use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
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
    /// RAR archive (RAR4: Rar!\x1a\x07\x00, RAR5: Rar!\x1a\x07\x01\x00 header)
    Rar,
    /// ZIP archive (PK\x03\x04 header)
    Zip,
    /// FreeArc archive (`ArC\x01` magic)
    Arc,
    /// Unknown type � first 8 bytes as hex string
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

    // RAR archive (RAR4: `Rar!\x1a\x07\x00`, RAR5: `Rar!\x1a\x07\x01\x00`)
    if buf[0] == 0x52 && buf[1] == 0x61 && buf[2] == 0x72 && buf[3] == 0x21
        && buf[4] == 0x1A && buf[5] == 0x07
        && (buf[6] == 0x00 || buf[6] == 0x01)
    {
        return DetectedFileType::Rar;
    }

    // ZIP archive
    if buf[0] == 0x50 && buf[1] == 0x4B && buf[2] == 0x03 && buf[3] == 0x04 {
        return DetectedFileType::Zip;
    }

    // FreeArc archive (`ArC\x01`)
    if buf[0] == 0x41 && buf[1] == 0x72 && buf[2] == 0x43 && buf[3] == 0x01 {
        return DetectedFileType::Arc;
    }

    // Unknown � hex preview
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
    println!("[DEBRID][INSTALL] Renamed {} ? {}", path.display(), new_path.display());
    Ok(new_path)
}

