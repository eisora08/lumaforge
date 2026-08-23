use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url, WebviewUrl};
use tokio::sync::oneshot;

use crate::commands::repack_catalog::RepackCatalogArtifact;
use crate::commands::sqlite_cache::SqliteStoreDb;

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraSourceConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_count: Option<u32>,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraSourceFile {
    pub name: String,
    pub games: Vec<HydraSourceGameEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HydraSourceMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraSourceMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_games: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraSourceGameEntry {
    pub title: String,
    #[serde(default)]
    pub app_id: u32,
    pub uris: Vec<String>,
    pub repacker: String,
    #[serde(default)]
    pub file_size: Option<i64>,
    #[serde(default)]
    pub install_size: Option<i64>,
    #[serde(default)]
    pub installer_type: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub languages: Option<Vec<String>>,
    #[serde(default)]
    pub selective_features: Option<Vec<String>>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub checksum: Option<String>,
    #[serde(default)]
    pub drm: Option<String>,
    #[serde(default)]
    pub repack_group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraFetchResult {
    pub success: bool,
    pub source_name: String,
    pub game_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraImportResult {
    pub source_name: String,
    pub source_url: String,
    pub imported_count: u32,
    pub updated_count: u32,
    pub total_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Summary of a pasted repack feed (rows in `repack_catalog` with an empty
/// `source_url`), grouped by the feed's source name.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFeedSummary {
    pub name: String,
    pub game_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydraSourceList {
    pub sources: Vec<HydraSourceConfig>,
}

/// Normalized repack row used by the tolerant feed parser and the shared SQLite insert.
#[derive(Debug, Clone)]
pub struct RepackRowData {
    pub title: String,
    pub app_id: u32,
    pub repacker: String,
    pub repack_group: Option<String>,
    pub installer_type: String,
    pub file_size: Option<i64>,
    pub install_size: Option<i64>,
    pub languages: Vec<String>,
    pub selective_features: Vec<String>,
    pub uris: Vec<String>,
    pub checksum: Option<String>,
    pub updated_at: Option<String>,
    pub tags: Vec<String>,
}

// ── Tolerant repack feed parsing ──

/// Parse a human-readable file size like "5.4 GB", "33 GB" or "800 MB" into bytes.
fn parse_human_size(s: &str) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    let bytes = t.as_bytes();
    let mut i = 0;
    while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.' || bytes[i] == b',') {
        i += 1;
    }
    if i == 0 {
        return None;
    }
    let num: f64 = t[..i].replace(',', ".").parse().ok()?;
    let unit = t[i..].trim().to_ascii_uppercase();
    let multiplier = if unit.starts_with("TB") {
        1024i64.pow(4)
    } else if unit.starts_with("GB") {
        1024i64.pow(3)
    } else if unit.starts_with("MB") {
        1024i64.pow(2)
    } else if unit.starts_with("KB") {
        1024i64
    } else if unit.starts_with("B") {
        1
    } else {
        return None;
    };
    Some((num * multiplier as f64) as i64)
}

fn infer_installer_type(uris: &[String]) -> String {
    if uris.iter().any(|u| u.starts_with("magnet:")) {
        "torrent".to_string()
    } else {
        "zip".to_string()
    }
}

/// Detect the feed format by root key and parse into normalized rows.
/// Supported: `games` (Hydra source), `records` (official repack artifact), `downloads` (scraped JSON).
fn parse_repack_feed_value(
    value: &serde_json::Value,
    fallback_source_name: &str,
) -> Result<(String, Vec<RepackRowData>), String> {
    if value.get("games").is_some() {
        parse_hydra_feed(value, fallback_source_name)
    } else if value.get("records").is_some() {
        parse_artifact_feed(value, fallback_source_name)
    } else if value.get("downloads").is_some() {
        parse_scraped_feed(value, fallback_source_name)
    } else {
        Err(
            "Unknown repack feed format: expected a 'games', 'records' or 'downloads' root key"
                .to_string(),
        )
    }
}

fn parse_hydra_feed(
    value: &serde_json::Value,
    fallback_source_name: &str,
) -> Result<(String, Vec<RepackRowData>), String> {
    let file: HydraSourceFile =
        serde_json::from_value(value.clone()).map_err(|e| format!("Parse error: {}", e))?;
    let name = if file.name.trim().is_empty() {
        fallback_source_name.to_string()
    } else {
        file.name
    };
    let rows = file
        .games
        .iter()
        .map(|e| RepackRowData {
            title: e.title.clone(),
            app_id: e.app_id,
            repacker: e.repacker.clone(),
            repack_group: e.repack_group.clone(),
            installer_type: e
                .installer_type
                .clone()
                .unwrap_or_else(|| infer_installer_type(&e.uris)),
            file_size: e.file_size,
            install_size: e.install_size,
            languages: e.languages.clone().unwrap_or_default(),
            selective_features: e.selective_features.clone().unwrap_or_default(),
            uris: e.uris.clone(),
            checksum: e.checksum.clone(),
            updated_at: e.updated_at.clone(),
            tags: e.tags.clone().unwrap_or_default(),
        })
        .collect();
    Ok((name, rows))
}

fn parse_artifact_feed(
    value: &serde_json::Value,
    fallback_source_name: &str,
) -> Result<(String, Vec<RepackRowData>), String> {
    let artifact: RepackCatalogArtifact =
        serde_json::from_value(value.clone()).map_err(|e| format!("Parse error: {}", e))?;
    let rows = artifact
        .records
        .iter()
        .map(|r| RepackRowData {
            title: r.title.clone(),
            app_id: r.app_id,
            repacker: r.repacker.clone(),
            repack_group: r.repack_group.clone(),
            installer_type: r.installer_type.clone(),
            file_size: Some(r.file_size),
            install_size: r.install_size,
            languages: r.languages.clone(),
            selective_features: r.selective_features.clone(),
            uris: r.download_uris.clone(),
            checksum: r.checksum.clone(),
            updated_at: Some(r.updated_at.clone()),
            tags: r.tags.clone(),
        })
        .collect();
    Ok((fallback_source_name.to_string(), rows))
}

fn parse_scraped_feed(
    value: &serde_json::Value,
    fallback_source_name: &str,
) -> Result<(String, Vec<RepackRowData>), String> {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback_source_name.to_string());

    let repacker = name.to_lowercase();

    let downloads = value
        .get("downloads")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "missing 'downloads' array".to_string())?;

    let mut rows = Vec::with_capacity(downloads.len());
    for item in downloads {
        let Some(title) = item.get("title").and_then(|v| v.as_str()) else {
            continue;
        };
        let title = title.trim();
        if title.is_empty() {
            continue;
        }

        let uris: Vec<String> = item
            .get("uris")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| u.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let file_size = item.get("fileSize").and_then(|v| {
            v.as_str()
                .and_then(parse_human_size)
                .or_else(|| v.as_i64())
        });

        let updated_at = item
            .get("uploadDate")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let installer_type = infer_installer_type(&uris);

        rows.push(RepackRowData {
            title: title.to_string(),
            app_id: 0,
            repacker: repacker.clone(),
            repack_group: None,
            installer_type,
            file_size,
            install_size: None,
            languages: vec![],
            selective_features: vec![],
            uris,
            checksum: None,
            updated_at,
            tags: vec![],
        });
    }
    Ok((name, rows))
}

/// Shared SQLite insert for normalized repack rows. Returns (imported, updated).
fn insert_repack_rows(
    db: &rusqlite::Connection,
    rows: &[RepackRowData],
    source_url: &str,
    source_name: &str,
) -> (u32, u32) {
    let mut imported_count = 0u32;
    let mut updated_count = 0u32;

    for entry in rows {
        let installer_type = entry.installer_type.clone();

        // Canonical key: normalized title slug + lowercased repacker slug
        let normalized_title = entry
            .title
            .to_lowercase()
            .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), "")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let id = format!(
            "{}-{}",
            normalized_title.replace(' ', "-"),
            entry
                .repacker
                .to_lowercase()
                .replace(|c: char| !c.is_alphanumeric(), "-")
        );

        let languages_json = serde_json::to_string(&entry.languages).unwrap_or_else(|_| "[]".into());
        let selective_json =
            serde_json::to_string(&entry.selective_features).unwrap_or_else(|_| "[]".into());
        let download_uris_json =
            serde_json::to_string(&entry.uris).unwrap_or_else(|_| "[]".into());
        let tags_json = serde_json::to_string(&entry.tags).unwrap_or_else(|_| "[]".into());

        let was_update = db
            .query_row(
                "SELECT 1 FROM repack_catalog WHERE id=?1",
                rusqlite::params![id],
                |row| row.get::<_, i64>(0),
            )
            .is_ok();

        let result = db.execute(
            "INSERT INTO repack_catalog (id, title, normalized_title, app_id, repacker,
                 repack_group, installer_type, file_size, install_size, languages_json,
                 selective_json, download_uris_json, source_url, source, checksum,
                 updated_at, tags_json, import_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
             ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title,
                 normalized_title=excluded.normalized_title,
                 app_id=excluded.app_id,
                 repacker=excluded.repacker,
                 repack_group=excluded.repack_group,
                 installer_type=excluded.installer_type,
                 file_size=excluded.file_size,
                 install_size=excluded.install_size,
                 languages_json=excluded.languages_json,
                 selective_json=excluded.selective_json,
                 download_uris_json=excluded.download_uris_json,
                 source_url=excluded.source_url,
                 source=excluded.source,
                 checksum=excluded.checksum,
                 updated_at=excluded.updated_at,
                 tags_json=excluded.tags_json,
                 import_version=excluded.import_version + 1",
            rusqlite::params![
                id,
                entry.title,
                normalized_title,
                entry.app_id,
                entry.repacker,
                entry.repack_group,
                installer_type,
                entry.file_size.unwrap_or(0),
                entry.install_size,
                languages_json,
                selective_json,
                download_uris_json,
                source_url,
                source_name,
                entry.checksum,
                entry.updated_at.as_deref().unwrap_or(""),
                tags_json,
                1u32,
            ],
        );

        match result {
            Ok(_) => {
                if was_update {
                    updated_count += 1;
                } else {
                    imported_count += 1;
                }
            }
            Err(e) => eprintln!("[HYDRA] DB error for {}: {}", id, e),
        }
    }

    (imported_count, updated_count)
}

