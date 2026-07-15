use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreAppInfoEntry {
    pub app_id: String,
    pub name: Option<String>,
    pub header_image: Option<String>,
    pub capsule_image: Option<String>,
    pub hero_path: Option<String>,
    pub header_path: Option<String>,
    pub capsule_path: Option<String>,
    pub logo_path: Option<String>,
    pub updated_at: Option<u64>,
}

pub type StoreAppInfoMap = HashMap<String, StoreAppInfoEntry>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreGameDetailsEntry {
    pub app_id: u32,
    #[serde(flatten)]
    pub data: serde_json::Value,
    pub updated_at: u64,
    pub version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreReviewEntry {
    pub app_id: u32,
    #[serde(flatten)]
    pub data: serde_json::Value,
    pub updated_at: u64,
    pub version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreMediaCacheEntry {
    pub capsule_path: Option<String>,
    pub header_path: Option<String>,
    pub hero_path: Option<String>,
    pub background_path: Option<String>,
    pub logo_path: Option<String>,
    pub updated_at: Option<u64>,
}

// ---------------------------------------------------------------------------
// Debug flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_STORE_CACHE_LOGS: bool = false;

#[inline]
fn log_store(msg: &str) {
    if ENABLE_VERBOSE_STORE_CACHE_LOGS {
        println!("[StoreCache] {}", msg);
    }
}

// ---------------------------------------------------------------------------
// Path helpers — all under app_data/store/
// ---------------------------------------------------------------------------

fn get_store_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let store_dir = app_dir.join("store");
    fs::create_dir_all(&store_dir)
        .map_err(|e| format!("Failed to create store dir: {}", e))?;

    Ok(store_dir)
}

fn get_details_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_store_dir(app_handle)?.join("details");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create details dir: {}", e))?;
    Ok(dir)
}

fn get_media_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_store_dir(app_handle)?.join("media");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create media dir: {}", e))?;
    Ok(dir)
}

fn get_reviews_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_store_dir(app_handle)?.join("reviews");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create reviews dir: {}", e))?;
    Ok(dir)
}

fn get_appinfo_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_store_dir(app_handle)?.join("appinfo.json"))
}

fn get_discovery_index_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_store_dir(app_handle)?.join("discovery-index.json"))
}

fn get_catalog_sections_cache_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_store_dir(app_handle)?.join("catalog-sections-cache.json"))
}

fn get_details_path(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    Ok(get_details_dir(app_handle)?.join(format!("{}.json", app_id)))
}

fn get_review_path(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    Ok(get_reviews_dir(app_handle)?.join(format!("{}.json", app_id)))
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

fn get_media_game_dir(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    let key = format!("steam-{}", app_id);
    let dir = get_media_dir(app_handle)?.join(safe_filename(&key));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create media game dir: {}", e))?;
    Ok(dir)
}

fn get_media_metadata_path(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
    Ok(get_media_game_dir(app_handle, app_id)?.join("metadata.json"))
}

// ---------------------------------------------------------------------------
// appinfo.json  —  app_data/store/appinfo.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_store_appinfo(app_handle: AppHandle) -> Result<StoreAppInfoMap, String> {
    let path = get_appinfo_path(&app_handle)?;

    if !path.exists() {
        log_store("appinfo loaded (empty)");
        return Ok(StoreAppInfoMap::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read store appinfo: {}", e))?;

    match serde_json::from_str(&content) {
        Ok(map) => {
            log_store("appinfo loaded");
            Ok(map)
        }
        Err(_) => {
            log_store("appinfo corrupt — ignoring, will replace on write");
            Ok(StoreAppInfoMap::new())
        }
    }
}

#[tauri::command]
pub fn write_store_appinfo(
    app_handle: AppHandle,
    appinfo: StoreAppInfoMap,
) -> Result<(), String> {
    let path = get_appinfo_path(&app_handle)?;

    let content = serde_json::to_string_pretty(&appinfo)
        .map_err(|e| format!("Failed to serialize store appinfo: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write store appinfo: {}", e))?;

    log_store("appinfo saved");
    Ok(())
}

#[tauri::command]
pub fn update_store_appinfo_entry(
    app_handle: AppHandle,
    app_id: String,
    entry: StoreAppInfoEntry,
) -> Result<(), String> {
    let path = get_appinfo_path(&app_handle)?;

    let mut map: StoreAppInfoMap = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        StoreAppInfoMap::new()
    };

    map.insert(app_id, entry);

    let content = serde_json::to_string_pretty(&map)
        .map_err(|e| format!("Failed to serialize store appinfo: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write store appinfo: {}", e))?;

    log_store("appinfo entry updated");
    Ok(())
}

// ---------------------------------------------------------------------------
// Store game details  —  app_data/store/details/{appid}.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_store_game_details(
    app_handle: AppHandle,
    app_id: u32,
) -> Result<Option<StoreGameDetailsEntry>, String> {
    let path = get_details_path(&app_handle, app_id)?;

    if !path.exists() {
        log_store(&format!("details miss for {}", app_id));
        return Ok(None);
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            log_store(&format!("details read error for {}: {}", app_id, e));
            return Ok(None);
        }
    };

    let entry: StoreGameDetailsEntry = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(_) => {
            log_store(&format!("details corrupt for {}", app_id));
            return Ok(None);
        }
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if entry.version != 1 || now - entry.updated_at > 24 * 60 * 60 * 1000 {
        let _ = fs::remove_file(&path);
        log_store(&format!("details expired for {}", app_id));
        return Ok(None);
    }

    log_store(&format!("details hit for {}", app_id));
    Ok(Some(entry))
}

