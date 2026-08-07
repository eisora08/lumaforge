## Session � Debrid multivolume: primary-part regex fix + ordering guarantee + in-flight download guard

### Problem
A FitGirl-style multivolume repack (setup.exe + several .bin volumes) downloaded/extracted fine but setup.exe never auto-ran. User asked whether a cooldown or a queue-empty check could safely auto-launch setup without the premature-execution bug.

### Feasibility answer
YES � the correct mechanism is **ordering + a deterministic in-flight check**, NOT a cooldown timer (a timer can't distinguish "still downloading" from "finished" and reintroduces the race). The TS loop is already sequential (await per part), so the queue is empty by construction when the primary starts; the ordering fix makes that true even when the primary appears first in the file list.

### Part 1 � pickPrimaryPartIndex regex (root cause)
- useDebridInstallSync.ts � regex /setup|installer|\.exe$/ matched volume names like `setup-1.bin`/`installer.bin` (the `setup`/`installer` alternatives are substring matches). If a .bin appeared after setup.exe in the resolver file list, the "primary part" picked was a .bin -> detect_file_type (Rust) saw Unknown (no RAR/ZIP/MZ magic) -> download failed -> setup.exe never auto-ran.
- Changed to /\.exe$/ (only real executables). Rule: last .exe = primary; else first-volume RAR (fallback intact); else last item. Doc comment updated.

### Part 2 � Ordering guarantee: primary ALWAYS last
- useDebridInstallSync.ts multivolume loop now iterates `[...nonPrimaryIndices, primaryIndex]`: every volume first (autoExtract=false, just saved to disk), the primary LAST (autoExtract=true, reassembles + auto-runs setup).
- Structural guarantee: when setup.exe is downloaded+extracted, all volumes are verified on disk; the queue is empty by construction (sequential await).
- The multivolume log is now always-on (was gated behind DEBUG_DEBRID_INSTALL): `[DEBRID_INSTALL] multivolume files=N primary=<name> jobId=...`.

### Part 3 � Deterministic in-flight guard (Rust, defense-in-depth)
- debrid_installer.rs uto_run_installer � before `spawn_installer_detached`, if `has_partial_install_artifacts(dest_dir)` (non-empty tmp/ = an in-progress .part) returns `needs-setup` with message "Download still in progress - setup will not run until all parts are on disk. Click Install Now to retry." and does NOT spawn.
- Deterministic (no timer); the download removes tmp/ on completion, so a legitimately-finished set always passes and the legit flow is never blocked.

### Tests (2 new in debrid_installer::tests)
- uto_run_installer_skips_spawn_when_download_in_flight � .part present -> needs-setup, no pid, in-flight message.
- uto_run_installer_passes_when_no_partial_artifacts � clean dir -> guard passes through to spawn attempt (nonexistent exe fails fast on spawn, message differs).

### Key Files Changed
- src/hooks/useDebridInstallSync.ts � regex fix, ordering loop, always-on multivolume log
- src-tauri/src/commands/debrid_installer.rs � in-flight guard in uto_run_installer, 2 tests

### Build
- cargo test ? **237 passed / 0 failed** (235 previos + 2 nuevos)
- 	sc --noEmit ? (only pre-existing extension/test errors, none in touched files)
- ite build ? (2.77s, Rolldown; only pre-existing chunk warnings)

