use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::AppHandle;
use tauri::Manager;

pub mod achievements;
pub mod catalog_blobs;
pub mod entities;
pub mod game_appinfo;
pub mod game_actions;
pub mod game_files;
pub mod game_sessions;
pub mod games_v2;
pub mod import_exclusions;
pub mod launcher_achievements_cache;
pub mod library_cache;
pub mod media_manifests;
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
    Achievement, AchievementPercentages, AchievementProgress, AchievementSummary,
    app_id_to_game_id, batch_upsert_achievements, batch_upsert_achievements_inner,
    delete_achievements_for_game, delete_achievements_for_game_inner,
    get_achievement_percentages, get_achievement_percentages_inner,
    get_achievement_progress_for_game, get_achievement_progress_for_game_inner,
    get_achievement_summary, get_achievement_summary_inner,
    get_achievements_for_game, get_achievements_for_game_inner,
    get_all_achievement_summaries, get_all_achievement_summaries_inner,
    upsert_achievement, upsert_achievement_inner,
    upsert_achievement_percentages, upsert_achievement_percentages_inner,
    upsert_achievement_progress, upsert_achievement_progress_inner,
    upsert_achievement_summary, upsert_achievement_summary_inner,
};
pub use catalog_blobs::{get_game_catalog_blob, upsert_game_catalog_blob};
pub use game_appinfo::{
    read_game_appinfo, read_batch_appinfo, write_game_appinfo,
    merge_and_write_appinfo, upsert_game_base,
};
pub use games_v2::{
    GameV2, add_playtime_v2, batch_upsert_games_v2, delete_game_v2, get_all_games_v2, get_game_v2,
    get_game_v2_by_app_id, get_game_v2_count, get_games_v2_by_source, increment_play_count_v2, search_games_v2,
    update_playtime_v2, upsert_game_v2,
};
pub use game_sessions::{
    GameSession, delete_game_sessions_for_game, delete_game_sessions_for_game_inner,
    get_all_game_sessions, get_all_game_sessions_inner,
    get_game_sessions_for_game, get_game_sessions_for_game_inner,
    get_recent_game_sessions, get_recent_game_sessions_inner,
    update_game_session_end, update_game_session_end_inner,
    upsert_game_session, upsert_game_session_inner,
};
pub use game_files::{
    GameFile, GameFilesMedia, MediaInfo,
    upsert_game_file_inner, upsert_game_files_media_inner, upsert_game_files_depot_inner,
    upsert_game_files_fingerprints_inner, get_game_file_inner, get_game_files_media_inner,
    delete_game_file_inner, get_installed_game_files_inner,
};
pub use game_actions::{
    GameAction, add_game_action_inner, get_game_actions_inner, get_all_game_actions_inner,
    update_game_action_inner, delete_game_action_inner, delete_game_actions_for_game_inner,
};
pub use import_exclusions::{
    ImportExclusion, add_import_exclusion_inner, get_import_exclusions_inner,
    is_game_excluded_inner, is_folder_excluded_inner, remove_import_exclusion_inner,
};
pub use library_cache::{delete_library_cache, read_library_cache, write_library_cache};
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
pub use library_cache::__cmd__read_library_cache;
pub use library_cache::__cmd__write_library_cache;
pub use library_cache::__cmd__delete_library_cache;
pub use achievements::__cmd__upsert_achievement_summary;
pub use achievements::__cmd__get_achievement_summary;
pub use achievements::__cmd__get_all_achievement_summaries;
pub use achievements::__cmd__upsert_achievement;
pub use achievements::__cmd__batch_upsert_achievements;
pub use achievements::__cmd__get_achievements_for_game;
pub use achievements::__cmd__delete_achievements_for_game;
pub use achievements::__cmd__upsert_achievement_progress;
pub use achievements::__cmd__get_achievement_progress_for_game;
pub use achievements::__cmd__upsert_achievement_percentages;
pub use achievements::__cmd__get_achievement_percentages;
pub use game_sessions::__cmd__upsert_game_session;
pub use game_sessions::__cmd__get_game_sessions_for_game;
pub use game_sessions::__cmd__get_all_game_sessions;
pub use game_sessions::__cmd__delete_game_sessions_for_game;
pub use game_sessions::__cmd__update_game_session_end;
pub use game_sessions::__cmd__get_recent_game_sessions;
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
pub use library_cache::__tauri_command_name_read_library_cache;
pub use library_cache::__tauri_command_name_write_library_cache;
pub use library_cache::__tauri_command_name_delete_library_cache;
pub use games_v2::__cmd__upsert_game_v2;
pub use games_v2::__cmd__batch_upsert_games_v2;
pub use games_v2::__cmd__get_game_v2;
pub use games_v2::__cmd__get_game_v2_by_app_id;
pub use games_v2::__cmd__get_all_games_v2;
pub use games_v2::__cmd__get_games_v2_by_source;
pub use games_v2::__cmd__search_games_v2;
pub use games_v2::__cmd__delete_game_v2;
pub use games_v2::__cmd__get_game_v2_count;
pub use games_v2::__tauri_command_name_upsert_game_v2;
pub use games_v2::__tauri_command_name_batch_upsert_games_v2;
pub use games_v2::__tauri_command_name_get_game_v2;
pub use games_v2::__tauri_command_name_get_game_v2_by_app_id;
pub use games_v2::__tauri_command_name_get_all_games_v2;
pub use games_v2::__tauri_command_name_get_games_v2_by_source;
pub use games_v2::__tauri_command_name_search_games_v2;
pub use games_v2::__tauri_command_name_delete_game_v2;
pub use games_v2::__tauri_command_name_get_game_v2_count;
pub use games_v2::__cmd__update_playtime_v2;
pub use games_v2::__cmd__increment_play_count_v2;
pub use games_v2::__cmd__add_playtime_v2;
pub use games_v2::__tauri_command_name_update_playtime_v2;
pub use games_v2::__tauri_command_name_increment_play_count_v2;
pub use games_v2::__tauri_command_name_add_playtime_v2;
pub use achievements::__tauri_command_name_upsert_achievement_summary;
pub use achievements::__tauri_command_name_get_achievement_summary;
pub use achievements::__tauri_command_name_get_all_achievement_summaries;
pub use achievements::__tauri_command_name_upsert_achievement;
pub use achievements::__tauri_command_name_batch_upsert_achievements;
pub use achievements::__tauri_command_name_get_achievements_for_game;
pub use achievements::__tauri_command_name_delete_achievements_for_game;
pub use achievements::__tauri_command_name_upsert_achievement_progress;
pub use achievements::__tauri_command_name_get_achievement_progress_for_game;
pub use achievements::__tauri_command_name_upsert_achievement_percentages;
pub use achievements::__tauri_command_name_get_achievement_percentages;
pub use game_sessions::__tauri_command_name_upsert_game_session;
pub use game_sessions::__tauri_command_name_get_game_sessions_for_game;
pub use game_sessions::__tauri_command_name_get_all_game_sessions;
pub use game_sessions::__tauri_command_name_delete_game_sessions_for_game;
pub use game_sessions::__tauri_command_name_update_game_session_end;
pub use game_sessions::__tauri_command_name_get_recent_game_sessions;
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
    // Library cache table — stores enriched game list as JSON blob for instant startup
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS library_cache (
            cache_key   TEXT PRIMARY KEY,
            cache_value TEXT NOT NULL,
            saved_at    INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Failed to create library_cache table: {}", e))?;

    // Games V2 — unified table for ALL providers (single source of truth)
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS games_v2 (
            id                TEXT PRIMARY KEY,
            title             TEXT NOT NULL,
            source            TEXT NOT NULL,
            app_id            TEXT,
            provider_game_id  TEXT,
            library_id        TEXT,

            -- Installation
            is_installed      INTEGER DEFAULT 0,
            install_dir       TEXT,
            install_size      INTEGER,
            exe_path          TEXT,
            exe_name          TEXT,
            working_directory TEXT,
            launch_arguments  TEXT,

            -- Playtime (seconds, like Playnite)
            playtime_seconds  INTEGER DEFAULT 0,
            play_count        INTEGER DEFAULT 0,
            last_played_at    INTEGER,

            -- Media
            cover_path        TEXT,
            landscape_path    TEXT,
            background_path   TEXT,
            logo_path         TEXT,
            icon_path         TEXT,

            -- Metadata
            release_date      TEXT,
            description       TEXT,
            short_description TEXT,
            genres            TEXT,
            developers        TEXT,
            publishers        TEXT,
            categories        TEXT,
            features          TEXT,
            tags              TEXT,

            -- Scores
            user_score        TEXT,
            critic_score      TEXT,
            community_score   TEXT,
            review_summary    TEXT,
            review_count      TEXT,

            -- Links (cross-provider)
            linked_app_id     TEXT,
            linked_igdb_id    TEXT,

            -- State
            is_favorite       INTEGER DEFAULT 0,
            is_hidden         INTEGER DEFAULT 0,
            standalone        INTEGER DEFAULT 0,
            sorting_name      TEXT,

            -- Series / Rating
            series            TEXT,
            age_rating        TEXT,
            region            TEXT,
            completion_status TEXT,

            -- Lua overlay
            has_lua           INTEGER DEFAULT 0,

            -- Provider-specific overrides (JSON blob)
            provider_metadata TEXT,

            created_at        INTEGER NOT NULL,
            updated_at        INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_games_v2_source ON games_v2(source);
        CREATE INDEX IF NOT EXISTS idx_games_v2_app_id ON games_v2(app_id);
        CREATE INDEX IF NOT EXISTS idx_games_v2_library_id ON games_v2(library_id);
        CREATE INDEX IF NOT EXISTS idx_games_v2_is_installed ON games_v2(is_installed);
        ",
    )
    .map_err(|e| format!("Failed to create games_v2 table: {}", e))?;

    // Migration: add has_lua column for existing databases
    let _ = conn.execute_batch("ALTER TABLE games_v2 ADD COLUMN has_lua INTEGER DEFAULT 0;");

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

    // Launcher achievements — singleton blobs for launcher meta-achievement data
    if let Err(e) = launcher_achievements_cache::create_tables(conn) {
        eprintln!("[SqliteCache] launcher_achievements table init failed (non-fatal): {}", e);
    }

    // Store details + library game details — per-game detail page cache (uses SqliteCoreDb)
    if let Err(e) = store_details_cache::create_tables(conn) {
        eprintln!("[SqliteCache] store_details table init in core.db failed (non-fatal): {}", e);
    }

    // Achievement tables — all achievement data lives in core.db (FK to games_v2)
    if let Err(e) = init_achievement_tables(conn) {
        eprintln!("[SqliteCache] achievement tables init failed (non-fatal): {}", e);
    }

    // Game sessions — per-game session tracking (FK to games_v2)
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS game_sessions (
            session_id      TEXT PRIMARY KEY,
            game_id         TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            started_at      INTEGER NOT NULL DEFAULT 0,
            ended_at        INTEGER,
            duration_seconds INTEGER,
            exit_reason     TEXT,
            source          TEXT NOT NULL DEFAULT 'local'
        );

        CREATE INDEX IF NOT EXISTS idx_game_sessions_game_id ON game_sessions(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_started_at ON game_sessions(started_at);
        ",
    ).map_err(|e| eprintln!("[SqliteCache] game_sessions init failed: {}", e)).ok();

    // Game files — unified file registry (FK to games_v2)
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS game_files (
            id              TEXT PRIMARY KEY,
            game_id         TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            file_path       TEXT NOT NULL,
            file_type       TEXT NOT NULL DEFAULT 'unknown',
            file_size       INTEGER,
            file_hash       TEXT,
            installed_at    INTEGER,
            updated_at      INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_game_files_game_id ON game_files(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_files_file_type ON game_files(file_type);
        ",
    ).map_err(|e| eprintln!("[SqliteCache] game_files init failed: {}", e)).ok();

    // Entity tables — genres, companies, categories, features, tags + junction tables
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS genres (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS companies (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS categories (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS features (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        -- Junction tables
        CREATE TABLE IF NOT EXISTS game_genres (
            game_id TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, genre_id)
        );

        CREATE TABLE IF NOT EXISTS game_developers (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, company_id)
        );

        CREATE TABLE IF NOT EXISTS game_publishers (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, company_id)
        );

        CREATE TABLE IF NOT EXISTS game_categories (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, category_id)
        );

        CREATE TABLE IF NOT EXISTS game_features (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, feature_id)
        );

        CREATE TABLE IF NOT EXISTS game_tags (
            game_id TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, tag_id)
        );
        ",
    ).map_err(|e| eprintln!("[SqliteCache] entity tables init failed: {}", e)).ok();

    // Game actions — custom per-game actions
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS game_actions (
            id          TEXT PRIMARY KEY,
            game_id     TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            action_type TEXT NOT NULL DEFAULT 'launch',
            command     TEXT,
            args        TEXT,
            working_dir TEXT,
            created_at  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_game_actions_game_id ON game_actions(game_id);
        ",
    ).map_err(|e| eprintln!("[SqliteCache] game_actions init failed: {}", e)).ok();

    // Import exclusions
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS import_exclusions (
            id          TEXT PRIMARY KEY,
            exclusion_type TEXT NOT NULL,
            value       TEXT NOT NULL,
            reason      TEXT,
            created_at  INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_import_exclusions_type ON import_exclusions(exclusion_type);
        ",
    ).map_err(|e| eprintln!("[SqliteCache] import_exclusions init failed: {}", e)).ok();

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
            app_id          TEXT NOT NULL,
            source          TEXT NOT NULL DEFAULT 'steam-official',
            platform        TEXT NOT NULL DEFAULT 'steam-official',
            unlocked        INTEGER NOT NULL DEFAULT 0,
            total           INTEGER NOT NULL DEFAULT 0,
            in_progress     INTEGER NOT NULL DEFAULT 0,
            completion_time INTEGER,
            last_unlock_at  INTEGER,
            updated_at      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (app_id, platform)
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

    // Migration: achievement_summaries needs composite PK (app_id, platform) + source columns.
    // SQLite cannot alter a PRIMARY KEY, so recreate the table if old schema detected.
    let has_old_schema: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('achievement_summaries') WHERE name = 'platform'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_old_schema {
        // Old schema: no `platform` or `source` column. Recreate with new schema, preserving data.
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS achievement_summaries_new (
                app_id          TEXT NOT NULL,
                source          TEXT NOT NULL DEFAULT 'steam-official',
                platform        TEXT NOT NULL DEFAULT 'steam-official',
                unlocked        INTEGER NOT NULL DEFAULT 0,
                total           INTEGER NOT NULL DEFAULT 0,
                in_progress     INTEGER NOT NULL DEFAULT 0,
                completion_time INTEGER,
                last_unlock_at  INTEGER,
                updated_at      INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (app_id, platform)
            );
            INSERT INTO achievement_summaries_new (app_id, source, platform, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at)
                SELECT app_id, 'steam-official', 'steam-official', unlocked, total, in_progress, completion_time, last_unlock_at, updated_at
                FROM achievement_summaries;
            DROP TABLE achievement_summaries;
            ALTER TABLE achievement_summaries_new RENAME TO achievement_summaries;
            ",
        )
        .map_err(|e| format!("Failed to migrate achievement_summaries: {}", e))?;
    }

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

            // Cleanup: remove steam entries that overlap with lua, manual, or debrid entries.
            // These are ghost duplicates created by writeMetadataToSqlite when it didn't check
            // for existing entries from other sources.
            if let Err(e) = conn.execute_batch(
                "DELETE FROM games_v2
                 WHERE source = 'steam'
                   AND (
                     (app_id IS NULL OR app_id = '')
                     OR app_id IN (
                       SELECT l.app_id FROM games_v2 l
                       WHERE l.source IN ('lua', 'manual', 'debrid')
                         AND l.app_id IS NOT NULL AND l.app_id != ''
                     )
                   );"
            ) {
                eprintln!("[SqliteCache] cleanup duplicates failed (non-fatal): {}", e);
            } else {
                let deleted = conn.changes();
                if deleted > 0 {
                    println!("[SqliteCache] cleaned up {} duplicate steam entries", deleted);
                }
            }

            // Backfill app_id from id for remaining steam entries with NULL app_id
            // e.g., "steam-12345" -> set app_id = "12345"
            if let Err(e) = conn.execute_batch(
                "UPDATE games_v2
                 SET app_id = SUBSTR(id, 7)
                 WHERE source = 'steam'
                   AND (app_id IS NULL OR app_id = '')
                   AND id LIKE 'steam-%';"
            ) {
                eprintln!("[SqliteCache] backfill app_id failed (non-fatal): {}", e);
            } else {
                let updated = conn.changes();
                if updated > 0 {
                    println!("[SqliteCache] backfilled app_id for {} steam entries", updated);
                }
            }

            // Remove any stale entries with :en suffix in id (e.g., "steam-730:en")
            if let Err(e) = conn.execute_batch(
                "DELETE FROM games_v2 WHERE id LIKE '%:en';"
            ) {
                eprintln!("[SqliteCache] cleanup stale ids failed (non-fatal): {}", e);
            } else {
                let deleted = conn.changes();
                if deleted > 0 {
                    println!("[SqliteCache] cleaned up {} stale entries with locale suffix", deleted);
                }
            }

            // Fix double-prefix manual IDs (e.g., "manual:manual:uuid" → "manual:uuid")
            // and fix provider_game_id that also got the prefix
            if let Err(e) = conn.execute_batch(
                "UPDATE games_v2 SET
                   id = 'manual:' || SUBSTR(id, LENGTH('manual:manual:') + 1),
                   provider_game_id = SUBSTR(provider_game_id, LENGTH('manual:') + 1)
                 WHERE id LIKE 'manual:manual:%' AND source = 'manual';"
            ) {
                eprintln!("[SqliteCache] fix double-prefix manual ids failed (non-fatal): {}", e);
            } else {
                let fixed = conn.changes();
                if fixed > 0 {
                    println!("[SqliteCache] fixed {} double-prefix manual game ids", fixed);
                }
            }

            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM games_v2", [], |row| row.get(0))
                .unwrap_or(-1);
            println!("[SqliteCache] games_v2 rows on startup: {}", count);
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

    // Achievements now use core.db (achievement tables created in init_core_tables).
    // This function returns a dummy SqliteAchievementsDb(None) — callers should
    // use SqliteCoreDb instead. Kept for backwards compat during migration.
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

