use std::collections::HashMap;
use std::path::Path;

use crate::utils::lua_parser;
use crate::utils::steamcmd_api;
use crate::utils::steam_keys_cache;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct DlcInfo {
    pub app_id: u64,
    pub name: Option<String>,
    pub has_own_depot: bool,
    pub is_already_in_lua: bool,
    pub depot_key: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LuaActionResult {
    pub success: bool,
    pub message: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Query all DLCs for a game. Returns info about each DLC including whether
/// it's already in the Lua file, if it has its own depot, and if we have a key.
pub fn query_game_dlcs(app_id: u64) -> Result<Vec<DlcInfo>, String> {
    // Get game info from SteamCMD API
    let app_info = steamcmd_api::fetch_app_depot_info(app_id)?;

    if app_info.dlc_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Get the Lua directory
    let lua_dir = get_lua_dir()?;

    // Parse existing Lua to find which DLCs are already imported
    let lua_path = lua_dir.join(format!("{}.lua", app_id));
    let existing_depots = if lua_path.exists() {
        lua_parser::parse_lua_file(&lua_path)
            .unwrap_or_default()
            .into_iter()
            .map(|e| e.depot_id)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    // Load depot keys to check if we have keys for DLC depots
    let depot_keys = steam_keys_cache::load_depot_keys_from_cache().unwrap_or_default();

    // Build depot ID set for quick lookup
    let main_depot_ids: HashMap<u64, bool> = app_info
        .depots
        .iter()
        .map(|d| (d.depot_id, d.dlc_app_id.is_some()))
        .collect();

    let mut dlcs = Vec::new();

    for &dlc_id in &app_info.dlc_ids {
        // Check if this DLC has its own depot
        let has_own_depot = main_depot_ids.contains_key(&dlc_id);

        // Check if already in Lua
        let is_in_lua = existing_depots.contains(&dlc_id);

        // Try to find depot key for this DLC
        let depot_key = depot_keys.get(&dlc_id).cloned();

        // Try to fetch DLC name from SteamCMD (it's in the DLC list but we need sub-query)
        // For now, use None — the frontend can fetch names separately via store API
        let name = None;

        dlcs.push(DlcInfo {
            app_id: dlc_id,
            name,
            has_own_depot,
            is_already_in_lua: is_in_lua,
            depot_key,
        });
    }

    // Sort: non-imported first, then by app_id
    dlcs.sort_by(|a, b| {
        a.is_already_in_lua
            .cmp(&b.is_already_in_lua)
            .then(a.app_id.cmp(&b.app_id))
    });

    Ok(dlcs)
}

/// Add a single DLC to a game's Lua file.
pub fn add_dlc_to_game_lua(app_id: u64, dlc_app_id: u64) -> Result<LuaActionResult, String> {
    let lua_dir = get_lua_dir()?;
    let lua_path = lua_dir.join(format!("{}.lua", app_id));

    if !lua_path.exists() {
        return Err(format!(
            "No Lua file found for app {}. Generate it first.",
            app_id
        ));
    }

    // Check if DLC is already in Lua
    let entries = lua_parser::parse_lua_file(&lua_path).unwrap_or_default();
    if entries.iter().any(|e| e.depot_id == dlc_app_id && e.is_active) {
        return Ok(LuaActionResult {
            success: true,
            message: format!("DLC {} is already in the Lua file", dlc_app_id),
        });
    }

    // Try to find depot key
    let depot_keys = steam_keys_cache::load_depot_keys_from_cache().unwrap_or_default();
    let key = depot_keys.get(&dlc_app_id).map(|k| k.as_str());

    // Add to Lua
    crate::utils::lua_writer::add_dlc_to_lua(&lua_path, dlc_app_id, key, None)?;

    let msg = if key.is_some() {
        format!("DLC {} added with depot key", dlc_app_id)
    } else {
        format!("DLC {} added (no depot key available)", dlc_app_id)
    };

    Ok(LuaActionResult {
        success: true,
        message: msg,
    })
}

/// Add all missing DLCs to a game's Lua file.
pub fn add_all_dlcs_to_game_lua(app_id: u64) -> Result<LuaActionResult, String> {
    let dlcs = query_game_dlcs(app_id)?;
    let mut added = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    for dlc in &dlcs {
        if dlc.is_already_in_lua {
            skipped += 1;
            continue;
        }
        match add_dlc_to_game_lua(app_id, dlc.app_id) {
            Ok(_) => added += 1,
            Err(e) => errors.push(format!("DLC {}: {}", dlc.app_id, e)),
        }
    }

    let msg = if errors.is_empty() {
        format!("Added {} DLCs, {} already present", added, skipped)
    } else {
        format!(
            "Added {} DLCs, {} already present, {} errors: {}",
            added,
            skipped,
            errors.len(),
            errors.join("; ")
        )
    };

    Ok(LuaActionResult {
        success: errors.is_empty(),
        message: msg,
    })
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn get_lua_dir() -> Result<std::path::PathBuf, String> {
    let paths = crate::utils::path_utils::detect_steam_paths()
        .ok_or("Steam installation not found")?;
    let lua_dir = Path::new(&paths.lua_path);
    if !lua_dir.exists() {
        std::fs::create_dir_all(lua_dir)
            .map_err(|e| format!("Failed to create Lua directory: {e}"))?;
    }
    Ok(lua_dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dlc_info_serialization() {
        let info = DlcInfo {
            app_id: 731,
            name: Some("Test DLC".to_string()),
            has_own_depot: true,
            is_already_in_lua: false,
            depot_key: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("731"));
        assert!(json.contains("Test DLC"));
    }

    #[test]
    fn test_lua_action_result() {
        let result = LuaActionResult {
            success: true,
            message: "OK".to_string(),
        };
        assert!(result.success);
    }
}
