## Session � Torrent resume: never trust partial files (completion marker)

### Problem
Pausing a torrent/torque (librqbit) download and starting it again falsely reported the game as "descargado" and left a broken `setup.exe`. Uninterrupted downloads worked fine; the bug was isolated to the torrent/TorBox path (the steamrip/gofile HTTP path was fine).

### Root cause
The torrent Step 0 short-circuit (`torrent.rs:184-204`) trusted any on-disk installer/game exe as "already installed": it ran `find_installer_exe_recursive(&dest_path)` ? `auto_run_installer(...)`. librqbit writes pieces **in place** into `dest_dir` (no `tmp/` folder like the HTTP path), so a paused mid-download leaves a partial-but-real `setup.exe` (correct name, non-zero size). On resume, Step 0 found that corrupt exe ? auto-ran it ? false "installing/descargado". The HTTP path already had the analogous guard (`has_partial_install_artifacts`), but the torrent path had no interrupt signal.

### Fix
Torrent-specific **completion marker** stored in the librqbit session dir (`<appData>/librqbit/<job_id>.done`), NOT in `dest_dir` (a marker in dest would break `flatten_single_root_folder`, which requires the root to contain only the game folder):

- `torrent_base_dir(app_handle)` � shared resolve/create of the session dir (extracted from `get_session`).
- `marker_file_name(job_id)` � sanitizes the job id for the filename.
- `torrent_marker_path` / `torrent_marker_exists` / `write_torrent_marker` / `remove_torrent_marker`.
- **Step 0 gated**: only short-circuits when the marker exists. Without it (pause/cancel/first run), the short-circuit is skipped and the torrent is actually (re)added/resumed � partial files are re-verified by librqbit piece verification.
- **Marker written** on `Ok(PollOutcome::Done)` after the flush + `session.delete(..., false)`, before the `auto_extract`/`process_torrent_files` branch.
- **Marker removed** on the `Err` cancel/fail path (next to `delete(..., true)` partial cleanup).
- **Pause path unchanged**: no marker ? resume re-adds the magnet.

### Behavior after fix
- Pause ? resume ? Step 0 skipped ? torrent re-added ? real resume/re-download ? only after `Done` does post-processing run ? valid `setup.exe`.
- First-time download ? no marker ? normal flow (same as before).
- Cancelled/failed ? marker removed ? a later attempt re-downloads instead of trusting leftover partials.

### Tests (3 new in torrent::tests)
- `marker_file_name_sanitizes_job_id` � safe filename from alnum/-/_. and sanitized separators.
- `torrent_marker_roundtrip` � write ? exists ? remove ? gone.
- `torrent_marker_lives_in_session_dir_not_dest_dir` � marker never leaks into dest_dir (protects `flatten_single_root_folder`).

### Build
- `cargo check` ? (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ? **227 passed / 0 failed** (224 previos + 3 nuevos)
- `tsc --noEmit` ?? skipped (no TS changes)
- `vite build` ?? skipped (no TS changes)
