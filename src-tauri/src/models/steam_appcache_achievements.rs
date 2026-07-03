use serde::{Deserialize, Deserializer, Serialize};

/// Custom deserializer for f64 that accepts both numbers and numeric strings.
pub fn deserialize_f64<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
  D: Deserializer<'de>,
{
  use serde::de;
  struct F64Visitor;
  impl<'de> de::Visitor<'de> for F64Visitor {
    type Value = f64;
    fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
      f.write_str("a number or numeric string")
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<f64, E> { Ok(v) }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<f64, E> { Ok(v as f64) }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<f64, E> { Ok(v as f64) }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<f64, E> {
      v.trim().parse().map_err(de::Error::custom)
    }
  }
  deserializer.deserialize_any(F64Visitor)
}

pub fn deserialize_f64_option<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
  D: Deserializer<'de>,
{
  #[derive(Deserialize)]
  #[serde(untagged)]
  enum NumOrStr {
    Num(f64),
    Str(String),
    Null,
  }
  match NumOrStr::deserialize(deserializer)? {
    NumOrStr::Num(n) => Ok(Some(n)),
    NumOrStr::Str(s) => s.trim().parse().map(Some).map_err(serde::de::Error::custom),
    NumOrStr::Null => Ok(None),
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAppcacheAchievement {
  pub api_name: String,
  pub unlocked: bool,
  pub unlock_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAppcacheSchemaEntry {
  pub api_name: String,
  pub display_name: Option<String>,
  pub description: Option<String>,
  pub icon: Option<String>,
  pub icon_gray: Option<String>,
  pub hidden: Option<bool>,
  #[serde(default)]
  pub stat_id: Option<u32>,
  #[serde(default)]
  pub bit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAppcacheParsedProgress {
  pub api_name: String,
  pub unlocked: bool,
  pub stat_id: u32,
  pub value: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAppcacheScanResult {
  pub stats_file_found: bool,
  pub schema_file_found: bool,
  pub stats_file_size: Option<u64>,
  pub schema_file_size: Option<u64>,
  pub stats_file_modified: Option<u64>,
  pub schema_file_modified: Option<u64>,
  pub parsed_achievements: Vec<SteamAppcacheAchievement>,
  pub parsed_schema: Vec<SteamAppcacheSchemaEntry>,
  pub parsed_progress: Vec<SteamAppcacheParsedProgress>,
  pub parser_confidence: String,
  pub progress_available: bool,
  pub error_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementCacheEntry {
  pub id: String,
  pub api_name: String,
  pub name: String,
  pub description: Option<String>,
  /// Canonical icon field: serialized as "icon", accepts "icon_url" on read for backward compat.
  #[serde(rename = "icon", alias = "icon_url")]
  pub icon_url: Option<String>,
  /// Canonical gray icon field: serialized as "icon_gray", accepts "icon_gray_url" on read.
  #[serde(rename = "icon_gray", alias = "icon_gray_url")]
  pub icon_gray_url: Option<String>,
  pub unlocked: bool,
  pub unlock_time: Option<u64>,
  #[serde(default, deserialize_with = "deserialize_f64_option")]
  pub rarity_percent: Option<f64>,
  #[serde(default)]
  pub stat_id: Option<u32>,
  #[serde(default)]
  pub bit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementPercentagesEntry {
  pub name: String,
  #[serde(deserialize_with = "deserialize_f64")]
  pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementSummary {
  pub app_id: String,
  pub total: u32,
  pub unlocked: u32,
  pub percent: f64,
  pub progress_available: bool,
  #[serde(default = "default_source")]
  pub source: String,
  #[serde(default = "default_updated_at")]
  pub updated_at: u64,
  #[serde(default)]
  pub cache_version: Option<u32>,
}

fn default_source() -> String {
  "schema-only".to_string()
}

fn default_updated_at() -> u64 {
  0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementCache {
  pub achievements: Vec<AppAchievementCacheEntry>,
  pub achievement_percentages: Vec<AppAchievementPercentagesEntry>,
  pub summary: AppAchievementSummary,
}

// ---------------------------------------------------------------------------
// Achievements app schema JSON format
// ---------------------------------------------------------------------------

/// Locale map as stored in achievements.json
pub type LocaleMap = std::collections::HashMap<String, String>;

/// Value that can be either a plain string or a locale map
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LocaleValue {
  String(String),
  Map(LocaleMap),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppSchemaEntry {
  pub name: String,
  #[serde(default, alias = "display_name")]
  pub display_name: Option<LocaleValue>,
  #[serde(default)]
  pub description: Option<LocaleValue>,
  #[serde(default, alias = "icon_path", alias = "iconUrl", alias = "icon_url")]
  pub icon: Option<String>,
  #[serde(default, alias = "icon_gray", alias = "iconGray", alias = "icongray", alias = "icon_gray_path", alias = "iconGrayUrl", alias = "icon_gray_url")]
  pub icon_gray: Option<String>,
  #[serde(default)]
  pub hidden: Option<bool>,
  #[serde(default, alias = "stat_id")]
  pub stat_id: Option<u32>,
  #[serde(default)]
  pub bit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppPercentagesFile {
  pub achievements: Vec<AchievementsAppPctEntry>,
  #[serde(default)]
  pub appid: Option<String>,
  #[serde(default)]
  pub source: Option<String>,
  #[serde(default)]
  pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppPctEntry {
  pub name: String,
  #[serde(deserialize_with = "deserialize_f64")]
  pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppSchemaResult {
  pub achievements: Vec<AppAchievementCacheEntry>,
  pub achievement_percentages: Vec<AppAchievementPercentagesEntry>,
  pub base_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementImageStatus {
  pub api_name: String,
  pub icon_exists: bool,
  pub icon_gray_exists: bool,
}



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheAchievementEntry {
  #[serde(default, alias = "strID")]
  pub str_id: Option<String>,
  #[serde(default, alias = "strName")]
  pub str_name: Option<String>,
  #[serde(default, alias = "strDescription")]
  pub str_description: Option<String>,
  #[serde(default, alias = "bAchieved")]
  pub b_achieved: Option<bool>,
  #[serde(default, alias = "rtUnlocked")]
  pub rt_unlocked: Option<u64>,
  #[serde(default, alias = "strImage")]
  pub str_image: Option<String>,
  #[serde(default, alias = "bHidden")]
  pub b_hidden: Option<bool>,
  #[serde(default, alias = "flAchieved")]
  pub fl_achieved: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheData {
  #[serde(default, alias = "vecHighlight")]
  pub vec_highlight: Vec<LibraryCacheAchievementEntry>,
  #[serde(default, alias = "vecUnachieved")]
  pub vec_unachieved: Vec<LibraryCacheAchievementEntry>,
  #[serde(default, alias = "vecAchievedHidden")]
  pub vec_achieved_hidden: Vec<LibraryCacheAchievementEntry>,
  #[serde(default, alias = "nTotal")]
  pub n_total: Option<u32>,
  #[serde(default, alias = "nAchieved")]
  pub n_achieved: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheValue {
  #[serde(default)]
  pub version: Option<u32>,
  #[serde(default)]
  pub data: Option<LibraryCacheData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheProgress {
  pub file_found: bool,
  pub file_path: String,
  pub file_size: Option<u64>,
  pub n_total: Option<u32>,
  pub n_achieved: Option<u32>,
  pub progress_available: bool,
  pub entries: Vec<LibraryCacheAchievementEntry>,
  pub error_reason: Option<String>,
}

// ---------------------------------------------------------------------------
// Debug achievement progress models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugFileInfo {
  pub found: bool,
  pub path: String,
  pub size: Option<u64>,
  pub modified: Option<u64>,
  pub hex_preview: String,
  pub hex_preview_len: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugKvNode {
  pub field_number: u64,
  pub wire_type: u64,
  pub wire_type_name: String,
  pub value_preview: String,
  pub offset: usize,
  pub length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugMatchResult {
  pub api_name: String,
  pub display_name: Option<String>,
  pub stat_id: Option<u32>,
  pub bit: Option<u32>,
  pub stat_value: Option<u32>,
  pub unlocked_by_bit: Option<bool>,
  pub unlocked_by_v1: Option<bool>,
  pub unlock_time: Option<u64>,
  pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugAchievementReport {
  pub stats_file: DebugFileInfo,
  pub schema_file: DebugFileInfo,
  pub stats_kv_tree: Vec<DebugKvNode>,
  pub schema_kv_tree: Vec<DebugKvNode>,
  pub stat_pairs: Vec<StatPair>,
  pub achievement_entries: Vec<SteamAppcacheAchievement>,
  pub schema_entries: Vec<SteamAppcacheSchemaEntry>,
  pub app_schema: Option<AchievementsAppSchemaResult>,
  pub library_cache: Option<LibraryCacheProgress>,
  pub match_results: Vec<DebugMatchResult>,
  pub v1_match_results: Vec<DebugMatchResult>,
  pub error_reason: Option<String>,
}

// ---------------------------------------------------------------------------
// UserGameStats raw parser result
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserGameStatsRawResult {
  pub file_found: bool,
  pub file_size: Option<u64>,
  pub stat_pairs: Vec<StatPair>,
  pub achievement_entries: Vec<SteamAppcacheAchievement>,
  pub error_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatPair {
  pub stat_id: u32,
  pub value: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanCleanupResult {
  pub expected_max: usize,
  pub actual_files: usize,
  pub orphaned_files: Vec<String>,
  pub orphaned_count: usize,
}

// ---------------------------------------------------------------------------
// LibraryCache file metadata — lightweight check without parsing full JSON
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryCacheFileMetadata {
  pub file_found: bool,
  pub file_path: String,
  pub file_size: Option<u64>,
  pub modified_at: Option<u64>,
  pub error_reason: Option<String>,
}
