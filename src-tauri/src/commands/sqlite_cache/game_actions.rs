use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameAction {
    pub id: i64,
    pub game_id: String,
    pub action_type: String,
    pub label: String,
    pub command: String,
    pub arguments: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
}

// ---------------------------------------------------------------------------
// Inner functions
// ---------------------------------------------------------------------------

pub fn add_game_action_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    action_type: &str,
    label: &str,
    command: &str,
    arguments: Option<&str>,
    icon: Option<&str>,
    sort_order: i64,
) -> Result<i64, String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO game_actions (game_id, action_type, label, command, arguments, icon, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![game_id, action_type, label, command, arguments, icon, sort_order],
    )
    .map_err(|e| format!("add_game_action: {}", e))?;
    Ok(conn.last_insert_rowid())
}

pub fn get_game_actions_inner(db: &Mutex<Connection>, game_id: &str) -> Result<Vec<GameAction>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, action_type, label, command, arguments, icon, sort_order, created_at
             FROM game_actions WHERE game_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(|e| format!("get_game_actions prepare: {}", e))?;

    let rows = stmt
        .query_row(params![game_id], |row| {
            Ok(GameAction {
                id: row.get(0)?,
                game_id: row.get(1)?,
                action_type: row.get(2)?,
                label: row.get(3)?,
                command: row.get(4)?,
                arguments: row.get(5)?,
                icon: row.get(6)?,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .ok();

    // query_row only returns one row; use query_map for multiple
    let mut stmt2 = conn
        .prepare(
            "SELECT id, game_id, action_type, label, command, arguments, icon, sort_order, created_at
             FROM game_actions WHERE game_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(|e| format!("get_game_actions prepare2: {}", e))?;

    let rows = stmt2
        .query_map(params![game_id], |row| {
            Ok(GameAction {
                id: row.get(0)?,
                game_id: row.get(1)?,
                action_type: row.get(2)?,
                label: row.get(3)?,
                command: row.get(4)?,
                arguments: row.get(5)?,
                icon: row.get(6)?,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("get_game_actions query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

pub fn get_all_game_actions_inner(db: &Mutex<Connection>) -> Result<Vec<GameAction>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, action_type, label, command, arguments, icon, sort_order, created_at
             FROM game_actions ORDER BY game_id, sort_order, id",
        )
        .map_err(|e| format!("get_all_game_actions prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(GameAction {
                id: row.get(0)?,
                game_id: row.get(1)?,
                action_type: row.get(2)?,
                label: row.get(3)?,
                command: row.get(4)?,
                arguments: row.get(5)?,
                icon: row.get(6)?,
                sort_order: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("get_all_game_actions query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

pub fn update_game_action_inner(
    db: &Mutex<Connection>,
    id: i64,
    label: Option<&str>,
    command: Option<&str>,
    arguments: Option<&str>,
    icon: Option<&str>,
    sort_order: Option<i64>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE game_actions SET
            label = COALESCE(?2, label),
            command = COALESCE(?3, command),
            arguments = COALESCE(?4, arguments),
            icon = COALESCE(?5, icon),
            sort_order = COALESCE(?6, sort_order)
         WHERE id = ?1",
        params![id, label, command, arguments, icon, sort_order],
    )
    .map_err(|e| format!("update_game_action: {}", e))?;
    Ok(())
}

pub fn delete_game_action_inner(db: &Mutex<Connection>, id: i64) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM game_actions WHERE id = ?1", params![id])
        .map_err(|e| format!("delete_game_action: {}", e))?;
    Ok(())
}

pub fn delete_game_actions_for_game_inner(db: &Mutex<Connection>, game_id: &str) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM game_actions WHERE game_id = ?1", params![game_id])
        .map_err(|e| format!("delete_game_actions_for_game: {}", e))?;
    Ok(())
}

// ============================================
// TAURI COMMANDS
// ============================================

#[tauri::command]
pub fn add_game_action_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    gameId: String,
    actionType: String,
    label: String,
    command: String,
    arguments: Option<String>,
    icon: Option<String>,
    sortOrder: Option<i64>,
) -> Result<i64, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(0);
    };
    add_game_action_inner(
        db,
        &gameId,
        &actionType,
        &label,
        &command,
        arguments.as_deref(),
        icon.as_deref(),
        sortOrder.unwrap_or(0),
    )
}

#[tauri::command]
pub fn get_game_actions_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    gameId: String,
) -> Result<Vec<GameAction>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(Vec::new());
    };
    get_game_actions_inner(db, &gameId)
}

#[tauri::command]
pub fn get_all_game_actions_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<GameAction>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(Vec::new());
    };
    get_all_game_actions_inner(db)
}

#[tauri::command]
pub fn update_game_action_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    id: i64,
    label: Option<String>,
    command: Option<String>,
    arguments: Option<String>,
    icon: Option<String>,
    sortOrder: Option<i64>,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    update_game_action_inner(
        db,
        id,
        label.as_deref(),
        command.as_deref(),
        arguments.as_deref(),
        icon.as_deref(),
        sortOrder,
    )
}

#[tauri::command]
pub fn delete_game_action_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    id: i64,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    delete_game_action_inner(db, id)
}

#[tauri::command]
pub fn delete_game_actions_for_game_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    gameId: String,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    delete_game_actions_for_game_inner(db, &gameId)
}
