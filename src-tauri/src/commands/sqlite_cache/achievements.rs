use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteAchievementsDb;

// ---------------------------------------------------------------------------
// Achievement tables — new schema with FK to games_v2 (v9+)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementSummary {
    pub game_id: String,
    pub platform: String,
    pub source: String,
    pub unlocked: i64,
    pub total: i64,
    pub in_progress: i64,
    pub completion_time: Option<i64>,
    pub last_unlock_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Achievement {
    pub id: String,
    pub game_id: String,
    pub platform: String,
    pub api_name: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub icon_gray: Option<String>,
    pub hidden: bool,
    pub global_pct: Option<f64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementProgress {
    pub id: String,
    pub game_id: String,
    pub platform: String,
    pub api_name: String,
    pub unlocked: bool,
    pub unlock_time: Option<i64>,
    pub unlocked_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementPercentages {
    pub game_id: String,
    pub entries: String, // JSON array [{name, percent}]
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// CRUD — AchievementSummary
// ---------------------------------------------------------------------------

pub fn upsert_achievement_summary_inner(
    db: &Mutex<Connection>,
    row: &AchievementSummary,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievement_summaries (game_id, platform, source, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(game_id) DO UPDATE SET
            platform = excluded.platform,
            source = CASE
                WHEN excluded.source = 'binary-stats' THEN excluded.source
                WHEN excluded.source = 'crack' THEN excluded.source
                ELSE achievement_summaries.source
            END,
            unlocked = excluded.unlocked,
            total = excluded.total,
            in_progress = excluded.in_progress,
            completion_time = excluded.completion_time,
            last_unlock_at = excluded.last_unlock_at,
            updated_at = excluded.updated_at",
        rusqlite::params![
            row.game_id,
            row.platform,
            row.source,
            row.unlocked,
            row.total,
            row.in_progress,
            row.completion_time,
            row.last_unlock_at,
            row.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert achievement summary: {}", e))?;
    Ok(())
}

pub fn get_achievement_summary_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<Option<AchievementSummary>, String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT game_id, platform, source, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at
         FROM achievement_summaries WHERE game_id = ?1",
        [game_id],
        |row| {
            Ok(AchievementSummary {
                game_id: row.get(0)?,
                platform: row.get(1)?,
                source: row.get(2)?,
                unlocked: row.get(3)?,
                total: row.get(4)?,
                in_progress: row.get(5)?,
                completion_time: row.get(6)?,
                last_unlock_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to get achievement summary: {}", e))
}

pub fn get_all_achievement_summaries_inner(
    db: &Mutex<Connection>,
) -> Result<Vec<AchievementSummary>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT game_id, platform, source, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at
             FROM achievement_summaries ORDER BY last_unlock_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AchievementSummary {
                game_id: row.get(0)?,
                platform: row.get(1)?,
                source: row.get(2)?,
                unlocked: row.get(3)?,
                total: row.get(4)?,
                in_progress: row.get(5)?,
                completion_time: row.get(6)?,
                last_unlock_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to query summaries: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(summary) = row {
            results.push(summary);
        }
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// CRUD — Achievement
// ---------------------------------------------------------------------------

pub fn upsert_achievement_inner(
    db: &Mutex<Connection>,
    achievement: &Achievement,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievements (id, game_id, platform, api_name, name, description, icon_url, icon_gray, hidden, global_pct, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(game_id, platform, api_name) DO UPDATE SET
            name = COALESCE(excluded.name, achievements.name),
            description = COALESCE(excluded.description, achievements.description),
            icon_url = COALESCE(excluded.icon_url, achievements.icon_url),
            icon_gray = COALESCE(excluded.icon_gray, achievements.icon_gray),
            hidden = excluded.hidden,
            global_pct = COALESCE(excluded.global_pct, achievements.global_pct),
            updated_at = excluded.updated_at",
        rusqlite::params![
            achievement.id,
            achievement.game_id,
            achievement.platform,
            achievement.api_name,
            achievement.name,
            achievement.description,
            achievement.icon_url,
            achievement.icon_gray,
            achievement.hidden as i32,
            achievement.global_pct,
            achievement.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert achievement: {}", e))?;
    Ok(())
}

pub fn batch_upsert_achievements_inner(
    db: &Mutex<Connection>,
    achievements: &[Achievement],
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    for achievement in achievements {
        tx.execute(
            "INSERT INTO achievements (id, game_id, platform, api_name, name, description, icon_url, icon_gray, hidden, global_pct, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(game_id, platform, api_name) DO UPDATE SET
                name = COALESCE(excluded.name, achievements.name),
                description = COALESCE(excluded.description, achievements.description),
                icon_url = COALESCE(excluded.icon_url, achievements.icon_url),
                icon_gray = COALESCE(excluded.icon_gray, achievements.icon_gray),
                hidden = excluded.hidden,
                global_pct = COALESCE(excluded.global_pct, achievements.global_pct),
                updated_at = excluded.updated_at",
            rusqlite::params![
                achievement.id,
                achievement.game_id,
                achievement.platform,
                achievement.api_name,
                achievement.name,
                achievement.description,
                achievement.icon_url,
                achievement.icon_gray,
                achievement.hidden as i32,
                achievement.global_pct,
                achievement.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to batch upsert achievement {}: {}", achievement.id, e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    Ok(())
}

pub fn get_achievements_for_game_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<Vec<Achievement>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, platform, api_name, name, description, icon_url, icon_gray, hidden, global_pct, updated_at
             FROM achievements WHERE game_id = ?1 ORDER BY api_name",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([game_id], |row| {
            Ok(Achievement {
                id: row.get(0)?,
                game_id: row.get(1)?,
                platform: row.get(2)?,
                api_name: row.get(3)?,
                name: row.get(4)?,
                description: row.get(5)?,
                icon_url: row.get(6)?,
                icon_gray: row.get(7)?,
                hidden: row.get::<_, i32>(8)? != 0,
                global_pct: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to query achievements: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(achievement) = row {
            results.push(achievement);
        }
    }
    Ok(results)
}

pub fn delete_achievements_for_game_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    // Cascading delete via FK — but also delete from achievement_progress
    conn.execute("DELETE FROM achievements WHERE game_id = ?1", [game_id])
        .map_err(|e| format!("Failed to delete achievements: {}", e))?;
    conn.execute("DELETE FROM achievement_progress WHERE game_id = ?1", [game_id])
        .map_err(|e| format!("Failed to delete achievement progress: {}", e))?;
    conn.execute("DELETE FROM achievement_summaries WHERE game_id = ?1", [game_id])
        .map_err(|e| format!("Failed to delete achievement summary: {}", e))?;
    conn.execute("DELETE FROM achievement_percentages WHERE game_id = ?1", [game_id])
        .map_err(|e| format!("Failed to delete achievement percentages: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// CRUD — AchievementProgress
// ---------------------------------------------------------------------------

pub fn upsert_achievement_progress_inner(
    db: &Mutex<Connection>,
    progress: &AchievementProgress,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievement_progress (id, game_id, platform, api_name, unlocked, unlock_time, unlocked_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(game_id, platform, api_name) DO UPDATE SET
            unlocked = excluded.unlocked,
            unlock_time = excluded.unlock_time,
            unlocked_at = excluded.unlocked_at,
            updated_at = excluded.updated_at",
        rusqlite::params![
            progress.id,
            progress.game_id,
            progress.platform,
            progress.api_name,
            progress.unlocked as i32,
            progress.unlock_time,
            progress.unlocked_at,
            progress.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert achievement progress: {}", e))?;
    Ok(())
}

pub fn get_achievement_progress_for_game_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<Vec<AchievementProgress>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, game_id, platform, api_name, unlocked, unlock_time, unlocked_at, updated_at
             FROM achievement_progress WHERE game_id = ?1 ORDER BY api_name",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([game_id], |row| {
            Ok(AchievementProgress {
                id: row.get(0)?,
                game_id: row.get(1)?,
                platform: row.get(2)?,
                api_name: row.get(3)?,
                unlocked: row.get::<_, i32>(4)? != 0,
                unlock_time: row.get(5)?,
                unlocked_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query achievement progress: {}", e))?;

    let mut results = Vec::new();
    for row in rows {
        if let Ok(progress) = row {
            results.push(progress);
        }
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// CRUD — AchievementPercentages
// ---------------------------------------------------------------------------

pub fn upsert_achievement_percentages_inner(
    db: &Mutex<Connection>,
    percentages: &AchievementPercentages,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievement_percentages (game_id, entries, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(game_id) DO UPDATE SET
            entries = excluded.entries,
            updated_at = excluded.updated_at",
        rusqlite::params![
            percentages.game_id,
            percentages.entries,
            percentages.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert achievement percentages: {}", e))?;
    Ok(())
}

pub fn get_achievement_percentages_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<Option<AchievementPercentages>, String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT game_id, entries, updated_at
         FROM achievement_percentages WHERE game_id = ?1",
        [game_id],
        |row| {
            Ok(AchievementPercentages {
                game_id: row.get(0)?,
                entries: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to get achievement percentages: {}", e))
}

// ---------------------------------------------------------------------------
// Legacy compatibility — map old app_id-based calls to new game_id-based calls
// ---------------------------------------------------------------------------

/// Convert an old app_id to a game_id (steam-{app_id})
pub fn app_id_to_game_id(app_id: &str) -> String {
    format!("steam-{}", app_id)
}

/// Legacy wrapper: upsert summary using app_id (for backward compat during transition)
pub fn upsert_achievement_summary_legacy(
    db: &Mutex<Connection>,
    app_id: &str,
    platform: &str,
    source: &str,
    unlocked: i64,
    total: i64,
    in_progress: i64,
    completion_time: Option<i64>,
    last_unlock_at: Option<i64>,
    updated_at: i64,
) -> Result<(), String> {
    let game_id = app_id_to_game_id(app_id);
    let row = AchievementSummary {
        game_id,
        platform: platform.to_string(),
        source: source.to_string(),
        unlocked,
        total,
        in_progress,
        completion_time,
        last_unlock_at,
        updated_at,
    };
    upsert_achievement_summary_inner(db, &row)
}

/// Legacy wrapper: get summary using app_id
pub fn get_achievement_summary_legacy(
    db: &Mutex<Connection>,
    app_id: &str,
) -> Result<Option<AchievementSummary>, String> {
    let game_id = app_id_to_game_id(app_id);
    get_achievement_summary_inner(db, &game_id)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn upsert_achievement_summary(
    state: tauri::State<'_, SqliteAchievementsDb>,
    row: AchievementSummary,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_achievement_summary_inner(db, &row)
}

#[tauri::command]
pub fn get_achievement_summary(
    state: tauri::State<'_, SqliteAchievementsDb>,
    game_id: String,
) -> Result<Option<AchievementSummary>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    get_achievement_summary_inner(db, &game_id)
}

#[tauri::command]
pub fn get_all_achievement_summaries(
    state: tauri::State<'_, SqliteAchievementsDb>,
) -> Result<Vec<AchievementSummary>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_all_achievement_summaries_inner(db)
}

#[tauri::command]
pub fn upsert_achievement(
    state: tauri::State<'_, SqliteAchievementsDb>,
    achievement: Achievement,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_achievement_inner(db, &achievement)
}

#[tauri::command]
pub fn batch_upsert_achievements(
    state: tauri::State<'_, SqliteAchievementsDb>,
    achievements: Vec<Achievement>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    batch_upsert_achievements_inner(db, &achievements)
}

#[tauri::command]
pub fn get_achievements_for_game(
    state: tauri::State<'_, SqliteAchievementsDb>,
    game_id: String,
) -> Result<Vec<Achievement>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_achievements_for_game_inner(db, &game_id)
}

#[tauri::command]
pub fn delete_achievements_for_game(
    state: tauri::State<'_, SqliteAchievementsDb>,
    game_id: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    delete_achievements_for_game_inner(db, &game_id)
}

#[tauri::command]
pub fn upsert_achievement_progress(
    state: tauri::State<'_, SqliteAchievementsDb>,
    progress: AchievementProgress,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_achievement_progress_inner(db, &progress)
}

#[tauri::command]
pub fn get_achievement_progress_for_game(
    state: tauri::State<'_, SqliteAchievementsDb>,
    game_id: String,
) -> Result<Vec<AchievementProgress>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_achievement_progress_for_game_inner(db, &game_id)
}

#[tauri::command]
pub fn upsert_achievement_percentages(
    state: tauri::State<'_, SqliteAchievementsDb>,
    percentages: AchievementPercentages,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_achievement_percentages_inner(db, &percentages)
}

#[tauri::command]
pub fn get_achievement_percentages(
    state: tauri::State<'_, SqliteAchievementsDb>,
    game_id: String,
) -> Result<Option<AchievementPercentages>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    get_achievement_percentages_inner(db, &game_id)
}
