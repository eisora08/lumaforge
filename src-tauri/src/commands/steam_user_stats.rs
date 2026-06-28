use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::steam_user_game_stats::SteamUserGameStats;

fn debug_log(msg: impl std::fmt::Display) {
    eprintln!("[steam-user-stats] {}", msg);
}

fn find_userdata_dirs(steam_root: &Path) -> Vec<PathBuf> {
    let userdata = steam_root.join("userdata");
    if !userdata.is_dir() {
        return Vec::new();
    }
    let mut dirs = Vec::new();
    if let Ok(entries) = fs::read_dir(&userdata) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.chars().all(|c| c.is_ascii_digit()) {
                        dirs.push(path);
                    }
                }
            }
        }
    }
    dirs
}

/// Parse VDF content into a flat map of dot-separated paths to string values.
/// Handles `"key" "value"` pairs and `"key" { ... }` nested scopes.
fn parse_vdf_to_map(content: &str) -> HashMap<String, String> {
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut path: Vec<String> = Vec::new();
    let mut result: HashMap<String, String> = HashMap::new();

    while i < len {
        let c = bytes[i];

        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        match c {
            b'}' => {
                path.pop();
                i += 1;
            }
            b'{' => {
                i += 1;
            }
            b'"' => {
                i += 1;
                let start = i;
                while i < len && bytes[i] != b'"' {
                    i += 1;
                }
                if i >= len {
                    break;
                }
                let key = String::from_utf8_lossy(&bytes[start..i]).to_string();
                i += 1;

                while i < len && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }

                if i < len && bytes[i] == b'"' {
                    i += 1;
                    let val_start = i;
                    while i < len && bytes[i] != b'"' {
                        i += 1;
                    }
                    let value = String::from_utf8_lossy(&bytes[val_start..i]).to_string();
                    i += 1;

                    let full_path = if path.is_empty() {
                        key.clone()
                    } else {
                        path.join(".") + "." + &key
                    };
                    result.insert(full_path, value);

                    while i < len && bytes[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if i < len && bytes[i] == b'{' {
                        path.push(key);
                        i += 1;
                    }
                } else if i < len && bytes[i] == b'{' {
                    path.push(key);
                    i += 1;
                } else {
                    let saved = i;
                    while i < len && bytes[i].is_ascii_whitespace() {
                        i += 1;
                    }
                    if i < len && bytes[i] == b'{' {
                        path.push(key);
                        i += 1;
                    } else {
                        i = saved;
                    }
                }
            }
            _ => {
                i += 1;
            }
        }
    }

    result
}

fn collect_stats_from_user(
    userdata_dir: &Path,
    app_filter: Option<&[u32]>,
) -> Vec<SteamUserGameStats> {
    let localconfig_path = userdata_dir.join("config").join("localconfig.vdf");
    if !localconfig_path.is_file() {
        return Vec::new();
    }

    let steam_id = userdata_dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());

    let content = match fs::read_to_string(&localconfig_path) {
        Ok(c) => c,
        Err(e) => {
            debug_log(format!("Failed to read {:?}: {}", localconfig_path, e));
            return Vec::new();
        }
    };

    let parsed = parse_vdf_to_map(&content);
    let prefix = "UserLocalConfigStore.Software.Valve.Steam.apps.";
    let filter_set: Option<Vec<u32>> = app_filter.map(|ids| ids.to_vec());

    let mut user_stats: HashMap<u32, SteamUserGameStats> = HashMap::new();

    for (vdf_path, value) in &parsed {
        if !vdf_path.starts_with(prefix) {
            continue;
        }

        let suffix = &vdf_path[prefix.len()..];
        let dot_pos = match suffix.find('.') {
            Some(p) => p,
            None => continue,
        };

        let app_id_str = &suffix[..dot_pos];
        let field = &suffix[dot_pos + 1..];

        let app_id: u32 = match app_id_str.parse() {
            Ok(id) => id,
            Err(_) => continue,
        };

        if let Some(ref filter) = filter_set {
            if !filter.contains(&app_id) {
                continue;
            }
        }

        let entry = user_stats.entry(app_id).or_insert(SteamUserGameStats {
            app_id,
            steam_id: steam_id.clone(),
            last_played: None,
            playtime_minutes: None,
            playtime_2weeks: None,
            cloud_status: None,
            autocloud_last_launch: None,
            autocloud_last_exit: None,
        });

        match field {
            "LastPlayed" => entry.last_played = value.parse::<u64>().ok(),
            "Playtime" => entry.playtime_minutes = value.parse::<u64>().ok(),
            "Playtime2wks" => entry.playtime_2weeks = value.parse::<u64>().ok(),
            "cloud.last_sync_state" => entry.cloud_status = Some(value.clone()),
            "autocloud.lastlaunch" => entry.autocloud_last_launch = value.parse::<u64>().ok(),
            "autocloud.lastexit" => entry.autocloud_last_exit = value.parse::<u64>().ok(),
            _ => {}
        }
    }

    user_stats.into_values().collect()
}

