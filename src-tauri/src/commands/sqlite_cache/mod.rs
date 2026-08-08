use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::AppHandle;
use tauri::Manager;

pub mod achievements;
pub mod catalog_blobs;
pub mod debrid_games_cache;
pub mod game_appinfo;
pub mod games;
pub mod library_cache;
pub mod manual_games_cache;
pub mod media;
pub mod media_manifests;
pub mod metadata;
pub mod playtime;
pub mod provider_snapshot;
pub mod provider_status;
pub mod source_availability;
pub mod startup_snapshots;
pub mod store_appinfo_cache;
pub mod store_details_cache;
pub mod store_media_cache;
pub mod store_reviews;

// Re-export every command and model so existing consumers keep resolving via
// `crate::commands::sqlite_cache::<name>` (zero changes to lib.rs / callers).
// Some re-exports are unused after SQLite migration but kept for Tauri handler resolution.
#[allow(unused_imports)]
pub use achievements::{
    AchievementEntryRow, AchievementPercentageRow, AchievementSummaryRow,
    batch_get_achievement_summaries, batch_upsert_achievement_entries, get_achievement_entries,
    get_achievement_percentages, get_achievement_summary, upsert_achievement_entry,
    upsert_achievement_percentages, upsert_achievement_summary,
};
pub use catalog_blobs::{get_game_catalog_blob, upsert_game_catalog_blob};
pub use game_appinfo::{
    read_game_appinfo, read_batch_appinfo, write_game_appinfo,
    merge_and_write_appinfo, upsert_game_base,
};
pub use games::{
    GameEntry, batch_upsert_games, get_game_count, read_all_games, update_game_metadata_json,
    upsert_game,
};
pub use library_cache::{delete_library_cache, read_library_cache, write_library_cache};
pub use media::{MediaCacheEntry, get_media_cache, insert_media_cache};
pub use media_manifests::{
    read_media_manifest_sqlite, read_media_manifests_batch_sqlite, write_media_manifest_sqlite,
};
pub use metadata::{MetadataCacheEntry, get_metadata_cache, insert_metadata_cache};
pub use startup_snapshots::{
    read_startup_snapshot_sqlite, write_startup_snapshot_sqlite, clear_startup_snapshot_sqlite,
};
pub use provider_status::{
    ProviderStatusRow, get_all_provider_statuses, get_provider_status_from_db, upsert_provider_status,
};
pub use store_reviews::{
    StoreReviewRow, batch_get_store_reviews, get_store_review, upsert_store_review,
};
// Submodules are used directly by command files via crate::commands::sqlite_cache::<module>::*

// ---------------------------------------------------------------------------
// Tauri `__cmd__` handler re-exports
// ---------------------------------------------------------------------------
// `#[tauri::command]` generates `pub fn __cmd__<name>` inside each submodule.
// `tauri::generate_handler!` in lib.rs resolves the flat `sqlite_cache::<name>`
// path, which requires `__cmd__<name>` to also live at that namespace. Re-export
// every generated handler so lib.rs entries keep their existing flat paths.
pub use media::__cmd__get_media_cache;
pub use media::__cmd__insert_media_cache;
pub use metadata::__cmd__get_metadata_cache;
pub use metadata::__cmd__insert_metadata_cache;
pub use library_cache::__cmd__read_library_cache;
pub use library_cache::__cmd__write_library_cache;
pub use library_cache::__cmd__delete_library_cache;
pub use games::__cmd__upsert_game;
pub use games::__cmd__batch_upsert_games;
pub use games::__cmd__read_all_games;
pub use games::__cmd__get_game_count;
pub use games::__cmd__update_game_metadata_json;
pub use achievements::__cmd__upsert_achievement_summary;
pub use achievements::__cmd__get_achievement_summary;
pub use achievements::__cmd__batch_get_achievement_summaries;
pub use achievements::__cmd__upsert_achievement_entry;
pub use achievements::__cmd__batch_upsert_achievement_entries;
pub use achievements::__cmd__get_achievement_entries;
pub use achievements::__cmd__upsert_achievement_percentages;
pub use achievements::__cmd__get_achievement_percentages;
pub use store_reviews::__cmd__upsert_store_review;
pub use store_reviews::__cmd__get_store_review;
pub use store_reviews::__cmd__batch_get_store_reviews;
pub use provider_status::__cmd__upsert_provider_status;
pub use provider_status::__cmd__get_provider_status_from_db;
pub use provider_status::__cmd__get_all_provider_statuses;
pub use catalog_blobs::__cmd__upsert_game_catalog_blob;
pub use catalog_blobs::__cmd__get_game_catalog_blob;

