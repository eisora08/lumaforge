use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::depot::{DepotDownloadJob, DepotInfo, DepotResolveResult, DepotRunResult};
use crate::utils::config_vdf_parser;
use crate::utils::lua_parser;
use crate::utils::manifest_parser;
use crate::utils::progress_utils::emit_installer_progress;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SILENCE_TIMEOUT_MINS: u64 = 10;
const MAX_CHUNK_DOWNLOADS: &str = "32";
const PROGRESS_THROTTLE_SECS: u64 = 1;

// ---------------------------------------------------------------------------
// Static state: app-wide serialization gate (one anonymous session at a time)
// ---------------------------------------------------------------------------

static RUN_GATE: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();

fn run_gate() -> &'static tokio::sync::Semaphore {
    RUN_GATE.get_or_init(|| tokio::sync::Semaphore::new(1))
}

// ---------------------------------------------------------------------------
// Static state: track running child PIDs for external cancel/pause
// ---------------------------------------------------------------------------

static RUNNING_PIDS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

fn running_pids() -> &'static Mutex<HashMap<String, u32>> {
    RUNNING_PIDS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_pid(job_id: &str, pid: u32) {
    if let Ok(mut map) = running_pids().lock() {
        map.insert(job_id.to_string(), pid);
    }
}

fn unregister_pid(job_id: &str) {
    if let Ok(mut map) = running_pids().lock() {
        map.remove(job_id);
    }
}

// ---------------------------------------------------------------------------
// Static state: track intentionally cancelled/paused jobs
// ---------------------------------------------------------------------------

static CANCELLED_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled_jobs() -> &'static Mutex<HashSet<String>> {
    CANCELLED_JOBS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn mark_cancelled(job_id: &str) {
    if let Ok(mut set) = cancelled_jobs().lock() {
        set.insert(job_id.to_string());
    }
}

fn is_cancelled(job_id: &str) -> bool {
    cancelled_jobs()
        .lock()
        .map(|mut set| set.remove(job_id))
        .unwrap_or(false)
}

fn kill_by_job_id(job_id: &str) -> bool {
    let pid = {
        let Ok(mut map) = running_pids().lock() else {
            return false;
        };
        match map.remove(job_id) {
            Some(pid) => pid,
            None => return false,
        }
    };

    println!(
        "[DEPOT_DOWNLOADER] Killing process {} for job {}",
        pid, job_id
    );

    // Kill the process on Windows
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        match Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
        {
            Ok(out) if !out.status.success() => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                println!(
                    "[DEPOT_DOWNLOADER] taskkill for PID {} returned non-zero: {}",
                    pid,
                    stderr.trim()
                );
            }
            Err(e) => {
                println!("[DEPOT_DOWNLOADER] taskkill failed for PID {}: {}", pid, e);
            }
            _ => {}
        }
    }

    // Kill on Unix
    #[cfg(not(target_os = "windows"))]
    {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }

    true
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn get_app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))
}

fn depot_downloader_exe(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_app_data_dir(app_handle)?
        .join("thirdparty")
        .join("depotdownloader")
        .join("DepotDownloaderMod.exe"))
}

fn staging_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_app_data_dir(app_handle)?.join("temp").join("depotdownloader");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create staging dir: {e}"))?;
    Ok(dir)
}

// ---------------------------------------------------------------------------
// Depot key resolution
// ---------------------------------------------------------------------------

/// Resolve depot keys from .lua files for a specific app.
pub fn resolve_keys(app_handle: &AppHandle, app_id: u64) -> HashMap<u64, String> {
    let mut keys = HashMap::new();

    if let Some(paths) = crate::utils::path_utils::detect_steam_paths() {
        let lua_dir = Path::new(&paths.lua_path);
        if lua_dir.exists() {
            let lua_keys = lua_parser::resolve_keys_from_lua(lua_dir, app_id);
            keys.extend(lua_keys);
        }
    }

    keys
}

/// Write depot keys to a temporary file in the format DepotDownloader expects.
pub fn write_keys_file(
    app_handle: &AppHandle,
    keys: &HashMap<u64, String>,
) -> Result<PathBuf, String> {
    let staging = staging_dir(app_handle)?;
    let path = staging.join(format!("depotkeys_{}.txt", uuid::Uuid::new_v4()));

    let content: String = keys
        .iter()
        .map(|(id, key)| format!("{};{}\n", id, key))
        .collect();

    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write keys file: {e}"))?;

    Ok(path)
}