// ── Paths ──

fn get_hydra_sources_path(app_handle: &AppHandle) -> PathBuf {
    app_handle.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("debrid")
        .join("hydra-sources.json")
}

fn get_hydra_cache_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("debrid")
        .join("hydra-cache")
}

// ── Source persistence ──

fn load_hydra_sources(app_handle: &AppHandle) -> Vec<HydraSourceConfig> {
    let path = get_hydra_sources_path(app_handle);
    if !path.exists() {
        return vec![];
    }
    match fs::read_to_string(&path) {
        Ok(content) => {
            serde_json::from_str(&content).unwrap_or_default()
        }
        Err(_) => vec![],
    }
}

fn save_hydra_sources(app_handle: &AppHandle, sources: &[HydraSourceConfig]) -> Result<(), String> {
    let path = get_hydra_sources_path(app_handle);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(sources).map_err(|e| format!("Serialization failed: {}", e))?;
    // Atomic write via temp file
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &json).map_err(|e| format!("Write failed: {}", e))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Rename failed: {}", e))?;
    Ok(())
}

// ── Fetch and import ──

/// Fetch a repack feed from a remote URL, parse it (Hydra, artifact, or scraped format),
/// and import it into the repack catalog.
#[tauri::command]
pub async fn fetch_and_import_hydra_source(
    app_handle: AppHandle,
    source_id: String,
    source_url: String,
    source_name: String,
) -> Result<HydraImportResult, String> {
    // Step 1: Fetch the remote JSON (auto fallback to webview for Cloudflare)
    let text = fetch_hydra_source_url(&app_handle, &source_url).await?;

    // Step 2: Tolerant parse — Hydra, official artifact, or scraped JSON
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;
    let (parsed_name, rows) = parse_repack_feed_value(&value, &source_name)?;
    let effective_name = if parsed_name.trim().is_empty() {
        source_name.clone()
    } else {
        parsed_name
    };
    let total_count = rows.len() as u32;

    // Step 3: Cache the raw JSON for offline use
    let cache_dir = get_hydra_cache_dir(&app_handle);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Cache dir: {}", e))?;
    let cache_path = cache_dir.join(format!("{}.json", source_id));
    fs::write(&cache_path, &text).map_err(|e| format!("Cache write: {}", e))?;

    // Step 4: Import entries into the repack catalog (sync DB work after async)
    let db = app_handle.state::<SqliteStoreDb>();
    let db_guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("DB lock: {}", e))?,
        None => return Err("Database not available".to_string()),
    };
    let (imported_count, updated_count) =
        insert_repack_rows(&db_guard, &rows, &source_url, &effective_name);
    drop(db_guard);

    // Step 5: Update source config with fetch metadata
    let mut sources = load_hydra_sources(&app_handle);
    if let Some(existing) = sources.iter_mut().find(|s| s.id == source_id) {
        existing.last_fetched_at = Some(chrono_now());
        existing.game_count = Some(total_count);
        existing.last_error = None;
        let _ = save_hydra_sources(&app_handle, &sources);
    }

    eprintln!(
        "[HYDRA] Imported source={} name={} total={} imported={} updated={}",
        source_id, effective_name, total_count, imported_count, updated_count
    );

    Ok(HydraImportResult {
        source_name: effective_name,
        source_url,
        imported_count,
        updated_count,
        total_count,
        error: None,
    })
}

