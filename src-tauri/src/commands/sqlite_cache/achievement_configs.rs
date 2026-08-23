use tauri::State;

use crate::commands::sqlite_cache::SqliteCoreDb;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AchievementGameConfig {
    pub app_id: String,
    pub name: String,
    pub platform: String,
    pub config_path: Option<String>,
    pub save_path: Option<String>,
    pub executable: Option<String>,
    pub arguments: Option<String>,
    pub process_name: Option<String>,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn with_conn<F, R>(db: &State<'_, SqliteCoreDb>, f: F) -> Result<R, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<R, String>,
{
    let guard = db
        .0
        .as_ref()
        .ok_or("SQLite not available")?
        .lock()
        .map_err(|e| e.to_string())?;
    f(&guard)
}

// ---------------------------------------------------------------------------
// CRUD Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_achievement_game_config(
    db: State<'_, SqliteCoreDb>,
    app_id: String,
) -> Result<Option<AchievementGameConfig>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT app_id, name, platform, config_path, save_path, executable, arguments, process_name, updated_at
                 FROM achievement_game_configs WHERE app_id = ?1",
            )
            .map_err(|e| format!("prepare: {}", e))?;

        let result = stmt
            .query_row(rusqlite::params![app_id], |row| {
                Ok(AchievementGameConfig {
                    app_id: row.get(0)?,
                    name: row.get(1)?,
                    platform: row.get(2)?,
                    config_path: row.get(3)?,
                    save_path: row.get(4)?,
                    executable: row.get(5)?,
                    arguments: row.get(6)?,
                    process_name: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .ok();

        Ok(result)
    })
}

#[tauri::command]
pub fn write_achievement_game_config(
    db: State<'_, SqliteCoreDb>,
    config: AchievementGameConfig,
) -> Result<(), String> {
    with_conn(&db, |conn| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        conn.execute(
            "INSERT OR REPLACE INTO achievement_game_configs
             (app_id, name, platform, config_path, save_path, executable, arguments, process_name, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                config.app_id,
                config.name,
                config.platform,
                config.config_path,
                config.save_path,
                config.executable,
                config.arguments,
                config.process_name,
                now,
            ],
        )
        .map_err(|e| format!("write config: {}", e))?;

        Ok(())
    })
}

#[tauri::command]
pub fn delete_achievement_game_config(
    db: State<'_, SqliteCoreDb>,
    app_id: String,
) -> Result<(), String> {
    with_conn(&db, |conn| {
        conn.execute(
            "DELETE FROM achievement_game_configs WHERE app_id = ?1",
            rusqlite::params![app_id],
        )
        .map_err(|e| format!("delete config: {}", e))?;
        Ok(())
    })
}

#[tauri::command]
pub fn list_achievement_game_configs(
    db: State<'_, SqliteCoreDb>,
) -> Result<Vec<AchievementGameConfig>, String> {
    with_conn(&db, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT app_id, name, platform, config_path, save_path, executable, arguments, process_name, updated_at
                 FROM achievement_game_configs ORDER BY name",
            )
            .map_err(|e| format!("prepare: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(AchievementGameConfig {
                    app_id: row.get(0)?,
                    name: row.get(1)?,
                    platform: row.get(2)?,
                    config_path: row.get(3)?,
                    save_path: row.get(4)?,
                    executable: row.get(5)?,
                    arguments: row.get(6)?,
                    process_name: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| format!("query: {}", e))?;

        let mut configs = Vec::new();
        for row in rows.flatten() {
            configs.push(row);
        }

        Ok(configs)
    })
}
