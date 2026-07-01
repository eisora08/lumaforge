use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use crate::commands::sqlite_cache::SqliteDb;
use crate::commands::steam::{normalize_steam_library_path, collect_library_roots_from_vdf, parse_appmanifest, is_valid_steamapps_path};
use crate::commands::metadata::resolve_steam_app_metadata;
use crate::models::steam_installed_game::SteamInstalledGame;

const BATCH_SIZE: usize = 10;

fn debug_log(msg: impl std::fmt::Display) {
    eprintln!("[steam-index] {}", msg);
}

fn collect_all_steamapps_dirs(
    steam_path: Option<&str>,
    lua_path: Option<&str>,
    depotcache_path: Option<&str>,
    game_scan_folders: Option<&[String]>,
) -> Vec<(PathBuf, PathBuf)> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(sp) = steam_path {
        candidates.push(PathBuf::from(sp));
    }
    if let Some(lp) = lua_path {
        candidates.push(PathBuf::from(lp));
    }
    if let Some(dp) = depotcache_path {
        candidates.push(PathBuf::from(dp));
    }
    if let Some(folders) = game_scan_folders {
        for f in folders {
            candidates.push(PathBuf::from(f));
        }
    }

    if let Some(sp) = crate::utils::path_utils::detect_steam_paths() {
        let p = PathBuf::from(&sp.steam_root);
        let p_lower = p.to_string_lossy().to_lowercase();
        let already = candidates.iter().any(|c| c.to_string_lossy().to_lowercase() == p_lower);
        if !already {
            candidates.push(p);
        }
    }

    let mut normalized_libs = Vec::new();
    let mut seen_steamapps: HashSet<String> = HashSet::new();

    for candidate in &candidates {
        let Some(lib_path) = normalize_steam_library_path(candidate) else { continue };
        if !is_valid_steamapps_path(&lib_path.steamapps_path) { continue }
        let key = lib_path.steamapps_path.to_string_lossy().to_lowercase();
        if seen_steamapps.insert(key) {
            normalized_libs.push(lib_path);
        }
    }

    let mut all_dirs: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut seen_all: HashSet<String> = HashSet::new();

    for lib in &normalized_libs {
        let key = lib.steamapps_path.to_string_lossy().to_lowercase();
        if seen_all.insert(key) {
            all_dirs.push((lib.steamapps_path.clone(), lib.common_path.clone()));
        }

        let vdf_path = lib.steamapps_path.join("libraryfolders.vdf");
        if !vdf_path.is_file() { continue }

        let extra_roots = collect_library_roots_from_vdf(&vdf_path);
        for root_path in extra_roots {
            if let Some(extra_lib) = normalize_steam_library_path(&root_path) {
                let extra_key = extra_lib.steamapps_path.to_string_lossy().to_lowercase();
                if seen_all.insert(extra_key) {
                    all_dirs.push((extra_lib.steamapps_path, extra_lib.common_path));
                }
            }
        }
    }

    all_dirs
}

fn scan_all_manifests(all_dirs: &[(PathBuf, PathBuf)]) -> Vec<SteamInstalledGame> {
    let mut games = Vec::new();

    for (steamapps_dir, common_path) in all_dirs {
        let entries = match fs::read_dir(steamapps_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() { continue }
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }
            if let Some(game) = parse_appmanifest(&path, common_path, steamapps_dir) {
                games.push(game);
            }
        }
    }

    games
}

#[tauri::command]
pub fn scan_and_build_full_dataset(
    steam_path: Option<String>,
    lua_path: Option<String>,
    depotcache_path: Option<String>,
    game_scan_folders: Option<Vec<String>>,
    db: tauri::State<'_, SqliteDb>,
) -> Result<i64, String> {
    debug_log("Starting full dataset scan...");

    let app_dirs = collect_all_steamapps_dirs(
        steam_path.as_deref(),
        lua_path.as_deref(),
        depotcache_path.as_deref(),
        game_scan_folders.as_deref(),
    );

    let all_games = scan_all_manifests(&app_dirs);
    debug_log(format!("Found {} manifests", all_games.len()));

    let app_ids: Vec<u32> = all_games.iter().map(|g| g.app_id).collect();

    // Write basic entries first (no metadata)
    let guard = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Err("Database not available".to_string()),
    };

    for game in &all_games {
        let _ = guard.execute(
            "INSERT OR REPLACE INTO games (appId, title, installed, playtime, lastPlayed, metadata_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                game.app_id.to_string(),
                game.name,
                game.is_installed as i32,
                0i64,
                0i64,
                "{}",
                0i64,
            ],
        );
    }

    drop(guard);

    // Resolve metadata in batches
    let total_batches = (app_ids.len() + BATCH_SIZE - 1) / BATCH_SIZE;
    debug_log(format!("Resolving metadata in {} batches...", total_batches));

    for (batch_idx, chunk) in app_ids.chunks(BATCH_SIZE).enumerate() {
        debug_log(format!("Batch {}/{} ({} apps)", batch_idx + 1, total_batches, chunk.len()));

        let metadata_results = match resolve_steam_app_metadata(chunk.to_vec()) {
            Ok(results) => results,
            Err(e) => {
                debug_log(format!("Batch {} failed: {}", batch_idx + 1, e));
                continue;
            }
        };

        let guard2 = match &db.0 {
            Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
            None => continue,
        };

        for meta in &metadata_results {
            let meta_json = serde_json::to_string(meta).unwrap_or_else(|_| "{}".to_string());
            let _ = guard2.execute(
                "UPDATE games SET title = ?1, metadata_json = ?2, updated_at = ?3 WHERE appId = ?4",
                rusqlite::params![
                    meta.name,
                    meta_json,
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64,
                    meta.app_id.to_string(),
                ],
            );
        }

        drop(guard2);
    }

    // Get final count
    let guard3 = match &db.0 {
        Some(mutex) => mutex.lock().map_err(|e| format!("Lock error: {}", e))?,
        None => return Ok(0),
    };

    let count: i64 = guard3
        .query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))
        .map_err(|e| format!("Count error: {}", e))?;

    debug_log(format!("Full dataset scan complete: {} games", count));
    Ok(count)
}