/// Merge stats from multiple users, preferring latest last_played / highest playtime.
fn merge_user_stats(all_users: Vec<Vec<SteamUserGameStats>>) -> Vec<SteamUserGameStats> {
    let mut merged: HashMap<u32, SteamUserGameStats> = HashMap::new();

    for user_stats in all_users {
        for stat in user_stats {
            let entry = merged.entry(stat.app_id).or_insert_with(|| SteamUserGameStats {
                app_id: stat.app_id,
                steam_id: None,
                last_played: None,
                playtime_minutes: None,
                playtime_2weeks: None,
                cloud_status: None,
                autocloud_last_launch: None,
                autocloud_last_exit: None,
            });

            // Prefer whatever user has the latest last_played
            let use_this = match (entry.last_played, stat.last_played) {
                (Some(existing), Some(new)) => new > existing,
                (None, Some(_)) => true,
                (Some(_), None) => false,
                (None, None) => match (entry.playtime_minutes, stat.playtime_minutes) {
                    (Some(existing), Some(new)) => new > existing,
                    (None, Some(_)) => true,
                    _ => false,
                },
            };

            if use_this {
                *entry = stat;
            } else {
                // Merge fields: fill in missing values from the other user
                if entry.last_played.is_none() {
                    entry.last_played = stat.last_played;
                }
                if entry.playtime_minutes.is_none() {
                    entry.playtime_minutes = stat.playtime_minutes;
                }
                if entry.playtime_2weeks.is_none() {
                    entry.playtime_2weeks = stat.playtime_2weeks;
                }
                if entry.cloud_status.is_none() {
                    entry.cloud_status = stat.cloud_status;
                }
                if entry.autocloud_last_launch.is_none() {
                    entry.autocloud_last_launch = stat.autocloud_last_launch;
                }
                if entry.autocloud_last_exit.is_none() {
                    entry.autocloud_last_exit = stat.autocloud_last_exit;
                }
            }
        }
    }

    // Normalize: if steam_id would be None for a merged entry, collect it from the best user
    // (already handled by the merge logic above)
    merged.into_values().collect()
}

#[tauri::command]
pub fn scan_steam_user_game_stats(
    steam_path: Option<String>,
    app_ids: Option<Vec<u32>>,
) -> Result<Vec<SteamUserGameStats>, String> {
    debug_log("===== Steam user game stats scan start =====");

    let steam_root = match steam_path {
        Some(p) => {
            debug_log(format!("Using provided steam_path: {}", p));
            PathBuf::from(p)
        }
        None => {
            debug_log("No steam_path provided, attempting auto-detection...");
            match crate::utils::path_utils::detect_steam_paths() {
                Some(paths) => {
                    debug_log(format!("Auto-detected Steam root: {}", paths.steam_root));
                    PathBuf::from(paths.steam_root)
                }
                None => {
                    return Err("Steam path not provided and auto-detection failed".to_string());
                }
            }
        }
    };

    debug_log(format!("Steam root resolved to: {}", steam_root.display()));
    if !steam_root.is_dir() {
        return Err(format!("Steam root not found: {}", steam_root.display()));
    }

    let userdata_dirs = find_userdata_dirs(&steam_root);
    debug_log(format!(
        "Steam root: {} -> userdata dirs found: {}",
        steam_root.display(),
        userdata_dirs.len()
    ));

    if userdata_dirs.is_empty() {
        debug_log("No userdata directories found under userdata/");
        return Ok(Vec::new());
    }

    for d in &userdata_dirs {
        let localconfig = d.join("config").join("localconfig.vdf");
        debug_log(format!(
            "  userdata dir: {} -> localconfig.vdf exists: {}",
            d.display(),
            localconfig.is_file()
        ));
    }

    let filter = app_ids.as_deref();
    let mut all_users: Vec<Vec<SteamUserGameStats>> = Vec::new();

    for user_dir in &userdata_dirs {
        let stats = collect_stats_from_user(user_dir, filter);
        debug_log(format!(
            "  user {}: {} game stats found",
            user_dir.file_name().unwrap_or_default().to_string_lossy(),
            stats.len()
        ));
        // Log first few appIds for debugging
        for s in stats.iter().take(5) {
            debug_log(format!(
                "    app_id={} last_played={:?} playtime={:?} cloud={:?}",
                s.app_id, s.last_played, s.playtime_minutes, s.cloud_status
            ));
        }
        all_users.push(stats);
    }

    let merged = merge_user_stats(all_users);
    debug_log(format!("Total merged game stats: {}", merged.len()));
    for s in merged.iter().take(10) {
        debug_log(format!(
            "  merged app_id={} last_played={:?} playtime={:?} cloud={:?}",
            s.app_id, s.last_played, s.playtime_minutes, s.cloud_status
        ));
    }
    debug_log("===== Steam user game stats scan end =====");

    Ok(merged)
}
