use std::path::{Path, PathBuf};
use std::time::Duration;
use std::{fs, io::Read};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models::steam_appcache_achievements::{
  AchievementImageStatus, AchievementsAppSchemaEntry, AchievementsAppPercentagesFile,
  AchievementsAppSchemaResult, AppAchievementCache, AppAchievementCacheEntry,
  AppAchievementPercentagesEntry, DebugAchievementReport, DebugFileInfo, DebugKvNode,
  DebugMatchResult, LibraryCacheProgress,
  LibraryCacheValue, LocaleValue, OrphanCleanupResult, StatPair, SteamAppcacheAchievement,
  SteamAppcacheParsedProgress, SteamAppcacheScanResult, SteamAppcacheSchemaEntry,
  UserGameStatsRawResult,
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
  eprintln!("[ACH] {}", msg);
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
    eprintln!("[ACH][SCHEMA] skipped token-only entry: api_name={}", api_name);
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
    eprintln!("[ACH][SCHEMA] entry: api_name={}, stat_id={:?}, bit={:?}", api_name, stat_id, bit);
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
      eprintln!("[ACH][SCHEMA] skipping token-only: api_name={}", name);
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
    eprintln!("[ACH][SCHEMA] quality gate: {}/{} passed (many rejected as tokens)", entries.len(), names.len());
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
      eprintln!("[ACH][PROGRESS] proto parser: {} achievements", achievements.len());
      return Ok(achievements);
    }
    Err(e) => {
      eprintln!("[ACH][PROGRESS] proto parser failed, trying text fallback: {}", e);
    }
  }

  // Fallback to text-based parser
  let result = try_parse_stats_fallback(&data)?;
  eprintln!("[ACH][PROGRESS] text fallback: {} achievements", result.len());
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
      eprintln!("[ACH][SCHEMA] proto parser: {} entries", entries.len());
      return Ok(entries);
    }
    Err(e) => {
      eprintln!("[ACH][SCHEMA] proto parser failed, trying text fallback: {}", e);
    }
  }

  let result = try_parse_schema_fallback(&data)?;
  eprintln!("[ACH][SCHEMA] text fallback: {} entries", result.len());
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
  eprintln!("[ACH][SCHEMA] === scan app_id={} account_id={:?} ===", app_id, steam_account_id);

  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let stats_dir = find_appcache_stats_dir(&steam_root);

  if !stats_dir.is_dir() {
    eprintln!("[ACH][SCHEMA] stats dir not found: {}", stats_dir.display());
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
// parse_user_game_stats_raw — read raw stat values + achievement entries
// from UserGameStats_<accountId>_<appId>.bin without requiring a schema file.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn parse_user_game_stats_raw(
  steam_path: Option<String>,
  steam_account_id: String,
  app_id: u32,
) -> Result<UserGameStatsRawResult, String> {
  diag_log(format!("=== parse_user_game_stats_raw app_id={} account_id={} ===", app_id, steam_account_id));

  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let stats_dir = find_appcache_stats_dir(&steam_root);

  if !stats_dir.is_dir() {
    diag_log(format!("Stats directory not found: {}", stats_dir.display()));
    return Ok(UserGameStatsRawResult {
      file_found: false,
      file_size: None,
      stat_pairs: vec![],
      achievement_entries: vec![],
      error_reason: Some("stats-directory-not-found".to_string()),
    });
  }

  let stats_path = stats_dir.join(format!("UserGameStats_{}_{}.bin", steam_account_id, app_id));
  if !stats_path.is_file() {
    diag_log(format!("Stats file NOT FOUND: {}", stats_path.display()));
    return Ok(UserGameStatsRawResult {
      file_found: false,
      file_size: None,
      stat_pairs: vec![],
      achievement_entries: vec![],
      error_reason: Some("file-not-found".to_string()),
    });
  }

  let mut data = Vec::new();
  fs::File::open(&stats_path)
    .map_err(|e| format!("Failed to open stats file: {}", e))?
    .read_to_end(&mut data)
    .map_err(|e| format!("Failed to read stats file: {}", e))?;

  let file_size = data.len() as u64;
  diag_log(format!("Stats file FOUND: {} ({} bytes)", stats_path.display(), file_size));

  let mut stat_pairs: Vec<StatPair> = Vec::new();
  let mut achievement_entries: Vec<SteamAppcacheAchievement> = Vec::new();

  // Try v2 parser for (stat_id, value) pairs
  match try_parse_stats_proto_v2(&data) {
    Ok((pairs, _count)) => {
      stat_pairs = pairs
        .into_iter()
        .map(|(stat_id, value)| StatPair { stat_id, value })
        .collect();
      diag_log(format!("v2 parser extracted {} stat pairs", stat_pairs.len()));
    }
    Err(e) => {
      diag_log(format!("v2 parser failed: {}", e));
    }
  }

  // Try v1 parser for achievement entries with unlock_time
  match try_parse_stats_proto(&data) {
    Ok(achievements) => {
      achievement_entries = achievements;
      diag_log(format!("v1 parser extracted {} achievement entries", achievement_entries.len()));
    }
    Err(e) => {
      diag_log(format!("v1 parser failed: {}", e));
    }
  }

  eprintln!("[ACH][PROGRESS] appid={} statsFileFound=true size={}", app_id, file_size);
  eprintln!("[ACH][PROGRESS] parsedStats={} achievementEntries={}", stat_pairs.len(), achievement_entries.len());

  Ok(UserGameStatsRawResult {
    file_found: true,
    file_size: Some(file_size),
    stat_pairs,
    achievement_entries,
    error_reason: None,
  })
}

