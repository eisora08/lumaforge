use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreMetadataCacheEntry {
    pub app_id: u32,
    #[serde(flatten)]
    pub data: serde_json::Value,
    pub updated_at: u64,
    pub version: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreReviewCacheEntry {
    pub app_id: u32,
    #[serde(flatten)]
    pub data: serde_json::Value,
    pub updated_at: u64,
    pub version: u8,
}

const METADATA_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const REVIEW_TTL_MS: u64 = 12 * 60 * 60 * 1000;

fn get_cache_dir(app_handle: &AppHandle, subdir: &str) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let cache_dir = app_dir.join("cache").join("store").join(subdir);
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    Ok(cache_dir)
}

fn metadata_path(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    Ok(get_cache_dir(app_handle, "metadata")?.join(format!("{}.json", app_id)))
}

fn review_path(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    Ok(get_cache_dir(app_handle, "reviews")?.join(format!("{}.json", app_id)))
}

#[tauri::command]
pub fn read_store_metadata_cache(
    app_handle: AppHandle,
    app_id: u32,
) -> Result<Option<StoreMetadataCacheEntry>, String> {
    let path = metadata_path(&app_handle, app_id)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read metadata cache: {}", e))?;

    let entry: StoreMetadataCacheEntry = serde_json::from_str(&content)
        .map_err(|_| format!("Corrupt metadata cache for app {}", app_id))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if entry.version != 1 || now - entry.updated_at > METADATA_TTL_MS {
        let _ = fs::remove_file(&path);
        return Ok(None);
    }

    Ok(Some(entry))
}

#[tauri::command]
pub fn write_store_metadata_cache(
    app_handle: AppHandle,
    app_id: u32,
    entry: StoreMetadataCacheEntry,
) -> Result<(), String> {
    let path = metadata_path(&app_handle, app_id)?;
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize metadata cache: {}", e))?;
    fs::write(&path, &content).map_err(|_| format!("Failed to write metadata cache for app {}", app_id))?;
    Ok(())
}

#[tauri::command]
pub fn read_store_review_cache(
    app_handle: AppHandle,
    app_id: u32,
) -> Result<Option<StoreReviewCacheEntry>, String> {
    let path = review_path(&app_handle, app_id)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read review cache: {}", e))?;

    let entry: StoreReviewCacheEntry = serde_json::from_str(&content)
        .map_err(|_| format!("Corrupt review cache for app {}", app_id))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if entry.version != 1 || now - entry.updated_at > REVIEW_TTL_MS {
        let _ = fs::remove_file(&path);
        return Ok(None);
    }

    Ok(Some(entry))
}

#[tauri::command]
pub fn write_store_review_cache(
    app_handle: AppHandle,
    app_id: u32,
    entry: StoreReviewCacheEntry,
) -> Result<(), String> {
    let path = review_path(&app_handle, app_id)?;
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize review cache: {}", e))?;
    fs::write(&path, &content).map_err(|_| format!("Failed to write review cache for app {}", app_id))?;
    Ok(())
}

#[tauri::command]
pub fn clear_store_cache(app_handle: AppHandle) -> Result<(), String> {
    let meta_dir = get_cache_dir(&app_handle, "metadata")?;
    let rev_dir = get_cache_dir(&app_handle, "reviews")?;

    if let Ok(entries) = fs::read_dir(&meta_dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }

    if let Ok(entries) = fs::read_dir(&rev_dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }

    Ok(())
}
