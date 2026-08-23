use rusqlite::Connection;

use super::SqliteCoreDb;
use crate::models::game_cache::{
    MediaManifestEntry, MediaManifestFile, MediaManifestFiles,
};

// ---------------------------------------------------------------------------
// MediaManifests — SQLite backing for per-game media_manifest.json files.
// ---------------------------------------------------------------------------

struct ManifestRow {
    provider: String,
    version: i64,
    updated_at: i64,
    cover_path: Option<String>,
    cover_exists: i64,
    cover_size: Option<i64>,
    cover_modified_at: Option<i64>,
    landscape_path: Option<String>,
    landscape_exists: i64,
    landscape_size: Option<i64>,
    landscape_modified_at: Option<i64>,
    background_path: Option<String>,
    background_exists: i64,
    background_size: Option<i64>,
    background_modified_at: Option<i64>,
    logo_path: Option<String>,
    logo_exists: i64,
    logo_size: Option<i64>,
    logo_modified_at: Option<i64>,
    icon_path: Option<String>,
    icon_exists: i64,
    icon_size: Option<i64>,
    icon_modified_at: Option<i64>,
    fingerprints_json: String,
}

fn row_to_manifest(app_id: &str, row: ManifestRow) -> MediaManifestFile {
    let entry = |path: Option<String>, exists: i64, size: Option<i64>, mod_at: Option<i64>| {
        MediaManifestEntry {
            path: path.unwrap_or_default(),
            exists: exists != 0,
            size: size.map(|v| v as u64),
            modified_at: mod_at.map(|v| v as u64),
        }
    };

    MediaManifestFile {
        provider: row.provider,
        appid: app_id.to_string(),
        version: row.version as u32,
        updated_at: row.updated_at as u64,
        files: MediaManifestFiles {
            cover: entry(row.cover_path, row.cover_exists, row.cover_size, row.cover_modified_at),
            landscape: entry(row.landscape_path, row.landscape_exists, row.landscape_size, row.landscape_modified_at),
            background: entry(row.background_path, row.background_exists, row.background_size, row.background_modified_at),
            logo: entry(row.logo_path, row.logo_exists, row.logo_size, row.logo_modified_at),
            icon: entry(row.icon_path, row.icon_exists, row.icon_size, row.icon_modified_at),
        },
        fingerprints: serde_json::from_str(&row.fingerprints_json).ok().flatten(),
    }
}

fn read_manifest_row(conn: &Connection, app_id: &str) -> Option<ManifestRow> {
    conn.query_row(
        "SELECT provider, version, updated_at, \
         cover_path, cover_exists, cover_size, cover_modified_at, \
         landscape_path, landscape_exists, landscape_size, landscape_modified_at, \
         background_path, background_exists, background_size, background_modified_at, \
         logo_path, logo_exists, logo_size, logo_modified_at, \
         icon_path, icon_exists, icon_size, icon_modified_at, \
         fingerprints_json \
         FROM media_manifests WHERE app_id = ?1",
        [app_id],
        |row| {
            Ok(ManifestRow {
                provider: row.get(0)?,
                version: row.get(1)?,
                updated_at: row.get(2)?,
                cover_path: row.get(3)?,
                cover_exists: row.get(4)?,
                cover_size: row.get(5)?,
                cover_modified_at: row.get(6)?,
                landscape_path: row.get(7)?,
                landscape_exists: row.get(8)?,
                landscape_size: row.get(9)?,
                landscape_modified_at: row.get(10)?,
                background_path: row.get(11)?,
                background_exists: row.get(12)?,
                background_size: row.get(13)?,
                background_modified_at: row.get(14)?,
                logo_path: row.get(15)?,
                logo_exists: row.get(16)?,
                logo_size: row.get(17)?,
                logo_modified_at: row.get(18)?,
                icon_path: row.get(19)?,
                icon_exists: row.get(20)?,
                icon_size: row.get(21)?,
                icon_modified_at: row.get(22)?,
                fingerprints_json: row.get(23)?,
            })
        },
    )
    .ok()
}

/// Read a single media manifest.
pub fn read_media_manifest_sqlite(
    db: &SqliteCoreDb,
    app_id: &str,
) -> Option<MediaManifestFile> {
    let conn_ref = db.0.as_ref()?;
    let conn = conn_ref.lock().unwrap();
    let row = read_manifest_row(&conn, app_id)?;
    Some(row_to_manifest(app_id, row))
}