// ---------------------------------------------------------------------------
// debug_achievement_progress — deep diagnostic of achievement progress data
// from Steam appcache/stats files. Returns raw hex, KV tree, stat pairs,
// achievement times, per-achievement statId/bit matching, and full JSON report.
// ---------------------------------------------------------------------------

/// Build a KV tree view of the proto wire format (field_number → wire_type → value).
fn build_kv_tree(data: &[u8]) -> Vec<DebugKvNode> {
  let mut nodes = Vec::new();
  let mut pos = 0;
  while pos < data.len() {
    let start = pos;
    let (tag, p) = match read_varint(data, pos) {
      Some(t) => t,
      None => break,
    };
    pos = p;
    let fn_num = field_number(tag);
    let wt = wire_type(tag);
    let wt_name = match wt {
      0 => "varint",
      1 => "64-bit",
      2 => "length-delim",
      5 => "32-bit",
      _ => "unknown",
    };

    let (value_preview, consumed): (String, usize) = match wt {
      0 => {
        if let Some((val, p)) = read_varint(data, pos) {
          let preview = if val > 100_000_000 {
            // Likely a timestamp
            format!("{} (timestamp?)", val)
          } else {
            val.to_string()
          };
          (preview, p - pos)
        } else {
          ("?varint".to_string(), 0)
        }
      }
      1 => {
        if pos + 8 <= data.len() {
          let val = u64::from_le_bytes([
            data[pos], data[pos + 1], data[pos + 2], data[pos + 3],
            data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7],
          ]);
          (format!("0x{:016x}", val), 8)
        } else {
          ("?64bit".to_string(), 0)
        }
      }
      2 => {
        if let Some((len, p)) = read_varint(data, pos) {
          let end = p + len as usize;
          if end <= data.len() {
            let content = &data[p..end];
            // Try to show as ASCII if printable
            if content.iter().all(|&b| b.is_ascii_graphic() || b == b' ') && !content.is_empty() {
              (format!("\"{}\"", String::from_utf8_lossy(content)), (end - start))
            } else {
              (format!("<{} bytes: {:02x}{}>", len, content.first().unwrap_or(&0), if len > 4 { ".." } else { "" }), (end - start))
            }
          } else {
            (format!("<len={} exceeds data>", len), 0)
          }
        } else {
          ("?delimited".to_string(), 0)
        }
      }
      5 => {
        if pos + 4 <= data.len() {
          let val = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]);
          (format!("0x{:08x} ({})", val, val), 4)
        } else {
          ("?32bit".to_string(), 0)
        }
      }
      _ => ("?wire".to_string(), 0),
    };

    let total_consumed = if consumed == 0 { pos - start } else { start + (pos - start) + consumed - start };
    nodes.push(DebugKvNode {
      field_number: fn_num,
      wire_type: wt,
      wire_type_name: wt_name.to_string(),
      value_preview,
      offset: start,
      length: total_consumed,
    });

    // Advance past the field value
    if consumed > 0 {
      pos = start + (pos - start) + consumed;
    } else {
      pos = match skip_field(data, pos, wt) {
        Some(p) => p,
        None => break,
      };
    }

    if pos >= data.len() {
      break;
    }
  }
  nodes
}

/// Extract stat pairs from raw data for debug display.
fn extract_stat_pairs_for_debug(data: &[u8]) -> Vec<StatPair> {
  let sub_msgs = collect_sub_messages(data);
  let mut seen = std::collections::HashSet::new();
  let mut pairs = Vec::new();
  for msg in &sub_msgs {
    if let Some((stat_id, value)) = parse_stat_value_from_submsg(&msg.raw) {
      if seen.insert(stat_id) {
        pairs.push(StatPair { stat_id, value });
      }
    }
  }
  pairs
}

// ---------------------------------------------------------------------------
// parse_librarycache_achievements — read progress from Steam librarycache JSON
// at <steamRoot>/userdata/<accountId>/config/librarycache/<appid>.json
// ---------------------------------------------------------------------------

