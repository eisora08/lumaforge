use std::path::{Path, PathBuf};
use std::time::Duration;
use std::{fs, io::Read};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models::steam_appcache_achievements::{
  AchievementsAppSchemaResult, AppAchievementCache, AppAchievementCacheEntry,
  AppAchievementPercentagesEntry, AchievementsAppSchemaEntry, AchievementsAppPercentagesFile,
  SteamAppcacheAchievement, SteamAppcacheScanResult, SteamAppcacheSchemaEntry,
};

fn build_client() -> Result<reqwest::blocking::Client, String> {
  reqwest::blocking::Client::builder()
    .user_agent("LumaForge/0.1.0")
    .timeout(Duration::from_secs(15))
    .connect_timeout(Duration::from_secs(8))
    .redirect(reqwest::redirect::Policy::limited(5))
    .build()
    .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

#[tauri::command]
pub fn fetch_steam_player_achievements(
  app_id: u32,
  steam_id: String,
  api_key: String,
  language: Option<String>,
) -> Result<Value, String> {
  let lang = language.unwrap_or_else(|| "english".to_string());
  let url = format!(
    "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid={}&steamid={}&key={}&l={}",
    app_id, steam_id, api_key, lang
  );
  let client = build_client()?;
  let response = client
    .get(&url)
    .send()
    .map_err(|e| format!("GetPlayerAchievements request failed: {}", e))?;
  if !response.status().is_success() {
    return Err(format!(
      "GetPlayerAchievements returned HTTP {}",
      response.status()
    ));
  }
  response
    .json::<Value>()
    .map_err(|e| format!("Failed to parse GetPlayerAchievements response: {}", e))
}

#[tauri::command]
pub fn fetch_steam_global_achievement_percentages(app_id: u32) -> Result<Value, String> {
  let url = format!(
    "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={}&format=json",
    app_id
  );
  let client = build_client()?;
  let response = client
    .get(&url)
    .send()
    .map_err(|e| format!("GetGlobalAchievementPercentages request failed: {}", e))?;
  if !response.status().is_success() {
    return Err(format!(
      "GetGlobalAchievementPercentages returned HTTP {}",
      response.status()
    ));
  }
  response
    .json::<Value>()
    .map_err(|e| format!("Failed to parse global percentages response: {}", e))
}

#[tauri::command]
pub fn fetch_steam_achievement_schema(
  app_id: u32,
  api_key: String,
  language: Option<String>,
) -> Result<Value, String> {
  let lang = language.unwrap_or_else(|| "english".to_string());
  let url = format!(
    "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid={}&key={}&l={}",
    app_id, api_key, lang
  );
  let client = build_client()?;
  let response = client
    .get(&url)
    .send()
    .map_err(|e| format!("GetSchemaForGame request failed: {}", e))?;
  if !response.status().is_success() {
    return Err(format!(
      "GetSchemaForGame returned HTTP {}",
      response.status()
    ));
  }
  response
    .json::<Value>()
    .map_err(|e| format!("Failed to parse schema response: {}", e))
}

// ---------------------------------------------------------------------------
// Diagnostics log
// ---------------------------------------------------------------------------
fn diag_log(msg: impl std::fmt::Display) {
  eprintln!("[SteamAchievementsLocal] {}", msg);
}

// ---------------------------------------------------------------------------
// Steam root resolution + appcache/stats directory
// ---------------------------------------------------------------------------
fn find_appcache_stats_dir(steam_root: &Path) -> PathBuf {
  steam_root.join("appcache").join("stats")
}

fn resolve_steam_root(steam_path: Option<&str>) -> Result<PathBuf, String> {
  match steam_path {
    Some(p) => {
      let root = PathBuf::from(p);
      if root.is_dir() {
        Ok(root)
      } else {
        Err(format!("Steam root not found: {}", root.display()))
      }
    }
    None => match crate::utils::path_utils::detect_steam_paths() {
      Some(paths) => {
        let root = PathBuf::from(paths.steam_root);
        diag_log(format!("Auto-detected Steam root: {}", root.display()));
        Ok(root)
      }
      None => Err("Steam path not provided and auto-detection failed".to_string()),
    },
  }
}

// ---------------------------------------------------------------------------
// Protobuf wire format helpers
// ---------------------------------------------------------------------------

/// Try to read a varint from the data at position pos.
/// Returns (value, new_pos) or None if it fails.
fn read_varint(data: &[u8], pos: usize) -> Option<(u64, usize)> {
  let mut value: u64 = 0;
  let mut shift = 0;
  let mut p = pos;
  loop {
    if p >= data.len() {
      return None;
    }
    let byte = data[p];
    value |= ((byte & 0x7F) as u64) << shift;
    p += 1;
    if byte & 0x80 == 0 {
      return Some((value, p));
    }
    shift += 7;
    if shift > 63 {
      return None;
    }
  }
}

fn wire_type(tag: u64) -> u64 {
  tag & 0x07
}

fn field_number(tag: u64) -> u64 {
  tag >> 3
}

/// Skip a proto field value at position pos given the wire type.
/// Returns new position after the field.
fn skip_field(data: &[u8], pos: usize, wt: u64) -> Option<usize> {
  match wt {
    0 => {
      // varint
      let (_, p) = read_varint(data, pos)?;
      Some(p)
    }
    1 => {
      // 64-bit
      if pos + 8 > data.len() {
        return None;
      }
      Some(pos + 8)
    }
    2 => {
      // length-delimited
      let (len, p) = read_varint(data, pos)?;
      let end = p + len as usize;
      if end > data.len() {
        return None;
      }
      Some(end)
    }
    5 => {
      // 32-bit
      if pos + 4 > data.len() {
        return None;
      }
      Some(pos + 4)
    }
    _ => None,
  }
}

// ---------------------------------------------------------------------------
// Proto-based parser for UserGameStats_*.bin
// ---------------------------------------------------------------------------

/// Parse a protobuf sub-message looking for achievement-like fields.
struct ParsedSubMessage {
  raw: Vec<u8>,
}

/// Scan the full data for all embedded length-delimited sub-messages (wire type 2).
/// Returns the raw bytes of each found sub-message.
fn collect_sub_messages(data: &[u8]) -> Vec<ParsedSubMessage> {
  let mut msgs = Vec::new();
  let mut pos = 0;
  while pos < data.len() {
    let (tag, p) = match read_varint(data, pos) {
      Some(t) => t,
      None => break,
    };
    pos = p;
    let wt = wire_type(tag);
    if wt == 2 {
      // Length-delimited: could be an embedded sub-message
      let (len, p) = match read_varint(data, pos) {
        Some(l) => l,
        None => break,
      };
      pos = p;
      let end = pos + len as usize;
      if end > data.len() {
        break;
      }
      msgs.push(ParsedSubMessage {
        raw: data[pos..end].to_vec(),
      });
      pos = end;
    } else {
      pos = match skip_field(data, pos, wt) {
        Some(p) => p,
        None => break,
      };
    }
  }
  msgs
}

/// Extract strings (consecutive ASCII printable bytes) from byte slice.
fn extract_strings_from_slice(slice: &[u8], min_len: usize) -> Vec<String> {
  let mut strings = Vec::new();
  let mut current = Vec::new();
  for &b in slice {
    if b.is_ascii_graphic() || b == b' ' || b == b'_' || b == b'-' || b == b':' {
      current.push(b);
    } else {
      if current.len() >= min_len {
        if let Ok(s) = String::from_utf8(current.clone()) {
          strings.push(s);
        }
      }
      current.clear();
    }
  }
  if current.len() >= min_len {
    if let Ok(s) = String::from_utf8(current) {
      strings.push(s);
    }
  }
  strings
}

/// Check if a string looks like a Steam achievement API name.
fn is_achievement_name(s: &str) -> bool {
  let trimmed = s.trim();
  trimmed.starts_with("ACH_")
    || trimmed.starts_with("ach_")
    || trimmed.starts_with("ACHIEVEMENT_")
    || trimmed.starts_with("achievement_")
    || (trimmed.contains('_') && trimmed.chars().filter(|&c| c == '_').count() >= 2 && trimmed.len() >= 6)
}

/// Parse a sub-message as an achievement:
/// - Look for a string field (API name)
/// - Look for a varint 0/1 (achieved)
/// - Look for a larger varint (unlock_time)
fn parse_achievement_from_submsg(data: &[u8]) -> Option<(String, bool, Option<u64>)> {
  let strings = extract_strings_from_slice(data, 4);

  let api_name = strings.iter().find(|s| is_achievement_name(s))?.trim().to_string();

  // Now parse varints from the sub-message to find achieved state and unlock_time
  let mut pos = 0;
  let mut achieved_val: Option<bool> = None;
  let mut unlock_time_val: Option<u64> = None;

  while pos < data.len() {
    let (tag, p) = read_varint(data, pos)?;
    pos = p;
    let wt = wire_type(tag);

    if wt == 0 {
      // Varint field
      let (val, p) = read_varint(data, pos)?;
      pos = p;
      let _fn_num = field_number(tag);

      // Steam proto: field 3 = achieved (0/1), field 4 = unlock_time
      // But we don't know exact schema, so use heuristics:
      // - If val is 0 or 1 and we don't have achieved yet, it's likely achieved
      // - If val > 1 and < 2^32, it's likely a timestamp
      if achieved_val.is_none() && (val == 0 || val == 1) {
        achieved_val = Some(val == 1);
      } else if val > 100_000_000 && val < 4_000_000_000 {
        unlock_time_val = Some(val);
      }
    } else {
      pos = match skip_field(data, pos, wt) {
        Some(p) => p,
        None => break,
      };
    }
  }

  Some((api_name, achieved_val.unwrap_or(false), unlock_time_val))
}

/// Parse the full stats file binary using protobuf wire format.
fn try_parse_stats_proto(data: &[u8]) -> Result<Vec<SteamAppcacheAchievement>, String> {
  let sub_msgs = collect_sub_messages(data);

  if sub_msgs.is_empty() {
    return Err("No protobuf sub-messages found in stats file".to_string());
  }

  let mut achievements = Vec::new();
  for msg in &sub_msgs {
    if let Some((api_name, unlocked, unlock_time)) = parse_achievement_from_submsg(&msg.raw) {
      if !achievements.iter().any(|a: &SteamAppcacheAchievement| a.api_name == api_name) {
        achievements.push(SteamAppcacheAchievement {
          api_name,
          unlocked,
          unlock_time,
        });
      }
    }
  }

  if achievements.is_empty() {
    return Err("No parseable achievements found in stats file".to_string());
  }

  Ok(achievements)
}

// ---------------------------------------------------------------------------
// Proto-based parser for UserGameStatsSchema_*.bin
// ---------------------------------------------------------------------------

fn parse_schema_from_submsg(data: &[u8]) -> Option<SteamAppcacheSchemaEntry> {
  let strings = extract_strings_from_slice(data, 4);

  let api_name = strings.iter().find(|s| is_achievement_name(s))?.trim().to_string();

  // Look for a display_name: a string that's longer, contains uppercase, not an API name
  let display_name = strings
    .iter()
    .find(|s| {
      let t = s.trim();
      t.len() > api_name.len() || (t.len() >= 3 && t != &api_name && t.chars().any(|c| c.is_ascii_uppercase()) && !t.starts_with("ACH_") && !t.starts_with("ach_"))
    })
    .map(|s| s.trim().to_string());

  Some(SteamAppcacheSchemaEntry {
    api_name,
    display_name,
    description: None,
    icon: None,
    icon_gray: None,
    hidden: None,
  })
}

fn try_parse_schema_proto(data: &[u8]) -> Result<Vec<SteamAppcacheSchemaEntry>, String> {
  let sub_msgs = collect_sub_messages(data);

  if sub_msgs.is_empty() {
    return Err("No protobuf sub-messages found in schema file".to_string());
  }

  let mut entries = Vec::new();
  for msg in &sub_msgs {
    if let Some(entry) = parse_schema_from_submsg(&msg.raw) {
      if !entries.iter().any(|e: &SteamAppcacheSchemaEntry| e.api_name == entry.api_name) {
        entries.push(entry);
      }
    }
  }

  if entries.is_empty() {
    return Err("No parseable schema entries found".to_string());
  }

  Ok(entries)
}

// ---------------------------------------------------------------------------
// Legacy text-based parsers (fallback)
// ---------------------------------------------------------------------------

fn extract_achievement_names_text(data: &[u8]) -> Vec<String> {
  let raw = extract_strings_from_slice(data, 4);
  let mut names = Vec::new();
  for s in raw {
    let t = s.trim().to_string();
    if is_achievement_name(&t) && !names.contains(&t) {
      names.push(t);
    }
  }
  names
}

fn find_subsequence(data: &[u8], needle: &[u8]) -> Option<usize> {
  data.windows(needle.len()).position(|w| w == needle)
}

fn try_parse_stats_fallback(data: &[u8]) -> Result<Vec<SteamAppcacheAchievement>, String> {
  let names = extract_achievement_names_text(data);
  if names.is_empty() {
    return Err("No recognizable achievement names found via text scan".to_string());
  }
  let mut achievements = Vec::new();
  for name in names {
    let name_bytes = name.as_bytes();
    let pos = find_subsequence(data, name_bytes).unwrap_or(0);
    let look_ahead = 64.min(data.len().saturating_sub(pos + name_bytes.len()));
    let tail = &data[pos + name_bytes.len()..pos + name_bytes.len() + look_ahead];
    let unlocked = tail.windows(2).any(|w| w == [0x01, 0x00] || w == [0x01]);
    achievements.push(SteamAppcacheAchievement {
      api_name: name,
      unlocked,
      unlock_time: None,
    });
  }
  Ok(achievements)
}

fn try_parse_schema_fallback(data: &[u8]) -> Result<Vec<SteamAppcacheSchemaEntry>, String> {
  let names = extract_achievement_names_text(data);
  if names.is_empty() {
    return Err("No recognizable schema entries found via text scan".to_string());
  }
  let all_strings = extract_strings_from_slice(data, 3);
  let mut entries = Vec::new();
  for name in &names {
    let display_name = all_strings
      .iter()
      .find(|s| {
        s.len() > name.len()
          && s.contains(name.as_str())
          && s.chars().any(|c| c.is_ascii_uppercase())
      })
      .cloned();
    entries.push(SteamAppcacheSchemaEntry {
      api_name: name.clone(),
      display_name,
      description: None,
      icon: None,
      icon_gray: None,
      hidden: None,
    });
  }
  Ok(entries)
}

// ---------------------------------------------------------------------------
// Read and parse a stats file (try proto first, then fallback)
// ---------------------------------------------------------------------------

fn read_and_parse_stats(path: &Path) -> Result<Vec<SteamAppcacheAchievement>, String> {
  let mut data = Vec::new();
  fs::File::open(path)
    .map_err(|e| format!("Failed to open stats file: {}", e))?
    .read_to_end(&mut data)
    .map_err(|e| format!("Failed to read stats file: {}", e))?;

  if data.is_empty() {
    return Err("Stats file is empty".to_string());
  }

  // Try protobuf-aware parser first
  match try_parse_stats_proto(&data) {
    Ok(achievements) => {
      diag_log(format!("Proto parser succeeded: {} achievements", achievements.len()));
      return Ok(achievements);
    }
    Err(e) => {
      diag_log(format!("Proto parser failed ({}), trying text fallback...", e));
    }
  }

  // Fallback to text-based parser
  let result = try_parse_stats_fallback(&data)?;
  diag_log(format!("Text fallback parser: {} achievements", result.len()));
  Ok(result)
}

fn read_and_parse_schema(path: &Path) -> Result<Vec<SteamAppcacheSchemaEntry>, String> {
  let mut data = Vec::new();
  fs::File::open(path)
    .map_err(|e| format!("Failed to open schema file: {}", e))?
    .read_to_end(&mut data)
    .map_err(|e| format!("Failed to read schema file: {}", e))?;

  if data.is_empty() {
    return Err("Schema file is empty".to_string());
  }

  match try_parse_schema_proto(&data) {
    Ok(entries) => {
      diag_log(format!("Schema proto parser succeeded: {} entries", entries.len()));
      return Ok(entries);
    }
    Err(e) => {
      diag_log(format!("Schema proto parser failed ({}), trying text fallback...", e));
    }
  }

  let result = try_parse_schema_fallback(&data)?;
  diag_log(format!("Schema text fallback: {} entries", result.len()));
  Ok(result)
}

// ---------------------------------------------------------------------------
// scan_steam_appcache_achievements command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn scan_steam_appcache_achievements(
  steam_path: Option<String>,
  steam_account_id: Option<String>,
  app_id: u32,
) -> Result<SteamAppcacheScanResult, String> {
  diag_log(format!("=== scan_steam_appcache_achievements app_id={} account_id={:?} ===", app_id, steam_account_id));

  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let stats_dir = find_appcache_stats_dir(&steam_root);

  if !stats_dir.is_dir() {
    diag_log(format!("Stats directory not found: {}", stats_dir.display()));
    return Ok(SteamAppcacheScanResult {
      stats_file_found: false,
      schema_file_found: false,
      stats_file_size: None,
      schema_file_size: None,
      stats_file_modified: None,
      schema_file_modified: None,
      parsed_achievements: vec![],
      parsed_schema: vec![],
      progress_available: false,
      error_reason: Some("stats-directory-not-found".to_string()),
    });
  }

  let mut result = SteamAppcacheScanResult {
    stats_file_found: false,
    schema_file_found: false,
    stats_file_size: None,
    schema_file_size: None,
    stats_file_modified: None,
    schema_file_modified: None,
    parsed_achievements: vec![],
    parsed_schema: vec![],
    progress_available: false,
    error_reason: None,
  };

  // --- Stats file ---
  if let Some(ref acc_id) = steam_account_id {
    let stats_path = stats_dir.join(format!("UserGameStats_{}_{}.bin", acc_id, app_id));
    if stats_path.is_file() {
      result.stats_file_found = true;
      let meta = fs::metadata(&stats_path).ok();
      result.stats_file_size = meta.as_ref().map(|m| m.len());
      result.stats_file_modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

      diag_log(format!("Stats file FOUND: {} ({} bytes)", stats_path.display(), result.stats_file_size.unwrap_or(0)));

      match read_and_parse_stats(&stats_path) {
        Ok(achievements) => {
          let unlocked_count = achievements.iter().filter(|a| a.unlocked).count();
          result.parsed_achievements = achievements;
          diag_log(format!("Stats file parsed: {} total, {} unlocked", result.parsed_achievements.len(), unlocked_count));
        }
        Err(e) => {
          diag_log(format!("Stats file parse failed: {}", e));
        }
      }
    } else {
      diag_log(format!("Stats file NOT FOUND: {}", stats_path.display()));
    }
  } else {
    // No account_id — discover candidates
    diag_log("No steam_account_id — searching for candidate stats files...");
    if let Ok(entries) = fs::read_dir(&stats_dir) {
      let mut candidates: Vec<(PathBuf, u64)> = entries
        .flatten()
        .filter(|e| {
          e.path()
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with("UserGameStats_") && n.ends_with(&format!("_{}.bin", app_id)))
            .unwrap_or(false)
        })
        .filter_map(|e| {
          let path = e.path();
          let modified = fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
          Some((path, modified))
        })
        .collect();

      candidates.sort_by(|a, b| b.1.cmp(&a.1));

      if let Some((best, mod_time)) = candidates.first() {
        result.stats_file_found = true;
        let meta = fs::metadata(best).ok();
        result.stats_file_size = meta.as_ref().map(|m| m.len());
        result.stats_file_modified = Some(*mod_time);
        diag_log(format!("Best candidate: {} ({} bytes)", best.display(), result.stats_file_size.unwrap_or(0)));

        match read_and_parse_stats(best) {
          Ok(achievements) => {
            let unlocked_count = achievements.iter().filter(|a| a.unlocked).count();
            result.parsed_achievements = achievements;
            diag_log(format!("Candidate stats file parsed: {} total, {} unlocked", result.parsed_achievements.len(), unlocked_count));
          }
          Err(e) => {
            diag_log(format!("Candidate stats file parse failed: {}", e));
          }
        }
      } else {
        diag_log("No candidate stats files found");
      }
    }
  }

  // --- Schema file ---
  let schema_path = stats_dir.join(format!("UserGameStatsSchema_{}.bin", app_id));
  if schema_path.is_file() {
    result.schema_file_found = true;
    let meta = fs::metadata(&schema_path).ok();
    result.schema_file_size = meta.as_ref().map(|m| m.len());
    result.schema_file_modified = meta
      .and_then(|m| m.modified().ok())
      .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
      .map(|d| d.as_secs());
    diag_log(format!("Schema file FOUND: {} ({} bytes)", schema_path.display(), result.schema_file_size.unwrap_or(0)));

    match read_and_parse_schema(&schema_path) {
      Ok(schema) => {
        result.parsed_schema = schema;
        diag_log(format!("Schema file parsed: {} entries", result.parsed_schema.len()));
      }
      Err(e) => {
        diag_log(format!("Schema file parse failed: {}", e));
      }
    }
  } else {
    diag_log(format!("Schema file NOT FOUND: {}", schema_path.display()));
  }

  // Determine progress_available
  result.progress_available = result.parsed_achievements.iter().any(|a| a.unlocked)
    || (result.parsed_achievements.len() > 0
      && result
        .parsed_achievements
        .iter()
        .any(|a| a.unlock_time.is_some()));

  diag_log(format!(
    "=== Scan done: stats={}, schema={}, achievements={}, schema_entries={}, progress={}, error={:?} ===",
    result.stats_file_found,
    result.schema_file_found,
    result.parsed_achievements.len(),
    result.parsed_schema.len(),
    result.progress_available,
    result.error_reason
  ));

  Ok(result)
}

