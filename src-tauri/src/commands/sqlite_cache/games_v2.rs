use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::SqliteCoreDb;

// ---------------------------------------------------------------------------
// games_v2 — unified game table (migration v5+)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameV2 {
    pub id: String,
    pub title: String,
    pub source: String,
    #[serde(default)]
    pub app_id: Option<String>,
    #[serde(default)]
    pub provider_game_id: Option<String>,
    #[serde(default)]
    pub library_id: Option<String>,

    // Installation
    #[serde(default)]
    pub is_installed: bool,
    #[serde(default)]
    pub install_dir: Option<String>,
    #[serde(default)]
    pub install_size: Option<i64>,
    #[serde(default)]
    pub exe_path: Option<String>,
    #[serde(default)]
    pub exe_name: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub launch_arguments: Option<String>,

    // Playtime
    #[serde(default)]
    pub playtime_seconds: i64,
    #[serde(default)]
    pub play_count: i64,
    #[serde(default)]
    pub last_played_at: Option<i64>,

    // Media
    #[serde(default)]
    pub cover_path: Option<String>,
    #[serde(default)]
    pub landscape_path: Option<String>,
    #[serde(default)]
    pub background_path: Option<String>,
    #[serde(default)]
    pub logo_path: Option<String>,
    #[serde(default)]
    pub icon_path: Option<String>,

    // Metadata
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub short_description: Option<String>,
    #[serde(default)]
    pub genres: Option<String>,
    #[serde(default)]
    pub developers: Option<String>,
    #[serde(default)]
    pub publishers: Option<String>,
    #[serde(default)]
    pub categories: Option<String>,
    #[serde(default)]
    pub features: Option<String>,
    #[serde(default)]
    pub tags: Option<String>,

    // Scores
    #[serde(default)]
    pub user_score: Option<String>,
    #[serde(default)]
    pub critic_score: Option<String>,
    #[serde(default)]
    pub community_score: Option<String>,
    #[serde(default)]
    pub review_summary: Option<String>,
    #[serde(default)]
    pub review_count: Option<String>,

    // Links
    #[serde(default)]
    pub linked_app_id: Option<String>,
    #[serde(default)]
    pub linked_igdb_id: Option<String>,

    // State
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(default)]
    pub is_hidden: bool,
    #[serde(default)]
    pub standalone: bool,
    #[serde(default)]
    pub sorting_name: Option<String>,

    // Series / Rating
    #[serde(default)]
    pub series: Option<String>,
    #[serde(default)]
    pub age_rating: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub completion_status: Option<String>,

    // Lua overlay
    #[serde(default)]
    pub has_lua: bool,

    // Provider-specific overrides
    #[serde(default)]
    pub provider_metadata: Option<String>,

    pub created_at: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Inner functions (take &Mutex<Connection>)
// ---------------------------------------------------------------------------

