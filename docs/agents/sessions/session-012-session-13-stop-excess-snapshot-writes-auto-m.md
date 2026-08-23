## Session 13 — Stop excess snapshot writes + auto media repair for all 5 roles

### Problem
Auto media repair only checked cover/landscape. GameDetails auto-repair checked appinfo paths (`canonicalAppInfo?.media?.backgroundPath`) instead of actual disk files — so deleted background/logo/icon files were never detected. Snapshot writes fired per-appId instead of batching. `[MEDIA][GRID_RENDER]`, `[MEDIA][ASYNC_IMAGE]`, `[NAME][DISPLAY]` logs spammed console by default.

### Part 1: detectAndQueueMissingMedia with multi-tier source resolution
- Created `detectAndQueueMissingMedia(appId)` in `gameCacheService.ts:904`
- Checks actual disk files via Rust `resolveGameMediaPaths` (not appinfo paths)
- Resolves source URLs using 4-tier priority chain:
  1. `resolveGameMedia` with store metadata (Steam Store API)
  2. Game metadata direct fields (e.g. `library_logo_image` for logo role)
  3. SteamGridDB artwork (if `steamGridDbArtworkEnabled` + API key in settings)
  4. `mediaSources` (user-configured)
- Queues low-priority downloads via `mediaDownloadQueue` for each missing role
- Dynamic imports avoid circular dependencies
- `[MEDIA][AUTO_REPAIR_SCAN]`, `[MEDIA][AUTO_REPAIR_QUEUE]`, `[MEDIA][AUTO_REPAIR_FAILED]`, `[MEDIA][AUTO_REPAIR_DONE]` diagnostic logs

### Part 2: GameDetails disk check
- `LibraryGameDetailPage.tsx:200-225` — now calls `detectAndQueueMissingMedia` instead of `!!canonicalAppInfo?.media?.backgroundPath` (which was always true when appinfo had a path, even if the file was deleted)
- `[MEDIA][DETAILS_REPAIR] appid=<id> missing=<roles> queued=true` log

### Part 3: Validation log shows all 5 roles
- `gameStore.ts:335-343` — `[BOOT][HEALTH]` now includes `mediaWithBackground` and `mediaWithLogo` (was only `cover`, `landscape`, `icon`)
- `startupSnapshotService.ts:346/382` — hydrate logs show all 5 roles

### Part 4: Snapshot write batching
- `_processDirtyAppIds` logs `reason=media-update` (was missing reason field)
- `[BootSnapshot][WRITE_SKIP] reason=no-dirty-appids` early return when dirtyAppIds empty
- Existing 1000ms debounce + `_coalescedScheduleCount` + `_pendingAfterWrite` retained

### Part 5: Noisy log suppression
- `[MEDIA][GRID_RENDER]` gated behind `DEBUG_MEDIA_GRID = false` (`GameLauncherTile.tsx:188`)
- `[MEDIA][ASYNC_IMAGE]` success log gated behind `window.__DEBUG_ASYNC_IMAGE` (`AsyncImage.tsx:127`)
- `[NAME][DISPLAY]` gated behind `window.__DEBUG_NAME_TRACE` (`LibraryGameDetailPage.tsx:367`)
- `ASYNC_IMAGE_ERROR` kept visible

### Part 6: System tool skip
- `SYSTEM_TOOL_APP_IDS` Set + `isSystemToolApp(appId)` in `gameCacheService.ts:64`
- Covers Steamworks Redistributables, Proton, Steam Linux Runtime
- Both `detectAndQueueMissingMedia` and `executeRepairGameMedia` check it
- `[MEDIA][AUTO_REPAIR_SKIP] appid=<id> reason=system-tool` log

### Key Files Changed
- `src/services/gameCacheService.ts` — `detectAndQueueMissingMedia()`, `isSystemToolApp()`, `SYSTEM_TOOL_APP_IDS`
- `src/pages/LibraryGameDetailPage.tsx` — auto-repair uses `detectAndQueueMissingMedia`, unused `backgroundJobQueue` import removed, `[NAME][DISPLAY]` gated
- `src/services/startupSnapshotService.ts` — hydrate logs show all 5 roles, snapshot write logging
- `src/services/gameStore.ts` — `[BOOT][HEALTH]` includes `mediaWithBackground`, `mediaWithLogo`
- `src/services/backgroundJobQueue.ts` — `executeRepairGameMedia` skips system tools
- `src/components/games/GameLauncherTile.tsx` — `[MEDIA][GRID_RENDER]` gated
- `src/components/common/AsyncImage.tsx` — `[MEDIA][ASYNC_IMAGE]` gated

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes
