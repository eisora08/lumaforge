use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct SteamCmdDepotInfo {
    pub depot_id: u64,
    pub size: u64,
    pub dlc_app_id: Option<u64>,
    pub is_shared: bool,
    pub from_app_id: Option<u64>,
    pub os: Option<String>,
    pub language: Option<String>,
    pub public_manifest_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SteamCmdAppInfo {
    pub app_id: u64,
    pub app_name: Option<String>,
    pub depots: Vec<SteamCmdDepotInfo>,
    pub dlc_ids: Vec<u64>,
}

// ---------------------------------------------------------------------------
// In-memory cache (per session, successes cached forever, failures for 60s)
// ---------------------------------------------------------------------------

struct CacheEntry {
    info: Option<SteamCmdAppInfo>,
    fetched_at: Instant,
}

fn cache() -> &'static Mutex<HashMap<u64, CacheEntry>> {
    static INSTANCE: OnceLock<Mutex<HashMap<u64, CacheEntry>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}

const FAILURE_TTL_SECS: u64 = 60;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Fetch depot metadata for an app from api.steamcmd.net.
/// Results are cached in memory: successes forever, failures for 60 seconds.
pub fn fetch_app_depot_info(app_id: u64) -> Result<SteamCmdAppInfo, String> {
    // Check cache
    {
        let map = cache().lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(entry) = map.get(&app_id) {
            if entry.info.is_some() || entry.fetched_at.elapsed().as_secs() < FAILURE_TTL_SECS {
                return match &entry.info {
                    Some(info) => Ok(info.clone()),
                    None => Err("Previously failed to fetch depot info".to_string()),
                };
            }
        }
    }

    // Fetch from API
    let result = fetch_from_api(app_id);

    // Cache result
    {
        let mut map = cache().lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        map.insert(
            app_id,
            CacheEntry {
                info: result.as_ref().ok().cloned(),
                fetched_at: Instant::now(),
            },
        );
    }

    result
}

fn fetch_from_api(app_id: u64) -> Result<SteamCmdAppInfo, String> {
    let url = format!("https://api.steamcmd.net/v1/info/{}", app_id);

    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!(
            env!("CARGO_PKG_NAME"),
            "/",
            env!("CARGO_PKG_VERSION")
        ))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch depot info: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }

    let root: serde_json::Value = resp
        .json()
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    let data = root
        .get("data")
        .ok_or("No 'data' in response")?
        .get(app_id.to_string())
        .ok_or(format!("No data for app {}", app_id))?;

    // App name
    let app_name = data
        .get("common")
        .and_then(|c| c.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    // Parse depots
    let mut depots = Vec::new();
    if let Some(depot_map) = data.get("depots").and_then(|d| d.as_object()) {
        for (key, val) in depot_map {
            // Skip non-numeric keys (branches, baselanguages, etc.)
            let depot_id: u64 = match key.parse() {
                Ok(id) => id,
                Err(_) => continue,
            };
            if !val.is_object() {
                continue;
            }

            let is_shared = val.get("depotfromapp").is_some();
            let from_app_id = if is_shared {
                val.get("depotfromapp")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<u64>().ok())
            } else {
                None
            };

            let dlc_app_id = val
                .get("dlcappid")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok());

            let mut os = None;
            let mut language = None;
            if let Some(config) = val.get("config").and_then(|c| c.as_object()) {
                os = config
                    .get("oslist")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                language = config
                    .get("dlclanguage")
                    .or_else(|| config.get("language"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }

            let public_manifest_id = val
                .get("manifests")
                .and_then(|m| m.get("public"))
                .and_then(|p| p.get("gid"))
                .and_then(|g| g.as_str())
                .map(|s| s.to_string());

            let public_size = val
                .get("manifests")
                .and_then(|m| m.get("public"))
                .and_then(|p| p.get("size"))
                .and_then(|s| s.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);

            depots.push(SteamCmdDepotInfo {
                depot_id,
                size: public_size,
                dlc_app_id,
                is_shared,
                from_app_id,
                os,
                language,
                public_manifest_id,
            });
        }
    }

    // DLC IDs from extended.listofdlc
    let mut dlc_ids = Vec::new();
    if let Some(extended) = data.get("extended") {
        if let Some(list) = extended.get("listofdlc").and_then(|l| l.as_str()) {
            for part in list.split(',') {
                let trimmed = part.trim();
                if let Ok(id) = trimmed.parse::<u64>() {
                    dlc_ids.push(id);
                }
            }
        }
    }

    Ok(SteamCmdAppInfo {
        app_id,
        app_name,
        depots,
        dlc_ids,
    })
}
