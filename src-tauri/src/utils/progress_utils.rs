use tauri::{AppHandle, Emitter};

use crate::models::install_progress::InstallProgressEvent;

pub fn emit_installer_progress(
    app_handle: &AppHandle,
    job_id: &str,
    status: &str,
    progress: u8,
    bytes_read: u64,
    total_bytes: u64,
    message: &str,
) {
    let payload = InstallProgressEvent {
        job_id: job_id.to_string(),
        status: status.to_string(),
        progress,
        bytes_read,
        total_bytes,
        message: message.to_string(),
    };

    let _ = app_handle.emit("installer-progress", payload);
}