use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::models::game_cache::{
    GameAppInfo, GameArtwork, GameMediaPaths,
    MigrationSummary, SteamGridDbRef, StoreDetails,
};
use crate::models::library_cache::{LibraryAppInfoEntry, LibraryGameDetailsEntry, GameMediaCacheEntry};
use crate::commands::media_cache::process_and_save_with_dedup;

// ---------------------------------------------------------------------------
// Debug flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_GAME_CACHE_LOGS: bool = false;

#[inline]
fn log(msg: &str) {
    if ENABLE_VERBOSE_GAME_CACHE_LOGS {
        println!("[GameCache] {}", msg);
    }
}

// ---------------------------------------------------------------------------
// Path helpers — all under app_data/games/steam/{appid}/
// ---------------------------------------------------------------------------

fn get_games_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let games_dir = app_dir.join("games").join("steam");
    fs::create_dir_all(&games_dir)
        .map_err(|e| format!("Failed to create games dir: {}", e))?;

    Ok(games_dir)
}

fn get_game_dir(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let dir = get_games_dir(app_handle)?.join(safe_filename(app_id));
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create game dir: {}", e))?;
    Ok(dir)
}

fn get_media_dir(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let dir = get_game_dir(app_handle, app_id)?.join("media");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create media dir: {}", e))?;
    Ok(dir)
}

fn get_appinfo_path(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    Ok(get_game_dir(app_handle, app_id)?.join("appinfo.json"))
}

fn get_store_details_path(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    Ok(get_game_dir(app_handle, app_id)?.join("store-details.json"))
}

fn get_artwork_path(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    Ok(get_game_dir(app_handle, app_id)?.join("artwork.json"))
}

