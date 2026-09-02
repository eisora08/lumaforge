use std::sync::Mutex;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameFile {
    pub game_id: String,
    pub install_dir: Option<String>,
    pub exe_path: Option<String>,
    pub exe_name: Option<String>,
    pub installed: bool,
    pub last_validated: i64,
    pub cover_path: Option<String>,
    pub cover_exists: bool,
    pub cover_size: Option<i64>,
    pub cover_modified_at: Option<i64>,
    pub landscape_path: Option<String>,
    pub landscape_exists: bool,
    pub landscape_size: Option<i64>,
    pub landscape_modified_at: Option<i64>,
    pub background_path: Option<String>,
    pub background_exists: bool,
    pub background_size: Option<i64>,
    pub background_modified_at: Option<i64>,
    pub logo_path: Option<String>,
    pub logo_exists: bool,
    pub logo_size: Option<i64>,
    pub logo_modified_at: Option<i64>,
    pub icon_path: Option<String>,
    pub icon_exists: bool,
    pub icon_size: Option<i64>,
    pub icon_modified_at: Option<i64>,
    pub depot_manifests: Option<String>,
    pub dest_dir: Option<String>,
    pub downloaded_at: Option<i64>,
    pub fingerprints: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaInfo {
    pub path: Option<String>,
    pub exists: bool,
    pub size: Option<i64>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GameFilesMedia {
    pub cover: MediaInfo,
    pub landscape: MediaInfo,
    pub background: MediaInfo,
    pub logo: MediaInfo,
    pub icon: MediaInfo,
}

// ---------------------------------------------------------------------------
// Inner functions (&Mutex<Connection>)
// ---------------------------------------------------------------------------

pub fn upsert_game_file_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    install_dir: Option<&str>,
    exe_path: Option<&str>,
    exe_name: Option<&str>,
    installed: bool,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO game_files (game_id, install_dir, exe_path, exe_name, installed, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(game_id) DO UPDATE SET
            install_dir = COALESCE(?2, install_dir),
            exe_path = COALESCE(?3, exe_path),
            exe_name = COALESCE(?4, exe_name),
            installed = ?5,
            updated_at = ?6",
        params![game_id, install_dir, exe_path, exe_name, installed as i64, now_ts()],
    )
    .map_err(|e| format!("upsert_game_file: {}", e))?;
    Ok(())
}

pub fn upsert_game_files_media_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    media: &GameFilesMedia,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO game_files (game_id, cover_path, cover_exists, cover_size, cover_modified_at,
            landscape_path, landscape_exists, landscape_size, landscape_modified_at,
            background_path, background_exists, background_size, background_modified_at,
            logo_path, logo_exists, logo_size, logo_modified_at,
            icon_path, icon_exists, icon_size, icon_modified_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
         ON CONFLICT(game_id) DO UPDATE SET
            cover_path = COALESCE(?2, cover_path), cover_exists = ?3, cover_size = ?4, cover_modified_at = ?5,
            landscape_path = COALESCE(?6, landscape_path), landscape_exists = ?7, landscape_size = ?8, landscape_modified_at = ?9,
            background_path = COALESCE(?10, background_path), background_exists = ?11, background_size = ?12, background_modified_at = ?13,
            logo_path = COALESCE(?14, logo_path), logo_exists = ?15, logo_size = ?16, logo_modified_at = ?17,
            icon_path = COALESCE(?18, icon_path), icon_exists = ?19, icon_size = ?20, icon_modified_at = ?21,
            updated_at = ?22",
        params![
            game_id,
            media.cover.path, media.cover.exists as i64, media.cover.size, media.cover.modified_at,
            media.landscape.path, media.landscape.exists as i64, media.landscape.size, media.landscape.modified_at,
            media.background.path, media.background.exists as i64, media.background.size, media.background.modified_at,
            media.logo.path, media.logo.exists as i64, media.logo.size, media.logo.modified_at,
            media.icon.path, media.icon.exists as i64, media.icon.size, media.icon.modified_at,
            now_ts(),
        ],
    )
    .map_err(|e| format!("upsert_game_files_media: {}", e))?;
    Ok(())
}

