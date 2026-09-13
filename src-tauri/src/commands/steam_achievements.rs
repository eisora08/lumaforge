use std::path::{Path, PathBuf};
use std::time::Duration;
use std::{fs, io::Read};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models::steam_appcache_achievements::{
  AchievementImageStatus, AchievementsAppSchemaEntry, AchievementsAppPercentagesFile,
  AchievementsAppSchemaResult, AppAchievementCache, AppAchievementCacheEntry,
  AppAchievementPercentagesEntry, AppAchievementSummary, DebugAchievementReport, DebugFileInfo, DebugKvNode,
  DebugMatchResult, LibraryCacheFileMetadata, LibraryCacheProgress,
  LibraryCacheValue, LocaleValue, OrphanCleanupResult, StatPair, SteamAppcacheAchievement,
  SteamAppcacheParsedProgress, SteamAppcacheScanResult, SteamAppcacheSchemaEntry,
  UserGameStatsRawResult,
};

// Disable verbose librarycache debug logs by default
const DEBUG_ACH_LIBRARYCACHE: bool = false;

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
// Debug logging flags (all default false in production)
// ---------------------------------------------------------------------------
const DEBUG_ACH_CACHE_IO: bool = false;
const DEBUG_ACH_SCHEMA: bool = false;
const DEBUG_ACH_MIGRATION: bool = false;

// Diag log gated behind cache IO flag
fn diag_log(msg: impl std::fmt::Display) {
  if DEBUG_ACH_CACHE_IO {
    eprintln!("[ACH] {}", msg);
  }
}

// Category-specific log macros — all gated behind per-category flags.
macro_rules! schema_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_SCHEMA { eprintln!($($arg)*); }
    };
}

macro_rules! migration_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_MIGRATION { eprintln!($($arg)*); }
    };
}

macro_rules! progress_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_SCHEMA { eprintln!($($arg)*); }
    };
}

macro_rules! librarycache_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_SCHEMA { eprintln!($($arg)*); }
    };
}

macro_rules! rarity_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_SCHEMA { eprintln!($($arg)*); }
    };
}

macro_rules! cache_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_CACHE_IO { eprintln!($($arg)*); }
    };
}

macro_rules! repair_log {
    ($($arg:tt)*) => {
        if DEBUG_ACH_SCHEMA { eprintln!($($arg)*); }
    };
}

// ---------------------------------------------------------------------------
// Steam root resolution + appcache/stats directory
// ---------------------------------------------------------------------------
fn find_appcache_stats_dir(steam_root: &Path) -> PathBuf {
  steam_root.join("appcache").join("stats")
}

