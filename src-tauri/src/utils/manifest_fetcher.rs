use std::cmp::Ordering;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use flate2::read::DeflateDecoder;
use regex::Regex;
use reqwest::blocking::Client;
use serde::Deserialize;
use tauri::AppHandle;
use tauri::Manager;

use crate::utils::manifest_parser;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_OWNER: &str = "steamtools-games";
const GITHUB_REPO: &str = "ManifestHub3";

const API_TIMEOUT_SECS: u64 = 30;
const DOWNLOAD_TIMEOUT_SECS: u64 = 120;
const MAX_DECOMPRESS_BYTES: u64 = 512 * 1024 * 1024; // 512 MB safety limit

const BACKUP_DIR_NAME: &str = "manifest-backup";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct FetchedManifest {
    pub depot_id: u64,
    pub manifest_gid: String,
    pub is_latest: bool,
    pub placed_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubContentEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRefEntry {
    #[serde(rename = "ref")]
    ref_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Fetch manifests for all depots of a game from the GitHub repository.
///
/// For each depot, tries 3 strategies:
/// 1. Direct raw download using PICS gid (0 API cost if hit)
/// 2. Latest file from branch (highest gid)
/// 3. Tags fallback (old versions)
pub fn fetch_manifests_for_game(
    app_handle: &AppHandle,
    app_id: u64,
    depot_ids: &[u64],
    pics_gids: &HashMap<u64, String>,
) -> Result<Vec<FetchedManifest>, String> {
    // 1. Try local backup first (silent, no network)
    if let Ok(Some(local)) = try_restore_from_backup(app_handle, app_id, depot_ids) {
        if !local.is_empty() {
            return Ok(local);
        }
    }

    // 2. Fetch from ManifestHub3
    let client = build_client()?;
    let branch_files = get_branch_files(&client, app_id)?;

    let branch_files = match branch_files {
        Some(files) => files,
        None => {
            return Err(format!(
                "Game {} has no branch in the manifest repository",
                app_id
            ));
        }
    };

    let mut results = Vec::new();
    for &depot_id in depot_ids {
        let pics_gid = pics_gids.get(&depot_id).cloned().unwrap_or_default();
        match fetch_one_depot(&client, app_id, depot_id, &pics_gid, &branch_files) {
            Some(manifest) => results.push(manifest),
            None => {
                // Depot not found in repo — not an error, just skip
            }
        }
    }

    // Save each fetched manifest to depotcache
    for manifest in &mut results {
        if let Some(ref bytes) = get_manifest_bytes(&client, app_id, manifest) {
            if let Ok(path) = save_manifest_to_depotcache(app_handle, manifest.depot_id, &manifest.manifest_gid, bytes) {
                manifest.placed_path = Some(path);
                backup_manifest(app_handle, app_id, manifest.depot_id, &manifest.manifest_gid);
            }
        }
    }

    Ok(results)
}

/// Get list of manifest files in a branch. Returns map of depot_id -> max_gid.
/// Returns None if the branch doesn't exist (404).
pub fn get_branch_files(
    client: &Client,
    app_id: u64,
) -> Result<Option<HashMap<u64, String>>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/contents/?ref={}",
        GITHUB_OWNER, GITHUB_REPO, app_id
    );

    let response = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .send();

    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                let entries: Vec<GitHubContentEntry> = resp
                    .json()
                    .map_err(|e| format!("Failed to parse GitHub contents: {e}"))?;

                let re = Regex::new(r"^(\d+)_(\d+)\.manifest$").unwrap();
                let mut map: HashMap<u64, String> = HashMap::new();

                for entry in &entries {
                    if entry.entry_type.as_deref() != Some("file") {
                        continue;
                    }
                    if let Some(ref name) = entry.name {
                        if let Some(caps) = re.captures(name) {
                            if let (Some(depot_str), Some(gid_str)) =
                                (caps.get(1), caps.get(2))
                            {
                                if let Ok(depot_id) = depot_str.as_str().parse::<u64>() {
                                    let gid = gid_str.as_str().to_string();
                                    // Keep highest gid per depot
                                    if let Some(existing) = map.get(&depot_id) {
                                        if compare_gid(&gid, existing) == Ordering::Greater {
                                            map.insert(depot_id, gid);
                                        }
                                    } else {
                                        map.insert(depot_id, gid);
                                    }
                                }
                            }
                        }
                    }
                }

                Ok(Some(map))
            } else if resp.status().as_u16() == 404 {
                Ok(None) // Branch doesn't exist
            } else {
                Err(format!(
                    "GitHub API returned status {}",
                    resp.status()
                ))
            }
        }
        Err(e) => Err(format!("Failed to fetch branch files: {e}")),
    }
}

