use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicGameEntryJson {
    /// Full `epic:<namespace>:<catalogItemId>:<appName>` identifier.
    pub app_id: String,
    pub title: String,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub playtime: i64,
    #[serde(default)]
    pub last_played: i64,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default = "default_empty_json")]
    pub media_json: String,
    #[serde(default = "default_empty_json")]
    pub metadata_json: String,
    #[serde(default)]
    pub install_dir: Option<String>,
    #[serde(default)]
    pub executable_path: Option<String>,
    #[serde(default)]
    pub size_on_disk: Option<u64>,
}

fn default_provider() -> String {
    "epic".to_string()
}

fn default_empty_json() -> String {
    "{}".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpicGamesFile {
    pub version: u32,
    pub entries: Vec<EpicGameEntryJson>,
}

// ─── Commands (stubs — data now lives in games_v2) ──

#[tauri::command]
pub fn read_epic_games(
    _app_handle: AppHandle,
    _db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<EpicGameEntryJson>, String> {
    // Deprecated: data now lives in games_v2. Return empty for backwards compat.
    Ok(vec![])
}

#[tauri::command]
pub fn write_epic_games(
    _app_handle: AppHandle,
    _db: tauri::State<'_, SqliteCoreDb>,
    _entries: Vec<EpicGameEntryJson>,
) -> Result<(), String> {
    // Deprecated: data now lives in games_v2. No-op for backwards compat.
    Ok(())
}

#[tauri::command]
pub fn backup_epic_games(_app_handle: AppHandle) -> Result<String, String> {
    Ok("backup no longer needed, data is in games_v2".to_string())
}
