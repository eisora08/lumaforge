use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPOT_KEYS_URL: &str = "https://api.993499094.xyz/depotkeys.json";
const TOKEN_KEYS_URL: &str = "https://api.993499094.xyz/appaccesstokens.json";
const KEY_INDEX_URL: &str = "https://pan.qzyun.net/f/d/MlArs0/key.txt";

const CACHE_SUBDIR: &str = "cache";
const STEAM_KEYS_DIR: &str = "steam_keys";
const DEPOT_KEYS_FILE: &str = "depotkeys.json";
const TOKEN_KEYS_FILE: &str = "appaccesstokens.json";
const LAST_UPDATE_FILE: &str = ".lastupdate";

/// Refresh cache every 24 hours
const UPDATE_INTERVAL_SECS: u64 = 86400;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn get_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let dir = app_data.join(CACHE_SUBDIR).join(STEAM_KEYS_DIR);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create cache dir: {e}"))?;
    Ok(dir)
}

fn depot_keys_path(cache_dir: &PathBuf) -> PathBuf {
    cache_dir.join(DEPOT_KEYS_FILE)
}

fn token_keys_path(cache_dir: &PathBuf) -> PathBuf {
    cache_dir.join(TOKEN_KEYS_FILE)
}

fn last_update_path(cache_dir: &PathBuf) -> PathBuf {
    cache_dir.join(LAST_UPDATE_FILE)
}

// ---------------------------------------------------------------------------
// Update logic
// ---------------------------------------------------------------------------

fn read_last_update(cache_dir: &PathBuf) -> u64 {
    let path = last_update_path(cache_dir);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

fn write_last_update(cache_dir: &PathBuf) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = fs::write(last_update_path(cache_dir), now.to_string());
}

/// Check if cache needs update (files missing or older than UPDATE_INTERVAL_SECS)
pub fn needs_update(app_handle: &AppHandle) -> Result<bool, String> {
    let cache_dir = get_cache_dir(app_handle)?;
    let depot_path = depot_keys_path(&cache_dir);
    let token_path = token_keys_path(&cache_dir);

    if !depot_path.exists() || !token_path.exists() {
        return Ok(true);
    }

    let last_update = read_last_update(&cache_dir);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(now.saturating_sub(last_update) >= UPDATE_INTERVAL_SECS)
}

/// Download depotkeys.json and appaccesstokens.json from remote sources.
/// Tries primary source first, then falls back to resolving URLs from key index.
pub fn update_key_files(app_handle: &AppHandle) -> Result<(), String> {
    let cache_dir = get_cache_dir(app_handle)?;
    let client = build_client()?;

    // Try primary source first
    let result = try_download_from_primary(&client, &cache_dir);
    if result.is_ok() {
        return result;
    }

    // Fallback: resolve URLs from key index
    try_download_from_index(&client, &cache_dir)
}

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("LumaForge/1.2.0")
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))
}

fn try_download_from_primary(
    client: &reqwest::blocking::Client,
    cache_dir: &PathBuf,
) -> Result<(), String> {
    let depot_bytes = client
        .get(DEPOT_KEYS_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("Failed to download depotkeys.json: {e}"))?;

    let token_bytes = client
        .get(TOKEN_KEYS_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("Failed to download appaccesstokens.json: {e}"))?;

    if depot_bytes.len() < 100 {
        return Err("depotkeys.json too small, likely invalid".to_string());
    }
    if token_bytes.len() < 50 {
        return Err("appaccesstokens.json too small, likely invalid".to_string());
    }

    fs::write(depot_keys_path(cache_dir), &depot_bytes)
        .map_err(|e| format!("Failed to write depotkeys.json: {e}"))?;
    fs::write(token_keys_path(cache_dir), &token_bytes)
        .map_err(|e| format!("Failed to write appaccesstokens.json: {e}"))?;

    write_last_update(cache_dir);
    Ok(())
}

fn try_download_from_index(
    client: &reqwest::blocking::Client,
    cache_dir: &PathBuf,
) -> Result<(), String> {
    let index_content = client
        .get(KEY_INDEX_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| format!("Failed to download key index: {e}"))?;

    let mut depot_url = String::new();
    let mut token_url = String::new();

    for line in index_content.lines() {
        let url = line.trim().to_string();
        if url.ends_with("depotkeys.json") {
            depot_url = url;
        } else if url.ends_with("appaccesstokens.json") {
            token_url = url;
        }
    }

    if depot_url.is_empty() || token_url.is_empty() {
        return Err("Could not resolve depot/token URLs from key index".to_string());
    }

    let depot_bytes = client
        .get(&depot_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("Failed to download depotkeys.json from resolved URL: {e}"))?;

    let token_bytes = client
        .get(&token_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("Failed to download appaccesstokens.json from resolved URL: {e}"))?;

    fs::write(depot_keys_path(cache_dir), &depot_bytes)
        .map_err(|e| format!("Failed to write depotkeys.json: {e}"))?;
    fs::write(token_keys_path(cache_dir), &token_bytes)
        .map_err(|e| format!("Failed to write appaccesstokens.json: {e}"))?;

    write_last_update(cache_dir);
    Ok(())
}

