use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;
use uuid::Uuid;

use crate::commands::sqlite_cache::SqliteCoreDb;
use crate::models::playtime::{
    ActivePlaySession, PlaySessionEnd, PlaySessionStart, PlaytimeEntry, PlaytimeStore,
    PLAYTIME_STORE_VERSION,
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

/// Convert a game_key to a game_id (for backward compat with old callers)
fn game_key_to_game_id(game_key: &str) -> String {
    if let Some(key) = game_key.strip_prefix("app-") {
        return format!("steam-{}", key);
    }
    game_key.to_string()
}

// ---------------------------------------------------------------------------
// Tauri commands — session tracking via game_sessions table
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn record_play_session_start(
    db: State<'_, SqliteCoreDb>,
    input: PlaySessionStart,
) -> Result<ActivePlaySession, String> {
    let session_id = Uuid::new_v4().to_string();
    let game_key = input.game_key.clone();
    let game_id = game_key_to_game_id(&game_key);
    let session_started_at = input.started_at;

    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    // Auto-close any stale sessions for this game
    conn.execute(
        "UPDATE game_sessions
         SET ended_at = ?1,
             duration_seconds = ?1 - started_at,
             exit_reason = 'auto-closed'
         WHERE game_id = ?2 AND ended_at IS NULL AND started_at < ?1 - 86400",
        rusqlite::params![session_started_at as i64, game_id],
    )
    .map_err(|e| format!("Failed to auto-close stale sessions: {}", e))?;

    // Cap sessions at 50 per game
    conn.execute(
        "DELETE FROM game_sessions
         WHERE session_id IN (
             SELECT session_id FROM game_sessions
             WHERE game_id = ?1
             ORDER BY started_at DESC
             LIMIT -1 OFFSET 49
         )",
        [&game_id],
    )
    .map_err(|e| format!("Failed to cap sessions: {}", e))?;

    // Insert the new session
    conn.execute(
        "INSERT INTO game_sessions (session_id, game_id, started_at, source)
         VALUES (?1, ?2, ?3, 'local')",
        rusqlite::params![session_id, game_id, session_started_at],
    )
    .map_err(|e| format!("Failed to insert session: {}", e))?;

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
    let game_id = game_key_to_game_id(&game_key);

    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    // Find the session to close
    let session: (i64, i64) = conn
        .query_row(
            "SELECT started_at, COALESCE(ended_at, 0) FROM game_sessions
             WHERE session_id = ?1 AND game_id = ?2",
            rusqlite::params![input.session_id, game_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Session not found: {}", e))?;

    // Guard: prevent duplicate end
    if session.1 > 0 {
        return Ok(PlaytimeEntry {
            game_key,
            app_id: None,
            provider: "unknown".to_string(),
            title: String::new(),
            playtime_source: None,
            external_playtime_seconds: 0,
            external_source: None,
            external_imported_at: None,
            local_playtime_seconds: 0,
            total_playtime_seconds: 0,
            last_played_at: Some(input.ended_at),
            last_session_seconds: None,
            sessions: Vec::new(),
        });
    }

    let duration = input.ended_at.saturating_sub(session.0 as u64);

    // Update the session
    conn.execute(
        "UPDATE game_sessions
         SET ended_at = ?1,
             duration_seconds = ?2,
             exit_reason = ?3
         WHERE session_id = ?4",
        rusqlite::params![input.ended_at, duration, input.exit_reason, input.session_id],
    )
    .map_err(|e| format!("Failed to update session: {}", e))?;

    // Build a minimal PlaytimeEntry for return
    Ok(PlaytimeEntry {
        game_key,
        app_id: None,
        provider: "unknown".to_string(),
        title: String::new(),
        playtime_source: None,
        external_playtime_seconds: 0,
        external_source: None,
        external_imported_at: None,
        local_playtime_seconds: 0,
        total_playtime_seconds: 0,
        last_played_at: Some(input.ended_at),
        last_session_seconds: Some(duration),
        sessions: Vec::new(),
    })
}

/// Read playtime store — now returns empty since playtime data lives in games_v2.
pub fn read_store_from_db(_conn: &rusqlite::Connection) -> PlaytimeStore {
    PlaytimeStore {
        version: PLAYTIME_STORE_VERSION,
        updated_at: now_secs(),
        games: HashMap::new(),
    }
}

#[tauri::command]
pub fn read_playtime_store(
    db: State<'_, SqliteCoreDb>,
) -> Result<PlaytimeStore, String> {
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(read_store_from_db(&conn))
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
    let guard = db.0.as_ref().ok_or("Core DB not initialized")?;
    let conn = guard
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    // Query from games_v2 instead of playtime_entries
    let mut stmt = conn
        .prepare(
            "SELECT app_id, title FROM games_v2
             WHERE app_id IS NOT NULL AND app_id != ''
             AND last_played_at IS NOT NULL AND last_played_at > 0
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
}
