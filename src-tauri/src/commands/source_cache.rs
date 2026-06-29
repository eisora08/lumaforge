use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailabilitySourceEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub status: String,
    pub package_url: Option<String>,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailabilityGameEntry {
    pub app_id: String,
    pub title: String,
    pub status: String,
    pub lua_ready: bool,
    pub selected_source_id: Option<String>,
    pub available_sources: Vec<SourceAvailabilitySourceEntry>,
    pub source_count: u32,
    pub total_provider_count: u32,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailabilityIndex {
    pub version: u32,
    pub updated_at: u64,
    pub games: HashMap<String, SourceAvailabilityGameEntry>,
}

fn get_sources_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let sources_dir = app_dir.join("sources");
    fs::create_dir_all(&sources_dir)
        .map_err(|e| format!("Failed to create sources dir: {}", e))?;

    Ok(sources_dir)
}

fn get_index_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_sources_dir(app_handle)?.join("source-index.json"))
}

#[tauri::command]
pub fn read_source_availability_index(
    app_handle: AppHandle,
) -> Result<SourceAvailabilityIndex, String> {
    let path = get_index_path(&app_handle)?;

    if !path.exists() {
        return Ok(SourceAvailabilityIndex {
            version: 1,
            updated_at: 0,
            games: HashMap::new(),
        });
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read source availability index: {}", e))?;

    match serde_json::from_str(&content) {
        Ok(index) => Ok(index),
        Err(_) => {
            Ok(SourceAvailabilityIndex {
                version: 1,
                updated_at: 0,
                games: HashMap::new(),
            })
        }
    }
}

#[tauri::command]
pub fn write_source_availability_index(
    app_handle: AppHandle,
    index: SourceAvailabilityIndex,
) -> Result<(), String> {
    let path = get_index_path(&app_handle)?;

    let content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize source availability index: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write source availability index: {}", e))?;

    Ok(())
}
