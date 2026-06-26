
use serde::Serialize;

#[derive(Serialize)]
pub struct InstallResult {
    pub lua_installed: usize,
    pub manifests_installed: usize,
    pub backups_created: usize,
    pub message: String,
}
