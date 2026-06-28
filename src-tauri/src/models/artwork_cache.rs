use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtworkCacheEntry {
    pub app_id: u32,
    pub grid_url: Option<String>,
    pub grid_thumb_url: Option<String>,
    pub hero_url: Option<String>,
    pub logo_url: Option<String>,
    pub cached_at: u64,
}

pub type ArtworkCacheIndex = HashMap<u32, ArtworkCacheEntry>;