// ---------------------------------------------------------------------------
// LumaForge achievement cache (on disk at app_data/achievements/{appid}/)
// ---------------------------------------------------------------------------

fn get_achievement_cache_dir(app_handle: &AppHandle, app_id: u32) -> Result<PathBuf, String> {
  let app_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;

  let cache_dir = app_dir.join("achievements").join(app_id.to_string());
  fs::create_dir_all(&cache_dir)
    .map_err(|e| format!("Failed to create achievement cache dir: {}", e))?;

  Ok(cache_dir)
}

#[tauri::command]
pub fn write_achievement_cache(app_handle: AppHandle, app_id: u32, data: AppAchievementCache) -> Result<(), String> {
  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;

  diag_log(format!("Writing achievement cache for app_id={} to {:?}", app_id, cache_dir));

  // Write summary.json
  let summary_path = cache_dir.join("summary.json");
  let summary_content =
    serde_json::to_string_pretty(&data.summary).map_err(|e| format!("Failed to serialize summary: {}", e))?;
  fs::write(&summary_path, &summary_content)
    .map_err(|e| format!("Failed to write summary: {}", e))?;

  // Write achievements.json
  let achievements_path = cache_dir.join("achievements.json");
  let achievements_content =
    serde_json::to_string_pretty(&data.achievements).map_err(|e| format!("Failed to serialize achievements: {}", e))?;
  fs::write(&achievements_path, &achievements_content)
    .map_err(|e| format!("Failed to write achievements: {}", e))?;

  // Write achievementpercentages.json
  let pcts_path = cache_dir.join("achievementpercentages.json");
  let pcts_content = serde_json::to_string_pretty(&data.achievement_percentages)
    .map_err(|e| format!("Failed to serialize percentages: {}", e))?;
  fs::write(&pcts_path, &pcts_content).map_err(|e| format!("Failed to write percentages: {}", e))?;

  diag_log(format!("Achievement cache written for app_id={}: {} achievements", app_id, data.achievements.len()));
  Ok(())
}

