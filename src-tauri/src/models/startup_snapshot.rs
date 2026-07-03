use serde::{Deserialize, Serialize};

pub const STARTUP_SNAPSHOT_VERSION: u32 = 1;
#[allow(dead_code)]
pub const STALE_THRESHOLD_SECS: u64 = 86400; // 24 hours

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupSnapshot {
    pub version: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    pub library: SnapshotLibrary,
    pub sidebar: SnapshotSidebar,
    pub indexes: SnapshotIndexes,
    #[serde(rename = "lastKnownStats")]
    pub last_known_stats: Option<SnapshotStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotLibrary {
    pub games: Vec<SnapshotGame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotGame {
    #[serde(rename = "appId")]
    pub app_id: String,
    pub provider: String,
    pub title: String,
    pub installed: bool,
    pub playable: bool,
    pub source: String,
    #[serde(rename = "installPath")]
    pub install_path: Option<String>,
    pub media: SnapshotGameMedia,
    #[serde(rename = "lastPlayed")]
    pub last_played: Option<u64>,
    pub playtime: Option<u64>,
    #[serde(rename = "cloudStatus")]
    pub cloud_status: Option<String>,
    #[serde(rename = "mediaStatus")]
    pub media_status: Option<String>,
    #[serde(rename = "missingMedia")]
    pub missing_media: Option<Vec<String>>,
    #[serde(rename = "lastMediaCheckAt")]
    pub last_media_check_at: Option<u64>,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub hidden: Option<bool>,
    #[serde(rename = "achievementSummary", default)]
    pub achievement_summary: Option<SnapshotAchievementSummary>,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotAchievementSummary {
    pub total: u32,
    pub unlocked: u32,
    pub percent: f64,
    #[serde(rename = "progressAvailable")]
    pub progress_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotGameMedia {
    #[serde(rename = "landscapePath")]
    pub landscape_path: Option<String>,
    #[serde(rename = "coverPath")]
    pub cover_path: Option<String>,
    #[serde(rename = "backgroundPath")]
    pub background_path: Option<String>,
    #[serde(rename = "logoPath")]
    pub logo_path: Option<String>,
    #[serde(rename = "iconPath")]
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotSidebar {
    pub items: Vec<SnapshotSidebarItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotSidebarItem {
    #[serde(rename = "appId")]
    pub app_id: String,
    pub title: String,
    pub provider: String,
    pub media: SnapshotSidebarMedia,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotSidebarMedia {
    #[serde(rename = "landscapePath")]
    pub landscape_path: Option<String>,
    #[serde(rename = "coverPath")]
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotIndexes {
    #[serde(rename = "appIds")]
    pub app_ids: Vec<String>,
    #[serde(rename = "mediaReadyAppIds")]
    pub media_ready_app_ids: Vec<String>,
    #[serde(rename = "luaFingerprint", default)]
    pub lua_fingerprint: Option<String>,
    #[serde(rename = "appinfoFingerprint", default)]
    pub appinfo_fingerprint: Option<String>,
    #[serde(rename = "dashboardFingerprint", default)]
    pub dashboard_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotStats {
    pub entries: Vec<SnapshotStatsEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotStatsEntry {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "lastPlayed")]
    pub last_played: Option<u64>,
    pub playtime: Option<u64>,
    #[serde(rename = "cloudStatus")]
    pub cloud_status: Option<String>,
}
