use crate::commands::sqlite_cache::SqliteStoreDb;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

// ── Types ──

/// Repack catalog record — matches the TS RepackCatalogRecord type (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackCatalogRecord {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub app_id: u32,
    pub repacker: String,
    #[serde(default)]
    pub repack_group: Option<String>,
    pub installer_type: String,
    pub file_size: i64,
    #[serde(default)]
    pub install_size: Option<i64>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub selective_features: Vec<String>,
    #[serde(default)]
    pub download_uris: Vec<String>,
    pub source_url: String,
    pub source: String,
    #[serde(default)]
    pub checksum: Option<String>,
    pub updated_at: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Repack catalog artifact wrapper (the JSON file structure).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackCatalogArtifact {
    pub schema_version: u32,
    pub generated_at: String,
    pub records: Vec<RepackCatalogRecord>,
}

/// Repack query result — returned to TS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackQueryResult {
    pub id: String,
    pub title: String,
    pub app_id: u32,
    pub repacker: String,
    pub installer_type: String,
    pub file_size: i64,
    pub install_size: Option<i64>,
    pub languages: Vec<String>,
    pub download_uris: Vec<String>,
    pub source_url: String,
    pub checksum: Option<String>,
    pub updated_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackCatalogMeta {
    pub has_catalog: bool,
    pub schema_version: u32,
    pub record_count: u32,
    pub games_with_app_id: u32,
    pub checksum: String,
    pub imported_at: String,
}

/// Repacker aggregate (distinct repacker + entry count) — returned to TS for filter chips.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepackGroupStat {
    pub repacker: String,
    pub count: i64,
}

// ── Table creation (DDL body lives in sqlite_cache; delegating here) ──

pub fn create_repack_tables(conn: &Connection) -> SqliteResult<()> {
    super::sqlite_cache::repack_tables(conn)
}

// ── Internal import logic ──

fn import_repack_catalog_inner(
    conn: &Connection,
    artifact: &RepackCatalogArtifact,
    checksum: &str,
) -> SqliteResult<u32> {
    let tx = conn.unchecked_transaction()?;

    // Ensure tables exist (no-op if already created by boot init)
    create_repack_tables(&tx)?;

    // MERGE: upsert bundled records via INSERT OR REPLACE.
    // User-imported feeds (Hydra/paste) are preserved — only IDs present in
    // the artifact get overwritten; all other rows remain untouched.
    let mut merged: u32 = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO repack_catalog (
                id, title, normalized_title, app_id, repacker, repack_group,
                installer_type, file_size, install_size,
                languages_json, selective_json, download_uris_json,
                source_url, source, checksum, updated_at, tags_json,
                import_version
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        )?;

        for record in &artifact.records {
            let normalized_title = record.title.to_lowercase()
                .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), "")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");

            let languages_json = serde_json::to_string(&record.languages).unwrap_or_default();
            let selective_json = serde_json::to_string(&record.selective_features).unwrap_or_default();
            let download_uris_json = serde_json::to_string(&record.download_uris).unwrap_or_default();
            let tags_json = serde_json::to_string(&record.tags).unwrap_or_default();

            stmt.execute(params![
                record.id,
                record.title,
                normalized_title,
                record.app_id,
                record.repacker,
                record.repack_group,
                record.installer_type,
                record.file_size,
                record.install_size,
                languages_json,
                selective_json,
                download_uris_json,
                record.source_url,
                record.source,
                record.checksum,
                record.updated_at,
                tags_json,
                artifact.schema_version as i32,
            ])?;
            merged += 1;
        }
    }

    // Meta — record total count across ALL sources (bundled + user-imported)
    let total_count: u32 = tx.query_row(
        "SELECT COUNT(*) FROM repack_catalog", [], |r| r.get(0),
    )?;
    let games_with_app_id: u32 = tx.query_row(
        "SELECT COUNT(*) FROM repack_catalog WHERE app_id > 0", [], |r| r.get(0),
    )?;
    let meta_pairs = [
        ("schema_version", artifact.schema_version.to_string()),
        ("record_count", total_count.to_string()),
        ("games_with_app_id", games_with_app_id.to_string()),
        ("checksum", checksum.to_string()),
        ("imported_at", chrono_now()),
    ];
    for (k, v) in &meta_pairs {
        tx.execute(
            "INSERT OR REPLACE INTO repack_catalog_meta (key, value) VALUES (?1, ?2)",
            params![k, v],
        )?;
    }

    tx.commit()?;
    Ok(merged)
}