// ---------------------------------------------------------------------------
// Versioned Migration System — PRAGMA user_version
// ---------------------------------------------------------------------------

/// Current target schema version. Increment when adding a new migration.
const CURRENT_DB_VERSION: u32 = 15;

/// Run all pending migrations in order. Called once on boot after opening core.db.
fn run_migrations(conn: &Connection) -> Result<(), String> {
    let current_version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap_or(0);

    if current_version < 5 {
        migrate_v4_to_v5(conn)?;
    }
    if current_version < 6 {
        migrate_v5_to_v6(conn)?;
    }
    if current_version < 7 {
        migrate_v6_to_v7(conn)?;
    }
    if current_version < 8 {
        migrate_v7_to_v8(conn)?;
    }
    if current_version < 9 {
        migrate_v8_to_v9(conn)?;
    }
    if current_version < 10 {
        migrate_v9_to_v10(conn)?;
    }
    if current_version < 11 {
        migrate_v10_to_v11(conn)?;
    }
    if current_version < 12 {
        migrate_v11_to_v12(conn)?;
    }
    if current_version < 13 {
        migrate_v12_to_v13(conn)?;
    }
    if current_version < 14 {
        migrate_v13_to_v14(conn)?;
    }
    if current_version < 15 {
        migrate_v14_to_v15(conn)?;
    }

    conn.execute_batch(&format!("PRAGMA user_version = {};", CURRENT_DB_VERSION))
        .map_err(|e| format!("Failed to set user_version: {}", e))?;

    Ok(())
}

