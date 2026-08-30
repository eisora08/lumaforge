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
        // Read only this entry + its sessions (O(1) instead of full store)
        let mut entry = match db::read_playtime_entry(conn, &input.game_key)? {
            Some(e) => e,
            None => PlaytimeEntry {
                game_key: input.game_key.clone(),
                app_id: input.app_id.clone(),
                provider: input.provider.clone(),
                title: input.title.clone(),
                playtime_source: Some(if input.provider == "steam" {
                    "external"
                } else {
                    "local"
                }
                .to_string()),
                external_playtime_seconds: 0,
                external_source: None,
                external_imported_at: None,
                local_playtime_seconds: 0,
                total_playtime_seconds: 0,
                last_played_at: None,
                last_session_seconds: None,
                sessions: Vec::new(),
            },
        };

        // Auto-close any stale sessions (endedAt = null) for this game (single UPDATE)
        db::auto_close_stale_sessions(conn, &input.game_key, session_started_at as i64)?;

        // Cap sessions at MAX — read fresh count after auto-close
        let open_count = entry.sessions.iter().filter(|s| s.ended_at.is_none()).count();
        let total_count = entry.sessions.len();
        if total_count >= MAX_SESSIONS_PER_GAME {
            // Remove oldest sessions to make room
            entry.sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));
            entry.sessions.truncate(MAX_SESSIONS_PER_GAME - 1);
        }

        // Add the new session
        entry.sessions.push(PlaytimeSession {
            session_id: session_id.clone(),
            started_at: session_started_at,
            ended_at: None,
            duration_seconds: None,
            exit_reason: None,
        });

        entry.last_played_at = Some(session_started_at);

        // Upsert only this entry + new session (not the full store)
        db::upsert_playtime_entry(conn, &entry)?;
        db::upsert_playtime_session(
            conn,
            entry.sessions.last().unwrap(),
            &game_key,
        )?;

        // Trim old sessions for this game only
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
        // Read only this entry (O(1) instead of full store)
        let mut entry = db::read_playtime_entry(conn, &game_key)?
            .ok_or_else(|| format!("No playtime entry for game: {}", game_key))?;

        // Find the session to close
        let session = entry
            .sessions
            .iter_mut()
            .find(|s| s.session_id == input.session_id)
            .ok_or_else(|| format!("Session not found: {}", input.session_id))?;

        // Guard: prevent duplicate end
        if session.ended_at.is_some() {
            return Ok(entry);
        }

        session.ended_at = Some(input.ended_at);
        session.exit_reason = Some(input.exit_reason.clone());

        let duration = input.ended_at.saturating_sub(session.started_at);
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

        let is_external_game = entry.playtime_source.as_deref() == Some("external");

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

        // Upsert only the changed entry + session
        db::upsert_playtime_entry(conn, &entry)?;
        db::upsert_playtime_session(
            conn,
            entry.sessions.iter().find(|s| s.session_id == input.session_id).unwrap(),
            &game_key,
        )?;

        Ok(entry)
    })
}

#[tauri::command]
pub fn import_external_playtime(
    db: State<'_, SqliteCoreDb>,
    input: ExternalPlaytimeImport,
) -> Result<PlaytimeEntry, String> {
    let title = input.title.clone().unwrap_or_else(|| "Unknown".to_string());

    with_conn(&db, |conn| {
        // Read only this entry (O(1) instead of full store)
        let mut entry = match db::read_playtime_entry(conn, &input.game_key)? {
            Some(mut e) => {
                update_external(&mut e, input.external_playtime_seconds, &input.external_source);
                // Update last_played_at when incoming value is more recent
                if let Some(lp) = input.last_played_at_seconds {
                    if lp > 0 {
                        if e.last_played_at.map_or(true, |existing| lp > existing) {
                            e.last_played_at = Some(lp);
                        }
                    }
                }
                e
            }
            None => {
                let playtime_source = Some(if input.provider == "steam" {
                    "external"
                } else {
                    "local"
                }
                .to_string());
                PlaytimeEntry {
                    game_key: input.game_key.clone(),
                    app_id: input.app_id,
                    provider: input.provider,
                    title,
                    playtime_source,
                    external_playtime_seconds: input.external_playtime_seconds,
                    external_source: Some(input.external_source),
                    external_imported_at: Some(now_secs()),
                    local_playtime_seconds: 0,
                    total_playtime_seconds: input.external_playtime_seconds,
                    last_played_at: input.last_played_at_seconds.filter(|&v| v > 0),
                    last_session_seconds: None,
                    sessions: Vec::new(),
                }
            }
        };

        // Upsert only the changed entry (sessions untouched)
        db::upsert_playtime_entry(conn, &entry)?;

        Ok(entry)
    })
}

/// Batch import external playtime for multiple games in a single transaction.
#[tauri::command]
pub fn batch_import_external_playtime(
    db: State<'_, SqliteCoreDb>,
    inputs: Vec<ExternalPlaytimeImport>,
) -> Result<u32, String> {
    with_conn(&db, |conn| {
        let mut entries = Vec::with_capacity(inputs.len());

        for input in &inputs {
            let title = input.title.clone().unwrap_or_else(|| "Unknown".to_string());
            let entry = match db::read_playtime_entry(conn, &input.game_key)? {
                Some(mut e) => {
                    update_external(&mut e, input.external_playtime_seconds, &input.external_source);
                    if let Some(lp) = input.last_played_at_seconds {
                        if lp > 0 {
                            if e.last_played_at.map_or(true, |existing| lp > existing) {
                                e.last_played_at = Some(lp);
                            }
                        }
                    }
                    e
                }
                None => {
                    let playtime_source = Some(if input.provider == "steam" {
                        "external"
                    } else {
                        "local"
                    }
                    .to_string());
                    PlaytimeEntry {
                        game_key: input.game_key.clone(),
                        app_id: input.app_id.clone(),
                        provider: input.provider.clone(),
                        title,
                        playtime_source,
                        external_playtime_seconds: input.external_playtime_seconds,
                        external_source: Some(input.external_source.clone()),
                        external_imported_at: Some(now_secs()),
                        local_playtime_seconds: 0,
                        total_playtime_seconds: input.external_playtime_seconds,
                        last_played_at: input.last_played_at_seconds.filter(|&v| v > 0),
                        last_session_seconds: None,
                        sessions: Vec::new(),
                    }
                }
            };
            entries.push(entry);
        }

        let count = db::batch_upsert_playtime_entries(conn, &entries)?;
        Ok(count)
    })
}

// ---------------------------------------------------------------------------
// get_recent_played_games — 5 most recently played games for tray menu
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct RecentGame {
    pub app_id: String,
    pub title: String,
}

#[tauri::command]
pub fn get_recent_played_games(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<RecentGame>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT app_id, title FROM playtime_entries \
                 WHERE app_id IS NOT NULL AND app_id != '' \
                 AND last_played_at IS NOT NULL AND last_played_at > 0 \
                 ORDER BY last_played_at DESC LIMIT 5",
            )
            .map_err(|e| format!("Failed to prepare recent games query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(RecentGame {
                    app_id: row.get::<_, String>(0).unwrap_or_default(),
                    title: row.get::<_, String>(1).unwrap_or_default(),
                })
            })
            .map_err(|e| format!("Failed to query recent games: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            if let Ok(game) = row {
                results.push(game);
            }
        }
        Ok(results)
    })
}