/// Fetch and validate a repack feed URL without importing.
#[tauri::command]
pub async fn validate_hydra_source_url(
    app_handle: AppHandle,
    url: String,
) -> Result<HydraFetchResult, String> {
    let text = fetch_hydra_source_url(&app_handle, &url).await?;

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;
    let (parsed_name, rows) = parse_repack_feed_value(&value, "")?;

    Ok(HydraFetchResult {
        success: true,
        source_name: parsed_name,
        game_count: rows.len() as u32,
        error: None,
    })
}

/// Import a pasted repack feed (raw JSON content) directly into the repack catalog.
/// Supports Hydra (`games`), official artifact (`records`), and scraped (`downloads`) formats.
#[tauri::command]
pub async fn import_repack_feed(
    app_handle: AppHandle,
    contents: String,
    source_name: Option<String>,
    source_url: Option<String>,
) -> Result<HydraImportResult, String> {
    let fallback_name = source_name.unwrap_or_else(|| "pasted-feed".to_string());
    let url = source_url.unwrap_or_default();

    let value: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Parse error: {}", e))?;
    let (parsed_name, rows) = parse_repack_feed_value(&value, &fallback_name)?;
    let effective_name = if parsed_name.trim().is_empty() {
        fallback_name
    } else {
        parsed_name
    };
    let total_count = rows.len() as u32;

    let db = app_handle.state::<SqliteStoreDb>();
    let db_guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("DB lock: {}", e))?,
        None => return Err("Database not available".to_string()),
    };
    let (imported_count, updated_count) =
        insert_repack_rows(&db_guard, &rows, &url, &effective_name);
    drop(db_guard);

    eprintln!(
        "[HYDRA] Pasted feed name={} total={} imported={} updated={}",
        effective_name, total_count, imported_count, updated_count
    );

    Ok(HydraImportResult {
        source_name: effective_name,
        source_url: url,
        imported_count,
        updated_count,
        total_count,
        error: None,
    })
}