// ---------------------------------------------------------------------------
// Ensure / Load
// ---------------------------------------------------------------------------

/// Ensure key files exist and are fresh. Downloads if missing or stale.
pub fn ensure_key_files(app_handle: &AppHandle) -> Result<(), String> {
    if !needs_update(app_handle)? {
        return Ok(());
    }
    update_key_files(app_handle)
}

/// Load depot keys from cache. Returns map of depot_id -> hex_key.
/// Ensures files exist first.
pub fn load_depot_keys(app_handle: &AppHandle) -> Result<HashMap<u64, String>, String> {
    ensure_key_files(app_handle)?;
    let cache_dir = get_cache_dir(app_handle)?;
    let path = depot_keys_path(&cache_dir);

    if !path.exists() {
        return Err("depotkeys.json not found after ensure".to_string());
    }

    let file = fs::File::open(&path)
        .map_err(|e| format!("Failed to open depotkeys.json: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let json: HashMap<String, String> = serde_json::from_reader(reader)
        .map_err(|e| format!("Failed to parse depotkeys.json: {e}"))?;

    let mut result = HashMap::new();
    for (key, value) in json {
        if let Ok(id) = key.parse::<u64>() {
            if value.len() >= 40 {
                // Valid hex key is at least 40 chars
                result.insert(id, value);
            }
        }
    }

    Ok(result)
}

/// Load app access tokens from cache. Returns map of app_id -> token_hex.
/// Ensures files exist first.
pub fn load_app_tokens(app_handle: &AppHandle) -> Result<HashMap<u64, String>, String> {
    ensure_key_files(app_handle)?;
    let cache_dir = get_cache_dir(app_handle)?;
    let path = token_keys_path(&cache_dir);

    if !path.exists() {
        return Err("appaccesstokens.json not found after ensure".to_string());
    }

    let file = fs::File::open(&path)
        .map_err(|e| format!("Failed to open appaccesstokens.json: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let json: HashMap<String, String> = serde_json::from_reader(reader)
        .map_err(|e| format!("Failed to parse appaccesstokens.json: {e}"))?;

    let mut result = HashMap::new();
    for (key, value) in json {
        if let Ok(id) = key.parse::<u64>() {
            if !value.is_empty() {
                result.insert(id, value);
            }
        }
    }

    Ok(result)
}

/// Load depot keys directly from cache files without AppHandle.
/// Useful for components that don't have access to the Tauri AppHandle.
/// Returns empty map if cache files don't exist.
pub fn load_depot_keys_from_cache() -> Result<HashMap<u64, String>, String> {
    // Try to find cache in common locations
    let possible_paths = get_cache_paths();
    
    for cache_dir in &possible_paths {
        let path = depot_keys_path(cache_dir);
        if path.exists() {
            return read_depot_keys_from_path(&path);
        }
    }
    
    Ok(HashMap::new())
}

/// Get possible cache directory paths (follows the same logic as get_cache_dir)
fn get_cache_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    
    // Try AppData location
    if let Ok(app_data) = std::env::var("APPDATA") {
        paths.push(PathBuf::from(app_data)
            .join("com.einey.lumaforge")
            .join(CACHE_SUBDIR)
            .join(STEAM_KEYS_DIR));
    }
    
    // Try local AppData
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        paths.push(PathBuf::from(local_app_data)
            .join("com.einey.lumaforge")
            .join(CACHE_SUBDIR)
            .join(STEAM_KEYS_DIR));
    }
    
    paths
}

/// Read depot keys from a specific file path
fn read_depot_keys_from_path(path: &PathBuf) -> Result<HashMap<u64, String>, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Failed to open depotkeys.json: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let json: HashMap<String, String> = serde_json::from_reader(reader)
        .map_err(|e| format!("Failed to parse depotkeys.json: {e}"))?;

    let mut result = HashMap::new();
    for (key, value) in json {
        if let Ok(id) = key.parse::<u64>() {
            if value.len() >= 40 {
                result.insert(id, value);
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_dir_creation() {
        let dir = PathBuf::from("test_cache_dir").join(CACHE_SUBDIR).join(STEAM_KEYS_DIR);
        // Just verify the path construction is correct
        assert!(dir.to_string_lossy().contains("steam_keys"));
        assert!(dir.to_string_lossy().contains("cache"));
    }

    #[test]
    fn test_parse_valid_json_keys() {
        let json_str = r#"{"2555350": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", "2555360": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}"#;
        let json: HashMap<String, String> = serde_json::from_str(json_str).unwrap();
        assert_eq!(json.len(), 2);
        assert!(json.contains_key("2555350"));
    }

    #[test]
    fn test_parse_invalid_json() {
        let json_str = r#"not json"#;
        let result: Result<HashMap<String, String>, _> = serde_json::from_str(json_str);
        assert!(result.is_err());
    }
}