/// Migration v4 → v5: Create games_v2 unified table + indexes.
fn migrate_v4_to_v5(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v4 → v5: creating games_v2 table");

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS games_v2 (
            id                TEXT PRIMARY KEY,
            title             TEXT NOT NULL,
            source            TEXT NOT NULL,
            app_id            TEXT,
            provider_game_id  TEXT,
            library_id        TEXT,

            -- Installation
            is_installed      INTEGER DEFAULT 0,
            install_dir       TEXT,
            install_size      INTEGER,
            exe_path          TEXT,
            exe_name          TEXT,
            working_directory TEXT,
            launch_arguments  TEXT,

            -- Playtime (seconds, like Playnite)
            playtime_seconds  INTEGER DEFAULT 0,
            play_count        INTEGER DEFAULT 0,
            last_played_at    INTEGER,

            -- Media
            cover_path        TEXT,
            landscape_path    TEXT,
            background_path   TEXT,
            logo_path         TEXT,
            icon_path         TEXT,

            -- Metadata
            release_date      TEXT,
            description       TEXT,
            short_description TEXT,
            genres            TEXT,
            developers        TEXT,
            publishers        TEXT,
            categories        TEXT,
            features          TEXT,
            tags              TEXT,

            -- Scores
            user_score        TEXT,
            critic_score      TEXT,
            community_score   TEXT,
            review_summary    TEXT,
            review_count      TEXT,

            -- Links (cross-provider)
            linked_app_id     TEXT,
            linked_igdb_id    TEXT,

            -- State
            is_favorite       INTEGER DEFAULT 0,
            is_hidden         INTEGER DEFAULT 0,
            standalone        INTEGER DEFAULT 0,
            sorting_name      TEXT,

            -- Series / Rating
            series            TEXT,
            age_rating        TEXT,
            region            TEXT,
            completion_status TEXT,

            -- Lua overlay
            has_lua           INTEGER DEFAULT 0,

            -- Provider-specific overrides (JSON blob)
            provider_metadata TEXT,

            created_at        INTEGER NOT NULL,
            updated_at        INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_games_v2_source ON games_v2(source);
        CREATE INDEX IF NOT EXISTS idx_games_v2_app_id ON games_v2(app_id);
        CREATE INDEX IF NOT EXISTS idx_games_v2_library_id ON games_v2(library_id);
        CREATE INDEX IF NOT EXISTS idx_games_v2_is_installed ON games_v2(is_installed);
        ",
    )
    .map_err(|e| format!("Failed to create games_v2 table: {}", e))?;

    println!("[SqliteCache] migration v4 → v5 complete: games_v2 table created");
    Ok(())
}