/// Parse a librarycache JSON file and extract achievement progress.
fn parse_librarycache_data(value: &LibraryCacheValue) -> LibraryCacheProgress {
  let mut entries = Vec::new();
  let mut n_total = None;
  let mut n_achieved = None;
  let mut progress_available = false;

  if let Some(ref data) = value.data {
    n_total = data.n_total;
    n_achieved = data.n_achieved;

    // Collect all entries
    for ach in &data.vec_highlight {
      entries.push(ach.clone());
    }
    for ach in &data.vec_achieved_hidden {
      entries.push(ach.clone());
    }
    for ach in &data.vec_unachieved {
      entries.push(ach.clone());
    }

    progress_available = data.n_total.unwrap_or(0) > 0;
  }

  LibraryCacheProgress {
    file_found: true,
    file_path: String::new(),
    file_size: None,
    n_total,
    n_achieved,
    progress_available,
    entries,
    error_reason: None,
  }
}

#[tauri::command]
pub fn parse_librarycache_achievements(
  steam_path: Option<String>,
  steam_account_id: String,
  app_id: u32,
) -> Result<LibraryCacheProgress, String> {
  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let lib_path = steam_root.join("userdata").join(&steam_account_id).join("config").join("librarycache").join(format!("{}.json", app_id));
  let path_str = lib_path.to_string_lossy().to_string();

  eprintln!("[ACH][LIBRARYCACHE] path={}", path_str);

  if !lib_path.is_file() {
    eprintln!("[ACH][LIBRARYCACHE] exists=false");
    return Ok(LibraryCacheProgress {
      file_found: false,
      file_path: path_str,
      file_size: None,
      n_total: None,
      n_achieved: None,
      progress_available: false,
      entries: vec![],
      error_reason: Some("file-not-found".to_string()),
    });
  }

  let meta = match fs::metadata(&lib_path) {
    Ok(m) => m,
    Err(e) => {
      return Ok(LibraryCacheProgress {
        file_found: false,
        file_path: path_str,
        file_size: None,
        n_total: None,
        n_achieved: None,
        progress_available: false,
        entries: vec![],
        error_reason: Some(format!("metadata-error: {}", e)),
      });
    }
  };

  let file_size = Some(meta.len());
  eprintln!("[ACH][LIBRARYCACHE] exists=true size={}", meta.len());

  let raw = match fs::read_to_string(&lib_path) {
    Ok(s) => s,
    Err(e) => {
      return Ok(LibraryCacheProgress {
        file_found: true,
        file_path: path_str,
        file_size,
        n_total: None,
        n_achieved: None,
        progress_available: false,
        entries: vec![],
        error_reason: Some(format!("read-error: {}", e)),
      });
    }
  };

  // The file is an array of [$key, $value] pairs; find the "achievements" entry
  let root: Vec<serde_json::Value> = match serde_json::from_str(&raw) {
    Ok(v) => v,
    Err(e) => {
      return Ok(LibraryCacheProgress {
        file_found: true,
        file_path: path_str,
        file_size,
        n_total: None,
        n_achieved: None,
        progress_available: false,
        entries: vec![],
        error_reason: Some(format!("parse-error: {}", e)),
      });
    }
  };

  for entry in &root {
    if let Some(arr) = entry.as_array() {
      if arr.len() >= 2 {
        if let Some(key) = arr[0].as_str() {
          if key == "achievements" {
            let value: LibraryCacheValue = match serde_json::from_value(arr[1].clone()) {
              Ok(v) => v,
              Err(e) => {
                return Ok(LibraryCacheProgress {
                  file_found: true,
                  file_path: path_str,
                  file_size,
                  n_total: None,
                  n_achieved: None,
                  progress_available: false,
                  entries: vec![],
                  error_reason: Some(format!("value-parse-error: {}", e)),
                });
              }
            };
            let mut result = parse_librarycache_data(&value);
            result.file_path = path_str;
            result.file_size = file_size;

            eprintln!("[ACH][LIBRARYCACHE] appid={} found=true", app_id);
            eprintln!("[ACH][LIBRARYCACHE] nTotal={:?}", result.n_total);
            eprintln!("[ACH][LIBRARYCACHE] nAchieved={:?}", result.n_achieved);
            eprintln!("[ACH][LIBRARYCACHE] progressEntries={}", result.entries.len());
            eprintln!("[ACH][LIBRARYCACHE] progressAvailable={}", result.progress_available);

            // Log first 10 entries
            for ach in result.entries.iter().take(10) {
              eprintln!(
                "[ACH][LIBRARYCACHE_ENTRY] apiName={:?} name={:?} achieved={:?} unlockTime={:?} rarity={:?}",
                ach.str_id, ach.str_name, ach.b_achieved, ach.rt_unlocked, ach.fl_achieved,
              );
            }

            if let Some(ref data) = value.data {
              eprintln!("[ACH][LIBRARYCACHE] vecHighlight={}", data.vec_highlight.len());
              eprintln!("[ACH][LIBRARYCACHE] vecAchievedHidden={}", data.vec_achieved_hidden.len());
              eprintln!("[ACH][LIBRARYCACHE] vecUnachieved={}", data.vec_unachieved.len());
            }

            return Ok(result);
          }
        }
      }
    }
  }

  Ok(LibraryCacheProgress {
    file_found: true,
    file_path: path_str,
    file_size,
    n_total: None,
    n_achieved: None,
    progress_available: false,
    entries: vec![],
    error_reason: Some("no-achievements-key-found".to_string()),
  })
}

