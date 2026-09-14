use std::sync::Mutex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaHealthRecord {
    pub app_id: String,
    pub complete: bool,
    pub missing: String,       // JSON array of role names
    pub checked_at: i64,
    pub last_repair_attempt_at: Option<i64>,
    pub last_repair_error: Option<String>,
    pub download_error: Option<String>,
}

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS media_health (
            app_id                TEXT PRIMARY KEY,
            complete              INTEGER NOT NULL DEFAULT 0,
            missing               TEXT NOT NULL DEFAULT '[]',
            checked_at            INTEGER NOT NULL DEFAULT 0,
            last_repair_attempt_at INTEGER,
            last_repair_error     TEXT,
            download_error        TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_media_health_complete ON media_health(complete);
        CREATE INDEX IF NOT EXISTS idx_media_health_last_error ON media_health(last_repair_error);
        ",
    )
    .map_err(|e| format!("Failed to create media_health table: {}", e))?;
    Ok(())
}

pub fn load_all_media_health(db: &Mutex<Connection>) -> Result<Vec<MediaHealthRecord>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT app_id, complete, missing, checked_at, last_repair_attempt_at, last_repair_error, download_error
             FROM media_health",
        )
        .map_err(|e| format!("Failed to prepare load_all_media_health: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(MediaHealthRecord {
                app_id: row.get(0)?,
                complete: row.get::<_, i64>(1)? != 0,
                missing: row.get(2)?,
                checked_at: row.get(3)?,
                last_repair_attempt_at: row.get(4)?,
                last_repair_error: row.get(5)?,
                download_error: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query media_health: {}", e))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| format!("Failed to read media_health row: {}", e))?);
    }
    Ok(records)
}

pub fn upsert_media_health(db: &Mutex<Connection>, record: &MediaHealthRecord) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO media_health (app_id, complete, missing, checked_at, last_repair_attempt_at, last_repair_error, download_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(app_id) DO UPDATE SET
            complete = excluded.complete,
            missing = excluded.missing,
            checked_at = excluded.checked_at,
            last_repair_attempt_at = excluded.last_repair_attempt_at,
            last_repair_error = excluded.last_repair_error,
            download_error = excluded.download_error",
        rusqlite::params![
            record.app_id,
            record.complete as i64,
            record.missing,
            record.checked_at,
            record.last_repair_attempt_at,
            record.last_repair_error,
            record.download_error,
        ],
    )
    .map_err(|e| format!("Failed to upsert media_health: {}", e))?;
    Ok(())
}

pub fn batch_upsert_media_health(
    db: &Mutex<Connection>,
    records: &[MediaHealthRecord],
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let conn = db.lock().unwrap();
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO media_health (app_id, complete, missing, checked_at, last_repair_attempt_at, last_repair_error, download_error)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(app_id) DO UPDATE SET
                    complete = excluded.complete,
                    missing = excluded.missing,
                    checked_at = excluded.checked_at,
                    last_repair_attempt_at = excluded.last_repair_attempt_at,
                    last_repair_error = excluded.last_repair_error,
                    download_error = excluded.download_error",
            )
            .map_err(|e| format!("Failed to prepare batch_upsert_media_health: {}", e))?;

        for record in records {
            stmt.execute(rusqlite::params![
                record.app_id,
                record.complete as i64,
                record.missing,
                record.checked_at,
                record.last_repair_attempt_at,
                record.last_repair_error,
                record.download_error,
            ])
            .map_err(|e| format!("Failed to upsert media_health record: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit batch_upsert_media_health: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_media_health_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<MediaHealthRecord>, String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(Vec::new());
    };
    load_all_media_health(db)
}

#[tauri::command]
pub fn batch_upsert_media_health_cmd(
    state: tauri::State<'_, SqliteCoreDb>,
    records: Vec<MediaHealthRecord>,
) -> Result<(), String> {
    let Some(db) = state.0.as_ref() else {
        return Ok(());
    };
    batch_upsert_media_health(db, &records)
}
