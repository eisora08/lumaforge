use serde::{Deserialize, Serialize};

/// Information about a single depot within a Steam app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotInfo {
    pub depot_id: u64,
    pub name: String,
    pub manifest_id: Option<String>,
    pub size_on_disk: Option<u64>,
    pub key: Option<String>,
    pub manifest_path: Option<String>,
    pub encrypted: bool,
    /// DLC app ID if this depot belongs to a DLC
    pub dlc_app_id: Option<u64>,
    /// Platform: "windows", "macos", "linux", or null for all
    pub os: Option<String>,
    /// Language if depot is language-specific
    pub language: Option<String>,
    /// Whether this is a shared redistributable (VC++, DirectX, etc.)
    pub is_shared: bool,
    /// Owning app for shared depots
    pub from_app_id: Option<u64>,
}

/// A depot selected for download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotSelection {
    pub depot_id: u64,
    pub manifest_id: String,
    pub manifest_path: String,
    pub size: u64,
}

/// A full depot download job request from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotDownloadJob {
    /// Frontend-provided job ID so events map to the queue job.
    pub job_id: Option<String>,
    pub app_id: u64,
    pub game_name: String,
    pub depots: Vec<DepotSelection>,
    pub output_dir: String,
}

/// Result from resolving depots for an app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotResolveResult {
    pub depots: Vec<DepotInfo>,
    pub game_name: String,
}

/// Result of a single depot download run.
#[derive(Debug, Clone, Serialize)]
pub struct DepotRunResult {
    pub ok: bool,
    pub error: Option<String>,
}