// ---------------------------------------------------------------------------
// Tauri `__tauri_command_name_*` re-exports
// ---------------------------------------------------------------------------
// `#[tauri::command]` also generates `pub const fn __tauri_command_name_<name>()`
// inside each submodule. `tauri::generate_handler!` in lib.rs resolves those via
// the flat `sqlite_cache::<name>` parent path, so re-export every one of them.
pub use media::__tauri_command_name_get_media_cache;
pub use media::__tauri_command_name_insert_media_cache;
pub use metadata::__tauri_command_name_get_metadata_cache;
pub use metadata::__tauri_command_name_insert_metadata_cache;
pub use library_cache::__tauri_command_name_read_library_cache;
pub use library_cache::__tauri_command_name_write_library_cache;
pub use library_cache::__tauri_command_name_delete_library_cache;
pub use games::__tauri_command_name_upsert_game;
pub use games::__tauri_command_name_batch_upsert_games;
pub use games::__tauri_command_name_read_all_games;
pub use games::__tauri_command_name_get_game_count;
pub use games::__tauri_command_name_update_game_metadata_json;
pub use achievements::__tauri_command_name_upsert_achievement_summary;
pub use achievements::__tauri_command_name_get_achievement_summary;
pub use achievements::__tauri_command_name_batch_get_achievement_summaries;
pub use achievements::__tauri_command_name_upsert_achievement_entry;
pub use achievements::__tauri_command_name_batch_upsert_achievement_entries;
pub use achievements::__tauri_command_name_get_achievement_entries;
pub use achievements::__tauri_command_name_upsert_achievement_percentages;
pub use achievements::__tauri_command_name_get_achievement_percentages;
pub use store_reviews::__tauri_command_name_upsert_store_review;
pub use store_reviews::__tauri_command_name_get_store_review;
pub use store_reviews::__tauri_command_name_batch_get_store_reviews;
pub use provider_status::__tauri_command_name_upsert_provider_status;
pub use provider_status::__tauri_command_name_get_provider_status_from_db;
pub use provider_status::__tauri_command_name_get_all_provider_statuses;
pub use catalog_blobs::__tauri_command_name_upsert_game_catalog_blob;
pub use catalog_blobs::__tauri_command_name_get_game_catalog_blob;

// ---------------------------------------------------------------------------
// Debug flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_SQLITE_LOGS: bool = false;

// ---------------------------------------------------------------------------
// State: lazily initialized SQLite connections (split by concern)
// ---------------------------------------------------------------------------
// Three separate databases keep the volatile per-game achievement data and the
// large store catalog from contending with the core library/media caches on
// the same connection. Each struct keeps the `(pub Option<Mutex<Connection>>)`
// tuple-struct shape so submodule command wrappers (`state.0.as_ref()`) only
// need their state type name swapped to retarget to the right database.

/// Core library/media/metadata cache DB (`core.db`).
pub struct SqliteCoreDb(pub Option<Mutex<Connection>>);

/// Volatile per-game achievement progress DB (`achievements.db`).
pub struct SqliteAchievementsDb(pub Option<Mutex<Connection>>);

/// Store catalog / repack / provider-status / reviews DB (`store.db`).
pub struct SqliteStoreDb(pub Option<Mutex<Connection>>);

fn get_db_path(app_handle: &AppHandle, file_name: &str) -> PathBuf {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let cache_dir = app_dir.join("cache");
    fs::create_dir_all(&cache_dir).ok();
    cache_dir.join(file_name)
}

fn get_core_db_path(app_handle: &AppHandle) -> PathBuf {
    get_db_path(app_handle, "core.db")
}

fn get_achievements_db_path(app_handle: &AppHandle) -> PathBuf {
    get_db_path(app_handle, "achievements.db")
}

fn get_store_db_path(app_handle: &AppHandle) -> PathBuf {
    get_db_path(app_handle, "store.db")
}

// ---------------------------------------------------------------------------
// Store catalog tables — versioned Steam catalog index for Discover/View All.
// The DDL body lives here at the single sqlite init site; store_catalog.rs
// delegates to this function so there is one canonical source for the schema.
// ---------------------------------------------------------------------------

