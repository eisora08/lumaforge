use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache::SqliteCoreDb;

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
    pub app_id: Option<String>,
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

// ─── Commands (stubs — data now lives in games_v2) ───────────────────────

#[tauri::command]
pub fn read_manual_games(
    _app_handle: AppHandle,
    _db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<ManualGameEntry>, String> {
    // Deprecated: data now lives in games_v2. Return empty for backwards compat.
    Ok(vec![])
}

#[tauri::command]
pub fn write_manual_games(
    _app_handle: AppHandle,
    _db: tauri::State<'_, SqliteCoreDb>,
    _entries: Vec<ManualGameEntry>,
) -> Result<(), String> {
    // Deprecated: data now lives in games_v2. No-op for backwards compat.
    Ok(())
}

#[tauri::command]
pub fn backup_manual_games(_app_handle: AppHandle) -> Result<String, String> {
    Ok("backup no longer needed, data is in games_v2".to_string())
}