pub fn upsert_game_v2_inner(db: &Mutex<Connection>, game: &GameV2) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO games_v2 (
            id, title, source, app_id, provider_game_id, library_id,
            is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
            playtime_seconds, play_count, last_played_at,
            cover_path, landscape_path, background_path, logo_path, icon_path,
            release_date, description, short_description, genres, developers, publishers, categories, features, tags,
            user_score, critic_score, community_score, review_summary, review_count,
            linked_app_id, linked_igdb_id,
            is_favorite, is_hidden, standalone, sorting_name,
            series, age_rating, region, completion_status,
            has_lua, provider_metadata, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16,
            ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
            ?31, ?32, ?33, ?34, ?35,
            ?36, ?37,
            ?38, ?39, ?40, ?41,
            ?42, ?43, ?44, ?45,
            ?46, ?47, ?48, ?49
        )
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            source = excluded.source,
            app_id = COALESCE(excluded.app_id, games_v2.app_id),
            provider_game_id = COALESCE(excluded.provider_game_id, games_v2.provider_game_id),
            library_id = COALESCE(excluded.library_id, games_v2.library_id),
            is_installed = excluded.is_installed,
            install_dir = COALESCE(excluded.install_dir, games_v2.install_dir),
            install_size = COALESCE(excluded.install_size, games_v2.install_size),
            exe_path = COALESCE(excluded.exe_path, games_v2.exe_path),
            exe_name = COALESCE(excluded.exe_name, games_v2.exe_name),
            working_directory = COALESCE(excluded.working_directory, games_v2.working_directory),
            launch_arguments = COALESCE(excluded.launch_arguments, games_v2.launch_arguments),
            playtime_seconds = CASE WHEN excluded.playtime_seconds IS NULL OR excluded.playtime_seconds = 0 THEN games_v2.playtime_seconds ELSE excluded.playtime_seconds END,
            play_count = CASE WHEN excluded.play_count IS NULL OR excluded.play_count = 0 THEN games_v2.play_count ELSE excluded.play_count END,
            last_played_at = COALESCE(NULLIF(excluded.last_played_at, 0), games_v2.last_played_at),
            cover_path = COALESCE(excluded.cover_path, games_v2.cover_path),
            landscape_path = COALESCE(excluded.landscape_path, games_v2.landscape_path),
            background_path = COALESCE(excluded.background_path, games_v2.background_path),
            logo_path = COALESCE(excluded.logo_path, games_v2.logo_path),
            icon_path = COALESCE(excluded.icon_path, games_v2.icon_path),
            release_date = COALESCE(excluded.release_date, games_v2.release_date),
            description = COALESCE(excluded.description, games_v2.description),
            short_description = COALESCE(excluded.short_description, games_v2.short_description),
            genres = COALESCE(excluded.genres, games_v2.genres),
            developers = COALESCE(excluded.developers, games_v2.developers),
            publishers = COALESCE(excluded.publishers, games_v2.publishers),
            categories = COALESCE(excluded.categories, games_v2.categories),
            features = COALESCE(excluded.features, games_v2.features),
            tags = COALESCE(excluded.tags, games_v2.tags),
            user_score = COALESCE(excluded.user_score, games_v2.user_score),
            critic_score = COALESCE(excluded.critic_score, games_v2.critic_score),
            community_score = COALESCE(excluded.community_score, games_v2.community_score),
            review_summary = COALESCE(excluded.review_summary, games_v2.review_summary),
            review_count = COALESCE(excluded.review_count, games_v2.review_count),
            linked_app_id = COALESCE(excluded.linked_app_id, games_v2.linked_app_id),
            linked_igdb_id = COALESCE(excluded.linked_igdb_id, games_v2.linked_igdb_id),
            is_favorite = excluded.is_favorite,
            is_hidden = excluded.is_hidden,
            standalone = excluded.standalone,
            sorting_name = COALESCE(excluded.sorting_name, games_v2.sorting_name),
            series = COALESCE(excluded.series, games_v2.series),
            age_rating = COALESCE(excluded.age_rating, games_v2.age_rating),
            region = COALESCE(excluded.region, games_v2.region),
            completion_status = COALESCE(excluded.completion_status, games_v2.completion_status),
            has_lua = excluded.has_lua,
            provider_metadata = COALESCE(excluded.provider_metadata, games_v2.provider_metadata),
            updated_at = excluded.updated_at",
        rusqlite::params![
            game.id,
            game.title,
            game.source,
            game.app_id,
            game.provider_game_id,
            game.library_id,
            game.is_installed as i32,
            game.install_dir,
            game.install_size,
            game.exe_path,
            game.exe_name,
            game.working_directory,
            game.launch_arguments,
            game.playtime_seconds,
            game.play_count,
            game.last_played_at,
            game.cover_path,
            game.landscape_path,
            game.background_path,
            game.logo_path,
            game.icon_path,
            game.release_date,
            game.description,
            game.short_description,
            game.genres,
            game.developers,
            game.publishers,
            game.categories,
            game.features,
            game.tags,
            game.user_score,
            game.critic_score,
            game.community_score,
            game.review_summary,
            game.review_count,
            game.linked_app_id,
            game.linked_igdb_id,
            game.is_favorite as i32,
            game.is_hidden as i32,
            game.standalone as i32,
            game.sorting_name,
            game.series,
            game.age_rating,
            game.region,
            game.completion_status,
            game.has_lua as i32,
            game.provider_metadata,
            game.created_at,
            game.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert game_v2: {}", e))?;
    Ok(())
}

