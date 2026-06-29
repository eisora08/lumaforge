use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::models::library_cache::{
    GameMediaCacheEntry, LibraryAppInfoEntry, LibraryAppInfoMap,
    LibraryGameDetailsEntry,
};

const ENABLE_VERBOSE_LIBRARY_CACHE_LOGS: bool = false;

#[inline]
fn log_lib(msg: &str) {
    if ENABLE_VERBOSE_LIBRARY_CACHE_LOGS {
        println!("[LibraryCache] {}", msg);
    }
}

#[inline]
fn log_media(msg: &str) {
    if ENABLE_VERBOSE_LIBRARY_CACHE_LOGS {
        println!("[MediaCache] {}", msg);
    }
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

fn get_library_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let lib_dir = app_dir.join("library");
    fs::create_dir_all(&lib_dir)
        .map_err(|e| format!("Failed to create library dir: {}", e))?;

    Ok(lib_dir)
}

fn get_details_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_library_dir(app_handle)?.join("details");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create details dir: {}", e))?;
    Ok(dir)
}

#[allow(dead_code)]
fn get_covers_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_library_dir(app_handle)?.join("covers");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create covers dir: {}", e))?;
    Ok(dir)
}

fn get_media_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_library_dir(app_handle)?.join("media");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create media dir: {}", e))?;
    Ok(dir)
}

fn get_appinfo_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_library_dir(app_handle)?.join("appinfo.json"))
}

fn get_details_path(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let dir = get_details_dir(app_handle)?;
    Ok(dir.join(format!("{}.json", app_id)))
}

// ---------------------------------------------------------------------------
// appinfo.json commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_library_appinfo(
    app_handle: AppHandle,
) -> Result<LibraryAppInfoMap, String> {
    let path = get_appinfo_path(&app_handle)?;

    if !path.exists() {
        log_lib("appinfo loaded");
        return Ok(LibraryAppInfoMap::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read appinfo: {}", e))?;

    match serde_json::from_str(&content) {
        Ok(map) => {
            log_lib("appinfo loaded");
            Ok(map)
        }
        Err(_) => {
            log_lib("appinfo corrupt — ignoring, will replace on write");
            Ok(LibraryAppInfoMap::new())
        }
    }
}

#[tauri::command]
pub fn write_library_appinfo(
    app_handle: AppHandle,
    appinfo: LibraryAppInfoMap,
) -> Result<(), String> {
    let path = get_appinfo_path(&app_handle)?;

    let content = serde_json::to_string_pretty(&appinfo)
        .map_err(|e| format!("Failed to serialize appinfo: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write appinfo: {}", e))?;

    log_lib("appinfo saved");
    Ok(())
}

#[tauri::command]
pub fn update_library_appinfo_entry(
    app_handle: AppHandle,
    app_id: String,
    entry: LibraryAppInfoEntry,
) -> Result<(), String> {
    let path = get_appinfo_path(&app_handle)?;

    let mut map: LibraryAppInfoMap = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        LibraryAppInfoMap::new()
    };

    map.insert(app_id, entry);

    let content = serde_json::to_string_pretty(&map)
        .map_err(|e| format!("Failed to serialize appinfo: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write appinfo: {}", e))?;

    log_lib("appinfo saved");
    Ok(())
}

// ---------------------------------------------------------------------------
// Library game details commands  (details/{appid}.json)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_library_game_details(
    app_handle: AppHandle,
    app_id: String,
) -> Result<Option<LibraryGameDetailsEntry>, String> {
    let path = get_details_path(&app_handle, &app_id)?;

    if !path.exists() {
        log_lib("details miss");
        return Ok(None);
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            log_lib(&format!("details read error: {}", e));
            return Ok(None);
        }
    };

    match serde_json::from_str(&content) {
        Ok(entry) => {
            log_lib("details hit");
            Ok(Some(entry))
        }
        Err(_) => {
            log_lib("details corrupt — ignoring");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_library_game_details(
    app_handle: AppHandle,
    app_id: String,
    entry: LibraryGameDetailsEntry,
) -> Result<(), String> {
    let path = get_details_path(&app_handle, &app_id)?;

    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize game details: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write game details: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Library game media cache commands  (media/steam-{appid}/metadata.json)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn library_get_game_media_cache(
    app_handle: AppHandle,
    game_key: String,
) -> Result<Option<GameMediaCacheEntry>, String> {
    let media_dir = get_media_dir(&app_handle)?;
    let game_media_dir = media_dir.join(safe_filename(&game_key));
    let metadata_path = game_media_dir.join("metadata.json");

    if !metadata_path.exists() {
        log_media("metadata miss");
        return Ok(None);
    }

    let content = match fs::read_to_string(&metadata_path) {
        Ok(c) => c,
        Err(e) => {
            log_media(&format!("metadata read error: {}", e));
            return Ok(None);
        }
    };

    match serde_json::from_str(&content) {
        Ok(entry) => {
            log_media("metadata hit");
            Ok(Some(entry))
        }
        Err(_) => {
            log_media("metadata corrupt — ignoring");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn library_save_game_media_cache(
    app_handle: AppHandle,
    game_key: String,
    entry: GameMediaCacheEntry,
) -> Result<GameMediaCacheEntry, String> {
    let media_dir = get_media_dir(&app_handle)?;
    let game_media_dir = media_dir.join(safe_filename(&game_key));
    fs::create_dir_all(&game_media_dir)
        .map_err(|e| format!("Failed to create game media dir: {}", e))?;

    let mut saved = entry.clone();
    saved.updated_at = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );

    let metadata_path = game_media_dir.join("metadata.json");
    let content = serde_json::to_string_pretty(&saved)
        .map_err(|e| format!("Failed to serialize media metadata: {}", e))?;

    fs::write(&metadata_path, &content)
        .map_err(|e| format!("Failed to write media metadata: {}", e))?;

    Ok(saved)
}

#[tauri::command]
pub fn library_clear_game_media_cache(
    app_handle: AppHandle,
    game_key: String,
) -> Result<(), String> {
    let media_dir = get_media_dir(&app_handle)?;
    let game_media_dir = media_dir.join(safe_filename(&game_key));

    if game_media_dir.exists() {
        fs::remove_dir_all(&game_media_dir)
            .map_err(|e| format!("Failed to remove game media dir: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn library_clear_all_game_media_cache(
    app_handle: AppHandle,
) -> Result<(), String> {
    let media_dir = get_media_dir(&app_handle)?;

    if media_dir.exists() {
        let entries = fs::read_dir(&media_dir)
            .map_err(|e| format!("Failed to read media dir: {}", e))?;

        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }

    Ok(())
}
