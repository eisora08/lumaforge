use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Game sessions — unified session tracking with FK to games_v2 (v10+)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSession {
    pub session_id: String,
    pub game_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub exit_reason: Option<String>,
    pub source: String,
}

// ---------------------------------------------------------------------------
// CRUD — GameSession
// ---------------------------------------------------------------------------

pub fn upsert_game_session_inner(
    db: &Mutex<Connection>,
    session: &GameSession,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO game_sessions (session_id, game_id, started_at, ended_at, duration_seconds, exit_reason, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(session_id) DO UPDATE SET
            ended_at = excluded.ended_at,
            duration_seconds = excluded.duration_seconds,
            exit_reason = excluded.exit_reason",
        rusqlite::params![
            session.session_id,
            session.game_id,
            session.started_at,
            session.ended_at,
            session.duration_seconds,
            session.exit_reason,
            session.source,
        ],
    )
    .map_err(|e| format!("Failed to upsert game session: {}", e))?;
    Ok(())
}

pub fn get_game_sessions_for_game_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<Vec<GameSession>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT session_id, game_id, started_at, ended_at, duration_seconds, exit_reason, source
             FROM game_sessions WHERE game_id = ?1 ORDER BY started_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([game_id], |row| {
            Ok(GameSession {
                session_id: row.get(0)?,
                game_id: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                duration_seconds: row.get(4)?,
                exit_reason: row.get(5)?,
                source: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query game sessions: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(session) = row {
            results.push(session);
        }
    }
    Ok(results)
}

pub fn get_all_game_sessions_inner(
    db: &Mutex<Connection>,
    limit: Option<i64>,
) -> Result<Vec<GameSession>, String> {
    let conn = db.lock().unwrap();
    let query = match limit {
        Some(l) => format!(
            "SELECT session_id, game_id, started_at, ended_at, duration_seconds, exit_reason, source
             FROM game_sessions ORDER BY started_at DESC LIMIT {}",
            l
        ),
        None => "SELECT session_id, game_id, started_at, ended_at, duration_seconds, exit_reason, source
                 FROM game_sessions ORDER BY started_at DESC"
            .to_string(),
    };

    let mut stmt = conn
        .prepare(&query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(GameSession {
                session_id: row.get(0)?,
                game_id: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                duration_seconds: row.get(4)?,
                exit_reason: row.get(5)?,
                source: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query game sessions: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(session) = row {
            results.push(session);
        }
    }
    Ok(results)
}

pub fn delete_game_sessions_for_game_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM game_sessions WHERE game_id = ?1", [game_id])
        .map_err(|e| format!("Failed to delete game sessions: {}", e))?;
    Ok(())
}

pub fn update_game_session_end_inner(
    db: &Mutex<Connection>,
    session_id: &str,
    ended_at: i64,
    duration_seconds: i64,
    exit_reason: &str,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE game_sessions
         SET ended_at = ?1,
             duration_seconds = ?2,
             exit_reason = ?3
         WHERE session_id = ?4",
        rusqlite::params![ended_at, duration_seconds, exit_reason, session_id],
    )
    .map_err(|e| format!("Failed to update game session: {}", e))?;
    Ok(())
}

pub fn get_recent_game_sessions_inner(
    db: &Mutex<Connection>,
    limit: i64,
) -> Result<Vec<GameSession>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT session_id, game_id, started_at, ended_at, duration_seconds, exit_reason, source
             FROM game_sessions
             WHERE ended_at IS NOT NULL
             ORDER BY ended_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([limit], |row| {
            Ok(GameSession {
                session_id: row.get(0)?,
                game_id: row.get(1)?,
                started_at: row.get(2)?,
                ended_at: row.get(3)?,
                duration_seconds: row.get(4)?,
                exit_reason: row.get(5)?,
                source: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query recent sessions: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(session) = row {
            results.push(session);
        }
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn upsert_game_session(
    state: tauri::State<'_, SqliteCoreDb>,
    session: GameSession,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_game_session_inner(db, &session)
}

#[tauri::command]
pub fn get_game_sessions_for_game(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Vec<GameSession>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_game_sessions_for_game_inner(db, &game_id)
}

#[tauri::command]
pub fn get_all_game_sessions(
    state: tauri::State<'_, SqliteCoreDb>,
    limit: Option<i64>,
) -> Result<Vec<GameSession>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_all_game_sessions_inner(db, limit)
}

#[tauri::command]
pub fn delete_game_sessions_for_game(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    delete_game_sessions_for_game_inner(db, &game_id)
}

#[tauri::command]
pub fn update_game_session_end(
    state: tauri::State<'_, SqliteCoreDb>,
    session_id: String,
    ended_at: i64,
    duration_seconds: i64,
    exit_reason: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    update_game_session_end_inner(db, &session_id, ended_at, duration_seconds, &exit_reason)
}

#[tauri::command]
pub fn get_recent_game_sessions(
    state: tauri::State<'_, SqliteCoreDb>,
    limit: i64,
) -> Result<Vec<GameSession>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_recent_game_sessions_inner(db, limit)
}
