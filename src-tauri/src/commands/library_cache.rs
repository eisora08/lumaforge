use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::models::library_cache::{
    GameMediaCacheEntry, LibraryAppInfoEntry, LibraryAppInfoMap,
    LibraryGameDetailsEntry,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheIndex {
    pub last_scan_at: Option<u64>,
    pub game_count: Option<usize>,
    pub version: u8,
}

const ENABLE_VERBOSE_LIBRARY_CACHE_LOGS: bool = false;
const ENABLE_VERBOSE_MEDIA_CACHE_LOGS: bool = false;

#[inline]
fn log_lib(msg: &str) {
    if ENABLE_VERBOSE_LIBRARY_CACHE_LOGS {
        println!("[LibraryCache] {}", msg);
    }
}

#[inline]
fn log_media(msg: &str) {
    if ENABLE_VERBOSE_MEDIA_CACHE_LOGS {
        println!("[LibraryMedia] {}", msg);
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
    _app_handle: AppHandle,
) -> Result<LibraryAppInfoMap, String> {
    println!("[LibraryCache][DEPRECATED] read_library_appinfo called — superseded by SQLite games table. Returning empty.");
    Ok(LibraryAppInfoMap::new())
}

#[tauri::command]
pub fn write_library_appinfo(
    _app_handle: AppHandle,
    _appinfo: LibraryAppInfoMap,
) -> Result<(), String> {
    println!("[LibraryCache][DEPRECATED] write_library_appinfo called — superseded by SQLite games table. Ignoring.");
    Ok(())
}

#[tauri::command]
pub fn update_library_appinfo_entry(
    _app_handle: AppHandle,
    _app_id: String,
    _entry: LibraryAppInfoEntry,
) -> Result<(), String> {
    println!("[LibraryCache][DEPRECATED] update_library_appinfo_entry called — superseded by SQLite games table. Ignoring.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Library game details commands  (details/{appid}.json)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_library_game_details(
    _app_handle: AppHandle,
    app_id: String,
    db: tauri::State<'_, crate::commands::sqlite_cache::SqliteCoreDb>,
) -> Result<Option<LibraryGameDetailsEntry>, String> {
    let conn = db.0.as_ref().ok_or("SQLite not available")?.lock().map_err(|e| e.to_string())?;
    let json = crate::commands::sqlite_cache::store_details_cache::read_library_game_details(&conn, &app_id)
        .map_err(|e| format!("Failed to read library game details from SQLite: {}", e))?;
    match json {
        Some(raw) => {
            match serde_json::from_str::<LibraryGameDetailsEntry>(&raw) {
                Ok(entry) => {
                    log_lib("details hit (sqlite)");
                    Ok(Some(entry))
                }
                Err(_) => {
                    log_lib("details corrupt — ignoring (sqlite)");
                    Ok(None)
                }
            }
        }
        None => {
            log_lib("details miss (sqlite)");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_library_game_details(
    _app_handle: AppHandle,
    app_id: String,
    entry: LibraryGameDetailsEntry,
    db: tauri::State<'_, crate::commands::sqlite_cache::SqliteCoreDb>,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize game details: {}", e))?;
    let conn = db.0.as_ref().ok_or("SQLite not available")?.lock().map_err(|e| e.to_string())?;
    crate::commands::sqlite_cache::store_details_cache::write_library_game_details(&conn, &app_id, &content)
        .map_err(|e| format!("Failed to write library game details to SQLite: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Library game media cache commands  (media/steam-{appid}/metadata.json)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn library_get_game_media_cache(
    _app_handle: AppHandle,
    _game_key: String,
) -> Result<Option<GameMediaCacheEntry>, String> {
    Ok(None)
}

#[tauri::command]
pub fn library_save_game_media_cache(
    _app_handle: AppHandle,
    game_key: String,
    entry: GameMediaCacheEntry,
) -> Result<GameMediaCacheEntry, String> {
    Ok(entry)
}

#[tauri::command]
pub fn library_clear_game_media_cache(
    _app_handle: AppHandle,
    _game_key: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn library_clear_all_game_media_cache(
    _app_handle: AppHandle,
) -> Result<(), String> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Library cache index  —  app_data/library/cache.json
// ---------------------------------------------------------------------------

fn get_cache_index_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_library_dir(app_handle)?.join("cache.json"))
}

#[tauri::command]
pub fn read_library_cache_index(_app_handle: AppHandle) -> Result<LibraryCacheIndex, String> {
    Ok(LibraryCacheIndex {
        last_scan_at: None,
        game_count: None,
        version: 1,
    })
}

#[tauri::command]
pub fn write_library_cache_index(
    _app_handle: AppHandle,
    _index: LibraryCacheIndex,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn read_image_as_data_url(app_handle: AppHandle, path: String) -> Result<String, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    let app_data_canonical = app_data
        .canonicalize()
        .map_err(|e| format!("Invalid app data dir: {}", e))?;

    if !canonical.starts_with(&app_data_canonical) {
        return Err("Access denied: path outside app data directory".to_string());
    }

    let bytes =
        std::fs::read(&canonical).map_err(|e| format!("Failed to read image: {}", e))?;

    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

// ---------------------------------------------------------------------------
// cache_library_game_media — download images + write metadata.json + quick cover
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cache_library_game_media(
    _app_handle: AppHandle,
    game_key: String,
    app_id: Option<String>,
    title: Option<String>,
    _cover_url: Option<String>,
    _grid_url: Option<String>,
    _hero_url: Option<String>,
    _logo_url: Option<String>,
    _icon_url: Option<String>,
) -> Result<GameMediaCacheEntry, String> {
    Ok(GameMediaCacheEntry {
        game_key,
        app_id,
        title,
        cover_path: None,
        grid_path: None,
        hero_path: None,
        logo_path: None,
        icon_path: None,
        quick_cover_path: None,
        updated_at: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        ),
    })
}
