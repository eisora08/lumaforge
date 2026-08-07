use rusqlite::{Connection, OptionalExtension};

// ---------------------------------------------------------------------------
// Store media cache — replaces store/media-cache/{appId}.json
// Cached store media resolution (capsule, header, hero, logo, icon).
// ---------------------------------------------------------------------------

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS store_media_cache (
            app_id     TEXT PRIMARY KEY,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create store_media_cache table: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn read_store_media_cache(
    conn: &Connection,
    app_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM store_media_cache WHERE app_id = ?1",
        [app_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

pub fn write_store_media_cache(
    conn: &Connection,
    app_id: &str,
    data_json: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO store_media_cache (app_id, data_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(app_id) DO UPDATE SET
            data_json  = excluded.data_json,
            updated_at = excluded.updated_at",
        rusqlite::params![app_id, data_json, now()],
    )
    .map_err(|e| format!("Upsert store_media_cache error: {}", e))?;
    Ok(())
}

pub fn read_all_store_media_cache(
    conn: &Connection,
) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT app_id, data_json FROM store_media_cache ORDER BY updated_at DESC")
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("Query error: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(results)
}

pub fn delete_store_media_cache(
    conn: &Connection,
    app_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM store_media_cache WHERE app_id = ?1",
        [app_id],
    )
    .map_err(|e| format!("Delete store_media_cache error: {}", e))?;
    Ok(())
}
