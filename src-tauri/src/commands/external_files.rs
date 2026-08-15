use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

// ── Types ──

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileEntry {
    pub relative_path: String,
    pub absolute_path: String,
    pub size: u64,
    pub modified_at: u64,
    pub checksum: String,
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileCollection {
    pub root_label: String,
    pub root_path: String,
    pub total_files: usize,
    pub total_size: u64,
    pub files: Vec<ExternalFileEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileRestoreEntry {
    pub relative_path: String,
    pub content: String,
    pub expected_checksum: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub all_valid: bool,
    pub checked: usize,
    pub errors: Vec<String>,
}

// ── Helpers ──

fn compute_checksum(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))
}

/// Check if a relative path is safe (no traversal, no absolute paths)
fn is_external_path_safe(relative: &str) -> bool {
    if relative.starts_with('/') || relative.starts_with('\\') {
        return false;
    }
    if relative.contains("..") {
        return false;
    }
    // Normalize and check again
    let normalized = relative.replace('\\', "/");
    if normalized.contains("..") {
        return false;
    }
    true
}

/// Check if a file extension is in the allowlist
fn is_extension_allowed(ext: &str, allowed: &[&str]) -> bool {
    let lower = ext.to_lowercase();
    allowed.iter().any(|a| a.eq_ignore_ascii_case(&lower))
}

/// Scan a directory for files matching the allowlist, returning a collection
fn scan_file_collection(
    root: &Path,
    root_label: &str,
    allowed_extensions: &[&str],
    max_file_size: u64,
    max_files: usize,
) -> Result<ExternalFileCollection, String> {
    if !root.exists() {
        return Err(format!("Root directory does not exist: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("Root path is not a directory: {}", root.display()));
    }

    let root_str = root.to_string_lossy().to_string();
    let mut files = Vec::new();
    let mut total_size: u64 = 0;

    scan_directory_recursive(
        root,
        root,
        &mut files,
        &mut total_size,
        allowed_extensions,
        max_file_size,
        max_files,
    )?;

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(ExternalFileCollection {
        root_label: root_label.to_string(),
        root_path: root_str,
        total_files: files.len(),
        total_size,
        files,
    })
}

fn scan_directory_recursive(
    base: &Path,
    current: &Path,
    files: &mut Vec<ExternalFileEntry>,
    total_size: &mut u64,
    allowed_extensions: &[&str],
    max_file_size: u64,
    max_files: usize,
) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|e| format!("Failed to read directory {}: {}", current.display(), e))?;

    for entry in entries.flatten() {
        if files.len() >= max_files {
            break;
        }

        let path = entry.path();

        // Skip symlinks
        if path.is_symlink() {
            continue;
        }

        if path.is_dir() {
            scan_directory_recursive(
                base,
                &path,
                files,
                total_size,
                allowed_extensions,
                max_file_size,
                max_files,
            )?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        // Check extension
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !is_extension_allowed(ext, allowed_extensions) {
            // Also check compound extensions like .lua.disabled
            if let Some(stem_name) = path.file_name().and_then(|n| n.to_str()) {
                if stem_name.ends_with(".lua.disabled") && is_extension_allowed("lua", allowed_extensions) {
                    // Allow .lua.disabled
                } else {
                    continue;
                }
            } else {
                continue;
            }
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let file_size = metadata.len();
        if file_size > max_file_size {
            continue;
        }

        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let relative_path = path
            .strip_prefix(base)
            .ok()
            .and_then(|p| p.to_str())
            .unwrap_or(&file_name)
            .replace('\\', "/");

        // Read and checksum
        let content = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
        let checksum = compute_checksum(&content);

        *total_size += file_size;

        files.push(ExternalFileEntry {
            relative_path,
            absolute_path: path.to_string_lossy().to_string(),
            size: file_size,
            modified_at,
            checksum,
            file_name,
        });
    }

    Ok(())
}

// ── Tauri Commands ──

/// Scan a directory and return a file collection with checksums and metadata.
/// Used by backup collectors to inventory files before export.
#[tauri::command]
pub fn scan_external_file_collection(
    root_path: String,
    root_label: String,
    allowed_extensions: Vec<String>,
    max_file_size: Option<u64>,
    max_files: Option<usize>,
) -> Result<ExternalFileCollection, String> {
    let root = PathBuf::from(&root_path);
    let ext_refs: Vec<&str> = allowed_extensions.iter().map(|s| s.as_str()).collect();
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024); // 10MB default
    let max_count = max_files.unwrap_or(500);

    scan_file_collection(&root, &root_label, &ext_refs, max_size, max_count)
}

/// Read the content of files in a collection and return them as a map of relative_path → content.
/// Used during backup export to embed file data in the archive.
#[tauri::command]
pub fn read_file_collection_content(
    root_path: String,
    relative_paths: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let root = PathBuf::from(&root_path);
    let mut content_map = std::collections::HashMap::new();

    for rel_path in &relative_paths {
        if !is_external_path_safe(rel_path) {
            continue;
        }
        let full_path = root.join(rel_path);
        if !full_path.exists() || !full_path.is_file() {
            continue;
        }
        // Try UTF-8 text first, fall back to base64 for binary
        match fs::read_to_string(&full_path) {
            Ok(text) => {
                content_map.insert(rel_path.clone(), text);
            }
            Err(_) => {
                // Binary file — encode as base64
                if let Ok(bytes) = fs::read(&full_path) {
                    use base64::Engine;
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    content_map.insert(rel_path.clone(), format!("__base64:{}", encoded));
                }
            }
        }
    }

    Ok(content_map)
}

/// Restore files from a backup to a target directory.
/// Creates the target directory if it doesn't exist.
/// Returns a result with counts of restored/failed files.
#[tauri::command]
pub fn restore_external_files(
    target_root: String,
    files: Vec<ExternalFileRestoreEntry>,
    dry_run: Option<bool>,
) -> Result<RestoreResult, String> {
    let root = PathBuf::from(&target_root);
    let is_dry_run = dry_run.unwrap_or(false);
    let mut result = RestoreResult {
        restored: 0,
        failed: 0,
        errors: Vec::new(),
    };

    for entry in &files {
        if !is_external_path_safe(&entry.relative_path) {
            result.failed += 1;
            result.errors.push(format!("Unsafe path: {}", entry.relative_path));
            continue;
        }

        let full_path = root.join(&entry.relative_path);

        // Verify checksum before writing
        let content_bytes = entry.content.as_bytes();
        let checksum = compute_checksum(content_bytes);
        if checksum != entry.expected_checksum {
            result.failed += 1;
            result.errors.push(format!(
                "Checksum mismatch for {}: expected {}, got {}",
                entry.relative_path, entry.expected_checksum, checksum
            ));
            continue;
        }

        if is_dry_run {
            result.restored += 1;
            continue;
        }

        // Ensure parent directory exists
        if let Some(parent) = full_path.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                result.failed += 1;
                result.errors.push(format!(
                    "Failed to create directory for {}: {}",
                    entry.relative_path, e
                ));
                continue;
            }
        }

        // Write file
        match fs::write(&full_path, &entry.content) {
            Ok(()) => {
                // Verify write
                if full_path.exists() {
                    result.restored += 1;
                } else {
                    result.failed += 1;
                    result.errors
                        .push(format!("File not found after write: {}", entry.relative_path));
                }
            }
            Err(e) => {
                result.failed += 1;
                result.errors
                    .push(format!("Failed to write {}: {}", entry.relative_path, e));
            }
        }
    }

    Ok(result)
}

