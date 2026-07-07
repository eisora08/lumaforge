use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusLocal {
    pub package_path: Option<String>,
    pub lua_path: Option<String>,
    pub file_size_at_install: Option<i64>,
    pub file_modified_at_install: Option<String>,
    pub file_created_at_install: Option<String>,
    pub metadata_source: Option<String>,
    pub provider_timestamp_at_install: Option<String>,
    pub checksum_at_install: Option<String>,
    pub version_at_install: Option<String>,
    pub manifest_ids_at_install: Vec<String>,
    pub depot_ids_at_install: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusRemote {
    pub status: String,
    pub game_name: Option<String>,
    pub manifest_file_exists: Option<bool>,
    pub auto_update_enabled: Option<bool>,
    pub update_in_progress: Option<bool>,
    pub file_size: Option<i64>,
    pub file_modified: Option<String>,
    pub file_age_days: Option<f64>,
    pub needs_update: Option<bool>,
    pub update_reason: Option<String>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusResult {
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusFile {
    pub app_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub checked_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local: Option<ProviderStatusLocal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<ProviderStatusRemote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ProviderStatusResult>,
}

fn get_provider_status_dir(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dir = app_dir.join("store").join("provider-status").join(app_id);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create provider-status dir: {}", e))?;

    Ok(dir)
}

fn get_provider_status_path(
    app_handle: &AppHandle,
    app_id: &str,
    provider_id: &str,
) -> Result<PathBuf, String> {
    let filename = format!("{}.json", provider_id);
    Ok(get_provider_status_dir(app_handle, app_id)?.join(filename))
}

#[tauri::command]
pub fn read_provider_status(
    app_handle: AppHandle,
    app_id: String,
    provider_id: String,
) -> Result<Option<ProviderStatusFile>, String> {
    let path = get_provider_status_path(&app_handle, &app_id, &provider_id)?;

    if !path.exists() {
        println!(
            "[PROVIDER_STATUS][LOAD] appid={} provider={} found=false path=\"{}\"",
            app_id,
            provider_id,
            path.display()
        );
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read provider-status file: {}", e))?;

    match serde_json::from_str(&content) {
        Ok(data) => {
            println!(
                "[PROVIDER_STATUS][LOAD] appid={} provider={} found=true path=\"{}\"",
                app_id,
                provider_id,
                path.display()
            );
            Ok(Some(data))
        }
        Err(e) => {
            println!(
                "[PROVIDER_STATUS][LOAD] appid={} provider={} found=corrupt error=\"{}\" path=\"{}\"",
                app_id,
                provider_id,
                e,
                path.display()
            );
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_provider_status(
    app_handle: AppHandle,
    app_id: String,
    provider_id: String,
    payload: String,
) -> Result<(), String> {
    let path = get_provider_status_path(&app_handle, &app_id, &provider_id)?;

    println!(
        "[PROVIDER_STATUS][WRITE_CALL] appid={} provider={} path=\"{}\"",
        app_id,
        provider_id,
        path.display()
    );

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create provider-status dir: {}", e))?;
    }

    fs::write(&path, &payload)
        .map_err(|e| format!("Failed to write provider-status file: {}", e))?;

    println!(
        "[PROVIDER_STATUS][WRITE_OK] appid={} provider={} path=\"{}\"",
        app_id,
        provider_id,
        path.display()
    );

    Ok(())
}