// ── Queries ──

fn query_by_fuzzy_title(conn: &Connection, query: &str, limit: u32) -> SqliteResult<Vec<RepackQueryResult>> {
    let normalized = query.to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let mut stmt = conn.prepare(
        "SELECT id, title, app_id, repacker, installer_type, file_size, install_size,
                languages_json, download_uris_json, source_url, checksum, updated_at, tags_json
         FROM repack_catalog
         WHERE normalized_title LIKE '%' || ?1 || '%'
         ORDER BY
            CASE WHEN app_id > 0 THEN 0 ELSE 1 END,
            length(normalized_title) ASC
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![normalized, limit], |row| parse_repack_row(row))?;
    rows.collect()
}

/// Fuzzy title search constrained to a single repacker (case-insensitive).
fn query_by_repacker_fuzzy_title(
    conn: &Connection,
    repacker: &str,
    query: &str,
    limit: u32,
) -> SqliteResult<Vec<RepackQueryResult>> {
    let normalized = query.to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let mut stmt = conn.prepare(
        "SELECT id, title, app_id, repacker, installer_type, file_size, install_size,
                languages_json, download_uris_json, source_url, checksum, updated_at, tags_json
         FROM repack_catalog
         WHERE lower(repacker) = lower(?1)
           AND normalized_title LIKE '%' || ?2 || '%'
         ORDER BY
            CASE WHEN app_id > 0 THEN 0 ELSE 1 END,
            length(normalized_title) ASC
         LIMIT ?3",
    )?;

    let rows = stmt.query_map(params![repacker, normalized, limit], |row| parse_repack_row(row))?;
    rows.collect()
}

fn query_by_app_id(conn: &Connection, app_id: u32) -> SqliteResult<Vec<RepackQueryResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, app_id, repacker, installer_type, file_size, install_size,
                languages_json, download_uris_json, source_url, checksum, updated_at, tags_json
         FROM repack_catalog
         WHERE app_id = ?1
         ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map(params![app_id], |row| parse_repack_row(row))?;
    rows.collect()
}

fn query_all(conn: &Connection) -> SqliteResult<Vec<RepackQueryResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, app_id, repacker, installer_type, file_size, install_size,
                languages_json, download_uris_json, source_url, checksum, updated_at, tags_json
         FROM repack_catalog
         ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| parse_repack_row(row))?;
    rows.collect()
}

fn query_by_repacker(conn: &Connection, repacker: &str, limit: u32, offset: u32) -> SqliteResult<Vec<RepackQueryResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, app_id, repacker, installer_type, file_size, install_size,
                languages_json, download_uris_json, source_url, checksum, updated_at, tags_json
         FROM repack_catalog
         WHERE lower(repacker) = lower(?1)
         ORDER BY updated_at DESC
         LIMIT ?2 OFFSET ?3",
    )?;

    let rows = stmt.query_map(params![repacker, limit, offset], |row| parse_repack_row(row))?;
    rows.collect()
}