/// Migration v5 → v6: Migrate playtime_entries → games_v2.
///
/// Key format mapping:
///   - `app-{steamId}`  → `steam-{steamId}`
///   - `manual:<uuid>`  → `manual:<uuid>` (unchanged)
///   - `epic:<id>`      → `epic:<id>` (unchanged)
///   - `debrid:<id>`    → `debrid:<id>` (unchanged)
///
/// Games that exist in playtime_entries but not in games_v2 are skipped
/// (they will be handled when their source is synced to games_v2).
fn migrate_v5_to_v6(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v5 → v6: migrating playtime_entries → games_v2");

    // Check if playtime_entries table exists (first install may not have it)
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='playtime_entries'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if !table_exists {
        println!("[SqliteCache] playtime_entries table not found — skipping migration");
        return Ok(());
    }

    // Read all playtime entries
    let mut stmt = conn
        .prepare(
            "SELECT game_key, app_id, provider, title, playtime_source,
                    external_playtime_seconds, external_source, external_imported_at,
                    local_playtime_seconds, total_playtime_seconds,
                    last_played_at, last_session_seconds
             FROM playtime_entries",
        )
        .map_err(|e| format!("Failed to prepare playtime_entries query: {}", e))?;

    let entries: Vec<(String, Option<String>, String, String, Option<String>,
        i64, Option<String>, Option<i64>,
        i64, i64,
        Option<i64>, Option<i64>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,          // game_key
                row.get::<_, Option<String>>(1)?,  // app_id
                row.get::<_, String>(2)?,           // provider
                row.get::<_, String>(3)?,           // title
                row.get::<_, Option<String>>(4)?,  // playtime_source
                row.get::<_, i64>(5)?,              // external_playtime_seconds
                row.get::<_, Option<String>>(6)?,  // external_source
                row.get::<_, Option<i64>>(7)?,     // external_imported_at
                row.get::<_, i64>(8)?,              // local_playtime_seconds
                row.get::<_, i64>(9)?,              // total_playtime_seconds
                row.get::<_, Option<i64>>(10)?,    // last_played_at
                row.get::<_, Option<i64>>(11)?,    // last_session_seconds
            ))
        })
        .map_err(|e| format!("Failed to query playtime_entries: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Count playtime sessions per game_key
    let mut session_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut s_stmt = conn
            .prepare("SELECT game_key, COUNT(*) FROM playtime_sessions GROUP BY game_key")
            .map_err(|e| format!("Failed to prepare session count query: {}", e))?;
        let rows = s_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("Failed to query session counts: {}", e))?;
        for row in rows {
            if let Ok((key, count)) = row {
                session_counts.insert(key, count);
            }
        }
    }

    let mut migrated = 0u64;
    let mut skipped = 0u64;

    for (
        game_key, app_id, _provider, title, _playtime_source,
        external_secs, _ext_source, _ext_imported,
        local_secs, total_secs,
        last_played, _last_session,
    ) in &entries
    {
        let game_id = map_playtime_key_to_game_id(game_key, app_id.as_deref());

        // Only update if game exists in games_v2
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM games_v2 WHERE id = ?1",
                [&game_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;

        if !exists {
            skipped += 1;
            continue;
        }

        // Use total_playtime_seconds (external + local merged)
        let playtime = if *total_secs > 0 {
            *total_secs
        } else {
            external_secs + local_secs
        };

        let play_count = session_counts.get(game_key).copied().unwrap_or(0);
        let last_played_at = *last_played;

        conn.execute(
            "UPDATE games_v2
             SET playtime_seconds = ?1,
                 play_count = ?2,
                 last_played_at = ?3,
                 updated_at = ?4
             WHERE id = ?5",
            rusqlite::params![
                playtime,
                play_count,
                last_played_at,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64,
                game_id,
            ],
        )
        .map_err(|e| format!("Failed to update playtime for {}: {}", game_id, e))?;

        migrated += 1;
    }

    println!(
        "[SqliteCache] migration v5 → v6 complete: migrated {} entries, skipped {} (not in games_v2)",
        migrated, skipped
    );
    Ok(())
}

