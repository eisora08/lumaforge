use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameAppInfo {
    #[serde(rename = "appId", alias = "app_id")]
    pub app_id: String,
    pub provider: String,
    pub name: Option<String>,
    #[serde(rename = "updatedAt", alias = "updated_at")]
    pub updated_at: Option<u64>,
    pub media: Option<GameMediaPaths>,
    pub remote: Option<GameRemoteRefs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameRemoteRefs {
    pub header_image: Option<String>,
    pub capsule_image: Option<String>,
    pub background_image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaPaths {
    #[serde(rename = "coverPath", alias = "cover_path")]
    pub cover_path: Option<String>,
    #[serde(rename = "backgroundPath", alias = "background_path")]
    pub background_path: Option<String>,
    #[serde(rename = "logoPath", alias = "logo_path")]
    pub logo_path: Option<String>,
    #[serde(rename = "iconPath", alias = "icon_path")]
    pub icon_path: Option<String>,
    #[serde(rename = "landscapePath", alias = "landscape_path")]
    pub landscape_path: Option<String>,
}

impl GameMediaPaths {
    pub fn new() -> Self {
        GameMediaPaths {
            cover_path: None,
            background_path: None,
            logo_path: None,
            icon_path: None,
            landscape_path: None,
        }
    }
}

impl Default for GameMediaPaths {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaPathsResult {
    #[serde(rename = "coverPath", alias = "cover_path")]
    pub cover_path: Option<String>,
    #[serde(rename = "coverExists")]
    pub cover_exists: bool,
    #[serde(rename = "landscapePath", alias = "landscape_path")]
    pub landscape_path: Option<String>,
    #[serde(rename = "landscapeExists")]
    pub landscape_exists: bool,
    #[serde(rename = "backgroundPath", alias = "background_path")]
    pub background_path: Option<String>,
    #[serde(rename = "backgroundExists")]
    pub background_exists: bool,
    #[serde(rename = "logoPath", alias = "logo_path")]
    pub logo_path: Option<String>,
    #[serde(rename = "logoExists")]
    pub logo_exists: bool,
    #[serde(rename = "iconPath", alias = "icon_path")]
    pub icon_path: Option<String>,
    #[serde(rename = "iconExists")]
    pub icon_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreDetails {
    pub app_id: String,
    pub source: String,
    pub updated_at: u64,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameArtwork {
    pub app_id: String,
    pub updated_at: u64,
    pub sources: ArtworkSources,
    pub steam_grid_db: Option<SteamGridDbRef>,
    pub paths: GameMediaPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtworkSources {
    pub store: String,
    pub library: String,
}

impl Default for ArtworkSources {
    fn default() -> Self {
        ArtworkSources {
            store: "steam-store".to_string(),
            library: "steamgriddb".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamGridDbRef {
    pub grid_url: Option<String>,
    pub hero_url: Option<String>,
    pub logo_url: Option<String>,
    pub icon_url: Option<String>,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationSummary {
    pub app_info_copied: usize,
    pub details_copied: usize,
    pub media_folders_moved: usize,
    pub errors: Vec<String>,
}
