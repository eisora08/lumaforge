use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::models::game_media_cache::{GameMediaCacheEntry, GameMediaCacheIndex};

fn get_media_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let cache_dir = app_dir.join("library").join("media");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create media cache dir: {}", e))?;

    Ok(cache_dir)
}

fn get_index_path(cache_dir: &PathBuf) -> PathBuf {
    cache_dir.join("index.json")
}

fn safe_filename(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

#[tauri::command]
pub fn get_game_media_cache(
    app_handle: AppHandle,
    game_key: String,
) -> Result<Option<GameMediaCacheEntry>, String> {
    let cache_dir = get_media_cache_dir(&app_handle)?;
    let path = get_index_path(&cache_dir);

    if !path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read media cache index: {}", e))?;

    let index: GameMediaCacheIndex =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse media cache index: {}", e))?;

    Ok(index.get(&game_key).cloned())
}

#[tauri::command]
pub fn get_all_game_media_cache(app_handle: AppHandle) -> Result<GameMediaCacheIndex, String> {
    let cache_dir = get_media_cache_dir(&app_handle)?;
    let path = get_index_path(&cache_dir);

    if !path.exists() {
        return Ok(GameMediaCacheIndex::new());
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read media cache index: {}", e))?;

    let index: GameMediaCacheIndex =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse media cache index: {}", e))?;

    Ok(index)
}

#[tauri::command]
pub fn save_game_media_cache(
    app_handle: AppHandle,
    game_key: String,
    media: GameMediaCacheEntry,
) -> Result<GameMediaCacheEntry, String> {
    let cache_dir = get_media_cache_dir(&app_handle)?;
    let path = get_index_path(&cache_dir);

    let mut index: GameMediaCacheIndex = if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read media cache index: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse media cache index: {}", e))?
    } else {
        GameMediaCacheIndex::new()
    };

    let entry = GameMediaCacheEntry {
        cover_path: media.cover_path,
        grid_path: media.grid_path,
        hero_path: media.hero_path,
        logo_path: media.logo_path,
        icon_path: media.icon_path,
        updated_at: Some(std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()),
    };

    index.insert(game_key, entry.clone());

    let content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize media cache index: {}", e))?;

    fs::write(&path, &content).map_err(|e| format!("Failed to write media cache index: {}", e))?;

    Ok(entry)
}

#[tauri::command]
pub fn clear_game_media_cache(app_handle: AppHandle, game_key: String) -> Result<(), String> {
    let cache_dir = get_media_cache_dir(&app_handle)?;
    let game_dir = cache_dir.join(safe_filename(&game_key));

    if game_dir.exists() {
        let _ = fs::remove_dir_all(&game_dir);
    }

    let path = get_index_path(&cache_dir);
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read media cache index: {}", e))?;
        let mut index: GameMediaCacheIndex =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse: {}", e))?;
        index.remove(&game_key);
        let content = serde_json::to_string_pretty(&index)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        fs::write(&path, &content).map_err(|e| format!("Failed to write: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn clear_all_game_media_cache(app_handle: AppHandle) -> Result<(), String> {
    let cache_dir = get_media_cache_dir(&app_handle)?;

    if cache_dir.exists() {
        let _ = fs::remove_dir_all(&cache_dir);
    }

    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to recreate media cache dir: {}", e))?;

    Ok(())
}