/// List pasted repack feeds (catalog rows with an empty `source_url`),
/// grouped by feed name with per-feed game counts.
#[tauri::command]
pub fn list_imported_feeds(app_handle: AppHandle) -> Result<Vec<ImportedFeedSummary>, String> {
    let db = app_handle.state::<SqliteStoreDb>();
    let db_guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("DB lock: {}", e))?,
        None => return Ok(Vec::new()),
    };

    let mut stmt = db_guard
        .prepare(
            "SELECT source, COUNT(*), MAX(updated_at)
             FROM repack_catalog
             WHERE source_url = '' AND source <> ''
             GROUP BY source
             ORDER BY source ASC",
        )
        .map_err(|e| format!("Failed to prepare imported feeds query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportedFeedSummary {
                name: row.get(0)?,
                game_count: row.get::<_, i64>(1)? as u32,
                last_updated: row.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query imported feeds: {}", e))?;

    let mut feeds = Vec::new();
    for row in rows {
        feeds.push(row.map_err(|e| format!("Failed to read imported feed row: {}", e))?);
    }
    Ok(feeds)
}

/// Remove a pasted repack feed, purging all of its rows from the repack catalog.
#[tauri::command]
pub fn remove_imported_feed(app_handle: AppHandle, name: String) -> Result<u32, String> {
    let db = app_handle.state::<SqliteStoreDb>();
    let db_guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("DB lock: {}", e))?,
        None => return Err("Database not available".to_string()),
    };
    let deleted = db_guard
        .execute(
            "DELETE FROM repack_catalog WHERE source_url = '' AND source = ?1",
            rusqlite::params![name],
        )
        .map_err(|e| format!("Failed to purge feed rows: {}", e))?;
    drop(db_guard);
    eprintln!("[HYDRA][FEED_REMOVE] name={} deleted={} rows", name, deleted);
    Ok(deleted as u32)
}

/// List all configured Hydra sources.
#[tauri::command]
pub fn list_hydra_sources(app_handle: AppHandle) -> Vec<HydraSourceConfig> {
    load_hydra_sources(&app_handle)
}

/// Add a new Hydra source configuration.
#[tauri::command]
pub fn add_hydra_source(
    app_handle: AppHandle,
    id: String,
    name: String,
    url: String,
) -> Result<(), String> {
    let mut sources = load_hydra_sources(&app_handle);

    if sources.iter().any(|s| s.id == id) {
        return Err(format!("Source with ID '{}' already exists", id));
    }

    sources.push(HydraSourceConfig {
        id,
        name,
        url,
        last_fetched_at: None,
        game_count: None,
        enabled: true,
        last_error: None,
    });

    save_hydra_sources(&app_handle, &sources)
}

/// Remove a Hydra source configuration and purge its entries from the repack catalog.
#[tauri::command]
pub fn remove_hydra_source(app_handle: AppHandle, id: String) -> Result<(), String> {
    let mut sources = load_hydra_sources(&app_handle);
    let removed_url = sources.iter().find(|s| s.id == id).map(|s| s.url.clone());
    sources.retain(|s| s.id != id);
    save_hydra_sources(&app_handle, &sources)?;

    if let Some(url) = removed_url {
        let db = app_handle.state::<SqliteStoreDb>();
        let db_guard = match &db.0 {
            Some(mutex) => mutex.lock().map_err(|e| format!("DB lock: {}", e))?,
            None => return Err("Database not available".to_string()),
        };
        let deleted = db_guard
            .execute(
                "DELETE FROM repack_catalog WHERE source_url=?1",
                rusqlite::params![url],
            )
            .map_err(|e| format!("Failed to purge repack rows: {}", e))?;
        drop(db_guard);
        eprintln!("[HYDRA][REMOVE] source={} deleted={} rows", id, deleted);
    }

    Ok(())
}

