use rusqlite::{Connection, OptionalExtension};

// ---------------------------------------------------------------------------
// Epic games cache — singleton row storing the full Vec<EpicGameEntryJson>
// as a JSON blob. Kept in a dedicated table (NOT the `games` table) so Epic
// rows never mix with Steam/manual/debrid game data.
// ---------------------------------------------------------------------------

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS epic_games (
            id         INTEGER PRIMARY KEY DEFAULT 1,
            data_json  TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create epic_games table: {}", e))?;
    Ok(())
}

pub fn read_epic_games(conn: &Connection) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT data_json FROM epic_games WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Query error: {}", e))
}

pub fn write_epic_games(
    conn: &Connection,
    data_json: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO epic_games (id, data_json, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
            data_json  = excluded.data_json,
            updated_at = excluded.updated_at",
        rusqlite::params![data_json, now()],
    )
    .map_err(|e| format!("Upsert epic_games error: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
