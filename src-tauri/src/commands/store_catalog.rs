use crate::commands::sqlite_cache::SqliteDb;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

/// Versioned Steam catalog record — matches the TS SteamCatalogRecord type exactly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamCatalogRecord {
    pub app_id: u32,
    pub name: String,
    #[serde(default = "default_type")]
    pub r#type: String,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub original_genres: Vec<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub category_ids: Vec<i32>,
    #[serde(default)]
    pub release_timestamp: i64,
    #[serde(default)]
    pub coming_soon: bool,
    #[serde(default)]
    pub is_free: bool,
    #[serde(default)]
    pub review_percent: u32,
    #[serde(default)]
    pub review_count: u32,
    #[serde(default)]
    pub header_image: String,
    #[serde(default)]
    pub capsule_image: String,
    #[serde(default)]
    pub developers: Vec<String>,
    #[serde(default)]
    pub publishers: Vec<String>,
    #[serde(default)]
    pub last_enriched_at: i64,
}

fn default_type() -> String {
    "game".to_string()
}

/// Catalog artifact wrapper (the JSON file structure).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamCatalogArtifact {
    pub schema_version: u32,
    pub catalog_version: u32,
    pub generated_at: String,
    pub records: Vec<SteamCatalogRecord>,
}

/// Catalog query result for a single game — returned to TS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGameResult {
    pub app_id: u32,
    pub name: String,
    pub r#type: String,
    pub genres: Vec<String>,
    pub categories: Vec<String>,
    pub release_timestamp: i64,
    pub coming_soon: bool,
    pub is_free: bool,
    pub review_percent: u32,
    pub review_count: u32,
    pub header_image: String,
    pub capsule_image: String,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
}

/// Catalog metadata result — returned to TS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogMetaResult {
    pub schema_version: u32,
    pub catalog_version: u32,
    pub imported_at: String,
    pub record_count: u32,
    pub game_count: u32,
    pub checksum: String,
    pub has_catalog: bool,
}

// ── Table creation (called from sqlite_cache init) ──

