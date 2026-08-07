## Session — Debrid torrent post-process fixes (Part A: multivolume routing + Part B: installer/volume selection)

### Goal
Fix the FitGirl-via-debrid install pipeline after the integrated torrent client was introduced: multivolume repacks were resolving to a single direct link (only the first `.bin` downloaded) instead of routing through the torrent client, and the torrent post-process picked wrong installers/misplaced files.

### Part A — Multivolume repacks route to torrent client (completed, validated)
- **Root cause**: `DebridResolveResult` only exposed `resolved_url: Option<String>`; TorBox used `torbox_largest_file` (single largest file) and Real-Debrid used `.first()` → multivolume repack resolved to only its first part.
- **Rust** (`debrid_resolver.rs`):
  - `DebridResolveResult` gained `resolved_urls: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`) and `file_count: Option<usize>`.
  - Helper `torbox_usable_files` collects non-sample/non-metadata TorBox files; when >1, `file_count = Some(usable.len())` and `picked = Some((0, name, size))` (whole-torrent); single file → `file_count = Some(1)`.
  - Real-Debrid magnet: enumerate `torrents/links/{id}` → `all_links: Vec<String>` + `file_count = Some(len)` when several. WebDL (direct-HTTP, single-file) keeps `resolved_urls::new()`, `file_count: None`.
- **TS**: `DebridResolveResult` type gained `resolvedUrls?`/`fileCount?` (`debridProviderService.ts:14-25`); `resolveInstallUri` returns `{ url, fileName?, fileCount? }` (`useDebridInstallSync.ts:74-82`); `startInstall` routes to `startTorrentDownload` when `resolved.fileCount > 1` and `downloadUri.startsWith("magnet:")` (~line 475).

### Part B — Torrent post-process: installer + volume selection (B1 done, B2 pending)
- **B1a — installer selection uses canonical helper**: local `find_installer_file_recursive` in `torrent.rs` was a naive DFS that did NOT skip `_Redist` nor prefer the root → could pick a redistributable's `setup.exe` over the repack's real installer (misplaced files, "setup.exe que no funciona"). Replaced all 3 call sites (short-circuit step 0, `process_torrent_files` Priority 1, post-extraction re-scan) with the canonical `find_installer_exe_recursive` (root-first, skips `_Redist`, depth cap) from `debrid_installer.rs`; removed the local function + the now-unused `INSTALLER_EXE_NAMES`/`REPACK_UTILITY_EXES` imports.
- **B1b — multivolume RAR extraction picks the first volume**: unrar/7-Zip must be pointed at the FIRST volume of a `Game.partNNN.rar` set (auto-follows the rest); picking the largest fails/partial. New `archive_is_first_volume(path)` (`rsplit_once(".part")` on the stem, trims leading zeros, parses u64, `== 1`; covers `part01`/`part1`/`part001`). `find_largest_archive_recursive` → `find_archive_to_extract`: if any RAR first-volumes exist, returns the largest of them; otherwise the largest single archive (legacy `.r00` sets only expose the `.rar`, which IS the first volume).
- **B2 — pending** (`debrid_installer.rs:1162` `spawn_installer_detached`): validate the installer spawn + working dir for the actual "setup.exe que no funciona" symptom. Not started.
- **Canonical helpers (verified)**: `REPACK_UTILITY_EXES` `:2517`; `INSTALLER_EXE_NAMES` `:2525` (`setup.exe`, `installer.exe`, `setup_x64.exe`, `setup_x86.exe`, `autorun.exe`); `find_installer_exe_in_dir` `:2535` (priority setup.exe → other installers → repack utilities); `auto_run_installer` `:1118` (detached spawn; success → `status:"installing"` + `installer_pid`; failure → `status:"needs-setup"` + `installer_path`; after installer exit re-scans via `find_largest_exe_in_dir` `:1102`); `flatten_single_root_folder` `:2314`.
- **TS poll loop**: `pollInstallerUntilDone` (`useDebridInstallSync.ts:165`) polls `checkInstallerStatus({ pid, installDir })`; `"ready"` → `updateDebridGame(...)`; `"needs-path"` → registry auto-detect.
- **Pipeline** `process_torrent_files`: `flatten_single_root_folder` → Priority 1 installer (`auto_run_installer`) → Priority 2 largest game exe → Priority 3 archive extraction → `delete_archive` → re-scan.
- **Kill-switch**: `DEBRID_TORRENT_ENABLED = true` (`torrent.rs:37`).

### Tests
- 7 new regression tests in `torrent.rs`: `archive_is_first_volume` (part01/part1/part001 recognized; later/plain/zip rejected) + `find_archive_to_extract` (prefers first volume over larger later volume, largest first-volume across sets, largest single archive, recursive zip fallback, empty dir → None). Use temp-dir fixtures with `SystemTime`-based unique names.
- Full suite: **210 passed / 0 failed** (203 previos + 7 nuevos).

### Build
- `cargo check` ✅ (0 errors; only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ✅ 210 passed / 0 failed