/// Fetch a single depot's manifest using the 3-strategy approach.
fn fetch_one_depot(
    client: &Client,
    app_id: u64,
    depot_id: u64,
    pics_gid: &str,
    branch_files: &HashMap<u64, String>,
) -> Option<FetchedManifest> {
    // Strategy 1: Direct PICS gid raw download
    if let Ok(gid_num) = pics_gid.parse::<u64>() {
        if gid_num != 0 {
            let name = format!("{}_{}.manifest", depot_id, pics_gid);
            let url = branch_raw_url(app_id, &name);
            if let Some(bytes) = try_download_bytes(client, &url) {
                if let Some(placed) = try_prepare_manifest(&bytes) {
                    return Some(FetchedManifest {
                        depot_id,
                        manifest_gid: pics_gid.to_string(),
                        is_latest: true,
                        placed_path: None,
                    });
                }
            }
        }
    }

    // Strategy 2: Latest file from branch
    if let Some(branch_gid) = branch_files.get(&depot_id) {
        let name = format!("{}_{}.manifest", depot_id, branch_gid);
        let url = branch_raw_url(app_id, &name);
        if let Some(bytes) = try_download_bytes(client, &url) {
            if let Some(_placed) = try_prepare_manifest(&bytes) {
                let is_latest = pics_gid.is_empty() || branch_gid == pics_gid;
                return Some(FetchedManifest {
                    depot_id,
                    manifest_gid: branch_gid.clone(),
                    is_latest,
                    placed_path: None,
                });
            }
        }
    }

    // Strategy 3: Tags fallback
    if let Some(tag_gid) = get_max_tag_gid(client, depot_id) {
        let tag = format!("{}_{}", depot_id, tag_gid);
        let name = format!("{}.manifest", tag);
        let url = format!(
            "https://raw.githubusercontent.com/{}/{}/refs/tags/{}/{}",
            GITHUB_OWNER, GITHUB_REPO, tag, name
        );
        if let Some(bytes) = try_download_bytes(client, &url) {
            if let Some(_placed) = try_prepare_manifest(&bytes) {
                return Some(FetchedManifest {
                    depot_id,
                    manifest_gid: tag_gid,
                    is_latest: false,
                    placed_path: None,
                });
            }
        }
    }

    None
}

/// Get the highest gid tag for a specific depot.
fn get_max_tag_gid(client: &Client, depot_id: u64) -> Option<String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/git/matching-refs/tags/{}_",
        GITHUB_OWNER, GITHUB_REPO, depot_id
    );

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let refs: Vec<GitHubRefEntry> = resp.json().ok()?;
    let re = Regex::new(r"^(\d+)_(\d+)$").unwrap();
    let mut best: Option<String> = None;

    for entry in &refs {
        if let Some(ref ref_path) = entry.ref_path {
            let tag_name = ref_path.split('/').last().unwrap_or("");
            if let Some(caps) = re.captures(tag_name) {
                if let Some(depot_match) = caps.get(1) {
                    if depot_match.as_str() == depot_id.to_string() {
                        if let Some(gid_match) = caps.get(2) {
                            let gid = gid_match.as_str().to_string();
                            if let Some(ref cur) = best {
                                if compare_gid(&gid, cur) == Ordering::Greater {
                                    best = Some(gid);
                                }
                            } else {
                                best = Some(gid);
                            }
                        }
                    }
                }
            }
        }
    }

    best
}

/// Try to prepare manifest bytes: parse raw or decompress (Pro format).
/// Returns Some(bytes) if valid, None if corrupted.
pub fn try_prepare_manifest(raw: &[u8]) -> Option<Vec<u8>> {
    if raw.len() < 16 {
        return None;
    }

    // Try raw first
    if manifest_parser::try_read_manifest_bytes(raw).is_some() {
        return Some(raw.to_vec());
    }

    // Try decompression with different offsets (Pro format: 10-byte header + deflate)
    for offset in [10, 2, 0] {
        if let Some(inflated) = try_inflate_at(raw, offset) {
            if manifest_parser::try_read_manifest_bytes(&inflated).is_some() {
                return Some(inflated);
            }
        }
    }

    None
}

/// Save manifest bytes to Steam's depotcache directory and LumaForge backup.
pub fn save_manifest_to_depotcache(
    app_handle: &AppHandle,
    depot_id: u64,
    manifest_gid: &str,
    bytes: &[u8],
) -> Result<String, String> {
    let paths = crate::utils::path_utils::detect_steam_paths()
        .ok_or("Steam installation not found")?;

    let depotcache = std::path::Path::new(&paths.depotcache_path);
    if !depotcache.exists() {
        std::fs::create_dir_all(depotcache)
            .map_err(|e| format!("Failed to create depotcache: {e}"))?;
    }

    let filename = format!("{}_{}.manifest", depot_id, manifest_gid);
    let dest = depotcache.join(&filename);
    std::fs::write(&dest, bytes)
        .map_err(|e| format!("Failed to write manifest: {e}"))?;

    Ok(dest.to_string_lossy().to_string())
}

/// Backup a manifest file to LumaForge's backup directory.
/// Called after writing to depotcache. Silent, no error propagation.
pub fn backup_manifest(
    app_handle: &AppHandle,
    app_id: u64,
    depot_id: u64,
    manifest_gid: &str,
) {
    let Ok(app_data) = app_handle.path().app_data_dir() else { return };
    let backup_dir = app_data.join(BACKUP_DIR_NAME).join(app_id.to_string());
    let _ = std::fs::create_dir_all(&backup_dir);

    let filename = format!("{}_{}.manifest", depot_id, manifest_gid);
    let paths = match crate::utils::path_utils::detect_steam_paths() {
        Some(p) => p,
        None => return,
    };
    let source = Path::new(&paths.depotcache_path).join(&filename);
    if source.exists() {
        let _ = std::fs::copy(&source, backup_dir.join(&filename));
    }
}

