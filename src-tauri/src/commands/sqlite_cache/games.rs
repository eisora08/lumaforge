use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::{ENABLE_VERBOSE_SQLITE_LOGS, SqliteCoreDb};

// ---------------------------------------------------------------------------
// Games table — full Steam dataset (Phase 3)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameEntry {
    pub app_id: String,
    pub title: String,
    pub installed: bool,
    pub playtime: i64,
    pub last_played: i64,
    pub metadata_json: String,
    pub updated_at: i64,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub media_json: Option<String>,
}

pub fn upsert_game_inner(db: &Mutex<Connection>, game: &GameEntry) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO games (appId, title, installed, playtime, lastPlayed, metadata_json, updated_at, provider, media_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(appId) DO UPDATE SET
            title = excluded.title,
            installed = excluded.installed,
            playtime = excluded.playtime,
            lastPlayed = excluded.lastPlayed,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at,
            provider = COALESCE(excluded.provider, games.provider),
            media_json = COALESCE(excluded.media_json, games.media_json)",
        rusqlite::params![
            game.app_id,
            game.title,
            game.installed as i32,
            game.playtime,
            game.last_played,
            game.metadata_json,
            game.updated_at,
            game.provider.as_deref().unwrap_or("steam"),
            game.media_json.as_deref().unwrap_or("{}"),
        ],
    )
    .map_err(|e| format!("Failed to upsert game: {}", e))?;
    Ok(())
}

pub fn batch_upsert_games_inner(db: &Mutex<Connection>, games: &[GameEntry]) -> Result<(), String> {
    if games.is_empty() {
        return Ok(());
    }
    let conn = db.lock().unwrap();
    for game in games {
        conn.execute(
            "INSERT INTO games (appId, title, installed, playtime, lastPlayed, metadata_json, updated_at, provider, media_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(appId) DO UPDATE SET
                title = excluded.title,
                installed = excluded.installed,
                playtime = excluded.playtime,
                lastPlayed = excluded.lastPlayed,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at,
                provider = COALESCE(excluded.provider, games.provider),
                media_json = COALESCE(excluded.media_json, games.media_json)",
            rusqlite::params![
                game.app_id,
                game.title,
                game.installed as i32,
                game.playtime,
                game.last_played,
                game.metadata_json,
                game.updated_at,
                game.provider.as_deref().unwrap_or("steam"),
                game.media_json.as_deref().unwrap_or("{}"),
            ],
        )
        .map_err(|e| format!("Failed to batch upsert game {}: {}", game.app_id, e))?;
    }
    Ok(())
}

pub fn read_all_games_inner(db: &Mutex<Connection>) -> Result<Vec<GameEntry>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT appId, title, installed, playtime, lastPlayed, metadata_json, updated_at, provider, media_json
             FROM games ORDER BY title ASC",
        )
        .map_err(|e| format!("Failed to prepare read_all_games: {}", e))?;
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
                provider: row.get(7)?,
                media_json: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to query all games: {}", e))?;
    let mut games = Vec::new();
    for row in rows {
        games.push(row.map_err(|e| format!("Failed to map game row: {}", e))?);
    }
    Ok(games)
}

pub fn update_game_metadata_json_inner(
    db: &Mutex<Connection>,
    app_id: &str,
    metadata_json: &str,
) -> Result<(), String> {
    if ENABLE_VERBOSE_SQLITE_LOGS {
        println!("[SqliteCache] update_game_metadata_json appId={}", app_id);
    }
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE games SET metadata_json = ?1, updated_at = ?2 WHERE appId = ?3",
        rusqlite::params![metadata_json, 0, app_id],
    )
    .map_err(|e| format!("Failed to update game metadata_json: {}", e))?;
    Ok(())
}

pub fn get_game_count_inner(db: &Mutex<Connection>) -> Result<i64, String> {
    let conn = db.lock().unwrap();
    conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("Failed to count games: {}", e))
}

#[tauri::command]
pub fn upsert_game(state: tauri::State<'_, SqliteCoreDb>, game: GameEntry) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_game_inner(db, &game)
}

#[tauri::command]
pub fn batch_upsert_games(
    state: tauri::State<'_, SqliteCoreDb>,
    games: Vec<GameEntry>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    batch_upsert_games_inner(db, &games)
}

#[tauri::command]
pub fn read_all_games(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<GameEntry>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    read_all_games_inner(db)
}

#[tauri::command]
pub fn update_game_metadata_json(
    state: tauri::State<'_, SqliteCoreDb>,
    app_id: String,
    metadata_json: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    update_game_metadata_json_inner(db, &app_id, &metadata_json)
}

#[tauri::command]
pub fn get_game_count(state: tauri::State<'_, SqliteCoreDb>) -> Result<i64, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(0);
    };
    get_game_count_inner(db)
}

#[tauri::command]
pub fn sqlite_get_game(
    state: tauri::State<'_, SqliteCoreDb>,
    app_id: String,
) -> Result<Option<GameEntry>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT appId, title, installed, playtime, lastPlayed, metadata_json, updated_at, provider, media_json
         FROM games WHERE appId = ?1",
        [&app_id],
        |row| {
            Ok(GameEntry {
                app_id: row.get(0)?,
                title: row.get(1)?,
                installed: row.get::<_, i32>(2)? != 0,
                playtime: row.get(3)?,
                last_played: row.get(4)?,
                metadata_json: row.get(5)?,
                updated_at: row.get(6)?,
                provider: row.get(7)?,
                media_json: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read game: {}", e))
}