pub fn create_catalog_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS store_catalog_games (
            app_id          INTEGER PRIMARY KEY,
            name            TEXT NOT NULL DEFAULT '',
            normalized_name TEXT NOT NULL DEFAULT '',
            type            TEXT NOT NULL DEFAULT 'game',
            release_timestamp INTEGER NOT NULL DEFAULT 0,
            coming_soon     INTEGER NOT NULL DEFAULT 0,
            is_free         INTEGER NOT NULL DEFAULT 0,
            review_percent  INTEGER NOT NULL DEFAULT 0,
            review_count    INTEGER NOT NULL DEFAULT 0,
            header_image    TEXT NOT NULL DEFAULT '',
            capsule_image   TEXT NOT NULL DEFAULT '',
            developers_json TEXT NOT NULL DEFAULT '[]',
            publishers_json TEXT NOT NULL DEFAULT '[]',
            last_enriched_at INTEGER NOT NULL DEFAULT 0,
            catalog_version INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS store_catalog_genres (
            app_id          INTEGER NOT NULL,
            genre           TEXT NOT NULL,
            original_genre  TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (app_id, genre),
            FOREIGN KEY (app_id) REFERENCES store_catalog_games(app_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS store_catalog_categories (
            app_id          INTEGER NOT NULL,
            category        TEXT NOT NULL,
            category_id     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (app_id, category),
            FOREIGN KEY (app_id) REFERENCES store_catalog_games(app_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS store_catalog_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_catalog_games_type ON store_catalog_games(type);
        CREATE INDEX IF NOT EXISTS idx_catalog_games_release ON store_catalog_games(release_timestamp);
        CREATE INDEX IF NOT EXISTS idx_catalog_games_review ON store_catalog_games(review_percent, review_count);
        CREATE INDEX IF NOT EXISTS idx_catalog_games_name ON store_catalog_games(normalized_name);
        CREATE INDEX IF NOT EXISTS idx_catalog_games_version ON store_catalog_games(catalog_version);
        CREATE INDEX IF NOT EXISTS idx_catalog_genres_genre ON store_catalog_genres(genre);
        CREATE INDEX IF NOT EXISTS idx_catalog_categories_category ON store_catalog_categories(category);
        ",
    )?;
    Ok(())
}

// ── Internal import logic ──

fn import_catalog_inner(
    conn: &Connection,
    artifact: &SteamCatalogArtifact,
    checksum: &str,
) -> SqliteResult<u32> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    let tx = conn.unchecked_transaction()?;

    // Drop + recreate (atomic replacement)
    tx.execute_batch(
        "
        DROP TABLE IF EXISTS store_catalog_genres;
        DROP TABLE IF EXISTS store_catalog_categories;
        DROP TABLE IF EXISTS store_catalog_games;
        ",
    )?;
    create_catalog_tables(&tx)?;

    // Insert records
    let mut inserted: u32 = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO store_catalog_games (
                app_id, name, normalized_name, type, release_timestamp,
                coming_soon, is_free, review_percent, review_count,
                header_image, capsule_image, developers_json, publishers_json,
                last_enriched_at, catalog_version
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;

        for record in &artifact.records {
            let normalized_name = record.name.to_lowercase();
            let developers_json = serde_json::to_string(&record.developers).unwrap_or_default();
            let publishers_json = serde_json::to_string(&record.publishers).unwrap_or_default();

            stmt.execute(params![
                record.app_id,
                record.name,
                normalized_name,
                record.r#type,
                record.release_timestamp,
                record.coming_soon as i32,
                record.is_free as i32,
                record.review_percent,
                record.review_count,
                record.header_image,
                record.capsule_image,
                developers_json,
                publishers_json,
                record.last_enriched_at,
                artifact.catalog_version,
            ])?;
            inserted += 1;
        }
    }

    // Insert genres
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO store_catalog_genres (app_id, genre, original_genre) VALUES (?1, ?2, ?3)",
        )?;
        for record in &artifact.records {
            for genre in &record.genres {
                let original = record
                    .original_genres
                    .iter()
                    .find(|og| {
                        og.to_lowercase().replace('-', " ")
                            == genre.to_lowercase().replace('-', " ")
                    })
                    .cloned()
                    .unwrap_or_default();
                stmt.execute(params![record.app_id, genre, original])?;
            }
        }
    }

    // Insert categories
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO store_catalog_categories (app_id, category, category_id) VALUES (?1, ?2, ?3)",
        )?;
        for record in &artifact.records {
            for (i, category) in record.categories.iter().enumerate() {
                let cat_id = record.category_ids.get(i).copied().unwrap_or(0);
                stmt.execute(params![record.app_id, category, cat_id])?;
            }
        }
    }

    // Metadata
    let game_count = artifact.records.iter().filter(|r| r.r#type == "game").count() as u32;
    let genre_count = artifact.records.iter().filter(|r| !r.genres.is_empty()).count() as u32;
    let image_count = artifact.records.iter().filter(|r| !r.header_image.is_empty() || !r.capsule_image.is_empty()).count() as u32;
    let release_count = artifact.records.iter().filter(|r| r.release_timestamp > 0).count() as u32;
    let review_count_meta = artifact.records.iter().filter(|r| r.review_count > 0).count() as u32;

    let meta_pairs = [
        ("schema_version", artifact.schema_version.to_string()),
        ("catalog_version", artifact.catalog_version.to_string()),
        ("imported_at", chrono_now()),
        ("record_count", inserted.to_string()),
        ("game_count", game_count.to_string()),
        ("genre_count", genre_count.to_string()),
        ("image_count", image_count.to_string()),
        ("release_count", release_count.to_string()),
        ("review_count", review_count_meta.to_string()),
        ("checksum", checksum.to_string()),
    ];
    for (k, v) in &meta_pairs {
        tx.execute(
            "INSERT OR REPLACE INTO store_catalog_meta (key, value) VALUES (?1, ?2)",
            params![k, v],
        )?;
    }

    tx.commit()?;
    Ok(inserted)
}

fn get_meta(conn: &Connection) -> SqliteResult<Option<CatalogMetaResult>> {
    let mut stmt = conn.prepare("SELECT key, value FROM store_catalog_meta")?;
    let mut map = std::collections::HashMap::new();
    let rows = stmt.query_map([], |row| {
        let key: String = row.get(0)?;
        let value: String = row.get(1)?;
        Ok((key, value))
    })?;
    for row in rows {
        if let Ok((k, v)) = row {
            map.insert(k, v);
        }
    }
    if map.is_empty() {
        return Ok(Some(CatalogMetaResult {
            schema_version: 0,
            catalog_version: 0,
            imported_at: String::new(),
            record_count: 0,
            game_count: 0,
            checksum: String::new(),
            has_catalog: false,
        }));
    }
    Ok(Some(CatalogMetaResult {
        schema_version: map.get("schema_version").and_then(|v| v.parse().ok()).unwrap_or(0),
        catalog_version: map.get("catalog_version").and_then(|v| v.parse().ok()).unwrap_or(0),
        imported_at: map.get("imported_at").cloned().unwrap_or_default(),
        record_count: map.get("record_count").and_then(|v| v.parse().ok()).unwrap_or(0),
        game_count: map.get("game_count").and_then(|v| v.parse().ok()).unwrap_or(0),
        checksum: map.get("checksum").cloned().unwrap_or_default(),
        has_catalog: true,
    }))
}

fn query_by_genre(conn: &Connection, genre: &str, limit: u32, offset: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let mut stmt = conn.prepare(
        "SELECT g.app_id, g.name, g.type, g.release_timestamp, g.coming_soon, g.is_free,
                g.review_percent, g.review_count, g.header_image, g.capsule_image,
                g.developers_json, g.publishers_json
         FROM store_catalog_games g
         INNER JOIN store_catalog_genres gen ON g.app_id = gen.app_id
         WHERE gen.genre = ?1 AND g.type IN ('game', 'demo')
         ORDER BY g.review_count DESC, g.review_percent DESC
         LIMIT ?2 OFFSET ?3",
    )?;
    let rows = stmt.query_map(params![genre, limit, offset], |row| parse_catalog_row(row, genre))?;
    rows.collect()
}