/// Map a playtime_entries game_key to a games_v2 id.
///
/// - `app-{steamId}` → `steam-{steamId}`
/// - `manual:<uuid>` → `manual:<uuid>`
/// - `epic:<id>`     → `epic:<id>`
/// - `debrid:<id>`   → `debrid:<id>`
/// - fallback: return game_key as-is (for any future provider format)
fn map_playtime_key_to_game_id(game_key: &str, app_id: Option<&str>) -> String {
    if let Some(key) = game_key.strip_prefix("app-") {
        // Steam game: "app-730" → "steam-730"
        return format!("steam-{}", key);
    }

    if game_key.starts_with("manual:")
        || game_key.starts_with("epic:")
        || game_key.starts_with("debrid:")
    {
        // Already in the correct format
        return game_key.to_string();
    }

    // Fallback: if we have an app_id, construct steam-{appId}
    if let Some(id) = app_id {
        if !id.is_empty() {
            return format!("steam-{}", id);
        }
    }

    // Last resort: use game_key as-is
    game_key.to_string()
}

/// Migration v6 → v7: Drop playtime_entries table (data migrated to games_v2 in v5→v6).
/// Keep playtime_sessions — still used by session tracking (will be migrated in Fase 4).
fn migrate_v6_to_v7(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v6 → v7: dropping playtime_entries table");

    // Check if playtime_entries table exists
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='playtime_entries'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if table_exists {
        conn.execute_batch("DROP TABLE IF EXISTS playtime_entries;")
            .map_err(|e| format!("Failed to drop playtime_entries: {}", e))?;
        println!("[SqliteCache] dropped playtime_entries table");
    } else {
        println!("[SqliteCache] playtime_entries table not found — skipping drop");
    }

    println!("[SqliteCache] migration v6 → v7 complete: playtime_entries dropped");
    Ok(())
}

