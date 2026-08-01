use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;

use winreg::enums::*;
use winreg::RegKey;

use tokio::io::AsyncWriteExt;


use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::ZipArchive;

use crate::commands::process::spawn_game_with_elevation_fallback;
use crate::models::debrid_install_result::{DebridDownloadResult, DebridVerifyResult, InstallerCheckResult};
use crate::utils::progress_utils::emit_installer_progress;

/// File type detected by reading magic bytes from the downloaded file.
#[derive(Debug)]
enum DetectedFileType {
    /// Windows PE executable (MZ header)
    Executable,
    /// RAR archive (Rar!\x1a\x07\x00 header)
    Rar,
    /// ZIP archive (PK\x03\x04 header)
    Zip,
    /// Unknown type — first 8 bytes as hex string
    Unknown(String),
}

/// Read magic bytes from `path` and return the detected file type.
fn detect_file_type(path: &Path) -> DetectedFileType {
    let mut buf = [0u8; 16];
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return DetectedFileType::Unknown("cannot_open".to_string()),
    };
    if file.read_exact(&mut buf).is_err() {
        return DetectedFileType::Unknown("cannot_read".to_string());
    }

    // PE executable (MZ header)
    if buf[0] == 0x4D && buf[1] == 0x5A {
        return DetectedFileType::Executable;
    }

    // RAR archive
    if buf[0] == 0x52 && buf[1] == 0x61 && buf[2] == 0x72 && buf[3] == 0x21
        && buf[4] == 0x1A && buf[5] == 0x07 && buf[6] == 0x00
    {
        return DetectedFileType::Rar;
    }

    // ZIP archive
    if buf[0] == 0x50 && buf[1] == 0x4B && buf[2] == 0x03 && buf[3] == 0x04 {
        return DetectedFileType::Zip;
    }

    // Unknown — hex preview
    let hex = buf[..8]
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(" ");
    DetectedFileType::Unknown(hex)
}

/// Rename a file to have an `.exe` extension if it doesn't already.
fn ensure_exe_extension(path: &Path) -> Result<PathBuf, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("exe") {
        return Ok(path.to_path_buf());
    }
    let new_path = path.with_extension("exe");
    fs::rename(path, &new_path)
        .map_err(|e| format!("Failed to rename {} to .exe: {}", path.display(), e))?;
    println!("[DEBRID][INSTALL] Renamed {} → {}", path.display(), new_path.display());
    Ok(new_path)
}

/// Attempt to resolve a gofile.io URL to a downloadable link.
///
/// Gofile requires a guest token for downloads. This function:
///   1. Creates a guest account via POST /accounts
///   2. For page URLs (`/d/{contentId}`): resolves via contents API
///   3. For direct download URLs (`/download/...`): appends `?wt={guestToken}`
async fn resolve_gofile_url(gofile_url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Gofile HTTP client error: {}", e))?;

    // Step 1: Create guest account
    let resp = client
        .post("https://api.gofile.io/accounts")
        .send()
        .await
        .map_err(|e| format!("Gofile account creation failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Gofile account creation HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gofile account parse error: {}", e))?;

    let token = body["data"]["token"]
        .as_str()
        .ok_or_else(|| "No guest token in gofile response".to_string())?
        .to_string();

    // Step 2: Determine URL type
    let lower = gofile_url.to_lowercase();

    if lower.contains("/d/") {
        // Page URL: extract contentId and use contents API
        let content_id = gofile_url
            .trim_end_matches('/')
            .split('/')
            .last()
            .ok_or_else(|| format!("Bad gofile URL: {}", gofile_url))?
            .to_string();

        let contents_url = format!(
            "https://api.gofile.io/contents/{}?wt={}&cache=true",
            content_id, token
        );

        let c_resp = client
            .get(&contents_url)
            .send()
            .await
            .map_err(|e| format!("Gofile contents fetch failed: {}", e))?;

        if !c_resp.status().is_success() {
            return Err(format!("Gofile contents HTTP {}", c_resp.status()));
        }

        let c_body: serde_json::Value = c_resp
            .json()
            .await
            .map_err(|e| format!("Gofile contents parse error: {}", e))?;

        let children = &c_body["data"]["children"];
        let first = children
            .as_object()
            .and_then(|obj| obj.values().next())
            .ok_or_else(|| "No children in gofile contents".to_string())?;

        let link = first["link"]
            .as_str()
            .ok_or_else(|| "No link in gofile child".to_string())?
            .to_string();

        println!("[DEBRID][GOFILE] Resolved page URL to direct link via API");
        Ok(link)
    } else {
        // Direct download URL or other format: append guest token
        let authed_url = if gofile_url.contains('?') {
            format!("{}&wt={}", gofile_url, token)
        } else {
            format!("{}?wt={}", gofile_url, token)
        };
        println!("[DEBRID][GOFILE] Appended guest token to direct URL");
        Ok(authed_url)
    }
}

// ── Cancellation tracker ──

/// Module-level set of cancelled job IDs. Any in-flight `download_file_to_dest`
/// for a cancelled job_id will abort its HTTP stream, clean up, and return an error.
fn cancelled_jobs() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_job_cancelled(job_id: &str) -> bool {
    cancelled_jobs().lock().unwrap().contains(job_id)
}

/// Mark a download job as cancelled so the in-flight HTTP stream stops.
#[tauri::command]
pub fn cancel_debrid_download(job_id: String) -> Result<(), String> {
    cancelled_jobs().lock().unwrap().insert(job_id.clone());
    println!("[DEBRID][CANCEL] Download cancelled: {}", job_id);
    Ok(())
}

// ── Download command: download + extract (ZIP/RAR) or just save (EXE/SFX) ──