/// Toggle a Hydra source enabled/disabled.
#[tauri::command]
pub fn toggle_hydra_source(
    app_handle: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut sources = load_hydra_sources(&app_handle);
    if let Some(source) = sources.iter_mut().find(|s| s.id == id) {
        source.enabled = enabled;
        save_hydra_sources(&app_handle, &sources)
    } else {
        Err(format!("Source '{}' not found", id))
    }
}

/// Refresh all enabled Hydra sources, importing any new entries.
#[tauri::command]
pub async fn refresh_all_hydra_sources(
    app_handle: AppHandle,
) -> Result<Vec<HydraImportResult>, String> {
    let sources = load_hydra_sources(&app_handle);
    let enabled: Vec<HydraSourceConfig> = sources.into_iter().filter(|s| s.enabled).collect();

    if enabled.is_empty() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();

    for source in &enabled {
        // Reuse the import logic by calling import_entries_to_catalog
        match import_hydra_source_entries(&app_handle, source).await {
            Ok(result) => results.push(result),
            Err(e) => {
                results.push(HydraImportResult {
                    source_name: source.name.clone(),
                    source_url: source.url.clone(),
                    imported_count: 0,
                    updated_count: 0,
                    total_count: 0,
                    error: Some(e),
                });
            }
        }
    }

    Ok(results)
}

/// Shared import logic: fetch, parse, and store Hydra source entries into the repack catalog.
async fn import_hydra_source_entries(
    app_handle: &AppHandle,
    source: &HydraSourceConfig,
) -> Result<HydraImportResult, String> {
    let text = fetch_hydra_source_url(app_handle, &source.url).await?;

    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;
    let (parsed_name, rows) = parse_repack_feed_value(&value, &source.name)?;
    let effective_name = if parsed_name.trim().is_empty() {
        source.name.clone()
    } else {
        parsed_name
    };
    let total_count = rows.len() as u32;

    // Cache raw JSON
    let cache_dir = get_hydra_cache_dir(app_handle);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Cache dir: {}", e))?;
    let cache_path = cache_dir.join(format!("{}.json", source.id));
    let _ = fs::write(&cache_path, &text);

    // Insert entries into DB
    let db = app_handle.state::<SqliteStoreDb>();
    let db_guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("DB lock: {}", e))?,
        None => return Err("Database not available".to_string()),
    };
    let (imported_count, updated_count) =
        insert_repack_rows(&db_guard, &rows, &source.url, &effective_name);
    drop(db_guard);

    // Update source metadata
    let mut sources = load_hydra_sources(app_handle);
    if let Some(existing) = sources.iter_mut().find(|s| s.id == source.id) {
        existing.last_fetched_at = Some(chrono_now());
        existing.game_count = Some(total_count);
        existing.last_error = None;
        let _ = save_hydra_sources(app_handle, &sources);
    }

    eprintln!(
        "[HYDRA] Refreshed source={} name={} total={} imported={} updated={}",
        source.id, effective_name, total_count, imported_count, updated_count
    );

    Ok(HydraImportResult {
        source_name: effective_name,
        source_url: source.url.clone(),
        imported_count,
        updated_count,
        total_count,
        error: None,
    })
}

/// Clear the Hydra source cache (fetched JSON files).
#[tauri::command]
pub fn clear_hydra_cache(app_handle: AppHandle) -> Result<(), String> {
    let cache_dir = get_hydra_cache_dir(&app_handle);
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| format!("Failed to clear cache: {}", e))?;
    }
    Ok(())
}

// ── Webview-based fetch (Cloudflare challenge bypass) ──

