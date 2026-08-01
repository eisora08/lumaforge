//! In-app torrent download via `librqbit`.
//!
//! Used for repack downloads whose source is a magnet URI (FitGirl / DODI
//! style) that a debrid provider can't or shouldn't resolve. The torrent is
//! downloaded directly into `games/debrid/<providerGameId>/` and post-processed
//! with the shared helpers from `debrid_installer.rs` (auto-run installer,
//! extract archive, find game executable), returning the same
//! `DebridDownloadResult` so the TS install pipeline is unchanged.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Instant;

use dashmap::DashMap;
use librqbit::api::TorrentIdOrHash;
use librqbit::{
    AddTorrent, AddTorrentOptions, ManagedTorrent, Session, SessionOptions,
    SessionPersistenceConfig, TorrentStats, TorrentStatsState,
};
use tauri::{AppHandle, Manager};
use tokio::time::{sleep, Duration};

use crate::commands::debrid_installer::{
    auto_run_installer, clear_job_flags, extract_rar_via_7z, extract_rar_with_cli,
    extract_rar_with_unrar, extract_zip_with_zip_crate, flatten_single_root_folder,
    is_job_cancelled, is_job_paused, INSTALLER_EXE_NAMES, REPACK_UTILITY_EXES,
};
use crate::models::debrid_install_result::DebridDownloadResult;
use crate::utils::progress_utils::emit_installer_progress;

/// Kill-switch for in-app torrent downloads. Mirrors the TS feature flag
/// `DEBRID_TORRENT_ENABLED` in `src/features/debrid/debridFeatureFlag.ts`.
const DEBRID_TORRENT_ENABLED: bool = true;

const TORRENT_POLL_MS: u64 = 500;
const TORRENT_MAX_WAIT_SECS: u64 = 6 * 60 * 60;

/// How long a magnet may sit in `Initializing` (metadata resolution / peer
/// discovery) before we give up. Only guards the connect phase — a download
/// that has produced bytes is never cut by this limit.
const TORRENT_METADATA_STALL_SECS: u64 = 3 * 60;

/// Whether the connect phase has been stalled past the threshold.
fn metadata_stall_exceeded(first_seen: Instant, threshold_secs: u64) -> bool {
    first_seen.elapsed().as_secs() > threshold_secs
}

/// Process-lifetime librqbit session (single torrent engine for the whole app).
static TORRENT_SESSION: OnceLock<Arc<Session>> = OnceLock::new();

/// Active torrents keyed by job id (`debrid-install-<providerGameId>`).
static ACTIVE_TORRENTS: OnceLock<DashMap<String, Arc<ManagedTorrent>>> = OnceLock::new();

fn active_torrents() -> &'static DashMap<String, Arc<ManagedTorrent>> {
    ACTIVE_TORRENTS.get_or_init(DashMap::new)
}

async fn get_session(app_handle: &AppHandle) -> Result<Arc<Session>, String> {
    if let Some(session) = TORRENT_SESSION.get() {
        return Ok(session.clone());
    }
    // Persistent session: fastresume + JSON persistence under
    // <appData>/librqbit so a paused download survives an app restart and can be
    // resumed later. This is the single torrent engine for the whole app.
    let base_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("librqbit");
    if let Err(e) = fs::create_dir_all(&base_dir) {
        return Err(format!("Failed to create torrent session dir: {e}"));
    }
    let opts = SessionOptions {
        enable_upnp_port_forwarding: false,
        fastresume: true,
        persistence: Some(SessionPersistenceConfig::Json {
            folder: Some(base_dir.clone()),
        }),
        ..Default::default()
    };
    let session = Session::new_with_opts(base_dir, opts)
        .await
        .map_err(|e| format!("Failed to initialize torrent engine: {e}"))?;
    let _ = TORRENT_SESSION.set(session.clone());
    Ok(session)
}

