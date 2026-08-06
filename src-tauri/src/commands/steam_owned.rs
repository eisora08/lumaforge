use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::sqlite_cache::SqliteDb;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnedGame {
    pub appid: u32,
    pub name: Option<String>,
    pub playtime_forever: Option<i64>,
    pub playtime_windows_forever: Option<i64>,
    pub playtime_mac_forever: Option<i64>,
    pub playtime_linux_forever: Option<i64>,
    pub has_community_visible_stats: Option<bool>,
    pub last_played: Option<i64>,
    pub img_logo_url: Option<String>,
    pub img_icon_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct OwnedGamesApiResponse {
    response: OwnedGamesData,
}

#[derive(Serialize, Deserialize)]
struct OwnedGamesData {
    game_count: i32,
    games: Vec<OwnedGame>,
}

#[derive(Serialize, Deserialize)]
struct OwnedGamesCache {
    steam_id: String,
    fetched_at: u64,
    games: Vec<OwnedGame>,
}

const OWNED_GAMES_CACHE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const API_URL: &str = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";

fn get_cache_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app dir: {}", e))?;
    Ok(app_dir.join("steam_owned_cache.json"))
}

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

#[tauri::command]
pub fn fetch_steam_owned_games(
    app_handle: AppHandle,
    api_key: String,
    steam_id: String,
    db: tauri::State<'_, SqliteDb>,
) -> Result<Vec<OwnedGame>, String> {
    let cache_path = get_cache_path(&app_handle)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    if cache_path.exists() {
        if let Ok(content) = fs::read_to_string(&cache_path) {
            if let Ok(cache) = serde_json::from_str::<OwnedGamesCache>(&content) {
                if cache.steam_id == steam_id && (now - cache.fetched_at) < OWNED_GAMES_CACHE_TTL_MS {
                    return Ok(cache.games);
                }
            }
        }
    }

    let client = build_client()?;
    let url = format!(
        "{}?key={}&steamid={}&include_appinfo=true&include_played_free_games=true&format=json",
        API_URL, api_key, steam_id
    );

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        if let Ok(content) = fs::read_to_string(&cache_path) {
            if let Ok(cache) = serde_json::from_str::<OwnedGamesCache>(&content) {
                if cache.steam_id == steam_id {
                    println!("[SteamOwned] API returned HTTP {}, using stale cache", status);
                    return Ok(cache.games);
                }
            }
        }
        return Err(format!("Steam API returned HTTP {}", status));
    }

    let api_resp: OwnedGamesApiResponse = resp
        .json()
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let games = api_resp.response.games;

    let cache = OwnedGamesCache {
        steam_id: steam_id.clone(),
        fetched_at: now,
        games: games.clone(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&cache) {
        let _ = fs::write(&cache_path, &json);
        // Dual-write: persist to SQLite for fast boot reads
        if let Some(mutex) = &db.0 {
            if let Ok(guard) = mutex.lock() {
                let catalog_key = format!("steam-owned:{}", steam_id);
                let now_ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as i64;
                let _ = guard.execute(
                    "INSERT OR REPLACE INTO game_catalog_blobs (catalog_key, data_json, updated_at) VALUES (?1, ?2, ?3)",
                    rusqlite::params![catalog_key, json, now_ts],
                );
            }
        }
    }

    println!("[SteamOwned] fetched {} games", games.len());
    Ok(games)
}

#[tauri::command]
pub fn read_steam_owned_cache(app_handle: AppHandle) -> Result<Vec<OwnedGame>, String> {
    let cache_path = get_cache_path(&app_handle)?;
    if !cache_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&cache_path)
        .map_err(|e| format!("Failed to read steam_owned_cache: {}", e))?;
    let cache: OwnedGamesCache = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse steam_owned_cache: {}", e))?;
    Ok(cache.games)
}