/// Download a Debrid repack: download file, extract if archive, return result.
///
/// Returns:
///   - status="ready" + executablePath — game is ready to play (ZIP extracted, .exe found)
///   - status="ready" — game executable found after extraction/installer auto-run
#[tauri::command]
pub async fn download_debrid_package(
    app_handle: AppHandle,
    job_id: String,
    download_uri: String,
    dest_dir: String,
) -> Result<DebridDownloadResult, String> {
    if job_id.trim().is_empty() {
        return Err("Job ID is empty.".to_string());
    }
    if download_uri.trim().is_empty() {
        return Err("Download URI is empty.".to_string());
    }
    if dest_dir.trim().is_empty() {
        return Err("Destination directory is empty.".to_string());
    }

    let dest_path = PathBuf::from(&dest_dir);

    // ── Resolve gofile.io URL to a direct download link ──
    let effective_uri = if download_uri.to_lowercase().contains("gofile.io") {
        println!(
            "[DEBRID][GOFILE] Resolving gofile URL: {}",
            &download_uri[..download_uri.len().min(80)]
        );
        resolve_gofile_url(&download_uri).await?
    } else {
        download_uri.clone()
    };

    // ── Step 0: Short-circuit if already extracted (Bug 3 fix) ──
    // If dest_dir already has a usable installer or game exe from a previous
    // successful extraction, skip download+extract entirely.
    let installer_name = find_installer_exe_in_dir(&dest_path);
    if let Some(ref name) = installer_name {
        let installer_path = dest_path.join(name);
        println!("[DEBRID][SHORTCIRCUIT] Installer already on disk: {}", installer_path.display());
        return Ok(auto_run_installer(&installer_path, &dest_dir));
    }

    let game_exe = find_largest_exe_in_dir(&dest_path);
    if let Some(exe_name) = game_exe {
        let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
        println!("[DEBRID][SHORTCIRCUIT] Game executable already on disk: {}", exe_path);
        return Ok(DebridDownloadResult {
            success: true,
            status: "ready".to_string(),
            install_dir: dest_dir.clone(),
            executable_path: Some(exe_path),
            installer_path: None,
            installer_pid: None,
            message: "Already extracted. Ready to play.".to_string(),
        });
    }

    // ── Step 1: Download ──
    emit_installer_progress(
        &app_handle,
        &job_id,
        "downloading",
        5,
        0,
        0,
        &format!("Downloading: {}", effective_uri),
    );

    let downloaded = download_file_to_dest(&effective_uri, &dest_path, &app_handle, &job_id).await?;

    // ── Step 2: Detect actual file type via magic bytes ──
    let detected = detect_file_type(&downloaded.path);
    println!("[DEBRID][DOWNLOAD] detected={:?}", detected);

    match detected {
        // ── EXE/SFX: direct executable — try to run and wait (SFX), or return ready
        DetectedFileType::Executable => {
            let exe_path = ensure_exe_extension(&downloaded.path)?;
            let exe_name_lower = exe_path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.to_lowercase())
                .unwrap_or_default();
            let is_installer = INSTALLER_EXE_NAMES.iter().any(|n| exe_name_lower == *n);
            println!("[DEBRID][DOWNLOAD] EXE saved: {} installer={}", exe_path.display(), is_installer);

            if is_installer {
                // Download complete — auto-run the installer
                println!(
                    "[DEBRID][DOWNLOAD] Fresh download — auto-running installer: {}",
                    exe_path.display()
                );

                let result = auto_run_installer(&exe_path, &dest_dir);

                emit_installer_progress(
                    &app_handle,
                    &job_id,
                    "done",
                    100,
                    downloaded.bytes_read,
                    downloaded.total_bytes,
                    &result.message,
                );

                return Ok(result);
            }

            // Not a known installer name — treat as game executable (direct play)
            println!("[DEBRID][DOWNLOAD] EXE is a game executable — ready to play");
            emit_installer_progress(
                &app_handle,
                &job_id,
                "done",
                100,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Game ready to play!",
            );

            Ok(DebridDownloadResult {
                success: true,
                status: "ready".to_string(),
                install_dir: dest_dir.clone(),
                executable_path: Some(exe_path.to_string_lossy().to_string()),
                installer_path: None,
                installer_pid: None,
                message: "Game ready to play!".to_string(),
            })
        }

        // ── RAR: CLI-first extraction pipeline
        //        Chain: CLI (temp+flatten+copy) → unrar crate → 7z CLI ──
        DetectedFileType::Rar => {
            let rar_path = ensure_archive_extension(&downloaded.path, ".rar");

            emit_installer_progress(
                &app_handle,
                &job_id,
                "extracting",
                50,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Extracting RAR\u{2026}",
            );

            let extract_result = extract_rar_with_cli(&rar_path, &dest_path)
                .or_else(|err| {
                    println!("[DEBRID][EXTRACT] CLI pipeline failed, trying unrar crate: {}", err);
                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "extracting",
                        50,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "Trying pure Rust extractor\u{2026}",
                    );
                    extract_rar_with_unrar(&rar_path, &dest_path)
                })
                .or_else(|err| {
                    println!("[DEBRID][EXTRACT] unrar crate failed, trying 7-Zip: {}", err);
                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "extracting",
                        50,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "Trying 7-Zip fallback\u{2026}",
                    );
                    extract_rar_via_7z(&rar_path, &dest_path)
                });

            match extract_result {
                Ok(()) => {
                    // Keep the downloaded archive on disk for retry — Bug 2 fix
                    // (do NOT fs::remove_file here — if install fails later,
                    //  retry can skip re-download since the archive is still present)

                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "scanning",
                        90,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "Looking for game executable\u{2026}",
                    );

                    // Priority 1: installer/repack-utility files exist → auto-run installer
                    let installer_name = find_installer_exe_in_dir(&dest_path);
                    if let Some(installer_name) = installer_name {
                        let installer_path = dest_path.join(&installer_name);
                        println!("[DEBRID][DOWNLOAD] RAR extracted — auto-running installer: {}", installer_path.display());

                        let result = auto_run_installer(&installer_path, &dest_dir);

                        emit_installer_progress(
                            &app_handle,
                            &job_id,
                            "done",
                            100,
                            downloaded.bytes_read,
                            downloaded.total_bytes,
                            &result.message,
                        );

                        return Ok(result);
                    }

                    // Priority 2: no installer → look for a real game executable (plug-and-play)
                    let game_exe = find_largest_exe_in_dir(&dest_path);
                    if let Some(exe_name) = game_exe {
                        let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
                        println!("[DEBRID][DOWNLOAD] RAR extracted — game executable found: {}", exe_path);

                        emit_installer_progress(
                            &app_handle,
                            &job_id,
                            "done",
                            100,
                            downloaded.bytes_read,
                            downloaded.total_bytes,
                            "Game ready to play!",
                        );

                        return Ok(DebridDownloadResult {
                            success: true,
                            status: "ready".to_string(),
                            install_dir: dest_dir.clone(),
                            executable_path: Some(exe_path),
                            installer_path: None,
                            installer_pid: None,
                            message: "Game ready to play!".to_string(),
                        });
                    }

                    // Extracted but no installer or game exe found — still success, files on disk
                    println!("[DEBRID][DOWNLOAD] RAR extracted but no installer or game exe found");
                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "done",
                        100,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "Extraction complete. Open folder to find the game executable.",
                    );
                    Ok(DebridDownloadResult {
                        success: true,
                        status: "ready".to_string(),
                        install_dir: dest_dir.clone(),
                        executable_path: None,
                        installer_path: None,
                        installer_pid: None,
                        message: "Extraction complete. No game executable found automatically.".to_string(),
                    })
                }
                Err(e) => {
                    println!("[DEBRID][DOWNLOAD] 7-Zip extraction failed: {}", e);
                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "done",
                        100,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "RAR extraction failed. Install 7-Zip or extract manually.",
                    );

                    Err(format!(
                        "RAR archive saved but could not extract automatically. \
                         Install 7-Zip (https://7-zip.org) and extract manually. ({})", e
                    ))
                }
            }
        }

        // ── ZIP: extract using the zip crate (entry-by-entry streaming) ──
        DetectedFileType::Zip => {
            emit_installer_progress(
                &app_handle,
                &job_id,
                "extracting",
                50,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Extracting ZIP\u{2026}",
            );

            extract_zip_with_zip_crate(&downloaded.path, &dest_path)?;

            // Keep the downloaded archive on disk for retry — Bug 2 fix
            // (do NOT fs::remove_file here — if install fails later,
            //  retry can skip re-download since the archive is still present)

            emit_installer_progress(
                &app_handle,
                &job_id,
                "scanning",
                90,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Looking for game executable\u{2026}",
            );

            // Priority 1: installer/repack-utility files exist → auto-run installer
            let installer_name = find_installer_exe_in_dir(&dest_path);
            if let Some(installer_name) = installer_name {
                let installer_path = dest_path.join(&installer_name);
                println!("[DEBRID][DOWNLOAD] ZIP extracted — auto-running installer: {}", installer_path.display());

                let result = auto_run_installer(&installer_path, &dest_dir);

                emit_installer_progress(
                    &app_handle,
                    &job_id,
                    "done",
                    100,
                    downloaded.bytes_read,
                    downloaded.total_bytes,
                    &result.message,
                );

                return Ok(result);
            }

            // Priority 2: no installer → look for a real game executable (plug-and-play)
            let game_exe = find_largest_exe_in_dir(&dest_path);
            if let Some(exe_name) = game_exe {
                let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
                println!("[DEBRID][DOWNLOAD] ZIP extracted — game executable found: {}", exe_path);

                emit_installer_progress(
                    &app_handle,
                    &job_id,
                    "done",
                    100,
                    downloaded.bytes_read,
                    downloaded.total_bytes,
                    "Game ready to play!",
                );

                return Ok(DebridDownloadResult {
                    success: true,
                    status: "ready".to_string(),
                    install_dir: dest_dir.clone(),
                    executable_path: Some(exe_path),
                    installer_path: None,
                    installer_pid: None,
                    message: "Game ready to play!".to_string(),
                });
            }

            // Nothing found — still success, files on disk
            println!("[DEBRID][DOWNLOAD] ZIP extracted but no game .exe or setup.exe found");
            emit_installer_progress(
                &app_handle,
                &job_id,
                "done",
                100,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Extraction complete. Open folder to find the game executable.",
            );
            Ok(DebridDownloadResult {
                success: true,
                status: "ready".to_string(),
                install_dir: dest_dir.clone(),
                executable_path: None,
                installer_path: None,
                installer_pid: None,
                message: "Extraction complete. No game executable found automatically.".to_string(),
            })
        }

        DetectedFileType::Unknown(hex) => {
            Err(format!(
                "Unknown file type (magic bytes: {}). Expected RAR, ZIP, or Windows executable.",
                hex
            ))
        }
    }
}

