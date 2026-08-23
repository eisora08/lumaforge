## Session 4 — Unify all surfaces to use canonical title/media resolvers

### Goal
Unify Dashboard, Grid, GameDetails to use same canonical appinfo/title resolvers, eliminating inconsistent placeholders and the "Refresh Artwork needed" bug.

### Part 1: Helpers in gameCacheService.ts
- `isPlaceholderSteamTitle(title, appId)` — returns true if title matches `/^Steam App \d+$/`
- `resolveCanonicalDisplayTitle(appId, game, appInfoEntry, canonicalInfo)` — title priority: canonical name → appInfoEntry.name → game.metadata.name → game.title (if not placeholder) → `"Steam App ${appId}"`

### Part 2: Dashboard sections use resolveGameMediaUrl + canonical title
All 5 dashboard sections (ContinuePlaying, Favorites, TopPlayed, LuaReady, Library) now:
- Replace inline `localPathToUrl(imgPath)` with `resolveGameMediaUrl(appId, imgPath)` async effect (handles relative `media/` paths)
- Replace `{game.title}` with `resolveCanonicalDisplayTitle` fallback
- Add `[MEDIA][DASH]` diagnostic logs

### Part 3: loadGameAppInfoWithMediaFallback re-scans disk post-repair
When session cache has insufficient media (missing background/logo/icon), and `isAppInfoRepaired` is true:
- New code after repair block does targeted `resolveGameMediaPaths` check for missing roles
- If new files found on disk, updates appinfo.json, invalidates canonical cache, notifies watcher, and updates session cache
- Fixes the "Refresh Artwork needed" bug where files appeared after repair was marked complete

### Part 4: Non-installed games title hydration
- `LibraryGameDetailPage.tsx` detailTitle → uses `resolveCanonicalDisplayTitle` with canonicalAppInfo
- `LibraryGameDetails.tsx` detailTitle → uses `resolveCanonicalDisplayTitle` with canonicalAppInfo
- `GameHero.tsx` hero title → uses `resolveCanonicalDisplayTitle` fallback
- All surfaces now share the same title priority chain

### Part 5: Diagnostic logs added
- `[MEDIA][DASH]` — each dashboard section log per rendered card
- `[MEDIA][DETAILS_CANONICAL]` — per-source logs in getHeroImageUrl fallback chain
- `[MEDIA][DETAILS_RENDER]` — LibraryGameDetails render log with media state
- `[MEDIA][HERO]` — GameHero background/title resolution log
- `[NAME][DISPLAY]` — LibraryGameDetailPage title resolution log
- All build clean: `tsc --noEmit` ✅, `vite build` ✅

### Key Changes
- Snapshot game sections no longer pass relative paths to `localPathToUrl` (which returned null for `media/` prefix)
- Non-installed games get real names from canonical appinfo instead of "Steam App <appid>"
- Dashboard sections auto-resolve relative media paths asynchronously on mount
- Post-repair disk re-scan catches media files that appeared after `isAppInfoRepaired` was set

## Previous sessions below (for context)<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="todowrite">
<｜｜DSML｜｜parameter name="todos" string="false">[{"priority":"high","content":"Add isPlaceholderSteamTitle and resolveCanonicalDisplayTitle helpers to gameCacheService.ts","status":"completed"},{"priority":"high","content":"Patch 6 dashboard sections to use resolveGameMediaUrl + canonical title fallback","status":"completed"},{"priority":"high","content":"Patch GameDetails/loadGameAppInfoWithMediaFallback to re-scan disk for new files after repair","status":"completed"},{"priority":"medium","content":"Fix non-installed games title hydration","status":"completed"},{"priority":"medium","content":"Add diagnostic logs per spec ([MEDIA][DASH], [MEDIA][DETAILS_CANONICAL], etc.)","status":"completed"},{"priority":"high","content":"Run tsc --noEmit and vite build to verify","status":"completed"},{"priority":"low","content":"Review final changes and update AGENTS.md","status":"completed"}]
- Added `app_id: String` parameter to `validate_snapshot_media_paths` command
- `snapshot_media_path_exists()` helper resolves `media/*` and `img/*` against `<appData>/games/steam/<appId>/media/`
- Handles `.tmp` stripping, HTTP/S, `data:`, `asset://`, `file://` paths
- Logs `[BootSnapshot] validated relative media appid=<appid> path=<path> exists=true|false`
- Made `get_game_dir`, `get_media_dir`, `safe_filename` pub in `game_cache.rs`; imported in `startup_snapshot.rs`

