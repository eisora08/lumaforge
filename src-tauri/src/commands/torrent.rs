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
    extract_rar_with_unrar, extract_zip_with_zip_crate, find_installer_exe_recursive,
    flatten_single_root_folder, is_excluded_exe_name, is_excluded_redist_dir, is_job_cancelled,
    is_job_paused,
};
use crate::models::debrid_install_result::DebridDownloadResult;
use crate::utils::progress_utils::{emit_installer_network, emit_installer_progress};

/// Kill-switch for in-app torrent downloads. Mirrors the TS feature flag
/// `DEBRID_TORRENT_ENABLED` in `src/features/debrid/debridFeatureFlag.ts`.
const DEBRID_TORRENT_ENABLED: bool = true;

const TORRENT_POLL_MS: u64 = 500;
const TORRENT_MAX_WAIT_SECS: u64 = 6 * 60 * 60;

/// How long a magnet may sit in `Initializing` (metadata resolution / peer
/// discovery) before we give up. Only guards the connect phase — a download
/// that has produced bytes is never cut by this limit.
const TORRENT_METADATA_STALL_SECS: u64 = 3 * 60;

/// How long the download may produce no new bytes (metadata resolved, but the
/// swarm has no seeds/peers or the connection stalled) before we give up.
/// Without this, a magnet with no peers would spin at 0% until
/// `TORRENT_MAX_WAIT_SECS` (6h) with the job stuck in "downloading".
const TORRENT_DATA_STALL_SECS: u64 = 2 * 60;

/// Minimum interval between progress emits once bytes are flowing. The frontend
/// speed chart samples one bar per `installer-progress` event, so emitting only
/// on percent change (a 30 GB repack moves 1% every ~30s) leaves the chart
/// nearly empty. A time-based cadence keeps ~1 sample/sec.
const TORRENT_PROGRESS_EMIT_SECS: u64 = 1;

/// Whether a phase has been stalled past the threshold.
fn stall_exceeded(first_seen: Instant, threshold_secs: u64) -> bool {
    first_seen.elapsed().as_secs() > threshold_secs
}

/// Whether the connect phase has been stalled past the threshold.
fn metadata_stall_exceeded(first_seen: Instant, threshold_secs: u64) -> bool {
    stall_exceeded(first_seen, threshold_secs)
}

/// Whether the download has produced no new bytes for the threshold.
fn data_stall_exceeded(first_seen: Instant, threshold_secs: u64) -> bool {
    stall_exceeded(first_seen, threshold_secs)
}

/// Whether a progress emit is due: the percentage changed OR the throttle
/// window elapsed (so the frontend chart gets a steady sample stream).
fn progress_emit_due(last_pct: i32, pct: i32, elapsed_secs: u64, throttle_secs: u64) -> bool {
    pct != last_pct || elapsed_secs >= throttle_secs
}

/// Process-lifetime librqbit session (single torrent engine for the whole app).
static TORRENT_SESSION: OnceLock<Arc<Session>> = OnceLock::new();

/// Active torrents keyed by job id (`debrid-install-<providerGameId>`).
static ACTIVE_TORRENTS: OnceLock<DashMap<String, Arc<ManagedTorrent>>> = OnceLock::new();

fn active_torrents() -> &'static DashMap<String, Arc<ManagedTorrent>> {
    ACTIVE_TORRENTS.get_or_init(DashMap::new)
}

/// Resolve (and create) the torrent session dir under app data, used for both
/// the librqbit persistence and the per-job completion markers.
fn torrent_base_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("librqbit");
    fs::create_dir_all(&base_dir)
        .map_err(|e| format!("Failed to create torrent session dir: {e}"))?;
    Ok(base_dir)
}

/// Sanitize a job id so it is safe to use as a marker file name.
fn marker_file_name(job_id: &str) -> String {
    let mut out = String::with_capacity(job_id.len());
    for ch in job_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    out
}

/// Path to the completion marker for a job. The marker is written ONLY after a
/// torrent download has fully completed (all pieces verified on disk). It lives
/// in the session dir (`<appData>/librqbit`), NOT in `dest_dir`, so it never
/// interferes with `flatten_single_root_folder` (which requires the dest root to
/// contain only the game folder, with no loose files).
fn torrent_marker_path(job_id: &str, base_dir: &Path) -> PathBuf {
    base_dir.join(format!("{}.done", marker_file_name(job_id)))
}