/// Distinct repacker names with entry counts, sorted by count descending.
fn query_repacker_groups(conn: &Connection) -> SqliteResult<Vec<RepackGroupStat>> {
    let mut stmt = conn.prepare(
        "SELECT repacker, COUNT(*) AS count
         FROM repack_catalog
         WHERE repacker <> ''
         GROUP BY lower(repacker)
         ORDER BY count DESC, lower(repacker) ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(RepackGroupStat {
            repacker: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    rows.collect()
}

/// Paged query over the whole catalog (for browse-all without a repacker filter).
fn query_page(conn: &Connection, limit: u32, offset: u32) -> SqliteResult<Vec<RepackQueryResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, app_id, repacker, installer_type, file_size, install_size,
                languages_json, download_uris_json, source_url, checksum, updated_at, tags_json
         FROM repack_catalog
         ORDER BY
            CASE WHEN app_id > 0 THEN 0 ELSE 1 END,
            updated_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;

    let rows = stmt.query_map(params![limit, offset], |row| parse_repack_row(row))?;
    rows.collect()
}

fn get_meta(conn: &Connection) -> SqliteResult<RepackCatalogMeta> {
    let mut stmt = conn.prepare("SELECT key, value FROM repack_catalog_meta")?;
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
        return Ok(RepackCatalogMeta {
            has_catalog: false,
            schema_version: 0,
            record_count: 0,
            games_with_app_id: 0,
            checksum: String::new(),
            imported_at: String::new(),
        });
    }
    Ok(RepackCatalogMeta {
        has_catalog: true,
        schema_version: map.get("schema_version").and_then(|v| v.parse().ok()).unwrap_or(0),
        record_count: map.get("record_count").and_then(|v| v.parse().ok()).unwrap_or(0),
        games_with_app_id: map.get("games_with_app_id").and_then(|v| v.parse().ok()).unwrap_or(0),
        checksum: map.get("checksum").cloned().unwrap_or_default(),
        imported_at: map.get("imported_at").cloned().unwrap_or_default(),
    })
}

fn parse_repack_row(row: &rusqlite::Row<'_>) -> Result<RepackQueryResult, rusqlite::Error> {
    let languages_json: String = row.get(7)?;
    let download_uris_json: String = row.get(8)?;
    let tags_json: String = row.get(12)?;

    Ok(RepackQueryResult {
        id: row.get(0)?,
        title: row.get(1)?,
        app_id: row.get(2)?,
        repacker: row.get(3)?,
        installer_type: row.get(4)?,
        file_size: row.get(5)?,
        install_size: row.get(6)?,
        languages: serde_json::from_str(&languages_json).unwrap_or_default(),
        download_uris: serde_json::from_str(&download_uris_json).unwrap_or_default(),
        source_url: row.get(9)?,
        checksum: row.get(10)?,
        updated_at: row.get(11)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
    })
}

// ── Tauri commands ──

#[tauri::command]
pub fn get_repack_catalog_meta(
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<RepackCatalogMeta, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(RepackCatalogMeta {
            has_catalog: false, schema_version: 0, record_count: 0,
            games_with_app_id: 0, checksum: String::new(), imported_at: String::new(),
        }),
    };
    get_meta(&guard).map_err(|e| format!("Repack meta query error: {}", e))
}

#[tauri::command]
pub fn import_repack_catalog(
    artifact_json: String,
    checksum: String,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<u32, String> {
    let artifact: RepackCatalogArtifact = serde_json::from_str(&artifact_json)
        .map_err(|e| format!("Failed to parse repack artifact: {}", e))?;
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Err("Database not available".to_string()),
    };
    let count = import_repack_catalog_inner(&guard, &artifact, &checksum)
        .map_err(|e| format!("Repack catalog import error: {}", e))?;
    Ok(count)
}

#[tauri::command]
pub fn query_repack_catalog_fuzzy(
    query: String,
    limit: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackQueryResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_by_fuzzy_title(&guard, &query, limit)
        .map_err(|e| format!("Repack fuzzy query error: {}", e))
}

#[tauri::command]
pub fn query_repack_catalog_by_repacker_fuzzy(
    repacker: String,
    query: String,
    limit: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackQueryResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_by_repacker_fuzzy_title(&guard, &repacker, &query, limit)
        .map_err(|e| format!("Repack fuzzy by repacker query error: {}", e))
}

#[tauri::command]
pub fn query_repack_catalog_by_app_id(
    app_id: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackQueryResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_by_app_id(&guard, app_id)
        .map_err(|e| format!("Repack by app_id query error: {}", e))
}

#[tauri::command]
pub fn query_repack_catalog_all(
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackQueryResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_all(&guard).map_err(|e| format!("Repack all query error: {}", e))
}

#[tauri::command]
pub fn query_repack_catalog_by_repacker(
    repacker: String,
    limit: u32,
    offset: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackQueryResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_by_repacker(&guard, &repacker, limit, offset)
        .map_err(|e| format!("Repack by repacker query error: {}", e))
}

#[tauri::command]
pub fn query_repack_catalog_page(
    limit: u32,
    offset: u32,
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackQueryResult>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_page(&guard, limit, offset)
        .map_err(|e| format!("Repack page query error: {}", e))
}

