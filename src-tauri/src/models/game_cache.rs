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
    /// Stores remote URLs that served as sources for each media role.
    /// e.g. { "landscape": "https://remote-source/landscape.jpg" }
    /// UI must use media.*, not mediaSources.
    #[serde(rename = "mediaSources", alias = "media_sources")]
    pub media_sources: Option<GameMediaSources>,
    pub remote: Option<GameRemoteRefs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMediaSources {
    pub landscape: Option<String>,
    pub cover: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub icon: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaManifestFile {
    pub provider: String,
    pub appid: String,
    pub version: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    pub files: MediaManifestFiles,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprints: Option<FileFingerprints>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaManifestFiles {
    pub cover: MediaManifestEntry,
    pub landscape: MediaManifestEntry,
    pub background: MediaManifestEntry,
    pub logo: MediaManifestEntry,
    pub icon: MediaManifestEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaManifestEntry {
    pub path: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "modifiedAt")]
    pub modified_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileFingerprints {
    pub lua: Option<String>,
    pub appinfo: Option<String>,
    pub dashboard: Option<String>,
}
