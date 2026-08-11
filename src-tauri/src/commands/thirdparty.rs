use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE: &str = "https://api.github.com";
const CONNECT_TIMEOUT_SECS: u64 = 30;
const DOWNLOAD_TIMEOUT_SECS: u64 = 300;
const RELEASE_CACHE_TTL_SECS: u64 = 86400;
const APP_USER_AGENT: &str = concat!(
    env!("CARGO_PKG_NAME"),
    "/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/LumaForge)"
);

// ---------------------------------------------------------------------------
// Tool definitions (static metadata)
// ---------------------------------------------------------------------------

struct ToolDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    github_owner: &'static str,
    github_repo: &'static str,
    /// Exact asset filename to prefer when a repo publishes several archives
    /// (e.g. Detanup01/gbe_fork publishes `emu-win-release.7z` next to the
    /// emulator). When `None`, the selection falls back to `.zip` → `.7z`.
    preferred_asset: Option<&'static str>,
}

const TOOL_DEFS: &[ToolDef] = &[
    ToolDef {
        id: "smokeapi",
        name: "SmokeAPI",
        description: "Steam API proxy for offline Steam games",
        github_owner: "acidicoala",
        github_repo: "SmokeAPI",
        preferred_asset: None,
    },
    ToolDef {
        id: "steamless",
        name: "Steamless",
        description: "SteamStub DRM unpacker for game executables",
        github_owner: "atom0s",
        github_repo: "Steamless",
        preferred_asset: None,
    },
    ToolDef {
        id: "goldberg_fork",
        name: "Goldberg (fork)",
        description: "Goldberg Steam Emu fork by Detanup01",
        github_owner: "Detanup01",
        github_repo: "gbe_fork",
        preferred_asset: Some("emu-win-release.7z"),
    },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyToolInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub github_owner: String,
    pub github_repo: String,
    pub installed: bool,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub install_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThirdPartyToolResult {
    pub ok: bool,
    pub tool: String,
    pub message: String,
    pub files_installed: Vec<String>,
    pub errors: Vec<String>,
}

// ---------------------------------------------------------------------------
// Path helpers (LumaForge: app data dir via AppHandle)
// ---------------------------------------------------------------------------

fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

fn thirdparty_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app_handle)?.join("thirdparty"))
}

fn thirdparty_state_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(thirdparty_dir(app_handle)?.join("thirdparty-state.json"))
}

fn thirdparty_tool_dir(app_handle: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(thirdparty_dir(app_handle)?.join(id))
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ThirdPartyState {
    #[serde(flatten)]
    tools: HashMap<String, ToolStateEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolStateEntry {
    version: String,
    installed_at: String,
}

fn load_state(app_handle: &tauri::AppHandle) -> ThirdPartyState {
    let path = thirdparty_state_path(app_handle).unwrap_or_default();
    if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default()
    } else {
        ThirdPartyState::default()
    }
}

fn save_state(app_handle: &tauri::AppHandle, state: &ThirdPartyState) {
    let Ok(path) = thirdparty_state_path(app_handle) else {
        return;
    };
    let Ok(json) = serde_json::to_string_pretty(state) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    // Atomic write: temp file + rename
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &json).is_ok() && std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct ReleaseInfo {
    tag_name: String,
    zip_url: String,
    zip_name: String,
    /// Archive extension: `"zip"` or `"7z"` (some repos only publish `.7z`).
    archive_ext: String,
}

struct ReleaseCache {
    entries: HashMap<String, CachedRelease>,
}

struct CachedRelease {
    info: ReleaseInfo,
    cached_at: SystemTime,
}

static GITHUB_CACHE: std::sync::OnceLock<std::sync::Mutex<ReleaseCache>> =
    std::sync::OnceLock::new();

fn github_cache() -> &'static std::sync::Mutex<ReleaseCache> {
    GITHUB_CACHE.get_or_init(|| {
        std::sync::Mutex::new(ReleaseCache {
            entries: HashMap::new(),
        })
    })
}

