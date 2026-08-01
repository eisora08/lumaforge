use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

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

const FILENAME: &str = "debrid-games.json";

// ─── Helpers ──

fn get_debrid_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("games").join("debrid");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create debrid games dir: {}", e))?;
    Ok(dir)
}

fn get_debrid_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_debrid_dir(app_handle)?.join(FILENAME))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─── Commands ──

#[tauri::command]
pub fn read_debrid_games(app_handle: AppHandle) -> Result<Vec<DebridGameEntry>, String> {
    let path = get_debrid_path(&app_handle)?;

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read debrid games file: {}", e))?;

    let file: DebridGamesFile = serde_json::from_str(&content).map_err(|e| {
        let timestamp = now_secs();
        let backup_name = format!("debrid-games.corrupt.{}.json", timestamp);
        if let Ok(dir) = get_debrid_dir(&app_handle) {
            let backup_path = dir.join(&backup_name);
            let _ = fs::copy(&path, &backup_path);
            let _ = fs::rename(&path, &backup_path);
            println!(
                "[DebridGames] corrupt file backed up to {}, returning empty",
                backup_name
            );
        }
        format!("Corrupt debrid games file: {}", e)
    })?;

    Ok(file.entries)
}

#[tauri::command]
pub fn write_debrid_games(app_handle: AppHandle, entries: Vec<DebridGameEntry>) -> Result<(), String> {
    let path = get_debrid_path(&app_handle)?;
    let tmp_path = path.with_extension("tmp.json");

    let file = DebridGamesFile {
        version: 1,
        entries,
    };

    let json =
        serde_json::to_string_pretty(&file).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn backup_debrid_games(app_handle: AppHandle) -> Result<String, String> {
    let path = get_debrid_path(&app_handle)?;

    if !path.exists() {
        return Ok("no-file".to_string());
    }

    let timestamp = now_secs();
    let backup_name = format!("debrid-games.backup.{}.json", timestamp);
    let backup_path = get_debrid_dir(&app_handle)?.join(&backup_name);

    fs::copy(&path, &backup_path)
        .map_err(|e| format!("Failed to backup debrid games: {}", e))?;

    println!("[DebridGames] backed up to {}", backup_name);
    Ok(backup_name)
}