/// Pending webview fetch callbacks, keyed by callback ID.
pub(crate) static PENDING_FETCHES: LazyLock<Mutex<HashMap<String, oneshot::Sender<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Mutex to serialize webview-based fetches (single hidden webview).
static WEBVIEW_FETCH_MUTEX: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Callback invoked by the webview-fetch-callback.html page after a successful fetch.
#[tauri::command]
pub async fn webview_fetch_callback(
    callback_id: String,
    content: String,
) -> Result<(), String> {
    let mut map = PENDING_FETCHES
        .lock()
        .map_err(|e| format!("[WEBVIEW_FETCH] lock: {}", e))?;
    if let Some(tx) = map.remove(&callback_id) {
        tx.send(content)
            .map_err(|_| "[WEBVIEW_FETCH] receiver dropped".to_string())
    } else {
        Err(format!(
            "[WEBVIEW_FETCH] no pending fetch for {}",
            callback_id
        ))
    }
}

/// Fetch a URL using a hidden WebviewWindow (handles Cloudflare JS challenges).
#[tauri::command]
pub async fn fetch_url_via_webview(
    app_handle: AppHandle,
    url: String,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let _lock = WEBVIEW_FETCH_MUTEX.lock().await;
    fetch_url_via_webview_impl(&app_handle, &url, timeout_secs).await
}

/// Internal impl: long-wait + about:blank bounce.
///
/// Key insight: Cloudflare's JS challenge needs 5-10s of uninterrupted time on
/// the target page. The old code navigated to about:blank every 6s, which killed
/// the challenge before it could complete.
///
/// Fix: wait 15s on the FIRST attempt before doing the about:blank bounce.
/// Subsequent retries (after navigating back to target) use shorter waits.
/// window.name survives all navigations including cross-origin about:blank.
pub(crate) async fn fetch_url_via_webview_impl(
    app_handle: &AppHandle,
    url: &str,
    _timeout_secs: Option<u64>,
) -> Result<String, String> {
    let label = "webview-fetcher";

    let window = match app_handle.get_webview_window(label) {
        Some(w) => w,
        None => {
            eprintln!("[WEBVIEW_FETCH] creating hidden webview");
            tauri::WebviewWindowBuilder::new(
                app_handle,
                label,
                WebviewUrl::External(Url::parse("about:blank").unwrap()),
            )
            .title("Fetch")
            .inner_size(1.0, 1.0)
            .skip_taskbar(true)
            .visible(false)
            .build()
            .map_err(|e| format!("[WEBVIEW_FETCH] create: {}", e))?
        }
    };

    let target = Url::parse(url).map_err(|e| format!("[WEBVIEW_FETCH] invalid URL: {}", e))?;
    let about_blank = Url::parse("about:blank").unwrap();

    eprintln!("[WEBVIEW_FETCH] navigating to {}", url);
    window
        .navigate(target.clone())
        .map_err(|e| format!("[WEBVIEW_FETCH] navigate: {}", e))?;

    let max_attempts: u32 = 12;

    for attempt in 1..=max_attempts {
        // First attempt: 15s — enough for Cloudflare JS challenge (typically 5-10s)
        // Subsequent attempts: 3s each (navigating back restarts Cloudflare, so
        // these are fallbacks for edge cases where Cloudflare took >15s).
        let wait_s = if attempt == 1 { 15 } else { 3 };
        tokio::time::sleep(Duration::from_secs(wait_s)).await;

        let callback_id = format!("wf_{}_{}", url_hash(url), attempt);
        let (tx, mut rx) = oneshot::channel::<String>();

        {
            let mut map = PENDING_FETCHES
                .lock()
                .map_err(|e| format!("[WEBVIEW_FETCH] lock: {}", e))?;
            map.insert(callback_id.clone(), tx);
        }

        // Step 1: eval on current page → store real content in window.name
        // window.name survives navigation to about:blank.
        let store_js = r#"(function(){try{var t=document.body?.innerText||'';if(t.length>50&&!/Checking|Just a moment|Verify you are human/i.test(t)){window.name=t;}}catch(e){}})();"#;
        let _ = window.eval(store_js);

        // Step 2: navigate to about:blank where __TAURI_INTERNALS__ is available
        let _ = window.navigate(about_blank.clone());
        tokio::time::sleep(Duration::from_millis(80)).await;

        // Step 3: on about:blank, read window.name and invoke callback
        let invoke_js = format!(
            r#"window.__TAURI_INTERNALS__.invoke('webview_fetch_callback',{{callbackId:'{}',content:window.name||''}});"#,
            callback_id
        );
        let _ = window.eval(&invoke_js);

        eprintln!(
            "[WEBVIEW_FETCH] attempt={}/{} url={}",
            attempt,
            max_attempts,
            if url.len() > 100 { &url[..100] } else { url },
        );

        // Wait for callback with 3s timeout
        tokio::select! {
            result = &mut rx => {
                let _ = PENDING_FETCHES.lock().map(|mut m| m.remove(&callback_id));
                match result {
                    Ok(content) if !content.is_empty() && content.len() > 50 => {
                        eprintln!("[WEBVIEW_FETCH] success attempt={} len={}", attempt, content.len());
                        return Ok(content);
                    }
                    Ok(c) => {
                        eprintln!("[WEBVIEW_FETCH] empty/short content attempt={} len={}", attempt, c.len());
                        // Navigate back to target URL for retry — Cloudflare restarts
                        let _ = window.navigate(target.clone());
                    }
                    Err(_) => {
                        eprintln!("[WEBVIEW_FETCH] rx cancelled attempt={}", attempt);
                        let _ = window.navigate(target.clone());
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(3)) => {
                let _ = PENDING_FETCHES.lock().map(|mut m| m.remove(&callback_id));
                eprintln!("[WEBVIEW_FETCH] timeout attempt={}", attempt);
                let _ = window.navigate(target.clone());
            }
        }
    }

    Err("[WEBVIEW_FETCH] timed out after all attempts".to_string())
}

/// Deterministic hash of a URL string (for callback ID prefixes).
pub(crate) fn url_hash(url: &str) -> String {
    let mut h: u64 = 0;
    for b in url.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u64);
    }
    format!("{:x}", h)
}

