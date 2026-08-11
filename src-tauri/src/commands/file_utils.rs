use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// Simple file I/O commands for config/achievement services
// These replace @tauri-apps/plugin-fs which is not installed.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Ok(());
    }
    fs::create_dir_all(p).map_err(|e| format!("Failed to create directory {}: {}", path, e))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dir for {}: {}", path, e))?;
    }
    fs::write(p, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&path))
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
pub fn list_files_in_dir(path: String) -> Result<Vec<String>, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(p).map_err(|e| format!("Failed to read dir {}: {}", path, e))? {
        let entry = entry.map_err(|e| format!("entry error: {}", e))?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                files.push(name.to_string());
            }
        }
    }
    Ok(files)
}
