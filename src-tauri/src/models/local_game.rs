use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDiscoveredGame {
    pub exe_path: String,
    pub file_name: String,
    pub dir_name: String,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<u64>,
}
