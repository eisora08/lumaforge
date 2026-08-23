use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::sqlite_cache;
use crate::commands::sqlite_cache::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherAchievementUnlock {
    pub achievement_id: String,
    pub unlocked_at: u64,
    pub xp_awarded: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherAchievementsFile {
    pub version: u32,
    pub unlocks: Vec<LauncherAchievementUnlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherXpEvent {
    pub id: String,
    pub source: String,
    pub amount: u32,
    pub timestamp: u64,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherXpFile {
    pub version: u32,
    pub events: Vec<LauncherXpEvent>,
}

// ─── Commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn read_launcher_achievements(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<LauncherAchievementUnlock>, String> {
    let Some(inner) = db.0.as_ref() else {
        return Ok(vec![]);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::launcher_achievements_cache::read_launcher_achievements(&conn)?;

    let Some(json) = json_opt else {
        return Ok(vec![]);
    };

    let file: LauncherAchievementsFile =
        serde_json::from_str(&json).map_err(|e| format!("Corrupt launcher achievements: {}", e))?;

    Ok(file.unlocks)
}

#[tauri::command]
pub fn write_launcher_achievements(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
    unlocks: Vec<LauncherAchievementUnlock>,
) -> Result<(), String> {
    let Some(inner) = db.0.as_ref() else {
        return Err("SQLite core DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let file = LauncherAchievementsFile {
        version: 1,
        unlocks,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("Failed to serialize: {}", e))?;

    sqlite_cache::launcher_achievements_cache::write_launcher_achievements(&conn, &json)?;
    Ok(())
}

#[tauri::command]
pub fn read_launcher_xp_events(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<LauncherXpEvent>, String> {
    let Some(inner) = db.0.as_ref() else {
        return Ok(vec![]);
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let json_opt = sqlite_cache::launcher_achievements_cache::read_launcher_xp_events(&conn)?;

    let Some(json) = json_opt else {
        return Ok(vec![]);
    };

    let file: LauncherXpFile =
        serde_json::from_str(&json).map_err(|e| format!("Corrupt launcher XP data: {}", e))?;

    Ok(file.events)
}

#[tauri::command]
pub fn write_launcher_xp_events(
    _app_handle: AppHandle,
    db: tauri::State<'_, SqliteCoreDb>,
    events: Vec<LauncherXpEvent>,
) -> Result<(), String> {
    let Some(inner) = db.0.as_ref() else {
        return Err("SQLite core DB not initialized".to_string());
    };
    let conn = inner.lock().map_err(|e| format!("Lock error: {}", e))?;

    let file = LauncherXpFile {
        version: 1,
        events,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| format!("Failed to serialize: {}", e))?;

    sqlite_cache::launcher_achievements_cache::write_launcher_xp_events(&conn, &json)?;
    Ok(())
}