pub fn upsert_game_files_depot_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    depot_manifests: Option<&str>,
    dest_dir: Option<&str>,
    downloaded_at: Option<i64>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO game_files (game_id, depot_manifests, dest_dir, downloaded_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(game_id) DO UPDATE SET
            depot_manifests = COALESCE(?2, depot_manifests),
            dest_dir = COALESCE(?3, dest_dir),
            downloaded_at = COALESCE(?4, downloaded_at),
            updated_at = ?5",
        params![game_id, depot_manifests, dest_dir, downloaded_at, now_ts()],
    )
    .map_err(|e| format!("upsert_game_files_depot: {}", e))?;
    Ok(())
}

pub fn upsert_game_files_fingerprints_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    fingerprints: Option<&str>,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO game_files (game_id, fingerprints, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(game_id) DO UPDATE SET
            fingerprints = ?2, updated_at = ?3",
        params![game_id, fingerprints, now_ts()],
    )
    .map_err(|e| format!("upsert_game_files_fingerprints: {}", e))?;
    Ok(())
}

pub fn get_game_file_inner(db: &Mutex<Connection>, game_id: &str) -> Result<Option<GameFile>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT game_id, install_dir, exe_path, exe_name, installed, last_validated,
                cover_path, cover_exists, cover_size, cover_modified_at,
                landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                background_path, background_exists, background_size, background_modified_at,
                logo_path, logo_exists, logo_size, logo_modified_at,
                icon_path, icon_exists, icon_size, icon_modified_at,
                depot_manifests, dest_dir, downloaded_at, fingerprints, updated_at
             FROM game_files WHERE game_id = ?1",
        )
        .map_err(|e| format!("get_game_file prepare: {}", e))?;

    let row = stmt
        .query_row(params![game_id], |row| {
            Ok(GameFile {
                game_id: row.get(0)?,
                install_dir: row.get(1)?,
                exe_path: row.get(2)?,
                exe_name: row.get(3)?,
                installed: row.get::<_, i64>(4)? != 0,
                last_validated: row.get(5)?,
                cover_path: row.get(6)?,
                cover_exists: row.get::<_, i64>(7)? != 0,
                cover_size: row.get(8)?,
                cover_modified_at: row.get(9)?,
                landscape_path: row.get(10)?,
                landscape_exists: row.get::<_, i64>(11)? != 0,
                landscape_size: row.get(12)?,
                landscape_modified_at: row.get(13)?,
                background_path: row.get(14)?,
                background_exists: row.get::<_, i64>(15)? != 0,
                background_size: row.get(16)?,
                background_modified_at: row.get(17)?,
                logo_path: row.get(18)?,
                logo_exists: row.get::<_, i64>(19)? != 0,
                logo_size: row.get(20)?,
                logo_modified_at: row.get(21)?,
                icon_path: row.get(22)?,
                icon_exists: row.get::<_, i64>(23)? != 0,
                icon_size: row.get(24)?,
                icon_modified_at: row.get(25)?,
                depot_manifests: row.get(26)?,
                dest_dir: row.get(27)?,
                downloaded_at: row.get(28)?,
                fingerprints: row.get(29)?,
                updated_at: row.get(30)?,
            })
        })
        .ok();

    Ok(row)
}

pub fn get_game_files_media_inner(db: &Mutex<Connection>, game_id: &str) -> Result<Option<GameFilesMedia>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT cover_path, cover_exists, cover_size, cover_modified_at,
                landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                background_path, background_exists, background_size, background_modified_at,
                logo_path, logo_exists, logo_size, logo_modified_at,
                icon_path, icon_exists, icon_size, icon_modified_at
             FROM game_files WHERE game_id = ?1",
        )
        .map_err(|e| format!("get_game_files_media prepare: {}", e))?;

    let row = stmt
        .query_row(params![game_id], |row| {
            Ok(GameFilesMedia {
                cover: MediaInfo {
                    path: row.get(0)?,
                    exists: row.get::<_, i64>(1)? != 0,
                    size: row.get(2)?,
                    modified_at: row.get(3)?,
                },
                landscape: MediaInfo {
                    path: row.get(4)?,
                    exists: row.get::<_, i64>(5)? != 0,
                    size: row.get(6)?,
                    modified_at: row.get(7)?,
                },
                background: MediaInfo {
                    path: row.get(8)?,
                    exists: row.get::<_, i64>(9)? != 0,
                    size: row.get(10)?,
                    modified_at: row.get(11)?,
                },
                logo: MediaInfo {
                    path: row.get(12)?,
                    exists: row.get::<_, i64>(13)? != 0,
                    size: row.get(14)?,
                    modified_at: row.get(15)?,
                },
                icon: MediaInfo {
                    path: row.get(16)?,
                    exists: row.get::<_, i64>(17)? != 0,
                    size: row.get(18)?,
                    modified_at: row.get(19)?,
                },
            })
        })
        .ok();

    Ok(row)
}

