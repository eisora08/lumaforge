use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;

fn debug_log(msg: impl std::fmt::Display) {
    eprintln!("[steam-scan] {}", msg);
}

use crate::models::steam_installed_game::SteamInstalledGame;
use crate::models::steam_paths::SteamPaths;
use crate::utils::path_utils;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub bytes_downloaded: u64,
    pub bytes_to_download: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamGameInstallStatus {
    pub is_installed: bool,
    pub is_completed: bool,
    pub state_flags: Option<u64>,
    pub install_path: Option<String>,
    pub install_dir: Option<String>,
    pub library_path: Option<String>,
    pub name: Option<String>,
    pub size_on_disk: Option<u64>,
    pub last_updated: Option<u64>,
    pub download_progress: Option<DownloadProgress>,
}

pub struct SteamLibraryPath {
    pub library_root: PathBuf,
    pub steamapps_path: PathBuf,
    pub common_path: PathBuf,
}

#[tauri::command]
pub fn detect_steam_paths() -> Option<SteamPaths> {
    path_utils::detect_steam_paths()
}

pub fn normalize_steam_library_path(input: &Path) -> Option<SteamLibraryPath> {
    if !input.exists() {
        return None;
    }

    let leaf = input.file_name().and_then(|n| n.to_str());

    // Case 1: input is directly a steamapps folder
    //   e.g. E:\SteamLibrary\steamapps
    if leaf == Some("steamapps") && input.is_dir() {
        let parent = input.parent()?;
        let common = input.join("common");
        return Some(SteamLibraryPath {
            library_root: parent.to_path_buf(),
            steamapps_path: input.to_path_buf(),
            common_path: if common.is_dir() { common } else { input.join("common") },
        });
    }

    // Case 2: input is a common folder directly
    //   e.g. E:\SteamLibrary\steamapps\common
    if leaf == Some("common") && input.is_dir() {
        if let Some(parent) = input.parent() {
            if parent.file_name().and_then(|n| n.to_str()) == Some("steamapps") {
                let library_root = parent.parent()?;
                return Some(SteamLibraryPath {
                    library_root: library_root.to_path_buf(),
                    steamapps_path: parent.to_path_buf(),
                    common_path: input.to_path_buf(),
                });
            }
        }
    }

    // Case 3: input/steamapps exists (steam root or library root)
    //   e.g. C:\Program Files (x86)\Steam Luma
    //   e.g. E:\SteamLibrary
    let steamapps = input.join("steamapps");
    if steamapps.is_dir() {
        let common = steamapps.join("common");
        return Some(SteamLibraryPath {
            library_root: input.to_path_buf(),
            steamapps_path: steamapps.clone(),
            common_path: if common.is_dir() { common } else { steamapps.join("common") },
        });
    }

    None
}

/// Check common drive-root locations for Steam library folders — no deep scanning.
pub fn collect_safe_fallback_steam_paths() -> Vec<PathBuf> {
    let mut results = Vec::new();

    let patterns = &[
        "SteamLibrary",
        "Games/SteamLibrary",
        "Steam",
        "Program Files (x86)/Steam",
        "Program Files/Steam",
    ];

    for ch in 'C' as u8..='Z' as u8 {
        let drive = format!("{}:\\", ch as char);
        let drive_path = Path::new(&drive);
        if !drive_path.exists() || !drive_path.is_dir() {
            continue;
        }

        for pattern in patterns {
            let candidate = drive_path.join(pattern.replace("/", "\\"));
            let steamapps = candidate.join("steamapps");
            if steamapps.is_dir() {
                if let Ok(canon) = candidate.canonicalize() {
                    if !results.contains(&canon) {
                        results.push(canon);
                    }
                } else if !results.contains(&candidate) {
                    results.push(candidate);
                }
            }
        }
    }

    results
}

pub fn is_valid_steamapps_path(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    if path.join("common").is_dir() {
        return true;
    }
    if path.join("libraryfolders.vdf").is_file() {
        return true;
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(name_str) = name.to_str() {
                if name_str.starts_with("appmanifest_") && name_str.ends_with(".acf") {
                    return true;
                }
            }
        }
    }
    false
}

