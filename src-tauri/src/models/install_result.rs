use serde::Serialize;

#[derive(Serialize)]
pub struct InstallResult {
    pub lua_installed: usize,
    pub manifests_installed: usize,
    pub backups_created: usize,
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub zip_path: String,
    pub message: String,
}