#[tauri::command]
pub fn query_repack_repackers(
    db: tauri::State<'_, SqliteStoreDb>,
) -> Result<Vec<RepackGroupStat>, String> {
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(Vec::new()),
    };
    query_repacker_groups(&guard)
        .map_err(|e| format!("Repack repackers query error: {}", e))
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

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        create_repack_tables(&conn).unwrap();
        conn
    }

    fn make_record(id: &str, title: &str, app_id: u32, repacker: &str) -> RepackCatalogRecord {
        RepackCatalogRecord {
            id: id.to_string(),
            title: title.to_string(),
            app_id,
            repacker: repacker.to_string(),
            repack_group: None,
            installer_type: "sfx".to_string(),
            file_size: 30_000_000_000,
            install_size: Some(50_000_000_000),
            languages: vec!["en".to_string(), "es".to_string()],
            selective_features: vec![],
            download_uris: vec![],
            source_url: format!("https://example.com/{}", id),
            source: "manual-curation".to_string(),
            checksum: None,
            updated_at: "2025-01-01T00:00:00Z".to_string(),
            tags: vec!["repack".to_string(), repacker.to_string()],
        }
    }

    fn make_artifact(records: Vec<RepackCatalogRecord>) -> RepackCatalogArtifact {
        RepackCatalogArtifact {
            schema_version: 1,
            generated_at: "2025-01-01T00:00:00Z".to_string(),
            records,
        }
    }

    fn build_test_artifact() -> RepackCatalogArtifact {
        make_artifact(vec![
            make_record("fitgirl-1091500", "Cyberpunk 2077", 1091500, "fitgirl"),
            make_record("dodi-1086940", "Baldur's Gate 3", 1086940, "dodi"),
            make_record("fitgirl-1245620", "Elden Ring", 1245620, "fitgirl"),
            make_record("elamigos-990080", "Hogwarts Legacy", 990080, "elamigos"),
            make_record("fitgirl-0", "Some Non-Steam Game", 0, "fitgirl"),
        ])
    }

    // ── Import tests ──

    #[test]
    fn test_import_valid_artifact() {
        let conn = test_conn();
        let artifact = build_test_artifact();
        let count = import_repack_catalog_inner(&conn, &artifact, "abc123").unwrap();
        assert_eq!(count, 5);
        let meta = get_meta(&conn).unwrap();
        assert!(meta.has_catalog);
        assert_eq!(meta.record_count, 5);
        assert_eq!(meta.games_with_app_id, 4);
    }

    #[test]
    fn test_import_empty_artifact() {
        let conn = test_conn();
        let artifact = make_artifact(vec![]);
        let count = import_repack_catalog_inner(&conn, &artifact, "empty").unwrap();
        assert_eq!(count, 0);
        let meta = get_meta(&conn).unwrap();
        assert!(meta.has_catalog);
        assert_eq!(meta.record_count, 0);
    }

    #[test]
    fn test_import_merges_preserving_existing() {
        let conn = test_conn();
        let first = make_artifact(vec![make_record("fg-1", "Game One", 1, "fitgirl")]);
        import_repack_catalog_inner(&conn, &first, "v1").unwrap();
        assert_eq!(get_meta(&conn).unwrap().record_count, 1);

        let second = make_artifact(vec![
            make_record("fg-2", "Game Two", 2, "fitgirl"),
            make_record("fg-3", "Game Three", 3, "fitgirl"),
        ]);
        import_repack_catalog_inner(&conn, &second, "v2").unwrap();
        // MERGE preserves the old record (fg-1) — total is 3
        assert_eq!(get_meta(&conn).unwrap().record_count, 3);

        let games = query_by_app_id(&conn, 1).unwrap();
        assert_eq!(games.len(), 1, "old record preserved by merge");
    }

    #[test]
    fn test_import_upserts_overlapping_ids() {
        let conn = test_conn();
        let first = make_artifact(vec![make_record("fg-1", "Old Name", 1, "fitgirl")]);
        import_repack_catalog_inner(&conn, &first, "v1").unwrap();

        let second = make_artifact(vec![make_record("fg-1", "New Name", 1, "fitgirl")]);
        import_repack_catalog_inner(&conn, &second, "v2").unwrap();

        let games = query_by_app_id(&conn, 1).unwrap();
        assert_eq!(games.len(), 1, "only one row after upsert");
        assert_eq!(games[0].title, "New Name", "overwritten with new data");
    }

    // ── Fuzzy search ──

    #[test]
    fn test_fuzzy_exact_match() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_fuzzy_title(&conn, "Cyberpunk 2077", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "fitgirl-1091500");
    }

    #[test]
    fn test_fuzzy_partial_match() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_fuzzy_title(&conn, "cyber", 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_fuzzy_no_results() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_fuzzy_title(&conn, "zzz_nonexistent", 10).unwrap();
        assert_eq!(results.len(), 0);
    }

    // ── Query by appId ──

    #[test]
    fn test_query_by_app_id_found() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_app_id(&conn, 1091500).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "fitgirl-1091500");
    }

    #[test]
    fn test_query_by_app_id_not_found() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_app_id(&conn, 99999).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_query_by_app_id_multiple_repacks() {
        let conn = test_conn();
        let mut records = build_test_artifact().records;
        // Add a second repack for Elden Ring
        records.push(make_record("dodi-1245620", "Elden Ring (Dodi)", 1245620, "dodi"));
        let artifact = make_artifact(records);
        import_repack_catalog_inner(&conn, &artifact, "x").unwrap();

        let results = query_by_app_id(&conn, 1245620).unwrap();
        assert_eq!(results.len(), 2, "should find both FitGirl and Dodi repacks");
    }

    // ── Query by repacker ──

    #[test]
    fn test_query_by_repacker_found() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_repacker(&conn, "fitgirl", 10, 0).unwrap();
        assert!(results.len() >= 2);
        assert!(results.iter().all(|r| r.repacker == "fitgirl"));
    }

    // ── Query by repacker + fuzzy title ──

    #[test]
    fn test_query_by_repacker_fuzzy_match() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_repacker_fuzzy_title(&conn, "fitgirl", "cyberpunk", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "fitgirl-1091500");
    }

    #[test]
    fn test_query_by_repacker_fuzzy_case_insensitive_repacker() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_repacker_fuzzy_title(&conn, "FITGIRL", "eld", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "fitgirl-1245620");
    }

    #[test]
    fn test_query_by_repacker_fuzzy_excludes_other_repackers() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_repacker_fuzzy_title(&conn, "fitgirl", "bald", 10).unwrap();
        assert!(results.is_empty(), "Baldur's Gate 3 belongs to Dodi, not FitGirl");
    }

    #[test]
    fn test_query_by_repacker_fuzzy_no_results() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_repacker_fuzzy_title(&conn, "fitgirl", "zzz_nonexistent", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_query_by_repacker_pagination() {
        let conn = test_conn();
        let records: Vec<RepackCatalogRecord> = (1..=50)
            .map(|i| make_record(&format!("fg-{}", i), &format!("Game {}", i), i, "fitgirl"))
            .collect();
        import_repack_catalog_inner(&conn, &make_artifact(records), "x").unwrap();

        let page1 = query_by_repacker(&conn, "fitgirl", 20, 0).unwrap();
        assert_eq!(page1.len(), 20);
        let page2 = query_by_repacker(&conn, "fitgirl", 20, 20).unwrap();
        assert_eq!(page2.len(), 20);
        let page3 = query_by_repacker(&conn, "fitgirl", 20, 40).unwrap();
        assert_eq!(page3.len(), 10);
    }

    #[test]
    fn test_query_by_repacker_not_found() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "x").unwrap();
        let results = query_by_repacker(&conn, "nonexistent", 10, 0).unwrap();
        assert!(results.is_empty());
    }

    // ── Meta before import ──

    #[test]
    fn test_meta_before_import() {
        let conn = test_conn();
        let meta = get_meta(&conn).unwrap();
        assert!(!meta.has_catalog);
        assert_eq!(meta.record_count, 0);
    }

    // ── Checksum ──

    #[test]
    fn test_checksum_preserved() {
        let conn = test_conn();
        import_repack_catalog_inner(&conn, &build_test_artifact(), "my_checksum_42").unwrap();
        let meta = get_meta(&conn).unwrap();
        assert_eq!(meta.checksum, "my_checksum_42");
    }
}
