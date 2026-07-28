use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Debug flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_SQLITE_LOGS: bool = false;

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
    .map_err(|e| format!("Failed to create tables: {}", e))?;

    // Migration: add executable columns to metadata_cache (safe to re-run)
    for sql in &[
        "ALTER TABLE metadata_cache ADD COLUMN exe_path TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE metadata_cache ADD COLUMN exe_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE metadata_cache ADD COLUMN install_dir TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = conn.execute(sql, []);
    }

    // Library cache table — stores enriched game list as JSON blob for instant startup
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS library_cache (
            cache_key   TEXT PRIMARY KEY,
            cache_value TEXT NOT NULL,
            saved_at    INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Failed to create library_cache table: {}", e))?;

    // Games table — full Steam dataset (Phase 3)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS games (
            appId        TEXT PRIMARY KEY,
            title        TEXT NOT NULL DEFAULT '',
            installed    INTEGER NOT NULL DEFAULT 0,
            playtime     INTEGER NOT NULL DEFAULT 0,
            lastPlayed   INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            updated_at   INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Failed to create games table: {}", e))?;

    // Store catalog tables — versioned Steam catalog index for Discover/View All
    if let Err(e) = super::store_catalog::create_catalog_tables(conn) {
        eprintln!("[SqliteCache] catalog table init failed (non-fatal): {}", e);
    }

    Ok(())
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
    #[serde(default)]
    pub exe_path: String,
    #[serde(default)]
    pub exe_name: String,
    #[serde(default)]
    pub install_dir: String,
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
            "SELECT game_id, title, provider, installed, last_played, playtime, updated_at, exe_path, exe_name, install_dir FROM metadata_cache WHERE game_id = ?1",
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
                exe_path: row.get(7)?,
                exe_name: row.get(8)?,
                install_dir: row.get(9)?,
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
            "INSERT OR REPLACE INTO metadata_cache (game_id, title, provider, installed, last_played, playtime, updated_at, exe_path, exe_name, install_dir) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                entry.game_id,
                entry.title,
                entry.provider,
                entry.installed as i32,
                entry.last_played,
                entry.playtime,
                entry.updated_at,
                entry.exe_path,
                entry.exe_name,
                entry.install_dir,
            ],
        )
        .map_err(|e| format!("Insert error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Library cache — stores enriched game list as JSON blob for instant startup
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_library_cache(
    key: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Option<String>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(None),
    };

    let mut stmt = guard
        .prepare("SELECT cache_value FROM library_cache WHERE cache_key = ?1")
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let result = stmt.query_row([&key], |row| row.get::<_, String>(0)).ok();
    Ok(result)
}

#[tauri::command]
pub fn write_library_cache(
    key: String,
    value: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    guard
        .execute(
            "INSERT OR REPLACE INTO library_cache (cache_key, cache_value, saved_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, value, now],
        )
        .map_err(|e| format!("Insert error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_library_cache(
    key: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };

    guard
        .execute("DELETE FROM library_cache WHERE cache_key = ?1", [&key])
        .map_err(|e| format!("Delete error: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Games table — full Steam dataset (Phase 3)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEntry {
    pub app_id: String,
    pub title: String,
    pub installed: bool,
    pub playtime: i64,
    pub last_played: i64,
    pub metadata_json: String,
    pub updated_at: i64,
}

#[tauri::command]
pub fn upsert_game(
    entry: GameEntry,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };

    guard
        .execute(
            "INSERT OR REPLACE INTO games (appId, title, installed, playtime, lastPlayed, metadata_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                entry.app_id,
                entry.title,
                entry.installed as i32,
                entry.playtime,
                entry.last_played,
                entry.metadata_json,
                entry.updated_at,
            ],
        )
        .map_err(|e| format!("Upsert game error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn batch_upsert_games(
    entries: Vec<GameEntry>,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };

    for entry in &entries {
        guard
            .execute(
                "INSERT OR REPLACE INTO games (appId, title, installed, playtime, lastPlayed, metadata_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    entry.app_id,
                    entry.title,
                    entry.installed as i32,
                    entry.playtime,
                    entry.last_played,
                    entry.metadata_json,
                    entry.updated_at,
                ],
            )
            .map_err(|e| format!("Batch upsert game error: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn read_all_games(
    db: tauri::State<'_, SqliteDb>,
) -> Result<Vec<GameEntry>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };

    let mut stmt = guard
        .prepare("SELECT appId, title, installed, playtime, lastPlayed, metadata_json, updated_at FROM games ORDER BY title ASC")
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(GameEntry {
                app_id: row.get(0)?,
                title: row.get(1)?,
                installed: row.get::<_, i32>(2)? != 0,
                playtime: row.get(3)?,
                last_played: row.get(4)?,
                metadata_json: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut games = Vec::new();
    for row in rows {
        games.push(row.map_err(|e| format!("Row error: {}", e))?);
    }

    Ok(games)
}

#[tauri::command]
pub fn update_game_metadata_json(
    app_id: String,
    metadata_json: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<(), String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(()),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    guard
        .execute(
            "UPDATE games SET metadata_json = ?1, updated_at = ?2 WHERE appId = ?3",
            rusqlite::params![metadata_json, now, app_id],
        )
        .map_err(|e| format!("Update metadata_json error: {}", e))?;
    if ENABLE_VERBOSE_SQLITE_LOGS {
        println!("[SQLite] metadata_json updated for appId={}", app_id);
    }
    Ok(())
}

#[tauri::command]
pub fn get_game_count(
    db: tauri::State<'_, SqliteDb>,
) -> Result<i64, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(0),
    };

    let count: i64 = guard
        .query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))
        .map_err(|e| format!("Count error: {}", e))?;

    Ok(count)
}
