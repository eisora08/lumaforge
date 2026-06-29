use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaCacheEntry {
    pub cover_path: Option<String>,
    pub grid_path: Option<String>,
    pub hero_path: Option<String>,
    pub logo_path: Option<String>,
    pub icon_path: Option<String>,
    pub updated_at: Option<u64>,
}

pub type GameMediaCacheIndex = HashMap<String, GameMediaCacheEntry>;