/// User-Agent matched to the `X-Website-Token` hash inputs (Chrome 124 + en-US).
const GOFILE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Known website-token salts. `9844d94d963d30` is the current salt (byte-verified
/// against the live `wt.obf.js`); the second is a gallery-dl fallback in case it rotates.
const GOFILE_SALTS: &[&str] = &["9844d94d963d30", "5d4f7g8sd45fsd"];

/// Website-token time window (4h) � `floor(unix_time / window)`.
const GOFILE_WINDOW_SECS: u64 = 14_400;

/// Guest session token cache (4h TTL). Refresh on 401 / `error-token`.
fn gofile_token_cache() -> &'static Mutex<Option<(String, Instant)>> {
    static CACHE: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Compute the gofile website token: `sha256("{ua}::en-US::{token}::{window}::{salt}")`.
fn gofile_website_token(token: &str, salt: &str, ua: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    gofile_website_token_for_window(token, salt, ua, now / GOFILE_WINDOW_SECS)
}

/// Pure core of `gofile_website_token` with the 4h window injected, so the exact
/// formula can be locked down by a deterministic regression test.
fn gofile_website_token_for_window(token: &str, salt: &str, ua: &str, window: u64) -> String {
    let input = format!("{}::en-US::{}::{}::{}", ua, token, window, salt);
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Create a free guest account and return its token. No email/password required.
async fn gofile_create_guest_token(client: &reqwest::Client) -> Result<String, String> {
    let resp = client
        .post("https://api.gofile.io/accounts")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "application/json")
        .body(r#"{"email":null,"pass":null}"#)
        .send()
        .await
        .map_err(|e| format!("Gofile guest account request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Gofile guest account HTTP {}",
            resp.status().as_u16()
        ));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gofile guest account parse error: {}", e))?;

    let token = body["data"]["token"]
        .as_str()
        .ok_or_else(|| "Gofile guest account response has no token".to_string())?
        .to_string();

    println!("[DEBRID][GOFILE] Guest token acquired (tier={})", body["data"]["tier"].as_str().unwrap_or("?"));
    Ok(token)
}

/// Return a usable gofile bearer token: `GOFILE_TOKEN` env override if set, else a
/// cached guest token (refreshed when the cache is empty or expired).
async fn gofile_bearer_token(client: &reqwest::Client) -> Result<String, String> {
    if let Ok(env_tok) = std::env::var("GOFILE_TOKEN") {
        let t = env_tok.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }

    {
        let cache = gofile_token_cache().lock().unwrap();
        if let Some((token, created)) = cache.as_ref() {
            if created.elapsed() < std::time::Duration::from_secs(4 * 60 * 60) {
                return Ok(token.clone());
            }
        }
    }

    let token = gofile_create_guest_token(client).await?;
    *gofile_token_cache().lock().unwrap() = Some((token.clone(), Instant::now()));
    Ok(token)
}

/// Result of gofile resolution: the direct download URL plus the bearer token the
/// download step must send (gofile CDN links return 302 ? HTML without it).
#[derive(Debug, Clone)]
struct GofileResolved {
    url: String,
    bearer: Option<String>,
}

/// Fetch `https://api.gofile.io/contents/{content_id}` with the website-token
/// headers for a given salt. Returns the parsed JSON body.
async fn gofile_get_contents(
    client: &reqwest::Client,
    token: &str,
    salt: &str,
    content_id: &str,
) -> Result<serde_json::Value, String> {
    let wt = gofile_website_token(token, salt, GOFILE_UA);
    let contents_url = format!("https://api.gofile.io/contents/{}", content_id);

    let resp = client
        .get(&contents_url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
        .header("X-Website-Token", wt)
        .header("X-BL", "en-US")
        .send()
        .await
        .map_err(|e| format!("Gofile contents fetch failed: {}", e))?;

    let status = resp.status().as_u16();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Gofile contents parse error: {}", e))?;

    if status != 200 {
        let hint = match status {
            401 => "unauthorized (bad token or rotated website-token salt)".to_string(),
            403 => "forbidden (token lacks permission)".to_string(),
            404 => "content not found or expired".to_string(),
            429 => "rate limited".to_string(),
            _ => body["message"].as_str().unwrap_or("unknown error").to_string(),
        };
        return Err(format!(
            "Gofile contents HTTP {} for content '{}': {}",
            status, content_id, hint
        ));
    }

    Ok(body)
}

/// Attempt to resolve a gofile URL (`gofile.io` / `gofile.my`) to a direct link.
///
/// Uses the official `.io` API (`https://api.gofile.io/contents/{id}`) with a guest
/// account token and the obfuscated website-token header. The bearer token is also
/// returned because gofile CDN links require it on download (302 ? HTML otherwise).
/// Handles both page URLs (`/d/{contentId}`) and direct download URLs (returned
/// unchanged, but still carrying the bearer token).
async fn resolve_gofile_url(gofile_url: &str) -> Result<GofileResolved, String> {
    let client = reqwest::Client::builder()
        .user_agent(GOFILE_UA)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Gofile HTTP client error: {}", e))?;

    let token = gofile_bearer_token(&client).await?;

    if gofile_url.to_lowercase().contains("/d/") {
        // Page URL: extract contentId and resolve via the `.io` contents API.
        let content_id = gofile_url
            .trim_end_matches('/')
            .split('/')
            .last()
            .ok_or_else(|| format!("Bad gofile URL: {}", gofile_url))?
            .to_string();

        let mut body = None;
        let mut last_err: Option<String> = None;

        // Try each known salt (handles future salt rotation); on 401 refresh the
        // guest token once and retry before giving up.
        for (idx, salt) in GOFILE_SALTS.iter().enumerate() {
            match gofile_get_contents(&client, &token, salt, &content_id).await {
                Ok(b) => {
                    body = Some(b);
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                    if idx == 0 {
                        // 401 ? likely expired cached token. Refresh once and retry.
                        let refreshed = gofile_create_guest_token(&client).await.ok();
                        if let Some(rt) = refreshed {
                            *gofile_token_cache().lock().unwrap() = Some((rt.clone(), Instant::now()));
                            if let Ok(b) =
                                gofile_get_contents(&client, &rt, salt, &content_id).await
                            {
                                body = Some(b);
                                break;
                            }
                        }
                    }
                }
            }
        }

        let c_body = body.ok_or_else(|| {
            last_err.unwrap_or_else(|| "Gofile contents resolution failed".to_string())
        })?;

        // `.io` returns `data.children` as an OBJECT map; legacy clients used an
        // array (`data.childs`). Support both, taking the first child's link.
        let link = c_body["data"]["children"]
            .as_object()
            .and_then(|map| map.values().next())
            .and_then(|c| c["link"].as_str())
            .or_else(|| {
                c_body["data"]["childs"]
                    .as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|c| c["link"].as_str())
            })
            .ok_or_else(|| "No children in gofile contents".to_string())?
            .to_string();

        println!("[DEBRID][GOFILE] Resolved page URL to direct link via .io API");
        Ok(GofileResolved {
            url: link,
            bearer: Some(token),
        })
    } else {
        // Direct download URL or other format: return unchanged, but still carry the
        // bearer token (the CDN download requires it).
        println!("[DEBRID][GOFILE] Direct URL returned unchanged (with bearer)");
        Ok(GofileResolved {
            url: gofile_url.to_string(),
            bearer: Some(token),
        })
    }
}

// -- Cancellation tracker --

/// Module-level set of cancelled job IDs. Any in-flight `download_file_to_dest`
/// for a cancelled job_id will abort its HTTP stream, clean up, and return an error.
fn cancelled_jobs() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

pub(crate) fn is_job_cancelled(job_id: &str) -> bool {
    cancelled_jobs().lock().unwrap().contains(job_id)
}

/// Mark a download job as cancelled so the in-flight HTTP stream stops.
#[tauri::command]
pub fn cancel_debrid_download(job_id: String) -> Result<(), String> {
    cancelled_jobs().lock().unwrap().insert(job_id.clone());
    println!("[DEBRID][CANCEL] Download cancelled: {}", job_id);
    Ok(())
}

// -- Pause tracker --

/// Module-level set of paused job IDs. Any in-flight `download_file_to_dest` or
/// torrent poll loop for a paused job_id will checkpoint its progress, pause the
/// engine, and return a `paused` result instead of an error. The partial data is
/// preserved so a later resume reuses it.
fn paused_jobs() -> &'static Mutex<HashSet<String>> {
    static PAUSED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    PAUSED.get_or_init(|| Mutex::new(HashSet::new()))
}

pub(crate) fn is_job_paused(job_id: &str) -> bool {
    paused_jobs().lock().unwrap().contains(job_id)
}

/// Mark a download job as paused so the in-flight download stops cleanly.
#[tauri::command]
pub fn pause_debrid_download(job_id: String) -> Result<(), String> {
    paused_jobs().lock().unwrap().insert(job_id.clone());
    println!("[DEBRID][PAUSE] Download paused: {}", job_id);
    Ok(())
}

/// Clear both cancel + pause flags for a job id. Called at the start of a fresh
/// `download_debrid_package` / `start_torrent_download` so a re-invocation of the
/// same job id (resume/retry after cancel) is never aborted by a stale flag.
pub(crate) fn clear_job_flags(job_id: &str) {
    cancelled_jobs().lock().unwrap().remove(job_id);
    paused_jobs().lock().unwrap().remove(job_id);
}

// -- Download command: download + extract (ZIP/RAR) or just save (EXE/SFX) --

/// Download a Debrid repack: download file, extract if archive, return result.
///
/// Returns:
///   - status="ready" + executablePath � game is ready to play (ZIP extracted, .exe found)
///   - status="ready" � game executable found after extraction/installer auto-run
#[tauri::command]
pub async fn download_debrid_package(
    app_handle: AppHandle,
    job_id: String,
    download_uri: String,
    dest_dir: String,
    download_name: Option<String>,
    auto_extract: bool,
    delete_archive: bool,
    source_key: Option<String>,
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

    // Fresh attempt � clear any stale cancel/pause flags for this job id so a
    // resume after a prior cancel/pause is never aborted immediately.
    clear_job_flags(&job_id);

    let dest_path = PathBuf::from(&dest_dir);

    // -- Resolve gofile URL (gofile.io / gofile.my) to a direct download link --
    let is_gofile = {
        let lower = download_uri.to_lowercase();
        lower.contains("gofile.io") || lower.contains("gofile.my")
    };
    let (effective_uri, gofile_bearer) = if is_gofile {
        println!(
            "[DEBRID][GOFILE] Resolving gofile URL: {}",
            &download_uri[..download_uri.len().min(80)]
        );
        let resolved = resolve_gofile_url(&download_uri).await?;
        (resolved.url, resolved.bearer)
    } else {
        (download_uri.clone(), None)
    };

    // -- Checkpoint identity --
    // The checkpoint is keyed on the STABLE source URL (the page/magnet URL the
    // user started from, or the direct URL), NOT the volatile resolved CDN link.
    // Gofile URLs re-resolve to a fresh CDN link on every call; keying on that
    // would invalidate the `.part`/`.part.meta` on every resume and restart the
    // download from byte 0. `source_key` arrives from the frontend as the job's
    // original `downloadUrl`; fall back to the incoming `download_uri` when absent.
    let checkpoint_key = source_key.unwrap_or_else(|| download_uri.clone());

    // -- Step 0: Short-circuit if already extracted (Bug 3 fix) --
    // If dest_dir already has a usable installer or game exe from a previous
    // successful extraction, skip download+extract entirely. BUT only when the
    // install is not mid-flight: leftover `.part`/`.part.meta` (or any content
    // in `tmp/`) means a previous download never finished � short-circuiting
    // would auto-run setup on partial/corrupt files. In that case fall through
    // to the full download+extract pipeline.
    if has_partial_install_artifacts(&dest_path) {
        println!(
            "[DEBRID][SHORTCIRCUIT_SKIP] Partial install artifacts present � running full download/extract: {}",
            dest_path.display()
        );
    } else {
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
    }

    // -- Step 1: Download --
    emit_installer_progress(
        &app_handle,
        &job_id,
        "downloading",
        5,
        0,
        0,
        &format!("Downloading: {}", effective_uri),
    );

    let downloaded = match download_file_to_dest(
        &effective_uri,
        &dest_path,
        &app_handle,
        &job_id,
        gofile_bearer.as_deref(),
        download_name.as_deref(),
        &checkpoint_key,
    )
    .await?
    {
        DownloadFileOutcome::File(f) => f,
        DownloadFileOutcome::Paused => {
            // Paused by user � return a paused result so the TS queue marks the
            // job as paused (resumable) instead of failed.
            emit_installer_progress(
                &app_handle,
                &job_id,
                "paused",
                0,
                0,
                0,
                "Download paused",
            );
            return Ok(DebridDownloadResult {
                success: false,
                status: "paused".to_string(),
                install_dir: dest_dir.clone(),
                executable_path: None,
                installer_path: None,
                installer_pid: None,
                message: "Download paused.".to_string(),
            });
        }
    };

    // -- Step 1.5: auto_extract=false � download only, keep the archive on disk --
    // The user opted to download and manually extract later. Skip all
    // extraction/installer auto-run and return status="downloaded" so the TS
    // queue marks the job done (manual extraction) without marking the game
    // as installed.
    if !auto_extract {
        println!(
            "[DEBRID][DOWNLOAD] auto_extract=false � saved archive only: {}",
            downloaded.path.display()
        );
        emit_installer_progress(
            &app_handle,
            &job_id,
            "done",
            100,
            downloaded.bytes_read,
            downloaded.total_bytes,
            "Download complete. Extract manually.",
        );
        return Ok(DebridDownloadResult {
            success: true,
            status: "downloaded".to_string(),
            install_dir: dest_dir.clone(),
            executable_path: None,
            installer_path: Some(downloaded.path.to_string_lossy().to_string()),
            installer_pid: None,
            message: "Download complete. Extract the archive manually.".to_string(),
        });
    }

    // -- Step 2: Detect actual file type via magic bytes --
    let detected = detect_file_type(&downloaded.path);
    println!("[DEBRID][DOWNLOAD] detected={:?}", detected);

    match detected {
        // -- EXE/SFX: direct executable � try to run and wait (SFX), or return ready
        DetectedFileType::Executable => {
            let exe_path = ensure_exe_extension(&downloaded.path)?;
            let exe_name_lower = exe_path.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.to_lowercase())
                .unwrap_or_default();
            let is_installer = INSTALLER_EXE_NAMES.iter().any(|n| exe_name_lower == *n);
            println!("[DEBRID][DOWNLOAD] EXE saved: {} installer={}", exe_path.display(), is_installer);

            if is_installer {
                // Download complete � auto-run the installer
                println!(
                    "[DEBRID][DOWNLOAD] Fresh download � auto-running installer: {}",
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

            // Not a known installer name � treat as game executable (direct play)
            println!("[DEBRID][DOWNLOAD] EXE is a game executable � ready to play");
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

        // -- RAR: CLI-first extraction pipeline
        //        Chain: CLI (temp+flatten+copy) ? unrar crate ? 7z CLI --
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
                    // Keep the downloaded archive on disk for retry � Bug 2 fix
                    // (do NOT fs::remove_file here � if install fails later,
                    //  retry can skip re-download since the archive is still present).
                    // Exception: if the user explicitly opted to delete the archive
                    // after a successful extraction, honor it now.
                    if delete_archive {
                        match fs::remove_file(&rar_path) {
                            Ok(_) => println!("[DEBRID][EXTRACT] Removed RAR after extraction: {}", rar_path.display()),
                            Err(e) => println!("[DEBRID][EXTRACT] Failed to remove RAR {}: {}", rar_path.display(), e),
                        }
                    }

                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "scanning",
                        90,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "Looking for game executable\u{2026}",
                    );

                    // Priority 1: installer/repack-utility files exist ? auto-run installer
                    let installer_path = find_installer_exe_recursive(&dest_path);
                    if let Some(installer_path) = installer_path {
                        println!("[DEBRID][DOWNLOAD] RAR extracted � auto-running installer: {}", installer_path.display());

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

                    // Priority 2: no installer ? look for a real game executable (plug-and-play)
                    let game_exe = find_largest_exe_in_dir(&dest_path);
                    if let Some(exe_name) = game_exe {
                        let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
                        println!("[DEBRID][DOWNLOAD] RAR extracted � game executable found: {}", exe_path);

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

                    // Extracted but no installer or game exe found � still success, files on disk.
                    // If a repack utility (quicksfv/verify) is present, guide the user to run the
                    // repack's own setup manually instead of auto-running the checksum tool.
                    let has_util = has_repack_utility(&dest_path);
                    let msg = if has_util {
                        "Extraction complete. Open the folder and run the repack's setup.exe manually."
                            .to_string()
                    } else {
                        "Extraction complete. Open folder to find the game executable.".to_string()
                    };
                    println!(
                        "[DEBRID][DOWNLOAD] RAR extracted but no installer or game exe found (repack_utility={})",
                        has_util
                    );
                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "done",
                        100,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        &msg,
                    );
                    Ok(DebridDownloadResult {
                        success: true,
                        status: "ready".to_string(),
                        install_dir: dest_dir.clone(),
                        executable_path: None,
                        installer_path: None,
                        installer_pid: None,
                        message: msg,
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

        // -- FreeArc (.arc): extract via 7-Zip CLI (generic `7z x`) --
        DetectedFileType::Arc => {
            emit_installer_progress(
                &app_handle,
                &job_id,
                "extracting",
                50,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Extracting FreeArc archive\u{2026}",
            );

            match extract_rar_via_7z(&downloaded.path, &dest_path) {
                Ok(()) => {
                    if delete_archive {
                        match fs::remove_file(&downloaded.path) {
                            Ok(_) => println!("[DEBRID][EXTRACT] Removed ARC after extraction: {}", downloaded.path.display()),
                            Err(e) => println!("[DEBRID][EXTRACT] Failed to remove ARC {}: {}", downloaded.path.display(), e),
                        }
                    }

                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "scanning",
                        90,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "Looking for game executable\u{2026}",
                    );

                    // Priority 1: installer/repack-utility files exist ? auto-run installer
                    let installer_path = find_installer_exe_recursive(&dest_path);
                    if let Some(installer_path) = installer_path {
                        println!("[DEBRID][DOWNLOAD] ARC extracted � auto-running installer: {}", installer_path.display());

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

                    // Priority 2: no installer ? look for a real game executable
                    let game_exe = find_largest_exe_in_dir(&dest_path);
                    if let Some(exe_name) = game_exe {
                        let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
                        println!("[DEBRID][DOWNLOAD] ARC extracted � game executable found: {}", exe_path);

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

                    Ok(DebridDownloadResult {
                        success: true,
                        status: "needs-setup".to_string(),
                        install_dir: dest_dir.clone(),
                        executable_path: None,
                        installer_path: None,
                        installer_pid: None,
                        message: "Extraction complete. No game executable found automatically.".to_string(),
                    })
                }
                Err(e) => {
                    println!("[DEBRID][DOWNLOAD] 7-Zip extraction of ARC failed: {}", e);
                    emit_installer_progress(
                        &app_handle,
                        &job_id,
                        "done",
                        100,
                        downloaded.bytes_read,
                        downloaded.total_bytes,
                        "ARC extraction failed. Install 7-Zip or extract manually.",
                    );

                    Err(format!(
                        "FArc archive saved but could not extract automatically. \
                         Install 7-Zip (https://7-zip.org) and extract manually. ({})", e
                    ))
                }
            }
        }

        // -- ZIP: extract using the zip crate (entry-by-entry streaming) --
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

            // Keep the downloaded archive on disk for retry � Bug 2 fix
            // (do NOT fs::remove_file here � if install fails later,
            //  retry can skip re-download since the archive is still present).
            // Exception: if the user explicitly opted to delete the archive
            // after a successful extraction, honor it now.
            if delete_archive {
                match fs::remove_file(&downloaded.path) {
                    Ok(_) => println!("[DEBRID][EXTRACT] Removed ZIP after extraction: {}", downloaded.path.display()),
                    Err(e) => println!("[DEBRID][EXTRACT] Failed to remove ZIP {}: {}", downloaded.path.display(), e),
                }
            }

            emit_installer_progress(
                &app_handle,
                &job_id,
                "scanning",
                90,
                downloaded.bytes_read,
                downloaded.total_bytes,
                "Looking for game executable\u{2026}",
            );

            // Priority 1: installer/repack-utility files exist ? auto-run installer
            let installer_path = find_installer_exe_recursive(&dest_path);
            if let Some(installer_path) = installer_path {
                println!("[DEBRID][DOWNLOAD] ZIP extracted � auto-running installer: {}", installer_path.display());

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

            // Priority 2: no installer ? look for a real game executable (plug-and-play)
            let game_exe = find_largest_exe_in_dir(&dest_path);
            if let Some(exe_name) = game_exe {
                let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
                println!("[DEBRID][DOWNLOAD] ZIP extracted � game executable found: {}", exe_path);

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

            // Nothing found � still success, files on disk
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

// -- Setup command: run the already-extracted installer, no download --

/// Run a previously-downloaded repack installer (setup.exe) in detached mode.
///
/// Unlike `download_debrid_package`, this command does NOT download or extract
/// anything � it assumes the installer is already on disk from a prior
/// `download_debrid_package` call that returned `status="needs-setup"`.
/// Returns `status="installing"` with `installer_pid` � TS must poll
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
            println!("[DEBRID][SETUP] Installer PID={} � TS will poll", pid);
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

// -- Spawn installer, WAIT for it to close, then scan for game .exe --

/// Run an installer executable in the foreground and wait for it to complete,
/// then scan the destination directory for the game executable.
///
/// Called from `setup_debrid_game` � the user sees the installer GUI,
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

            println!("[DEBRID][INSTALL] Elevation required � retrying via PowerShell RunAs");
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
    println!("[DEBRID][INSTALL] Setup.exe spawned PID={} � waiting for exit", pid);

    let exit_status = child
        .wait()
        .map_err(|e| format!("Failed to wait for installer: {}", e))?;

    println!(
        "[DEBRID][INSTALL] Setup.exe exited with status={:?} � scanning for game .exe",
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
pub(crate) fn auto_run_installer(
    installer_path: &Path,
    dest_dir: &str,
) -> DebridDownloadResult {
    // Deterministic guard: never spawn the installer while a download is still
    // in flight. `has_partial_install_artifacts` reports a non-empty `tmp/`
    // directory (an in-progress `.part` file). The download removes `tmp/` on
    // completion, so a legitimately-finished set always passes, and the race
    // that previously let setup.exe run before the volumes finished is closed
    // without a timer.
    if has_partial_install_artifacts(Path::new(dest_dir)) {
        println!(
            "[DEBRID][AUTO_INSTALL] SKIP: download still in flight (partial artifacts present) - not spawning {}",
            installer_path.display()
        );
        return DebridDownloadResult {
            success: true,
            status: "needs-setup".to_string(),
            install_dir: dest_dir.to_string(),
            executable_path: None,
            installer_path: Some(installer_path.to_string_lossy().to_string()),
            installer_pid: None,
            message:
                "Download still in progress - setup will not run until all parts are on disk. Click Install Now to retry."
                    .to_string(),
        };
    }

    println!(
        "[DEBRID][AUTO_INSTALL] Spawning installer detached: {}",
        installer_path.display()
    );

    match spawn_installer_detached(installer_path) {
        Ok(pid) => {
            println!("[DEBRID][AUTO_INSTALL] Installer PID={} � tracking in TS", pid);
            DebridDownloadResult {
                success: true,
                status: "installing".to_string(),
                install_dir: dest_dir.to_string(),
                executable_path: None,
                installer_path: Some(installer_path.to_string_lossy().to_string()),
                installer_pid: Some(pid),
                message: format!("Installer started (PID {}) � tracking progress", pid),
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

// -- Detached spawn + polling helpers --

/// Spawn an installer in detached mode (no wait, process outlives Rust).
///
/// - Tries normal spawn first
/// - Falls back to PowerShell `Start-Process -Verb RunAs` for elevation (error 740)
/// - Returns the PID of the spawned process
fn spawn_installer_detached(installer_path: &Path) -> Result<u32, String> {
    if !installer_path.exists() {
        return Err(format!("Installer not found: {}", installer_path.display()));
    }

    // Many repack installers (setup.exe + `.bin` volumes) resolve their data
    // files and write output relative to their own working directory. Without
    // `current_dir` the process inherits this app's CWD, which may not contain
    // the `.bin` parts ? silent partial installs. Always anchor to the
    // installer's own folder.
    let work_dir = installer_path.parent().unwrap_or_else(|| Path::new("."));
    let work_dir_str = work_dir.to_string_lossy();

    println!(
        "[DEBRID][INSTALL] Detached spawn: {} (cwd={})",
        installer_path.display(),
        work_dir_str
    );

    match std::process::Command::new(installer_path)
        .current_dir(work_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            // Detach � let the process outlive our command
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
            println!("[DEBRID][INSTALL] Elevation required � PowerShell RunAs (detached)");
            let safe_path = installer_path.to_string_lossy().replace('\'', "''");
            let safe_work_dir = work_dir_str.replace('\'', "''");
            let output = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-Command",
                    &format!(
                        "Start-Process -FilePath '{}' -WorkingDirectory '{}' -Verb RunAs -PassThru | Select-Object -ExpandProperty Id",
                        safe_path, safe_work_dir
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
/// When the installer is still running ? `status: "running"`.
/// When the installer has exited:
///   - Game .exe found on disk ? `status: "ready"` + `executable_path`
///   - No .exe found ? `status: "needs-path"` (modal will ask user)
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

    // Process has exited � scan for game executable
    println!("[DEBRID][POLL] PID={} has exited � scanning for game .exe", pid);

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
            println!("[DEBRID][POLL] No game executable found � needs-path");
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

// -- Verify command: check if game .exe exists in install dir --

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

// -- Internal helpers --

struct DownloadedFile {
    path: PathBuf,
    bytes_read: u64,
    total_bytes: u64,
}

/// Result of a download attempt. A `Paused` outcome preserves the partial file
/// + checkpoint on disk so a later resume reuses the same `.part`.
enum DownloadFileOutcome {
    File(DownloadedFile),
    Paused,
}

/// Checkpoint describing an in-progress (possibly resumable) download.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct DownloadCheckpoint {
    uri: String,
    total_bytes: u64,
    downloaded_bytes: u64,
    started_at: u64,
}

/// How to proceed given a leftover partial download and the server's response.
#[derive(Debug, Clone, Copy, PartialEq)]
enum ResumeDecision {
    /// Append from the given byte offset (server answered 206 Partial Content).
    ResumeFrom(u64),
    /// Discard the partial file and start from byte 0.
    FreshStart,
    /// The server confirms the partial already covers the whole file � rename to final.
    AlreadyComplete,
}

fn part_path(tmp_dir: &Path, file_name: &str) -> PathBuf {
    tmp_dir.join(format!("{}.part", file_name))
}

fn meta_path(tmp_dir: &Path, file_name: &str) -> PathBuf {
    tmp_dir.join(format!("{}.part.meta", file_name))
}

/// True when `dest_dir` holds leftover artifacts of an interrupted install:
/// any content in `tmp/` (`.part`, `.part.meta`, or a transient `.meta.tmp`)
/// means a previous download started but never completed. When present, Step 0
/// must NOT short-circuit to "already extracted" — the on-disk installer/game
/// exe may be partial or corrupt, and auto-running setup would silently break.
/// The normal completion path removes `tmp/`, so a non-empty `tmp/` is exactly
/// the "in-flight or interrupted" signal.
fn has_partial_install_artifacts(dest_dir: &Path) -> bool {
    let tmp_dir = dest_dir.join("tmp");
    if !tmp_dir.exists() {
        return false;
    }
    match fs::read_dir(&tmp_dir) {
        Ok(mut entries) => entries.next().is_some(),
        Err(_) => false,
    }
}

/// Load the resume offset for a download, if any.
///
/// Returns `None` when there is no usable checkpoint (missing/mismatched meta,
/// missing or empty part file). A stale/incompatible checkpoint is removed so a
/// later attempt starts clean.
fn load_checkpoint(tmp_dir: &Path, file_name: &str, uri: &str) -> Option<u64> {
    let part = part_path(tmp_dir, file_name);
    let meta = meta_path(tmp_dir, file_name);

    if !part.exists() {
        // Stale meta without a part � nothing to resume.
        let _ = fs::remove_file(&meta);
        return None;
    }

    let part_len = fs::metadata(&part).ok().map(|m| m.len()).unwrap_or(0);
    if part_len == 0 {
        // Empty partial carries no value; start over.
        let _ = fs::remove_file(&part);
        let _ = fs::remove_file(&meta);
        return None;
    }

    if !meta.exists() {
        // Part without meta � can't verify the source; start over.
        let _ = fs::remove_file(&part);
        return None;
    }

    let meta_str = match fs::read_to_string(&meta) {
        Ok(s) => s,
        Err(_) => {
            let _ = fs::remove_file(&part);
            let _ = fs::remove_file(&meta);
            return None;
        }
    };
    let cp: DownloadCheckpoint = match serde_json::from_str(&meta_str) {
        Ok(cp) => cp,
        Err(_) => {
            // Corrupt meta � can't trust the partial.
            let _ = fs::remove_file(&part);
            let _ = fs::remove_file(&meta);
            return None;
        }
    };
    if cp.uri != uri {
        // Different source � the partial belongs to another repack.
        let _ = fs::remove_file(&part);
        let _ = fs::remove_file(&meta);
        return None;
    }

    // The on-disk size is authoritative; the meta value is advisory.
    Some(part_len)
}

/// Write (or refresh) the checkpoint metadata for an in-progress download.
/// Written via temp file + rename so a crash never leaves a half-written meta.
fn write_checkpoint(tmp_dir: &Path, file_name: &str, uri: &str, downloaded: u64, total: u64) {
    let cp = DownloadCheckpoint {
        uri: uri.to_string(),
        total_bytes: total,
        downloaded_bytes: downloaded,
        started_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    let tmp_meta = tmp_dir.join(format!("{}.part.meta.tmp", file_name));
    let meta = meta_path(tmp_dir, file_name);
    if let Ok(json) = serde_json::to_string(&cp) {
        if fs::write(&tmp_meta, json).is_ok() {
            let _ = fs::rename(&tmp_meta, &meta);
        }
    }
}

/// Shrink-only truncation of the partial file to exactly `bytes_read` bytes.
///
/// Called on every non-complete exit (cancel, pause, network/stream error,
/// write error). A chunk that was partially written before a failure can leave
/// the on-disk `.part` LONGER than the bytes `bytes_read` acknowledges; resuming
/// from an offset that disagrees with the checkpoint reassembles the file with a
/// gap ? corruption. Truncating (never extending) guarantees the on-disk part
/// size always matches the checkpoint metadata, so `load_checkpoint`'s
/// on-disk-size-is-authoritative resume stays consistent.
async fn truncate_part_to(file: &mut tokio::fs::File, bytes_read: u64) {
    let _ = file.flush().await;
    if let Ok(meta) = file.metadata().await {
        if meta.len() > bytes_read {
            let _ = file.set_len(bytes_read).await;
        }
    }
}

/// Decide how to proceed with a download attempt based on the local partial
/// (`resume_from`) and the server response.
fn decide_resume(resume_from: u64, status: reqwest::StatusCode, content_length: Option<u64>) -> ResumeDecision {
    if resume_from == 0 {
        return ResumeDecision::FreshStart;
    }
    match status.as_u16() {
        // Partial Content � the server honors the Range. Content-Length is the
        // *remaining* bytes (0 means we already have the whole file).
        206 => match content_length {
            Some(rem) if rem == 0 => ResumeDecision::AlreadyComplete,
            _ => ResumeDecision::ResumeFrom(resume_from),
        },
        // 416 Range Not Satisfiable with a resume offset means the local partial
        // disagrees with the server � safest to restart.
        416 => ResumeDecision::FreshStart,
        // 200 (or anything else): server ignored the Range header ? full restart.
        _ => ResumeDecision::FreshStart,
    }
}

/// Maximum number of download attempts before giving up on a transient network
/// failure (DNS, connection, timeout, mid-stream drop). Each retry resumes from
/// the on-disk checkpoint via HTTP Range.
const DOWNLOAD_MAX_ATTEMPTS: u32 = 3;

/// Backoff (ms) to wait before each retry attempt, indexed by `attempt - 1`.
/// There are only `MAX_ATTEMPTS - 1` gaps, so the last gap is the largest.
const DOWNLOAD_RETRY_BACKOFF_MS: [u64; 2] = [2_000, 5_000];

/// Backoff (ms) to wait before the next retry attempt, or `None` when no
/// attempts remain. `attempt` is 1-based (the first attempt has no backoff �
/// it just happened).
fn retry_backoff_ms(attempt: u32) -> Option<u64> {
    if attempt == 0 || attempt >= DOWNLOAD_MAX_ATTEMPTS {
        return None;
    }
    DOWNLOAD_RETRY_BACKOFF_MS.get((attempt - 1) as usize).copied()
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
    bearer: Option<&str>,
    preferred_filename: Option<&str>,
    source_key: &str,
) -> Result<DownloadFileOutcome, String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination dir: {}", e))?;

    // Use a temp sub-directory inside dest_dir so the rename is instant (same filesystem).
    let tmp_dir = dest_dir.join("tmp");
    fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create tmp dir: {}", e))?;

    // -- Bug 1 fix: Check if file already exists on disk --
    // Prefer the resolver-provided filename (preserves the real extension, e.g.
    // `setup.exe` for a FitGirl repack) over what can be derived from the CDN URL.
    // Prefer the resolver-provided filename. When it carries a nested in-archive
    // path (e.g. `MD5/checksums.md5`), PRESERVE that relative structure so
    // checksum folders keep their place instead of being flattened to the root;
    // a flat name (or the URI-derived slug) stays at the dest root via the plain
    // sanitizer.
    let (file_name, dest_path): (String, PathBuf) =
        match preferred_filename.and_then(normalize_download_relative_path) {
            Some(rel) => {
                let joined = dest_dir.join(Path::new(&rel));
                (rel, joined)
            }
            None => {
                let flat = clean_download_filename(
                    preferred_filename
                        .map(|s| s.to_string())
                        .or_else(|| extract_filename_from_uri(uri)),
                );
                let joined = dest_dir.join(&flat);
                (flat, joined)
            }
        };
    let part = part_path(&tmp_dir, &file_name);
    let meta = meta_path(&tmp_dir, &file_name);

    // A nested destination path (e.g. `dest_dir/MD5/checksums.md5`) needs its
    // parent created before the completion rename succeeds.
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dest parent dir: {}", e))?;
    }

    // Only treat an existing final file as "already downloaded" when there is no
    // in-flight partial. A leftover `.part`/`.part.meta` (preserved on cancel,
    // pause or error) means a previous attempt never finished � trusting the
    // final file would skip the download and leave corrupt data in place. When a
    // partial exists, fall through and resume it via the checkpoint below.
    if dest_path.exists() && !part.exists() && !meta.exists() {
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
            return Ok(DownloadFileOutcome::File(DownloadedFile {
                path: dest_path,
                bytes_read: file_len,
                total_bytes: file_len,
            }));
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(300))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // -- Resume support --
    // A previous attempt may have left tmp/<file>.part + tmp/<file>.part.meta
    // (preserved on cancel/error). When present, we send an HTTP Range header and
    // append, so interrupted downloads resume instead of restarting from byte 0.
    // The checkpoint is keyed on `source_key` (stable origin URL), not the volatile
    // CDN link, so a re-resolved gofile URL still resumes the same `.part`.

    // -- Transient auto-retry --
    // A brief network drop (Wi-Fi switch, momentary loss, server reset) is absorbed
    // by retrying up to DOWNLOAD_MAX_ATTEMPTS with a small backoff. Each retry
    // re-loads the on-disk checkpoint, so HTTP Range resumes from the last written
    // byte instead of restarting. Cancel/pause are authoritative and stop at once;
    // if the network is still down after all attempts the error propagates and the
    // job becomes `failed` (recoverable from the Downloads UI).
    let mut attempt: u32 = 0;
    'attempt: loop {
        attempt += 1;
        let mut resume_from = load_checkpoint(&tmp_dir, &file_name, source_key).unwrap_or(0);

        // -- Request / resume decision loop --
        // Bounded loop (max 2 iterations): send the request, react to the status.
        // A 416 on a resume attempt means our offset disagrees with the server � drop
        // the partial and retry once from zero. Everything else falls through to the
        // streaming phase below. (Async recursion is not allowed, hence the loop.)
        let (response, resume_from) = loop {
            let mut req = client.get(uri);
            if let Some(tok) = bearer {
                if !tok.is_empty() {
                    req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", tok));
                }
            }
            if resume_from > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={}-", resume_from));
                println!(
                    "[DEBRID][RESUME] Requesting resume from byte {} for {}",
                    resume_from, file_name
                );
            }

            let response = match req.send().await {
                Ok(resp) => resp,
                Err(e) => {
                    // Network-level failure (DNS, connect, timeout). Retry with backoff
                    // when attempts remain; cancel/pause abort immediately.
                    if is_job_cancelled(job_id) {
                        return Err(format!("Download request failed: {}", e));
                    }
                    if is_job_paused(job_id) {
                        return Ok(DownloadFileOutcome::Paused);
                    }
                    match retry_backoff_ms(attempt) {
                        Some(backoff) => {
                            println!(
                                "[DEBRID][RETRY] Request failed (attempt {}/{}): {} � retrying in {}ms",
                                attempt, DOWNLOAD_MAX_ATTEMPTS, e, backoff
                            );
                            tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
                            if is_job_cancelled(job_id) {
                                return Err(format!("Download request failed: {}", e));
                            }
                            if is_job_paused(job_id) {
                                return Ok(DownloadFileOutcome::Paused);
                            }
                            continue 'attempt;
                        }
                        None => return Err(format!("Download request failed: {}", e)),
                    }
                }
            };

            // Reject Content-Type text/html � this is an error page or login page, not a file.
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

            let status = response.status();
            if status.as_u16() == 416 && resume_from > 0 {
                // 416 on a resume attempt: the server doesn't know our offset.
                println!("[DEBRID][RESUME] 416 Range Not Satisfiable � restarting from zero");
                let _ = fs::remove_file(&part);
                let _ = fs::remove_file(&meta);
                resume_from = 0;
                continue;
            }
            if !status.is_success() {
                return Err(format!("Download failed with HTTP {}", status));
            }

            // Decide how to continue based on the local partial + server response.
            match decide_resume(resume_from, status, response.content_length()) {
                ResumeDecision::ResumeFrom(n) => break (response, n),
                ResumeDecision::AlreadyComplete => {
                    // Server confirms we already hold the entire file � rename part ? final.
                    println!("[DEBRID][RESUME] Server confirms partial is complete: {}", file_name);
                    drop(response);
                    let _ = fs::remove_file(&meta);
                    let final_bytes = fs::metadata(&part).ok().map(|m| m.len()).unwrap_or(0);
                    fs::rename(&part, &dest_path)
                        .map_err(|e| format!("Failed to move downloaded file: {}", e))?;
                    let _ = fs::remove_dir(&tmp_dir);
                    return Ok(DownloadFileOutcome::File(DownloadedFile {
                        path: dest_path,
                        bytes_read: final_bytes,
                        total_bytes: final_bytes,
                    }));
                }
                ResumeDecision::FreshStart => {
                    if resume_from > 0 {
                        println!("[DEBRID][RESUME] Server ignored Range � restarting from zero");
                    }
                    let _ = fs::remove_file(&part);
                    let _ = fs::remove_file(&meta);
                    break (response, 0);
                }
            }
        };

        // On a 206 response, Content-Length is the *remaining* bytes.
        let server_total = response.content_length().unwrap_or(0);
        let mut total_bytes = if resume_from > 0 {
            resume_from + server_total
        } else {
            server_total
        };
        if total_bytes < resume_from {
            total_bytes = resume_from;
        }

        // Check disk space for the remaining bytes before downloading anything more.
        let remaining = total_bytes.saturating_sub(resume_from);
        check_disk_space(dest_dir, remaining)?;

        // Defense-in-depth: make sure the partial's parent directory exists before
        // opening it. `file_name` is already sanitized to a single component via
        // `clean_download_filename`, but a residual nested name (e.g. from a stale
        // checkpoint) must never surface as a silent `os error 3` mid-download.
        if let Some(parent) = part.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create part dir: {}", e))?;
        }

        // Open the partial in append mode when resuming, else create fresh.
        let mut file = if resume_from > 0 {
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&part)
                .await
                .map_err(|e| format!("Failed to open partial file for resume: {}", e))?
        } else {
            tokio::fs::File::create(&part)
                .await
                .map_err(|e| format!("Failed to create file: {}", e))?
        };

        // -- Stream the response body chunk-by-chunk --
        // Each chunk is written to disk immediately (async, non-blocking).
        // No part of the file is retained in memory after writing.
        // Progress is throttled to avoid flooding Tauri IPC.
        let mut stream = response.bytes_stream();
        let mut bytes_read: u64 = resume_from;
        let mut last_progress = std::time::Instant::now();
        let progress_interval = std::time::Duration::from_millis(250);

        while let Some(chunk_result) = stream.next().await {
            // Check for cancellation on every chunk. The partial file + checkpoint are
            // PRESERVED so a later retry resumes via HTTP Range.
            if is_job_cancelled(job_id) {
                truncate_part_to(&mut file, bytes_read).await;
                write_checkpoint(&tmp_dir, &file_name, source_key, bytes_read, total_bytes);
                println!(
                    "[DEBRID][CANCEL] Download aborted by user (partial kept for resume): {} ({} bytes)",
                    file_name, bytes_read
                );
                drop(file);
                return Err("Download cancelled by user.".to_string());
            }

            // Paused on every chunk: checkpoint and stop cleanly so a resume reuses
            // the partial via HTTP Range.
            if is_job_paused(job_id) {
                truncate_part_to(&mut file, bytes_read).await;
                write_checkpoint(&tmp_dir, &file_name, source_key, bytes_read, total_bytes);
                println!(
                    "[DEBRID][PAUSE] Download paused (partial kept for resume): {} ({} bytes)",
                    file_name, bytes_read
                );
                drop(file);
                return Ok(DownloadFileOutcome::Paused);
            }

            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    // Network/stream error mid-download: keep the partial + checkpoint so
                    // a retry resumes via HTTP Range. Truncate to bytes_read first so the
                    // on-disk part size matches the checkpointed offset. Retry with
                    // backoff when attempts remain; cancel/pause abort immediately.
                    truncate_part_to(&mut file, bytes_read).await;
                    write_checkpoint(&tmp_dir, &file_name, source_key, bytes_read, total_bytes);
                    if is_job_cancelled(job_id) {
                        return Err(format!("Download stream error: {}", e));
                    }
                    if is_job_paused(job_id) {
                        drop(file);
                        return Ok(DownloadFileOutcome::Paused);
                    }
                    match retry_backoff_ms(attempt) {
                        Some(backoff) => {
                            println!(
                                "[DEBRID][RETRY] Stream error (attempt {}/{}): {} � retrying in {}ms",
                                attempt, DOWNLOAD_MAX_ATTEMPTS, e, backoff
                            );
                            drop(file);
                            tokio::time::sleep(std::time::Duration::from_millis(backoff)).await;
                            if is_job_cancelled(job_id) {
                                return Err(format!("Download stream error: {}", e));
                            }
                            if is_job_paused(job_id) {
                                return Ok(DownloadFileOutcome::Paused);
                            }
                            continue 'attempt;
                        }
                        None => return Err(format!("Download stream error: {}", e)),
                    }
                }
            };
            if let Err(e) = file.write_all(&chunk).await {
                // A partial write may have left the file longer than bytes_read �
                // truncate so the resume offset stays consistent with the checkpoint.
                truncate_part_to(&mut file, bytes_read).await;
                write_checkpoint(&tmp_dir, &file_name, source_key, bytes_read, total_bytes);
                return Err(format!("Write error during download: {}", e));
            }
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

        // Flush and close before the atomic rename (required on Windows).
        file.flush()
            .await
            .map_err(|e| format!("Failed to flush file: {}", e))?;
        drop(file);

        // Atomic rename from tmp to final destination (instant on same filesystem)
        fs::rename(&part, &dest_path)
            .map_err(|e| format!("Failed to move downloaded file: {}", e))?;
        let _ = fs::remove_file(&meta);

        // Clean up the tmp directory if empty
        let _ = fs::remove_dir(&tmp_dir);

        println!(
            "[DEBRID][DOWNLOAD] Complete: {} ({} bytes written)",
            file_name, bytes_read
        );

        return Ok(DownloadFileOutcome::File(DownloadedFile {
            path: dest_path,
            bytes_read,
            total_bytes,
        }));
    }
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
/// This is the primary extractor � no CMD window, no external dependencies.
/// If `unrar` fails (corrupt archive, unsupported feature), falls back to
/// `extract_rar_via_7z` (external process with hidden window).
pub(crate) fn extract_rar_with_unrar(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
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

/// --- Primary: CLI-based RAR extraction (temp dir + flatten + copy) ---
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
/// Check order: WinRAR ? 7-Zip ? unar (PATH only).
/// Each tool path is verified (file exists or in PATH).
fn detect_rar_extractors() -> Vec<RarCliTool> {
    let mut tools: Vec<RarCliTool> = Vec::new();

    // -- 1. UnRAR.exe (WinRAR) in Program Files --
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

    // -- 2. 7z.exe (7-Zip) in Program Files --
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

    // -- 3. unar.exe via PATH --
    if let Some(p) = find_in_path("unar.exe") {
        tools.push(RarCliTool::Unar(p));
    }

    // -- 4. Also try bare names via PATH for UnRAR and 7z --
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
pub(crate) fn extract_rar_with_cli(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
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

        // -- Flatten single-root folder --
        let source = flatten_single_root_folder(&extract_root);

        // -- Copy with rollback --
        match copy_recursive_with_rollback(&source, dest_dir) {
            Ok(copied) => {
                println!(
                    "[DEBRID][EXTRACT] {} extracted via {} ({} files, temp cleanup)",
                    rar_path.display(),
                    name,
                    copied
                );
                // temp_dir is dropped here ? auto-cleanup
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
pub(crate) fn flatten_single_root_folder(extract_root: &Path) -> PathBuf {
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

/// Extract a `.7z` archive using the pure-Rust `sevenz-rust` crate (no 7-Zip CLI needed).
pub(crate) fn extract_7z_native(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
    sevenz_rust::decompress_file(zip_path, dest_dir)
        .map_err(|e| format!("Failed to extract 7z archive: {e}"))
}

/// Fallback: extract a RAR archive via `7z.exe` (7-Zip CLI) with the CMD window hidden.
///
/// Only called when `extract_rar_with_unrar` fails.
/// Uses `CREATE_NO_WINDOW` so the console flash doesn't appear.
pub(crate) fn extract_rar_via_7z(rar_path: &Path, dest_dir: &Path) -> Result<(), String> {
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
/// then decompresses each entry via a streaming reader � memory usage stays
/// proportional to the buffer size (~64 KB), NOT the archive size.
/// This avoids the gigabytes of RAM that PowerShell `Expand-Archive` consumes.
pub(crate) fn extract_zip_with_zip_crate(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
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
/// Known repack utility executables � checksum tools, verify helpers, etc.
/// These are NOT game executables � they signal that the extracted content needs
/// manual setup installation (typically a FitGirl/DODI/ElAmigos repack).
pub(crate) const REPACK_UTILITY_EXES: &[&str] = &[
    "quicksfv.exe", "quicksfv64.exe",
    "verify.exe", "verify.bat",
    "md5.exe", "md5sums.exe",
    "sfv.exe",
];

/// Known installer executable names.
pub(crate) const INSTALLER_EXE_NAMES: &[&str] = &[
    "setup.exe", "installer.exe",
    "setup_x64.exe", "setup_x86.exe",
    "autorun.exe",
];

/// Check whether `dir` contains a real setup/installer executable (top-level).
///
/// Only returns genuine installer names (`setup.exe`, `installer.exe`, ...).
/// Repack utility executables (checksum/verify tools) are deliberately NOT
/// returned here: callers use this to decide whether to AUTO-RUN setup, and
/// spawning `quicksfv.exe` as if it were the game installer breaks installs.
/// Detect their presence separately via [`find_repack_utility_exe_in_dir`].
pub(crate) fn find_installer_exe_in_dir(dir: &Path) -> Option<String> {
    for candidate in INSTALLER_EXE_NAMES {
        let path = dir.join(candidate);
        if path.exists() && path.is_file() {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Look for a repack-utility executable (`quicksfv`, `verify`, checksum tools)
/// in a directory (top-level only). These signal the extracted content still
/// needs a manual setup installation — they are never auto-run as installers.
pub(crate) fn find_repack_utility_exe_in_dir(dir: &Path) -> Option<String> {
    for candidate in REPACK_UTILITY_EXES {
        let path = dir.join(candidate);
        if path.exists() && path.is_file() {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Whether `dir` contains a repack-utility file (checksum/verify tool).
pub(crate) fn has_repack_utility(dir: &Path) -> bool {
    find_repack_utility_exe_in_dir(dir).is_some()
}

/// Recursively find an installer/repack-utility EXE, preferring the root dir and
/// shallow folders. Honors the redistributable-directory and uninstaller/crash
/// handler exclusions so we never auto-run a `_Redist` .exe or an uninstaller.
///
/// Returns the path of the first match (deepest-first is NOT preferred � we walk
/// breadth-first so a root-level `setup.exe` wins over a nested one).
pub(crate) fn find_installer_exe_recursive(dir: &Path) -> Option<PathBuf> {
    // Prefer a direct root match first.
    if let Some(name) = find_installer_exe_in_dir(dir) {
        return Some(dir.join(name));
    }

    fn walk(dir: &Path, depth: usize) -> Option<PathBuf> {
        if depth > 12 {
            return None;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return None;
        };
        let subdirs: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                let dir_name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                !is_excluded_redist_dir(&dir_name)
            })
            .collect();

        // Check each subdir for a direct installer before descending further.
        for sub in &subdirs {
            if let Some(name) = find_installer_exe_in_dir(sub) {
                return Some(sub.join(name));
            }
        }
        for sub in &subdirs {
            if let Some(found) = walk(sub, depth + 1) {
                return Some(found);
            }
        }
        None
    }

    walk(dir, 0)
}

/// Whether a directory name is a redistributable folder we must never recurse
/// into / auto-pick the game executable from (`_Redist`, `_CommonRedist`).
pub(crate) fn is_excluded_redist_dir(dir_name: &str) -> bool {
    let lower = dir_name.to_lowercase();
    lower == "_redist" || lower == "_commonredist"
}

/// Whether an executable name is one we must never auto-pick as the game path
/// (uninstallers `unins000*` and Unity crash handlers `UnityCrashHandler64*`).
pub(crate) fn is_excluded_exe_name(exe_name: &str) -> bool {
    let lower = exe_name.to_lowercase();
    lower.starts_with("unins000") || lower.starts_with("unitycrashhandler64")
}

/// Scan a directory for the largest .exe file (excluding setup/installer/repack-utility names).
pub(crate) fn find_largest_exe_in_dir(dir: &Path) -> Option<String> {
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
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if is_excluded_redist_dir(&dir_name) {
                    continue;
                }
                visit_dir(&path, exclude, largest);
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext.to_lowercase() != "exe" {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let name_lower = name.to_lowercase();
            if exclude.contains(&name_lower.as_str()) || is_excluded_exe_name(&name_lower) {
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

// --- Launch ------------------------------------------------------------

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
/// so no protocol launcher is needed � just `Command::new(executable_path)`.
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

/// Normalize a raw filename to a safe single path component.
///
/// Debrid resolvers can return a full in-archive path (e.g. `Game Folder/Setup.exe`)
/// or a string with Windows-invalid characters. If that were joined directly onto
/// `tmp_dir`, `part_path` would build `tmp/<sub>/<file>.part` whose parent dir does
/// not exist ? `File::create` fails with `os error 3` before any byte downloads.
///
/// This keeps only the last path segment, replaces invalid/control characters,
/// trims Windows-hostile trailing dots/spaces, and falls back to `"repack"` for
/// empty/reserved/over-long names.
fn normalize_download_filename(name: &str) -> String {
    const MAX_LEN: usize = 50;
    const INVALID_CHARS: &[char] = &[
        '<', '>', ':', '"', '/', '\\', '|', '?', '*',
        '\u{0}', '\u{1}', '\u{2}', '\u{3}', '\u{4}', '\u{5}', '\u{6}', '\u{7}',
        '\u{8}', '\u{9}', '\u{A}', '\u{B}', '\u{C}', '\u{D}', '\u{E}', '\u{F}',
        '\u{10}', '\u{11}', '\u{12}', '\u{13}', '\u{14}', '\u{15}', '\u{16}', '\u{17}',
        '\u{18}', '\u{19}', '\u{1A}', '\u{1B}', '\u{1C}', '\u{1D}', '\u{1E}', '\u{1F}',
    ];

    // 1. Keep only the last path segment � never allow nested directories.
    let last = name.split(['/', '\\']).last().unwrap_or(name);

    // 2. Replace Windows-invalid and control characters with `_`.
    let mut cleaned: String = last
        .chars()
        .map(|c| if INVALID_CHARS.contains(&c) { '_' } else { c })
        .collect();

    // 3. Trim trailing dots/spaces (Windows treats these as terminators).
    while cleaned.ends_with('.') || cleaned.ends_with(' ') {
        cleaned.pop();
    }

    // 4. Reject empty / `.` / `..` / reserved device names ? fall back.
    let normalized = cleaned.to_lowercase();
    let reserved = matches!(normalized.as_str(), "con" | "nul" | "prn" | "aux")
        || normalized.starts_with("con.")
        || normalized.starts_with("lpt")
        || normalized.starts_with("com");
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." || reserved {
        return "repack".to_string();
    }

    // 5. Cap length, preserving the extension when one exists. Bare over-long
    //    tokens (e.g. gofile CDN names) fall back to `"repack"` instead of a
    //    50-char gibberish name.
    if cleaned.len() > MAX_LEN {
        if let Some(dot) = cleaned.rfind('.') {
            let ext = &cleaned[dot..];
            let stem = cleaned[..dot]
                .chars()
                .take(MAX_LEN.saturating_sub(ext.len()))
                .collect::<String>();
            cleaned = stem + ext;
        } else {
            return "repack".to_string();
        }
    }

    cleaned
}

/// Sanitize a full relative download path, PRESERVING directory structure.
///
/// Debrid providers return per-file names that may carry a nested in-archive
/// path (e.g. `MD5/checksums.md5` or `Game Folder/Setup/setup.exe`). For the
/// multivolume flow those checksum folders are meaningful: flattening them to
/// the root (as [`normalize_download_filename`] does) drops the `MD5/` folder
/// entirely and leaves its files scattered in the extract root. This keeps the
/// relative structure while sanitizing every component with the same rules as
/// the flat sanitizer (invalid chars, trailing dots/spaces, reserved names,
/// length caps) and dropping traversal components, so the result is always
/// safe to join under `dest_dir`.
///
/// Returns `None` for a flat single-component name, a leading separator/drive
/// prefix, an unsafe mid-path component, or an empty result — the caller falls
/// back to a flat path in those cases.
fn normalize_download_relative_path(name: &str) -> Option<String> {
    // A leading separator (`/abs/...`, `\\abs\\...`) is absolute — never relative
    // to dest_dir. Checked before splitting because the filter would otherwise
    // drop the empty leading segment and turn it into a relative path.
    if name.starts_with('/') || name.starts_with('\\') {
        return None;
    }

    let parts = name
        .split(['/', '\\'])
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect::<Vec<_>>();

    // A single component (or none) is a flat filename — handled by the flat path.
    if parts.len() < 2 {
        return None;
    }
    // A drive prefix (`C:/...`) is absolute — never relative to dest_dir.
    if parts[0].ends_with(':') {
        return None;
    }

    let mut sanitized: Vec<String> = Vec::with_capacity(parts.len());
    for part in &parts {
        let s = normalize_download_filename(part);
        // A genuinely unsafe component (reserved device name, over-long bare
        // token) collapses to `"repack"`; that would make a nonsense folder
        // name mid-path, so bail to the flat path instead.
        if s == "repack" && *part != "repack" {
            return None;
        }
        sanitized.push(s);
    }

    let joined = sanitized.join("/");
    if joined.is_empty() {
        return None;
    }
    Some(joined)
}

/// Return a short clean download filename.
///
/// Gofile.io download links produce 200+ character tokens with no extension;
/// Debrid resolver filenames may carry an in-archive path or invalid characters.
/// Always normalized through [`normalize_download_filename`] so we never hit
/// Windows MAX_PATH issues, nested-path `os error 3`, or confuse the user.
fn clean_download_filename(raw: Option<String>) -> String {
    match raw {
        Some(ref name) if !name.is_empty() => normalize_download_filename(name),
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
        "[DEBRID][RENAME] {} ? {}",
        path.display(),
        new_path.display()
    );
    new_path
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

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    #[test]
    fn website_token_known_vector() {
        // Independently computed (PowerShell SHA256) for:
        //   window=12345, token="testtoken", salt="9844d94d963d30", ua=TEST_UA
        //   input = "{ua}::en-US::testtoken::12345::9844d94d963d30"
        let expected =
            "26c3eb177e3027ae20796898eb3aa7f012a2529e2cb44ed28512a0f25a757aaa";
        assert_eq!(
            gofile_website_token_for_window("testtoken", "9844d94d963d30", TEST_UA, 12345),
            expected
        );
    }

    #[test]
    fn website_token_hex_format() {
        let h = gofile_website_token_for_window("abc", "9844d94d963d30", TEST_UA, 1);
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(h.chars().all(|c| !c.is_ascii_uppercase()));
    }

    #[test]
    fn website_token_deterministic() {
        let a = gofile_website_token_for_window("tok", "9844d94d963d30", TEST_UA, 7);
        let b = gofile_website_token_for_window("tok", "9844d94d963d30", TEST_UA, 7);
        assert_eq!(a, b);
    }

    #[test]
    fn website_token_salt_sensitive() {
        let a = gofile_website_token_for_window("tok", "9844d94d963d30", TEST_UA, 7);
        let b = gofile_website_token_for_window("tok", "5d4f7g8sd45fsd", TEST_UA, 7);
        assert_ne!(a, b);
    }

    #[test]
    fn website_token_window_sensitive() {
        let a = gofile_website_token_for_window("tok", "9844d94d963d30", TEST_UA, 7);
        let b = gofile_website_token_for_window("tok", "9844d94d963d30", TEST_UA, 8);
        assert_ne!(a, b);
    }

    #[test]
    fn website_token_salt_rotation_behavior() {
        // The live resolver tries salts in order; a wrong salt must not panic and
        // must differ from the correct one (so the 401 retry can be attempted).
        let cur = gofile_website_token_for_window("t", "9844d94d963d30", TEST_UA, 42);
        let rot = gofile_website_token_for_window("t", "5d4f7g8sd45fsd", TEST_UA, 42);
        assert!(!cur.is_empty());
        assert_ne!(cur, rot);
    }

    #[test]
    fn detect_rar5_signature() {
        // RAR5 magic: Rar!\x1a\x07\x01\x00 (repack files on gofile are RAR5).
        // Regression: previously only RAR4 (byte6=0x00) was matched, so RAR5
        // downloads fell through to Unknown ? "Unknown file type" error.
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.rar");
        let mut bytes = [0u8; 16];
        bytes[..8].copy_from_slice(&[0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]);
        std::fs::write(&path, bytes).unwrap();
        assert!(matches!(detect_file_type(&path), DetectedFileType::Rar));
    }

    #[test]
    fn detect_rar4_signature() {
        // RAR4 magic: Rar!\x1a\x07\x00
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.rar");
        let mut bytes = [0u8; 16];
        bytes[..8].copy_from_slice(&[0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00, 0x00]);
        std::fs::write(&path, bytes).unwrap();
        assert!(matches!(detect_file_type(&path), DetectedFileType::Rar));
    }

    #[test]
    fn detect_arc_signature() {
        // FreeArc magic: ArC\x01
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.arc");
        let mut bytes = [0u8; 16];
        bytes[..4].copy_from_slice(&[0x41, 0x72, 0x43, 0x01]);
        std::fs::write(&path, bytes).unwrap();
        assert!(matches!(detect_file_type(&path), DetectedFileType::Arc));
    }

    #[test]
    fn detect_unknown_signature() {
        // Unrelated magic bytes must still classify as Unknown.
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.bin");
        let bytes = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B];
        std::fs::write(&path, bytes).unwrap();
        assert!(matches!(detect_file_type(&path), DetectedFileType::Unknown(_)));
    }

    // -- Resume decision --

    #[test]
    fn resume_decision_no_resume_is_fresh() {
        use reqwest::StatusCode;
        assert_eq!(
            decide_resume(0, StatusCode::OK, Some(100)),
            ResumeDecision::FreshStart
        );
    }

    #[test]
    fn resume_decision_206_appends() {
        use reqwest::StatusCode;
        assert_eq!(
            decide_resume(5000, StatusCode::PARTIAL_CONTENT, Some(15000)),
            ResumeDecision::ResumeFrom(5000)
        );
    }

    #[test]
    fn resume_decision_206_without_length_appends() {
        use reqwest::StatusCode;
        assert_eq!(
            decide_resume(5000, StatusCode::PARTIAL_CONTENT, None),
            ResumeDecision::ResumeFrom(5000)
        );
    }

    #[test]
    fn resume_decision_206_zero_remaining_complete() {
        use reqwest::StatusCode;
        assert_eq!(
            decide_resume(5000, StatusCode::PARTIAL_CONTENT, Some(0)),
            ResumeDecision::AlreadyComplete
        );
    }

    #[test]
    fn resume_decision_200_restarts() {
        // Server ignored the Range header and sent the full body from byte 0.
        use reqwest::StatusCode;
        assert_eq!(
            decide_resume(5000, StatusCode::OK, Some(20000)),
            ResumeDecision::FreshStart
        );
    }

    #[test]
    fn resume_decision_416_restarts() {
        use reqwest::StatusCode;
        assert_eq!(
            decide_resume(5000, StatusCode::RANGE_NOT_SATISFIABLE, None),
            ResumeDecision::FreshStart
        );
    }

    // -- Checkpoint load --

    #[test]
    fn checkpoint_load_resumes_from_part_size() {
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        // Part file is authoritative for the offset.
        std::fs::write(part_path(tmp.path(), name), vec![0u8; 4096]).unwrap();
        let cp = DownloadCheckpoint {
            uri: "https://cdn.test/game.rar".to_string(),
            total_bytes: 100_000,
            downloaded_bytes: 4000,
            started_at: 1,
        };
        std::fs::write(
            meta_path(tmp.path(), name),
            serde_json::to_string(&cp).unwrap(),
        )
        .unwrap();
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://cdn.test/game.rar"),
            Some(4096)
        );
    }

    #[test]
    fn checkpoint_load_uri_mismatch_starts_fresh() {
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        std::fs::write(part_path(tmp.path(), name), vec![0u8; 1024]).unwrap();
        let cp = DownloadCheckpoint {
            uri: "https://cdn.test/other.rar".to_string(),
            total_bytes: 100_000,
            downloaded_bytes: 1000,
            started_at: 1,
        };
        std::fs::write(
            meta_path(tmp.path(), name),
            serde_json::to_string(&cp).unwrap(),
        )
        .unwrap();
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://cdn.test/game.rar"),
            None
        );
        // Stale files are removed so the next attempt is clean.
        assert!(!part_path(tmp.path(), name).exists());
        assert!(!meta_path(tmp.path(), name).exists());
    }

    #[test]
    fn checkpoint_load_corrupt_meta_starts_fresh() {
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        std::fs::write(part_path(tmp.path(), name), vec![0u8; 1024]).unwrap();
        std::fs::write(meta_path(tmp.path(), name), "{not json").unwrap();
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://cdn.test/game.rar"),
            None
        );
        assert!(!part_path(tmp.path(), name).exists());
    }

    #[test]
    fn checkpoint_load_meta_without_part_starts_fresh() {
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        let cp = DownloadCheckpoint {
            uri: "https://cdn.test/game.rar".to_string(),
            total_bytes: 100_000,
            downloaded_bytes: 1000,
            started_at: 1,
        };
        std::fs::write(
            meta_path(tmp.path(), name),
            serde_json::to_string(&cp).unwrap(),
        )
        .unwrap();
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://cdn.test/game.rar"),
            None
        );
        assert!(!meta_path(tmp.path(), name).exists());
    }

    #[test]
    fn checkpoint_load_empty_part_starts_fresh() {
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        std::fs::write(part_path(tmp.path(), name), b"").unwrap();
        let cp = DownloadCheckpoint {
            uri: "https://cdn.test/game.rar".to_string(),
            total_bytes: 100_000,
            downloaded_bytes: 0,
            started_at: 1,
        };
        std::fs::write(
            meta_path(tmp.path(), name),
            serde_json::to_string(&cp).unwrap(),
        )
        .unwrap();
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://cdn.test/game.rar"),
            None
        );
        assert!(!part_path(tmp.path(), name).exists());
    }

    #[test]
    fn checkpoint_write_then_load_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        std::fs::write(part_path(tmp.path(), name), vec![0u8; 8192]).unwrap();
        write_checkpoint(tmp.path(), name, "https://cdn.test/game.rar", 8192, 50_000);
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://cdn.test/game.rar"),
            Some(8192)
        );
    }

    #[test]
    fn checkpoint_load_resumes_across_cdn_rotation() {
        // Bug 1 fix: the checkpoint is keyed on the STABLE source URL (page URL),
        // so a re-resolved gofile CDN link on resume still matches and continues.
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        std::fs::write(part_path(tmp.path(), name), vec![0u8; 8192]).unwrap();
        let cp = DownloadCheckpoint {
            uri: "https://gofile.io/d/ABC123".to_string(), // stable origin key
            total_bytes: 50_000,
            downloaded_bytes: 8192,
            started_at: 1,
        };
        std::fs::write(
            meta_path(tmp.path(), name),
            serde_json::to_string(&cp).unwrap(),
        )
        .unwrap();
        // The actual download call uses the (rotated) CDN link as `uri`, but the
        // checkpoint lookup uses `source_key` — the stable page URL.
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://gofile.io/d/ABC123"),
            Some(8192)
        );
    }

    #[test]
    fn checkpoint_load_source_key_mismatch_starts_fresh() {
        // A genuinely different origin (user re-added a different source) must
        // discard the stale partial instead of resuming unrelated bytes.
        let tmp = tempfile::tempdir().unwrap();
        let name = "game.rar";
        std::fs::write(part_path(tmp.path(), name), vec![0u8; 2048]).unwrap();
        let cp = DownloadCheckpoint {
            uri: "https://gofile.io/d/ABC123".to_string(),
            total_bytes: 50_000,
            downloaded_bytes: 2048,
            started_at: 1,
        };
        std::fs::write(
            meta_path(tmp.path(), name),
            serde_json::to_string(&cp).unwrap(),
        )
        .unwrap();
        assert_eq!(
            load_checkpoint(tmp.path(), name, "https://gofile.io/d/OTHER"),
            None
        );
        assert!(!part_path(tmp.path(), name).exists());
        assert!(!meta_path(tmp.path(), name).exists());
    }

    // -- Partial install artifacts (Step 0 short-circuit guard) --

    #[test]
    fn has_partial_artifacts_no_tmp_false() {
        let dest = tempfile::tempdir().unwrap();
        // A clean, fully-extracted dest dir has no `tmp/` — not partial.
        assert!(!has_partial_install_artifacts(dest.path()));
    }

    #[test]
    fn has_partial_artifacts_empty_tmp_false() {
        let dest = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dest.path().join("tmp")).unwrap();
        // An empty `tmp/` (leftover dir only, no files) is not an interrupted
        // download — the completion path would have removed it, but tolerate it.
        assert!(!has_partial_install_artifacts(dest.path()));
    }

    #[test]
    fn has_partial_artifacts_part_file_true() {
        let dest = tempfile::tempdir().unwrap();
        let tmp = dest.path().join("tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("game.rar.part"), vec![0u8; 512]).unwrap();
        // A leftover `.part` means the previous download never finished — Step 0
        // must NOT short-circuit to "already extracted".
        assert!(has_partial_install_artifacts(dest.path()));
    }

    #[test]
    fn has_partial_artifacts_meta_only_true() {
        let dest = tempfile::tempdir().unwrap();
        let tmp = dest.path().join("tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("game.rar.part.meta"), "{}").unwrap();
        assert!(has_partial_install_artifacts(dest.path()));
    }

    // -- auto_run_installer: in-flight download guard --

    #[test]
    fn auto_run_installer_skips_spawn_when_download_in_flight() {
        let dest = tempfile::tempdir().unwrap();
        let tmp = dest.path().join("tmp");
        std::fs::create_dir_all(&tmp).unwrap();
        // An in-flight `.bin` volume: setup.exe must NOT be spawned yet.
        std::fs::write(tmp.join("setup-1.bin.part"), vec![0u8; 512]).unwrap();

        let result = auto_run_installer(
            &dest.path().join("setup.exe"),
            &dest.path().to_string_lossy(),
        );
        assert!(result.success);
        assert_eq!(result.status, "needs-setup");
        assert!(result.installer_pid.is_none());
        assert!(
            result.message.contains("still in progress"),
            "unexpected message: {}",
            result.message
        );
    }

    #[test]
    fn auto_run_installer_passes_when_no_partial_artifacts() {
        let dest = tempfile::tempdir().unwrap();
        // No `tmp/`, no partial artifacts -> the guard passes through to the
        // spawn attempt. A nonexistent exe fails fast on spawn, which proves the
        // guard did not block it (message differs from the in-flight one).
        let result = auto_run_installer(
            &dest.path().join("does-not-exist.exe"),
            &dest.path().to_string_lossy(),
        );
        assert_eq!(result.status, "needs-setup");
        assert!(
            !result.message.contains("still in progress"),
            "guard unexpectedly blocked: {}",
            result.message
        );
    }

    // -- Pause tracker / flag cleanup --

    #[test]
    fn truncate_part_shrinks_to_acknowledged_bytes() {
        // A partial write left the file longer than `bytes_read` acknowledges.
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), "game.rar");
        std::fs::write(&part, vec![0u8; 8192]).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .open(&part)
                .await
                .unwrap();
            truncate_part_to(&mut file, 4096).await;
        });

        assert_eq!(std::fs::metadata(&part).unwrap().len(), 4096);
    }

    #[test]
    fn truncate_part_noop_when_aligned() {
        // When on-disk size == bytes_read, truncation must not change anything.
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), "game.rar");
        std::fs::write(&part, vec![0u8; 4096]).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .open(&part)
                .await
                .unwrap();
            truncate_part_to(&mut file, 4096).await;
        });

        assert_eq!(std::fs::metadata(&part).unwrap().len(), 4096);
    }

    #[test]
    fn truncate_part_never_extends() {
        // bytes_read is never larger than on-disk size in practice; the guard must
        // not extend the file (which would insert zero-gap corruption on resume).
        let tmp = tempfile::tempdir().unwrap();
        let part = part_path(tmp.path(), "game.rar");
        std::fs::write(&part, vec![0u8; 2048]).unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .open(&part)
                .await
                .unwrap();
            truncate_part_to(&mut file, 100_000).await;
        });

        assert_eq!(std::fs::metadata(&part).unwrap().len(), 2048);
    }

    #[test]
    fn truncate_part_missing_file_no_panic() {
        // Missing/unopenable partial should be a no-op, not a panic.
        let tmp = tempfile::tempdir().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .open(part_path(tmp.path(), "game.rar"))
                .await
                .unwrap();
            truncate_part_to(&mut file, 0).await;
        });
        assert_eq!(std::fs::metadata(part_path(tmp.path(), "game.rar")).unwrap().len(), 0);
    }

    #[test]
    fn pause_flag_tracked_and_checked() {
        clear_job_flags("pause-test-job");
        assert!(!is_job_paused("pause-test-job"));
        assert!(!is_job_cancelled("pause-test-job"));

        pause_debrid_download("pause-test-job".to_string()).unwrap();
        assert!(is_job_paused("pause-test-job"));

        // A paused job is NOT treated as cancelled.
        assert!(!is_job_cancelled("pause-test-job"));
    }

    #[test]
    fn clear_job_flags_removes_both_cancel_and_pause() {
        clear_job_flags("flags-test-job");
        cancel_debrid_download("flags-test-job".to_string()).unwrap();
        pause_debrid_download("flags-test-job".to_string()).unwrap();
        assert!(is_job_cancelled("flags-test-job"));
        assert!(is_job_paused("flags-test-job"));

        // Fresh attempt (resume/retry) must clear both so re-invocation proceeds.
        clear_job_flags("flags-test-job");
        assert!(!is_job_cancelled("flags-test-job"));
        assert!(!is_job_paused("flags-test-job"));
    }

    #[test]
    fn clear_job_flags_only_affects_target_job() {
        clear_job_flags("other-job");
        pause_debrid_download("keep-job".to_string()).unwrap();
        clear_job_flags("other-job");
        assert!(is_job_paused("keep-job"));
        assert!(!is_job_paused("other-job"));
    }

    #[test]
    fn clear_job_flags_idempotent() {
        clear_job_flags("idem-job");
        clear_job_flags("idem-job");
        assert!(!is_job_cancelled("idem-job"));
        assert!(!is_job_paused("idem-job"));
    }

    // -- Transient retry backoff --

    #[test]
    fn retry_backoff_first_attempt_waits_short() {
        assert_eq!(retry_backoff_ms(1), Some(2_000));
    }

    #[test]
    fn retry_backoff_second_attempt_waits_long() {
        assert_eq!(retry_backoff_ms(2), Some(5_000));
    }

    #[test]
    fn retry_backoff_after_max_attempts_returns_none() {
        // attempt 3 is the final attempt � no more retries.
        assert_eq!(retry_backoff_ms(3), None);
        assert_eq!(retry_backoff_ms(4), None);
        assert_eq!(retry_backoff_ms(u32::MAX), None);
    }

    #[test]
    fn retry_backoff_zero_attempt_returns_none() {
        // attempt is 1-based; 0 is an invalid state.
        assert_eq!(retry_backoff_ms(0), None);
    }

    // -- Filename sanitization (nested-path `os error 3` fix) --

    #[test]
    fn normalize_filename_strips_nested_subdir() {
        // Regression: a resolver returning an in-archive path like
        // `Game Folder/Setup.exe` used to build `tmp/<sub>/Setup.exe.part` whose
        // parent dir didn't exist ? `File::create` failed with `os error 3` before
        // any byte downloaded.
        assert_eq!(normalize_download_filename("Game Folder/Setup.exe"), "Setup.exe");
        assert_eq!(normalize_download_filename("dir\\sub\\game.iso"), "game.iso");
        assert_eq!(normalize_download_filename("/abs/path/archive.zip"), "archive.zip");
    }

    #[test]
    fn normalize_filename_replaces_invalid_chars() {
        // Windows-invalid characters (`<>:"/\|?*` + controls) become `_`.
        assert_eq!(normalize_download_filename("bad:name*.exe"), "bad_name_.exe");
        assert_eq!(normalize_download_filename("a<b>c|d?e"), "a_b_c_d_e");
        assert_eq!(normalize_download_filename("tab\there.rar"), "tab_here.rar");
    }

    #[test]
    fn normalize_filename_trims_trailing_dots_and_spaces() {
        assert_eq!(normalize_download_filename("setup.exe."), "setup.exe");
        assert_eq!(normalize_download_filename("setup.exe "), "setup.exe");
        assert_eq!(normalize_download_filename("file.  ."), "file");
    }

    #[test]
    fn normalize_filename_falls_back_to_repack() {
        // Empty / `.` / `..` / reserved device names / over-long names ? "repack".
        assert_eq!(normalize_download_filename(""), "repack");
        assert_eq!(normalize_download_filename("."), "repack");
        assert_eq!(normalize_download_filename(".."), "repack");
        assert_eq!(normalize_download_filename("CON"), "repack");
        assert_eq!(normalize_download_filename("con.txt"), "repack");
        assert_eq!(normalize_download_filename("lpt1.txt"), "repack");
        assert_eq!(normalize_download_filename("com9.log"), "repack");
        assert_eq!(normalize_download_filename("///"), "repack");
        assert_eq!(normalize_download_filename("\\\\"), "repack");
        // 51+ chars without a valid fallback point.
        let long = "x".repeat(60);
        assert_eq!(normalize_download_filename(&long), "repack");
    }

    #[test]
    fn normalize_filename_caps_length_preserving_extension() {
        let stem = "a".repeat(60);
        let name = format!("{}.zip", stem);
        let out = normalize_download_filename(&name);
        assert!(out.ends_with(".zip"));
        assert!(out.len() <= 50);
        // Extension must survive the truncation.
        assert!(out.len() >= 4);
    }

    #[test]
    fn normalize_filename_keeps_valid_names_unchanged() {
        assert_eq!(normalize_download_filename("setup.exe"), "setup.exe");
        assert_eq!(normalize_download_filename("The-Operator-SteamRIP.com.rar"), "The-Operator-SteamRIP.com.rar");
        assert_eq!(normalize_download_filename("My Game (v1.2).zip"), "My Game (v1.2).zip");
    }

    #[test]
    fn clean_download_filename_uses_sanitizer_for_all_inputs() {
        // Bare long tokens (gofile CDN) still normalize instead of passing raw.
        let token = "t".repeat(220);
        assert_eq!(clean_download_filename(Some(token.clone())), "repack");
        // Short name with extension passes through sanitized.
        assert_eq!(clean_download_filename(Some("game.zip".to_string())), "game.zip");
        // None/empty fall back.
        assert_eq!(clean_download_filename(None), "repack");
        assert_eq!(clean_download_filename(Some(String::new())), "repack");
    }

    // -- Relative path preservation (MD5-folder fix) --

    #[test]
    fn relative_path_preserves_nested_checksum_folder() {
        // Regression: a multivolume resolver returning `MD5/checksums.md5` must
        // keep the folder. The previous flat sanitizer dropped `MD5/` entirely,
        // leaving its files scattered in the extract root and never creating MD5/.
        assert_eq!(
            normalize_download_relative_path("MD5/checksums.md5"),
            Some("MD5/checksums.md5".to_string())
        );
        assert_eq!(
            normalize_download_relative_path("Game Folder/Setup/setup.exe"),
            Some("Game Folder/Setup/setup.exe".to_string())
        );
    }

    #[test]
    fn relative_path_flat_name_returns_none() {
        assert_eq!(normalize_download_relative_path("setup.exe"), None);
        assert_eq!(normalize_download_relative_path("checksums.md5"), None);
        assert_eq!(normalize_download_relative_path(""), None);
    }

    #[test]
    fn relative_path_rejects_abs_and_drive_prefix() {
        assert_eq!(normalize_download_relative_path("/abs/path/file.bin"), None);
        assert_eq!(normalize_download_relative_path("\\abs\\path\\file.bin"), None);
        assert_eq!(normalize_download_relative_path("C:/Game/file.bin"), None);
    }

    #[test]
    fn relative_path_drops_traversal_and_sanitizes_components() {
        // `..`/`.` components are dropped; invalid chars replaced per component.
        assert_eq!(
            normalize_download_relative_path("MD5/../checksums.md5"),
            Some("MD5/checksums.md5".to_string())
        );
        assert_eq!(
            normalize_download_relative_path("bad:col/MD5/checksums.md5"),
            Some("bad_col/MD5/checksums.md5".to_string())
        );
    }

    #[test]
    fn relative_path_unsafe_component_returns_none() {
        // A reserved/over-long top-level token can't become a folder -- bail flat.
        assert_eq!(normalize_download_relative_path("CON/setup.exe"), None);
    }

    // -- Installer finder never returns repack utilities --

    #[test]
    fn installer_finder_never_returns_repack_utility() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("quicksfv.exe"), b"x").unwrap();
        // A checksum utility alone must NOT be treated as a runnable installer,
        // otherwise `auto_run_installer` spawns it as if it were the game setup.
        assert_eq!(find_installer_exe_in_dir(dir.path()), None);
        // The recursive search must not surface it either.
        assert_eq!(find_installer_exe_recursive(dir.path()), None);
        // But its presence IS detected by the dedicated helper.
        assert!(has_repack_utility(dir.path()));
        assert_eq!(
            find_repack_utility_exe_in_dir(dir.path()),
            Some("quicksfv.exe".to_string())
        );
    }

    #[test]
    fn installer_finder_returns_real_setup_over_utility() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("setup.exe"), b"MZ").unwrap();
        std::fs::write(dir.path().join("quicksfv.exe"), b"x").unwrap();
        assert_eq!(
            find_installer_exe_in_dir(dir.path()),
            Some("setup.exe".to_string())
        );
        assert_eq!(
            find_installer_exe_recursive(dir.path()),
            Some(dir.path().join("setup.exe"))
        );
    }

    #[test]
    fn has_repack_utility_false_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("setup.exe"), b"MZ").unwrap();
        assert!(!has_repack_utility(dir.path()));
    }
}
