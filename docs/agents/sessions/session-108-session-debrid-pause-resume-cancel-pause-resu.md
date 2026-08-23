## Session — Debrid Pause/Resume (Cancel/Pause/Resume for HTTP + torrent installs)

### Goal
Add Cancel/Pause/Resume for Debrid repack installs (HTTP/SteamRip/gofile and torrent via librqbit) with persistence that survives app restart / PC shutdown. Paused downloads resume manually (never auto-restart); a resumed torrent deletes stale partial data from other torrents recorded this session (TS job queue is the single source of truth).

### Decisions (user-confirmed)
- After app restart with active debrid downloads → they show **"Paused" with manual resume**; nothing downloads automatically.
- Resuming a torrent **deletes orphaned partial data** of other torrents remembered this session.
- **Pause/Resume only for `debrid-install` jobs**; Steam installs and others stay cancel-only.
- Pause → the in-flight command returns `DebridDownloadResult { success:false, status:"paused" }` (HTTP) or `Ok(PollOutcome::Paused)` (torrent); resume → re-invokes the same entry point (`download_debrid_package` / `start_torrent_download`). HTTP resumes via `.part`/`.part.meta`; torrent via fastresume + Json persistence.
- **Root-cause bug**: `cancelled_jobs()` was never cleared → `is_job_cancelled` stayed `true` forever and a re-invocation aborted on the first chunk. Fix: `clear_job_flags(job_id)` at the start of `download_debrid_package` and `start_torrent_download` (clears both cancel **and** pause).
- `job_id = debrid-install-${providerGameId}`; `DownloadStatus` already included `"paused"` and `activeStatuses` includes it, so dedup doesn't block resume.

### Part 1 (Rust HTTP) — `debrid_installer.rs`
- `DownloadFileOutcome { File(DownloadedFile), Paused }`; pause tracker `paused_jobs()` + `is_job_paused(job_id)` + `#[tauri::command] pause_debrid_download(job_id)` + `clear_job_flags(job_id)`.
- `download_debrid_package` calls `clear_job_flags(&job_id)`; dispatches `Paused` → emits `emit_installer_progress(..., "paused", 0,0,0, "Download paused")` and returns `Ok(DebridDownloadResult { success:false, status:"paused", message:"Download paused." })`.
- `download_file_to_dest` returns `Result<DownloadFileOutcome, String>`; checks `is_job_paused(job_id)` in the loop (next to cancel) → `drop(file)` + `write_checkpoint` + `Ok(Paused)`.

### Part 2 (Rust torrent) — `torrent.rs`
- New imports: `use std::collections::HashSet;`, `use tokio::time::{sleep, Duration}`, `use crate::utils::progress_utils::emit_installer_progress`, `use tauri::{AppHandle, Manager}`.
- `get_session(&app_handle)` → `Session::new_with_opts(base_dir, opts)` with `base_dir = app_data_dir()/librqbit`, `fastresume: true`, `persistence: Some(SessionPersistenceConfig::Json { folder: Some(base_dir.clone()) })` (removed `disable_dht_persistence`/`persistence: None`).
- `cleanup_orphan_torrents(session, current)`: collects `HashSet` of ids from `active_torrents()`, uses `session.with_torrents(|it| -> Vec<TorrentId>)` and deletes via `session.delete(TorrentIdOrHash::Id(id), true)`.
- `start_torrent_download`: `clear_job_flags(&job_id)`; `get_session(&app_handle)`; `session.unpause(&torrent)` if `stats.state == Paused`; `cleanup_orphan_torrents`; match `poll_result` → `Ok(Done) => process_torrent_files`, `Ok(Paused) => session.pause(&torrent)` + result `status:"paused"` (torrent stays in `active_torrents()`), `Err(e) => session.delete(..., true)` + remove from `active_torrents()`.
- `PollOutcome { Done, Paused }`; `poll_torrent_until_done` returns `Result<PollOutcome, String>` and adds `if is_job_paused(job_id) { return Ok(PollOutcome::Paused); }`.

### Part 3 (TS)
- `src/services/tauri.ts` — `pauseDebridDownload(jobId)` → `invoke("pause_debrid_download", { jobId })`; `DebridDownloadResult.status` union extended with `"paused"`.
- `src/hooks/useDebridInstallSync.ts` — early branch in `handleInstallResult`: `if (!result.success && result.status === "paused")` → `updateJobRef(jobId, { status:"paused", message })` and return (Debrid store untouched).
- `src/context/DownloadQueueContext.tsx` — `loadJobs()` converts active `debrid-install` jobs after reload → `status:"paused", error:undefined, message:"Download paused"` (Steam installs stay `"failed"`); `pauseJob(jobId)` (sets `"paused"`, invokes Rust, reverts on failure); `resumeJob(jobId)` (derives `providerGameId` from `debrid-install-`, sets `"queued"`, re-calls `debridInstallRef.current.startInstall(jobId, providerGameId, job.downloadUrl, "zip", job.gameTitle, job.installMethod)`); exposed in types + provider value.

### Part 4 (UI)
- `src/components/downloads/DownloadJobCard.tsx` — destructured `onPause`/`onResume`; `canPause`/`canResume` (only `debrid-install`; pause when active, resume when `"paused"`); Pause/Play buttons in the action row before Cancelar.
- `src/pages/Downloads.tsx` — `pauseJob`/`resumeJob` destructured; `onPause`/`onResume` passed to both card render sites. `paused` already in the active section filter.

### Tests (4 new in debrid_installer)
- `pause_flag_tracked_and_checked` — pause sets paused flag, paused ≠ cancelled.
- `clear_job_flags_removes_both_cancel_and_pause` — fresh attempt clears both so re-invocation proceeds.
- `clear_job_flags_only_affects_target_job` — other jobs' flags untouched.
- `clear_job_flags_idempotent` — clearing empty state is safe.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — `DownloadFileOutcome`, pause tracker + `clear_job_flags`, `pause_debrid_download` command, dispatch `Paused`, pause check in download loop
- `src-tauri/src/commands/torrent.rs` — persistent session (`get_session(&app_handle)`), `cleanup_orphan_torrents`, `unpause`/`pause`, `PollOutcome { Done, Paused }`
- `src-tauri/src/lib.rs` — `pause_debrid_download` registered (~276-278)
- `src/services/tauri.ts` — `pauseDebridDownload` binding + `"paused"` in `DebridDownloadResult.status`
- `src/hooks/useDebridInstallSync.ts` — `paused` early branch in `handleInstallResult`
- `src/context/DownloadQueueContext.tsx` — `loadJobs()` pause-on-reload, `pauseJob`/`resumeJob`, types + provider value
- `src/components/downloads/DownloadJobCard.tsx` — Pause/Resume buttons
- `src/pages/Downloads.tsx` — wiring

### Build
- `cargo test` ✅ (185 passed / 0 failed; 4 new pause/flag tests)
- `cargo check` ✅ (0 errors; 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings + chunk-size warning)
