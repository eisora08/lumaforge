use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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

// ─── Commands (stubs — data now lives in games_v2) ──

#[tauri::command]
pub fn read_debrid_games(
    _app_handle: AppHandle,
    _db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<DebridGameEntry>, String> {
    // Deprecated: data now lives in games_v2. Return empty for backwards compat.
    Ok(vec![])
}

#[tauri::command]
pub fn write_debrid_games(
    _app_handle: AppHandle,
    _db: tauri::State<'_, SqliteCoreDb>,
    _entries: Vec<DebridGameEntry>,
) -> Result<(), String> {
    // Deprecated: data now lives in games_v2. No-op for backwards compat.
    Ok(())
}

#[tauri::command]
pub fn backup_debrid_games(_app_handle: AppHandle) -> Result<String, String> {
    Ok("backup no longer needed, data is in games_v2".to_string())
}