async fn get_latest_github_release(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    preferred_asset: Option<&str>,
) -> Result<ReleaseInfo, String> {
    let cache_key = format!("{owner}/{repo}");

    {
        let cache = github_cache()
            .lock()
            .map_err(|e| format!("Lock: {e}"))?;
        if let Some(cached) = cache.entries.get(&cache_key) {
            let age = cached.cached_at.elapsed().unwrap_or(Duration::from_secs(0));
            if age.as_secs() < RELEASE_CACHE_TTL_SECS {
                return Ok(cached.info.clone());
            }
        }
    }

    let url = format!("{GITHUB_API_BASE}/repos/{owner}/{repo}/releases/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub release: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let rate_reset = resp
            .headers()
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let body = resp.text().await.unwrap_or_default();
        if status.as_u16() == 403 {
            if let Some(reset) = rate_reset {
                return Err(format!(
                    "GitHub API rate limit exceeded. Resets at Unix timestamp {reset}"
                ));
            }
        }
        return Err(format!("GitHub API error {status}: {body}"));
    }

    let release: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub release: {e}"))?;

    let tag_name = release["tag_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let assets = release["assets"]
        .as_array()
        .ok_or_else(|| "No assets in release".to_string())?;

    // Asset selection priority: exact `preferred_asset` name match (for repos
    // that publish several archives, e.g. Detanup01/gbe_fork) → `.zip` → `.7z`.
    let zip_asset = assets
        .iter()
        .find(|a| {
            preferred_asset.is_some()
                && a["name"].as_str().is_some_and(|n| n == preferred_asset.unwrap())
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(".zip")))
        })
        .or_else(|| {
            assets
                .iter()
                .find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(".7z")))
        })
        .ok_or_else(|| "No ZIP/7z asset found in release".to_string())?;

    let zip_url = zip_asset["browser_download_url"]
        .as_str()
        .ok_or_else(|| "No download URL for archive".to_string())?
        .to_string();

    let zip_name = zip_asset["name"]
        .as_str()
        .unwrap_or("release.zip")
        .to_string();

    let archive_ext = if zip_name.ends_with(".7z") {
        "7z".to_string()
    } else {
        "zip".to_string()
    };

    let info = ReleaseInfo {
        tag_name,
        zip_url,
        zip_name,
        archive_ext,
    };

    {
        let mut cache = github_cache()
            .lock()
            .map_err(|e| format!("Lock: {e}"))?;
        cache.entries.insert(
            cache_key,
            CachedRelease {
                info: info.clone(),
                cached_at: SystemTime::now(),
            },
        );
    }

    Ok(info)
}