/// Whether a previous torrent attempt for this job completed successfully.
fn torrent_marker_exists(job_id: &str, base_dir: &Path) -> bool {
    torrent_marker_path(job_id, base_dir).is_file()
}

/// Record that the torrent for this job finished downloading (all pieces
/// verified). Only this proves the on-disk files are complete and trustworthy.
fn write_torrent_marker(job_id: &str, base_dir: &Path) {
    let path = torrent_marker_path(job_id, base_dir);
    if let Err(e) = fs::write(&path, b"ok") {
        println!(
            "[TORRENT][MARKER] Failed to write completion marker {}: {e}",
            path.display()
        );
    }
}

/// Drop the completion marker (used when a job is cancelled/failed so a later
/// attempt never short-circuits on stale/partial files).
fn remove_torrent_marker(job_id: &str, base_dir: &Path) {
    let path = torrent_marker_path(job_id, base_dir);
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
}

async fn get_session(app_handle: &AppHandle) -> Result<Arc<Session>, String> {
    if let Some(session) = TORRENT_SESSION.get() {
        return Ok(session.clone());
    }
    // Persistent session: fastresume + JSON persistence under
    // <appData>/librqbit so a paused download survives an app restart and can be
    // resumed later. This is the single torrent engine for the whole app.
    let base_dir = torrent_base_dir(app_handle)?;
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
    // On a fresh process the in-memory `active_torrents()` is empty, so any
    // torrent librqbit restored from its JSON persistence belongs to a PREVIOUS
    // session. Drop them so they never resume in the background (and never hold
    // file locks on the game folder). The download queue is the source of truth
    // — a job the user resumes re-adds its magnet explicitly below.
    sweep_restored_torrents(&session).await;
    let _ = TORRENT_SESSION.set(session.clone());
    Ok(session)
}

