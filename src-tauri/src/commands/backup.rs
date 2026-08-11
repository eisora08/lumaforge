use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupFileInfo {
    pub relative_path: String,
    pub section: String,
    pub size: u64,
    pub checksum: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupManifest {
    pub schema_version: u32,
    pub backup_id: String,
    pub created_at: String,
    pub app_version: String,
    pub device_id: String,
    pub sections: std::collections::HashMap<String, bool>,
    pub files: Vec<BackupFileInfo>,
    pub total_size: u64,
    pub total_files: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupArchive {
    pub manifest: BackupManifest,
    pub data: std::collections::HashMap<String, String>,
}

fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub fn get_app_data_dir_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = get_app_data_dir(&app_handle)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn write_backup_archive(
    app_handle: tauri::AppHandle,
    backup_json: String,
    filename: String,
) -> Result<String, String> {
    let dir = get_app_data_dir(&app_handle)?;
    let backup_dir = dir.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("Failed to create backup dir: {}", e))?;

    let safe_name = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect::<String>();

    let path = backup_dir.join(&safe_name);
    fs::write(&path, &backup_json).map_err(|e| format!("Failed to write backup: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn read_backup_archive(
    app_handle: tauri::AppHandle,
    filename: String,
) -> Result<String, String> {
    let dir = get_app_data_dir(&app_handle)?;
    let path = dir.join("backups").join(&filename);

    if !path.exists() {
        return Err("Backup file not found".to_string());
    }

    fs::read_to_string(&path).map_err(|e| format!("Failed to read backup: {}", e))
}

#[tauri::command]
pub async fn list_backup_archives(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = get_app_data_dir(&app_handle)?;
    let backup_dir = dir.join("backups");

    if !backup_dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&backup_dir).map_err(|e| format!("Failed to read backup dir: {}", e))?;

    let mut files: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                files.push(name.to_string());
            }
        }
    }

    files.sort();
    Ok(files)
}

#[tauri::command]
pub async fn delete_backup_archive(
    app_handle: tauri::AppHandle,
    filename: String,
) -> Result<(), String> {
    let dir = get_app_data_dir(&app_handle)?;
    let path = dir.join("backups").join(&filename);

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete backup: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn validate_backup_file(
    app_handle: tauri::AppHandle,
    filename: String,
) -> Result<BackupManifest, String> {
    let content = read_backup_archive(app_handle, filename).await?;
    let archive: BackupArchive =
        serde_json::from_str(&content).map_err(|e| format!("Invalid backup format: {}", e))?;
    Ok(archive.manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backup_manifest_schema_version() {
        let manifest = BackupManifest {
            schema_version: 1,
            backup_id: "test-123".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            app_version: "0.1.0".to_string(),
            device_id: "device-test".to_string(),
            sections: std::collections::HashMap::new(),
            files: vec![],
            total_size: 0,
            total_files: 0,
        };
        assert_eq!(manifest.schema_version, 1);
    }

    #[test]
    fn test_backup_archive_serialization() {
        let archive = BackupArchive {
            manifest: BackupManifest {
                schema_version: 1,
                backup_id: "test".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                app_version: "0.1.0".to_string(),
                device_id: "device-test".to_string(),
                sections: std::collections::HashMap::new(),
                files: vec![],
                total_size: 0,
                total_files: 0,
            },
            data: std::collections::HashMap::new(),
        };
        let json = serde_json::to_string(&archive).unwrap();
        let parsed: BackupArchive = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.manifest.schema_version, 1);
    }
}