#[tauri::command]
pub fn read_achievement_cache(app_handle: AppHandle, app_id: u32) -> Result<Option<AppAchievementCache>, String> {
  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;

  let summary_path = cache_dir.join("summary.json");
  let achievements_path = cache_dir.join("achievements.json");
  let pcts_path = cache_dir.join("achievementpercentages.json");

  if !summary_path.exists() || !achievements_path.exists() {
    diag_log(format!("No achievement cache found for app_id={}", app_id));
    return Ok(None);
  }

  let summary: crate::models::steam_appcache_achievements::AppAchievementSummary =
    serde_json::from_str(
      &fs::read_to_string(&summary_path).map_err(|e| format!("Failed to read summary: {}", e))?,
    )
    .map_err(|e| format!("Failed to parse summary: {}", e))?;

  let achievements: Vec<crate::models::steam_appcache_achievements::AppAchievementCacheEntry> =
    serde_json::from_str(
      &fs::read_to_string(&achievements_path)
        .map_err(|e| format!("Failed to read achievements: {}", e))?,
    )
    .map_err(|e| format!("Failed to parse achievements: {}", e))?;

  let pcts: Vec<crate::models::steam_appcache_achievements::AppAchievementPercentagesEntry> =
    if pcts_path.exists() {
      serde_json::from_str(
        &fs::read_to_string(&pcts_path).map_err(|e| format!("Failed to read percentages: {}", e))?,
      )
      .unwrap_or_default()
    } else {
      vec![]
    };

  diag_log(format!(
    "Read achievement cache for app_id={}: {} achievements, progress={}",
    app_id,
    achievements.len(),
    summary.progress_available
  ));

  Ok(Some(AppAchievementCache {
    achievements,
    achievement_percentages: pcts,
    summary,
  }))
}