/// Delete every torrent currently in the session (without removing their files).
/// Called right after the session is first created (fresh process) to purge
/// torrents restored from persistence — nothing can be legitimately active at
/// that point. Files are kept on disk so an explicit resume later re-adds the
/// magnet and reuses the partial data; only the session reference (and its file
/// handles) are released so nothing downloads in the background.
async fn sweep_restored_torrents(session: &Arc<Session>) {
    let ids: Vec<_> = session.with_torrents(|it| it.map(|(id, _)| id).collect());
    for id in ids {
        println!("[TORRENT][SWEEP] Removing restored torrent id={}", id);
        let _ = session.delete(TorrentIdOrHash::Id(id), false).await;
    }
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
    auto_extract: bool,
    delete_archive: bool,
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

    // Shared with `get_session`; also hosts the per-job completion markers.
    let base_dir = torrent_base_dir(&app_handle)?;

    // Step 0: short-circuit if a previous attempt already produced a usable
    // install. Only trust the on-disk installer/game exe when the previous
    // torrent download COMPLETED (marker present). librqbit writes pieces in
    // place (no `tmp/` folder like the HTTP path), so after a pause/cancel the
    // files on disk may be partial or corrupt — a matching `setup.exe` there is
    // NOT proof of success and auto-running it would silently install a broken
    // build. Without the marker, skip the short-circuit and actually
    // (re)download the torrent.
    if torrent_marker_exists(&job_id, &base_dir) {
        if let Some(installer_path) = find_installer_exe_recursive(&dest_path) {
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

    // Resolving the magnet metadata is UNBOUNDED inside librqbit: for a magnet
    // without an embedded info dict, `add_torrent` awaits `read_metainfo_from_peer_receiver`,
    // which blocks until a peer delivers the info-hash metadata or the peer-address
    // stream ends. With DHT enabled (our default) that stream stays open forever, so
    // a dead/swarmless magnet (or blocked DHT ports) would leave the job stuck on
    // "Connecting to torrent swarm…" indefinitely. Wrap the add in the same
    // `TORRENT_METADATA_STALL_SECS` budget used by the poll-loop connect guard so the
    // metadata-fetch phase is bounded too. No cleanup is needed on timeout: the
    // torrent is only inserted into `active_torrents()` (and registered in the
    // session) after this call returns.
    let add_timeout = tokio::time::timeout(
        Duration::from_secs(TORRENT_METADATA_STALL_SECS),
        session.add_torrent(
            AddTorrent::from_url(magnet),
            Some(AddTorrentOptions {
                overwrite: true,
                output_folder: Some(dest_dir.clone()),
                ..Default::default()
            }),
        ),
    )
    .await;

    let response = match add_timeout {
        Ok(Ok(response)) => response,
        Ok(Err(e)) => return Err(format!("Failed to add torrent: {e}")),
        Err(_elapsed) => {
            println!(
                "[TORRENT][METADATA_TIMEOUT] job_id={} no swarm metadata after {}s",
                job_id, TORRENT_METADATA_STALL_SECS
            );
            emit_installer_progress(
                &app_handle,
                &job_id,
                "failed",
                0,
                0,
                0,
                "Could not connect to torrent swarm (no peers/seeds).",
            );
            return Err("Could not connect to torrent swarm (no peers/seeds).".to_string());
        }
    };

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

            // The download is complete and verified on disk — record the marker
            // so a later call short-circuits instead of re-downloading.
            write_torrent_marker(&job_id, &base_dir);
            println!("[TORRENT][MARKER] job_id={} completed", job_id);

            // auto_extract=false → download only, leave the files on disk. Never
            // auto-run an installer or extract an archive; return "downloaded"
            // so the job shows a manual-extraction message without marking the
            // game as installed.
            if !auto_extract {
                println!(
                    "[TORRENT][DOWNLOAD_ONLY] job_id={} auto_extract=false",
                    job_id
                );
                emit_installer_progress(
                    &app_handle,
                    &job_id,
                    "done",
                    100,
                    0,
                    0,
                    "Download complete. Extract manually.",
                );
                return Ok(DebridDownloadResult {
                    success: true,
                    status: "downloaded".to_string(),
                    install_dir: dest_dir.clone(),
                    executable_path: None,
                    installer_path: None,
                    installer_pid: None,
                    message: "Download complete. Extract the archive manually.".to_string(),
                });
            }

            process_torrent_files(&app_handle, &job_id, &dest_path, &dest_dir, delete_archive)
        }
        Ok(PollOutcome::Paused) => {
            // Paused by user — release the file handles so the game folder is
            // not locked on Windows. Partial data + fastresume stay on disk; a
            // resume re-adds the magnet via `start_torrent_download` and
            // librqbit reuses the existing files (piece verification on add).
            let _ = session
                .delete(TorrentIdOrHash::Id(torrent.id()), false)
                .await;
            active_torrents().remove(&job_id);
            println!("[TORRENT][PAUSE] Torrent released job={}", job_id);
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
            // The marker must go too, otherwise a later attempt would trust the
            // leftover partial `setup.exe` and auto-run it on corrupt data.
            remove_torrent_marker(&job_id, &base_dir);
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
    let mut last_emit: Option<Instant> = None;
    let mut metadata_stalled: Option<Instant> = None;
    let mut data_stalled: Option<Instant> = None;
    let mut last_progress_bytes: u64 = 0;

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
            // But if no NEW bytes have been downloaded for a while, the swarm
            // has no seeds/peers (or the connection stalled). Cut the job so it
            // never spins at 0% until TORRENT_MAX_WAIT_SECS.
            if stats.progress_bytes > last_progress_bytes {
                data_stalled = None;
                last_progress_bytes = stats.progress_bytes;
            } else {
                let first_seen = *data_stalled.get_or_insert_with(Instant::now);
                if data_stall_exceeded(first_seen, TORRENT_DATA_STALL_SECS) {
                    return Err(
                        "No download progress (no seeds/peers).".to_string(),
                    );
                }
            }
            let pct = if stats.total_bytes > 0 {
                (stats.progress_bytes.saturating_mul(100) / stats.total_bytes).min(99) as i32
            } else {
                0
            };
            let msg = if pct < 5 {
                "Starting torrent download\u{2026}"
            } else {
                "Downloading via torrent\u{2026}"
            };
            let emit_due = progress_emit_due(
                last_pct,
                pct,
                last_emit.map_or(0, |t| t.elapsed().as_secs()),
                TORRENT_PROGRESS_EMIT_SECS,
            );
            if emit_due {
                emit_installer_progress(
                    app_handle,
                    job_id,
                    "downloading",
                    pct as u8,
                    stats.progress_bytes,
                    stats.total_bytes,
                    msg,
                );
                // Live swarm count (aligned with the emit cadence): PEERS =
                // connected live peers, SEEDS = live peers serving data. Noise
                // is gated by the same throttle as the progress emit; `live()`
                // is cheap (borrows the peer registry).
                let (peers, seeds) = torrent
                    .live()
                    .map(|l| {
                        let snap = l.per_peer_stats_snapshot(Default::default());
                        (
                            snap.peers.len() as u32,
                            snap.peers
                                .values()
                                .filter(|p| p.counters.downloaded_and_checked_pieces > 0)
                                .count() as u32,
                        )
                    })
                    .unwrap_or((0, 0));
                emit_installer_network(app_handle, job_id, peers, seeds);
                last_pct = pct;
                last_emit = Some(Instant::now());
            }
        }

        sleep(Duration::from_millis(TORRENT_POLL_MS)).await;
    }
}

