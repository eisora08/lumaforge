use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

use crate::models::game_name::GameNameResult;
use crate::models::local_game::LocalDiscoveredGame;
use crate::models::local_executable_game::LocalExecutableGame;

#[tauri::command]
pub fn resolve_steam_app_names(app_ids: Vec<u32>) -> Result<Vec<GameNameResult>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("[HTTP][TIMEOUT] Error creando cliente HTTP: {}", error))?;

    let mut results: HashMap<u32, GameNameResult> = HashMap::new();

    for app_id in app_ids {
        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={}",
            app_id
        );

        let response = client
            .get(&url)
            .send()
            .map_err(|error| format!("Error consultando Steam para {}: {}", app_id, error))?;

        if !response.status().is_success() {
            results.insert(
                app_id,
                GameNameResult {
                    app_id,
                    name: format!("Steam App {}", app_id),
                    resolved: false,
                },
            );

            continue;
        }

        let json: serde_json::Value = response
            .json()
            .map_err(|error| format!("Error leyendo respuesta de Steam: {}", error))?;

        let entry = json.get(app_id.to_string());

        let name = entry
            .and_then(|value| value.get("data"))
            .and_then(|data| data.get("name"))
            .and_then(|name| name.as_str())
            .map(|name| name.trim().to_string());

        match name {
            Some(name) if !name.is_empty() => {
                results.insert(
                    app_id,
                    GameNameResult {
                        app_id,
                        name,
                        resolved: true,
                    },
                );
            }
            _ => {
                results.insert(
                    app_id,
                    GameNameResult {
                        app_id,
                        name: format!("Steam App {}", app_id),
                        resolved: false,
                    },
                );
            }
        }
    }

    let mut output: Vec<GameNameResult> = results.into_values().collect();
    output.sort_by_key(|item| item.app_id);

    Ok(output)
}

const IGNORED_EXE_PATTERNS: &[&str] = &[
    "unins",
    "uninstall",
    "vc_redist",
    "vcredist",
    "dxsetup",
    "directx",
    "dotnet",
    "ueprereqsetup",
    "installuwo",
    "oalinst",
    "xnafx",
    "gfm",
    "pyro",
    "msi",
    "vulkan",
    "physx",
    "steam",
];

const IGNORED_DIR_NAMES: &[&str] = &[
    "_commonredist",
    "__installer",
    "redist",
    "installer",
    "directx",
    "vc_redist",
    "vcredist",
    "_installer",
    "commonredist",
];

fn should_ignore_exe(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    for pattern in IGNORED_EXE_PATTERNS {
        if lower.starts_with(pattern) {
            return true;
        }
    }
    false
}

fn path_should_be_ignored(path: &Path) -> bool {
    for component in path.components() {
        if let Some(component_str) = component.as_os_str().to_str() {
            let lower = component_str.to_lowercase();
            for dir_name in IGNORED_DIR_NAMES {
                if lower == *dir_name {
                    return true;
                }
            }
        }
    }
    false
}

#[tauri::command]
pub fn scan_local_games(
    folders: Vec<String>,
    max_depth: Option<u32>,
) -> Result<Vec<LocalDiscoveredGame>, String> {
    let depth = max_depth.unwrap_or(3);
    let mut results = Vec::new();

    for folder in &folders {
        let folder_path = Path::new(folder);
        if !folder_path.exists() || !folder_path.is_dir() {
            continue;
        }

        let walker = walkdir::WalkDir::new(folder_path)
            .max_depth(depth as usize)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    return !path_should_be_ignored(path);
                }
                true
            });

        for entry in walker {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();

            if ext != "exe" {
                continue;
            }

            let file_name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if should_ignore_exe(&file_name) {
                continue;
            }

            let dir_name = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let metadata = fs::metadata(path).ok();
            let size_bytes = metadata.as_ref().map(|m| m.len());
            let modified_at = metadata
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            results.push(LocalDiscoveredGame {
                exe_path: path.to_string_lossy().to_string(),
                file_name,
                dir_name,
                size_bytes,
                modified_at,
            });
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn scan_local_game_folders(
    folders: Vec<String>,
) -> Result<Vec<LocalExecutableGame>, String> {
    let depth: u32 = 3;
    let mut results = Vec::new();

    for folder in &folders {
        let folder_path = Path::new(folder);
        if !folder_path.exists() || !folder_path.is_dir() {
            continue;
        }

        let walker = walkdir::WalkDir::new(folder_path)
            .max_depth(depth as usize)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    return !path_should_be_ignored(path);
                }
                true
            });

        for entry in walker {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();

            if ext != "exe" {
                continue;
            }

            let file_name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if should_ignore_exe(&file_name) {
                continue;
            }

            let directory_name = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            results.push(LocalExecutableGame {
                executable_path: path.to_string_lossy().to_string(),
                file_name,
                directory_name,
            });
        }
    }

    Ok(results)
}