#[tauri::command]
pub fn scan_steam_installed_games(
    steam_path: Option<String>,
    lua_path: Option<String>,
    depotcache_path: Option<String>,
    game_scan_folders: Option<Vec<String>>,
) -> Result<Vec<SteamInstalledGame>, String> {
    debug_log("===== Steam scan start =====");

    // ---- Step 1: collect candidate paths from every source ----
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(ref sp) = steam_path {
        candidates.push(PathBuf::from(sp));
        debug_log(format_args!("candidate from steamPath: {}", sp));
    }
    if let Some(ref lp) = lua_path {
        candidates.push(PathBuf::from(lp));
        debug_log(format_args!("candidate from luaPath: {}", lp));
    }
    if let Some(ref dp) = depotcache_path {
        candidates.push(PathBuf::from(dp));
        debug_log(format_args!("candidate from depotcachePath: {}", dp));
    }
    if let Some(ref folders) = game_scan_folders {
        for f in folders {
            candidates.push(PathBuf::from(f));
            debug_log(format_args!("candidate from gameScanFolders: {}", f));
        }
    }

    // Add auto-detected Steam root if not already present
    if let Some(sp) = path_utils::detect_steam_paths() {
        let p = PathBuf::from(&sp.steam_root);
        let p_lower = p.to_string_lossy().to_lowercase();
        let already = candidates.iter().any(|c| c.to_string_lossy().to_lowercase() == p_lower);
        if !already {
            debug_log(format_args!("candidate from auto-detect: {}", p.display()));
            candidates.push(p);
        }
    }

    // Add safe fallback paths from common drive-root locations
    let safe_fallback = collect_safe_fallback_steam_paths();
    for fp in &safe_fallback {
        let fp_lower = fp.to_string_lossy().to_lowercase();
        let already = candidates.iter().any(|c| c.to_string_lossy().to_lowercase() == fp_lower);
        if !already {
            debug_log(format_args!("candidate from safe fallback: {}", fp.display()));
            candidates.push(fp.clone());
        }
    }
    if safe_fallback.len() > 0 {
        debug_log(format_args!("safe fallback paths found: {}", safe_fallback.len()));
    }

    debug_log(format_args!("total candidates: {}", candidates.len()));

    // ---- Step 2: normalize each candidate into SteamLibraryPath ----
    let mut normalized_libs: Vec<SteamLibraryPath> = Vec::new();
    let mut seen_steamapps: HashSet<String> = HashSet::new();

    for candidate in &candidates {
        let Some(lib_path) = normalize_steam_library_path(candidate) else {
            debug_log(format_args!("candidate not valid: {}", candidate.display()));
            continue;
        };

        if !is_valid_steamapps_path(&lib_path.steamapps_path) {
            debug_log(format_args!("steamapps path not valid: {}", lib_path.steamapps_path.display()));
            continue;
        }

        let key = lib_path.steamapps_path.to_string_lossy().to_lowercase();
        if seen_steamapps.insert(key) {
            debug_log(format_args!(
                "normalized: root={}, steamapps={}, common={}",
                lib_path.library_root.display(),
                lib_path.steamapps_path.display(),
                lib_path.common_path.display()
            ));
            normalized_libs.push(lib_path);
        }
    }

    debug_log(format_args!("unique normalized steamapps paths: {}", normalized_libs.len()));

    // ---- Step 3: expand via libraryfolders.vdf ----
    let mut all_steamapps_dirs: Vec<(PathBuf, PathBuf)> = Vec::new(); // (steamapps_path, common_path)
    let mut seen_all: HashSet<String> = HashSet::new();

    for lib in &normalized_libs {
        let key = lib.steamapps_path.to_string_lossy().to_lowercase();
        if seen_all.insert(key) {
            all_steamapps_dirs.push((lib.steamapps_path.clone(), lib.common_path.clone()));
        }

        let vdf_path = lib.steamapps_path.join("libraryfolders.vdf");
        if !vdf_path.is_file() {
            continue;
        }

        let extra_roots = collect_library_roots_from_vdf(&vdf_path);
        for root_path in extra_roots {
            // The VDF path is a library root like D:\SteamLibrary
            // Normalize it to find steamapps/common
            if let Some(extra_lib) = normalize_steam_library_path(&root_path) {
                let extra_key = extra_lib.steamapps_path.to_string_lossy().to_lowercase();
                if seen_all.insert(extra_key) {
                    debug_log(format_args!("extra library from VDF: root={}, steamapps={}, common={}",
                        extra_lib.library_root.display(),
                        extra_lib.steamapps_path.display(),
                        extra_lib.common_path.display()
                    ));
                    all_steamapps_dirs.push((extra_lib.steamapps_path, extra_lib.common_path));
                }
            } else {
                debug_log(format_args!("VDF library root not valid: {}", root_path.display()));
            }
        }
    }

    debug_log(format_args!("total steamapps dirs to scan: {}", all_steamapps_dirs.len()));

    // ---- Step 4: scan appmanifest files in each steamapps dir ----
    let mut games = Vec::new();
    let mut manifest_count = 0;
    let debug_app_id: u32 = 2358720;

    for (steamapps_dir, common_path) in &all_steamapps_dirs {
        let entries = match fs::read_dir(steamapps_dir) {
            Ok(e) => e,
            Err(_) => {
                debug_log(format_args!("cannot read steamapps dir: {}", steamapps_dir.display()));
                continue;
            }
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
            manifest_count += 1;
            if let Some(game) = parse_appmanifest(&path, common_path, steamapps_dir) {
                if game.app_id == debug_app_id {
                    debug_log(format_args!(
                        "  app {} ({}): manifest={:?}, install_path={:?}, is_installed={}",
                        game.app_id, game.name, game.manifest_path, game.install_path, game.is_installed
                    ));
                }
                games.push(game);
            }
        }
    }

    debug_log(format_args!("manifests found: {}, games parsed: {}", manifest_count, games.len()));
    let installed_count = games.iter().filter(|g| g.is_installed).count();
    debug_log(format_args!("installed games: {}", installed_count));
    debug_log("===== Steam scan end =====");
    Ok(games)
}

