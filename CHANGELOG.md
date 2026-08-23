# Changelog

All notable changes to LumaForge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Startup Configuration System**: Persistent startup mode (Windowed/Maximized/Fullscreen) with `startup-config.json` and tray menu integration.
- **System Tray**: Dynamic tray icon with mode-aware context menu (Desktop/Console), auto-rebuild on mode change.
- **Dynamic Window Sizing**: Window resizes to 55%×75% of primary monitor at boot, with `window-state` plugin preserving position across sessions.
- **Fullscreen Mode**: F11 toggle, fullscreen sync between Desktop and Console modes, `Escape` returns to previous mode.
- **Third-Party Tools Section**: SmokeAPI, Steamless, Goldberg Emulator, Koaloader, Online-Fix with Toggle/Update/Uninstall UI.
- **Data & Services Revamp**: Six external services (SteamGridDB, IGDB, RAWG, TorBox, Real-Debrid, AllDebrid) with badge system (`configured`/`external`/`always`).
- **OpenSteamTool Integration**: Custom third-party tool with enable/disable toggle, auto-download from GitHub, in-game activation.
- **NSIS Installer Polish**: Custom midnight-blue BMP artwork (header, sidebar, uninstaller-header), `currentUser` install mode, LZMA compression, Spanish/English language selector, Start Menu folder, LICENSE display.
- **Auto-Update Foundation**: `tauri-plugin-updater` wired with endpoint placeholder and zero-byte key for future release server integration.
- **FixProgressListener**: Background listener showing success toasts when game fixes (SmokeAPI, Steamless, etc.) complete.
- **Achievement Toast Dedup**: Session-level dedup with 5-minute auto-cleanup to prevent duplicate toasts.
- **Game Session HUD Toggle**: User-facing setting to show/hide the floating gameplay pill.
- **Library Hover Preview**: Steam-style screenshot carousel popup on library card hover.
- **Idle-Phase Bulk Artwork Download**: Background artwork download for all library games after boot idle phase.
- **Debrid Multivolume Support**: Sequential per-file downloads for FitGirl-style repacks with primary-part ordering.
- **Debrid Pause/Resume**: Full pause/resume support for HTTP and torrent installs with persistence across restarts.
- **Torrent Seeds/Peers**: Real-time swarm stats from librqbit on the Active Download Card.
- **Universal Download Manager**: Premium dashboard with ActiveDownloadCard hero, live speed chart, and glassmorphism panels.
- **Console Mode Settings**: Full settings panel with 6 sections (Profile, General, Visuals, Layout, Input, Advanced).
- **Global User Profile**: Discord-style profile modal with avatar/banner presets, accent color, and display name.
- **Fluent Theme**: Windows 11-style Mica-like backdrop with Liquid Glass support.
- **Ambient Background System**: Dynamic game-art backgrounds with image mode, color-dominant mode, crossfade transitions, and intensity levels.
- **Hero Transition Selector**: Three modes (Crossfade/Ken Burns/Focus) for Library, Dashboard, Store, and Console hero transitions.
- **Store Discover Sections**: Rich curated sections (Featured, For You, Top Picks, New & Noteworthy, Genre Rails).
- **SQLite-First Storage**: All game data, playtime, achievements, settings, and caches migrated to SQLite with JSON-to-SQLite one-time migration.
- **Batch Name Writes**: Single SQLite transaction for all boot-time game name updates (eliminates 60-90 sequential IPC calls).
- **Data Change Bus**: Tauri event bus for SQLite→React reactive notifications.
- **Epic Games Library Integration**: Epic installed games detected, mapped, and merged into unified Library grid.
- **Epic Games Launch**: Protocol-based and direct-executable launch with process tracking and playtime.
- **Manual Game Registry**: Create/edit/remove non-Steam games with metadata from IGDB or Steam search.
- **Extension System**: Lua 5.4 sandboxed runtime with `lumaforge.*` API, criteria evaluator, and third-party tool registry.
- **Documentation**: GPL-3.0 LICENSE, premium bilingual README (EN/ES), THIRD_PARTY_NOTICES.md, CHANGELOG.md.

### Fixed
- **Stale hero props on game switch**: Render-phase reset prevents previous game's hero from flashing during async load.
- **Cross-game logo contamination**: Stale-bundle appId guards (3 layers) prevent downloading wrong game's logo.
- **Achievement percent lost on reload**: Snapshot fallback for achievement summary in LibraryGameDetails.
- **Dashboard lastPlayedAt not updating**: `_processDirtyAppIds` now patches playtime and achievement fields.
- **Manual game removal root cause**: `mergeGames` skips stale manual games from `current` to prevent resurrection.
- **Favorite key duplication**: Unified `getFavoriteKey()` + delete-only reconciler for manual games with Steam appIds.
- **Hero flicker (blur-to-sharp)**: Snapshot media paths mapped through `snapshotGameToLibraryGame` + stable hero key via `sameHeroFile`.
- **Logo title flash**: Synchronous render-phase logo resolution + responsive sizing.
- **Store metadata merge**: Batch metadata uses merge instead of replace, preventing skeleton flash.
- **Downloads "Jugar" bypass**: Removed direct game launch, navigates to GameDetails instead.
- **Provider status stale**: Post-snapshot Steam install reconciliation via `scanSteamInstalledGames`.
- **Uninstall detection**: 30-second passive poll detects appmanifest disappearance.
- **Debrid checkpoint resume**: Stable `source_key` prevents CDN rotation from invalidating saved progress.
- **Torrent metadata stall**: `tokio::time::timeout` wraps `add_torrent` to prevent endless swarm connection.
- **RAR5 signature detection**: Expanded magic byte check to include RAR5 format.
- **Gofile download (302→HTML)**: Full `.io` API flow with guest token, website-token, and bearer auth.
- **Download filename os error 3**: `normalize_download_relative_path` preserves nested directory structure.
- **Goldberg dual-DLL**: Apply fix to all present Steam API DLLs (x64 AND x86).
- **Steamless multi-exe**: Runs over every candidate executable (Win64 + root), not just main exe.
- **Multi-volume repack routing**: Sequential per-file downloads instead of single-file torrent fallback.
- **Quicksfv auto-run bug**: Repack utilities never auto-run as game installers.
- **Multi-volume MD5 folder**: Checksum files placed in correct nested directory structure.

### Changed
- **NSIS installer**: Switched from Inno Setup (not supported by Tauri v2) to native NSIS with custom artwork.
- **Uninstaller**: Uses Tauri's default NSIS uninstaller (includes "Delete app data" checkbox).
- **Background job queue**: Formalized P0-P6 priority tiers with idle-phase deferral.
- **Boot performance**: Batch name writes reduce IPC from 60-90 calls to 2 SQLite transactions.
- **Vite upgrade**: Vite 7 → Vite 8.2 (Rolldown bundler, 3× faster builds).
- **Settings simplification**: Removed technical performance tabs, hardcoded auto-sync ON, added HUD toggle.
- **PackageCard hover**: Simplified to image-only with dark overlay, removed dead action buttons.

---

## [0.1.0] — Unreleased

Initial release of LumaForge.