// ── Shared fetch helper (reqwest → webview fallback) ──

/// Fetch Hydra source content: tries reqwest first, falls back to webview on 403/Cloudflare.
async fn fetch_hydra_source_url(app_handle: &AppHandle, url: &str) -> Result<String, String> {
    // Fast path: reqwest
    let client = reqwest::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client: {}", e))?;

    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status();
            let text = response
                .text()
                .await
                .map_err(|e| format!("Read response: {}", e))?;

            if status.is_success() {
                return Ok(text);
            }

            if status.as_u16() == 403
                && (text.contains("Checking your browser")
                    || text.contains("Just a moment")
                    || text.contains("Verify you are human"))
            {
                eprintln!("[HYDRA] Cloudflare challenge for {}, using webview", url);
            } else {
                return Err(format!("HTTP {} for {}", status, url));
            }
        }
        Err(e) => {
            eprintln!(
                "[HYDRA] reqwest error for {}: {}. Falling back to webview",
                url, e
            );
        }
    }

    // Slow path: webview-based fetch (serialized by WEBVIEW_FETCH_MUTEX)
    let _lock = WEBVIEW_FETCH_MUTEX.lock().await;
    fetch_url_via_webview_impl(app_handle, url, Some(45)).await
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Format as ISO 8601
    let days = secs / 86400;
    let time = secs % 86400;
    let hours = time / 3600;
    let minutes = (time % 3600) / 60;
    let seconds = time % 60;

    // Simple date from days since epoch (1970-01-01)
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if is_leap_year(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let month_days = if is_leap_year(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md {
            m = i;
            break;
        }
        remaining -= md;
    }

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m + 1,
        remaining + 1,
        hours,
        minutes,
        seconds
    )
}

fn is_leap_year(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}
