use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportExclusion {
    pub id: i64,
    pub game_id: Option<String>,
    pub folder: Option<String>,
    pub title: Option<String>,
    pub reason: Option<String>,
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// Inner functions
// ---------------------------------------------------------------------------

pub fn add_import_exclusion_inner(
    db: &Mutex<Connection>,
    game_id: Option<&str>,
    folder: Option<&str>,
    title: Option<&str>,
    reason: Option<&str>,
) -> Result<i64, String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO import_exclusions (game_id, folder, title, reason) VALUES (?1, ?2, ?3, ?4)",
        params![game_id, folder, title, reason],
    )
    .map_err(|e| format!("add_import_exclusion: {}", e))?;
    Ok(conn.last_insert_rowid())
}

pub fn get_import_exclusions_inner(db: &Mutex<Connection>) -> Result<Vec<ImportExclusion>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, game_id, folder, title, reason, created_at FROM import_exclusions ORDER BY created_at DESC")
        .map_err(|e| format!("get_import_exclusions prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportExclusion {
                id: row.get(0)?,
                game_id: row.get(1)?,
                folder: row.get(2)?,
                title: row.get(3)?,
                reason: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("get_import_exclusions query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

pub fn is_game_excluded_inner(db: &Mutex<Connection>, game_id: &str) -> Result<bool, String> {
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM import_exclusions WHERE game_id = ?1",
            params![game_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("is_game_excluded: {}", e))?;
    Ok(count > 0)
}

pub fn is_folder_excluded_inner(db: &Mutex<Connection>, folder: &str) -> Result<bool, String> {
    let conn = db.lock().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM import_exclusions WHERE folder = ?1",
            params![folder],
            |row| row.get(0),
        )
        .map_err(|e| format!("is_folder_excluded: {}", e))?;
    Ok(count > 0)
}

pub fn remove_import_exclusion_inner(db: &Mutex<Connection>, id: i64) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM import_exclusions WHERE id = ?1", params![id])
        .map_err(|e| format!("remove_import_exclusion: {}", e))?;
    Ok(())
}

// ============================================
// TAURI COMMANDS
// ============================================

#[tauri::command]
pub fn add_import_exclusion_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: Option<String>,
    folder: Option<String>,
    title: Option<String>,
    reason: Option<String>,
) -> Result<i64, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(0);
    };
    add_import_exclusion_inner(db, game_id.as_deref(), folder.as_deref(), title.as_deref(), reason.as_deref())
}

#[tauri::command]
pub fn get_import_exclusions_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<ImportExclusion>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(Vec::new());
    };
    get_import_exclusions_inner(db)
}

#[tauri::command]
pub fn is_game_excluded_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<bool, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(false);
    };
    is_game_excluded_inner(db, &game_id)
}

#[tauri::command]
pub fn is_folder_excluded_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    folder: String,
) -> Result<bool, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(false);
    };
    is_folder_excluded_inner(db, &folder)
}

#[tauri::command]
pub fn remove_import_exclusion_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    id: i64,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    remove_import_exclusion_inner(db, id)
}