fn safe_filename(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

// ---------------------------------------------------------------------------
// GameAppInfo CRUD — app_data/games/steam/{appid}/appinfo.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_game_app_info(
    app_handle: AppHandle,
    app_id: String,
) -> Result<Option<GameAppInfo>, String> {
    let path = get_appinfo_path(&app_handle, &app_id)?;
    if !path.exists() {
        log(&format!("appinfo miss for {}", app_id));
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read game appinfo: {}", e))?;
    match serde_json::from_str(&content) {
        Ok(entry) => {
            log(&format!("appinfo hit for {}", app_id));
            Ok(Some(entry))
        }
        Err(_) => {
            log(&format!("appinfo corrupt for {} — ignoring", app_id));
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn save_game_app_info(
    app_handle: AppHandle,
    app_id: String,
    entry: GameAppInfo,
) -> Result<(), String> {
    let path = get_appinfo_path(&app_handle, &app_id)?;
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize game appinfo: {}", e))?;
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write game appinfo: {}", e))?;
    log(&format!("appinfo saved for {}", app_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// StoreDetails CRUD — app_data/games/steam/{appid}/store-details.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_store_details(
    app_handle: AppHandle,
    app_id: String,
) -> Result<Option<StoreDetails>, String> {
    let path = get_store_details_path(&app_handle, &app_id)?;
    if !path.exists() {
        log(&format!("store-details miss for {}", app_id));
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read store details: {}", e))?;
    match serde_json::from_str(&content) {
        Ok(entry) => {
            log(&format!("store-details hit for {}", app_id));
            Ok(Some(entry))
        }
        Err(_) => {
            log(&format!("store-details corrupt for {} — ignoring", app_id));
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn save_store_details(
    app_handle: AppHandle,
    app_id: String,
    entry: StoreDetails,
) -> Result<(), String> {
    let path = get_store_details_path(&app_handle, &app_id)?;
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize store details: {}", e))?;
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write store details: {}", e))?;
    log(&format!("store-details saved for {}", app_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// GameArtwork CRUD — app_data/games/steam/{appid}/artwork.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_game_artwork(
    app_handle: AppHandle,
    app_id: String,
) -> Result<Option<GameArtwork>, String> {
    let path = get_artwork_path(&app_handle, &app_id)?;
    if !path.exists() {
        log(&format!("artwork miss for {}", app_id));
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read game artwork: {}", e))?;
    match serde_json::from_str(&content) {
        Ok(entry) => {
            log(&format!("artwork hit for {}", app_id));
            Ok(Some(entry))
        }
        Err(_) => {
            log(&format!("artwork corrupt for {} — ignoring", app_id));
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn save_game_artwork(
    app_handle: AppHandle,
    app_id: String,
    entry: GameArtwork,
) -> Result<(), String> {
    let path = get_artwork_path(&app_handle, &app_id)?;
    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize game artwork: {}", e))?;
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write game artwork: {}", e))?;
    log(&format!("artwork saved for {}", app_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// Cache landscape.jpg — unified landscape image for all UI
// Priority: 1. SGDB horizontal grid  2. SGDB hero  3. store header_image
//           4. store background  5. fallback placeholder
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cache_landscape_image(
    app_handle: AppHandle,
    app_id: String,
    urls: LandscapeUrls,
    force_refresh: bool,
) -> Result<Option<String>, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;
    let dest_path = media_dir.join("landscape.jpg");

    if dest_path.exists() && !force_refresh {
        log(&format!("landscape cache hit for {}", app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    // Try sources in priority order
    let sources: Vec<Option<String>> = vec![
        urls.sgdb_grid_url,
        urls.sgdb_hero_url,
        urls.store_header_url,
        urls.store_background_url,
    ];

    for url_opt in &sources {
        if let Some(url) = url_opt {
            match safe_single_download(&app_handle, &app_id, url, "landscape", &dest_path) {
                Ok(Some(path)) => return Ok(Some(path)),
                Ok(None) => continue,
                Err(_) => continue,
            }
        }
    }

    log(&format!("no landscape source available for {}", app_id));
    Ok(None)
}

// ---------------------------------------------------------------------------
// Cache cover.jpg — optional cover/poster image
// Priority: 1. SGDB vertical grid/poster  2. store capsule_image
//           3. store capsule_imagev5  4. store header_image fallback  5. none
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cache_cover_image(
    app_handle: AppHandle,
    app_id: String,
    urls: CoverUrls,
    force_refresh: bool,
) -> Result<Option<String>, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;
    let dest_path = media_dir.join("cover.jpg");

    if dest_path.exists() && !force_refresh {
        log(&format!("cover cache hit for {}", app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    let sources: Vec<Option<String>> = vec![
        urls.sgdb_cover_url,
        urls.store_capsule_url,
        urls.store_capsule_v5_url,
        urls.store_header_url,
    ];

    for url_opt in &sources {
        if let Some(url) = url_opt {
            match safe_single_download(&app_handle, &app_id, url, "cover", &dest_path) {
                Ok(Some(path)) => return Ok(Some(path)),
                Ok(None) => continue,
                Err(_) => continue,
            }
        }
    }

    log(&format!("no cover source available for {}", app_id));
    Ok(None)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LandscapeUrls {
    pub sgdb_grid_url: Option<String>,
    pub sgdb_hero_url: Option<String>,
    pub store_header_url: Option<String>,
    pub store_background_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CoverUrls {
    pub sgdb_cover_url: Option<String>,
    pub store_capsule_url: Option<String>,
    pub store_capsule_v5_url: Option<String>,
    pub store_header_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Update canonical appinfo media paths helper
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_game_appinfo_media(
    app_handle: AppHandle,
    app_id: String,
    name: Option<String>,
    media: GameMediaPaths,
    remote: Option<GameRemoteRefsInput>,
) -> Result<(), String> {
    let path = get_appinfo_path(&app_handle, &app_id)?;

    let mut entry: GameAppInfo = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_else(|_| GameAppInfo {
            app_id: app_id.clone(),
            provider: "steam".to_string(),
            name: name.clone(),
            updated_at: None,
            media: None,
            remote: None,
        })
    } else {
        GameAppInfo {
            app_id: app_id.clone(),
            provider: "steam".to_string(),
            name: name.clone(),
            updated_at: None,
            media: None,
            remote: None,
        }
    };

    entry.name = entry.name.or(name);
    entry.media = Some(media);
    if let Some(r) = remote {
        entry.remote = Some(crate::models::game_cache::GameRemoteRefs {
            header_image: r.header_image,
            capsule_image: r.capsule_image,
            background_image: r.background_image,
        });
    }
    entry.updated_at = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );

    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize game appinfo: {}", e))?;
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write game appinfo: {}", e))?;

    log(&format!("appinfo media updated for {}", app_id));
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GameRemoteRefsInput {
    pub header_image: Option<String>,
    pub capsule_image: Option<String>,
    pub background_image: Option<String>,
}

// ---------------------------------------------------------------------------
// Update artwork.json
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_game_artwork(
    app_handle: AppHandle,
    app_id: String,
    sgdb: Option<SteamGridDbRef>,
    paths: GameMediaPaths,
) -> Result<(), String> {
    let path = get_artwork_path(&app_handle, &app_id)?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let entry = GameArtwork {
        app_id: app_id.clone(),
        updated_at: now,
        sources: Default::default(),
        steam_grid_db: sgdb,
        paths,
    };

    let content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize game artwork: {}", e))?;
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write game artwork: {}", e))?;

    log(&format!("artwork updated for {}", app_id));
    Ok(())
}

// ---------------------------------------------------------------------------
// Migration from old paths — consolidate to landscape.jpg / cover.jpg only
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn migrate_to_canonical_cache(app_handle: AppHandle) -> Result<MigrationSummary, String> {
    let mut summary = MigrationSummary {
        app_info_copied: 0,
        details_copied: 0,
        media_folders_moved: 0,
        errors: Vec::new(),
    };

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // --- Migrate library/appinfo.json entries ---
    let old_lib_appinfo_path = app_dir.join("library").join("appinfo.json");
    if old_lib_appinfo_path.exists() {
        if let Ok(content) = fs::read_to_string(&old_lib_appinfo_path) {
            if let Ok(map) = serde_json::from_str::<std::collections::HashMap<String, LibraryAppInfoEntry>>(&content) {
                for (app_id, entry) in &map {
                    let canonical_path = get_appinfo_path(&app_handle, app_id);
                    if let Ok(p) = canonical_path {
                        if p.exists() {
                            continue;
                        }
                        let game_info = GameAppInfo {
                            app_id: app_id.clone(),
                            provider: "steam".to_string(),
                            name: entry.name.clone(),
                            updated_at: entry.updated_at,
                            media: None,
                            remote: None,
                        };
                        if let Ok(content) = serde_json::to_string_pretty(&game_info) {
                            if fs::write(&p, &content).is_ok() {
                                summary.app_info_copied += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Migrate library/details/{appid}.json to store-details ---
    let old_details_dir = app_dir.join("library").join("details");
    if old_details_dir.exists() {
        if let Ok(entries) = fs::read_dir(&old_details_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(old_entry) = serde_json::from_str::<LibraryGameDetailsEntry>(&content) {
                        let canonical_path = get_store_details_path(&app_handle, file_stem);
                        if let Ok(cp) = canonical_path {
                            if cp.exists() {
                                continue;
                            }
                            let store_details = StoreDetails {
                                app_id: file_stem.to_string(),
                                source: old_entry.source.clone(),
                                updated_at: old_entry.updated_at,
                                data: old_entry.data,
                            };
                            if let Ok(json) = serde_json::to_string_pretty(&store_details) {
                                if fs::write(&cp, &json).is_ok() {
                                    summary.details_copied += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // --- Migrate library/media/steam-{appid}/ to games/steam/{appid}/media/ ---
    // Old files: cover.jpg, grid.jpg, hero.jpg → landscape.jpg / cover.jpg
    let old_media_dir = app_dir.join("library").join("media");
    if old_media_dir.exists() {
        if let Ok(entries) = fs::read_dir(&old_media_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if let Some(app_id) = dir_name.strip_prefix("steam-") {
                    let metadata_path = path.join("metadata.json");
                    if metadata_path.exists() {
                        if let Ok(content) = fs::read_to_string(&metadata_path) {
                            if let Ok(cache_entry) = serde_json::from_str::<GameMediaCacheEntry>(&content) {
                                let new_media_dir = match get_media_dir(&app_handle, app_id) {
                                    Ok(d) => d,
                                    Err(_) => continue,
                                };
                                // grid → landscape (first priority)
                                if try_move_media_file(&path, &new_media_dir, &cache_entry.grid_path, "library-grid.jpg", "landscape.jpg") {
                                    summary.media_folders_moved += 1;
                                }
                                // hero → landscape (fallback if no grid)
                                if !new_media_dir.join("landscape.jpg").exists() {
                                    let _ = try_move_media_file(&path, &new_media_dir, &cache_entry.hero_path, "library-hero.jpg", "landscape.jpg");
                                }
                                // cover → cover
                                let _ = try_move_media_file(&path, &new_media_dir, &cache_entry.cover_path, "library-cover.jpg", "cover.jpg");
                            }
                        }
                    }
                }
            }
        }
    }

    log(&format!("migration complete: {} appinfo, {} details, {} media", summary.app_info_copied, summary.details_copied, summary.media_folders_moved));
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Safe single-image download with timeout, content validation, resize/compress
// ---------------------------------------------------------------------------

const DOWNLOAD_TIMEOUT_SECS: u64 = 30;
const MAX_RESPONSE_BYTES: u64 = 50 * 1024 * 1024; // 50 MB

fn safe_single_download(
    _app_handle: &AppHandle,
    _app_id: &str,
    url: &str,
    media_type: &str,
    dest_path: &Path,
) -> Result<Option<String>, String> {
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("LumaForge/0.2.0")
        .build()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to create HTTP client: {}", e)),
    };

    let response = match client.get(url).send() {
        Ok(r) => r,
        Err(e) => {
            log(&format!("safe_download: HTTP error for {}: {}", media_type, e));
            return Ok(None);
        }
    };

    if !response.status().is_success() {
        log(&format!("safe_download: bad status {} for {}", response.status(), media_type));
        return Ok(None);
    }

    if let Some(content_type) = response.headers().get("content-type") {
        if let Ok(ct_str) = content_type.to_str() {
            if !ct_str.starts_with("image/") {
                log(&format!("safe_download: invalid content-type {} for {}", ct_str, media_type));
                return Ok(None);
            }
        }
    }

    let bytes = match response.bytes() {
        Ok(b) => {
            if b.len() as u64 > MAX_RESPONSE_BYTES {
                log(&format!("safe_download: response too large ({} bytes)", b.len()));
                return Ok(None);
            }
            b
        }
        Err(e) => {
            log(&format!("safe_download: read error: {}", e));
            return Ok(None);
        }
    };

    // Write to temp file first, then rename for atomicity
    let temp_path = dest_path.with_extension("tmp");
    match process_and_save_with_dedup(&bytes, &temp_path, media_type) {
        Ok(_) => {
            let _ = fs::remove_file(dest_path);
            match fs::rename(&temp_path, dest_path) {
                Ok(_) => {
                    log(&format!("safe_download: saved {} ({} bytes)", media_type, bytes.len()));
                    Ok(Some(dest_path.to_string_lossy().to_string()))
                }
                Err(e) => {
                    log(&format!("safe_download: rename error: {}", e));
                    // Fallback: temp path is the saved file
                    Ok(Some(temp_path.to_string_lossy().to_string()))
                }
            }
        }
        Err(e) => {
            log(&format!("safe_download: processing error for {}: {}", media_type, e));
            // Fallback: raw save
            match fs::write(dest_path, &bytes) {
                Ok(_) => {
                    let _ = fs::remove_file(&temp_path);
                    log(&format!("safe_download: fallback raw save for {}", media_type));
                    Ok(Some(dest_path.to_string_lossy().to_string()))
                }
                Err(e2) => {
                    log(&format!("safe_download: fallback write error: {}", e2));
                    Ok(None)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// safe_download_image — generic endpoint for media download queue
// Only supports "landscape" and "cover" roles now.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn safe_download_image(
    app_handle: AppHandle,
    url: String,
    app_id: String,
    media_type: String,
    _target: String,
    force_refresh: bool,
) -> Result<Option<String>, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;

    let filename = match media_type.as_str() {
        "landscape" => "landscape.jpg",
        "cover" => "cover.jpg",
        _ => return Err(format!("Unknown media_type: {}", media_type)),
    };

    let dest_path = media_dir.join(filename);

    if dest_path.exists() && !force_refresh {
        log(&format!("safe_download: cache hit for {} of {}", filename, app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    safe_single_download(&app_handle, &app_id, &url, &media_type, &dest_path)
}

fn try_move_media_file(
    _old_game_dir: &std::path::Path,
    new_media_dir: &std::path::Path,
    old_path: &Option<String>,
    _old_filename: &str,
    new_filename: &str,
) -> bool {
    if let Some(path) = old_path {
        let src = std::path::Path::new(path);
        if src.exists() {
            let dst = new_media_dir.join(new_filename);
            if !dst.exists() {
                let _ = fs::copy(src, &dst);
                return true;
            }
        }
    }
    false
}
