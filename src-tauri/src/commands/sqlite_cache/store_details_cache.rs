use rusqlite::{Connection, OptionalExtension};

// ---------------------------------------------------------------------------
// Store details cache — replaces store/store-details/{appId}.json
// Cached full StoreGameDetailsPage data per game.
// ---------------------------------------------------------------------------

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS store_details (
            app_id     TEXT PRIMARY KEY,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS library_game_details (
            app_id     TEXT PRIMARY KEY,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create store_details tables: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// store_details
// ---------------------------------------------------------------------------

pub fn read_store_details(
    conn: &Connection,
    app_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM store_details WHERE app_id = ?1",
        [app_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

pub fn write_store_details(
    conn: &Connection,
    app_id: &str,
    data_json: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO store_details (app_id, data_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(app_id) DO UPDATE SET
            data_json  = excluded.data_json,
            updated_at = excluded.updated_at",
        rusqlite::params![app_id, data_json, now()],
    )
    .map_err(|e| format!("Upsert store_details error: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// library_game_details
// ---------------------------------------------------------------------------

pub fn read_library_game_details(
    conn: &Connection,
    app_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM library_game_details WHERE app_id = ?1",
        [app_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

pub fn write_library_game_details(
    conn: &Connection,
    app_id: &str,
    data_json: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO library_game_details (app_id, data_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(app_id) DO UPDATE SET
            data_json  = excluded.data_json,
            updated_at = excluded.updated_at",
        rusqlite::params![app_id, data_json, now()],
    )
    .map_err(|e| format!("Upsert library_game_details error: {}", e))?;
    Ok(())
}