pub fn batch_upsert_games_v2_inner(db: &Mutex<Connection>, games: &[GameV2]) -> Result<(), String> {
    if games.is_empty() {
        return Ok(());
    }
    let conn = db.lock().unwrap();
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    for game in games {
        tx.execute(
            "INSERT INTO games_v2 (
                id, title, source, app_id, provider_game_id, library_id,
                is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                playtime_seconds, play_count, last_played_at,
                cover_path, landscape_path, background_path, logo_path, icon_path,
                release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                user_score, critic_score, community_score, review_summary, review_count,
                linked_app_id, linked_igdb_id,
                is_favorite, is_hidden, standalone, sorting_name,
                series, age_rating, region, completion_status,
                has_lua, provider_metadata, created_at, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16,
                ?17, ?18, ?19, ?20, ?21,
                ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
                ?31, ?32, ?33, ?34, ?35,
                ?36, ?37,
                ?38, ?39, ?40, ?41,
                ?42, ?43, ?44, ?45,
                ?46, ?47, ?48, ?49
            )
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                source = excluded.source,
                app_id = COALESCE(excluded.app_id, games_v2.app_id),
                provider_game_id = COALESCE(excluded.provider_game_id, games_v2.provider_game_id),
                library_id = COALESCE(excluded.library_id, games_v2.library_id),
                is_installed = excluded.is_installed,
                install_dir = COALESCE(excluded.install_dir, games_v2.install_dir),
                install_size = COALESCE(excluded.install_size, games_v2.install_size),
                exe_path = COALESCE(excluded.exe_path, games_v2.exe_path),
                exe_name = COALESCE(excluded.exe_name, games_v2.exe_name),
                working_directory = COALESCE(excluded.working_directory, games_v2.working_directory),
                launch_arguments = COALESCE(excluded.launch_arguments, games_v2.launch_arguments),
                playtime_seconds = CASE WHEN excluded.playtime_seconds IS NULL OR excluded.playtime_seconds = 0 THEN games_v2.playtime_seconds ELSE excluded.playtime_seconds END,
                play_count = CASE WHEN excluded.play_count IS NULL OR excluded.play_count = 0 THEN games_v2.play_count ELSE excluded.play_count END,
                last_played_at = COALESCE(NULLIF(excluded.last_played_at, 0), games_v2.last_played_at),
                cover_path = COALESCE(excluded.cover_path, games_v2.cover_path),
                landscape_path = COALESCE(excluded.landscape_path, games_v2.landscape_path),
                background_path = COALESCE(excluded.background_path, games_v2.background_path),
                logo_path = COALESCE(excluded.logo_path, games_v2.logo_path),
                icon_path = COALESCE(excluded.icon_path, games_v2.icon_path),
                release_date = COALESCE(excluded.release_date, games_v2.release_date),
                description = COALESCE(excluded.description, games_v2.description),
                short_description = COALESCE(excluded.short_description, games_v2.short_description),
                genres = COALESCE(excluded.genres, games_v2.genres),
                developers = COALESCE(excluded.developers, games_v2.developers),
                publishers = COALESCE(excluded.publishers, games_v2.publishers),
                categories = COALESCE(excluded.categories, games_v2.categories),
                features = COALESCE(excluded.features, games_v2.features),
                tags = COALESCE(excluded.tags, games_v2.tags),
                user_score = COALESCE(excluded.user_score, games_v2.user_score),
                critic_score = COALESCE(excluded.critic_score, games_v2.critic_score),
                community_score = COALESCE(excluded.community_score, games_v2.community_score),
                review_summary = COALESCE(excluded.review_summary, games_v2.review_summary),
                review_count = COALESCE(excluded.review_count, games_v2.review_count),
                linked_app_id = COALESCE(excluded.linked_app_id, games_v2.linked_app_id),
                linked_igdb_id = COALESCE(excluded.linked_igdb_id, games_v2.linked_igdb_id),
                is_favorite = excluded.is_favorite,
                is_hidden = excluded.is_hidden,
                standalone = excluded.standalone,
                sorting_name = COALESCE(excluded.sorting_name, games_v2.sorting_name),
                series = COALESCE(excluded.series, games_v2.series),
                age_rating = COALESCE(excluded.age_rating, games_v2.age_rating),
                region = COALESCE(excluded.region, games_v2.region),
                completion_status = COALESCE(excluded.completion_status, games_v2.completion_status),
                has_lua = excluded.has_lua,
                provider_metadata = COALESCE(excluded.provider_metadata, games_v2.provider_metadata),
                updated_at = excluded.updated_at",
            rusqlite::params![
                game.id,
                game.title,
                game.source,
                game.app_id,
                game.provider_game_id,
                game.library_id,
                game.is_installed as i32,
                game.install_dir,
                game.install_size,
                game.exe_path,
                game.exe_name,
                game.working_directory,
                game.launch_arguments,
                game.playtime_seconds,
                game.play_count,
                game.last_played_at,
                game.cover_path,
                game.landscape_path,
                game.background_path,
                game.logo_path,
                game.icon_path,
                game.release_date,
                game.description,
                game.short_description,
                game.genres,
                game.developers,
                game.publishers,
                game.categories,
                game.features,
                game.tags,
                game.user_score,
                game.critic_score,
                game.community_score,
                game.review_summary,
                game.review_count,
                game.linked_app_id,
                game.linked_igdb_id,
                game.is_favorite as i32,
                game.is_hidden as i32,
                game.standalone as i32,
                game.sorting_name,
                game.series,
                game.age_rating,
                game.region,
                game.completion_status,
                game.has_lua as i32,
                game.provider_metadata,
                game.created_at,
                game.updated_at,
            ],
        )
        .map_err(|e| format!("Failed to batch upsert game_v2 {}: {}", game.id, e))?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    let after_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM games_v2", [], |row| row.get(0))
        .unwrap_or(-1);
    println!(
        "[GAMES_V2][RUST] batch_upsert committed {} games, total in DB now: {}",
        games.len(),
        after_count
    );
    Ok(())
}