/// Post-process the downloaded torrent files, mirroring `download_debrid_package`:
/// auto-run installer → find game exe → extract archive → fallback "files on disk".
/// `delete_archive` removes the downloaded `.rar`/`.zip` after a successful
/// extraction (only meaningful when `auto_extract` is enabled upstream).
fn process_torrent_files(
    app_handle: &AppHandle,
    job_id: &str,
    dest_path: &Path,
    dest_dir: &str,
    delete_archive: bool,
) -> Result<DebridDownloadResult, String> {
    // Effective game root: torrents sometimes ship a single wrapper folder.
    let game_root = flatten_single_root_folder(dest_path);

    // Priority 1: installer / repack-utility present → auto-run installer.
    // Uses the canonical helper (root-first, BFS, skips `_Redist`, depth cap)
    // so a `setup.exe` in a redistributable/nested folder never wins over the
    // repack's real installer at the root.
    if let Some(installer_path) = find_installer_exe_recursive(&game_root) {
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
    if let Some(archive_path) = find_archive_to_extract(&game_root) {
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

        // User asked to remove the archive after a successful extraction.
        if delete_archive {
            match fs::remove_file(&archive_path) {
                Ok(()) => {
                    println!(
                        "[TORRENT][DELETE_ARCHIVE] Removed {}",
                        archive_path.display()
                    );
                }
                Err(e) => {
                    println!(
                        "[TORRENT][DELETE_ARCHIVE] Failed to remove {}: {e}",
                        archive_path.display()
                    );
                }
            }
        }

        // Re-scan after extraction (flatten wrapper again).
        let game_root = flatten_single_root_folder(dest_path);
        if let Some(installer_path) = find_installer_exe_recursive(&game_root) {
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
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if is_excluded_redist_dir(&dir_name) {
                    continue;
                }
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
            if excluded.contains(&name.as_str()) || is_excluded_exe_name(&name) {
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

/// Whether an archive path is the FIRST volume of a RAR5 multivolume set
/// (`Game.part01.rar`, `Game.part1.rar`, `Game.part001.rar`). The extractor
/// (unrar / 7-Zip) must be pointed at the first volume — it auto-follows the
/// remaining `.partNNN.rar` files, so picking the *largest* volume instead can
/// fail or produce a partial extract.
fn archive_is_first_volume(path: &Path) -> bool {
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return false;
    };
    let Some((_, part)) = stem.rsplit_once(".part") else {
        return false;
    };
    part.trim_start_matches('0').parse::<u64>().map(|n| n == 1).unwrap_or(false)
}

/// Recursively find the archive to extract (`.rar` / `.zip`, full path).
///
/// - If any RAR5 multivolume set is present, returns the FIRST volume of the
///   largest such set (the extractor follows the rest).
/// - Otherwise returns the largest single archive (previous behavior).
fn find_archive_to_extract(dir: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !(ext.eq_ignore_ascii_case("rar") || ext.eq_ignore_ascii_case("zip")) {
                continue;
            }
            if let Ok(meta) = path.metadata() {
                if meta.is_file() {
                    out.push((path, meta.len()));
                }
            }
        }
    }

    let mut archives: Vec<(PathBuf, u64)> = Vec::new();
    walk(dir, &mut archives);
    if archives.is_empty() {
        return None;
    }

    let first_volumes: Vec<(PathBuf, u64)> = archives
        .iter()
        .filter(|(p, _)| archive_is_first_volume(p))
        .cloned()
        .collect();

    if first_volumes.is_empty() {
        // No multivolume set: largest single archive (legacy `.r00` sets only
        // expose the `.rar` here, which IS the first volume).
        archives.into_iter().max_by_key(|(_, s)| *s).map(|(p, _)| p)
    } else {
        first_volumes.into_iter().max_by_key(|(_, s)| *s).map(|(p, _)| p)
    }
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

    // ── data stall guard (Fix 1) ──

    #[test]
    fn data_stall_below_threshold_is_not_exceeded() {
        let threshold = TORRENT_DATA_STALL_SECS;
        let first_seen = Instant::now() - Duration::from_secs(threshold - 1);
        assert!(!data_stall_exceeded(first_seen, threshold));
    }

    #[test]
    fn data_stall_at_threshold_is_not_exceeded() {
        let threshold = TORRENT_DATA_STALL_SECS;
        let first_seen = Instant::now() - Duration::from_secs(threshold);
        assert!(!data_stall_exceeded(first_seen, threshold));
    }

    #[test]
    fn data_stall_over_threshold_is_exceeded() {
        let threshold = TORRENT_DATA_STALL_SECS;
        let first_seen = Instant::now() - Duration::from_secs(threshold + 1);
        assert!(data_stall_exceeded(first_seen, threshold));
    }

    // ── progress_emit_due (time-based chart sampling) ──

    #[test]
    fn progress_emit_due_true_on_percent_change() {
        assert!(progress_emit_due(10, 11, 0, TORRENT_PROGRESS_EMIT_SECS));
        assert!(progress_emit_due(-1, 0, 0, TORRENT_PROGRESS_EMIT_SECS));
    }

    #[test]
    fn progress_emit_due_true_when_throttle_elapsed() {
        assert!(progress_emit_due(10, 10, TORRENT_PROGRESS_EMIT_SECS, TORRENT_PROGRESS_EMIT_SECS));
        assert!(progress_emit_due(10, 10, 60, TORRENT_PROGRESS_EMIT_SECS));
    }

    #[test]
    fn progress_emit_due_false_when_unchanged_and_within_throttle() {
        assert!(!progress_emit_due(10, 10, 0, TORRENT_PROGRESS_EMIT_SECS));
        assert!(!progress_emit_due(10, 10, TORRENT_PROGRESS_EMIT_SECS - 1, TORRENT_PROGRESS_EMIT_SECS));
    }

    #[test]
    fn progress_emit_due_first_real_percent_is_due() {
        assert!(progress_emit_due(-1, 0, 0, TORRENT_PROGRESS_EMIT_SECS));
    }

    // ── archive_is_first_volume ──

    #[test]
    fn first_volume_part01_and_part1_and_part001_recognized() {
        for name in ["Game.part01.rar", "Game.part1.rar", "Game.part001.rar"] {
            assert!(
                archive_is_first_volume(Path::new(name)),
                "{name} should be recognized as the first volume"
            );
        }
    }

    #[test]
    fn first_volume_rejects_later_plain_and_zip() {
        for name in [
            "Game.part02.rar",
            "Game.part10.rar",
            "Game.rar",
            "Game.part2.zip",
            "Game.zip",
        ] {
            assert!(
                !archive_is_first_volume(Path::new(name)),
                "{name} should NOT be recognized as the first volume"
            );
        }
    }

    // ── find_archive_to_extract ──

    fn temp_case_dir(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join("lf-torrent-archive-tests");
        let dir = base.join(format!(
            "{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn archive_pick_prefers_first_volume_over_larger_later_volume() {
        let dir = temp_case_dir("multivolume");
        fs::write(dir.join("Game.part01.rar"), "first-volume").unwrap();
        fs::write(dir.join("Game.part02.rar"), "much-larger-later-volume-bytes").unwrap();
        fs::write(dir.join("Game.part03.rar"), "small").unwrap();

        let picked = find_archive_to_extract(&dir).expect("should find an archive");
        assert_eq!(
            picked.file_name().unwrap().to_str().unwrap(),
            "Game.part01.rar",
            "must pick the FIRST volume, not the largest"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_pick_largest_first_volume_when_multiple_sets() {
        let dir = temp_case_dir("multi-set");
        fs::write(dir.join("A.part01.rar"), "aaaa").unwrap();
        fs::write(dir.join("B.part01.rar"), "bbbbbbbbbbbbbbbb").unwrap();
        fs::write(dir.join("B.part02.rar"), "b2").unwrap();

        let picked = find_archive_to_extract(&dir).expect("should find an archive");
        assert_eq!(
            picked.file_name().unwrap().to_str().unwrap(),
            "B.part01.rar",
            "largest first-volume wins across sets"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_pick_largest_single_when_no_multivolume() {
        let dir = temp_case_dir("single");
        fs::write(dir.join("small.rar"), "s").unwrap();
        fs::write(dir.join("big.rar"), "largest-single-archive").unwrap();

        let picked = find_archive_to_extract(&dir).expect("should find an archive");
        assert_eq!(picked.file_name().unwrap().to_str().unwrap(), "big.rar");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_pick_recurses_and_falls_back_to_zip() {
        let dir = temp_case_dir("recursive");
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("nested").join("packed.zip"), "zip-only").unwrap();
        fs::write(dir.join("note.txt"), "not an archive").unwrap();

        let picked = find_archive_to_extract(&dir).expect("should find the zip");
        assert_eq!(picked.file_name().unwrap().to_str().unwrap(), "packed.zip");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn archive_pick_none_when_dir_empty() {
        let dir = temp_case_dir("empty");
        assert!(find_archive_to_extract(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── metadata-fetch timeout (add_torrent bounded) ──

    #[test]
    fn add_metadata_timeout_reuses_connect_guard_budget() {
        // The unbounded `add_torrent` metadata fetch is wrapped in
        // `TORRENT_METADATA_STALL_SECS` so a dead/swarmless magnet fails after the
        // same budget the poll-loop connect guard uses. If this invariant breaks,
        // a magnet with no reachable peers hangs on "Connecting to torrent swarm…"
        // forever again.
        assert_eq!(TORRENT_METADATA_STALL_SECS, 180);
        assert_eq!(TORRENT_METADATA_STALL_SECS, TORRENT_DATA_STALL_SECS + 60);
    }

    // ── completion marker (resume never trusts partial files) ──

    fn marker_test_base(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join("lf-torrent-marker-tests");
        let dir = base.join(format!(
            "{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn marker_file_name_sanitizes_job_id() {
        assert_eq!(
            marker_file_name("debrid-install-abc-123"),
            "debrid-install-abc-123"
        );
        assert_eq!(
            marker_file_name("debrid-install:a/b c"),
            "debrid-install_a_b_c"
        );
    }

    #[test]
    fn torrent_marker_roundtrip() {
        let base = marker_test_base("roundtrip");
        let job = "debrid-install-runix";
        assert!(!torrent_marker_exists(job, &base));
        write_torrent_marker(job, &base);
        assert!(torrent_marker_exists(job, &base));
        remove_torrent_marker(job, &base);
        assert!(!torrent_marker_exists(job, &base));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn torrent_marker_lives_in_session_dir_not_dest_dir() {
        // The marker must never leak into dest_dir, otherwise
        // `flatten_single_root_folder` (which requires the root to contain only
        // the game folder) would fail to flatten because of the loose marker.
        let session_dir = marker_test_base("session");
        let dest_dir = marker_test_base("dest");
        let job = "debrid-install-x";
        write_torrent_marker(job, &session_dir);
        let dest_entries: Vec<_> = fs::read_dir(&dest_dir).unwrap().flatten().collect();
        assert!(
            dest_entries.is_empty(),
            "marker must not be written into dest_dir"
        );
        let _ = fs::remove_dir_all(&session_dir);
        let _ = fs::remove_dir_all(&dest_dir);
    }
}
