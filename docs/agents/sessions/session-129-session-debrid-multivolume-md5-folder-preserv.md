## Session � Debrid multivolume: MD5 folder preservation + repack-utility never auto-run

### Goal
Two layered bugs in the Debrid repack install pipeline: (1) the `MD5` checksum folder was dropped � its files were dumped at the extract root and `MD5/` was never created; (2) repack utilities (`quicksfv.exe`) were auto-run as if they were the game installer.

### Root causes
- **MD5 bug**: multivolume per-file downloads. The resolver returns nested relative paths like `MD5/checksums.md5` (torrents list the checksum folder as separate files), but `download_file_to_dest` routed them through `clean_download_filename` ? `normalize_download_filename`, which keeps only the LAST path segment (`checksums.md5`). The file landed at `dest_dir/checksums.md5`; the `MD5/` parent folder was never created.
- **QuickSFV bug**: `find_installer_exe_in_dir` Priority 2 returned `REPACK_UTILITY_EXES` names (`quicksfv.exe`, `verify.exe`, `md5.exe`, ...). Every auto-run call site (`Step 0`, RAR-extract Priority 1, `torrent.rs`) uses this function, so a leftover checksum tool in the extract root got spawned as if it were the repack installer.

### Part 1 � `normalize_download_relative_path` + nested dest (debrid_installer.rs)
- New `normalize_download_relative_path(name) -> Option<String>` beside `normalize_download_filename`: preserves nested directory structure while sanitizing each component (invalid chars ? `_`, trailing dots/spaces trimmed, reserved-device detection, per-component length caps). Drops `.`/`..` components. Returns `None` for: leading-separator absolute paths (`/abs/...`, `\\abs\\...`), drive prefixes (`C:/...`), flat single-component names, unsafe mid-path components (a component collapsing to `"repack"`), empty.
- `download_file_to_dest`: when the resolver-provided `preferred_filename` yields a nested relative path, sets `dest_path = dest_dir.join(rel)` and `file_name = rel` (drives `.part`/`.part.meta` naming under `tmp/`); otherwise falls back to the flat sanitizer. Adds `create_dir_all(dest_path.parent())` before the completion rename so `dest_dir/MD5/checksums.md5` can be created.

### Part 2 � utilities never auto-run (debrid_installer.rs)
- `find_installer_exe_in_dir` now returns ONLY genuine `INSTALLER_EXE_NAMES` (`setup.exe`, `installer.exe`, `setup_x64.exe`, `setup_x86.exe`, `autorun.exe`). Repack utilities removed from its results � doc updated.
- New `find_repack_utility_exe_in_dir(dir) -> Option<String>` and `has_repack_utility(dir) -> bool` (top-level checks over `REPACK_UTILITY_EXES`).
- RAR-extract no-installer fallback message improved: when `has_repack_utility(&dest_path)` is true ? "Open the folder and run the repack's setup.exe manually" instead of the generic "no executable found" (prevents the false `ready` on a utility-only extract).

### Part 3 � regression tests (8 new)
- `relative_path_preserves_nested_checksum_folder` (exact MD5 bug), `relative_path_flat_name_returns_none`, `relative_path_rejects_abs_and_drive_prefix`, `relative_path_drops_traversal_and_sanitizes_components`, `relative_path_unsafe_component_returns_none`.
- `installer_finder_never_returns_repack_utility` (quicksfv alone ? None from both `find_installer_exe_in_dir` and `find_installer_exe_recursive`, detected only by the dedicated helper), `installer_finder_returns_real_setup_over_utility`, `has_repack_utility_false_when_absent`.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` � `normalize_download_relative_path`, nested dest wiring in `download_file_to_dest`, `find_installer_exe_in_dir` utility removal, `find_repack_utility_exe_in_dir`/`has_repack_utility`, fallback message, 8 tests

### Build
- `cargo check` ? (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ? **235 passed / 0 failed** (227 previos + 8 nuevos)
- `tsc --noEmit` / `vite build` ?? skipped (no TS changes)
