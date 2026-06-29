use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryAppInfoEntry {
    pub app_id: String,
    pub name: Option<String>,
    pub header_image: Option<String>,
    pub cover_path: Option<String>,
    pub grid_path: Option<String>,
    pub hero_path: Option<String>,
    pub logo_path: Option<String>,
    pub icon_path: Option<String>,
    pub updated_at: Option<u64>,
}

pub type LibraryAppInfoMap = HashMap<String, LibraryAppInfoEntry>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryGameDetailsEntry {
    pub app_id: String,
    pub source: String,
    pub updated_at: u64,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaCacheEntry {
    pub game_key: String,
    pub app_id: Option<String>,
    pub title: Option<String>,
    pub cover_path: Option<String>,
    pub grid_path: Option<String>,
    pub hero_path: Option<String>,
    pub logo_path: Option<String>,
    pub icon_path: Option<String>,
    pub quick_cover_path: Option<String>,
    pub updated_at: Option<u64>,
}

#[allow(dead_code)]
pub type GameMediaCacheIndex = HashMap<String, GameMediaCacheEntry>;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaUrls {
    pub cover_url: Option<String>,
    pub grid_url: Option<String>,
    pub hero_url: Option<String>,
    pub logo_url: Option<String>,
    pub icon_url: Option<String>,
    pub quick_cover_url: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported_covers: usize,
    pub imported_details: usize,
    pub imported_app_info: bool,
}
