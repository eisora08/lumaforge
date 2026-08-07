use serde_json;

use super::SqliteCoreDb;
use crate::models::game_cache::{GameAppInfo, GameMediaPaths, GameMediaSources, GameRemoteRefs};

// ---------------------------------------------------------------------------
// GameAppInfo — SQLite backing for the per-game appinfo.json files.
// Stored as JSON blobs in the `games` table alongside the base columns.
// ---------------------------------------------------------------------------

/// Read GameAppInfo from the `games` table. Returns None if the row doesn't
/// exist or if the JSON is corrupt.
pub fn read_game_appinfo(db: &SqliteCoreDb, app_id: &str) -> Option<GameAppInfo> {
    let conn_ref = db.0.as_ref()?;
    let conn = conn_ref.lock().unwrap();

    let row = conn
        .query_row(
            "SELECT title, provider, media_json, media_sources_json, remote_json, user_data_json, updated_at \
             FROM games WHERE appId = ?1",
            [app_id],
            |row| {
                Ok(GameAppInfoRow {
                    title: row.get(0)?,
                    provider: row.get(1)?,
                    media_json: row.get(2)?,
                    media_sources_json: row.get(3)?,
                    remote_json: row.get(4)?,
                    user_data_json: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .ok()?;

    Some(row_to_appinfo(app_id, row))
}

struct GameAppInfoRow {
    title: String,
    provider: String,
    media_json: String,
    media_sources_json: String,
    remote_json: String,
    user_data_json: Option<String>,
    updated_at: Option<i64>,
}

fn row_to_appinfo(app_id: &str, row: GameAppInfoRow) -> GameAppInfo {
    GameAppInfo {
        app_id: app_id.to_string(),
        provider: row.provider,
        name: if row.title.is_empty() { None } else { Some(row.title) },
        updated_at: row.updated_at.map(|v| v as u64),
        media: serde_json::from_str(&row.media_json).ok().flatten(),
        media_sources: serde_json::from_str(&row.media_sources_json).ok().flatten(),
        remote: serde_json::from_str(&row.remote_json).ok().flatten(),
        user_data: row
            .user_data_json
            .and_then(|j| serde_json::from_str(&j).ok()),
    }
}

/// Read multiple GameAppInfo entries in a single query.
pub fn read_batch_appinfo(
    db: &SqliteCoreDb,
    app_ids: &[String],
) -> std::collections::HashMap<String, GameAppInfo> {
    let conn_ref = match db.0.as_ref() {
        Some(db) => db,
        None => return std::collections::HashMap::new(),
    };
    let conn = conn_ref.lock().unwrap();
    let mut result = std::collections::HashMap::new();

    // SQLite supports up to 999 bound parameters; chunk at 500 for safety.
    for chunk in app_ids.chunks(500) {
        let placeholders: Vec<String> = chunk.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT appId, title, provider, media_json, media_sources_json, remote_json, user_data_json, updated_at \
             FROM games WHERE appId IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let params: Vec<&dyn rusqlite::types::ToSql> =
            chunk.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();

        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                GameAppInfoRow {
                    title: row.get(1)?,
                    provider: row.get(2)?,
                    media_json: row.get(3)?,
                    media_sources_json: row.get(4)?,
                    remote_json: row.get(5)?,
                    user_data_json: row.get(6)?,
                    updated_at: row.get(7)?,
                },
            ))
        });

        if let Ok(rows) = rows {
            for row_result in rows.flatten() {
                let (app_id, info_row) = row_result;
                result.insert(app_id.clone(), row_to_appinfo(&app_id, info_row));
            }
        }
    }

    result
}

/// Write a full GameAppInfo to the `games` table. Preserves existing base
/// columns (installed, playtime, lastPlayed) via UPDATE.
pub fn write_game_appinfo(
    db: &SqliteCoreDb,
    app_id: &str,
    info: &GameAppInfo,
) -> Result<(), String> {
    let conn_ref = db.0.as_ref().ok_or("Database not available")?;
    let conn = conn_ref.lock().map_err(|e| format!("Lock error: {}", e))?;

    let media_json = serde_json::to_string(&info.media)
        .map_err(|e| format!("Serialize media: {}", e))?;
    let media_sources_json = serde_json::to_string(&info.media_sources)
        .map_err(|e| format!("Serialize media_sources: {}", e))?;
    let remote_json = serde_json::to_string(&info.remote)
        .map_err(|e| format!("Serialize remote: {}", e))?;
    let user_data_json = info.user_data.as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    // INSERT OR IGNORE + UPDATE: create the row if it doesn't exist, then update
    // the appinfo columns. Base columns (installed, playtime, etc.) are preserved.
    conn.execute(
        "INSERT OR IGNORE INTO games (appId, title, provider, media_json, media_sources_json, remote_json, user_data_json, updated_at, installed, playtime, lastPlayed) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, 0)",
        rusqlite::params![
            app_id,
            info.name.as_deref().unwrap_or(""),
            info.provider,
            media_json,
            media_sources_json,
            remote_json,
            user_data_json,
            info.updated_at.map(|v| v as i64).unwrap_or(0),
        ],
    )
    .map_err(|e| format!("INSERT games: {}", e))?;

    conn.execute(
        "UPDATE games SET title = ?1, provider = ?2, media_json = ?3, media_sources_json = ?4, remote_json = ?5, user_data_json = ?6, updated_at = ?7 \
         WHERE appId = ?8",
        rusqlite::params![
            info.name.as_deref().unwrap_or(""),
            info.provider,
            media_json,
            media_sources_json,
            remote_json,
            user_data_json,
            info.updated_at.map(|v| v as i64).unwrap_or(0),
            app_id,
        ],
    )
    .map_err(|e| format!("UPDATE games: {}", e))?;

    Ok(())
}