// ── Setup command: run the already-extracted installer, no download ──

/// Run a previously-downloaded repack installer (setup.exe) in detached mode.
///
/// Unlike `download_debrid_package`, this command does NOT download or extract
/// anything — it assumes the installer is already on disk from a prior
/// `download_debrid_package` call that returned `status="needs-setup"`.
/// Returns `status="installing"` with `installer_pid` — TS must poll
/// `check_installer_status` to know when the installer finishes.
#[tauri::command]
pub fn setup_debrid_game(
    installer_path: String,
    install_dir: String,
) -> Result<DebridDownloadResult, String> {
    if installer_path.trim().is_empty() {
        return Err("Installer path is empty.".to_string());
    }
    if install_dir.trim().is_empty() {
        return Err("Install directory is empty.".to_string());
    }

    let installer = Path::new(&installer_path);

    if !installer.exists() {
        return Err(format!("Installer not found: {}", installer_path));
    }

    println!("[DEBRID][SETUP] Spawning installer detached: {}", installer_path);

    match spawn_installer_detached(installer) {
        Ok(pid) => {
            println!("[DEBRID][SETUP] Installer PID={} — TS will poll", pid);
            Ok(DebridDownloadResult {
                success: true,
                status: "installing".to_string(),
                install_dir,
                executable_path: None,
                installer_path: Some(installer_path),
                installer_pid: Some(pid),
                message: format!("Installer started (PID {})", pid),
            })
        }
        Err(e) => {
            println!("[DEBRID][SETUP] Failed to spawn installer: {}", e);
            Ok(DebridDownloadResult {
                success: true,
                status: "ready".to_string(),
                install_dir,
                executable_path: None,
                installer_path: Some(installer_path),
                installer_pid: None,
                message: format!("Failed to start installer: {}. Open the install folder and run setup.exe manually.", e),
            })
        }
    }
}

// ── Spawn installer, WAIT for it to close, then scan for game .exe ──

/// Run an installer executable in the foreground and wait for it to complete,
/// then scan the destination directory for the game executable.
///
/// Called from `setup_debrid_game` — the user sees the installer GUI,
/// Rust waits for the process to exit, then scans for the game .exe
/// and returns the path.
#[allow(dead_code)]
fn spawn_installer_and_wait(
    installer_path: &Path,
    dest_dir: &Path,
) -> Result<Option<String>, String> {
    if !installer_path.exists() {
        return Err(format!("Installer not found: {}", installer_path.display()));
    }

    println!(
        "[DEBRID][INSTALL] Spawning installer: {}",
        installer_path.display()
    );

    // Try normal spawn; fall back to PowerShell RunAs for elevation (error 740)
    let mut child = match std::process::Command::new(installer_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            #[cfg(not(target_os = "windows"))]
            return Err(format!("Failed to spawn installer: {}", e));

            #[cfg(target_os = "windows")]
            if e.raw_os_error() != Some(740) {
                return Err(format!("Failed to spawn installer: {}", e));
            }

            println!("[DEBRID][INSTALL] Elevation required — retrying via PowerShell RunAs");
            let safe_path = installer_path.to_string_lossy().replace('\'', "''");
            std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    &format!(
                        "Start-Process -FilePath '{}' -Wait -Verb RunAs; exit 0",
                        safe_path
                    ),
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .stdin(std::process::Stdio::null())
                .spawn()
                .map_err(|e2| {
                    format!(
                        "Failed to spawn elevated installer via PowerShell: {}",
                        e2
                    )
                })?
        }
    };

    let pid = child.id();
    println!("[DEBRID][INSTALL] Setup.exe spawned PID={} — waiting for exit", pid);

    let exit_status = child
        .wait()
        .map_err(|e| format!("Failed to wait for installer: {}", e))?;

    println!(
        "[DEBRID][INSTALL] Setup.exe exited with status={:?} — scanning for game .exe",
        exit_status.code()
    );

    let game_exe = find_largest_exe_in_dir(dest_dir);

    if let Some(ref exe_name) = game_exe {
        let exe_path = dest_dir.join(exe_name);
        println!("[DEBRID][INSTALL] Game executable found: {}", exe_path.display());
    } else {
        println!("[DEBRID][INSTALL] No game executable found after installer exited");
    }

    Ok(game_exe.map(|n| dest_dir.join(n).to_string_lossy().to_string()))
}

/// Auto-run the installer in detached mode, return the PID so TS can poll.
///
/// - On spawn success: returns `status: "installing"` with `installer_pid`
/// - On spawn failure: returns `status: "needs-setup"` with `installer_path`
fn auto_run_installer(
    installer_path: &Path,
    dest_dir: &str,
) -> DebridDownloadResult {
    println!(
        "[DEBRID][AUTO_INSTALL] Spawning installer detached: {}",
        installer_path.display()
    );

    match spawn_installer_detached(installer_path) {
        Ok(pid) => {
            println!("[DEBRID][AUTO_INSTALL] Installer PID={} — tracking in TS", pid);
            DebridDownloadResult {
                success: true,
                status: "installing".to_string(),
                install_dir: dest_dir.to_string(),
                executable_path: None,
                installer_path: Some(installer_path.to_string_lossy().to_string()),
                installer_pid: Some(pid),
                message: format!("Installer started (PID {}) — tracking progress", pid),
            }
        }
        Err(e) => {
            println!("[DEBRID][AUTO_INSTALL] Failed to spawn installer: {}", e);
            DebridDownloadResult {
                success: true,
                status: "needs-setup".to_string(),
                install_dir: dest_dir.to_string(),
                executable_path: None,
                installer_path: Some(installer_path.to_string_lossy().to_string()),
                installer_pid: None,
                message: format!("Failed to start installer: {}. Click Install Now to retry.", e),
            }
        }
    }
}