/// Read multiple media manifests in a single query.
pub fn read_media_manifests_batch_sqlite(
    db: &SqliteCoreDb,
    app_ids: &[String],
) -> std::collections::HashMap<String, MediaManifestFile> {
    let conn_ref = match db.0.as_ref() {
        Some(db) => db,
        None => return std::collections::HashMap::new(),
    };
    let conn = conn_ref.lock().unwrap();
    let mut result = std::collections::HashMap::new();

    for chunk in app_ids.chunks(500) {
        let placeholders: Vec<String> = chunk.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT app_id, provider, version, updated_at, \
             cover_path, cover_exists, cover_size, cover_modified_at, \
             landscape_path, landscape_exists, landscape_size, landscape_modified_at, \
             background_path, background_exists, background_size, background_modified_at, \
             logo_path, logo_exists, logo_size, logo_modified_at, \
             icon_path, icon_exists, icon_size, icon_modified_at, \
             fingerprints_json \
             FROM media_manifests WHERE app_id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let params: Vec<&dyn rusqlite::types::ToSql> =
            chunk.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();

        let rows = stmt.query_map(params.as_slice(), |row| {
            let app_id: String = row.get(0)?;
            Ok((
                app_id,
                ManifestRow {
                    provider: row.get(1)?,
                    version: row.get(2)?,
                    updated_at: row.get(3)?,
                    cover_path: row.get(4)?,
                    cover_exists: row.get(5)?,
                    cover_size: row.get(6)?,
                    cover_modified_at: row.get(7)?,
                    landscape_path: row.get(8)?,
                    landscape_exists: row.get(9)?,
                    landscape_size: row.get(10)?,
                    landscape_modified_at: row.get(11)?,
                    background_path: row.get(12)?,
                    background_exists: row.get(13)?,
                    background_size: row.get(14)?,
                    background_modified_at: row.get(15)?,
                    logo_path: row.get(16)?,
                    logo_exists: row.get(17)?,
                    logo_size: row.get(18)?,
                    logo_modified_at: row.get(19)?,
                    icon_path: row.get(20)?,
                    icon_exists: row.get(21)?,
                    icon_size: row.get(22)?,
                    icon_modified_at: row.get(23)?,
                    fingerprints_json: row.get(24)?,
                },
            ))
        });

        if let Ok(rows) = rows {
            for row_result in rows.flatten() {
                let (app_id, mrow) = row_result;
                result.insert(app_id.clone(), row_to_manifest(&app_id, mrow));
            }
        }
    }

    result
}

/// Write (upsert) a media manifest to SQLite.
pub fn write_media_manifest_sqlite(
    db: &SqliteCoreDb,
    manifest: &MediaManifestFile,
) -> Result<(), String> {
    let conn_ref = db.0.as_ref().ok_or("Database not available")?;
    let conn = conn_ref.lock().map_err(|e| format!("Lock error: {}", e))?;

    let fp_json = manifest
        .fingerprints
        .as_ref()
        .map(|f| serde_json::to_string(f).unwrap_or_default())
        .unwrap_or_else(|| "{}".to_string());

    let e = |entry: &MediaManifestEntry| -> (String, i64, Option<i64>, Option<i64>) {
        (
            entry.path.clone(),
            entry.exists as i64,
            entry.size.map(|v| v as i64),
            entry.modified_at.map(|v| v as i64),
        )
    };

    let (c_path, c_exists, c_size, c_mod) = e(&manifest.files.cover);
    let (l_path, l_exists, l_size, l_mod) = e(&manifest.files.landscape);
    let (b_path, b_exists, b_size, b_mod) = e(&manifest.files.background);
    let (lo_path, lo_exists, lo_size, lo_mod) = e(&manifest.files.logo);
    let (i_path, i_exists, i_size, i_mod) = e(&manifest.files.icon);

    conn.execute(
        "INSERT OR REPLACE INTO media_manifests \
         (app_id, provider, version, updated_at, \
          cover_path, cover_exists, cover_size, cover_modified_at, \
          landscape_path, landscape_exists, landscape_size, landscape_modified_at, \
          background_path, background_exists, background_size, background_modified_at, \
          logo_path, logo_exists, logo_size, logo_modified_at, \
          icon_path, icon_exists, icon_size, icon_modified_at, \
          fingerprints_json) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
        rusqlite::params![
            manifest.appid,
            manifest.provider,
            manifest.version as i64,
            manifest.updated_at as i64,
            c_path, c_exists, c_size, c_mod,
            l_path, l_exists, l_size, l_mod,
            b_path, b_exists, b_size, b_mod,
            lo_path, lo_exists, lo_size, lo_mod,
            i_path, i_exists, i_size, i_mod,
            fp_json,
        ],
    )
    .map_err(|e| format!("Upsert media_manifest: {}", e))?;

    Ok(())
}