pub fn get_game_v2_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<Option<GameV2>, String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT id, title, source, app_id, provider_game_id, library_id,
                is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                playtime_seconds, play_count, last_played_at,
                cover_path, landscape_path, background_path, logo_path, icon_path,
                release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                user_score, critic_score, community_score, review_summary, review_count,
                linked_app_id, linked_igdb_id,
                is_favorite, is_hidden, standalone, sorting_name,
                series, age_rating, region, completion_status,
                has_lua, provider_metadata, created_at, updated_at
         FROM games_v2 WHERE id = ?1",
        [game_id],
        |row| map_row_to_game_v2(row),
    )
    .optional()
    .map_err(|e| format!("Failed to get game_v2: {}", e))
}

pub fn get_game_v2_by_app_id_inner(
    db: &Mutex<Connection>,
    app_id: &str,
) -> Result<Option<GameV2>, String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT id, title, source, app_id, provider_game_id, library_id,
                is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                playtime_seconds, play_count, last_played_at,
                cover_path, landscape_path, background_path, logo_path, icon_path,
                release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                user_score, critic_score, community_score, review_summary, review_count,
                linked_app_id, linked_igdb_id,
                is_favorite, is_hidden, standalone, sorting_name,
                series, age_rating, region, completion_status,
                has_lua, provider_metadata, created_at, updated_at
         FROM games_v2 WHERE app_id = ?1 LIMIT 1",
        [app_id],
        |row| map_row_to_game_v2(row),
    )
    .optional()
    .map_err(|e| format!("Failed to get game_v2 by app_id: {}", e))
}

pub fn get_games_v2_by_app_id_inner(
    db: &Mutex<Connection>,
    app_id: &str,
) -> Result<Vec<GameV2>, String> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, source, app_id, provider_game_id, library_id,
                    is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                    playtime_seconds, play_count, last_played_at,
                    cover_path, landscape_path, background_path, logo_path, icon_path,
                    release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                    user_score, critic_score, community_score, review_summary, review_count,
                    linked_app_id, linked_igdb_id,
                    is_favorite, is_hidden, standalone, sorting_name,
                    series, age_rating, region, completion_status,
                    has_lua, provider_metadata, created_at, updated_at
             FROM games_v2 WHERE app_id = ?1",
        )
        .map_err(|e| format!("Failed to prepare get_games_v2_by_app_id: {}", e))?;
    let rows = stmt
        .query_map([app_id], |row| map_row_to_game_v2(row))
        .map_err(|e| format!("Failed to query games_v2 by app_id: {}", e))?;
    let mut games = Vec::new();
    for row in rows {
        games.push(row.map_err(|e| format!("Failed to map game_v2 row: {}", e))?);
    }
    Ok(games)
}