#[tauri::command]
pub fn debug_achievement_progress(
  steam_path: Option<String>,
  steam_account_id: String,
  app_id: u32,
  achievement_schema_path: Option<String>,
) -> Result<DebugAchievementReport, String> {
  eprintln!("[ACH][DEBUG_REPORT] === debug_achievement_progress app_id={} ===", app_id);

  let steam_root = match resolve_steam_root(steam_path.as_deref()) {
    Ok(r) => r,
    Err(e) => {
      return Ok(DebugAchievementReport {
        stats_file: DebugFileInfo { found: false, path: e.clone(), size: None, modified: None, hex_preview: String::new(), hex_preview_len: 0 },
        schema_file: DebugFileInfo { found: false, path: String::new(), size: None, modified: None, hex_preview: String::new(), hex_preview_len: 0 },
        stats_kv_tree: vec![], schema_kv_tree: vec![],
        stat_pairs: vec![], achievement_entries: vec![], schema_entries: vec![],
        app_schema: None, library_cache: None, match_results: vec![], v1_match_results: vec![],
        error_reason: Some(format!("Steam root not found: {}", e)),
      });
    }
  };

  let stats_dir = find_appcache_stats_dir(&steam_root);
  let stats_path = stats_dir.join(format!("UserGameStats_{}_{}.bin", steam_account_id, app_id));
  let schema_path = stats_dir.join(format!("UserGameStatsSchema_{}.bin", app_id));

  // --- Stats file ---
  let (stats_file_info, stats_kv_tree, stat_pairs, achievement_entries) = {
    let mut info = DebugFileInfo {
      found: stats_path.is_file(),
      path: stats_path.to_string_lossy().to_string(),
      size: None, modified: None,
      hex_preview: String::new(), hex_preview_len: 0,
    };
    let mut raw = Vec::new();
    let mut kv = Vec::new();
    let mut pairs = Vec::new();
    let mut entries = Vec::new();

    if stats_path.is_file() {
      if let Ok(meta) = fs::metadata(&stats_path) {
        info.size = Some(meta.len());
        info.modified = meta.modified().ok()
          .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
          .map(|d| d.as_secs());
      }
      if let Ok(mut f) = fs::File::open(&stats_path) {
        let _ = f.read_to_end(&mut raw);
      }
      if !raw.is_empty() {
        let preview_max = 256.min(raw.len());
        info.hex_preview = raw[..preview_max].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        info.hex_preview_len = raw.len();

        kv = build_kv_tree(&raw);
        pairs = extract_stat_pairs_for_debug(&raw);

        // v1 achievement parsing
        match try_parse_stats_proto(&raw) {
          Ok(ach) => entries = ach,
          Err(_) => {
            if let Ok(ach) = try_parse_stats_fallback(&raw) {
              entries = ach;
            }
          }
        }
      }
    }
    (info, kv, pairs, entries)
  };

  // --- Schema file ---
  let (schema_file_info, schema_kv_tree, schema_entries) = {
    let mut info = DebugFileInfo {
      found: schema_path.is_file(),
      path: schema_path.to_string_lossy().to_string(),
      size: None, modified: None,
      hex_preview: String::new(), hex_preview_len: 0,
    };
    let mut raw = Vec::new();
    let mut kv = Vec::new();
    let mut entries = Vec::new();

    if schema_path.is_file() {
      if let Ok(meta) = fs::metadata(&schema_path) {
        info.size = Some(meta.len());
        info.modified = meta.modified().ok()
          .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
          .map(|d| d.as_secs());
      }
      if let Ok(mut f) = fs::File::open(&schema_path) {
        let _ = f.read_to_end(&mut raw);
      }
      if !raw.is_empty() {
        let preview_max = 256.min(raw.len());
        info.hex_preview = raw[..preview_max].iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        info.hex_preview_len = raw.len();

        kv = build_kv_tree(&raw);
        match read_and_parse_schema(&schema_path) {
          Ok(e) => entries = e,
          Err(e) => eprintln!("[ACH][DEBUG_REPORT] schema parse error: {}", e),
        }
      }
    }
    (info, kv, entries)
  };

  // --- Per-achievement statId/bit matching against UserGameStatsSchema ---
  let match_results: Vec<DebugMatchResult> = schema_entries.iter().map(|entry| {
    let sid = entry.stat_id;
    let bit = entry.bit;
    let (stat_value, unlocked_by_bit) = sid.and_then(|sid| {
      stat_pairs.iter().find(|sp| sp.stat_id == sid).map(|sp| {
        let unlocked = bit.map_or(sp.value != 0, |b| (sp.value & (1u32 << b)) != 0);
        (Some(sp.value), Some(unlocked))
      })
    }).unwrap_or((None, None));

    DebugMatchResult {
      api_name: entry.api_name.clone(),
      display_name: entry.display_name.clone(),
      stat_id: sid,
      bit,
      stat_value,
      unlocked_by_bit,
      unlocked_by_v1: None,
      unlock_time: None,
      source: "UserGameStatsSchema".to_string(),
    }
  }).collect();

  // --- v1 matching (by api_name) ---
  let v1_match_results: Vec<DebugMatchResult> = achievement_entries.iter().map(|ach| {
    DebugMatchResult {
      api_name: ach.api_name.clone(),
      display_name: None,
      stat_id: None,
      bit: None,
      stat_value: None,
      unlocked_by_bit: None,
      unlocked_by_v1: Some(ach.unlocked),
      unlock_time: ach.unlock_time,
      source: "UserGameStats_v1".to_string(),
    }
  }).collect();

  // --- App schema (if provided) ---
  let app_schema = achievement_schema_path.and_then(|path| {
    match read_achievements_app_schema_folder(path, app_id) {
      Ok(result) => Some(result),
      Err(e) => {
        eprintln!("[ACH][DEBUG_REPORT] app schema error: {}", e);
        None
      }
    }
  });

  // --- Librarycache ---
  let library_cache = {
    let lib_path = steam_root.join("userdata").join(&steam_account_id).join("config").join("librarycache").join(format!("{}.json", app_id));
    if lib_path.is_file() {
      match parse_librarycache_achievements(steam_path.clone(), steam_account_id.clone(), app_id) {
        Ok(p) => Some(p),
        Err(e) => {
          eprintln!("[ACH][DEBUG_REPORT] librarycache error: {}", e);
          None
        }
      }
    } else {
      eprintln!("[ACH][DEBUG_REPORT] librarycache not found: {}", lib_path.display());
      None
    }
  };

  eprintln!("[ACH][DEBUG_REPORT] === report ready: stats={} schema={} statPairs={} v1Entries={} schemaEntries={} appSchema={} libcache={} ===",
    stats_file_info.found, schema_file_info.found, stat_pairs.len(), achievement_entries.len(),
    schema_entries.len(), app_schema.is_some(), library_cache.is_some());

  Ok(DebugAchievementReport {
    stats_file: stats_file_info,
    schema_file: schema_file_info,
    stats_kv_tree,
    schema_kv_tree,
    stat_pairs,
    achievement_entries,
    schema_entries,
    app_schema,
    library_cache,
    match_results,
    v1_match_results,
    error_reason: None,
  })
}

