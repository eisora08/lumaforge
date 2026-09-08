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

#[tauri::command]
pub fn delete_directory(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_dir_all(p).map_err(|e| format!("Failed to delete directory {}: {}", path, e))?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ScannedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[tauri::command]
pub fn scan_directory_recursive(
    path: String,
    max_depth: Option<u32>,
) -> Result<Vec<ScannedFile>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let depth = max_depth.unwrap_or(10);
    let mut results = Vec::new();
    scan_dir_recursive_inner(root, depth, 0, &mut results)?;
    Ok(results)
}

fn scan_dir_recursive_inner(
    dir: &Path,
    max_depth: u32,
    current_depth: u32,
    results: &mut Vec<ScannedFile>,
) -> Result<(), String> {
    if current_depth > max_depth {
        return Ok(());
    }
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        results.push(ScannedFile {
            path: path_str,
            name,
            size: metadata.len(),
            is_dir,
        });
        if is_dir {
            scan_dir_recursive_inner(&path, max_depth, current_depth + 1, results)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    let metadata =
        fs::metadata(p).map_err(|e| format!("Failed to get metadata for {}: {}", path, e))?;
    Ok(metadata.len())
}