// ---------------------------------------------------------------------------
// Achievements app schema folder reader
// ---------------------------------------------------------------------------

/// Resolve a locale map to a single string: try english first, then any locale, fallback to api_name.
fn resolve_localized(map: &Option<std::collections::HashMap<String, String>>, _api_name: &str) -> Option<String> {
  let map = map.as_ref()?;
  if let Some(en) = map.get("english") {
    if !en.is_empty() {
      return Some(en.clone());
    }
  }
  map.values().find(|v| !v.is_empty()).cloned()
}

/// Try to read an image file and encode it as a base64 data URL.
/// Returns None if the file doesn't exist, can't be read, or is too large (>1MB).
fn embed_image_as_data_url(path: &Path) -> Option<String> {
  if !path.is_file() {
    diag_log(format!("Icon file not found: {}", path.display()));
    return None;
  }

  let data = fs::read(path).ok()?;

  if data.is_empty() || data.len() > 1_048_576 {
    diag_log(format!("Icon file too large or empty: {} ({} bytes)", path.display(), data.len()));
    return None;
  }

  let mime = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp",
    "svg" => "image/svg+xml",
    "bmp" => "image/bmp",
    "ico" => "image/x-icon",
    _ => {
      diag_log(format!("Unknown icon extension for: {}", path.display()));
      return None;
    }
  };

  let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
  let data_url = format!("data:{};base64,{}", mime, b64);
  diag_log(format!("Embedded icon: {} ({} bytes -> {} chars)", path.display(), data.len(), data_url.len()));
  Some(data_url)
}