// ── Detached spawn + polling helpers ──

/// Spawn an installer in detached mode (no wait, process outlives Rust).
///
/// - Tries normal spawn first
/// - Falls back to PowerShell `Start-Process -Verb RunAs` for elevation (error 740)
/// - Returns the PID of the spawned process
fn spawn_installer_detached(installer_path: &Path) -> Result<u32, String> {
    if !installer_path.exists() {
        return Err(format!("Installer not found: {}", installer_path.display()));
    }

    println!(
        "[DEBRID][INSTALL] Detached spawn: {}",
        installer_path.display()
    );

    match std::process::Command::new(installer_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            // Detach — let the process outlive our command
            std::mem::forget(child);
            println!("[DEBRID][INSTALL] Detached PID={}", pid);
            Ok(pid)
        }
        Err(e) => {
            #[cfg(not(target_os = "windows"))]
            return Err(format!("Failed to spawn installer: {}", e));

            #[cfg(target_os = "windows")]
            if e.raw_os_error() != Some(740) {
                return Err(format!("Failed to spawn installer: {}", e));
            }

            // Elevation required: use PowerShell Start-Process (no -Wait = detached)
            println!("[DEBRID][INSTALL] Elevation required — PowerShell RunAs (detached)");
            let safe_path = installer_path.to_string_lossy().replace('\'', "''");
            let output = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    &format!(
                        "Start-Process -FilePath '{}' -Verb RunAs -PassThru | Select-Object -ExpandProperty Id",
                        safe_path
                    ),
                ])
                .output()
                .map_err(|e2| format!("Failed to launch elevated installer: {}", e2))?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let pid_str = stdout.trim();
            let pid: u32 = pid_str.parse().map_err(|_| {
                format!(
                    "Could not get PID from elevated process: stdout='{}'",
                    stdout
                )
            })?;

            println!("[DEBRID][INSTALL] Elevated detached PID={}", pid);
            Ok(pid)
        }
    }
}

/// Check whether a process with the given PID is still running.
///
/// Uses Win32 `OpenProcess` on Windows, `kill -0` on Unix.
fn is_process_running(pid: u32) -> bool {
    #[cfg(windows)]
    {
        // Win32: OpenProcess with PROCESS_QUERY_INFORMATION
        // If the handle is non-null, the process exists.
        type HANDLE = *mut std::ffi::c_void;
        type BOOL = i32;

        extern "system" {
            fn OpenProcess(
                dwDesiredAccess: u32,
                bInheritHandle: BOOL,
                dwProcessId: u32,
            ) -> HANDLE;
            fn CloseHandle(hObject: HANDLE) -> BOOL;
        }

        const PROCESS_QUERY_INFORMATION: u32 = 0x0400;

        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            CloseHandle(handle);
            true
        }
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// Poll an installer process status by PID.
///
/// When the installer is still running → `status: "running"`.
/// When the installer has exited:
///   - Game .exe found on disk → `status: "ready"` + `executable_path`
///   - No .exe found → `status: "needs-path"` (modal will ask user)
#[tauri::command]
pub fn check_installer_status(
    pid: u32,
    install_dir: String,
) -> Result<InstallerCheckResult, String> {
    println!("[DEBRID][POLL] Checking PID={} in dir={}", pid, install_dir);

    if is_process_running(pid) {
        println!("[DEBRID][POLL] PID={} still running", pid);
        return Ok(InstallerCheckResult {
            status: "running".to_string(),
            executable_path: None,
            error: None,
        });
    }

    // Process has exited — scan for game executable
    println!("[DEBRID][POLL] PID={} has exited — scanning for game .exe", pid);

    let dir_path = Path::new(&install_dir);
    if !dir_path.exists() || !dir_path.is_dir() {
        return Ok(InstallerCheckResult {
            status: "needs-path".to_string(),
            executable_path: None,
            error: Some(format!("Install directory not found: {}", install_dir)),
        });
    }

    match find_largest_exe_in_dir(dir_path) {
        Some(exe_name) => {
            let exe_path = dir_path.join(&exe_name).to_string_lossy().to_string();
            println!("[DEBRID][POLL] Game executable found: {}", exe_path);
            Ok(InstallerCheckResult {
                status: "ready".to_string(),
                executable_path: Some(exe_path),
                error: None,
            })
        }
        None => {
            println!("[DEBRID][POLL] No game executable found — needs-path");
            Ok(InstallerCheckResult {
                status: "needs-path".to_string(),
                executable_path: None,
                error: None,
            })
        }
    }
}

/// Re-run the installer (detached) after a previous run failed or was cancelled.
///
/// Returns `status: "installing"` with `installer_pid` so the caller can poll.
#[tauri::command]
pub fn run_installer_again(
    installer_path: String,
    install_dir: String,
) -> Result<DebridDownloadResult, String> {
    if installer_path.trim().is_empty() {
        return Err("Installer path is empty.".to_string());
    }
    if install_dir.trim().is_empty() {
        return Err("Install directory is empty.".to_string());
    }

    let installer = Path::new(&installer_path);
    if !installer.exists() {
        return Err(format!("Installer not found: {}", installer_path));
    }

    println!("[DEBRID][RERUN] Spawning installer again: {}", installer_path);

    match spawn_installer_detached(installer) {
        Ok(pid) => {
            println!("[DEBRID][RERUN] Installer PID={}", pid);
            Ok(DebridDownloadResult {
                success: true,
                status: "installing".to_string(),
                install_dir,
                executable_path: None,
                installer_path: Some(installer_path),
                installer_pid: Some(pid),
                message: format!("Installer started (PID {})", pid),
            })
        }
        Err(e) => {
            println!("[DEBRID][RERUN] Failed to spawn installer: {}", e);
            Ok(DebridDownloadResult {
                success: false,
                status: "needs-setup".to_string(),
                install_dir,
                executable_path: None,
                installer_path: Some(installer_path),
                installer_pid: None,
                message: format!("Failed to start installer: {}", e),
            })
        }
    }
}

// ── Verify command: check if game .exe exists in install dir ──

/// Check whether a game executable exists in a Debrid install directory.
/// Used for manual "Verify Installation" and post-installer verification.
#[tauri::command]
pub fn verify_debrid_installation(
    install_dir: String,
) -> Result<DebridVerifyResult, String> {
    if install_dir.trim().is_empty() {
        return Err("Install directory is empty.".to_string());
    }

    let dir_path = Path::new(&install_dir);
    if !dir_path.exists() {
        return Ok(DebridVerifyResult {
            installed: false,
            install_dir,
            executable_path: None,
        });
    }

    let game_exe = find_largest_exe_in_dir(dir_path);
    let exe_path = game_exe.map(|name| dir_path.join(&name).to_string_lossy().to_string());

    println!(
        "[DEBRID][VERIFY] installed={} executable={:?}",
        exe_path.is_some(),
        exe_path
    );

    Ok(DebridVerifyResult {
        installed: exe_path.is_some(),
        install_dir,
        executable_path: exe_path,
    })
}

// ── Internal helpers ──

struct DownloadedFile {
    path: PathBuf,
    bytes_read: u64,
    total_bytes: u64,
}

/// Download a file from a URI to a destination directory using async streaming reqwest.
///
/// Uses `reqwest::Client` (async) with `bytes_stream()` to download chunk-by-chunk
/// without buffering the entire response body in RAM. Each chunk is written to disk
/// immediately via a buffered File writer, keeping memory usage constant (~64 KB
/// per chunk) regardless of total file size.
///
/// The download goes to `dest_dir/tmp/<filename>` first (same filesystem as dest),
/// then is atomically renamed to `dest_dir/<filename>` on completion. This ensures
/// partial/corrupt downloads never pollute the final directory.
async fn download_file_to_dest(
    uri: &str,
    dest_dir: &Path,
    app_handle: &AppHandle,
    job_id: &str,
) -> Result<DownloadedFile, String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    // Use a temp sub-directory inside dest_dir so the rename is instant (same filesystem).
    let tmp_dir = dest_dir.join("tmp");
    fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create tmp dir: {}", e))?;

    // ── Bug 1 fix: Check if file already exists on disk ──
    let file_name = clean_download_filename(extract_filename_from_uri(uri));
    let dest_path = dest_dir.join(&file_name);
    if dest_path.exists() {
        let metadata = dest_path.metadata().map_err(|e| format!("Failed to read file metadata: {}", e))?;
        let file_len = metadata.len();
        if file_len > 0 {
            println!(
                "[DEBRID][DOWNLOAD] File already exists on disk, skipping download: {} ({} bytes)",
                file_name, file_len
            );
            emit_installer_progress(
                app_handle,
                job_id,
                "downloading",
                55,
                file_len,
                file_len,
                "Already downloaded",
            );
            return Ok(DownloadedFile {
                path: dest_path,
                bytes_read: file_len,
                total_bytes: file_len,
            });
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(300))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(uri)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }

    // Reject Content-Type text/html — this is an error page or login page, not a file.
    if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
        if let Ok(ct_str) = content_type.to_str() {
            if ct_str.contains("text/html") {
                return Err(
                    "Not a direct download link (server returned HTML instead of file). \
                     Use stygian-browser for this URL."
                        .to_string(),
                );
            }
        }
    }

    let total_bytes = response.content_length().unwrap_or(0);

    // Check disk space before downloading anything
    check_disk_space(dest_dir, total_bytes)?;

    // Use a clean short filename — gofile.io tokens are 200+ chars
    let tmp_path = tmp_dir.join(&file_name);

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    // ── Stream the response body chunk-by-chunk ──
    // Each chunk is written to disk immediately (async, non-blocking).
    // No part of the file is retained in memory after writing.
    // Progress is throttled to avoid flooding Tauri IPC.
    let mut stream = response.bytes_stream();
    let mut bytes_read: u64 = 0;
    let mut last_progress = std::time::Instant::now();
    let progress_interval = std::time::Duration::from_millis(250);

    while let Some(chunk_result) = stream.next().await {
        // ── Bug 4 fix: Check for cancellation on every chunk ──
        if is_job_cancelled(job_id) {
            drop(file);
            let _ = fs::remove_file(&tmp_path);
            let _ = fs::remove_dir(&tmp_dir);
            println!("[DEBRID][CANCEL] Download aborted by user: {}", file_name);
            return Err("Download cancelled by user.".to_string());
        }

        let chunk = chunk_result.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error during download: {}", e))?;
        bytes_read += chunk.len() as u64;

        // Throttle progress: emit max 4 times per second
        if last_progress.elapsed() >= progress_interval {
            let progress = if total_bytes > 0 {
                let pct = ((bytes_read as f64 / total_bytes as f64) * 55.0) as u8;
                5 + pct.min(55)
            } else {
                35
            };

            emit_installer_progress(
                app_handle,
                job_id,
                "downloading",
                progress,
                bytes_read,
                total_bytes,
                "Downloading repack\u{2026}",
            );
            last_progress = std::time::Instant::now();
        }
    }

    // Atomic rename from tmp to final destination (instant on same filesystem)
    fs::rename(&tmp_path, &dest_path)
        .map_err(|e| format!("Failed to move downloaded file: {}", e))?;

    // Clean up the tmp directory if empty
    let _ = fs::remove_dir(&tmp_dir);

    println!(
        "[DEBRID][DOWNLOAD] Complete: {} ({} bytes written)",
        file_name, bytes_read
    );

    Ok(DownloadedFile {
        path: dest_path,
        bytes_read,
        total_bytes,
    })
}

