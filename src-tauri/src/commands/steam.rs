use std::fs;
use std::path::{Path, PathBuf};

use crate::models::steam_installed_game::SteamInstalledGame;
use crate::models::steam_paths::SteamPaths;
use crate::utils::path_utils;

#[tauri::command]
pub fn detect_steam_paths() -> Option<SteamPaths> {
    path_utils::detect_steam_paths()
}

#[tauri::command]
pub fn scan_steam_installed_games(
    steam_path: Option<String>,
    lua_path: Option<String>,
    depotcache_path: Option<String>,
) -> Result<Vec<SteamInstalledGame>, String> {
    let root = resolve_steam_root(steam_path.as_deref(), lua_path.as_deref(), depotcache_path.as_deref());
    let root = match root {
        Some(r) => r,
        None => return Ok(Vec::new()),
    };

    let steamapps_dir = root.join("steamapps");
    if !steamapps_dir.exists() || !steamapps_dir.is_dir() {
        return Ok(Vec::new());
    }

    let root_str = root.to_string_lossy().to_string();
    let library_paths = collect_library_paths(&steamapps_dir);

    let mut games = Vec::new();

    for lib_path in &library_paths {
        let entries = match fs::read_dir(lib_path) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }
            if let Some(game) = parse_appmanifest(&path, lib_path, &root_str) {
                games.push(game);
            }
        }
    }

    Ok(games)
}

fn resolve_steam_root(
    steam_path: Option<&str>,
    lua_path: Option<&str>,
    depotcache_path: Option<&str>,
) -> Option<PathBuf> {
    // 1. Direct steam_path
    if let Some(sp) = steam_path {
        let p = PathBuf::from(sp);
        if is_valid_steam_root(&p) {
            return Some(p);
        }
    }

    // 2. Derive from lua_path: lua is at {root}/config/lua
    if let Some(lp) = lua_path {
        let p = PathBuf::from(lp);
        // Navigate up from config/lua to root
        if let Some(parent) = p.parent().and_then(|p| p.parent()) {
            if is_valid_steam_root(parent) {
                return Some(parent.to_path_buf());
            }
        }
    }

    // 3. Derive from depotcache_path: depotcache is at {root}/depotcache
    if let Some(dp) = depotcache_path {
        let p = PathBuf::from(dp);
        if let Some(parent) = p.parent() {
            if is_valid_steam_root(parent) {
                return Some(parent.to_path_buf());
            }
        }
    }

    // 4. Try auto-detection (registry / common paths)
    path_utils::detect_steam_paths()
        .and_then(|sp| {
            let p = PathBuf::from(&sp.steam_root);
            if is_valid_steam_root(&p) { Some(p) } else { None }
        })
}

fn is_valid_steam_root(path: &Path) -> bool {
    if !path.exists() || !path.is_dir() {
        return false;
    }
    let steamapps = path.join("steamapps");
    if !steamapps.exists() || !steamapps.is_dir() {
        return false;
    }
    true
}

fn collect_library_paths(steamapps_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    // Always include the main steamapps
    paths.push(steamapps_dir.to_path_buf());

    let libraryfolders_path = steamapps_dir.join("libraryfolders.vdf");
    if !libraryfolders_path.exists() {
        return paths;
    }

    let content = match fs::read_to_string(&libraryfolders_path) {
        Ok(c) => c,
        Err(_) => return paths,
    };

    // Parse both old flat format and new nested format
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Look for a quoted line that starts a block: "0", "1", etc.
        if trimmed.starts_with('"') && trimmed.ends_with('{') {
            // This is a library entry block start: "0" {
            // Check if the value is right after the key on the same line
            let inner = &trimmed[1..trimmed.len() - 1].trim();
            let key_parts: Vec<&str> = inner.splitn(2, '"').collect();
            let key = if key_parts.len() > 1 {
                key_parts[0].trim()
            } else {
                inner
            };

            if key.parse::<u32>().is_ok() {
                // Nested format: look for "path" inside this block
                let block_content = read_vdf_block(&lines, &mut i);
                for block_line in &block_content {
                    if let Some(path) = extract_vdf_key_value(block_line, "path") {
                        let lib_steamapps = PathBuf::from(&path).join("steamapps");
                        if lib_steamapps.exists() && lib_steamapps.is_dir() {
                            paths.push(lib_steamapps);
                        }
                        break;
                    }
                }
                continue;
            }
        }

        // Flat format: "0" "C:\\path"
        if let Some(path) = extract_vdf_flat_path(trimmed) {
            let lib_steamapps = PathBuf::from(&path).join("steamapps");
            if lib_steamapps.exists() && lib_steamapps.is_dir() {
                paths.push(lib_steamapps);
            }
        }

        i += 1;
    }

    // Deduplicate
    paths.sort();
    paths.dedup();

    paths
}