pub fn catalog_tables(conn: &Connection) -> rusqlite::Result<()> {
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

// ---------------------------------------------------------------------------
// Repack catalog tables — Hydra-compatible game repack index.
// ---------------------------------------------------------------------------

pub fn repack_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS repack_catalog (
            id                  TEXT PRIMARY KEY,
            title               TEXT NOT NULL DEFAULT '',
            normalized_title    TEXT NOT NULL DEFAULT '',
            app_id              INTEGER NOT NULL DEFAULT 0,
            repacker            TEXT NOT NULL DEFAULT '',
            repack_group        TEXT,
            installer_type      TEXT NOT NULL DEFAULT 'unknown',
            file_size           INTEGER NOT NULL DEFAULT 0,
            install_size        INTEGER,
            languages_json      TEXT NOT NULL DEFAULT '[]',
            selective_json      TEXT NOT NULL DEFAULT '[]',
            download_uris_json  TEXT NOT NULL DEFAULT '[]',
            source_url          TEXT NOT NULL DEFAULT '',
            source              TEXT NOT NULL DEFAULT '',
            checksum            TEXT,
            updated_at          TEXT NOT NULL DEFAULT '',
            tags_json           TEXT NOT NULL DEFAULT '[]',
            import_version      INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS repack_catalog_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_repack_normalized ON repack_catalog(normalized_title);
        CREATE INDEX IF NOT EXISTS idx_repack_app_id ON repack_catalog(app_id);
        CREATE INDEX IF NOT EXISTS idx_repack_repacker ON repack_catalog(repacker);
        ",
    )?;
    Ok(())
}