/// Delete recorded torrents that are neither the current job's torrent nor an
/// in-process active torrent (tracked in `ACTIVE_TORRENTS`). This clears partial
/// data from jobs that were removed/cancelled or from previous sessions so they
/// never resume in the background. The download queue is the source of truth for
/// which jobs should keep their data.
async fn cleanup_orphan_torrents(session: &Arc<Session>, current: &Arc<ManagedTorrent>) {
    let active_ids: HashSet<_> = active_torrents().iter().map(|e| e.value().id()).collect();
    let to_delete = session.with_torrents(|it| {
        let mut ids = Vec::new();
        for (id, _handle) in it {
            if id != current.id() && !active_ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    });
    for id in to_delete {
        println!("[TORRENT][ORPHAN] Removing orphan torrent id={}", id);
        let _ = session.delete(TorrentIdOrHash::Id(id), true).await;
    }
}

/// Download a repack whose source is a magnet URI using the in-app torrent engine.
///
/// Downloads into `dest_dir`, waits for completion (emitting progress events on
/// `installer-progress`), then post-processes exactly like
/// `download_debrid_package` (auto-run installer → find game exe → extract
/// archive). Returns the same `DebridDownloadResult` shape.
#[tauri::command]
pub async fn start_torrent_download(
    app_handle: AppHandle,
    job_id: String,
    magnet: String,
    dest_dir: String,
) -> Result<DebridDownloadResult, String> {
    if !DEBRID_TORRENT_ENABLED {
        return Err("Torrent downloads are disabled.".to_string());
    }
    if job_id.trim().is_empty() {
        return Err("Job ID is empty.".to_string());
    }
    if magnet.trim().is_empty() {
        return Err("Magnet URI is empty.".to_string());
    }
    if dest_dir.trim().is_empty() {
        return Err("Destination directory is empty.".to_string());
    }

    let dest_path = PathBuf::from(&dest_dir);

    // Fresh attempt — clear any stale cancel/pause flags for this job id so a
    // resume after a prior cancel/pause is never aborted immediately.
    clear_job_flags(&job_id);

    // Step 0: short-circuit if a previous attempt already produced a usable install.
    if let Some(installer_path) = find_installer_file_recursive(&dest_path) {
        println!(
            "[TORRENT][SHORTCIRCUIT] Installer already on disk: {}",
            installer_path.display()
        );
        return Ok(auto_run_installer(&installer_path, &dest_dir));
    }
    if let Some(exe_path) = find_largest_exe_recursive(&dest_path) {
        let exe_path = exe_path.to_string_lossy().to_string();
        println!("[TORRENT][SHORTCIRCUIT] Game executable already on disk: {}", exe_path);
        return Ok(DebridDownloadResult {
            success: true,
            status: "ready".to_string(),
            install_dir: dest_dir.clone(),
            executable_path: Some(exe_path),
            installer_path: None,
            installer_pid: None,
            message: "Already downloaded. Ready to play.".to_string(),
        });
    }

    let session = get_session(&app_handle).await?;

    emit_installer_progress(
        &app_handle,
        &job_id,
        "downloading",
        1,
        0,
        0,
        "Connecting to torrent swarm\u{2026}",
    );

    let response = session
        .add_torrent(
            AddTorrent::from_url(magnet),
            Some(AddTorrentOptions {
                overwrite: true,
                output_folder: Some(dest_dir.clone()),
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| format!("Failed to add torrent: {e}"))?;

    // `into_handle` returns a handle for both freshly-added torrents and
    // `AlreadyManaged` ones (recorded by persistence from a previous attempt).
    let torrent = response
        .into_handle()
        .ok_or_else(|| "Torrent is not supported (missing info hash).".to_string())?;

    active_torrents().insert(job_id.clone(), torrent.clone());
    println!(
        "[TORRENT][ADD] job_id={} name={:?} id={}",
        job_id,
        torrent.name(),
        torrent.id()
    );

    // If a previous pause left this torrent in a paused state, resume it.
    if matches!(torrent.stats().state, TorrentStatsState::Paused) {
        println!("[TORRENT][RESUME] Resuming previously paused torrent job={}", job_id);
        session
            .unpause(&torrent)
            .await
            .map_err(|e| format!("Failed to resume torrent: {e}"))?;
    }

    // Remove recorded torrents from removed/cancelled jobs or previous sessions
    // so they never resume in the background.
    cleanup_orphan_torrents(&session, &torrent).await;

    let poll_result = poll_torrent_until_done(&app_handle, &job_id, &torrent).await;

    match poll_result {
        Ok(PollOutcome::Done) => {
            // Make sure the final flush is done before touching files, then stop
            // seeding and release the handle (keep the downloaded files).
            let _ = tokio::time::timeout(
                Duration::from_secs(30),
                torrent.wait_until_completed(),
            )
            .await;
            let _ = session
                .delete(TorrentIdOrHash::Id(torrent.id()), false)
                .await;
            active_torrents().remove(&job_id);

            process_torrent_files(&app_handle, &job_id, &dest_path, &dest_dir)
        }
        Ok(PollOutcome::Paused) => {
            // Paused by user — stop the engine but keep the partial data +
            // fastresume so a later resume reuses them. The torrent stays tracked
            // in ACTIVE_TORRENTS (protected from orphan cleanup).
            let _ = session.pause(&torrent).await;
            println!("[TORRENT][PAUSE] Torrent paused job={}", job_id);
            Ok(DebridDownloadResult {
                success: false,
                status: "paused".to_string(),
                install_dir: dest_dir.clone(),
                executable_path: None,
                installer_path: None,
                installer_pid: None,
                message: "Torrent download paused.".to_string(),
            })
        }
        Err(e) => {
            // Cancelled or failed — drop the torrent and clean its partial files.
            let _ = session
                .delete(TorrentIdOrHash::Id(torrent.id()), true)
                .await;
            active_torrents().remove(&job_id);
            Err(e)
        }
    }
}

/// Outcome of the torrent download loop — used to decide what the caller does
/// with the partial data (post-process vs keep for resume vs clean).
enum PollOutcome {
    Done,
    Paused,
}

/// Poll torrent stats until finished, cancelled, paused, errored, or timed out.
///
/// Emits `installer-progress` events so the Downloads page shows a determinate
/// progress bar (real bytes/total from librqbit — no fake percentages).
async fn poll_torrent_until_done(
    app_handle: &AppHandle,
    job_id: &str,
    torrent: &Arc<ManagedTorrent>,
) -> Result<PollOutcome, String> {
    let started = Instant::now();
    let mut last_pct: i32 = -1;
    let mut metadata_stalled: Option<Instant> = None;

    loop {
        if is_job_cancelled(job_id) {
            return Err("Download cancelled.".to_string());
        }
        if is_job_paused(job_id) {
            return Ok(PollOutcome::Paused);
        }
        if started.elapsed().as_secs() > TORRENT_MAX_WAIT_SECS {
            return Err("Torrent download timed out.".to_string());
        }

        let stats: TorrentStats = torrent.stats();
        if let TorrentStatsState::Error = stats.state {
            return Err(stats
                .error
                .clone()
                .unwrap_or_else(|| "Torrent failed.".to_string()));
        }

        if matches!(stats.state, TorrentStatsState::Initializing) {
            // Magnet still resolving metadata / finding peers.
            let first_seen = *metadata_stalled.get_or_insert_with(Instant::now);
            if metadata_stall_exceeded(first_seen, TORRENT_METADATA_STALL_SECS) {
                return Err(
                    "Could not connect to torrent swarm (no peers/seeds).".to_string(),
                );
            }
            if last_pct != 0 {
                emit_installer_progress(
                    app_handle,
                    job_id,
                    "downloading",
                    1,
                    0,
                    0,
                    "Connecting to torrent swarm\u{2026}",
                );
                last_pct = 0;
            }
        } else if stats.finished {
            emit_installer_progress(
                app_handle,
                job_id,
                "downloading",
                100,
                stats.progress_bytes,
                stats.total_bytes,
                "Torrent download complete",
            );
            return Ok(PollOutcome::Done);
        } else {
            // Metadata resolved and bytes flowing (or torrent finished) — clear
            // the connect-phase stall guard so a large download is never cut.
            metadata_stalled = None;
            let pct = if stats.total_bytes > 0 {
                (stats.progress_bytes.saturating_mul(100) / stats.total_bytes).min(99) as i32
            } else {
                0
            };
            if pct != last_pct {
                let msg = if pct < 5 {
                    "Starting torrent download\u{2026}"
                } else {
                    "Downloading via torrent\u{2026}"
                };
                emit_installer_progress(
                    app_handle,
                    job_id,
                    "downloading",
                    pct as u8,
                    stats.progress_bytes,
                    stats.total_bytes,
                    msg,
                );
                last_pct = pct;
            }
        }

        sleep(Duration::from_millis(TORRENT_POLL_MS)).await;
    }
}

/// Post-process the downloaded torrent files, mirroring `download_debrid_package`:
/// auto-run installer → find game exe → extract archive → fallback "files on disk".
fn process_torrent_files(
    app_handle: &AppHandle,
    job_id: &str,
    dest_path: &Path,
    dest_dir: &str,
) -> Result<DebridDownloadResult, String> {
    // Effective game root: torrents sometimes ship a single wrapper folder.
    let game_root = flatten_single_root_folder(dest_path);

    // Priority 1: installer / repack-utility present → auto-run installer.
    if let Some(installer_path) = find_installer_file_recursive(&game_root) {
        println!("[TORRENT][POST] Auto-running installer: {}", installer_path.display());
        emit_installer_progress(app_handle, job_id, "scanning", 95, 0, 0, "Running installer\u{2026}");
        let result = auto_run_installer(&installer_path, dest_dir);
        emit_installer_progress(app_handle, job_id, "done", 100, 0, 0, &result.message);
        return Ok(result);
    }

    // Priority 2: real game executable → ready to play.
    if let Some(exe_path) = find_largest_exe_recursive(&game_root) {
        let exe_path = exe_path.to_string_lossy().to_string();
        println!("[TORRENT][POST] Game executable found: {}", exe_path);
        emit_installer_progress(app_handle, job_id, "done", 100, 0, 0, "Game ready to play!");
        return Ok(DebridDownloadResult {
            success: true,
            status: "ready".to_string(),
            install_dir: dest_dir.to_string(),
            executable_path: Some(exe_path),
            installer_path: None,
            installer_pid: None,
            message: "Game ready to play!".to_string(),
        });
    }

    // Priority 3: archive → extract → re-scan.
    if let Some(archive_path) = find_largest_archive_recursive(&game_root) {
        let is_rar = archive_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("rar"))
            .unwrap_or(false);
        println!("[TORRENT][POST] Extracting archive: {}", archive_path.display());
        emit_installer_progress(
            app_handle,
            job_id,
            "extracting",
            50,
            0,
            0,
            if is_rar {
                "Extracting RAR\u{2026}"
            } else {
                "Extracting archive\u{2026}"
            },
        );

        let extract_result = if is_rar {
            extract_rar_with_cli(&archive_path, dest_path)
                .or_else(|err| {
                    println!("[TORRENT][EXTRACT] CLI failed ({err}), trying unrar crate");
                    extract_rar_with_unrar(&archive_path, dest_path)
                })
                .or_else(|err| {
                    println!("[TORRENT][EXTRACT] unrar failed ({err}), trying 7-Zip");
                    extract_rar_via_7z(&archive_path, dest_path)
                })
        } else {
            extract_zip_with_zip_crate(&archive_path, dest_path)
        };
        extract_result.map_err(|e| {
            format!(
                "Archive saved but could not extract automatically. \
                 Install 7-Zip and extract manually. ({e})"
            )
        })?;

        // Re-scan after extraction (flatten wrapper again).
        let game_root = flatten_single_root_folder(dest_path);
        if let Some(installer_path) = find_installer_file_recursive(&game_root) {
            println!("[TORRENT][POST] Extracted installer: {}", installer_path.display());
            let result = auto_run_installer(&installer_path, dest_dir);
            emit_installer_progress(app_handle, job_id, "done", 100, 0, 0, &result.message);
            return Ok(result);
        }
        if let Some(exe_path) = find_largest_exe_recursive(&game_root) {
            let exe_path = exe_path.to_string_lossy().to_string();
            println!("[TORRENT][POST] Extracted game executable: {}", exe_path);
            emit_installer_progress(app_handle, job_id, "done", 100, 0, 0, "Game ready to play!");
            return Ok(DebridDownloadResult {
                success: true,
                status: "ready".to_string(),
                install_dir: dest_dir.to_string(),
                executable_path: Some(exe_path),
                installer_path: None,
                installer_pid: None,
                message: "Game ready to play!".to_string(),
            });
        }

        emit_installer_progress(
            app_handle,
            job_id,
            "done",
            100,
            0,
            0,
            "Extraction complete. Open folder to find the game executable.",
        );
        return Ok(DebridDownloadResult {
            success: true,
            status: "ready".to_string(),
            install_dir: dest_dir.to_string(),
            executable_path: None,
            installer_path: None,
            installer_pid: None,
            message: "Extraction complete. No game executable found automatically.".to_string(),
        });
    }

    // Nothing usable found — files are on disk anyway.
    emit_installer_progress(
        app_handle,
        job_id,
        "done",
        100,
        0,
        0,
        "Download complete. Open folder to find the game executable.",
    );
    Ok(DebridDownloadResult {
        success: true,
        status: "ready".to_string(),
        install_dir: dest_dir.to_string(),
        executable_path: None,
        installer_path: None,
        installer_pid: None,
        message: "Download complete. No game executable found automatically.".to_string(),
    })
}

// ─── Recursive file finders ────────────────────────────────────────────────

/// Recursively find a known installer / repack-utility file (full path).
fn find_installer_file_recursive(dir: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path) -> Option<PathBuf> {
        for entry in fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = walk(&path) {
                    return Some(found);
                }
            } else {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if INSTALLER_EXE_NAMES.iter().any(|n| name == *n)
                    || REPACK_UTILITY_EXES.iter().any(|n| name == *n)
                {
                    return Some(path);
                }
            }
        }
        None
    }
    walk(dir)
}

