use rusqlite::Connection;

use crate::models::playtime::{PlaytimeEntry, PlaytimeSession};

// ---------------------------------------------------------------------------
// Playtime — SQLite backing for the per-game playtime store.
// Replaces the in-memory / JSON playtime store with persistent queries.
// ---------------------------------------------------------------------------

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS playtime_entries (
            game_key                TEXT PRIMARY KEY,
            app_id                  TEXT,
            provider                TEXT NOT NULL DEFAULT 'steam',
            title                   TEXT NOT NULL DEFAULT '',
            playtime_source         TEXT,
            external_playtime_seconds INTEGER NOT NULL DEFAULT 0,
            external_source         TEXT,
            external_imported_at    INTEGER,
            local_playtime_seconds  INTEGER NOT NULL DEFAULT 0,
            total_playtime_seconds  INTEGER NOT NULL DEFAULT 0,
            last_played_at          INTEGER,
            last_session_seconds    INTEGER,
            updated_at              INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS playtime_sessions (
            session_id      TEXT PRIMARY KEY,
            game_key        TEXT NOT NULL,
            started_at      INTEGER NOT NULL DEFAULT 0,
            ended_at        INTEGER,
            duration_seconds INTEGER,
            exit_reason     TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_playtime_sessions_game_key
            ON playtime_sessions(game_key);
        ",
    )
    .map_err(|e| format!("Failed to create playtime tables: {}", e))?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

pub fn read_all_playtime_entries(conn: &Connection) -> Result<Vec<PlaytimeEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT game_key, app_id, provider, title, playtime_source,
                    external_playtime_seconds, external_source, external_imported_at,
                    local_playtime_seconds, total_playtime_seconds,
                    last_played_at, last_session_seconds
             FROM playtime_entries
             ORDER BY last_played_at DESC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PlaytimeEntry {
                game_key: row.get(0)?,
                app_id: row.get(1)?,
                provider: row.get(2)?,
                title: row.get(3)?,
                playtime_source: row.get(4)?,
                external_playtime_seconds: row.get(5)?,
                external_source: row.get(6)?,
                external_imported_at: row.get(7)?,
                local_playtime_seconds: row.get(8)?,
                total_playtime_seconds: row.get(9)?,
                last_played_at: row.get(10)?,
                last_session_seconds: row.get(11)?,
                sessions: Vec::new(),
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(entries)
}

pub fn read_playtime_sessions_for_game(
    conn: &Connection,
    game_key: &str,
) -> Result<Vec<PlaytimeSession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT session_id, started_at, ended_at, duration_seconds, exit_reason
             FROM playtime_sessions
             WHERE game_key = ?1
             ORDER BY started_at DESC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map([game_key], |row| {
            Ok(PlaytimeSession {
                session_id: row.get(0)?,
                started_at: row.get(1)?,
                ended_at: row.get(2)?,
                duration_seconds: row.get(3)?,
                exit_reason: row.get(4)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(sessions)
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

pub fn upsert_playtime_entry(conn: &Connection, entry: &PlaytimeEntry) -> Result<(), String> {
    conn.execute(
        "INSERT INTO playtime_entries
            (game_key, app_id, provider, title, playtime_source,
             external_playtime_seconds, external_source, external_imported_at,
             local_playtime_seconds, total_playtime_seconds,
             last_played_at, last_session_seconds, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(game_key) DO UPDATE SET
            app_id                = excluded.app_id,
            provider              = excluded.provider,
            title                 = excluded.title,
            playtime_source       = excluded.playtime_source,
            external_playtime_seconds = excluded.external_playtime_seconds,
            external_source       = excluded.external_source,
            external_imported_at  = excluded.external_imported_at,
            local_playtime_seconds  = excluded.local_playtime_seconds,
            total_playtime_seconds  = excluded.total_playtime_seconds,
            last_played_at        = excluded.last_played_at,
            last_session_seconds  = excluded.last_session_seconds,
            updated_at            = excluded.updated_at",
        rusqlite::params![
            entry.game_key,
            entry.app_id,
            entry.provider,
            entry.title,
            entry.playtime_source,
            entry.external_playtime_seconds as i64,
            entry.external_source,
            entry.external_imported_at.map(|v| v as i64),
            entry.local_playtime_seconds as i64,
            entry.total_playtime_seconds as i64,
            entry.last_played_at.map(|v| v as i64),
            entry.last_session_seconds.map(|v| v as i64),
            now(),
        ],
    )
    .map_err(|e| format!("Upsert playtime_entry error: {}", e))?;
    Ok(())
}

pub fn upsert_playtime_session(
    conn: &Connection,
    session: &PlaytimeSession,
    game_key: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO playtime_sessions
            (session_id, game_key, started_at, ended_at, duration_seconds, exit_reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(session_id) DO UPDATE SET
            game_key         = excluded.game_key,
            started_at       = excluded.started_at,
            ended_at         = excluded.ended_at,
            duration_seconds = excluded.duration_seconds,
            exit_reason      = excluded.exit_reason",
        rusqlite::params![
            session.session_id,
            game_key,
            session.started_at as i64,
            session.ended_at.map(|v| v as i64),
            session.duration_seconds.map(|v| v as i64),
            session.exit_reason,
        ],
    )
    .map_err(|e| format!("Upsert playtime_session error: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/// Keep only the newest `keep_count` sessions for the given game_key.
/// Deletes all older sessions.
pub fn delete_playtime_sessions_older_than(
    conn: &Connection,
    game_key: &str,
    keep_count: usize,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM playtime_sessions
         WHERE game_key = ?1
           AND session_id NOT IN (
               SELECT session_id FROM playtime_sessions
               WHERE game_key = ?1
               ORDER BY started_at DESC
               LIMIT ?2
           )",
        rusqlite::params![game_key, keep_count as i64],
    )
    .map_err(|e| format!("Delete old playtime_sessions error: {}", e))?;
    Ok(())
}