pub fn get_all_games_v2_inner(db: &Mutex<Connection>) -> Result<Vec<GameV2>, String> {
    let conn = db.lock().unwrap();
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM games_v2", [], |row| row.get(0))
        .unwrap_or(-1);
    let mut stmt = conn
        .prepare(
            "SELECT id, title, source, app_id, provider_game_id, library_id,
                    is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                    playtime_seconds, play_count, last_played_at,
                    cover_path, landscape_path, background_path, logo_path, icon_path,
                    release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                    user_score, critic_score, community_score, review_summary, review_count,
                    linked_app_id, linked_igdb_id,
                    is_favorite, is_hidden, standalone, sorting_name,
                    series, age_rating, region, completion_status,
                    has_lua, provider_metadata, created_at, updated_at
             FROM games_v2 ORDER BY title ASC",
        )
        .map_err(|e| format!("Failed to prepare get_all_games_v2: {}", e))?;
    let rows = stmt
        .query_map([], |row| map_row_to_game_v2(row))
        .map_err(|e| format!("Failed to query games_v2: {}", e))?;
    let mut games = Vec::new();
    for row in rows {
        games.push(row.map_err(|e| format!("Failed to map game_v2 row: {}", e))?);
    }
    println!("[GAMES_V2][RUST] get_all_games_v2: total_rows={} returned={}", total, games.len());
    Ok(games)
}

pub fn get_games_v2_by_source_inner(
    db: &Mutex<Connection>,
    source: &str,
) -> Result<Vec<GameV2>, String> {
    let conn = db.lock().unwrap();
    let source_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM games_v2 WHERE source = ?1", [source], |row| row.get(0))
        .unwrap_or(-1);
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM games_v2", [], |row| row.get(0))
        .unwrap_or(-1);
    let mut stmt = conn
        .prepare(
            "SELECT id, title, source, app_id, provider_game_id, library_id,
                    is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                    playtime_seconds, play_count, last_played_at,
                    cover_path, landscape_path, background_path, logo_path, icon_path,
                    release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                    user_score, critic_score, community_score, review_summary, review_count,
                    linked_app_id, linked_igdb_id,
                    is_favorite, is_hidden, standalone, sorting_name,
                    series, age_rating, region, completion_status,
                    has_lua, provider_metadata, created_at, updated_at
             FROM games_v2 WHERE source = ?1 ORDER BY title ASC",
        )
        .map_err(|e| format!("Failed to prepare get_games_v2_by_source: {}", e))?;
    let rows = stmt
        .query_map([source], |row| map_row_to_game_v2(row))
        .map_err(|e| format!("Failed to query games_v2 by source: {}", e))?;
    let mut games = Vec::new();
    for row in rows {
        games.push(row.map_err(|e| format!("Failed to map game_v2 row: {}", e))?);
    }
    println!("[GAMES_V2][RUST] get_by_source '{}' total_in_db={} source_count={} returned={}", source, total, source_count, games.len());
    Ok(games)
}

pub fn search_games_v2_inner(
    db: &Mutex<Connection>,
    query: &str,
) -> Result<Vec<GameV2>, String> {
    let conn = db.lock().unwrap();
    let search_pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare(
            "SELECT id, title, source, app_id, provider_game_id, library_id,
                    is_installed, install_dir, install_size, exe_path, exe_name, working_directory, launch_arguments,
                    playtime_seconds, play_count, last_played_at,
                    cover_path, landscape_path, background_path, logo_path, icon_path,
                    release_date, description, short_description, genres, developers, publishers, categories, features, tags,
                    user_score, critic_score, community_score, review_summary, review_count,
                    linked_app_id, linked_igdb_id,
                    is_favorite, is_hidden, standalone, sorting_name,
                    series, age_rating, region, completion_status,
                    has_lua, provider_metadata, created_at, updated_at
             FROM games_v2 WHERE title LIKE ?1 ORDER BY title ASC",
        )
        .map_err(|e| format!("Failed to prepare search_games_v2: {}", e))?;
    let rows = stmt
        .query_map([search_pattern], |row| map_row_to_game_v2(row))
        .map_err(|e| format!("Failed to search games_v2: {}", e))?;
    let mut games = Vec::new();
    for row in rows {
        games.push(row.map_err(|e| format!("Failed to map game_v2 row: {}", e))?);
    }
    Ok(games)
}