pub(crate) fn resolve_steam_root(steam_path: Option<&str>) -> Result<PathBuf, String> {
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
// Valve KeyValues binary parser — faithful port of reference steam-appcache.js
// ---------------------------------------------------------------------------

/// Read a null-terminated C string from buf starting at offset.
/// Returns (string, new_offset) or None if out of bounds or no null terminator.
fn kv_read_cstring(buf: &[u8], off: usize) -> Option<(String, usize)> {
  if off >= buf.len() { return None; }
  let end = buf[off..].iter().position(|&b| b == 0)?;
  let s = String::from_utf8_lossy(&buf[off..off + end]).to_string();
  Some((s, off + end + 1))
}

/// Insert a key-value pair into a HashMap. Duplicate keys produce a JSON-like array.
fn kv_add_key(obj: &mut serde_json::Map<String, serde_json::Value>, key: String, value: serde_json::Value) {
  use serde_json::Value;
  if let Some(existing) = obj.get(&key) {
    let arr = match existing {
      Value::Array(a) => {
        let mut a = a.clone();
        a.push(value);
        a
      }
      other => vec![other.clone(), value],
    };
    obj.insert(key, Value::Array(arr));
  } else {
    obj.insert(key, value);
  }
}

/// Parse KV binary node children — the core recursive parser.
/// Direct port of `parseNodeChildren` from reference steam-appcache.js.
fn kv_parse_node_children(buf: &[u8], off: &mut usize) -> serde_json::Map<String, serde_json::Value> {
  use serde_json::Value;
  let mut obj = serde_json::Map::new();
  let section_start = *off;

  while *off < buf.len() {
    let type_byte = buf[*off];
    *off += 1;

    // 0x08 = END marker → return to parent
    if type_byte == 0x08 {
      break;
    }

    // Read key (null-terminated C string)
    let (key, new_off) = match kv_read_cstring(buf, *off) {
      Some(v) => v,
      None => break,
    };
    *off = new_off;

    match type_byte {
      0x00 => {
        // SUBSECTION → recurse
        let child = kv_parse_node_children(buf, off);
        kv_add_key(&mut obj, key, Value::Object(child));
      }
      0x01 => {
        // STRING
        let (val, new_off) = match kv_read_cstring(buf, *off) {
          Some(v) => v,
          None => break,
        };
        *off = new_off;
        kv_add_key(&mut obj, key, Value::String(val));
      }
      0x02 => {
        // INT32 (4 bytes, little-endian signed)
        if *off + 4 > buf.len() { break; }
        let val = i32::from_le_bytes([buf[*off], buf[*off+1], buf[*off+2], buf[*off+3]]);
        *off += 4;
        kv_add_key(&mut obj, key, Value::Number(val.into()));
      }
      0x03 => {
        // FLOAT (4 bytes, little-endian)
        if *off + 4 > buf.len() { break; }
        let val = f32::from_le_bytes([buf[*off], buf[*off+1], buf[*off+2], buf[*off+3]]);
        *off += 4;
        if let Some(n) = serde_json::Number::from_f64(val as f64) {
          kv_add_key(&mut obj, key, Value::Number(n));
        }
      }
      0x07 => {
        // INT64 (8 bytes, little-endian, stored as string — matching reference)
        if *off + 8 > buf.len() { break; }
        let val = u64::from_le_bytes([
          buf[*off], buf[*off+1], buf[*off+2], buf[*off+3],
          buf[*off+4], buf[*off+5], buf[*off+6], buf[*off+7],
        ]);
        *off += 8;
        kv_add_key(&mut obj, key, Value::String(val.to_string()));
      }
      0x04 => {
        // UINT64 (8 bytes, little-endian) — used in newer schema binaries
        if *off + 8 > buf.len() { break; }
        let val = u64::from_le_bytes([
          buf[*off], buf[*off+1], buf[*off+2], buf[*off+3],
          buf[*off+4], buf[*off+5], buf[*off+6], buf[*off+7],
        ]);
        *off += 8;
        kv_add_key(&mut obj, key, Value::String(val.to_string()));
      }
      0x05 => {
        // BOOLEAN (4 bytes, little-endian int32 — 0 or 1)
        if *off + 4 > buf.len() { break; }
        let val = i32::from_le_bytes([buf[*off], buf[*off+1], buf[*off+2], buf[*off+3]]);
        *off += 4;
        kv_add_key(&mut obj, key, Value::Bool(val != 0));
      }
      0x06 => {
        // INT64 (8 bytes, little-endian signed)
        if *off + 8 > buf.len() { break; }
        let val = i64::from_le_bytes([
          buf[*off], buf[*off+1], buf[*off+2], buf[*off+3],
          buf[*off+4], buf[*off+5], buf[*off+6], buf[*off+7],
        ]);
        *off += 8;
        kv_add_key(&mut obj, key, Value::String(val.to_string()));
      }
      0x09 => {
        // INT64 alternate encoding (8 bytes, little-endian)
        if *off + 8 > buf.len() { break; }
        let val = i64::from_le_bytes([
          buf[*off], buf[*off+1], buf[*off+2], buf[*off+3],
          buf[*off+4], buf[*off+5], buf[*off+6], buf[*off+7],
        ]);
        *off += 8;
        kv_add_key(&mut obj, key, Value::String(val.to_string()));
      }
      0x0A => {
        // DOUBLE (8 bytes, little-endian)
        if *off + 8 > buf.len() { break; }
        let val = f64::from_le_bytes([
          buf[*off], buf[*off+1], buf[*off+2], buf[*off+3],
          buf[*off+4], buf[*off+5], buf[*off+6], buf[*off+7],
        ]);
        *off += 8;
        if let Some(n) = serde_json::Number::from_f64(val) {
          kv_add_key(&mut obj, key, Value::Number(n));
        }
      }
      _ => {
        // Unknown type → fail fast (matching reference behavior)
        // Do NOT continue — value size is unknown, parser would desync
        eprintln!("[KV][DIAG] Unknown type 0x{:02x} at offset {} key='{}' section_start={} keys_so_far={}",
          type_byte, *off - 1, key, section_start, obj.len());
        break;
      }
    }
  }

  obj
}

/// Parse a Valve KV binary buffer into a JSON object.
/// Direct port of `parseKVBinary` from reference steam-appcache.js.
fn kv_parse(buf: &[u8]) -> Result<(String, serde_json::Map<String, serde_json::Value>), String> {
  if buf.len() < 2 {
    return Err("Empty or invalid KV binary".to_string());
  }

  let mut off = 0;
  let first_type = buf[off];
  off += 1;

  let root_name;
  if first_type == 0x00 {
    let (name, new_off) = kv_read_cstring(buf, off)
      .ok_or("Failed to read root name".to_string())?;
    root_name = if name.is_empty() { "root".to_string() } else { name };
    off = new_off;
  } else {
    root_name = "root".to_string();
    off = 0;
  }

  let data = kv_parse_node_children(buf, &mut off);
  Ok((root_name, data))
}

/// Walk a KV JSON tree recursively, calling `visitor` for each node that has a `data` property (number).
/// The visitor receives the path (last component = statId) and the node object.
fn kv_walk_stats(obj: &serde_json::Value, path: &[&str], visitor: &mut dyn FnMut(&str, &serde_json::Map<String, serde_json::Value>)) {
  if let serde_json::Value::Object(map) = obj {
    // Check if this node has a "data" property (number) — it's a stat entry
    if let Some(serde_json::Value::Number(_)) = map.get("data") {
      if let Some(stat_id) = path.last() {
        visitor(stat_id, map);
      }
    }
    // Recurse into child objects
    for (k, v) in map {
      let mut child_path = path.to_vec();
      child_path.push(k);
      kv_walk_stats(v, &child_path, visitor);
    }
  }
}

/// Extract (stat_id, data_u32, times) from a parsed KV user stats tree.
/// Returns: Vec<(stat_id_str, data_u32, HashMap<bit_index, timestamp>)>
fn kv_extract_user_stats(data: &serde_json::Map<String, serde_json::Value>) -> Vec<(String, u32, std::collections::HashMap<String, u64>)> {
  use serde_json::Value;
  let mut result = Vec::new();

  kv_walk_stats(&Value::Object(data.clone()), &[], &mut |stat_id, node| {
    let data_u32 = match node.get("data") {
      Some(Value::Number(n)) => {
        // Negative i32 (e.g. -16 for 0xFFFFFFF0) needs i64→u32 cast to preserve bits.
        // serde_json::Number::as_u64() returns None for negative values.
        n.as_u64()
          .unwrap_or_else(|| n.as_i64().unwrap_or(0) as u64)
          as u32
      }
      Some(Value::String(s)) => s.parse::<u32>().unwrap_or(0),
      _ => 0,
    };

    // Look for AchievementTimes node (multiple naming variants)
    let times = if let Some(times_node) = node.get("AchievementTimes")
      .or_else(|| node.get("achievementTimes"))
      .or_else(|| node.get("AchievementsTimes"))
      .or_else(|| node.get("achievement_times"))
    {
      if let Value::Object(tn) = times_node {
        tn.iter().filter_map(|(k, v)| {
          let ts = match v {
            Value::Number(n) => n.as_u64(),
            Value::String(s) => s.parse::<u64>().ok(),
            _ => None,
          };
          ts.map(|t| (k.clone(), t))
        }).collect()
      } else {
        std::collections::HashMap::new()
      }
    } else {
      std::collections::HashMap::new()
    };

    result.push((stat_id.to_string(), data_u32, times));
  });

  result
}

/// Walk the schema KV tree to build a map of stat name → (statId, min, max).
/// Stat definitions are nodes with a "name" but NOT "bits" (i.e., not an achievements node).
/// The statId is the numeric path component of the stat node.
fn extract_stat_definitions(data: &serde_json::Value) -> std::collections::HashMap<String, (u32, Option<f64>, Option<f64>)> {
  let mut defs = std::collections::HashMap::new();
  extract_stat_definitions_walk(data, &["root"], &mut defs);
  defs
}

fn extract_stat_definitions_walk(obj: &serde_json::Value, path: &[&str], defs: &mut std::collections::HashMap<String, (u32, Option<f64>, Option<f64>)>) {
  if let serde_json::Value::Object(map) = obj {
    // Stat definition: has "name" but NOT "bits" (not an achievements node)
    if let Some(name) = map.get("name").and_then(|v| v.as_str()) {
      if !name.is_empty() && !map.contains_key("bits") {
        if let Some(stat_id) = path.last().and_then(|s| s.parse::<u32>().ok()) {
          let min = map.get("min").and_then(|v| v.as_f64());
          let max = map.get("max").and_then(|v| v.as_f64());
          defs.insert(name.to_string(), (stat_id, min, max));
        }
      }
    }
    for (k, v) in map {
      let mut child_path = path.to_vec();
      child_path.push(k);
      extract_stat_definitions_walk(v, &child_path, defs);
    }
  }
}

/// Extract schema achievements from a parsed KV schema tree.
/// Follows the reference implementation (Achievements-1.2.2 steam-appcache.js:extractSchemaAchievements):
/// - Modern path: any node with a `bits` object (NO type gate — type may be "ACHIEVEMENTS", "4", or absent)
/// - Legacy path: nodes with `name` + numeric path components (infer statId/bit from path)
fn kv_extract_schema(data: &serde_json::Value) -> Vec<SteamAppcacheSchemaEntry> {
  use serde_json::Value;
  let mut result = Vec::new();
  let mut seen = std::collections::HashSet::new();

  // Pre-build stat definitions map for progress metadata resolution
  let stat_defs = extract_stat_definitions(data);
  if DEBUG_ACH_SCHEMA { eprintln!("[KV][SCHEMA] stat_defs count={}", stat_defs.len()); }

  fn walk(obj: &Value, path: &[&str], result: &mut Vec<SteamAppcacheSchemaEntry>, seen: &mut std::collections::HashSet<String>, stat_defs: &std::collections::HashMap<String, (u32, Option<f64>, Option<f64>)>) {
    if let Value::Object(map) = obj {
      // PATH 1 (modern): Any node with a `bits` object — no type gate
      if let Some(Value::Object(bits)) = map.get("bits") {
        let stat_id = path.last().and_then(|s| s.parse::<u32>().ok());
        if DEBUG_ACH_SCHEMA { eprintln!("[KV][SCHEMA] Found bits node at path {:?} stat_id={:?}", path, stat_id); }
        for (bit_key, bit_val) in bits {
          let bit = bit_val.get("bit")
            .and_then(|v| v.as_u64())
            .map(|b| b as u32)
            .or_else(|| bit_key.parse::<u32>().ok());

          // API name: try multiple fields (reference line 307-313)
          let api_name = bit_val.get("name")
            .or_else(|| bit_val.get("api"))
            .or_else(|| bit_val.get("statname"))
            .or_else(|| bit_val.get("display").and_then(|d| d.get("name")).and_then(|n| n.get("token")))
            .or_else(|| bit_val.get("display").and_then(|d| d.get("name")))
            .and_then(|v| v.as_str())
            .unwrap_or(bit_key)
            .to_string();

          if api_name.is_empty() || seen.contains(&api_name) {
            continue;
          }

          let display_name = bit_val.get("display")
            .and_then(|d| d.get("name"))
            .and_then(|n| n.as_str())
            .or_else(|| bit_val.get("display").and_then(|d| d.as_str()))
            .or_else(|| bit_val.get("displayName").and_then(|d| d.as_str()))
            .map(|s| s.to_string());

          let description = bit_val.get("display")
            .and_then(|d| d.get("desc"))
            .and_then(|v| v.as_str())
            .or_else(|| bit_val.get("description").and_then(|d| d.as_str()))
            .map(|s| s.to_string());

          let hidden = bit_val.get("display")
            .and_then(|d| d.get("hidden"))
            .or_else(|| bit_val.get("hidden"))
            .and_then(|v| v.as_u64())
            .map(|h| h != 0);

          let icon = bit_val.get("display")
            .and_then(|d| d.get("icon"))
            .or_else(|| bit_val.get("icon"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

          let icon_gray = bit_val.get("display")
            .and_then(|d| d.get("icon_gray"))
            .or_else(|| bit_val.get("display").and_then(|d| d.get("icongray")))
            .or_else(|| bit_val.get("icon_gray"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

          // Extract progress metadata (reference: extractProgressMetadata)
          let mut progress_stat_id: Option<u32> = None;
          let mut progress_min: Option<f64> = None;
          let mut progress_max: Option<f64> = None;

          if let Some(progress_node) = bit_val.get("progress").and_then(|v| v.as_object()) {
            // Resolve operand1 (stat name) from progress.value.operand1 or progress.operand1
            let operand1 = progress_node.get("value")
              .and_then(|v| v.as_object())
              .and_then(|v| v.get("operand1"))
              .or_else(|| progress_node.get("operand1"))
              .and_then(|v| v.as_str())
              .unwrap_or("");

            if !operand1.is_empty() {
              // Resolve stat name → statId from pre-built stat definitions map
              if let Some(&(sid, smin, smax)) = stat_defs.get(operand1) {
                progress_stat_id = Some(sid);
                progress_min = smin;
                progress_max = smax;
              }
            }

            // Read min/max directly from the progress node (overrides stat definitions)
            if let Some(v) = progress_node.get("min_val").or_else(|| progress_node.get("min")).and_then(|v| v.as_f64()) {
              progress_min = Some(v);
            }
            if let Some(v) = progress_node.get("max_val").or_else(|| progress_node.get("max")).and_then(|v| v.as_f64()) {
              progress_max = Some(v);
            }
          }

          if stat_id.is_some() && bit.is_some() {
            seen.insert(api_name.clone());
            if DEBUG_ACH_SCHEMA { eprintln!("[KV][SCHEMA] Pushing entry: api_name={} stat_id={:?} bit={:?} progress_stat_id={:?}", api_name, stat_id, bit, progress_stat_id); }
            result.push(SteamAppcacheSchemaEntry {
              api_name,
              display_name,
              description,
              icon,
              icon_gray,
              hidden,
              stat_id,
              bit,
              progress_stat_id,
              progress_min,
              progress_max,
            });
          } else {
            if DEBUG_ACH_SCHEMA { eprintln!("[KV][SCHEMA] Skipping entry: api_name={} stat_id={:?} bit={:?} (missing required fields)", api_name, stat_id, bit); }
          }
        }
      }

      // PATH 2 (legacy): node has `name` + numeric path components → infer statId/bit from path
      // Reference line 338-350
      if let Some(Value::String(name)) = map.get("name") {
        if !name.is_empty() && !seen.contains(name) {
          // Infer statId and bit from path: walk backwards finding numeric components
          let mut inferred_bit: Option<u32> = None;
          let mut inferred_stat_id: Option<u32> = None;
          for i in (0..path.len()).rev() {
            if let Ok(n) = path[i].parse::<u32>() {
              if inferred_bit.is_none() {
                inferred_bit = Some(n);
              } else if inferred_stat_id.is_none() {
                inferred_stat_id = Some(n);
                break;
    }
  }
}

          if let (Some(stat_id), Some(bit)) = (inferred_stat_id, inferred_bit) {
            let api_name = name.clone();
            let display_name = map.get("display")
              .or_else(|| map.get("DisplayName"))
              .or_else(|| map.get("displayName"))
              .and_then(|v| v.as_str())
              .map(|s| s.to_string());

            let description = map.get("desc")
              .or_else(|| map.get("description"))
              .or_else(|| map.get("Desc"))
              .and_then(|v| v.as_str())
              .map(|s| s.to_string());

            let hidden = map.get("hidden")
              .and_then(|v| v.as_u64())
              .map(|h| h != 0);

            let icon = map.get("icon")
              .or_else(|| map.get("Icon"))
              .and_then(|v| v.as_str())
              .map(|s| s.to_string());

            let icon_gray = map.get("icon_gray")
              .or_else(|| map.get("iconGray"))
              .and_then(|v| v.as_str())
              .map(|s| s.to_string());

            seen.insert(api_name.clone());
            result.push(SteamAppcacheSchemaEntry {
              api_name,
              display_name,
              description,
              icon,
              icon_gray,
              hidden,
              stat_id: Some(stat_id),
              bit: Some(bit),
              progress_stat_id: None,
              progress_min: None,
              progress_max: None,
            });
          }
        }
      }

      // Recurse into child objects
      for (k, v) in map {
        let mut child_path = path.to_vec();
        child_path.push(k);
        walk(v, &child_path, result, seen, stat_defs);
      }
    }
  }

  walk(data, &[], &mut result, &mut seen, &stat_defs);
  let with_stat_id = result.iter().filter(|e| e.stat_id.is_some()).count();
  let with_bit = result.iter().filter(|e| e.bit.is_some()).count();
  let with_progress = result.iter().filter(|e| e.progress_stat_id.is_some()).count();
  if DEBUG_ACH_SCHEMA { eprintln!("[KV][SCHEMA] Walk complete: total={} with_stat_id={} with_bit={} with_progress={}", result.len(), with_stat_id, with_bit, with_progress); }
  result
}

/// Parse UserGameStats_*.bin (KV binary) to extract stat_id → value pairs.
fn kv_parse_user_stats(data: &[u8]) -> Result<Vec<(String, u32, std::collections::HashMap<String, u64>)>, String> {
  let (_root_name, tree) = kv_parse(data)?;
  Ok(kv_extract_user_stats(&tree))
}

/// Parse UserGameStatsSchema_*.bin (KV binary) to extract achievement schema entries.
fn kv_parse_schema(data: &[u8]) -> Result<Vec<SteamAppcacheSchemaEntry>, String> {
  let (_root_name, tree) = kv_parse(data)?;
  let entries = kv_extract_schema(&serde_json::Value::Object(tree));
  if entries.is_empty() {
    return Err("No achievement entries found in KV schema".to_string());
  }
  Ok(entries)
}

// ---------------------------------------------------------------------------
// Proto-based parser for UserGameStats_*.bin (legacy fallback)
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

  // Reject entries where display_name is a localization token (counted by caller for summary)
  if display_name.as_deref().map_or(true, |d| !is_valid_display_name(d)) {
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
    schema_log!("[ACH][SCHEMA] entry: api_name={}, stat_id={:?}, bit={:?}", api_name, stat_id, bit);
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
    progress_stat_id: None,
    progress_min: None,
    progress_max: None,
  })
}

fn try_parse_schema_proto(data: &[u8]) -> Result<Vec<SteamAppcacheSchemaEntry>, String> {
  let sub_msgs = collect_sub_messages(data);

  if sub_msgs.is_empty() {
    return Err("No protobuf sub-messages found in schema file".to_string());
  }

  let mut entries = Vec::new();
  let mut skipped_token = 0u32;
  for msg in &sub_msgs {
    if let Some(entry) = parse_schema_from_submsg(&msg.raw) {
      if !entries.iter().any(|e: &SteamAppcacheSchemaEntry| e.api_name == entry.api_name) {
        entries.push(entry);
      }
    } else {
      skipped_token += 1;
    }
  }

  if entries.is_empty() {
    return Err("No parseable schema entries found".to_string());
  }

  if skipped_token > 0 {
    schema_log!("[ACH][SCHEMA] skippedTokenOnly={} accepted={}", skipped_token, entries.len());
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
  let mut skipped_token_count = 0u32;
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
      skipped_token_count += 1;
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
      progress_stat_id: None,
      progress_min: None,
      progress_max: None,
    });
  }

  // Quality gate: require at least some entries passed the filter
  if entries.is_empty() {
    return Err("All schema entries were rejected (token-only)".to_string());
  }

  // Summary instead of per-entry logs
  if skipped_token_count > 0 {
    schema_log!("[ACH][SCHEMA] skippedTokenOnly={} accepted={}", skipped_token_count, entries.len());
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

  // KV binary parser — try first (correct format for Valve appcache)
  match kv_parse_user_stats(&data) {
    Ok(stats) => {
      // Convert to achievements format for compatibility
      let achievements: Vec<SteamAppcacheAchievement> = stats.iter().map(|(stat_id, data, _times)| {
        SteamAppcacheAchievement {
          api_name: format!("stat_{}", stat_id),
          unlocked: *data != 0,
          unlock_time: None,
        }
      }).collect();
      if !achievements.is_empty() {
        progress_log!("[ACH][PROGRESS] KV parser: {} stat entries", achievements.len());
        return Ok(achievements);
      }
    }
    Err(e) => {
      progress_log!("[ACH][PROGRESS] KV parser failed: {}", e);
    }
  }

  // Try protobuf-aware parser (legacy)
  match try_parse_stats_proto(&data) {
    Ok(achievements) => {
      progress_log!("[ACH][PROGRESS] proto parser: {} achievements", achievements.len());
      return Ok(achievements);
    }
    Err(e) => {
      progress_log!("[ACH][PROGRESS] proto parser failed, trying text fallback: {}", e);
    }
  }

  // Fallback to text-based parser
  let result = try_parse_stats_fallback(&data)?;
  progress_log!("[ACH][PROGRESS] text fallback: {} achievements", result.len());
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

  // KV binary parser — try first (correct format for Valve appcache)
  match kv_parse_schema(&data) {
    Ok(entries) => {
      schema_log!("[ACH][SCHEMA] KV parser: {} entries", entries.len());
      if !entries.is_empty() {
        return Ok(entries);
      }
    }
    Err(e) => {
      schema_log!("[ACH][SCHEMA] KV parser failed: {}", e);
    }
  }

  // Fallback: try protobuf-aware parser (legacy)
  match try_parse_schema_proto(&data) {
    Ok(entries) => {
      schema_log!("[ACH][SCHEMA] proto parser: {} entries", entries.len());
      return Ok(entries);
    }
    Err(e) => {
      schema_log!("[ACH][SCHEMA] proto parser failed, trying text fallback: {}", e);
    }
  }

  let result = try_parse_schema_fallback(&data)?;
  schema_log!("[ACH][SCHEMA] text fallback: {} entries", result.len());
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
  schema_log!("[ACH][SCHEMA] === scan app_id={} account_id={:?} ===", app_id, steam_account_id);

  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let stats_dir = find_appcache_stats_dir(&steam_root);

  if !stats_dir.is_dir() {
    schema_log!("[ACH][SCHEMA] stats dir not found: {}", stats_dir.display());
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

  // KV binary parser — try first (correct format for Valve appcache)
  match kv_parse_user_stats(&data) {
    Ok(stats) => {
      stat_pairs = stats
        .into_iter()
        .map(|(stat_id, value, times)| StatPair {
          stat_id: stat_id.parse::<u32>().unwrap_or(0),
          value,
          times,
        })
        .collect();
      diag_log(format!("KV parser extracted {} stat pairs", stat_pairs.len()));
    }
    Err(e) => {
      diag_log(format!("KV parser failed: {}", e));
    }
  }

  // Fallback: try v2 proto parser for (stat_id, value) pairs
  // Only overwrite KV parser results if proto parser found ACTUAL data
  match try_parse_stats_proto_v2(&data) {
    Ok((pairs, _count)) => {
      if !pairs.is_empty() {
        stat_pairs = pairs
          .into_iter()
          .map(|(stat_id, value)| StatPair { stat_id, value, times: std::collections::HashMap::new() })
          .collect();
        diag_log(format!("v2 proto parser extracted {} stat pairs (overriding KV)", stat_pairs.len()));
      } else {
        diag_log(format!("v2 proto parser returned 0 pairs — keeping KV result ({} pairs)", stat_pairs.len()));
      }
    }
    Err(e) => {
      diag_log(format!("v2 proto parser failed: {}", e));
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

  progress_log!("[ACH][PROGRESS] appid={} statsFileFound=true size={}", app_id, file_size);
  progress_log!("[ACH][PROGRESS] parsedStats={} achievementEntries={}", stat_pairs.len(), achievement_entries.len());

  Ok(UserGameStatsRawResult {
    file_found: true,
    file_size: Some(file_size),
    stat_pairs,
    achievement_entries,
    error_reason: None,
  })
}

// ---------------------------------------------------------------------------
// detect_steam_account_id_for_app — auto-detect account ID from stats files
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn detect_steam_account_id_for_app(
  steam_path: Option<String>,
  app_id: u32,
) -> Result<Option<String>, String> {
  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let stats_dir = find_appcache_stats_dir(&steam_root);

  if !stats_dir.is_dir() {
    return Ok(None);
  }

  let pattern = format!("UserGameStats_*_{}.bin", app_id);
  let mut candidates: Vec<String> = Vec::new();

  if let Ok(entries) = fs::read_dir(&stats_dir) {
    for entry in entries.flatten() {
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with("UserGameStats_") && name.ends_with(&format!("_{}.bin", app_id)) {
        // Extract account ID: UserGameStats_<accountId>_<appId>.bin
        if let Some(mid) = name.strip_prefix("UserGameStats_") {
          if let Some(rest) = mid.strip_suffix(&format!("_{}.bin", app_id)) {
            candidates.push(rest.to_string());
          }
        }
      }
    }
  }

  if candidates.is_empty() {
    return Ok(None);
  }

  // Prefer the most recently modified file
  let mut best: Option<(String, std::time::SystemTime)> = None;
  for account_id in &candidates {
    let path = stats_dir.join(format!("UserGameStats_{}_{}.bin", account_id, app_id));
    if let Ok(meta) = fs::metadata(&path) {
      if let Ok(modified) = meta.modified() {
        match &best {
          None => best = Some((account_id.clone(), modified)),
          Some((_, prev)) if modified > *prev => best = Some((account_id.clone(), modified)),
          _ => {}
        }
      }
    }
  }

  let result = best.map(|(id, _)| id).or_else(|| candidates.first().cloned());
  if let Some(ref id) = result {
    diag_log(format!("Auto-detected account_id={} for app_id={} from stats files", id, app_id));
  }
  Ok(result)
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
        pairs.push(StatPair { stat_id, value, times: std::collections::HashMap::new() });
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
/// Returns per-achievement unlock status from vecHighlight + vecAchievedHidden.
fn parse_librarycache_data(value: &LibraryCacheValue) -> LibraryCacheProgress {
  let mut entries = Vec::new();
  let mut n_total = None;
  let mut n_achieved = None;
  let mut progress_available = false;

  if let Some(ref data) = value.data {
    n_total = data.n_total;
    n_achieved = data.n_achieved;

    // vecHighlight: achievements that are UNLOCKED and visible
    for ach in &data.vec_highlight {
      entries.push(ach.clone());
    }
    // vecAchievedHidden: achievements that are UNLOCKED but hidden
    for ach in &data.vec_achieved_hidden {
      entries.push(ach.clone());
    }
    // vecUnachieved: achievements that are LOCKED
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

  if DEBUG_ACH_LIBRARYCACHE {
    librarycache_log!("[ACH][LIBRARYCACHE] path={}", path_str);
  }

  if !lib_path.is_file() {
    if DEBUG_ACH_LIBRARYCACHE {
      librarycache_log!("[ACH][LIBRARYCACHE] exists=false");
    }
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
  if DEBUG_ACH_LIBRARYCACHE {
    librarycache_log!("[ACH][LIBRARYCACHE] exists=true size={}", meta.len());
  }

  // ── Targeted diagnostic log for appId 1167630 (Teardown) ──
  if app_id == 1167630 {
    println!(
      "[ACH][LC_RAW] appid=1167630 path={} exists=true size={}",
      path_str,
      file_size.unwrap_or(0)
    );
  }

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
      if app_id == 1167630 {
        println!("[ACH][LC_RAW] appid=1167630 parse-error={}", e);
      }
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

  // ── Log top-level keys for appId 1167630 ──
  if app_id == 1167630 {
    let keys: Vec<String> = root
      .iter()
      .filter_map(|entry| {
        entry.as_array().and_then(|arr| {
          if arr.len() >= 2 { arr[0].as_str().map(String::from) } else { None }
        })
      })
      .collect();
    println!("[ACH][LC_RAW_KEYS] appid=1167630 keys={:?}", keys);
  }

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

            if DEBUG_ACH_LIBRARYCACHE {
              librarycache_log!("[ACH][LIBRARYCACHE] appid={} found=true", app_id);
              librarycache_log!("[ACH][LIBRARYCACHE] nTotal={:?}", result.n_total);
              librarycache_log!("[ACH][LIBRARYCACHE] nAchieved={:?}", result.n_achieved);
              librarycache_log!("[ACH][LIBRARYCACHE] progressEntries={}", result.entries.len());
              librarycache_log!("[ACH][LIBRARYCACHE] progressAvailable={}", result.progress_available);

              // Log first 10 entries
              for ach in result.entries.iter().take(10) {
                librarycache_log!(
                  "[ACH][LIBRARYCACHE_ENTRY] apiName={:?} name={:?} achieved={:?} unlockTime={:?} rarity={:?}",
                  ach.str_id, ach.str_name, ach.b_achieved, ach.rt_unlocked, ach.fl_achieved,
                );
              }

              if let Some(ref data) = value.data {
                librarycache_log!("[ACH][LIBRARYCACHE] vecHighlight={}", data.vec_highlight.len());
                librarycache_log!("[ACH][LIBRARYCACHE] vecAchievedHidden={}", data.vec_achieved_hidden.len());
                librarycache_log!("[ACH][LIBRARYCACHE] vecUnachieved={}", data.vec_unachieved.len());
              }
            }

            // Targeted parse result log for appId 1167630
            if app_id == 1167630 {
              let locked_names: Vec<&str> = result.entries.iter()
                .filter(|e| e.b_achieved == Some(true))
                .filter_map(|e| e.str_id.as_deref())
                .collect();
              println!(
                "[ACH][LC_PARSE_RESULT] appid=1167630 nTotal={:?} nAchieved={:?} entries={} progress_available={} unlockedApiNames={:?}",
                result.n_total, result.n_achieved, result.entries.len(), result.progress_available, locked_names
              );
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

// ---------------------------------------------------------------------------
// check_achievement_librarycache_metadata — lightweight file metadata check,
// no JSON parsing, used by the frontend auto-sync poller.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn check_achievement_librarycache_metadata(
  steam_path: Option<String>,
  steam_account_id: String,
  app_id: u32,
) -> Result<LibraryCacheFileMetadata, String> {
  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let lib_path = steam_root
    .join("userdata")
    .join(&steam_account_id)
    .join("config")
    .join("librarycache")
    .join(format!("{}.json", app_id));
  let path_str = lib_path.to_string_lossy().to_string();

  if !lib_path.is_file() {
    return Ok(LibraryCacheFileMetadata {
      file_found: false,
      file_path: path_str,
      file_size: None,
      modified_at: None,
      error_reason: Some("file-not-found".to_string()),
    });
  }

  match fs::metadata(&lib_path) {
    Ok(meta) => {
      let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
      Ok(LibraryCacheFileMetadata {
        file_found: true,
        file_path: path_str,
        file_size: Some(meta.len()),
        modified_at: modified,
        error_reason: None,
      })
    }
    Err(e) => Ok(LibraryCacheFileMetadata {
      file_found: true,
      file_path: path_str,
      file_size: None,
      modified_at: None,
      error_reason: Some(format!("metadata-error: {}", e)),
    }),
  }
}

#[tauri::command]
pub fn debug_achievement_progress(
  steam_path: Option<String>,
  steam_account_id: String,
  app_id: u32,
  achievement_schema_path: Option<String>,
) -> Result<DebugAchievementReport, String> {
  schema_log!("[ACH][DEBUG_REPORT] === debug_achievement_progress app_id={} ===", app_id);

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
          Err(e) => schema_log!("[ACH][DEBUG_REPORT] schema parse error: {}", e),
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
        schema_log!("[ACH][DEBUG_REPORT] app schema error: {}", e);
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
          schema_log!("[ACH][DEBUG_REPORT] librarycache error: {}", e);
          None
        }
      }
    } else {
      schema_log!("[ACH][DEBUG_REPORT] librarycache not found: {}", lib_path.display());
      None
    }
  };

  schema_log!("[ACH][DEBUG_REPORT] === report ready: stats={} schema={} statPairs={} v1Entries={} schemaEntries={} appSchema={} libcache={} ===",
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
pub async fn download_achievement_image(
  app_handle: AppHandle,
  app_id: u32,
  url: String,
  file_name: String,
  platform: Option<String>,
) -> Result<Option<String>, String> {
  if url.starts_with("data:") {
    return Ok(Some(url));
  }

  let write_platform = platform.as_deref().unwrap_or("steam-official");
  let cache_dir = get_achievement_write_dir(&app_handle, app_id, write_platform)?;
  let img_dir = cache_dir.join("img");
  let dest_path = img_dir.join(&file_name);

  // Return existing valid file path
  if let Ok(meta) = tokio::fs::metadata(&dest_path).await {
    if meta.len() > 0 {
      return Ok(Some(dest_path.to_string_lossy().to_string()));
    }
    let _ = tokio::fs::remove_file(&dest_path).await;
  }

  tokio::fs::create_dir_all(&img_dir)
    .await
    .map_err(|e| format!("Failed to create img dir: {}", e))?;

  let client = reqwest::Client::builder()
    .user_agent("LumaForge/0.1.0")
    .timeout(Duration::from_secs(15))
    .connect_timeout(Duration::from_secs(8))
    .redirect(reqwest::redirect::Policy::limited(5))
    .build()
    .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

  let response = match client.get(&url).send().await {
    Ok(r) => r,
    Err(e) => {
      diag_log(format!("download_achievement_image failed appid={} file={} reason=network_error: {}", app_id, file_name, e));
      return Ok(None);
    }
  };

  if !response.status().is_success() {
    diag_log(format!("download_achievement_image failed appid={} file={} reason=HTTP {}", app_id, file_name, response.status()));
    return Ok(None);
  }

  let bytes = match response.bytes().await {
    Ok(b) => b,
    Err(e) => {
      diag_log(format!("download_achievement_image failed appid={} file={} reason=read_error: {}", app_id, file_name, e));
      return Ok(None);
    }
  };

  if let Err(e) = tokio::fs::write(&dest_path, &bytes).await {
    diag_log(format!("download_achievement_image failed appid={} file={} reason=write_error: {}", app_id, file_name, e));
    return Ok(None);
  }

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

  // When the active cache dir is the crack dir (steam/<appId>/), also check
  // the official dir (steam-official/<appId>/img/) so already-downloaded icons
  // from the official schema are detected as existing and not re-downloaded.
  let official_img_dir = {
    let app_dir = app_handle.path().app_data_dir()
      .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    app_dir.join("achievements").join("schema").join("steam-official")
      .join(app_id.to_string()).join("img")
  };

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
      img_dir.join(fname).is_file() || official_img_dir.join(fname).is_file()
    });
    let icon_gray_exists = entry.icon_gray_url.as_ref().map_or(false, |path| {
      let fname = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("");
      // The TS download logic saves gray icons as "hash_gray.jpg" (adds _gray suffix).
      // The icon_gray_url field may contain the original CDN URL without _gray.
      // Check both the original filename and the _gray variant.
      let gray_fname = if fname.ends_with(".jpg") || fname.ends_with(".png") {
        let stem = &fname[..fname.rfind('.').unwrap_or(fname.len())];
        let ext = &fname[fname.rfind('.').unwrap_or(fname.len())..];
        format!("{}_gray{}", stem, ext)
      } else {
        String::new()
      };
      img_dir.join(fname).is_file()
        || official_img_dir.join(fname).is_file()
        || (!gray_fname.is_empty() && (img_dir.join(&gray_fname).is_file() || official_img_dir.join(&gray_fname).is_file()))
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
      // Gray icons must use <hash>_gray.jpg filename to match normalized cache paths
      let gray_fname = if fname.ends_with("_gray.jpg") {
        fname.to_string()
      } else if let Some(stem) = fname.strip_suffix(".jpg") {
        format!("{}_gray.jpg", stem)
      } else if let Some(stem) = fname.strip_suffix(".png") {
        format!("{}_gray.png", stem)
      } else {
        fname.to_string()
      };
      all_urls.push((url.clone(), gray_fname));
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
        failed += 1;
      }
    }
  }

  librarycache_log!("[ACH][IMG] appid={} mode={} downloaded={} failed={}", app_id, mode, downloaded, failed);
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

  // Cracked games: achievements/schema/steam/<appid>/
  let crack_dir = app_dir.join("achievements").join("schema").join("steam").join(app_id.to_string());
  let crack_json = crack_dir.join("achievements.json");

  // Steam library games: achievements/schema/steam-official/<appid>/
  let official_dir = app_dir.join("achievements").join("schema").join("steam-official").join(app_id.to_string());
  let official_json = official_dir.join("achievements.json");

  // Legacy format: achievements/steam/<appid>/
  let legacy_dir = app_dir.join("achievements").join("steam").join(app_id.to_string());

  // Priority: cracked (steam/) with valid content > official (steam-official/) > legacy
  // NOTE: callers that know the platform should use get_achievement_write_dir() instead.
  // This reader is only for unknown-platform fallback reads.
  if crack_json.exists() && std::fs::read_to_string(&crack_json).map(|c| c.len() > 10).unwrap_or(false) {
    Ok(crack_dir)
  } else if official_json.exists() && std::fs::read_to_string(&official_json).map(|c| c.len() > 10).unwrap_or(false) {
    Ok(official_dir)
  } else if legacy_dir.exists() {
    let _ = fs::rename(&legacy_dir, &official_dir);
    Ok(official_dir)
  } else {
    Ok(official_dir)
  }
}

/// Get the write directory for achievement schema based on platform.
/// "steam" = cracked games → writes to steam/<appId>/
/// "steam-official" = Steam library games → writes to steam-official/<appId>/
/// "epic-official" = Epic Official games → writes to epic-official/<appId>/
fn get_achievement_write_dir(app_handle: &AppHandle, app_id: u32, platform: &str) -> Result<PathBuf, String> {
  let app_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;

  let sub = match platform {
    "steam" => "steam",
    "epic-official" => "epic-official",
    _ => "steam-official",
  };
  Ok(app_dir.join("achievements").join("schema").join(sub).join(app_id.to_string()))
}

#[tauri::command]
pub fn write_achievement_cache(app_handle: AppHandle, app_id: u32, data: AppAchievementCache, migrate_icons: bool, platform: Option<String>) -> Result<(), String> {
  let cache_dir = match platform.as_deref() {
    Some("steam") => get_achievement_write_dir(&app_handle, app_id, "steam")?,
    Some("steam-official") => get_achievement_write_dir(&app_handle, app_id, "steam-official")?,
    Some("epic-official") => get_achievement_write_dir(&app_handle, app_id, "epic-official")?,
    _ => get_achievement_cache_dir(&app_handle, app_id)?,
  };

  // Create directory only when actually writing files
  fs::create_dir_all(&cache_dir)
    .map_err(|e| format!("Failed to create achievement cache dir: {}", e))?;

  diag_log(format!("Writing achievement cache for app_id={} migrate_icons={} to {:?}", app_id, migrate_icons, cache_dir));

  // Save originals before moving for image_sources.json comparison
  let original_achievements = data.achievements.clone();

  // Normalize icon URLs to relative paths before writing (expensive — only done when migrate_icons is true)
  let normalized_achievements: Vec<AppAchievementCacheEntry> = data.achievements.into_iter().map(|mut entry| {
    if migrate_icons {
      entry.icon_url = normalize_icon_url_for_cache(&app_handle, app_id, &entry.icon_url, false);
      entry.icon_gray_url = normalize_icon_url_for_cache(&app_handle, app_id, &entry.icon_gray_url, true);
    }
    entry
  }).collect();

  // Helper: skip write if content is identical to what's already on disk (ignores updated_at)
  fn write_if_changed(path: &std::path::Path, content: &str, label: &str, _app_id: u32) -> Result<(), String> {
    if path.exists() {
      if let Ok(existing) = fs::read_to_string(path) {
        // Strip updated_at field before comparing to avoid timestamp-only diffs
        let normalize = |s: &str| -> String {
          if let Some(pos) = s.find("\"updated_at\"") {
            let mut result = s.to_string();
            // Find the value after "updated_at": and replace digits with zeros
            if let Some(colon_pos) = result[pos..].find(':') {
              let val_start = pos + colon_pos + 1;
              let bytes = result.as_bytes();
              let mut i = val_start;
              while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
              let num_start = i;
              while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
              if i > num_start {
                let replacement = "0".repeat(i - num_start);
                result.replace_range(num_start..i, &replacement);
              }
            }
            result
          } else {
            s.to_string()
          }
        };
        if normalize(&existing) == normalize(content) {
          return Ok(());
        }
      }
    }
    fs::write(path, content)
      .map_err(|e| format!("Failed to write {}: {}", label, e))
  }

  // Write summary.json
  let mut summary = data.summary;
  // Preserve caller-provided cache_version (TS sets 7, schema gen sets 7)
  if summary.cache_version.is_none() {
    summary.cache_version = Some(6);
  }
  let summary_path = cache_dir.join("summary.json");
  let summary_content =
    serde_json::to_string_pretty(&summary).map_err(|e| format!("Failed to serialize summary: {}", e))?;
  write_if_changed(&summary_path, &summary_content, "summary", app_id)?;

  // Write achievements.json (with normalized relative icon paths)
  let achievements_path = cache_dir.join("achievements.json");
  let achievements_content =
    serde_json::to_string_pretty(&normalized_achievements).map_err(|e| format!("Failed to serialize achievements: {}", e))?;
  write_if_changed(&achievements_path, &achievements_content, "achievements", app_id)?;

  // Write achievementpercentages.json
  let pcts_path = cache_dir.join("achievementpercentages.json");
  let pcts_content = serde_json::to_string_pretty(&data.achievement_percentages)
    .map_err(|e| format!("Failed to serialize percentages: {}", e))?;
  write_if_changed(&pcts_path, &pcts_content, "achievementpercentages", app_id)?;

  // Write image_sources.json (separate remote URL metadata)
  let sources_path = cache_dir.join("image_sources.json");
  let source_entries: Vec<serde_json::Value> = normalized_achievements.iter().filter_map(|entry| {
    let had_original = original_achievements.iter().find(|o| o.api_name == entry.api_name);
    match had_original {
      Some(orig) => {
        let orig_icon = orig.icon_url.as_deref().unwrap_or("");
        let orig_gray = orig.icon_gray_url.as_deref().unwrap_or("");
        let new_icon = entry.icon_url.as_deref().unwrap_or("");
        let new_gray = entry.icon_gray_url.as_deref().unwrap_or("");

        let icon_changed = !orig_icon.is_empty() && orig_icon != new_icon && (orig_icon.starts_with("http://") || orig_icon.starts_with("https://"));
        let gray_changed = !orig_gray.is_empty() && orig_gray != new_gray && (orig_gray.starts_with("http://") || orig_gray.starts_with("https://"));

        if icon_changed || gray_changed {
          let mut obj = serde_json::Map::new();
          obj.insert("api_name".to_string(), serde_json::Value::String(entry.api_name.clone()));
          if icon_changed {
            obj.insert("remote_icon_url".to_string(), serde_json::Value::String(orig_icon.to_string()));
          }
          if gray_changed {
            obj.insert("remote_icon_gray_url".to_string(), serde_json::Value::String(orig_gray.to_string()));
          }
          Some(serde_json::Value::Object(obj))
        } else {
          None
        }
      }
      None => None,
    }
  }).collect();
  if !source_entries.is_empty() {
    let sources_content = serde_json::to_string_pretty(&source_entries)
      .map_err(|e| format!("Failed to serialize image sources: {}", e))?;
    fs::write(&sources_path, &sources_content)
      .map_err(|e| format!("Failed to write image sources: {}", e))?;
    diag_log(format!("Wrote {} image source entries", source_entries.len()));
  }

  diag_log(format!("Achievement cache written for app_id={}: {} achievements", app_id, normalized_achievements.len()));
  Ok(())
}

#[tauri::command]
pub fn delete_achievement_cache(app_handle: AppHandle, app_id: u32, platform: Option<String>) -> Result<(), String> {
  let dirs: Vec<std::path::PathBuf> = match platform.as_deref() {
    Some("steam") => vec![get_achievement_write_dir(&app_handle, app_id, "steam")?],
    Some("steam-official") => vec![get_achievement_write_dir(&app_handle, app_id, "steam-official")?],
    Some("epic-official") => vec![get_achievement_write_dir(&app_handle, app_id, "epic-official")?],
    _ => vec![
      get_achievement_write_dir(&app_handle, app_id, "steam")?,
      get_achievement_write_dir(&app_handle, app_id, "steam-official")?,
    ],
  };
  for dir in dirs {
    if dir.exists() {
      fs::remove_dir_all(&dir)
        .map_err(|e| format!("Failed to delete achievement cache dir: {}", e))?;
    }
  }
  diag_log(format!("Deleted achievement cache for app_id={}", app_id));
  Ok(())
}

#[tauri::command]
pub fn read_achievement_cache(app_handle: AppHandle, app_id: u32, platform: Option<String>) -> Result<Option<AppAchievementCache>, String> {
  let cache_dir = match platform.as_deref() {
    Some("steam") => get_achievement_write_dir(&app_handle, app_id, "steam")?,
    Some("steam-official") => get_achievement_write_dir(&app_handle, app_id, "steam-official")?,
    Some("epic-official") => get_achievement_write_dir(&app_handle, app_id, "epic-official")?,
    _ => get_achievement_cache_dir(&app_handle, app_id)?,
  };

  let summary_path = cache_dir.join("summary.json");
  let achievements_path = cache_dir.join("achievements.json");
  let pcts_path = cache_dir.join("achievementpercentages.json");

  if !summary_path.exists() || !achievements_path.exists() {
    if DEBUG_ACH_LIBRARYCACHE {
      diag_log(format!("No achievement cache found for app_id={}", app_id));
    }
    return Ok(None);
  }

  if DEBUG_ACH_LIBRARYCACHE {
    diag_log(format!("read cache appid={}", app_id));
  }

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
    cache_log!("[ACH][CACHE] migrated old summary appid={}", app_id);
    let summary_content =
      serde_json::to_string_pretty(&summary).map_err(|e| format!("Failed to serialize migrated summary: {}", e))?;
    fs::write(&summary_path, &summary_content)
      .map_err(|e| format!("Failed to write migrated summary: {}", e))?;
  }

  let mut achievements: Vec<crate::models::steam_appcache_achievements::AppAchievementCacheEntry> =
    serde_json::from_str(
      &fs::read_to_string(&achievements_path)
        .map_err(|e| format!("Failed to read achievements: {}", e))?,
    )
    .map_err(|e| format!("Failed to parse achievements: {}", e))?;

  // Part 4: On-read migration — normalize CDN URLs + repair truncated CDN folder URLs
  let mut migrated_icons = 0u32;
  let mut migrated_gray = 0u32;
  let mut repaired_icons = 0u32;
  let mut repaired_gray = 0u32;
  let mut sources_entries: Vec<serde_json::Value> = vec![];

  for entry in achievements.iter_mut() {
    // Handle icon_url if it contains Steam CDN path
    if let Some(ref icon) = entry.icon_url.clone() {
      if icon.contains("/steamcommunity/public/images/apps/") {
        if is_valid_cdn_achievement_url(icon) {
          // Complete CDN URL with valid hash → migrate to relative path
          if let Some(rel) = cdn_url_to_relative_icon_path(icon, false) {
            let mut obj = serde_json::Map::new();
            obj.insert("api_name".to_string(), serde_json::Value::String(entry.api_name.clone()));
            obj.insert("remote_icon_url".to_string(), serde_json::Value::String(icon.clone()));
            sources_entries.push(serde_json::Value::Object(obj));
            entry.icon_url = Some(rel);
            migrated_icons += 1;
          }
        } else {
          // Truncated CDN folder URL (no hash) → strip it
          repair_log!("[ACH][SCHEMA_REPAIR] appid={} apiName={} stripping invalid icon_url (truncated CDN folder): {}", app_id, entry.api_name, icon);
          entry.icon_url = None;
          repaired_icons += 1;
        }
      }
    }

    // Handle icon_gray_url if it contains Steam CDN path
    if let Some(ref icon_gray) = entry.icon_gray_url.clone() {
      if icon_gray.contains("/steamcommunity/public/images/apps/") {
        if is_valid_cdn_achievement_url(icon_gray) {
          // Complete CDN URL with valid hash → migrate to relative path
          if let Some(rel) = cdn_url_to_relative_icon_path(icon_gray, true) {
            if let Some(existing) = sources_entries.iter_mut().find(|v| {
              v.get("api_name").and_then(|n| n.as_str()) == Some(&entry.api_name)
            }) {
              if let Some(obj) = existing.as_object_mut() {
                obj.insert("remote_icon_gray_url".to_string(), serde_json::Value::String(icon_gray.clone()));
              }
            } else {
              let mut obj = serde_json::Map::new();
              obj.insert("api_name".to_string(), serde_json::Value::String(entry.api_name.clone()));
              obj.insert("remote_icon_gray_url".to_string(), serde_json::Value::String(icon_gray.clone()));
              sources_entries.push(serde_json::Value::Object(obj));
            }
            entry.icon_gray_url = Some(rel);
            migrated_gray += 1;
          }
        } else {
          // Truncated CDN folder URL (no hash) → strip it
          repair_log!("[ACH][SCHEMA_REPAIR] appid={} apiName={} stripping invalid icon_gray_url (truncated CDN folder): {}", app_id, entry.api_name, icon_gray);
          entry.icon_gray_url = None;
          repaired_gray += 1;
        }
      }
    }
  }

  if migrated_icons > 0 || migrated_gray > 0 || repaired_icons > 0 || repaired_gray > 0 {
    repair_log!("[ACH][SCHEMA_REPAIR] appid={} migratedIcons={} migratedGrayIcons={} repairedIcons={} repairedGrayIcons={} total={}", app_id, migrated_icons, migrated_gray, repaired_icons, repaired_gray, achievements.len());
    // Write repaired/migrated achievements.json
    let achievements_content =
      serde_json::to_string_pretty(&achievements).map_err(|e| format!("Failed to serialize migrated achievements: {}", e))?;
    fs::write(&achievements_path, &achievements_content)
      .map_err(|e| format!("Failed to write migrated achievements: {}", e))?;
    // Write/update image_sources.json
    if !sources_entries.is_empty() {
      let sources_path = cache_dir.join("image_sources.json");
      let sources_content = serde_json::to_string_pretty(&sources_entries)
        .map_err(|e| format!("Failed to serialize image sources: {}", e))?;
      fs::write(&sources_path, &sources_content)
        .map_err(|e| format!("Failed to write image sources: {}", e))?;
    }
  }

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
  schema_log!("[ACH][RUST_SCHEMA] appid={} entries={}", app_id, raw_entries.len());

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
        rarity_log!("[ACH][RARITY] appid={} entries={}", app_id, map.len());
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

      // Return raw path from achievements.json, do not embed.
      // Normalize any Steam CDN URLs to relative img/ paths.
      let raw_icon = entry.icon.as_ref().filter(|p| !p.is_empty()).cloned();
      let raw_gray = entry.icon_gray.as_ref().filter(|p| !p.is_empty()).cloned();
      // Normalize without app_handle (no absolute local path conversion, just CDN → img/)
      let icon_url = raw_icon.and_then(|val| {
        if val.contains("/steamcommunity/public/images/apps/") {
          if is_valid_cdn_achievement_url(&val) {
            cdn_url_to_relative_icon_path(&val, false)
          } else {
            // Truncated CDN folder URL (no hash) → reject entirely
            schema_log!("[ACH][SCHEMA_VALIDATE] appid={} invalidIconUrl reason=missing-hash url={}", app_id, val);
            None
          }
        } else {
          Some(val)
        }
      });
      let icon_gray_url = raw_gray.and_then(|val| {
        if val.contains("/steamcommunity/public/images/apps/") {
          if is_valid_cdn_achievement_url(&val) {
            cdn_url_to_relative_icon_path(&val, true)
          } else {
            // Truncated CDN folder URL (no hash) → reject entirely
            schema_log!("[ACH][SCHEMA_VALIDATE] appid={} invalidGrayUrl reason=missing-hash url={}", app_id, val);
            None
          }
        } else {
          Some(val)
        }
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
        stat_id: entry.stat_id,
        bit: entry.bit,
        progress_stat_id: entry.progress_stat_id,
        progress_min: entry.progress_min,
        progress_max: entry.progress_max,
      }
    })
    .collect();

  schema_log!("[ACH][RUST_SCHEMA] appid={} entries={}", app_id, achievements.len());

  // Build percentages
  let achievement_percentages: Vec<AppAchievementPercentagesEntry> = achievements
    .iter()
    .filter_map(|a| {
      pct_map.get(&a.api_name).map(|&pct| {
        rarity_log!("[ACH][RARITY] normalized percent name={} percent={}", a.api_name, pct);
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

  librarycache_log!(
    "[ACH][IMG_CLEANUP] appid={} dryRun={} expectedMax={} expectedReferenced={} actual={} orphaned={}",
    app_id, dry_run, expected_max, expected_referenced, actual_count, orphaned_count
  );

  // Delete orphans if not dry run
  if !dry_run {
    for fname in &orphaned {
      let path = img_dir.join(fname);
      let _ = fs::remove_file(&path);
      librarycache_log!("[ACH][IMG_CLEANUP] deleted appid={} file={}", app_id, fname);
    }
    librarycache_log!("[ACH][IMG_CLEANUP] appid={} deleted={}", app_id, orphaned_count);
  }

  Ok(OrphanCleanupResult {
    expected_max,
    actual_files: actual_count,
    orphaned_files: orphaned,
    orphaned_count,
  })
}

// ===================================================================
// Icon URL normalization helpers
// ===================================================================

/// Check if a URL string's last path segment is a valid 40-char hex hash.
/// Parses the URL as a string (not Path) to avoid platform issues.
fn is_valid_image_hash(url: &str) -> bool {
  // Find the last '/' and take everything after it
  let last_segment = match url.rsplit('/').next() {
    Some(s) if !s.is_empty() => s,
    _ => return false,
  };
  // Strip extension — must be .jpg or .png
  let stem = match last_segment.strip_suffix(".jpg").or_else(|| last_segment.strip_suffix(".png")) {
    Some(s) => s,
    None => return false,
  };
  // Handle _gray suffix
  let clean = stem.strip_suffix("_gray").unwrap_or(stem);
  clean.len() == 40 && clean.chars().all(|c| c.is_ascii_hexdigit())
}

/// Extract a Steam CDN image hash from a URL like:
/// https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/<appid>/<40hex>.jpg
/// Uses string parsing (not Path) for reliable URL handling.
fn extract_steam_image_hash(url: &str) -> Option<String> {
  let last_segment = url.rsplit('/').next()?;
  // Strip extension
  let stem = last_segment
    .strip_suffix(".jpg")
    .or_else(|| last_segment.strip_suffix(".png"))?;
  // Handle _gray suffix
  let clean = stem.strip_suffix("_gray").unwrap_or(stem);
  if clean.len() == 40 && clean.chars().all(|c| c.is_ascii_hexdigit()) {
    Some(clean.to_string())
  } else {
    None
  }
}

/// Check if a URL is a Steam CDN achievement icon URL (any host, with valid hash).
/// Returns true if the URL contains the CDN path pattern and ends with a valid image hash.
fn is_valid_cdn_achievement_url(url: &str) -> bool {
  url.contains("/steamcommunity/public/images/apps/") && is_valid_image_hash(url)
}

/// Normalize a Steam CDN URL to a local relative path, extracting the image hash.
/// For gray icons (is_gray=true), returns `img/<hash>_gray.jpg`.
/// For colored icons, returns `img/<hash>.jpg`.
fn cdn_url_to_relative_icon_path(url: &str, is_gray: bool) -> Option<String> {
  let hash = extract_steam_image_hash(url)?;
  if is_gray {
    Some(format!("img/{}_gray.jpg", hash))
  } else {
    Some(format!("img/{}.jpg", hash))
  }
}

/// Normalize an icon URL for storage in achievements.json.
/// - Remote Steam CDN URLs → `img/<hash>.jpg` (or `img/<hash>_gray.jpg` when `is_gray`)
/// - Absolute local paths inside img dir → `img/<filename>`
/// - Already relative `img/` paths → unchanged
/// - Truncated CDN folder URLs (no hash) → `None` (rejected)
/// - Remote non-CDN URLs → `None` (rejected — only img/ paths stored)
fn normalize_icon_url_for_cache(app_handle: &AppHandle, app_id: u32, url: &Option<String>, is_gray: bool) -> Option<String> {
  let url = match url {
    Some(u) if !u.is_empty() => u,
    _ => return None,
  };

  // Already relative
  if url.starts_with("img/") {
    return Some(url.clone());
  }

  // Data URLs pass through
  if url.starts_with("data:") {
    return Some(url.clone());
  }

  // Steam CDN URL → extract hash, store as img/<hash>.jpg
  // Covers all Steam CDN hosts: steamcdn-a.akamaihd.net, cdn.cloudflare.steamstatic.com,
  // steamcdn.cloudflare.steamstatic.com, media.steampowered.com, etc.
  if is_valid_cdn_achievement_url(url) {
    if let Some(rel) = cdn_url_to_relative_icon_path(url, is_gray) {
      if cfg!(debug_assertions) {
        migration_log!("[ACH][SCHEMA_MIGRATE] appid={} icon_url -> {} (from CDN URL)", app_id, rel);
      }
      return Some(rel);
    }
  }

  // URL matches CDN path pattern but has no valid hash → truncated folder URL, reject
  if url.contains("/steamcommunity/public/images/apps/") {
    if cfg!(debug_assertions) {
      schema_log!("[ACH][SCHEMA_VALIDATE] appid={} invalidIconUrl reason=missing-hash url={}", app_id, url);
    }
    return None;
  }

  // Absolute local path → try to normalize to relative
  if url.starts_with('/') || url.chars().nth(1) == Some(':') {
    let app_dir = match app_handle.path().app_data_dir() {
      Ok(d) => d,
      Err(_) => return None,
    };
    let app_id_str = app_id.to_string();
    let possible_bases = vec![
      app_dir.join("achievements").join("steam").join(&app_id_str).join("img"),
      app_dir.join("achievements").join(&app_id_str).join("img"),
    ];
    let path = std::path::Path::new(url);
    for base in &possible_bases {
      let path_str = path.to_string_lossy().replace('\\', "/");
      let base_str = base.to_string_lossy().replace('\\', "/");
      if path_str.starts_with(&base_str) {
        let suffix = path_str[base_str.len()..].trim_start_matches('/');
        let rel_str = format!("img/{}", suffix);
        if cfg!(debug_assertions) {
          migration_log!("[ACH][SCHEMA_MIGRATE] appid={} icon_url {} -> {}", app_id, url, rel_str);
        }
        return Some(rel_str);
      }
      // Also try with parent of img
      if let Some(base_parent) = base.parent() {
        let base_parent_str = base_parent.to_string_lossy().replace('\\', "/") + "/";
        if path_str.starts_with(&base_parent_str) {
          let suffix = path_str[base_parent_str.len()..].trim_start_matches('/');
          if suffix.starts_with("img/") || suffix.starts_with("img\\") {
            let rel_str = suffix.replace('\\', "/");
            if cfg!(debug_assertions) {
              migration_log!("[ACH][SCHEMA_MIGRATE] appid={} icon_url {} -> {}", app_id, url, rel_str);
            }
            return Some(rel_str);
          }
        }
      }
    }
    // Absolute local path that doesn't match achievement dir → reject
    return None;
  }

  // Any other remote HTTP/HTTPS URL → reject (do not keep remote URLs in cache)
  if url.starts_with("http://") || url.starts_with("https://") {
    if cfg!(debug_assertions) {
      schema_log!("[ACH][SCHEMA_VALIDATE] appid={} rejectedRemoteIconUrl reason=non-cdn-url url={}", app_id, url);
    }
    return None;
  }

  // Unknown format → reject
  None
}

// ===================================================================
// Runtime path resolvers (Part 4)
// ===================================================================

/// Resolve the absolute path to an achievement cache directory.
/// e.g. resolveAchievementPath("steam", 268910)
///   → <appData>/achievements/steam/268910/
#[tauri::command]
pub fn resolve_achievement_path(
    app_handle: AppHandle,
    provider: String,
    app_id: u32,
) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("achievements").join(&provider).join(app_id.to_string());
    Ok(dir.to_string_lossy().to_string())
}

/// Resolve an absolute path for an achievement image from a relative path.
/// e.g. resolveAchievementImagePath("steam", 268910, "img/hash.jpg")
///   → <appData>/achievements/steam/268910/img/hash.jpg
#[tauri::command]
pub fn resolve_achievement_image_path(
    app_handle: AppHandle,
    provider: String,
    app_id: u32,
    relative_path: String,
) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let abs = app_dir.join("achievements").join(&provider).join(app_id.to_string()).join(&relative_path);
    Ok(abs.to_string_lossy().to_string())
}

// ===================================================================
// Validation: scan for absolute paths, asset URLs, remote icon fields
// ===================================================================

#[tauri::command]
pub fn validate_portable_paths(app_handle: AppHandle) -> Result<Value, String> {
  let app_dir = app_handle.path().app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;
  let mut details: Vec<String> = vec![];
  let mut appdata_abs = 0u32;
  let mut asset_urls_persisted = 0u32;
  let mut remote_icon = 0u32;
  let mut providerless = 0u32;
  let missing_local = 0u32;

  let achievements_dir = app_dir.join("achievements");
  if !achievements_dir.exists() {
    return Ok(serde_json::json!({
      "appdata_absolute_paths": 0, "asset_urls_persisted": 0,
      "remote_icon_fields": 0, "providerless_achievement_folders": 0,
      "missing_local_files": 0, "details": ["No achievements directory found"]
    }));
  }

  // Scan achievement folders
  for entry in fs::read_dir(&achievements_dir).unwrap().flatten() {
    let path = entry.path();
    if !path.is_dir() { continue; }
    let dir_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

    // Check for providerless folders (direct numeric subdirs)
    if dir_name.chars().all(|c| c.is_ascii_digit()) && dir_name != "steam" {
      providerless += 1;
      details.push(format!("PROVIDERLESS: achievements/{}", dir_name));
    }

    // Scan JSON files within for absolute paths
    for json_entry in walkdir::WalkDir::new(&path).into_iter().filter_map(|e| e.ok()) {
      if json_entry.path().extension().map_or(true, |ext| ext != "json") { continue; }
      let content = match fs::read_to_string(json_entry.path()) {
        Ok(c) => c,
        Err(_) => continue,
      };
      // Check for app data absolute paths
      let appdata_str = app_dir.to_string_lossy().replace('\\', "/");
      if content.contains(&appdata_str) {
        appdata_abs += 1;
        details.push(format!("ABSOLUTE: {} contains appdata path", json_entry.path().display()));
      }
      // Check for asset:// URLs
      if content.contains("asset://") || content.contains("asset.localhost") {
        asset_urls_persisted += 1;
        details.push(format!("ASSET_URL: {} contains asset URL", json_entry.path().display()));
      }
      // Check for remote icon/gray icon URLs
      if content.contains("\"icon_url\":\"http") || content.contains("\"icon_gray_url\":\"http") {
        remote_icon += 1;
        details.push(format!("REMOTE_ICON: {} contains remote icon URL", json_entry.path().display()));
      }
    }
  }

  // Scan game cache files in games/ directory
  let games_dir = app_dir.join("games");
  if games_dir.exists() {
    for json_entry in walkdir::WalkDir::new(&games_dir).into_iter().filter_map(|e| e.ok()) {
      if json_entry.path().extension().map_or(true, |ext| ext != "json") { continue; }
      let content = match fs::read_to_string(json_entry.path()) {
        Ok(c) => c,
        Err(_) => continue,
      };
      let appdata_str = app_dir.to_string_lossy().replace('\\', "/");
      if content.contains(&appdata_str) {
        appdata_abs += 1;
        details.push(format!("ABSOLUTE: {} contains appdata path", json_entry.path().display()));
      }
      if content.contains("asset://") || content.contains("asset.localhost") {
        asset_urls_persisted += 1;
        details.push(format!("ASSET_URL: {} contains asset URL", json_entry.path().display()));
      }
    }
  }

  schema_log!("[PATH][VALIDATE] absolutePaths={}", appdata_abs);
  schema_log!("[PATH][VALIDATE] assetUrlsPersisted={}", asset_urls_persisted);
  schema_log!("[PATH][VALIDATE] remoteIconFields={}", remote_icon);
  schema_log!("[PATH][VALIDATE] providerlessAchievementFolders={}", providerless);
  schema_log!("[PATH][VALIDATE] missingFiles={}", missing_local);

  if appdata_abs == 0 && remote_icon == 0 && providerless == 0 && asset_urls_persisted == 0 && missing_local == 0 {
    details.push("All paths are portable. No absolute paths, asset URLs, remote icon fields, or providerless folders found.".to_string());
  }

  Ok(serde_json::json!({
    "absolutePaths": appdata_abs,
    "assetUrlsPersisted": asset_urls_persisted,
    "remoteIconFields": remote_icon,
    "providerlessAchievementFolders": providerless,
    "missingFiles": missing_local,
    "details": details,
  }))
}

// ===================================================================
// Validate: check a single appId's generated achievements.json for
// remote URLs in icon fields, and count local icon fields (Part 7).
// ===================================================================

#[tauri::command]
pub fn validate_generated_achievement_schema(app_handle: AppHandle, app_id: u32) -> Result<Value, String> {
  let cache_dir = get_achievement_cache_dir(&app_handle, app_id)
    .map_err(|e| format!("Failed to get cache dir: {}", e))?;
  let achievements_path = cache_dir.join("achievements.json");

  if !achievements_path.exists() {
    return Ok(serde_json::json!({
      "appId": app_id,
      "total": 0,
      "remoteIconFields": 0,
      "localIconFields": 0,
      "missingLocalFiles": 0,
      "details": ["No achievements.json found"]
    }));
  }

  let content = fs::read_to_string(&achievements_path)
    .map_err(|e| format!("Failed to read achievements.json: {}", e))?;

  let entries: Vec<AppAchievementCacheEntry> = serde_json::from_str(&content)
    .map_err(|e| format!("Failed to parse achievements.json: {}", e))?;

  let total = entries.len();
  let mut remote_icon_fields = 0u32;
  let mut local_icon_fields = 0u32;
  let mut missing_local_files = 0u32;
  let img_dir = cache_dir.join("img");
  let mut details: Vec<String> = vec![];

  for entry in &entries {
    // Check icon field
    if let Some(ref icon) = entry.icon_url {
      if icon.starts_with("http://") || icon.starts_with("https://") {
        remote_icon_fields += 1;
        details.push(format!("REMOTE_ICON: apiName={} icon={}", entry.api_name, icon));
      } else if icon.starts_with("img/") {
        local_icon_fields += 1;
        let fname = icon.trim_start_matches("img/");
        let disk_path = img_dir.join(fname);
        if !disk_path.exists() {
          missing_local_files += 1;
          details.push(format!("MISSING: apiName={} icon={}", entry.api_name, icon));
        }
      }
    }

    // Check icon_gray field
    if let Some(ref gray) = entry.icon_gray_url {
      if gray.starts_with("http://") || gray.starts_with("https://") {
        remote_icon_fields += 1;
        details.push(format!("REMOTE_ICON: apiName={} icon_gray={}", entry.api_name, gray));
      } else if gray.starts_with("img/") {
        local_icon_fields += 1;
        let fname = gray.trim_start_matches("img/");
        let disk_path = img_dir.join(fname);
        if !disk_path.exists() {
          missing_local_files += 1;
          details.push(format!("MISSING: apiName={} icon_gray={}", entry.api_name, gray));
        }
      }
    }
  }

  schema_log!("[ACH][SCHEMA_VALIDATE] appid={}", app_id);
  schema_log!("[ACH][SCHEMA_VALIDATE] total={}", total);
  schema_log!("[ACH][SCHEMA_VALIDATE] remoteIconFields={}", remote_icon_fields);
  schema_log!("[ACH][SCHEMA_VALIDATE] localIconFields={}", local_icon_fields);
  schema_log!("[ACH][SCHEMA_VALIDATE] missingLocalFiles={}", missing_local_files);

  Ok(serde_json::json!({
    "appId": app_id,
    "total": total,
    "remoteIconFields": remote_icon_fields,
    "localIconFields": local_icon_fields,
    "missingLocalFiles": missing_local_files,
    "details": details,
  }))
}

// ---------------------------------------------------------------------------
// read_achievement_progress_index — reads the global achievement_progress.json
// from config/librarycache/. Returns the parsed entries as a map of
// appId → { unlocked, total, percentage, allUnlocked, cacheTime }.
// Used by the watcher to detect which games changed when this file is written.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct AchievementProgressEntry {
  pub app_id: u32,
  pub unlocked: u32,
  pub total: u32,
  pub percentage: f64,
  pub all_unlocked: bool,
  pub cache_time: u64,
}

#[tauri::command]
pub fn read_achievement_progress_index(
  steam_path: Option<String>,
  steam_account_id: String,
) -> Result<Vec<AchievementProgressEntry>, String> {
  let steam_root = resolve_steam_root(steam_path.as_deref())
    .map_err(|e| format!("Steam root not found: {}", e))?;

  let progress_path = steam_root
    .join("userdata")
    .join(&steam_account_id)
    .join("config")
    .join("librarycache")
    .join("achievement_progress.json");

  if !progress_path.is_file() {
    return Ok(vec![]);
  }

  let raw = std::fs::read_to_string(&progress_path)
    .map_err(|e| format!("Failed to read achievement_progress.json: {}", e))?;

  let parsed: serde_json::Value = serde_json::from_str(&raw)
    .map_err(|e| format!("Failed to parse achievement_progress.json: {}", e))?;

  let mut entries = Vec::new();

  // Format: { nVersion: 3, mapCache: [[appid, { appid, unlocked, total, percentage, all_unlocked, cache_time, vetted }], ...] }
  if let Some(map_cache) = parsed.get("mapCache").and_then(|v| v.as_array()) {
    for item in map_cache {
      if let Some(arr) = item.as_array() {
        if arr.len() >= 2 {
          if let Some(obj) = arr[1].as_object() {
            let app_id = obj.get("appid")
              .and_then(|v| v.as_u64())
              .unwrap_or(0) as u32;
            let unlocked = obj.get("unlocked")
              .and_then(|v| v.as_u64())
              .unwrap_or(0) as u32;
            let total = obj.get("total")
              .and_then(|v| v.as_u64())
              .unwrap_or(0) as u32;
            let percentage = obj.get("percentage")
              .and_then(|v| v.as_f64())
              .unwrap_or(0.0);
            let all_unlocked = obj.get("all_unlocked")
              .and_then(|v| v.as_bool())
              .unwrap_or(false);
            let cache_time = obj.get("cache_time")
              .and_then(|v| v.as_u64())
              .unwrap_or(0);

            if total > 0 {
              entries.push(AchievementProgressEntry {
                app_id,
                unlocked,
                total,
                percentage,
                all_unlocked,
                cache_time,
              });
            }
          }
        }
      }
    }
  }

  progress_log!("[ACH][PROGRESS_INDEX] parsed {} entries from achievement_progress.json", entries.len());
  Ok(entries)
}

// ---------------------------------------------------------------------------
// generate_achievement_schema — auto-generate canonical achievement schema
// ---------------------------------------------------------------------------
// Reads UserGameStatsSchema_*.bin (KV binary) for schema entries with stat_id/bit.
// Optionally enriches with Steam Web API (display names, icons, descriptions).
// Optionally reads UserGameStats_*.bin for unlock status via bitfield extraction.
// Writes achievements/steam/<appId>/achievements.json as the single source of truth.
// Reference: Achievements-1.2.2/generate_achievements_schema.js

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateSchemaResult {
  pub entries_count: u32,
  pub source: String,
  pub icons_downloaded: u32,
  pub progress_available: bool,
  pub error: Option<String>,
}

#[tauri::command]
pub fn generate_achievement_schema(
  app_handle: AppHandle,
  app_id: u32,
  steam_path: Option<String>,
  steam_account_id: Option<String>,
  steam_web_api_key: Option<String>,
  platform: Option<String>,
) -> Result<GenerateSchemaResult, String> {
  // Respect the platform param from the frontend — never override.
  // "steam-official" = KV binary writes to steam-official/<appId>/
  // "steam" = crack path writes to steam/<appId>/
  schema_log!("[ACH][SCHEMA_GEN] === generate schema app_id={} platform={} ===", app_id, platform.as_deref().unwrap_or("steam-official"));

  // Step 1: Read KV binary schema
  let steam_root = resolve_steam_root(steam_path.as_deref())?;
  let stats_dir = find_appcache_stats_dir(&steam_root);
  let schema_path = stats_dir.join(format!("UserGameStatsSchema_{}.bin", app_id));

  let kv_entries = if schema_path.is_file() {
    // Steam creates the bin file immediately on game launch but writes content asynchronously.
    // If the file is too small, Steam hasn't finished writing yet — tell the caller to retry.
    let file_size = schema_path.metadata().map(|m| m.len()).unwrap_or(0);
    if file_size < 100 {
      schema_log!("[ACH][SCHEMA_GEN] schema file too small ({} bytes), Steam still writing: {}", file_size, schema_path.display());
      return Ok(GenerateSchemaResult {
        entries_count: 0,
        source: "schema-not-ready".to_string(),
        icons_downloaded: 0,
        progress_available: false,
        error: Some(format!("Schema file too small ({} bytes) — Steam still writing {}", file_size, schema_path.display())),
      });
    }
    match read_and_parse_schema(&schema_path) {
      Ok(entries) => {
        let with_stat_id = entries.iter().filter(|e| e.stat_id.is_some()).count();
        let with_bit = entries.iter().filter(|e| e.bit.is_some()).count();
        let with_progress = entries.iter().filter(|e| e.progress_stat_id.is_some()).count();
        schema_log!("[ACH][SCHEMA_GEN] KV schema: {} entries, with_stat_id={}, with_bit={}, with_progress={}", entries.len(), with_stat_id, with_bit, with_progress);
        entries
      }
      Err(e) => {
        schema_log!("[ACH][SCHEMA_GEN] KV schema failed: {}", e);
        vec![]
      }
    }
  } else {
    schema_log!("[ACH][SCHEMA_GEN] schema file not found: {}", schema_path.display());
    vec![]
  };

  if kv_entries.is_empty() {
    return Ok(GenerateSchemaResult {
      entries_count: 0,
      source: "no-schema-file".to_string(),
      icons_downloaded: 0,
      progress_available: false,
      error: Some(format!("No schema entries found in {}", schema_path.display())),
    });
  }

  // Step 2: Read binary stats for unlock status (bitfield extraction)
  let mut unlock_map: std::collections::HashMap<String, (bool, Option<u64>)> = std::collections::HashMap::new();
  let mut progress_available = false;

  // If KV parser extracted entries with stat_id+bit, progress metadata is available
  // (even if stats binary isn't read yet — unlock status comes from binary stats later)
  if kv_entries.iter().any(|e| e.stat_id.is_some() && e.bit.is_some()) {
    progress_available = true;
    schema_log!("[ACH][SCHEMA_GEN] progress_available=true (entries have stat_id+bit)");
  }

  if let Some(ref acc_id) = steam_account_id {
    let stats_path = stats_dir.join(format!("UserGameStats_{}_{}.bin", acc_id, app_id));
    if stats_path.is_file() {
      match fs::read(&stats_path) {
        Ok(raw_data) => {
          // Parse the KV tree ONCE to get both stat values AND AchievementTimes
          if let Ok((_root_name, tree)) = kv_parse(&raw_data) {
            let tree_value = serde_json::Value::Object(tree);

            // Extract stat_id → data_u32 (bitmask) from the tree
            let mut stats_map: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
            let mut stat_times: std::collections::HashMap<u32, std::collections::HashMap<u32, u64>> = std::collections::HashMap::new();
            collect_stat_times(&tree_value, &[], &mut stat_times);

            // Walk tree again to extract stat values
            if let serde_json::Value::Object(ref root) = tree_value {
              for (key, val) in root {
                if let serde_json::Value::Object(obj) = val {
                  if let Some(serde_json::Value::Number(n)) = obj.get("data") {
                    if let Ok(stat_id) = key.parse::<u32>() {
                      // Negative i32 (e.g. -16 for 0xFFFFFFF0) needs i64→u32 cast to preserve bits.
                      let v = n.as_u64()
                        .unwrap_or_else(|| n.as_i64().unwrap_or(0) as u64);
                      stats_map.insert(stat_id, v as u32);
                    }
                  }
                }
              }
            }

            // AchievementTimes is AUTHORITATIVE for unlock detection.
            // The bitmask (data_u32) can be stale: bits set without timestamps (false positives)
            // or timestamps without bits set (false negatives).
            // Reference app: earned = ts !== null
            for entry in &kv_entries {
              if let (Some(stat_id), Some(bit)) = (entry.stat_id, entry.bit) {
                let has_timestamp = stat_times
                  .get(&stat_id)
                  .and_then(|bt| bt.get(&bit))
                  .is_some();

                if has_timestamp {
                  // Timestamp exists → achievement IS unlocked (authoritative)
                  let ts = stat_times[&stat_id][&bit];
                  unlock_map.insert(entry.api_name.clone(), (true, Some(ts)));
                } else {
                  // No timestamp → achievement is NOT unlocked
                  // (even if bitmask has the bit set — bitmask can be stale)
                  unlock_map.insert(entry.api_name.clone(), (false, None));
                }
                progress_available = true;
              }
            }

            schema_log!("[ACH][SCHEMA_GEN] binary stats: {} stat pairs, {} unlocked (from timestamps), progress={}",
              stats_map.len(),
              unlock_map.values().filter(|(u, _)| *u).count(),
              progress_available,
            );

            // Fallback: if no entries matched via timestamps (no stat_id/bit in schema),
            // try proto heuristic parser which extracts unlocked booleans directly.
            if !progress_available {
              schema_log!("[ACH][SCHEMA_GEN] no timestamp matches, trying proto heuristic parser...");
              match try_parse_stats_proto(&raw_data) {
                Ok(achievements) => {
                  if !achievements.is_empty() {
                    // First pass: exact name match
                    for ach in &achievements {
                      if kv_entries.iter().any(|e| e.api_name == ach.api_name) {
                        unlock_map.insert(ach.api_name.clone(), (ach.unlocked, ach.unlock_time));
                        progress_available = true;
                      }
                    }
                    // Second pass: fuzzy match (strip common prefixes, lowercase, compare)
                    if !progress_available {
                      for kv_entry in &kv_entries {
                        if let Some(ach) = achievements.iter().find(|a| {
                          fuzzy_achievement_name_match(&a.api_name, &kv_entry.api_name)
                        }) {
                          unlock_map.insert(kv_entry.api_name.clone(), (ach.unlocked, ach.unlock_time));
                          progress_available = true;
                        }
                      }
                    }
                    schema_log!("[ACH][SCHEMA_GEN] proto heuristic: {} achievements, {} matched, progress={}",
                      achievements.len(),
                      unlock_map.len(),
                      progress_available,
                    );
                  } else {
                    schema_log!("[ACH][SCHEMA_GEN] proto heuristic returned 0 entries");
                  }
                }
                Err(e) => {
                  schema_log!("[ACH][SCHEMA_GEN] proto heuristic failed: {}", e);
                }
              }
            }
          } else {
            schema_log!("[ACH][SCHEMA_GEN] KV stats parse failed");
          }
        }
        Err(e) => {
          schema_log!("[ACH][SCHEMA_GEN] stats read failed: {}", e);
        }
      }
    } else {
      schema_log!("[ACH][SCHEMA_GEN] stats file not found: {}", stats_path.display());
    }
  }

  // Step 3: Enrich with Steam Web API (display names, icons, descriptions)
  let mut api_enriched = false;
  eprintln!("[ACH][SCHEMA_GEN] appid={} api_key_present={} api_key_len={}", app_id, steam_web_api_key.is_some(), steam_web_api_key.as_deref().unwrap_or("").len());
  if let Some(ref api_key) = steam_web_api_key {
    if !api_key.trim().is_empty() {
      match fetch_schema_from_api(app_id, api_key) {
        Ok(api_schema) => {
          eprintln!("[ACH][SCHEMA_GEN] API SUCCESS appid={} entries_returned={}", app_id, api_schema.len());
          schema_log!("[ACH][SCHEMA_GEN] API enrichment: {} entries", api_schema.len());
          // Merge API data into kv_entries — API takes priority for display fields
          // We'll use a separate merge loop below
          api_enriched = true;

          // Step 4: Fetch global achievement percentages
          let global_pcts = fetch_global_percentages(app_id);

          // Build final entries merging KV schema + API enrichment + unlock status
          let cache_dir = get_achievement_cache_dir(&app_handle, app_id)?;
          let mut final_entries: Vec<AppAchievementCacheEntry> = Vec::new();

          for kv_entry in &kv_entries {
            let api_entry = api_schema.iter().find(|a| a.name == kv_entry.api_name);
            let (unlocked, unlock_time) = unlock_map.get(&kv_entry.api_name).copied().unwrap_or((false, None));
            let global_pct = global_pcts.iter().find(|p| p.name == kv_entry.api_name).map(|p| p.percent);

            // Icon resolution: prefer API CDN URLs (reliable), fallback to KV binary paths
            // KV binary icons are relative (e.g. "img/hash.jpg" or "hash.jpg") — convert to CDN URLs
            let icon_url = api_entry
              .and_then(|a| a.icon.clone())
              .or_else(|| kv_entry.icon.clone())
              .map(|url| kv_icon_to_cdn_url(app_id, &url));
            let icon_gray_url = api_entry
              .and_then(|a| a.icongray.clone())
              .or_else(|| kv_entry.icon_gray.clone())
              .map(|url| kv_icon_to_cdn_url(app_id, &url));

            // Display name: prefer API, fallback to KV
            let name = api_entry
              .and_then(|a| a.display_name.clone())
              .or_else(|| kv_entry.display_name.clone())
              .unwrap_or_else(|| kv_entry.api_name.clone());

            // Description: prefer API, fallback to KV
            let description = api_entry
              .and_then(|a| a.description.clone())
              .or_else(|| kv_entry.description.clone());

            // Hidden: prefer API, fallback to KV
            let hidden = api_entry
              .and_then(|a| a.hidden)
              .or_else(|| kv_entry.hidden)
              .unwrap_or(false);

            final_entries.push(AppAchievementCacheEntry {
              id: kv_entry.api_name.clone(),
              api_name: kv_entry.api_name.clone(),
              name,
              description,
              icon_url: icon_url.clone(),
              icon_gray_url: icon_gray_url.clone(),
              unlocked,
              unlock_time: unlock_time.map(|t| {
                // Normalize: if < 1000000000000 it's seconds, convert to ms
                if t > 0 && t < 1000000000000 { t * 1000 } else { t }
              }),
              rarity_percent: global_pct,
              stat_id: kv_entry.stat_id,
              bit: kv_entry.bit,
              progress_stat_id: kv_entry.progress_stat_id,
              progress_min: kv_entry.progress_min,
              progress_max: kv_entry.progress_max,
            });
          }

          // Sort: unlocked first, then alphabetical
          final_entries.sort_by(|a, b| {
            if a.unlocked != b.unlocked { return a.unlocked.cmp(&b.unlocked).reverse(); }
            a.name.cmp(&b.name)
          });

          let total = final_entries.len() as u32;
          let unlocked_count = final_entries.iter().filter(|e| e.unlocked).count() as u32;
          let percent = if total > 0 { (unlocked_count as f64 / total as f64) * 100.0 } else { 0.0 };

          let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

          let cache = AppAchievementCache {
            achievements: final_entries.clone(),
            achievement_percentages: global_pcts,
            summary: AppAchievementSummary {
              app_id: app_id.to_string(),
              total,
              unlocked: unlocked_count,
              percent,
              progress_available,
              source: if progress_available { "schema-generated".to_string() } else { "schema-only".to_string() },
              updated_at: now,
              cache_version: Some(7),
            },
          };

          // Only write cache if entries have real data (stat_id/bit from KV parser)
          // Don't overwrite existing good cache with text fallback entries (no stat_id)
          let has_stat_id = final_entries.iter().any(|e| e.stat_id.is_some() && e.bit.is_some());
          if has_stat_id || progress_available {
            let write_platform = platform.as_deref().unwrap_or("steam-official");
            let cache_dir = get_achievement_write_dir(&app_handle, app_id, write_platform)?;
            fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache dir: {}", e))?;
            let achievements_path = cache_dir.join("achievements.json");
            let summary_path = cache_dir.join("summary.json");
            let pcts_path = cache_dir.join("achievementpercentages.json");
            // Skip writes if content is identical to what's on disk
            let ach_content = serde_json::to_string_pretty(&cache.achievements).map_err(|e| e.to_string())?;
            let sum_content = serde_json::to_string_pretty(&cache.summary).map_err(|e| e.to_string())?;
            let pcts_content = serde_json::to_string_pretty(&cache.achievement_percentages).map_err(|e| e.to_string())?;
            fn write_if_changed(path: &std::path::Path, content: &str, label: &str) -> Result<(), String> {
              if path.exists() {
                if let Ok(existing) = std::fs::read_to_string(path) {
                  let normalize = |s: &str| -> String {
                    if let Some(pos) = s.find("\"updated_at\"") {
                      let mut result = s.to_string();
                      if let Some(colon_pos) = result[pos..].find(':') {
                        let val_start = pos + colon_pos + 1;
                        let bytes = result.as_bytes();
                        let mut i = val_start;
                        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
                        let num_start = i;
                        while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
                        if i > num_start {
                          let replacement = "0".repeat(i - num_start);
                          result.replace_range(num_start..i, &replacement);
                        }
                      }
                      result
                    } else {
                      s.to_string()
                    }
                  };
                  if normalize(&existing) == normalize(content) { return Ok(()); }
                }
              }
              std::fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", label, e))
            }
            write_if_changed(&achievements_path, &ach_content, "achievements")?;
            write_if_changed(&summary_path, &sum_content, "summary")?;
            write_if_changed(&pcts_path, &pcts_content, "achievementpercentages")?;
            schema_log!("[ACH][SCHEMA_GEN] written {} entries to {} (unlocked={}/{}, progress={})",
              total, cache_dir.display(), unlocked_count, total, progress_available);
          } else {
            schema_log!("[ACH][SCHEMA_GEN] skipping cache write — entries lack stat_id (text fallback)");
          }

          return Ok(GenerateSchemaResult {
            entries_count: total,
            source: "kv+api".to_string(),
            icons_downloaded: 0,
            progress_available,
            error: None,
          });
        }
        Err(e) => {
          eprintln!("[ACH][SCHEMA_GEN] API FAILED appid={} error={}", app_id, e);
          schema_log!("[ACH][SCHEMA_GEN] API enrichment failed: {}", e);
        }
      }
    } else {
      eprintln!("[ACH][SCHEMA_GEN] API SKIPPED appid={} reason=api-key-empty", app_id);
    }
  } else {
    eprintln!("[ACH][SCHEMA_GEN] API SKIPPED appid={} reason=no-api-key", app_id);
  }

  // Fallback: KV-only (no API enrichment)
  {
    let global_pcts = if !api_enriched { fetch_global_percentages(app_id) } else { vec![] };

    let mut final_entries: Vec<AppAchievementCacheEntry> = Vec::new();
    for kv_entry in &kv_entries {
      let (unlocked, unlock_time) = unlock_map.get(&kv_entry.api_name).copied().unwrap_or((false, None));
      let global_pct = global_pcts.iter().find(|p| p.name == kv_entry.api_name).map(|p| p.percent);

      final_entries.push(AppAchievementCacheEntry {
        id: kv_entry.api_name.clone(),
        api_name: kv_entry.api_name.clone(),
        name: kv_entry.display_name.clone().unwrap_or_else(|| kv_entry.api_name.clone()),
        description: kv_entry.description.clone(),
        icon_url: kv_entry.icon.clone().map(|url| kv_icon_to_cdn_url(app_id, &url)),
        icon_gray_url: kv_entry.icon_gray.clone().map(|url| kv_icon_to_cdn_url(app_id, &url)),
        unlocked,
        unlock_time: unlock_time.map(|t| if t > 0 && t < 1000000000000 { t * 1000 } else { t }),
        rarity_percent: global_pct,
        stat_id: kv_entry.stat_id,
        bit: kv_entry.bit,
        progress_stat_id: kv_entry.progress_stat_id,
        progress_min: kv_entry.progress_min,
        progress_max: kv_entry.progress_max,
      });
    }

    final_entries.sort_by(|a, b| {
      if a.unlocked != b.unlocked { return a.unlocked.cmp(&b.unlocked).reverse(); }
      a.name.cmp(&b.name)
    });

    let total = final_entries.len() as u32;
    let unlocked_count = final_entries.iter().filter(|e| e.unlocked).count() as u32;
    let percent = if total > 0 { (unlocked_count as f64 / total as f64) * 100.0 } else { 0.0 };

    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0);

    let cache = AppAchievementCache {
      achievements: final_entries.clone(),
      achievement_percentages: global_pcts,
      summary: AppAchievementSummary {
        app_id: app_id.to_string(),
        total,
        unlocked: unlocked_count,
        percent,
        progress_available,
        source: if progress_available { "schema-generated".to_string() } else { "schema-only".to_string() },
        updated_at: now,
        cache_version: Some(7),
      },
    };

    // Only write cache if entries have real data (stat_id/bit from KV parser)
    let has_stat_id = final_entries.iter().any(|e| e.stat_id.is_some() && e.bit.is_some());
    if has_stat_id || progress_available {
      let write_platform = platform.as_deref().unwrap_or("steam-official");
      let cache_dir = get_achievement_write_dir(&app_handle, app_id, write_platform)?;
      fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache dir: {}", e))?;
      let achievements_path = cache_dir.join("achievements.json");
      let summary_path = cache_dir.join("summary.json");
      let pcts_path = cache_dir.join("achievementpercentages.json");
      let ach_content = serde_json::to_string_pretty(&cache.achievements).map_err(|e| e.to_string())?;
      let sum_content = serde_json::to_string_pretty(&cache.summary).map_err(|e| e.to_string())?;
      let pcts_content = serde_json::to_string_pretty(&cache.achievement_percentages).map_err(|e| e.to_string())?;
      fn write_if_changed(path: &std::path::Path, content: &str, label: &str) -> Result<(), String> {
        if path.exists() {
          if let Ok(existing) = std::fs::read_to_string(path) {
            let normalize = |s: &str| -> String {
              if let Some(pos) = s.find("\"updated_at\"") {
                let mut result = s.to_string();
                if let Some(colon_pos) = result[pos..].find(':') {
                  let val_start = pos + colon_pos + 1;
                  let bytes = result.as_bytes();
                  let mut i = val_start;
                  while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
                  let num_start = i;
                  while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
                  if i > num_start {
                    let replacement = "0".repeat(i - num_start);
                    result.replace_range(num_start..i, &replacement);
                  }
                }
                result
              } else {
                s.to_string()
              }
            };
            if normalize(&existing) == normalize(content) { return Ok(()); }
          }
        }
        std::fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", label, e))
      }
      write_if_changed(&achievements_path, &ach_content, "achievements")?;
      write_if_changed(&summary_path, &sum_content, "summary")?;
      write_if_changed(&pcts_path, &pcts_content, "achievementpercentages")?;
      schema_log!("[ACH][SCHEMA_GEN] KV-only: {} entries written to {} (unlocked={}/{}, progress={})",
        total, cache_dir.display(), unlocked_count, total, progress_available);
    } else {
      schema_log!("[ACH][SCHEMA_GEN] KV-only: skipping cache write — entries lack stat_id");
    }

    Ok(GenerateSchemaResult {
      entries_count: total,
      source: if progress_available { "kv-binary".to_string() } else { "kv-only".to_string() },
      icons_downloaded: 0,
      progress_available,
      error: None,
    })
  }
}

/// Convert a KV binary icon path (relative) to a full Steam CDN URL.
/// KV icons are like "img/hash.jpg" or "hash.jpg" — CDN URLs are
/// `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/{appid}/{hash}`
fn kv_icon_to_cdn_url(app_id: u32, path: &str) -> String {
  // Already a full URL — return as-is
  if path.starts_with("http://") || path.starts_with("https://") {
    return path.to_string();
  }
  // Extract just the hash/filename from relative paths like "img/hash.jpg"
  let hash = path.rsplit('/').next().unwrap_or(path);
  format!(
    "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/{}/{}",
    app_id, hash
  )
}

/// Fuzzy match between a proto-heuristic achievement name and a KV schema api_name.
/// Strips common prefixes/suffixes, lowercases, and compares.
fn fuzzy_achievement_name_match(proto_name: &str, schema_name: &str) -> bool {
  let normalize = |s: &str| -> String {
    s.trim()
      .to_lowercase()
      .replace(['-', ' ', '.'], "_")
      .chars()
      .filter(|c| c.is_alphanumeric() || *c == '_')
      .collect()
  };

  let pn = normalize(proto_name);
  let sn = normalize(schema_name);

  // Exact match after normalization
  if pn == sn {
    return true;
  }

  // One contains the other
  if pn.contains(&sn) || sn.contains(&pn) {
    return true;
  }

  // Strip common prefixes and compare
  let strip_prefixes = ["ach_", "achievement_", "progress_", "stat_"];
  for prefix in &strip_prefixes {
    let pn_stripped = pn.strip_prefix(prefix).unwrap_or(&pn);
    let sn_stripped = sn.strip_prefix(prefix).unwrap_or(&sn);
    if pn_stripped == sn_stripped {
      return true;
    }
    if pn_stripped.contains(sn_stripped) || sn_stripped.contains(pn_stripped) {
      return true;
    }
  }

  false
}

/// Fetch schema from Steam Web API (GetSchemaForGame/v2).
/// Returns parsed achievement entries with display names, icons, descriptions.
fn fetch_schema_from_api(
  app_id: u32,
  api_key: &str,
) -> Result<Vec<SchemaAchievementFromApi>, String> {
  let url = format!(
    "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid={}&key={}",
    app_id, api_key
  );
  let client = build_client()?;
  let response = client.get(&url).send()
    .map_err(|e| format!("Schema API request failed: {}", e))?;

  if !response.status().is_success() {
    return Err(format!("Schema API returned HTTP {}", response.status()));
  }

  let body: serde_json::Value = response.json()
    .map_err(|e| format!("Failed to parse schema API response: {}", e))?;

  let achievements = body
    .get("game")
    .and_then(|g| g.get("availableGameStats"))
    .and_then(|s| s.get("achievements"))
    .and_then(|a| a.as_array())
    .cloned()
    .unwrap_or_default();

  let mut result = Vec::new();
  for ach in &achievements {
    let name = ach.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if name.is_empty() { continue; }

    result.push(SchemaAchievementFromApi {
      name: name.clone(),
      display_name: ach.get("displayName").and_then(|v| v.as_str()).map(|s| s.to_string()),
      description: ach.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
      hidden: ach.get("hidden").and_then(|v| v.as_u64()).map(|h| h != 0),
      icon: ach.get("icon").and_then(|v| v.as_str()).map(|s| s.to_string()),
      icongray: ach.get("icongray").and_then(|v| v.as_str()).map(|s| s.to_string()),
    });
  }

  Ok(result)
}

#[derive(Debug, Clone)]
struct SchemaAchievementFromApi {
  name: String,
  display_name: Option<String>,
  description: Option<String>,
  hidden: Option<bool>,
  icon: Option<String>,
  icongray: Option<String>,
}

/// Fetch global achievement percentages for rarity display.
fn fetch_global_percentages(app_id: u32) -> Vec<AppAchievementPercentagesEntry> {
  let url = format!(
    "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={}&format=json",
    app_id
  );
  let client = match build_client() {
    Ok(c) => c,
    Err(_) => return vec![],
  };
  let response = match client.get(&url).send() {
    Ok(r) => r,
    Err(_) => return vec![],
  };
  if !response.status().is_success() {
    return vec![];
  }
  let body: serde_json::Value = match response.json() {
    Ok(v) => v,
    Err(_) => return vec![],
  };

  let achievements = body
    .get("achievementpercentages")
    .and_then(|a| a.get("achievements"))
    .and_then(|a| a.as_array())
    .cloned()
    .unwrap_or_default();

  achievements.iter().filter_map(|a| {
    let name = a.get("name")?.as_str()?.to_string();
    let percent = a.get("percent")?.as_f64()?;
    Some(AppAchievementPercentagesEntry { name, percent })
  }).collect()
}

/// Download a single achievement icon to the cache img/ directory.
fn download_achievement_icon(
  app_handle: &AppHandle,
  app_id: u32,
  url: &str,
  is_gray: bool,
) -> Result<bool, String> {
  let cache_dir = get_achievement_cache_dir(app_handle, app_id)?;
  let img_dir = cache_dir.join("img");
  fs::create_dir_all(&img_dir).map_err(|e| format!("Failed to create img dir: {}", e))?;

  // Extract filename from URL
  let filename = url.rsplit('/').next().unwrap_or("");
  if filename.is_empty() {
    return Err("Empty filename from URL".to_string());
  }

  // For gray icons, ensure _gray suffix
  let final_filename = if is_gray && !filename.contains("_gray") {
    let base = if let Some(pos) = filename.rfind('.') {
      &filename[..pos]
    } else {
      filename
    };
    let ext = if let Some(pos) = filename.rfind('.') {
      &filename[pos..]
    } else {
      ".jpg"
    };
    format!("{}_gray{}", base, ext)
  } else {
    filename.to_string()
  };

  let dest = img_dir.join(&final_filename);
  if dest.exists() {
    return Ok(false); // Already exists
  }

  // Download
  let client = build_client()?;
  let response = client.get(url).send()
    .map_err(|e| format!("Icon download failed: {}", e))?;
  if !response.status().is_success() {
    return Err(format!("Icon download HTTP {}", response.status()));
  }

  let bytes = response.bytes()
    .map_err(|e| format!("Failed to read icon bytes: {}", e))?;
  fs::write(&dest, &bytes)
    .map_err(|e| format!("Failed to write icon: {}", e))?;

  Ok(true)
}

/// Collect achievement unlock timestamps from KV tree, keyed by stat_id → bit → timestamp.
fn collect_stat_times(
  obj: &serde_json::Value,
  path: &[&str],
  result: &mut std::collections::HashMap<u32, std::collections::HashMap<u32, u64>>,
) {
  if let serde_json::Value::Object(map) = obj {
    // Check if this node has a "data" field (stat entry) and AchievementTimes child
    if let Some(serde_json::Value::Number(_)) = map.get("data") {
      // This is a stat node — its last path segment is the stat_id
      if let Some(stat_id) = path.last().and_then(|s| s.parse::<u32>().ok()) {
        let times_keys = ["AchievementTimes", "achievementTimes", "AchievementsTimes", "achievement_times"];
        for key in &times_keys {
          if let Some(serde_json::Value::Object(times)) = map.get(*key) {
            let mut bit_times = std::collections::HashMap::new();
            for (bit_str, ts_val) in times {
              if let Some(bit) = bit_str.parse::<u32>().ok() {
                if let Some(ts) = ts_val.as_u64() {
                  bit_times.insert(bit, ts);
                }
              }
            }
            if !bit_times.is_empty() {
              result.insert(stat_id, bit_times);
            }
          }
        }
      }
    }

    // Recurse into child objects
    for (k, v) in map {
      let mut child_path = path.to_vec();
      child_path.push(k);
      collect_stat_times(v, &child_path, result);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Regression: negative i32 bitmask (e.g. -16 = 0xFFFFFFF0) must preserve bits.
  #[test]
  fn kv_extract_user_stats_preserves_negative_i32_bitmask() {
    use serde_json::json;

    // Build a minimal tree: root "cache" → stat_id "2" with data=-16
    let mut root_map = serde_json::Map::new();
    let mut stat_node = serde_json::Map::new();
    // -16 as i32 → 0xFFFFFFF0 bitmask (bits 4-31 set)
    stat_node.insert("data".into(), json!(-16i32));
    stat_node.insert("state".into(), json!(2));
    root_map.insert("2".into(), Value::Object(stat_node));

    // stat_id=1 with data=100 (positive, unaffected)
    let mut stat1 = serde_json::Map::new();
    stat1.insert("data".into(), json!(100));
    root_map.insert("1".into(), Value::Object(stat1));

    // stat_id=5 with data=16383 (positive, unaffected)
    let mut stat5 = serde_json::Map::new();
    stat5.insert("data".into(), json!(16383));
    root_map.insert("5".into(), Value::Object(stat5));

    let result = kv_extract_user_stats(&root_map);

    // Find stat_id=2 entry
    let entry2 = result.iter().find(|(sid, _, _)| sid == "2").expect("stat_id 2 missing");
    assert_eq!(entry2.1, 0xFFFFFFF0, "Negative i32 -16 must produce bitmask 0xFFFFFFF0, got {:#x}", entry2.1);

    // Verify bit 4 and bit 31 are set
    assert_ne!(entry2.1 & (1 << 4), 0, "Bit 4 must be set");
    assert_ne!(entry2.1 & (1 << 31), 0, "Bit 31 must be set");
    assert_eq!(entry2.1 & (1 << 0), 0, "Bit 0 must be clear");

    // stat_id=1 and stat_id=5 unchanged
    let entry1 = result.iter().find(|(sid, _, _)| sid == "1").expect("stat_id 1 missing");
    assert_eq!(entry1.1, 100);
    let entry5 = result.iter().find(|(sid, _, _)| sid == "5").expect("stat_id 5 missing");
    assert_eq!(entry5.1, 16383);
  }
}

// ===================================================================
// Scan both achievement schema folders and return summaries with
// source derived from the folder name: "steam" = crack, "steam-official"
// = official Steam. Used by ActivityStats GameAchievementsCards.
// ===================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderAchievementSummary {
    pub app_id: String,
    pub source: String,
    pub total: u32,
    pub unlocked: u32,
    pub percent: f64,
}

#[tauri::command]
pub fn scan_achievement_folders(app_handle: AppHandle) -> Result<Vec<FolderAchievementSummary>, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let schema_dir = app_dir.join("achievements").join("schema");
    let mut results: Vec<FolderAchievementSummary> = Vec::new();

    for (platform, source_label) in [("steam", "crack"), ("steam-official", "steam"), ("epic-official", "epic")] {
        let platform_dir = schema_dir.join(platform);
        if !platform_dir.exists() {
            continue;
        }

        let entries = match fs::read_dir(&platform_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let summary_path = entry.path().join("summary.json");
            if !summary_path.exists() {
                continue;
            }

            let content = match fs::read_to_string(&summary_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let summary: AppAchievementSummary = match serde_json::from_str(&content) {
                Ok(s) => s,
                Err(_) => continue,
            };

            // Use app_id from summary.json (matches game.appId in TypeScript)
            // Fall back to folder name for legacy cache entries
            let app_id = if summary.app_id.is_empty() {
                entry.file_name().to_string_lossy().to_string()
            } else {
                summary.app_id.clone()
            };

            if summary.total == 0 {
                continue;
            }

            results.push(FolderAchievementSummary {
                app_id,
                source: source_label.to_string(),
                total: summary.total,
                unlocked: summary.unlocked,
                percent: summary.percent,
            });
        }
    }

    Ok(results)
}
