use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::commands::sqlite_cache::playtime as db;
use crate::commands::sqlite_cache::SqliteCoreDb;
use crate::models::playtime::{
    ActivePlaySession, ExternalPlaytimeImport, PlaySessionEnd, PlaySessionStart, PlaytimeEntry,
    PlaytimeSession, PlaytimeStore, MAX_SESSIONS_PER_GAME, PLAYTIME_STORE_VERSION,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn empty_store() -> PlaytimeStore {
    PlaytimeStore {
        version: PLAYTIME_STORE_VERSION,
        updated_at: now_secs(),
        games: HashMap::new(),
    }
}

fn ensure_entry(
    store: &mut PlaytimeStore,
    game_key: &str,
    app_id: Option<String>,
    provider: &str,
    title: &str,
) {
    let key = game_key.to_string();
    let prov = provider.to_string();
    let t = title.to_string();
    store.games.entry(key).or_insert_with(|| {
        let playtime_source = if prov == "steam" {
            Some("external".to_string())
        } else if prov == "local" {
            Some("local".to_string())
        } else {
            None
        };
        PlaytimeEntry {
            game_key: game_key.to_string(),
            app_id,
            provider: prov,
            title: t,
            playtime_source,
            external_playtime_seconds: 0,
            external_source: None,
            external_imported_at: None,
            local_playtime_seconds: 0,
            total_playtime_seconds: 0,
            last_played_at: None,
            last_session_seconds: None,
            sessions: Vec::new(),
        }
    });
}

fn update_external(entry: &mut PlaytimeEntry, external_seconds: u64, external_source: &str) {
    if external_seconds > entry.external_playtime_seconds {
        entry.external_playtime_seconds = external_seconds;
        entry.external_source = Some(external_source.to_string());
        entry.external_imported_at = Some(now_secs());
    }
    // Source-aware total: external games don't accumulate local
    if entry.playtime_source.as_deref() == Some("external") || entry.external_source.is_some() {
        entry.total_playtime_seconds = entry.external_playtime_seconds;
    } else {
        entry.total_playtime_seconds =
            entry.external_playtime_seconds + entry.local_playtime_seconds;
    }
}

// ---------------------------------------------------------------------------
// Database read/write (replaces JSON file I/O)
// ---------------------------------------------------------------------------

/// Read the full playtime store from SQLite: all entries + their sessions.
pub fn read_store_from_db(conn: &rusqlite::Connection) -> PlaytimeStore {
    let entries = match db::read_all_playtime_entries(conn) {
        Ok(e) => e,
        Err(e) => {
            println!("[Playtime] DB read error ({}), returning empty", e);
            return empty_store();
        }
    };

    let mut store = PlaytimeStore {
        version: PLAYTIME_STORE_VERSION,
        updated_at: now_secs(),
        games: HashMap::new(),
    };

    for mut entry in entries {
        let sessions =
            db::read_playtime_sessions_for_game(conn, &entry.game_key).unwrap_or_default();
        entry.sessions = sessions;
        store.games.insert(entry.game_key.clone(), entry);
    }

    store
}

/// Write the full playtime store to SQLite: upsert all entries and sessions,
/// then trim old sessions per game.
fn write_store_to_db(
    conn: &rusqlite::Connection,
    store: &PlaytimeStore,
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    for entry in store.games.values() {
        db::upsert_playtime_entry(&tx, entry)?;
        for session in &entry.sessions {
            db::upsert_playtime_session(&tx, session, &entry.game_key)?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    // Trim old sessions after commit (non-critical, separate statements)
    for entry in store.games.values() {
        if entry.sessions.len() > MAX_SESSIONS_PER_GAME {
            db::delete_playtime_sessions_older_than(
                conn,
                &entry.game_key,
                MAX_SESSIONS_PER_GAME,
            )?;
        }
    }

    Ok(())
}

/// Acquire the SQLite connection from the Tauri state, returning an error string
/// if unavailable.
fn with_conn<F, R>(db: &State<'_, SqliteCoreDb>, f: F) -> Result<R, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<R, String>,
{
    let guard = db
        .0
        .as_ref()
        .ok_or("SQLite not available")?
        .lock()
        .map_err(|e| e.to_string())?;
    f(&guard)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_playtime_store(
    db: State<'_, SqliteCoreDb>,
) -> Result<PlaytimeStore, String> {
    with_conn(&db, |conn| Ok(read_store_from_db(conn)))
}

#[tauri::command]
pub fn write_playtime_store(
    db: State<'_, SqliteCoreDb>,
    store: PlaytimeStore,
) -> Result<(), String> {
    with_conn(&db, |conn| write_store_to_db(conn, &store))
}

#[tauri::command]
pub fn record_play_session_start(
    db: State<'_, SqliteCoreDb>,
    input: PlaySessionStart,
) -> Result<ActivePlaySession, String> {
    let session_id = Uuid::new_v4().to_string();
    let game_key = input.game_key.clone();
    let session_started_at = input.started_at;

    with_conn(&db, |conn| {
        // Read existing entry (if any) + its sessions
        let mut store = read_store_from_db(conn);

        ensure_entry(
            &mut store,
            &input.game_key,
            input.app_id.clone(),
            &input.provider,
            &input.title,
        );

        // Auto-close any stale sessions (endedAt = null) for this game
        if let Some(entry) = store.games.get_mut(&input.game_key) {
            for session in entry.sessions.iter_mut() {
                if session.ended_at.is_none() {
                    session.ended_at = Some(session_started_at);
                    session.exit_reason = Some("auto-closed".to_string());
                    session.duration_seconds =
                        Some(session_started_at.saturating_sub(session.started_at));
                }
            }
        }

        // Add the new session
        let entry = store.games.get_mut(&input.game_key).unwrap();
        while entry.sessions.len() >= MAX_SESSIONS_PER_GAME {
            entry.sessions.remove(0);
        }

        entry.sessions.push(PlaytimeSession {
            session_id: session_id.clone(),
            started_at: session_started_at,
            ended_at: None,
            duration_seconds: None,
            exit_reason: None,
        });

        entry.last_played_at = Some(session_started_at);
        store.updated_at = now_secs();

        // Write entry + all sessions (including auto-closed ones)
        write_store_to_db(conn, &store)?;

        // Trim old sessions
        db::delete_playtime_sessions_older_than(conn, &game_key, MAX_SESSIONS_PER_GAME)?;

        Ok(())
    })?;

    Ok(ActivePlaySession {
        session_id,
        started_at: session_started_at,
        game_key,
    })
}

#[tauri::command]
pub fn record_play_session_end(
    db: State<'_, SqliteCoreDb>,
    input: PlaySessionEnd,
) -> Result<PlaytimeEntry, String> {
    let game_key = input.game_key.clone();

    with_conn(&db, |conn| {
        let mut store = read_store_from_db(conn);

        let has_entry = store
            .games
            .get(&game_key)
            .map(|e| e.sessions.iter().any(|s| s.session_id == input.session_id))
            .unwrap_or(false);

        if !has_entry {
            return Err(format!("Session not found: {}", input.session_id));
        }

        // Guard: prevent duplicate end
        if store
            .games
            .get(&game_key)
            .and_then(|e| {
                e.sessions
                    .iter()
                    .find(|s| s.session_id == input.session_id)
            })
            .and_then(|s| s.ended_at)
            .is_some()
        {
            let entry = store.games.get(&game_key).unwrap().clone();
            return Ok(entry);
        }

        let duration;
        let is_external_game;
        {
            let entry = store.games.get_mut(&game_key).unwrap();
            let session = entry
                .sessions
                .iter_mut()
                .find(|s| s.session_id == input.session_id)
                .unwrap();

            session.ended_at = Some(input.ended_at);
            session.exit_reason = Some(input.exit_reason.clone());

            duration = input.ended_at.saturating_sub(session.started_at);
            session.duration_seconds = Some(duration);

            // Set playtime_source if not already set
            if entry.playtime_source.is_none() {
                entry.playtime_source = if entry.external_source.is_some() || entry.provider == "steam"
                {
                    Some("external".to_string())
                } else {
                    Some("local".to_string())
                };
            }

            is_external_game = entry.playtime_source.as_deref() == Some("external");

            if duration < 15 {
                // Too short — close session but don't count toward playtime
                entry.last_played_at = Some(input.ended_at);
            } else if is_external_game {
                // External game: don't persist to local, total = external + current session
                entry.total_playtime_seconds = entry.external_playtime_seconds + duration;
                entry.last_played_at = Some(input.ended_at);
                entry.last_session_seconds = Some(duration);
            } else {
                // Local game: accumulate normally
                entry.local_playtime_seconds += duration;
                entry.total_playtime_seconds =
                    entry.external_playtime_seconds + entry.local_playtime_seconds;
                entry.last_played_at = Some(input.ended_at);
                entry.last_session_seconds = Some(duration);
            }
        }

        store.updated_at = now_secs();

        // Upsert the updated session + entry
        let entry = store.games.get(&game_key).unwrap();
        let session = entry
            .sessions
            .iter()
            .find(|s| s.session_id == input.session_id)
            .unwrap();
        db::upsert_playtime_session(conn, session, &game_key)?;
        db::upsert_playtime_entry(conn, entry)?;

        Ok(entry.clone())
    })
}

#[tauri::command]
pub fn import_external_playtime(
    db: State<'_, SqliteCoreDb>,
    input: ExternalPlaytimeImport,
) -> Result<PlaytimeEntry, String> {
    let title = input.title.clone().unwrap_or_else(|| "Unknown".to_string());

    with_conn(&db, |conn| {
        let mut store = read_store_from_db(conn);

        ensure_entry(
            &mut store,
            &input.game_key,
            input.app_id,
            &input.provider,
            &title,
        );

        {
            let entry = store.games.get_mut(&input.game_key).unwrap();
            update_external(entry, input.external_playtime_seconds, &input.external_source);
        }

        store.updated_at = now_secs();

        // Upsert only the changed entry (sessions are untouched)
        let entry = store.games.get(&input.game_key).unwrap().clone();
        db::upsert_playtime_entry(conn, &entry)?;

        Ok(entry)
    })
}
