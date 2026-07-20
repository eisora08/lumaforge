/**
 * Verified Steam Achievement Sources
 *
 * Reads Steam-owned achievement source files from:
 *   1. <steam_root>/appcache/stats/UserGameStats_<accountId>_<appId>.bin
 *   2. <steam_root>/appcache/stats/UserGameStatsSchema_<appId>.bin
 *   3. <steam_root>/userdata/<accountId>/config/librarycache/<appId>.json
 *
 * These are read-only audit/export commands. Restore writes back to the
 * exact same paths after safety checks (Steam not running, safety backup).
 */

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::utils::path_utils::detect_steam_paths;

// ── Types ──

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum SteamSourceKind {
    UserGameStats,
    UserGameStatsSchema,
    LibraryCacheJson,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedSourceFile {
    pub source_kind: SteamSourceKind,
    pub logical_path: String,
    pub absolute_path: String,
    pub size: u64,
    pub modified_at: u64,
    pub checksum: String,
    pub requires_steam_closed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedSourceGameEntry {
    pub app_id: String,
    pub files: Vec<VerifiedSourceFile>,
    pub total_size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedSourcesManifest {
    pub schema_version: u32,
    pub account_scope: String,
    pub steam_root: String,
    pub total_games: usize,
    pub total_files: usize,
    pub total_size: u64,
    pub games: Vec<VerifiedSourceGameEntry>,
    pub rejected: Vec<RejectedSourceFile>,
    pub stats_count: usize,
    pub schema_count: usize,
    pub librarycache_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedSourceFile {
    pub logical_path: String,
    pub source_kind: SteamSourceKind,
    pub base64_content: String,
    pub checksum: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedSourceResult {
    pub app_id: String,
    pub files: Vec<ExportedSourceFile>,
    pub total_size: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamProcessCheckResult {
    pub running: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSourceResult {
    pub restored: usize,
    pub failed: usize,
    pub errors: Vec<String>,
    pub checksums_valid: bool,
}

// ── Helpers ──

fn compute_checksum(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Validate an appId string: must be a positive integer within Steam's numeric range.
/// Returns the parsed u32 on success, or a rejection reason string on failure.
fn validate_app_id(app_id_str: &str) -> Result<u32, String> {
    if app_id_str.is_empty() {
        return Err("empty-app-id".to_string());
    }

    // Reject non-numeric (including decimals, negatives, hex, etc.)
    let parsed = app_id_str.parse::<u32>().map_err(|_| "invalid-app-id".to_string())?;

    // Reject zero
    if parsed == 0 {
        return Err("invalid-app-id".to_string());
    }

    // Reject overflow (u32::MAX is 4294967295 — Steam appIds are well below this,
    // but u32 parse already handles overflow by failing)
    // Steam's max known appId is in the ~2 billion range; u32 covers it.
    if parsed > 100_000_000 {
        return Err("invalid-app-id".to_string());
    }

    Ok(parsed)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RejectedSourceFile {
    pub file_name: String,
    pub source_kind: String,
    pub reason: String,
}

fn resolve_steam_root(steam_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = steam_path {
        let root = PathBuf::from(p);
        if root.is_dir() {
            return Ok(root);
        }
        return Err(format!("Steam root not found: {}", root.display()));
    }
    match detect_steam_paths() {
        Some(paths) => Ok(PathBuf::from(paths.steam_root)),
        None => Err("Steam path not provided and auto-detection failed".to_string()),
    }
}

fn stats_dir(steam_root: &Path) -> PathBuf {
    steam_root.join("appcache").join("stats")
}

fn librarycache_dir(steam_root: &Path, account_id: &str) -> PathBuf {
    steam_root
        .join("userdata")
        .join(account_id)
        .join("config")
        .join("librarycache")
}

fn file_metadata(path: &Path) -> Option<(u64, u64, String)> {
    let meta = fs::metadata(path).ok()?;
    let size = meta.len();
    let modified = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    let data = fs::read(path).ok()?;
    let checksum = compute_checksum(&data);
    Some((size, modified, checksum))
}

fn read_file_raw(path: &Path) -> Option<Vec<u8>> {
    fs::read(path).ok()
}

/// Check if Steam process is running on Windows
fn is_steam_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
            .output()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout.to_lowercase().contains("steam.exe")
            })
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("pgrep")
            .arg("steam")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
}

// ── Tauri Commands ──

/// Audit all verified Steam achievement source files for the current account.
/// Returns a manifest with per-game file metadata (size, modified, checksum).
#[tauri::command]
pub fn audit_steam_achievement_sources(
    steam_path: Option<String>,
    steam_account_id: String,
) -> Result<VerifiedSourcesManifest, String> {
    let steam_root = resolve_steam_root(steam_path.as_deref())?;
    let stats = stats_dir(&steam_root);
    let libcache = librarycache_dir(&steam_root, &steam_account_id);

    let mut games: Vec<VerifiedSourceGameEntry> = Vec::new();
    let mut all_app_ids: Vec<String> = Vec::new();
    let mut rejected: Vec<RejectedSourceFile> = Vec::new();
    let mut stats_count = 0usize;
    let mut schema_count = 0usize;
    let mut librarycache_count = 0usize;

    // Collect appIds from librarycache *.json files
    if libcache.is_dir() {
        if let Ok(entries) = fs::read_dir(&libcache) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        match validate_app_id(stem) {
                            Ok(valid_id) => {
                                let id_str = valid_id.to_string();
                                if !all_app_ids.contains(&id_str) {
                                    all_app_ids.push(id_str);
                                }
                                librarycache_count += 1;
                            }
                            Err(reason) => {
                                rejected.push(RejectedSourceFile {
                                    file_name: path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
                                    source_kind: "librarycache".to_string(),
                                    reason,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Collect appIds from UserGameStats_<acc>_<appid>.bin files
    if stats.is_dir() {
        let prefix = format!("UserGameStats_{}_", &steam_account_id);
        if let Ok(entries) = fs::read_dir(&stats) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with(&prefix) && fname.ends_with(".bin") {
                    let without_prefix = &fname[prefix.len()..];
                    let appid_str = without_prefix.trim_end_matches(".bin");
                    match validate_app_id(appid_str) {
                        Ok(valid_id) => {
                            let id_str = valid_id.to_string();
                            if !all_app_ids.contains(&id_str) {
                                all_app_ids.push(id_str);
                            }
                            stats_count += 1;
                        }
                        Err(reason) => {
                            rejected.push(RejectedSourceFile {
                                file_name: fname.clone(),
                                source_kind: "userGameStats".to_string(),
                                reason,
                            });
                        }
                    }
                }
            }
        }
    }

    // Collect appIds from UserGameStatsSchema_<appid>.bin files
    if stats.is_dir() {
        if let Ok(entries) = fs::read_dir(&stats) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with("UserGameStatsSchema_") && fname.ends_with(".bin") {
                    let appid_str = fname
                        .trim_start_matches("UserGameStatsSchema_")
                        .trim_end_matches(".bin");
                    match validate_app_id(appid_str) {
                        Ok(valid_id) => {
                            let id_str = valid_id.to_string();
                            if !all_app_ids.contains(&id_str) {
                                all_app_ids.push(id_str);
                            }
                            schema_count += 1;
                        }
                        Err(reason) => {
                            rejected.push(RejectedSourceFile {
                                file_name: fname.clone(),
                                source_kind: "userGameStatsSchema".to_string(),
                                reason,
                            });
                        }
                    }
                }
            }
        }
    }

    all_app_ids.sort();

    for app_id in &all_app_ids {
        let mut files: Vec<VerifiedSourceFile> = Vec::new();
        let mut total_size: u64 = 0;

        // 1. UserGameStats_<accountId>_<appId>.bin
        let stats_path = stats.join(format!("UserGameStats_{}_{}.bin", &steam_account_id, app_id));
        if stats_path.is_file() {
            if let Some((size, modified, checksum)) = file_metadata(&stats_path) {
                files.push(VerifiedSourceFile {
                    source_kind: SteamSourceKind::UserGameStats,
                    logical_path: format!("steam/achievement-sources/{}/user-game-stats.bin", app_id),
                    absolute_path: stats_path.to_string_lossy().to_string(),
                    size,
                    modified_at: modified,
                    checksum,
                    requires_steam_closed: true,
                });
                total_size += size;
            }
        }

        // 2. UserGameStatsSchema_<appId>.bin
        let schema_path = stats.join(format!("UserGameStatsSchema_{}.bin", app_id));
        if schema_path.is_file() {
            if let Some((size, modified, checksum)) = file_metadata(&schema_path) {
                files.push(VerifiedSourceFile {
                    source_kind: SteamSourceKind::UserGameStatsSchema,
                    logical_path: format!("steam/achievement-sources/{}/user-game-stats-schema.bin", app_id),
                    absolute_path: schema_path.to_string_lossy().to_string(),
                    size,
                    modified_at: modified,
                    checksum,
                    requires_steam_closed: true,
                });
                total_size += size;
            }
        }

        // 3. <appId>.json in librarycache
        let libcache_path = libcache.join(format!("{}.json", app_id));
        if libcache_path.is_file() {
            if let Some((size, modified, checksum)) = file_metadata(&libcache_path) {
                files.push(VerifiedSourceFile {
                    source_kind: SteamSourceKind::LibraryCacheJson,
                    logical_path: format!("steam/achievement-sources/{}/librarycache.json", app_id),
                    absolute_path: libcache_path.to_string_lossy().to_string(),
                    size,
                    modified_at: modified,
                    checksum,
                    requires_steam_closed: false,
                });
                total_size += size;
            }
        }

        if !files.is_empty() {
            games.push(VerifiedSourceGameEntry {
                app_id: app_id.clone(),
                files,
                total_size,
            });
        }
    }

    let total_files: usize = games.iter().map(|g| g.files.len()).sum();
    let total_size: u64 = games.iter().map(|g| g.total_size).sum();

    Ok(VerifiedSourcesManifest {
        schema_version: 1,
        account_scope: "current-steam-account".to_string(),
        steam_root: steam_root.to_string_lossy().to_string(),
        total_games: games.len(),
        total_files,
        total_size,
        games,
        rejected,
        stats_count,
        schema_count,
        librarycache_count,
    })
}

/// Export selected source files as base64 for inclusion in a backup archive.
/// Only exports files for the requested appIds.
#[tauri::command]
pub fn export_steam_achievement_sources(
    steam_path: Option<String>,
    steam_account_id: String,
    app_ids: Vec<String>,
) -> Result<Vec<ExportedSourceResult>, String> {
    let manifest = audit_steam_achievement_sources(steam_path.clone(), steam_account_id.clone())?;
    let selected: std::collections::HashSet<String> = app_ids.into_iter().collect();
    let mut results: Vec<ExportedSourceResult> = Vec::new();

    for game in &manifest.games {
        if !selected.contains(&game.app_id) {
            continue;
        }

        let mut exported_files: Vec<ExportedSourceFile> = Vec::new();
        let mut total_size: u64 = 0;

        for file in &game.files {
            let path = Path::new(&file.absolute_path);
            match read_file_raw(path) {
                Some(data) => {
                    let checksum = compute_checksum(&data);
                    let base64_content = base64::engine::general_purpose::STANDARD.encode(&data);
                    total_size += data.len() as u64;
                    exported_files.push(ExportedSourceFile {
                        logical_path: file.logical_path.clone(),
                        source_kind: file.source_kind.clone(),
                        base64_content,
                        checksum,
                        size: data.len() as u64,
                    });
                }
                None => {
                    // Skip files that can't be read (locked by Steam, etc.)
                }
            }
        }

        if !exported_files.is_empty() {
            results.push(ExportedSourceResult {
                app_id: game.app_id.clone(),
                files: exported_files,
                total_size,
            });
        }
    }

    Ok(results)
}

/// Read achievement source data for a single game (for preview before export).
#[tauri::command]
pub fn read_steam_achievement_source_for_game(
    steam_path: Option<String>,
    steam_account_id: String,
    app_id: String,
) -> Result<Option<ExportedSourceResult>, String> {
    let results = export_steam_achievement_sources(steam_path, steam_account_id, vec![app_id])?;
    Ok(results.into_iter().next())
}

/// Check if Steam process is currently running.
/// Used before any write operations to Steam-owned files.
#[tauri::command]
pub fn check_steam_running() -> Result<SteamProcessCheckResult, String> {
    let running = is_steam_running();
    Ok(SteamProcessCheckResult {
        running,
        message: if running {
            "Steam is running. Close Steam before restoring achievement source files.".to_string()
        } else {
            "Steam is not running. Safe to write achievement source files.".to_string()
        },
    })
}

/// Restore achievement source files from exported data.
/// Creates safety backup first, writes files, validates checksums.
#[tauri::command]
pub fn restore_steam_achievement_sources(
    steam_path: Option<String>,
    steam_account_id: String,
    exports: Vec<ExportedSourceResult>,
) -> Result<RestoreSourceResult, String> {
    // Safety check: Steam must not be running
    let steam_check = check_steam_running()?;
    if steam_check.running {
        return Err("Cannot restore while Steam is running. Close Steam first.".to_string());
    }

    let steam_root = resolve_steam_root(steam_path.as_deref())?;
    restore_sources_inner(&steam_root, &steam_account_id, &exports)
}

/// Core restore logic — testable without Steam-running check.
fn restore_sources_inner(
    steam_root: &Path,
    steam_account_id: &str,
    exports: &[ExportedSourceResult],
) -> Result<RestoreSourceResult, String> {
    let mut restored = 0usize;
    let mut failed = 0usize;
    let mut errors: Vec<String> = Vec::new();
    let mut all_checksums_valid = true;

    for export in exports {
        for file in &export.files {
            let target_path = match file.source_kind {
                SteamSourceKind::UserGameStats => {
                    steam_root.join("appcache").join("stats").join(format!(
                        "UserGameStats_{}_{}.bin",
                        steam_account_id, &export.app_id
                    ))
                }
                SteamSourceKind::UserGameStatsSchema => {
                    steam_root
                        .join("appcache")
                        .join("stats")
                        .join(format!("UserGameStatsSchema_{}.bin", &export.app_id))
                }
                SteamSourceKind::LibraryCacheJson => {
                    steam_root.join("userdata").join(steam_account_id).join("config")
                        .join("librarycache")
                        .join(format!("{}.json", &export.app_id))
                }
            };

            // Safety backup before overwrite
            if target_path.is_file() {
                let backup_path = PathBuf::from(format!(
                    "{}.lumasafety",
                    target_path.to_string_lossy()
                ));
                if let Err(e) = fs::copy(&target_path, &backup_path) {
                    errors.push(format!(
                        "Failed to safety-backup {}: {}",
                        target_path.display(),
                        e
                    ));
                    failed += 1;
                    continue;
                }
            }

            // Decode and write
            match base64::engine::general_purpose::STANDARD.decode(&file.base64_content) {
                Ok(data) => {
                    // Ensure parent directory exists
                    if let Some(parent) = target_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }

                    if let Err(e) = fs::write(&target_path, &data) {
                        errors.push(format!(
                            "Failed to write {}: {}",
                            target_path.display(),
                            e
                        ));
                        failed += 1;
                        continue;
                    }

                    // Verify checksum
                    let written_checksum = compute_checksum(&data);
                    if written_checksum != file.checksum {
                        all_checksums_valid = false;
                        errors.push(format!(
                            "Checksum mismatch for {}: expected {} got {}",
                            target_path.display(),
                            file.checksum,
                            written_checksum
                        ));
                        failed += 1;
                        continue;
                    }

                    restored += 1;
                }
                Err(e) => {
                    errors.push(format!(
                        "Failed to decode base64 for {}: {}",
                        file.logical_path, e
                    ));
                    failed += 1;
                }
            }
        }
    }

    Ok(RestoreSourceResult {
        restored,
        failed,
        errors,
        checksums_valid: all_checksums_valid,
    })
}

// ═══════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ── Helpers ──

    fn make_steam_dirs(root: &Path) {
        fs::create_dir_all(root.join("appcache").join("stats")).unwrap();
        fs::create_dir_all(
            root.join("userdata")
                .join("12345")
                .join("config")
                .join("librarycache"),
        )
        .unwrap();
    }

    fn write_file(path: &Path, content: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn tmp_steam_root() -> TempDir {
        let tmp = TempDir::new().unwrap();
        make_steam_dirs(tmp.path());
        tmp
    }

    // ══════════════════════════════════════════════════════════════
    //  validate_app_id
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn validate_app_id_valid() {
        assert_eq!(validate_app_id("268910").unwrap(), 268910);
        assert_eq!(validate_app_id("1").unwrap(), 1);
        assert_eq!(validate_app_id("480").unwrap(), 480);
    }

    #[test]
    fn validate_app_id_zero_rejected() {
        assert!(validate_app_id("0").is_err());
        assert_eq!(validate_app_id("0").unwrap_err(), "invalid-app-id");
    }

    #[test]
    fn validate_app_id_negative_rejected() {
        assert!(validate_app_id("-1").is_err());
    }

    #[test]
    fn validate_app_id_empty_rejected() {
        assert!(validate_app_id("").is_err());
        assert_eq!(validate_app_id("").unwrap_err(), "empty-app-id");
    }

    #[test]
    fn validate_app_id_decimal_rejected() {
        assert!(validate_app_id("1.5").is_err());
    }

    #[test]
    fn validate_app_id_non_numeric_rejected() {
        assert!(validate_app_id("abc").is_err());
        assert!(validate_app_id("0x1A").is_err());
        assert!(validate_app_id("268910a").is_err());
    }

    #[test]
    fn validate_app_id_overflow_rejected() {
        assert!(validate_app_id("100000001").is_err());
        assert!(validate_app_id("4294967295").is_err());
    }

    // ══════════════════════════════════════════════════════════════
    //  compute_checksum
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn compute_checksum_deterministic() {
        let data = b"hello world";
        let c1 = compute_checksum(data);
        let c2 = compute_checksum(data);
        assert_eq!(c1, c2);
    }

    #[test]
    fn compute_checksum_different_data() {
        let c1 = compute_checksum(b"hello");
        let c2 = compute_checksum(b"world");
        assert_ne!(c1, c2);
    }

    #[test]
    fn compute_checksum_empty() {
        let c = compute_checksum(b"");
        // SHA-256 of empty string
        assert_eq!(c.len(), 64);
    }

    // ══════════════════════════════════════════════════════════════
    //  audit_steam_achievement_sources — directory structure
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn audit_empty_dirs() {
        let tmp = tmp_steam_root();
        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 0);
        assert_eq!(manifest.total_files, 0);
        assert_eq!(manifest.rejected.len(), 0);
        assert_eq!(manifest.account_scope, "current-steam-account");
        assert_eq!(manifest.schema_version, 1);
    }

    #[test]
    fn audit_with_valid_librarycache_json() {
        let tmp = tmp_steam_root();
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");
        write_file(&libcache.join("268910.json"), b"{\"appid\":268910}");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 1);
        assert_eq!(manifest.games[0].app_id, "268910");
        assert_eq!(manifest.librarycache_count, 1);
        assert_eq!(manifest.games[0].files.len(), 1);
        assert!(matches!(
            manifest.games[0].files[0].source_kind,
            SteamSourceKind::LibraryCacheJson
        ));
    }

    #[test]
    fn audit_rejects_appid_zero_in_librarycache() {
        let tmp = tmp_steam_root();
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");
        write_file(&libcache.join("0.json"), b"{}");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 0);
        assert_eq!(manifest.rejected.len(), 1);
        assert_eq!(manifest.rejected[0].file_name, "0.json");
        assert_eq!(manifest.rejected[0].reason, "invalid-app-id");
        assert_eq!(manifest.rejected[0].source_kind, "librarycache");
    }

    #[test]
    fn audit_rejects_non_numeric_librarycache_filename() {
        let tmp = tmp_steam_root();
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");
        write_file(&libcache.join("unknown.json"), b"{}");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 0);
        assert_eq!(manifest.rejected.len(), 1);
        assert_eq!(manifest.rejected[0].reason, "invalid-app-id");
    }

    #[test]
    fn audit_with_user_game_stats() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"stats data");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 1);
        assert_eq!(manifest.games[0].app_id, "268910");
        assert_eq!(manifest.stats_count, 1);
        assert!(matches!(
            manifest.games[0].files[0].source_kind,
            SteamSourceKind::UserGameStats
        ));
        assert!(manifest.games[0].files[0].requires_steam_closed);
    }

    #[test]
    fn audit_rejects_appid_zero_in_user_game_stats() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_0.bin"), b"bad data");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 0);
        assert_eq!(manifest.rejected.len(), 1);
        assert_eq!(manifest.rejected[0].source_kind, "userGameStats");
        assert_eq!(manifest.rejected[0].reason, "invalid-app-id");
    }

    #[test]
    fn audit_with_user_game_stats_schema() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStatsSchema_268910.bin"), b"schema data");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 1);
        assert_eq!(manifest.schema_count, 1);
        assert!(matches!(
            manifest.games[0].files[0].source_kind,
            SteamSourceKind::UserGameStatsSchema
        ));
    }

    #[test]
    fn audit_rejects_appid_zero_in_schema() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStatsSchema_0.bin"), b"bad schema");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 0);
        assert_eq!(manifest.rejected.len(), 1);
        assert_eq!(manifest.rejected[0].source_kind, "userGameStatsSchema");
    }

    #[test]
    fn audit_merges_multiple_sources_per_app() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");

        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"stats");
        write_file(&stats.join("UserGameStatsSchema_268910.bin"), b"schema");
        write_file(&libcache.join("268910.json"), b"{\"appid\":268910}");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 1);
        assert_eq!(manifest.games[0].files.len(), 3);
        assert_eq!(manifest.games[0].app_id, "268910");
        assert_eq!(manifest.stats_count, 1);
        assert_eq!(manifest.schema_count, 1);
        assert_eq!(manifest.librarycache_count, 1);
    }

    #[test]
    fn audit_games_sorted_by_app_id() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");

        write_file(&stats.join("UserGameStats_12345_730.bin"), b"data");
        write_file(&stats.join("UserGameStats_12345_10.bin"), b"data");
        write_file(&stats.join("UserGameStats_12345_500.bin"), b"data");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.games.len(), 3);
        assert_eq!(manifest.games[0].app_id, "10");
        assert_eq!(manifest.games[1].app_id, "500");
        assert_eq!(manifest.games[2].app_id, "730");
    }

    #[test]
    fn audit_checksum_correct() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"test data");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        let expected = compute_checksum(b"test data");
        assert_eq!(manifest.games[0].files[0].checksum, expected);
    }

    #[test]
    fn audit_total_size_calculation() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");

        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"12345");
        write_file(&libcache.join("268910.json"), b"abc");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_size, 5 + 3); // "12345" + "abc"
        assert_eq!(manifest.games[0].total_size, 8);
    }

    #[test]
    fn audit_wrong_account_id_finds_no_user_game_stats() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        // File belongs to account 99999, but we query with 12345
        write_file(&stats.join("UserGameStats_99999_268910.bin"), b"data");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 0);
        assert_eq!(manifest.stats_count, 0);
    }

    // ══════════════════════════════════════════════════════════════
    //  resolve_steam_root
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn resolve_steam_root_explicit_valid() {
        let tmp = tmp_steam_root();
        let root = resolve_steam_root(Some(tmp.path().to_str().unwrap())).unwrap();
        assert_eq!(root, tmp.path());
    }

    #[test]
    fn resolve_steam_root_explicit_missing() {
        let result = resolve_steam_root(Some("/nonexistent/path/steam"));
        assert!(result.is_err());
    }

    // ══════════════════════════════════════════════════════════════
    //  export_steam_achievement_sources
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn export_returns_base64_content() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        let content = b"binary achievement data";
        write_file(&stats.join("UserGameStats_12345_268910.bin"), content);

        let results = export_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
            vec!["268910".to_string()],
        )
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].app_id, "268910");
        assert_eq!(results[0].files.len(), 1);

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&results[0].files[0].base64_content)
            .unwrap();
        assert_eq!(decoded, content);
    }

    #[test]
    fn export_checksum_matches_original() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"verify me");

        let results = export_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
            vec!["268910".to_string()],
        )
        .unwrap();

        let expected = compute_checksum(b"verify me");
        assert_eq!(results[0].files[0].checksum, expected);
    }

    #[test]
    fn export_filters_by_selected_app_ids() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_100.bin"), b"a");
        write_file(&stats.join("UserGameStats_12345_200.bin"), b"b");

        let results = export_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
            vec!["100".to_string()], // Only select 100
        )
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].app_id, "100");
    }

    #[test]
    fn export_excludes_nonexistent_files() {
        let tmp = tmp_steam_root();
        // No files exist — export should return empty
        let results = export_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
            vec!["99999".to_string()],
        )
        .unwrap();

        assert_eq!(results.len(), 0);
    }

    // ══════════════════════════════════════════════════════════════
    //  read_steam_achievement_source_for_game
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn read_single_game_returns_some() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"single");

        let result = read_steam_achievement_source_for_game(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
            "268910".to_string(),
        )
        .unwrap();

        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.app_id, "268910");
        assert_eq!(r.files.len(), 1);
    }

    #[test]
    fn read_single_game_returns_none_when_missing() {
        let tmp = tmp_steam_root();
        let result = read_steam_achievement_source_for_game(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
            "99999".to_string(),
        )
        .unwrap();

        assert!(result.is_none());
    }

    // ══════════════════════════════════════════════════════════════
    //  restore_steam_achievement_sources
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn restore_writes_file_and_validates_checksum() {
        let tmp = tmp_steam_root();
        let content = b"restored content";
        let checksum = compute_checksum(content);
        let encoded = base64::engine::general_purpose::STANDARD.encode(content);

        let exports = vec![ExportedSourceResult {
            app_id: "268910".to_string(),
            files: vec![ExportedSourceFile {
                logical_path: "steam/achievement-sources/268910/user-game-stats.bin".to_string(),
                source_kind: SteamSourceKind::UserGameStats,
                base64_content: encoded,
                checksum,
                size: content.len() as u64,
            }],
            total_size: content.len() as u64,
        }];

        // Tests call restore_sources_inner directly to bypass the Steam-running guard
        let result = restore_sources_inner(tmp.path(), "12345", &exports).unwrap();

        assert_eq!(result.restored, 1);
        assert_eq!(result.failed, 0);
        assert!(result.checksums_valid);

        // Verify file was written
        let target = tmp
            .path()
            .join("appcache")
            .join("stats")
            .join("UserGameStats_12345_268910.bin");
        assert!(target.is_file());
        assert_eq!(fs::read(&target).unwrap(), content);
    }

    #[test]
    fn restore_creates_safety_backup_of_existing_file() {
        let tmp = tmp_steam_root();
        let target = tmp
            .path()
            .join("appcache")
            .join("stats")
            .join("UserGameStats_12345_268910.bin");
        write_file(&target, b"original content");

        let new_content = b"new content";
        let encoded = base64::engine::general_purpose::STANDARD.encode(new_content);
        let checksum = compute_checksum(new_content);

        let exports = vec![ExportedSourceResult {
            app_id: "268910".to_string(),
            files: vec![ExportedSourceFile {
                logical_path: "steam/achievement-sources/268910/user-game-stats.bin".to_string(),
                source_kind: SteamSourceKind::UserGameStats,
                base64_content: encoded,
                checksum,
                size: new_content.len() as u64,
            }],
            total_size: new_content.len() as u64,
        }];

        let result = restore_sources_inner(tmp.path(), "12345", &exports).unwrap();

        assert_eq!(result.restored, 1);

        // Safety backup should exist
        let backup = tmp
            .path()
            .join("appcache")
            .join("stats")
            .join("UserGameStats_12345_268910.bin.lumasafety");
        assert!(backup.is_file());
        assert_eq!(fs::read(&backup).unwrap(), b"original content");
    }

    #[test]
    fn restore_librarycache_json() {
        let tmp = tmp_steam_root();
        let content = b"{\"appid\":268910}";
        let encoded = base64::engine::general_purpose::STANDARD.encode(content);
        let checksum = compute_checksum(content);

        let exports = vec![ExportedSourceResult {
            app_id: "268910".to_string(),
            files: vec![ExportedSourceFile {
                logical_path: "steam/achievement-sources/268910/librarycache.json".to_string(),
                source_kind: SteamSourceKind::LibraryCacheJson,
                base64_content: encoded,
                checksum,
                size: content.len() as u64,
            }],
            total_size: content.len() as u64,
        }];

        let result = restore_sources_inner(tmp.path(), "12345", &exports).unwrap();

        assert_eq!(result.restored, 1);

        let target = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache")
            .join("268910.json");
        assert!(target.is_file());
        assert_eq!(fs::read(&target).unwrap(), content);
    }

    #[test]
    fn restore_schema_bin() {
        let tmp = tmp_steam_root();
        let content = b"schema data";
        let encoded = base64::engine::general_purpose::STANDARD.encode(content);
        let checksum = compute_checksum(content);

        let exports = vec![ExportedSourceResult {
            app_id: "268910".to_string(),
            files: vec![ExportedSourceFile {
                logical_path: "steam/achievement-sources/268910/user-game-stats-schema.bin"
                    .to_string(),
                source_kind: SteamSourceKind::UserGameStatsSchema,
                base64_content: encoded,
                checksum,
                size: content.len() as u64,
            }],
            total_size: content.len() as u64,
        }];

        let result = restore_sources_inner(tmp.path(), "12345", &exports).unwrap();

        assert_eq!(result.restored, 1);
        let target = tmp
            .path()
            .join("appcache")
            .join("stats")
            .join("UserGameStatsSchema_268910.bin");
        assert!(target.is_file());
    }

    #[test]
    fn restore_checksum_mismatch_detected() {
        let tmp = tmp_steam_root();
        let content = b"actual content";
        let encoded = base64::engine::general_purpose::STANDARD.encode(content);
        let wrong_checksum = compute_checksum(b"wrong data");

        let exports = vec![ExportedSourceResult {
            app_id: "268910".to_string(),
            files: vec![ExportedSourceFile {
                logical_path: "steam/achievement-sources/268910/user-game-stats.bin".to_string(),
                source_kind: SteamSourceKind::UserGameStats,
                base64_content: encoded,
                checksum: wrong_checksum,
                size: content.len() as u64,
            }],
            total_size: content.len() as u64,
        }];

        let result = restore_sources_inner(tmp.path(), "12345", &exports).unwrap();

        // File is still written, but checksum validation fails
        assert_eq!(result.restored, 0);
        assert_eq!(result.failed, 1);
        assert!(!result.checksums_valid);
    }

    #[test]
    fn restore_empty_exports() {
        let tmp = tmp_steam_root();
        let result = restore_sources_inner(tmp.path(), "12345", &[]).unwrap();

        assert_eq!(result.restored, 0);
        assert_eq!(result.failed, 0);
        assert!(result.checksums_valid);
    }

    // ══════════════════════════════════════════════════════════════
    //  SteamSourceKind serde
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn steam_source_kind_serde_roundtrip() {
        let kinds = vec![
            SteamSourceKind::UserGameStats,
            SteamSourceKind::UserGameStatsSchema,
            SteamSourceKind::LibraryCacheJson,
        ];
        for kind in kinds {
            let json = serde_json::to_string(&kind).unwrap();
            let back: SteamSourceKind = serde_json::from_str(&json).unwrap();
            let json2 = serde_json::to_string(&back).unwrap();
            assert_eq!(json, json2);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  RejectedSourceFile serde
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn rejected_source_file_has_all_fields() {
        let r = RejectedSourceFile {
            file_name: "0.json".to_string(),
            source_kind: "librarycache".to_string(),
            reason: "invalid-app-id".to_string(),
        };
        assert_eq!(r.file_name, "0.json");
        assert_eq!(r.reason, "invalid-app-id");
    }

    // ══════════════════════════════════════════════════════════════
    //  Logical path correctness
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn logical_path_user_game_stats() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"x");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(
            manifest.games[0].files[0].logical_path,
            "steam/achievement-sources/268910/user-game-stats.bin"
        );
    }

    #[test]
    fn logical_path_schema() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStatsSchema_268910.bin"), b"x");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(
            manifest.games[0].files[0].logical_path,
            "steam/achievement-sources/268910/user-game-stats-schema.bin"
        );
    }

    #[test]
    fn logical_path_librarycache() {
        let tmp = tmp_steam_root();
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");
        write_file(&libcache.join("268910.bin"), b"x");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        // librarycache uses .json extension, so a .bin file won't be collected
        assert_eq!(manifest.total_games, 0);
    }

    // ══════════════════════════════════════════════════════════════
    //  Schema-only rejection scenarios
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn audit_mixed_valid_and_invalid_appids() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");

        // Valid
        write_file(&stats.join("UserGameStats_12345_268910.bin"), b"v");
        // Invalid (0)
        write_file(&stats.join("UserGameStats_12345_0.bin"), b"z");
        // Invalid (non-numeric)
        write_file(&libcache.join("unknown.json"), b"{}");
        // Valid
        write_file(&libcache.join("480.json"), b"{}");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert_eq!(manifest.total_games, 2); // 268910 + 480
        assert_eq!(manifest.rejected.len(), 2); // 0.bin + unknown.json
    }

    // ══════════════════════════════════════════════════════════════
    //  File not found in read_file_raw
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn read_file_raw_nonexistent_returns_none() {
        let result = read_file_raw(Path::new("/nonexistent/file.bin"));
        assert!(result.is_none());
    }

    // ══════════════════════════════════════════════════════════════
    //  Requires steam closed flags
    // ══════════════════════════════════════════════════════════════

    #[test]
    fn user_game_stats_requires_steam_closed() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStats_12345_100.bin"), b"x");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert!(manifest.games[0].files[0].requires_steam_closed);
    }

    #[test]
    fn schema_requires_steam_closed() {
        let tmp = tmp_steam_root();
        let stats = tmp.path().join("appcache").join("stats");
        write_file(&stats.join("UserGameStatsSchema_100.bin"), b"x");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert!(manifest.games[0].files[0].requires_steam_closed);
    }

    #[test]
    fn librarycache_does_not_require_steam_closed() {
        let tmp = tmp_steam_root();
        let libcache = tmp
            .path()
            .join("userdata")
            .join("12345")
            .join("config")
            .join("librarycache");
        write_file(&libcache.join("100.json"), b"{}");

        let manifest = audit_steam_achievement_sources(
            Some(tmp.path().to_str().unwrap().to_string()),
            "12345".to_string(),
        )
        .unwrap();

        assert!(!manifest.games[0].files[0].requires_steam_closed);
    }
}
