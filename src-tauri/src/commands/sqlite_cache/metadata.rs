use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Metadata cache — per-game resolved metadata JSON
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataCacheEntry {
    pub game_id: String,
    pub provider: String,
    pub metadata: String,
    pub exe_path: Option<String>,
    pub exe_name: Option<String>,
    pub install_dir: Option<String>,
    pub updated_at: i64,
}

fn get_metadata_cache_inner(
    conn: &Connection,
    game_id: &str,
) -> Result<Option<MetadataCacheEntry>, String> {
    conn.query_row(
        "SELECT game_id, provider, metadata, exe_path, exe_name, install_dir, updated_at
         FROM metadata_cache WHERE game_id = ?1",
        [game_id],
        |row| {
            Ok(MetadataCacheEntry {
                game_id: row.get(0)?,
                provider: row.get(1)?,
                metadata: row.get(2)?,
                exe_path: row.get(3)?,
                exe_name: row.get(4)?,
                install_dir: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read metadata cache: {}", e))
}

#[tauri::command]
pub fn get_metadata_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Option<MetadataCacheEntry>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().unwrap();
    get_metadata_cache_inner(&conn, &game_id)
}

#[tauri::command]
pub fn insert_metadata_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    entry: MetadataCacheEntry,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO metadata_cache (game_id, provider, metadata, exe_path, exe_name, install_dir, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(game_id) DO UPDATE SET
            provider = excluded.provider,
            metadata = excluded.metadata,
            exe_path = excluded.exe_path,
            exe_name = excluded.exe_name,
            install_dir = excluded.install_dir,
            updated_at = excluded.updated_at",
        rusqlite::params![
            entry.game_id,
            entry.provider,
            entry.metadata,
            entry.exe_path,
            entry.exe_name,
            entry.install_dir,
            entry.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to insert metadata cache: {}", e))?;
    Ok(())
}
