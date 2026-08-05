//! Non-Steam achievement detection and config management.
//!
//! Supports Goldberg, CODEX/RUNE, and OnlineFix achievement data formats.
//! Config persisted as `non-steam-configs.json` in app data dir.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};


use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

use crate::models::steam_appcache_achievements::AchievementsAppPercentagesFile;

// ─── Config Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonSteamAchievementConfig {
    pub app_id: u64,
    #[serde(default)]
    pub name: String,
    pub game_dir: String,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
    /// Directory where achievement unlock state files are stored (e.g. GSE Saves path).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_path: Option<String>,
    /// Platform identifier for the reference tool config (e.g. "goldberg", "codex", "onlinefix").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

fn default_source() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NonSteamConfigsFile {
    pub version: u32,
    pub entries: Vec<NonSteamAchievementConfig>,
}

// ─── Achievement Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonSteamAchievement {
    pub api_name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub description: String,
    pub unlocked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unlock_time: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_gray: Option<String>,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonSteamDetectionResult {
    pub has_achievements: bool,
    pub source: Option<String>,
    pub app_id: Option<u64>,
    pub achievement_count: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NonSteamAchievementPercentage {
    pub name: String,
    pub percent: f64,
}

// ─── Config File Helpers ────────────────────────────────────────────────────

const CONFIG_FILENAME: &str = "non-steam-configs.json";

fn get_config_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("config");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    Ok(dir)
}

fn get_config_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_config_dir(app_handle)?.join(CONFIG_FILENAME))
}

// ─── Config CRUD Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn read_non_steam_configs(
    app_handle: AppHandle,
) -> Result<Vec<NonSteamAchievementConfig>, String> {
    let path = get_config_path(&app_handle)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read non-steam configs: {}", e))?;
    let file: NonSteamConfigsFile =
        serde_json::from_str(&content).map_err(|e| format!("Corrupt non-steam configs: {}", e))?;
    Ok(file.entries)
}

