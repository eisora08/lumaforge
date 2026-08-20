use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteAchievementsDb;

// ---------------------------------------------------------------------------
// Achievement tables — volatile per-game progress
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementSummaryRow {
    pub app_id: String,
    pub unlocked: i64,
    pub total: i64,
    pub in_progress: i64,
    pub completion_time: Option<i64>,
    pub last_unlock_at: Option<i64>,
    pub updated_at: i64,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_platform")]
    pub platform: String,
}

fn default_source() -> String {
    "steam-official".to_string()
}
fn default_platform() -> String {
    "steam-official".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementEntryRow {
    pub app_id: String,
    pub api_name: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub icon_gray: Option<String>,
    pub hidden: bool,
    pub unlocked: bool,
    pub unlock_time: Option<i64>,
    pub unlocked_at: Option<i64>,
    pub global_pct: Option<f64>,
    pub updated_at: i64,
}

pub fn upsert_achievement_summary_inner(
    db: &Mutex<Connection>,
    row: &AchievementSummaryRow,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievement_summaries (app_id, source, platform, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(app_id, platform) DO UPDATE SET
            source = excluded.source,
            unlocked = excluded.unlocked,
            total = excluded.total,
            in_progress = excluded.in_progress,
            completion_time = excluded.completion_time,
            last_unlock_at = excluded.last_unlock_at,
            updated_at = excluded.updated_at",
        rusqlite::params![
            row.app_id,
            row.source,
            row.platform,
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
    app_id: &str,
) -> Result<Option<AchievementSummaryRow>, String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT app_id, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at, source, platform
         FROM achievement_summaries WHERE app_id = ?1",
        [app_id],
        |row| {
            Ok(AchievementSummaryRow {
                app_id: row.get(0)?,
                unlocked: row.get(1)?,
                total: row.get(2)?,
                in_progress: row.get(3)?,
                completion_time: row.get(4)?,
                last_unlock_at: row.get(5)?,
                updated_at: row.get(6)?,
                source: row.get::<_, Option<String>>(7)?.unwrap_or_else(default_source),
                platform: row.get::<_, Option<String>>(8)?.unwrap_or_else(default_platform),
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read achievement summary: {}", e))
}

pub fn batch_get_achievement_summaries_inner(
    db: &Mutex<Connection>,
    app_ids: &[String],
) -> Result<Vec<AchievementSummaryRow>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.lock().unwrap();
    let mut out = Vec::new();
    for app_id in app_ids {
        if let Some(row) = get_achievement_summary_unlocked(&conn, app_id)? {
            out.push(row);
        }
    }
    Ok(out)
}

fn get_achievement_summary_unlocked(
    conn: &Connection,
    app_id: &str,
) -> Result<Option<AchievementSummaryRow>, String> {
    conn.query_row(
        "SELECT app_id, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at, source, platform
         FROM achievement_summaries WHERE app_id = ?1",
        [app_id],
        |row| {
            Ok(AchievementSummaryRow {
                app_id: row.get(0)?,
                unlocked: row.get(1)?,
                total: row.get(2)?,
                in_progress: row.get(3)?,
                completion_time: row.get(4)?,
                last_unlock_at: row.get(5)?,
                updated_at: row.get(6)?,
                source: row.get::<_, Option<String>>(7)?.unwrap_or_else(default_source),
                platform: row.get::<_, Option<String>>(8)?.unwrap_or_else(default_platform),
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read achievement summary: {}", e))
}

pub fn get_all_achievement_summaries_inner(
    db: &Mutex<Connection>,
) -> Result<Vec<AchievementSummaryRow>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT app_id, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at, source, platform
             FROM achievement_summaries ORDER BY app_id ASC",
        )
        .map_err(|e| format!("Failed to prepare get_all_achievement_summaries: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AchievementSummaryRow {
                app_id: row.get(0)?,
                unlocked: row.get(1)?,
                total: row.get(2)?,
                in_progress: row.get(3)?,
                completion_time: row.get(4)?,
                last_unlock_at: row.get(5)?,
                updated_at: row.get(6)?,
                source: row.get::<_, Option<String>>(7)?.unwrap_or_else(default_source),
                platform: row.get::<_, Option<String>>(8)?.unwrap_or_else(default_platform),
            })
        })
        .map_err(|e| format!("Failed to query all achievement summaries: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to map achievement row: {}", e))?);
    }
    Ok(out)
}

pub fn upsert_achievement_entry_inner(
    db: &Mutex<Connection>,
    row: &AchievementEntryRow,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievement_entries (app_id, api_name, name, description, icon_url, icon_gray, hidden, unlocked, unlock_time, unlocked_at, global_pct, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(app_id, api_name) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            icon_url = excluded.icon_url,
            icon_gray = excluded.icon_gray,
            hidden = excluded.hidden,
            unlocked = excluded.unlocked,
            unlock_time = excluded.unlock_time,
            unlocked_at = excluded.unlocked_at,
            global_pct = excluded.global_pct,
            updated_at = excluded.updated_at",
        rusqlite::params![
            row.app_id,
            row.api_name,
            row.name,
            row.description,
            row.icon_url,
            row.icon_gray,
            row.hidden as i32,
            row.unlocked as i32,
            row.unlock_time,
            row.unlocked_at,
            row.global_pct,
            row.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert achievement entry: {}", e))?;
    Ok(())
}

pub fn batch_upsert_achievement_entries_inner(
    db: &Mutex<Connection>,
    rows: &[AchievementEntryRow],
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let conn = db.lock().unwrap();
    for row in rows {
        upsert_achievement_entry_with_conn(&conn, row)?;
    }
    Ok(())
}

fn upsert_achievement_entry_with_conn(
    conn: &Connection,
    row: &AchievementEntryRow,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO achievement_entries (app_id, api_name, name, description, icon_url, icon_gray, hidden, unlocked, unlock_time, unlocked_at, global_pct, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(app_id, api_name) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            icon_url = excluded.icon_url,
            icon_gray = excluded.icon_gray,
            hidden = excluded.hidden,
            unlocked = excluded.unlocked,
            unlock_time = excluded.unlock_time,
            unlocked_at = excluded.unlocked_at,
            global_pct = excluded.global_pct,
            updated_at = excluded.updated_at",
        rusqlite::params![
            row.app_id,
            row.api_name,
            row.name,
            row.description,
            row.icon_url,
            row.icon_gray,
            row.hidden as i32,
            row.unlocked as i32,
            row.unlock_time,
            row.unlocked_at,
            row.global_pct,
            row.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert achievement entry: {}", e))?;
    Ok(())
}

pub fn get_achievement_entries_inner(
    db: &Mutex<Connection>,
    app_id: &str,
) -> Result<Vec<AchievementEntryRow>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT app_id, api_name, name, description, icon_url, icon_gray, hidden, unlocked, unlock_time, unlocked_at, global_pct, updated_at
             FROM achievement_entries WHERE app_id = ?1 ORDER BY api_name ASC",
        )
        .map_err(|e| format!("Failed to prepare get_achievement_entries: {}", e))?;
    let rows = stmt
        .query_map([app_id], |row| {
            Ok(AchievementEntryRow {
                app_id: row.get(0)?,
                api_name: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                icon_url: row.get(4)?,
                icon_gray: row.get(5)?,
                hidden: row.get::<_, i32>(6)? != 0,
                unlocked: row.get::<_, i32>(7)? != 0,
                unlock_time: row.get(8)?,
                unlocked_at: row.get(9)?,
                global_pct: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to query achievement entries: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to map achievement row: {}", e))?);
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementPercentageRow {
    pub app_id: String,
    pub entries: String,
    pub updated_at: i64,
}

pub fn upsert_achievement_percentages_inner(
    db: &Mutex<Connection>,
    row: &AchievementPercentageRow,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO achievement_percentages (app_id, entries, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(app_id) DO UPDATE SET
            entries = excluded.entries,
            updated_at = excluded.updated_at",
        rusqlite::params![row.app_id, row.entries, row.updated_at],
    )
    .map_err(|e| format!("Failed to upsert achievement percentages: {}", e))?;
    Ok(())
}

pub fn get_achievement_percentages_inner(
    db: &Mutex<Connection>,
    app_id: &str,
) -> Result<Option<AchievementPercentageRow>, String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT app_id, entries, updated_at FROM achievement_percentages WHERE app_id = ?1",
        [app_id],
        |row| {
            Ok(AchievementPercentageRow {
                app_id: row.get(0)?,
                entries: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read achievement percentages: {}", e))
}

#[tauri::command]
pub fn upsert_achievement_summary(
    state: tauri::State<'_, SqliteAchievementsDb>,
    row: AchievementSummaryRow,
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
    app_id: String,
) -> Result<Option<AchievementSummaryRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    get_achievement_summary_inner(db, &app_id)
}

#[tauri::command]
pub fn batch_get_achievement_summaries(
    state: tauri::State<'_, SqliteAchievementsDb>,
    app_ids: Vec<String>,
) -> Result<Vec<AchievementSummaryRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    batch_get_achievement_summaries_inner(db, &app_ids)
}

#[tauri::command]
pub fn upsert_achievement_entry(
    state: tauri::State<'_, SqliteAchievementsDb>,
    row: AchievementEntryRow,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_achievement_entry_inner(db, &row)
}

#[tauri::command]
pub fn batch_upsert_achievement_entries(
    state: tauri::State<'_, SqliteAchievementsDb>,
    rows: Vec<AchievementEntryRow>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    batch_upsert_achievement_entries_inner(db, &rows)
}

#[tauri::command]
pub fn get_achievement_entries(
    state: tauri::State<'_, SqliteAchievementsDb>,
    app_id: String,
) -> Result<Vec<AchievementEntryRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_achievement_entries_inner(db, &app_id)
}

#[tauri::command]
pub fn upsert_achievement_percentages(
    state: tauri::State<'_, SqliteAchievementsDb>,
    row: AchievementPercentageRow,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    upsert_achievement_percentages_inner(db, &row)
}

#[tauri::command]
pub fn get_achievement_percentages(
    state: tauri::State<'_, SqliteAchievementsDb>,
    app_id: String,
) -> Result<Option<AchievementPercentageRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    get_achievement_percentages_inner(db, &app_id)
}

#[tauri::command]
pub fn get_all_achievement_summaries(
    state: tauri::State<'_, SqliteAchievementsDb>,
) -> Result<Vec<AchievementSummaryRow>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_all_achievement_summaries_inner(db)
}
