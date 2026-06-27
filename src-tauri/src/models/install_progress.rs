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