/// Migration v7 → v8: Initialize old achievement tables (if not exist).
/// These will be migrated to new schema with FK in v8→v9.
fn migrate_v7_to_v8(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v7 → v8: initializing achievement tables");

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS achievement_summaries (
            app_id          TEXT NOT NULL,
            source          TEXT NOT NULL DEFAULT 'steam-official',
            platform        TEXT NOT NULL DEFAULT 'steam-official',
            unlocked        INTEGER NOT NULL DEFAULT 0,
            total           INTEGER NOT NULL DEFAULT 0,
            in_progress     INTEGER NOT NULL DEFAULT 0,
            completion_time INTEGER,
            last_unlock_at  INTEGER,
            updated_at      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (app_id, platform)
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
    .map_err(|e| format!("Failed to create old achievement tables: {}", e))?;

    println!("[SqliteCache] migration v7 → v8 complete: old achievement tables initialized");
    Ok(())
}

/// Migration v8 → v9: Create new achievement tables with FK to games_v2.
///
/// New tables:
///   - achievements (replaces achievement_entries)
///   - achievement_progress (new)
///   - achievement_summaries (new schema with game_id + source)
///   - achievement_percentages (new schema with game_id)
///
/// Migrates data from old tables, mapping app_id → game_id.
/// Old tables are dropped after migration.
fn migrate_v8_to_v9(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v8 → v9: creating new achievement tables with FK to games_v2");

    // Create new tables with foreign keys
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS achievements_new (
            id              TEXT PRIMARY KEY,
            game_id         TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            platform        TEXT NOT NULL DEFAULT 'steam-official',
            api_name        TEXT NOT NULL,
            name            TEXT,
            description     TEXT,
            icon_url        TEXT,
            icon_gray       TEXT,
            hidden          INTEGER NOT NULL DEFAULT 0,
            global_pct      REAL,
            updated_at      INTEGER NOT NULL DEFAULT 0,
            UNIQUE(game_id, platform, api_name)
        );

        CREATE TABLE IF NOT EXISTS achievement_progress_new (
            id              TEXT PRIMARY KEY,
            game_id         TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            platform        TEXT NOT NULL DEFAULT 'steam-official',
            api_name        TEXT NOT NULL,
            unlocked        INTEGER NOT NULL DEFAULT 0,
            unlock_time     INTEGER,
            unlocked_at     INTEGER,
            updated_at      INTEGER NOT NULL DEFAULT 0,
            UNIQUE(game_id, platform, api_name)
        );

        CREATE TABLE IF NOT EXISTS achievement_summaries_new (
            game_id         TEXT PRIMARY KEY REFERENCES games_v2(id) ON DELETE CASCADE,
            platform        TEXT NOT NULL DEFAULT 'steam-official',
            source          TEXT NOT NULL DEFAULT 'local-cache',
            unlocked        INTEGER NOT NULL DEFAULT 0,
            total           INTEGER NOT NULL DEFAULT 0,
            in_progress     INTEGER NOT NULL DEFAULT 0,
            completion_time INTEGER,
            last_unlock_at  INTEGER,
            updated_at      INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS achievement_percentages_new (
            game_id     TEXT PRIMARY KEY REFERENCES games_v2(id) ON DELETE CASCADE,
            entries     TEXT NOT NULL DEFAULT '[]',
            updated_at  INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .map_err(|e| format!("Failed to create new achievement tables: {}", e))?;

    // Migrate achievement_entries → achievements_new + achievement_progress_new
    let entries_exist: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='achievement_entries'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if entries_exist {
        // Migrate entries to achievements_new (schema data)
        conn.execute_batch(
            "INSERT OR IGNORE INTO achievements_new (id, game_id, platform, api_name, name, description, icon_url, icon_gray, hidden, global_pct, updated_at)
             SELECT
                app_id || ':' || COALESCE(api_name, '') AS id,
                'steam-' || app_id AS game_id,
                'steam-official' AS platform,
                api_name,
                name,
                description,
                icon_url,
                icon_gray,
                hidden,
                global_pct,
                updated_at
             FROM achievement_entries;",
        )
        .map_err(|e| format!("Failed to migrate achievement_entries to achievements_new: {}", e))?;

        // Migrate entries to achievement_progress_new (progress data)
        conn.execute_batch(
            "INSERT OR IGNORE INTO achievement_progress_new (id, game_id, platform, api_name, unlocked, unlock_time, unlocked_at, updated_at)
             SELECT
                app_id || ':' || COALESCE(api_name, '') AS id,
                'steam-' || app_id AS game_id,
                'steam-official' AS platform,
                api_name,
                unlocked,
                unlock_time,
                unlocked_at,
                updated_at
             FROM achievement_entries
             WHERE unlocked = 1;",
        )
        .map_err(|e| format!("Failed to migrate achievement_entries to achievement_progress_new: {}", e))?;

        println!("[SqliteCache] migrated achievement_entries → achievements_new + achievement_progress_new");
    }

    // Migrate achievement_summaries → achievement_summaries_new
    let summaries_exist: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='achievement_summaries'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if summaries_exist {
        conn.execute_batch(
            "INSERT OR IGNORE INTO achievement_summaries_new (game_id, platform, source, unlocked, total, in_progress, completion_time, last_unlock_at, updated_at)
             SELECT
                'steam-' || app_id AS game_id,
                COALESCE(platform, 'steam-official') AS platform,
                COALESCE(source, 'local-cache') AS source,
                unlocked,
                total,
                in_progress,
                completion_time,
                last_unlock_at,
                updated_at
             FROM achievement_summaries;",
        )
        .map_err(|e| format!("Failed to migrate achievement_summaries: {}", e))?;

        println!("[SqliteCache] migrated achievement_summaries → achievement_summaries_new");
    }

    // Migrate achievement_percentages → achievement_percentages_new
    let percentages_exist: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='achievement_percentages'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if percentages_exist {
        conn.execute_batch(
            "INSERT OR IGNORE INTO achievement_percentages_new (game_id, entries, updated_at)
             SELECT
                'steam-' || app_id AS game_id,
                entries,
                updated_at
             FROM achievement_percentages;",
        )
        .map_err(|e| format!("Failed to migrate achievement_percentages: {}", e))?;

        println!("[SqliteCache] migrated achievement_percentages → achievement_percentages_new");
    }

    // Drop old tables
    conn.execute_batch(
        "DROP TABLE IF EXISTS achievement_entries;
         DROP TABLE IF EXISTS achievement_summaries;
         DROP TABLE IF EXISTS achievement_percentages;",
    )
    .map_err(|e| format!("Failed to drop old achievement tables: {}", e))?;

    // Rename new tables to final names
    conn.execute_batch(
        "ALTER TABLE achievements_new RENAME TO achievements;
         ALTER TABLE achievement_progress_new RENAME TO achievement_progress;
         ALTER TABLE achievement_summaries_new RENAME TO achievement_summaries;
         ALTER TABLE achievement_percentages_new RENAME TO achievement_percentages;",
    )
    .map_err(|e| format!("Failed to rename achievement tables: {}", e))?;

    // Create indexes
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_achievements_game_id ON achievements(game_id);
         CREATE INDEX IF NOT EXISTS idx_achievement_progress_game_id ON achievement_progress(game_id);
         CREATE INDEX IF NOT EXISTS idx_achievements_platform ON achievements(platform);",
    )
    .map_err(|e| format!("Failed to create achievement indexes: {}", e))?;

    println!("[SqliteCache] migration v8 → v9 complete: new achievement tables created with FK to games_v2");
    Ok(())
}

/// Migration v9 → v10: Create game_sessions table with FK to games_v2.
/// Migrates data from playtime_sessions, mapping game_key → game_id.
fn migrate_v9_to_v10(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v9 → v10: creating game_sessions table");

    // Create game_sessions table
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS game_sessions (
            session_id      TEXT PRIMARY KEY,
            game_id         TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            started_at      INTEGER NOT NULL DEFAULT 0,
            ended_at        INTEGER,
            duration_seconds INTEGER,
            exit_reason     TEXT,
            source          TEXT NOT NULL DEFAULT 'local'
        );

        CREATE INDEX IF NOT EXISTS idx_game_sessions_game_id ON game_sessions(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_started_at ON game_sessions(started_at);
        ",
    )
    .map_err(|e| format!("Failed to create game_sessions table: {}", e))?;

    // Migrate playtime_sessions → game_sessions
    let sessions_exist: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='playtime_sessions'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        > 0;

    if sessions_exist {
        // Migrate sessions, mapping game_key → game_id
        conn.execute_batch(
            "INSERT OR IGNORE INTO game_sessions (session_id, game_id, started_at, ended_at, duration_seconds, exit_reason, source)
             SELECT
                session_id,
                CASE
                    WHEN game_key LIKE 'app-%' THEN 'steam-' || SUBSTR(game_key, 5)
                    WHEN game_key LIKE 'manual:%' THEN game_key
                    WHEN game_key LIKE 'epic:%' THEN game_key
                    WHEN game_key LIKE 'debrid:%' THEN game_key
                    ELSE game_key
                END AS game_id,
                started_at,
                ended_at,
                duration_seconds,
                exit_reason,
                'local' AS source
             FROM playtime_sessions;",
        )
        .map_err(|e| format!("Failed to migrate playtime_sessions: {}", e))?;

        // Drop old table
        conn.execute_batch("DROP TABLE IF EXISTS playtime_sessions;")
            .map_err(|e| format!("Failed to drop playtime_sessions: {}", e))?;

        println!("[SqliteCache] migrated playtime_sessions → game_sessions");
    }

    // Migrate localStorage session-history-v1 if it exists in a temp table
    // (This is handled by the TypeScript side during boot)

    println!("[SqliteCache] migration v9 → v10 complete: game_sessions table created");
    Ok(())
}

/// Migration v10 → v11: Create normalized entity tables + junction tables.
/// Migrates JSON arrays from games_v2 into proper relational tables.
fn migrate_v10_to_v11(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v10 → v11: creating entity tables");

    conn.execute_batch(
        "
        -- ============================================
        -- ENTITY TABLES (normalized, deduplicated)
        -- ============================================

        CREATE TABLE IF NOT EXISTS genres (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS companies (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS categories (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS features (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );

        -- ============================================
        -- JUNCTION TABLES (game ↔ entity)
        -- ============================================

        CREATE TABLE IF NOT EXISTS game_genres (
            game_id  TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, genre_id)
        );

        CREATE TABLE IF NOT EXISTS game_developers (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, company_id)
        );

        CREATE TABLE IF NOT EXISTS game_publishers (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, company_id)
        );

        CREATE TABLE IF NOT EXISTS game_categories (
            game_id     TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, category_id)
        );

        CREATE TABLE IF NOT EXISTS game_features (
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, feature_id)
        );

        CREATE TABLE IF NOT EXISTS game_tags (
            game_id TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (game_id, tag_id)
        );

        -- ============================================
        -- INDEXES for junction tables
        -- ============================================

        CREATE INDEX IF NOT EXISTS idx_game_genres_genre ON game_genres(genre_id);
        CREATE INDEX IF NOT EXISTS idx_game_developers_company ON game_developers(company_id);
        CREATE INDEX IF NOT EXISTS idx_game_publishers_company ON game_publishers(company_id);
        CREATE INDEX IF NOT EXISTS idx_game_categories_category ON game_categories(category_id);
        CREATE INDEX IF NOT EXISTS idx_game_features_feature ON game_features(feature_id);
        CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags(tag_id);
        ",
    )
    .map_err(|e| format!("Failed to create entity tables: {}", e))?;

    // Migrate JSON arrays from games_v2 into junction tables
    // Read all games with JSON entity data and populate junction tables
    {
        let mut stmt = conn
            .prepare("SELECT id, genres, developers, publishers, categories, features, tags FROM games_v2 WHERE genres IS NOT NULL OR developers IS NOT NULL OR publishers IS NOT NULL OR categories IS NOT NULL OR features IS NOT NULL OR tags IS NOT NULL")
            .map_err(|e| format!("Failed to prepare migration query: {}", e))?;

        let rows: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| format!("Failed to query games_v2: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        let mut migrated = 0;
        for (game_id, genres, developers, publishers, categories, features, tags) in &rows {
            // Helper macro to migrate a JSON array to a junction table
            macro_rules! migrate_array {
                ($json:expr, $entity_table:expr, $junction_table:expr) => {
                    if let Some(ref json) = $json {
                        if let Ok(items) = serde_json::from_str::<Vec<String>>(json) {
                            for item in items {
                                let trimmed = item.trim();
                                if trimmed.is_empty() {
                                    continue;
                                }
                                // Get or create entity
                                let entity_id: i64 = conn
                                    .query_row(
                                        &format!("SELECT id FROM {} WHERE name = ?1", $entity_table),
                                        [trimmed],
                                        |row| row.get(0),
                                    )
                                    .unwrap_or_else(|_| {
                                        conn.execute(
                                            &format!("INSERT INTO {} (name) VALUES (?1)", $entity_table),
                                            [trimmed],
                                        )
                                        .ok();
                                        conn.last_insert_rowid()
                                    });

                                // Insert junction record
                                conn.execute(
                                    &format!(
                                        "INSERT OR IGNORE INTO {} (game_id, entity_id) VALUES (?1, ?2)",
                                        $junction_table
                                    ),
                                    rusqlite::params![game_id, entity_id],
                                )
                                .ok();
                            }
                        }
                    }
                };
            }

            migrate_array!(genres, "genres", "game_genres");
            migrate_array!(developers, "companies", "game_developers");
            migrate_array!(publishers, "companies", "game_publishers");
            migrate_array!(categories, "categories", "game_categories");
            migrate_array!(features, "features", "game_features");
            migrate_array!(tags, "tags", "game_tags");

            migrated += 1;
        }

        println!(
            "[SqliteCache] migrated {} games with entity data to junction tables",
            migrated
        );
    }

    println!("[SqliteCache] migration v10 → v11 complete: entity tables created + data migrated");
    Ok(())
}

/// Migration v11 → v12: Create game_files unified file registry.
fn migrate_v11_to_v12(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v11 → v12: creating game_files table");

    conn.execute_batch(
        "
        -- ============================================
        -- GAME FILES: unified file registry per game
        -- Replaces: media_manifests, media_cache, metadata_cache install fields,
        --           depot-manifests localStorage
        -- ============================================
        CREATE TABLE IF NOT EXISTS game_files (
            game_id              TEXT PRIMARY KEY REFERENCES games_v2(id) ON DELETE CASCADE,

            -- Install info (from metadata_cache + installed_games_registry)
            install_dir          TEXT,
            exe_path             TEXT,
            exe_name             TEXT,
            installed            INTEGER NOT NULL DEFAULT 0,
            last_validated       INTEGER NOT NULL DEFAULT 0,

            -- Media: cover
            cover_path           TEXT,
            cover_exists         INTEGER NOT NULL DEFAULT 0,
            cover_size           INTEGER,
            cover_modified_at    INTEGER,

            -- Media: landscape
            landscape_path       TEXT,
            landscape_exists     INTEGER NOT NULL DEFAULT 0,
            landscape_size       INTEGER,
            landscape_modified_at INTEGER,

            -- Media: background
            background_path      TEXT,
            background_exists    INTEGER NOT NULL DEFAULT 0,
            background_size      INTEGER,
            background_modified_at INTEGER,

            -- Media: logo
            logo_path            TEXT,
            logo_exists          INTEGER NOT NULL DEFAULT 0,
            logo_size            INTEGER,
            logo_modified_at     INTEGER,

            -- Media: icon
            icon_path            TEXT,
            icon_exists          INTEGER NOT NULL DEFAULT 0,
            icon_size            INTEGER,
            icon_modified_at     INTEGER,

            -- Depot info (from depot-manifests localStorage)
            depot_manifests      TEXT,
            dest_dir             TEXT,
            downloaded_at        INTEGER,

            -- Source fingerprints (from media_manifests)
            fingerprints         TEXT,

            updated_at           INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_game_files_installed ON game_files(installed);
        CREATE INDEX IF NOT EXISTS idx_game_files_updated ON game_files(updated_at);
        ",
    )
    .map_err(|e| format!("Failed to create game_files table: {}", e))?;

    // Migrate data from media_manifests → game_files (if media_manifests exists)
    {
        let has_media_manifests: bool = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_manifests'")
            .and_then(|mut stmt| {
                stmt.query_row([], |row| row.get::<_, String>(0))
                    .map(|_| true)
                    .or(Ok(false))
            })
            .unwrap_or(false);

        if has_media_manifests {
            let mut stmt = conn
                .prepare(
                    "SELECT app_id, cover_path, cover_exists, cover_size, cover_modified_at,
                        landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                        background_path, background_exists, background_size, background_modified_at,
                        logo_path, logo_exists, logo_size, logo_modified_at,
                        icon_path, icon_exists, icon_size, icon_modified_at
                     FROM media_manifests",
                )
                .map_err(|e| format!("Failed to prepare media_manifests query: {}", e))?;

            let rows: Vec<(String, Option<String>, i64, Option<i64>, Option<i64>, Option<String>, i64, Option<i64>, Option<i64>, Option<String>, i64, Option<i64>, Option<i64>, Option<String>, i64, Option<i64>, Option<i64>, Option<String>, i64, Option<i64>, Option<i64>)> = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get(1)?, row.get::<_, i64>(2)?, row.get(3)?, row.get(4)?,
                        row.get(5)?, row.get::<_, i64>(6)?, row.get(7)?, row.get(8)?,
                        row.get(9)?, row.get::<_, i64>(10)?, row.get(11)?, row.get(12)?,
                        row.get(13)?, row.get::<_, i64>(14)?, row.get(15)?, row.get(16)?,
                        row.get(17)?, row.get::<_, i64>(18)?, row.get(19)?, row.get(20)?,
                    ))
                })
                .map_err(|e| format!("Failed to query media_manifests: {}", e))?
                .filter_map(|r| r.ok())
                .collect();

            let mut migrated = 0;
            for row in &rows {
                let (app_id, cover_path, cover_exists, cover_size, cover_modified_at,
                     landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                     background_path, background_exists, background_size, background_modified_at,
                     logo_path, logo_exists, logo_size, logo_modified_at,
                     icon_path, icon_exists, icon_size, icon_modified_at) = row;

                conn.execute(
                    "INSERT INTO game_files (game_id, cover_path, cover_exists, cover_size, cover_modified_at,
                        landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                        background_path, background_exists, background_size, background_modified_at,
                        logo_path, logo_exists, logo_size, logo_modified_at,
                        icon_path, icon_exists, icon_size, icon_modified_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
                     ON CONFLICT(game_id) DO UPDATE SET
                        cover_path = COALESCE(?2, cover_path), cover_exists = ?3, cover_size = ?4, cover_modified_at = ?5,
                        landscape_path = COALESCE(?6, landscape_path), landscape_exists = ?7, landscape_size = ?8, landscape_modified_at = ?9,
                        background_path = COALESCE(?10, background_path), background_exists = ?11, background_size = ?12, background_modified_at = ?13,
                        logo_path = COALESCE(?14, logo_path), logo_exists = ?15, logo_size = ?16, logo_modified_at = ?17,
                        icon_path = COALESCE(?18, icon_path), icon_exists = ?19, icon_size = ?20, icon_modified_at = ?21",
                    rusqlite::params![
                        app_id, cover_path, cover_exists, cover_size, cover_modified_at,
                        landscape_path, landscape_exists, landscape_size, landscape_modified_at,
                        background_path, background_exists, background_size, background_modified_at,
                        logo_path, logo_exists, logo_size, logo_modified_at,
                        icon_path, icon_exists, icon_size, icon_modified_at,
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64,
                    ],
                )
                .ok();
                migrated += 1;
            }

            println!(
                "[SqliteCache] migrated {} media manifests → game_files",
                migrated
            );
        }
    }

    println!("[SqliteCache] migration v11 → v12 complete: game_files table created + media migrated");
    Ok(())
}

