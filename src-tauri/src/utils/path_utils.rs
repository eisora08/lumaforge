use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::steam_paths::SteamPaths;

pub fn detect_steam_paths() -> Option<SteamPaths> {
    let search_roots = get_search_roots();

    for root in search_roots {
        if !root.exists() {
            continue;
        }

        if let Some(paths) = find_steam_in_directory(&root) {
            return Some(paths);
        }
    }

    None
}

fn get_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
            roots.push(PathBuf::from(program_files_x86));
        }
        if let Ok(program_files) = env::var("ProgramFiles") {
            roots.push(PathBuf::from(program_files));
        }
        if let Ok(system_drive) = env::var("SystemDrive") {
            roots.push(PathBuf::from(format!("{}\\", system_drive)));
        }
        roots.push(PathBuf::from("C:\\Program Files (x86)"));
        roots.push(PathBuf::from("C:\\Program Files"));
        roots.push(PathBuf::from("C:\\"));
        roots.push(PathBuf::from("D:\\"));
        roots.push(PathBuf::from("E:\\"));
        roots.push(PathBuf::from("F:\\"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(home) = env::var("HOME") {
            let home = PathBuf::from(&home);
            roots.push(home.join(".steam/steam"));
            roots.push(home.join(".steam/debian-installation"));
            roots.push(home.join(".local/share/Steam"));
        }
        roots.push(PathBuf::from("/usr/lib/steam"));
        roots.push(PathBuf::from("/usr/local/lib/steam"));
        roots.push(PathBuf::from("/opt/steam"));
    }

    roots
}

fn find_steam_in_directory(root: &Path) -> Option<SteamPaths> {
    // Primero revisa si el root directo ya es Steam
    if let Some(paths) = build_paths_if_steam_root(root) {
        return Some(paths);
    }

    let entries = fs::read_dir(root).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let folder_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        // Detecta carpetas como Steam, Steam Luma, SteamSomething, etc.
        if folder_name.contains("steam") {
            if let Some(paths) = build_paths_if_steam_root(&path) {
                return Some(paths);
            }

            // Busca un nivel más profundo por si Steam está dentro de otra carpeta
            if let Some(paths) = find_steam_one_level_deep(&path) {
                return Some(paths);
            }
        }
    }

    None
}

fn find_steam_one_level_deep(root: &Path) -> Option<SteamPaths> {
    let entries = fs::read_dir(root).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        if let Some(paths) = build_paths_if_steam_root(&path) {
            return Some(paths);
        }
    }

    None
}

fn build_paths_if_steam_root(root: &Path) -> Option<SteamPaths> {
    // On Windows look for steam.exe, on Linux look for steam.sh or the steam binary
    let steam_exe = if cfg!(target_os = "windows") {
        root.join("steam.exe")
    } else {
        let steam_sh = root.join("steam.sh");
        let steam_bin = root.join("ubuntu12_32/steam");
        if steam_sh.exists() {
            steam_sh
        } else if steam_bin.exists() {
            steam_bin
        } else {
            // Check if the root itself is a valid Steam directory by looking for config/loginusers.vdf
            let config = root.join("config").join("loginusers.vdf");
            if config.exists() {
                root.join("steam")
            } else {
                return None;
            }
        }
    };

    if !steam_exe.exists() && !root.join("config").join("loginusers.vdf").exists() {
        return None;
    }

    let lua_path = root.join("config").join("lua");
    let depotcache_path = root.join("depotcache");

    Some(SteamPaths {
        steam_root: root.to_string_lossy().to_string(),
        steam_exe: steam_exe.to_string_lossy().to_string(),
        lua_path: lua_path.to_string_lossy().to_string(),
        depotcache_path: depotcache_path.to_string_lossy().to_string(),
        lua_exists: lua_path.exists(),
        depotcache_exists: depotcache_path.exists(),
    })
}