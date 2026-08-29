use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache;
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

// ─── Commands ──

#[tauri::command]
pub fn read_epic_games(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<EpicGameEntryJson>, String> {
    let Some(inner) = db.0.as_ref() else {
        return Ok(vec![]);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::epic_games_cache::read_epic_games(&conn)?;

    let Some(json) = json_opt else {
        return Ok(vec![]);
    };

    let file: EpicGamesFile = serde_json::from_str(&json).map_err(|e| {
        println!("[EpicGames] corrupt data in SQLite, returning empty: {}", e);
        format!("Corrupt epic games data: {}", e)
    })?;

    Ok(file.entries)
}

#[tauri::command]
pub fn write_epic_games(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
    entries: Vec<EpicGameEntryJson>,
) -> Result<(), String> {
    let Some(inner) = db.0.as_ref() else {
        return Err("SQLite core DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let file = EpicGamesFile {
        version: 1,
        entries,
    };

    let json =
        serde_json::to_string_pretty(&file).map_err(|e| format!("Failed to serialize: {}", e))?;

    sqlite_cache::epic_games_cache::write_epic_games(&conn, &json)?;

    Ok(())
}

#[tauri::command]
pub fn backup_epic_games(_app_handle: AppHandle) -> Result<String, String> {
    Ok("backup no longer needed, data is in SQLite".to_string())
}