/// Check that `dest_dir` has enough free space to accommodate `required_bytes`
/// (plus a 10 % margin for extraction overhead).
///
/// Uses `fs2::available_space` for a cross-platform filesystem space query.
/// Skips the check when `required_bytes` is zero (unknown Content-Length).
fn check_disk_space(dest_dir: &Path, required_bytes: u64) -> Result<(), String> {
    if required_bytes == 0 {
        return Ok(());
    }

    // Add 10 % margin for extraction overhead
    let needed = (required_bytes as f64 * 1.1) as u64;

    let available = fs2::available_space(dest_dir)
        .map_err(|e| format!("Failed to check disk space: {}", e))?;

    if available < needed {
        let needed_gb = needed as f64 / 1_073_741_824.0;
        let available_gb = available as f64 / 1_073_741_824.0;
        return Err(format!(
            "Not enough disk space. Need {:.1} GB, only {:.1} GB available.",
            needed_gb, available_gb
        ));
    }

    println!(
        "[DEBRID][DISK] available={}B needed={}B OK",
        available, needed
    );
    Ok(())
}

/// Sanitize a ZIP entry path: normalize separators, strip parent-dir traversal.
fn sanitize_zip_entry_path(path: &str) -> PathBuf {
    let cleaned = path
        .replace('\\', "/")
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".." && *part != ".")
        .collect::<Vec<_>>()
        .join("/");
    PathBuf::from(cleaned)
}

