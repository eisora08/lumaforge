use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteStoreDb;

// ---------------------------------------------------------------------------
// Store reviews — replaces store/reviews/{appid}.json
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreReviewRow {
    pub app_id: String,
    pub data: String,
    pub updated_at: i64,
}

fn get_store_review_inner(
    conn: &Connection,
    app_id: &str,
) -> Result<Option<StoreReviewRow>, String> {
    conn.query_row(
        "SELECT app_id, data, updated_at FROM store_reviews WHERE app_id = ?1",
        [app_id],
        |row| {
            Ok(StoreReviewRow {
                app_id: row.get(0)?,
                data: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

#[tauri::command]
pub fn upsert_store_review(
    state: tauri::State<'_, SqliteStoreDb>,
    row: StoreReviewRow,
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
        "INSERT INTO store_reviews (app_id, data, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(app_id) DO UPDATE SET
            data = excluded.data,
            updated_at = excluded.updated_at",
        rusqlite::params![row.app_id, row.data, if row.updated_at > 0 { row.updated_at } else { now }],
    )
    .map_err(|e| format!("Upsert store_review error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_store_review(
    state: tauri::State<'_, SqliteStoreDb>,
    app_id: String,
) -> Result<Option<StoreReviewRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_store_review_inner(&conn, &app_id)
}

#[tauri::command]
pub fn batch_get_store_reviews(
    state: tauri::State<'_, SqliteStoreDb>,
    app_ids: Vec<String>,
) -> Result<Vec<StoreReviewRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let mut results = Vec::new();
    for app_id in &app_ids {
        if let Some(row) = get_store_review_inner(&conn, app_id)? {
            results.push(row);
        }
    }
    Ok(results)
}
