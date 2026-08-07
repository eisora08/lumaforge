use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteStoreDb;

// ---------------------------------------------------------------------------
// Provider status — replaces store/provider-status/{appId}/{providerId}.json
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusRow {
    pub app_id: String,
    pub provider_id: String,
    pub data: String,
    pub updated_at: i64,
}

fn get_provider_status_inner(
    conn: &Connection,
    app_id: &str,
    provider_id: &str,
) -> Result<Option<ProviderStatusRow>, String> {
    conn.query_row(
        "SELECT app_id, provider_id, data, updated_at
         FROM provider_status WHERE app_id = ?1 AND provider_id = ?2",
        rusqlite::params![app_id, provider_id],
        |row| {
            Ok(ProviderStatusRow {
                app_id: row.get(0)?,
                provider_id: row.get(1)?,
                data: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

#[tauri::command]
pub fn upsert_provider_status(
    state: tauri::State<'_, SqliteStoreDb>,
    row: ProviderStatusRow,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO provider_status (app_id, provider_id, data, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(app_id, provider_id) DO UPDATE SET
            data = excluded.data,
            updated_at = excluded.updated_at",
        rusqlite::params![row.app_id, row.provider_id, row.data, if row.updated_at > 0 { row.updated_at } else { now }],
    )
    .map_err(|e| format!("Upsert provider_status error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_provider_status_from_db(
    state: tauri::State<'_, SqliteStoreDb>,
    app_id: String,
    provider_id: String,
) -> Result<Option<ProviderStatusRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_provider_status_inner(&conn, &app_id, &provider_id)
}

#[tauri::command]
pub fn get_all_provider_statuses(
    state: tauri::State<'_, SqliteStoreDb>,
    app_id: String,
) -> Result<Vec<ProviderStatusRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT app_id, provider_id, data, updated_at
             FROM provider_status WHERE app_id = ?1",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;
    let rows = stmt
        .query_map([&app_id], |row| {
            Ok(ProviderStatusRow {
                app_id: row.get(0)?,
                provider_id: row.get(1)?,
                data: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(results)
}