/// Extract a RAR archive using the `unrar` crate (pure Rust, no external process).
///
/// This is the primary extractor — no CMD window, no external dependencies.
/// If `unrar` fails (corrupt archive, unsupported feature), falls back to
/// `extract_rar_via_7z` (external process with hidden window).
fn extract_rar_with_unrar(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    use unrar::Archive;

    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    let archive = Archive::new(rar_path)
        .open_for_processing()
        .map_err(|e| format!("Failed to open RAR archive: {}", e))?;

    let mut extracted = 0u32;
    let mut current = archive;
    loop {
        match current.read_header() {
            Ok(Some(header)) => {
                let entry = header.entry();
                let entry_filename = entry.filename.to_path_buf();
                let entry_idx = extracted + 1;
                let filename_str = entry_filename.to_string_lossy().to_string();
                let is_dir = entry.is_directory()
                    || filename_str.ends_with('/')
                    || filename_str.ends_with('\\');

                println!(
                    "[DEBRID][EXTRACT] Entry {}: filename='{}' is_dir={} unpacked_size={}",
                    entry_idx,
                    filename_str,
                    is_dir,
                    entry.unpacked_size
                );

                if is_dir {
                    // Directory entry: create the directory and skip
                    let full_dir = dest_dir.join(&entry_filename);
                    if let Err(e) = fs::create_dir_all(&full_dir) {
                        println!(
                            "[DEBRID][EXTRACT] Warning: could not create dir '{}': {}",
                            full_dir.display(),
                            e
                        );
                    }
                    current = match header.skip() {
                        Ok(next) => next,
                        Err(e) => {
                            return Err(format!(
                                "Failed to skip dir entry {} '{}': {}",
                                entry_idx, filename_str, e
                            ));
                        }
                    };
                    continue;
                }

                // File entry: create parent directory, then extract
                if let Some(parent) = entry_filename.parent() {
                    if !parent.as_os_str().is_empty() {
                        let full_parent = dest_dir.join(parent);
                        if let Err(e) = fs::create_dir_all(&full_parent) {
                            return Err(format!(
                                "Failed to create directory '{}': {}",
                                full_parent.display(),
                                e
                            ));
                        }
                    }
                }

                let output_path = dest_dir.join(&entry_filename);
                println!(
                    "[DEBRID][EXTRACT] Extracting entry {} to '{}'",
                    entry_idx,
                    output_path.display()
                );

                // Try extract_to first, fall back to extract_with_base
                let extract_result = header.extract_to(dest_dir).or_else(|_| {
                    // extract_to consumed header on error, reopen and skip to this entry
                    // Since we can't skip forward, we'll let the error propagate
                    Err("extract_to failed".to_string())
                });

                match extract_result {
                    Ok(next) => {
                        current = next;
                        extracted += 1;
                    }
                    Err(e) => {
                        return Err(format!(
                            "Failed to extract entry {} '{}' -> '{}': {}",
                            entry_idx, filename_str, output_path.display(), e
                        ));
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                println!(
                    "[DEBRID][EXTRACT] Warning: read error at entry {}: {}",
                    extracted + 1,
                    e
                );
                break;
            }
        }
    }

    if extracted == 0 {
        return Err("RAR extraction produced zero files".to_string());
    }

    println!(
        "[DEBRID][EXTRACT] RAR extracted via unrar crate ({} entries)",
        extracted
    );
    Ok(())
}

/// ─── Primary: CLI-based RAR extraction (temp dir + flatten + copy) ───
///
/// 1. Detects the best available CLI tool (UnRAR, 7z, unar)
/// 2. Extracts to a temporary directory
/// 3. Flattens a single-root wrapper folder if present
/// 4. Copies with rollback to the final destination
/// 5. Cleans up the temp directory

/// A detected RAR-extraction CLI tool.
#[derive(Debug)]
enum RarCliTool {
    UnRar(PathBuf),
    SevenZip(PathBuf),
    Unar(PathBuf),
}

impl RarCliTool {
    fn exe_path(&self) -> &Path {
        match self {
            RarCliTool::UnRar(p) | RarCliTool::SevenZip(p) | RarCliTool::Unar(p) => p,
        }
    }

    fn display_name(&self) -> &'static str {
        match self {
            RarCliTool::UnRar(_) => "UnRAR",
            RarCliTool::SevenZip(_) => "7-Zip",
            RarCliTool::Unar(_) => "unar",
        }
    }
}

/// Search for available RAR-extraction CLI tools on the system.
///
/// Check order: WinRAR → 7-Zip → unar (PATH only).
/// Each tool path is verified (file exists or in PATH).
fn detect_rar_extractors() -> Vec<RarCliTool> {
    let mut tools: Vec<RarCliTool> = Vec::new();

    // ── 1. UnRAR.exe (WinRAR) in Program Files ──
    for base in [
        r"C:\Program Files\WinRAR",
        r"C:\Program Files (x86)\WinRAR",
    ] {
        let p = Path::new(base).join("UnRAR.exe");
        if p.is_file() {
            tools.push(RarCliTool::UnRar(p));
            break;
        }
    }

    // ── 2. 7z.exe (7-Zip) in Program Files ──
    for base in [
        r"C:\Program Files\7-Zip",
        r"C:\Program Files (x86)\7-Zip",
    ] {
        let p = Path::new(base).join("7z.exe");
        if p.is_file() {
            tools.push(RarCliTool::SevenZip(p));
            break;
        }
    }

    // ── 3. unar.exe via PATH ──
    if let Some(p) = find_in_path("unar.exe") {
        tools.push(RarCliTool::Unar(p));
    }

    // ── 4. Also try bare names via PATH for UnRAR and 7z ──
    if !tools.iter().any(|t| matches!(t, RarCliTool::UnRar(_))) {
        if let Some(p) = find_in_path("UnRAR.exe") {
            tools.push(RarCliTool::UnRar(p));
        }
    }
    if !tools.iter().any(|t| matches!(t, RarCliTool::SevenZip(_))) {
        if let Some(p) = find_in_path("7z.exe") {
            tools.push(RarCliTool::SevenZip(p));
        }
    }

    tools
}

/// Look for `exe_name` in every directory listed in `%PATH%`.
fn find_in_path(exe_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Primary RAR extraction: tries each available CLI tool in order.
///
/// For each tool:
///   a. Extract to a temp directory
///   b. Flatten single-root wrapper folder
///   c. Copy with rollback to the final destination
/// Returns `Ok(())` on the first successful extraction.
fn extract_rar_with_cli(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // FitGirl and many repack groups use "1234" as the archive password
    const RAR_PASSWORD: &str = "1234";

    let tools = detect_rar_extractors();
    if tools.is_empty() {
        return Err("No RAR extraction tool found on the system".to_string());
    }

    let mut last_err = String::new();

    for tool in &tools {
        let exe = tool.exe_path();
        let name = tool.display_name();
        println!("[DEBRID][EXTRACT] Trying {} ({})", name, exe.display());

        // Create temp dir
        let temp_dir = match tempfile::tempdir() {
            Ok(d) => d,
            Err(e) => {
                last_err = format!("Failed to create temp dir: {}", e);
                continue;
            }
        };
        let extract_root = temp_dir.path().join("extracted");
        let _ = fs::create_dir_all(&extract_root);

        // Build the CLI command
        let output = match tool {
            RarCliTool::UnRar(_) => {
                Command::new(exe)
                    .arg("x")        // extract with full paths
                    .arg(format!("-p{}", RAR_PASSWORD))
                    .arg("-y")       // assume yes
                    .arg(rar_path)
                    .arg(&extract_root)  // destination
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
            }
            RarCliTool::SevenZip(_) => {
                Command::new(exe)
                    .arg("x")
                    .arg(format!("-p{}", RAR_PASSWORD))
                    .arg(format!("-o{}", extract_root.display()))
                    .arg("-y")
                    .arg(rar_path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
            }
            RarCliTool::Unar(_) => {
                Command::new(exe)
                    .arg(format!("-p{}", RAR_PASSWORD))
                    .arg("-o")
                    .arg(&extract_root)
                    .arg(rar_path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
            }
        };

        let output = match output {
            Ok(o) => o,
            Err(e) => {
                last_err = format!("{} launch failed: {}", name, e);
                continue;
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            last_err = format!("{} failed.\nstdout: {}\nstderr: {}", name, stdout, stderr);
            continue;
        }

        // ── Flatten single-root folder ──
        let source = flatten_single_root_folder(&extract_root);

        // ── Copy with rollback ──
        match copy_recursive_with_rollback(&source, dest_dir) {
            Ok(copied) => {
                println!(
                    "[DEBRID][EXTRACT] {} extracted via {} ({} files, temp cleanup)",
                    rar_path.display(),
                    name,
                    copied
                );
                // temp_dir is dropped here → auto-cleanup
                return Ok(());
            }
            Err(e) => {
                last_err = format!("{} copy failed: {}", name, e);
                continue;
            }
        }
    }

    Err(format!(
        "All CLI extractors failed. Last error: {}",
        last_err
    ))
}

/// If the extracted directory contains exactly one subdirectory and no loose
/// files, return that subdirectory as the effective source (flatten wrapper).
fn flatten_single_root_folder(extract_root: &Path) -> PathBuf {
    let entries: Vec<_> = match fs::read_dir(extract_root) {
        Ok(iter) => iter.flatten().collect(),
        Err(_) => return extract_root.to_path_buf(),
    };

    let dirs: Vec<_> = entries.iter().filter(|e| e.path().is_dir()).collect();
    let files: Vec<_> = entries.iter().filter(|e| e.path().is_file()).collect();

    if dirs.len() == 1 && files.is_empty() {
        let inner = dirs[0].path();
        println!(
            "[DEBRID][EXTRACT] Flattening single root folder: {} -> {}",
            extract_root.display(),
            inner.display()
        );
        inner
    } else {
        extract_root.to_path_buf()
    }
}

/// Recursively copy files from `src` to `dst`, tracking every created file.
///
/// If any copy fails, all already-copied files are deleted (rollback).
/// Returns the number of files copied.
fn copy_recursive_with_rollback(src: &Path, dst: &Path) -> Result<u32, String> {
    let mut created_files: Vec<PathBuf> = Vec::new();

    let result = copy_recursive_impl(src, dst, &mut created_files);

    if result.is_err() {
        // Rollback: delete every file we already copied
        for f in &created_files {
            let _ = fs::remove_file(f);
        }
        // Also try to clean up empty parent directories (best-effort)
        let mut parent = dst.to_path_buf();
        for _ in 0..5 {
            if !parent.pop() {
                break;
            }
            let _ = fs::remove_dir(&parent);
        }
        println!(
            "[DEBRID][EXTRACT] Rollback: deleted {} files on copy failure",
            created_files.len()
        );
    }

    result.map(|_| created_files.len() as u32)
}

fn copy_recursive_impl(src: &Path, dst: &Path, created: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(src)
        .map_err(|e| format!("Failed to read source dir {}: {}", src.display(), e))?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let relative = entry_path
            .strip_prefix(src)
            .map_err(|e| format!("Path strip error: {}", e))?;
        let target = dst.join(relative);

        if entry_path.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|e| format!("Failed to create dir {}: {}", target.display(), e))?;
            copy_recursive_impl(&entry_path, &target, created)?;
        } else if entry_path.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir {}: {}", parent.display(), e))?;
            }
            fs::copy(&entry_path, &target)
                .map_err(|e| format!("Failed to copy {} -> {}: {}", entry_path.display(), target.display(), e))?;
            created.push(target);
        }
    }

    Ok(())
}

