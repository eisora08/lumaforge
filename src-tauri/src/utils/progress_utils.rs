use tauri::{AppHandle, Emitter};

use crate::models::install_progress::{InstallProgressEvent, InstallerNetworkEvent};

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

/// Emits live torrent swarm stats (connected peers + serving seeds) for a job.
/// Separate from `installer-progress` so the existing progress signature stays
/// untouched for all 46+ call sites across the install pipeline.
pub fn emit_installer_network(app_handle: &AppHandle, job_id: &str, peers: u32, seeds: u32) {
    let payload = InstallerNetworkEvent {
        job_id: job_id.to_string(),
        peers,
        seeds,
    };

    let _ = app_handle.emit("installer-network", payload);
}