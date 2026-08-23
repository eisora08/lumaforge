use rusqlite::{Connection, OptionalExtension};

// ---------------------------------------------------------------------------
// Debrid games cache — singleton row storing the full Vec<DebridGameEntry>
// as a JSON blob (replaces debrid-games.json on disk).
// ---------------------------------------------------------------------------

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS debrid_games (
            id         INTEGER PRIMARY KEY DEFAULT 1,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create debrid_games table: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn read_debrid_games(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM debrid_games WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

pub fn write_debrid_games(
    conn: &Connection,
    data_json: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO debrid_games (id, data_json, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
            data_json  = excluded.data_json,
            updated_at = excluded.updated_at",
        rusqlite::params![data_json, now()],
    )
    .map_err(|e| format!("Upsert debrid_games error: {}", e))?;
    Ok(())
}
