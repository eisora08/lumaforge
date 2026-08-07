use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Media cache — per-game media paths and coverage flags
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaCacheEntry {
    pub game_id: String,
    pub provider: String,
    pub base_path: String,
    pub has_cover: bool,
    pub has_background: bool,
    pub has_logo: bool,
    pub has_landscape: bool,
    pub updated_at: i64,
}

fn get_media_cache_inner(
    conn: &Connection,
    game_id: &str,
) -> Result<Option<MediaCacheEntry>, String> {
    conn.query_row(
        "SELECT game_id, provider, base_path, has_cover, has_background, has_logo, has_landscape, updated_at
         FROM media_cache WHERE game_id = ?1",
        [game_id],
        |row| {
            Ok(MediaCacheEntry {
                game_id: row.get(0)?,
                provider: row.get(1)?,
                base_path: row.get(2)?,
                has_cover: row.get::<_, i32>(3)? != 0,
                has_background: row.get::<_, i32>(4)? != 0,
                has_logo: row.get::<_, i32>(5)? != 0,
                has_landscape: row.get::<_, i32>(6)? != 0,
                updated_at: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read media cache: {}", e))
}

#[tauri::command]
pub fn get_media_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Option<MediaCacheEntry>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().unwrap();
    get_media_cache_inner(&conn, &game_id)
}

#[tauri::command]
pub fn insert_media_cache(
    state: tauri::State<'_, SqliteCoreDb>,
    entry: MediaCacheEntry,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO media_cache (game_id, provider, base_path, has_cover, has_background, has_logo, has_landscape, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(game_id) DO UPDATE SET
            provider = excluded.provider,
            base_path = excluded.base_path,
            has_cover = excluded.has_cover,
            has_background = excluded.has_background,
            has_logo = excluded.has_logo,
            has_landscape = excluded.has_landscape,
            updated_at = excluded.updated_at",
        rusqlite::params![
            entry.game_id,
            entry.provider,
            entry.base_path,
            entry.has_cover as i32,
            entry.has_background as i32,
            entry.has_logo as i32,
            entry.has_landscape as i32,
            entry.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to insert media cache: {}", e))?;
    Ok(())
}

// Used internally by other modules; kept for reuse.
pub(crate) fn read_media_cache(db: &Mutex<Connection>, game_id: &str) -> Result<Option<MediaCacheEntry>, String> {
    let conn = db.lock().unwrap();
    get_media_cache_inner(&conn, game_id)
}