fn init_core_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS media_cache (
            game_id         TEXT PRIMARY KEY,
            provider        TEXT NOT NULL DEFAULT '',
            base_path       TEXT NOT NULL DEFAULT '',
            has_cover       INTEGER NOT NULL DEFAULT 0,
            has_background  INTEGER NOT NULL DEFAULT 0,
            has_logo        INTEGER NOT NULL DEFAULT 0,
            has_landscape   INTEGER NOT NULL DEFAULT 0,
            updated_at      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS metadata_cache (
            game_id      TEXT PRIMARY KEY,
            title        TEXT,
            provider     TEXT NOT NULL DEFAULT '',
            installed    INTEGER NOT NULL DEFAULT 0,
            last_played  INTEGER NOT NULL DEFAULT 0,
            playtime     INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create tables: {}", e))?;

    // Migration: add executable columns to metadata_cache (safe to re-run)
    for sql in &[
        "ALTER TABLE metadata_cache ADD COLUMN exe_path TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE metadata_cache ADD COLUMN exe_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE metadata_cache ADD COLUMN install_dir TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = conn.execute(sql, []);
    }

    // Library cache table — stores enriched game list as JSON blob for instant startup
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS library_cache (
            cache_key   TEXT PRIMARY KEY,
            cache_value TEXT NOT NULL,
            saved_at    INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Failed to create library_cache table: {}", e))?;

    // Games table — full Steam dataset (Phase 3)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS games (
            appId        TEXT PRIMARY KEY,
            title        TEXT NOT NULL DEFAULT '',
            installed    INTEGER NOT NULL DEFAULT 0,
            playtime     INTEGER NOT NULL DEFAULT 0,
            lastPlayed   INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            updated_at   INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Failed to create games table: {}", e))?;

    // Migration: add GameAppInfo columns to games table (safe to re-run)
    for sql in &[
        "ALTER TABLE games ADD COLUMN provider TEXT NOT NULL DEFAULT 'steam'",
        "ALTER TABLE games ADD COLUMN media_json TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE games ADD COLUMN media_sources_json TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE games ADD COLUMN remote_json TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE games ADD COLUMN user_data_json TEXT",
    ] {
        let _ = conn.execute(sql, []);
    }

    // Media manifests table — replaces per-game media_manifest.json files
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_manifests (
            app_id                TEXT PRIMARY KEY,
            provider              TEXT NOT NULL DEFAULT 'steam',
            version               INTEGER NOT NULL DEFAULT 1,
            updated_at            INTEGER NOT NULL DEFAULT 0,
            cover_path            TEXT,
            cover_exists          INTEGER NOT NULL DEFAULT 0,
            cover_size            INTEGER,
            cover_modified_at     INTEGER,
            landscape_path        TEXT,
            landscape_exists      INTEGER NOT NULL DEFAULT 0,
            landscape_size        INTEGER,
            landscape_modified_at INTEGER,
            background_path       TEXT,
            background_exists     INTEGER NOT NULL DEFAULT 0,
            background_size       INTEGER,
            background_modified_at INTEGER,
            logo_path             TEXT,
            logo_exists           INTEGER NOT NULL DEFAULT 0,
            logo_size             INTEGER,
            logo_modified_at      INTEGER,
            icon_path             TEXT,
            icon_exists           INTEGER NOT NULL DEFAULT 0,
            icon_size             INTEGER,
            icon_modified_at      INTEGER,
            fingerprints_json     TEXT NOT NULL DEFAULT '{}'
        );",
    )
    .map_err(|e| format!("Failed to create media_manifests table: {}", e))?;

    // Startup snapshot table — replaces cache/startup-snapshot.json (single row)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS startup_snapshots (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            version         INTEGER NOT NULL DEFAULT 1,
            updated_at      INTEGER NOT NULL DEFAULT 0,
            snapshot_json   TEXT NOT NULL DEFAULT '{}'
        );",
    )
    .map_err(|e| format!("Failed to create startup_snapshots table: {}", e))?;

    // Playtime tables — per-game session/playtime tracking
    if let Err(e) = playtime::create_tables(conn) {
        eprintln!("[SqliteCache] playtime table init failed (non-fatal): {}", e);
    }

    // Manual games cache — singleton blob for manual game entries
    if let Err(e) = manual_games_cache::create_tables(conn) {
        eprintln!("[SqliteCache] manual_games table init failed (non-fatal): {}", e);
    }

    // Debrid games cache — singleton blob for debrid game entries (uses SqliteCoreDb)
    if let Err(e) = debrid_games_cache::create_tables(conn) {
        eprintln!("[SqliteCache] debrid_games table init failed (non-fatal): {}", e);
    }

    // Store details + library game details — per-game detail page cache (uses SqliteCoreDb)
    if let Err(e) = store_details_cache::create_tables(conn) {
        eprintln!("[SqliteCache] store_details table init in core.db failed (non-fatal): {}", e);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// JSON → SQLite migration — runs once on first boot after update.
// Detects migration state by checking if `media_json` column has real data.
// ---------------------------------------------------------------------------

fn migrate_json_to_sqlite(conn: &Connection, app_handle: &AppHandle) {
    use crate::models::game_cache::{GameAppInfo, MediaManifestFile};

    let app_dir = match app_handle.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };

    // --- Migrate appinfo.json → games table ---
    let already_migrated: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM games WHERE media_json != '{}' LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if !already_migrated {
        let games_dir = app_dir.join("games").join("steam");
        if games_dir.is_dir() {
            let mut migrated = 0u32;
            let entries = fs::read_dir(&games_dir).unwrap_or_else(|_| fs::read_dir(".").unwrap());
            for entry in entries.flatten() {
                let game_dir = entry.path();
                if !game_dir.is_dir() { continue; }

                // Extract appId from directory name
                let dir_name = game_dir.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                if dir_name.is_empty() || dir_name == "steam" { continue; }

                let appinfo_path = game_dir.join("appinfo.json");
                if !appinfo_path.exists() { continue; }

                let content = match fs::read_to_string(&appinfo_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let info: GameAppInfo = match serde_json::from_str(&content) {
                    Ok(i) => i,
                    Err(_) => continue,
                };

                let app_id = info.app_id.clone();
                let media_json = serde_json::to_string(&info.media).unwrap_or_default();
                let media_sources_json = serde_json::to_string(&info.media_sources).unwrap_or_default();
                let remote_json = serde_json::to_string(&info.remote).unwrap_or_default();
                let user_data_json = info.user_data.as_ref()
                    .map(|v| serde_json::to_string(v).unwrap_or_default());

                let _ = conn.execute(
                    "INSERT OR REPLACE INTO games \
                     (appId, title, provider, media_json, media_sources_json, remote_json, user_data_json, updated_at, installed, playtime, lastPlayed) \
                     VALUES (?1, ?2, ?3, ?4, !5, ?6, !7, ?8, 0, 0, 0)",
                    rusqlite::params![
                        app_id,
                        info.name.as_deref().unwrap_or(""),
                        info.provider,
                        media_json,
                        media_sources_json,
                        remote_json,
                        user_data_json,
                        info.updated_at.map(|v| v as i64).unwrap_or(0),
                    ],
                );
                migrated += 1;
            }
            if migrated > 0 {
                println!("[SqliteCache] migrated {} appinfo.json → games table", migrated);
            }
        }
    }

    // --- Migrate media_manifest.json → media_manifests table ---
    let manifest_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM media_manifests", [], |row| row.get(0))
        .unwrap_or(0);

    if manifest_count == 0 {
        let games_dir = app_dir.join("games").join("steam");
        if games_dir.is_dir() {
            let mut migrated = 0u32;
            let entries = fs::read_dir(&games_dir).unwrap_or_else(|_| fs::read_dir(".").unwrap());
            for entry in entries.flatten() {
                let game_dir = entry.path();
                if !game_dir.is_dir() { continue; }

                let manifest_path = game_dir.join("media_manifest.json");
                if !manifest_path.exists() { continue; }

                let content = match fs::read_to_string(&manifest_path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let manifest: MediaManifestFile = match serde_json::from_str(&content) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                let fp_json = manifest.fingerprints.as_ref()
                    .map(|f| serde_json::to_string(f).unwrap_or_default())
                    .unwrap_or_else(|| "{}".to_string());

                let e = |entry: &crate::models::game_cache::MediaManifestEntry| -> (String, i64, Option<i64>, Option<i64>) {
                    (entry.path.clone(), entry.exists as i64, entry.size.map(|v| v as i64), entry.modified_at.map(|v| v as i64))
                };

                let (c_path, c_exists, c_size, c_mod) = e(&manifest.files.cover);
                let (l_path, l_exists, l_size, l_mod) = e(&manifest.files.landscape);
                let (b_path, b_exists, b_size, b_mod) = e(&manifest.files.background);
                let (lo_path, lo_exists, lo_size, lo_mod) = e(&manifest.files.logo);
                let (i_path, i_exists, i_size, i_mod) = e(&manifest.files.icon);

                let _ = conn.execute(
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
                );
                migrated += 1;
            }
            if migrated > 0 {
                println!("[SqliteCache] migrated {} media_manifest.json → media_manifests table", migrated);
            }
        }
    }

    // --- Migrate startup-snapshot.json → startup_snapshots table ---
    let snap_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM startup_snapshots", [], |row| row.get(0))
        .unwrap_or(0);

    if snap_count == 0 {
        let snap_path = app_dir.join("cache").join("startup-snapshot.json");
        if snap_path.exists() {
            if let Ok(content) = fs::read_to_string(&snap_path) {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;

                // Try to extract version from JSON
                let version: i64 = serde_json::from_str::<serde_json::Value>(&content)
                    .ok()
                    .and_then(|v| v.get("version").and_then(|ver| ver.as_i64()))
                    .unwrap_or(1);

                let _ = conn.execute(
                    "INSERT INTO startup_snapshots (id, version, updated_at, snapshot_json) \
                     VALUES (1, ?1, ?2, ?3)",
                    rusqlite::params![version, now, content],
                );
                println!("[SqliteCache] migrated startup-snapshot.json → startup_snapshots table");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Migration for P0-P2 JSON stores → SQLite (runs once on first boot after update)
// ---------------------------------------------------------------------------

fn migrate_remaining_json_to_sqlite(conn: &Connection, app_handle: &AppHandle) {
    let app_dir = match app_handle.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };

    // --- Migrate playtime.json → playtime tables ---
    let playtime_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM playtime_entries", [], |row| row.get(0))
        .unwrap_or(0);
    if playtime_count == 0 {
        let pt_path = app_dir.join("activity").join("playtime").join("playtime.json");
        if pt_path.exists() {
            if let Ok(content) = fs::read_to_string(&pt_path) {
                if let Ok(store) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(games) = store.get("games").and_then(|g| g.as_object()) {
                        let mut migrated = 0u32;
                        for (key, entry_val) in games {
                            let app_id = entry_val.get("app_id").or(entry_val.get("appId")).and_then(|v| v.as_str()).map(|s| s.to_string());
                            let provider = entry_val.get("provider").and_then(|v| v.as_str()).unwrap_or("steam").to_string();
                            let title = entry_val.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let playtime_source = entry_val.get("playtime_source").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let ext_secs = entry_val.get("external_playtime_seconds").and_then(|v| v.as_u64()).unwrap_or(0);
                            let ext_source = entry_val.get("external_source").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let ext_imported = entry_val.get("external_imported_at").and_then(|v| v.as_u64());
                            let local_secs = entry_val.get("local_playtime_seconds").and_then(|v| v.as_u64()).unwrap_or(0);
                            let total_secs = entry_val.get("total_playtime_seconds").and_then(|v| v.as_u64()).unwrap_or(0);
                            let last_played = entry_val.get("last_played_at").and_then(|v| v.as_u64());
                            let last_session = entry_val.get("last_session_seconds").and_then(|v| v.as_u64());

                            let _ = conn.execute(
                                "INSERT OR REPLACE INTO playtime_entries \
                                 (game_key, app_id, provider, title, playtime_source, \
                                  external_playtime_seconds, external_source, external_imported_at, \
                                  local_playtime_seconds, total_playtime_seconds, last_played_at, \
                                  last_session_seconds, updated_at) \
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0)",
                                rusqlite::params![key, app_id, provider, title, playtime_source, ext_secs, ext_source, ext_imported, local_secs, total_secs, last_played, last_session],
                            );

                            // Migrate sessions
                            if let Some(sessions) = entry_val.get("sessions").and_then(|s| s.as_array()) {
                                for sess in sessions {
                                    let sid = sess.get("session_id").or(sess.get("sessionId")).and_then(|v| v.as_str()).unwrap_or("");
                                    let started = sess.get("started_at").or(sess.get("startedAt")).and_then(|v| v.as_u64()).unwrap_or(0);
                                    let ended = sess.get("ended_at").or(sess.get("endedAt")).and_then(|v| v.as_u64());
                                    let dur = sess.get("duration_seconds").or(sess.get("durationSeconds")).and_then(|v| v.as_u64());
                                    let reason = sess.get("exit_reason").or(sess.get("exitReason")).and_then(|v| v.as_str()).map(|s| s.to_string());
                                    let _ = conn.execute(
                                        "INSERT OR IGNORE INTO playtime_sessions \
                                         (session_id, game_key, started_at, ended_at, duration_seconds, exit_reason) \
                                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                                        rusqlite::params![sid, key, started, ended, dur, reason],
                                    );
                                }
                            }
                            migrated += 1;
                        }
                        if migrated > 0 {
                            println!("[SqliteCache] migrated {} playtime games → playtime_entries + playtime_sessions", migrated);
                        }
                    }
                }
            }
        }
    }

    // --- Migrate debrid-games.json → debrid_games table ---
    let debrid_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM debrid_games", [], |row| row.get(0))
        .unwrap_or(0);
    if debrid_count == 0 {
        let path = app_dir.join("games").join("debrid").join("debrid-games.json");
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                let _ = conn.execute(
                    "INSERT INTO debrid_games (id, data_json, updated_at) VALUES (1, ?1, ?2)",
                    rusqlite::params![content, now],
                );
                println!("[SqliteCache] migrated debrid-games.json → debrid_games table");
            }
        }
    }

    // --- Migrate manual-games.json → manual_games table ---
    let manual_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM manual_games", [], |row| row.get(0))
        .unwrap_or(0);
    if manual_count == 0 {
        let path = app_dir.join("games").join("manual").join("manual-games.json");
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                let _ = conn.execute(
                    "INSERT INTO manual_games (id, data_json, updated_at) VALUES (1, ?1, ?2)",
                    rusqlite::params![content, now],
                );
                println!("[SqliteCache] migrated manual-games.json → manual_games table");
            }
        }
    }

    // --- Migrate source-index.json → source_availability table ---
    let source_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM source_availability", [], |row| row.get(0))
        .unwrap_or(0);
    if source_count == 0 {
        let path = app_dir.join("sources").join("source-index.json");
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(index) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(games) = index.get("games").and_then(|g| g.as_object()) {
                        let mut migrated = 0u32;
                        for (app_id, game_val) in games {
                            let entry_json = serde_json::to_string(game_val).unwrap_or_default();
                            let _ = conn.execute(
                                "INSERT OR REPLACE INTO source_availability (app_id, data_json, updated_at) VALUES (?1, ?2, 0)",
                                rusqlite::params![app_id, entry_json],
                            );
                            migrated += 1;
                        }
                        if migrated > 0 {
                            println!("[SqliteCache] migrated {} source entries → source_availability table", migrated);
                        }
                    }
                }
            }
        }
    }

    // --- Migrate provider-status/snapshot.json → provider_status_snapshot table ---
    let snap_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM provider_status_snapshot", [], |row| row.get(0))
        .unwrap_or(0);
    if snap_count == 0 {
        let path = app_dir.join("store").join("provider-status").join("snapshot.json");
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                let _ = conn.execute(
                    "INSERT INTO provider_status_snapshot (id, data_json, updated_at) VALUES (1, ?1, ?2)",
                    rusqlite::params![content, now],
                );
                println!("[SqliteCache] migrated provider-status/snapshot.json → provider_status_snapshot table");
            }
        }
    }

    // --- Migrate store/appinfo.json → store_appinfo table ---
    let store_app_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM store_appinfo", [], |row| row.get(0))
        .unwrap_or(0);
    if store_app_count == 0 {
        let path = app_dir.join("store").join("appinfo.json");
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(map) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(obj) = map.as_object() {
                        let mut migrated = 0u32;
                        for (app_id, val) in obj {
                            let entry_json = serde_json::to_string(val).unwrap_or_default();
                            let _ = conn.execute(
                                "INSERT OR REPLACE INTO store_appinfo (app_id, data_json, updated_at) VALUES (?1, ?2, 0)",
                                rusqlite::params![app_id, entry_json],
                            );
                            migrated += 1;
                        }
                        if migrated > 0 {
                            println!("[SqliteCache] migrated {} store appinfo entries → store_appinfo table", migrated);
                        }
                    }
                }
            }
        }
    }

    // --- Migrate discovery-index, catalog-sections, sgdb-artwork → game_catalog_blobs ---
    let blob_migrations: &[(&str, &str)] = &[
        ("discovery-index", "store/discovery-index.json"),
        ("catalog-sections-cache", "store/catalog-sections-cache.json"),
        ("sgdb-artwork-cache", "store/sgdb-artwork-cache.json"),
    ];
    for (key, rel_path) in blob_migrations {
        let existing: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_catalog_blobs WHERE catalog_key = ?1", [key], |row| row.get(0))
            .unwrap_or(0);
        if existing == 0 {
            let path = app_dir.join(rel_path);
            if path.exists() {
                if let Ok(content) = fs::read_to_string(&path) {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO game_catalog_blobs (catalog_key, data_json, updated_at) VALUES (?1, ?2, ?3)",
                        rusqlite::params![key, content, now],
                    );
                    println!("[SqliteCache] migrated {} → game_catalog_blobs", rel_path);
                }
            }
        }
    }

    // --- Migrate store-details.json files → store_details table ---
    let sd_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM store_details", [], |row| row.get(0))
        .unwrap_or(0);
    if sd_count == 0 {
        let games_dir = app_dir.join("games").join("steam");
        if games_dir.is_dir() {
            let mut migrated = 0u32;
            for entry in fs::read_dir(&games_dir).unwrap_or_else(|_| fs::read_dir(".").unwrap()).flatten() {
                let game_dir = entry.path();
                if !game_dir.is_dir() { continue; }
                let dir_name = game_dir.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                if dir_name.is_empty() || dir_name == "steam" { continue; }
                let sd_path = game_dir.join("store-details.json");
                if !sd_path.exists() { continue; }
                if let Ok(content) = fs::read_to_string(&sd_path) {
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO store_details (app_id, data_json, updated_at) VALUES (?1, ?2, 0)",
                        rusqlite::params![dir_name, content],
                    );
                    migrated += 1;
                }
            }
            if migrated > 0 {
                println!("[SqliteCache] migrated {} store-details.json → store_details table", migrated);
            }
        }
    }

    // --- Migrate library/details/*.json → library_game_details table ---
    let lgd_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM library_game_details", [], |row| row.get(0))
        .unwrap_or(0);
    if lgd_count == 0 {
        let details_dir = app_dir.join("library").join("details");
        if details_dir.is_dir() {
            let mut migrated = 0u32;
            for entry in fs::read_dir(&details_dir).unwrap_or_else(|_| fs::read_dir(".").unwrap()).flatten() {
                let file_path = entry.path();
                if !file_path.is_file() { continue; }
                let stem = file_path.file_stem().and_then(|n| n.to_str()).unwrap_or("").to_string();
                if stem.is_empty() { continue; }
                let app_id = stem.trim_end_matches(".json").to_string();
                if let Ok(content) = fs::read_to_string(&file_path) {
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO library_game_details (app_id, data_json, updated_at) VALUES (?1, ?2, 0)",
                        rusqlite::params![app_id, content],
                    );
                    migrated += 1;
                }
            }
            if migrated > 0 {
                println!("[SqliteCache] migrated {} library/details/*.json → library_game_details table", migrated);
            }
        }
    }
}

