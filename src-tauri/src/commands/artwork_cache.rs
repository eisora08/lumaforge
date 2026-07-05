use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::models::artwork_cache::ArtworkCacheIndex;

fn get_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let cache_dir = app_dir.join("artwork_cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    Ok(cache_dir)
}

fn get_index_path(cache_dir: &PathBuf) -> PathBuf {
    cache_dir.join("index.json")
}

#[tauri::command]
pub fn read_artwork_cache_index(app_handle: AppHandle) -> Result<ArtworkCacheIndex, String> {
    let cache_dir = get_cache_dir(&app_handle)?;
    let path = get_index_path(&cache_dir);

    if !path.exists() {
        return Ok(ArtworkCacheIndex::new());
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read cache index: {}", e))?;

    let index: ArtworkCacheIndex =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse cache index: {}", e))?;

    Ok(index)
}

#[tauri::command]
pub fn write_artwork_cache_index(app_handle: AppHandle, index: ArtworkCacheIndex) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app_handle)?;
    let path = get_index_path(&cache_dir);

    let content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize cache index: {}", e))?;

    fs::write(&path, &content).map_err(|e| format!("Failed to write cache index: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn cache_remote_artwork(
    app_handle: AppHandle,
    url: String,
    app_id: u32,
    kind: String,
) -> Result<String, String> {
    let cache_dir = get_cache_dir(&app_handle)?;

    let ext = url.rsplit('.').next().unwrap_or("jpg");
    let filename = format!("{}_{}.{}", app_id, kind, ext);
    let dest_path = cache_dir.join(&filename);

    if dest_path.exists() {
        return Ok(dest_path.to_string_lossy().to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .user_agent("LumaForge/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .map_err(|e| format!("[HTTP][TIMEOUT] Failed to download artwork: {}", e))?;

    let bytes = response
        .bytes()
        .map_err(|e| format!("Failed to read artwork bytes: {}", e))?;

    fs::write(&dest_path, &bytes)
        .map_err(|e| format!("Failed to write artwork to cache: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_artwork_cache_for_game(app_handle: AppHandle, app_id: u32) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app_handle)?;
    let mut index = read_artwork_cache_index(app_handle.clone())?;

    let prefixes = [
        format!("{}_{}.", app_id, "grid"),
        format!("{}_{}.", app_id, "hero"),
        format!("{}_{}.", app_id, "logo"),
    ];

    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if prefixes.iter().any(|p| name.starts_with(p)) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    index.remove(&app_id);
    write_artwork_cache_index(app_handle.clone(), index)?;

    Ok(())
}

#[tauri::command]
pub fn clear_all_artwork_cache(app_handle: AppHandle) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app_handle)?;

    if let Ok(entries) = fs::read_dir(&cache_dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }

    write_artwork_cache_index(app_handle.clone(), ArtworkCacheIndex::new())?;

    Ok(())
}
