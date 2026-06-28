use std::path::{Path, PathBuf};
use std::time::Duration;
use std::{fs, io::Read};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models::steam_appcache_achievements::{
  AchievementsAppSchemaResult, AppAchievementCache, AppAchievementCacheEntry,
  AppAchievementPercentagesEntry, AchievementsAppSchemaEntry, AchievementsAppPercentagesFile,
  SteamAppcacheAchievement, SteamAppcacheParsedProgress, SteamAppcacheScanResult, SteamAppcacheSchemaEntry,
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

/// Extract (stat_id, value) pairs from a stats file sub-message using known proto field numbers.
/// StatValue message: field 1 (tag=8, varint) = stat_id, field 2 (tag=16, varint) = value.
fn parse_stat_value_from_submsg(data: &[u8]) -> Option<(u32, u32)> {
  let mut pos = 0;
  let mut stat_id: Option<u32> = None;
  let mut value: Option<u32> = None;

  while pos < data.len() {
    let (tag, p) = read_varint(data, pos)?;
    pos = p;
    let fn_num = field_number(tag);
    let wt = wire_type(tag);

    if wt == 0 {
      let (val, p) = read_varint(data, pos)?;
      pos = p;
      if fn_num == 1 {
        stat_id = Some(val as u32);
      } else if fn_num == 2 {
        value = Some(val as u32);
      }
    } else {
      pos = skip_field(data, pos, wt)?;
    }
  }

  match (stat_id, value) {
    (Some(sid), Some(v)) => Some((sid, v)),
    _ => None,
  }
}

/// Parse the full stats file binary looking for (stat_id, value) pairs.
/// Returns a map of stat_id → value and a confidence indicator.
fn try_parse_stats_proto_v2(data: &[u8]) -> Result<(Vec<(u32, u32)>, usize), String> {
  let sub_msgs = collect_sub_messages(data);

  if sub_msgs.is_empty() {
    return Err("No protobuf sub-messages found in stats file".to_string());
  }

  let mut pairs: Vec<(u32, u32)> = Vec::new();
  for msg in &sub_msgs {
    if let Some((stat_id, value)) = parse_stat_value_from_submsg(&msg.raw) {
      if !pairs.iter().any(|(sid, _)| *sid == stat_id) {
        pairs.push((stat_id, value));
      }
    }
  }

  if pairs.is_empty() {
    return Err("No stat_id-value pairs found in stats file".to_string());
  }

  let unique_count = pairs.len();
  diag_log(format!("Stats proto v2 parsed {} unique stat_id-value pairs", unique_count));
  Ok((pairs, unique_count))
}

/// Build matched progress from schema entries and stats stat_id→value map.
/// Uses bitfield matching when schema entry has `bit`, otherwise checks value directly.
fn match_progress_from_pairs(
  schema: &[SteamAppcacheSchemaEntry],
  pairs: &[(u32, u32)],
) -> (Vec<SteamAppcacheParsedProgress>, u32, u32) {
  let mut progress = Vec::new();
  let mut matched = 0u32;
  let mut total_with_ids = 0u32;

  for entry in schema {
    let sid = match entry.stat_id {
      Some(s) => s,
      None => continue,
    };
    total_with_ids += 1;

    // Find matching stat value
    if let Some((_, value)) = pairs.iter().find(|(sid2, _)| *sid2 == sid) {
      matched += 1;
      let unlocked = match entry.bit {
        Some(b) => (value & (1u32 << b)) != 0,
        None => *value != 0,
      };
      progress.push(SteamAppcacheParsedProgress {
        api_name: entry.api_name.clone(),
        unlocked,
        stat_id: sid,
        value: *value,
      });
    }
  }

  (progress, matched, total_with_ids)
}

/// Determine parser confidence level based on matching results.
fn determine_confidence(total_with_ids: u32, matched: u32, pairs_count: usize) -> String {
  if total_with_ids == 0 && pairs_count > 0 {
    // We found stat values but no schema entries have stat_ids (schema didn't parse them)
    "low".to_string()
  } else if total_with_ids == 0 {
    "none".to_string()
  } else if matched >= total_with_ids {
    "high".to_string()
  } else if matched >= total_with_ids / 2 {
    "medium".to_string()
  } else if matched > 0 {
    "low".to_string()
  } else {
    "none".to_string()
  }
}

// ---------------------------------------------------------------------------
// Binary inspection utilities
// ---------------------------------------------------------------------------

/// Format bytes as hex preview (first N bytes, truncated for display).
#[allow(dead_code)]
fn hex_preview(data: &[u8], max_len: usize) -> String {
  let preview = if data.len() > max_len { &data[..max_len] } else { data };
  let hex: Vec<String> = preview.iter().map(|b| format!("{:02x}", b)).collect();
  hex.join(" ")
}

/// Safe read a little-endian u32 from a slice, returning None if out of bounds.
#[allow(dead_code)]
fn read_le_u32(data: &[u8], pos: usize) -> Option<u32> {
  if pos + 4 > data.len() {
    return None;
  }
  Some(u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]))
}