/// Fallback: extract a RAR archive via `7z.exe` (7-Zip CLI) with the CMD window hidden.
///
/// Only called when `extract_rar_with_unrar` fails.
/// Uses `CREATE_NO_WINDOW` so the console flash doesn't appear.
fn extract_rar_via_7z(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let candidates = [
        r#"C:\Program Files\7-Zip\7z.exe"#,
        r#"C:\Program Files (x86)\7-Zip\7z.exe"#,
        "7z.exe",
    ];

    let seven_zip = candidates
        .iter()
        .find(|p| Path::new(p).is_file())
        .ok_or_else(|| {
            "7-Zip not found. Install 7-Zip (https://7-zip.org) to extract RAR archives automatically."
                .to_string()
        })?;

    let output = Command::new(seven_zip)
        .arg("x")
        .arg(rar_path)
        .arg(format!("-o{}", dest_dir.display()))
        .arg("-y")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to launch 7-Zip: {}", e))?;

    if output.status.success() {
        println!(
            "[DEBRID][EXTRACT] RAR extracted via 7-Zip from {}",
            rar_path.display()
        );
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!(
            "7-Zip extraction failed.\nstdout: {}\nstderr: {}",
            stdout, stderr
        ))
    }
}

/// Extract a ZIP archive entry-by-entry using the `zip` crate.
///
/// The `zip` crate reads the central directory (small metadata, kilobytes)
/// then decompresses each entry via a streaming reader — memory usage stays
/// proportional to the buffer size (~64 KB), NOT the archive size.
/// This avoids the gigabytes of RAM that PowerShell `Expand-Archive` consumes.
fn extract_zip_with_zip_crate(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    if !zip_path.exists() {
        return Err(format!("ZIP file not found: {}", zip_path.display()));
    }

    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    let file =
        fs::File::open(zip_path).map_err(|e| format!("Failed to open ZIP file: {}", e))?;

    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    let count = archive.len();
    println!("[DEBRID][EXTRACT] Extracting ZIP via zip crate ({} entries)", count);

    for i in 0..count {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;

        let entry_name = entry.name().to_string();
        let safe_path = sanitize_zip_entry_path(&entry_name);
        let target = dest_dir.join(&safe_path);

        // ZipSlip guard: reject entries that escape the destination
        if !target.starts_with(dest_dir) {
            println!("[DEBRID][EXTRACT] Skipped path-traversal entry: {}", entry_name);
            continue;
        }

        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|e| format!("Failed to create dir {}: {}", safe_path.display(), e))?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }

            let mut out =
                fs::File::create(&target).map_err(|e| format!("Failed to create file {}: {}", safe_path.display(), e))?;

            let mut buffer = [0u8; 65_536]; // 64 KB decompression buffer
            loop {
                let n = entry
                    .read(&mut buffer)
                    .map_err(|e| format!("Failed to read entry {}: {}", entry_name, e))?;
                if n == 0 {
                    break;
                }
                out.write_all(&buffer[..n])
                    .map_err(|e| format!("Failed to write {}: {}", safe_path.display(), e))?;
            }
        }
    }

    println!("[DEBRID][EXTRACT] ZIP extraction complete via zip crate");
    Ok(())
}

/// Look for a setup/installer executable in a directory (top-level only).
/// Known repack utility executables — checksum tools, verify helpers, etc.
/// These are NOT game executables — they signal that the extracted content needs
/// manual setup installation (typically a FitGirl/DODI/ElAmigos repack).
const REPACK_UTILITY_EXES: &[&str] = &[
    "quicksfv.exe", "quicksfv64.exe",
    "verify.exe", "verify.bat",
    "md5.exe", "md5sums.exe",
    "sfv.exe",
];

/// Known installer executable names.
const INSTALLER_EXE_NAMES: &[&str] = &[
    "setup.exe", "installer.exe",
    "setup_x64.exe", "setup_x86.exe",
    "autorun.exe",
];

/// Check whether `dir` contains any installer or repack-utility file.
///
/// Returns the name of the first match using a priority order:
/// setup.exe (most authoritative) → other installer names → repack utilities.
fn find_installer_exe_in_dir(dir: &Path) -> Option<String> {
    // Priority 1: real installer EXEs
    for candidate in INSTALLER_EXE_NAMES {
        let path = dir.join(candidate);
        if path.exists() && path.is_file() {
            return Some(candidate.to_string());
        }
    }

    // Priority 2: repack utilities (checksum tools, verify helpers)
    for candidate in REPACK_UTILITY_EXES {
        let path = dir.join(candidate);
        if path.exists() && path.is_file() {
            return Some(candidate.to_string());
        }
    }

    None
}

