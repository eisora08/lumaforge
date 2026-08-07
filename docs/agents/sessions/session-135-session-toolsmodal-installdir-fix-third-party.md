## Session � ToolsModal installDir fix + third-party tool install bugs (temp dir + .7z assets)

### Problem 1: ToolsModal "Este juego no tiene carpeta de instalaci�n"
- **Diagn�stico**: `SnapshotGame.installPath` is populated by the snapshot build (`startupSnapshotService.ts:1309`), but `snapshotGameToLibraryGame` (`LibraryGamesContext.tsx:639-668`) never mapped it ? games hydrated via the snapshot-fallback boot path (no SQLite cache) had empty `installDir`.
- **Fix**: `snapshotGameToLibraryGame` now maps `installDir: sg.installPath ?? undefined` and `executablePath: sg.installPath ?? undefined`.
- **Merge safety** (`applyGamesSafely`, line 434): `existing.installDir === game.installDir` � incoming snapshot games now carry installDir, so the fresh value wins when it differs from an empty cached one. No regression.
- Unblocks: ToolsModal apply guard (`!game?.installDir`), "Browse Local Files", "Create Shortcut" for snapshot-hydrated games.

### Problem 2: `install_thirdparty_tool` fails with os error 3
- **Root cause**: `tempdir_in(get_app_data_dir()/temp/thirdparty)` at `thirdparty.rs:562` � the parent dir may not exist ? os error 3.
- **Fix**: `create_dir_all(&temp_root)` before `tempdir_in`.

### Problem 3: `goldberg_fork` install fails � no `.zip` asset
- **Root cause**: `Detanup01/gbe_fork` only publishes `.7z`/`.tar.bz2`; the asset filter `ends_with(".zip")` (`thirdparty.rs:250`) never matched ? "No ZIP asset found".
- **Fix**: asset selection prefers `.zip` then falls back to `.7z`; `ReleaseInfo` gained `archive_ext` (`"zip"`|`"7z"`); extraction branches to `extract_rar_via_7z` (shared helper from `debrid_installer.rs`) for `.7z`, else the `zip` crate.

### Key Files Changed
- `src/context/LibraryGamesContext.tsx` � `snapshotGameToLibraryGame` maps `installDir`/`executablePath` from `sg.installPath`
- `src-tauri/src/commands/thirdparty.rs` � `ReleaseInfo.archive_ext`, `.zip`?`.7z` asset fallback, `create_dir_all` before tempdir, `.7z` extraction via 7z CLI

### Build
- `cargo check` (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test --lib` 241 passed / 0 failed
- `tsc --noEmit` (only pre-existing extension/test errors, none in touched files)
