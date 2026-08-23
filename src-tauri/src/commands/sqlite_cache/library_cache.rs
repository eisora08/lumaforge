use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Library cache — key/value blobs for snapshot/library state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheEntry {
    pub cache_key: String,
    pub cache_value: String,
    pub saved_at: i64,
}

#[tauri::command]
pub fn read_library_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    key: String,
) -> Result<Option<LibraryCacheEntry>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().unwrap();
    read_library_cache_inner(&conn, &key)
}

#[tauri::command]
pub fn write_library_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    let conn = db.lock().unwrap();
    conn.execute(
        "DELETE FROM library_cache WHERE cache_key = ?1",
        [&key],
    )
    .map_err(|e| format!("Failed to clear library cache key: {}", e))?;
    conn.execute(
        "INSERT INTO library_cache (cache_key, cache_value, saved_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![key, value, chrono::Utc::now().timestamp()],
    )
    .map_err(|e| format!("Failed to write library cache: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_library_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    key: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM library_cache WHERE cache_key = ?1", [&key])
        .map_err(|e| format!("Failed to delete library cache key: {}", e))?;
    Ok(())
}

fn read_library_cache_inner(
    conn: &Connection,
    key: &str,
) -> Result<Option<LibraryCacheEntry>, String> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT cache_key, cache_value, saved_at FROM library_cache WHERE cache_key = ?1",
        [key],
        |row| {
            Ok(LibraryCacheEntry {
                cache_key: row.get(0)?,
                cache_value: row.get(1)?,
                saved_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read library cache: {}", e))
}
