use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct InstallProgressEvent {
    pub job_id: String,
    pub status: String,
    pub progress: u8,
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct InstallerNetworkEvent {
    pub job_id: String,
    pub peers: u32,
    pub seeds: u32,
}