#[tauri::command]
pub fn read_achievements_app_schema_folder(path: String, app_id: u32) -> Result<AchievementsAppSchemaResult, String> {
  diag_log(format!("=== read_achievements_app_schema_folder path={} app_id={} ===", path, app_id));

  let schema_dir = PathBuf::from(&path);
  if !schema_dir.is_dir() {
    return Err(format!("Schema folder not found: {}", schema_dir.display()));
  }

  // Read achievements.json
  let achievements_path = schema_dir.join("achievements.json");
  if !achievements_path.is_file() {
    return Err(format!("achievements.json not found in: {}", schema_dir.display()));
  }

  let raw_entries: Vec<AchievementsAppSchemaEntry> = serde_json::from_str(
    &fs::read_to_string(&achievements_path)
      .map_err(|e| format!("Failed to read achievements.json: {}", e))?,
  )
  .map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

  diag_log(format!("Read {} entries from achievements.json", raw_entries.len()));

  // Read achievementpercentages.json (optional)
  let pcts_path = schema_dir.join("achievementpercentages.json");
  let pct_map: std::collections::HashMap<String, f64> = if pcts_path.is_file() {
    match serde_json::from_str::<AchievementsAppPercentagesFile>(
      &fs::read_to_string(&pcts_path).map_err(|e| format!("Failed to read achievementpercentages.json: {}", e))?,
    ) {
      Ok(file) => {
        let map: std::collections::HashMap<_, _> = file
          .achievementpercentages
          .achievements
          .into_iter()
          .map(|e| (e.name, e.percent))
          .collect();
        diag_log(format!("Read {} entries from achievementpercentages.json", map.len()));
        map
      }
      Err(e) => {
        diag_log(format!("Failed to parse achievementpercentages.json (ignoring): {}", e));
        std::collections::HashMap::new()
      }
    }
  } else {
    diag_log("achievementpercentages.json not found, skipping");
    std::collections::HashMap::new()
  };

  // Normalize to AppAchievementCacheEntry with base64-embedded icons
  let achievements: Vec<AppAchievementCacheEntry> = raw_entries
    .into_iter()
    .map(|entry| {
      let name = resolve_localized(&entry.display_name, &entry.name).unwrap_or_else(|| entry.name.clone());
      let description = resolve_localized(&entry.description, &entry.name);

      let icon_url = entry.icon_path.and_then(|p| {
        let full_path = schema_dir.join(&p);
        embed_image_as_data_url(&full_path)
      });
      let icon_gray_url = entry.icon_gray_path.and_then(|p| {
        let full_path = schema_dir.join(&p);
        embed_image_as_data_url(&full_path)
      });

      AppAchievementCacheEntry {
        id: entry.name.clone(),
        api_name: entry.name,
        name,
        description,
        icon_url,
        icon_gray_url,
        unlocked: false,
        unlock_time: None,
        rarity_percent: None,
      }
    })
    .collect();

  // Build percentages
  let achievement_percentages: Vec<AppAchievementPercentagesEntry> = achievements
    .iter()
    .filter_map(|a| {
      pct_map.get(&a.api_name).map(|&pct| AppAchievementPercentagesEntry {
        name: a.api_name.clone(),
        percent: pct,
      })
    })
    .collect();

  diag_log(format!(
    "Normalized {} achievements, {} percentages from app schema",
    achievements.len(),
    achievement_percentages.len()
  ));

  Ok(AchievementsAppSchemaResult {
    achievements,
    achievement_percentages,
  })
}