/// Migration v12 → v13: Create import_exclusions table.
fn migrate_v12_to_v13(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v12 → v13: creating import_exclusions table");

    conn.execute_batch(
        "
        -- ============================================
        -- IMPORT EXCLUSIONS: games/folders to skip on scan
        -- ============================================
        CREATE TABLE IF NOT EXISTS import_exclusions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id    TEXT,
            folder     TEXT,
            title      TEXT,
            reason     TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_import_exclusions_game ON import_exclusions(game_id);
        CREATE INDEX IF NOT EXISTS idx_import_exclusions_folder ON import_exclusions(folder);
        ",
    )
    .map_err(|e| format!("Failed to create import_exclusions table: {}", e))?;

    println!("[SqliteCache] migration v12 → v13 complete: import_exclusions table created");
    Ok(())
}

/// Migration v13 → v14: Create game_actions table.
fn migrate_v13_to_v14(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v13 → v14: creating game_actions table");

    conn.execute_batch(
        "
        -- ============================================
        -- GAME ACTIONS: custom actions per game
        -- ============================================
        CREATE TABLE IF NOT EXISTS game_actions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id    TEXT NOT NULL REFERENCES games_v2(id) ON DELETE CASCADE,
            action_type TEXT NOT NULL DEFAULT 'custom',
            label      TEXT NOT NULL,
            command    TEXT NOT NULL,
            arguments  TEXT,
            icon       TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_game_actions_game ON game_actions(game_id);
        CREATE INDEX IF NOT EXISTS idx_game_actions_type ON game_actions(action_type);
        ",
    )
    .map_err(|e| format!("Failed to create game_actions table: {}", e))?;

    println!("[SqliteCache] migration v13 → v14 complete: game_actions table created");
    Ok(())
}