/// Try to restore manifests from local backup (no network needed).
/// Returns Some(results) if any manifests were found and restored.
fn try_restore_from_backup(
    app_handle: &AppHandle,
    app_id: u64,
    depot_ids: &[u64],
) -> Result<Option<Vec<FetchedManifest>>, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?;

    let backup_dir = app_data.join(BACKUP_DIR_NAME).join(app_id.to_string());
    if !backup_dir.exists() {
        return Ok(None);
    }

    let paths = crate::utils::path_utils::detect_steam_paths()
        .ok_or("Steam installation not found")?;
    let depotcache = Path::new(&paths.depotcache_path);

    let mut results = Vec::new();

    for &depot_id in depot_ids {
        // Scan backup dir for files matching this depot_id
        if let Ok(entries) = std::fs::read_dir(&backup_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".manifest") {
                    continue;
                }
                // Parse depot_id from filename: {depot_id}_{gid}.manifest
                let stem = name.strip_suffix(".manifest").unwrap_or(&name);
                let parts: Vec<&str> = stem.splitn(2, '_').collect();
                if parts.len() != 2 {
                    continue;
                }
                if let Ok(file_depot_id) = parts[0].parse::<u64>() {
                    if file_depot_id == depot_id {
                        let gid = parts[1].to_string();
                        // Copy to depotcache if not already there
                        let dest = depotcache.join(&name);
                        if !dest.exists() {
                            let _ = std::fs::copy(entry.path(), &dest);
                        }
                        results.push(FetchedManifest {
                            depot_id,
                            manifest_gid: gid,
                            is_latest: true,
                            placed_path: Some(dest.to_string_lossy().to_string()),
                        });
                    }
                }
            }
        }
    }

    if results.is_empty() {
        Ok(None)
    } else {
        Ok(Some(results))
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("LumaForge/1.2.0")
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

fn branch_raw_url(app_id: u64, file_name: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        GITHUB_OWNER, GITHUB_REPO, app_id, file_name
    )
}

fn try_download_bytes(client: &Client, url: &str) -> Option<Vec<u8>> {
    let resp = client.get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().ok()?;
    if bytes.len() < 16 {
        return None;
    }
    Some(bytes.to_vec())
}

/// Download raw bytes for a manifest (used internally for saving).
fn get_manifest_bytes(client: &Client, app_id: u64, manifest: &FetchedManifest) -> Option<Vec<u8>> {
    // Try raw download
    let name = format!("{}_{}.manifest", manifest.depot_id, manifest.manifest_gid);
    let url = branch_raw_url(app_id, &name);
    if let Some(bytes) = try_download_bytes(client, &url) {
        if let Some(prepared) = try_prepare_manifest(&bytes) {
            return Some(prepared);
        }
    }
    None
}

fn try_inflate_at(raw: &[u8], offset: usize) -> Option<Vec<u8>> {
    if offset >= raw.len() {
        return None;
    }

    let mut decoder = DeflateDecoder::new(&raw[offset..]);
    let mut output = Vec::new();
    let mut buf = [0u8; 65536];
    let mut total: u64 = 0;

    loop {
        let n = decoder.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_DECOMPRESS_BYTES {
            return None;
        }
        output.extend_from_slice(&buf[..n]);
    }

    if output.is_empty() {
        return None;
    }

    Some(output)
}

/// Compare manifest GIDs as decimal strings: first by length, then lexicographically.
fn compare_gid(a: &str, b: &str) -> std::cmp::Ordering {
    if a.len() != b.len() {
        return a.len().cmp(&b.len());
    }
    a.cmp(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_gid() {
        assert_eq!(compare_gid("123", "456"), std::cmp::Ordering::Less);
        assert_eq!(compare_gid("999", "100"), std::cmp::Ordering::Greater);
        assert_eq!(compare_gid("123", "123"), std::cmp::Ordering::Equal);
        assert_eq!(compare_gid("1234", "123"), std::cmp::Ordering::Greater);
    }

    #[test]
    fn test_branch_raw_url() {
        let url = branch_raw_url(730, "2555350_12345.manifest");
        assert!(url.contains("steamtools-games"));
        assert!(url.contains("ManifestHub3"));
        assert!(url.contains("/730/"));
        assert!(url.contains("2555350_12345.manifest"));
    }

    #[test]
    fn test_try_prepare_manifest_too_small() {
        assert!(try_prepare_manifest(&[0u8; 10]).is_none());
    }

    #[test]
    fn test_try_inflate_at_invalid_data() {
        let data = [0u8; 100];
        assert!(try_inflate_at(&data, 50).is_none());
    }

    #[test]
    fn test_try_inflate_at_offset_beyond_data() {
        let data = [0u8; 10];
        assert!(try_inflate_at(&data, 20).is_none());
    }
}