#[tauri::command]
pub fn write_store_game_details(
    app_handle: AppHandle,
    app_id: u32,
    entry: StoreGameDetailsEntry,
) -> Result<(), String> {
    let path = get_details_path(&app_handle, app_id)?;

    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize store game details: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write store game details: {}", e))?;

    log_store(&format!("details saved for {}", app_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// Store review summaries  —  app_data/store/reviews/{appid}.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_store_review_summary(
    app_handle: AppHandle,
    app_id: u32,
) -> Result<Option<StoreReviewEntry>, String> {
    let path = get_review_path(&app_handle, app_id)?;

    if !path.exists() {
        log_store(&format!("review miss for {}", app_id));
        return Ok(None);
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            log_store(&format!("review read error for {}: {}", app_id, e));
            return Ok(None);
        }
    };

    let entry: StoreReviewEntry = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(_) => {
            log_store(&format!("review corrupt for {}", app_id));
            return Ok(None);
        }
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    if entry.version != 1 || now - entry.updated_at > 12 * 60 * 60 * 1000 {
        let _ = fs::remove_file(&path);
        log_store(&format!("review expired for {}", app_id));
        return Ok(None);
    }

    log_store(&format!("review hit for {}", app_id));
    Ok(Some(entry))
}

#[tauri::command]
pub fn write_store_review_summary(
    app_handle: AppHandle,
    app_id: u32,
    entry: StoreReviewEntry,
) -> Result<(), String> {
    let path = get_review_path(&app_handle, app_id)?;

    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize store review: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write store review: {}", e))?;

    log_store(&format!("review saved for {}", app_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// Store media cache  —  app_data/store/media/steam-{appid}/
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_store_media_cache(
    app_handle: AppHandle,
    app_id: u32,
) -> Result<Option<StoreMediaCacheEntry>, String> {
    let path = get_media_metadata_path(&app_handle, app_id)?;

    if !path.exists() {
        log_store(&format!("media miss for {}", app_id));
        return Ok(None);
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    match serde_json::from_str(&content) {
        Ok(entry) => {
            log_store(&format!("media hit for {}", app_id));
            Ok(Some(entry))
        }
        Err(_) => {
            log_store(&format!("media metadata corrupt for {}", app_id));
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn cache_store_remote_media(
    app_handle: AppHandle,
    app_id: u32,
    capsule_url: Option<String>,
    header_url: Option<String>,
    hero_url: Option<String>,
    background_url: Option<String>,
    logo_url: Option<String>,
) -> Result<StoreMediaCacheEntry, String> {
    let game_dir = get_media_game_dir(&app_handle, app_id)?;

    let mut entry = StoreMediaCacheEntry {
        capsule_path: None,
        header_path: None,
        hero_path: None,
        background_path: None,
        logo_path: None,
        updated_at: None,
    };

    let downloads: Vec<(&str, &Option<String>, &str)> = vec![
        ("capsule.jpg", &capsule_url, "capsule"),
        ("header.jpg", &header_url, "header"),
        ("hero.jpg", &hero_url, "hero"),
        ("background.jpg", &background_url, "background"),
        ("logo.png", &logo_url, "logo"),
    ];

    let http_client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .user_agent("LumaForge/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build();

    for (filename, url_opt, field) in &downloads {
        if let Some(url) = url_opt {
            let dest_path = game_dir.join(filename);
            if dest_path.exists() {
                let path_str = dest_path.to_string_lossy().to_string();
                match *field {
                    "capsule" => entry.capsule_path = Some(path_str),
                    "header" => entry.header_path = Some(path_str),
                    "hero" => entry.hero_path = Some(path_str),
                    "background" => entry.background_path = Some(path_str),
                    "logo" => entry.logo_path = Some(path_str),
                    _ => {}
                }
                continue;
            }

            if let Ok(client) = &http_client {
                match client.get(url).send() {
                    Ok(response) => {
                    if let Ok(bytes) = response.bytes() {
                        if fs::write(&dest_path, &bytes).is_ok() {
                            let path_str = dest_path.to_string_lossy().to_string();
                            match *field {
                                "capsule" => entry.capsule_path = Some(path_str),
                                "header" => entry.header_path = Some(path_str),
                                "hero" => entry.hero_path = Some(path_str),
                                "background" => entry.background_path = Some(path_str),
                                "logo" => entry.logo_path = Some(path_str),
                                _ => {}
                            }
                        }
                    }
                }
                Err(_) => {}
            }
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    entry.updated_at = Some(now);

    // Save metadata.json
    let metadata_path = game_dir.join("metadata.json");
    if let Ok(content) = serde_json::to_string_pretty(&entry) {
        let _ = fs::write(&metadata_path, &content);
    }

    log_store(&format!("media cached for {}", app_id));
    Ok(entry)
}

// ---------------------------------------------------------------------------
// Discovery index  —  app_data/store/discovery-index.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_store_discovery_index(app_handle: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = get_discovery_index_path(&app_handle)?;

    if !path.exists() {
        log_store("discovery index loaded (none on disk)");
        return Ok(None);
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(value) => {
                log_store("discovery index loaded");
                Ok(Some(value))
            }
            Err(_) => {
                log_store("discovery index corrupt — ignoring");
                Ok(None)
            }
        },
        Err(e) => {
            log_store(&format!("discovery index read error: {}", e));
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_store_discovery_index(app_handle: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = get_discovery_index_path(&app_handle)?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize discovery index: {}", e))?;

    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write discovery index: {}", e))?;

    log_store(&format!("discovery index saved ({} bytes)", content.len()));
    Ok(())
}

// ---------------------------------------------------------------------------
// Catalog sections cache  —  app_data/store/catalog-sections-cache.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_store_catalog_sections_cache(app_handle: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = get_catalog_sections_cache_path(&app_handle)?;

    if !path.exists() {
        log_store("catalog sections cache loaded (none on disk)");
        return Ok(None);
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(value) => {
                log_store("catalog sections cache loaded");
                Ok(Some(value))
            }
            Err(_) => {
                log_store("catalog sections cache corrupt — ignoring");
                Ok(None)
            }
        },
        Err(e) => {
            log_store(&format!("catalog sections cache read error: {}", e));
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_store_catalog_sections_cache(app_handle: AppHandle, data: serde_json::Value) -> Result<(), String> {
    let path = get_catalog_sections_cache_path(&app_handle)?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize catalog sections cache: {}", e))?;

    // Atomic write via temp file + rename
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write catalog sections cache: {}", e))?;
    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename catalog sections cache: {}", e))?;

    log_store(&format!("catalog sections cache saved ({} bytes)", content.len()));
    Ok(())
}

// ---------------------------------------------------------------------------
// Clear entire store cache
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn clear_store_cache(app_handle: AppHandle) -> Result<(), String> {
    let store_dir = get_store_dir(&app_handle)?;

    if store_dir.exists() {
        if let Ok(entries) = fs::read_dir(&store_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let _ = fs::remove_dir_all(&path);
                } else {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    log_store("store cache cleared");
    Ok(())
}