fn read_vdf_block(lines: &[&str], start: &mut usize) -> Vec<String> {
    let mut depth = 1;
    let mut content = Vec::new();
    *start += 1;

    while *start < lines.len() && depth > 0 {
        let line = lines[*start].trim();
        if line == "{" {
            depth += 1;
        } else if line == "}" {
            depth -= 1;
        } else if depth > 0 {
            content.push(lines[*start].trim().to_string());
        }
        *start += 1;
    }

    content
}

fn extract_vdf_key_value(line: &str, target_key: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with('"') {
        return None;
    }
    let parts: Vec<&str> = trimmed.split('"').collect();
    if parts.len() < 5 {
        return None;
    }
    let key = parts[1].trim().to_lowercase();
    if key == target_key {
        Some(parts[3].trim().to_string())
    } else {
        None
    }
}

fn extract_vdf_flat_path(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if !trimmed.contains('"') {
        return None;
    }
    let parts: Vec<&str> = trimmed.split('"').collect();
    if parts.len() < 5 {
        return None;
    }
    let key = parts[1].trim();
    if key.parse::<u32>().is_ok() {
        let value = parts[3].trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn parse_appmanifest(
    path: &Path,
    library_steamapps_dir: &Path,
    steam_root: &str,
) -> Option<SteamInstalledGame> {
    let content = fs::read_to_string(path).ok()?;
    let mut app_id: Option<u32> = None;
    let mut name: Option<String> = None;
    let mut install_dir: Option<String> = None;
    let mut state_flags: Option<u64> = None;
    let mut size_on_disk: Option<u64> = None;
    let mut build_id: Option<String> = None;
    let mut last_updated: Option<u64> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('"') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('"').collect();
        if parts.len() < 5 {
            continue;
        }
        let key = parts[1].trim().to_lowercase();
        let value = parts[3].trim();
        match key.as_str() {
            "appid" => app_id = value.parse::<u32>().ok(),
            "name" => name = Some(value.to_string()),
            "installdir" => install_dir = Some(value.to_string()),
            "stateflags" => state_flags = value.parse::<u64>().ok(),
            "sizeondisk" => size_on_disk = value.parse::<u64>().ok(),
            "buildid" => build_id = Some(value.to_string()),
            "lastupdated" => last_updated = value.parse::<u64>().ok(),
            _ => {}
        }
    }

    let app_id = app_id?;
    let install_dir_val = install_dir;
    let manifest_path = path.to_string_lossy().to_string();

    let install_path = install_dir_val.as_ref().map(|dir| {
        library_steamapps_dir
            .join("common")
            .join(dir)
            .to_string_lossy()
            .to_string()
    });

    let install_dir_exists = install_path
        .as_ref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false);

    let is_installed = install_dir_exists || (state_flags.unwrap_or(0) & 4 != 0);

    Some(SteamInstalledGame {
        app_id,
        name: name.unwrap_or_else(|| format!("Steam App {}", app_id)),
        install_dir: install_dir_val,
        library_path: library_steamapps_dir.to_string_lossy().to_string(),
        steam_root: Some(steam_root.to_string()),
        manifest_path,
        install_path,
        state_flags,
        size_on_disk,
        build_id,
        last_updated,
        is_installed,
    })
}
