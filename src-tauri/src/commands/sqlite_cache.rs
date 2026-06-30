use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// State: lazily initialized SQLite connection
// ---------------------------------------------------------------------------

pub struct SqliteDb(pub Option<Mutex<Connection>>);

fn get_db_path(app_handle: &AppHandle) -> PathBuf {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let cache_dir = app_dir.join("cache");
    fs::create_dir_all(&cache_dir).ok();
    cache_dir.join("cache.db")
}

fn init_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS media_cache (
            game_id         TEXT PRIMARY KEY,
            provider        TEXT NOT NULL DEFAULT '',
            base_path       TEXT NOT NULL DEFAULT '',
            has_cover       INTEGER NOT NULL DEFAULT 0,
            has_background  INTEGER NOT NULL DEFAULT 0,
            has_logo        INTEGER NOT NULL DEFAULT 0,
            has_landscape   INTEGER NOT NULL DEFAULT 0,
            updated_at      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS metadata_cache (
            game_id      TEXT PRIMARY KEY,
            title        TEXT,
            provider     TEXT NOT NULL DEFAULT '',
            installed    INTEGER NOT NULL DEFAULT 0,
            last_played  INTEGER NOT NULL DEFAULT 0,
            playtime     INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create tables: {}", e))
}

// ---------------------------------------------------------------------------
// Initialize the SQLite database. Called from setup().
// If anything fails, the state is set to None and all queries fall back.
// ---------------------------------------------------------------------------

pub fn initialize_sqlite(app_handle: &AppHandle) -> SqliteDb {
    let db_path = get_db_path(app_handle);

    match Connection::open(&db_path) {
        Ok(conn) => {
            if let Err(e) = init_tables(&conn) {
                eprintln!("[SqliteCache] table init failed: {}", e);
                return SqliteDb(None);
            }
            println!(
                "[SqliteCache] database ready at {:?}",
                db_path
            );
            SqliteDb(Some(Mutex::new(conn)))
        }
        Err(e) => {
            eprintln!("[SqliteCache] failed to open database: {}", e);
            SqliteDb(None)
        }
    }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCacheEntry {
    pub game_id: String,
    pub title: Option<String>,
    pub provider: String,
    pub installed: bool,
    pub last_played: i64,
    pub playtime: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_media_cache(
    game_id: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Option<MediaCacheEntry>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(None),
    };

    let mut stmt = guard
        .prepare(
            "SELECT game_id, provider, base_path, has_cover, has_background, has_logo, has_landscape, updated_at FROM media_cache WHERE game_id = ?1",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let result = stmt
        .query_row([&game_id], |row| {
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
        })
        .ok();

    Ok(result)
}

#[tauri::command]
pub fn check_sqlite_health(db: tauri::State<'_, SqliteDb>) -> Result<bool, String> {
    Ok(db.0.is_some())
}

#[tauri::command]
pub fn get_metadata_cache(
    game_id: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Option<MetadataCacheEntry>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(None),
    };

    let mut stmt = guard
        .prepare(
            "SELECT game_id, title, provider, installed, last_played, playtime, updated_at FROM metadata_cache WHERE game_id = ?1",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let result = stmt
        .query_row([&game_id], |row| {
            Ok(MetadataCacheEntry {
                game_id: row.get(0)?,
                title: row.get(1)?,
                provider: row.get(2)?,
                installed: row.get::<_, i32>(3)? != 0,
                last_played: row.get(4)?,
                playtime: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .ok();

    Ok(result)
}

// ---------------------------------------------------------------------------
// Write commands (write-through caching)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn insert_media_cache(
    entry: MediaCacheEntry,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };

    guard
        .execute(
            "INSERT OR REPLACE INTO media_cache (game_id, provider, base_path, has_cover, has_background, has_logo, has_landscape, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
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
        .map_err(|e| format!("Insert error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn insert_metadata_cache(
    entry: MetadataCacheEntry,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };

    guard
        .execute(
            "INSERT OR REPLACE INTO metadata_cache (game_id, title, provider, installed, last_played, playtime, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                entry.game_id,
                entry.title,
                entry.provider,
                entry.installed as i32,
                entry.last_played,
                entry.playtime,
                entry.updated_at,
            ],
        )
        .map_err(|e| format!("Insert error: {}", e))?;

    Ok(())
}