/// Parse libraryfolders.vdf and return library root paths (not yet joined with steamapps).
pub fn collect_library_roots_from_vdf(vdf_path: &Path) -> Vec<PathBuf> {
    let content = match fs::read_to_string(vdf_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut roots = Vec::new();
    let lines: Vec<&str> = content.lines().map(|l| l.trim()).collect();
    let mut i = 0;
    let mut depth: u32 = 0;
    let mut in_libraryfolders = false;

    while i < lines.len() {
        let line = lines[i];

        if line == "{" {
            depth += 1;
            i += 1;
            continue;
        }
        if line == "}" {
            if depth > 0 {
                depth -= 1;
                if depth == 0 {
                    in_libraryfolders = false;
                }
            }
            i += 1;
            continue;
        }

        if let Some((key, value)) = parse_vdf_line(line) {
            if !in_libraryfolders && key.to_lowercase() == "libraryfolders" {
                in_libraryfolders = true;
                i += 1;
                continue;
            }

            if in_libraryfolders {
                if key == "path" && depth >= 2 {
                    let decoded = value.replace("\\\\", "\\");
                    roots.push(PathBuf::from(&decoded));
                } else if depth == 1 && !value.is_empty() {
                    let decoded = value.replace("\\\\", "\\");
                    roots.push(PathBuf::from(&decoded));
                }
            }
        }

        i += 1;
    }

    roots.sort();
    roots.dedup();
    roots
}

fn parse_vdf_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('"') {
        return None;
    }
    let parts: Vec<&str> = trimmed.split('"').collect();
    if parts.len() < 5 {
        return None;
    }
    let key = parts[1].trim().to_string();
    let value = parts[3].trim().to_string();
    Some((key, value))
}

