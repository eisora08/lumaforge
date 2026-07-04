use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

use crate::commands::game_cache::get_game_dir;
use crate::models::startup_snapshot::{StartupSnapshot, STARTUP_SNAPSHOT_VERSION};

fn get_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let cache_dir = app_dir.join("cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    Ok(cache_dir)
}

fn get_snapshot_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_cache_dir(app_handle)?.join("startup-snapshot.json"))
}

#[tauri::command]
pub fn read_startup_snapshot(app_handle: AppHandle) -> Result<Option<StartupSnapshot>, String> {
    let path = match get_snapshot_path(&app_handle) {
        Ok(p) => p,
        Err(e) => {
            println!("[BootSnapshot] failed to get snapshot path: {}", e);
            return Ok(None);
        }
    };

    if !path.exists() {
        println!("[BootSnapshot] missing");
        return Ok(None);
    }

    match fs::read_to_string(&path) {
        Ok(content) => {
            match serde_json::from_str::<StartupSnapshot>(&content) {
                Ok(snapshot) => {
                    if snapshot.version != STARTUP_SNAPSHOT_VERSION {
                        println!(
                            "[BootSnapshot] version mismatch (got {}, expected {}), ignoring",
                            snapshot.version, STARTUP_SNAPSHOT_VERSION
                        );
                        return Ok(None);
                    }
                    let game_count = snapshot.library.games.len();
                    let sidebar_count = snapshot.sidebar.items.len();
                    let with_fav = snapshot.library.games.iter().filter(|g| g.favorite.is_some()).count();
                    let fav_true = snapshot.library.games.iter().filter(|g| g.favorite.unwrap_or(false)).count();
                    let with_hidden = snapshot.library.games.iter().filter(|g| g.hidden.is_some()).count();
                    let hidden_true = snapshot.library.games.iter().filter(|g| g.hidden.unwrap_or(false)).count();
                    let ach_some = snapshot.library.games.iter().filter(|g| g.achievement_summary.is_some()).count();
                    let ach_none = snapshot.library.games.iter().filter(|g| g.achievement_summary.is_none()).count();
                    let with_updated = snapshot.library.games.iter().filter(|g| g.updated_at.is_some()).count();
                    println!(
                        "[BootSnapshot] games={} sidebar={} withFavoriteField={} favoriteTrue={} withHiddenField={} hiddenTrue={} withAchievementSummaryField={} achievementSummaryObject={} achievementSummaryNull={} withUpdatedAt={}",
                        game_count, sidebar_count, with_fav, fav_true, with_hidden, hidden_true, (ach_some + ach_none), ach_some, ach_none, with_updated
                    );
                    Ok(Some(snapshot))
                }
                Err(e) => {
                    println!("[BootSnapshot] corrupt JSON ({}), ignoring", e);
                    Ok(None)
                }
            }
        }
        Err(e) => {
            println!("[BootSnapshot] read error ({}), ignoring", e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn write_startup_snapshot(
    app_handle: AppHandle,
    snapshot: StartupSnapshot,
) -> Result<(), String> {
    let path = get_snapshot_path(&app_handle)?;

    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;

    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("Failed to write snapshot temp file: {}", e))?;

    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename snapshot file: {}", e))?;

    let game_count = snapshot.library.games.len();
    let sidebar_count = snapshot.sidebar.items.len();
    let with_fav = snapshot.library.games.iter().filter(|g| g.favorite.is_some()).count();
    let fav_true = snapshot.library.games.iter().filter(|g| g.favorite.unwrap_or(false)).count();
    let with_hidden = snapshot.library.games.iter().filter(|g| g.hidden.is_some()).count();
    let hidden_true = snapshot.library.games.iter().filter(|g| g.hidden.unwrap_or(false)).count();
    let ach_some = snapshot.library.games.iter().filter(|g| g.achievement_summary.is_some()).count();
    let ach_none = snapshot.library.games.iter().filter(|g| g.achievement_summary.is_none()).count();
    let with_updated = snapshot.library.games.iter().filter(|g| g.updated_at.is_some()).count();
    println!(
        "[BootSnapshot] write — games={} sidebar={} withFavoriteField={} favoriteTrue={} withHiddenField={} hiddenTrue={} withAchievementSummaryField={} achievementSummaryObject={} achievementSummaryNull={} withUpdatedAt={}",
        game_count, sidebar_count, with_fav, fav_true, with_hidden, hidden_true, (ach_some + ach_none), ach_some, ach_none, with_updated,
    );

    Ok(())
}

#[tauri::command]
pub fn clear_startup_snapshot(app_handle: AppHandle) -> Result<(), String> {
    let path = match get_snapshot_path(&app_handle) {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to remove snapshot: {}", e))?;
        println!("[BootSnapshot] cleared");
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// validate_snapshot_media_paths — check which local media file paths exist.
// Remote URLs, data: URIs, and asset:// URLs are returned as-is.
// Provider-relative paths (media/*, img/*) are resolved against the
// game directory: <appData>/games/<provider>/<appId>/media/<file>
// Absolute paths are checked directly.
// Returns the same keys with exists flags.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ValidatedMediaPaths {
    #[serde(rename = "coverPath")]
    pub cover_path: Option<String>,
    #[serde(rename = "coverExists")]
    pub cover_exists: bool,
    #[serde(rename = "landscapePath")]
    pub landscape_path: Option<String>,
    #[serde(rename = "landscapeExists")]
    pub landscape_exists: bool,
    #[serde(rename = "backgroundPath")]
    pub background_path: Option<String>,
    #[serde(rename = "backgroundExists")]
    pub background_exists: bool,
    #[serde(rename = "logoPath")]
    pub logo_path: Option<String>,
    #[serde(rename = "logoExists")]
    pub logo_exists: bool,
    #[serde(rename = "iconPath")]
    pub icon_path: Option<String>,
    #[serde(rename = "iconExists")]
    pub icon_exists: bool,
}

/// Resolve a media path to an absolute filesystem path for existence checking.
/// Relative paths like "media/landscape.jpg" are resolved against the game dir:
/// `<appData>/games/<provider>/<appId>/media/landscape.jpg`.
/// Absolute paths are returned as-is. Remote URLs should be handled by caller.
fn resolve_snapshot_media_path(app_handle: &AppHandle, app_id: &str, path: &str) -> std::path::PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else if let Ok(dir) = get_game_dir(app_handle, app_id) {
        dir.join(path)
    } else {
        p.to_path_buf()
    }
}

/// Internal helper: validate a single snapshot media path entry.
/// Used by both validate_snapshot_media_paths and validate_snapshot_media_paths_batch.
fn validate_single_media_path(
    app_handle: &AppHandle,
    app_id: &str,
    role: &str,
    path: &Option<String>,
) -> (Option<String>, bool) {
    let provider = "steam";
    match path {
        Some(p) => {
            // Remote URLs, data: URIs, and asset:// URLs are kept as-is
            if p.starts_with("http://") || p.starts_with("https://")
                || p.starts_with("data:") || p.starts_with("asset://")
                || p.starts_with("file://")
            {
                return (Some(p.clone()), true);
            }
            // .tmp paths are always stripped (stale download artifacts)
            if p.ends_with(".tmp") {
                println!("[BootSnapshot] stripping .tmp path: {}", p);
                return (None, false);
            }
            // Resolve provider-relative paths against game directory
            let resolved = resolve_snapshot_media_path(app_handle, app_id, p);
            let exists = resolved.exists();
            const DEBUG_BOOTSNAPSHOT_VALIDATE: bool = false;
            if DEBUG_BOOTSNAPSHOT_VALIDATE {
                println!(
                    "[BootSnapshot][VALIDATE_PATH] appid={} provider={} role={} input={} resolved={} exists={}",
                    app_id, provider, role, p, resolved.display(), exists
                );
            }
            if exists {
                (Some(p.clone()), true)
            } else {
                println!(
                    "[BootSnapshot][VALIDATE_PATH_MISSING] appid={} role={} resolved={}",
                    app_id, role, resolved.display()
                );
                (None, false)
            }
        }
        None => (None, false),
    }
}

/// Internal helper: validate all 5 media roles for a single app.
fn validate_snapshot_game_media(
    app_handle: &AppHandle,
    app_id: &str,
    media: &crate::models::startup_snapshot::SnapshotGameMedia,
) -> ValidatedMediaPaths {
    let (cover_path, cover_exists) = validate_single_media_path(app_handle, app_id, "cover", &media.cover_path);
    let (landscape_path, landscape_exists) = validate_single_media_path(app_handle, app_id, "landscape", &media.landscape_path);
    let (background_path, background_exists) = validate_single_media_path(app_handle, app_id, "background", &media.background_path);
    let (logo_path, logo_exists) = validate_single_media_path(app_handle, app_id, "logo", &media.logo_path);
    let (icon_path, icon_exists) = validate_single_media_path(app_handle, app_id, "icon", &media.icon_path);

    ValidatedMediaPaths {
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
    }
}

#[tauri::command]
pub fn validate_snapshot_media_paths(
    app_handle: AppHandle,
    app_id: String,
    media: crate::models::startup_snapshot::SnapshotGameMedia,
) -> Result<ValidatedMediaPaths, String> {
    Ok(validate_snapshot_game_media(&app_handle, &app_id, &media))
}

// ---------------------------------------------------------------------------
// validate_snapshot_media_paths_batch — batch validate media paths for
// multiple games in a single Tauri call.
// Replaces per-app validateSnapshotMediaPaths loops in
// hydrateStartupSnapshotMedia and buildStartupSnapshotFromCurrentState.
// Read-only, per-item errors are non-fatal (missing entry = skipped).
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn validate_snapshot_media_paths_batch(
    app_handle: AppHandle,
    items: std::collections::HashMap<String, crate::models::startup_snapshot::SnapshotGameMedia>,
) -> Result<std::collections::HashMap<String, ValidatedMediaPaths>, String> {
    use std::collections::HashMap;
    let mut result = HashMap::new();
    for (app_id, media) in items {
        result.insert(app_id.clone(), validate_snapshot_game_media(&app_handle, &app_id, &media));
    }
    Ok(result)
}