/// Create a safety backup of files that may be overwritten during restore.
/// Copies files to <appData>/backups/safety/<operationId>/ maintaining relative paths.
#[tauri::command]
pub fn create_external_safety_backup(
    app_handle: tauri::AppHandle,
    operation_id: String,
    source_root: String,
    relative_paths: Vec<String>,
) -> Result<String, String> {
    let backup_dir = get_app_data_dir(&app_handle)?
        .join("backups")
        .join("safety")
        .join(&operation_id);

    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create safety backup dir: {}", e))?;

    let source = PathBuf::from(&source_root);
    let mut backed_up = 0;

    for rel_path in &relative_paths {
        if !is_external_path_safe(rel_path) {
            continue;
        }
        let full_path = source.join(rel_path);
        if !full_path.exists() || !full_path.is_file() {
            continue;
        }

        let dest = backup_dir.join(rel_path);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::copy(&full_path, &dest) {
            eprintln!(
                "[BACKUP][SAFETY] failed to copy {}: {}",
                full_path.display(),
                e
            );
            continue;
        }
        backed_up += 1;
    }

    Ok(format!(
        "Safety backup created: {} files backed up to {}",
        backed_up,
        backup_dir.display()
    ))
}

/// Restore files from a safety backup back to their original location.
#[tauri::command]
pub fn restore_from_safety_backup(
    app_handle: tauri::AppHandle,
    operation_id: String,
    target_root: String,
    relative_paths: Vec<String>,
) -> Result<RestoreResult, String> {
    let backup_dir = get_app_data_dir(&app_handle)?
        .join("backups")
        .join("safety")
        .join(&operation_id);

    if !backup_dir.exists() {
        return Err(format!(
            "Safety backup not found for operation: {}",
            operation_id
        ));
    }

    let mut result = RestoreResult {
        restored: 0,
        failed: 0,
        errors: Vec::new(),
    };

    let target = PathBuf::from(&target_root);

    for rel_path in &relative_paths {
        if !is_external_path_safe(rel_path) {
            result.failed += 1;
            result.errors.push(format!("Unsafe path: {}", rel_path));
            continue;
        }

        let backup_file = backup_dir.join(rel_path);
        if !backup_file.exists() {
            result.failed += 1;
            result.errors
                .push(format!("Safety backup missing: {}", rel_path));
            continue;
        }

        let content = match fs::read_to_string(&backup_file) {
            Ok(c) => c,
            Err(e) => {
                result.failed += 1;
                result.errors
                    .push(format!("Failed to read safety backup {}: {}", rel_path, e));
                continue;
            }
        };

        let target_file = target.join(rel_path);
        if let Some(parent) = target_file.parent() {
            let _ = fs::create_dir_all(parent);
        }

        match fs::write(&target_file, &content) {
            Ok(()) => result.restored += 1,
            Err(e) => {
                result.failed += 1;
                result.errors
                    .push(format!("Failed to restore {}: {}", rel_path, e));
            }
        }
    }

    Ok(result)
}