pub fn delete_game_v2_inner(db: &Mutex<Connection>, game_id: &str) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute("DELETE FROM games_v2 WHERE id = ?1", [game_id])
        .map_err(|e| format!("Failed to delete game_v2: {}", e))?;
    Ok(())
}

pub fn get_game_v2_count_inner(db: &Mutex<Connection>) -> Result<i64, String> {
    let conn = db.lock().unwrap();
    conn.query_row("SELECT COUNT(*) FROM games_v2", [], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("Failed to count games_v2: {}", e))
}

// ---------------------------------------------------------------------------
// Helper: map a rusqlite Row to GameV2
// ---------------------------------------------------------------------------

fn map_row_to_game_v2(row: &rusqlite::Row<'_>) -> rusqlite::Result<GameV2> {
    Ok(GameV2 {
        id: row.get(0)?,
        title: row.get(1)?,
        source: row.get(2)?,
        app_id: row.get(3)?,
        provider_game_id: row.get(4)?,
        library_id: row.get(5)?,
        is_installed: row.get::<_, i32>(6)? != 0,
        install_dir: row.get(7)?,
        install_size: row.get(8)?,
        exe_path: row.get(9)?,
        exe_name: row.get(10)?,
        working_directory: row.get(11)?,
        launch_arguments: row.get(12)?,
        playtime_seconds: row.get(13)?,
        play_count: row.get(14)?,
        last_played_at: row.get(15)?,
        cover_path: row.get(16)?,
        landscape_path: row.get(17)?,
        background_path: row.get(18)?,
        logo_path: row.get(19)?,
        icon_path: row.get(20)?,
        release_date: row.get(21)?,
        description: row.get(22)?,
        short_description: row.get(23)?,
        genres: row.get(24)?,
        developers: row.get(25)?,
        publishers: row.get(26)?,
        categories: row.get(27)?,
        features: row.get(28)?,
        tags: row.get(29)?,
        user_score: row.get(30)?,
        critic_score: row.get(31)?,
        community_score: row.get(32)?,
        review_summary: row.get(33)?,
        review_count: row.get(34)?,
        linked_app_id: row.get(35)?,
        linked_igdb_id: row.get(36)?,
        is_favorite: row.get::<_, i32>(37)? != 0,
        is_hidden: row.get::<_, i32>(38)? != 0,
        standalone: row.get::<_, i32>(39)? != 0,
        sorting_name: row.get(40)?,
        series: row.get(41)?,
        age_rating: row.get(42)?,
        region: row.get(43)?,
        completion_status: row.get(44)?,
        has_lua: row.get::<_, i32>(45)? != 0,
        provider_metadata: row.get(46)?,
        created_at: row.get(47)?,
        updated_at: row.get(48)?,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn upsert_game_v2(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    game: GameV2,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        eprintln!("[GAMES_V2][RUST] upsert: DB IS NONE! Cannot write game {}", game.id);
        return Ok(());
    };
    upsert_game_v2_inner(db, &game)?;
    crate::utils::progress_utils::emit_data_changed(&app, "games-upserted", "1");
    Ok(())
}

#[tauri::command]
pub fn batch_upsert_games_v2(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    games: Vec<GameV2>,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        eprintln!("[GAMES_V2][RUST] batch_upsert: DB IS NONE! Cannot write {} games", games.len());
        return Ok(());
    };
    batch_upsert_games_v2_inner(db, &games)?;
    // Notify TS subscribers (dataChangeBus) so LibraryGamesContext re-reads from games_v2
    crate::utils::progress_utils::emit_data_changed(&app, "games-upserted", &games.len().to_string());
    Ok(())
}

#[tauri::command]
pub fn get_game_v2(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<Option<GameV2>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    get_game_v2_inner(db, &game_id)
}

#[tauri::command]
pub fn get_game_v2_by_app_id(
    state: tauri::State<'_, SqliteCoreDb>,
    app_id: String,
) -> Result<Option<GameV2>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(None);
    };
    get_game_v2_by_app_id_inner(db, &app_id)
}

#[tauri::command]
pub fn get_games_v2_by_app_id(
    state: tauri::State<'_, SqliteCoreDb>,
    app_id: String,
) -> Result<Vec<GameV2>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    get_games_v2_by_app_id_inner(db, &app_id)
}