fn query_search(conn: &Connection, query: &str, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let normalized = query.to_lowercase();
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE normalized_name LIKE '%' || ?1 || '%' AND type IN ('game', 'demo')
         ORDER BY review_count DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![normalized, limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn query_by_app_id(conn: &Connection, app_id: u32) -> SqliteResult<Option<CatalogGameResult>> {
    let mut stmt = conn.prepare(
        "SELECT g.app_id, g.name, g.type, g.release_timestamp, g.coming_soon, g.is_free,
                g.review_percent, g.review_count, g.header_image, g.capsule_image,
                g.developers_json, g.publishers_json
         FROM store_catalog_games g WHERE g.app_id = ?1",
    )?;
    let mut rows = stmt.query_map(params![app_id], |row| parse_catalog_row(row, ""))?;
    rows.next().transpose()
}

fn query_featured(conn: &Connection, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE type IN ('game', 'demo') AND review_count >= 100 AND review_percent >= 75
           AND header_image != ''
         ORDER BY review_count DESC, review_percent DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn query_new_noteworthy(conn: &Connection, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let cutoff = (chrono_now_ts() / 1000) as i64 - (180 * 24 * 60 * 60);
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE type IN ('game', 'demo') AND coming_soon = 0
           AND release_timestamp > 0 AND release_timestamp > ?1
         ORDER BY release_timestamp DESC, review_count DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![cutoff, limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn parse_catalog_row(
    row: &rusqlite::Row<'_>,
    genre: &str,
) -> Result<CatalogGameResult, rusqlite::Error> {
    let developers_json: String = row.get(10)?;
    let publishers_json: String = row.get(11)?;
    Ok(CatalogGameResult {
        app_id: row.get(0)?,
        name: row.get(1)?,
        r#type: row.get(2)?,
        genres: if genre.is_empty() { vec![] } else { vec![genre.to_string()] },
        categories: vec![],
        release_timestamp: row.get(3)?,
        coming_soon: row.get::<_, i32>(4)? != 0,
        is_free: row.get::<_, i32>(5)? != 0,
        review_percent: row.get(6)?,
        review_count: row.get(7)?,
        header_image: row.get(8)?,
        capsule_image: row.get(9)?,
        developers: serde_json::from_str(&developers_json).unwrap_or_default(),
        publishers: serde_json::from_str(&publishers_json).unwrap_or_default(),
    })
}

// ── Tauri commands ──

#[tauri::command]
pub fn get_catalog_meta(
    db: tauri::State<'_, SqliteDb>,
) -> Result<CatalogMetaResult, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(CatalogMetaResult {
            schema_version: 0, catalog_version: 0, imported_at: String::new(),
            record_count: 0, game_count: 0, checksum: String::new(), has_catalog: false,
        }),
    };
    let meta = get_meta(&guard).map_err(|e| format!("Catalog meta query error: {}", e))?;
    Ok(meta.unwrap_or_else(|| CatalogMetaResult {
        schema_version: 0, catalog_version: 0, imported_at: String::new(),
        record_count: 0, game_count: 0, checksum: String::new(), has_catalog: false,
    }))
}

#[tauri::command]
pub fn import_steam_catalog(
    artifact_json: String,
    checksum: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<u32, String> {
    let artifact: SteamCatalogArtifact = serde_json::from_str(&artifact_json)
        .map_err(|e| format!("Failed to parse catalog artifact: {}", e))?;
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Err("Database not available".to_string()),
    };
    let count = import_catalog_inner(&guard, &artifact, &checksum)
        .map_err(|e| format!("Catalog import error: {}", e))?;
    Ok(count)
}

#[tauri::command]
pub fn query_catalog_by_genre(
    genre: String,
    limit: u32,
    offset: u32,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_by_genre(&guard, &genre, limit, offset)
        .map_err(|e| format!("Catalog genre query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_search(
    query: String,
    limit: u32,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_search(&guard, &query, limit)
        .map_err(|e| format!("Catalog search query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_game(
    app_id: u32,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Option<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(None),
    };
    query_by_app_id(&guard, app_id)
        .map_err(|e| format!("Catalog game query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_featured(
    limit: u32,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_featured(&guard, limit)
        .map_err(|e| format!("Catalog featured query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_new_noteworthy(
    limit: u32,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_new_noteworthy(&guard, limit)
        .map_err(|e| format!("Catalog new & noteworthy query error: {}", e))
}

// ── Helpers ──

fn chrono_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!(
        "{}-{:02}-{:02}T00:00:00Z",
        1970 + (now / 31556926) as u32,
        ((now % 31556926) / 2592000 + 1),
        ((now % 2592000) / 86400 + 1),
    )
}

fn chrono_now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
