## Session � Goldberg dual-DLL apply + Steamless main-exe tier selection

### Goal
1. Make Goldberg apply the fix to ALL present Steam API DLLs (`steam_api64.dll` x64 AND `steam_api.dll` x86), not just one.
2. Implement main-exe selection for Steamless as the user specified: `Win64-Shipping.exe` wins; if the game lacks it, an exe inside a `Win64` folder; else size-based.

### Part 1 � Goldberg dual-DLL (`game_fix.rs`)
- New helper `apply_goldberg_to_present_dlls(game_path, emu_dir, present_dlls, on_progress) -> (Vec<String>, Vec<String>)` � per DLL: `find_file_recursive_bounded` on the emu dir (missing fork copy ? error + continue), then on the game dir (missing real target ? error + continue), `backup_file_if_exists` + `std::fs::copy`. Progress `20 + (i*60/total)`, 100 at the end.
- `library_apply_goldberg` rewritten: keeps the `No steam_api dll found` guard when neither arch is present; builds `present_dlls` from `has_64`/`has_32`; calls the helper; `installed.is_empty()` ? `ok:false` with per-DLL errors; else `write_fix_log(..., &installed)` + emit 100 + message `"Goldberg emulator applied ({applied}). Originals backed up as .bak."`.

### Part 2 � `exe_win64_priority` suffix/parent-folder tier scoring (`game_fix.rs:199`)
- Replaced substring matching with a 5-tier rank: `ends_with("win64-shipping.exe")` ? 4; parent-folder basename lower == `"win64"` ? 3; `name.contains("win64")` ? 2; full parent path `contains("win64")` ? 1; else 0. Same-tier tiebreak = larger size (existing `compare_exes_win64_first`).
- Beneficiaries sharing the comparator: `find_main_exe`, `find_game_exe_dir`, `get_game_imported_dlls`.

### Part 3 � CrashReportClient exclusion (`game_fix.rs:249`)
- `is_non_game_exe` gained `name_lower.starts_with("crashreportclient")` so `CrashReportClient-Win64-Shipping.exe` variants never compete with the real game binary (Kena test case).

### Tests (6 new + updated, game_fix 12 total)
- Updated `exe_win64_priority_ranks_shipping_highest` ? 4/3/2/0.
- `is_non_game_exe_excludes_crash_report_client_prefixes` � prefix rule excludes CrashReportClient but not real shipped binaries.
- `find_main_exe_prefers_shipping_over_server_and_crash_reporter` � Kena: `Kena-Win64-Shipping.exe` (90k) beats `KenaServer-*`, `*-Cmd`, `CrashReportClient-*`.
- `find_main_exe_falls_back_to_exe_inside_win64_folder` � exe in `Win64` wins over larger loose `Launcher.exe`.
- `find_main_exe_falls_back_to_largest_when_no_win64`.
- `goldberg_applies_to_all_present_steam_api_dlls` / `goldberg_applies_surviving_arch_when_one_dll_missing_from_emu` � both DLLs backed up + replaced; a missing fork arch is skipped, not fatal.

### Build
- `cargo test --lib` ? **253 passed / 0 failed** (was 241; +6 game_fix, +6 earlier sessions)
- `cargo check` ? (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `tsc --noEmit` ?? (no TS changes this session)
- `vite build` ?? (no TS changes this session)
