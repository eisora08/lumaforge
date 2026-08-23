use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache;
use crate::commands::sqlite_cache::SqliteStoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailabilitySourceEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub status: String,
    pub package_url: Option<String>,
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailabilityGameEntry {
    pub app_id: String,
    pub title: String,
    pub status: String,
    pub lua_ready: bool,
    pub selected_source_id: Option<String>,
    pub available_sources: Vec<SourceAvailabilitySourceEntry>,
    pub source_count: u32,
    pub total_provider_count: u32,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAvailabilityIndex {
    pub version: u32,
    pub updated_at: u64,
    pub games: HashMap<String, SourceAvailabilityGameEntry>,
}

#[tauri::command]
pub fn read_source_availability_index(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
) -> Result<SourceAvailabilityIndex, String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Ok(SourceAvailabilityIndex {
            version: 1,
            updated_at: 0,
            games: HashMap::new(),
        });
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let rows = sqlite_cache::source_availability::read_all_source_availability(&conn)?;

    let mut games = HashMap::new();
    for (app_id, data_json) in rows {
        match serde_json::from_str::<SourceAvailabilityGameEntry>(&data_json) {
            Ok(entry) => {
                games.insert(app_id, entry);
            }
            Err(e) => {
                println!(
                    "[SOURCE_AVAIL][READ] appid={} corrupt error=\"{}\"",
                    app_id, e
                );
            }
        }
    }

    let updated_at = games.values().map(|g| g.updated_at).max().unwrap_or(0);

    Ok(SourceAvailabilityIndex {
        version: 1,
        updated_at,
        games,
    })
}

#[tauri::command]
pub fn write_source_availability_index(
    _app_handle: AppHandle,
    store_db: tauri::State<'_, SqliteStoreDb>,
    index: SourceAvailabilityIndex,
) -> Result<(), String> {
    let Some(inner) = store_db.0.as_ref() else {
        return Err("SQLite store DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    for (app_id, entry) in &index.games {
        let data_json = serde_json::to_string(entry)
            .map_err(|e| format!("Failed to serialize source entry for {}: {}", app_id, e))?;
        sqlite_cache::source_availability::write_source_availability(&conn, app_id, &data_json)?;
    }

    Ok(())
}
