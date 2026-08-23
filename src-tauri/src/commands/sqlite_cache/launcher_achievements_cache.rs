use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS launcher_achievements (
            id         INTEGER PRIMARY KEY DEFAULT 1,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS launcher_xp_events (
            id         INTEGER PRIMARY KEY DEFAULT 1,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Failed to create launcher_achievements tables: {}", e))?;
    Ok(())
}

pub fn read_launcher_achievements(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM launcher_achievements WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query launcher_achievements error: {}", e))
}

pub fn write_launcher_achievements(conn: &Connection, data_json: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO launcher_achievements (id, data_json, updated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
        rusqlite::params![data_json, now],
    )
    .map_err(|e| format!("Upsert launcher_achievements error: {}", e))?;
    Ok(())
}

pub fn read_launcher_xp_events(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM launcher_xp_events WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query launcher_xp_events error: {}", e))
}

pub fn write_launcher_xp_events(conn: &Connection, data_json: &str) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO launcher_xp_events (id, data_json, updated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at",
        rusqlite::params![data_json, now],
    )
    .map_err(|e| format!("Upsert launcher_xp_events error: {}", e))?;
    Ok(())
}

// Count for migration check
pub fn count_achievements(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM launcher_achievements",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

use rusqlite::OptionalExtension;