// ---------------------------------------------------------------------------
// Manifest resolution
// ---------------------------------------------------------------------------

/// Resolve the path to a .manifest file for a given depot+manifest ID.
/// Checks depotcache first, returns None if not found.
pub fn resolve_manifest_path(
    app_handle: &AppHandle,
    depot_id: u64,
    manifest_id: &str,
) -> Option<PathBuf> {
    let paths = crate::utils::path_utils::detect_steam_paths()?;
    let depotcache = Path::new(&paths.depotcache_path);

    // Try standard depotcache filename: <depotId>_<manifestId>.manifest
    let path = depotcache.join(format!("{}_{}.manifest", depot_id, manifest_id));
    if path.exists() {
        // Validate
        if let Some(info) = manifest_parser::try_read_manifest(&path) {
            if info.depot_id == depot_id {
                return Some(path);
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Stdout parsing
// ---------------------------------------------------------------------------

fn progress_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s*([0-9]+(?:\.[0-9]+)?)%\s+(.+)$").unwrap())
}

#[derive(Debug, Clone, PartialEq)]
enum DepotPhase {
    PreAllocating,
    Downloading,
    Manifest,
    Validating,
}

fn detect_phase(line: &str) -> Option<DepotPhase> {
    if line.starts_with("Pre-allocating ") {
        Some(DepotPhase::PreAllocating)
    } else if line.starts_with("Downloading depot ") && line.ends_with(" manifest") {
        Some(DepotPhase::Manifest)
    } else if line.starts_with("Downloading depot ") {
        Some(DepotPhase::Downloading)
    } else if line.starts_with("Validating ") {
        Some(DepotPhase::Validating)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

/// Spawn DepotDownloaderMod.exe and download a single depot.
async fn spawn_depot_download(
    app_handle: AppHandle,
    job_id: String,
    exe: PathBuf,
    app_id: u64,
    depot_id: u64,
    manifest_id: &str,
    keys_file: &Path,
    manifest_path: &Path,
    output_dir: &Path,
    validate: bool,
    depot_size: u64,
    cumulative_bytes: u64,
    total_bytes: u64,
) -> Result<DepotRunResult, String> {
    let mut args = vec![
        "-app".to_string(),
        app_id.to_string(),
        "-depot".to_string(),
        depot_id.to_string(),
        "-manifest".to_string(),
        manifest_id.to_string(),
        "-depotkeys".to_string(),
        keys_file.to_string_lossy().to_string(),
        "-manifestfile".to_string(),
        manifest_path.to_string_lossy().to_string(),
        "-dir".to_string(),
        output_dir.to_string_lossy().to_string(),
        "-max-downloads".to_string(),
        MAX_CHUNK_DOWNLOADS.to_string(),
    ];

    if validate {
        args.push("-validate".to_string());
    }

    println!(
        "[DEPOT_DOWNLOADER] Spawning for depot {}: {:?}",
        depot_id, args
    );

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    // Set working directory to the exe's parent so relative paths resolve correctly
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }

    // Apply CREATE_NO_WINDOW on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn DepotDownloader: {e}"))?;

    // Register PID for external cancel/pause access
    if let Some(pid) = child.id() {
        register_pid(&job_id, pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Failed to capture stderr")?;

    // Parse stdout in a background task
    let app_handle_clone = app_handle.clone();
    let job_id_clone = job_id.clone();
    let stdout_handle = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        let mut last_phase: Option<DepotPhase> = None;
        let mut last_emit = std::time::Instant::now();
        let mut last_bytes_read: u64 = 0;
        let mut last_progress: u8 = 0;
        let throttle = Duration::from_secs(PROGRESS_THROTTLE_SECS);

        while let Ok(Some(line)) = lines.next_line().await {
            // Try progress regex
            if let Some(caps) = progress_regex().captures(&line) {
                if let Some(pct_str) = caps.get(1).map(|m| m.as_str()) {
                    if let Ok(pct) = pct_str.parse::<f64>() {
                        if last_phase != Some(DepotPhase::Downloading) {
                            last_phase = Some(DepotPhase::Downloading);
                        }
                        let progress = (pct.clamp(0.0, 100.0)) as u8;
                        let file = caps
                            .get(2)
                            .map(|m| m.as_str())
                            .unwrap_or("");
                        // Compute bytes read for this depot from percentage
                        let depot_bytes = (depot_size as f64 * pct / 100.0) as u64;
                        let bytes_read = cumulative_bytes + depot_bytes;
                        // Compute overall progress across all depots
                        let overall_progress = if total_bytes > 0 {
                            ((bytes_read as f64 / total_bytes as f64) * 100.0).min(99.0) as u8
                        } else {
                            progress
                        };
                        last_bytes_read = bytes_read;
                        last_progress = overall_progress;
                        // Throttle: emit max once per second unless progress changed significantly
                        if last_emit.elapsed() >= throttle || overall_progress != last_progress {
                            let msg = format!("Depot {} - {}%", depot_id, file);
                            emit_installer_progress(
                                &app_handle_clone,
                                &job_id_clone,
                                "downloading",
                                overall_progress,
                                bytes_read,
                                total_bytes,
                                &msg,
                            );
                            last_emit = std::time::Instant::now();
                        }
                        continue;
                    }
                }
            }

            // Phase detection
            if let Some(phase) = detect_phase(&line) {
                if last_phase != Some(phase.clone()) {
                    last_phase = Some(phase.clone());
                    let msg = match &phase {
                        DepotPhase::PreAllocating => format!("Depot {} - Pre-allocating", depot_id),
                        DepotPhase::Downloading => format!("Depot {} - Downloading", depot_id),
                        DepotPhase::Manifest => format!("Depot {} - Fetching manifest", depot_id),
                        DepotPhase::Validating => format!("Depot {} - Validating", depot_id),
                    };
                    let status = match &phase {
                        DepotPhase::PreAllocating => "extracting",
                        DepotPhase::Downloading => "downloading",
                        DepotPhase::Manifest => "downloading",
                        DepotPhase::Validating => "verifying",
                    };
                    // Keep last known bytes_read and progress — don't reset to 0
                    emit_installer_progress(
                        &app_handle_clone,
                        &job_id_clone,
                        status,
                        last_progress,
                        last_bytes_read,
                        total_bytes,
                        &msg,
                    );
                    last_emit = std::time::Instant::now();
                }
            }

            // Log meaningful lines
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("at ") {
                println!("[DEPOT_DOWNLOADER][depot={}] {}", depot_id, trimmed);
            }
        }
    });

    // Parse stderr
    let stderr_handle = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut last_error = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                last_error = trimmed;
            }
        }
        last_error
    });

    // Wait for process with silence timeout
    let silence_timeout = Duration::from_secs(SILENCE_TIMEOUT_MINS * 60);
    let start = std::time::Instant::now();

    loop {
        match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
            Ok(Ok(status)) => {
                let code = status.code().unwrap_or(-1);

                // Wait for stdout/stderr tasks to finish
                let _ = stdout_handle.await;
                let last_error = stderr_handle.await.unwrap_or_default();

                // Clean up PID tracking
                unregister_pid(&job_id);

                if code == 0 {
                    return Ok(DepotRunResult {
                        ok: true,
                        error: None,
                    });
                } else {
                    return Ok(DepotRunResult {
                        ok: false,
                        error: Some(if last_error.is_empty() {
                            format!("exit code {}", code)
                        } else if last_error.len() > 300 {
                            last_error[..300].to_string()
                        } else {
                            last_error
                        }),
                    });
                }
            }
            Ok(Err(e)) => {
                let _ = stdout_handle.await;
                unregister_pid(&job_id);
                return Err(format!("Process wait error: {e}"));
            }
            Err(_) => {
                // Timeout - check silence
                if start.elapsed() > silence_timeout {
                    println!("[DEPOT_DOWNLOADER] Silence timeout, killing process");
                    let _ = child.kill().await;
                    let _ = stdout_handle.await;
                    unregister_pid(&job_id);
                    return Ok(DepotRunResult {
                        ok: false,
                        error: Some("timeout".to_string()),
                    });
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Resolve available depots for a given Steam app ID.
/// Reads depot keys from .lua files and manifests from depotcache.
#[tauri::command]
pub fn depot_downloader_resolve_depots(
    app_handle: AppHandle,
    app_id: u64,
) -> Result<DepotResolveResult, String> {
    let keys = resolve_keys(&app_handle, app_id);

    if keys.is_empty() {
        return Err(format!(
            "No depot keys found for app {}. Make sure the .lua file is installed.",
            app_id
        ));
    }

    // Fetch authoritative depot metadata from steamcmd API
    let api_info = crate::utils::steamcmd_api::fetch_app_depot_info(app_id).ok();

    let mut depots: Vec<DepotInfo> = Vec::new();

    for (depot_id, key) in &keys {
        // Try to find a manifest in depotcache
        let manifest_path = crate::utils::path_utils::detect_steam_paths()
            .as_ref()
            .and_then(|p| {
                let depotcache = Path::new(&p.depotcache_path);
                find_manifest_for_depot(depotcache, *depot_id)
            });

        let (manifest_id, manifest_path_str, size, encrypted) =
            if let Some(path) = manifest_path {
                if let Some(info) = manifest_parser::try_read_manifest(&path) {
                    (
                        Some(info.gid_manifest.to_string()),
                        Some(path.to_string_lossy().to_string()),
                        Some(info.size_on_disk),
                        info.filenames_encrypted,
                    )
                } else {
                    (None, None, None, false)
                }
            } else {
                (None, None, None, false)
            };

        // Cross-reference with steamcmd API metadata
        let api_depot = api_info.as_ref().and_then(|info| {
            info.depots.iter().find(|d| d.depot_id == *depot_id)
        });

        let dlc_app_id = api_depot.and_then(|d| d.dlc_app_id);
        let os = api_depot.and_then(|d| d.os.clone());
        let language = api_depot.and_then(|d| d.language.clone());
        let is_shared = api_depot.map(|d| d.is_shared).unwrap_or(false);
        let from_app_id = api_depot.and_then(|d| d.from_app_id);

        // Build a human-readable name
        let name = if let Some(dlc_id) = dlc_app_id {
            // DLC depot — try to find DLC name from API info
            format!("DLC Depot ({})", dlc_id)
        } else if is_shared {
            format!("Shared Depot {}", depot_id)
        } else {
            format!("Depot {}", depot_id)
        };

        depots.push(DepotInfo {
            depot_id: *depot_id,
            name,
            manifest_id,
            size_on_disk: size,
            key: Some(key.clone()),
            manifest_path: manifest_path_str,
            encrypted,
            dlc_app_id,
            os,
            language,
            is_shared,
            from_app_id,
        });
    }

    depots.sort_by_key(|d| d.depot_id);

    let game_name = api_info
        .as_ref()
        .and_then(|i| i.app_name.clone())
        .unwrap_or_default();

    Ok(DepotResolveResult {
        depots,
        game_name,
    })
}

/// Find a .manifest file for a given depot ID in the depotcache directory.
fn find_manifest_for_depot(depotcache: &Path, depot_id: u64) -> Option<PathBuf> {
    if !depotcache.exists() {
        return None;
    }

    let prefix = format!("{}_", depot_id);

    for entry in std::fs::read_dir(depotcache).ok()? {
        let entry = entry.ok()?;
        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with(&prefix) && name.ends_with(".manifest") {
            let path = entry.path();
            // Validate
            if let Some(info) = manifest_parser::try_read_manifest(&path) {
                if info.depot_id == depot_id {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Start a depot download job. Downloads all selected depots sequentially.
#[tauri::command]
pub async fn depot_downloader_start(
    app_handle: AppHandle,
    job: DepotDownloadJob,
) -> Result<String, String> {
    // Use frontend-provided job ID if present, otherwise generate one
    let job_id = job.job_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Compute total bytes across all depots for progress reporting
    let total_bytes: u64 = job.depots.iter().map(|d| d.size).sum();

    // Check tool is installed (managed by thirdparty system)
    let exe = depot_downloader_exe(&app_handle)?;
    if !exe.exists() {
        return Err(
            "DepotDownloaderMod is not installed. Install it from Settings > Integrations > Third-Party Tools."
                .to_string(),
        );
    }

    // Write depot keys file
    let keys = resolve_keys(&app_handle, job.app_id);
    let keys_file = write_keys_file(&app_handle, &keys)?;

    // Create output directory
    let output_dir = PathBuf::from(&job.output_dir);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    // Acquire serialization gate
    let _permit = run_gate()
        .acquire()
        .await
        .map_err(|e| format!("Failed to acquire run gate: {e}"))?;

    // Emit job started
    emit_installer_progress(
        &app_handle,
        &job_id,
        "downloading",
        0,
        0,
        total_bytes,
        &format!("Starting depot download for {}", job.game_name),
    );

    let mut all_ok = true;
    let mut last_error: Option<String> = None;
    let mut cumulative_bytes: u64 = 0;

    for (i, depot) in job.depots.iter().enumerate() {
        // Validate we have the required files
        let keys_path = keys_file.clone();
        let manifest_path = PathBuf::from(&depot.manifest_path);

        if !manifest_path.exists() {
            println!(
                "[DEPOT_DOWNLOADER] Manifest not found for depot {}, skipping",
                depot.depot_id
            );
            continue;
        }

        let msg = format!(
            "Downloading depot {}/{} ({})",
            i + 1,
            job.depots.len(),
            depot.depot_id
        );
        emit_installer_progress(&app_handle, &job_id, "downloading", 0, cumulative_bytes, total_bytes, &msg);

        // Check free space
        if let Ok(free) = free_disk_space(&output_dir) {
            if free < depot.size {
                last_error = Some(format!(
                    "Not enough disk space: need {} MB, have {} MB",
                    depot.size / (1024 * 1024),
                    free / (1024 * 1024)
                ));
                all_ok = false;
                break;
            }
        }

        // On resume or if output dir already has content, use -validate
        let validate = output_dir.exists()
            && std::fs::read_dir(&output_dir)
                .ok()
                .map(|mut e| e.next().is_some())
                .unwrap_or(false);

        let result = spawn_depot_download(
            app_handle.clone(),
            job_id.clone(),
            exe.clone(),
            job.app_id,
            depot.depot_id,
            &depot.manifest_id,
            &keys_path,
            &manifest_path,
            &output_dir,
            validate,
            depot.size,
            cumulative_bytes,
            total_bytes,
        )
        .await?;

        if !result.ok {
            all_ok = false;
            last_error = result.error;
            break;
        }

        // Advance cumulative bytes after successful depot download
        cumulative_bytes += depot.size;
    }

    // Cleanup keys file
    let _ = std::fs::remove_file(&keys_file);

    if all_ok {
        emit_installer_progress(
            &app_handle,
            &job_id,
            "done",
            100,
            total_bytes,
            total_bytes,
            &format!("Download complete: {}", job.game_name),
        );
        Ok(job_id)
    } else if is_cancelled(&job_id) {
        // Process was killed by cancel/pause — don't emit "failed", the correct
        // status ("cancelled" or "paused") was already emitted by the command.
        Ok(job_id)
    } else {
        let err = last_error.unwrap_or_else(|| "Unknown error".to_string());
        emit_installer_progress(
            &app_handle,
            &job_id,
            "failed",
            0,
            cumulative_bytes,
            total_bytes,
            &format!("Download failed: {}", err),
        );
        Err(err)
    }
}

/// Cancel a running depot download — kills the child process and emits a cancelled event.
#[tauri::command]
pub fn depot_downloader_cancel(
    app_handle: AppHandle,
    job_id: String,
) -> Result<(), String> {
    println!("[DEPOT_DOWNLOADER] Cancel requested for job {}", job_id);
    mark_cancelled(&job_id);
    let killed = kill_by_job_id(&job_id);
    if killed {
        emit_installer_progress(
            &app_handle,
            &job_id,
            "cancelled",
            0,
            0,
            0,
            "Cancelled by user",
        );
    }
    // Gate releases automatically when depot_downloader_start returns (_permit drop)
    Ok(())
}

/// Pause a running depot download — kills the child process (resume re-runs with -validate).
#[tauri::command]
pub fn depot_downloader_pause(
    app_handle: AppHandle,
    job_id: String,
) -> Result<(), String> {
    println!("[DEPOT_DOWNLOADER] Pause requested for job {}", job_id);
    mark_cancelled(&job_id);
    let killed = kill_by_job_id(&job_id);
    if killed {
        emit_installer_progress(
            &app_handle,
            &job_id,
            "paused",
            0,
            0,
            0,
            "Download paused",
        );
    }
    // Gate releases automatically when depot_downloader_start returns (_permit drop)
    Ok(())
}

/// Check if DepotDownloader is installed.
#[tauri::command]
pub fn depot_downloader_status(app_handle: AppHandle) -> Result<serde_json::Value, String> {
    let exe = depot_downloader_exe(&app_handle)?;
    let installed = exe.exists();

    Ok(serde_json::json!({
        "installed": installed,
        "exePath": if installed { exe.to_string_lossy().to_string() } else { String::new() },
    }))
}

fn free_disk_space(path: &Path) -> Result<u64, String> {
    // Simple implementation: use sysinfo or just return a large number
    // TODO: Use proper disk space detection
    Ok(u64::MAX)
}