pub fn parse_appmanifest(
    path: &Path,
    common_path: &Path,
    steamapps_dir: &Path,
) -> Option<SteamInstalledGame> {
    let content = fs::read_to_string(path).ok()?;
    let mut app_id: Option<u32> = None;
    let mut name: Option<String> = None;
    let mut install_dir: Option<String> = None;
    let mut state_flags: Option<u64> = None;
    let mut size_on_disk: Option<u64> = None;
    let mut build_id: Option<String> = None;
    let mut last_updated: Option<u64> = None;
    let mut bytes_downloaded: Option<u64> = None;
    let mut bytes_to_download: Option<u64> = None;

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
            "bytesdownloaded" => bytes_downloaded = value.parse::<u64>().ok(),
            "bytestodownload" => bytes_to_download = value.parse::<u64>().ok(),
            _ => {}
        }
    }

    let app_id = app_id?;
    let install_dir_val = install_dir;
    let manifest_path = path.to_string_lossy().to_string();
    let steamapps_path_str = steamapps_dir.to_string_lossy().to_string();
    let library_root = steamapps_dir.parent().map(|p| p.to_string_lossy().to_string());

    let install_path = install_dir_val.as_ref().map(|dir| {
        common_path.join(dir).to_string_lossy().to_string()
    });

    let install_dir_exists = install_path
        .as_ref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false);

    let is_installed = match state_flags {
        Some(flags) => flags & 4 != 0,
        None => install_dir_exists,
    };

    Some(SteamInstalledGame {
        app_id,
        name: name.unwrap_or_else(|| format!("Steam App {}", app_id)),
        install_dir: install_dir_val,
        library_path: steamapps_path_str.clone(),
        steam_root: library_root,
        steamapps_path: steamapps_path_str,
        manifest_path,
        install_path,
        state_flags,
        size_on_disk,
        build_id,
        last_updated,
        bytes_downloaded,
        bytes_to_download,
        is_installed,
    })
}

#[tauri::command]
pub fn scan_steam_login_users(steam_root: String) -> Result<Vec<crate::models::steam_login_user::SteamLoginUser>, String> {
    use crate::models::steam_login_user::SteamLoginUser;

    let loginusers_path = std::path::Path::new(&steam_root).join("config").join("loginusers.vdf");
    if !loginusers_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&loginusers_path)
        .map_err(|e| format!("Failed to read loginusers.vdf: {}", e))?;

    let mut users = Vec::new();
    let mut current_id: Option<String> = None;
    let mut current_account_name: Option<String> = None;
    let mut current_persona_name: Option<String> = None;
    let mut current_remember_password = false;
    let mut current_timestamp: u64 = 0;
    let mut in_user = false;
    let mut brace_depth = 0u32;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed == "{" {
            brace_depth += 1;
            if brace_depth == 2 && current_id.is_some() {
                in_user = true;
            }
            continue;
        }
        if trimmed == "}" {
            if in_user && brace_depth == 2 {
                if let (Some(id), Some(account)) = (current_id.take(), current_account_name.take()) {
                    users.push(SteamLoginUser {
                        steam_id: id,
                        account_name: account,
                        persona_name: current_persona_name.take().unwrap_or_default(),
                        remember_password: current_remember_password,
                        timestamp: current_timestamp,
                    });
                }
                current_persona_name = None;
                current_remember_password = false;
                current_timestamp = 0;
                in_user = false;
            }
            if brace_depth > 0 {
                brace_depth -= 1;
            }
            continue;
        }

        // Parse key-value pairs
        let parts: Vec<&str> = trimmed.split('"').collect();
        if parts.len() < 5 {
            // Could be a steam_id key at depth 1
            if brace_depth == 1 && trimmed.starts_with('"') {
                if let Some(id_val) = parts.get(1) {
                    let val = id_val.trim();
                    if !val.is_empty() && val.chars().all(|c| c.is_ascii_digit()) {
                        current_id = Some(val.to_string());
                    }
                }
            }
            continue;
        }

        let key = parts[1].trim();
        let value = parts[3].trim();

        if in_user {
            match key {
                "AccountName" => current_account_name = Some(value.to_string()),
                "PersonaName" => current_persona_name = Some(value.to_string()),
                "RememberPassword" => current_remember_password = value == "1",
                "Timestamp" => current_timestamp = value.parse::<u64>().unwrap_or(0),
                _ => {}
            }
        }
    }

    // Flush any remaining
    if in_user {
        if let (Some(id), Some(account)) = (current_id.take(), current_account_name.take()) {
            users.push(SteamLoginUser {
                steam_id: id,
                account_name: account,
                persona_name: current_persona_name.take().unwrap_or_default(),
                remember_password: current_remember_password,
                timestamp: current_timestamp,
            });
        }
    }

    users.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(users)
}