/// Migration v14 → v15: Drop dead table `achievement_game_configs`.
fn migrate_v14_to_v15(conn: &Connection) -> Result<(), String> {
    println!("[SqliteCache] running migration v14 → v15: dropping dead table achievement_game_configs");

    let has_table: bool = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='achievement_game_configs'")
        .and_then(|mut stmt| {
            stmt.query_row([], |row| row.get::<_, String>(0))
                .map(|_| true)
                .or_else(|_| Ok(false))
        })
        .unwrap_or(false);

    if has_table {
        conn.execute_batch("DROP TABLE IF EXISTS achievement_game_configs;")
            .map_err(|e| format!("Failed to drop achievement_game_configs: {}", e))?;
        println!("[SqliteCache] dropped achievement_game_configs table");
    } else {
        println!("[SqliteCache] achievement_game_configs table not found — skipping drop");
    }

    println!("[SqliteCache] migration v14 → v15 complete");
    Ok(())
}

#[tauri::command]
pub fn check_sqlite_health(
    core: tauri::State<'_, SqliteCoreDb>,
    achievements: tauri::State<'_, SqliteAchievementsDb>,
    store: tauri::State<'_, SqliteStoreDb>,
) -> Result<bool, String> {
    Ok(core.0.is_some() && achievements.0.is_some() && store.0.is_some())
}
