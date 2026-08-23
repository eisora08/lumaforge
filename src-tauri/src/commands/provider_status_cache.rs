use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache;
use crate::commands::sqlite_cache::SqliteStoreDb;

const DEBUG_PROVIDER_STATUS: bool = false;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusSnapshotEntryLocal {
    pub file_size_at_install: Option<i64>,
    pub file_modified_at_install: Option<String>,
    pub version_at_install: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusSnapshotEntryRemote {
    pub status: Option<String>,
    pub file_size: Option<i64>,
    pub file_modified: Option<String>,
    pub needs_update: Option<bool>,
    pub update_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusSnapshotEntry {
    pub app_id: String,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local: Option<ProviderStatusSnapshotEntryLocal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<ProviderStatusSnapshotEntryRemote>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusSnapshot {
    pub schema_version: u32,
    pub updated_at: u64,
    pub entries: HashMap<String, ProviderStatusSnapshotEntry>,
}

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

// ─── Snapshot commands (SQLite via provider_snapshot) ──

#[tauri::command]
pub fn read_provider_status_snapshot(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Option<ProviderStatusSnapshot>, String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Ok(None);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::provider_snapshot::read_provider_status_snapshot(&conn)?;

    let Some(json) = json_opt else {
        println!("[PROVIDER_STATUS][SNAPSHOT_LOAD] found=false source=sqlite");
        return Ok(None);
    };

    match serde_json::from_str::<ProviderStatusSnapshot>(&json) {
        Ok(data @ ProviderStatusSnapshot { schema_version: 1, .. }) => {
            println!(
                "[PROVIDER_STATUS][SNAPSHOT_LOAD] found=true entries={} source=sqlite",
                data.entries.len()
            );
            Ok(Some(data))
        }
        Ok(_) => {
            println!(
                "[PROVIDER_STATUS][SNAPSHOT_LOAD] found=true valid=false reason=bad-schema source=sqlite"
            );
            Ok(None)
        }
        Err(e) => {
            println!(
                "[PROVIDER_STATUS][SNAPSHOT_LOAD] found=corrupt error=\"{}\" source=sqlite",
                e
            );
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_provider_status_snapshot(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    payload: String,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    sqlite_cache::provider_snapshot::write_provider_status_snapshot(&conn, &payload)?;

    Ok(())
}

// ─── Per-game provider status (SQLite via provider_status) ──

#[tauri::command]
pub fn read_provider_status(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    app_id: String,
    provider_id: String,
) -> Result<Option<ProviderStatusFile>, String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Ok(None);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let row = sqlite_cache::provider_status::get_provider_status_inner(&conn, &app_id, &provider_id)?;

    let Some(row) = row else {
        if DEBUG_PROVIDER_STATUS {
            println!(
                "[PROVIDER_STATUS][LOAD] appid={} provider={} found=false source=sqlite",
                app_id, provider_id
            );
        }
        return Ok(None);
    };

    match serde_json::from_str::<ProviderStatusFile>(&row.data) {
        Ok(data) => {
            if DEBUG_PROVIDER_STATUS {
                println!(
                    "[PROVIDER_STATUS][LOAD] appid={} provider={} found=true source=sqlite",
                    app_id, provider_id
                );
            }
            Ok(Some(data))
        }
        Err(e) => {
            println!(
                "[PROVIDER_STATUS][LOAD] appid={} provider={} found=corrupt error=\"{}\" source=sqlite",
                app_id, provider_id, e
            );
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_provider_status(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    app_id: String,
    provider_id: String,
    payload: String,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    println!(
        "[PROVIDER_STATUS][WRITE_CALL] appid={} provider={} source=sqlite",
        app_id, provider_id
    );

    sqlite_cache::provider_status::upsert_provider_status_inner(&conn, &app_id, &provider_id, &payload)?;

    if DEBUG_PROVIDER_STATUS {
        println!(
            "[PROVIDER_STATUS][WRITE_OK] appid={} provider={} source=sqlite",
            app_id, provider_id
        );
    }

    Ok(())
}