#[tauri::command]
pub fn get_all_games_v2(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<Vec<GameV2>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        eprintln!("[GAMES_V2][RUST] get_all_games_v2: DB IS NONE!");
        return Ok(Vec::new());
    };
    get_all_games_v2_inner(db)
}

#[tauri::command]
pub fn get_games_v2_by_source(
    state: tauri::State<'_, SqliteCoreDb>,
    source: String,
) -> Result<Vec<GameV2>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        eprintln!("[GAMES_V2][RUST] get_games_v2_by_source: DB IS NONE! source={}", source);
        return Ok(Vec::new());
    };
    get_games_v2_by_source_inner(db, &source)
}

#[tauri::command]
pub fn search_games_v2(
    state: tauri::State<'_, SqliteCoreDb>,
    query: String,
) -> Result<Vec<GameV2>, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(Vec::new());
    };
    search_games_v2_inner(db, &query)
}

#[tauri::command]
pub fn delete_game_v2(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    delete_game_v2_inner(db, &game_id)?;
    crate::utils::progress_utils::emit_data_changed(&app, "games-deleted", &game_id);
    Ok(())
}

#[tauri::command]
pub fn get_game_v2_count(
    state: tauri::State<'_, SqliteCoreDb>,
) -> Result<i64, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(0);
    };
    get_game_v2_count_inner(db)
}

// ---------------------------------------------------------------------------
// Playtime commands
// ---------------------------------------------------------------------------

/// Update playtime_seconds and last_played_at for a game.
pub fn update_playtime_v2_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    seconds: i64,
    last_played: i64,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE games_v2
         SET playtime_seconds = ?1,
             last_played_at = ?2,
             updated_at = ?3
         WHERE id = ?4",
        rusqlite::params![seconds, last_played, last_played, game_id],
    )
    .map_err(|e| format!("Failed to update playtime_v2: {}", e))?;
    Ok(())
}

/// Increment play_count by 1 for a game.
pub fn increment_play_count_v2_inner(
    db: &Mutex<Connection>,
    game_id: &str,
) -> Result<i64, String> {
    let conn = db.lock().unwrap();
    conn.execute(
        "UPDATE games_v2
         SET play_count = play_count + 1,
             updated_at = ?1
         WHERE id = ?2",
        rusqlite::params![chrono_now_secs(), game_id],
    )
    .map_err(|e| format!("Failed to increment play_count_v2: {}", e))?;
    let count: i64 = conn
        .query_row(
            "SELECT play_count FROM games_v2 WHERE id = ?1",
            [game_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(count)
}

/// Add playtime_seconds to existing value (delta update).
pub fn add_playtime_v2_inner(
    db: &Mutex<Connection>,
    game_id: &str,
    delta_seconds: i64,
) -> Result<i64, String> {
    let conn = db.lock().unwrap();
    let now = chrono_now_secs();
    conn.execute(
        "UPDATE games_v2
         SET playtime_seconds = playtime_seconds + ?1,
             last_played_at = ?2,
             updated_at = ?3
         WHERE id = ?4",
        rusqlite::params![delta_seconds, now, now, game_id],
    )
    .map_err(|e| format!("Failed to add playtime_v2: {}", e))?;
    let total: i64 = conn
        .query_row(
            "SELECT playtime_seconds FROM games_v2 WHERE id = ?1",
            [game_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(total)
}

fn chrono_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ---------------------------------------------------------------------------
// Tauri commands — playtime
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_playtime_v2(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
    seconds: i64,
    last_played: i64,
) -> Result<(), String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(());
    };
    update_playtime_v2_inner(db, &game_id, seconds, last_played)
}

#[tauri::command]
pub fn increment_play_count_v2(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
) -> Result<i64, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(0);
    };
    increment_play_count_v2_inner(db, &game_id)
}

#[tauri::command]
pub fn add_playtime_v2(
    state: tauri::State<'_, SqliteCoreDb>,
    game_id: String,
    delta_seconds: i64,
) -> Result<i64, String> {
    let db = state.0.as_ref();
    let Some(db) = db else {
        return Ok(0);
    };
    add_playtime_v2_inner(db, &game_id, delta_seconds)
}