/// Safe read a little-endian i32 from a slice, returning None if out of bounds.
#[allow(dead_code)]
fn read_le_i32(data: &[u8], pos: usize) -> Option<i32> {
  if pos + 4 > data.len() {
    return None;
  }
  Some(i32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]))
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

  // Reject entries where display_name is a localization token
  if display_name.as_deref().map_or(true, |d| !is_valid_display_name(d)) {
    diag_log(format!("Proto parser skipped token-only schema entry: api_name={}, display_name={:?}", api_name, display_name));
    return None;
  }

  // Extract stat_id (field 10 ≈ tag 80, varint) and bit (field 11 ≈ tag 88, varint)
  let mut stat_id: Option<u32> = None;
  let mut bit: Option<u32> = None;
  let mut pos = 0;
  while pos < data.len() {
    let (tag, p) = match read_varint(data, pos) {
      Some(t) => t,
      None => break,
    };
    pos = p;
    let fn_num = field_number(tag);
    let wt = wire_type(tag);
    if wt == 0 {
      // Varint field
      let (val, p) = match read_varint(data, pos) {
        Some(v) => v,
        None => break,
      };
      pos = p;
      // Field 10 = stat_id (known proto field)
      if fn_num == 10 && val <= 500 {
        stat_id = Some(val as u32);
      }
      // Field 11 = bit index (known proto field)
      if fn_num == 11 && val <= 63 {
        bit = Some(val as u32);
      }
    } else {
      pos = match skip_field(data, pos, wt) {
        Some(p) => p,
        None => break,
      };
    }
  }

  if stat_id.is_some() || bit.is_some() {
    diag_log(format!("Schema entry: api_name={}, stat_id={:?}, bit={:?}", api_name, stat_id, bit));
  }

  Some(SteamAppcacheSchemaEntry {
    api_name,
    display_name,
    description: None,
    icon: None,
    icon_gray: None,
    hidden: None,
    stat_id,
    bit,
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
// Token detection for schema quality gate
// ---------------------------------------------------------------------------

/// Check if a string looks like an internal localization token rather than
/// a user-facing achievement name.
/// Examples: NEW_ACHIEVEMENT_1_0_NAME, NEW_ACHIEVEMENT_1_0_DESC,
///           ACHIEVEMENT_1_0_NAME, ACH_1_NAME
fn is_probably_localization_token(s: &str) -> bool {
  let trimmed = s.trim();
  if trimmed.is_empty() {
    return true;
  }
  // Starts with NEW_ACHIEVEMENT
  if trimmed.starts_with("NEW_ACHIEVEMENT") {
    return true;
  }
  // Contains _NAME or _DESC suffix
  if trimmed.ends_with("_NAME") || trimmed.ends_with("_DESC") || trimmed.ends_with("_DESCRIPTION") {
    return true;
  }
  // All uppercase + underscores + digits (no lowercase) -> token
  if trimmed.chars().all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit()) && trimmed.contains('_') {
    return true;
  }
  // No lowercase letters at all and has underscores -> likely token
  if !trimmed.chars().any(|c| c.is_ascii_lowercase()) && trimmed.contains('_') {
    return true;
  }
  false
}

/// Check if a display name is a valid human-readable name (not a token).
fn is_valid_display_name(s: &str) -> bool {
  let trimmed = s.trim();
  if trimmed.is_empty() {
    return false;
  }
  if is_probably_localization_token(trimmed) {
    return false;
  }
  // Must have at least one letter
  if !trimmed.chars().any(|c| c.is_alphabetic()) {
    return false;
  }
  // Must have at least some variety (not just "ACH_123")
  if trimmed.len() < 3 {
    return false;
  }
  true
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

    // Apply quality gate: skip entries with token-only display names
    let clean_name = display_name.as_deref().filter(|d| is_valid_display_name(d));
    if clean_name.is_none() {
      diag_log(format!("Skipping token-only schema entry: api_name={}, display_name={:?}", name, display_name));
      continue;
    }

    entries.push(SteamAppcacheSchemaEntry {
      api_name: name.clone(),
      display_name: clean_name.map(|s| s.to_string()),
      description: None,
      icon: None,
      icon_gray: None,
      hidden: None,
      stat_id: None,
      bit: None,
    });
  }

  // Quality gate: require at least some entries passed the filter
  if entries.is_empty() {
    return Err("All schema entries were rejected (token-only)".to_string());
  }

  // Warn if most entries were rejected
  if entries.len() < names.len() / 2 {
    diag_log(format!("Quality gate: {}/{} schema entries passed (many rejected as tokens)", entries.len(), names.len()));
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
      parsed_progress: vec![],
      parser_confidence: "none".to_string(),
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
    parsed_progress: vec![],
    parser_confidence: "none".to_string(),
    progress_available: false,
    error_reason: None,
  };

  // Track the stats file path for v2 binary progress parsing
  let mut stats_path_used: Option<PathBuf> = None;

  // --- Stats file ---
  if let Some(ref acc_id) = steam_account_id {
    let stats_path_candidate = stats_dir.join(format!("UserGameStats_{}_{}.bin", acc_id, app_id));
    if stats_path_candidate.is_file() {
      result.stats_file_found = true;
      stats_path_used = Some(stats_path_candidate.clone());
      let meta = fs::metadata(&stats_path_candidate).ok();
      result.stats_file_size = meta.as_ref().map(|m| m.len());
      result.stats_file_modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

      diag_log(format!("Stats file FOUND: {} ({} bytes)", stats_path_candidate.display(), result.stats_file_size.unwrap_or(0)));

      match read_and_parse_stats(&stats_path_candidate) {
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
      diag_log(format!("Stats file NOT FOUND: no candidate for account_id"));
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
        stats_path_used = Some(best.clone());
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

  // --- v2 binary progress parser: match schema stat_id→bit against stats values ---
  if result.parsed_schema.iter().any(|e| e.stat_id.is_some()) {
    if let Some(ref stats_path) = stats_path_used {
      match fs::read(stats_path) {
        Ok(raw_data) => {
          diag_log(format!("Running v2 stats parser on {} ({} bytes)", stats_path.display(), raw_data.len()));
          match try_parse_stats_proto_v2(&raw_data) {
            Ok((pairs, count)) => {
              let (matched_progress, matched, total_with_ids) = match_progress_from_pairs(&result.parsed_schema, &pairs);
              let confidence = determine_confidence(total_with_ids, matched, count);
              result.parsed_progress = matched_progress;
              result.parser_confidence = confidence.clone();
              diag_log(format!(
                "v2 parser: {} pairs, {} schema with ids, {} matched, confidence={}",
                count, total_with_ids, matched, confidence
              ));
              // If confidence is medium or high, use v2 progress
              if (confidence == "high" || confidence == "medium") && !result.parsed_progress.is_empty() {
                result.progress_available = true;
                diag_log("v2 parser achieved confidence >= medium — marking progress_available");
              }
            }
            Err(e) => {
              diag_log(format!("v2 stats parser failed: {}", e));
            }
          }
        }
        Err(e) => {
          diag_log(format!("Failed to re-read stats file for v2 parser: {}", e));
        }
      }
    }
  } else {
    diag_log("No schema entries with stat_id found — v2 parser not applicable");
  }

  // Fallback: if v2 didn't set progress, check v1 results
  if !result.progress_available {
    result.progress_available = result.parsed_achievements.iter().any(|a| a.unlocked)
      || (result.parsed_achievements.len() > 0
        && result
          .parsed_achievements
          .iter()
          .any(|a| a.unlock_time.is_some()));
  }

  diag_log(format!(
    "=== Scan done: stats={}, schema={}, achievements={}, schema_entries={}, progress={}, parsed_progress={}, confidence={}, error={:?} ===",
    result.stats_file_found,
    result.schema_file_found,
    result.parsed_achievements.len(),
    result.parsed_schema.len(),
    result.progress_available,
    result.parsed_progress.len(),
    result.parser_confidence,
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
  let mut summary = data.summary;
  summary.cache_version = Some(6);
  let summary_path = cache_dir.join("summary.json");
  let summary_content =
    serde_json::to_string_pretty(&summary).map_err(|e| format!("Failed to serialize summary: {}", e))?;
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
    return Err(format!("[AchievementsSchema] Schema folder not found: {}", schema_dir.display()));
  }

  // Support two layouts:
  // 1. Direct: {path}/achievements.json
  // 2. App subdir: {path}/{app_id}/achievements.json
  let base_dir: PathBuf;
  let achievements_path = if schema_dir.join("achievements.json").is_file() {
    base_dir = schema_dir.clone();
    schema_dir.join("achievements.json")
  } else {
    let sub_dir = schema_dir.join(app_id.to_string());
    let sub_path = sub_dir.join("achievements.json");
    if sub_path.is_file() {
      base_dir = sub_dir.clone();
      diag_log(format!("[AchievementsSchema] Found in app subdirectory: {}", sub_path.display()));
      sub_path
    } else {
      return Err(format!("[AchievementsSchema] achievements.json not found in {} or {}", schema_dir.display(), sub_dir.display()));
    }
  };

  diag_log(format!("[AchievementsSchema] Reading achievements from: {}", achievements_path.display()));

  let raw_entries: Vec<AchievementsAppSchemaEntry> = serde_json::from_str(
    &fs::read_to_string(&achievements_path)
      .map_err(|e| format!("Failed to read achievements.json: {}", e))?,
  )
  .map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

  diag_log(format!("[AchievementsSchema] Parsed {} entries", raw_entries.len()));

  // Read achievementpercentages.json (optional) from same base_dir
  let pcts_path = base_dir.join("achievementpercentages.json");
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
        let full_path = base_dir.join(&p);
        embed_image_as_data_url(&full_path)
      });
      let icon_gray_url = entry.icon_gray_path.and_then(|p| {
        let full_path = base_dir.join(&p);
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
    "[AchievementsSchema] Normalized {} achievements, {} percentages, {} icons embedded",
    achievements.len(),
    achievement_percentages.len(),
    achievements.iter().filter(|a| a.icon_url.is_some() || a.icon_gray_url.is_some()).count(),
  ));

  Ok(AchievementsAppSchemaResult {
    achievements,
    achievement_percentages,
  })
}