/// Recursively find the largest game `.exe` (full path), excluding known
/// installer / redistributable / repack-utility names.
fn find_largest_exe_recursive(dir: &Path) -> Option<PathBuf> {
    const EXCLUDED: &[&str] = &[
        "unins000.exe",
        "uninstall.exe",
        "setup.exe",
        "installer.exe",
        "setup_x64.exe",
        "setup_x86.exe",
        "autorun.exe",
        "dxsetup.exe",
        "vc_redist.exe",
        "vcredist.exe",
        "dotnet.exe",
        "directx.exe",
        "oalinst.exe",
        "xnafx.exe",
        "gfwlivesetup.exe",
        "gamesforsetup.exe",
        "quicksfv.exe",
        "quicksfv64.exe",
        "verify.exe",
        "md5.exe",
        "md5sums.exe",
        "sfv.exe",
    ];

    fn walk(dir: &Path, excluded: &[&str], largest: &mut Option<(PathBuf, u64)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, excluded, largest);
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !ext.eq_ignore_ascii_case("exe") {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if excluded.contains(&name.as_str()) {
                continue;
            }
            if let Ok(meta) = path.metadata() {
                if meta.is_file() && largest.as_ref().map_or(true, |(_, s)| meta.len() > *s) {
                    *largest = Some((path, meta.len()));
                }
            }
        }
    }

    let mut largest: Option<(PathBuf, u64)> = None;
    walk(dir, EXCLUDED, &mut largest);
    largest.map(|(p, _)| p)
}