fn init_achievement_tables(conn: &Connection) -> Result<(), String> {
    // Achievement tables — volatile per-game progress
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS achievement_summaries (
            app_id          TEXT PRIMARY KEY,
            unlocked        INTEGER NOT NULL DEFAULT 0,
            total           INTEGER NOT NULL DEFAULT 0,
            in_progress     INTEGER NOT NULL DEFAULT 0,
            completion_time INTEGER,
            last_unlock_at  INTEGER,
            updated_at      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS achievement_entries (
            app_id      TEXT NOT NULL,
            api_name    TEXT NOT NULL,
            name        TEXT,
            description TEXT,
            icon_url    TEXT,
            icon_gray   TEXT,
            hidden      INTEGER NOT NULL DEFAULT 0,
            unlocked    INTEGER NOT NULL DEFAULT 0,
            unlock_time INTEGER,
            unlocked_at INTEGER,
            global_pct  REAL,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (app_id, api_name)
        );

        CREATE TABLE IF NOT EXISTS achievement_percentages (
            app_id     TEXT PRIMARY KEY,
            entries    TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create achievement tables: {}", e))?;

    Ok(())
}

fn init_store_tables(conn: &Connection) -> Result<(), String> {
    // Store reviews — replaces store/reviews/{appid}.json
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS store_reviews (
            app_id     TEXT PRIMARY KEY,
            data       TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create store_reviews table: {}", e))?;

    // Provider status — replaces store/provider-status/{appId}/{providerId}.json
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS provider_status (
            app_id      TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            data        TEXT NOT NULL DEFAULT '{}',
            updated_at  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (app_id, provider_id)
        );
        ",
    )
    .map_err(|e| format!("Failed to create provider_status table: {}", e))?;

    // Game catalog blobs — single-row per catalog storing the full JSON
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS game_catalog_blobs (
            catalog_key TEXT PRIMARY KEY,
            data_json   TEXT NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create game_catalog_blobs table: {}", e))?;

    // Store catalog tables — versioned Steam catalog index for Discover/View All
    if let Err(e) = catalog_tables(conn) {
        eprintln!("[SqliteCache] catalog table init failed (non-fatal): {}", e);
    }

    // Repack catalog tables — Hydra-compatible game repack index
    if let Err(e) = repack_tables(conn) {
        eprintln!("[SqliteCache] repack catalog table init failed (non-fatal): {}", e);
    }

    // Source availability — per-game download source index
    if let Err(e) = source_availability::create_tables(conn) {
        eprintln!("[SqliteCache] source_availability table init failed (non-fatal): {}", e);
    }

    // Store appinfo cache — Steam appdetails API responses
    if let Err(e) = store_appinfo_cache::create_tables(conn) {
        eprintln!("[SqliteCache] store_appinfo table init failed (non-fatal): {}", e);
    }

    // Store media cache — store media resolution per game
    if let Err(e) = store_media_cache::create_tables(conn) {
        eprintln!("[SqliteCache] store_media_cache table init failed (non-fatal): {}", e);
    }

    // Provider status snapshot — singleton blob for provider status index
    if let Err(e) = provider_snapshot::create_tables(conn) {
        eprintln!("[SqliteCache] provider_status_snapshot table init failed (non-fatal): {}", e);
    }

    // Store details + library game details — per-game detail page cache
    if let Err(e) = store_details_cache::create_tables(conn) {
        eprintln!("[SqliteCache] store_details tables init failed (non-fatal): {}", e);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Initialize the SQLite databases. Called from setup().
// If anything fails, the state is set to None and all queries fall back.
// ---------------------------------------------------------------------------

pub fn initialize_core_sqlite(app_handle: &AppHandle) -> SqliteCoreDb {
    let db_path = get_core_db_path(app_handle);

    match Connection::open(&db_path) {
        Ok(conn) => {
            if let Err(e) = init_core_tables(&conn) {
                eprintln!("[SqliteCache] core table init failed: {}", e);
                return SqliteCoreDb(None);
            }

            // Migrate existing JSON files to SQLite on first boot after update
            migrate_json_to_sqlite(&conn, app_handle);
            migrate_remaining_json_to_sqlite(&conn, app_handle);

            println!(
                "[SqliteCache] core database ready at {:?}",
                db_path
            );
            SqliteCoreDb(Some(Mutex::new(conn)))
        }
        Err(e) => {
            eprintln!("[SqliteCache] failed to open core database: {}", e);
            SqliteCoreDb(None)
        }
    }
}

pub fn initialize_achievements_sqlite(app_handle: &AppHandle) -> SqliteAchievementsDb {
    let db_path = get_achievements_db_path(app_handle);

    match Connection::open(&db_path) {
        Ok(conn) => {
            if let Err(e) = init_achievement_tables(&conn) {
                eprintln!("[SqliteCache] achievement table init failed: {}", e);
                return SqliteAchievementsDb(None);
            }
            println!(
                "[SqliteCache] achievement database ready at {:?}",
                db_path
            );
            SqliteAchievementsDb(Some(Mutex::new(conn)))
        }
        Err(e) => {
            eprintln!("[SqliteCache] failed to open achievement database: {}", e);
            SqliteAchievementsDb(None)
        }
    }
}

pub fn initialize_store_sqlite(app_handle: &AppHandle) -> SqliteStoreDb {
    let db_path = get_store_db_path(app_handle);

    match Connection::open(&db_path) {
        Ok(conn) => {
            if let Err(e) = init_store_tables(&conn) {
                eprintln!("[SqliteCache] store table init failed: {}", e);
                return SqliteStoreDb(None);
            }
            println!(
                "[SqliteCache] store database ready at {:?}",
                db_path
            );
            SqliteStoreDb(Some(Mutex::new(conn)))
        }
        Err(e) => {
            eprintln!("[SqliteCache] failed to open store database: {}", e);
            SqliteStoreDb(None)
        }
    }
}

#[tauri::command]
pub fn check_sqlite_health(
    core: tauri::State<'_, SqliteCoreDb>,
    achievements: tauri::State<'_, SqliteAchievementsDb>,
    store: tauri::State<'_, SqliteStoreDb>,
) -> Result<bool, String> {
    Ok(core.0.is_some() && achievements.0.is_some() && store.0.is_some())
}
