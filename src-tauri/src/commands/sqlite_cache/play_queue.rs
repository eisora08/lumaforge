use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Play Next queue — ordered list of games the user wants to play next.
// ---------------------------------------------------------------------------

const MAX_QUEUE_SIZE: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayQueueEntry {
    pub game_id: String,
    pub position: i32,
    pub added_at: i64,
}

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS play_queue (
            game_id   TEXT PRIMARY KEY,
            position  INTEGER NOT NULL,
            added_at  INTEGER NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Failed to create play_queue table: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Inner functions
// ---------------------------------------------------------------------------

pub fn get_play_queue_inner(db: &Mutex<Connection>) -> Result<Vec<PlayQueueEntry>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT game_id, position, added_at FROM play_queue ORDER BY position ASC")
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let entries = stmt
        .query_map([], |row| {
            Ok(PlayQueueEntry {
                game_id: row.get(0)?,
                position: row.get(1)?,
                added_at: row.get(2)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

pub fn add_to_play_queue_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<PlayQueueEntry, String> {
    let conn = db.lock().unwrap();

    // Check if already in queue
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM play_queue WHERE game_id = ?1",
            [game_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if exists {
        return Err("Game already in play queue".into());
    }

    // Enforce max size
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM play_queue", [], |row| row.get(0))
        .unwrap_or(0);

    if count >= MAX_QUEUE_SIZE as i64 {
        return Err(format!("Play queue is full (max {})", MAX_QUEUE_SIZE).into());
    }

    // Get next position
    let max_pos: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM play_queue",
            [],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let new_pos = max_pos + 1;
    let ts = now();

    conn.execute(
        "INSERT INTO play_queue (game_id, position, added_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![game_id, new_pos, ts],
    )
    .map_err(|e| format!("Insert error: {}", e))?;

    Ok(PlayQueueEntry {
        game_id: game_id.to_string(),
        position: new_pos,
        added_at: ts,
    })
}

pub fn remove_from_play_queue_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<(), String> {
    let conn = db.lock().unwrap();

    let deleted = conn
        .execute("DELETE FROM play_queue WHERE game_id = ?1", [game_id])
        .map_err(|e| format!("Delete error: {}", e))?;

    if deleted == 0 {
        return Err("Game not in play queue".into());
    }

    // Reorder remaining entries to fill gaps
    let mut stmt = conn
        .prepare("SELECT game_id FROM play_queue ORDER BY position ASC")
        .map_err(|e| format!("Query error: {}", e))?;
    let entries: Vec<(String, i32)> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Query error: {}", e))?
        .filter_map(|r| r.ok())
        .enumerate()
        .map(|(i, id)| (id, i as i32))
        .collect();

    for (id, pos) in &entries {
        conn.execute(
            "UPDATE play_queue SET position = ?1 WHERE game_id = ?2",
            rusqlite::params![pos, id],
        )
        .map_err(|e| format!("Reorder error: {}", e))?;
    }

    Ok(())
}

pub fn reorder_play_queue_inner(
    db: &Mutex<Connection>,
    game_ids: &[String],
) -> Result<(), String> {
    let conn = db.lock().unwrap();

    for (i, id) in game_ids.iter().enumerate() {
        conn.execute(
            "UPDATE play_queue SET position = ?1 WHERE game_id = ?2",
            rusqlite::params![i as i32, id],
        )
        .map_err(|e| format!("Reorder error for {}: {}", id, e))?;
    }

    Ok(())
}

pub fn clear_play_queue_inner(db: &Mutex<Connection>) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM play_queue", [])
        .map_err(|e| format!("Clear error: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_play_queue(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<PlayQueueEntry>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(vec![]);
    };
    get_play_queue_inner(db)
}

#[tauri::command]
pub fn add_to_play_queue(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<PlayQueueEntry, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    let entry = add_to_play_queue_inner(db, &game_id)?;
    crate::utils::progress_utils::emit_data_changed(&app, "play-queue-changed", &game_id);
    Ok(entry)
}

#[tauri::command]
pub fn remove_from_play_queue(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    remove_from_play_queue_inner(db, &game_id)?;
    crate::utils::progress_utils::emit_data_changed(&app, "play-queue-changed", &game_id);
    Ok(())
}

#[tauri::command]
pub fn reorder_play_queue(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    game_ids: Vec<String>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    reorder_play_queue_inner(db, &game_ids)?;
    crate::utils::progress_utils::emit_data_changed(&app, "play-queue-changed", "reorder");
    Ok(())
}

#[tauri::command]
pub fn clear_play_queue(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Err("Database not initialized".into());
    };
    clear_play_queue_inner(db)?;
    crate::utils::progress_utils::emit_data_changed(&app, "play-queue-changed", "cleared");
    Ok(())
}