async fn get_github_release_tag(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    preferred_asset: Option<&str>,
) -> Result<String, String> {
    let release = get_latest_github_release(client, owner, repo, preferred_asset).await?;
    Ok(release.tag_name)
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async fn download_file(client: &reqwest::Client, url: &str, dest: &Path) -> Result<(), String> {
    let resp = client
        .get(url)
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download body: {e}"))?;

    if bytes.is_empty() {
        return Err(format!("Downloaded file is empty: {url}"));
    }

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    tokio::fs::write(dest, &bytes).await.map_err(|e| format!("Failed to write downloaded file: {e}"))?;
    Ok(())
}

fn is_dir_populated(dir: &Path) -> bool {
    dir.is_dir()
        && std::fs::read_dir(dir)
            .ok()
            .and_then(|mut entries| entries.next())
            .is_some()
}

fn flatten_extracted_dir(dir: &Path) -> Option<PathBuf> {
    let mut entries = std::fs::read_dir(dir).ok()?;
    let first = entries.next()?.ok()?;
    if entries.next().is_some() {
        return None;
    }
    if first.path().is_dir() {
        Some(first.path())
    } else {
        None
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let mut installed = Vec::new();
    copy_dir_inner(src, dest, dest, &mut installed)?;
    Ok(installed)
}

fn copy_dir_inner(
    src: &Path,
    dest: &Path,
    base: &Path,
    installed: &mut Vec<String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(src).map_err(|e| format!("Failed to read dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            std::fs::create_dir_all(&dest_path)
                .map_err(|e| format!("Failed to create dir: {e}"))?;
            copy_dir_inner(&src_path, &dest_path, base, installed)?;
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir: {e}"))?;
            }
            backup_file_if_exists(&dest_path);
            std::fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy file: {e}"))?;
            let relative = dest_path
                .strip_prefix(base)
                .unwrap_or(&dest_path)
                .to_string_lossy()
                .to_string();
            installed.push(relative);
        }
    }
    Ok(())
}

fn backup_file_if_exists(dest: &Path) -> bool {
    if !dest.exists() {
        return false;
    }
    let bak = PathBuf::from(format!("{}.bak", dest.to_string_lossy()));
    if bak.exists() {
        let _ = std::fs::remove_file(&bak);
    }
    std::fs::rename(dest, &bak).is_ok()
}

fn remove_dir_recursive(dir: &Path) -> Result<(), String> {
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {e}"))? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                remove_dir_recursive(&path)?;
            } else {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove file: {e}"))?;
            }
        }
        std::fs::remove_dir(dir).map_err(|e| format!("Failed to remove dir: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_thirdparty_tools(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ThirdPartyToolInfo>, String> {
    let mut state = load_state(&app_handle);
    let mut state_updated = false;
    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut tools = Vec::new();

    for def in TOOL_DEFS {
        let tool_dir = thirdparty_tool_dir(&app_handle, def.id).ok();
        let installed = tool_dir
            .as_ref()
            .map(|d| is_dir_populated(d))
            .unwrap_or(false);

        let mut installed_version = state.tools.get(def.id).map(|e| e.version.clone());

        let latest_version =
            get_github_release_tag(&client, def.github_owner, def.github_repo, def.preferred_asset)
                .await
                .ok();

        // Auto-detect: if installed but no state entry, save the latest version
        if installed && installed_version.is_none() {
            if let Some(ref ver) = latest_version {
                state.tools.insert(
                    def.id.to_string(),
                    ToolStateEntry {
                        version: ver.clone(),
                        installed_at: chrono::Local::now()
                            .format("%Y-%m-%dT%H:%M:%S")
                            .to_string(),
                    },
                );
                installed_version = Some(ver.clone());
                state_updated = true;
            }
        }

        let update_available = match (&installed_version, &latest_version) {
            (Some(installed), Some(latest)) => installed != latest,
            (None, _) => false,
            (_, None) => false,
        };

        tools.push(ThirdPartyToolInfo {
            id: def.id.to_string(),
            name: def.name.to_string(),
            description: def.description.to_string(),
            github_owner: def.github_owner.to_string(),
            github_repo: def.github_repo.to_string(),
            installed,
            installed_version,
            latest_version,
            update_available,
            install_path: tool_dir.map(|p| p.to_string_lossy().to_string()),
        });
    }

    if state_updated {
        save_state(&app_handle, &state);
    }

    Ok(tools)
}

#[tauri::command]
pub async fn install_thirdparty_tool(
    tool_id: String,
    app_handle: tauri::AppHandle,
) -> Result<ThirdPartyToolResult, String> {
    let def = TOOL_DEFS
        .iter()
        .find(|d| d.id == tool_id)
        .ok_or_else(|| format!("Unknown tool: {tool_id}"))?;

    let target_dir = thirdparty_dir(&app_handle)?.join(def.id);

    // Ensure the destination exists before extraction + copy (os error 3 otherwise).
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create tool dir: {e}"))?;

    // Already installed?
    if is_dir_populated(&target_dir) {
        let mut state = load_state(&app_handle);
        if !state.tools.contains_key(&tool_id) {
            let client = reqwest::Client::builder()
                .user_agent(APP_USER_AGENT)
                .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
                .build()
                .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

            let version =
                get_latest_github_release(&client, def.github_owner, def.github_repo, def.preferred_asset)
                    .await
                    .map(|r| r.tag_name)
                    .unwrap_or_else(|_| "detected".to_string());

            state.tools.insert(
                tool_id.clone(),
                ToolStateEntry {
                    version,
                    installed_at: chrono::Local::now()
                        .format("%Y-%m-%dT%H:%M:%S")
                        .to_string(),
                },
            );
            save_state(&app_handle, &state);
        }
        return Ok(ThirdPartyToolResult {
            ok: true,
            tool: tool_id,
            message: format!("{} is already installed.", def.name),
            files_installed: Vec::new(),
            errors: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let _ = app_handle.emit(
        "thirdparty://progress",
        serde_json::json!({
            "toolId": tool_id,
            "progress": 10,
            "message": format!("Fetching {} release...", def.name),
        }),
    );

    let release =
        get_latest_github_release(&client, def.github_owner, def.github_repo, def.preferred_asset)
            .await
            .map_err(|e| format!("Failed to fetch release: {e}"))?;

    let _ = app_handle.emit(
        "thirdparty://progress",
        serde_json::json!({
            "toolId": tool_id,
            "progress": 30,
            "message": format!("Downloading {} v{}...", def.name, release.tag_name),
        }),
    );

    let temp_root = get_app_data_dir(&app_handle)?.join("temp").join("thirdparty");
    std::fs::create_dir_all(&temp_root)
        .map_err(|e| format!("Failed to create temp root: {e}"))?;
    let temp_dir = tempfile::tempdir_in(&temp_root)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let zip_path = temp_dir.path().join(&release.zip_name);

    download_file(&client, &release.zip_url, &zip_path)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let _ = app_handle.emit(
        "thirdparty://progress",
        serde_json::json!({
            "toolId": tool_id,
            "progress": 60,
            "message": "Extracting...",
        }),
    );

    let extract_dir = temp_dir.path().join("extracted");
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract dir: {e}"))?;

    if release.archive_ext == "7z" {
        // Pure-Rust 7z extraction (no external 7-Zip CLI required).
        crate::commands::debrid_installer::extract_7z_native(&zip_path, &extract_dir)
            .map_err(|e| format!("Failed to extract 7z: {e}"))?;
    } else {
        let zip_file =
            std::fs::File::open(&zip_path).map_err(|e| format!("Failed to open ZIP: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to read ZIP: {e}"))?;
        archive
            .extract(&extract_dir)
            .map_err(|e| format!("Failed to extract ZIP: {e}"))?;
    }

    let effective_src = flatten_extracted_dir(&extract_dir).unwrap_or(extract_dir);
    let installed = copy_dir_recursive(&effective_src, &target_dir)
        .map_err(|e| format!("Failed to copy files: {e}"))?;

    // Persist version
    let mut state = load_state(&app_handle);
    state.tools.insert(
        tool_id.clone(),
        ToolStateEntry {
            version: release.tag_name.clone(),
            installed_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        },
    );
    save_state(&app_handle, &state);

    let _ = app_handle.emit(
        "thirdparty://progress",
        serde_json::json!({
            "toolId": tool_id,
            "progress": 100,
            "message": format!("{} v{} installed.", def.name, release.tag_name),
        }),
    );

    Ok(ThirdPartyToolResult {
        ok: true,
        tool: tool_id,
        message: format!(
            "{} v{} installed. {} file(s) extracted.",
            def.name,
            release.tag_name,
            installed.len()
        ),
        files_installed: installed,
        errors: Vec::new(),
    })
}

#[tauri::command]
pub async fn uninstall_thirdparty_tool(
    tool_id: String,
    app_handle: tauri::AppHandle,
) -> Result<ThirdPartyToolResult, String> {
    let def = TOOL_DEFS
        .iter()
        .find(|d| d.id == tool_id)
        .ok_or_else(|| format!("Unknown tool: {tool_id}"))?;

    let target_dir = thirdparty_dir(&app_handle)?.join(def.id);

    if !is_dir_populated(&target_dir) {
        return Ok(ThirdPartyToolResult {
            ok: true,
            tool: tool_id,
            message: format!("{} is not installed.", def.name),
            files_installed: Vec::new(),
            errors: Vec::new(),
        });
    }

    let _ = app_handle.emit(
        "thirdparty://progress",
        serde_json::json!({
            "toolId": tool_id,
            "progress": 50,
            "message": format!("Uninstalling {}...", def.name),
        }),
    );

    remove_dir_recursive(&target_dir).map_err(|e| format!("Failed to remove {}: {e}", def.name))?;

    // Remove from state
    let mut state = load_state(&app_handle);
    state.tools.remove(&tool_id);
    save_state(&app_handle, &state);

    let _ = app_handle.emit(
        "thirdparty://progress",
        serde_json::json!({
            "toolId": tool_id,
            "progress": 100,
            "message": format!("{} uninstalled.", def.name),
        }),
    );

    Ok(ThirdPartyToolResult {
        ok: true,
        tool: tool_id,
        message: format!("{} uninstalled successfully.", def.name),
        files_installed: Vec::new(),
        errors: Vec::new(),
    })
}

#[tauri::command]
pub async fn check_thirdparty_updates(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ThirdPartyToolInfo>, String> {
    // Re-use list to get fresh state with latest versions
    list_thirdparty_tools(app_handle).await
}

#[tauri::command]
pub async fn update_thirdparty_tool(
    tool_id: String,
    app_handle: tauri::AppHandle,
) -> Result<ThirdPartyToolResult, String> {
    let def = TOOL_DEFS
        .iter()
        .find(|d| d.id == tool_id)
        .ok_or_else(|| format!("Unknown tool: {tool_id}"))?;

    let target_dir = thirdparty_dir(&app_handle)?.join(def.id);

    // Uninstall first, then install fresh
    if is_dir_populated(&target_dir) {
        let _ = app_handle.emit(
            "thirdparty://progress",
            serde_json::json!({
                "toolId": tool_id,
                "progress": 10,
                "message": format!("Removing old {} files...", def.name),
            }),
        );
        remove_dir_recursive(&target_dir)
            .map_err(|e| format!("Failed to remove old files: {e}"))?;
    }

    install_thirdparty_tool(tool_id, app_handle).await
}

#[tauri::command]
pub fn open_thirdparty_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = thirdparty_dir(&app_handle)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {e}"))?;
    open::that(&dir).map_err(|e| format!("Failed to open folder: {e}"))
}