// ---------------------------------------------------------------------------
// download_achievement_image — download a single achievement image from URL,
// save to achievements/<appid>/img/<file_name>, return local file path.
// Does NOT embed as data URL.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn download_achievement_image(
  app_handle: AppHandle,
  app_id: u32,
  url: String,
  file_name: String,
) -> Result<Option<String>, String> {
  if url.starts_with("data:") {
    return Ok(Some(url));
  }

  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;
  let img_dir = cache_dir.join("img");
  let dest_path = img_dir.join(&file_name);

  // Return existing valid file path
  if dest_path.is_file() {
    if let Ok(meta) = fs::metadata(&dest_path) {
      if meta.len() > 0 {
        return Ok(Some(dest_path.to_string_lossy().to_string()));
      }
      let _ = fs::remove_file(&dest_path);
    }
  }

  fs::create_dir_all(&img_dir)
    .map_err(|e| format!("Failed to create img dir: {}", e))?;

  let client = match build_client() {
    Ok(c) => c,
    Err(e) => return Err(format!("Failed to create HTTP client: {}", e)),
  };

  let response = match client.get(&url).send() {
    Ok(r) => r,
    Err(e) => {
      eprintln!("[ACH][IMG] failed appid={} file={} reason=network_error: {}", app_id, file_name, e);
      return Ok(None);
    }
  };

  if !response.status().is_success() {
    eprintln!("[ACH][IMG] failed appid={} file={} reason=HTTP {}", app_id, file_name, response.status());
    return Ok(None);
  }

  let bytes = match response.bytes() {
    Ok(b) => b,
    Err(e) => {
      eprintln!("[ACH][IMG] failed appid={} file={} reason=read_error: {}", app_id, file_name, e);
      return Ok(None);
    }
  };

  if let Err(e) = fs::write(&dest_path, &bytes) {
    eprintln!("[ACH][IMG] failed appid={} file={} reason=write_error: {}", app_id, file_name, e);
    return Ok(None);
  }

  eprintln!("[ACH][IMG] downloaded appid={} file={}", app_id, file_name);
  Ok(Some(dest_path.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------------------
// resolve_achievement_image_paths — check which achievement images exist
// in the local cache/img directory without downloading or embedding.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn resolve_achievement_image_paths(
  app_handle: AppHandle,
  app_id: u32,
) -> Result<Vec<AchievementImageStatus>, String> {
  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;
  let img_dir = cache_dir.join("img");

  let cache_path = cache_dir.join("achievements.json");
  if !cache_path.is_file() {
    return Ok(vec![]);
  }

  let entries: Vec<AppAchievementCacheEntry> = serde_json::from_str(
    &fs::read_to_string(&cache_path).map_err(|e| format!("Failed to read cache: {}", e))?,
  )
  .map_err(|e| format!("Failed to parse cache: {}", e))?;

  let mut results = Vec::new();
  for entry in &entries {
    let icon_exists = entry.icon_url.as_ref().map_or(false, |path| {
      let fname = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("");
      img_dir.join(fname).is_file()
    });
    let icon_gray_exists = entry.icon_gray_url.as_ref().map_or(false, |path| {
      let fname = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("");
      img_dir.join(fname).is_file()
    });
    results.push(AchievementImageStatus {
      api_name: entry.api_name.clone(),
      icon_exists,
      icon_gray_exists,
    });
  }

  Ok(results)
}

// ---------------------------------------------------------------------------
// ensure_achievement_images — download missing achievement images for a given appid.
// mode=preload: first 5 missing; mode=details/modal: all missing.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn ensure_achievement_images(
  app_handle: AppHandle,
  app_id: u32,
  mode: String,
  schema_urls: Vec<String>,
  schema_gray_urls: Vec<String>,
) -> Result<(usize, usize), String> {
  diag_log(format!("=== ensure_achievement_images app_id={} mode={} ===", app_id, mode));

  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;
  let img_dir = cache_dir.join("img");
  fs::create_dir_all(&img_dir)
    .map_err(|e| format!("Failed to create img dir: {}", e))?;

  let max_count = match mode.as_str() {
    "preload" => 5,
    _ => usize::MAX,
  };

  let client = match build_client() {
    Ok(c) => c,
    Err(e) => return Err(format!("Failed to create HTTP client: {}", e)),
  };

  let mut downloaded = 0usize;
  let mut failed = 0usize;

  // Combine icon + gray URLs
  let mut all_urls: Vec<(String, String)> = schema_urls
    .into_iter()
    .filter_map(|url| {
      let fname = Path::new(&url)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())?;
      Some((url, fname))
    })
    .collect();
  for url in &schema_gray_urls {
    if let Some(fname) = Path::new(url).file_name().and_then(|n| n.to_str()) {
      all_urls.push((url.clone(), fname.to_string()));
    }
  }

  let to_download: Vec<_> = all_urls
    .into_iter()
    .filter(|(_, fname)| {
      let dest = img_dir.join(fname);
      !dest.is_file() || fs::metadata(&dest).map(|m| m.len() == 0).unwrap_or(true)
    })
    .take(max_count)
    .collect();

  for (url, fname) in &to_download {
    let dest = img_dir.join(fname);
    match client.get(url).send() {
      Ok(resp) if resp.status().is_success() => {
        let bytes = match resp.bytes() {
          Ok(b) => b,
          Err(_) => { failed += 1; continue; }
        };
        if fs::write(&dest, &bytes).is_ok() {
          downloaded += 1;
        } else {
          failed += 1;
        }
      }
      _ => {
        eprintln!("[ACH][IMG] failed appid={} file={} reason=HTTP", app_id, fname);
        failed += 1;
      }
    }
  }

  eprintln!("[ACH][IMG] appid={} mode={} downloaded={} failed={}", app_id, mode, downloaded, failed);
  Ok((downloaded, failed))
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

  eprintln!("[ACH][CACHE] read appid={}", app_id);

  let mut summary: crate::models::steam_appcache_achievements::AppAchievementSummary =
    serde_json::from_str(
      &fs::read_to_string(&summary_path).map_err(|e| format!("Failed to read summary: {}", e))?,
    )
    .map_err(|e| format!("Failed to parse summary: {}", e))?;

  // Cache migration: fill missing fields
  let mut migrated = false;
  if summary.source.is_empty() {
    summary.source = "schema-only".to_string();
    migrated = true;
  }
  if summary.updated_at == 0 {
    summary.updated_at = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0);
    migrated = true;
  }
  if summary.cache_version.is_none() {
    summary.cache_version = Some(6);
    migrated = true;
  }

  if migrated {
    eprintln!("[ACH][CACHE] migrated old summary appid={}", app_id);
    let summary_content =
      serde_json::to_string_pretty(&summary).map_err(|e| format!("Failed to serialize migrated summary: {}", e))?;
    fs::write(&summary_path, &summary_content)
      .map_err(|e| format!("Failed to write migrated summary: {}", e))?;
  }

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

