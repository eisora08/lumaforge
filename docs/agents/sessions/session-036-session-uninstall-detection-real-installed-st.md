## Session — Uninstall Detection + Real Installed State Fix

### Problem 1: onInstalled created fake/incomplete installed state
When Steam finishes installing a game, the `onInstalled` handler only patched `steamInstalled=true`, `isPlayable=true`, `isInstallable=false` — never populated `installDir`, `libraryPath`, `source`, `sizeOnDisk` from the actual appmanifest. Open installation directory, play actions, and sidebar snapshot resolution all broke.

### Fix 1: Real installed pipeline re-ingestion
- **Rust `check_steam_game_installed` enhanced** — added `name`, `size_on_disk`, `last_updated` fields to `SteamGameInstallStatus`; populated from `parse_appmanifest` in both return paths
- **TS `SteamGameInstallStatus` type** — matching `name`, `sizeOnDisk`, `lastUpdated` fields
- **`onInstalled` handler rewritten** as 6-phase pipeline:
  1. Call `checkSteamGameInstalled(appId, steamRoot)` for real appmanifest data
  2. Build `LibraryGame` with `installDir`, `libraryPath`, `source="steam"`, `sizeOnDisk`, `lastUpdated`
  3. Update React state via `updateGame` (sync)
  4. Persist to SQLite via `saveCachedGames`
  5. Update game store via `setReconciledGames` — prevents stale boot reconciliation
  6. Schedule snapshot write with 100ms delay via `scheduleSnapshotWrite(..., "install-detected")`
- Lua metadata preserved explicitly: `luaScripts`, `hasLua`, `isLuaActive`, `isLuaDisabled`, `hasLuaSource` spread from existing game
- `[INSTALL_REAL]` diagnostic logs for all phases: detected, steam-scan, canonical-built, merge-preserve-lua, sqlite-write, reconciled-write, snapshot-dirty, install-dir-action, play-action

### Problem 2: No uninstall detection
When a Steam game is uninstalled outside LumaForge (appmanifest deleted from Steam library folder):
- `installTrackerService` stopped polling (only checks actively-downloading games, 3s interval, stops on install)
- `resolveLibraryGames` + `mergeGames` in cached/reconciled-update mode preserves existing games — never detects disappearance
- Downgrade guard (`[INSTALL_STATE] downgradeBlocked`) prevents owned-only merge from setting `steamInstalled=false`
- Zero uninstall detection exists anywhere — sidebar shows uninstalled games permanently until restart or full manual refresh

### Fix 2: Periodic uninstall poll in LibraryGamesContext
- **30s interval + 5s initial delay** — balanced between responsiveness and CPU usage
- **Single Rust command per cycle**: `scanSteamInstalledGames({ steamPath: steamRoot })` — reads all appmanifest files across all library folders in one invoke (<50ms for 80+ games)
- **Games read AFTER scan** to capture any interleaved installs that completed during the async scan
- **Set-difference comparison**: build Set of currently-installed appIds from scan result, compare against `gamesRef.current` games with `steamInstalled=true`
- **Full 5-layer persistence** per missing appId:
  1. `updateGame(appId, {...})` — React state (sync, React 18 auto-batches)
  2. `saveCachedGames(updatedGames)` — SQLite cache
  3. `setReconciledGames(updatedGames)` — game store for boot reconciliation
  4. `scheduleSnapshotWrite(..., "uninstall-detected")` — snapshot with 100ms delay
- **Clears**: `steamInstalled=false`, `isInstallable=true`, `isPlayable=false`, `installDir`, `libraryPath`, `sizeOnDisk`, `lastUpdated`
- **Preserves**: `source`, `title`, Lua metadata, `steamLastPlayedAt`, `steamPlaytimeMinutes`, `achievementTotal`, `isFavorite`
- **Sidebar auto-updates**: reads `useLibraryGames()` → `games` state filtered by `isSidebarInstalledGame(game)` which checks `steamInstalled===true` — React re-render removes game instantly
- **Guard flag**: module-level `running` bool prevents overlapping scan cycles
- **Cleanup on unmount**: `clearInterval` + `clearTimeout` — no leaks
- **`[UNINSTALL][DETECT]`** log per appId with title; **`[UNINSTALL][DONE]`** log with count
- **Edge cases handled**:
  - No `steamRoot` → skip silently
  - No installed games → return early
  - Scan failure → try again next interval
  - Multiple games uninstalled between polls → all detected in one cycle, single persistence batch
  - Downgrade guard doesn't re-lift: guard only fires when incoming ownership merge has `steamInstalled=false` while current has `steamInstalled=true`; uninstall handler explicitly sets through `updateGame` which is a direct mutation, not a merge path
  - Owned games remain in library as owned-only (uninstalled) — not removed completely
  - Non-owned games naturally removed from library when uninstalled (no owned-entry fallback)

### Key Files Changed
- `src-tauri/src/commands/steam.rs` — `SteamGameInstallStatus` enhanced with `name`, `size_on_disk`, `last_updated`
- `src/services/tauri.ts` — `SteamGameInstallStatus` type with matching fields
- `src/context/LibraryGamesContext.tsx` — `onInstalled` handler rewritten as real pipeline (lines 690-782); new uninstall detection effect (lines 784-876)

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (no errors)
- `cargo check` ✅ (no errors)