pub fn delete_game_file_inner(db: &Mutex<Connection>, game_id: &str) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM game_files WHERE game_id = ?1", params![game_id])
        .map_err(|e| format!("delete_game_file: {}", e))?;
    Ok(())
}

pub fn get_installed_game_files_inner(db: &Mutex<Connection>) -> Result<Vec<GameFile>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT game_id, install_dir, exe_path, exe_name, installed, last_validated,
                cover_path, cover_exists, cover_size, cover_modified_at,
                landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                background_path, background_exists, background_size, background_modified_at,
                logo_path, logo_exists, logo_size, logo_modified_at,
                icon_path, icon_exists, icon_size, icon_modified_at,
                depot_manifests, dest_dir, downloaded_at, fingerprints, updated_at
             FROM game_files WHERE installed = 1",
        )
        .map_err(|e| format!("get_installed_game_files prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(GameFile {
                game_id: row.get(0)?,
                install_dir: row.get(1)?,
                exe_path: row.get(2)?,
                exe_name: row.get(3)?,
                installed: row.get::<_, i64>(4)? != 0,
                last_validated: row.get(5)?,
                cover_path: row.get(6)?,
                cover_exists: row.get::<_, i64>(7)? != 0,
                cover_size: row.get(8)?,
                cover_modified_at: row.get(9)?,
                landscape_path: row.get(10)?,
                landscape_exists: row.get::<_, i64>(11)? != 0,
                landscape_size: row.get(12)?,
                landscape_modified_at: row.get(13)?,
                background_path: row.get(14)?,
                background_exists: row.get::<_, i64>(15)? != 0,
                background_size: row.get(16)?,
                background_modified_at: row.get(17)?,
                logo_path: row.get(18)?,
                logo_exists: row.get::<_, i64>(19)? != 0,
                logo_size: row.get(20)?,
                logo_modified_at: row.get(21)?,
                icon_path: row.get(22)?,
                icon_exists: row.get::<_, i64>(23)? != 0,
                icon_size: row.get(24)?,
                icon_modified_at: row.get(25)?,
                depot_manifests: row.get(26)?,
                dest_dir: row.get(27)?,
                downloaded_at: row.get(28)?,
                fingerprints: row.get(29)?,
                updated_at: row.get(30)?,
            })
        })
        .map_err(|e| format!("get_installed_game_files query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ============================================
// TAURI COMMANDS
// ============================================

#[tauri::command]
pub fn upsert_game_file_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
    install_dir: Option<String>,
    exe_path: Option<String>,
    exe_name: Option<String>,
    installed: bool,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    upsert_game_file_inner(
        db,
        &game_id,
        install_dir.as_deref(),
        exe_path.as_deref(),
        exe_name.as_deref(),
        installed,
    )
}

#[tauri::command]
pub fn upsert_game_files_media_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
    media: GameFilesMedia,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    upsert_game_files_media_inner(db, &game_id, &media)
}

#[tauri::command]
pub fn upsert_game_files_depot_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
    depot_manifests: Option<String>,
    dest_dir: Option<String>,
    downloaded_at: Option<i64>,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    upsert_game_files_depot_inner(
        db,
        &game_id,
        depot_manifests.as_deref(),
        dest_dir.as_deref(),
        downloaded_at,
    )
}

#[tauri::command]
pub fn upsert_game_files_fingerprints_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
    fingerprints: Option<String>,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    upsert_game_files_fingerprints_inner(db, &game_id, fingerprints.as_deref())
}

#[tauri::command]
pub fn get_game_file_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Option<GameFile>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(None);
    };
    get_game_file_inner(db, &game_id)
}

#[tauri::command]
pub fn get_game_files_media_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Option<GameFilesMedia>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(None);
    };
    get_game_files_media_inner(db, &game_id)
}

#[tauri::command]
pub fn delete_game_file_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    delete_game_file_inner(db, &game_id)
}

#[tauri::command]
pub fn get_installed_game_files_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<GameFile>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(Vec::new());
    };
    get_installed_game_files_inner(db)
}
