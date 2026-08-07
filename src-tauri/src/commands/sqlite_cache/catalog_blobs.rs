use rusqlite::{Connection, OptionalExtension};

use super::SqliteStoreDb;

// ---------------------------------------------------------------------------
// Game catalog blob CRUD (steam-owned, debrid, installed, snapshot)
// ---------------------------------------------------------------------------

fn get_catalog_blob_inner(conn: &Connection, catalog_key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM game_catalog_blobs WHERE catalog_key = ?1",
        [catalog_key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

#[tauri::command]
#[allow(dead_code)]
pub fn upsert_game_catalog_blob(
    state: tauri::State<'_, SqliteStoreDb>,
    catalog_key: String,
    data_json: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "INSERT INTO game_catalog_blobs (catalog_key, data_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(catalog_key) DO UPDATE SET
            data_json = excluded.data_json,
            updated_at = excluded.updated_at",
        rusqlite::params![catalog_key, data_json, now],
    )
    .map_err(|e| format!("SQLite upsert error: {}", e))?;
    Ok(())
}

#[tauri::command]
#[allow(dead_code)]
pub fn get_game_catalog_blob(
    state: tauri::State<'_, SqliteStoreDb>,
    catalog_key: String,
) -> Result<Option<String>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().map_err(|e| format!("Lock error: {}", e))?;
    get_catalog_blob_inner(&conn, &catalog_key)
}