/// Recursively find the largest `.rar` / `.zip` archive (full path).
fn find_largest_archive_recursive(dir: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path, largest: &mut Option<(PathBuf, u64)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, largest);
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !(ext.eq_ignore_ascii_case("rar") || ext.eq_ignore_ascii_case("zip")) {
                continue;
            }
            if let Ok(meta) = path.metadata() {
                if meta.is_file() && largest.as_ref().map_or(true, |(_, s)| meta.len() > *s) {
                    *largest = Some((path, meta.len()));
                }
            }
        }
    }

    let mut largest: Option<(PathBuf, u64)> = None;
    walk(dir, &mut largest);
    largest.map(|(p, _)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_stall_below_threshold_is_not_exceeded() {
        let threshold = 180u64;
        let first_seen = Instant::now() - Duration::from_secs(threshold - 1);
        assert!(!metadata_stall_exceeded(first_seen, threshold));
    }

    #[test]
    fn metadata_stall_at_threshold_is_not_exceeded() {
        let threshold = 180u64;
        let first_seen = Instant::now() - Duration::from_secs(threshold);
        assert!(!metadata_stall_exceeded(first_seen, threshold));
    }

    #[test]
    fn metadata_stall_over_threshold_is_exceeded() {
        let threshold = 180u64;
        let first_seen = Instant::now() - Duration::from_secs(threshold + 1);
        assert!(metadata_stall_exceeded(first_seen, threshold));
    }
}
