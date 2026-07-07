use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStateSummary {
    pub updates: u64,
    pub up_to_date: u64,
    pub unknown: u64,
    pub auth_required: u64,
    pub provider_unavailable: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanState {
    pub last_scan_at: u64,
    pub interval_hours: u64,
    pub last_result_hash: Option<String>,
    pub last_summary: Option<ScanStateSummary>,
}

fn get_scan_state_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dir = app_dir.join("store").join("provider-status");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create scan-state dir: {}", e))?;

    Ok(dir.join("scan-state.json"))
}

#[tauri::command]
pub fn read_scan_state(app_handle: AppHandle) -> Result<Option<ScanState>, String> {
    let path = get_scan_state_path(&app_handle)?;

    if !path.exists() {
        println!("[SCAN_STATE][LOAD] found=false path=\"{}\"", path.display());
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read scan-state file: {}", e))?;

    match serde_json::from_str(&content) {
        Ok(data) => {
            println!("[SCAN_STATE][LOAD] found=true path=\"{}\"", path.display());
            Ok(Some(data))
        }
        Err(e) => {
            println!(
                "[SCAN_STATE][LOAD] found=corrupt error=\"{}\" path=\"{}\"",
                e,
                path.display()
            );
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_scan_state(app_handle: AppHandle, payload: String) -> Result<(), String> {
    let path = get_scan_state_path(&app_handle)?;

    println!("[SCAN_STATE][WRITE] path=\"{}\"", path.display());

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create scan-state dir: {}", e))?;
    }

    fs::write(&path, &payload)
        .map_err(|e| format!("Failed to write scan-state file: {}", e))?;

    println!("[SCAN_STATE][WRITE_OK] path=\"{}\"", path.display());

    Ok(())
}