#[tauri::command]
pub fn launch_steam_app(app_id: u32, steam_path: Option<String>) -> Result<(), String> {
    // Try to find steam.exe for silent launch
    let steam_exe = resolve_steam_exe_from_path(steam_path.as_deref())
        .or_else(|| resolve_steam_exe_detected());

    if let Some(exe) = steam_exe {
        // Premium: steam.exe -silent -applaunch keeps Steam in tray
        eprintln!("[LAUNCH] steam.exe -silent -applaunch {app_id} ({exe})");
        std::process::Command::new(&exe)
            .args(["-silent", "-applaunch", &app_id.to_string()])
            .spawn()
            .map_err(|e| format!("Could not launch Steam game via {exe}: {e}"))?;
        return Ok(());
    }

    // Fallback: protocol URL (opens Steam window)
    eprintln!("[LAUNCH] fallback steam://run/{app_id} (steam.exe not found)");
    let url = format!("steam://run/{}", app_id);
    open::that_detached(&url).map_err(|e| format!("Could not launch Steam game: {}", e))
}

fn resolve_steam_exe_from_path(steam_path: Option<&str>) -> Option<String> {
    let root = PathBuf::from(steam_path?);
    let exe = root.join("steam.exe");
    if exe.exists() {
        Some(exe.to_string_lossy().to_string())
    } else {
        None
    }
}

fn resolve_steam_exe_detected() -> Option<String> {
    let paths = path_utils::detect_steam_paths()?;
    let exe = PathBuf::from(&paths.steam_exe);
    if exe.exists() {
        Some(paths.steam_exe)
    } else {
        None
    }
}

#[tauri::command]
pub fn install_steam_app(app_id: u32) -> Result<(), String> {
    let url = format!("steam://install/{}", app_id);
    open::that_detached(&url).map_err(|e| format!("Could not open Steam install page: {}", e))
}

#[tauri::command]
pub fn uninstall_steam_app(app_id: u32) -> Result<(), String> {
    let url = format!("steam://uninstall/{}", app_id);
    open::that_detached(&url).map_err(|e| format!("Could not open Steam uninstall page: {}", e))
}

#[tauri::command]
pub fn open_steam_store_app(app_id: u32) -> Result<(), String> {
    let url = format!("steam://store/{}", app_id);
    open::that_detached(&url).map_err(|e| format!("Could not open Steam store page: {}", e))
}

#[tauri::command]
pub fn open_steam_library(app_id: u32) -> Result<(), String> {
    let url = format!("steam://nav/games/details/{}", app_id);
    open::that_detached(&url).map_err(|e| format!("Could not open Steam library: {}", e))
}

