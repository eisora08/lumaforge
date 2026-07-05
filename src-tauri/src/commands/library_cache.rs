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

// ---------------------------------------------------------------------------
// Library cache index  —  app_data/library/cache.json
// ---------------------------------------------------------------------------

fn get_cache_index_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_library_dir(app_handle)?.join("cache.json"))
}

#[tauri::command]
pub fn read_library_cache_index(app_handle: AppHandle) -> Result<LibraryCacheIndex, String> {
    let path = get_cache_index_path(&app_handle)?;

    if !path.exists() {
        log_lib("cache index loaded (empty)");
        return Ok(LibraryCacheIndex {
            last_scan_at: None,
            game_count: None,
            version: 1,
        });
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read library cache index: {}", e))?;

    match serde_json::from_str(&content) {
        Ok(index) => {
            log_lib("cache index loaded");
            Ok(index)
        }
        Err(_) => {
            log_lib("cache index corrupt — resetting");
            Ok(LibraryCacheIndex {
                last_scan_at: None,
                game_count: None,
                version: 1,
            })
        }
    }
}

#[tauri::command]
pub fn write_library_cache_index(
    app_handle: AppHandle,
    index: LibraryCacheIndex,
) -> Result<(), String> {
    let path = get_cache_index_path(&app_handle)?;

    let content = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Failed to serialize library cache index: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write library cache index: {}", e))?;

    log_lib("cache index saved");
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
    app_handle: AppHandle,
    game_key: String,
    app_id: Option<String>,
    title: Option<String>,
    cover_url: Option<String>,
    grid_url: Option<String>,
    hero_url: Option<String>,
    logo_url: Option<String>,
    icon_url: Option<String>,
) -> Result<GameMediaCacheEntry, String> {
    let media_dir = get_media_dir(&app_handle)?;
    let game_media_dir = media_dir.join(safe_filename(&game_key));
    fs::create_dir_all(&game_media_dir)
        .map_err(|e| format!("Failed to create game media dir: {}", e))?;

    let mut entry = GameMediaCacheEntry {
        game_key: game_key.clone(),
        app_id: app_id.clone(),
        title: title.clone(),
        cover_path: None,
        grid_path: None,
        hero_path: None,
        logo_path: None,
        icon_path: None,
        quick_cover_path: None,
        updated_at: None,
    };

    let downloads: Vec<(&str, &Option<String>, &str)> = vec![
        ("cover.jpg", &cover_url, "cover"),
        ("grid.jpg", &grid_url, "grid"),
        ("hero.jpg", &hero_url, "hero"),
        ("logo.png", &logo_url, "logo"),
        ("icon.png", &icon_url, "icon"),
    ];

    for (filename, url_opt, field) in &downloads {
        if let Some(url) = url_opt {
            let dest_path = game_media_dir.join(filename);
            if dest_path.exists() {
                let path_str = dest_path.to_string_lossy().to_string();
                match *field {
                    "cover" => entry.cover_path = Some(path_str),
                    "grid" => entry.grid_path = Some(path_str),
                    "hero" => entry.hero_path = Some(path_str),
                    "logo" => entry.logo_path = Some(path_str),
                    "icon" => entry.icon_path = Some(path_str),
                    _ => {}
                }
                log_media(&format!("skipped download — local exists for {} of {}", field, game_key));
                continue;
            }

            let http_client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(15))
                .connect_timeout(Duration::from_secs(8))
                .user_agent("LumaForge/0.1.0")
                .redirect(reqwest::redirect::Policy::limited(5))
                .build();
            let http_client = match http_client {
                Ok(c) => c,
                Err(_) => continue,
            };
            match http_client.get(url).send() {
                Ok(response) => {
                    if let Ok(bytes) = response.bytes() {
                        if fs::write(&dest_path, &bytes).is_ok() {
                            let path_str = dest_path.to_string_lossy().to_string();
                            match *field {
                                "cover" => entry.cover_path = Some(path_str),
                                "grid" => entry.grid_path = Some(path_str),
                                "hero" => entry.hero_path = Some(path_str),
                                "logo" => entry.logo_path = Some(path_str),
                                "icon" => entry.icon_path = Some(path_str),
                                _ => {}
                            }
                            log_media(&format!("saved {} for {}", field, game_key));
                        }
                    }
                }
                Err(_) => {
                    log_media(&format!("download failed for {} of {}", field, game_key));
                }
            }
        }
    }

    // Save quick cover to library/covers/{appid}.jpg
    if let Some(ref aid) = app_id {
        let covers_dir = get_covers_dir(&app_handle)?;
        let quick_cover_path = covers_dir.join(format!("{}.jpg", aid));
        if !quick_cover_path.exists() {
            let quick_url = grid_url
                .as_ref()
                .or(cover_url.as_ref())
                .or(hero_url.as_ref());
            if let Some(url) = quick_url {
                let qc_client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(15))
                    .connect_timeout(Duration::from_secs(8))
                    .user_agent("LumaForge/0.1.0")
                    .redirect(reqwest::redirect::Policy::limited(5))
                    .build();
                if let Ok(client) = qc_client {
                    if let Ok(response) = client.get(url).send() {
                        if let Ok(bytes) = response.bytes() {
                            if fs::write(&quick_cover_path, &bytes).is_ok() {
                                let path_str = quick_cover_path.to_string_lossy().to_string();
                                entry.quick_cover_path = Some(path_str);
                                log_media(&format!("saved quick cover for {}", aid));
                            }
                        }
                    }
                }
            }
        } else {
            let path_str = quick_cover_path.to_string_lossy().to_string();
            entry.quick_cover_path = Some(path_str);
            log_media(&format!("quick cover already exists for {}", aid));
        }
    }

    // Save metadata.json
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    entry.updated_at = Some(now);

    let metadata_path = game_media_dir.join("metadata.json");
    if let Ok(content) = serde_json::to_string_pretty(&entry) {
        let _ = fs::write(&metadata_path, &content);
        log_media(&format!("metadata written for {}", game_key));
    }

    log_media(&format!("cache complete for {}", game_key));
    Ok(entry)
}
