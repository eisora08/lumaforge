use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::models::game_cache::{
    GameAppInfo, GameArtwork, GameMediaPaths,
    MigrationSummary, SteamGridDbRef, StoreDetails,
};
use crate::models::library_cache::{LibraryAppInfoEntry, LibraryGameDetailsEntry, GameMediaCacheEntry};
use crate::commands::media_cache::{process_and_save_with_dedup, repair_hash_index};
use crate::utils::image_utils;

// ---------------------------------------------------------------------------
// read_canonical_appinfos — batch read all appinfo.json files for the given
// appIds. Returns a map of appId → GameAppInfo for only those that exist and
// are valid JSON. Missing or corrupt appinfo is silently skipped.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_canonical_appinfos(
    app_handle: AppHandle,
    app_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, GameAppInfo>, String> {
    let mut result = std::collections::HashMap::new();
    for app_id in &app_ids {
        let path = match get_appinfo_path(&app_handle, app_id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !path.exists() {
            continue;
        }
        match fs::read_to_string(&path) {
            Ok(content) => {
                match serde_json::from_str::<GameAppInfo>(&content) {
                    Ok(entry) => {
                        result.insert(app_id.clone(), entry);
                    }
                    Err(_) => {
                        log(&format!("appinfo corrupt for {} — skipping in batch read", app_id));
                    }
                }
            }
            Err(_) => {}
        }
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Debug flags
// ---------------------------------------------------------------------------

const ENABLE_VERBOSE_GAME_CACHE_LOGS: bool = false;
const ENABLE_VERBOSE_MEDIA_CACHE_LOGS: bool = true;

#[inline]
fn log(msg: &str) {
    if ENABLE_VERBOSE_GAME_CACHE_LOGS {
        println!("[GameCache] {}", msg);
    }
}

#[inline]
fn media_log(msg: &str) {
    if ENABLE_VERBOSE_MEDIA_CACHE_LOGS {
        println!("[MediaCache] {}", msg);
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

pub fn get_game_dir(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let dir = get_games_dir(app_handle)?.join(safe_filename(app_id));
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create game dir: {}", e))?;
    Ok(dir)
}

pub fn get_media_dir(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
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

/// Normalize an absolute media path to a provider-relative path.
/// If the path points inside `<appData>/games/<provider>/<appid>/media/`,
/// return `media/<filename>`. Otherwise return the path as-is.
fn media_path_exists_for_app(app_handle: &AppHandle, app_id: &str, path: &str) -> bool {
    let p = std::path::Path::new(path);
    if p.is_absolute() {
        p.exists()
    } else if let Ok(dir) = get_game_dir(app_handle, app_id) {
        dir.join(path).exists()
    } else {
        p.exists()
    }
}

fn normalize_media_to_relative(app_handle: &AppHandle, app_id: &str, abs_path: &str) -> String {
    if let Ok(media_dir) = get_media_dir(app_handle, app_id) {
        let path = std::path::Path::new(abs_path);
        if let Some(media_parent) = media_dir.parent() {
            if let Ok(canonical) = path.canonicalize() {
                if canonical.starts_with(&media_dir) {
                    if let Ok(rel) = canonical.strip_prefix(&media_dir) {
                        let rel_str = format!("media/{}", rel.to_string_lossy().replace('\\', "/"));
                        media_log(&format!("[PATH] normalized absolute->relative {} -> {}", abs_path, rel_str));
                        return rel_str;
                    }
                } else if canonical.starts_with(media_parent) {
                    // e.g., games/steam/<appid>/media/landscape.jpg -> media/landscape.jpg
                    if let Ok(rel) = canonical.strip_prefix(media_parent) {
                        let rel_str = rel.to_string_lossy().replace('\\', "/");
                        media_log(&format!("[PATH] normalized absolute->relative {} -> {}", abs_path, rel_str));
                        return rel_str;
                    }
                }
            }
            // Non-canonicalized fallback: check if path contains the expected segment
            let path_str = path.to_string_lossy().replace('\\', "/");
            let media_str = media_dir.to_string_lossy().replace('\\', "/");
            if path_str.starts_with(&media_str) {
                let suffix = path_str[media_str.len()..].trim_start_matches('/');
                let rel_str = format!("media/{}", suffix);
                media_log(&format!("[PATH] normalized (non-canonical) {} -> {}", abs_path, rel_str));
                return rel_str;
            }
        }
    }
    abs_path.to_string()
}

pub fn safe_filename(input: &str) -> String {
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

// ---------------------------------------------------------------------------
// Cache background.jpg — hero/background for GameDetails
// Priority: 1. SGDB hero  2. store background_raw  3. store background
//           4. store header_image  5. existing landscape.jpg
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cache_background_image(
    app_handle: AppHandle,
    app_id: String,
    urls: BackgroundUrls,
    force_refresh: bool,
) -> Result<Option<String>, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;
    let dest_path = media_dir.join("background.jpg");

    if dest_path.exists() && !force_refresh {
        log(&format!("background cache hit for {}", app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    let sources: Vec<Option<String>> = vec![
        urls.sgdb_hero_url,
        urls.store_background_raw_url,
        urls.store_background_url,
        urls.store_header_url,
    ];

    for url_opt in &sources {
        if let Some(url) = url_opt {
            match safe_single_download(&app_handle, &app_id, url, "background", &dest_path) {
                Ok(Some(path)) => {
                    media_log(&format!("saved background for {}", app_id));
                    return Ok(Some(path));
                }
                Ok(None) => continue,
                Err(_) => continue,
            }
        }
    }

    // Fallback: copy existing landscape.jpg as background
    let landscape_path = media_dir.join("landscape.jpg");
    if landscape_path.exists() {
        media_log(&format!("background fallback: copying landscape for {}", app_id));
        let _ = std::fs::copy(&landscape_path, &dest_path);
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    log(&format!("no background source available for {}", app_id));
    Ok(None)
}

// ---------------------------------------------------------------------------
// Cache logo.png — transparent logo for GameDetails overlay
// Priority: 1. SGDB logo  2. none
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cache_logo_image(
    app_handle: AppHandle,
    app_id: String,
    urls: LogoUrls,
    force_refresh: bool,
) -> Result<Option<String>, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;
    let dest_path = media_dir.join("logo.png");

    if dest_path.exists() && !force_refresh {
        log(&format!("logo cache hit for {}", app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    if let Some(url) = urls.sgdb_logo_url {
        match safe_single_download(&app_handle, &app_id, &url, "logo", &dest_path) {
            Ok(Some(path)) => {
                media_log(&format!("saved logo for {}", app_id));
                return Ok(Some(path));
            }
            Ok(None) => {}
            Err(_) => {}
        }
    }

    log(&format!("no logo source available for {}", app_id));
    Ok(None)
}

// ---------------------------------------------------------------------------
// Cache icon.png — small icon for sidebar
// Priority: 1. SGDB icon  2. none
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn cache_icon_image(
    app_handle: AppHandle,
    app_id: String,
    urls: IconUrls,
    force_refresh: bool,
) -> Result<Option<String>, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;
    let dest_path = media_dir.join("icon.png");

    if dest_path.exists() && !force_refresh {
        log(&format!("icon cache hit for {}", app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    if let Some(url) = urls.sgdb_icon_url {
        match safe_single_download(&app_handle, &app_id, &url, "icon", &dest_path) {
            Ok(Some(path)) => {
                media_log(&format!("saved icon for {}", app_id));
                return Ok(Some(path));
            }
            Ok(None) => {}
            Err(_) => {}
        }
    }

    log(&format!("no icon source available for {}", app_id));
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BackgroundUrls {
    pub sgdb_hero_url: Option<String>,
    pub store_background_raw_url: Option<String>,
    pub store_background_url: Option<String>,
    pub store_header_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LogoUrls {
    pub sgdb_logo_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IconUrls {
    pub sgdb_icon_url: Option<String>,
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
    media_sources: Option<GameMediaSourcesInput>,
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
            media_sources: None,
            remote: None,
        })
    } else {
        GameAppInfo {
            app_id: app_id.clone(),
            provider: "steam".to_string(),
            name: name.clone(),
            updated_at: None,
            media: None,
            media_sources: None,
            remote: None,
        }
    };

    // Name priority: existing entry.name > incoming name param > store-details > fallback
    if entry.name.is_some() {
        // Keep existing name
    } else if let Some(ref n) = name {
        entry.name = Some(n.clone());
    } else {
        // Try store-details for name
        let store_path = get_store_details_path(&app_handle, &app_id);
        if let Ok(sp) = store_path {
            if sp.exists() {
                if let Ok(sc) = fs::read_to_string(&sp) {
                    if let Ok(sd) = serde_json::from_str::<StoreDetails>(&sc) {
                        if let Some(n) = sd.data.get("name").and_then(|v| v.as_str()) {
                            entry.name = Some(n.to_string());
                            media_log(&format!("[AppInfoUpdate] resolved name from store-details: {}", n));
                        }
                    }
                }
            }
        }
    }

    // Merge incoming paths with existing paths: incoming non-null values
    // override, null values fall through to existing (preserving paths that
    // were set by previous calls). Each path is validated against disk.
    // Paths are then normalized to provider-relative format.
    let existing = entry.media.as_ref();

    let resolve_media_path = |path: &str| -> String {
        let p = std::path::Path::new(path);
        if p.is_relative() {
            if let Ok(dir) = get_game_dir(&app_handle, &app_id) {
                dir.join(path).to_string_lossy().to_string()
            } else {
                path.to_string()
            }
        } else {
            path.to_string()
        }
    };

    let merge_path = |field: &str, incoming: &Option<String>, existing: Option<&String>| -> Option<String> {
        if let Some(p) = incoming {
            let resolved = resolve_media_path(p);
            if media_path_exists_for_app(&app_handle, &app_id, &resolved) {
                let rel = normalize_media_to_relative(&app_handle, &app_id, &resolved);
                if resolved != rel {
                    media_log(&format!("[MEDIA][PATH] normalized before write appid={} input={} relative={}", app_id, resolved, rel));
                }
                media_log(&format!("[MEDIA][APPINFO_WRITE] appid={} field={} relative={}", app_id, field, rel));
                return Some(rel);
            }
            media_log(&format!("[AppInfoUpdate] incoming path missing {}, checking existing: {}", field, p));
        }
        if let Some(ep) = existing {
            if media_path_exists_for_app(&app_handle, &app_id, ep) {
                let rel = normalize_media_to_relative(&app_handle, &app_id, ep);
                return Some(rel);
            }
            media_log(&format!("[AppInfoUpdate] stripping stale existing {} path: {}", field, ep));
        }
        None
    };

    let validated_media = GameMediaPaths {
        cover_path: merge_path("cover", &media.cover_path, existing.and_then(|m| m.cover_path.as_ref())),
        landscape_path: merge_path("landscape", &media.landscape_path, existing.and_then(|m| m.landscape_path.as_ref())),
        background_path: merge_path("background", &media.background_path, existing.and_then(|m| m.background_path.as_ref())),
        logo_path: merge_path("logo", &media.logo_path, existing.and_then(|m| m.logo_path.as_ref())),
        icon_path: merge_path("icon", &media.icon_path, existing.and_then(|m| m.icon_path.as_ref())),
    };

    entry.media = Some(validated_media);
    if let Some(r) = remote {
        entry.remote = Some(crate::models::game_cache::GameRemoteRefs {
            header_image: r.header_image,
            capsule_image: r.capsule_image,
            background_image: r.background_image,
        });
    }
    // Merge mediaSources: incoming non-null values override, null falls through to existing
    if let Some(sources) = media_sources {
        let existing = entry.media_sources.as_ref();
        let merge_src = |incoming: &Option<String>, existing: Option<&String>| -> Option<String> {
            incoming.clone().or_else(|| existing.cloned())
        };
        entry.media_sources = Some(crate::models::game_cache::GameMediaSources {
            landscape: merge_src(&sources.landscape, existing.and_then(|m| m.landscape.as_ref())),
            cover: merge_src(&sources.cover, existing.and_then(|m| m.cover.as_ref())),
            background: merge_src(&sources.background, existing.and_then(|m| m.background.as_ref())),
            logo: merge_src(&sources.logo, existing.and_then(|m| m.logo.as_ref())),
            icon: merge_src(&sources.icon, existing.and_then(|m| m.icon.as_ref())),
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GameMediaSourcesInput {
    pub landscape: Option<String>,
    pub cover: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub icon: Option<String>,
}

// ---------------------------------------------------------------------------
// Media manifest — per-game fast media index
// ---------------------------------------------------------------------------

fn get_media_manifest_path(app_handle: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    Ok(get_game_dir(app_handle, app_id)?.join("media_manifest.json"))
}

#[tauri::command]
pub fn read_media_manifest(
    app_handle: AppHandle,
    app_id: String,
) -> Result<Option<crate::models::game_cache::MediaManifestFile>, String> {
    let path = get_media_manifest_path(&app_handle, &app_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read media_manifest: {}", e))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("Failed to parse media_manifest: {}", e))
}

#[tauri::command]
pub fn write_media_manifest(
    app_handle: AppHandle,
    app_id: String,
    manifest: crate::models::game_cache::MediaManifestFile,
) -> Result<(), String> {
    let path = get_media_manifest_path(&app_handle, &app_id)?;
    let content = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize media_manifest: {}", e))?;
    fs::write(&path, &content)
        .map_err(|e| format!("Failed to write media_manifest: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_media_manifests_batch(
    app_handle: AppHandle,
    app_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, crate::models::game_cache::MediaManifestFile>, String> {
    let mut result = std::collections::HashMap::new();
    for app_id in &app_ids {
        let path = match get_media_manifest_path(&app_handle, app_id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if !path.exists() {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(manifest) = serde_json::from_str::<crate::models::game_cache::MediaManifestFile>(&content) {
                result.insert(app_id.clone(), manifest);
            }
        }
    }
    Ok(result)
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
                            media_sources: None,
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

    // Classify image by aspect ratio to ensure role matches actual dimensions.
    // This prevents vertical/poster images from being saved as landscape.jpg.
    let actual_role = match image_utils::classify_image_role(&bytes, media_type) {
        Ok(Some(role)) => role,
        Ok(None) => {
            media_log(&format!("[MediaClassify] rejected {} for {} — skipping", media_type, _app_id));
            return Ok(None);
        }
        Err(e) => {
            media_log(&format!("[MediaClassify] classification error for {}: {}", media_type, e));
            // Fall through to original media_type
            media_type.to_string()
        }
    };

    // If reclassified to a different role, adjust dest_path
    let (actual_dest_path, actual_media_type) = if actual_role != media_type {
        let new_filename = match actual_role.as_str() {
            "cover" => "cover.jpg",
            "landscape" => "landscape.jpg",
            "background" => "background.jpg",
            "logo" => "logo.png",
            "icon" => "icon.png",
            _ => media_type,
        };
        let new_path = dest_path.parent().unwrap().join(new_filename);
        media_log(&format!("[MediaClassify] reclassified {} -> {}, path: {}", media_type, actual_role, new_path.display()));
        (new_path, actual_role)
    } else {
        (dest_path.to_path_buf(), media_type.to_string())
    };

    // Write to temp file first, then rename for atomicity.
    // The hash index is updated by process_and_save_with_dedup with the
    // final filename (landscape.jpg / cover.jpg), never .tmp.
    let temp_path = actual_dest_path.with_extension("tmp");
    media_log(&format!("temp write start — {} -> {}", actual_media_type, temp_path.display()));
    match process_and_save_with_dedup(&bytes, &temp_path, &actual_media_type) {
        Ok(_saved_path) => {
            // Dedup hit: process_and_save_with_dedup returned path of existing file.
            // If the temp file does NOT exist, this was a dedup reuse — nothing to rename.
            if !temp_path.exists() {
                if actual_dest_path.exists() {
                    media_log(&format!("dedup reuse — using existing {}", actual_dest_path.display()));
                    return Ok(Some(actual_dest_path.to_string_lossy().to_string()));
                }
                // Temp missing and final missing — shouldn't happen, fall through to retry
                media_log(&format!("dedup temp missing and no final file — re-downloading"));
                match fs::write(&actual_dest_path, &bytes) {
                    Ok(_) => return Ok(Some(actual_dest_path.to_string_lossy().to_string())),
                    Err(e2) => {
                        log(&format!("safe_download: fallback write error: {}", e2));
                        return Ok(None);
                    }
                }
            }

            media_log(&format!("temp write success — {} ({} bytes)", actual_media_type, bytes.len()));
            let _ = fs::remove_file(&actual_dest_path);
            match fs::rename(&temp_path, &actual_dest_path) {
                Ok(_) => {
                    media_log(&format!("rename temp to final — {} -> {}", temp_path.display(), actual_dest_path.display()));
                    // Defensive: ensure hash index points to final file, not .tmp
                    if let Some(parent) = actual_dest_path.parent() {
                        let _ = repair_hash_index(parent);
                    }
                    log(&format!("safe_download: saved {} ({} bytes)", actual_media_type, bytes.len()));
                    Ok(Some(actual_dest_path.to_string_lossy().to_string()))
                }
                Err(e) => {
                    // Rename failed — try copy as fallback, never return .tmp path
                    if temp_path.exists() {
                        media_log(&format!("rename failed ({}), trying copy", e));
                        match fs::copy(&temp_path, &actual_dest_path) {
                            Ok(_) => {
                                let _ = fs::remove_file(&temp_path);
                                media_log(&format!("final path returned — {}", actual_dest_path.display()));
                                log(&format!("safe_download: saved {} via copy ({} bytes)", actual_media_type, bytes.len()));
                                Ok(Some(actual_dest_path.to_string_lossy().to_string()))
                            }
                            Err(e2) => {
                                media_log(&format!("copy also failed: {}", e2));
                                let _ = fs::remove_file(&temp_path);
                                log(&format!("safe_download: rename AND copy failed for {}: {}, {}", actual_media_type, e, e2));
                                Ok(None)
                            }
                        }
                    } else {
                        media_log(&format!("temp file missing after process — {}", temp_path.display()));
                        Ok(None)
                    }
                }
            }
        }
        Err(e) => {
            log(&format!("safe_download: processing error for {}: {}", actual_media_type, e));
            // Fallback: raw save (to final path, never .tmp)
            let _ = fs::remove_file(&temp_path);
            match fs::write(&actual_dest_path, &bytes) {
                Ok(_) => {
                    log(&format!("safe_download: fallback raw save for {}", actual_media_type));
                    Ok(Some(actual_dest_path.to_string_lossy().to_string()))
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
        "background" => "background.jpg",
        "logo" => "logo.png",
        "icon" => "icon.png",
        _ => return Err(format!("Unknown media_type: {}", media_type)),
    };

    let dest_path = media_dir.join(filename);

    if dest_path.exists() && !force_refresh {
        log(&format!("safe_download: cache hit for {} of {}", filename, app_id));
        return Ok(Some(dest_path.to_string_lossy().to_string()));
    }

    safe_single_download(&app_handle, &app_id, &url, &media_type, &dest_path)
}

// ---------------------------------------------------------------------------
// resolve_game_media_paths — check if media files exist on disk, return paths
// Does NOT create directories or download anything.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn resolve_game_media_paths(
    app_handle: AppHandle,
    app_id: String,
) -> Result<GameMediaPaths, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let media_dir = app_dir.join("games").join("steam")
        .join(safe_filename(&app_id)).join("media");

    // Repair any stale .tmp entries in the hash index
    if media_dir.exists() {
        let _ = repair_hash_index(&media_dir);
    }

    // If a .tmp file exists but final doesn't, try to rename it now
    for (tmp_name, final_name) in [
        ("landscape.tmp", "landscape.jpg"),
        ("cover.tmp", "cover.jpg"),
        ("background.tmp", "background.jpg"),
        ("logo.tmp", "logo.png"),
        ("icon.tmp", "icon.png"),
    ] {
        let tmp_path = media_dir.join(tmp_name);
        let final_path = media_dir.join(final_name);
        if tmp_path.exists() && !final_path.exists() {
            media_log(&format!("resolve: renaming orphan {} -> {}", tmp_name, final_name));
            let _ = fs::rename(&tmp_path, &final_path);
        }
    }

    let cover_path = {
        let p = media_dir.join("cover.jpg");
        if p.exists() { Some(p.to_string_lossy().to_string()) }
        else { let p2 = media_dir.join("cover.png"); if p2.exists() { Some(p2.to_string_lossy().to_string()) } else { None } }
    };

    let background_path = {
        let p = media_dir.join("background.jpg");
        if p.exists() { Some(p.to_string_lossy().to_string()) }
        else { let p2 = media_dir.join("background.png"); if p2.exists() { Some(p2.to_string_lossy().to_string()) } else { None } }
    };

    let logo_path = {
        let p = media_dir.join("logo.png");
        if p.exists() { Some(p.to_string_lossy().to_string()) }
        else { let p2 = media_dir.join("logo.jpg"); if p2.exists() { Some(p2.to_string_lossy().to_string()) } else { None } }
    };

    let icon_path = {
        let p = media_dir.join("icon.png");
        if p.exists() { Some(p.to_string_lossy().to_string()) }
        else { let p2 = media_dir.join("icon.jpg"); if p2.exists() { Some(p2.to_string_lossy().to_string()) } else { None } }
    };

    let landscape_path = {
        let p = media_dir.join("landscape.jpg");
        if p.exists() { Some(p.to_string_lossy().to_string()) }
        else { let p2 = media_dir.join("landscape.png"); if p2.exists() { Some(p2.to_string_lossy().to_string()) } else { None } }
    };

    media_log(&format!(
        "resolve: cover={}, background={}, logo={}, icon={}, landscape={}",
        cover_path.is_some(), background_path.is_some(),
        logo_path.is_some(), icon_path.is_some(), landscape_path.is_some(),
    ));
    Ok(GameMediaPaths {
        cover_path,
        background_path,
        logo_path,
        icon_path,
        landscape_path,
    })
}

// ---------------------------------------------------------------------------
// get_game_media_paths — like resolve_game_media_paths but also returns
// per-role existence booleans so the frontend can know exactly which files
// exist without guessing. Only returns paths for files that physically exist.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_game_media_paths(
    app_handle: AppHandle,
    app_id: String,
) -> Result<crate::models::game_cache::GameMediaPathsResult, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let media_dir = app_dir.join("games").join("steam")
        .join(safe_filename(&app_id)).join("media");

    fn first_existing(dir: &std::path::Path, names: &[&str]) -> (Option<String>, bool) {
        for name in names {
            let p = dir.join(name);
            if p.exists() {
                return (Some(p.to_string_lossy().to_string()), true);
            }
        }
        (None, false)
    }

    let (cover_path, cover_exists) = first_existing(&media_dir, &["cover.jpg", "cover.png"]);
    let (landscape_path, landscape_exists) = first_existing(&media_dir, &["landscape.jpg", "landscape.png"]);
    let (background_path, background_exists) = first_existing(&media_dir, &["background.jpg", "background.png"]);
    let (logo_path, logo_exists) = first_existing(&media_dir, &["logo.png", "logo.jpg"]);
    let (icon_path, icon_exists) = first_existing(&media_dir, &["icon.png", "icon.jpg"]);

    media_log(&format!(
        "get_game_media_paths: app={} cover={} landscape={} background={} logo={} icon={}",
        app_id, cover_exists, landscape_exists, background_exists, logo_exists, icon_exists,
    ));

    Ok(crate::models::game_cache::GameMediaPathsResult {
        cover_path,
        cover_exists,
        landscape_path,
        landscape_exists,
        background_path,
        background_exists,
        logo_path,
        logo_exists,
        icon_path,
        icon_exists,
    })
}

// ---------------------------------------------------------------------------
// repair_appinfo_media_paths — validate all paths in appinfo.json and strip
// any that point to non-existent files. Also scans disk for media files that
// exist but are not referenced in appinfo.json and adds them.
// Returns true if any changes were made.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn repair_appinfo_media_paths(
    app_handle: AppHandle,
    app_id: String,
) -> Result<bool, String> {
    let path = get_appinfo_path(&app_handle, &app_id)?;
    if !path.exists() {
        return Ok(false);
    }

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    let mut entry: GameAppInfo = match serde_json::from_str(&content) {
        Ok(e) => e,
        Err(_) => return Ok(false),
    };

    let existing_media = entry.media.clone();
    let mut changed = false;

    // Scan disk for all media files
    let media_dir = get_media_dir(&app_handle, &app_id)?;

    let disk_check = |filename: &str| -> Option<String> {
        let p = media_dir.join(filename);
        if p.exists() { Some(p.to_string_lossy().to_string()) } else { None }
    };

    let disk_cover = disk_check("cover.jpg").or_else(|| disk_check("cover.png"));
    let disk_landscape = disk_check("landscape.jpg").or_else(|| disk_check("landscape.png"));
    let disk_background = disk_check("background.jpg").or_else(|| disk_check("background.png"));
    let disk_logo = disk_check("logo.png").or_else(|| disk_check("logo.jpg"));
    let disk_icon = disk_check("icon.png").or_else(|| disk_check("icon.jpg"));

    media_log(&format!("[AppInfoRepair] {} existing files {{ cover={}, landscape={}, background={}, logo={}, icon={} }}",
        app_id, disk_cover.is_some(), disk_landscape.is_some(), disk_background.is_some(), disk_logo.is_some(), disk_icon.is_some()));

    media_log(&format!("[AppInfoRepair] {} before media {{ cover={:?}, landscape={:?}, background={:?}, logo={:?}, icon={:?} }}",
        app_id,
        existing_media.as_ref().and_then(|m| m.cover_path.as_ref()),
        existing_media.as_ref().and_then(|m| m.landscape_path.as_ref()),
        existing_media.as_ref().and_then(|m| m.background_path.as_ref()),
        existing_media.as_ref().and_then(|m| m.logo_path.as_ref()),
        existing_media.as_ref().and_then(|m| m.icon_path.as_ref()),
    ));

    // For each role: validate existing path, fall through to disk file
    let normalize = |path: String| -> String {
        normalize_media_to_relative(&app_handle, &app_id, &path)
    };

    let cover_path = existing_media.as_ref().and_then(|m| m.cover_path.as_ref())
        .and_then(|p| if media_path_exists_for_app(&app_handle, &app_id, p) { Some(normalize(p.clone())) } else {
            media_log(&format!("repair: stripping missing cover_path for {}: {}", app_id, p));
            changed = true;
            None
        })
        .or_else(|| {
            if let Some(dp) = disk_cover.clone() {
                media_log(&format!("repair: adding cover_path from disk for {}", app_id));
                changed = true;
                Some(normalize(dp.clone()))
            } else { None }
        });

    let landscape_path = existing_media.as_ref().and_then(|m| m.landscape_path.as_ref())
        .and_then(|p| if media_path_exists_for_app(&app_handle, &app_id, p) { Some(normalize(p.clone())) } else {
            media_log(&format!("repair: stripping missing landscape_path for {}: {}", app_id, p));
            changed = true;
            None
        })
        .or_else(|| {
            if let Some(dp) = disk_landscape.clone() {
                media_log(&format!("repair: adding landscape_path from disk for {}", app_id));
                changed = true;
                Some(normalize(dp))
            } else { None }
        });

    let background_path = existing_media.as_ref().and_then(|m| m.background_path.as_ref())
        .and_then(|p| if media_path_exists_for_app(&app_handle, &app_id, p) { Some(normalize(p.clone())) } else {
            media_log(&format!("repair: stripping missing background_path for {}: {}", app_id, p));
            changed = true;
            None
        })
        .or_else(|| {
            if let Some(dp) = disk_background.clone() {
                media_log(&format!("repair: adding background_path from disk for {}", app_id));
                changed = true;
                Some(normalize(dp))
            } else { None }
        });

    let logo_path = existing_media.as_ref().and_then(|m| m.logo_path.as_ref())
        .and_then(|p| if media_path_exists_for_app(&app_handle, &app_id, p) { Some(normalize(p.clone())) } else {
            media_log(&format!("repair: stripping missing logo_path for {}: {}", app_id, p));
            changed = true;
            None
        })
        .or_else(|| {
            if let Some(dp) = disk_logo.clone() {
                media_log(&format!("repair: adding logo_path from disk for {}", app_id));
                changed = true;
                Some(normalize(dp))
            } else { None }
        });

    let icon_path = existing_media.as_ref().and_then(|m| m.icon_path.as_ref())
        .and_then(|p| if media_path_exists_for_app(&app_handle, &app_id, p) { Some(normalize(p.clone())) } else {
            media_log(&format!("repair: stripping missing icon_path for {}: {}", app_id, p));
            changed = true;
            None
        })
        .or_else(|| {
            if let Some(dp) = disk_icon.clone() {
                media_log(&format!("repair: adding icon_path from disk for {}", app_id));
                changed = true;
                Some(normalize(dp))
            } else { None }
        });

    if !changed {
        return Ok(false);
    }

    entry.media = Some(GameMediaPaths {
        cover_path,
        landscape_path,
        background_path,
        logo_path,
        icon_path,
    });

    // Also try to resolve name from store-details if still null
    if entry.name.is_none() {
        let store_path = get_store_details_path(&app_handle, &app_id);
        if let Ok(sp) = store_path {
            if sp.exists() {
                if let Ok(sc) = fs::read_to_string(&sp) {
                    if let Ok(sd) = serde_json::from_str::<StoreDetails>(&sc) {
                        if let Some(name) = sd.data.get("name").and_then(|v| v.as_str()) {
                            entry.name = Some(name.to_string());
                            media_log(&format!("repair: resolved name from store-details for {}: {}", app_id, name));
                        }
                    }
                }
            }
        }
    }

    entry.updated_at = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    );

    let new_content = serde_json::to_string_pretty(&entry)
        .map_err(|e| format!("Failed to serialize repaired appinfo: {}", e))?;
    fs::write(&path, &new_content)
        .map_err(|e| format!("Failed to write repaired appinfo: {}", e))?;

    media_log(&format!("[AppInfoRepair] {} after media {{ cover={:?}, landscape={:?}, background={:?}, logo={:?}, icon={:?} }}",
        app_id,
        entry.media.as_ref().and_then(|m| m.cover_path.as_ref()),
        entry.media.as_ref().and_then(|m| m.landscape_path.as_ref()),
        entry.media.as_ref().and_then(|m| m.background_path.as_ref()),
        entry.media.as_ref().and_then(|m| m.logo_path.as_ref()),
        entry.media.as_ref().and_then(|m| m.icon_path.as_ref()),
    ));

    log(&format!("appinfo media paths repaired for {} (stale paths stripped, disk paths added)", app_id));
    Ok(true)
}

// ---------------------------------------------------------------------------
// repair_media_roles — inspect each cached image and fix misclassified files.
// e.g. if landscape.jpg is actually a vertical cover, move it to cover.jpg.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn repair_media_roles(
    app_handle: AppHandle,
    app_id: String,
) -> Result<bool, String> {
    let media_dir = get_media_dir(&app_handle, &app_id)?;
    if !media_dir.exists() {
        return Ok(false);
    }

    let mut changed = false;

    // Check landscape.jpg
    let landscape_path = media_dir.join("landscape.jpg");
    if landscape_path.exists() {
        if let Ok(bytes) = fs::read(&landscape_path) {
            match image_utils::classify_image_role(&bytes, "landscape") {
                Ok(Some(role)) if role == "landscape" => {
                    media_log(&format!("[MediaRepair] landscape.jpg is valid for {}", app_id));
                }
                Ok(Some(role)) if role == "cover" => {
                    // landscape.jpg is actually a cover — move to cover.jpg if missing
                    let cover_path = media_dir.join("cover.jpg");
                    if !cover_path.exists() {
                        media_log(&format!("[MediaRepair] moved landscape.jpg to cover.jpg for {}", app_id));
                        let _ = fs::rename(&landscape_path, &cover_path);
                        changed = true;
                    } else {
                        // cover.jpg already exists — just remove the misclassified landscape.jpg
                        media_log(&format!("[MediaRepair] removed misclassified landscape.jpg (vertical) for {}", app_id));
                        let _ = fs::remove_file(&landscape_path);
                        changed = true;
                    }
                }
                Ok(None) => {
                    media_log(&format!("[MediaRepair] landscape.jpg has invalid aspect — removing for {}", app_id));
                    let _ = fs::remove_file(&landscape_path);
                    changed = true;
                }
                _ => {}
            }
        }
    }

    // Check cover.jpg — if it's actually a landscape and landscape is missing, move it
    let cover_path = media_dir.join("cover.jpg");
    if cover_path.exists() {
        let landscape_path = media_dir.join("landscape.jpg");
        if !landscape_path.exists() {
            if let Ok(bytes) = fs::read(&cover_path) {
                match image_utils::classify_image_role(&bytes, "cover") {
                    Ok(Some(role)) if role == "landscape" => {
                        media_log(&format!("[MediaRepair] moved cover.jpg to landscape.jpg for {}", app_id));
                        let _ = fs::rename(&cover_path, &landscape_path);
                        changed = true;
                    }
                    _ => {}
                }
            }
        }
    }

    // Check background.jpg — if it's vertical, remove it
    let background_path = media_dir.join("background.jpg");
    if background_path.exists() {
        if let Ok(bytes) = fs::read(&background_path) {
            match image_utils::classify_image_role(&bytes, "background") {
                Ok(Some(role)) if role == "background" => {
                    media_log(&format!("[MediaRepair] background.jpg is valid for {}", app_id));
                }
                Ok(Some(role)) if role == "landscape" => {
                    // Accept landscape-as-background if no real background
                    media_log(&format!("[MediaRepair] background.jpg is landscape (acceptable) for {}", app_id));
                }
                Ok(Some(role)) if role == "cover" => {
                    media_log(&format!("[MediaRepair] background.jpg is vertical/cover — removing for {}", app_id));
                    let _ = fs::remove_file(&background_path);
                    changed = true;
                }
                Ok(None) => {
                    media_log(&format!("[MediaRepair] background.jpg has invalid aspect — removing for {}", app_id));
                    let _ = fs::remove_file(&background_path);
                    changed = true;
                }
                _ => {}
            }
        }
    }

    // Update appinfo to match repaired files
    if changed {
        let path = get_appinfo_path(&app_handle, &app_id)?;
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(mut entry) = serde_json::from_str::<GameAppInfo>(&content) {
                    let disk_cover = { let p = media_dir.join("cover.jpg"); if p.exists() { Some(normalize_media_to_relative(&app_handle, &app_id, &p.to_string_lossy())) } else { None } };
                    let disk_landscape = { let p = media_dir.join("landscape.jpg"); if p.exists() { Some(normalize_media_to_relative(&app_handle, &app_id, &p.to_string_lossy())) } else { None } };
                    let disk_background = { let p = media_dir.join("background.jpg"); if p.exists() { Some(normalize_media_to_relative(&app_handle, &app_id, &p.to_string_lossy())) } else { None } };
                    let disk_logo = { let p = media_dir.join("logo.png"); if p.exists() { Some(normalize_media_to_relative(&app_handle, &app_id, &p.to_string_lossy())) } else { None } };
                    let disk_icon = { let p = media_dir.join("icon.png"); if p.exists() { Some(normalize_media_to_relative(&app_handle, &app_id, &p.to_string_lossy())) } else { None } };

                    entry.media = Some(GameMediaPaths {
                        cover_path: disk_cover,
                        landscape_path: disk_landscape,
                        background_path: disk_background,
                        logo_path: disk_logo,
                        icon_path: disk_icon,
                    });
                    entry.updated_at = Some(
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                    );
                    if let Ok(json) = serde_json::to_string_pretty(&entry) {
                        let _ = fs::write(&path, &json);
                    }
                    media_log(&format!("[MediaRepair] appinfo updated for {}", app_id));
                }
            }
        }
    }

    Ok(changed)
}

// ---------------------------------------------------------------------------
// read_game_media_data_url — read a local cached image and return a data URL.
// Security: only allows files inside the app data directory.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_game_media_data_url(
    app_handle: AppHandle,
    path: String,
) -> Result<String, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let canonical = std::path::Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    let app_data_canonical = app_data
        .canonicalize()
        .map_err(|e| format!("Invalid app data dir: {}", e))?;

    if !canonical.starts_with(&app_data_canonical) {
        return Err("Access denied: path outside app data directory".to_string());
    }

    let bytes = std::fs::read(&canonical)
        .map_err(|e| format!("Failed to read image: {}", e))?;

    if bytes.len() > 10 * 1024 * 1024 {
        return Err("Image too large for data URL (>10MB)".to_string());
    }

    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "image/jpeg",
    };

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

// ---------------------------------------------------------------------------
// Runtime path resolvers — convert provider-relative paths to absolute paths
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// migrate_game_media_to_relative — scan all appinfo.json files and convert
// any remaining absolute paths to provider-relative paths (Part 6).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn migrate_game_media_to_relative(app_handle: AppHandle) -> Result<u32, String> {
    let games_dir = get_games_dir(&app_handle)?;
    let mut total_fixed = 0u32;

    if !games_dir.exists() {
        return Ok(0);
    }

    for entry in fs::read_dir(&games_dir).map_err(|e| format!("Failed to read games dir: {}", e))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let app_id = match path.file_name().and_then(|n| n.to_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        let appinfo_path = path.join("appinfo.json");
        if !appinfo_path.exists() {
            continue;
        }

        let content = match fs::read_to_string(&appinfo_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut entry: GameAppInfo = match serde_json::from_str(&content) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let media = match entry.media.as_mut() {
            Some(m) => m,
            None => continue,
        };

        let mut changed = false;

        let fix_field = |field: &mut Option<String>, field_name: &str| -> bool {
            let val = match field {
                Some(v) if !v.is_empty() => v.clone(),
                _ => return false,
            };
            // Check if it looks like an absolute Windows path
            let is_abs = std::path::Path::new(&val).is_absolute();
            if !is_abs {
                return false;
            }
            let rel = normalize_media_to_relative(&app_handle, &app_id, &val);
            if rel != val {
                eprintln!("[PATH][MIGRATE] game appid={} field={} absolute->relative {}", app_id, field_name, rel);
                *field = Some(rel);
                true
            } else {
                // Path is absolute but outside appdata media folder — log warning
                eprintln!("[PATH][MIGRATE] game appid={} field={} absolute path outside media folder, skipping: {}", app_id, field_name, val);
                false
            }
        };

        if fix_field(&mut media.cover_path, "cover") { changed = true; }
        if fix_field(&mut media.landscape_path, "landscape") { changed = true; }
        if fix_field(&mut media.background_path, "background") { changed = true; }
        if fix_field(&mut media.logo_path, "logo") { changed = true; }
        if fix_field(&mut media.icon_path, "icon") { changed = true; }

        if changed {
            if let Ok(json) = serde_json::to_string_pretty(&entry) {
                if fs::write(&appinfo_path, &json).is_ok() {
                    total_fixed += 1;
                    media_log(&format!("[PATH][MIGRATE] appinfo rewritten for appid={}", app_id));
                }
            }
        }
    }

    if total_fixed > 0 {
        eprintln!("[PATH][MIGRATE] complete fixed={} game appinfos", total_fixed);
    } else {
        eprintln!("[PATH][MIGRATE] no absolute paths found");
    }

    Ok(total_fixed)
}

// ---------------------------------------------------------------------------
// Runtime path resolver Tauri commands (Part 4)
// ---------------------------------------------------------------------------

/// Resolve the absolute path to a provider game directory.
/// e.g. resolveProviderGamePath("steam", "2605790")
///   → <appData>/games/steam/2605790/
#[tauri::command]
pub fn resolve_provider_game_path(
    app_handle: AppHandle,
    provider: String,
    app_id: String,
) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_dir.join("games").join(&provider).join(&app_id);
    Ok(dir.to_string_lossy().to_string())
}

/// Resolve an absolute path for a game media file from a relative path.
/// e.g. resolveGameMediaPath("steam", "2605790", "media/landscape.jpg")
///   → <appData>/games/steam/2605790/media/landscape.jpg
#[tauri::command]
pub fn resolve_game_media_path(
    app_handle: AppHandle,
    provider: String,
    app_id: String,
    relative_path: String,
) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let abs = app_dir.join("games").join(&provider).join(&app_id).join(&relative_path);
    Ok(abs.to_string_lossy().to_string())
}

/// Convert an absolute filesystem path to a Tauri-compatible URL.
/// Note: The TS-side localPathToUrl() using convertFileSrc() is preferred
/// for actual asset:// protocol URLs. This returns a file:// URL for reference.
#[tauri::command]
pub fn resolve_to_tauri_asset_url(abs_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&abs_path);
    if !path.exists() {
        return Ok(abs_path);
    }
    // Construct file:// URL manually to avoid url crate dependency
    let lossy = path.to_string_lossy();
    let normalized = lossy.replace('\\', "/");
    let url = if normalized.starts_with('/') {
        format!("file://{}", normalized)
    } else {
        format!("file:///{}", normalized)
    };
    Ok(url)
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
