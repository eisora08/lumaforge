use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache;
use crate::commands::sqlite_cache::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridGameEntry {
    pub id: String,
    pub app_id: Option<i64>,
    #[serde(default)]
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_arguments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repacker: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installer_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_size: Option<i64>,
    pub installed_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebridGamesFile {
    pub version: u32,
    pub entries: Vec<DebridGameEntry>,
}

// ─── Commands ──

#[tauri::command]
pub fn read_debrid_games(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<DebridGameEntry>, String> {
    let Some(inner) = db.0.as_ref() else {
        return Ok(vec![]);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::debrid_games_cache::read_debrid_games(&conn)?;

    let Some(json) = json_opt else {
        return Ok(vec![]);
    };

    let file: DebridGamesFile = serde_json::from_str(&json).map_err(|e| {
        println!("[DebridGames] corrupt data in SQLite, returning empty: {}", e);
        format!("Corrupt debrid games data: {}", e)
    })?;

    Ok(file.entries)
}

#[tauri::command]
pub fn write_debrid_games(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
    entries: Vec<DebridGameEntry>,
) -> Result<(), String> {
    let Some(inner) = db.0.as_ref() else {
        return Err("SQLite core DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let file = DebridGamesFile {
        version: 1,
        entries,
    };

    let json =
        serde_json::to_string_pretty(&file).map_err(|e| format!("Failed to serialize: {}", e))?;

    sqlite_cache::debrid_games_cache::write_debrid_games(&conn, &json)?;

    Ok(())
}

#[tauri::command]
pub fn backup_debrid_games(_app_handle: AppHandle) -> Result<String, String> {
    Ok("backup no longer needed, data is in SQLite".to_string())
}
