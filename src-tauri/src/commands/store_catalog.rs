use crate::commands::sqlite_cache::SqliteStoreDb;
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

// ── Table creation (DDL body lives in sqlite_cache; delegating here) ──

pub fn create_catalog_tables(conn: &Connection) -> SqliteResult<()> {
    super::sqlite_cache::catalog_tables(conn)
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
         WHERE type IN ('game', 'demo') AND review_count >= 100
           AND header_image != ''
         ORDER BY review_count DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn query_new_noteworthy(conn: &Connection, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE type IN ('game', 'demo') AND coming_soon = 0
           AND review_count >= 50
           AND header_image != ''
         ORDER BY review_count DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn query_hidden_gems(conn: &Connection, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE type IN ('game', 'demo')
           AND review_count BETWEEN 50 AND 5000
           AND header_image != ''
         ORDER BY review_count DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn query_top_rated(conn: &Connection, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE type IN ('game', 'demo')
           AND review_count >= 200
           AND header_image != ''
         ORDER BY review_count DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| parse_catalog_row(row, ""))?;
    rows.collect()
}

fn query_cult_classics(conn: &Connection, limit: u32) -> SqliteResult<Vec<CatalogGameResult>> {
    let two_years_ago = (chrono_now_ts() / 1000) as i64 - (2 * 365 * 24 * 60 * 60);
    let mut stmt = conn.prepare(
        "SELECT app_id, name, type, release_timestamp, coming_soon, is_free,
                review_percent, review_count, header_image, capsule_image,
                developers_json, publishers_json
         FROM store_catalog_games
         WHERE type IN ('game', 'demo')
           AND review_count >= 500
           AND header_image != ''
           AND release_timestamp > 0 AND release_timestamp < ?1
         ORDER BY review_count DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![two_years_ago, limit], |row| parse_catalog_row(row, ""))?;
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
    db: tauri::State<'_, SqliteStoreDb>,
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
    db: tauri::State<'_, SqliteStoreDb>,
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
    db: tauri::State<'_, SqliteStoreDb>,
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
    db: tauri::State<'_, SqliteStoreDb>,
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
    db: tauri::State<'_, SqliteStoreDb>,
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
    db: tauri::State<'_, SqliteStoreDb>,
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
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_new_noteworthy(&guard, limit)
        .map_err(|e| format!("Catalog new & noteworthy query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_hidden_gems(
    limit: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_hidden_gems(&guard, limit)
        .map_err(|e| format!("Catalog hidden gems query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_top_rated(
    limit: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_top_rated(&guard, limit)
        .map_err(|e| format!("Catalog top rated query error: {}", e))
}

#[tauri::command]
pub fn query_catalog_cult_classics(
    limit: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<CatalogGameResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_cult_classics(&guard, limit)
        .map_err(|e| format!("Catalog cult classics query error: {}", e))
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

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        create_catalog_tables(&conn).unwrap();
        conn
    }

    fn make_record(app_id: u32, name: &str, genres: &[&str]) -> SteamCatalogRecord {
        SteamCatalogRecord {
            app_id,
            name: name.to_string(),
            r#type: "game".to_string(),
            genres: genres.iter().map(|g| g.to_string()).collect(),
            original_genres: genres.iter().map(|g| g.to_uppercase()).collect(),
            categories: vec![],
            category_ids: vec![],
            release_timestamp: 1700000000,
            coming_soon: false,
            is_free: false,
            review_percent: 85,
            review_count: 500,
            header_image: format!("https://example.com/header_{}.jpg", app_id),
            capsule_image: format!("https://example.com/capsule_{}.jpg", app_id),
            developers: vec!["Dev".to_string()],
            publishers: vec!["Pub".to_string()],
            last_enriched_at: 1700000000,
        }
    }

    fn make_artifact(records: Vec<SteamCatalogRecord>) -> SteamCatalogArtifact {
        SteamCatalogArtifact {
            schema_version: 1,
            catalog_version: 1,
            generated_at: "2025-01-01T00:00:00Z".to_string(),
            records,
        }
    }

    fn build_test_artifact() -> SteamCatalogArtifact {
        let records = vec![
            make_record(10, "Action Alpha", &["Action", "Shooter"]),
            make_record(20, "Indie Indie", &["Indie"]),
            make_record(30, "Racing Racer", &["Racing"]),
            make_record(40, "RPG Quest", &["RPG"]),
            make_record(50, "Adventure Explorer", &["Adventure"]),
            make_record(60, "Shooter Blaster", &["Shooter", "Action"]),
            make_record(70, "Strategy Commander", &["Strategy"]),
            make_record(80, "Simulator Builder", &["Simulation"]),
            make_record(90, "Adventure Wanderer", &["Adventure", "Indie"]),
            make_record(100, "Action Fighter", &["Action"]),
        ];
        make_artifact(records)
    }

    // ── Import tests ──

    #[test]
    fn test_import_valid_artifact() {
        let conn = test_conn();
        let artifact = build_test_artifact();
        let checksum = "abc123".to_string();
        let count = import_catalog_inner(&conn, &artifact, &checksum).unwrap();
        assert_eq!(count, 10);
        let meta = get_meta(&conn).unwrap().unwrap();
        assert!(meta.has_catalog);
        assert_eq!(meta.record_count, 10);
        assert_eq!(meta.game_count, 10);
        assert_eq!(meta.schema_version, 1);
        assert_eq!(meta.catalog_version, 1);
        assert_eq!(meta.checksum, "abc123");
    }

    #[test]
    fn test_import_rejects_no_records() {
        let conn = test_conn();
        let artifact = make_artifact(vec![]);
        let count = import_catalog_inner(&conn, &artifact, "empty").unwrap();
        assert_eq!(count, 0);
        let meta = get_meta(&conn).unwrap().unwrap();
        assert!(meta.has_catalog);
        assert_eq!(meta.record_count, 0);
    }

    #[test]
    fn test_import_replaces_previous_catalog() {
        let conn = test_conn();
        let first = make_artifact(vec![make_record(1, "Game One", &["Action"])]);
        import_catalog_inner(&conn, &first, "v1").unwrap();
        let meta1 = get_meta(&conn).unwrap().unwrap();
        assert_eq!(meta1.record_count, 1);
        assert_eq!(meta1.checksum, "v1");

        let second = make_artifact(vec![
            make_record(2, "Game Two", &["Indie"]),
            make_record(3, "Game Three", &["RPG"]),
        ]);
        import_catalog_inner(&conn, &second, "v2").unwrap();
        let meta2 = get_meta(&conn).unwrap().unwrap();
        assert_eq!(meta2.record_count, 2);
        assert_eq!(meta2.checksum, "v2");
        let game = query_by_app_id(&conn, 1).unwrap();
        assert!(game.is_none(), "old game should be gone after replace");
    }

    // ── Query by appId ──

    #[test]
    fn test_query_by_app_id_found() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let game = query_by_app_id(&conn, 50).unwrap().unwrap();
        assert_eq!(game.app_id, 50);
        assert_eq!(game.name, "Adventure Explorer");
        // Single-game queries don't populate genres (they live in the junction table).
        // Verify the genre association via a genre query.
        let adventure = query_by_genre(&conn, "Adventure", 24, 0).unwrap();
        assert!(adventure.iter().any(|g| g.app_id == 50));
    }

    #[test]
    fn test_query_by_app_id_not_found() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let game = query_by_app_id(&conn, 99999).unwrap();
        assert!(game.is_none());
    }

    // ── Query by genre ──

    #[test]
    fn test_query_by_genre_action() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let games = query_by_genre(&conn, "Action", 24, 0).unwrap();
        assert!(games.len() >= 3, "should find Action Alpha, Shooter Blaster, Action Fighter, got {}", games.len());
        for g in &games {
            assert_eq!(g.genres, vec!["Action".to_string()]);
        }
    }

    #[test]
    fn test_query_by_genre_pagination() {
        let conn = test_conn();
        let records: Vec<SteamCatalogRecord> = (1..=50)
            .map(|i| make_record(i, &format!("Game {}", i), &["Racing"]))
            .collect();
        import_catalog_inner(&conn, &make_artifact(records), "x").unwrap();

        let page1 = query_by_genre(&conn, "Racing", 24, 0).unwrap();
        assert_eq!(page1.len(), 24, "page 1 should have 24 items");

        let page2 = query_by_genre(&conn, "Racing", 24, 24).unwrap();
        assert_eq!(page2.len(), 24, "page 2 should have 24 items");

        let page3 = query_by_genre(&conn, "Racing", 24, 48).unwrap();
        assert_eq!(page3.len(), 2, "page 3 should have 2 items (50-48)");

        let ids1: Vec<u32> = page1.iter().map(|g| g.app_id).collect();
        let ids2: Vec<u32> = page2.iter().map(|g| g.app_id).collect();
        let ids3: Vec<u32> = page3.iter().map(|g| g.app_id).collect();
        let mut all_ids = ids1;
        all_ids.extend(ids2);
        all_ids.extend(ids3);
        all_ids.sort();
        all_ids.dedup();
        assert_eq!(all_ids.len(), 50, "no duplicates across pages");
    }

    #[test]
    fn test_no_duplicate_appids_across_genre_query() {
        let conn = test_conn();
        let records = vec![
            make_record(1, "Multi Genre", &["Action", "Indie"]),
        ];
        import_catalog_inner(&conn, &make_artifact(records), "x").unwrap();

        let action_games = query_by_genre(&conn, "Action", 24, 0).unwrap();
        let indie_games = query_by_genre(&conn, "Indie", 24, 0).unwrap();
        assert_eq!(action_games.len(), 1);
        assert_eq!(indie_games.len(), 1);
        assert_eq!(action_games[0].app_id, indie_games[0].app_id);
    }

    // ── Search ──

    #[test]
    fn test_query_search_exact() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_search(&conn, "adventure explorer", 24).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].app_id, 50);
    }

    #[test]
    fn test_query_search_partial() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_search(&conn, "adv", 24).unwrap();
        assert!(results.len() >= 2, "should match Adventure Explorer and Adventure Wanderer");
    }

    #[test]
    fn test_query_search_no_results() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_search(&conn, "zzz_nonexistent", 24).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_query_search_ordered_by_review_count() {
        let conn = test_conn();
        let records = vec![
            make_record(1, "Alpha Test", &["Action"]),
            make_record(2, "Alpha Test Two", &["Action"]),
        ];
        let mut r1 = records[0].clone();
        r1.review_count = 100;
        let mut r2 = records[1].clone();
        r2.review_count = 5000;
        let artifact = make_artifact(vec![r1, r2]);
        import_catalog_inner(&conn, &artifact, "x").unwrap();
        let results = query_search(&conn, "alpha", 24).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].app_id, 2, "higher review count first");
        assert_eq!(results[1].app_id, 1);
    }

    // ── Featured ──

    #[test]
    fn test_query_featured_filters_low_reviews() {
        let conn = test_conn();
        let mut high_review = make_record(1, "High Review", &["Action"]);
        high_review.review_count = 5000;
        high_review.review_percent = 95;
        let mut low_review = make_record(2, "Low Review", &["Action"]);
        low_review.review_count = 5;
        low_review.review_percent = 99;
        import_catalog_inner(&conn, &make_artifact(vec![high_review, low_review]), "x").unwrap();
        let featured = query_featured(&conn, 24).unwrap();
        assert_eq!(featured.len(), 1);
        assert_eq!(featured[0].app_id, 1);
    }

    #[test]
    fn test_query_featured_requires_image() {
        let conn = test_conn();
        let mut with_image = make_record(1, "Has Image", &["Indie"]);
        with_image.review_count = 1000;
        with_image.review_percent = 90;
        with_image.header_image = "https://example.com/header.jpg".to_string();
        let mut no_image = make_record(2, "No Image", &["Indie"]);
        no_image.review_count = 1000;
        no_image.review_percent = 90;
        no_image.header_image = String::new();
        import_catalog_inner(&conn, &make_artifact(vec![with_image, no_image]), "x").unwrap();
        let featured = query_featured(&conn, 24).unwrap();
        assert_eq!(featured.len(), 1);
        assert_eq!(featured[0].app_id, 1);
    }

    // ── New & Noteworthy ──

    #[test]
    fn test_query_new_noteworthy_recent_games() {
        let conn = test_conn();
        let now_secs = chrono_now_ts() / 1000;
        let mut recent = make_record(1, "Recent Game", &["Indie"]);
        recent.release_timestamp = now_secs as i64 - 30 * 24 * 3600;
        recent.review_count = 200;
        recent.coming_soon = false;
        let mut old = make_record(2, "Old Game", &["Indie"]);
        old.release_timestamp = now_secs as i64 - 400 * 24 * 3600;
        old.review_count = 10;
        old.coming_soon = false;
        import_catalog_inner(&conn, &make_artifact(vec![recent, old]), "x").unwrap();
        let results = query_new_noteworthy(&conn, 24).unwrap();
        assert!(results.iter().any(|g| g.app_id == 1));
        assert!(!results.iter().any(|g| g.app_id == 2), "old game should not appear");
    }

    #[test]
    fn test_query_new_noteworthy_excludes_coming_soon() {
        let conn = test_conn();
        let now_secs = chrono_now_ts() / 1000;
        let mut released = make_record(1, "Released", &["Action"]);
        released.release_timestamp = now_secs as i64 - 100;
        released.coming_soon = false;
        let mut upcoming = make_record(2, "Upcoming", &["Action"]);
        upcoming.release_timestamp = now_secs as i64 + 100000;
        upcoming.coming_soon = true;
        import_catalog_inner(&conn, &make_artifact(vec![released, upcoming]), "x").unwrap();
        let results = query_new_noteworthy(&conn, 24).unwrap();
        assert!(results.iter().any(|g| g.app_id == 1));
        assert!(!results.iter().any(|g| g.app_id == 2));
    }

    // ── Genre isolation ──

    #[test]
    fn test_categories_cannot_satisfy_genre_filter() {
        let conn = test_conn();
        let mut record = make_record(1, "Shooter Only", &[]);
        record.categories = vec!["Action".to_string()];
        import_catalog_inner(&conn, &make_artifact(vec![record]), "x").unwrap();
        let action_games = query_by_genre(&conn, "Action", 24, 0).unwrap();
        assert_eq!(action_games.len(), 0, "categories should not match genre filter");
    }

    #[test]
    fn test_empty_genre_query_returns_nothing() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_genre(&conn, "NonExistentGenre", 24, 0).unwrap();
        assert_eq!(results.len(), 0);
    }

    // ── Meta before import ──

    #[test]
    fn test_meta_before_import() {
        let conn = test_conn();
        let meta = get_meta(&conn).unwrap().unwrap();
        assert!(!meta.has_catalog);
        assert_eq!(meta.record_count, 0);
        assert_eq!(meta.game_count, 0);
        assert_eq!(meta.schema_version, 0);
        assert_eq!(meta.catalog_version, 0);
    }

    // ── Checksum stored correctly ──

    #[test]
    fn test_checksum_preserved() {
        let conn = test_conn();
        import_catalog_inner(&conn, &build_test_artifact(), "my_checksum_42").unwrap();
        let meta = get_meta(&conn).unwrap().unwrap();
        assert_eq!(meta.checksum, "my_checksum_42");
    }

    // ── Hidden Gems ──

    #[test]
    fn test_hidden_gems_high_review_moderate_count() {
        let conn = test_conn();
        let mut gem = make_record(1, "Hidden Gem", &["Indie"]);
        gem.review_percent = 92;
        gem.review_count = 300;
        gem.header_image = "https://example.com/gem.jpg".to_string();
        let mut too_many = make_record(2, "Too Popular", &["Indie"]);
        too_many.review_percent = 95;
        too_many.review_count = 8000;
        too_many.header_image = "https://example.com/pop.jpg".to_string();
        let mut too_few = make_record(3, "Too Few", &["Indie"]);
        too_few.review_percent = 70;
        too_few.review_count = 30;
        too_few.header_image = "https://example.com/low.jpg".to_string();
        let mut no_image = make_record(4, "No Image", &["Indie"]);
        no_image.review_percent = 95;
        no_image.review_count = 200;
        no_image.header_image = "".to_string();
        import_catalog_inner(&conn, &make_artifact(vec![gem, too_many, too_few, no_image]), "x").unwrap();
        let results = query_hidden_gems(&conn, 24).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].app_id, 1);
    }

    #[test]
    fn test_hidden_gems_boundary_review_count() {
        let conn = test_conn();
        let mut at_min = make_record(1, "At Min", &["RPG"]);
        at_min.review_percent = 90;
        at_min.review_count = 50;
        at_min.header_image = "https://example.com/min.jpg".to_string();
        let mut at_max = make_record(2, "At Max", &["RPG"]);
        at_max.review_percent = 88;
        at_max.review_count = 5000;
        at_max.header_image = "https://example.com/max.jpg".to_string();
        let mut below_min = make_record(3, "Below Min", &["RPG"]);
        below_min.review_percent = 95;
        below_min.review_count = 49;
        below_min.header_image = "https://example.com/below.jpg".to_string();
        let mut above_max = make_record(4, "Above Max", &["RPG"]);
        above_max.review_percent = 95;
        above_max.review_count = 5001;
        above_max.header_image = "https://example.com/above.jpg".to_string();
        import_catalog_inner(&conn, &make_artifact(vec![at_min, at_max, below_min, above_max]), "x").unwrap();
        let results = query_hidden_gems(&conn, 24).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().any(|g| g.app_id == 1));
        assert!(results.iter().any(|g| g.app_id == 2));
    }

    // ── Top Rated ──

    #[test]
    fn test_top_rated_by_review_count() {
        let conn = test_conn();
        let mut high = make_record(1, "High", &["Action"]);
        high.review_percent = 95;
        high.review_count = 1000;
        high.header_image = "https://example.com/high.jpg".to_string();
        let mut low = make_record(2, "Low", &["Action"]);
        low.review_percent = 70;
        low.review_count = 100;
        low.header_image = "https://example.com/low.jpg".to_string();
        let mut few_reviews = make_record(3, "Few Reviews", &["Action"]);
        few_reviews.review_percent = 99;
        few_reviews.review_count = 50;
        few_reviews.header_image = "https://example.com/few.jpg".to_string();
        import_catalog_inner(&conn, &make_artifact(vec![high, low, few_reviews]), "x").unwrap();
        let results = query_top_rated(&conn, 24).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].app_id, 1);
    }

    // ── Cult Classics ──

    #[test]
    fn test_cult_classics_old_high_quality() {
        let conn = test_conn();
        let now_secs = chrono_now_ts() / 1000;
        let mut classic = make_record(1, "Cult Classic", &["RPG"]);
        classic.review_percent = 92;
        classic.review_count = 2000;
        classic.release_timestamp = now_secs as i64 - 3 * 365 * 24 * 3600; // 3 years old
        classic.header_image = "https://example.com/classic.jpg".to_string();
        let mut too_new = make_record(2, "Too New", &["RPG"]);
        too_new.review_percent = 92;
        too_new.review_count = 2000;
        too_new.release_timestamp = now_secs as i64 - 6 * 30 * 24 * 3600; // 6 months
        too_new.header_image = "https://example.com/new.jpg".to_string();
        let mut not_classic = make_record(3, "Not Classic", &["RPG"]);
        not_classic.review_percent = 92;
        not_classic.review_count = 200;
        not_classic.release_timestamp = now_secs as i64 - 3 * 365 * 24 * 3600;
        not_classic.header_image = "https://example.com/notclassic.jpg".to_string();
        import_catalog_inner(&conn, &make_artifact(vec![classic, too_new, not_classic]), "x").unwrap();
        let results = query_cult_classics(&conn, 24).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].app_id, 1);
    }
}