#[tauri::command]
pub fn check_steam_game_installed(
    app_id: u32,
    steam_root: Option<String>,
) -> Result<SteamGameInstallStatus, String> {
    // ---- Step 1: collect candidate paths ----
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(ref sp) = steam_root {
        candidates.push(PathBuf::from(sp));
    }

    // Add auto-detected Steam root if not already present
    if let Some(sp) = path_utils::detect_steam_paths() {
        let p = PathBuf::from(&sp.steam_root);
        let p_lower = p.to_string_lossy().to_lowercase();
        let already = candidates.iter().any(|c| c.to_string_lossy().to_lowercase() == p_lower);
        if !already {
            candidates.push(p);
        }
    }

    // Add safe fallback paths
    let safe_fallback = collect_safe_fallback_steam_paths();
    for fp in &safe_fallback {
        let fp_lower = fp.to_string_lossy().to_lowercase();
        let already = candidates.iter().any(|c| c.to_string_lossy().to_lowercase() == fp_lower);
        if !already {
            candidates.push(fp.clone());
        }
    }

    // ---- Step 2: normalize into SteamLibraryPath ----
    let mut normalized_libs: Vec<SteamLibraryPath> = Vec::new();
    let mut seen_steamapps: HashSet<String> = HashSet::new();

    for candidate in &candidates {
        if let Some(lib_path) = normalize_steam_library_path(candidate) {
            if is_valid_steamapps_path(&lib_path.steamapps_path) {
                let key = lib_path.steamapps_path.to_string_lossy().to_lowercase();
                if seen_steamapps.insert(key) {
                    normalized_libs.push(lib_path);
                }
            }
        }
    }

    // ---- Step 3: expand via libraryfolders.vdf ----
    let mut all_steamapps_dirs: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut seen_all: HashSet<String> = HashSet::new();

    for lib in &normalized_libs {
        let key = lib.steamapps_path.to_string_lossy().to_lowercase();
        if seen_all.insert(key) {
            all_steamapps_dirs.push((lib.steamapps_path.clone(), lib.common_path.clone()));
        }

        let vdf_path = lib.steamapps_path.join("libraryfolders.vdf");
        if vdf_path.is_file() {
            let extra_roots = collect_library_roots_from_vdf(&vdf_path);
            for root_path in extra_roots {
                if let Some(extra_lib) = normalize_steam_library_path(&root_path) {
                    let extra_key = extra_lib.steamapps_path.to_string_lossy().to_lowercase();
                    if seen_all.insert(extra_key) {
                        all_steamapps_dirs.push((extra_lib.steamapps_path, extra_lib.common_path));
                    }
                }
            }
        }
    }

    // ---- Step 4: look for appmanifest_<app_id>.acf ----
    let manifest_name = format!("appmanifest_{}.acf", app_id);

    for (steamapps_dir, common_path) in &all_steamapps_dirs {
        let manifest_path = steamapps_dir.join(&manifest_name);
        if !manifest_path.is_file() {
            continue;
        }

        if let Some(parsed) = parse_appmanifest(&manifest_path, common_path, steamapps_dir) {
            let download_progress = match (parsed.bytes_downloaded, parsed.bytes_to_download) {
                (Some(downloaded), Some(total)) if total > 0 => Some(DownloadProgress {
                    bytes_downloaded: downloaded,
                    bytes_to_download: total,
                    percent: (downloaded as f64 / total as f64) * 100.0,
                }),
                _ => None,
            };

            // Stricter completion check: FullyInstalled flag + no active download + bytes match
            let flags = parsed.state_flags.unwrap_or(0);
            let no_active_download = flags & 32 == 0    // Not Updating
                && flags & 512 == 0    // Not Preallocating
                && flags & 1024 == 0   // Not DownloadPaused
                && flags & 8192 == 0   // Not VerifyIntegrity
                && flags & 16384 == 0; // Not UpdatingPaused
            let bytes_complete = match (parsed.bytes_downloaded, parsed.bytes_to_download) {
                (Some(d), Some(t)) if t > 0 => d >= t,
                _ => true,
            };
            let is_completed = parsed.is_installed
                && (flags & 4 != 0)
                && no_active_download
                && bytes_complete;

            eprintln!("[INSTALL_TRACK] appid={} phase=status-check isInstalled={} isCompleted={} stateFlags={} bytesDownloaded={:?} bytesToDownload={:?} sizeOnDisk={:?}",
                app_id, parsed.is_installed, is_completed, flags, parsed.bytes_downloaded, parsed.bytes_to_download, parsed.size_on_disk);

            return Ok(SteamGameInstallStatus {
                is_installed: parsed.is_installed,
                is_completed,
                state_flags: parsed.state_flags,
                install_path: parsed.install_path,
                install_dir: parsed.install_dir,
                library_path: Some(parsed.library_path),
                name: Some(parsed.name),
                size_on_disk: parsed.size_on_disk,
                last_updated: parsed.last_updated,
                download_progress,
            });
        }
    }

    // Manifest not found in any library folder — game is not installed
    Ok(SteamGameInstallStatus {
        is_installed: false,
        is_completed: false,
        state_flags: None,
        install_path: None,
        install_dir: None,
        library_path: None,
        name: None,
        size_on_disk: None,
        last_updated: None,
        download_progress: None,
    })
}
