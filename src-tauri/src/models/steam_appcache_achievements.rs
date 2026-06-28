use serde::{Deserialize, Serialize};

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
  pub progress_available: bool,
  pub error_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementCacheEntry {
  pub id: String,
  pub api_name: String,
  pub name: String,
  pub description: Option<String>,
  pub icon_url: Option<String>,
  pub icon_gray_url: Option<String>,
  pub unlocked: bool,
  pub unlock_time: Option<u64>,
  pub rarity_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementPercentagesEntry {
  pub name: String,
  pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppAchievementSummary {
  pub app_id: String,
  pub total: u32,
  pub unlocked: u32,
  pub percent: f64,
  pub progress_available: bool,
  pub source: String,
  pub updated_at: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppSchemaEntry {
  pub name: String,
  #[serde(default, rename = "displayName")]
  pub display_name: Option<LocaleMap>,
  #[serde(default)]
  pub description: Option<LocaleMap>,
  #[serde(default, rename = "iconGrayPath")]
  pub icon_gray_path: Option<String>,
  #[serde(default, rename = "iconPath")]
  pub icon_path: Option<String>,
  #[serde(default)]
  pub hidden: Option<bool>,
  #[serde(default, rename = "statId")]
  pub stat_id: Option<u32>,
  #[serde(default)]
  pub bit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppPercentagesFile {
  pub achievementpercentages: AchievementsAppPercentagesInner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppPercentagesInner {
  pub achievements: Vec<AchievementsAppPctEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppPctEntry {
  pub name: String,
  pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AchievementsAppSchemaResult {
  pub achievements: Vec<AppAchievementCacheEntry>,
  pub achievement_percentages: Vec<AppAchievementPercentagesEntry>,
}