/// Merge incoming media/remote/sources into an existing (or new) GameAppInfo
/// entry in SQLite. Returns the merged entry for further processing.
pub fn merge_and_write_appinfo(
    db: &SqliteCoreDb,
    app_id: &str,
    name: Option<&str>,
    media: &GameMediaPaths,
    remote: Option<&GameRemoteRefs>,
    media_sources: Option<&GameMediaSources>,
) -> Result<GameAppInfo, String> {
    // Read existing or create new
    let mut entry = read_game_appinfo(db, app_id).unwrap_or_else(|| GameAppInfo {
        app_id: app_id.to_string(),
        provider: "steam".to_string(),
        name: None,
        updated_at: None,
        media: None,
        media_sources: None,
        remote: None,
        user_data: None,
    });

    // Name priority: existing > incoming > unchanged
    if entry.name.is_none() {
        if let Some(n) = name {
            entry.name = Some(n.to_string());
        }
    }

    // Merge media: incoming non-null overrides existing null
    let existing_media = entry.media.as_ref();
    entry.media = Some(GameMediaPaths {
        cover_path: media.cover_path.clone()
            .or_else(|| existing_media.and_then(|m| m.cover_path.clone())),
        landscape_path: media.landscape_path.clone()
            .or_else(|| existing_media.and_then(|m| m.landscape_path.clone())),
        background_path: media.background_path.clone()
            .or_else(|| existing_media.and_then(|m| m.background_path.clone())),
        logo_path: media.logo_path.clone()
            .or_else(|| existing_media.and_then(|m| m.logo_path.clone())),
        icon_path: media.icon_path.clone()
            .or_else(|| existing_media.and_then(|m| m.icon_path.clone())),
    });

    if let Some(r) = remote {
        entry.remote = Some(r.clone());
    }

    if let Some(sources) = media_sources {
        let existing = entry.media_sources.as_ref();
        entry.media_sources = Some(GameMediaSources {
            landscape: sources.landscape.clone()
                .or_else(|| existing.and_then(|m| m.landscape.clone())),
            cover: sources.cover.clone()
                .or_else(|| existing.and_then(|m| m.cover.clone())),
            background: sources.background.clone()
                .or_else(|| existing.and_then(|m| m.background.clone())),
            logo: sources.logo.clone()
                .or_else(|| existing.and_then(|m| m.logo.clone())),
            icon: sources.icon.clone()
                .or_else(|| existing.and_then(|m| m.icon.clone())),
        });
    }

    entry.updated_at = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );

    write_game_appinfo(db, app_id, &entry)?;
    Ok(entry)
}

/// Upsert basic game fields (used by boot scan, does NOT overwrite media).
pub fn upsert_game_base(
    db: &SqliteCoreDb,
    app_id: &str,
    title: &str,
    installed: bool,
    playtime: i64,
    last_played: i64,
    metadata_json: &str,
) -> Result<(), String> {
    let conn_ref = db.0.as_ref().ok_or("Database not available")?;
    let conn = conn_ref.lock().map_err(|e| format!("Lock error: {}", e))?;

    conn.execute(
        "INSERT INTO games (appId, title, installed, playtime, lastPlayed, metadata_json, updated_at, provider) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'steam') \
         ON CONFLICT(appId) DO UPDATE SET \
           title = excluded.title, \
           installed = excluded.installed, \
           playtime = excluded.playtime, \
           lastPlayed = excluded.lastPlayed, \
           metadata_json = excluded.metadata_json, \
           updated_at = excluded.updated_at",
        rusqlite::params![
            app_id,
            title,
            installed as i32,
            playtime,
            last_played,
            metadata_json,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64,
        ],
    )
    .map_err(|e| format!("Upsert game: {}", e))?;

    Ok(())
}
