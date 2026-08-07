use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// StartupSnapshot — SQLite backing for cache/startup-snapshot.json.
// Single-row table (id=1) storing the full snapshot as a JSON blob.
// ---------------------------------------------------------------------------

/// Read the startup snapshot JSON string from SQLite.
pub fn read_startup_snapshot_sqlite(
    db: &SqliteCoreDb,
) -> Option<String> {
    let conn_ref = db.0.as_ref()?;
    let conn = conn_ref.lock().unwrap();

    conn.query_row(
        "SELECT snapshot_json FROM startup_snapshots WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

/// Write (upsert) the startup snapshot JSON string to SQLite.
pub fn write_startup_snapshot_sqlite(
    db: &SqliteCoreDb,
    version: u32,
    snapshot_json: &str,
) -> Result<(), String> {
    let conn_ref = db.0.as_ref().ok_or("Database not available")?;
    let conn = conn_ref.lock().map_err(|e| format!("Lock error: {}", e))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    conn.execute(
        "INSERT INTO startup_snapshots (id, version, updated_at, snapshot_json) \
         VALUES (1, ?1, ?2, ?3) \
         ON CONFLICT(id) DO UPDATE SET \
           version = excluded.version, \
           updated_at = excluded.updated_at, \
           snapshot_json = excluded.snapshot_json",
        rusqlite::params![version as i64, now, snapshot_json],
    )
    .map_err(|e| format!("Write startup_snapshot: {}", e))?;

    Ok(())
}

/// Delete the startup snapshot from SQLite.
pub fn clear_startup_snapshot_sqlite(
    db: &SqliteCoreDb,
) -> Result<(), String> {
    let conn_ref = db.0.as_ref().ok_or("Database not available")?;
    let conn = conn_ref.lock().map_err(|e| format!("Lock error: {}", e))?;

    conn.execute("DELETE FROM startup_snapshots WHERE id = 1", [])
        .map_err(|e| format!("Clear startup_snapshot: {}", e))?;

    Ok(())
}
