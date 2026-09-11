use tauri::AppHandle;
use tauri::command;

use crate::utils::dlc_resolver;
use crate::utils::lua_writer;
use crate::utils::manifest_fetcher;
use crate::utils::steamcmd_api;
use crate::utils::steam_keys_cache;

// ---------------------------------------------------------------------------
// Request/Response types for frontend
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct PinManifestRequest {
    pub app_id: u64,
    pub depot_id: u64,
    pub manifest_id: String,
    pub pinned: bool,
}

#[derive(serde::Deserialize)]
pub struct FetchManifestRequest {
    pub app_id: u64,
    pub depot_id: u64,
    pub manifest_id: String,
}

#[derive(serde::Deserialize)]
pub struct GenerateLuaRequest {
    pub app_id: u64,
}

#[derive(serde::Deserialize)]
pub struct AddDlcRequest {
    pub app_id: u64,
    pub dlc_app_id: u64,
}

#[derive(serde::Deserialize)]
pub struct AddAllDlcsRequest {
    pub app_id: u64,
}

#[derive(serde::Serialize)]
pub struct CommandResult {
    pub success: bool,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct ManifestInfoResponse {
    pub manifest_id: String,
    pub pinned: bool,
    pub in_lua: bool,
}

#[derive(serde::Serialize)]
pub struct DlcQueryResponse {
    pub app_id: u64,
    pub name: Option<String>,
    pub has_own_depot: bool,
    pub is_already_in_lua: bool,
    pub has_key: bool,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Ensure depot keys and app access tokens are downloaded/cached.
#[command]
pub async fn steam_keys_ensure_cache(app_handle: AppHandle) -> Result<CommandResult, String> {
    let ah = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        steam_keys_cache::ensure_key_files(&ah)?;

        let depot_keys = steam_keys_cache::load_depot_keys(&ah)?;
        let app_tokens = steam_keys_cache::load_app_tokens(&ah)?;

        Ok(CommandResult {
            success: true,
            message: format!(
                "Cache updated: {} depot keys, {} app tokens",
                depot_keys.len(),
                app_tokens.len()
            ),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Force-refresh the key files from the API.
#[command]
pub async fn steam_keys_update_cache(app_handle: AppHandle) -> Result<CommandResult, String> {
    let ah = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        steam_keys_cache::update_key_files(&ah)?;

        let depot_keys = steam_keys_cache::load_depot_keys(&ah)?;
        let app_tokens = steam_keys_cache::load_app_tokens(&ah)?;

        Ok(CommandResult {
            success: true,
            message: format!(
                "Keys refreshed: {} depot keys, {} app tokens",
                depot_keys.len(),
                app_tokens.len()
            ),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Generate a .lua file for a game.
#[command]
pub async fn steam_keys_generate_lua(
    app_handle: AppHandle,
    request: GenerateLuaRequest,
) -> Result<CommandResult, String> {
    let ah = app_handle.clone();
    let app_id = request.app_id;
    tokio::task::spawn_blocking(move || {
        // Get game name from SteamCMD
        let app_info = steamcmd_api::fetch_app_depot_info(app_id)?;
        let game_name = app_info
            .app_name
            .clone()
            .unwrap_or_else(|| format!("Game {}", app_id));

        // Load keys and tokens
        let depot_keys = steam_keys_cache::load_depot_keys(&ah)?;
        let app_tokens = steam_keys_cache::load_app_tokens(&ah)?;

        // Get the Lua directory from steam paths
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;
        let lua_dir = std::path::Path::new(&paths.lua_path);

        // Build depot list: base game depots + DLC depots that have a key
        let depots: Vec<(u64, Option<String>)> = app_info
            .depots
            .iter()
            .filter(|d| {
                // Always include base game depots
                if d.dlc_app_id.is_none() || d.dlc_app_id == Some(app_id) {
                    return true;
                }
                // DLC depots: only include if we have a key
                depot_keys.contains_key(&d.depot_id)
            })
            .map(|d| {
                let key = depot_keys.get(&d.depot_id).cloned();
                (d.depot_id, key)
            })
            .collect();

        // Filter tokens: only for this app and its DLCs
        let mut relevant_ids = std::collections::HashSet::new();
        relevant_ids.insert(app_id);
        for &dlc_id in &app_info.dlc_ids {
            relevant_ids.insert(dlc_id);
        }
        let tokens: Vec<(u64, String)> = app_tokens
            .into_iter()
            .filter(|(id, _)| relevant_ids.contains(id))
            .collect();

        lua_writer::generate_lua_file(lua_dir, app_id, &game_name, &depots, &tokens, &[])?;

        Ok(CommandResult {
            success: true,
            message: format!("Lua file generated for app {}", app_id),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Pin or unpin a manifest in the Lua file.
#[command]
pub async fn steam_keys_pin_manifest(
    _app_handle: AppHandle,
    request: PinManifestRequest,
) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;
        let lua_path = std::path::Path::new(&paths.lua_path)
            .join(format!("{}.lua", request.app_id));

        if !lua_path.exists() {
            return Err(format!("No Lua file found for app {}", request.app_id));
        }

        lua_writer::set_manifest_pin(&lua_path, request.depot_id, &request.manifest_id, request.pinned)?;

        let action = if request.pinned { "Pinned" } else { "Unpinned" };
        Ok(CommandResult {
            success: true,
            message: format!("{} manifest {} for depot {}", action, request.manifest_id, request.depot_id),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Fetch manifests for a game from GitHub.
#[command]
pub async fn steam_keys_fetch_manifests(
    app_handle: AppHandle,
    app_id: u64,
) -> Result<CommandResult, String> {
    let ah = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        // Get depot IDs from SteamCMD
        let app_info = steamcmd_api::fetch_app_depot_info(app_id)?;
        let depot_ids: Vec<u64> = app_info.depots.iter().map(|d| d.depot_id).collect();

        if depot_ids.is_empty() {
            return Ok(CommandResult {
                success: false,
                message: format!("No depots found for app {}", app_id),
            });
        }

        // Build pics_gids map (empty for now, will use fallback strategies)
        let pics_gids = std::collections::HashMap::new();

        let manifests = manifest_fetcher::fetch_manifests_for_game(&ah, app_id, &depot_ids, &pics_gids)?;

        let count = manifests.len();
        let saved = manifests.iter().filter(|m| m.placed_path.is_some()).count();

        Ok(CommandResult {
            success: count > 0,
            message: format!("Fetched {} manifests, {} saved to depotcache for app {}", count, saved, app_id),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Update all manifest pins based on files in depotcache.
#[command]
pub async fn steam_keys_update_all_pins(
    _app_handle: AppHandle,
    app_id: u64,
) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;
        let lua_path = std::path::Path::new(&paths.lua_path)
            .join(format!("{}.lua", app_id));

        if !lua_path.exists() {
            return Err(format!("No Lua file found for app {}", app_id));
        }

        // Parse existing pins from Lua
        let existing_pins = lua_writer::parse_manifest_pins(&lua_path)?;

        // Convert to vec for update_all_manifest_pins
        let pins: Vec<(u64, String)> = existing_pins.into_iter().collect();

        lua_writer::update_all_manifest_pins(&lua_path, &pins)?;

        Ok(CommandResult {
            success: true,
            message: format!("Manifest pins updated for app {}", app_id),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Query DLCs for a game.
#[command]
pub async fn steam_keys_query_dlcs(app_id: u64) -> Result<Vec<DlcQueryResponse>, String> {
    tokio::task::spawn_blocking(move || {
        let dlcs = dlc_resolver::query_game_dlcs(app_id)?;

        Ok(dlcs
            .into_iter()
            .map(|d| DlcQueryResponse {
                app_id: d.app_id,
                name: d.name,
                has_own_depot: d.has_own_depot,
                is_already_in_lua: d.is_already_in_lua,
                has_key: d.depot_key.is_some(),
            })
            .collect())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Add a single DLC to a game's Lua file.
#[command]
pub async fn steam_keys_add_dlc(request: AddDlcRequest) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let result = dlc_resolver::add_dlc_to_game_lua(request.app_id, request.dlc_app_id)?;

        Ok(CommandResult {
            success: result.success,
            message: result.message,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Add all missing DLCs to a game's Lua file.
#[command]
pub async fn steam_keys_add_all_dlcs(request: AddAllDlcsRequest) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let result = dlc_resolver::add_all_dlcs_to_game_lua(request.app_id)?;

        Ok(CommandResult {
            success: result.success,
            message: result.message,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Check if a Lua file exists for a game.
#[command]
pub async fn steam_keys_lua_exists(app_id: u64) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;
        let lua_path = std::path::Path::new(&paths.lua_path)
            .join(format!("{}.lua", app_id));
        Ok(lua_path.exists())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Check if a game has any active manifest pins.
#[command]
pub async fn steam_keys_has_pins(app_id: u64) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;
        let lua_path = std::path::Path::new(&paths.lua_path)
            .join(format!("{}.lua", app_id));

        if !lua_path.exists() {
            return Ok(false);
        }

        Ok(lua_writer::has_active_pins(&lua_path))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Unpin all manifests for a game (comment out all setManifestid lines).
/// If app_id is 0, unpins all games in the Lua directory.
#[command]
pub async fn steam_keys_unpin_all(app_id: u64) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;
        let lua_dir = std::path::Path::new(&paths.lua_path);

        if app_id == 0 {
            // Unpin all games
            let mut total_count = 0u32;
            let mut total_games = 0u32;

            let entries = std::fs::read_dir(lua_dir)
                .map_err(|e| format!("Failed to read Lua directory: {e}"))?;

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("lua") {
                    match lua_writer::unpin_all_manifests(&path) {
                        Ok(count) if count > 0 => {
                            total_count += count;
                            total_games += 1;
                        }
                        _ => {}
                    }
                }
            }

            Ok(CommandResult {
                success: true,
                message: format!("Unpinned {} manifest(s) across {} game(s)", total_count, total_games),
            })
        } else {
            // Unpin single game
            let lua_path = lua_dir.join(format!("{}.lua", app_id));

            if !lua_path.exists() {
                return Err(format!("No Lua file found for app {}", app_id));
            }

            let count = lua_writer::unpin_all_manifests(&lua_path)?;

            Ok(CommandResult {
                success: true,
                message: format!("Unpinned {} manifest(s) for app {}", count, app_id),
            })
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Pin manifests to current installed version (reads from local ACF).
#[command]
pub async fn steam_keys_pin_to_current(app_id: u64) -> Result<CommandResult, String> {
    tokio::task::spawn_blocking(move || {
        let paths = crate::utils::path_utils::detect_steam_paths()
            .ok_or("Steam installation not found")?;

        // Find the ACF file for this app
        let steam_root = std::path::Path::new(&paths.steam_root);
        let acf_path = find_acf_file(steam_root, app_id)
            .ok_or_else(|| format!("No ACF file found for app {}. Is the game installed?", app_id))?;

        // Parse MountedDepots from ACF
        let mounted = parse_mounted_depots(&acf_path)?;
        if mounted.is_empty() {
            return Err(format!("No mounted depots found in ACF for app {}", app_id));
        }

        let lua_path = std::path::Path::new(&paths.lua_path)
            .join(format!("{}.lua", app_id));

        if !lua_path.exists() {
            return Err(format!("No Lua file found for app {}. Generate Lua first.", app_id));
        }

        // Pin each depot
        let mut count = 0u32;
        for (depot_id, manifest_id) in &mounted {
            lua_writer::set_manifest_pin(&lua_path, *depot_id, manifest_id, true)?;
            count += 1;
        }

        Ok(CommandResult {
            success: true,
            message: format!("Pinned {} depot(s) to current version for app {}", count, app_id),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Find the ACF file for a given app_id in Steam library folders.
fn find_acf_file(steam_root: &std::path::Path, app_id: u64) -> Option<std::path::PathBuf> {
    let manifest_name = format!("appmanifest_{}.acf", app_id);

    // Check primary steamapps folder
    let primary = steam_root.join("steamapps").join(&manifest_name);
    if primary.exists() {
        return Some(primary);
    }

    // Check library folders from libraryfolders.vdf
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = std::fs::read_to_string(&vdf_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('"') && trimmed.contains("path") {
                // Parse "path"    "C:\\SteamLibrary"
                let parts: Vec<&str> = trimmed.split('"').collect();
                if parts.len() >= 4 {
                    let path_str = parts[3];
                    let lib_path = std::path::Path::new(path_str);
                    let acf = lib_path.join("steamapps").join(&manifest_name);
                    if acf.exists() {
                        return Some(acf);
                    }
                }
            }
        }
    }

    None
}

/// Parse MountedDepots section from an ACF file.
/// Returns a map of depot_id -> manifest_id.
fn parse_mounted_depots(acf_path: &std::path::Path) -> Result<std::collections::HashMap<u64, String>, String> {
    let content = std::fs::read_to_string(acf_path)
        .map_err(|e| format!("Failed to read ACF: {e}"))?;

    let mut mounted = std::collections::HashMap::new();
    let mut in_mounted = false;
    let mut brace_depth = 0u32;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.contains("\"MountedDepots\"") {
            in_mounted = true;
            brace_depth = 0;
            continue;
        }

        if in_mounted {
            if trimmed == "{" {
                brace_depth += 1;
                continue;
            }
            if trimmed == "}" {
                brace_depth -= 1;
                if brace_depth == 0 {
                    break;
                }
                continue;
            }

            // Parse "depot_id"    "manifest_id"
            if trimmed.starts_with('"') {
                let parts: Vec<&str> = trimmed.split('"').collect();
                if parts.len() >= 5 {
                    if let Ok(depot_id) = parts[1].parse::<u64>() {
                        mounted.insert(depot_id, parts[3].to_string());
                    }
                }
            }
        }
    }

    Ok(mounted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_result_json() {
        let result = CommandResult {
            success: true,
            message: "ok".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("true"));
        assert!(json.contains("ok"));
    }

    #[test]
    fn test_dlc_query_response() {
        let resp = DlcQueryResponse {
            app_id: 731,
            name: Some("Test DLC".to_string()),
            has_own_depot: true,
            is_already_in_lua: false,
            has_key: true,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("731"));
        assert!(json.contains("Test DLC"));
    }
}