/// Verify checksums of files on disk against expected values.
#[tauri::command]
pub fn verify_file_checksums(
    root_path: String,
    files: Vec<(String, String)>, // (relative_path, expected_checksum)
) -> Result<VerifyResult, String> {
    let root = PathBuf::from(&root_path);
    let mut result = VerifyResult {
        all_valid: true,
        checked: 0,
        errors: Vec::new(),
    };

    for (rel_path, expected) in &files {
        if !is_external_path_safe(rel_path) {
            result.all_valid = false;
            result.errors.push(format!("Unsafe path: {}", rel_path));
            continue;
        }

        let full_path = root.join(rel_path);
        match fs::read(&full_path) {
            Ok(bytes) => {
                result.checked += 1;
                let actual = compute_checksum(&bytes);
                if &actual != expected {
                    result.all_valid = false;
                    result.errors.push(format!(
                        "Checksum mismatch {}: expected {} got {}",
                        rel_path, expected, actual
                    ));
                }
            }
            Err(e) => {
                result.all_valid = false;
                result.errors
                    .push(format!("File not found {}: {}", rel_path, e));
            }
        }
    }

    Ok(result)
}

/// Resolve the LumaForge achievements root directory for a provider.
/// Returns the absolute path to <appData>/achievements/<provider>/
#[tauri::command]
pub fn resolve_achievements_root_dir(
    app_handle: tauri::AppHandle,
    provider: String,
) -> Result<String, String> {
    let app_dir = get_app_data_dir(&app_handle)?;
    let dir = app_dir.join("achievements").join(&provider);
    Ok(dir.to_string_lossy().to_string())
}

/// Resolve the LumaForge app data directory as a string.
#[tauri::command]
pub fn resolve_app_data_dir(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let dir = get_app_data_dir(&app_handle)?;
    Ok(dir.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Crack save detection (uses std::env::var, works in Rust but not browser)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CrackSaveResult {
    pub crack_type: String,
    pub save_path: String,
}

#[tauri::command]
pub fn detect_crack_save_type(app_id: String) -> Result<Option<CrackSaveResult>, String> {
    let bases: Vec<(&str, Vec<&str>, &str)> = vec![
        ("PUBLIC", vec!["Documents", "Steam", "RUNE"], "rune"),
        ("PUBLIC", vec!["Documents", "Steam", "CODEX"], "codex"),
        ("PUBLIC", vec!["Documents", "OnlineFix"], "onlinefix"),
        ("PUBLIC", vec!["Documents", "EMPRESS"], "empress"),
        ("APPDATA", vec!["GSE Saves"], "gse"),
        ("APPDATA", vec!["Goldberg SteamEmu Saves"], "goldberg"),
        ("APPDATA", vec!["Goldberg UplayEmu Saves"], "goldberg"),
        ("APPDATA", vec!["Goldberg SocialClub Emu Saves"], "goldberg"),
        ("APPDATA", vec!["Steam", "CODEX"], "codex"),
        ("APPDATA", vec!["SmartSteamEmu"], "gse"),
    ];

    for (env_key, segments, crack_type) in bases {
        if let Ok(env_val) = std::env::var(env_key) {
            let mut path = std::path::PathBuf::from(env_val);
            for seg in &segments {
                path.push(seg);
            }
            path.push(&app_id);
            // Verify directory exists AND has actual achievement data
            if path.is_dir() && (path.join("achievements.ini").exists() || path.join("achievements.json").exists()) {
                return Ok(Some(CrackSaveResult {
                    crack_type: crack_type.to_string(),
                    save_path: path.to_string_lossy().to_string(),
                }));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_external_path_safe() {
        assert!(is_external_path_safe("lua/268910.lua"));
        assert!(is_external_path_safe("achievements/268910/summary.json"));
        assert!(!is_external_path_safe("../secret.txt"));
        assert!(!is_external_path_safe("/etc/passwd"));
        assert!(!is_external_path_safe("lua/../../etc/passwd"));
        assert!(!is_external_path_safe("\\\\server\\share"));
    }

    #[test]
    fn test_compute_checksum() {
        let data = b"hello world";
        let checksum = compute_checksum(data);
        assert_eq!(checksum.len(), 64); // SHA-256 hex
    }

    #[test]
    fn test_is_extension_allowed() {
        assert!(is_extension_allowed("lua", &["lua", "json"]));
        assert!(is_extension_allowed("JSON", &["lua", "json"]));
        assert!(!is_extension_allowed("exe", &["lua", "json"]));
        assert!(!is_extension_allowed("dll", &["lua", "json"]));
    }
}
