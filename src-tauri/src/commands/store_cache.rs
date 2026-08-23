use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::commands::sqlite_cache;
use crate::commands::sqlite_cache::SqliteStoreDb;

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
// Path helpers — only for image downloads and reviews (kept on disk)
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

// ---------------------------------------------------------------------------
// appinfo.json  —  SQLite via store_appinfo_cache
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_store_appinfo(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
) -> Result<StoreAppInfoMap, String> {
    let Some(inner) = store_db.0.as_ref() else {
        log_store("appinfo loaded (empty — no DB)");
        return Ok(StoreAppInfoMap::new());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let rows = sqlite_cache::store_appinfo_cache::read_all_store_appinfo(&conn)?;

    let mut map = StoreAppInfoMap::new();
    for (app_id, data_json) in rows {
        match serde_json::from_str::<StoreAppInfoEntry>(&data_json) {
            Ok(entry) => {
                map.insert(app_id, entry);
            }
            Err(_) => {
                log_store(&format!("appinfo entry corrupt for {}", app_id));
            }
        }
    }

    log_store(&format!("appinfo loaded ({} entries)", map.len()));
    Ok(map)
}

#[tauri::command]
pub fn write_store_appinfo(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    appinfo: StoreAppInfoMap,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    for (app_id, entry) in &appinfo {
        let data_json = serde_json::to_string(entry)
            .map_err(|e| format!("Failed to serialize store appinfo entry {}: {}", app_id, e))?;
        sqlite_cache::store_appinfo_cache::write_store_appinfo(&conn, app_id, &data_json)?;
    }

    log_store(&format!("appinfo saved ({} entries)", appinfo.len()));
    Ok(())
}

#[tauri::command]
pub fn update_store_appinfo_entry(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    app_id: String,
    entry: StoreAppInfoEntry,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let data_json = serde_json::to_string(&entry)
        .map_err(|e| format!("Failed to serialize store appinfo entry: {}", e))?;

    sqlite_cache::store_appinfo_cache::write_store_appinfo(&conn, &app_id, &data_json)?;

    log_store("appinfo entry updated");
    Ok(())
}

// ---------------------------------------------------------------------------
// Store review summaries  —  app_data/store/reviews/{appid}.json (UNCHANGED)
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
// Store media cache  —  SQLite metadata + disk image downloads
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_store_media_cache(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    app_id: u32,
) -> Result<Option<StoreMediaCacheEntry>, String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Ok(None);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let key = format!("{}", app_id);
    let json_opt = sqlite_cache::store_media_cache::read_store_media_cache(&conn, &key)?;

    let Some(json) = json_opt else {
        log_store(&format!("media miss for {}", app_id));
        return Ok(None);
    };

    match serde_json::from_str::<StoreMediaCacheEntry>(&json) {
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

// ---------------------------------------------------------------------------
// Discovery index  —  SQLite via catalog_blobs
// ---------------------------------------------------------------------------

const DISCOVERY_INDEX_KEY: &str = "discovery-index";

#[tauri::command]
pub fn read_store_discovery_index(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(inner) = store_db.0.as_ref() else {
        log_store("discovery index loaded (none — no DB)");
        return Ok(None);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::catalog_blobs::get_catalog_blob_inner(&conn, DISCOVERY_INDEX_KEY)?;

    let Some(json) = json_opt else {
        log_store("discovery index loaded (none on disk)");
        return Ok(None);
    };

    match serde_json::from_str(&json) {
        Ok(value) => {
            log_store("discovery index loaded");
            Ok(Some(value))
        }
        Err(_) => {
            log_store("discovery index corrupt — ignoring");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_store_discovery_index(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    data: serde_json::Value,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize discovery index: {}", e))?;

    sqlite_cache::catalog_blobs::upsert_catalog_blob_inner(&conn, DISCOVERY_INDEX_KEY, &content)?;

    log_store(&format!("discovery index saved ({} bytes)", content.len()));
    Ok(())
}

// ---------------------------------------------------------------------------
// Catalog sections cache  —  SQLite via catalog_blobs
// ---------------------------------------------------------------------------

const CATALOG_SECTIONS_KEY: &str = "catalog-sections-cache";

#[tauri::command]
pub fn read_store_catalog_sections_cache(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(inner) = store_db.0.as_ref() else {
        log_store("catalog sections cache loaded (none — no DB)");
        return Ok(None);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::catalog_blobs::get_catalog_blob_inner(&conn, CATALOG_SECTIONS_KEY)?;

    let Some(json) = json_opt else {
        log_store("catalog sections cache loaded (none on disk)");
        return Ok(None);
    };

    match serde_json::from_str(&json) {
        Ok(value) => {
            log_store("catalog sections cache loaded");
            Ok(Some(value))
        }
        Err(_) => {
            log_store("catalog sections cache corrupt — ignoring");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_store_catalog_sections_cache(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    data: serde_json::Value,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize catalog sections cache: {}", e))?;

    sqlite_cache::catalog_blobs::upsert_catalog_blob_inner(&conn, CATALOG_SECTIONS_KEY, &content)?;

    log_store(&format!("catalog sections cache saved ({} bytes)", content.len()));
    Ok(())
}

// ---------------------------------------------------------------------------
// SGDB artwork cache  —  SQLite via catalog_blobs
// ---------------------------------------------------------------------------

const SGDB_ARTWORK_KEY: &str = "sgdb-artwork-cache";

#[tauri::command]
pub fn read_store_sgdb_artwork_cache(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(inner) = store_db.0.as_ref() else {
        log_store("sgdb artwork cache loaded (none — no DB)");
        return Ok(None);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::catalog_blobs::get_catalog_blob_inner(&conn, SGDB_ARTWORK_KEY)?;

    let Some(json) = json_opt else {
        log_store("sgdb artwork cache loaded (none on disk)");
        return Ok(None);
    };

    match serde_json::from_str(&json) {
        Ok(value) => {
            log_store("sgdb artwork cache loaded");
            Ok(Some(value))
        }
        Err(_) => {
            log_store("sgdb artwork cache corrupt — ignoring");
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_store_sgdb_artwork_cache(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    data: serde_json::Value,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize sgdb artwork cache: {}", e))?;

    sqlite_cache::catalog_blobs::upsert_catalog_blob_inner(&conn, SGDB_ARTWORK_KEY, &content)?;

    log_store(&format!("sgdb artwork cache saved ({} bytes)", content.len()));
    Ok(())
}

// ---------------------------------------------------------------------------
// Clear store cache  —  clears disk cache only (SQLite is authoritative)
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
