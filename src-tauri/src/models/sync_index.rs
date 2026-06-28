use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncIndexItem {
    pub app_id: String,
    pub source_key: String,
    pub provider_id: String,
    pub provider_name: String,
    pub file_type: String,
    pub installed_path: String,
    pub last_download_url: String,
    pub remote_hash: Option<String>,
    pub local_hash: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub installed_at: String,
    pub updated_at: String,
    pub last_checked_at: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncIndex {
    pub version: u32,
    pub items: std::collections::HashMap<String, SyncIndexItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCheckResult {
    pub app_id: String,
    pub status: String,
    pub has_update: bool,
    pub message: String,
}
