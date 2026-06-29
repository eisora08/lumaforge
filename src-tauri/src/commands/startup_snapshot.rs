use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

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
                    println!(
                        "[BootSnapshot] found — games: {}, sidebar items: {}",
                        game_count, sidebar_count
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
    println!(
        "[BootSnapshot] write complete — games: {}, sidebar items: {}",
        game_count,
        snapshot.sidebar.items.len()
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
// Remote URLs are returned as-is. Returns the same keys with exists flags.
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

#[tauri::command]
pub fn validate_snapshot_media_paths(
    _app_handle: AppHandle,
    media: crate::models::startup_snapshot::SnapshotGameMedia,
) -> Result<ValidatedMediaPaths, String> {
    let check_path = |path: &Option<String>| -> (Option<String>, bool) {
        match path {
            Some(p) => {
                // Remote URLs are kept as-is
                if p.starts_with("http://") || p.starts_with("https://") {
                    return (Some(p.clone()), true);
                }
                // Local paths must exist
                let exists = std::path::Path::new(p).exists();
                if exists {
                    (Some(p.clone()), true)
                } else {
                    println!("[BootSnapshot] path not found, stripping: {}", p);
                    (None, false)
                }
            }
            None => (None, false),
        }
    };

    let (cover_path, cover_exists) = check_path(&media.cover_path);
    let (landscape_path, landscape_exists) = check_path(&media.landscape_path);
    let (background_path, background_exists) = check_path(&media.background_path);
    let (logo_path, logo_exists) = check_path(&media.logo_path);
    let (icon_path, icon_exists) = check_path(&media.icon_path);

    Ok(ValidatedMediaPaths {
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
