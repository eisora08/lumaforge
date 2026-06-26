use crate::models::steam_paths::SteamPaths;
use crate::utils::path_utils;

#[tauri::command]
pub fn detect_steam_paths() -> Option<SteamPaths> {
    path_utils::detect_steam_paths()
}