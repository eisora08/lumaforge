use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn get_profile_media_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("profile-media");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create profile-media dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub fn save_profile_media(
    app_handle: AppHandle,
    kind: String,
    extension: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let dir = get_profile_media_dir(&app_handle)?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let ext = extension.trim_start_matches('.');
    let filename = format!("{}-{}.{}", kind, timestamp, ext);
    let path = dir.join(&filename);

    // Remove old files of the same kind to avoid clutter
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&format!("{}-", kind)) && name != filename {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    // Write via temp file for atomicity
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &data).map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to rename file: {}", e))?;

    let abs = path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?;

    eprintln!("[PROFILE][MEDIA_SAVED] kind={} path={}", kind, abs.display());

    Ok(abs.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_profile_media(app_handle: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);

    // Only allow deleting files inside the profile-media directory
    let dir = get_profile_media_dir(&app_handle)?;
    let canonical = p
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {}", e))?;
    if !canonical.starts_with(&dir) {
        return Err("Cannot delete files outside profile-media directory".to_string());
    }

    if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("Failed to delete file: {}", e))?;
        eprintln!("[PROFILE][MEDIA_DELETED] path={}", p.display());
    }

    Ok(())
}
