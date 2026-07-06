use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamInstalledGame {
    pub app_id: u32,
    pub name: String,
    pub install_dir: Option<String>,
    pub library_path: String,
    pub steam_root: Option<String>,
    pub steamapps_path: String,
    pub manifest_path: String,
    pub install_path: Option<String>,
    pub state_flags: Option<u64>,
    pub size_on_disk: Option<u64>,
    pub build_id: Option<String>,
    pub last_updated: Option<u64>,
    pub bytes_downloaded: Option<u64>,
    pub bytes_to_download: Option<u64>,
    pub is_installed: bool,
}
