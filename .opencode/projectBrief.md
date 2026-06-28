# LumaForge

## Overview
A Tauri (React + Rust) desktop app that serves as a game launcher/library manager with Steam integration, Lua script management, and local executable detection.

## Changes Applied - Session 2026-06-28

### Feat: Add Game Detection Providers
- Added `gameScanFolders: string[]` + `scanLocalGames: boolean` to `AppSettings` type and `SettingsContext` defaults.
- Created Rust `LocalExecutableGame` model + `scan_local_game_folders` command in `commands/game.rs` (depth 3, ignores uninstallers/redist).
- Registered `scan_local_game_folders` in `lib.rs`.
- Created frontend type `localExecutableGame.ts` and Tauri command wrapper.
- Created `src/services/gameDetectionResolver.ts` with `resolveLauncherGames(settings)` pipeline: Steam scan → local folder scan → dedup → metadata resolution → image merge → sort.
- Rewrote `Games.tsx` to use `resolveLauncherGames` on mount, added remove/manual-add for local EXEs, wired filter panel with "Missing Path" option.
- Updated `GamesFilterPanel.tsx` with new `missing-path` install filter option.
- Added Game Scan Folders section to `Settings.tsx`.
- Verified: `cargo check` + `npx tsc --noEmit` both pass.

### Refactor: Unify Global Search Layout Settings & Game Detection
- **TopBar**: Search uses Steam global search on all pages except Store. `onNavigate` prop added.
- **Games.tsx**: Removed `useSearch` dependency. Uses `localQuery` state for page-local filtering.
- **Library.tsx**: Removed `useSearch` dependency. Uses `localQuery` state for page-local filtering.
- **GamesFilterPanel**: Expanded with local search input, sort (Name/Installed First), Grid/List view mode toggle, count display.
- **LibraryFilterPanel**: Expanded with local search input, Grid/List view mode toggle, count display, Updates toggle.
- **Settings.tsx**: Redesigned with centered `PageContainer` + tabbed sections (Paths, Game Detection, Providers, Behavior, Advanced). Game Scan Folders moved to Game Detection tab.
- Verified: `cargo check` + `npx tsc --noEmit` both pass.

### Fix: Wire Global Search and Game Detection

#### Part 1: Global search opens game details directly
- Created `GameDetailsContext` (`src/context/GameDetailsContext.tsx`) — shared state for the currently selected global game.
- Created `GameDetails` page (`src/pages/GameDetails.tsx`) — wraps `StoreGameDetailsPage`, resolves metadata/reviews/artwork for the selected game.
- Added `"game-details"` to `AppPage` type.
- Updated `App.tsx` — wraps `GameDetailsProvider`, adds `game-details` route to render `GameDetailsPage`.
- Updated `TopBar.tsx` — `handleSelectItem` sets game in `GameDetailsContext` and navigates to `"game-details"` page instead of Store.
- Enter key and "View All" still navigate to Store for full search results.

#### Part 3: LibraryFilterPanel updates
- Added `updatesOnly` prop to `LibraryFilterPanel` with a toggle button.
- Added `showUpdatesOnly` state in `Library.tsx` wired through filter logic.
- Reset includes `updatesOnly`.

#### Part 4: Improved Juegos detection error display
- Enhanced error panel with icon, descriptive hints (check Steam path, check Game Scan Folders, run scan again), and Retry button.
- Shows the actual backend error message.

#### Part 6: Rust steam.rs debug logs
- Changed `debug_log` from `cfg!(debug_assertions)`-gated to always-print for diagnostics.
- Added manifest count, installed count, per-library-path logging.
- Added specific debug log for appId 2358720 (manifest path, install path, is_installed).

#### Part 8: Improved dedup in gameDetectionResolver
- Added cross-source dedup: local games with same normalized title as an existing Steam game are skipped.
- Uses both `seenIds` (by game ID) and `seenTitles` (by lowercase title) for dedup.

## Architecture Notes
- VDF parser in `steam.rs` uses depth-tracking state machine for `libraryfolders.vdf`.
- Metadata caching under `lumaforge-steam-app-metadata-cache-v3`.
- Game detection pipeline: `gameDetectionResolver.ts` logs at each step.
- `scan_local_game_folders` ignores: `unins*.exe`, `uninstall*.exe`, `setup.exe`, `installer.exe`, `crashreporter.exe`, `helper.exe`, `_CommonRedist/`, `_Installer/`.
- Global search uses `GameDetailsContext` to lift selected game state from `TopBar` to `GameDetails` page.
- Library page now supports `updatesOnly` filter alongside existing filters.
