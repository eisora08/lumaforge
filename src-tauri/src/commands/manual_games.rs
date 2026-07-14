use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

// ─── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualGameEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_arguments: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub landscape_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub developers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub publishers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub features: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sorting_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_score: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critic_score: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub community_score: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_count: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_rating: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_steam_app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_igdb_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_on_disk: Option<u64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_favorite: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualGamesFile {
    pub version: u32,
    pub entries: Vec<ManualGameEntry>,
}

const FILENAME: &str = "manual-games.json";

// ─── Helpers ──────────────────────────────────────────────────────────────

fn get_manual_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("games").join("manual");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create manual games dir: {}", e))?;
    Ok(dir)
}

fn get_manual_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_manual_dir(app_handle)?.join(FILENAME))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ─── Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn read_manual_games(app_handle: AppHandle) -> Result<Vec<ManualGameEntry>, String> {
    let path = get_manual_path(&app_handle)?;

    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read manual games file: {}", e))?;

    let file: ManualGamesFile = serde_json::from_str(&content).map_err(|e| {
        // Corrupt file — back up and return empty
        let timestamp = now_secs();
        let backup_name = format!("manual-games.corrupt.{}.json", timestamp);
        if let Ok(dir) = get_manual_dir(&app_handle) {
            let backup_path = dir.join(&backup_name);
            let _ = fs::copy(&path, &backup_path);
            let _ = fs::rename(&path, &backup_path);
            println!(
                "[ManualGames] corrupt file backed up to {}, returning empty",
                backup_name
            );
        }
        format!("Corrupt manual games file: {}", e)
    })?;

    Ok(file.entries)
}

#[tauri::command]
pub fn write_manual_games(app_handle: AppHandle, entries: Vec<ManualGameEntry>) -> Result<(), String> {
    let path = get_manual_path(&app_handle)?;
    let tmp_path = path.with_extension("tmp.json");

    let file = ManualGamesFile {
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
pub fn backup_manual_games(app_handle: AppHandle) -> Result<String, String> {
    let path = get_manual_path(&app_handle)?;

    if !path.exists() {
        return Ok("no-file".to_string());
    }

    let timestamp = now_secs();
    let backup_name = format!("manual-games.backup.{}.json", timestamp);
    let backup_path = get_manual_dir(&app_handle)?.join(&backup_name);

    fs::copy(&path, &backup_path)
        .map_err(|e| format!("Failed to backup manual games: {}", e))?;

    println!("[ManualGames] backed up to {}", backup_name);
    Ok(backup_name)
}