/// Scan a directory for the largest .exe file (excluding setup/installer/repack-utility names).
fn find_largest_exe_in_dir(dir: &Path) -> Option<String> {
    let exclude = [
        // Installers
        "unins000.exe", "uninstall.exe", "setup.exe", "installer.exe",
        "setup_x64.exe", "setup_x86.exe", "autorun.exe",
        // Redistributables & runtimes
        "dxsetup.exe", "vc_redist.exe", "vcredist.exe", "dotnet.exe",
        "directx.exe", "oalinst.exe", "xnafx.exe",
        "gfwlivesetup.exe", "gamesforsetup.exe",
        // Repack utilities (checksum / verify)
        "quicksfv.exe", "quicksfv64.exe",
        "verify.exe",
        "md5.exe", "md5sums.exe",
        "sfv.exe",
    ];

    let mut largest: Option<(String, u64)> = None;

    fn visit_dir(dir: &Path, exclude: &[&str], largest: &mut Option<(String, u64)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit_dir(&path, exclude, largest);
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext.to_lowercase() != "exe" {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let name_lower = name.to_lowercase();
            if exclude.contains(&name_lower.as_str()) {
                continue;
            }
            if let Ok(meta) = path.metadata() {
                if meta.is_file() {
                    let size = meta.len();
                    if largest.as_ref().map_or(true, |(_, s)| size > *s) {
                        *largest = Some((name, size));
                    }
                }
            }
        }
    }

    visit_dir(dir, &exclude, &mut largest);
    largest.map(|(name, _)| name)
}

// ─── Launch ────────────────────────────────────────────────────────────

/// Result of a Debrid game launch attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridLaunchResult {
    /// Whether the game was successfully dispatched.
    pub success: bool,
    /// Launch method used: `"direct-executable"`.
    pub method: String,
    /// Non-null when launch failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// PID of the spawned process when launch succeeded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
}

/// Launch an installed Debrid game by running its executable directly.
///
/// Debrid games are installed locally to `games/debrid/<providerGameId>/`,
/// so no protocol launcher is needed — just `Command::new(executable_path)`.
#[tauri::command]
pub fn launch_debrid_game(
    executable_path: String,
    launch_arguments: Option<String>,
    working_directory: Option<String>,
) -> Result<DebridLaunchResult, String> {
    if executable_path.trim().is_empty() {
        return Err("Debrid launch failed: executable path is empty".to_string());
    }

    let trimmed = executable_path.trim().trim_matches(|c| c == '"' || c == '\'');
    if trimmed.is_empty() {
        return Err("Debrid launch failed: executable path is empty".to_string());
    }

    let mut args = Vec::new();
    if let Some(args_str) = launch_arguments {
        if !args_str.is_empty() {
            for arg in args_str.split_whitespace() {
                if !arg.is_empty() {
                    args.push(arg.to_string());
                }
            }
        }
    }

    let args_opt: Option<&[String]> = if args.is_empty() { None } else { Some(&args) };

    match spawn_game_with_elevation_fallback(trimmed, working_directory.as_deref(), args_opt) {
        Ok(pid) => Ok(DebridLaunchResult {
            success: true,
            method: "direct-executable".to_string(),
            error: None,
            pid: Some(pid),
        }),
        Err(e) => Err(format!("Failed to launch Debrid game executable: {}", e)),
    }
}

/// Extract a file name from a URI (the last path segment before query string).
fn extract_filename_from_uri(uri: &str) -> Option<String> {
    let without_query = uri.split('?').next()?;
    let path = Path::new(without_query);
    path.file_name()?.to_str().map(|s| s.to_string())
}

/// Return a short clean download filename.
///
/// Gofile.io download links produce 200+ character tokens with no extension.
/// This helper replaces those with a short fixed name so we don't hit Windows
/// MAX_PATH issues or confuse the user.
fn clean_download_filename(raw: Option<String>) -> String {
    const MAX_LEN: usize = 50;

    match raw {
        Some(ref name) if !name.is_empty() && name.len() <= MAX_LEN && has_file_extension(name) => {
            name.clone()
        }
        _ => "repack".to_string(),
    }
}

/// Ensures the file at `path` has the given `.ext` extension.
///
/// If the file already has some other extension (or none), it is renamed to
/// include `ext`. This is cosmetic but helps external tools like 7-Zip detect
/// the format when the user opens the folder.
fn ensure_archive_extension(path: &Path, ext: &str) -> PathBuf {
    let current = path.to_string_lossy().to_string();
    if current.ends_with(ext) {
        return path.to_path_buf();
    }
    let new_path = path.with_file_name(
        // Strip any existing extension before adding the new one
        match path.file_stem() {
            Some(stem) => format!("{}{}", stem.to_string_lossy(), ext),
            None => format!("repack{}", ext),
        },
    );
    let _ = fs::rename(path, &new_path);
    println!(
        "[DEBRID][RENAME] {} → {}",
        path.display(),
        new_path.display()
    );
    new_path
}

/// Does the filename have an extension after the last dot (and the dot isn't at position 0)?
fn has_file_extension(name: &str) -> bool {
    if let Some(dot) = name.rfind('.') {
        dot > 0 && dot < name.len() - 1
    } else {
        false
    }
}

/// Result from a registry scan match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryMatch {
    pub install_location: String,
    pub display_icon: Option<String>,
    pub display_name: Option<String>,
    pub confidence: f64,
}

/// Scan Windows Uninstall registry for a game matching the given title.
/// Checks both 64-bit and 32-bit (WOW6432Node) registry paths.
/// Returns the best match by confidence, or None if no match found.
#[tauri::command]
pub fn detect_install_path_from_registry(game_title: String) -> Result<Option<RegistryMatch>, String> {
    let candidates = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    let title_lower = game_title.to_lowercase();
    let mut best: Option<RegistryMatch> = None;

    for path in &candidates {
        let root = match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(*path, KEY_READ) {
            Ok(k) => k,
            Err(_) => continue,
        };

        for name in root.enum_keys().filter_map(|r| r.ok()) {
            let subkey = match root.open_subkey_with_flags(&name, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };

            let display_name: Option<String> = subkey.get_value("DisplayName").ok();
            let install_location: Option<String> = subkey.get_value("InstallLocation").ok();
            let display_icon: Option<String> = subkey.get_value("DisplayIcon").ok();

            // Skip entries without a DisplayName
            let Some(ref dn) = display_name else {
                continue;
            };

            let dn_lower = dn.to_lowercase();

            // Fuzzy match: check if game title contains display name OR vice versa
            if !dn_lower.contains(&title_lower) && !title_lower.contains(&dn_lower) {
                continue;
            }

            // Prefer matches that have both InstallLocation and DisplayIcon
            let has_location = install_location.is_some();
            let has_icon = display_icon.is_some();

            // Calculate confidence: display-name-length overlap + location + icon
            let len_overlap = title_lower.len().min(dn_lower.len()) as f64 / title_lower.len().max(dn_lower.len()) as f64;
            let mut confidence = len_overlap;
            if has_location {
                confidence += 0.3;
            }
            if has_icon {
                confidence += 0.1;
            }

            // Only keep the best match
            let should_replace = match &best {
                Some(b) => confidence > b.confidence,
                None => true,
            };

            if should_replace {
                best = Some(RegistryMatch {
                    install_location: install_location.unwrap_or_default(),
                    display_icon,
                    display_name,
                    confidence,
                });
            }
        }
    }

    Ok(best)
}
