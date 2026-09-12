use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read as _, Write as _};
use std::path::PathBuf;
use tauri::Manager;
use zip::write::SimpleFileOptions;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileInfo {
    pub relative_path: String,
    pub section: String,
    pub size: u64,
    pub checksum: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub schema_version: u32,
    pub backup_id: String,
    pub created_at: String,
    pub app_version: String,
    pub device_id: String,
    pub sections: HashMap<String, bool>,
    pub files: Vec<BackupFileInfo>,
    pub total_size: u64,
    pub total_files: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupArchive {
    pub manifest: BackupManifest,
    pub data: HashMap<String, String>,
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
    manifest_json: String,
    files_json: String,
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

    let files_map: HashMap<String, String> =
        serde_json::from_str(&files_json).map_err(|e| format!("Invalid files_json: {}", e))?;

    let file = fs::File::create(&path).map_err(|e| format!("Failed to create zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    zip.start_file("manifest.json", options)
        .map_err(|e| format!("Failed to start manifest entry: {}", e))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    for (rel_path, data) in &files_map {
        if rel_path.ends_with(".bin") {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|e| format!("Failed to decode base64 for {}: {}", rel_path, e))?;
            zip.start_file(rel_path, options)
                .map_err(|e| format!("Failed to start zip entry {}: {}", rel_path, e))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("Failed to write zip entry {}: {}", rel_path, e))?;
        } else {
            zip.start_file(rel_path, options)
                .map_err(|e| format!("Failed to start zip entry {}: {}", rel_path, e))?;
            zip.write_all(data.as_bytes())
                .map_err(|e| format!("Failed to write zip entry {}: {}", rel_path, e))?;
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

fn read_zip_as_backup_json(path: &std::path::Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid zip: {}", e))?;

    let mut manifest_content = String::new();
    let mut data_map: HashMap<String, String> = HashMap::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let name = entry.name().to_string();

        if name == "manifest.json" {
            entry
                .read_to_string(&mut manifest_content)
                .map_err(|e| format!("Failed to read manifest: {}", e))?;
        } else if name.ends_with(".bin") {
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Failed to read bin entry {}: {}", name, e))?;
            data_map.insert(
                name,
                base64::engine::general_purpose::STANDARD.encode(&bytes),
            );
        } else {
            let mut content = String::new();
            entry
                .read_to_string(&mut content)
                .map_err(|e| format!("Failed to read entry {}: {}", name, e))?;
            data_map.insert(name, content);
        }
    }

    let manifest: BackupManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Invalid manifest in zip: {}", e))?;

    let archive_data = BackupArchive {
        manifest,
        data: data_map,
    };

    serde_json::to_string(&archive_data)
        .map_err(|e| format!("Failed to serialize backup for restore: {}", e))
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

    if filename.ends_with(".zip") {
        return read_zip_as_backup_json(&path);
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
        let ext = path.extension().and_then(|e| e.to_str());
        if ext == Some("zip") || ext == Some("json") {
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
            sections: HashMap::new(),
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
                sections: HashMap::new(),
                files: vec![],
                total_size: 0,
                total_files: 0,
            },
            data: HashMap::new(),
        };
        let json = serde_json::to_string(&archive).unwrap();
        let parsed: BackupArchive = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.manifest.schema_version, 1);
    }
}