#[tauri::command]
pub fn write_non_steam_configs(
    app_handle: AppHandle,
    entries: Vec<NonSteamAchievementConfig>,
) -> Result<(), String> {
    let path = get_config_path(&app_handle)?;
    let file = NonSteamConfigsFile {
        version: 1,
        entries,
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Failed to serialize non-steam configs: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Failed to write non-steam configs: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to rename non-steam configs: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_non_steam_config(
    app_handle: AppHandle,
    config: NonSteamAchievementConfig,
) -> Result<(), String> {
    let mut entries = read_non_steam_configs(app_handle.clone())?;
    entries.retain(|e| e.app_id != config.app_id);
    entries.push(config);
    write_non_steam_configs(app_handle, entries)
}

#[tauri::command]
pub fn delete_non_steam_config(app_handle: AppHandle, app_id: u64) -> Result<(), String> {
    let mut entries = read_non_steam_configs(app_handle.clone())?;
    entries.retain(|e| e.app_id != app_id);
    write_non_steam_configs(app_handle, entries)
}

// ─── Detection Commands ─────────────────────────────────────────────────────

/// Inner detection logic (testable without AppHandle).
fn detect_non_steam_inner(
    game_dir: &str,
    app_id: Option<u64>,
    data_dir: Option<PathBuf>,
) -> Result<NonSteamDetectionResult, String> {
    let dir = PathBuf::from(game_dir);
    if !dir.is_dir() {
        return Ok(NonSteamDetectionResult {
            has_achievements: false,
            source: None,
            app_id,
            achievement_count: 0,
            message: format!("Directory does not exist: {}", game_dir),
        });
    }

    // Try each source in priority order
    if let Some(result) = detect_goldberg(&dir, app_id) {
        return Ok(result);
    }
    if let Some(result) = detect_codex(&dir, app_id) {
        return Ok(result);
    }
    if let Some(result) = detect_onlinefix(&dir, app_id) {
        return Ok(result);
    }

    // Check for generated-schema (written by generate_achievement_schema command)
    if let Some(data_dir) = data_dir {
        if let Some(resolved_id) = app_id.or_else(|| read_steam_appid(&dir)).or_else(|| read_steam_appid_from_steam_settings(&dir)) {
            let gen_path = data_dir
                .join("achievements")
                .join("non-steam")
                .join(resolved_id.to_string())
                .join("achievements.json");
            if gen_path.exists() {
                let count = fs::read_to_string(&gen_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<Vec<serde_json::Value>>(&c).ok())
                    .map(|arr| arr.len())
                    .unwrap_or(0);
                if count > 0 {
                    return Ok(NonSteamDetectionResult {
                        has_achievements: true,
                        source: Some("generated-schema".to_string()),
                        app_id: Some(resolved_id),
                        achievement_count: count,
                        message: format!("Generated schema: {} achievements found", count),
                    });
                }
            }
        }
    }

    // Try to read AppID from steam_appid.txt if not provided
    let resolved_app_id = app_id.or_else(|| read_steam_appid(&dir));

    Ok(NonSteamDetectionResult {
        has_achievements: false,
        source: None,
        app_id: resolved_app_id,
        achievement_count: 0,
        message: "No achievement data found (Goldberg, CODEX, OnlineFix, or generated schema)".to_string(),
    })
}

#[tauri::command]
pub fn detect_non_steam_achievements(
    app_handle: AppHandle,
    game_dir: String,
    app_id: Option<u64>,
) -> Result<NonSteamDetectionResult, String> {
    let data_dir = app_handle.path().app_data_dir().ok();
    detect_non_steam_inner(&game_dir, app_id, data_dir)
}

#[tauri::command]
pub fn read_non_steam_achievements(
    app_handle: AppHandle,
    game_dir: String,
    app_id: u64,
    source: String,
) -> Result<Vec<NonSteamAchievement>, String> {
    // generated-schema reads from the app data dir, not the game dir — skip dir check
    if source.as_str() != "generated-schema" {
        let dir = PathBuf::from(&game_dir);
        if !dir.is_dir() {
            return Err(format!("Directory does not exist: {}", game_dir));
        }
    }

    match source.as_str() {
        "goldberg" => read_goldberg_achievements(&PathBuf::from(&game_dir), app_id, &app_handle),
        "codex" => read_codex_achievements(&PathBuf::from(&game_dir), app_id),
        "onlinefix" => read_onlinefix_achievements(&PathBuf::from(&game_dir), app_id),
        "generated-schema" => read_generated_schema_achievements(&app_handle, app_id),
        _ => Err(format!("Unknown source: {}", source)),
    }
}

#[tauri::command]
pub fn read_non_steam_achievement_percentages(
    app_handle: AppHandle,
    app_id: u64,
) -> Result<Vec<NonSteamAchievementPercentage>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Try both non-steam (written by generate_achievement_schema) and steam (written by resolver) paths
    let non_steam_path = data_dir
        .join("achievements")
        .join("non-steam")
        .join(app_id.to_string())
        .join("achievementpercentages.json");
    let steam_path = data_dir
        .join("achievements")
        .join("steam")
        .join(app_id.to_string())
        .join("achievementpercentages.json");

    // Prefer non-steam path (written by generate_achievement_schema for this game)
    let pct_path = if non_steam_path.exists() {
        Some(non_steam_path)
    } else if steam_path.exists() {
        Some(steam_path)
    } else {
        None
    };

    let pct_path = match pct_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let content = fs::read_to_string(&pct_path)
        .map_err(|e| format!("Failed to read {}: {}", pct_path.display(), e))?;

    // First, try the wrapper format (used by Steam resolver): { appid, source, achievements: [...] }
    if let Ok(wrapper) = serde_json::from_str::<AchievementsAppPercentagesFile>(&content) {
        eprintln!(
            "[ACH][NON_STEAM_PCT] loaded wrapper format appid={} count={} path={}",
            app_id,
            wrapper.achievements.len(),
            pct_path.display()
        );
        return Ok(wrapper
            .achievements
            .into_iter()
            .map(|e| NonSteamAchievementPercentage {
                name: e.name,
                percent: e.percent,
            })
            .collect());
    }

    // Fallback: flat array format [{ name, percent }] (written by generate_achievement_schema)
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", pct_path.display(), e))?;

    match parsed {
        serde_json::Value::Array(arr) => {
            let result: Vec<NonSteamAchievementPercentage> = arr
                .into_iter()
                .filter_map(|v| {
                    let name = v.get("name")?.as_str()?.to_string();
                    let percent = v.get("percent")?.as_f64()?;
                    Some(NonSteamAchievementPercentage { name, percent })
                })
                .collect();
            eprintln!(
                "[ACH][NON_STEAM_PCT] loaded flat array format appid={} count={} path={}",
                app_id,
                result.len(),
                pct_path.display()
            );
            Ok(result)
        }
        _ => Ok(vec![]),
    }
}

// ─── Goldberg Detection ─────────────────────────────────────────────────────

/// Goldberg stores achievements in `steam_settings/achievements.json`.
/// Format: `{ "API_NAME": { displayName, description, icon, icongray, hidden } }`
fn detect_goldberg(dir: &Path, app_id: Option<u64>) -> Option<NonSteamDetectionResult> {
    let json_path = find_achievement_json(dir)?;
    let content = fs::read_to_string(&json_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;

    let count = match &parsed {
        serde_json::Value::Array(arr) => arr.len(),
        serde_json::Value::Object(map) => map.len(),
        _ => 0,
    };

    if count == 0 {
        return None;
    }

    let resolved_id = app_id
        .or_else(|| read_steam_appid(dir))
        .or_else(|| read_steam_appid_from_steam_settings(dir));

    Some(NonSteamDetectionResult {
        has_achievements: true,
        source: Some("goldberg".to_string()),
        app_id: resolved_id,
        achievement_count: count,
        message: format!("Goldberg: {} achievements found", count),
    })
}

/// Read Goldberg achievements.json and normalize to our format.
/// Also merges unlock state from GSE Saves (`%APPDATA%/GSE Saves/<appId>/achievements.json`).
fn read_goldberg_achievements(dir: &Path, app_id: u64, app_handle: &AppHandle) -> Result<Vec<NonSteamAchievement>, String> {
    let json_path = find_achievement_json(dir)
        .ok_or_else(|| "Goldberg achievements.json not found".to_string())?;

    let content =
        fs::read_to_string(&json_path).map_err(|e| format!("Failed to read achievements.json: {}", e))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

    let mut achievements = Vec::new();

    match &parsed {
        // Array format: [{ name, displayName, description, icon, icongray, hidden }]
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(obj) = item.as_object() {
                    let api_name = extract_string(obj, &["name", "Name", "apiName"])
                        .unwrap_or_default();
                    if api_name.is_empty() {
                        continue;
                    }
                    achievements.push(NonSteamAchievement {
                        api_name: api_name.clone(),
                        display_name: extract_string(obj, &["displayName", "display_name", "title"])
                            .unwrap_or_else(|| api_name.clone()),
                        description: extract_string(obj, &["description", "desc"])
                            .unwrap_or_default(),
                        unlocked: extract_bool(obj, &["achieved", "earned", "unlocked"])
                            .unwrap_or(false),
                        unlock_time: extract_u64(obj, &["unlockTime", "unlock_time", "earned_time", "timestamp"]),
                        icon: extract_string(obj, &["icon"]),
                        icon_gray: extract_string(obj, &["icongray", "icon_gray", "iconGray"]),
                        hidden: extract_bool(obj, &["hidden"]).unwrap_or(false),
                    });
                }
            }
        }
        // Object format: { "API_NAME": { displayName, description, icon, icongray, hidden } }
        serde_json::Value::Object(map) => {
            for (api_name, val) in map {
                if let Some(obj) = val.as_object() {
                    achievements.push(NonSteamAchievement {
                        api_name: api_name.clone(),
                        display_name: extract_string(obj, &["displayName", "display_name", "title"])
                            .unwrap_or_else(|| api_name.clone()),
                        description: extract_string(obj, &["description", "desc"])
                            .unwrap_or_default(),
                        unlocked: extract_bool(obj, &["achieved", "earned", "unlocked"])
                            .unwrap_or(false),
                        unlock_time: extract_u64(obj, &["unlockTime", "unlock_time", "earned_time", "timestamp"]),
                        icon: extract_string(obj, &["icon"]),
                        icon_gray: extract_string(obj, &["icongray", "icon_gray", "iconGray"]),
                        hidden: extract_bool(obj, &["hidden"]).unwrap_or(false),
                    });
                }
            }
        }
        _ => {}
    }

    // ── Merge GSE Saves unlock state ──────────────────────────────────────
    // GSE Saves format: { "apiName": { "earned": true, "earned_time": 1234567890 } }
    if app_id > 0 {
        if let Ok(gse_path) = app_handle.path().app_data_dir() {
            // GSE Saves is at %APPDATA%/GSE Saves/ (sibling of LumaForge app data)
            if let Some(parent) = gse_path.parent() {
                let saves_path = parent
                    .join("GSE Saves")
                    .join(app_id.to_string())
                    .join("achievements.json");
                if saves_path.exists() {
                    if let Ok(saves_content) = fs::read_to_string(&saves_path) {
                        if let Ok(saves_parsed) = serde_json::from_str::<serde_json::Value>(&saves_content) {
                            if let Some(saves_map) = saves_parsed.as_object() {
                                for ach in &mut achievements {
                                    if let Some(save_data) = saves_map.get(&ach.api_name) {
                                        if let Some(save_obj) = save_data.as_object() {
                                            let earned = save_obj.get("earned")
                                                .and_then(|v| v.as_bool())
                                                .unwrap_or(false);
                                            let earned_time = save_obj.get("earned_time")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0);
                                            if earned {
                                                ach.unlocked = true;
                                            }
                                            if earned_time > 0 {
                                                ach.unlock_time = Some(earned_time);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(achievements)
}

/// Detect account_id from steam_settings/ directory.
/// Looks for existing UserGameStats_<accountId>_<appId>.bin files and extracts accountId.
fn detect_account_id_from_steam_settings(game_dir: &Path, app_id: u64) -> Option<u64> {
    let ss_dir = game_dir.join("steam_settings");
    if !ss_dir.is_dir() {
        return None;
    }
    // Look for UserGameStats_<accountId>_<appId>.bin pattern
    if let Ok(entries) = fs::read_dir(&ss_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("UserGameStats_") && name_str.ends_with(".bin") {
                // Parse: UserGameStats_<accountId>_<appId>.bin
                let without_prefix = name_str.strip_prefix("UserGameStats_")?;
                let without_suffix = without_prefix.strip_suffix(".bin")?;
                // Split from right: the last _<appId> part is the appId
                let app_str = app_id.to_string();
                if let Some(pos) = without_suffix.rfind(&app_str) {
                    let account_str = &without_suffix[..pos];
                    // Trim trailing underscore
                    let account_str = account_str.trim_end_matches('_');
                    if let Ok(aid) = account_str.parse::<u64>() {
                        if aid > 0 {
                            return Some(aid);
                        }
                    }
                }
            }
        }
    }
    None
}

// ─── Generated Schema Reader ────────────────────────────────────────────────

/// Read achievements from a generated-schema directory.
/// Reads `achievements.json` and resolves icon paths from `img/` subdirectory.
fn read_generated_schema_achievements(
    app_handle: &AppHandle,
    app_id: u64,
) -> Result<Vec<NonSteamAchievement>, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let out_dir = data_dir
        .join("achievements")
        .join("non-steam")
        .join(app_id.to_string());

    let json_path = out_dir.join("achievements.json");
    if !json_path.exists() {
        return Err(format!("Generated schema not found: {}", json_path.display()));
    }

    let content = fs::read_to_string(&json_path)
        .map_err(|e| format!("Failed to read achievements.json: {}", e))?;
    let parsed: Vec<serde_json::Value> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

    let img_dir = out_dir.join("img");
    let mut achievements = Vec::new();

    for item in &parsed {
        let obj = item.as_object().ok_or_else(|| "Achievement is not an object".to_string())?;
        let api_name = extract_string(obj, &["name", "apiName"]).unwrap_or_default();
        if api_name.is_empty() {
            continue;
        }

        // Resolve icon paths from img/ directory
        let icon = extract_string(obj, &["icon"]).and_then(|_icon_file| {
            let icon_path = img_dir.join(format!("{}.jpg", api_name));
            if icon_path.exists() {
                Some(icon_path.to_string_lossy().to_string())
            } else {
                None
            }
        });

        let icon_gray = extract_string(obj, &["icongray", "icon_gray", "iconGray"]).and_then(|_icon_file| {
            let gray_path = img_dir.join(format!("{}_gray.jpg", api_name));
            if gray_path.exists() {
                Some(gray_path.to_string_lossy().to_string())
            } else {
                None
            }
        });

        achievements.push(NonSteamAchievement {
            api_name,
            display_name: extract_string(obj, &["displayName", "display_name", "title"])
                .unwrap_or_default(),
            description: extract_string(obj, &["description", "desc"]).unwrap_or_default(),
            unlocked: false,
            unlock_time: None,
            icon,
            icon_gray,
            hidden: extract_bool(obj, &["hidden"]).unwrap_or(false),
        });
    }

    Ok(achievements)
}

/// Find achievements.json in game dir or steam_settings/
fn find_achievement_json(dir: &Path) -> Option<PathBuf> {
    // Direct
    let direct = dir.join("achievements.json");
    if direct.exists() {
        return Some(direct);
    }
    // In steam_settings/
    let ss = dir.join("steam_settings").join("achievements.json");
    if ss.exists() {
        return Some(ss);
    }
    // In steam_settings/<appid>/
    if let Some(id) = read_steam_appid(dir) {
        let ss_id = dir
            .join("steam_settings")
            .join(id.to_string())
            .join("achievements.json");
        if ss_id.exists() {
            return Some(ss_id);
        }
    }
    None
}

// ─── CODEX / RUNE Detection ─────────────────────────────────────────────────

/// CODEX stores achievements in `steam_api64.ini` or `steam_api.ini`.
/// Format: UTF-16LE INI with sections like [AchievementId] with Achieved=1, UnlockTime=...
fn detect_codex(dir: &Path, app_id: Option<u64>) -> Option<NonSteamDetectionResult> {
    let ini_path = find_codex_ini(dir)?;
    let sections = parse_achievement_ini(&ini_path).ok()?;
    if sections.is_empty() {
        return None;
    }

    let resolved_id = app_id
        .or_else(|| read_steam_appid(dir))
        .or_else(|| read_steam_appid_from_steam_settings(dir));

    Some(NonSteamDetectionResult {
        has_achievements: true,
        source: Some("codex".to_string()),
        app_id: resolved_id,
        achievement_count: sections.len(),
        message: format!("CODEX/RUNE: {} achievements found", sections.len()),
    })
}

/// Read CODEX ini and normalize to our format.
/// CODEX ini uses numeric achievement IDs as section names.
/// We derive CRC32 icon filenames from the IDs.
fn read_codex_achievements(
    dir: &Path,
    _app_id: u64,
) -> Result<Vec<NonSteamAchievement>, String> {
    let ini_path =
        find_codex_ini(dir).ok_or_else(|| "CODEX ini not found".to_string())?;
    let sections =
        parse_achievement_ini(&ini_path).map_err(|e| format!("Failed to parse CODEX ini: {}", e))?;

    let mut achievements = Vec::new();
    for (section_name, props) in &sections {
        let api_name = props
            .get("name")
            .or_else(|| props.get("Name"))
            .cloned()
            .unwrap_or_else(|| section_name.clone());

        let unlocked = parse_bool(props.get("achieved").or_else(|| props.get("Achieved")))
            || parse_bool(props.get("unlocked").or_else(|| props.get("Unlocked")))
            || props.get("progress").and_then(|v| v.parse::<u64>().ok())
                == props.get("max").and_then(|v| v.parse::<u64>().ok())
                    .filter(|&m| m > 0);

        let unlock_time = props
            .get("unlocktime")
            .or_else(|| props.get("UnlockTime"))
            .or_else(|| props.get("time"))
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        // CRC32 icon derivation (matches reference app's crc-32 npm package)
        let crc = crc32fast::hash(api_name.to_lowercase().as_bytes());
        let hex_crc = format!("{:08x}", crc);

        achievements.push(NonSteamAchievement {
            api_name,
            display_name: section_name.clone(),
            description: String::new(),
            unlocked,
            unlock_time: if unlock_time > 0 {
                Some(unlock_time)
            } else {
                None
            },
            icon: Some(format!("{}.jpg", hex_crc)),
            icon_gray: Some(format!("{}_gray.jpg", hex_crc)),
            hidden: false,
        });
    }

    Ok(achievements)
}

/// Find CODEX/RUNE ini file
fn find_codex_ini(dir: &Path) -> Option<PathBuf> {
    for name in &[
        "steam_api64.ini",
        "steam_api.ini",
        "SteamAPI64.ini",
        "SteamAPI.ini",
    ] {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Parse a UTF-16LE or UTF-8 ini file into sections of key-value pairs.
fn parse_achievement_ini(path: &Path) -> Result<HashMap<String, HashMap<String, String>>, String> {
    let raw = fs::read(path).map_err(|e| format!("Failed to read ini: {}", e))?;

    let text = decode_ini_bytes(&raw);

    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current_section = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
            sections
                .entry(current_section.clone())
                .or_insert_with(HashMap::new);
            continue;
        }

        if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_string();
            let value = trimmed[eq_pos + 1..].trim().to_string();
            sections
                .entry(current_section.clone())
                .or_insert_with(HashMap::new)
                .insert(key, value);
        }
    }

    Ok(sections)
}

/// Decode ini bytes, handling UTF-16LE BOM.
fn decode_ini_bytes(raw: &[u8]) -> String {
    // Check for UTF-16LE BOM (FF FE)
    if raw.len() >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
        return String::from_utf16_lossy(
            raw[2..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect::<Vec<u16>>()
                .as_slice(),
        );
    }
    // Check for UTF-16BE BOM (FE FF)
    if raw.len() >= 2 && raw[0] == 0xFE && raw[1] == 0xFF {
        return String::from_utf16_lossy(
            raw[2..]
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect::<Vec<u16>>()
                .as_slice(),
        );
    }
    // Check for null bytes (likely UTF-16 without BOM)
    if raw.len() >= 2 && raw.windows(2).any(|w| w[1] == 0x00 && w[0] != 0x00) {
        return String::from_utf16_lossy(
            raw.chunks_exact(2)
                .map(|c| {
                    if c.len() == 2 {
                        u16::from_le_bytes([c[0], c[1]])
                    } else {
                        c[0] as u16
                    }
                })
                .collect::<Vec<u16>>()
                .as_slice(),
        );
    }
    // Default: UTF-8
    String::from_utf8_lossy(raw).to_string()
}

// ─── OnlineFix Detection ────────────────────────────────────────────────────

/// OnlineFix stores achievements in `Stats/Achievements.ini`.
/// Format: INI with section names as achievement API names.
fn detect_onlinefix(dir: &Path, app_id: Option<u64>) -> Option<NonSteamDetectionResult> {
    let ini_path = find_onlinefix_ini(dir)?;
    let sections = parse_achievement_ini(&ini_path).ok()?;
    if sections.is_empty() {
        return None;
    }

    let resolved_id = app_id
        .or_else(|| read_steam_appid(dir))
        .or_else(|| read_steam_appid_from_steam_settings(dir));

    Some(NonSteamDetectionResult {
        has_achievements: true,
        source: Some("onlinefix".to_string()),
        app_id: resolved_id,
        achievement_count: sections.len(),
        message: format!("OnlineFix: {} achievements found", sections.len()),
    })
}

/// Read OnlineFix achievements.ini and normalize.
fn read_onlinefix_achievements(
    dir: &Path,
    _app_id: u64,
) -> Result<Vec<NonSteamAchievement>, String> {
    let ini_path =
        find_onlinefix_ini(dir).ok_or_else(|| "OnlineFix Achievements.ini not found".to_string())?;
    let sections = parse_achievement_ini(&ini_path)
        .map_err(|e| format!("Failed to parse Achievements.ini: {}", e))?;

    let mut achievements = Vec::new();
    for (section_name, props) in &sections {
        let unlocked = parse_bool(props.get("unlocked").or_else(|| props.get("Unlocked")))
            || parse_bool(props.get("achieved").or_else(|| props.get("Achieved")))
            || props.get("progress").and_then(|v| v.parse::<u64>().ok())
                == props.get("maxprogress").and_then(|v| v.parse::<u64>().ok())
                    .filter(|&m| m > 0);

        let unlock_time = props
            .get("unlocktime")
            .or_else(|| props.get("UnlockTime"))
            .or_else(|| props.get("time"))
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        achievements.push(NonSteamAchievement {
            api_name: section_name.clone(),
            display_name: section_name.clone(),
            description: String::new(),
            unlocked,
            unlock_time: if unlock_time > 0 {
                Some(unlock_time)
            } else {
                None
            },
            icon: None,
            icon_gray: None,
            hidden: false,
        });
    }

    Ok(achievements)
}

/// Find OnlineFix Achievements.ini (check Stats/ dir and root)
fn find_onlinefix_ini(dir: &Path) -> Option<PathBuf> {
    // In Stats/ subdir (standard OnlineFix layout)
    let stats_ini = dir.join("Stats").join("Achievements.ini");
    if stats_ini.exists() {
        return Some(stats_ini);
    }
    // Recursive search (max depth 2, like reference app)
    let flat = find_file_recursive(dir, "achievements.ini", 2);
    if flat.is_some() {
        return flat;
    }
    // Direct in root
    let root = dir.join("Achievements.ini");
    if root.exists() {
        return Some(root);
    }
    None
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Read steam_appid.txt from game root
fn read_steam_appid(dir: &Path) -> Option<u64> {
    let path = dir.join("steam_appid.txt");
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let trimmed = content.trim();
    trimmed.parse::<u64>().ok()
}

/// Read steam_appid.txt from steam_settings/ subdir
fn read_steam_appid_from_steam_settings(dir: &Path) -> Option<u64> {
    let path = dir.join("steam_settings").join("steam_appid.txt");
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let trimmed = content.trim();
    trimmed.parse::<u64>().ok()
}

/// Find a file by name (case-insensitive) up to max_depth
fn find_file_recursive(dir: &Path, target: &str, max_depth: u32) -> Option<PathBuf> {
    let target_lower = target.to_lowercase();
    let mut stack = vec![(dir.to_path_buf(), 0u32)];

    while let Some((current, depth)) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.to_lowercase() == target_lower {
                            return Some(path);
                        }
                    }
                } else if path.is_dir() && depth < max_depth {
                    stack.push((path, depth + 1));
                }
            }
        }
    }
    None
}

/// Extract a string from a JSON object by trying multiple keys
fn extract_string(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(val) = obj.get(*key) {
            match val {
                serde_json::Value::String(s) => return Some(s.clone()),
                serde_json::Value::Number(n) => return Some(n.to_string()),
                _ => {}
            }
        }
    }
    None
}

/// Extract a boolean from a JSON object by trying multiple keys
fn extract_bool(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<bool> {
    for key in keys {
        if let Some(val) = obj.get(*key) {
            match val {
                serde_json::Value::Bool(b) => return Some(*b),
                serde_json::Value::Number(n) => return Some(n.as_u64().unwrap_or(0) == 1),
                serde_json::Value::String(s) => {
                    return Some(matches!(s.to_lowercase().as_str(), "1" | "true" | "yes"));
                }
                _ => {}
            }
        }
    }
    None
}

/// Extract a u64 from a JSON object by trying multiple keys
fn extract_u64(obj: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(val) = obj.get(*key) {
            match val {
                serde_json::Value::Number(n) => {
                    if let Some(v) = n.as_u64() {
                        return Some(v);
                    }
                }
                serde_json::Value::String(s) => {
                    if let Ok(v) = s.parse::<u64>() {
                        return Some(v);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Parse a boolean from an INI value
fn parse_bool(val: Option<&String>) -> bool {
    match val {
        Some(v) => matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"),
        None => false,
    }
}

// ─── Achievement Schema Generator (GSE-equivalent) ──────────────────────────
//
// Generates binary VDF files equivalent to GSE-GenV2 from a JSON achievement
// schema + icon images. Outputs:
//   <dir>/UserGameStatsSchema_<appId>.bin  — schema definition
//   <dir>/UserGameStats_<accountId>_<appId>.bin — empty unlock state seed
//   <dir>/img/                            — icon + icon_gray downloads

use crate::utils::binary_vdf::{write_binary_vdf, VdfValue};

/// Generate achievement schema and unlock-state bin files from a JSON schema.
///
/// `schema_json` is a flat JSON array of achievement objects:
/// ```json
/// [
///   {
///     "name": "API_NAME",
///     "displayName": "Display Name",
///     "description": "Description text",
///     "icon": "hash.jpg",
///     "icongray": "hash_gray.jpg",
///     "hidden": 0
///   }
/// ]
/// ```
///
/// `account_id` is the Steam account ID (default 0 for non-Steam).
/// Returns paths written or an error.
#[tauri::command]
pub async fn generate_achievement_schema(
    app_handle: AppHandle,
    app_id: u64,
    schema_json: String,
    account_id: Option<u64>,
    game_dir: Option<String>,
    game_name: Option<String>,
    save_path: Option<String>,
    platform: Option<String>,
) -> Result<String, String> {
    let achievements: Vec<serde_json::Value> = serde_json::from_str(&schema_json)
        .map_err(|e| format!("Invalid schema JSON: {}", e))?;

    if achievements.is_empty() {
        return Err("Schema JSON contains no achievements".to_string());
    }

    // Resolve output directory
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let out_dir = data_dir
        .join("achievements")
        .join("non-steam")
        .join(app_id.to_string());
    fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    // ── 1. Save achievements.json alongside bin VDFs ────────────────────────
    // This JSON is used by generated-schema reader to resolve icons.
    let json_path = out_dir.join("achievements.json");
    let json_data = serde_json::to_string_pretty(&achievements)
        .map_err(|e| format!("Failed to serialize achievements JSON: {}", e))?;
    fs::write(&json_path, &json_data)
        .map_err(|e| format!("Failed to write achievements.json: {}", e))?;

    // ── 2. Build and write schema bin ──────────────────────────────────────
    let schema_entries = build_schema_kv(app_id, &achievements)?;
    let schema_bytes = write_binary_vdf(&schema_entries);
    let schema_path = out_dir.join(format!("UserGameStatsSchema_{}.bin", app_id));
    fs::write(&schema_path, &schema_bytes)
        .map_err(|e| format!("Failed to write schema bin: {}", e))?;

    // ── 3. Build and write unlock state seed ───────────────────────────────
    // Detect account_id from game_dir's steam_settings/ if not provided
    let aid = if let Some(id) = account_id {
        id
    } else if let Some(ref gd) = game_dir {
        detect_account_id_from_steam_settings(Path::new(gd), app_id)
            .unwrap_or(0)
    } else {
        0
    };
    let seed_entries = build_unlock_state_seed(app_id, aid, achievements.len());
    let seed_bytes = write_binary_vdf(&seed_entries);
    let seed_path = out_dir.join(format!("UserGameStats_{}_{}.bin", aid, app_id));
    fs::write(&seed_path, &seed_bytes)
        .map_err(|e| format!("Failed to write unlock state bin: {}", e))?;

    // ── 4. Create img/ directory ───────────────────────────────────────────
    let img_dir = out_dir.join("img");
    fs::create_dir_all(&img_dir)
        .map_err(|e| format!("Failed to create img dir: {}", e))?;

    // ── 5. Download icons ──────────────────────────────────────────────────
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut downloaded = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;

    // Diagnostic: log first achievement's keys to verify icon/icongray presence
    if let Some(first) = achievements.first() {
        eprintln!(
            "[ACH][SCHEMA_GEN] icon-download first achievement keys={:?} name={:?} icon={:?} icongray={:?}",
            first.as_object().map(|m| m.keys().collect::<Vec<_>>()),
            extract_ach_field(first, "name"),
            extract_ach_field(first, "icon"),
            extract_ach_field(first, "icongray")
        );
    }
    eprintln!(
        "[ACH][SCHEMA_GEN] icon-download total achievements={}",
        achievements.len()
    );

    for ach in &achievements {
        let name = extract_ach_field(ach, "name").unwrap_or_default();
        if name.is_empty() {
            continue;
        }

        // Download colored icon
        if let Some(icon_file) = extract_ach_field(ach, "icon") {
            if !icon_file.is_empty() {
                // Steam API GetSchemaForGame returns absolute URLs; Goldberg/CODEX return raw hashes
                let url = if icon_file.starts_with("http://") || icon_file.starts_with("https://") {
                    icon_file.clone()
                } else {
                    format!(
                        "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{}/{}",
                        app_id, icon_file
                    )
                };
                let dest = img_dir.join(format!("{}.jpg", name));
                match download_icon(&client, &url, &dest).await {
                    Ok(true) => {
                        downloaded += 1;
                        eprintln!(
                            "[ACH][SCHEMA_GEN] icon downloaded name={} url={}",
                            name, url
                        );
                    }
                    Ok(false) => {
                        skipped += 1;
                        eprintln!(
                            "[ACH][SCHEMA_GEN] icon 404 name={} url={}",
                            name, url
                        );
                    }
                    Err(e) => {
                        failed += 1;
                        eprintln!(
                            "[ACH][SCHEMA_GEN] icon FAILED name={} url={} error={}",
                            name, url, e
                        );
                    }
                }
            }
        } else {
            eprintln!(
                "[ACH][SCHEMA_GEN] icon missing-in-json name={}",
                name
            );
        }

        // Download gray icon
        if let Some(gray_file) = extract_ach_field(ach, "icongray") {
            if !gray_file.is_empty() {
                // Steam API GetSchemaForGame returns absolute URLs; Goldberg/CODEX return raw hashes
                let url = if gray_file.starts_with("http://") || gray_file.starts_with("https://") {
                    gray_file.clone()
                } else {
                    format!(
                        "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{}/{}",
                        app_id, gray_file
                    )
                };
                let dest = img_dir.join(format!("{}_gray.jpg", name));
                match download_icon(&client, &url, &dest).await {
                    Ok(true) => {
                        downloaded += 1;
                        eprintln!(
                            "[ACH][SCHEMA_GEN] gray downloaded name={} url={}",
                            name, url
                        );
                    }
                    Ok(false) => {
                        skipped += 1;
                        eprintln!(
                            "[ACH][SCHEMA_GEN] gray 404 name={} url={}",
                            name, url
                        );
                    }
                    Err(e) => {
                        failed += 1;
                        eprintln!(
                            "[ACH][SCHEMA_GEN] gray FAILED name={} url={} error={}",
                            name, url, e
                        );
                    }
                }
            }
        } else {
            eprintln!(
                "[ACH][SCHEMA_GEN] gray missing-in-json name={}",
                name
            );
        }
    }

    // ── 6. Fetch and write achievementpercentages.json ─────────────────────
    let pct_json_path = out_dir.join("achievementpercentages.json");
    match fetch_global_achievement_percentages(&client, app_id).await {
        Ok(pct_data) => {
            let pct_json = serde_json::to_string_pretty(&pct_data)
                .unwrap_or_else(|_| "{}".to_string());
            if let Err(e) = fs::write(&pct_json_path, &pct_json) {
                eprintln!(
                    "[ACH][SCHEMA_GEN] achievementpercentages write FAILED appid={} error={}",
                    app_id, e
                );
            } else {
                eprintln!(
                    "[ACH][SCHEMA_GEN] achievementpercentages written path={} count={}",
                    pct_json_path.display(),
                    pct_data.as_array().map_or(0, |a| a.len())
                );
            }
        }
        Err(e) => {
            eprintln!(
                "[ACH][SCHEMA_GEN] achievementpercentages fetch FAILED appid={} error={}",
                app_id, e
            );
        }
    }

    // ── 7. Write config.json (reference tool format) ──────────────────────
    let config_platform = platform.unwrap_or_else(|| "goldberg".to_string());
    let config_name = game_name
        .clone()
        .unwrap_or_else(|| format!("App {}", app_id));
    let config_json = serde_json::json!({
        "name": config_name,
        "displayName": config_name,
        "appid": app_id.to_string(),
        "platform": config_platform,
        "config_path": out_dir.to_string_lossy(),
        "save_path": save_path.unwrap_or_default(),
        "executable": "",
        "arguments": "",
        "process_name": "",
    });
    let config_path = out_dir.join("config.json");
    let config_pretty = serde_json::to_string_pretty(&config_json)
        .map_err(|e| format!("Failed to serialize config.json: {}", e))?;
    fs::write(&config_path, config_pretty.as_bytes())
        .map_err(|e| format!("Failed to write config.json: {}", e))?;
    eprintln!(
        "[ACH][SCHEMA_GEN] config.json written path={} appid={} platform={} name={}",
        config_path.display(),
        app_id,
        config_platform,
        config_name
    );

    Ok(format!(
        "Schema: {}, Seed: {}, Icons: {} downloaded / {} skipped / {} failed, Percentages: written, Config: {}",
        schema_path.display(),
        seed_path.display(),
        downloaded,
        skipped,
        failed,
        config_path.display()
    ))
}

/// Build the Binary VDF schema KV tree for a game's achievements.
///
/// Structure: `<appid>` → Object([("gamename", Str), ("version", Str("1")),
///   ("stats", Object([block → Object([...])])])])
///
/// Achievements are grouped in blocks of 32.
fn build_schema_kv(
    app_id: u64,
    achievements: &[serde_json::Value],
) -> Result<Vec<(String, VdfValue)>, String> {
    let mut blocks: Vec<(String, VdfValue)> = Vec::new();

    for (idx, ach) in achievements.iter().enumerate() {
        let block_num = (idx / 32) + 1;
        let bit_pos = idx % 32;
        let block_key = block_num.to_string();

        // Find or create this block
        let block_entry = blocks.iter_mut().find(|(k, _)| k == &block_key);
        let block_obj = if let Some((_, VdfValue::Object(children))) = block_entry {
            children
        } else {
            // Create new block with type=4 (achievement stat)
            let block_children = vec![
                ("type".into(), VdfValue::Str("4".into())),
                ("id".into(), VdfValue::Str(block_num.to_string())),
                ("bits".into(), VdfValue::Object(Vec::new())),
            ];
            blocks.push((block_key.clone(), VdfValue::Object(block_children)));
            if let Some((_, VdfValue::Object(children))) = blocks.last_mut() {
                children
            } else {
                unreachable!()
            }
        };

        // Find the "bits" sub-object in this block
        let bits_obj = block_obj
            .iter_mut()
            .filter_map(|(k, v)| {
                if k == "bits" {
                    if let VdfValue::Object(bits) = v {
                        Some(bits)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .next()
            .ok_or_else(|| format!("Missing bits in block {}", block_num))?;

        // Build the achievement bit entry
        let api_name = extract_ach_field(ach, "name").unwrap_or_default();
        let display_name = extract_ach_field(ach, "displayName")
            .or_else(|| extract_ach_field(ach, "display_name"))
            .unwrap_or_else(|| api_name.clone());
        let description = extract_ach_field(ach, "description").unwrap_or_default();
        let hidden_val = ach
            .get("hidden")
            .map(|v| match v {
                serde_json::Value::Bool(b) => {
                    if *b {
                        "1"
                    } else {
                        "0"
                    }
                }
                serde_json::Value::Number(n) => {
                    if n.as_u64().unwrap_or(0) != 0 {
                        "1"
                    } else {
                        "0"
                    }
                }
                serde_json::Value::String(s) => {
                    if s == "1" || s.to_lowercase() == "true" {
                        "1"
                    } else {
                        "0"
                    }
                }
                _ => "0",
            })
            .unwrap_or("0");

        let bit_entry = VdfValue::Object(vec![
            ("name".into(), VdfValue::Str(api_name)),
            ("bit".into(), VdfValue::Int32(bit_pos as i32)),
            (
                "display".into(),
                VdfValue::Object(vec![
                    ("name".into(), VdfValue::Str(display_name)),
                    ("desc".into(), VdfValue::Str(description)),
                    ("hidden".into(), VdfValue::Str(hidden_val.into())),
                ]),
            ),
        ]);

        bits_obj.push((bit_pos.to_string(), bit_entry));
    }

    // Wrap: <appid> → Object(gamename, version, stats)
    let root = vec![(
        app_id.to_string(),
        VdfValue::Object(vec![
            ("gamename".into(), VdfValue::Str(format!("Game {}", app_id))),
            ("version".into(), VdfValue::Str("1".into())),
            ("stats".into(), VdfValue::Object(blocks)),
        ]),
    )];

    Ok(root)
}

/// Build the empty unlock state seed KV tree.
///
/// Structure matches `UserGameStats_<accountId>_<appId>.bin`:
/// a 38-byte zeroed block (6 × int32 + 14 × int16 pairs) + a VdfValue wrapper.
/// The actual binary is the raw seed bytes prefixed by nothing special — just the
/// same format as a VDF with one object containing all-zero achievement bits.
fn build_unlock_state_seed(
    app_id: u64,
    account_id: u64,
    achievement_count: usize,
) -> Vec<(String, VdfValue)> {
    // The unlock state stores a uint64 per 32 achievements (bitfield of unlocks).
    // For an empty seed, all bits are 0.
    let num_groups = (achievement_count + 31) / 32;
    let mut unlock_bits: Vec<(String, VdfValue)> = Vec::new();

    for group_idx in 0..num_groups {
        unlock_bits.push((
            (group_idx + 1).to_string(),
            VdfValue::UInt64(0), // all locked
        ));
    }

    vec![(
        app_id.to_string(),
        VdfValue::Object(vec![
            ("accountid".into(), VdfValue::UInt64(account_id)),
            ("unlock".into(), VdfValue::Object(unlock_bits)),
        ]),
    )]
}

/// Extract a string field from an achievement JSON object.
fn extract_ach_field(ach: &serde_json::Value, key: &str) -> Option<String> {
    ach.get(key).and_then(|v| match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

/// Fetch global achievement percentages from Steam and return a flat JSON array
/// matching the reference format: `[{ name, percent }, ...]`
async fn fetch_global_achievement_percentages(
    client: &reqwest::Client,
    app_id: u64,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={}",
        app_id
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP error fetching achievement percentages: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for achievement percentages", resp.status()));
    }
    let raw: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse achievement percentages JSON: {}", e))?;

    // Steam API response shape: { "achievementpercentages": { "achievements": [{ "name", "percent" }] } }
    eprintln!(
        "[ACH][SCHEMA_GEN] percentages raw top-level keys appid={}: {:?}",
        app_id,
        raw.as_object().map(|m| m.keys().collect::<Vec<_>>())
    );
    let achievements = raw
        .get("achievementpercentages")
        .and_then(|ap| {
            eprintln!(
                "[ACH][SCHEMA_GEN] percentages achievementpercentages keys: {:?}",
                ap.as_object().map(|m| m.keys().collect::<Vec<_>>())
            );
            ap.get("achievements")
        })
        .and_then(|a| {
            let arr = a.as_array().cloned().unwrap_or_default();
            eprintln!(
                "[ACH][SCHEMA_GEN] percentages achievements array len={}",
                arr.len()
            );
            if let Some(first) = arr.first() {
                eprintln!(
                    "[ACH][SCHEMA_GEN] percentages first entry keys: {:?}",
                    first.as_object().map(|m| m.keys().collect::<Vec<_>>())
                );
            }
            Some(arr)
        })
        .unwrap_or_default();

    // Normalize to reference format
    let normalized: Vec<serde_json::Value> = achievements
        .iter()
        .filter_map(|a| {
            let name = a.get("name")?.as_str()?;
            let percent = a.get("percent")?.as_f64()?;
            Some(serde_json::json!({
                "name": name,
                "percent": percent
            }))
        })
        .collect();

    Ok(serde_json::Value::Array(normalized))
}

/// Download a single icon file. Returns Ok(true) if downloaded, Ok(false) if 404.
async fn download_icon(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<bool, String> {
    if dest.exists() {
        return Ok(true); // already cached
    }
    let resp = client.get(url).send().await.map_err(|e| format!("HTTP error: {}", e))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(false);
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    fs::write(dest, &bytes).map_err(|e| format!("Failed to write icon: {}", e))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_utf16le_bom() {
        let mut bytes = vec![0xFF, 0xFE]; // BOM
        for ch in "hello".chars() {
            bytes.extend_from_slice(&(ch as u16).to_le_bytes());
        }
        assert_eq!(decode_ini_bytes(&bytes), "hello");
    }

    #[test]
    fn decode_utf8() {
        let bytes = b"[section]\nkey=value\n";
        assert_eq!(decode_ini_bytes(bytes), "[section]\nkey=value\n");
    }

    #[test]
    fn parse_bool_values() {
        assert!(parse_bool(Some(&"1".to_string())));
        assert!(parse_bool(Some(&"true".to_string())));
        assert!(parse_bool(Some(&"True".to_string())));
        assert!(!parse_bool(Some(&"0".to_string())));
        assert!(!parse_bool(None));
    }

    #[test]
    fn crc32_matches_javascript() {
        // CRC32 IEEE of "test" (lowercase)
        let crc = crc32fast::hash(b"test");
        let hex = format!("{:08x}", crc);
        // JavaScript crc-32 package: CRC32.str("test") >>> 0 = 0xD8D34632
        assert_eq!(hex, "d8d34632");
    }

    #[test]
    fn extract_string_from_json() {
        let mut obj = serde_json::Map::new();
        obj.insert(
            "displayName".to_string(),
            serde_json::Value::String("Test".to_string()),
        );
        assert_eq!(
            extract_string(&obj, &["displayName", "name"]),
            Some("Test".to_string())
        );
    }

    #[test]
    fn detect_empty_dir() {
        let dir = PathBuf::from("/nonexistent/path/that/doesnt/exist");
        let result = detect_non_steam_inner(dir.to_str().unwrap(), None, None).unwrap();
        assert!(!result.has_achievements);
    }
}