/// Resolve a localized value to a single string.
///
/// If value is a string, use it directly (unless it's a token).
/// If value is a map, resolve with fallback chain:
///   1. preferred language
///   2. latam
///   3. spanish
///   4. english
///   5. first non-empty value that is NOT a token
///   6. fallback to None (caller uses achievement name)
///
/// Never show a token if english exists.
fn resolve_localized(value: &Option<LocaleValue>, _api_name: &str, preferred_lang: Option<&str>) -> Option<String> {
  match value {
    None => None,
    Some(LocaleValue::String(s)) => {
      let trimmed = s.trim().to_string();
      if trimmed.is_empty() || is_probably_localization_token(&trimmed) {
        None
      } else {
        Some(trimmed)
      }
    }
    Some(LocaleValue::Map(map)) => {
      // 1. Preferred language
      if let Some(lang) = preferred_lang {
        if let Some(v) = map.get(lang) {
          if !v.is_empty() && !is_probably_localization_token(v) {
            return Some(v.clone());
          }
        }
      }
      // 2. LATAM
      if let Some(v) = map.get("latam") {
        if !v.is_empty() && !is_probably_localization_token(v) {
          return Some(v.clone());
        }
      }
      // 3. spanish
      if let Some(v) = map.get("spanish") {
        if !v.is_empty() && !is_probably_localization_token(v) {
          return Some(v.clone());
        }
      }
      // 4. english
      if let Some(v) = map.get("english") {
        if !v.is_empty() && !is_probably_localization_token(v) {
          return Some(v.clone());
        }
      }
      // 5. First non-empty value that is NOT a token
      for v in map.values() {
        if !v.is_empty() && !is_probably_localization_token(v) {
          return Some(v.clone());
        }
      }
      // 6. Fallback
      None
    }
  }
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

  // Support three layouts:
  // 1. Direct: {path}/achievements.json
  // 2. steam-official subdir: {path}/steam-official/{app_id}/achievements.json
  // 3. App subdir: {path}/{app_id}/achievements.json
  let base_dir: PathBuf;
  let achievements_path = if schema_dir.join("achievements.json").is_file() {
    base_dir = schema_dir.clone();
    schema_dir.join("achievements.json")
  } else {
    let steam_official_dir = schema_dir.join("steam-official").join(app_id.to_string());
    let steam_official_path = steam_official_dir.join("achievements.json");
    if steam_official_path.is_file() {
      base_dir = steam_official_dir.clone();
      diag_log(format!("[AchievementsSchema] Found in steam-official subdirectory: {}", steam_official_path.display()));
      steam_official_path
    } else {
      let sub_dir = schema_dir.join(app_id.to_string());
      let sub_path = sub_dir.join("achievements.json");
      if sub_path.is_file() {
        base_dir = sub_dir.clone();
        diag_log(format!("[AchievementsSchema] Found in app subdirectory: {}", sub_path.display()));
        sub_path
      } else {
        return Err(format!("[AchievementsSchema] achievements.json not found in {}, {}/steam-official/{}/ or {}/{}", schema_dir.display(), schema_dir.display(), app_id, schema_dir.display(), app_id));
      }
    }
  };

  diag_log(format!("[AchievementsSchema] Reading achievements from: {}", achievements_path.display()));

  let raw_entries: Vec<AchievementsAppSchemaEntry> = serde_json::from_str(
    &fs::read_to_string(&achievements_path)
      .map_err(|e| format!("Failed to read achievements.json: {}", e))?,
  )
  .map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

  diag_log(format!("[AchievementsSchema] Parsed {} entries", raw_entries.len()));

  // Log how many schema entries were parsed
  eprintln!("[ACH][RUST_SCHEMA] appid={} entries={}", app_id, raw_entries.len());

  // Read achievementpercentages.json (optional) from same base_dir
  let pcts_path = base_dir.join("achievementpercentages.json");
  let pct_map: std::collections::HashMap<String, f64> = if pcts_path.is_file() {
    match serde_json::from_str::<AchievementsAppPercentagesFile>(
      &fs::read_to_string(&pcts_path).map_err(|e| format!("Failed to read achievementpercentages.json: {}", e))?,
    ) {
      Ok(file) => {
        let map: std::collections::HashMap<_, _> = file
          .achievements
          .into_iter()
          .map(|e| (e.name, e.percent))
          .collect();
        eprintln!("[ACH][RARITY] appid={} entries={}", app_id, map.len());
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

  // Normalize to AppAchievementCacheEntry — return raw paths, do NOT embed images
  let mut localized_count = 0u32;

  let achievements: Vec<AppAchievementCacheEntry> = raw_entries
    .into_iter()
    .map(|entry| {
      let name = resolve_localized(&entry.display_name, &entry.name, None).unwrap_or_else(|| {
        localized_count += 1;
        entry.name.clone()
      });
      let description = resolve_localized(&entry.description, &entry.name, None);

      // Return raw path from achievements.json, do not embed
      let icon_url = entry.icon.as_ref().filter(|p| !p.is_empty()).cloned();
      let icon_gray_url = entry.icon_gray.as_ref().filter(|p| !p.is_empty()).cloned();

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
        stat_id: entry.stat_id,
        bit: entry.bit,
      }
    })
    .collect();

  eprintln!("[ACH][RUST_SCHEMA] appid={} entries={}", app_id, achievements.len());

  // Build percentages
  let achievement_percentages: Vec<AppAchievementPercentagesEntry> = achievements
    .iter()
    .filter_map(|a| {
      pct_map.get(&a.api_name).map(|&pct| {
        eprintln!("[ACH][RARITY] normalized percent name={} percent={}", a.api_name, pct);
        AppAchievementPercentagesEntry {
          name: a.api_name.clone(),
          percent: pct,
        }
      })
    })
    .collect();

  Ok(AchievementsAppSchemaResult {
    achievements,
    achievement_percentages,
    base_dir: Some(base_dir.to_string_lossy().to_string()),
  })
}

// ---------------------------------------------------------------------------
// cleanup_achievement_orphan_images — validate and optionally delete orphan
// achievement images not referenced by canonical achievements.json.
// dry_run=true: only report, do not delete.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cleanup_achievement_orphan_images(
  app_handle: AppHandle,
  app_id: u32,
  dry_run: bool,
) -> Result<OrphanCleanupResult, String> {
  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;
  let img_dir = cache_dir.join("img");

  // Build expected file set from achievements.json
  let cache_path = cache_dir.join("achievements.json");
  let entries: Vec<AppAchievementCacheEntry> = if cache_path.is_file() {
    serde_json::from_str(
      &fs::read_to_string(&cache_path).map_err(|e| format!("Failed to read cache: {}", e))?,
    )
    .map_err(|e| format!("Failed to parse cache: {}", e))?
  } else {
    return Err("achievements.json not found".to_string());
  };

  let mut expected: std::collections::HashSet<String> = std::collections::HashSet::new();
  for entry in &entries {
    if let Some(ref path) = entry.icon_url {
      if let Some(fname) = Path::new(path).file_name().and_then(|n| n.to_str()) {
        expected.insert(fname.to_string());
      }
    }
    if let Some(ref path) = entry.icon_gray_url {
      if let Some(fname) = Path::new(path).file_name().and_then(|n| n.to_str()) {
        expected.insert(fname.to_string());
      }
    }
  }

  let expected_max = entries.len() * 2;
  let expected_referenced = expected.len();

  // Scan img folder
  let mut actual_files: Vec<String> = Vec::new();
  if img_dir.is_dir() {
    if let Ok(rd) = fs::read_dir(&img_dir) {
      for entry in rd.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
          if let Some(name) = entry.file_name().to_str() {
            actual_files.push(name.to_string());
          }
        }
      }
    }
  }

  let actual_count = actual_files.len();
  let orphaned: Vec<String> = actual_files
    .into_iter()
    .filter(|fname| !expected.contains(fname))
    .collect();
  let orphaned_count = orphaned.len();

  eprintln!(
    "[ACH][IMG_CLEANUP] appid={} dryRun={} expectedMax={} expectedReferenced={} actual={} orphaned={}",
    app_id, dry_run, expected_max, expected_referenced, actual_count, orphaned_count
  );

  // Delete orphans if not dry run
  if !dry_run {
    for fname in &orphaned {
      let path = img_dir.join(fname);
      let _ = fs::remove_file(&path);
      eprintln!("[ACH][IMG_CLEANUP] deleted appid={} file={}", app_id, fname);
    }
    eprintln!("[ACH][IMG_CLEANUP] appid={} deleted={}", app_id, orphaned_count);
  }

  Ok(OrphanCleanupResult {
    expected_max,
    actual_files: actual_count,
    orphaned_files: orphaned,
    orphaned_count,
  })
}
