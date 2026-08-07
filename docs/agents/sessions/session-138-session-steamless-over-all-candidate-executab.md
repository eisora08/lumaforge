## Session — Steamless over ALL candidate executables + UnityCrashHandler filter

### Goal
Implement Steamless over EVERY candidate exe (Win64 + root) of the game, not just `main_exe`, and remove the `hasSteamStubDrm` gate from the ToolsModal UI button. Also fix the Kena bug where `UnityCrashHandler64.exe` was not filtered and could be chosen as the main exe.

### Part 1 — `find_candidate_exes` + UnityCrashHandler filter (`game_fix.rs`)
- New `find_candidate_exes(dir) -> Vec<PathBuf>`: `collect_exes_recursive` -> `filter_non_game_exes` -> `sort_by(compare_exes_win64_first)`. `find_main_exe` = `.into_iter().next()` (zero behavior change).
- `is_non_game_exe` now also excludes prefixes `crashreportclient`, `unitycrashhandler`, `crashpad`, `vcredist`, `vc_redist`, `dotnet` and the suffix `unins000.exe`, in addition to `NON_GAME_EXE_NAMES`.
- `filter_non_game_exes`: if ALL exes are non-game, keeps the whole list (repack root with only an installer still has a usable candidate).
- `library_get_game_fix_info`: `has_steam_stub_drm = install_path.map(|p| find_candidate_exes(p).iter().any(|e| has_steamstub_drm(e)))` — now informative across ALL candidates, not just `main_exe_path`.

### Part 2 — `library_apply_steamless` multi-exe loop (`game_fix.rs`)
- Loop over `candidates`: existing `.bak` -> skip (already applied); `Ok(["__no_drm__", _])` -> `no_drm_exes`, continue; `Ok` real -> `files_installed.extend`; `Err` -> `errors.push(format!("{exe_name}: {e:#}"))`. Never aborts on a single exe.
- 4 result cases: files_installed -> ok; only already-applied -> ok; only no-drm -> ok; only errors -> `ok:false` "Failed to apply Steamless to any executable".
- Guard no-windows at top intact. Emits `library://fix-progress` 50 at start (multi-exe) / 100 at end; `write_fix_log` once at the end.
- `library_unfix_steamless` / `library_has_steamless_fix` already iterate `find_bak_files_recursive` / use `!bak_files.is_empty()` — multi-`.bak` support without changes.

### Part 3 — ToolsModal Steamless row (`ToolsModal.tsx`)
- `applicable: nativeInfo.installed` — the `hasSteamStubDrm` gate removed (button unlocked whenever Steamless is installed).
- Hint with 3 branches: SteamStub detected in mainExe / "Steamless will check all candidate executables (Win64 and root)" / no candidates.

### Tests (2 new + 1 fixed; game_fix 14 total)
- `is_non_game_exe_excludes_unity_crash_handler` — lowercase `unitycrashhandler64.exe`/`crashpad_handler.exe`/`crashpadhandler-win64-shipping.exe` -> true; `kena-win64-shipping.exe`/`game.exe` -> false. (Function expects already-lowercased names — the mixed-case initial version failed.)
- `find_candidate_exes_returns_multiple_win64_and_root_exes` — temp tree with `Binaries/Win64/Kena-Win64-Shipping.exe` + `UnityCrashHandler64.exe` + `CrashReportClient-Win64-Shipping.exe`, root `Launcher.exe` -> exactly `["Kena-Win64-Shipping.exe", "Launcher.exe"]` in that order.

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `cargo test --lib commands::game_fix` ✅ 14 passed / 0 failed
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