### Part 2: Frontend passes appId to validate_snapshot_media_paths
- TS binding `validateSnapshotMediaPaths(appId, media)` now accepts `appId` as first arg
- Updated local wrapper in `startupSnapshotService.ts` to accept `appId` and pass to Rust
- Fixed all 8 call sites: `setMediaStatusOnGame`, `resolveMediaForSnapshot` (x2), `hydrateStartupSnapshotMedia`, `buildStartupSnapshotFromCurrentState` (x3), `gameStore.ts` health validation

### Part 3-6: Verified already-working or naturally handled
- BootSnapshot stripping logs now emit `exists=true` for valid relative paths
- `repair_appinfo_media_paths` already uses `media_path_exists_for_app` (relative-aware)
- `flushAppInfoUpdates` already calls `notifyMediaUpdated(appId)`
- Hydration on next boot re-validates with fixed logic, fixing old stripped snapshots

### Part 7: hydrateStartupSnapshotMedia repairs Steam App placeholders
- `needsTitle` changed from `!game.title` to `!game.title || game.title.startsWith("Steam App ")`
- Boot hydration now detects placeholder titles and replaces them with canonical appinfo names

### Part 8: Achievement background jobs skip no-summary gracefully
- `executeEnsureAchievementImages` now logs `[ACH][IMG_JOB] skipped appid=<id> reason=no-summary` and returns instead of throwing
- Prevents mass failed jobs in background job panel for apps without achievement schemas

### Part 9: AchievementIcon appId — verified all call sites pass it
- Confirmed `AchievementsModal.tsx:923/1184`, `LibraryGameDetails.tsx:1355/1436` all pass `appId`

## Key Decisions
- **Enhance, don't replace**: `MediaIndex` uses existing `resolvedMediaSessionCache` + `resolvedSrcCache` — no second resolver
- **Manifests over scans**: Per-game `media_manifest.json` avoids scanning media folder on startup
- **Fingerprints over force**: `luaFingerprint`/`appinfoFingerprint` fields allow `luaFingerprintChanged` detection without diffing
- **Coalescing over banning**: Background sync re-entry now coalesces with single follow-up
- **5-min TTL**: Librarycache listing cached, avoided repetitive `list_librarycache_appids` calls

## Critical Context
- `ResolvedGameMedia` uses `*Src` suffix fields; `executeRepairGameMedia` was fixed to use them
- `validateSnapshotMediaPaths` returns snake_case exists fields
- `localPathToUrl` returns null for relative paths; callers must resolve via `resolveRelativeMediaPath` first
- `GameMediaSources` in TS: 5 fields (landscape/cover/background/logo/icon)
- `update_game_appinfo_media` accepts `media_sources: Option<GameMediaSourcesInput>` with merge logic
- `hydrateStartupSnapshotMedia` mutates snapshot in-place, batch-reads canonical appinfos
- `seedResolvedMediaCacheFromSnapshot` seeds path cache; `seedMediaIndexFromStartup` seeds URL cache + MediaIndex
- `resolveGameMediaUrl(appId, path, provider)` resolves relative paths, skips `.tmp` files; not a high-level fallback function
- `AchievementIcon` now requires `appId` prop for relative path resolution via `resolveGameMediaUrl`
- Snapshot dashboard sections (ContinuePlaying, Favorites, TopPlayed, LuaReady) use pre-resolved absolute paths from snapshot hydration — `localPathToUrl` is safe for those
- `media_path_exists_for_app` Rust helper is used by `update_game_appinfo_media` and `repair_appinfo_media_paths` to avoid re-downloading existing files

## Key Files
- `src-tauri/src/models/game_cache.rs` — MediaManifest structs + FileFingerprints, media_path_exists_for_app helper
- `src-tauri/src/commands/game_cache.rs` — read/write/get_media_manifests_batch commands
- `src/services/tauri.ts` — MediaManifest types + bindings
- `src/services/gameCacheService.ts` — MediaIndexEntry type, mediaIndexStore, seedMediaIndexFromManifests, seedMediaIndexFromStartup, generateMediaManifest, resolveGameMediaUrl helper
- `src/services/backgroundJobQueue.ts` — executeValidateCacheHealth, generateMediaManifest call in repair, validate-cache-health job type, settings key fixes
- `src/services/gameStore.ts` — validateStartupCacheHealth, __validateStartupCacheHealth exposure, "Steam App" name skip
- `src/services/startupSnapshotService.ts` — SnapshotIndexes fingerprint fields
- `src/services/appBootCoordinator.ts` — fingerprint logs, MediaIndex seeding, validateStartupCacheHealth after boot
- `src/services/mediaDownloadQueue.ts` — notifyMediaUpdated call in flushAppInfoUpdates
- `src/components/common/AchievementIcon.tsx` — appId prop for relative path resolution
- `src/components/dashboard/GameHero.tsx` — iconPath fallback, mediaCheckDoneRef reset, [MEDIA][HERO] logs
