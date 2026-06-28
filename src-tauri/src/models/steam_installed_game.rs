use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SteamInstalledGame {
    pub app_id: u32,
    pub name: String,
    pub install_dir: Option<String>,
    pub library_path: String,
    pub steam_root: Option<String>,
    pub manifest_path: String,
    pub install_path: Option<String>,
    pub state_flags: Option<u64>,
    pub size_on_disk: Option<u64>,
    pub build_id: Option<String>,
    pub last_updated: Option<u64>,
    pub is_installed: bool,
}
