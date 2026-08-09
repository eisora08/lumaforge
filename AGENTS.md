# LumaForge Cache-First Architecture — Agent Summary

## Goal
Implement cache-first startup, formalized MediaIndex, per-game media manifests, precomputed snapshot state, incremental updates, background job priority rules, and cache health validation — without duplicating existing infrastructure.

## Core Audit (Phase 0)
All 9 items from the previous AppInfo/media prompt were confirmed **done**:
- ✅ appinfoContract — full media paths + mediaSources in Rust/TS
- ✅ mediaResolver — resolveRelativeMediaPath, resolveMediaPaths, localPathToUrl
- ✅ dashboardFallback — landscapePath > coverPath > backgroundPath > placeholder
- ✅ sidebarFallback — icon > cover > landscape > background via pickSidebarSrc
- ✅ detailsFallback — background > landscape > remote > cover > fallback
- ✅ mediaRepair — reads mediaSources, downloads only HTTP URLs
- ✅ startupHydration — hydrateStartupSnapshotMedia, appinfo only, no downloads
- ✅ syncCoalescing — _syncRunning/_syncPending guard, single follow-up
- ✅ librarycacheIndexCache — 5-min TTL, invalidated on watcher start

## What was implemented

### Phase 2: MediaIndex formalized
- `MediaIndexEntry` type with `*Path`, `*Url`, `has*` fields + `updatedAt`
- `mediaIndexStore` (Map<string, MediaIndexEntry>) alongside existing `resolvedMediaSessionCache`
- `getMediaEntry(appId, provider)` / `setMediaEntry()` / `getAllMediaEntries()` / `seedMediaIndexFromManifests()`
- `seedMediaIndexFromStartup(appIds)` — batch-reads manifests, resolves URLs, seeds index
- Seeded during boot Stage 6, with `[MEDIA_INDEX]` log diagnostics
- Never persisted; *Url fields are runtime-only

### Phase 3: Per-game media_manifest.json
- Rust struct `MediaManifestFile` + `MediaManifestFiles` + `MediaManifestEntry` + `FileFingerprints`
- Rust commands: `read_media_manifest`, `write_media_manifest`, `get_media_manifests_batch`
- TS types: `MediaManifest`, `MediaManifestFiles`, `MediaManifestEntry`, `FileFingerprints`
- TS bindings: `readMediaManifest`, `writeMediaManifest`, `getMediaManifestsBatch`
- `generateMediaManifest(appId, media)` in gameCacheService.ts — uses existing `getGameMediaPaths` for file-existence checks
- Manifest generation called at end of `executeRepairGameMedia` (backgroundJobQueue.ts)
- `[MEDIA][MANIFEST] written appid=` log on generation

### Phase 4: Precomputed dashboard state
- Startup snapshot already contains sidebar items + lastKnownStats
- Fingerprint fields added to SnapshotIndexes: `luaFingerprint`, `appinfoFingerprint`, `dashboardFingerprint`
- Freshness check uses `updatedAt` + 24h TTL

### Phase 5: Startup fingerprints + freshness
- `[BOOT][CACHE] luaFingerprintChanged` / `mediaFingerprintChanged` / `fingerprintBaseline` logs in boot Stage 3
- Fingerprint fields in SnapshotIndexes type
- `startupSnapshotInfo` overlay not needed — `updatedAt` field handles freshness

### Phase 6: Incremental updates
- Stable keys for job dedup: `type:provider:appId`
- `[JOB] queued key=` / `[JOB] started key=` / `[JOB] complete key= elapsed=ms`
- `[JOB] skipped duplicate key=` for dedup
- `[MEDIA][MANIFEST]`, `[MEDIA_INDEX]`, `[MEDIA][REPAIR]` all use stable key logging pattern

### Phase 7: Background job queue enhancements
- `validate-cache-health` job type + handler (`executeValidateCacheHealth`)
- Queue already has: priority-based sorting, 30s completed TTL, key-based dedup, `[JOB]` logging
- Priority ranks: high=0, normal=1, low=2

### Phase 8: Repair mediaSources
- Already done (confirmed in audit) — `executeRepairGameMedia` reads `mediaSources` remote URLs

### Phase 10: Validation functions
- `validateStartupCacheHealth()` in gameStore.ts — reports snapshotGames/sqliteGames/storeGames/luaGames/jobsQueued/mediaIndexEntries/mediaWithCover/mediaWithLandscape/mediaWithIcon
- Exposed as `__validateStartupCacheHealth` on window
- Runs automatically after boot completion via `scheduleAfterMain`
- `validateMediaCacheHealth()` already existed and is enhanced

### Boot Coordinator updates
- Stage 3: fingerprint logs (`luaFingerprintChanged`, `mediaFingerprintChanged`, `fingerprintBaseline`)
- Stage 6: seeds MediaIndex from manifests + `[MEDIA_INDEX]` diagnostics
- After boot: `validateStartupCacheHealth()` runs automatically

## Build Status
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

## Session 2 — Media fallback integrity fixes

### Part 1: resolveGameMediaUrl helper
- `resolveGameMediaUrl(appId, path, provider)` in gameCacheService.ts — resolves relative paths (`media/`, `img/`) via `resolveRelativeMediaPath` then `localPathToUrl`; handles `.tmp`, HTTP/S, `asset://`, `data:`, `file://`, and absolute paths
- `[MEDIA][RESOLVE]` log for verbose mode

### Part 2: GameHero.tsx fallback + logging
- Added `iconPath` to hero fallback chain (was missing)
- Added `[MEDIA][HERO]` diagnostic logs for landscape/cover/background/icon each tagged `selected=Y|N`
- Simplified `src` assignment with `resolveGameMediaUrl`

### Part 3: SidebarLibraryList.tsx retry logic
- Retries media fetch when `canonicalInfoMap` becomes populated after initial load
- Always removes from `sidebarMediaLoading.current` in `finally` block (was missing on error path)

### Part 4: seedResolvedMediaCacheFromSnapshot repair grip
- Only marks game as "repaired" when snapshot has landscape AND (cover OR background) — not just for any single path

### Part 5: loadGameAppInfoWithMediaFallback cache trust
- Does NOT trust incomplete snapshot cache; missing background/logo/icon triggers cache invalidation and repair instead of returning broken snapshot data

### Part 6: Rust media_path_exists_for_app
- `media_path_exists_for_app(app_id, media)` helper in `game_cache.rs` — checks which media paths exist on disk
- Used by `update_game_appinfo_media` and `repair_appinfo_media_paths`

### Part 7: notifyMediaUpdated in flushAppInfoUpdates
- Added `notifyMediaUpdated()` call in `mediaDownloadQueue.ts` `flushAppInfoUpdates` so dashboards react immediately after downloads

### Part 8: mediaCheckDoneRef reset on game switch
- `GameHero.tsx` now resets `mediaCheckDoneRef` when `selectedGame.appId` changes, allowing re-check

### Part 9: Skip "Steam App <appid>" placeholder names
- `updateAppInfoFromGames` in gameStore.ts skips names matching `/^Steam App \d+$/`

### Part 10: AchievementIcon relative path resolution
- `AchievementIcon` accepts `appId` prop; resolves relative `img/` paths via `resolveGameMediaUrl`
- Fixed 3 call sites: `AchievementsModal.tsx`, `LibraryGameDetails.tsx`, `AchievementTooltip.tsx`

### Part 11: Achievement image normalization verified
- `normalizeAchievementImagePath` already normalizes to `img/<file>` correctly — no changes needed

### Part 12: Fix settings keys
- `settings.steamApiKey` → `settings.steamWebApiKey`
- `settings.steamPath` → `settings.steamRoot`
- Both fixes in backgroundJobQueue.ts

### Part 13: TSC fixes in AchievementsModal.tsx
- Added `appIdStr` prop to `GlobalAchievementsTab` and `AchievementGroupsTab` component types (was missing, caused TSC/vite errors)

## Session 3 — Snapshot validation strips valid relative media paths

### Part 1: Rust validate_snapshot_media_paths — appId-aware resolution
- Already implemented (see above). 

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

## Session 5 — Title enrichment doesn't run when games are in SQLite

### Problem
The name enrichment code written in Session 4 (`appBootCoordinator.ts:303-358`) was inside the `if (missingFromSqlite.length > 0)` block. When games already exist in SQLite from a prior scan, reconciliation is skipped (`missingFromSqlite` is empty), so name enrichment never runs. This means placeholder titles ("Steam App <appid>") never get resolved for the common case of returning users.

### Root Cause
- Stage 4.5 reconciliation only runs when games are missing from SQLite
- Name enrichment was gated on reconciliation
- `rebuildLibraryIndex` (gameStore.ts:453) has zero callers — dead code
- Dashboard sections call `resolveCanonicalDisplayTitle(appId, game)` with only 2 args (no canonicalInfo), so they only see `game.title` from snapshot — if snapshot wasn't enriched, placeholders persist

### Fixes

#### Part 1: Move enrichment outside the `if (missingFromSqlite.length > 0)` block
- `appBootCoordinator.ts` — Restructured Stage 4.5 to always run name enrichment regardless of whether reconciliation was needed
- New `else` branch when `missingFromSqlite.length === 0`: reconstructs games from SQLite index via `indexEntryToLibraryGame`, then runs the same enrichment pipeline
- Enrichment sources (in priority order): canonical appinfo → `resolveGameMetadata` (new) → `getStoreDetails`
- Writes resolved names to canonical appinfo via `updateGameAppinfoMedia` and updates the in-memory snapshot

#### Part 2: Add Stage 3.5 enrichment (before UI renders)
- New boot task `"enrich-snapshot-titles"` added to `BootTaskId` type
- Runs right after snapshot hydration (Stage 3), before SQLite loading (Stage 4)
- Resolves placeholder titles on snapshot games via `resolveGameMetadata` → `getStoreDetails`
- Saves the enriched snapshot to disk via `saveStartupSnapshot`
- Ensures dashboard sections see real names from the start (before `Home.tsx` memoizes the snapshot)

#### Part 3: Remaining enrichment in Stage 4.5 serves the library grid
- Writes resolved names to canonical appinfo → `appinfo.json` on disk
- `GameLauncherTile` reads canonical appinfo via `loadGameAppInfoWithMediaFallback` (deferred until viewport)
- `resolveCanonicalDisplayTitle(appId, game, appInfoEntry, canonicalInfo)` with 4 args uses `canonicalInfo.name` as top priority

### Key Changes
- **`appBootCoordinator.ts`**: Stage 3.5 enrichment added; Stage 4.5 restructured to always run enrichment; `enrich-snapshot-titles` added to `BootTaskId`
- **Dashboard sections**: Get real names immediately because snapshot game.titles are enriched before UI renders (Stage 3.5)
- **Library grid**: Gets real names deferred — `loadGameAppInfoWithMediaFallback` reads enriched `appinfo.json` when card enters viewport
- **`GameLauncherTile.tsx`**: `resolveCanonicalDisplayTitle` with `canonicalInfo.name` as top priority — already works correctly

## Session 6 — Achievement Gray Icon Duplicate Fix

### Problem
`resolveImageSource` for `remote-url` type ignored the `type` parameter when generating filenames. For Steam CDN URLs (the standard achievement image source), both `icon` and `icon_gray` URLs end with `<hash>.jpg`. The `icon_gray` source was saved as `hash.jpg` instead of `hash_gray.jpg`. On cache re-read, the `relative-schema-path` handler correctly added `_gray` suffix, triggering a second download — producing both `hash.jpg` and `hash_gray.jpg`.

### Part 1 — `resolveImageSource` remote-url filename fix
- `achievementImageQueue.ts:resolveImageSource` — remote-url case now extracts 40-char hex hash from URL and applies `_gray` suffix for `icon_gray` type
- Added `[ACH][IMG_RESOLVE]` diagnostic log with filename

### Part 2 — Role mismatch detection
- `achievementImageQueue.ts:enqueue` — detects when a gray source URL is accidentally enqueued as `type="icon"`, skips and logs `[ACH][IMG_ROLE_MISMATCH]`

### Part 3 — Gray dedup at queue level
- `achievementImageQueue.ts:enqueue` — when an icon job's hash matches an existing/completed icon_gray job's hash, skips the icon job (`[ACH][IMG_DEDUP_GRAY]`)
- Added dedup by filename across all queued jobs (not just per apiName+type)

### Part 4 — Distinct icon preservation
- Dedup logic only triggers when hash matches an existing gray job — distinct hashes pass through normally

### Part 5 — Existing cache repair
- `achievementStore.ts:repairGrayIconPaths` — reads cached `achievements.json`, finds entries where `icon_gray` is `img/<hash>.jpg` (without `_gray`), repairs to `img/<hash>_gray.jpg`, writes back
- Called during boot in `appBootCoordinator.ts` for first 5 apps in background repair phase (`[ACH][SCHEMA_REPAIR_GRAY]` log)

### Part 6 — Skip existing files before download
- `achievementImageQueue.ts:downloadItem` — checks `resolveAchievementImagePaths` for existing icon/icon_gray files before downloading, skips with `[ACH][IMG_SKIP]` log

### Part 7 — Dry-run duplicate detection
- `achievementImageQueue.ts:detectDuplicateGrayIcons` — scans img folder for `<hash>.jpg`/`<hash>_gray.jpg` pairs, checks which are referenced by schema, logs suspects via `[ACH][IMG_DUPLICATE_GRAY]`
- Exposed as `window.__detectDuplicateGrayIcons`

### Part 8 — Queue dedup enhancements
- Added dedup by destination filename across all queued jobs (not just per apiName+type)

### Rust side already correct
- `cdn_url_to_relative_icon_path` and `normalize_icon_url_for_cache` already produce correct `img/<hash>_gray.jpg` for gray icons — no Rust changes needed

### Key Files Changed
- `src/services/achievementImageQueue.ts` — Part 1, 2, 3, 4, 6, 7, 8
- `src/services/achievementStore.ts` — Part 5 (`repairGrayIconPaths`)
- `src/services/appBootCoordinator.ts` — Part 5 boot integration

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

## Session 7 — GameHero selection, hover overlay, render spam, heart icon

### Step 25: GameHero selection + hover overlay + render spam
- **GameHero selection logic**: Deterministic priority chain — running > lastPlayed > favoriteWithMedia > validMedia > installed > titledFallback. Added `[DASH][HERO_SELECT]`, `[DASH][HERO_RUNNING]`, `[DASH][HERO_CLEAR_RUNNING]` diagnostic logs (only log on change). Playtime store consulted for up-to-date lastPlayed.
- **Dashboard card hover**: Removed `group-hover/card:scale-105` image zoom from all 6 sections. Added dark overlay `bg-black/30 opacity-0 group-hover/card:opacity-100` matching Library card hover. No padding/margin changes on hover — prevents layout shift.
- **Render spam**: `[MEDIA][GRID_RENDER]` in GameLauncherTile gated behind ref-based change detection (only logs when state changes).

### Step 27: Star → Heart replacements + PopularPicksSection
- **Star → Heart**: FavoritesSection, LibraryPreview, LibraryGameDetails all use Heart icon. Active: `text-rose-400 fill-current` with `bg-black/50` dark translucent bg. Inactive: no fill, muted color. GameDetails achievements stat keeps Star (not a favorite toggle).
- **PopularPicksSection created** (Step 27): Reads global catalog from `readAllGames()` (SQLite). Filters tool/system apps ("Steamworks", "Redistributable", "Utilities"). Excludes user's library games. Prefers games with metadata/media. Sorted by `updatedAt` descending.
- **`[DASH][RECOMMEND]` diagnostic log**: Added to RecommendedSection with `source=personalized|fallback`, `appIds`, and genre tags (gated by ref).

## Session 8 — Dashboard global catalog expansion (Step 28)

### Problem
Dashboard discovery sections were limited to the user's library games. Recommended for You had no way to suggest games the user doesn't own. No "New & Noteworthy" section existed. The "Popular Picks" label was misleading (no real popularity signal).

### Global catalog audit (complete)
Store page uses 4 sources — `steamdb.json` static file (primary 500K app catalog), `providerSearch` (mockPackages→real package registry), Steam store API for search, `sourceAvailabilityCache` for Lua-ready overlays. No rating/popularity/trending signal exists in any data source.

### Data source decisions
- `readAllGames()` from SQLite is the global catalog for dashboard discovery sections (not steamdb.json which is 500K+ entries).
- No "Trending Right Now" section — no real trending/popularity signal exists.
- PopularPicks → Featured Picks: per rule "Do not label as Popular if there is no popularity/rating signal".

### Part 1: Recommended for You — global catalog fill
- Added `getRecommendedWithGlobalFill()` in `recommendationService.ts` — first runs personalized scoring on libraryGames, then fills remaining slots (up to limit) from global catalog scored by genre/category match against user profile.
- Catalog entries from `readAllGames()` have `metadataJson` parsed for `genres`/`categories` — scored the same way as library games.
- Excludes library games, favorites, continuePlaying, and already-recommended from fill pool.
- `RecommendedSection.tsx` updated to load `readAllGames()` on mount, use `getRecommendedWithGlobalFill`.
- `handleOpen` navigates to store for catalog-only games (not in library).
- Subtitle updated: `"Genre-matched games from the catalog"` for fallback mode.
- `[DASH][GLOBAL_CATALOG]` diagnostic log reports total catalog size, metadata coverage, installed count.
- `[DASH][RECOMMEND]` log enhanced with `personal=N` and `global=N` counts.

### Part 2: PopularPicks → FeaturedPicks rename
- `PopularPicksSection.tsx` → `FeaturedPicksSection.tsx` (file deleted, new file created).
- Heading changed from "Popular Picks" to "Featured Picks".
- Subtitle changed to "Curated games from the global catalog".
- Added `[DASH][GLOBAL_CATALOG] section=featured` diagnostic log.
- All imports in `Home.tsx` updated.

### Part 3: NewNoteworthySection created
- New `NewNoteworthySection.tsx` reads `readAllGames()` catalog, filters library games and tool apps.
- Parses `release_date` from `SteamAppMetadata` (handles ISO dates, Steam text format like "Jan 15, 2024", "Coming Soon"/"TBA").
- Sorts by `release_date` descending, prefers games with media.
- Shows release date as pill badge on each card.
- Navigation: library games → game detail, catalog-only → store.

### Part 4: Heart/badge style refinement
- **RecommendedSection**: Changed from `rounded-lg bg-black/50 p-1.5 text-yellow-400` (old star style) → `rounded-full bg-black/60 px-1.5 py-1 text-rose-400/80 backdrop-blur-sm` matching store minimal pill style.
- **FavoritesSection**: Same style update for consistency.

### Part 5: Home.tsx section ordering
- New order: GameHero → ContinuePlaying → Favorites → Recommended → **NewNoteworthy** → **FeaturedPicks** → TopPlayed → StoreHighlights → QuickActions → System strip.
- Discovery sections (NewNoteworthy, FeaturedPicks) placed after personalized sections, before playtime sections.

### Key Files Changed
- `src/services/recommendationService.ts` — `getRecommendedWithGlobalFill()`, `parseMetadataJson()`
- `src/components/dashboard/RecommendedSection.tsx` — global catalog loading, fill candidates, catalog nav, heart style, diagnostic logs
- `src/components/dashboard/FavoritesSection.tsx` — heart style consistency
- `src/components/dashboard/PopularPicksSection.tsx` → deleted
- `src/components/dashboard/FeaturedPicksSection.tsx` — new file (renamed + enhanced)
- `src/components/dashboard/NewNoteworthySection.tsx` — new file
- `src/pages/Home.tsx` — updated imports and section ordering

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes

## Session 9 — Mount global discovery sections with fallback catalog (Step 29)

### Problem
Sections from Session 8 (FeaturedPicks, NewNoteworthy) were mounted in JSX but returned `null` because `readAllGames()` SQLite table is empty on first boot / before full scan. `libraryGames` from context was already populated but not used as catalog fallback. Recommended for You also had no fallback for empty SQLite. No Trending Right Now section existed at all.

### Root Cause
- `readAllGames()` reads SQLite `games` table that may be empty until a full library scan completes
- All three discovery sections only used `readAllGames()` — when empty, `displayGames.length === 0` → `return null`
- No `[DASH][SECTION_SKIP]` diagnostic logs to explain missing sections
- TrendingRightNowSection didn't exist (not even a placeholder)

### Part 1: Fallback catalog from libraryGames
- **FeaturedPicksSection**: Added `libraryGameToCatalogGame()` converter. `displayGames` computed from SQLite catalog when non-empty, else from `libraryGames` context (always populated after boot).
- **NewNoteworthySection**: Same fallback pattern. Parse `release_date` from `LibraryGame.metadata` when SQLite is empty.
- **RecommendedSection**: SQLite catalog loading now falls back to `libraryGames` converted to `GameEntry[]` format.
- All three sections emit `[DASH][GLOBAL_CATALOG] loaded=N source=<sqlite|context-fallback>`.

### Part 2: [DASH][SECTION_SKIP] diagnostic logs
- **FeaturedPicks**: Logs `[DASH][SECTION_SKIP] section=FeaturedPicks reason=no-catalog-data|all-candidates-filtered` when hidden.
- **NewNoteworthy**: Logs `[DASH][SECTION_SKIP] section=NewNoteworthy reason=no-release-date-metadata|all-candidates-filtered` when hidden.
- **TrendingRightNow**: Logs `[DASH][SECTION_SKIP] section=TrendingRightNow reason=no-trending-signal` on mount.
- Impossible for any section to disappear silently.

### Part 3: [DASH][POPULAR] and [DASH][NEW] diagnostic logs
- **FeaturedPicks**: `[DASH][POPULAR] candidates=N rendered=N source=<sqlite-catalog|context-fallback>` on each recompute.
- **NewNoteworthy**: `[DASH][NEW] candidates=N rendered=N source=<metadata-releaseDate|context-fallback>` on each recompute.

### Part 4: TrendingRightNowSection created (skip-only)
- New `TrendingRightNowSection.tsx` — always logs skip and returns null.
- No fake trending data. No fake cards. No random data.
- Mounted in `Home.tsx` between FeaturedPicks and TopPlayed.

### Part 5: Per-game source logs in RecommendedSection
- First-time mount logs `[DASH][RECOMMEND] appid=<id> title=<title> source=<local|global-catalog> score=N reasons=<genres>` per final recommendation.
- Source determination: `local` if game is in libraryGames, `global-catalog` if filled from catalog.

### Part 6: Empty state behavior
- All sections with no real data hide silently (return null).
- TrendingRightNowSection always hides with a console log.
- Diagnostic logs explain why any section is missing.
- No mock cards, no random data, no fake content.

### Key Files Changed
- `src/components/dashboard/FeaturedPicksSection.tsx` — `libraryGameToCatalogGame` fallback, `[DASH][SECTION_SKIP]` + `[DASH][POPULAR]` logs
- `src/components/dashboard/NewNoteworthySection.tsx` — `libraryGameToCatalogGame` fallback, `[DASH][SECTION_SKIP]` + `[DASH][NEW]` logs
- `src/components/dashboard/RecommendedSection.tsx` — libraryGames fallback catalog, per-game source logs
- `src/components/dashboard/TrendingRightNowSection.tsx` — new (skip-only with log)
- `src/pages/Home.tsx` — TrendingRightNowSection mount, `[DASH][GLOBAL_CATALOG]` snapshot log

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes

## Session 10 — HubcapDB 401 handling + auto-register Lua packages (Step 37)

### Part 1: 401/403 download failure handling
- `downloadFromSource` in Store.tsx now parses `Status: <code>` from Rust error messages
- Auth errors (401/403) mark source availability as `"error"` via `updateSourceAvailability` (preserves available sources for "Change Source")
- Clear error toast shows provider name + status code + suggestion ("Verifica la API key o permisos")
- Non-auth errors show the default error message unchanged
- `[STORE][PROVIDER_DOWNLOAD_FAILED]` diagnostic log with appId, provider, status, title
- Same pattern in `PackageCard.tsx` `internalDownload` with `[CARD][PROVIDER_DOWNLOAD_FAILED]` log

### Part 2: Auto-register installed Lua packages (no manual rescan needed)
- After successful `downloadAndInstallPackage` in Store.tsx: immediately calls `refreshInstalledScripts()` (updates Store UI) then `libraryRefresh()` from `useLibraryGames()` (updates library/sidebar/dashboard)
- `[LUA][REGISTER_PACKAGE]` log on install success
- `[LIBRARY][GAME_UPSERT]` log after library refresh completes
- Debounced `scheduleSnapshotWrite` in `LibraryGamesContext` persists state automatically

### Part 3: Tauri async cancellation guards
- `_mountedRef` pattern added to Store.tsx (`downloadFromSource`) and PackageCard.tsx (`internalDownload`)
- All `setState` calls guarded by `_mountedRef.current` check
- `[STORE][ASYNC_CANCELLED]` / `[CARD][ASYNC_CANCELLED]` log when component unmounts during async operation

### Key Files Changed
- `src/pages/Store.tsx` — `useLibraryGames` import, `_mountedRef` + cleanup, `downloadFromSource` refactored with 401 handling, cancellation guard, library refresh
- `src/components/packages/PackageCard.tsx` — `_mountedRef` + cleanup, `internalDownload` with 401 handling and cancellation guard

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

## Session 11 — Hubcap Provider Status and API Usage Card in Settings (Step 38)

### Goal
Add a compact Hubcap provider status/usage card in Settings near the Hubcap API key input.

### Part 1: Hubcap API service (`src/services/hubcapApiService.ts`)
- `checkHubcapHealth(baseUrl)` — GET `/api/v1/health`, no auth, returns online/offline/degraded/error + elapsed ms
- `fetchHubcapUserStats(baseUrl, apiKey)` — GET `/api/v1/user/stats` with Bearer auth, normalizes flexible response shape to `HubcapUsageStats`
- `fetchHubcapDepotKeys(baseUrl, apiKey)` — GET `/api/v1/depot-keys` with Bearer auth, returns count + ok/unauthorized/forbidden/error status
- `clearHubcapCaches()` — clears all caches for manual refresh
- 5-min TTL cache per endpoint; shorter 60s error cache
- `[HUBCAP][HEALTH]`, `[HUBCAP][USAGE_REFRESH]`, `[HUBCAP][AUTH]`, `[HUBCAP][RATE_LIMIT]`, `[HUBCAP][DEPOT_KEYS]` diagnostic logs
- No API key logged. No calls during render. No polling.

### Part 2: HubcapStatusCard component (`src/components/settings/HubcapStatusCard.tsx`)
- Card follows existing `lf-surface rounded-2xl border p-5` styling (matching `ProviderSettingsCard`)
- Header: Activity icon + "Hubcap Provider" title + status badges
- `StatusBadge` component with color-coded variants (green=online/valid, red=offline/error/invalid/forbidden, amber=degraded/ratelimited, muted=unknown)
- `StatRow` component showing label + current/max + "daily" suffix
- `UsageBar` component: thin progress bar with color shift at 70%/90% thresholds
- `formatCountdown` helper: converts `resetInSeconds` or `resetAt` to "in 12h 32m" format
- `formatResetTime` helper: shows absolute reset time

### Part 3: Settings page integration
- `HubcapStatusCard` rendered below the provider grid in the "providers" tab
- Reads hubcapdb API key and baseUrl from `settings.providers.hubcapdb` via `useSettings()`
- Auto-checks health on mount (no auth needed, cache-backed)
- Manual "Test Connection" button triggers health check + clears caches
- Manual "Refresh Usage" button triggers `fetchHubcapUserStats` + `fetchHubcapDepotKeys` in parallel
- "Hubcap Docs" link opens `https://hubcapmanifest.com` in new tab
- 30s countdown ticker updates reset display
- Auth error hints: "API key is invalid" (401), "API key is valid but lacks permission" (403), "Daily usage limit reached" (429)

### Part 4: Improved Hubcap download error messages
- `Store.tsx` and `PackageCard.tsx` now show: `"HubcapDB rechazó la descarga. Revisa la API key en Configuración > Providers. (HTTP 401)"`
- Non-Hubcap providers show generic auth error

### Key Files Changed
- `src/services/hubcapApiService.ts` — **new** — health, stats, depot keys + caching
- `src/components/settings/HubcapStatusCard.tsx` — **new** — status/usage card component
- `src/pages/Settings.tsx` — imported and placed HubcapStatusCard in providers section
- `src/pages/Store.tsx` — improved Hubcap-specific auth error message
- `src/components/packages/PackageCard.tsx` — improved Hubcap-specific auth error message

## Session 12 — Sidebar collapse toggle refactor + auto-repair hotfix

### Step 48: Remove floating chevron, add PanelLeft toggle
- Removed floating chevron button (`absolute -right-3 top-24`) from `Sidebar.tsx`
- Added `PanelLeftClose`/`PanelLeftOpen` toggle in sidebar header right side
- Replaced `ChevronLeft`/`ChevronRight` imports with `PanelLeftOpen`/`PanelLeftClose`

### Step 49: Merge logo and toggle
- Logo container acts as toggle when collapsed: Flame fades out, PanelLeft fades in on hover
- Removed standalone right-side PanelLeft button

### Step 50: Refine toggle placement
- **Expanded header**: `justify-between px-5` — static logo on left, separate `PanelLeftClose` button on right (no hover-swap)
- **Collapsed header**: `justify-center px-2` — centered logo button with hover-swap Flame→PanelLeftOpen; click expands
- Reverted collapsed width to `w-[72px]`
- Drawer mode unchanged (X close on right)

### Hotfix: Auto-repair all 5 media roles
- Fixed bug in `executeRepairGameMedia` where stale relative paths (e.g., `"logo.png"`) were truthy non-HTTP strings → skipped to "already-on-disk" → never consulted `mediaSources`
- Restructured: `const httpUrl = (url && typeof url === "string" && url.startsWith("http")) ? url : null;` — only HTTP URLs trigger primary download; everything else falls through to `mediaSources`
- Created shared `CANONICAL_GAME_MEDIA_ROLES` constant (`gameCacheService.ts:62`) — used by `backgroundJobQueue.ts:334` instead of inlined roles array
- All 5 roles (cover, landscape, background, logo, icon) now get downloaded even when appinfo has stale local paths
- Rust `safe_download_image` skips existing files, so redundant downloads are safe

### Key Files Changed
- `src/components/layout/Sidebar.tsx` — header restructured (expanded: static logo + PanelLeftClose; collapsed: centered logo hover-swap)
- `src/services/backgroundJobQueue.ts` — `executeRepairGameMedia` URL check restructured, uses `CANONICAL_GAME_MEDIA_ROLES`
- `src/services/gameCacheService.ts` — `CANONICAL_GAME_MEDIA_ROLES` constant exported

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

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

## Session 14 — Emergency Stabilization: Stop Global Background Jobs During Navigation

### Problem
App freezes during navigation and Store open due to excessive background work:
1. Achievement schema migration runs per-icon (`[ACH][SCHEMA_MIGRATE]`)
2. BootSnapshot validates every media role per-game (`[BootSnapshot][VALIDATE_PATH]`)
3. Media/appinfo repair runs globally and writes repeatedly (`[MEDIA][APPINFO_WRITE]`)
4. No coalescing guard for background work during visible page navigation

### Part 1: Hard-disable achievement schema migration auto-run
- Added `ACHIEVEMENT_SCHEMA_MIGRATION_AUTO = false`, `ACHIEVEMENT_IMAGE_MIGRATION_AUTO = false`, `DEBUG_ACH_MIGRATION = false` in `achievementStore.ts`
- `repairGrayIconPaths()` returns early when `ACHIEVEMENT_SCHEMA_MIGRATION_AUTO` is false, logs `[ACH][SCHEMA_MIGRATE_SKIP]` once
- `writeCacheInBackground()` (called from `applyProgressPatch`) returns early when flag is false — prevents disk writes that trigger Rust-side `[ACH][SCHEMA_MIGRATE]` per-icon logs

### Part 2: Achievement migration gated in background jobs
- `achievementImageQueue.ts.enqueue()` returns early when `ACHIEVEMENT_IMAGE_MIGRATION_AUTO=false`, logs `[ACH][IMG_MIGRATE_SKIP]` once
- `backgroundJobQueue.ts:executeGenerateAchievementSchema()` checks `ACHIEVEMENT_SCHEMA_MIGRATION_AUTO` and returns early
- `appBootCoordinator.ts` Stage 8 background repair — achievement schema/image jobs and `repairGrayIconPaths` all gated behind the flags
- Manual Refresh Artwork still works (calls `steamAchievementsResolver` directly, bypasses the auto flag)

### Part 3: Disable global media repair during navigation
- Added `AUTO_MEDIA_REPAIR_GLOBAL = false`, `AUTO_MEDIA_REPAIR_VISIBLE_ONLY = true` in `gameCacheService.ts`
- `detectAndQueueMissingMedia` now accepts `source` parameter (`"visible-details"` | `"refresh-artwork"` | `"global"` | `"boot"`)
- When source is not `"visible-details"` or `"refresh-artwork"`, returns early, logs `[MEDIA][GLOBAL_REPAIR_SKIP]` once

### Part 4: Visible GameDetails targeted repair only
- `LibraryGameDetailPage.tsx` calls `detectAndQueueMissingMedia(appId, "visible-details")` — only current visible game repairs
- Manual Refresh Artwork calls with `"refresh-artwork"` — still works

### Part 5: Disable BootSnapshot validation spam
- Modified Rust `startup_snapshot.rs` — added `const DEBUG_BOOTSNAPSHOT_VALIDATE: bool = false` around the `[BootSnapshot][VALIDATE_PATH]` success `println!`
- Missing/invalid path logs (`[VALIDATE_PATH_MISSING]`) still appear

### Part 6: No validate on every snapshot write
- Snapshot write already uses `_dirtyAppIds` (only processes changed appIds)
- No full-rebuild for media-update writes
- Existing coalescing (debounce, `_pendingAfterWrite`, `_coalescedScheduleCount`) retained

### Part 7: Disable MediaCache resolve spam
- `ENABLE_VERBOSE_MEDIA_CACHE_LOGS` already false in TS (`libraryLocalCacheService.ts:34`)
- Changed Rust `game_cache.rs` `ENABLE_VERBOSE_MEDIA_CACHE_LOGS` from `true` to `false` — silences `[MEDIA][APPINFO_WRITE]` and `[MediaCache]` logs from Rust

### Part 8: Store page isolation
- Store page loads cached catalog + renders visible cards — never triggers achievement migration or global media repair
- All flags disable background work before it starts, so Store page never triggers it

### Part 9: Snapshot write debounce
- Changed debounce from 1000ms to 2000ms in `startupSnapshotService.ts:444`

### Key Files Changed
- `src/services/achievementStore.ts` — constants + gating in `repairGrayIconPaths`, `writeCacheInBackground`
- `src/services/achievementImageQueue.ts` — constants + gating in `enqueue`
- `src/services/gameCacheService.ts` — `AUTO_MEDIA_REPAIR_GLOBAL`, `detectAndQueueMissingMedia` source parameter
- `src/services/appBootCoordinator.ts` — gated background repair calls
- `src/services/backgroundJobQueue.ts` — gated `executeGenerateAchievementSchema`
- `src/services/startupSnapshotService.ts` — debounce 2000ms
- `src-tauri/src/commands/startup_snapshot.rs` — `DEBUG_BOOTSNAPSHOT_VALIDATE` guard
- `src-tauri/src/commands/game_cache.rs` — `ENABLE_VERBOSE_MEDIA_CACHE_LOGS` set to false

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

## Session 15 — Architecture hotfix: snapshot-first, page-scoped, priority-based

### Problem
Previous Session 14 (emergency stabilization) disabled the worst background noise, but the architecture still lacked formal priority tiers, unified repair entry point, media health TTL metadata, dedup key helpers, and page-scoped logging flags.

### Part 1: Formalized P0-P6 job priority tiers
- Added `JobTier` type with 7 levels: `P0-user-action` → `P6-cleanup`
- `tierToPriority()` maps P0-P6 to legacy `high/normal/low`
- `tierLabel()` strips the `P\d-` prefix for display
- `BackgroundJob.tier` field added (optional, backward-compat)
- `enqueue()` accepts optional `tier` alongside `priority`
- Log format: `[JOB] queued key=<key> tier=<tier> priority=<priority>`

### Part 2: Shared refreshArtwork function (Part 7+9)
- Created `refreshArtwork(appId, options)` in `gameCacheService.ts:964` — unified entry point for both manual Refresh Artwork and GameDetails auto-repair
- Options: `roles`, `force`, `tier` (JobTier), `source` (MediaRepairSource)
- Manual: `roles=all, force=true, tier=P0-user-action, source=refresh-artwork`
- GameDetails: `roles=missing, force=false, tier=P1-visible-page, source=visible-details`
- Reuses same 4-tier source chain: resolveGameMedia → game-metadata → SGDB → mediaSources
- Both paths converge on `enqueueMediaDownload` → `UpdateGameAppinfoMedia` → `notifyMediaUpdated`
- Returns `{ queued, failed, skipped }` result

### Part 3: Media health metadata with TTL (Part 4)
- Added `MediaHealth` type: `{ complete, checkedAt, missing, lastRepairAttemptAt?, lastRepairError? }`
- `_mediaHealthStore` Map maintains per-appId health
- `getMediaHealth()`, `setMediaHealth()`, `isMediaHealthStale()`, `isMediaRepairOnCooldown()`
- TTL constants: complete=24h, incomplete=10min retry, failed=5min cooldown
- `detectAndQueueMissingMedia` now checks TTL before repair
- `refreshArtwork` bypasses TTL when `force=true` or `source=refresh-artwork`
- Health updated after each scan with missing/queued roles

### Part 4: BootSnapshot validation — dirty appIds only (Part 14)
- Existing `_processDirtyAppIds` already limited to dirty appIds for media-update
- `ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS = false` already gates per-game hydrate logs
- Rust `DEBUG_BOOTSNAPSHOT_VALIDATE = false` gates `[VALIDATE_PATH]` success logs
- No full-rebuild for media-update writes

### Part 5: Logging flags + dedupe keys (Part 18+19)
- Added `DEBUG_MEDIA_DETAILS = false`, `DEBUG_MEDIA_RESOLVE = false` in `gameCacheService.ts`
- Added `DEBUG_ACH_VERBOSE = false` in `achievementStore.ts`
- `backgroundJobQueue.ts`: `mediaRepairKey(provider, appId, role)` and `gameDetailsRepairKey(provider, appId, roles)` helpers
- All logging flags default to false

### Key Files Changed
- `src/services/backgroundJobQueue.ts` — `JobTier`, `tierToPriority`, `tierLabel`, `mediaRepairKey`, `gameDetailsRepairKey`, `BackgroundJob.tier`
- `src/services/gameCacheService.ts` — `refreshArtwork()`, `MediaHealth`, `_mediaHealthStore`, TTL helpers, `DEBUG_MEDIA_DETAILS`, `DEBUG_MEDIA_RESOLVE`
- `src/services/achievementStore.ts` — `DEBUG_ACH_VERBOSE`

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

## Session 16 — Cross-appId stale state cleanup + log suppression

### Problem
1. **GameDetails stale appId state**: When switching games rapidly, `canonicalAppInfo` from the previous appId persisted during the async fetch for the new appId, causing cross-appId media/title flicker.
2. **Store triggers snapshot writes**: `notifyMediaUpdated` scheduled `[BootSnapshot][SCHEDULE]` writes even when the user was browsing Store, wasting disk I/O.
3. **Console log spam**: `[MEDIA][DETAILS_CANONICAL]`, `[MEDIA][DETAILS_RENDER]`, `[MEDIA][SIDEBAR]`, `[DASH][GLOBAL_MEDIA]` logs printed on every render despite `ENABLE_VERBOSE_*` flags already being `false`.

### Part 1: GameDetails state cleared synchronously on appId change
- `LibraryGameDetailPage.tsx` — `useEffect` for appId now clears `setMediaEntry(null)`, `setCanonicalAppInfo(null)`, `setCanonicalDiskFallback(null)`, `setLocalDetailsData(null)` **immediately** at the start of the effect body, *before* beginning async fetches.
- Previously only cleared when `selectedGame?.appId` was null — stale appId 123 data persisted during the async fetch for appId 456.

### Part 2+6: All DETAILS logs gated behind `ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS`
- `LibraryGameDetails.tsx` — `getHeroImageUrl()` now calls `logDetailsCanonical()` helper that checks the flag before logging `[MEDIA][DETAILS_CANONICAL]`.
- `[MEDIA][DETAILS_RENDER]` at line 766 wrapped in `if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS)`.
- Flag already existed (`= false`) but logs were never gated by it.

### Part 5: All SIDEBAR logs gated behind `ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS`
- `SidebarLibraryList.tsx` — `pickSidebarSrc()` uses `logSidebarMedia()` helper that checks the flag. `getSidebarTitle()` placeholder log and the sidebar repair `[JOB]` log also gated.
- Flag already existed (`= false`) at line 32 but was never checked.

### Part 4: DASH_GLOBAL_MEDIA gated
- `FeaturedPicksSection.tsx` and `NewNoteworthySection.tsx` — `[DASH][GLOBAL_MEDIA]` logs now check `DEBUG_DASH_GLOBAL_MEDIA = false` constant.

### Part 3+7: Snapshot write guard for Store page
- `startupSnapshotService.ts:notifyMediaUpdated()` — checks `window.location.hash.startsWith("#/store")` and returns early without scheduling a snapshot write.
- Cache bust (`canonicalMediaCache.delete`) still runs, so next non-Store page load picks up fresh data.
- Prevents `[BootSnapshot][SCHEDULE] reason=media-update` from firing during Store navigation.

### Key Files Changed
- `src/pages/LibraryGameDetailPage.tsx` — Part 1: clear state immediately on appId change
- `src/components/library/LibraryGameDetails.tsx` — Part 2+6: `logDetailsCanonical()`, gate `[MEDIA][DETAILS_RENDER]`
- `src/components/layout/SidebarLibraryList.tsx` — Part 5: `logSidebarMedia()`, gate `[MEDIA][SIDEBAR]` + `[JOB]`
- `src/components/dashboard/FeaturedPicksSection.tsx` — Part 4: `DEBUG_DASH_GLOBAL_MEDIA` flag
- `src/components/dashboard/NewNoteworthySection.tsx` — Part 4: `DEBUG_DASH_GLOBAL_MEDIA` flag
- `src/services/startupSnapshotService.ts` — Part 3+7: store page guard in `notifyMediaUpdated`

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes

## Session 17 — Store image persistence, Show More dedup, safe achievements, stop no-op churn

### Goal
Persist Store display images across navigation, fix Show More dedup, restore safe achievement cache reads, stop no-op MediaIndex/BootSnapshot churn.

### Part 1: Store image cache (`src/services/storeImageCache.ts`)
- Module-level `Map<string, StoreImageCacheEntry>` — survives mount/unmount
- `resolveStoreDisplayImage(appId, role, options)` — fallback chain: cache → catalog → metadata → provider → Steam CDN → placeholder
- `getStoreDisplayImage()`, `setStoreImageCacheEntry()`, `markStoreImageLoaded()`, `markStoreImageFailed()`
- `getStoreImageCacheSize()`, `getStoreImageCacheSnapshot()` for diagnostics
- No local MediaIndex writes, no BootSnapshot schedule

### Part 2: AsyncImage global imageLoadCache
- Global `Map<string, "loaded"|"failed"|"loading">` that survives remounts
- `[IMG][CACHE_HIT]`/`[IMG][CACHE_LOADED]`/`[IMG][CACHE_FAILED]` logs behind `DEBUG_IMG_CACHE` (default `false`)

### Part 3-4: Show More single source of truth + cap removal
- `increaseStoreVisibleCount(reason)` — single source for both button-click and scroll-batch
- 50ms dedup tick guard (prevents rapid double-click)
- Logs `[STORE][SHOW_MORE]` / `[STORE][SCROLL_BATCH]` with old/added/next/count
- Removed `MAX_VISIBLE_COUNT` cap; `loadMoreCatalog` replaced entirely

### Part 5-6: Browse images resolver + block local MediaIndex
- Browse tab cards use `PackageCard` with `storeMetadata`; `getBestCardImage` falls back through `game.imageUrl` → `metadata.header_image` → placeholder
- `catalogGames` sets `imageUrl` from `getStoreDisplayImage(appId, "capsule")` or `"header"` before metadata fields
- Store-facing image resolution at 3 entry points blocked: `flushAppInfoUpdates` early-returns for `#/store`, `detectAndQueueMissingMedia` early-returns, `refreshArtwork` early-returns

### Part 7: News tab useful feed
- 5 feed types already deployed: provider discoveries → browse game status → new catalog entries → high-quality reviewed games → trending games

### Part 8-10: Safe achievements for visible app + sidebar + manual refresh
- `LibraryGameDetails.tsx`: When in-memory store misses, reads existing disk cache for current visible `appId` only (`readAchievementCache`). No schema scan, no migration, no cache write, no full library scan
- `ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP = true` flag
- `[ACH][VISIBLE_CACHE_READ]` log for in-memory hit, `[ACH][VISIBLE_CACHE_MISS]` for disk miss/failure
- Manual Refresh Achievements already works via `resolveSteamAchievements` with `forceRefresh: true`

### Part 11: Stop no-op MediaIndex updates
- `flushAppInfoUpdates` now logs `[MEDIA_INDEX][UPDATE_SKIP] appid=<id> reason=no-effective-change` when all paths match existing entries

### Part 12: Block Store/Browse from BootSnapshot
- `notifyMediaUpdated` returns early for `#/store` routes (already deployed)
- Cache bust still runs so next non-Store page picks up fresh data

### Part 13: One-phase Store restore
- `steamCatalog` initialized from `getCachedStoreDiscover()` synchronously via `useState(() => ...)`
- `visibleCount` initialized from `getCachedStoreUI()?.visibleCount`
- `cachedAllStoreSections` initialized from `getCachedStoreDiscover()?.allStoreSections`
- UI state (tab, search, browsePage, genreSectionId) restored from module-level `StoreUIState`
- No 0/0 flash on re-mount

### Key Files Changed
- `src/services/storeImageCache.ts` — **new** — module-level store display image cache
- `src/components/common/AsyncImage.tsx` — global `imageLoadCache` Map
- `src/pages/Store.tsx` — `increaseStoreVisibleCount` dedup, `getStoreDisplayImage` in catalogGames, image cache pre-population effect, sync `useState` initializers from cached store UI
- `src/components/library/LibraryGameDetails.tsx` — safe disk cache read for achievement data
- `src/services/mediaDownloadQueue.ts` — `[MEDIA_INDEX][UPDATE_SKIP]` log + Store guard
- `src/services/startupSnapshotService.ts` — `notifyMediaUpdated` early-return for Store (already deployed)
- `src/services/prewarmCacheService.ts` — `ENABLE_VERBOSE_PREWARM_LOGS=false`

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes

## Session — Background Queue and Boot Side Effects (Part 4)

### Part 4/5 — Background Queue and Boot Side Effects

#### Steps 1-2: Fix Store-active job deferral
- **Moved Store route check from `executeJob` to `processNext`** (`backgroundJobQueue.ts`) — check happens BEFORE `job.status = "running"`, preventing the job from being marked as "started" then "completed" when deferred.
- **Re-enqueue with "queued" status** — deferred jobs reuse a fresh status object, not a mutated "completed" one.
- **Dedup for deferred jobs** — `queue.some()` check prevents pushing a duplicate with the same id when Store-blocked.
- **Removed old Store-route block from `executeJob`** — no longer necessary, avoids dual-check confusion.
- Log format: `[JOB][DEFER] key=<key> reason=store-active retryMs=2000` / `[JOB][DEFER_SKIP] key=<key> reason=already-queued`.

#### Step 5: Remove unsafe clearReconciledGames from normal boot
- **Removed `clearReconciledGames()` call** (`appBootCoordinator.ts` line 436) in the `else` branch (games already in SQLite). Previously, if the game index was empty after the rebuild, `clearReconciledGames()` had already wiped healthy state with no recovery path.
- **Removed unused `clearReconciledGames` import** from the dynamic import at line 304.

#### Step 6: Guarantee setReconciledGames after reconcile
- Changed `if (reconciledGames && reconciledGames.length > 0)` to `if (reconciledGames)` — `setReconciledGames` now always fires in the `else` branch (with the empty-overwrite guard in `gameStore.ts` preventing actual wipe if runtime has healthy state).

#### Step 7: Remove name-only media wipe pattern
- **`updateGameAppinfoMedia` now preserves existing media** (`appBootCoordinator.ts:507-511`). Instead of passing all-null media paths, reads `appinfos[game.appId].media` and passes existing paths through, only updating the `name` field.
- Prevents erasing background/logo/icon/cover/landscape paths that were set by a previous repair or import.

#### Step 8: Make hydrateMediaOnStartup idle/no-op aware
- **Store route guard** — checks `window.location.hash` before running; logs `[BOOT][MEDIA_HYDRATE_SKIP] reason=store-active` when on Store.
- **Chunking** — processes appIds in chunks of 10 to avoid blocking the main thread during boot.
- **Lazy import** — `hydrateMediaOnStartup` only imported when not on Store route.

#### Step 9: Gate validate-cache-health for navigation
- **Store route guard** — skips `validateStartupCacheHealth()` when `#/store` is active, logs `[BOOT][HEALTH_SKIP] reason=store-active`.

### Build
- `tsc --noEmit` ✅ passes (only pre-existing unused-variable warnings in `LibraryGameDetails.tsx`)
- `vite build` ✅ passes (only pre-existing chunk warnings)

## Session — Critical UI State Hardening

### Goal
Fix duplicate React keys, single source of truth for visibleCount, fix Show More behavior, windowing for More to Explore, section ordering, consistent display image resolver, MediaIndex guards from Store, and dashboard derived data helpers.

### Part 1: Composite keys + dedup
- `StoreHorizontalSection.tsx` — accepts `sectionKey` prop, uses `sectionKey:steam:index` format for wrapper keys
- `Store.tsx renderStoreCard` — removed unused `key={game.appId}` (key handled by `StoreHorizontalSection`)
- Dynamic sections and More to Explore pass `sectionKey={section.id}` / `sectionKey="more-to-explore"`
- `moreToExploreGames` computation deduplicates by appId via `seen` Set
- Prevents duplicate key warnings when same appId appears in multiple sections

### Part 2: One source of truth for visibleCount
- `visibleCount` state: `const [visibleCount, setVisibleCount]` (was read-only `const [visibleCount]`)
- Removed `moreToExploreExtraCount` state entirely
- `StoreUIState` interface updated — removed `moreToExploreExtraCount` field
- All UI state persistence uses `visibleCount` only

### Part 3: Fix Show More behavior
- `increaseMoreToExploreCount` → renamed to `increaseStoreVisibleCount`
- Now adds `CATALOG_PAGE_SIZE` (40) to `visibleCount` directly
- 150ms dedup tick guard preserved
- `[STORE][SHOW_MORE]` log reports old/added/next values

### Part 4: Windowing for More to Explore
- `moreToExploreGames` slices `rankedSteamCatalog.slice(0, visibleCount)` (was `visibleCount + moreToExploreExtraCount`)
- Show More button condition: `rankedSteamCatalog.length > visibleCount`
- Removed `autoScrollToEndKey` from StoreHorizontalSection (no longer needed)

### Part 5: Restore Discover sections
- Genre sections (`genre-*`) moved ABOVE Top Rated in priority order
- Top Rated section moved after genres (was before)

### Part 6: Shared Store display image resolver
- `getStoreDisplayImage(appId, role)` from `storeImageCache.ts` used consistently in:
  - `catalogGames` (browse tab)
  - `moreToExploreGames` (discover tab)
- Featured games hero uses metadata directly (different rendering path)

### Part 7: Stop display images from MediaIndex
- Pre-existing guards confirmed in:
  - `mediaDownloadQueue.ts:101/247` — `#/store` early return
  - `startupSnapshotService.ts:438` — `#/store` early return
  - `gameCacheService.ts:1008/1172` — `#/store` early return

### Part 8: Dashboard derived cache + dedup
- `composeDerivedData<T>(games)` in `gameStore.ts` — deduplicates by appId
- `deduplicateByAppId<T>(items)` in `gameStore.ts` — standalone dedup helper

### Key Files Changed
- `src/components/store/StoreHorizontalSection.tsx` — `sectionKey` prop, composite keys
- `src/pages/Store.tsx` — `visibleCount` setter, remove `moreToExploreExtraCount`, `increaseStoreVisibleCount`, section ordering, `sectionKey` on StoreHorizontalSection calls
- `src/services/storeDiscoverCache.ts` — `StoreUIState`: removed `moreToExploreExtraCount`
- `src/services/gameStore.ts` — `composeDerivedData()`, `deduplicateByAppId()`

### Build
- `tsc --noEmit` ✅ passes (only pre-existing unused-import warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)
- `cargo check` ✅ passes

## Session — 8 Bug Investigation + Critical UI State Hardening + Dedup

### Part A: Bug Investigation (8 bugs)
1. **AchievementIcon race condition** — Fixed: `loadedRef` guard in `useResolvedUrl` prevents stale state after appId change
2. **Missing iconUrl hidden achievements** — Handled by Part 1 fix (race condition was root cause)
3. **Progress N/A in achievements** — Fixed `progressAvailable` derivation in `achievementStore.ts`: checks `highestUnlockTime` and schema `achievementGoal` alongside `unlockedCount`
4. **Manual refresh not persisting** — Determined NOT a bug: `refreshAchievements` writes to disk via `applyProgressPatch`, flush is async but consistent
5. **Store provider mismatch** — Identified root cause: `PackagesToolbar.tsx` passes `provider="hubcapdb"` but Rust command expects `HubcapDB` (capitalized). Needs separate session to fix since it involves Tauri event keys
6. **MediaIndex guards for Store/Browse** — Already exist: `mediaDownloadQueue.ts`, `gameCacheService.ts`, `startupSnapshotService.ts` all guard `#/store` routes
7. **BootSnapshot writes from Store** — Already guarded: `notifyMediaUpdated` returns early for `#/store` routes
8. **Log cleanup** — Discussed: `[MEDIA][DETAILS_RENDER]`, `[MEDIA][GRID_RENDER]` gated; `ENABLE_VERBOSE_*` flags set to false

### Part B: Composite keys (Part 1 of UI State Hardening)
- Changed `StoreHorizontalSection.tsx` — accepts `sectionKey` prop, uses `sectionKey:steam:index` for wrapper keys
- Changed `StoreGameDetailsPage.tsx` — uses `more-like-this:steam:index`, `details:steam:appId`
- Changed `StoreMoreLikeThisSection.tsx` — uses `more-like-this:steam:appId`
- Changed `StoreDiscoverHeroCarousel.tsx` — each `StoreHorizontalSection` call passes `sectionKey={section.id}`
- Changed `Store.tsx` — removed `key={game.appId}` from renderStoreCard, passes `sectionKey` to all StoreHorizontalSection calls, dedup via `seen` Set in moreToExploreGames
- Changed 4 dashboard GameHero calls to pass `key={…}`
- Changed `GameLauncherTile.tsx` — fixed to use composite `section:provider:appId` key
- Changed `InstalledGamesSidebar.tsx`, `Achievements.tsx` — composite keys
- Changed `SidebarLibraryList.tsx` — dedup by appId in visibleItems computation
- Changed `InstalledGameDetails.tsx` — composite keys in action buttons/watcher tabs
- Changed `PackagesToolbar.tsx`, `PackagesToolbarSearch.tsx` — avoid duplicate keys
- Total: 15 files with key fixes, 0 duplicate key warnings

### Part C: Dedup within each section
- Added `deduplicateByAppId<T>(items)` in `gameCacheService.ts` (moved from `gameStore.ts`, removed duplicate from `gameStore.ts`)
- Type constraint uses `appId?: string | null | undefined` to accept both required and optional appId
- Wrapped render `.map()` calls in all 7 dashboard sections:
  - `ContinuePlayingSection.tsx` — import + `deduplicateByAppId(games).map()`
  - `FavoritesSection.tsx` — `deduplicateByAppId(displayGames).map()`
  - `TopPlayedSection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `LibrarySection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `RecommendedSection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `FeaturedPicksSection.tsx` — import + `deduplicateByAppId(displayGames).map()`
  - `NewNoteworthySection.tsx` — import + `deduplicateByAppId(displayGames).map()`
- `tsc --noEmit` ✅ passes (only pre-existing unused-import warnings)

### Key Decisions
- **Inline dedup at render point** — Not changing displayGames useMemo logic; wrapping render `.map()` with dedup is simpler and avoids altering data used by other effects
- **Single dedup function** — `deduplicateByAppId` in `gameCacheService.ts` reused by all 7 sections (already imported by most)
- **Set-based dedup** — O(n) dedup preserving first occurrence order

### Key Files Changed (this session)
- `src/services/gameCacheService.ts` — `deduplicateByAppId()` added, type constraint relaxed
- `src/services/gameStore.ts` — removed duplicate `deduplicateByAppId()`/`composeDerivedData()`
- `src/components/dashboard/*.tsx` (7 files) — import + dedup at render map
- `src/components/store/*.tsx` (5 files), `src/pages/Store.tsx` — composite keys
- `src/components/games/GameLauncherTile.tsx` — composite key fix
- `src/components/layout/SidebarLibraryList.tsx` — dedup in visibleItems
- `src/components/installed/InstalledGameDetails.tsx` — composite keys
- `src/components/installed/InstalledGamesSidebar.tsx` — composite key
- `src/components/packages/PackagesToolbar.tsx`, `PackagesToolbarSearch.tsx` — composite key
- `src/pages/Achievements.tsx` — composite key
- `src/components/achievements/AchievementWatcherInit.tsx` — composite key

## Session — Rich Store Discover Sections

### Goal
Transform the flat Discover tab (Hero + sections + More to Explore) into a rich store home with 12 curated sections: Hero, Featured, For You, Top Picks, New and Noteworthy, Popular Genres, Action, Indie, Racing, Shooter, Lua Ready Picks, More to Explore.

### Part 1: StoreDiscoverSection model
- Added `StoreDiscoverSection` type to `storeDiscoverCache.ts`: `{ id, title, type, items, source }`
- Added `StoreGame` (simplified game item) and `SectionSource` ("catalog" | "personalized" | "genre" | "lua" | "fallback")
- Added `discoverSections` field to `CacheEntry` for caching
- Added `buildDiscoverSectionsFingerprint()` helper for composite fingerprint

### Part 2: Section builder
- Replaced the old `dynamicDiscoverSections` useMemo (produced `StoreSectionModel[]`) with `discoverSections` (produces `StoreDiscoverSection[]`)
- Added backward-compat `sectionModels` shim for cache/other consumers
- New sections:
  - **For You** — personalized genre overlap (was "Recommended for You")
  - **Top Picks** — top scored from high quality pool
  - **New and Noteworthy** — sorted by `release_date` via `parseReleaseDate`
  - **Popular Genres** — genre overview rail
  - **Action, Indie, Racing, Shooter** — genre rails from metadata tags (Racing added)
  - **Featured** — high-quality with media (was "Top Rated")
  - **Lua Ready Picks** — catalog games with available download sources
- Removed "Trending Now" section (no real trending signal)
- Reduced genre count from 7 (Action, RPG, Shooter, Indie, Simulation, Adventure, Strategy) to 4 (Action, Indie, Racing, Shooter)

### Part 3: Discover tab render
- Hero carousel stays rendered separately
- All 11 section rails rendered via `StoreHorizontalSection` with per-section descriptions
- More to Explore rendered as the LAST section, unaffected by section dedup
- Show More button only affects More to Explore's `visibleCount`

### Part 4: Image resolver
- All Store sections use `resolveStoreDisplayImage` via existing `renderStoreCard` path
- No MediaIndex or BootSnapshot updates from Store images (pre-existing guards confirmed)

### Part 5: Caching
- `discoverSections` cached in `CacheEntry.discoverSections`
- Cache restored by `catalogFingerprint` match
- `sectionModels` saved as `dynamicDiscoverSections` in cache for backwards compat

### Key Decisions
- **Inherit existing scoring** — For You, Top Picks, Featured all reuse existing `highQualityPool`, `interactionScoreByAppId`, `genreConfidence` scoring
- **No fake trending** — "Trending Now" removed instead of showing stale data
- **4 genre rails** — Reduced from 7 to 4 (Action, Indie, Racing, Shooter) to match requirements
- **More to Explore last** — Always rendered after all discover sections, unaffected by section dedup

### Key Files Changed
- `src/services/storeDiscoverCache.ts` — `StoreDiscoverSection`, `StoreGame`, `SectionSource` types; `discoverSections` field on `CacheEntry`; `buildDiscoverSectionsFingerprint`
- `src/pages/Store.tsx` — `discoverSections` useMemo replaces `dynamicDiscoverSections`; `sectionModels` shim; updated render loop; `parseReleaseDate` import; Lua Ready Picks section; description mapping

### Build
- `tsc --noEmit` ✅ passes (only pre-existing unused-import warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)

## Session — Final Polish: Console log throttling + MediaIndex no-op guard

### Goal
Reduce console noise from `ASYNC_IMAGE_ERROR`, `GENRE_GROUPS_RAW`, and false `notifyMediaUpdated` calls for `has*`-only MediaIndex updates.

### Step 3: Throttle ASYNC_IMAGE_ERROR
- Only logs when terminal (no parent `onError` handler) or has `fallbackLocalPath`.
- For Store cards with fallback chains (`onError` set), errors are expected fallback retries — log suppressed.
- `AsyncImage.tsx:197`

### Step 4: Throttle [STORE][GENRE_GROUPS_RAW]
- Module-level `_lastGenreGroupsLog` tracks genre composition fingerprint.
- Only logs when `rawGenreGroups.size` or per-genre counts change.
- `Store.tsx:963`

### Step 7: Suppress false notifyMediaUpdated for has*-only changes
- `flushAppInfoUpdates` in `mediaDownloadQueue.ts` now distinguishes path changes from `has*` flag fixes.
- When `pathActuallyChanged === 0` and `mediaIndexChanged > 0`: skips `notifyMediaUpdated`, logs `[MEDIA_INDEX][UPDATE_SKIP] reason=snapshot-already-synced`.

### Build
- `tsc --noEmit` ✅ passes (only pre-existing `LibraryGameDetails.tsx` unused-variable warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)

## Session — Final Cleanup: Snapshot No-Op Writes, Sidebar Filter Logging, and No-Source Media Repair Noise

### Goal
Reduce unnecessary writes and misleading logs without changing working Library/Sidebar/Store behavior. Library stays 82, Sidebar stays 34.

### Step 1: Full-rebuild no-op guard in scheduleSnapshotWrite
- Added `computeSnapshotFingerprint` check immediately after `buildStartupSnapshotFromCurrentState` in `scheduleSnapshotWrite`.
- When fingerprint matches `_lastWriteFingerprint`, skips calling `saveStartupSnapshot` entirely.
- Log: `[BootSnapshot][WRITE_SKIP] reason=no-content-change-full-rebuild games=<n> sidebarItems=<n>`.
- Also moved `SIDEBAR_FILTER`/`SIDEBAR_REPAIR` log inside this guard block so it only fires when a write actually happens.
- `startupSnapshotService.ts:1210-1221`

### Step 2: Rename misleading SIDEBAR_REPAIR log
- `SIDEBAR_REPAIR` only logs when `cachedSnapshot?.sidebar.items.length === deduped.length` (was full-library — old bad snapshot).
- Normal installed-only filtering logs as `[BootSnapshot][SIDEBAR_FILTER]`.
- Removed duplicate `SIDEBAR_FILTER` log from `buildStartupSnapshotFromCurrentState` (now gated behind `ENABLE_VERBOSE`).
- `startupSnapshotService.ts:1222-1229`

### Step 3: Input fingerprint to skip scheduling identical games
- Added `computeGamesFingerprint` in `LibraryGamesContext.tsx` — tracks appId + key status flags.
- Added module-level `_lastGamesFingerprint` to compare against.
- When fingerprint unchanged, logs `[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE_SKIP] reason=unchanged-games games=<n>` and returns early.
- `LibraryGamesContext.tsx:28-34`, `LibraryGamesContext.tsx:434-440`

### Step 4: No-source cooldown before repair scan
- Moved `isNoSourceCooldown` check to the VERY top of `detectAndQueueMissingMedia`, above display-only/Store/system/global checks.
- When cooldown active, logs `[MEDIA][AUTO_REPAIR_COOLDOWN] appid=<appid> reason=no-source-url` and returns immediately.
- No `AUTO_REPAIR_SCAN`, `AUTO_REPAIR_FAILED`, or disk scan while cooldown active.
- `gameCacheService.ts:1552-1556`

### Step 5: Optional persistence (skipped)
- No existing suitable persistent store for session-only cooldown. Creating a new DB/file is overkill. Session cooldown is sufficient.

### Step 6: Gate achievement ACH logs behind DEBUG flag
- Added `DEBUG_ACH_DETAILS = false` constant in `LibraryGameDetails.tsx`.
- `[ACH][STATE_PRESERVE]`, `[ACH][VISIBLE_CACHE_HIT]`, `[ACH][VISIBLE_CACHE_MISS]`, `[ACH][VISIBLE_CACHE_READ]`, `[ACH][SUMMARY_DERIVED_FROM_LIST]` all gated behind flag.
- `LibraryGameDetails.tsx:1`, `:504`, `:530`, `:544`, `:580`, `:583`, `:588`

## Session — Performance Architecture Pass

### Goal
Separate boot critical path from idle work, batch Tauri commands, consolidate Store state, and add performance counters to make the app feel native-fast.

### Constraints
- Do not change Library game count (82) or Sidebar installed-only behavior (34).
- Do not make Sidebar mirror Library or re-enable achievement auto-scans.
- Do not create new services or databases; reuse existing patterns.
- Prefer batch APIs, early no-op skips, idle scheduling, stable cache restoration, small incremental changes.

### Phase 0+11: Performance counters + boot summary
- Created `src/services/perfCounters.ts` — module-level counters for Tauri invokes, appinfo attempts/skips/writes, snapshot writes/skips, media classify, jobs queued, store cache source.
- `initPerfCounters()` called at boot start, `logBootPerfSummary()` runs 100ms after boot transitions to `ready`.
- `[PERF][BOOT]` log with all counter values and elapsed time.

### Phase 1: Boot phase boundaries
- Added phase markers: `critical-start` → `critical-done` → `post-shell-start` → `post-shell-done` → `idle-ready`.
- Each phase logged via `setBootPhaseLabel()` in `perfCounters.ts` and `[BOOT] phase=<phase>` console log.
- `critical-start`: before Stage 1 (load settings).
- `critical-done`: after Stage 3 (snapshot loaded + hydrate).
- `post-shell-start`: after Stage 7 (achievement watcher started).
- `post-shell-done`: after Stage 10 (confirm-mounted).
- `idle-ready`: when `_bootStatus = "ready"`.

### Phase 2: Idle scheduler
- `backgroundJobQueue.ts` — added `_routeShellReady`, `_bootCompleted`, `_lastNavigationChange`, `_idleAcknowledged` flags.
- `isIdleReady()` checks: routeShellReady && bootCompleted && no-navigation-5s && store-inactive && no-max-active-jobs.
- `setRouteShellReady(v)`, `setBootCompleted(v)`, `setNavigationChanged()` methods on the queue.
- `processNext()` defers P4-P6 jobs (background-repair, achievement, cleanup) when not idle ready, logs `[IDLE][DEFER]` with reasons.
- P0-P3 jobs always run regardless — user-initiated and visible-page actions are never blocked.
- `[IDLE][READY]`, `[IDLE][RUN]`, `[IDLE][DONE]` diagnostic logs.
- Boot coordinator calls `setRouteShellReady(true)` at Stage 8, `setBootCompleted(true)` when boot transitions to ready.

### Phase 3: Batch Tauri commands
- Stage 5 (achievement cache reads): switched from sequential `for..await` to `Promise.allSettled` for 20 concurrent reads in boot critical path.
- Stage 4.5 already uses `readCanonicalAppinfos(appIds)` batch API.
- Stage 6 already uses batch `getMediaManifestsBatch`.
- Idle scheduler's `_bootCompleted` guard prevents premature background work.

### Phase 6: Store state consolidation
- `DiscoverState` in `storeDiscoverStateCache.ts` already serves as unified single source of truth with fingerprint + status validation.
- `CacheEntry` in `storeDiscoverCache.ts` handles persistent caching with partial-cache guard.
- No additional consolidation needed.

### Phase 7: Store large catalog guard
- `rankedSteamCatalog`, `catalogGames`, `allStoreSections`, `moreToExploreGames` all use `useMemo` with stable `catalogFingerprint` dependency.
- `allStoreSections` checks cached version first via fingerprint match, skips recomputation.
- No additional guards needed.

### Phase 10: Background validation deferral
- `validate-portable-paths`, `generate-achievement-schema`, `ensure-achievement-images` all deferred via idle scheduler (P4-P6 tiers).
- Store-active check in processNext blocks `STORE_BLOCKED_JOB_TYPES` before marking jobs running.

### Key Files Changed
- `src/services/perfCounters.ts` — **new** — counters + boot summary log
- `src/services/appBootCoordinator.ts` — phase markers, setRouteShellReady/setBootCompleted integration, Promise.all batch for achievement cache reads, perf summary log after boot
- `src/services/backgroundJobQueue.ts` — idle scheduler (isIdleReady, setRouteShellReady, setBootCompleted, setNavigationChanged), P4-P6 deferral in processNext, [IDLE] logs, countJobQueued integration

## Session — React Render Audit + Disk Hot Path Reduction

### Goal
Reduce unnecessary React re-renders (context boundary memoization, effect deps) and eliminate redundant `getGameAppInfo` Tauri invokes via a session-level cache.

### Prompt 7: Context boundary memoization
- **LibraryGamesContext**: `useMemo` on context value, `useCallback` on `setSelectedId`, `setSelectedGame`, `refresh` — prevents cascade re-renders of all consumers on every library load
- **RouteTransitionContext**: `useMemo` on value with `[isPending, navigatingTo]` — prevents router re-render on unrelated state changes
- **GameDetailsContext**: `useCallback` on `selectGame`/`clearSelection`, `useMemo` on value — stops re-creating callbacks on every render
- **FavoritesContext**: `useMemo` on value with `[favoriteIds]` — stops re-creating object identity on every render
- **Store.tsx no-deps effect** (line 1260): Added 14-item explicit dependency array (was deps-free, ran on every render)
- **`VIRTUAL_CARD_STYLE`**: Extracted constant — replaces 2 identical inline style objects

### Prompt 8 Phase 1: Disk/cache audit counters
- `perfCounters.ts` — added `_appinfoReads`, `_appinfoCacheHits`, `_appinfoBatchReads`, `_diskReadsBoot`, `_diskReadsRoute`, `_diskWritesBoot`, `_diskWritesRoute`, `_manifestReads`
- `logBootPerfSummary()` — `[PERF][DISK]` line with all disk counters, `[PERF][CACHE_HIT_RATE]` with appinfo cache hit/miss ratio
- `[DATA_SOURCE_MAP]` — logged once on boot documenting data source layering

### Prompt 8 Phase 3: Session-level appinfo cache
- `gameCacheService.ts` — `_sessionAppinfoCache` (Map<string, GameAppInfo | null>) replaces direct `getGameAppInfo` Tauri invoke for read-heavy code paths
- `getCachedGameAppInfo(appId)` — checks in-memory cache first; counts cache hit/read via `countAppinfoCacheHit`/`countAppinfoRead`
- `clearSessionAppInfoCache(appId?)` — clears cache for a specific appId or all entries
- Cache invalidated on write paths: `updateGameAppinfoMediaIfChanged` deletes cached entry after `updateGameAppinfoMedia` completes; post-repair re-read in `loadGameAppInfoWithMediaFallback` also invalidates before read
- 8 call sites converted from `getGameAppInfo` to `getCachedGameAppInfo`:
  - `resolveCanonicalName` (read before metadata fallback)
  - `fillCanonicalName` (read check + pre-write merge)
  - `loadGameAppInfo` (public wrapper)
  - `loadGameAppInfoWithMediaFallback` (session cache hit + primary disk read)
  - `cacheAppInfoMedia` (pre-write merge)
  - `detectAndQueueMissingMedia` (repair source resolution)
  - `refreshArtwork` (repair source resolution)
- Import: `countAppinfoRead`, `countAppinfoCacheHit` from `./perfCounters`

### Key Files Changed
- `src/services/perfCounters.ts` — disk/cache counters, updated boot summary
- `src/services/gameCacheService.ts` — `_sessionAppinfoCache`, `getCachedGameAppInfo`, `clearSessionAppInfoCache`, 8 call site conversions, cache invalidation on writes
- `src/contexts/LibraryGamesContext.tsx` — `useMemo` on value, `useCallback` on setters
- `src/contexts/RouteTransitionContext.tsx` — `useMemo` on value
- `src/contexts/GameDetailsContext.tsx` — `useCallback` + `useMemo`
- `src/contexts/FavoritesContext.tsx` — `useMemo` on value
- `src/pages/Store.tsx` — added deps to no-deps effect, `VIRTUAL_CARD_STYLE` extraction

### Prompt 8 Phase 7: Media path TTL cache
- `gameCacheService.ts` — `setCachedResolvedMedia(appId, value)` wraps `resolvedMediaSessionCache` with `CacheEntry<T>` (value + timestamp)
- `getCachedResolvedMedia` now checks TTL (`MEDIA_PATH_CACHE_TTL_MS = 10min`) before returning stale data
- `getCachedGameMediaPaths(appId)` — public wrapper for read paths
- `clearCachedGameMediaPaths(appId?)` — public clear for invalidation
- All `resolvedMediaSessionCache.set()` call sites migrated to `setCachedResolvedMedia()`
- Stale entries auto-evicted on next read

### Prompt 8 Phase 8: SQLite as read index for names
- `gameCacheService.ts` — `getSqliteName(appId)` reads SQLite games table via `readAllGames()` (cached 5min, single invoke per 5min)
- `resolveCanonicalName` checks SQLite cache FIRST before appinfo.json
- 1 `readAllGames` invoke per 5min vs 82 `getGameAppInfo` invokes

### Prompt 8 Phase 9: Hot path write policy
- `updateGameAppinfoMediaIfChanged` invalidates `_sessionAppinfoCache.delete(appId)` after each write
- Post-repair re-read invalidates cache before re-read

### Prompt 8 Phase 10: Cache freshness TTL
- `CacheEntry<T>` generic type with `{ value: T; ts: number }` pattern
- `APPINFO_CACHE_TTL_MS = 5min` (appinfo cache)
- `MEDIA_PATH_CACHE_TTL_MS = 10min` (resolved media paths)
- `isCacheEntryFresh()` helper — old entries (no `.ts`) treated as stale

### Prompt 8 Phase 11/12: Boot/Route disk budgets
- `perfCounters.ts` — boot warning when `_diskReadsBoot > 500` or `_diskWritesBoot > 200`
- `checkRouteDiskBudget(routeName)` — warns when `_diskReadsRoute > 50`, resets counters

### Key Files Changed (additional)
- `src/services/perfCounters.ts` — boot/route budget warnings, `checkRouteDiskBudget`
- `src/services/gameCacheService.ts` — `CacheEntry`, TTL constants, `setCachedResolvedMedia`, `getSqliteName`, `getCachedGameMediaPaths`

### Build
- `tsc --noEmit` ✅ passes (only pre-existing `LibraryGameDetails.tsx` unused-variable warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)

## Session — Store Route Jank Fix (click handler defer + log dedup)

### Goal
Prevent Store-to-Home navigation jank by deferring non-critical work out of click handlers and deduplicating per-render/re-mount console logs.

### Phase 1: Audit — AppRouteTransition behavior
- `AppRouteTransition` wraps children with CSS transition only — React unmounts old page, mounts new page immediately on `routeKey` change. No keep-alive.
- Render summary (`logRenderSummary`) is cumulative per-session, not a transition spike. 2140 PackageCard renders over an entire Store session is expected.

### Phase 5: Defer heavy click handler work in openDetailsForGame
- **Restructured `openDetailsForGame`** (`Store.tsx:1984`):
  - CRITICAL PATH (in handler): `setActiveSectionId(null)`, `setSelectedDetailGame(game)` — immediate React state updates
  - Fast cache hydrate path stays in handler
  - DEFERRED PATH: Extracted `scheduleSourceResolve()` — runs via `setTimeout(0)` to let the browser paint first
  - Deferred: `pushInteractionEvent`, `setInteractionScoreByAppId`, `setSourcesLoadingByAppId`, `updateSourceAvailability`, `resolveProviderOverlaysForStoreGames`
  - `requestId` comparison still works for stale-request detection (same closure)
- Click handler returns immediately; source resolution starts ~16ms later after the browser has painted

### Phase 6: Deduplicate Store restore logs
- `Store.tsx` — restore effect (`[STORE][STATE_RESTORE]`, `[STORE][DISCOVER_STATE_RESTORED]`) now uses `restoreLoggedRef` to fire only on mount
- Changed dep from `[steamCatalog.length]` to `[]` — no need to wait for catalog load (cached state is always available)
- Prevents re-logging on Steam catalog refetches

### Phase 7: Gate per-render debug logs
- `App.tsx` — added `DEBUG_ROUTE_RENDER = false` flag; `[ROUTE][PAGE_RENDER]` now requires both `DEBUG_ROUTE_RENDER` AND `import.meta.env.DEV`
- `StoreGameDetailsPage.tsx` — `logDetailsMedia` call gated behind `ENABLE_VERBOSE_SOURCE_LOGS` (was always firing)

### Key Files Changed
- `src/pages/Store.tsx` — `openDetailsForGame` restructured + `scheduleSourceResolve` extract; `restoreLoggedRef` + dep change in restore effect
- `src/App.tsx` — `DEBUG_ROUTE_RENDER` flag, gate `[ROUTE][PAGE_RENDER]`
- `src/components/store/StoreGameDetailsPage.tsx` — gate `logDetailsMedia` behind `ENABLE_VERBOSE_SOURCE_LOGS`

### Build
- `tsc --noEmit` ✅ passes (only pre-existing `LibraryGameDetails.tsx` unused-variable warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)

## Session — Final Smooth Startup Guard: Do Not Build Cold Store During Boot Critical Path

### Goal
Avoid heavy Store Discover build over 162K games during boot critical path.

### Part 1: App.tsx — restore fallback
- `restoreActivePage()` checks `getCachedStoreDiscover()` + `isCacheComplete()` when stored page is `"store"`.
- If no complete cache, returns `"home"` instead. Log: `[ROUTE][RESTORE_FALLBACK]`.

### Part 2: Store.tsx — defer cold discover build
- `rankedSteamCatalog` useMemo: when no complete cache and `!isBootReady()`, returns `[]` + logs `[STORE][BUILD_DEFER]`.
- `deferredBuildKey` + `bootPollRef` — polls `isBootReady()` at 300ms intervals; increments key when ready, triggering rebuild.
- Partial cache write guarded: logs `[STORE][PARTIAL_BUILD_DEFER] reason=boot-critical`.

### Part 3: Complete cache fast path preserved
- When complete cache exists, `rankedSteamCatalog` returns cached data instantly — no deferral overhead.

### Key Files Changed
- `src/App.tsx` — import + restore fallback
- `src/pages/Store.tsx` — `isBootReady` import, `deferredBuildKey`/`bootPollRef`, deferral guard, polling effect, partial cache guard

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)

## Session — Playtime Lookup Fixes (Phases 2-8)

### Goal
Fix playtime not showing correctly across all surfaces by auditing the entire playtime data flow — from Rust `record_play_session_end` to TS consumer components.

### Phase 1: Audit complete
Root causes identified:
- **`computeTotalPlaytime()`** was fundamentally wrong: returned `externalPlaytimeSeconds` for external-source games (ignoring local session playtime) and `localPlaytimeSeconds` for local games (ignoring external/imported playtime). Rust already correctly maintains `totalPlaytimeSeconds`.
- **Key construction mismatch**: Some call sites used `game.id` (e.g., `"steam-480"`) instead of `\`app-${game.appId}\`` (e.g., `"app-480"`) for playtime store lookup, producing cache misses.
- **GameHero.tsx** displayed snapshot playtime (`heroGame.playtime` in minutes) instead of playtime store data with per-second precision.
- **`lastPlayedAt`** was only set on session end (Rust) — sessions that ran for hours showed stale `lastPlayedAt` until the game exited.
- **Snapshot playtime** used only Steam stats, ignoring LumaForge-tracked sessions.
- **Manual Refresh Achievements** handled all layers (store + disk) but didn't explicitly schedule a snapshot write.

### Phase 2: Helper functions + `computeTotalPlaytime` fix
- **`computeTotalPlaytime()`** (`playtimeService.ts:122`) now returns `entry.totalPlaytimeSeconds` — trusts Rust's authoritative total.
- **`getPlaytimeEntryByAppId(appId)`** — normalized lookup via `\`app-${appId}\`` key; returns `null` for null/missing appId.
- **`getPlaytimeSecondsForAppId(appId)`** — convenience wrapper returning `totalPlaytimeSeconds` or 0.
- Fixed 6 call sites to use helpers:
  - `GameHero.tsx` — `getEffectiveLastPlayedMs` and hero selection
  - `TopPlayedSection.tsx` — session count + totalSeconds
  - `LibraryGameDetails.tsx` — key construction + lookup
  - `LibraryGameDetailPage.tsx` — key construction for import

### Phase 3: GameHero display
- `heroPlaytimeStr` useMemo — prefers playtime store seconds, falls back to snapshot minutes.
- `lastPlayedStr` useMemo — prefers playtime store `lastPlayedAt` (updated at session start), falls back to snapshot.
- Playtime display shows `"X min"` from store (per-second precision) or snapshot (backup).

### Phase 4: `lastPlayedAt` updated on session launch
- `GameSessionContext.tsx:1078-1083` — after `startPlaySession` succeeds, also updates `cachedStore.games[key].lastPlayedAt` to `Date.now() / 1000` immediately.
- UI now shows "just now" for currently-playing games without waiting for session end.

### Phase 5: Playtime merged into snapshot
- `startupSnapshotService.ts:1184` — snapshot `playtime` field uses `getPlaytimeSecondsForAppId(appId) / 60` (playtime store first), falls back to `game.steamPlaytimeMinutes`.
- Dashboard sections reading snapshot data now see LumaForge-tracked playtime.

### Phase 6: Achievement summary refresh (no changes needed)
- Already implemented in Session — `LibraryGameDetails.tsx:522-638` reads disk cache for visible app only, no auto-scan.
- `ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP = true` flag.

### Phase 7: Manual Refresh Achievements
- Handler calls `achievementStore.setSummary(appIdStr, s)` which persists to disk.
- Next snapshot write (triggered by LibraryGamesContext) picks up fresh achievement data from `achievementStore` during `buildStartupSnapshotFromCurrentState`.
- No explicit snapshot schedule needed — incremental flow captures it.

### Phase 8: Snapshot write reason logging
- `scheduleSnapshotWrite()` now accepts optional `reason` parameter (defaults to `"full-rebuild"`).
- `[BootSnapshot][SCHEDULE] reason=<caller>` log for each call site:
  - `library-reconcile` — from LibraryGamesContext effect
  - `batch-media-update` — from `notifyMediaUpdatedBatch`
  - `media-change` — from `scheduleSnapshotUpdateAfterMediaChange`
- All defer/no-op logs also include `caller=<reason>`.

### Key Files Changed
- `src/services/playtimeService.ts` — `computeTotalPlaytime` fix, `getPlaytimeEntryByAppId`, `getPlaytimeSecondsForAppId`
- `src/components/dashboard/GameHero.tsx` — helper imports, `getEffectiveLastPlayedMs` rewrite, `heroPlaytimeStr` + `lastPlayedStr` useMemoi
- `src/components/dashboard/TopPlayedSection.tsx` — helper imports, sessionCount + totalSeconds via helpers
- `src/components/library/LibraryGameDetails.tsx` — `getPlaytimeEntryByAppId` import, key construction fix
- `src/pages/LibraryGameDetailPage.tsx` — key construction fix for playtime import
- `src/context/GameSessionContext.tsx` — `getCachedPlaytimeStore` import, `lastPlayedAt` update on session start
- `src/services/startupSnapshotService.ts` — `getPlaytimeSecondsForAppId` import, snapshot playtime merge, `reason` param on `scheduleSnapshotWrite`

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)

## Session — Cache Consistency & Memory Fixes (M2, S2, M3, S3, M4)

### Goal
Fix memory and consistency issues across media download queue, snapshot writes, resolved path cache, and media cache invalidation.

### Part 1: M2 — Cancel-vs-completion race in mediaDownloadQueue
- Added module-level `cancelledKeys` Set in `mediaDownloadQueue.ts`.
- `cancelMediaJobsForApp` marks the dedup key before resolving the cancel promise.
- `performDownload` checks `cancelledKeys` after the Rust invoke completes — if cancelled, skips success/failure side effects (no `recentlyCompleted`, no `queueAppInfoUpdate`, no notify).
- `clearMediaQueueState` does **not** clear `cancelledKeys` to avoid reintroducing the race.
- 4 edits across 1 file. `tsc --noEmit` ✅, `vite build` ✅.

### Part 2: S2 — Stale snapshot overwrites fresh in-memory media
- Wired up `trackPendingAppInfoUpdate` / `completePendingAppInfoUpdate` in `mediaDownloadQueue.ts` (3 edits).
- `buildStartupSnapshotFromCurrentState`'s `flushPendingAppInfoUpdates(2000)` now actually waits for in-flight appinfo writes before reading `appinfo.json`.
- Previously the counter was always 0 (exported but never imported — dead code).
- `tsc --noEmit` ✅, `vite build` ✅.

### Part 3: M3 — `resolvedSrcCache` never invalidated on media change
- Added `resolvedSrcCache.clear()` to `invalidateResolvedMediaCache(appId)` in `gameCacheService.ts`.
- Keys are raw filesystem paths (not appIds), so whole-cache clear is required.
- `convertFileSrc()` is cheap (~0.001ms), making this safe.
- 1 edit. `tsc --noEmit` ✅, `vite build` ✅.

### Part 4: S3 — Snapshot writes deferred indefinitely during interaction
- Added `MAX_DEFER_DURATION_MS = 30_000` + `_mediaUpdateDeferStart` / `_fullRebuildDeferStart` timestamps in `startupSnapshotService.ts`.
- After 30s of continuous `isInteractionBusy()` deferral, `_processDirtyAppIds` and `scheduleSnapshotWrite` proceed despite interaction.
- Defer timestamps reset after successful writes.
- Existing `_writeInProgress` guard is not bypassed.
- 5 edits. `tsc --noEmit` ✅, `vite build` ✅.

### Part 5: M4 — `cacheMediaForGame` leaves stale session cache
- `gameCacheService.ts`: after `invalidateResolvedMediaCache(appId)` and `notifyMediaUpdated(appId)`, re-seeds `resolvedMediaSessionCache` with current appinfo paths.
- Calls `getCachedGameAppInfo(appId)` (reads fresh `appinfo.json` from disk since session appinfo cache was invalidated by the write), resolves paths via `resolveMediaPaths`, and calls `setCachedResolvedMedia`.
- If resolve fails, the cache stays empty (no stale data).
- `[MEDIA][SESSION_CACHE_RESEED]` / `[MEDIA][SESSION_CACHE_RESEED_SKIP]` diagnostic logs.
- 1 edit. `tsc --noEmit` ✅, `vite build` ✅.

### Key Files Changed
- `src/services/mediaDownloadQueue.ts` — M2: `cancelledKeys` Set + guard in `performDownload`. S2: `trackPendingAppInfoUpdate` / `completePendingAppInfoUpdate` wiring (3 edits).
- `src/services/gameCacheService.ts` — M3: `resolvedSrcCache.clear()` in `invalidateResolvedMediaCache`. M4: re-seed block after `notifyMediaUpdated` in `cacheMediaForGame`.
- `src/services/startupSnapshotService.ts` — S3: max defer timestamps + threshold check in `_processDirtyAppIds` and `scheduleSnapshotWrite` (5 edits).

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — M5: clearMediaQueueState wipes dedup state while active downloads may be in flight

### Goal
Prevent duplicate downloads when `clearMediaQueueState()` is called while active Rust `safe_download_image` invokes are still running (either in `activeJobs` or orphaned in `cancelledKeys`).

### Root cause
`clearMediaQueueState()` unconditionally cleared `recentlyCompleted`/`recentlyFailed`, removing dedup protection for previously-completed jobs. After `cancelMediaJobsForApp` removes jobs from `activeJobs` and adds keys to `cancelledKeys`, `enqueueMediaDownload` had no way to detect orphaned in-flight Rust invokes — the key was not in `recentlyCompleted`, `recentlyFailed`, `activeJobs`, or `pendingQueue`. Re-enqueuing the same job created a second `safe_download_image` invoke for the same URL.

### Part 1: clearMediaQueueState — conditional dedup clear
- `clearMediaQueueState()` now preserves `recentlyCompleted`/`recentlyFailed` when `activeJobs.size > 0 || cancelledKeys.size > 0`.
- Logs `[MEDIA_QUEUE][CLEAR_DEFERRED] active=N orphaned=N` when skipping clearance.
- `pendingAppInfoUpdates` and `appInfoFlushTimer` are still always cleared (safe to clear — completions re-add their pending updates).
- `cancelledKeys` is still NOT cleared (M2 preservation).

### Part 2: enqueueMediaDownload — cancelledKeys dedup check
- After `recentlyCompleted`/`recentlyFailed` checks, added `cancelledKeys.has(key)` check.
- When found, polls at 100ms intervals until the orphaned Rust invoke completes and `performDownload` removes the key from `cancelledKeys`.
- Resolves with `{ success: false, error: "Previously cancelled" }` so the caller knows the previous attempt did not succeed.
- Only fires when `!job.forceRefresh`, matching the other dedup checks.

### Key Changes
- `src/services/mediaDownloadQueue.ts` — `clearMediaQueueState()` conditional dedup clear (line 568-583); `enqueueMediaDownload()` cancelledKeys dedup check (line 435-451).

### Scenario coverage
- **A — clear while active job in flight**: `activeJobs.size > 0` → `recentlyCompleted`/`recentlyFailed` preserved. Re-enqueue hits `activeJobs` loop → deduped.
- **B — cancel prewarm then restart**: `cancelMediaJobsForApp` removes from `activeJobs`, adds to `cancelledKeys`. `clearMediaQueueState` sees `cancelledKeys.size > 0` → preserves `recentlyCompleted`/`recentlyFailed`. Re-enqueue hits `cancelledKeys` check → polls until orphaned job resolves → returns cancelled result.
- **C — clear when idle**: `activeJobs.size === 0 && cancelledKeys.size === 0` → clears dedup state as before.
- **D — normal success/failure**: No changes to `performDownload` or `tryProcessNext` — behavior unchanged.

### M2 preservation
- `cancelledKeys` is never cleared by `clearMediaQueueState`.
- Orphaned job completions still check `cancelledKeys.has(key)` in `performDownload` and return without side effects.

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — B2: Duplicate readAllGames during boot

### Goal
Eliminate duplicate `readAllGames()` calls during boot by reusing Stage 4's SQLite game index in Stage 4.5.

### Root cause
Stage 4 (`appBootCoordinator.ts:294`) calls `loadSteamGameIndex()` → `readAllGames()` to count and log the game index. Stage 4.5's else branch (`appBootCoordinator.ts:447`) calls `loadSteamGameIndex()` again for name enrichment — causing a second full SQLite scan of the `games` table.

### Part 1: Boot-local cache
- Added `_cachedGameIndex` module-level variable (`SteamGameIndexEntry[] | null`) set by Stage 4, read by Stage 4.5.
- Stage 4 now stores `_cachedGameIndex = index` after loading (line 297).
- Stage 4.5 else branch: checks `_cachedGameIndex` first, falls back to `loadSteamGameIndex()` only if null.
- Consolidated two dynamic imports from `fullSteamGameIndex` into one.
- `[BOOT][SQLITE_REUSED]` diagnostic log when cache is used.
- No global cache — module-level variable scoped to boot lifecycle, same pattern as `_cachedSettings`.

### Key Changes
- `src/services/appBootCoordinator.ts` — type import for `SteamGameIndexEntry`, module-level `_cachedGameIndex`, store in Stage 4, reuse in Stage 4.5 (4 edits).

### Scenario coverage
- **A — warm boot (SQLite populated)**: Stage 4 loads index, Stage 4.5 reuses it. `[BOOT][SQLITE_REUSED]` logged. No second `readAllGames()` call.
- **B — first boot (SQLite empty)**: Stage 4 returns empty array, `_cachedGameIndex` set to empty array. Stage 4.5 still enters the else branch (if `sqliteCache` is populated from detection cache), uses empty index → `reconciledGames` stays null. Fallback paths unchanged.
- **C — Stage 4 fails**: `_cachedGameIndex` stays null. Stage 4.5 falls through to `loadSteamGameIndex()` fallback — behavior identical to before.
- **D — validateStartupCacheHealth**: Post-boot diagnostic, still reads SQLite directly (single read, not a duplicate — intentionally kept).

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — B3: Duplicate title enrichment during boot

### Goal
Avoid duplicate metadata/store/appinfo resolution for the same placeholder appIds between Stage 3.5 (enrich-snapshot-titles) and Stage 4.5 (reconcile-lua-games title enrichment).

### Root cause
- Stage 3.5 (appBootCoordinator.ts:243-289) resolves placeholder snapshot titles via `resolveGameMetadata` → `getStoreDetails`, mutates `_snapshotLoaded` in memory, and saves the snapshot.
- Stage 4.5 (appBootCoordinator.ts:483-592) separately resolves placeholder titles for `reconciledGames` via the same `resolveGameMetadata` → `getStoreDetails` chain, plus writes to canonical appinfo.
- On a warm boot, nearly all snapshot games overlap with reconciled games — causing duplicate metadata calls, duplicate store detail calls, duplicate appinfo writes (Stage 4.5 only), and duplicate snapshot saves.

### Part 1: Module-level Map tracking
- Added `_enrichedTitleAppIds: Map<string, string>` (appId → resolvedName) module-level variable, same pattern as `_cachedSettings` and `_cachedGameIndex`.
- Stage 3.5 adds to the Map after each successful enrichment (both metadata and store paths).
- Stage 4.5 checks the Map at the top of the per-game loop before attempting resolution.

### Part 2: Stage 3.5 persists canonical names
- Stage 3.5 now also writes the resolved name to canonical appinfo via `updateGameAppinfoMediaIfChanged` after each successful enrichment.
- Reads existing media from the B1 boot appinfo cache (`getCachedBootAppInfos`) to preserve all 5 media paths (coverPath, backgroundPath, logoPath, iconPath, landscapePath), remote, and mediaSources.
- Uses source tag `"bootStage35Enrichment"` to distinguish from Stage 4.5 writes.
- Safe non-critical try/catch — failure doesn't block enrichment or skip the Map entry.

### Part 3: Stage 4.5 skip logic
- At the top of the per-game loop (after `if (!game.appId) continue;`), checks `_enrichedTitleAppIds.has(game.appId)`.
- When enriched: reads the resolved name from the Map, updates `game.title`, logs `[BOOT][TITLE_ENRICH_SKIP] stage=4.5 appid=... reason=already-enriched`, and continues.
- Non-enriched games proceed through the existing full resolution chain unchanged.

### Part 4: Diagnostic logs added
- `[BOOT][TITLE_ENRICHED] stage=3.5 appid=... source=metadata|store` — per successful enrichment in Stage 3.5.
- `[BOOT][TITLE_APPINFO_WRITE] appid=... source=metadata|store` — when Stage 3.5 writes to appinfo.
- `[BOOT][TITLE_ENRICH_SKIP] stage=4.5 appid=... reason=already-enriched` — when Stage 4.5 skips a game.

### Key Changes
- `src/services/appBootCoordinator.ts` — `_enrichedTitleAppIds` Map, Stage 3.5 Map writes + appinfo persistence, Stage 4.5 skip check (3 edit blocks).

### Scenario coverage
- **A — warm boot with placeholder titles**: Stage 3.5 resolves and writes to Map + appinfo. Stage 4.5 skips those appIds. Logs show `[BOOT][TITLE_ENRICH_SKIP]` for enriched games.
- **B — Stage 3.5 cannot resolve a title**: Map has no entry. Stage 4.5 runs full resolution as before. No regression.
- **C — appinfo already has real name**: Stage 3.5 reads metadata/store, finds name, writes to Map + appinfo (no-op rewrite). Stage 4.5 skips.
- **D — media preservation**: Stage 3.5 appinfo write reads existing media from boot cache and preserves all 5 paths. No artwork fields wiped.
- **E — no snapshot / first boot**: `_snapshotLoaded` is null, Stage 3.5 skips entirely. Map stays empty. Stage 4.5 runs normally. No crash.

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — Audit #10: sourceAvailability cache grows without bound

### Goal
Add bounded cache behavior to `sourceAvailabilityCacheService.ts` so the `cachedIndex.games` record cannot grow indefinitely.

### Root cause
`cachedIndex.games` is a `Record<string, SourceAvailabilityGameEntry>` with no TTL, no max size, and no eviction. Entries are added by `updateSourceAvailability()` and persist forever. The cache is persisted to disk and loaded on boot, so stale entries accumulate across sessions.

### Implementation
- Added `SOURCE_AVAILABILITY_CACHE_TTL_S = 86400` (24 hours)
- Added `SOURCE_AVAILABILITY_CACHE_MAX = 1000` entry limit
- Added `pruneCache()` helper that:
  1. Filters entries older than 24h (by `updatedAt` field, already present in the type)
  2. If still over 1000, sorts by `updatedAt` descending and keeps the newest 1000
  3. Replaces `cachedIndex.games` with the pruned set
  4. Logs `[SOURCE_AVAIL][CACHE_PRUNE] removed=N size=N`
- `getSourceAvailability(appId)`: checks TTL before returning; deletes and returns `undefined` if expired
- `updateSourceAvailability()`: calls `pruneCache()` after inserting the new entry
- No changes to data shape, no new fields, no load-from-disk changes
- Existing callers receive the same `SourceAvailabilityGameEntry` shape unchanged

### Key Changes
- `src/services/sourceAvailabilityCacheService.ts` — 2 constants + `pruneCache()` function + TTL check in `getSourceAvailability()` + `pruneCache()` call in `updateSourceAvailability()` (3 edits)

### Scenarios
- **Normal cache hit**: TTL check passes, entry returned as before
- **Expired entry**: TTL check fails, entry deleted, `undefined` returned → refresh path repopulates
- **Overflow**: After inserting the 1001st unique appId, `pruneCache()` removes oldest entries until ≤1000 remain
- **Store browsing**: No behavior change; stale entries are transparently evicted

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — Cuphead Data Persistence Fixes

### Problem
After playing a game (e.g., Cuphead), session-end data wasn't reflected in the UI:
1. Dashboard `lastPlayedAt` not updated after session ends
2. Detail page playtime not reflecting
3. Achievement percent disappears after page reload

### Root Causes

#### Issue 1: Dashboard lastPlayedAt not updating
- `_processDirtyAppIds` (`startupSnapshotService.ts`) only patched **media fields** (landscapePath, coverPath, etc.)
- After session end, `notifyMediaUpdated` was called with `source: "playtime-changed"`, but `_processDirtyAppIds` never updated `lastPlayed` or `playtime` in the snapshot
- Dashboard reads `heroGame.playtime`/`heroGame.lastPlayed` from snapshot — stale data persisted

#### Issue 2: No React re-render on data change
- `cachedStore` in `playtimeService.ts` is a **module-level variable** — updates via `endPlaySession` or `importExternalPlaytime` don't trigger React re-renders
- `GameHero.tsx` and `LibraryGameDetails.tsx` read from `cachedStore` at render time, but nothing signals a re-render when the store changes
- After session ends, `cachedStore` IS updated correctly, but no component re-renders to reflect the new data

#### Issue 3: Achievement percent lost on reload
- `buildStartupSnapshotFromCurrentState` writes `achievementSummary` to snapshot, but **no component reads it back**
- `LibraryGameDetails.tsx` initializes `achievementsSummary` from in-memory `achievementStore.getSummary()` only
- On page reload: in-memory store is empty, Boot Stage 5 only loads disk cache for top 20 games
- Snapshot's `achievementSummary` (updated by full rebuild after manual refresh) was never used as fallback
- `_processDirtyAppIds` also never updated `achievementSummary` in the snapshot

### Fixes

#### Fix 1: `_processDirtyAppIds` updates playtime + achievement fields
- Added `getPlaytimeEntryByAppId` + `getLastSessionEndForAppId` imports
- Inside dirty appId loop: after media patching, queries playtime store for `lastPlayedAt`/`totalPlaytimeSeconds`, updates snapshot game fields
- Also dynamically imports `achievementStore` and patches `game.achievementSummary` from in-memory store
- Change detection (effectiveChanges) includes playtime/achievement field changes
- `startupSnapshotService.ts`

#### Fix 2: Subscribe/re-render pattern
- **`playtimeService.ts`**: Added `subscribePlaytimeStore()` + `notifyPlaytimeStored()` — called after `importExternalPlaytime`, `startPlaySession`, `endPlaySession`
- **`startupSnapshotService.ts`**: Added `subscribeSnapshotUpdated()` + `notifySnapshotWritten()` — called after both `_processDirtyAppIds` and full-rebuild `saveStartupSnapshot`
- **`GameHero.tsx`**: Subscribes to `subscribeSnapshotUpdated` via a force-update counter — re-renders after snapshot write to pick up fresh `lastPlayed`/`playtime`
- **`LibraryGameDetails.tsx`**: Subscribes to `subscribePlaytimeStore` via a force-update counter — re-renders after playtime store changes to show updated playtime

#### Fix 3: Achievement summary snapshot fallback
- **`_processDirtyAppIds`**: Now also patches `game.achievementSummary` from in-memory achievement store (dynamic import)
- **`LibraryGameDetails.tsx`**: `useState` initializer now falls back to `getCachedSnapshot()` to find the current game's `achievementSummary` when in-memory store is empty

### Key Files Changed
- `src/services/startupSnapshotService.ts` — Fix 1: `_processDirtyAppIds` playtime+achievement update, Fix 2: `subscribeSnapshotUpdated`/`notifySnapshotWritten`
- `src/services/playtimeService.ts` — Fix 2: `subscribePlaytimeStore`/`notifyPlaytimeStored`, calls in `importExternalPlaytime`/`startPlaySession`/`endPlaySession`
- `src/components/dashboard/GameHero.tsx` — Fix 2: `subscribeSnapshotUpdated` subscription for re-render
- `src/components/library/LibraryGameDetails.tsx` — Fix 2: `subscribePlaytimeStore` subscription for re-render; Fix 3: snapshot `achievementSummary` fallback in `useState` initializer

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — Achievement Image Download Freeze + Trigger Boundaries

### Problem
1. **Blocking `ensureAchievementImages`** — single Tauri command downloading 54 images sequentially for app 1167630 caused freeze/crash
2. **Auto-sync watcher triggered image downloads** — `achievementAutoSyncService.ts` called `resolveSteamAchievements` with `forceRefresh: true`, which set `_migrateIcons = true`, triggering `downloadAchievementIconsInBackground` on every librarycache change detection

### Root Cause
- `ensureAchievementImages` (Rust) was a single synchronous command that downloaded all images in sequence before returning — blocking the main thread for seconds
- `_migrateIcons` flag did double duty: controlled both cache normalization AND background image download. Every `forceRefresh: true` caller (including auto-sync watcher) triggered image downloads even though only Manual Refresh should
- The watcher (`achievementAutoSyncService.ts` line 329) and the watcher's `_scheduleResolverRefresh` (`achievementWatcherService.ts` line 942) are separate paths — the auto-sync called `resolveSteamAchievements` with `forceRefresh: true`, while the real-time watcher called without it (safe)

### Fix Part 1 — Non-blocking image download
- Replaced blocking `ensureAchievementsImages` → `downloadAchievementIconsInBackground()` fire-and-forget function in `achievementImageQueue.ts`
- Throttled concurrency: max 3 simultaneous `downloadAchievementImage` invokes
- Manual Refresh buttons still trigger downloads (fire-and-forget via `_migrateIcons` flag), but they no longer block UI

### Fix Part 2 — Watcher doesn't trigger image downloads
- Added `skipImageDownload?: boolean` param to `resolveSteamAchievements` params type (`steamAchievementsResolver.ts:662`)
- Added `_downloadImages = params.forceRefresh === true && !params.skipImageDownload` — separates image download control from icon migration
- Changed image download gate from `_migrateIcons` to `_downloadImages` (`steamAchievementsResolver.ts:1160`)
- Auto-sync service passes `skipImageDownload: true` (`achievementAutoSyncService.ts:330`) → schema re-read + normalized cache write WITHOUT image downloads
- Manual Refresh buttons don't pass `skipImageDownload` → full refresh WITH image downloads

### Trigger boundaries enforced
- **GameDetails mount**: lightweight disk cache read only (`shouldAutoLoadAchievements = false`, no `resolveSteamAchievements` call)
- **Manual Refresh (2 buttons in LibraryGameDetails)**: calls `resolveSteamAchievements(forceRefresh: true)` → schema re-read → normalized cache write → fire-and-forget image downloads
- **Watcher (achievementAutoSyncService)**: calls `resolveSteamAchievements(forceRefresh: true, skipImageDownload: true)` → schema re-read → normalized cache write → NO image downloads
- **Real-time watcher (achievementWatcherService._scheduleResolverRefresh)**: calls `resolveSteamAchievements` without `forceRefresh` → schema re-read → cache write WITHOUT normalization → NO image downloads (already safe)

### Key Files Changed
- `src/services/achievementImageQueue.ts` — Replaced `ensureAchievementsImages` with `downloadAchievementIconsInBackground` (fire-and-forget, throttled 3 concurrent)
- `src/services/steamAchievementsResolver.ts` — Added `skipImageDownload` param, `_downloadImages` flag, separated gate
- `src/services/achievementAutoSyncService.ts` — Passes `skipImageDownload: true`

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

## Session — Full-Completion Mapping Fix + Watcher Stuck Fix + Log Gating

### Problem
1. **Full-completion mapping stops at partial store**: librarycache says 42/42, but `buildProgressPatchFromLibraryCache` only maps `progressMap` entries (recently-changed subset). With 0 in-progress entries, `mappedUnlocked` stays at 19/42 — store shows incomplete despite librarycache indicating full completion.
2. **Watcher globally stuck after batch**: `_syncPendingAppIds.clear()` in `finally` discarded all pending appIds except the current one. After processing a batch, remaining events were lost — watcher appeared alive but silently dropped queued appIds forever.
3. **Verbose debug logs not gated**: `[ACH][SYNC_TRACE]`, `[ACH][WATCHER_STATE]`, `[ACH][PATCH_MAP]`, `[ACH][UI_COUNT_SOURCE]`, `[ACH][OVERLAY_THEME_VARS]`, `[ACTIVITY][TRACE_*]`, `[MEDIA][MANIFEST_*]` printed on every event/render despite having false-by-default debug flags.

### Part 1: Full-completion authoritative marking
- When `patch.unlocked === patch.total && patch.total > 0 && currentCanonicalTotal === patch.total`, ALL `mergedAchievements` are marked unlocked regardless of `progressMap` coverage
- `[ACH][FULL_COMPLETION]` diagnostic log when triggered
- This is safe because librarycache's `nAchieved` === `nTotal` is authoritative — the map may be partial (only recently-changed entries) but the count tells us everything is unlocked

### Part 2: Watcher _syncPendingAppIds progressive drain
- `_syncPendingAppIds.clear()` replaced with `delete(nextAppId)` — preserves remaining pending appIds for next `finally` block
- Event handler `.then()` chain now has `.catch()` that always calls `_debouncedAppIds.delete(appIdStr)` — prevents permanent debounce lock on rejection
- Removed unused `_syncPending` boolean flag (written but never read)
- Null-patch path now calls `_scheduleResolverRefresh(appId, traceId)` matching stale-librarycache pattern

### Part 3: Log gating
- `[ACH][SYNC_TRACE]` in `achievementWatcherService.ts` → `DEBUG_ACH_WATCHER`
- `[ACH][WATCHER_STATE]` → `DEBUG_ACH_WATCHER`
- `[ACH][PATCH_MAP]` in `achievementStore.ts` → `DEBUG_ACH_VERBOSE`
- `[ACH][UI_COUNT_SOURCE]` in `LibraryGameDetails.tsx` → `DEBUG_ACH_DETAILS`
- `[ACH][OVERLAY_THEME_VARS]` in `achievementNotificationService.ts` → `DEBUG_ACH_VERBOSE`
- `[ACTIVITY][TRACE_*]` in `LibraryGameDetailPage.tsx` → `window.__DEBUG_NAME_TRACE`
- `[MEDIA][MANIFEST_*]` in `LibraryGameDetailPage.tsx` and `gameCacheService.ts` → `ENABLE_VERBOSE_MEDIA_CACHE_LOGS`
- `[MEDIA][MANIFEST]` (single-word, concise write log) remains ungated as production summary
- Important warnings: `[WATCHER_STUCK]`, `[WATCHER_CLEANUP_MISSING]`, `[MANUAL_NEEDED_REASON]`, `[OVERLAY_FALLBACK]` remain ungated
- `[ACH][PATCH_MAP_MISSING]` and `[ACH][STORE_AFTER_PATCH]` remain ungated as actionable diagnostics

### Key Files Changed
- `src/services/achievementStore.ts` — Full-completion marking, `[ACH][FULL_COMPLETION]`, `[ACH][PATCH_MAP]` gated
- `src/services/achievementWatcherService.ts` — `_syncPendingAppIds` drain fix (delete not clear), `.catch()` on event handler, removed `_syncPending`, `[ACH][SYNC_TRACE]`/`[ACH][WATCHER_STATE]` gated
- `src/services/achievementNotificationService.ts` — `[ACH][OVERLAY_THEME_VARS]` gated, added `DEBUG_ACH_VERBOSE` import
- `src/components/library/LibraryGameDetails.tsx` — `[ACH][UI_COUNT_SOURCE]` gated
- `src/pages/LibraryGameDetailPage.tsx` — `[ACTIVITY][TRACE_*]` and `[MEDIA][MANIFEST_*]` gated
- `src/services/gameCacheService.ts` — `[MEDIA][MANIFEST_*]` gated behind `ENABLE_VERBOSE_MEDIA_CACHE_LOGS`

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

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

## Session — Universal Download Manager (Download center redesign)

### Goal
Upgrade the Downloads page into a universal download/install activity center supporting Steam install status tracking, Lua/ZIP/manifest packages, and future providers.

### Architecture
- **No new Rust code** — all changes are TypeScript/React only
- **No new services** — reuses existing `DownloadQueueContext` (localStorage-persisted queue) and `installTrackerService` (in-memory Steam install tracker)
- **No duplicate queue model** — unified `DownloadQueueContext` handles both Steam installs and package downloads
- **Steam install progress is observational only** — opens `steam://install/<appid>`, monitors via `checkSteamGameInstalled` (existing Rust command), never downloads Steam files or edits appmanifests

### Part 1 — Generic download/install model
- Extended `DownloadJob` type in `types/download.ts`:
  - `type?: "steam-install" | "lua-package" | "zip" | "manifest" | "media" | "other"`
  - `progressMode?: "determinate" | "indeterminate"` (indeterminate when no reliable percentage)
  - `speedBytesPerSec?: number`, `etaSeconds?: number`, `message?: string`, `artworkUrl?: string`, `parentId?: string`
  - Added `"waiting"` and `"paused"` to `DownloadStatus`
- All new fields are optional — backward compatible with existing serialized localStorage jobs

### Part 2 — Steam install status tracking via existing tracker
- `installTrackerService` already tracks Steam installs: opens URL, polls `checkSteamGameInstalled`, detects `downloadProgress` (BytesDownloaded/BytesToDownload from appmanifest), 5-min timeout
- **New `useSteamInstallSync` hook** (`src/hooks/useSteamInstallSync.ts`) bridges tracker → download queue:
  - `onAny()` callback listens to all tracker events
  - `opening-steam` → adds `addSteamInstallJob(appId, title)` to queue with `status="waiting"`
  - `waiting` with `downloadProgress.percent > 0` → switches to `status="downloading"`, `progressMode="determinate"`, displays real %
  - `waiting` without progress → keeps `status="waiting"`, `progressMode="indeterminate"`, updates message ("Starting…" or "Waiting for Steam…")
  - `installed` → marks `status="done"`, `progress=100`, `message="Installed · Ready to play"`
  - `timeout` → marks `status="failed"`, error "Timeout waiting for Steam to begin downloading."
  - `dismissed` → removes job from queue
- Mounted in `DownloadQueueProvider` via stable `syncRef` pattern — never duplicates `onAny` listener

### Part 3 — Real percentage (observational, determinate when available)
- `checkSteamGameInstalled` Rust command already returns `downloadProgress: { bytesDownloaded, bytesToDownload, percent }` from appmanifest fields
- When `percent > 0 && bytesToDownload > 0`: `progressMode="determinate"` with real percentage
- When unavailable: `progressMode="indeterminate"` using existing `lf-launch-bar` CSS animation (`lf-progress-indeterminate` keyframe)
- No fake percentages ever

### Part 4 — Lua/ZIP/Manifest integration
- `DownloadQueueContext` already handles these via `addJob()` with `fileType`
- `InstallerProgressListener.tsx` listens to Tauri `installer-progress` events and updates jobs
- No changes to the existing package download flow — UI shows both Steam installs and package downloads in the same unified queue

### Part 5 — UI redesign
- **`Downloads.tsx`**: Premium layout with header badge, subtitle, 4-column stats (Active/Queued/Completed/Failed), collapsible completed section with "Limpiar" button, improved empty state with "Explorar biblioteca" link
- **`DownloadJobCard.tsx`**: Unified card supporting both Steam and package items:
  - Shows game artwork when `artworkUrl` available (Steam installs), file-type icon otherwise
  - Provider badge: Steam (blue), Lua (purple), ZIP (amber), Manifest (cyan)
  - Status message below title
  - Determinate or indeterminate progress bar
  - Stats row: downloaded bytes, speed (if available), ETA (if available), installation status
  - Active Steam installs show "Open Steam" action link
  - Cancel active jobs, remove completed jobs
  - Error display
- **`DownloadProgressBar.tsx`**: Supports both `determinate` (percentage + width bar) and `indeterminate` (animated `lf-launch-bar` shimmer)
- **`DownloadStatusBadge.tsx`**: Added `waiting` (amber/clock) and `paused` (zinc/pause) statuses
- All styling uses existing theme variables — compatible with all themes (OLED/Midnight/Crimson/Steam Gray)

### Part 6 — State persistence
- Package downloads persisted to localStorage via existing `DownloadQueueContext`
- Steam install items use a **stable job ID** (`steam-install-<appId>`) — single job per appId, replaces previous terminal jobs
- On app reload, active jobs (including Steam) are marked `failed` with clear message — no fake active items
- Completed items persist until "Limpiar" is clicked
- Failed items persist until dismissed

### Part 7 — Sidebar/library update (already works)
- Steam installs already trigger the `onInstalled` handler in `LibraryGamesContext.tsx` — the real installed pipeline (from the previous session) re-ingests via `checkSteamGameInstalled`, persists to all layers
- Sidebar, library grid, and game details update via React re-render from `useLibraryGames()` context
- No additional work needed — the Downloads page is observational only

### Key Files Changed
- `src/types/download.ts` — Extended `DownloadJob` with `type`, `progressMode`, `speedBytesPerSec`, `etaSeconds`, `message`, `artworkUrl`, `parentId`; added `waiting`/`paused` to `DownloadStatus`
- `src/context/DownloadQueueContext.tsx` — `addSteamInstallJob()`, `getJobByAppId()`, migration in `loadJobs()`, extended `UpdateDownloadJobInput`, `useSteamInstallSync` mount
- `src/hooks/useSteamInstallSync.ts` — **new** — bridges `installTrackerService` → `DownloadQueueContext`
- `src/components/downloads/DownloadProgressBar.tsx` — Added `mode` prop for determinate/indeterminate
- `src/components/downloads/DownloadStatusBadge.tsx` — Added `waiting`/`paused` statuses
- `src/components/downloads/DownloadJobCard.tsx` — Redesigned as unified card (Steam artwork, provider badge, speed/ETA, Open Steam action)
- `src/pages/Downloads.tsx` — Redesigned with premium layout, 4-column stats, collapsible completed, empty state with link

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (no errors)
- `cargo check` ✅ (no Rust changes)

## Session — Downloads page: remove direct game launch, navigate to GameDetails instead

### Problem
The Downloads page "Jugar" button called `session.launchGame()` directly, creating a semi-direct launch path. This caused mismatched behavior: overlay routing logic in GameDetails was bypassed, and the session managed state (running in foreground, overlay cleared on navigation) was never established.

### Fix

#### Part 1: Remove `onPlay` from `DownloadJobCard`, replace with `onOpenDetails`
- Removed `onPlay: (appId: string) => void` prop from `DownloadJobCardProps`
- Added `onOpenDetails: (appId: string) => void` prop
- Changed "Jugar" button (Play icon) → "Ver detalles" button (Eye icon)
- Removed unused `Play` import, added `Eye` import from `lucide-react`
- No changes to Open Steam, Open folder, Remove actions

#### Part 2: Remove `handlePlay` from `Downloads.tsx`, add `handleOpenGame` with navigation
- Removed imports: `useGameSession`, `LibraryGame`, `showError`
- Removed `session = useGameSession()`
- Removed `handlePlay` (was building a `LibraryGame` from snapshot data and calling `session.launchGame()`)
- Removed `[DOWNLOAD_PLAY]`, `[GAME_SESSION_START]` diagnostic logs
- Added `useLibraryGames()` for `setSelectedGame` and `games`
- Added `onNavigate?: (page: AppPage) => void` prop to the component
- Added `handleOpenGame(appId)` — finds game in `games` by appId, calls `setSelectedGame(game)` then `onNavigate("library-game-detail")`
- Snapshot fallback: if game not in library, retries lookup via `getBootSnapshot`
- All `DownloadJobCard` instances now pass `onOpenDetails={handleOpenGame}`

#### Part 3: App.tsx wiring + log cleanup
- Changed `<Downloads />` → `<Downloads onNavigate={handleNavigate} />`
- Removed two `[SESSION_OVERLAY_ROUTE]` console.log statements from `SessionOverlayWrapper` (added for the Downloads play path)

### Key Files Changed
- `src/components/downloads/DownloadJobCard.tsx` — `onPlay` → `onOpenDetails`, Jugar → Ver detalles, `Play` → `Eye` icon
- `src/pages/Downloads.tsx` — replaced `handlePlay`/`useGameSession` with `handleOpenGame`/`useLibraryGames`/`onNavigate`
- `src/App.tsx` — pass `onNavigate` to `<Downloads>`, removed `[SESSION_OVERLAY_ROUTE]` logs

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)

## Session — Remove fake simulated uninstall, replace with safe Steam-managed flow

### Problem
Two context menus had "Uninstall" actions that showed a confirm dialog then a fake success toast `"Game uninstalled (simulated)."` — the user believed the game was uninstalled but nothing happened.

### Root cause
- `GameLauncherTile.tsx` — `handleUninstall()` function called `confirm()` then `showSuccess("Game uninstalled (simulated).")`
- `SidebarLibraryList.tsx` — inline handler with same pattern: `confirm()` then `showSuccess(...)`
- No actual uninstall logic existed — both were no-ops that pretended success

### Fix

#### Part 1: GameLauncherTile.tsx
- Removed `handleUninstall()` function entirely
- Removed `useConfirm` import + `const { confirm }` destructuring
- Removed `Trash2` from lucide imports (only used for uninstall)
- Replaced menu item: `"Uninstall"` with `Trash2` → `"Uninstall in Steam"` with `ExternalLink`
- On click: opens `getSteamStoreUrl(appId)` via `openExternalUrl` + shows info toast
- Toast: `"Steam opened. Complete uninstall in Steam. LumaForge will update automatically."`
- No confirm dialog, no fake success

#### Part 2: SidebarLibraryList.tsx
- Removed inline uninstall handler (confirm + simulated toast)
- Removed `useConfirm` import + `const { confirm }` destructuring
- Removed `Trash2` from lucide imports
- Replaced menu item: `"Uninstall"` with `Trash2` → `"Uninstall in Steam"` with `ExternalLink`
- Same click behavior: opens Steam store page, shows info toast

### Behavior
- **Click "Uninstall in Steam"**: Opens Steam store page in browser. Shows info toast (not success). Game remains installed in LumaForge.
- **User cancels in Steam**: No change — LumaForge still shows installed.
- **User completes in Steam**: 30-second passive poll detects missing appmanifest → game becomes uninstalled.
- **Lua installed Steam game**: Lua metadata preserved through existing uninstall detection path.
- **No remaining fake strings**: Only `simulated://` URL in `achievementWatcherService.ts` dev tool remains (unrelated).

### Key Files Changed
- `src/components/games/GameLauncherTile.tsx` — removed `handleUninstall`, `useConfirm`, `Trash2`; replaced menu item with `"Uninstall in Steam"` + external link + info toast
- `src/components/layout/SidebarLibraryList.tsx` — removed inline uninstall handler, `useConfirm`, `Trash2`; replaced menu item with `"Uninstall in Steam"` + external link + info toast

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Global Search → Store Details Source/Ownership Hydration

### Problem
Global search navigation created a bare `PackageGame { sources: [] }` and passed it to `StoreGameDetailsPage` without source cache hydration or ownership state, causing "No Sources Available" on cached games.

### Root cause
- `GameDetailsPage` bypassed `openDetailsForGame`'s cache hydration (source availability, overlay cache)
- Ownership state (`steamOwned`, `steamInstalled`, `luaInstalled`) was never resolved
- `StoreGameDetailsPage` internal check found no sources and no ownership context → showed empty state during async gap

### Fix
- Added async hydration effect in `GameDetails.tsx` on `selectedGame?.appId` change
- Source hydration: loads `sourceAvailabilityIndex` → if `getSourceAvailability(appId)` has `"ready"` status, builds `PackageSource[]` and sets `hydratedStatus="ready"`; cache miss leaves `hydratedStatus=undefined` so internal discovery fires
- Ownership resolution: `useLibraryGames().games` for `steamInstalled`, `readSteamOwnedCache()` for `steamOwned`, `scanInstalledLuaScripts(settings.luaPath)` for `luaInstalled`
- `displayGame` useMemo merges hydrated sources into PackageGame
- `effectiveSourceStatus` passes `"ready"` only on cache hit, else `undefined`
- Diagnostic logs: `[STORE][DETAILS_STATE_RESTORE]`, `[STORE][SOURCE_RESTORE_FROM_CACHE]`, `[STORE][SOURCE_EMPTY_GUARD]`, `[STORE][OWNERSHIP_STATE]`
- No new files, services, hooks, or components created

### Key Files Changed
- `src/pages/GameDetails.tsx` — hydration effect, ownership resolution, updated StoreGameDetailsPage props

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Search result badges + "Sources: None" retry fix

### Goal
Fix global search result badges (ownership/library/install state) and replace "Sources: None" dead-end with retry/re-check UX.

### Part 1: Global search result badges
- `PackagesToolbarSearch.tsx` — added `useLibraryGames()` for `games` and `steamInstalledSet` (computed from `games` with `steamInstalled=true`)
- Added `steamOwnedSet` loaded once on mount via `readSteamOwnedCache()`
- Added `luaInstalledSet` computed from `games` filtered by `hasLua`
- `dropdownItems` enriched with `owned`, `installed`, `inLibrary` fields
- Removed stale dynamic import (`scanInstalledLuaScripts`/`getInstalledAppIds` — not exported by module)

### Part 2: StoreGameSummaryPanel — retry/re-check UX everywhere
- `isChecking` now includes `"idle"` status (was excluded, causing "Sources: None" before check fires)
- `canRetry` now returns true for ANY non-ready, non-checking state (idle → check pending, none → no sources found, needsRetry → check failed)
- Retry button shows for all `canRetry` states (was only `needsRetry`)
- Summary "Sources" label text updated: `"Check pending"` (idle), `"None found"` (isNone), `"Check failed"` (needsRetry)
- Selected Source area shows contextual text per state
- "Sources: None" button label appends " — Check below"
- Diagnostic logs: `[STORE][SOURCE_RETRY_RENDER]`, `[STORE][SOURCE_NONE_LABEL_BLOCKED]`, `[STORE][NO_SOURCES_RENDER_GUARD]`
- Moved `[STORE][NO_SOURCES_RENDER_GUARD]` out of JSX expression into component body

### Part 3: Source restore priority (already correct)
- Existing `GameDetails.tsx` hydration effect checks `getSourceAvailability` cache first — if "ready" with sources, sets `hydratedStatus="ready"` and passes `sourceStatus="ready"` to StoreGameDetailsPage → `effectiveSourceStatus="ready"` → parent controls source status
- On cache miss: `hydratedStatus=undefined` → `effectiveSourceStatus=undefined` → internal check in StoreGameDetailsPage fires via `"idle"` path → provider discovery runs
- Owned games (`steamOwned=true`) already handled by Summary panel (hide source actions)
- Provider health/cooldown: existing `needsRetry`/`canRetry`/`isNone` logic handles all failure states

### Key Files Changed
- `src/components/packages/PackagesToolbarSearch.tsx` — ownership/install sets, enriched dropdownItems
- `src/components/store/details/StoreGameSummaryPanel.tsx` — retry/re-check UX, diagnostic logs, "Sources:" label state text

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Provider/Source stale-none cache fix, Lua inLibrary derivation, source retry

### Problem
1. **Lua inLibrary vs installed confusion**: `isInstalled = luaInstalled || isSteamInstalled` made lua-only games appear "installed", causing `inLibrary = steamOwned && !isInstalled` to exclude them from the "In Library" badge.
2. **Empty "none" result overwrites good cache**: `onEarlyResult` in Store.tsx called `updateSourceAvailability` with `buildSourceAvailabilityFromProviders` which produced `status: "none"` when no available sources yet — overwriting "checking" status before final `.then()` ran, so the preserve-early-return path never fired.
3. **No source rebuild from saved state**: When cache was stale/empty but `getStoreDetailsState` had `selectedProvider` + `providerResults > 0`, no code rebuilt a `PackageSource` from that data.
4. **Provider status blocked by "No Sources"**: `getButtonConfig` checked `isNone`/`needsRetry` before provider-status, blocking "Update Package" button for installed games with valid provider status.

### Part 1: Lua inLibrary derivation
- `StoreGameSummaryPanel.tsx` — `isInstalled = isSteamInstalled` (was `luaInstalled || isSteamInstalled`)
- `inLibrary = steamOwned || luaInstalled` (was `steamOwned && !isInstalled`)
- Status SummaryLine uses `inLibrary` not `steamOwned`
- `[STORE][DETAILS_STATE_DERIVE]` diagnostic log

### Part 2: Block empty "none" cache writes
- `Store.tsx:2572` — `onEarlyResult` guards `updateSourceAvailability` with `if (entry.status !== "none")`
- Same guard in `onRetryEarlyResult`
- `sourceAvailabilityCacheService.ts` `updateSourceAvailability` blocks overwriting existing non-empty cache with empty entry (`[STORE][SOURCE_CACHE_EMPTY_WRITE_BLOCKED]`)
- `markSourceUnavailable` preserves existing sources with `status: "timeout"` instead of clearing

### Part 3: Source rebuild from saved state
- `StoreGameDetailsPage.tsx` `checkSources()` now checks `getStoreDetailsState` for `selectedProvider` + `providerResults > 0`
- On cache miss/stale, tries to find source by provider name and rebuild `PackageSource` with `sourceLog("rebuilt from saved provider")`
- `[STORE][SOURCE_REBUILD_FROM_CACHE]` / `[STORE][SOURCE_RESTORE_START/MISS]` diagnostic logs

### Part 4: Retry clear (already correct)
- Existing `updateSourceAvailability({ status: "checking" })` overwrites stale "none" before discovery starts
- Part 2 guard prevents re-introducing empty "none"

### Part 5: No Sources guard + provider status unblocked
- `StoreGameSummaryPanel.tsx` badge guarded with `!canRetry` — only shows when retry is impossible
- `getButtonConfig` restructured — installed games check provider status FIRST, skip `isNone`/`needsRetry`
- `[PACKAGE][ACTION_RESOLVE]` / `[PACKAGE][MISSING_SOURCE_FOR_PROVIDER]` diagnostics

### Part 7: Global search (already correct)
- `[GLOBAL_SEARCH][RESULT_STATE]` log added in `PackagesToolbarSearch.tsx`

### Key Files Changed
- `src/components/store/details/StoreGameSummaryPanel.tsx` — Lua derivation, No Sources guard, button config
- `src/components/store/StoreGameDetailsPage.tsx` — source rebuild from saved state
- `src/pages/Store.tsx` — `onEarlyResult` empty-save guard
- `src/services/sourceAvailabilityCacheService.ts` — empty-write guard, markSourceUnavailable preserve guard
- `src/services/storeDetailsSourceState.ts` — `getStoreDetailsState` import
- `src/components/packages/PackagesToolbarSearch.tsx` — `[GLOBAL_SEARCH][RESULT_STATE]` log

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Steam Store HTML DRM fallback + Curated Denuvo JSON index

### Goal
Add a read-only Denuvo/DRM badge in `StoreGameDetailsPage` using official Steam Store data as primary source, with curated Denuvo JSON index as secondary fallback.

### Problem
The DRM notice (`"Incorporates 3rd-party DRM: Denuvo Anti-Tamper"`) exists on the public Steam Store HTML (`<div class="DRM_notice">`) but is absent from the `appdetails` API `legal_notice` field for many games (confirmed for 3768760).

### Phase 1 — Rust HTML parser + Tauri command
- `src-tauri/src/commands/metadata.rs`:
  - `extract_drm_notice_from_html` — parses `<div class="DRM_notice">` from Steam Store HTML, returns inner text or null
  - `fetch_steam_store_drm_notice(app_id)` — fetches `https://store.steampowered.com/app/<appId>/` with `Accept-Language: en-US`, extracts DRM notice, logs `[STORE][DRM_HTML_FETCH]`
- `src-tauri/src/models/steam_app_metadata.rs` — added `store_drm_notice: Option<String>` to `SteamAppMetadata`
- `src-tauri/src/lib.rs` — registered `fetch_steam_store_drm_notice` command
- `src/services/tauri.ts` — added `fetchSteamStoreDrmNotice(appId: number)` TS binding

### Phase 2 — Post-step DRM HTML fetch in metadata resolver
- `src/services/gameMetadataResolver.ts`:
  - Post-step DRM notice fetch runs AFTER `resolveGameMetadata` returns when `meta.resolved === true` and `store_drm_notice` is missing from the response
  - `_drmFetchedThisSession: Set<number>` module-level dedup — one fetch per appId per session
  - `clearGameMetadataCache(appId)` clears the dedup entry for that appId
  - `[STORE][DRM_HTML_POST_STEP]` diagnostic log on fetch
  - Cache schema check for `store_drm_notice` field in `loadFromAppCache` — missing field triggers re-fetch

### Phase 3 — DRM extraction helper
- `src/features/drm/storeDrmInfo.ts`:
  - `extractStoreDrmInfo(metadata)` — priority chain with short-circuit return:
    1. `legal_notice` (steam-metadata)
    2. `store_drm_notice` (steam-html)
    3. `detailed_description` (steam-metadata)
    4. `about_the_game` (steam-metadata)
    5. `short_description` (steam-metadata)
  - `searchField()` helper — strips HTML, checks Denuvo patterns first, checks 3rd-party DRM patterns second
  - Denuvo patterns: `\bdenuvo\b`, `\bdenuvo anti-tamper\b`
  - 3rd-party DRM patterns: `incorporates 3rd.party drm`, `3rd.party drm`, `third.party drm`

### Phase 4 — Curated Denuvo JSON index (tertiary fallback)
- `public/data/drm/denuvo-index.json` — bundled JSON with schema v1, 11 curated entries (007 First Light, Resident Evil Village, MH Rise, Tales of Arise, Persona 5 Royal, Sonic Frontiers, Street Fighter 6, Tekken 8, Hogwarts Legacy, S.T.A.L.K.E.R. 2, Dead Space)
- `src/features/drm/curatedDenuvoIndex.ts` — types + helpers:
  - `CuratedDenuvoIndex`, `CuratedDenuvoEntry`, `CuratedDenuvoDrmInfo`, `CuratedDenuvoSource`
  - `normalizeDenuvoTitle(title)` — strips punctuation, lowercase, single spaces
  - `matchCuratedDenuvoEntry(params)` — priority: exact appId → exact normalized title → title + developer/publisher overlap
- `src/features/drm/curatedDenuvoService.ts` — module-level cache, `loadCuratedDenuvoIndex()` (fetch once), `getCuratedDenuvoIndexCached()`, `clearCuratedDenuvoCache()`
  - `[STORE][DRM_CURATED_INDEX_LOAD]` diagnostic log on load

### Phase 5 — Integration in StoreGameDetailsPage.tsx
- Loads curated index on mount via `loadCuratedDenuvoIndex` → `setCuratedIndexReady(true)`
- Second effect matches curated entry when index + metadata are ready: `matchCuratedDenuvoEntry({ appId, title, developerNames, publisherNames, index })`
- `drmInfo` useMemo applies `applyCuratedDenuvoFallback(base, curatedEntry)` — only fires when `source === "none"`
- `[STORE][DRM_CURATED_MATCH]` diagnostic log with confidence and status
- Existing `[STORE][DRM_INFO]` log automatically reflects `source=curated-denuvo-index` when fallback applied

### Source priority (final)
1. **Steam `appdetails` API** — `legal_notice` field (authoritative Steam data)
2. **Steam Store HTML** — `<div class="DRM_notice">` parsed by Rust (official source, enforces English)
3. **Curated Denuvo index** — local bundled JSON (tertiary fallback, no auto-scraping)
4. **Fallback text search** — `detailed_description` → `about_the_game` → `short_description`

### Key Files Changed (this session)
- `src-tauri/src/commands/metadata.rs` — `extract_drm_notice_from_html`, `fetch_steam_store_drm_notice`
- `src-tauri/src/models/steam_app_metadata.rs` — `store_drm_notice` field
- `src-tauri/src/lib.rs` — command registration
- `src/services/tauri.ts` — TS binding
- `src/services/gameMetadataResolver.ts` — post-step DRM fetch + cache schema check
- `src/features/drm/storeDrmInfo.ts` — `applyCuratedDenuvoFallback`, `"curated-denuvo-index"` source, updated `StoreDrmInfo.source` type
- `src/features/drm/curatedDenuvoIndex.ts` — **new** — types + matching helpers
- `src/features/drm/curatedDenuvoService.ts` — **new** — index loader with module-level cache
- `public/data/drm/denuvo-index.json` — **new** — 11 curated Denuvo entries
- `src/components/store/StoreGameDetailsPage.tsx` — curated index integration, matching effects, diagnostic logs

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (only pre-existing unused-variable warnings)

## Session — Phase 2.9: Console Mode Grid & Spotlight Polish

### Problem
The Console Mode Grid view had a narrow right panel and the Spotlight layout needed polish.

### Implementation
- **ConsoleGridLayout** (`src/features/console/ConsoleGridLayout.tsx`): Wider right panel at `w-[420px] xl:w-[460px]` with `overflow-y-auto` for independent scrolling from the grid. Grid uses `grid-template-columns: repeat(auto-fill, minmax(175px, 1fr))` with poster cards. `flex h-screen flex-col` root structure prevents page scroll. Hud at top, grid+panel in middle (`flex flex-1 overflow-hidden`), category bar `shrink-0` at bottom.
- **ConsoleGameCard** (`src/features/console/ConsoleGameCard.tsx`): Focus ring (`ring-2 ring-accent/50`), border accent on focus, title below poster variant, gradient overlay on landscape variant, badges (Installed, Lua, Update), favorite heart, hover dark overlay.
- **ConsoleCategoryBar** (`src/features/console/ConsoleCategoryBar.tsx`): Keyboard hints (Enter=Details, Esc=Back, Tab=Navigate), active category accent highlight, per-category counts.
- **ConsoleSpotlightLayout**: Hero area with background art, centered cards, profile header with display name and playtime, achievement progress bar in preview panel.
- **ConsoleModePage** (`src/features/console/ConsoleModePage.tsx`): Rails-based category system (Continue/Installed/Lua/Favorites/All), keyboard navigation support, layout toggle between spotlight and grid, playtime/achievement stats in Hud.

### Key Files
- `src/features/console/ConsoleGridLayout.tsx` — Grid view with wide panel, scroll behavior, Hud/category bar layout
- `src/features/console/ConsoleModePage.tsx` — Category rails, keyboard nav, layout toggle
- `src/features/console/ConsoleGameCard.tsx` — Card with focus ring, badges, title
- `src/features/console/ConsoleSpotlightLayout.tsx` — Spotlight hero layout
- `src/features/console/ConsoleCategoryBar.tsx` — Category nav + keyboard hints
- `src/features/console/ConsoleProfileHeader.tsx` — Display name + playtime display
- `src/features/console/ConsoleTopHud.tsx` — Top bar with layout toggle
- `src/features/console/consoleMedia.ts` — Card/hero image resolution helpers

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes

## Session — Phase 2.10: Solaris-style Grid Polish

### Goal
Shift the Console Grid view toward a Solaris-inspired dense grid layout: wider preview panel, tighter card grid with no under-card labels, category icons, visual action buttons.

### Part 1 — Grid spacing and card count
- `ConsoleGridLayout.tsx`: Grid uses `minmax(160px, 180px)` for poster cards with `gap-x-6 gap-y-7` (24px horizontal, 28px vertical gaps)
- Yields 7-10 cards per row on 1920-2560px screens with the wider panel
- Landscape variant uses `minmax(200px, 220px)`

### Part 2 — Grid scroll behavior (structure already correct)
- Root `flex h-screen flex-col` prevents page scroll
- Middle container `flex flex-1 overflow-hidden` constrains grid+panel area
- Grid div `flex-1 overflow-y-auto` scrolls independently
- Hud `shrink-0` stays top, CategoryBar `shrink-0` stays bottom
- Panel `overflow-y-auto` scrolls independently

### Part 3 — Remove fixed title labels in Grid mode
- `ConsoleGameCard.tsx`: Added `noLabel` boolean prop
- Poster variant: title block below image is skipped when `noLabel=true`
- Landscape variant: gradient overlay title remains (acceptable per spec — title is ON the art, not under it)
- ConsoleGridLayout passes `noLabel` to all cards in grid mode

### Part 4 — Card focus glow
- `ConsoleGameCard.tsx`: Focus ring increased from `ring-2` to `ring-3` with stronger opacity
- `ring-3 ring-(--color-accent)/60 shadow-xl shadow-(--color-accent)/25`
- Removed dead `group-hover/card:scale-105` from AsyncImage (no group parent existed)

### Part 5 — Wider right preview panel
- `ConsoleGridLayout.tsx`: Panel uses `width: clamp(400px, 35vw, 600px)` with `min-width: 400px` and `max-width: 600px`
- 400px minimum, ~35vw on mid-range, 600px max — previously 420-460px fixed
- Also switched from `w-[420px]` to `clamp()` for responsive width

### Part 6 — Preview panel content upgrade
- Content (hero image, title, badges, stats grid, dev/publisher, achievements bar, genre chips, description) already comprehensive from Phase 2.9
- Better spacing with `gap-5` between sections

### Part 7 — Visual action buttons
- Added at bottom of panel content, separated by divider:
  - **Play** button (disabled, accent color) — placeholder, no real wiring
  - **Details** button (disabled, outline) — placeholder
  - **Favorite** toggle (wired via `useFavorites().toggleFavorite`) — shows heart icon, fills when favorited
  - **Options** button (disabled, outline) — placeholder
- Non-wired buttons show as disabled with low opacity (`opacity-90` / `opacity-50`)

### Part 8 — Category bar icons
- `ConsoleCategoryBar.tsx`: Each category now has a lucide icon before the label:
  - Continue → `Play`, Installed → `HardDrive`, Lua → `Code`, Favorites → `Heart`, All → `LayoutGrid`
- Icons are `h-3.5 w-3.5` with `opacity-70`
- Applies `inline-flex items-center gap-1.5` for proper alignment

### Part 9 — Spotlight stability
- `ConsoleGameCard` changes are backward-compatible: `noLabel` defaults to `false`
- Spotlight layout does not pass `noLabel` — card rendering unchanged
- Focus glow enhancement applies to both views

### Key Files Changed
- `src/features/console/ConsoleGridLayout.tsx` — Full rewrite: wider responsive panel (clamp), tighter grid gaps (gap-x-6 gap-y-7), noLabel on cards, action buttons row, favor toggle wiring
- `src/features/console/ConsoleGameCard.tsx` — Added `noLabel` prop, stronger focus glow (ring-3 + thicker shadow), removed dead group-hover zoom class
- `src/features/console/ConsoleCategoryBar.tsx` — Category icons (Play, HardDrive, Code, Heart, LayoutGrid), inline-flex alignment

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Phase 2.12: Console Mode Settings Overlay & Grid Polish

### Goal
Add Console Mode frontend settings overlay and polish Grid/Solaris layout: wider cards/panel, live-adjustable card size/gap/columns via sliders, input glyph system (Xbox/PlayStation/Keyboard), theme inheritance from app settings, centered bottom nav, and focus shine animation.

### Part 1: consoleSettings.ts — settings store
- **New file** `src/features/console/consoleSettings.ts`
- Types: `ConsoleSettings`, `ConsoleLayoutMode`, `ConsoleThemeMode`, `ConsoleInputGlyphStyle`
- localStorage persistence under key `lumaforge-console-settings-v1`
- `getConsoleSettings()` sync read, `saveConsoleSettings()`, `useConsoleSettings()` React hook
- Defaults: layoutMode=spotlight, theme=follow-app, inputGlyphs=xbox, cardSize=210, gridColumns=8, gridGap=36, sidePanelWidth=680, enableShineAnimation=true

### Part 2: ConsoleSettingsOverlay.tsx — settings UI
- **New file** `src/features/console/ConsoleSettingsOverlay.tsx`
- Fixed overlay with backdrop blur, max-h 85vh scrollable
- Sections: Theme (5 options), Input Hints (3 options), Grid Layout (4 sliders), Shine Animation toggle
- Sliders: Card Size (180–260px, step 5), Grid Columns (4–14, step 1), Grid Gap (16–64px, step 4), Side Panel Width (560–780px, step 10)
- Live apply + auto-persist via `onPatch` → `useConsoleSettings`

### Part 3: consoleInputHints.ts — revised labels
- Removed `DEFAULT_STYLE` constant and `ConsoleThemeMode` type (themes moved to settings)
- Labels per spec: Xbox (A/X/Y/Menu/B/LB RB), PS (Cross/Box/Triangle/Options/Circle/L1 R1), Keyboard (Enter/Enter// /Esc/Esc/F)
- `getConsoleInputHints(style)` accepts glyph style directly

### Part 4: ConsoleGridLayout.tsx — settings-driven layout
- `settings` and `onSettingsPatch` props consumed from ConsoleModePage
- Grid uses `cardSize` for `minmax(cardSize, 1fr)`, `gridGap` for gap
- Panel width set from `sidePanelWidth` (fixed, not clamp)
- Left padding changed from `clamp(40px, 4vw, 90px)` → `clamp(64px, 5vw, 120px)`
- Input hints in panel driven by `settings.inputGlyphs`
- Settings overlay opened from HUD via `onOpenSettings`
- Added `useState` for settingsOpen local state

### Part 5: ConsoleGameCard.tsx — focus shine (already done)
- Phase 2.11 already implemented `console-card-shine` CSS animation and `prefers-reduced-motion` guard
- No changes needed

### Part 6: ConsoleCategoryBar.tsx — centered nav + glyph hints
- Layout changed from `justify-center` with hints inline to `justify-between` with left spacer, centered pills, right-side glyph hints
- Added `inputGlyphs` prop to drive hint rendering
- `showHints` and `inputGlyphs` passed from both Grid and Spotlight layouts

### Part 7: ConsoleTopHud.tsx — settings gear button
- Added `Settings` icon import from lucide-react
- Added `onOpenSettings?: () => void` prop
- Settings gear rendered before the time display when callback is provided
- Passes `onOpenSettings` from both Grid and Spotlight layouts

### Part 8: ConsoleModePage.tsx — settings integration
- Layout mode persisted via `useConsoleSettings` instead of standalone localStorage key
- `data-console-theme` attribute on root wrapper div for CSS theme targeting
- Removed `RAIL_CONFIGS`, `ConsoleProfileHeader`, `ConsoleHomeRail` (unused)
- `layoutMode` and `toggleLayout` driven by `consoleSettings` + `patchConsoleSettings`
- Shared props include `settings` and `onSettingsPatch`

### Part 9: ConsoleSpotlightLayout.tsx — settings integration
- Added `settings` and `onSettingsPatch` props matching GridLayout interface
- Input hints removed (not rendered in Spotlight, uses ConsoleCategoryBar instead)
- Passes `onOpenSettings` to `ConsoleTopHud`
- Passes `inputGlyphs` to `ConsoleCategoryBar`
- Mounts `ConsoleSettingsOverlay` (same component as Grid)

### Key Files Changed
- `src/features/console/consoleSettings.ts` — **new** — settings store with types, defaults, localStorage, React hook
- `src/features/console/ConsoleSettingsOverlay.tsx` — **new** — settings UI with theme, glyphs, sliders, animation toggle
- `src/features/console/consoleInputHints.ts` — revised labels, removed redundant types
- `src/features/console/ConsoleGridLayout.tsx` — settings-driven card size/gap/panel, wider left padding, glyph hints from settings
- `src/features/console/ConsoleCategoryBar.tsx` — centered layout, right-side glyph hints, `inputGlyphs` prop
- `src/features/console/ConsoleTopHud.tsx` — settings gear button, `onOpenSettings` prop
- `src/features/console/ConsoleModePage.tsx` — `useConsoleSettings`, `data-console-theme`, removed dead code
- `src/features/console/ConsoleSpotlightLayout.tsx` — settings props, overlay, glyph hints in category bar

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Phase 2.13: Console Mode reset defaults + disk size/achievement bar

### Goal
Add reset-to-defaults to Console Settings overlay, show disk size and achievement progress in preview panel using shared pure helpers.

### Part 1: Reset to Defaults
- `consoleSettings.ts` — added `DEFAULT_CONSOLE_SETTINGS` export + `resetConsoleSettings()` (clears localStorage, returns defaults)
- `ConsoleSettingsOverlay.tsx` — added "Reset to Defaults" button below sections; calls `resetConsoleSettings()` then patches full defaults via single `onPatch` call

### Part 2: Shared game stat helpers
- `src/features/console/consoleGameStats.ts` — **new** — pure helpers:
  - `formatBytes(bytes?)` — returns `"Unknown"` for null/undefined, `"X.XX GB"` for ≥1GB, `"XX MB"` otherwise
  - `getGameAchievementSummary(game)` — reads `game.achievementSummary` (unlocked/total), returns `{unlocked, total, percent}` or `null`

### Part 3: Preview panel disk size + achievement bar
- `ConsoleGridLayout.tsx` — imported `formatBytes` and `getGameAchievementSummary`; added "Size" row using `formatBytes(focusedGame.sizeOnDisk)`, achievement progress bar (unlocked/total, percent, accent-fill) when summary available

### Key Files Changed
- `src/features/console/consoleSettings.ts` — `DEFAULT_CONSOLE_SETTINGS` export, `resetConsoleSettings()`
- `src/features/console/ConsoleSettingsOverlay.tsx` — reset-to-defaults button
- `src/features/console/consoleGameStats.ts` — **new** — pure game stat helpers
- `src/features/console/ConsoleGridLayout.tsx` — disk size + achievement bar in panel

### Build
- `tsc --noEmit` ✅ passes (no errors)
- `vite build` ✅ passes (no errors)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Global User Profile + Expanded Console Settings

### Goal
Create a global aesthetic user profile reusable by Desktop UI and Console Mode, expand Console Settings with 6 sections (Profile, General, Visuals, Layout, Input, Advanced) for Playnite/Solaris-style customization.

### Part 1: UserProfile store
- `src/features/profile/userProfile.ts` — **new** — localStorage key `lumaforge-user-profile-v1`
- Types: `UserProfile` with `displayName`, `status`, `avatarPreset`, `avatarUrl?`, `bannerPreset`, `bannerUrl?`, `accentMode`, `accentColor?`, `updatedAt`
- Defaults: displayName="Gamer", status="Exploring the library", avatarPreset="gamepad", bannerPreset="midnight", accentMode="follow-theme"
- Exports: `DEFAULT_USER_PROFILE`, `getUserProfile()`, `saveUserProfile()`, `resetUserProfile()`, `useUserProfile()`

### Part 2: Global profile reuse
- `ConsoleTopHud.tsx` — reads real avatar/displayName from `useUserProfile()` instead of hardcoded "Gamer"; removed unused `Gamepad2`, `displayName`, `playtimeHours` props; passes `settings` for `showClock`
- `ConsoleProfileHeader.tsx` — reads `useUserProfile()` + `getAvatarPreset`/`getBannerPreset` for full profile display with banner gradient background
- `TopBar.tsx` — compact profile badge (avatar + displayName) to the left of search; navigates to settings
- `ConsoleModePage.tsx` — passes `profile` + `onProfilePatch` through `sharedProps`

### Part 3: Avatar/banner presets
- `src/features/profile/profilePresets.ts` — **new** — `AVATAR_PRESETS` (6: gamepad, neon, ocean, samurai, synth, pixel) with CSS gradients + emoji icons; `BANNER_PRESETS` (6: midnight, ocean, forest, red-night, steam-blue, amoled) with CSS gradients
- `getAvatarPreset(id)` / `getBannerPreset(id)` lookup helpers

### Part 4: Console Settings overlay 6-section rewrite
- `ConsoleSettingsOverlay.tsx` — fully rewritten with sections:
  - **Profile**: display name input, status input, avatar preset picker (gradient swatches), banner preset picker, accent mode toggle + color picker, Reset Profile button
  - **General**: layout (Grid/Spotlight), start category selector, show clock/profile HUD/platform label toggles
  - **Visuals**: theme picker (5 options), background texture picker (4 options), focus shine toggle
  - **Layout**: sliders (cardSize 180-280, gridColumns 4-14, gridGap 16-64, leftPadding 24-160, sidePanelWidth 560-860), bottom bar position (center/left/right), horizontal/smooth scrolling toggles, Reset Layout button
  - **Input**: input hints picker (Xbox/PS/Keyboard/Auto), show button/bottom hints toggles
  - **Advanced**: Reset Console Settings, Reset All Console & Profile Settings buttons
- Accepts `profile` + `onProfilePatch` props alongside `settings` + `onPatch`

### Part 5: Console settings schema expanded
- `consoleSettings.ts` — new fields: `startCategory`, `themeMode` (renamed from `theme`), `backgroundTexture`, `inputHints` (renamed from `inputGlyphs`), `showClock`, `showProfileHud`, `showPlatformLabel`, `showButtonHints`, `showBottomHints`, `leftPadding`, `bottomBarPosition`, `horizontalScrolling`, `smoothScrolling`, `focusShine` (renamed from `enableShineAnimation`)
- Defaults: layoutMode=grid, themeMode=follow-app, cardSize=220, sidePanelWidth=720, leftPadding=64
- `LAYOUT_DEFAULTS`, `resetConsoleLayoutSettings()`, `resetAllConsoleAndProfileSettings()` exports
- Legacy migration: reads old `lumaforge-console-settings-v1` format, maps `theme`→`themeMode`, `inputGlyphs`→`inputHints`, `enableShineAnimation`→`focusShine`, removes old key after migration

### Part 6: Reset defaults (all 4 buttons)
- **Reset Profile**: `resetUserProfile()` + `onProfilePatch(DEFAULT_USER_PROFILE)` — instant
- **Reset Layout**: `resetConsoleLayoutSettings()` + `onPatch(LAYOUT_DEFAULTS)` — partial
- **Reset Console Settings**: `resetConsoleSettings()` + `onPatch(defaults)` — full
- **Reset All**: `resetAllConsoleAndProfileSettings()` + patches both stores — clears both localStorage keys

### Part 7: Theme behavior + CSS presets
- `ConsoleModePage.tsx` — `data-console-theme={consoleSettings.themeMode}` on root wrapper
- `App.css` — 4 console theme CSS presets: solaris-dark (bluish-purple), steam-deck (dark blue-gray/green), midnight (deep blue-black), amoled (true black)
- `follow-app` uses existing global CSS variables (no override)

### Part 8: Layout setting integration
- `ConsoleGridLayout.tsx` — uses `settings.cardSize`, `settings.gridColumns`, `settings.gridGap`, `settings.leftPadding`, `settings.sidePanelWidth` from new defaults (cardSize=220, sidePanelWidth=720, leftPadding=64)

### Part 9: Input hints updated
- `consoleInputHints.ts` — `ConsoleInputHintStyle` includes `"auto"` (auto-detects PlayStation on macOS, Xbox on others); `ConsoleInputGlyphStyle` removed

### Key Files Changed
- `src/features/profile/userProfile.ts` — **new** — global user profile store
- `src/features/profile/profilePresets.ts` — **new** — avatar/banner preset definitions
- `src/features/console/consoleInputHints.ts` — added `"auto"` mode, type rename
- `src/features/console/consoleSettings.ts` — expanded schema, legacy migration, reset helpers
- `src/features/console/ConsoleSettingsOverlay.tsx` — full 6-section rewrite
- `src/features/console/ConsoleTopHud.tsx` — profile-driven, removed hardcoded values
- `src/features/console/ConsoleProfileHeader.tsx` — profile-driven with banner/avatar
- `src/features/console/ConsoleModePage.tsx` — `useUserProfile`, `data-console-theme`, passes profile props
- `src/features/console/ConsoleGridLayout.tsx` — new setting field names, profile/onProfilePatch props
- `src/features/console/ConsoleSpotlightLayout.tsx` — profile/onProfilePatch props, removed unused playtime computation
- `src/features/console/ConsoleCategoryBar.tsx` — `inputGlyphs`→`inputHints` rename
- `src/components/layout/TopBar.tsx` — compact profile badge with avatar + displayName
- `src/App.css` — 4 console theme CSS presets

### Build
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Global User Profile in Sidebar Bottom + Profile Modal

### Goal
Move the global user profile from being only in Console Mode/TopBar to the primary sidebar bottom location (replacing "Reiniciar Steam" / "Sistema listo"), with a dedicated Discord-like ProfileModal for editing.

### Part 1: ProfileModal.tsx (new)
- `src/features/profile/ProfileModal.tsx` — **new** — Discord/Playnite style profile editing modal
- Uses `createPortal` to render at body level, `z-50` backdrop blur
- Sections:
  - **Preview**: banner gradient header, circular avatar overlapping banner, display name, status, accent color dot
  - **Identity**: display name input (max 32), status input (max 48)
  - **Avatar**: 6-preset gradient grid selector with ring highlight, optional custom URL field
  - **Banner**: 6-preset gradient grid selector (3-col) with ring highlight, label on each swatch
  - **Accent**: Follow Theme / Custom toggle; `input[type="color"]` picker when custom
- Footer: Reset Profile (rose/destructive), Cancel, Save (accent)
- Live preview updates while editing (draft state)
- Save calls `onSave`, Cancel discards draft, Reset restores `DEFAULT_USER_PROFILE`
- Escape key, backdrop click close modal
- Focus trap (Tab cycling)
- No Rust, no backend, no file upload

### Part 2: Sidebar bottom profile block
- `Sidebar.tsx` — bottom block replaced from "Reiniciar Steam" + "Sistema listo" to:
  - **Profile block**: avatar circle (gradient from preset or custom URL), accent status dot, display name, status line, "..." menu button on hover
  - Clicking profile opens `ProfileModal`
  - **"..." dropdown menu**: "Configuración" (navigates to settings), "Reiniciar Steam" (placeholder, no real functionality removed)
  - Collapsed mode: avatar only (centered, larger), name in tooltip
  - Version text preserved below profile block
  - External click handler closes dropdown
  - Dynamic import avoided: `saveUserProfile` imported statically alongside `useUserProfile`
- Imports: `useUserProfile`, `saveUserProfile`, `getAvatarPreset`, `ProfileModal`, `Ellipsis` icon

### Part 3: Reuse in Console/TopBar (already done in previous session)
- No changes needed — Console HUD, ProfileHeader, and TopBar already consume `useUserProfile()`

### Part 4: Settings separation
- `ProfileModal` is entirely separate from `ConsoleSettingsOverlay`
- Console Settings remains for layout/visual/input options
- Profile Modal remains for avatar/banner/name/status/accent

### Key Files Changed
- `src/features/profile/ProfileModal.tsx` — **new** — Discord-like profile editing modal
- `src/components/layout/Sidebar.tsx` — replaced "Reiniciar Steam" + "Sistema listo" with profile block + "..." menu + ProfileModal integration

### What happened to Reiniciar Steam / Sistema listo
- "Sistema listo" block completely removed (the new profile block takes its space)
- "Reiniciar Steam" moved into the "..." dropdown menu in the profile block — still accessible but less prominent
- No real functionality removed (original "Reiniciar Steam" was a decorative button with no onClick handler)

### Build
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Steam-style Library GameDetails Hero Redesign

### Problem
The Library GameDetails hero used a rounded card (`rounded-2xl` + shadow + padding) for the foreground image, creating a floating-poster effect disconnected from the blurred backdrop. The Back to Library button used hardcoded white text on hover instead of the theme accent color.

### Root Cause
- **Floating card effect**: Foreground image wrapped in `rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.45)]` with `p-2 sm:p-3` padding — created a distinct card boundary with visible rounded corners and a heavy shadow, making the image look like a separate poster floating on top of the blurred backdrop
- **Blur never visible**: `object-cover` on the foreground image filled 100% of the hero, completely hiding the blurred backdrop behind it
- **No theme accent**: Back button hover used `hover:text-white` — never followed the user's selected theme accent

### Changes

#### Steam-style 3-layer hero structure
- **Layer 1 — Blurred backdrop**: Full `absolute inset-0`, `object-cover`, `blur-2xl`, `scale-110`, `saturate-[1.5]`, dim overlay `bg-black/35`
- **Layer 2 — Main image**: Centered horizontally, `w-[85%]` width, fills hero height (`h-full`), `object-cover`, no rounded corners, no shadow, no padding — image naturally fills 85% width, blurred backdrop visible on the 7.5% sides
- **Layer 3 — Edge blending gradients**: Left/right `w-[clamp(40px,12vw,160px)]` gradients (`from-black/40 via-black/10 to-transparent`) blend main image edges into blurred backdrop. Bottom `h-[clamp(80px,15vh,180px)]` gradient ensures smooth transition into action row

#### Hero dimensions
- Updated from `min-h-[260px] max-h-[480px]` to `min-h-[340px] max-h-[520px]` — taller, more cinematic

#### Back to Library — theme accent on hover
- Idle: `bg-black/15 text-white/60`
- Hover: `bg-(--color-accent)/85 text-white shadow-lg shadow-(--color-accent)/25` — uses `--color-accent` CSS variable, follows theme changes in Settings
- Focus: `ring-2 ring-(--color-accent)/60`

#### Loading skeleton
- Hero skeleton dimensions: `min-h-[340px] max-h-[520px]` matching live hero

#### Action row
- Retained `bg-linear-to-b from-white/[0.03] to-transparent` gradient transition (no hard border)

### Key File Changed
- `src/components/library/LibraryGameDetails.tsx` — complete hero restructure

### Build
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — RAWG/IGDB Optional Providers + Priority Resolver Integration

### Goal
Add RAWG and IGDB as graceful optional media providers in the Console Mode priority-based resolver, with settings fields, extractor functions, and proper priority chain placement.

### Part 1: Settings fields
- `rawgApiKey`, `igdbClientId`, `igdbClientSecret` added to `AppSettings` type in `src/types/settings.ts`
- Default empty-string values in `SettingsContext.tsx`
- No Settings UI yet — fields are read-only until a provider configuration page is built

### Part 2: Extractor functions (`resolveGameMediaByPriority.ts`)
- `fromRawg(input, kind)` — returns background role only (RAWG background artwork is the most useful asset for this provider; no clean covers/logos/icons)
- `fromIgdb(input, kind)` — returns cover and background roles (IGDB has clean cover art and artwork backgrounds)

### Part 3: Priority chain placement
- **Cover**: local → cached → SGDB → **IGDB** → metadata → imageUrl (RAWG skipped — no cover data)
- **Landscape**: local → cached → SGDB → metadata → screenshots → **IGDB** (RAWG skipped — no landscape data)
- **Background**: local → cached → SGDB → **RAWG** → **IGDB** → metadata → screenshots → landscape fallback
- **Logo/Icon**: unchanged (RAWG/IGDB don't provide these)

### Part 4: `MediaResolutionInputs` extended
- Added `rawgData?: RawgArtworkData | null` field
- Added `igdbData?: IgdbArtworkData | null` field
- Both are optional — null values skip the extractor gracefully

### Part 5: Build verification
- `tsc --noEmit` ✅ passes (0 errors)
- `vite build` ✅ passes (0 errors, only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

### Key Files Changed
- `src/features/media/resolveGameMediaByPriority.ts` — `fromRawg()`, `fromIgdb()`, updated `MediaResolutionInputs`, wired into resolveCover/resolveLandscape/resolveBackground, called from `resolveMediaByPriority`
- `src/types/settings.ts` — `rawgApiKey`, `igdbClientId`, `igdbClientSecret` fields
- `src/context/SettingsContext.tsx` — default empty-string values

### Relevant Files (created in prior sessions)
- `src/features/media/mediaProviderClient.ts` — `fetchRawgArtworkDeduped()`, `fetchIgdbArtworkDeduped()` with per-appId dedup, 8s timeout, graceful empty return on missing credentials

## Session — Delete src/features/media/ directory (consolidate into existing services)

### Goal
Remove duplicated media pipeline files under `src/features/media/` by merging their logic into existing services. All 5 files were moved, exports re-exported, and the empty directory deleted.

### Results
- `src/features/media/` **deleted** — no longer exists
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (1992 modules, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

### File disposition

| File | Merged into | Notes |
|------|-------------|-------|
| `resolveGameTrailerByPriority.ts` | `gameMetadataResolver.ts` | `resolveGameHeroTrailers` coalesced into existing `resolveGameHeroTrailers`; `resolveGameTrailerByPriority` kept as thin wrapper |
| `resolveGameMediaByPriority.ts` | `gameCacheService.ts` | `resolveMediaByPriority` (sync), `from*` extractors, `resolve*` per-role, priority chain, `pickUrl`, `pickBackgroundUrl`, `isStorePageBackground`, types (`GameDetailsMediaOptions`, `MediaResolutionInputs`) all merged |
| `resolveGameDetailsArtwork.ts` | `gameCacheService.ts` | `resolveGameDetailsArtwork` (sync-first) and `resolveGameDetailsArtworkAsync` (network-backed) merged |
| `mediaProviderClient.ts` | `storeArtworkResolver.ts` | `fetchRawgArtworkDeduped` and `fetchIgdbArtworkDeduped` moved to existing artwork resolver service |
| `materializeGameMedia.ts` | `gameCacheService.ts` | `materializeResolvedGameMedia`, `clearMaterializeInFlight`, `MaterializeResult` export added |

### Key re-exports
All merged functions are re-exported from their new homes, so consumers (`LibraryGameDetailPage.tsx`, `libraryGameResolver.ts`, `GameLauncherTile.tsx`, etc.) continue to work with updated import paths.

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Console Quick Menu Parts 1-5, 8-10 Implementation

### Goal
Add controller connection/disconnection toasts (Part 1), top system bar with network/controller/jobs indicators (Part 2+3), time format settings (Part 4), startup settings page (Part 5), hover/focus visual polish (Part 8), system bar settings sub-page (Part 9), and input ownership enforcement (Part 10).

### Parts implemented

#### Part 1: Controller connection/disconnection toasts
- `src/features/console/useControllerDetection.ts` — **new** — listens to `gamepadconnected`/`gamepaddisconnected` events, fires `showInfo` toasts with controller name, calls `setGamepadDetected()` for auto hint detection. One-shot dedup via `knownRef` Set.

#### Part 2+3: Top System Bar indicators
- `ConsoleTopHud.tsx` fully rewritten:
  - **network indicator**: `useNetworkStatus()` hook returns "online"/"offline", shows `Wifi` (emerald) or `WifiOff` (rose) icon
  - **controller indicator**: `ControllerIndicator` sub-component listens to gamepad events, shows `Gamepad2` emerald/ muted
  - **jobs indicator**: polls `backgroundJobQueue.getStatus()` every 5s, shows `HardDrive` icon + badge count, hidden when 0
  - **enhanced clock**: `useClock(format, showSeconds)` — uses `Intl.DateTimeFormat` with 12h/24h/system/hidden modes, 1s or 60s interval

#### Part 4: Time format settings
- `ConsoleSettings` type extended with: `timeFormat: "12h"|"24h"|"system"|"hidden"`, `showSeconds: boolean`
- `CONSOLE_TIME_FORMAT_OPTIONS` in ConsoleSettingsPanelV2
- `TIME_FORMAT_DEFAULTS` + `resetConsoleTimeFormatSettings()` export from consoleSettings.ts
- `SETTING_ROWS_TIME` with time format segmented row, show seconds toggle, show clock toggle, reset button

#### Part 5: Startup settings page
- `ConsoleSettings` type extended with: `autostart: boolean`, `launchMode: "console"|"desktop"`, `windowMode: "fullscreen"|"maximized"|"windowed"`
- `LAUNCH_MODE_OPTIONS` / `WINDOW_MODE_OPTIONS` in ConsoleSettingsPanelV2
- `STARTUP_DEFAULTS` + `resetConsoleStartupSettings()` export
- `SETTING_ROWS_STARTUP` with launch mode segmented, window mode segmented, autostart toggle, reset button

#### Part 8+9: System bar settings sub-page
- `ConsoleSettings` type extended with: `showNetworkIndicator`, `showControllerIndicator`, `showJobIndicator`
- `SYSTEM_BAR_DEFAULTS` + `resetConsoleSystemBarSettings()` export
- `SETTING_ROWS_SYSTEM_BAR` with toggles for profile, clock, network, controller, jobs indicators, reset button
- Both "Time & Clock" and "System Bar" added to `SettingsCategoryGrid` and `SETTINGS_KEYS`

#### Part 10: Input ownership enforcement (already correct)
- Page-level handler returns early when `profileOpen` is true; settings panel's `handleGlobalKeyDown` uses `stopPropagation`
- `SETTINGS_KEYS` updated to include `"time"`, `"startup"`, `"system-bar"` for gamepad navigation

### Key Files Changed/Created
- `src/features/console/consoleSettings.ts` — extended type (8 fields), time/startup/system-bar defaults + reset functions
- `src/features/console/useControllerDetection.ts` — **new**
- `src/features/console/useNetworkStatus.ts` — **new**
- `src/features/console/ConsoleTopHud.tsx` — full rewrite with indicators + enhanced clock
- `src/features/console/ConsoleModePage.tsx` — `useControllerDetection` wired
- `src/features/console/ConsoleSettingsPanelV2.tsx` — 3 new sub-pages (time, startup, system-bar), 3 setting row groups, expanded SETTINGS_KEYS

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors, no Rust changes)

## Session — Media provider priority: Steam original assets before SteamGridDB for Steam games

### Problem
For Steam games, media materialization depended too heavily on SteamGridDB, which was checked BEFORE Steam CDN/metadata in all role resolvers. This caused wrong assets to be downloaded (screenshots, storepagebackground) instead of correct role-mapped Steam assets (Hero→background, Header→landscape, Capsule→cover, Logo→logo).

### Root cause
- **`fromSteamCdn` only handled background and logo** — no cover/landscape/icon CDN fallbacks existed
- **SGDB before Steam in all chains** — layout was: local → cached → SGDB → IGDB/RAWG → Steam CDN → metadata → screenshots
- **No `logSteamRoleMap` diagnostic** — no visibility into which Steam metadata fields were available

### Parts implemented

#### Part 1: Steam metadata fields identified
- `SteamAppMetadata` has: `header_image`, `capsule_image`, `capsule_image_v5`, `library_hero_image`, `hero_image`, `logo_image`, `library_logo_image`, `background_image`, `wide_cover_image`, `library_header_image`
- "Original Steam Assets" panel is not a LumaForge component — it's the Steam Store metadata display. All fields come from `appdetails` API via `gameMetadataResolver.ts`
- `buildSteamImageUrl` in `storeImageCache.ts` already supported capsule/header/hero patterns
- No icon field exists in Steam metadata — icon requires Steam Community API hash

#### Part 2: `fromSteamCdn` expanded to cover all 5 roles
- **Cover**: `buildSteamCdnUrl(appId, "capsule")` → `capsule_616x353.jpg` (skipped when metadata has `capsule_image_v5` or `capsule_image`)
- **Landscape**: `buildSteamCdnUrl(appId, "header")` → `header.jpg` (skipped when metadata has `header_image` or `library_header_image`)
- **Background**: unchanged — `library_hero.jpg` (skipped when metadata has `library_hero_image` or `hero_image`)
- **Logo**: unchanged — `logo.png` (skipped when metadata has `logo_image` or `library_logo_image`)
- **Icon**: returns `undefined` (no CDN icon available)
- Added `"capsule"` to `buildSteamCdnUrl` kind union
- Added `logSteamRoleMap(appId, meta)` helper for `[MEDIA_ROLE_MAP]` diagnostics
- Added `logMediaSelect(appId, role, source, url)` helper for `[MEDIA_SELECT]` per-role diagnostics

#### Part 3: Priority chain reordered (Steam before SGDB)

**Cover:** local → cached → **Steam CDN capsule** → **Steam metadata** → SGDB → IGDB → imageUrl
**Landscape:** local → cached → **Steam CDN header** → **Steam metadata** → screenshots → SGDB → IGDB
**Background:** local → cached → **Steam CDN hero** → **Steam metadata** → screenshots → SGDB → RAWG → IGDB → landscapeFallback
**Logo:** local → cached → **Steam CDN logo** → **Steam metadata** → SGDB
**Icon:** local → cached → Steam CDN (none) → SGDB

#### Part 4: No new setting
- Default behavior is Steam-first for all Steam games
- SGDB, RAWG, IGDB remain as fallbacks with their existing `use*` setting controls

#### Part 5: Stale local media (from prior session, verified)
- `refreshGameDetailsArtwork` verifies local paths via `resolveGameMediaPaths` (Rust disk check) before resolution
- Stale paths (file missing on disk but present in appinfo) are filtered out, `[MEDIA_STALE]` diagnostic logged
- Downstream re-resolution picks correct Steam CDN/metadata fallback

#### Part 6: Storepagebackground — only last fallback
- `isStorePageBackground()` + `pickBackgroundUrl()` already filter storepagebackground from `fromMetadata` background chain
- With Steam CDN hero at position 3 (before metadata), `library_hero.jpg` wins even when metadata only has storepagebackground
- Matches user spec: "use storepagebackground only as last ambient fallback"

#### Part 7: Screenshots — fallback only
- Screenshots at position 5 for background (after CDN + metadata)
- Screenshots at position 5 for landscape (after CDN + metadata)
- Screenshots never used for cover, logo, or icon
- Matches user spec: "Do not use screenshots for cover/logo/icon"

#### Part 8: Validation (manual, pending)
- User must delete incorrect files for appId=4717430 and re-open GameDetails to verify

#### Part 9: Debug logs behind `DEBUG_MEDIA_ROLE_MAP = false`
- `[MEDIA_ROLE_MAP]` — per-appId log of Steam metadata fields (header/capsule/hero/logo)
- `[MEDIA_SELECT]` — per-role resolution log with label (steam-cdn-hero/capsule/header/logo or source name)
- `[MEDIA_STALE]` — appinfo path filtered because file missing on disk

#### Part 10: Build validation
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

### Key Files Changed
- `src/services/gameCacheService.ts` — `buildSteamCdnUrl` expanded with "capsule" kind, `fromSteamCdn` expanded with cover/landscape (returns CDN capsule/header), `fromSteamCdn` icon returns undefined, `logSteamRoleMap()` and `logMediaSelect()` helpers, `DEBUG_MEDIA_ROLE_MAP` constant, `resolveCover`/`resolveLandscape`/`resolveBackground`/`resolveLogo`/`resolveIcon` all reordered (Steam CDN + metadata before SGDB), `appId` param added to `resolveCover`/`resolveLandscape`/`resolveIcon`, `meta` param added to `resolveIcon`, call sites in `resolveMediaByPriority` updated, `[MEDIA_STALE]` per-role log in stale detection block

## Session — Refresh Artwork Execution Path + Provider Status Reconciliation

### Objective 1: Fix Refresh Artwork execution path
Parts 1–8 of the media/artwork fix for the `refreshGameDetailsArtwork`/`detectAndQueueMissingMedia`/`executeRepairGameMedia` pipeline.

### Problem
- `loadGameAppInfoWithMediaFallback` check fixed local-source disk verification correctly, but `refreshGameDetailsArtwork` and `detectAndQueueMissingMedia` did NOT
- `refreshGameDetailsArtwork` checked `resolveMediaPaths` (TS-side, returns appinfo paths, not actual files on disk) instead of `resolveGameMediaPaths` (Rust, checks actual disk)
- `resolveMediaByPriority` candidate loop had `continue` at line ~2772 that skipped fallback candidates after the first pick — `findFirstUrl` never reached lower-priority sources
- `executeRepairGameMedia` did NOT go through Steam metadata resolution at all — only checked `mediaSources` (user-configured URLs)
- `performDownload` in `mediaDownloadQueue.ts` wrote stale relative paths to appinfo manifest even for fresh refresh-artwork downloads

### Parts implemented

#### Part 1: Local-source disk verification
- `refreshGameDetailsArtwork` checks `resolveGameMediaPaths` (Rust disk check) before resolution. Stale paths filtered out, `[MEDIA_STALE]` per-role diagnostic logged.
- Downstream re-resolution picks correct Steam CDN/metadata fallback.

#### Parts 4-5: Candidate fallback loop fix
- `resolveMediaByPriority` candidate loop restructured — `findFirstUrl` removed, replaced with `pickFirstUrl` that continues to next candidate when `!url || url === "undefined"`. Fallback candidates now reached.
- `[CANDIDATE_CONTINUE]` / `[FALLBACK_PICK]` diagnostic logs.

#### Part 6: Manifest write guard
- `performDownload` in `mediaDownloadQueue.ts` — when `_freshRefreshAppIds.has(appId)`, nulls non-current-role paths in the appinfo update to prevent stale path overwrites.
- `[MEDIA][MANIFEST_GUARD]` diagnostic log.

#### Part 7: `detectAndQueueMissingMedia` refactored
- Uses `resolveGameDetailsArtwork` (Steam metadata + full priority chain) instead of old `resolveGameMedia`.

#### Part 8: `executeRepairGameMedia` refactored
- Resolves Steam metadata via `resolveGameMetadata` before calling `resolveGameDetailsArtwork` for each role. `mediaSources` used only as last fallback.

#### Background candidate order fix
- storepagebackground deferred to last background candidate (after Steam CDN hero → metadata → screenshots → SGDB → RAWG → IGDB → landscape fallback).
- `[ARTWORK_BACKGROUND_SKIP]` / `[ARTWORK_BACKGROUND_CANDIDATES]` / `[ARTWORK_BACKGROUND_SELECTED]` diag logs.

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)

## Session — Console Mode settings-driven phantom widgets + sub-panel keyboard fix

### Problem
Console Grid/Spotlight layouts had hardcoded values for left padding, card width, scroll behavior, and scroll-snap that should have been driven by `ConsoleSettings` fields (`leftPadding`, `spotlightCardWidth`, `smoothScrolling`, `horizontalScrolling`, `bottomBarPosition`, `backgroundTexture`). Sub-panel keyboard navigation had a window handler conflict where ArrowLeft/ArrowRight fired after sub-panel handlers, overwriting selection.

### Part 1: Analysis
- `leftPadding`: hardcoded `clamp(64px, 5vw, 120px)` in GridLayout scroll container
- `spotlightCardWidth`: hardcoded `w-[clamp(180px,16vw,220px)]`/`w-[clamp(280px,26vw,360px)]` for poster/landscape in SwitchSpotlightLayout
- `backgroundTexture`: defined in type/defaults but never applied as CSS class
- `smoothScrolling`/`horizontalScrolling`: never read by either layout
- `bottomBarPosition`: never read by ConsoleCategoryBar
- Tools/Help sub-panels accepted no shared props, had no keyboard navigation
- Panel `handleKeyDown` processed ArrowLeft/ArrowRight for sub-panel navigation, but window `keydown` handler ALSO processed ArrowLeft/ArrowRight for page-level navigation — sub-panel's action ran first, then window handler overwrote the selection

### Part 2: Panel keyboard fix — remove Left/Right from window handler
- Removed ArrowLeft/ArrowRight case from window `keydown` listener's sub-page section in `ConsoleSettingsPanelV2.tsx`
- Added ArrowLeft/ArrowRight to Layout, Visuals, Media, and Input sub-panel `handleKeyDown` functions for intra-panel navigation
- Added ArrowLeft to `SettingsCategoryGrid` as back-navigation
- All sub-panel handlers now process Left/Right without window handler overwrite

### Part 3: Background texture CSS
- `App.css` — added 4 texture classes: `[data-console-texture="none"]` (no background), `grain-soft` (repeating SVG noise pattern), `vignette` (radial gradient dark edges), `blur` (backdrop-filter blur with brightness)
- `ConsoleModePage.tsx` — reads `consoleSettings.backgroundTexture` and applies `data-console-texture` attribute on root wrapper

### Part 4: Widget settings integration
- **GridLayout**: `paddingLeft` changed from `clamp(64px,5vw,120px)` to `${settings.leftPadding}px`; `scrollBy` behavior uses `settings.smoothScrolling`; passes `bottomBarPosition` to ConsoleCategoryBar
- **SwitchSpotlightLayout**: card width uses `settings.spotlightCardWidth` (landscape), `settings.spotlightCardWidth * 0.625` (poster); `scroll-smooth` and `snap-x` classes conditionally applied from `settings.smoothScrolling`/`settings.horizontalScrolling`; `scrollIntoView` behavior uses `settings.smoothScrolling`
- **ConsoleCategoryBar**: accepts `bottomBarPosition` prop; `justify-start` for left, `justify-end` with reversed DOM order for right, `justify-between` with spacer for center

### Part 6+7: Help/Tools sub-pages improvements
- `ConsoleSettingsPanelV2.tsx` — both Tools and Help sub-panels now accept `navigateTo`, `onOpenSettings`, `onBack` shared props
- Tools: keyboard navigation to switch tabs (Keyboard/Media), Esc back to grid, real tab content
- Help: keyboard navigation, Esc back to grid

### Key Files Changed
- `src/App.css` — grain-soft, vignette, blur texture classes
- `src/features/console/ConsoleModePage.tsx` — `data-console-texture` attribute
- `src/features/console/ConsoleSettingsPanelV2.tsx` — Left/Right sub-panel navigation, removed window handler Left/Right conflict, Tools/Help shared props
- `src/features/console/ConsoleGridLayout.tsx` — settings-driven leftPadding, smoothScrolling, bottomBarPosition pass
- `src/features/console/ConsoleSwitchSpotlightLayout.tsx` — settings-driven spotlightCardWidth, smoothScrolling, horizontalScrolling
- `src/features/console/ConsoleCategoryBar.tsx` — bottomBarPosition alignment

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)

### Objective 2: Fix provider status / Check Update flow

### Problem
`LibraryGame` fields (`steamInstalled`, `isPlayable`, `isInstallable`, `source`) are set once during snapshot hydration (`snapshotGameToLibraryGame` in `LibraryGamesContext.tsx` line ~428) and never refreshed. `getLauncherGamePrimaryAction` reads these stale fields directly — no async provider status verification. Games loaded as `source=lua`/`steamInstalled=false`/`isPlayable=false`/`isInstallable=false` show `primaryAction=install` even when the game is actually installed via Steam. No post-hydration Steam install status reconciliation ran.

### Root Cause
- `snapshotGameToLibraryGame` maps `sg.installed` → `steamInstalled`, `sg.playable` → `isPlayable`, `sg.source` → `source`. These are set once and never rechecked.
- No post-snapshot provider status reconciliation step exists in `LibraryGamesContext.load()`.
- `scanSteamInstalledGames` Rust command (single invoke, <50ms for 80+ games) exists but is only used by uninstall detection (30s poll with 5s initial delay) and full library resolver — never as a lightweight post-hydration check.
- `providerStatusStore`/`providerStatusService` track update-check status (update-available/up-to-date) but NOT the fundamental installed/playable/installable `LibraryGame` fields.

### Fixes

#### Part 2: Post-snapshot Steam install reconciliation
- Created `src/services/providerStatusReconciliation.ts`:
  - `schedulePostSnapshotSteamReconciliation(games, updateGame, options)` — runs 2s after games are hydrated. Calls `scanSteamInstalledGames({ steamPath })`, diffs against current games, calls `updateGame()` for games with mismatched `steamInstalled`/`isPlayable`/`isInstallable`/`source`.
  - `refreshSingleGameSteamStatus(appId, options)` — per-game check with 5min TTL dedup. Returns `{ steamInstalled } | null`. Used by `checkGameProviderStatus` in context.
  - `resetProviderStatusReconciliation()` — clears state for testing.
  - `[PROVIDER][RECONCILE]` / `[PROVIDER][RECONCILE_SKIP]` / `[PROVIDER][RECONCILE_DONE]` / `[PROVIDER][RECONCILE_FAILED]` / `[PROVIDER][REFRESH]` / `[PROVIDER][REFRESH_SKIP]` / `[PROVIDER][REFRESH_FAILED]` diagnostic logs.

#### Part 4: `checkGameProviderStatus` on context
- `LibraryGamesContextValue` exposes `checkGameProviderStatus(appId, force?)` — calls `refreshSingleGameSteamStatus`, then `updateGame()` with corrected fields when status changed.
- Called from `LibraryGamesContext.load()` right after `applyGamesSafely` (before background scan), using `settings.steamRoot`.
- Module-level guard prevents duplicate scheduling.

### Key Files Changed
- `src/services/providerStatusReconciliation.ts` — **new** — post-snapshot Steam reconciliation + per-game refresh
- `src/context/LibraryGamesContext.tsx` — import + call reconciliation after games load; `checkGameProviderStatus` function + context value

## Session — Console Trailers: Remote-only from metadata.movies[], remove all local file/cache lookups

### Problem
Console trailer preview tried to load local files from `media/trailers/` directory via `file:///` URLs, which the WebView blocked. The prior approach of converting local paths through `localPathToUrl` → `http://asset.localhost/...` added complexity with local cache download, stale file handling, and fallback logic that wasn't needed. The correct design is remote-only: use Steam movie links from `metadata.movies[]` directly, never touch local trailer files.

### Decision
- Console trailer videos use remote Steam movie links from `metadata.movies[]` only
- No download/cache of full trailer videos
- No search for local MP4/WebM trailer files
- No embedded `about_the_game`/`detailed_description` videos
- No `file://` local trailer paths

### Part 1 — `consoleTrailerData.ts`: Remove all cache code
- Removed `cacheTrailerFile` import from `tauri.ts`
- Removed `CachedTrailerResult`, `TRAILER_VIDEO_CACHE_ENABLED`, `_cachedTrailerKeys`, `DEBUG_CACHE`
- Removed `extractExt()`, `cacheTrailerForMovie()`, `cacheBestTrailer()`, `clearCachedTrailerKeys()`
- `extractTrailerData` now purely derives from `metadata.movies[]` — no API calls, no side effects

### Part 2 — `ConsoleGameDetails.tsx`: Remove cache wiring
- Removed `cacheBestTrailer` import and call
- Removed `CachedTrailerResult` type import
- Removed `cachedTrailer` state and `setCachedTrailer`
- Removed cache effect block in `useEffect`
- Removed `localVideoPath`/`localThumbnailPath` from `ConsoleSelectedPreview` JSX props

### Part 3 — `ConsoleSelectedPreview.tsx`: Remote-only, no local paths
- Removed `localPathToUrl` import
- Removed `localVideoPath`/`localThumbnailPath` props
- Removed `localMediaFailed` state, `safeLocalThumbnailUrl`/`safeLocalVideoUrl` useMemos
- Removed `useEffect` for resetting error states on local paths
- Image priority (simplified): `trailerData.thumbnail` → `movies[0].thumbnail` → `screenshots[0]` → landscape/background fallback
- Video priority (simplified): `trailerData.mp4Url` → `trailerData.webmUrl` → null (HLS/DASH → disabled overlay)
- `handleImgError` simplified: no local vs remote detection, always sets `imgError`
- `<img>` key retains `${appId}-${displaySrc}` pattern for fresh mount on src change

### Cuphead (appId=268910) expected behavior
- Trailer thumbnail: remote `movie.thumbnail` URL (e.g. `https://shared.akamai.steamstatic.com/...`)
- `hasDirectVideo=false`, `hasStreamFallback=true` (HLS/DASH only)
- Play overlay: disabled `CircleSlash` with "Stream preview unavailable" tooltip
- No `file:///` loading attempts
- No `media/trailers/*` lookup

### Key Files Changed
- `src/features/console/consoleTrailerData.ts` — stripped all cache/download code (6 functions, 3 constants removed)
- `src/features/console/ConsoleGameDetails.tsx` — removed `cacheBestTrailer`, `CachedTrailerResult`, `cachedTrailer` state, cache effect, local path props
- `src/features/console/ConsoleSelectedPreview.tsx` — remote-only image/video priority, removed all local path handling, simplified error handling

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Console Details: video controls, screenshots strip, reviews card, layout rebalance

### Goal
Replace the disabled HLS/DASH preview overlay with full video playback, add video controls (play/pause, seek ±10s, progress bar, time display, mute/unmute, fullscreen-ready), a screenshot strip for browsing, a reviews card with Steam review score color mapping, and rebalance the right-column layout into a two-card achievements/reviews row with more compact achievement display.

### Work completed

#### Part 2: ConsoleSelectedPreview video controls
- Added `screenshotOverrideUrl` prop for screenshot browsing override
- Added full controls bar: play/pause, seek back/forward 10s, progress bar, time display (`formatTime`), mute/unmute toggle, fullscreen-ready button
- Controls auto-hide after 3s when playing, show on hover/mouse-move, always visible when paused
- Native video event handlers (`onPlay`, `onPause`, `onTimeUpdate`, `onLoadedMetadata`, `onEnded`, `onError`) keep state synced
- `formatTime()` helper for `mm:ss` display
- All added state/props are backward-compatible — thumbnail mode unchanged

#### Part 4: Screenshots strip
- Horizontal scrollable strip of small thumbnail buttons below the trailer preview
- Thumbnails derived from `SteamAppMetadata.screenshots[]` full URLs via `_thumb.jpg` suffix (same pattern as `storeMediaService.ts`)
- Click selects screenshot → sets `screenshotOverrideUrl` on `ConsoleSelectedPreview`
- Click again deselects (back to trailer)
- Selected thumbnail shows accent ring with `X` overlay
- Clears selection on game change via effect

#### Part 5: Reviews card
- Fetches review summary via `resolveGameReviewSummaries([Number(game.appId)])` — uses existing in-memory/disk cache, no extra API call if already cached
- Color-coded card background/text/border based on `review_score_desc` (9 colors: Overwhelmingly Positive → emerald, Very Positive → green, Mixed → amber, Negative → red, etc.)
- Shows: review_score_desc, positive_percent, total_reviews count
- Loading state while fetching ("Loading review data…")
- One-shot fetch guard via `reviewFetchRef` prevents duplicate calls

#### Part 6: Layout rebalance
- Right column restructured: Preview → Screenshots Strip → Genres → **Row(Achievements | Reviews)** → Hints
- Achievements and Reviews are now side-by-side in a `grid-cols-2` row, each taking ~50% width
- Left column (35%) unchanged: Identity → Actions → Stats → Description

#### Part 7: Achievements polish
- Achievements card made more compact: smaller icons (h-3.5/h-3), tighter padding (px-3.5 py-3), thinner progress bar (h-1.5), mini rows show at most 2 achievements (was 3), smaller text (text-[10px]/[11px])
- Perfected row compacted with smaller icons and reduced padding

### Key Files Changed
- `src/features/console/ConsoleSelectedPreview.tsx` — Part 2: added `screenshotOverrideUrl` prop, full video controls bar, `formatTime()` helper, controls auto-hide timer, native video event handlers
- `src/features/console/ConsoleGameDetails.tsx` — Parts 4-7: screenshots strip state/derivation, review fetch via `resolveGameReviewSummaries`, `SteamReviewSummary` type import, review color map, `grid-cols-2` achievements/reviews layout row, compact achievements card

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Console Mode Focus Zones + Media Carousel Redesign

### Goal
Replace the flat two-column ConsoleGameDetails layout with a focus-zone model (left panel / media carousel / info cards / action hints) with keyboard navigation and console-style focus visuals. Rewrite ConsoleMediaGallery as a pure carousel, removing all video player code.

### Part 1: ConsoleMediaGallery — pure carousel
- `src/features/console/ConsoleMediaGallery.tsx` fully rewritten
- Horizontal scroll with `scroll-snap-x`, thumbnail grid, focus ring on selected item
- Trailers get play icon overlay (`Play` circle) with `bg-black/60` badge; screenshots get index badges
- Click handler delegates to parent via `onSelectMediaIndex(index)`
- No video player, no preview, no autoplay logic

### Part 2: ConsoleGameDetails — focus zone restructure
- **Focus zones**: Left panel (Identity + Actions + Stats + Description + Genres) → Media carousel → Info cards (Achievements + Reviews) → Action hints
- **Keyboard navigation**: ArrowUp/ArrowDown/ArrowLeft/ArrowRight move focus between zones, Enter selects media, Escape blurs
- **Console-style focus**: `ring-2 ring-(--color-accent)/60 shadow-lg shadow-(--color-accent)/25` with `transition-all duration-150` on focused element
- **Media carousel**: Trailers sorted by priority (MP4 → WebM → HLS) via `useMemo`, then screenshots. Trailers get play icon, screenshots get index badges
- **Video state** (`selectedMediaIndex`, `isPlayingMuted`, `showFullPlayer`, `isVideoPlaying`) lifted to ConsoleGameDetails and passed down to both Gallery and Preview
- **Left panel**: `overflow-y-auto` with `fade-edges` mask (top/bottom gradient `from-transparent via-background via-80% to-transparent`)
- **Action hints** row in `ConsoleCategoryBar` stub area, dynamically reflects current focus zone actions

### Part 3: ConsoleSelectedPreview — effect-based autoplay
- `useEffect` watches `(mediaType, selectedIndex, appId)` — autoplay fires only when these change, not on every render
- `<video key={\`${appId}-${mediaType}-${selectedIndex}\`}>` remounts on media type / index change, ensuring fresh video element
- Fullscreen button wired to `requestFullscreen()` on preview container ref
- A/V indicator badge shows resolution + framerate for trailers

### Key Files Changed
- `src/features/console/ConsoleMediaGallery.tsx` — full rewrite as pure carousel (removed all video player code)
- `src/features/console/ConsoleGameDetails.tsx` — focus zones, keyboard nav, media carousel, video state lifted, left panel fade edges, action hints
- `src/features/console/ConsolePreview.tsx` — `key` remount + effect-based autoplay

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Cross-game logo contamination fix + GameEditDialog/ImageSearchDialog polish

### Problem
**Cross-game logo contamination**: When user switches games rapidly (e.g. Cuphead → Cricket), a stale `setFallbackBundle` callback from the previous game's async `handleRefreshArtwork` could fire while the new game is active. The materialize effect at `LibraryGameDetailPage.tsx:467` called `materializeResolvedGameMedia(appId, fallbackBundle, "steam")` where `appId` = current game (Cricket) and `fallbackBundle` = previous game's bundle (Cuphead). This enqueued Cuphead's logo URL for download into Cricket's media directory — the file was saved to `games/steam/4717430/media/logo.png` instead of `games/steam/268910/media/logo.png`.

**Root cause**: `fallbackBundle.appId` was set by `resolveMediaByPriority` at bundle creation time, but no code verified bundle ownership before materialization.

### Fix

#### Part 1: Web Image Search browser fix
- `GameImageSearchDialog.tsx` — replaced `window.open(url, "_blank")` (blocked in Tauri WebView) with `openExternalUrl` from `src/services/externalLinks.ts`
- Added `[WEB_IMAGE_SEARCH][OPEN_EXTERNAL]` diagnostic log
- Added instruction text below browser buttons: "Open image search in your browser…"

#### Part 2: Set URL download fix
- `GameEditDialog.tsx` `handleUrlDownload` — fixed Tauri invoke to include `target: ""` (required String) and `forceRefresh: true` (required bool) params
- Added `[GAME_EDIT_URL]` diagnostic logs behind `DEBUG_MEDIA_EDIT` flag

#### Part 3: Open Media Folder button
- `GameEditDialog.tsx` — added `handleOpenMediaFolder` callback using `openGameMediaFolder(appId)` (Rust command → `get_media_dir` → `open::that`)
- Footer restructured to `justify-between` with left-aligned `FolderOpen` icon button
- Try/catch shows "Could not open media folder" toast on failure

#### Part 4: Context menu access to GameEditDialog
- `GameLauncherTile.tsx` — added "Edit Game Details" (initialTab="general") and "Manage Artwork" (initialTab="media") inside the existing Manage submenu, wired to existing `GameEditDialog`

#### Part 5: Stale-bundle appId guards (3 layers)
- **Layer 1 — Materialize effect** (`LibraryGameDetailPage.tsx:470`): checks `fallbackBundle.appId !== appId` before materializing. Logs `[MEDIA][MATERIALIZE_GUARD]` with appId/bundleAppId.
- **Layer 2 — Media queue subscription** (`LibraryGameDetailPage.tsx:494`): checks `bundle.appId !== appId` from `_fallbackBundleRef.current` before re-materializing on download success.
- **Layer 3 — Defensive guard in materializeResolvedGameMedia** (`gameCacheService.ts:3075`): checks `bundle.appId !== appId` and returns early with `[MEDIA_MATERIALIZE][GUARD]` log.

### Scenario coverage
- **A — Normal single game flow**: Bundle.appId === current appId, all 3 layers pass, materialization proceeds normally.
- **B — Rapid game switch during Refresh**: Old `setFallbackBundle(cupheadBundle)` fires while Cricket is active. Layer 1 detects mismatch, skips materialization. No Cuphead URLs enqueued for Cricket.
- **C — Media queue callback race**: Cuphead's download completes while on Cricket. Layer 2 checks ref bundle's appId vs current appId, skips re-materialization.
- **D — Third-party caller**: Any other caller of `materializeResolvedGameMedia` with mismatched appId/bundle is caught by Layer 3 defensive guard.

### Key Files Changed
- `src/components/games/GameImageSearchDialog.tsx` — `openExternalUrl`, instruction text, diagnostics
- `src/components/games/GameEditDialog.tsx` — Set URL invoke fix, diagnostics, Open Media Folder button
- `src/components/games/GameLauncherTile.tsx` — Edit Game Details / Manage Artwork context menu items
- `src/pages/LibraryGameDetailPage.tsx` — Layers 1+2 stale-bundle guards
- `src/services/gameCacheService.ts` — Layer 3 defensive guard in `materializeResolvedGameMedia`

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Console Home/Dock UX: Continue section, dock focus, rich empty states, label animation

### Goal
Enhance Console Mode home screen with real session-priority Continue section, dock focus navigation, rich per-section empty states, and animated dock label reveal.

### Part 1: Continue section with active session priority
- `ConsoleModePage.tsx` — `continuePlaying` now reads `GameSessionContext.sessions` + `getPlaytimeEntryByAppId` for active-session priority and accurate playtime.
- Active sessions sorted first, then remaining by `lastPlayedAt` from playtime store, capped at 15.
- `session` hook + `continuePlaying` moved before `rails` useMemo to fix temporal dead zone (TDZ).

### Part 2: Dock focus navigation
- `dockFocusedIndex` state (-1 unfocused, 0-4 when dock item focused).
- `dockFocusedIndexRef` for stable ref inside keyboard handler (avoids re-registration).
- ArrowDown from last rail (index 4) focuses dock. Left/Right wraps dock items. Up/Enter focuses last rail. Escape unfocuses.
- `focusRail` added to keyboard handler dependency array.

### Part 3: Rich empty states
- `ConsoleSwitchSpotlightLayout.tsx` — `RichEmptyState` component with per-section icon (Play/HardDrive/Code/Heart/LayoutGrid), gradient color circle, muted description message.
- Each of the 6 sections (Continue/Installed/Lua/Favorites/All) uses RichEmptyState instead of simple text.

### Part 4: Dock label animation
- `App.css` — `@keyframes dock-label-in` (opacity 0→1, max-width 0→100px, margin-left -4px→6px).
- `ConsoleSpotlightDock.tsx` — focused dock item expands width to show full section label via CSS animation.
- Focus ring (`ring-2 ring-white/50`) on focused dock item.

### Part 5: Bottom hints polish
- `ConsoleSwitchSpotlightLayout.tsx` — bottom hints change to "Arrows · Enter select · Esc unfocus" when dock focused, else "Keyboard · Arrows · Enter".
- `ConsoleGridLayout.tsx` — `dockFocusedIndex?: number` added to Props type.

### Key Files Changed
- `src/features/console/ConsoleModePage.tsx` — session + continuePlaying reordering, dockFocusedIndex state/ref, dock keyboard nav, sharedProps spread.
- `src/features/console/ConsoleSwitchSpotlightLayout.tsx` — RichEmptyState component, dockFocusedIndex prop, bottom hints context text.
- `src/features/console/ConsoleSpotlightDock.tsx` — focusedIndex prop, focus ring, label animation, wider focus width.
- `src/features/console/ConsoleGridLayout.tsx` — dockFocusedIndex added to Props.
- `src/App.css` — @keyframes dock-label-in animation.

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)

## Session — Console Quick Menu Tools + Power Actions

### Problem
The Quick Menu (Console Mode) Tools sub-panel was a placeholder with "coming soon" entries. Power actions (Shutdown/Suspend/Hibernate/Restart) were also "coming soon" with no real implementation.

### Part 1: Rust power commands
- `src-tauri/src/commands/power.rs` — **new** — `power_shutdown`, `power_suspend`, `power_hibernate`, `power_restart` commands using `std::process::Command` calling Windows `shutdown.exe`
- `src-tauri/src/lib.rs` — registered all 4 power commands
- `src/services/tauri.ts` — added TS bindings

### Part 2: Rust utility commands
- `src-tauri/src/commands/tools.rs` — **new** — `open_app_data` (opens `<appData>/games/steam/` in Explorer), `open_logs` (opens log directory), `clear_temp_cache` (removes `<appData>/cache/temp/`), `get_system_info` (returns CPU/OS/memory/uptime/totalGames info)
- All commands registered in `lib.rs`
- `src/services/tauri.ts` — added TS bindings

### Part 3: ConsoleToolsSubPanel — real entries
- `ConsoleToolsSubPanel.tsx` — 5 real entries instead of placeholders:
  - **Open App Data Folder** — calls `openAppData()` (Rust → `open::that`)
  - **Open Logs Folder** — calls `openLogs()` (Rust → log dir)
  - **Clear Temp Cache** — calls `clearTempCache()` + toast result
  - **System Information** — calls `getSystemInfo()` + displays modal with CPU/OS/RAM/Uptime/Total Games
  - **Run Diagnostics** — calls existing `window.__runDiagnostics?.()` placeholder

### Part 4: MAIN_OPTIONS — power actions wired
- `MAIN_OPTIONS` entries changed from `action: "coming-soon"` to `action: "power"` for Shutdown, Suspend, Hibernate, Restart
- Three dispatch points wired with `case "power":`:
  1. `handleMainKeyDown` — React keyboard handler
  2. Window keydown handler (`Enter` on focused option)
  3. Main option click handler
- All dispatch points call `executePowerAction(key, handleClose)` which shows confirm dialog, then calls the corresponding Rust command

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Console Quick Menu: Language page, ConfirmModal, keyboard nav for tools/help

### Objective
- Add App Language placeholder sub-page to Console Settings, replace `window.confirm` with existing `ConfirmModal` component for power actions, add keyboard/gamepad navigation (ArrowUp/Down/Enter) for Tools and Help sub-pages, expand Startup settings with new boolean fields, and remove conflicting local keyboard handlers.

### Changes
- `ConsoleSettings` type in `consoleSettings.ts` extended: `launchMode` now includes `"last-used"`; `windowMode` includes `"minimized"` and `"tray"`; added `startMaximized`, `startInTray`, `closeToTray`, `showDashboard`, `disableUpdate` (all boolean).
- `STARTUP_DEFAULTS` updated with new fields; `LAUNCH_MODE_OPTIONS` now 3 items; `WINDOW_MODE_OPTIONS` now 5 items.
- `SETTING_ROWS_STARTUP` expanded with toggle rows for all 5 new boolean fields.
- `SETTING_ROWS_LANGUAGE` added with `appLanguage` segmented (Follow System only) and `languageComingSoon` button row.
- `SUBPAGE_ROWS`, `SUBPAGE_TITLES`, `subPageLabel()`, `SETTINGS_KEYS`, and `SettingsCategoryGrid` all register `"language"` page.
- `ConfirmModal` imported from `../../components/common/ConfirmModal` and wired for all 4 power actions (shutdown/suspend/hibernate/restart):
  - `POWER_CONFIRM_CONFIGS` map replaces old `confirmLabels` record.
  - `executePowerAction` replaced by `executePowerCommand(key)` (no confirm, no `handleClose`).
  - `powerConfirm` state drives ConfirmModal rendering at bottom of panel.
- Window `keydown` handler restructured for sub-pages: `subPage === "tools"` handles ArrowUp/Down/Enter/Escape; `subPage === "help"` handles ArrowUp/Down/Escape; all other sub-pages handle Escape only.
- Local `handleKeyDown` removed from `ConsoleToolsSubPanel` and `ConsoleHelpSubPanel` to prevent double-firing with window handler.
- Unused `onFocusChange` props renamed to `_onFocusChange` to suppress TS6133.

### Key Files Changed
- `src/features/console/consoleSettings.ts` — type extended, defaults/options updated
- `src/features/console/ConsoleSettingsPanelV2.tsx` — SETTING_ROWS_LANGUAGE, ConfirmModal integration, window handler restructured, local key handlers removed, SETTINGS_KEYS/SETTINGS_CATEGORIES/SUBPAGE_ROWS all updated

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Manual Game Metadata End-to-End Fix + Artwork Pipeline

### Goal
Fix the manual metadata end-to-end flow: IGDB/Steam search → result mapping → Apply Metadata fills visible fields → Save persists → Reopen retains all data. Add comprehensive debug tracing. Add Steam Store fallback for manual games. Fix artwork pipeline for manual games.

### Part 1: Debug tracing
- Added `DEBUG_MANUAL_METADATA = false` flag in `GameEditDialog.tsx`
- Added `DEBUG_MANUAL_META = false` flag in `storeArtworkResolver.ts`
- Added 13+ `[MANUAL][META]` trace points in `handleDownloadMetadata` (source, searchName, isManual, isCreate, IGDB call/result, Steam call/results/best match/metadata)
- Added `[IGDB_NAME]` trace points in `fetchIgdbMetadataByName` (early return, dedup, Rust call, raw results, mapped result, error)
- All behind `DEBUG_MANUAL_METADATA` / `DEBUG_MANUAL_META` flags — off by default

### Part 2-4: IGDB verification
- Verified Rust `igdb.rs` query fields (`name, summary, first_release_date, genres.name, involved_companies.company.name, involved_companies.publisher, involved_companies.developer, cover.url, screenshots.url`) → `IgdbGameRaw` → `IgdbGameSearchResult` (snake_case) → TS `IgdbMetadataByNameResult` (camelCase). All correct.
- Verified Apply Metadata fills all EditableField state variables for both IGDB and Steam paths.

### Part 5: Manual save persistence (critical fix)
- **Root cause**: `ManualGameEntry` type was missing 14+ fields that the UI exposes (categories, features, tags, sortingName, scores, review data, series, ageRating, region, completionStatus). These were silently wiped on every save.
- **Fix**: Added all missing fields to `ManualGameEntry` type in `manualGameStore.ts`. Updated `loadDraftsFromManualEntry`, `handleSave` patch, `newEntry` construction, and `hasEdits` tracking.

### Part 6: Steam Store search fallback for manual games
- Changed `capabilities.canUseSteamMetadata` from `false` to `true` for manual/create mode
- Rewrote manual mode `handleDownloadMetadata` to support both IGDB and Steam sources
- Steam path: `resolveSteamStoreSearch({ term })` → best match → `resolveGameMetadata([app_id])` → fill all draft fields
- Added `Search` icon import + `resolveSteamStoreSearch` import for manual mode dropdown
- Manual dropdown shows "Steam (by name)" with `Search` icon, "IGDB" with `Image` icon

### Part 7: Artwork pipeline for manual games
- **GameImageSearchDialog**: Added `libraryId` optional prop. When `libraryId` is present and `appId` is absent (manual mode), `applyUrl` uses `downloadProviderMediaFromUrl("manual", libraryId, role, url)` + `updateManualGame(libraryId, patch)` instead of `safe_download_image` + `updateGameAppinfoMedia`.
- **GameEditDialog rendering guard**: Changed `appId &&` to `(appId || manualGameId) &&` to allow manual games. Passes both `appId` and `libraryId` props.
- **Refresh after image search**: When the dialog closes for manual games, re-reads the manual entry from localStorage to pick up the new media paths.
- **openGameMediaFolder**: Fixed for manual games — now uses `openProviderMediaFolder("manual", manualGameId)` instead of `openGameMediaFolder(manualGameId)` which wrote to `games/steam/` path. Also fixed the Actions tab "Open Media Folder" button.
- **Rust `open_provider_media_folder`**: New command in `provider_media.rs` — creates dir via `get_provider_media_dir`, opens via `open::that`. Registered in `lib.rs`.
- **TS binding**: `openProviderMediaFolder(providerId, providerGameId)` in `tauri.ts`.
- **handleSave media paths**: Both the update patch and create-mode `newEntry` now include `coverPath`, `landscapePath`, `backgroundPath`, `logoPath`, `iconPath` from `manualEntry`.

### Files Changed
- `src/components/games/GameImageSearchDialog.tsx` — `libraryId` prop, manual adapter path in `applyUrl`, imports for `downloadProviderMediaFromUrl` + `updateManualGame`
- `src/components/games/GameEditDialog.tsx` — rendering guard, `handleOpenMediaFolder`, `openProviderMediaFolder` import, `handleSave` media paths, `newEntry` media paths, image search close re-read
- `src/services/storeArtworkResolver.ts` — `DEBUG_MANUAL_META` flag + trace logging
- `src/services/manualGameStore.ts` — `ManualGameEntry` type expanded with 14+ fields
- `src/services/tauri.ts` — `openProviderMediaFolder` TS binding
- `src-tauri/src/commands/provider_media.rs` — `open_provider_media_folder` Rust command
- `src-tauri/src/lib.rs` — command registration

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Manual Game Removal Root Cause Fix + Debug Tracing

### Problem
Manual game removal (delete from Library) did not actually remove the game from any UI surface. The game persisted in Sidebar, Library grid, Console, and Dashboard despite `removeManualGame()` succeeding in the store.

### Root Cause
`mergeGames()` in `LibraryGamesContext.tsx:341` — the `reconciled-update`/`cached`/`snapshot-fallback`/`reconciled-fallback` merge path (lines 349-371) iterates ALL games from `current` (`gamesRef.current`, which is stale until React renders) and adds them to `byAppId`. The second loop only **adds/replaces** from `incoming` — it never **removes** entries absent from `incoming`. When a manual game is removed:

1. `removeManualGame()` splices from store, calls `notifyListeners()` synchronously
2. Manual subscription fires → strips manual games → calls `applyGamesSafely(nonManual, "manual-update")`
3. `mergeGames(current, withManual, "manual-update")` falls through to `dedupeLibraryGames(incoming)` (correct path — manual-update source skips the merge branch)
4. **But**: if a `reconciled-update` fires before React renders (before `gamesRef.current` updates), `mergeGames(current, reconciled+freshManual, "reconciled-update")` enters the first branch
5. First loop: ALL `current` games (including stale removed manual game) added to `byAppId`
6. Second loop: `incoming` doesn't have the removed game → it's never removed from `byAppId`
7. Result: removed manual game survives the merge

### Fix
**`LibraryGamesContext.tsx` `mergeGames()`** — In the first loop (lines 349-355), manual games (no `appId`) are no longer copied from `current` into `byAppId`. Manual games are always sourced exclusively from `incoming` → `getManualLibraryGames()` (line 222 in `applyGamesSafely`), which reads the latest manualGameStore. This prevents a removed manual game from surviving the merge via a stale `gamesRef.current`.

### Diagnostic Logs Added
- `[MANUAL_REMOVE][STORE]` — Always logged when `removeManualGame()` is called (found/not-found + remaining count)
- `[MANUAL_REMOVE][SIDEBAR]` / `[CONSOLE]` / `[DETAILS]` / `[TILE]` — Click-site traces behind `DEBUG_MANUAL_REMOVE = false` in each file
- `[MANUAL_REMOVE][LIBRARY_SUB]` — Subscription callback trace: prevManual count, freshManual count, removed IDs
- `[MANUAL_REMOVE][APPLY]` — `applyGamesSafely` merge result: prev total/manual, merged total/manual, fingerprint changed

### Downstream Propagation Verified
- **Sidebar**: reads `games` from `useLibraryGames()` → re-renders without removed game
- **Console**: reads `games` from `useLibraryGames()` → re-renders without removed game
- **Library grid**: reads `games` from `useLibraryGames()` → re-renders without removed game
- **Selected game**: `useEffect` at line 191 auto-clears `selectedId` when game disappears from `games`
- **LibraryGameDetails**: `onBack()` called after removal, navigating away from detail page
- **Favorites**: Stale `"manual:<uuid>"` in localStorage is harmless (UI filters by game existence)
- **gameStore/reconciled-update**: `getReconciledGames()` never contains manual games (gameStore has no manual concept)
- **Fingerprint skip**: Bypassed for `"manual-update"` source; for `reconciled-update`, fingerprints differ (current has removed game, incoming doesn't) → skip not triggered → merge proceeds correctly

### Key Files Changed
- `src/context/LibraryGamesContext.tsx` — `mergeGames()` skip manual games from `current`, `DEBUG_MANUAL_REMOVE` flag, subscription trace log, applyGamesSafely merge trace
- `src/services/manualGameStore.ts` — `removeManualGame()` trace log (always-on)
- `src/components/layout/SidebarLibraryList.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace
- `src/components/library/LibraryGameDetails.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace
- `src/features/console/ConsoleGameOptionsOverlay.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace
- `src/components/games/GameLauncherTile.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)

## Session — Manual Game Registry: localStorage → AppData JSON Migration

### Goal
Move manual game registry persistence from browser localStorage to an AppData JSON file (`games/manual/manual-games.json`) via Rust/Tauri commands. Keep the module-level cache pattern and public API unchanged.

### Problem
localStorage is unreliable for app data (WebView storage clear, different browsers, no filesystem access). Manual game data should live on disk like all other game data.

### Implementation

#### Part 1-2: Rust commands (`src-tauri/src/commands/manual_games.rs`)
- `read_manual_games(app_handle) → Vec<ManualGameEntry>` — reads `games/manual/manual-games.json`, returns `[]` if missing. Corrupt files backed up as `manual-games.corrupt.<timestamp>.json`.
- `write_manual_games(app_handle, entries)` — atomic write via temp→rename.
- `backup_manual_games(app_handle) → String` — creates timestamped backup.
- `ManualGameEntry` struct with `#[serde(rename_all = "camelCase")]` matching existing TS type.
- `ManualGamesFile` wrapper with `version: u32` + `entries: Vec<ManualGameEntry>`.

#### Part 3: TS bindings (`src/services/tauri.ts`)
- `readManualGames()`, `writeManualGames(entries)`, `backupManualGames()`.
- `ManualGameEntryJson` type matching the Rust camelCase output.

#### Part 4: manualGameStore.ts rewrite
- **Module-level cache** unchanged (`_cache`, `_listeners`).
- **Sync `ensureCache()`** loads from localStorage as immediate fallback (before boot).
- **`loadManualGamesFromJson()`** async — reads from JSON disk, migrates localStorage if JSON empty, normalizes entries, seeds `_cache`. Called once during boot Stage 3.25.
- **Write operations** (`saveManualGame`, `updateManualGame`, `removeManualGame`) update sync cache + write localStorage + async `persistToDisk()` (fire-and-forget).
- **`persistToDisk()`** creates backup on first write, then calls `writeManualGames()`.
- **`normalizeEntry()`** — strips `"manual:"` prefix, fills defaults, coerces types.
- **`MIGRATION_MARKER_KEY`** — `lumaforge-manual-games-json-migrated-v1` localStorage marker.

#### Part 5-6: Migration
- On first `loadManualGamesFromJson()`: if JSON has entries → use JSON.
- If JSON empty + localStorage has entries → normalize, write to JSON, set marker.
- Both empty → empty array.
- localStorage preserved as backup (not deleted).

#### Part 7-8: Public API preserved
- All 9 public functions unchanged: `loadManualGames`, `getAllManualGames`, `getManualGame`, `saveManualGame`, `updateManualGame`, `removeManualGame`, `subscribeManualGames`, `resetManualGameCache`, `getManualGameCount`.
- `normalizeManualGameId` and `getManualProviderGameId` unchanged.
- All manual flows (create, edit, remove, sidebar, console, details) work without code changes.

#### Boot integration
- Stage 3.25 (`load-manual-games`) added to `BootTaskId` type.
- Runs between Stage 3 (snapshot load) and Stage 3.5 (title enrichment).
- `[BOOT][MANUAL_GAMES]` log with entry count.

### Key Files Changed
- `src-tauri/src/commands/manual_games.rs` — **new** — read/write/backup commands
- `src-tauri/src/commands/mod.rs` — `pub mod manual_games` added
- `src-tauri/src/lib.rs` — 3 commands registered
- `src/services/tauri.ts` — TS bindings + `ManualGameEntryJson` type
- `src/services/manualGameStore.ts` — full rewrite: JSON backend + localStorage fallback + migration
- `src/services/appBootCoordinator.ts` — `load-manual-games` task in BootTaskId + Stage 3.25

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Epic Games Store Phase 1B: Library Provider Integration

### Goal
Integrate Epic Games local scanner results into the Library grid via a memory-first provider store, pure mapper, and isolated merge boundary in LibraryGamesContext. No launch, auth, owned/uninstalled, achievements, GOG, Console Mode, or cross-provider dedup.

### Parts Implemented

#### Part 1: LibraryGame type — provider-neutral `isInstalled` field
- Added `isInstalled?: boolean` to `LibraryGame` type in `src/types/libraryGame.ts`
- Provider-neutral: true when game exists on disk from any provider
- Distinct from `steamInstalled` (Steam-specific), `isPlayable` (launch-ready), `isInstallable` (can be installed via LumaForge)

#### Part 2: Feature flag (`src/services/epicFeatureFlag.ts`) — **new**
- `EPIC_LIBRARY_ENABLED = false` — master gate, defaults OFF for production
- `DEBUG_EPIC_LIBRARY = false` — verbose console diagnostics gate

#### Part 3: Pure mapper (`src/services/epicGameLibraryMapper.ts`) — **new**
- `epicGameToLibraryGame(game: EpicInstalledGame) → LibraryGame` — pure, no side effects
- `buildProviderGameId(game)` — canonical identity: `{namespace}:{catalogItemId}` → `{namespace}:{appName}` → `{appName}`
- `isEpicEntryEligible(game)` — strict filter: baseGame + manifestValid + installed + !incomplete + non-empty providerGameId + non-empty displayName
- `computeEpicFingerprint(games)` — deterministic fingerprint for change detection
- `isPlayable = false` (no launch adapter), `isInstalled = true` (on disk), `steamInstalled = false`, `isInstallable = false`

#### Part 4: Memory-first provider store (`src/services/epicGameStore.ts`) — **new**
- Module-level state: `_epicGames: LibraryGame[]`, `_epicFingerprint: string`, `_scanWarning: string | null`, `_scanState`
- `refreshEpicGames()` — runs Rust scanner, filters eligible, maps to LibraryGame, replaces state, notifies on fingerprint change
- `getAllEpicGames()`, `getEpicGame()`, `getEpicFingerprint()`, `getEpicScanState()`, `getEpicScanWarning()`
- `subscribeEpicGames(listener)` — returns cleanup function, no duplicate listeners
- `resetEpicGameCache()` — clears state + notifies
- Scanner failure: retains previous valid entries, sets warning, notifies once
- Successful empty scan: replaces with empty (stale entries removed)

#### Part 5: Steam-only action gating
- `GameLauncherTile.tsx` — "Uninstall in Steam" hidden when `game.source === "epic"`
- `SidebarLibraryList.tsx` — "Uninstall in Steam" hidden when `menuGame.source === "epic"`
- "Open in Steam" already safe (driven by `getLauncherGamePrimaryAction()` which returns "details" for Epic)

#### Part 6: Fingerprint safety for appId-less entries
- `LibraryGamesContext.tsx` — `computeLibraryFingerprint` and `computeGamesFingerprint` use `g.appId || g.libraryId || g.id` instead of raw `g.appId`
- Prevents `undefined:` prefix in fingerprint strings for Epic/GOG entries

#### Part 7: LibraryGamesContext Epic merge boundary
- `getEpicLibraryGames()` helper — sync read from in-memory Epic store
- `applyGamesSafely` appends Epic games alongside manual games: `[...nextGames, ...getManualLibraryGames(), ...getEpicLibraryGames()]`
- Epic subscription effect (follows manual subscription pattern):
  1. Calls `refreshEpicGames()` on mount (fire-and-forget)
  2. Subscribes to Epic store changes
  3. On change: strips Epic from current, calls `applyGamesSafely(nonEpic, "epic-update")`
  4. Epic games survive manual-update (not stripped, present in `getEpicLibraryGames()`)
  5. Manual games survive epic-update (not stripped, present in `getManualLibraryGames()`)
- Feature-flag gated: subscription effect returns immediately when `EPIC_LIBRARY_ENABLED = false`

#### Part 8: mergeGames compatibility (no changes needed)
- `mergeGames()` first branch (cached/reconciled/snapshot): Epic entries have `appId=undefined` → NOT copied into `byAppId` from current → incoming Epic entries added fresh via `noappid-${game.id}` path
- `mergeGames()` second branch (dedupe): `dedupeLibraryGames` dedupes by appId, doesn't affect appId-less Epic entries
- Replacement, not stale merge: on successful scan, all previous Epic entries replaced

### What was NOT changed (Phase 1B boundary)
- No launch adapter — `isPlayable = false` for all Epic entries
- No auth, no owned/uninstalled games, no Epic store integration
- No achievements, cloud, install/uninstall, cross-provider dedup
- No Console Mode Epic exposure
- No metadata API, no artwork resolution
- No changes to: libraryGameResolver, startupSnapshotService, gameStore, manualGameStore, manualGameLibraryMapper, GameSessionContext, FavoritesContext, Home, Sidebar layout, GameDetails, GameEditDialog, Store, Console Mode, Steam launch, manual launch, Hubcap

### Scenario Coverage
- **A — Feature disabled**: `EPIC_LIBRARY_ENABLED = false` → subscription returns early, `getEpicLibraryGames()` returns `[]`, no behavior change
- **B — Normal scan**: `refreshEpicGames()` → eligible entries mapped → fingerprint change → `applyGamesSafely(nonEpic, "epic-update")` → Epic games appear in Library
- **C — Empty scan**: replace with empty → stale Epic entries removed
- **D — Scanner failure**: retain previous entries, set warning, notify once
- **E — Rapid Epic refresh**: fingerprint change detection prevents duplicate notifications
- **F — Manual refresh**: `refresh()` calls `applyGamesSafely(enriched, "manual-refresh")` → Epic games appended from store via `getEpicLibraryGames()`
- **G — Steam actions**: "Uninstall in Steam" hidden for Epic; "Open in Steam" already safe via `getLauncherGamePrimaryAction()`

### Key Files Changed
- `src/types/libraryGame.ts` — added `isInstalled?: boolean` field
- `src/services/epicFeatureFlag.ts` — **new** — feature flag + debug flag
- `src/services/epicGameLibraryMapper.ts` — **new** — pure mapper + eligibility filter + fingerprint
- `src/services/epicGameStore.ts` — **new** — memory-first provider store with subscription
- `src/context/LibraryGamesContext.tsx` — Epic imports, `getEpicLibraryGames()`, `applyGamesSafely` Epic append, Epic subscription effect, fingerprint fixes
- `src/components/games/GameLauncherTile.tsx` — "Uninstall in Steam" gated for Epic
- `src/components/layout/SidebarLibraryList.tsx` — "Uninstall in Steam" gated for Epic

### Build
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)

## Session — Epic Games Phase 2A: Provider-Native Launch + Play Activation

### Goal
Enable playing Epic Games from LumaForge's Library via the Epic Games Launcher protocol, with full session tracking, process detection, and playtime recording — identical to the Steam launch experience.

### Architecture
- **Dual-mode launch**: Protocol URI first (`com.epicgames.launcher:/apps/<appName>?action=launch`), direct executable fallback
- **Provider launch adapter**: `dispatchProviderLaunch()` in `src/utils/providerLaunchAdapter.ts` — provider-neutral dispatch boundary called from GameSessionContext
- **Feature-flag gated**: `EPIC_LAUNCH_ENABLED` (off by default), requires `EPIC_LIBRARY_ENABLED` also enabled
- **Launch metadata retention**: `epicGameStore.ts` retains per-game `EpicLaunchMetadata` (appName, executablePath, launchArguments, processNames) from scanner results
- **Session tracking**: Same process-detection retry pattern as Steam (2s → 3s → 5s scan, soft-session fallback)

### Parts Implemented

#### Part 1: Rust `launch_epic_game` command
- `src-tauri/src/commands/epic.rs` — new `launch_epic_game` Tauri command
- `EpicLaunchResult` struct: `{ success, method: "protocol"|"direct-executable", error? }`
- Protocol attempt: `open::that_detached("com.epicgames.launcher:/apps/{appName}?action=launch")`
- Direct executable fallback: `Command::new(exe).args(args).spawn()` with detached child
- Registered in `src-tauri/src/lib.rs`

#### Part 2: TS binding
- `src/services/tauri.ts` — `launchEpicGame(appName, executablePath?, launchArguments?)` binding + `EpicLaunchResult` type

#### Part 3: Feature flags
- `src/services/epicFeatureFlag.ts` — added `EPIC_LAUNCH_ENABLED = false` and `DEBUG_EPIC_LAUNCH = false`

#### Part 4: Launch metadata retention
- `src/services/epicGameStore.ts` — `_launchMetadataByProviderGameId` Map retains `{ appName, executablePath, launchArguments, processNames, installLocation, manifestPath }` per eligible game
- `getEpicLaunchMetadata(providerGameId)` public getter
- Metadata populated during `refreshEpicGames()` scan, cleared on `resetEpicGameCache()`

#### Part 5: Provider launch adapter
- `src/utils/providerLaunchAdapter.ts` — **new** — `dispatchProviderLaunch(game)` returns `{ dispatched, method, error }`
- Dynamic imports of `getEpicLaunchMetadata` and `launchEpicGame` to avoid circular deps
- Returns `{ dispatched: false }` for non-Epic or disabled cases

#### Part 6: GameSessionContext Epic dispatch
- `src/context/GameSessionContext.tsx`:
  - Import `dispatchProviderLaunch`
  - Source mapping: `"epic"` added to session creation
  - Dispatch delay: Epic uses 1500ms (same as Steam)
  - New `else if (game.source === "epic")` branch: calls `dispatchProviderLaunch`, then scans for process with 2s/3s/5s retry
  - On dispatch failure: session cleaned up immediately
  - Provider labels: `"Epic"` in overlay events (launch/end)
  - Playtime provider: `"epic"` for start/end sessions
  - Activity source: `"epic"` for session history records
  - Hydrate: Epic soft sessions already handled (`s.source === "epic"` at line 265)

#### Part 7: `isPlayable` derivation
- `src/services/epicGameLibraryMapper.ts` — `isPlayable = EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED && (appName || executablePath)`
- When flags are OFF: `isPlayable = false` (Phase 1B behavior preserved)

#### Part 8: Primary action
- `src/utils/launcherGameActions.ts` — Epic launchable games return `"play"` as primary action (before Steam appId check)

#### Part 9: Steam-only action gating
- `src/components/games/GameLauncherTile.tsx` — "Open in Steam" hidden for `game.source === "epic"`

#### Part 10: Activity source type
- `src/types/gameActivity.ts` — added `"epic"` to `GameActivityItem.source` union

### What was NOT changed (Phase 2A boundary)
- No achievements for Epic games
- No cloud saves, DLC detection, or ownership tracking
- No Console Mode Epic exposure
- No metadata API, no artwork resolution for Epic
- No install/uninstall via LumaForge
- No cross-provider dedup between Steam and Epic
- No changes to: startupSnapshotService, gameStore, FavoritesContext, Home, Settings, Store

### Scenario Coverage
- **A — Feature disabled**: Both flags OFF → `isPlayable = false`, Play button never shown, no launch dispatch
- **B — Protocol launch**: `dispatchProviderLaunch` → `launchEpicGame(appName)` → `open::that_detached` → process detected → running session
- **C — Direct executable fallback**: Protocol fails → `Command::new(exe).spawn()` → process spawned → running session
- **D — Both methods fail**: Error returned → session cleaned up → user sees no running state
- **E — Process detection timeout**: No process found after 10s → soft session (same as Steam)
- **F — Steam-only actions hidden**: "Open in Steam" hidden for Epic games
- **G — Play button**: Appears when `EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED` and game has `appName` or `executablePath`
- **H — Activity history**: Session records use `"epic"` source, overlay shows `"Epic"` provider

### Key Files Changed
- `src-tauri/src/commands/epic.rs` — `launch_epic_game` command, `EpicLaunchResult` type
- `src-tauri/src/lib.rs` — registered `launch_epic_game`
- `src/services/tauri.ts` — `launchEpicGame` binding, `EpicLaunchResult` type
- `src/services/epicFeatureFlag.ts` — `EPIC_LAUNCH_ENABLED`, `DEBUG_EPIC_LAUNCH`
- `src/services/epicGameStore.ts` — `_launchMetadataByProviderGameId`, `getEpicLaunchMetadata()`, metadata retention in scan
- `src/services/epicGameLibraryMapper.ts` — `isPlayable` derivation from feature flags + manifest
- `src/utils/providerLaunchAdapter.ts` — **new** — `dispatchProviderLaunch()` adapter
- `src/utils/launcherGameActions.ts` — Epic primary action "play"
- `src/context/GameSessionContext.tsx` — Epic dispatch branch, provider labels, playtime/activity source
- `src/components/games/GameLauncherTile.tsx` — "Open in Steam" gated for Epic
- `src/types/gameActivity.ts` — `"epic"` added to source union

### Build
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)

## Session — Store Discover 20-Phase Stabilization + P0/P1 Fixes

### Goal
Full stabilization audit of the Store Discover pipeline: 20 phases covering route restoration, single-flight discovery builds, fingerprinting, cache quality, movie caching, metadata dedup, enrichment limits, interaction performance, layout stability, log noise, and boot dedup.

### P0/P1 Priority Fixes (pre-Stabilization)

#### P0-1: Dead media debug flag
- `gameCacheService.ts:3167` — `_DEBUG_MEDIA_APPID_ENABLED = false`
- Removed 3 dead exports

#### P0-2: Movie metadata negative cache
- `gameMetadataResolver.ts` — `_moviesCheckedThisSession` Set
- Prevents re-fetching movies for apps that have none

#### P0-3: Discovery index disk-save dedup
- `Store.tsx` — content fingerprint before `saveDiscoveryIndexToDisk`
- Skips disk write when index unchanged

#### P0-4: Background job watchdog
- `backgroundJobQueue.ts:60_000ms` `Promise.race` watchdog
- Detects stuck jobs, suppresses idle drain log noise

#### P1-1: Per-appId metadata dedup
- `gameMetadataResolver.ts` — `metadataInFlightByAppId` Map replaces batch-keyed dedup
- Per-appId Map dedup prevents duplicate loads across boot enrichment + Store mount

#### P1-2: Dead dashboardSectionCache
- Deleted entirely — `dashboardSectionCache.ts`

#### P1-3: Dead tauri.ts bindings
- Removed 6 dead exports from `tauri.ts`

#### P1-4: Redundant cache guard
- `storeDiscoverCache.ts` — removed dead redundant check

#### P1-5: dirtyAppIds dedup
- Already sufficient — no fix needed

### Store Discover Stabilization (20 Phases)

#### Phase 1: Fix Store route restoration
- `App.tsx:53-69` — removed `restoreActivePage()` Store→Home redirect
- Store now stays on best available cache (no redirect to Home)

#### Phase 2+3: Input fingerprint for discoverSections
- `Store.tsx` — `_sectionBuildFpRef` input fingerprint for `discoverSections` useMemo
- Computes lightweight fingerprint from metadata count, review count, installed count, interaction count, provider overlay count, featured count, enriched sections, discovery index hash, catalog fingerprint
- Skips 300-line section builder when inputs unchanged

#### Phase 7: Cap metadata fetch to 200 IDs max per batch
- `Store.tsx:METADATA_WINDOW_MAX = 200`
- Prevents loading metadata for 500+ games per batch

#### Phase 10: Gate verbose Store logs
- `FINAL_SECTION` gated behind `DEBUG_STORE_DISCOVERY`
- `ALL_SECTIONS_SOURCE` gated behind `DEBUG_STORE_RENDER_VERBOSE`
- `MORE_RENDER`/`MORE_WINDOW` gated behind `DEBUG_STORE_RENDER_VERBOSE`
- `SHOW_MORE` gated behind `DEBUG_STORE_RENDER_VERBOSE`

#### Phases 4-6, 8-9, 11-19: Verified already sound
- Cache quality gate: already checks `metadataReady`
- Interaction perf: already has `isInteractionBusy()` guards
- Layout stability: section IDs already stable
- Boot dedup: P1-1 per-appId Map handles this
- Store state: DiscoverState + CacheEntry set in same effect
- Featured games: stable priority chain
- Genre sections: adaptive threshold fallback already implemented
- More to Explore: already dedupes via seen Set + excludeIds

#### Phase 20: Build verification
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

### Key Files Changed
- `src/App.tsx` — removed `restoreActivePage()` Store→Home redirect, removed unused `getCachedStoreDiscover`/`isCacheComplete` import
- `src/pages/Store.tsx` — `_sectionBuildFpRef` input fingerprint, `METADATA_WINDOW_MAX = 200`, gated `FINAL_SECTION`/`ALL_SECTIONS_SOURCE`/`MORE_RENDER`/`MORE_WINDOW`/`SHOW_MORE` logs
- `src/services/gameMetadataResolver.ts` — `_moviesCheckedThisSession` negative cache, `metadataInFlightByAppId` per-appId dedup
- `src/services/gameCacheService.ts` — `_DEBUG_MEDIA_APPID_ENABLED = false`, removed 3 dead exports
- `src/services/backgroundJobQueue.ts` — `JOB_WATCHDOG_TIMEOUT_MS = 60_000` watchdog timer
- `src/services/storeDiscoverCache.ts` — removed dead redundant check
- `src/services/dashboardSectionCache.ts` — **deleted**
- `src/services/tauri.ts` — removed 6 dead exports

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Local Steam Catalog Index for Discover/View All

### Goal
Replace runtime-enriched genre sections (which depend on remote Steam appdetails API) with a local SQLite catalog index queried from Rust, enabling instant genre rail population without network calls.

### Architecture
- Offline Node.js catalog builder → versioned JSON artifact → Rust SQLite import → fast local queries → Discover genre sections populated from index → fallback to runtime metadata when catalog unavailable
- **No scraping, no remote API server, no automatic remote updates** — offline import only
- **Preserve scope**: no changes to Home, Library, Desktop Library Game Details, Console Mode, Favorites, Continue Playing, launch/Stop flows, Epic integration, manual games, achievements, package flows, Hubcap

### Parts Implemented

#### Phase 1-2: Checkpoint + Audit
- Clean working tree confirmed; commits 413cd13, ede05f8, bacc016 preserved
- Full audit: steamdb.json has 162K entries with only `{appid, name}`; 3 separate normalization systems found; genre sections depend entirely on runtime metadata enrichment; curated catalog has ~6 unique Adventure games
- `DISPLAY_GENRES` in Store.tsx lists 6 genres (Action, Indie, Racing, Shooter, RPG, Adventure)

#### Phase 3-8: Builder tool
- `tools/steam-catalog-builder/taxonomy.ts` — CANONICAL_GENRES (10), GENRE_ALIASES, STEAM_CATEGORY_IDS, `normalizeGenreName()`, `normalizeGenres()`, GENRE_SECTION_IDS, ACTIVE_GENRE_SECTIONS
- `tools/steam-catalog-builder/catalogSchema.ts` — SteamCatalogRecord, SteamCatalogArtifact, SteamCatalogManifest, BuilderCheckpoint types
- `tools/steam-catalog-builder/build.ts` — checkpoint/resume, bounded concurrency, retry, atomic artifact writes, manifest generation
- `tools/steam-catalog-builder/package.json` — builder package config

#### Phase 9: Rust catalog tables + queries
- `src-tauri/src/commands/store_catalog.rs` — full implementation:
  - Schema: `store_catalog_games` (15 columns + 6 indexes), `store_catalog_genres` (composite PK), `store_catalog_categories`, `store_catalog_meta`
  - Import: atomic drop+recreate via transaction, batch insert records/genres/categories/metadata
  - Queries: by genre (JOIN + ORDER BY reviews), by name (LIKE search), by appId, featured (review threshold), new & noteworthy (180-day window)
  - All functions use `tauri::State<'_, SqliteDb>` pattern with graceful None fallback

#### Phase 10: Tauri commands + TS bindings
- 7 commands registered in `src-tauri/src/lib.rs`: `get_catalog_meta`, `import_steam_catalog`, `query_catalog_by_genre`, `query_catalog_search`, `query_catalog_game`, `query_catalog_featured`, `query_catalog_new_noteworthy`
- Catalog tables auto-created in `sqlite_cache.rs` `init_tables()`
- TS types in `tauri.ts`: `CatalogMetaResult`, `CatalogGameResult` with camelCase mapping
- 7 async TS functions for each command

#### Phase 11: TS catalog query service
- `src/services/steamCatalogService.ts`:
  - `getLocalCatalogStatus()` — version check with 5-min cache
  - `queryByGenre()`, `queryFeaturedGames()`, `queryNewNoteworthyGames()`, `querySearch()`, `getCatalogGame()` — each with 5-min TTL in-memory cache
  - `preFetchGenreGroups(genres, limit)` — parallel genre pre-fetch for synchronous reads
  - `getLocalGenreGroups()` / `isLocalCatalogReady()` — synchronous getters for Store useMemo
  - `clearCatalogCaches()` + `_localGenreGroups.clear()` on import

#### Phase 12-13: Store.tsx integration
- Mount effect pre-fetches genre groups via `preFetchGenreGroups(DISPLAY_GENRES, 20)`
- `rawGenreGroups` computation: local catalog data merged first, then runtime metadata supplements (deduped by appId)
- When catalog unavailable: falls back to existing runtime metadata path (zero behavior change)
- `[STORE][GENRE_INDEX_READY] source=local-catalog` / `source=metadata` diagnostic logs

### Key Decisions
- **Merge, don't replace**: local catalog data supplements runtime metadata (catalog fills genres, metadata adds images/reviews)
- **Synchronous read**: `getLocalGenreGroups()` returns cached Map for useMemo consumption (no async in useMemo)
- **Graceful fallback**: when no catalog imported, Store behaves identically to before (runtime enrichment continues)
- **5-min TTL cache**: consistent across all query functions (genre, search, featured, status)

#### Phase 14: Section wiring — Featured, New & Noteworthy, View All
- `DISPLAY_GENRES` hoisted to module-level constant (was duplicated in two closures)
- `catalogGameToStoreGame()` helper converts `CatalogGameResult` → `StoreGame`
- `catalogFeaturedGames` state + `queryFeaturedGames(8)` on boot; used as primary in `discoverSections` useMemo; runtime `queryIndexFeatured` is fallback
- `catalogNewNoteworthyGames` state + `queryNewNoteworthyGames(8)` on boot; used as primary in `discoverSections` useMemo; runtime `parseReleaseDate` is fallback
- View All: `viewAllGames` + `viewAllLoading` + `viewAllPage` + `viewAllHasMore` state; `queryByGenre(genre, 24, offset)` with pagination; `loadMoreViewAll` callback; "Load More" button at bottom
- Mount effect: `ensureCatalogImported()` → `preFetchGenreGroups()` → `Promise.all([queryFeaturedGames(8), queryNewNoteworthyGames(8)])`

### Key Files Created/Changed
- `tools/steam-catalog-builder/taxonomy.ts` — **new** — genre/category taxonomy
- `tools/steam-catalog-builder/catalogSchema.ts` — **new** — record/artifact/manifest types
- `tools/steam-catalog-builder/build.ts` — **new** — offline builder with checkpoint/resume
- `tools/steam-catalog-builder/generate.cjs` — **new** — standalone CJS runner with rate-limit handling
- `tools/steam-catalog-builder/package.json` — **new** — builder package
- `public/data/catalog/steam-catalog-v1.json` — **new** — bundled 1,984-record artifact
- `public/data/catalog/steam-catalog-v1.json.gz` — **new** — compressed artifact
- `public/data/catalog/steam-catalog-v1.manifest.json` — **new** — manifest with checksum
- `src-tauri/src/commands/store_catalog.rs` — **new** — schema, import, queries, 7 Tauri commands, 20 unit tests
- `src-tauri/src/commands/mod.rs` — `pub mod store_catalog` added
- `src-tauri/src/commands/sqlite_cache.rs` — catalog tables in `init_tables()`
- `src-tauri/src/lib.rs` — 7 commands registered
- `src/services/tauri.ts` — CatalogMetaResult, CatalogGameResult types + 7 TS bindings
- `src/services/steamCatalogService.ts` — **new** — query service with TTL cache + pre-fetch + ensureCatalogImported
- `src/__tests__/steamCatalogService.test.ts` — **new** — 16 TS contract tests
- `vitest.config.ts` — **new** — vitest configuration
- `src/pages/Store.tsx` — mount auto-import + featured/noteworthy pre-fetch, DISPLAY_GENRES module constant, catalogGameToStoreGame helper, catalogFeaturedGames/catalogNewNoteworthyGames state, discoverSections with catalog-primary/fallback logic, View All pagination

### Build
- `tsc --noEmit` ✅ (0 new errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Gofile.io resolver: gofile page URL → direct download link via public API

### Problem
`install_debrid_package` descargaba desde URLs de gofile.io (`https://gofile.io/d/ABC123`), pero `reqwest` obtenía el HTML de la página, no el binario. Gofile.io requiere resolver vía su API pública para obtener el link directo.

### Fix
- **`debrid_installer.rs`**: Nueva función `resolve_gofile_url(gofile_url)` que:
  1. Extrae el `contentId` del URL (`/d/ABC123` → `ABC123`)
  2. Hace GET a `https://api.gofile.io/contents/{contentId}` (público, sin auth)
  3. Parsea el JSON y extrae el `link` del primer child en `data.children`
  4. Sin API keys, sin cookies, sin configuración extra
- **`install_debrid_package`**: Antes de Step 1 (download), detecta si el URI es gofile.io, lo resuelve a link directo, y pasa el link resuelto a `download_file_to_dest()`
- `reqwest` ya tenía feature `json` habilitado, `serde_json` ya era dependencia — cero cambios en Cargo.toml

### Repack JSON
- ContentIds verificados contra `steamrip.json`: GTA V=`O9qOj0`, RE2=`5QtuGG`, Palworld=`ukwugv` — todos correctos

### Flujo final
```
install_debrid_package("https://gofile.io/d/O9qOj0", ...)
  → detecta gofile.io
  → GET https://api.gofile.io/contents/O9qOj0
  → extrae link directo: "https://gofile.io/dl/abc123"
  → download_file_to_dest("https://gofile.io/dl/abc123", ...)
  → extract zip / run installer
  → find_largest_exe
```

### Build
- `cargo check` ✅ (0 new errors)
- `tsc --noEmit` ✅ (pre-existing only)
- `vite build` ✅ (pre-existing chunk warnings only)

## Session — Phase 2: Criteria Evaluator + ToolManager Integration

### Goal
Wire `criteria.detection` from extension manifests into the runtime so extensions auto-match to games without hardcoded ID branching.

### Part 1: Types and manifest parser
- `CriteriaDeclaration`, `DetectionCriteria`, `FilesPresenceCriteria` types in `src/extensions/types/index.ts`
- `criteria` field on `ExtensionManifestV1`
- `validateCriteria()` / `validateDetectionCriteria()` in manifest parser (`src/extensions/manifests/index.ts`)

### Part 2: Criteria evaluator engine
- `src/extensions/runtime/criteriaEvaluator.ts` — **new**
- `GameContext` type (installDir, appId, provider — all optional)
- `evaluateManifestCriteria(manifest, game)` → dispatches by `detection.type`
- `evaluateFilesPresence(criteria, game)` → checks all paths via `extensionFileExists` in install dir
- `filterMatchingManifests(manifests, game)` → batch filter
- Unknown criteria types → non-match with diagnostic reason

### Part 3: ToolManager integration
- `getApplicableTools(game)` → filters `_tools` by criteria via `evaluateManifestCriteria`
- `gameContextFromInstallDir(installDir)` → extracts Steam appId from path
- `detectToolsForGame()` → pre-filters by criteria before filesystem detection
- Tools without registered extensions always pass (backward compat)

### Part 4: Tests
- `src/__tests__/criteriaEvaluator.test.ts` — **new** — 10 tests: no-criteria passthrough, files_presence match/miss, missing installDir, fs error, unknown type, batch filter
- `src/__tests__/criteriaToolManagerIntegration.test.ts` — **new** — 6 tests: backward compat, criteria match/miss, unknown type, mixed batch, missing installDir
- Both use `vi.hoisted()` for shared mutable mock state (correct vitest 4.x pattern)

### Key Files Changed
- `src/extensions/types/index.ts` — CriteriaDeclaration, DetectionCriteria, FilesPresenceCriteria, criteria on ExtensionManifestV1
- `src/extensions/manifests/index.ts` — criteria validation in parser
- `src/extensions/runtime/criteriaEvaluator.ts` — **new** — evaluation engine
- `src/extensions/tools/ToolManager.ts` — getApplicableTools(), gameContextFromInstallDir(), updated detectToolsForGame()
- `src/__tests__/criteriaEvaluator.test.ts` — **new** — 10 unit tests
- `src/__tests__/criteriaToolManagerIntegration.test.ts` — **new** — 6 integration tests

### Build
- `tsc --noEmit` ✅ 0 new errors (23 pre-existing)
- `vitest run` ✅ 826 passed, 22 failed (all pre-existing)
- `vite build` ✅ (7.16s, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Webview bypass fix + curated Debrid repack catalog

### Goal
Fix Steam Store webview HTML fetch (Cloudflare challenge), then test the Debrid/Hydra repack download/install pipeline end-to-end with manually-curated JSON entries.

### Part 1: Webview bypass
- Increased initial delay from 15s → 30s with modal notification
- Still errors with Cloudflare/Safeguard — deferred
- Modal text updated to inform user about expected Cloudflare interaction

### Part 2: Repack catalog format investigation
- Discovered `steamrip.json` uses `{ downloads: [...] }` format with string fileSizes and no appIds — incompatible with expected `RepackCatalogArtifact` (`{ records: [...] }`)
- Same issue with `fitgirl.json`
- Raw scraper output cannot be read directly by the importer

### Part 3: Curated repack-catalog-v1.json
- Created new `repack-catalog-v1.json` in correct `RepackCatalogArtifact` format with 6 curated entries:
  - GTA V (271590) — steamrip, gofile.io URI
  - Resident Evil 2 (883710) — steamrip, gofile.io URI
  - Palworld (1623730) — steamrip, gofile.io URI
  - Armored Core VI (1971650) — fitgirl, no download URI
  - Alan Wake 2 (1269530) — dodi, no download URI
  - Armored Core VI v2 (1971650) — fitgirl, magnet URI
- All entries have proper numeric `appId`, numeric `fileSize`, and `downloadUris[]`
- Updated `repack-catalog-v1.manifest.json` with correct SHA256 checksum

### Part 4: Checksum re-import detection
- Modified `ensureRepackCatalogImported()` to compare `status.checksum` against `manifest.checksum`
- When checksums differ, re-imports from bundled JSON (instead of skipping because `hasCatalog` is true)
- Logs `[REPACK][AUTO_IMPORT] checksum changed (old... → new...)` on re-import
- Debrid library subscription effect picks up new entries on boot

### Part 5: Status
- Feature flags are `true`: `DEBRID_LIBRARY_ENABLED = true`, `DEBRID_INSTALL_ENABLED = true`
- `debrid` integration defaults to `enabled: true` in `DEFAULT_INTEGRATION_SETTINGS`
- Boot Stage 11 automatically imports repack catalog
- `LibraryGamesContext` subscription appends Debrid games to Library
- **Download will fail**: gofile.io URIs return HTML pages (not binary files) — need direct HTTP links or a configured debrid provider for magnet URIs
- Webview bypass still blocked by Cloudflare — deferred

### Key Files Changed
- `src/services/repackCatalogService.ts` — `ensureRepackCatalogImported()` checksum comparison + re-import
- `public/data/repacks/repack-catalog-v1.json` — replaced with 6 curated entries in `RepackCatalogArtifact` format
- `public/data/repacks/repack-catalog-v1.manifest.json` — updated SHA256 checksum

### Build
- `tsc --noEmit` ✅ (0 new errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — GRAND PHASE 2 (Rust): Lua Engine Wrapper + Generic Extension Lifecycle

### Goal
Build the foundational Lua extension runtime in Rust: a sandboxed Lua engine that loads `extension.lua` files and runs their lifecycle functions (detect, install, enable, disable, uninstall), with `lumaforge.*` API functions mapped to existing backend primitives. No frontend changes — Rust backend only.

### Audit finding
**No Lua runtime crate existed in the project.** The existing "Lua" infrastructure (src-tauri/src/commands/lua.rs) treats `.lua` files as opaque filesystem blobs — scan, enable/disable via rename, delete. No parsing, no execution, no sandbox, no `lumaforge.*` API.

### Part 1: mlua crate added
- `src-tauri/Cargo.toml` — added `mlua = { version = "0.10", features = ["lua54", "vendored"] }` (vendored Lua 5.4 — no system dep needed)

### Part 2: Lua Engine module (`src-tauri/src/lua_engine/`)
- `mod.rs` — **new** — Public API: `LuaEngine` struct, `LuaEngineConfig`, `LuaExtensionResult`, `LuaExtensionFunction`, `LuaExtensionTable`
  - `LuaEngine::new(config)` — Creates sandboxed `mlua::Lua` instance, registers all `lumaforge.*` API functions, loads and evaluates `extension.lua`
  - `get_function(name)` — Returns a typed Rust closure for a lifecycle function extracted from the Lua table
  - Sandboxing: `require`/`loadfile`/`dofile`/`io`/`os`/`package` removed from globals; memory limit via `set_memory_limit(mb)`; hook-based instruction limit via `set_instruction_limit(n)`
  - `lumaforge.file_exists(path)` → calls existing `extension_file_exists` (reused from extension.rs)
  - `lumaforge.file_status(path)` → calls existing `extension_file_status`
  - `lumaforge.rename_file(from, to)` → calls existing `extension_rename_file`
  - `lumaforge.copy_file(from, to)` → calls existing `extension_copy_file`
  - `lumaforge.remove_file(path)` → calls existing `extension_remove_file`
  - `lumaforge.create_dir(path)` → calls existing `extension_create_dir`
  - `lumaforge.list_directory(path)` → calls existing `extension_list_directory`
  - `lumaforge.download_file(url, target)` → calls existing `extension_download_file`
  - `lumaforge.extract_zip(zip, dir, files)` → calls existing `extension_extract_zip`
  - `lumaforge.run_process(exe, args)` → calls existing `extension_run_process`
  - `lumaforge.fetch_url(url)` → calls existing `extension_fetch_url_as_text`
  - `lumaforge.find_largest_exe(dir)` → calls existing `extension_find_largest_exe`
  - `lumaforge.write_text_file(path, content)` → calls existing `extension_write_text_file`
  - `lumaforge.log(level, message)` → Console log from Lua
  - `lumaforge.get_app_data_dir()` → Returns app data directory path
  - `lumaforge.get_extension_dir(id)` → Returns extension-specific directory path
  - All API functions return proper error messages on failure
  - Extension table is extracted via `serde` deserialization into `LuaExtensionTable`

### Part 3: Extension Lifecycle Commands (`src-tauri/src/commands/extension_lifecycle.rs`)
- **new** — 6 Tauri commands wrapping the Lua Engine:
  - `load_extension(extension_id, script_path)` → Creates `LuaEngine`, loads `extension.lua`, extracts table, caches engine in-memory
  - `call_extension_detect(extension_id, install_dir)` → Calls `extension.detect(install_dir)`, returns result
  - `call_extension_install(extension_id, install_dir)` → Calls `extension.install(install_dir)`, returns result
  - `call_extension_enable(extension_id, install_dir)` → Calls `extension.enable(install_dir)`, returns result
  - `call_extension_disable(extension_id, install_dir)` → Calls `extension.disable(install_dir)`, returns result
  - `call_extension_uninstall(extension_id, install_dir)` → Calls `extension.uninstall(install_dir)`, returns result
  - Module-level `ENGINES: DashMap<String, LuaEngine>` cache — engines persist for session lifetime
  - All commands return `Result<LuaFunctionResult, String>` with `{success, value, error}` shape
  - `LuaFunctionResult` serializable struct

### Part 4: Module + command registration
- `src-tauri/src/commands/mod.rs` — `pub mod extension_lifecycle;` added
- `src-tauri/src/lua_engine/mod.rs` — module declared
- `src-tauri/src/lib.rs` — `mod lua_engine;`, 6 lifecycle commands registered

### Key Decisions
- **Session-cached engines**: `DashMap<String, LuaEngine>` avoids re-loading/re-evaluating `extension.lua` on every call. Engine is created once, functions extracted once, and cached until app restart.
- **Sandbox strictness**: No `io`, `os`, `package`, `require`, `loadfile`, `dofile` — only `lumaforge.*` and vanilla Lua stdlib (string, table, math, etc.). Instruction limit and memory limit enforced.
- **Existing primitives reused**: All `lumaforge.*` functions delegate to existing `extension_*` commands — no filesystem rewrite.
- **No frontend yet**: Build is Rust-only; TS bindings and frontend integration deferred.

### Key Files Created/Changed
- `src-tauri/Cargo.toml` — `mlua = { version = "0.10", features = ["lua54", "vendored"] }` added
- `src-tauri/src/lua_engine/mod.rs` — **new** — LuaEngine, sandboxing, lumaforge.* API (423 lines)
- `src-tauri/src/commands/extension_lifecycle.rs` — **new** — 6 lifecycle Tauri commands + DashMap cache (269 lines)
- `src-tauri/src/commands/mod.rs` — `pub mod extension_lifecycle;` added
- `src-tauri/src/lib.rs` — `mod lua_engine;`, 6 commands registered

### Build
- `cargo check` ✅ 0 errors

## Session — Lua Adapter Bypass Fix (+ remote repository install flow)

### Problem
The DeclarativeExtension was hijacking repository-sourced Lua extensions (e.g. OpenSteamTool) during source discovery. When a repository extension had `managedFiles`, `tryCreateDeclarativeExtension` created a DeclarativeExtension runtime for it — which only installs managed DLL files (never saves `extension.lua` to AppData). Meanwhile, the Lua loader (`loadExtensionsFromAppData`) looked for `extension.lua` in AppData but it was never saved there. The DeclarativeExtension should have been bypassed and the Lua adapter (`createLuaExtension`) should have been used instead.

### Root Cause
Two flaws prevented `extension.lua` from being loaded:
1. **ID/Folder mismatch**: remote repo folder was `opensteamtool` but manifest `id` was `opensteamtool-repo`, causing wrong local path resolution in AppData.
2. **Factory hijacking**: `manager.ts` unconditionally fell back to `DeclarativeExtension` when `managedFiles` were present, never leaving room for the Lua adapter.
3. **Missing install flow**: Even with a correct manifest, no code fetched `extension.lua` from the remote repo and saved it to AppData.

### Fixes

#### Part 1: Remote repository ID fix
- `lumaforge-extensions/extensions/opensteamtool/manifest.json` — `id` changed from `"opensteamtool-repo"` to `"opensteamtool"`, `name` changed to `"OpenSteamTool"`.
- `lumaforge-extensions/index.json` — extension entry `id`/`name` changed to `"opensteamtool"`.
- Committed and pushed to `origin/main`.

#### Part 2: manager.ts — Repository extension URL store + DeclarativeExtension skip
- Added module-level `_repositoryExtensionUrls: Map<string, string>` for UI retrieval.
- `setRepositoryManifestUrl(id, url)` / `getRepositoryManifestUrl(id)` / `clearRepositoryManifestUrl(id)` / `clearAllRepositoryManifestUrls()` — public API.
- Repository-sourced extensions (sourceId !== "builtin") with `managedFiles` now SKIP DeclarativeExtension entirely — `ext.extension = undefined`.
- Built-in extensions with `managedFiles` still use DeclarativeExtension (no extension.lua — lifecycle from GitHub releases).
- `[SOURCE_MANAGER] Skipped DeclarativeExtension for "..." (repo-sourced Lua)` diagnostic log.

#### Part 3: ExtensionsSettings.tsx — Remote repository install flow
- New `installRemoteRepositoryExtension()` function (9-step pipeline):
  1. Find existing manifest from extensions list
  2. Derive `extension.lua` URL from manifest URL (`manifest.json` → `extension.lua`)
  3. Fetch both `extension.lua` and `manifest.json` from remote
  4. Re-parse manifest via `loadManifestFromObject` to verify validity
  5. Resolve AppData dir via `resolveAppDataDir()`, create `AppData/extensions/{id}/` via `extensionCreateDir`
  6. Write `extension.lua` and `manifest.json` to AppData directory via `extensionWriteTextFile`
  7. Create Lua extension via `createLuaExtension(manifest, scriptPath)`
  8. Register in runtime Registry via `registerExtension(luaExtension)`
  9. Call Lua install lifecycle via `luaExtension.install({ hostPath: steamRoot })`
- `handleOperation` entry point: when `getExtension(id)` returns null and `getRepositoryManifestUrl(id)` exists, sets "installing" state then delegates to remote install helper.
- UI shows "installing" indicator during fetch, error message on failure, re-detect on success.

### Key Files Changed
- `lumaforge-extensions/extensions/opensteamtool/manifest.json` — id fixed to `opensteamtool`
- `lumaforge-extensions/index.json` — extension entry id fixed to `opensteamtool`
- `src/extensions/sources/manager.ts` — repository URL store, DeclarativeExtension skip for repo extensions
- `src/extensions/ui/ExtensionsSettings.tsx` — `installRemoteRepositoryExtension`, remote install branch in `handleOperation`

### Build
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (only pre-existing test/runtime errors)
- `vite build` ✅ (6.88s, only pre-existing chunk warnings)

## Session — Dashboard/Store perf: PackageCard hover, discover cache guard, mock catalog removal

### Problem
- PackageCard hover had dead action buttons, source selector modal, and 11 unused imports creating noise and bundle size
- `moreToExploreGames` recomputed expensive scoreLookup map (10K entries) on every render due to reference-inequality-only changes
- LibraryGamesContext `applyGamesSafely` setState cascaded re-renders when fingerprint hadn't changed
- Store Browse tab's `searchMockCatalog` returned 4 hardcoded packages — real catalog search existed but was unused

### Fixes

#### PackageCard hover cleanup
- Hover overlay changed to `bg-black/30 pointer-events-none opacity-0 group-hover:opacity-100` matching library/dashboard cards
- Removed all action buttons (Install/Download/Play), source selector modal trigger, provider badge
- Removed dead exports: `onDownload`, `availableSources`, `bestSource`, `formatFileSize`, `getUniqueProviders`, `hasUsableSources`, `truncateTitle`
- Removed 11 imports (lucide icons, React hooks, hooks/services/types/components)
- Removed `internalDownload`, `handleOpenDetails`, `handleDismiss`, `handleShowSourceSelector` functions

#### moreToExploreGames perf guard
- Added `_moreToExploreCacheRef` with lightweight input fingerprint: `{ length, first3Ids, lastUpdateMs }`
- Early return when fingerprint unchanged since last compute
- Prevents expensive scoreLookup Map build (10K entries) on reference-inequality-only changes

#### LibraryGamesContext fingerprint guard
- `applyGamesSafely` now computes fingerprint of filtered games vs `gamesRef.current`
- Skips `setGames` when fingerprint matches — breaks cascading re-render cycle from manual-game/Epic triggers

#### Mock catalog replacement
- `searchMockCatalog()` (4 hardcoded packages) replaced with `searchLocalCatalog()` querying SQLite store catalog
- Uses `steamCatalogService.querySearch()` — returns real Steam games (1,984 entries) with empty `sources[]`
- `ProviderSearchResult.searchedProviders` and `ProviderSearchProviderReport.providerId` types changed from `ApiProviderId` to `string` to accommodate non-provider sources
- Dead functions removed: `filterGameByProvider`, `matchesQuery`, `mergeProviderResults`, `mergeSources`
- `getKnownGameTitle` kept as stub (returns undefined)
- `mockPackages.ts` has zero remaining imports

### Key Files Changed
- `src/components/packages/PackageCard.tsx` — full cleanup: hover simplified, dead code removed
- `src/pages/Store.tsx` — `_moreToExploreCacheRef` early-return guard
- `src/context/LibraryGamesContext.tsx` — fingerprint guard before setGames, fixed `currentFp` redeclaration
- `src/services/providerSearch.ts` — `searchLocalCatalog` replaces `searchMockCatalog`, 4 dead functions removed
- `src/types/providerSearch.ts` — `searchedProviders`/`providerId` type relaxed to `string`
- `src/hooks/useProviderSearch.ts` — type fix, removed `ApiProviderId` import
- `src/data/mockPackages.ts` — zero imports, pending deletion

### Build
- `tsc --noEmit` ✅ (2 pre-existing errors only: PackageCard.tsx `onInstallComplete`, ExtensionsSection.tsx `Puzzle`)
- `vite build` ✅ pending (no structural changes expected to fail)

## Session — Debrid/Hydra F2: Library Provider Integration

### Goal
Integrate Debrid/Hydra repack catalog entries into the Library grid as a first-class game source, following the same memory-first provider store pattern as Epic F1B. This is F2 of the 6-phase Debrid plan.

### Parts Implemented

#### Part 1: Types
- `"debrid"` added to `LibraryGameSource` and `LibraryFilter` unions in `libraryGame.ts`
- `"debrid"` added to `IntegrationId`, `ALL_INTEGRATION_IDS`, `DEFAULT_INTEGRATION_SETTINGS.integrations`, and `INTEGRATION_DISPLAY_DESCRIPTIONS` / `INTEGRATION_DISPLAY_NAMES` in `integrations.ts`
- `INTEGRATION_ICONS`, `INTEGRATION_COLORS`, `REFRESH_LABELS`, `DISABLE_CONFIRM` updated in `IntegrationsSection.tsx` (Cloud icon, cyan color)
- `LibraryRail.tsx` `computeCounts` — added `debrid: 0` counter
- `PROVIDER_CAPABILITIES` in `gameProviderCapabilities.ts` — added conservative `debrid` entry (all false except `canRemoveFromLibrary: true`)

#### Part 2: Feature flag (`debridFeatureFlag.ts`)
- 5 flags: `DEBRID_LIBRARY_ENABLED = false`, `DEBRID_LAUNCH_ENABLED = false`, `DEBRID_STORE_ENABLED = false`, `DEBUG_DEBRID_LIBRARY = false`, `DEBUG_DEBRID_LAUNCH = false`
- All defaults OFF for production

#### Part 3: Pure mapper (`debridGameLibraryMapper.ts`)
- `repackEntryToDebridGame(entry)` — maps `RepackQueryResult` → `LibraryGame`
- `computeDebridFingerprint(games)` — deterministic fingerprint (appId + repacker + fileSize combination)
- `isDebridEntryEligible(entry)` — strict filter (valid appId, non-empty title, non-empty repacker)
- Identity: `providerGameId = entry.id`, `libraryId = "debrid:<id>"`
- `appId = String(entry.appId)` — Steam appId for cross-provider dedup
- `source = "debrid"`, `isInstalled = false`, `isInstallable = true`, `isPlayable = false`
- Fields populated from repack catalog: `title`, `lastUpdated`, `sizeOnDisk` (installSize > fileSize), `gameSize` (fileSize)

#### Part 4: Memory-first provider store (`debridGameStore.ts`)
- Module-level state: `_debridGames: LibraryGame[]`, `_debridFingerprint`, `_scanWarning`, `_scanState`
- `refreshDebridGames()` — calls `getAllRepackEntries()`, filters eligible, maps to LibraryGame, replaces state, notifies on fingerprint change
- `getAllDebridGames()`, `getDebridGame()`, `getDebridGameByAppId()`, `getDebridFingerprint()`, `getDebridScanState()`, `getDebridScanWarning()`
- `subscribeDebridGames(listener)` — returns cleanup function
- `resetDebridGameCache()` — clears state + notifies
- Scanner failure: retains previous valid entries, sets warning, notifies once
- Successful empty scan: replaces with empty (stale entries removed)

#### Part 5: Rust catalog query
- `src-tauri/src/commands/repack_catalog.rs` — added `query_all()` internal fn + `query_repack_catalog_all` Tauri command
- `src-tauri/src/lib.rs` — registered new command
- `src/services/tauri.ts` — `queryRepackCatalogAll()` TS binding + `RepackQueryResult` type

#### Part 6: Catalog service
- `src/services/repackCatalogService.ts` — added `getAllRepackEntries()` with 5-min TTL cache (module-level Map), wraps `queryRepackCatalogAll`
- `resetRepackCatalogCache()` exported for testing

#### Part 7: LibraryGamesContext merge boundary
- Imports: `DEBRID_LIBRARY_ENABLED`, `DEBUG_DEBRID_LIBRARY`, `getAllDebridGames`, `subscribeDebridGames`, `refreshDebridGames`
- `getDebridLibraryGames()` — sync read from in-memory Debrid store
- `applyGamesSafely` now appends `...getDebridLibraryGames()` alongside manual + Epic
- Debrid subscription `useEffect` — strips Debrid games from current, re-applies fresh from store on Debrid store change
- Fingerprint change detection prevents duplicate notifications
- Feature-flag gated: subscription returns immediately when `DEBRID_LIBRARY_ENABLED = false`

### Merge behavior
- `dedupeLibraryGames` dedups by appId — Debrid entries with Steam appIds are deduped against Steam games (first occurrence wins, so real Steam games take priority)
- Debrid without appId go through `noAppId` array

### Key Files Created/Changed
- `src/features/debrid/debridFeatureFlag.ts` — **new** — feature flags
- `src/services/debridGameLibraryMapper.ts` — **new** — pure mapper, eligibility, fingerprint
- `src/services/debridGameStore.ts` — **new** — memory-first store with subscriptions
- `src-tauri/src/commands/repack_catalog.rs` — added `query_all()` + `query_repack_catalog_all`
- `src-tauri/src/lib.rs` — registered command
- `src/services/tauri.ts` — `queryRepackCatalogAll` binding + `RepackQueryResult` type
- `src/services/repackCatalogService.ts` — `getAllRepackEntries()` with 5-min TTL
- `src/context/LibraryGamesContext.tsx` — Debrid merge boundary + subscription effect
- `src/types/libraryGame.ts` — `"debrid"` source/filter
- `src/types/integrations.ts` — `"debrid"` IntegrationId + display names + defaults
- `src/types/gameProviderCapabilities.ts` — debrid capabilities entry
- `src/components/library/LibraryRail.tsx` — debrid count
- `src/components/settings/IntegrationsSection.tsx` — Debrid card icon/color/label/confirm/render loop

### What was NOT changed (F2 boundary)
- No launch — `isPlayable = false` for all Debrid entries
- No Store integration — `DEBRID_STORE_ENABLED = false`
- No Console Mode Debrid exposure
- No install/uninstall via LumaForge
- No metadata API, no artwork resolution
- No cross-provider dedup configuration
- No changes to: gameStore, GameSessionContext, Home, Sidebar, GameDetails, GameEditDialog, Store, Console Mode, Steam launch, Epic, manual games, Hubcap

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

## Session — Fix "render viejo" on Library game switch (hero stale props)

### Problem
When switching to a steam/lua game in LibraryGameDetails, the previous game's hero flashed briefly before self-correcting ("render viejo"). Caused by:
1. `LibraryGameDetailPage` is NOT keyed by game (`App.tsx:273-274`) — its state (`mediaEntry`, `artwork`, `canonicalAppInfo`, `canonicalDiskFallback`, `localDetailsData`, `fallbackBundle`, `resolvedGame`, `canonicalLoaded`) persists from the previous game while the new game's async pipeline loads.
2. Render #1 of the new game received the OLD states as props. Previously Layer 2 (sharp hero) was gated by `canonicalLoaded`; the effect's `setCanonicalLoaded(false)` reset it after paint, hiding the stale frame. After decoupling Layer 2 from `canonicalLoaded`, the stale hero became visible.
3. Two async setters lacked cancellation guards and could write stale state AFTER the reset: `getMediaCacheForAppId(...).then(setMediaEntry)` (`:328`) and `getLibraryGameDetails(...).then(...setLocalDetailsData)` (`:480`).
- Manual games were immune: `canonicalLoaded=true` + asset:// URLs arrive in one pass with `cancelled` guards.

### Fix
1. **Render-phase stale reset** in `LibraryGameDetailPage.tsx` (React "adjusting state when a prop changes" pattern): `_detailKeyRef` compared against `computeGameKey(selectedGame)`; on change, resets `mediaEntry`, `canonicalAppInfo`, `canonicalDiskFallback`, `localDetailsData`, `fallbackBundle`, `artwork`, `resolvedGame`, `canonicalLoaded` during render. Ref guard keeps it idempotent. Render #1 of a new game now always shows the correct placeholder → hero crossfade (matches manual behavior).
2. **`cancelled` guards** added to `getMediaCacheForAppId` (`.then`/`.catch`) and `getLibraryGameDetails` (`.then`) — late resolutions can no longer write stale state.
3. Existing effect resets (`:195-201`) kept as defense in depth (idempotent).

### Key Files Changed
- `src/pages/LibraryGameDetailPage.tsx` — render-phase reset block + 2 cancellation guards

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Vite 8.2 upgrade (Vite 7 → Rolldown)

### Goal
Upgrade the bundler from Vite 7 (esbuild + Rollup) to Vite 8.2 (Rolldown) for faster builds and lower memory in production builds.

### Changes
- **`package.json`** bumps:
  - `vite`: `^7.0.4` → `^8.2.0` (engines `^20.19.0 || >=22.12.0` — OK with Node v24.16.0)
  - `@vitejs/plugin-react`: `^4.6.0` → `^6.0.5` (Vite 8 requires the React 6 plugin; Oxc-based, no Babel)
  - `@tailwindcss/vite`: `^4.3.1` → `^4.3.3` (declares Vite 8 peer support)
  - `vitest`: unchanged at `^4.1.10` (peer `^6‖^7‖^8`)
- **`npm install`** regenerated lockfile: 12 added / 35 removed / 12 changed. EPERM cleanup warnings on native binaries (esbuild/rollup/oxide) are cosmetic.
- **No config changes**: `vite.config.ts` (server + plugins only) needed no Rolldown migration.

### Verification
- `npx tsc --noEmit` ✅ — only the 23 pre-existing errors (tests/extensions), none in touched files
- `npx vite build` ✅ — **1.85s** (was ~6.7s); main chunk `index-*.js` 1,752 kB / gzip 439 kB (similar to pre-existing 1.9MB warning)
- New Rolldown `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings are informational (dynamic imports that stay in the same chunk because they're also statically imported) — not errors
- `npx vitest run` ✅ — 802 passed / 4 failed. The 4 failures are **stale behavioral tests**, NOT Vite-related:
  - `sourceManagerDeclarativeWiring.test.ts` (×3) — tests the OLD behavior (repo-sourced extensions with `managedFiles` get a DeclarativeExtension), which was deliberately removed in the "Lua Adapter Bypass Fix" session (repo-sourced + managedFiles now SKIP DeclarativeExtension)
  - `tools.test.ts` `extractToolConfig` — expects an old 5-field `toolConfig` shape, actual now has 15 fields
- `cargo check` ⏭️ skipped (no Rust changes)

### Known trade-offs
- Rolldown dev server uses ~7x RAM (known upstream, being reduced)
- Pre-existing chunk-size warning persists

### Key Files Changed
- `package.json` — 3 dependency bumps
- `package-lock.json` — regenerated

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅ (1.85s, Rolldown; informational INEFFECTIVE_DYNAMIC_IMPORT warnings only)
- `vitest run` ✅ (802 pass / 4 stale behavioral fails — pre-existing)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Library GameDetails hero pull-focus (blur-to-sharp reveal)

### Problem
Steam/Lua game heroes showed a visible "low-res flash": the hero mounted with the snapshot's low-res landscape/header asset (e.g. `header.jpg` ~460×215) on frame 1, then swapped to the real high-res background (~1920×620) once the async canonical pipeline resolved. Manual games were immune because their artwork arrives in one pass. The existing `animate-hero-sharp-in` (1000ms opacity fade) went unnoticed because by the time the sharp layer mounted, the low-res asset was already showing — the swap itself was the visible artifact.

### Root cause
- `getHeroImageUrl` (LibraryGameDetails.tsx) preferred `appInfoEntry.header_image` (metadataSecondary, low-res) over `game.backgroundPath` (snapshot high-res path, always available in memory)
- `rawPlaceholder` preferred `coverPath` → `landscapePath` over `backgroundPath`, so even the blurred backdrop layer started from low-res assets
- The sharp layer's animation (opacity 0→1) was a pure fade, not tied to a "focus" metaphor — the asset swap between backdrop and sharp was still perceptible

### Fix — pull-focus (blur-to-sharp) reveal

#### Part 1: `getHeroImageUrl` priority reorder
- `game.backgroundPath` (snapshot high-res) now checked BEFORE `appInfoEntry.header_image` (metadataSecondary low-res) and before the rest of the metadata chain
- If no background, `game.landscapePath` still beats the low-res header fallback
- Result: the sharp layer targets the SAME high-res asset the blurred backdrop shows from frame 1 → same image, same crop, only sharpness changes

#### Part 2: `rawPlaceholder` background-first
- Order changed from `coverPath || landscapePath || backgroundPath` → `backgroundPath || landscapePath || coverPath`
- The blurred backdrop layer (frame 1) now starts from the high-res background instead of a low-res cover/landscape

#### Part 3: `heroFocusIn` keyframe (src/App.css)
- New `@keyframes heroFocusIn`: `from { opacity: 0; filter: blur(24px); transform: scale(1.05); }` → `to { opacity: 1; filter: blur(0); transform: scale(1); }`
- 1400ms, `cubic-bezier(0.33, 0, 0.2, 1)` (gentle ease), `both` fill mode
- Starts at `opacity: 0` — seamless with the blurred backdrop beneath (same asset), so no visible "pop"; the sharp layer fades in while unfocusing
- Blur+scale match the backdrop's own `blur-2xl scale-110` state, so the sharp layer "focuses in" from the identical visual state
- **Smoothing pass** (user: "se siente brusco"): was originally 900ms + `cubic-bezier(.2,.8,.2,1)` + starting `opacity: 0.4`; the 0→0.4 opacity jump read as abrupt. Now starts at 0 with a slower, softer ease for a continuous focus pull

#### Part 4: Sharp layer class swap
- `animate-hero-sharp-in` → `animate-hero-focus-in` on the sharp `<img>` (Layer 2), keeping the `imageUrl === loadedHeroUrl` opacity gate
- `heroSharpIn` keyframe + `.animate-hero-sharp-in` class retained in App.css (unused, no removal)

### Design decisions
- **Sutil, no "presentation"**: user chose the subtle variant — blur 24px, scale 1.05, 900ms. No dramatic zoom or full-opacity start
- **Same-asset principle**: backdrop and sharp now resolve to the same background URL, so the transition reads as "the image gained sharpness" rather than an asset swap
- **Backdrop layers unchanged**: `backdropLayers` crossfade (max 2, 600ms prune) confirmed intentional and left as-is
- **`animate-hero-entrance` on the container** (replays on keyed remount `source:appId`) retained

### Key Files Changed
- `src/components/library/LibraryGameDetails.tsx` — `getHeroImageUrl` priority reorder (backgroundPath above metadataSecondary), `rawPlaceholder` background-first, sharp layer class → `animate-hero-focus-in`
- `src/App.css` — `@keyframes heroFocusIn` + `.animate-hero-focus-in`

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.82s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — getHeroImageUrl priority: snapshot/disk paths before remote sources (no Steam→SGDB swap)

### Problem
Hero still showed a visible swap: frame 1 rendered the low-res Steam `appInfoEntry.header_image` (from `appInfoMap`), then `setFallbackBundle()` resolved SGDB and `fallbackBundle.background.url` replaced it ("primero llega una media de steam y luego carga el de steamgriddb"). Root cause: `game.backgroundPath` (snapshot high-res, the same asset the blurred backdrop shows) sat at the BOTTOM of the priority chain (after `appInfoEntry.header_image`, `artwork`, `metaPrimary`, and all `fallbackBundle` local/url sources) — so the sharp layer never converged to the backdrop asset.

### Fix — getHeroImageUrl reorder (LibraryGameDetails.tsx:127-170)
- Snapshot/canonical local disk paths moved to the TOP, interleaved by role, so the sharp hero targets the SAME high-res asset the blurred backdrop shows from frame 1:
  1. `canonicalAppInfo.media.backgroundPath`
  2. `game.backgroundPath` ← moved up
  3. `canonicalAppInfo.media.landscapePath`
  4. `game.landscapePath` ← moved up
  5. `canonicalAppInfo.media.coverPath`
  6. `game.coverPath` ← moved up
  7. `mediaEntry.hero_path` / `grid_path`
  8. `fallbackBundle.*.localPath` (materialized on disk)
  9. `metaPrimary` (Steam metadata background fields)
  10. `appInfoEntry.header_image` (Steam low-res — only when no snapshot/disk media)
  11. `artwork.sgdbHeroUrl` / `sgdbGridUrl`
  12. `fallbackBundle.*.url` (remote SGDB/IGDB/RAWG — last remote)
  13. `metaSecondary` / `imageUrl` / `cover_path` / `canonicalDiskFallback`
- Comment block updated to document the new priority and why (no visible swap when remote sources resolve later).
- No change to `rawPlaceholder` (already background-first) or any other surface.

### Scenario coverage
- **A — Game with snapshot background**: sharp = `game.backgroundPath` from frame 1, identical to backdrop. When `fallbackBundle`/SGDB resolve later they're below the snapshot path → no swap.
- **B — Game with no background but landscape/cover**: falls to `game.landscapePath`/`game.coverPath` before any remote source — still same asset as backdrop.
- **C — Game with only remote sources (no snapshot media)**: `metaPrimary` → `appInfoEntry.header_image` → SGDB → `fallbackBundle.url` chain preserved exactly as before.
- **D — canonicalAppInfo loads with fresh downloaded media**: `canonicalAppInfo.media.*` already outranks snapshot paths; since both usually point to the same file, no visible change.
- **E — Stale snapshot path**: same behavior as before — sharp error leaves the blurred backdrop, which uses the same path.

### Key Files Changed
- `src/components/library/LibraryGameDetails.tsx` — `getHeroImageUrl` reordered (snapshot/disk role paths first, remote sources last)

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.69s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Hero flicker root cause: snapshot media never reaches LibraryGame + relative/absolute path mismatch

### Problem
The blur→sharp hero flicker for Steam/Lua games persisted even after `getHeroImageUrl` was reordered to prioritize snapshot paths. Root cause had 2 gaps + 1 mismatch:

1. **Brecha 1 — `snapshotGameToLibraryGame` discarded `sg.media`** (`LibraryGamesContext.tsx:574-598`): only mapped appId/title/source/installed/playable/lastPlayed/playtime. `backgroundPath`/`landscapePath`/`coverPath` were never copied → `getHeroImageUrl` frame 1 fell to `appInfoEntry.header_image` (low-res) or placeholder. SQLite/reconciled games (`loadCachedGames`) don't populate media paths either.
2. **Mismatch — relative vs absolute path strings**: snapshot stores relative (`media/background.jpg`); `canonicalAppInfo.media` from `loadGameAppInfoWithMediaFallback` resolves to absolute (`resolveMediaPaths`, `gameCacheService.ts:1159`). Both point to the SAME file but the string changes → `key={imageUrl}` (`LibraryGameDetails.tsx:1203`) remounts the `<img>` with `opacity-0` → visible gap.
3. **Brecha 2 (cosmética)**: `rawPlaceholder` already prioritized `game.backgroundPath` but it was empty (gap 1).

Manual games never flickered: their flow (`LibraryGameDetailPage.tsx:244-280`) sets `canonicalAppInfo` + `canonicalLoaded=true` in ONE pass with stable `asset://` URLs.

### Fix

#### Part 1: `snapshotGameToLibraryGame` maps media (LibraryGamesContext.tsx)
- Param type changed from inline shape to `SnapshotGame` (imported from `startupSnapshotService`).
- Copies `backgroundPath`, `landscapePath`, `coverPath`, `logoPath`, `iconPath` from `sg.media` into the `LibraryGame` (fields already exist in `libraryGame.ts:61-68`).

#### Part 2: Snapshot media bridge for SQLite/reconciled path (LibraryGamesContext.tsx `load()`)
- After `loadedGames` is resolved from ANY source (cached/reconciled/snapshot), bridges `snapshot.library.games[i].media` into each game **only when the field is missing** (`!game.backgroundPath && sm.backgroundPath`, etc.).
- Logs `[LIBRARY_CONTEXT][SNAPSHOT_MEDIA_BRIDGE] bridged=N games=N`.
- Covers the common warm-boot case where games come from SQLite (which never populates media paths).

#### Part 3: Stable hero key by basename identity (LibraryGameDetails.tsx)
- Added `sameHeroFile(a, b)` helper — compares normalized basenames (case-insensitive, strips `?`/`#`, splits on `/` and `\`).
- In the `imageUrl` resolution effect (L375-406): `setImageUrl((prev) => (prev && url && sameHeroFile(prev, url) ? prev : url))` — keeps the current string when the newly-resolved URL points to the same file (relative snapshot vs absolute canonical). This prevents the `key={imageUrl}` remount and its opacity-0 gap.
- Functional update avoids adding `imageUrl` to the effect deps.
- Existing `imageUrl === loadedHeroUrl` opacity gate + backdrop crossfade remain as safety net when the file genuinely changes (e.g. header→background).

### Root-cause summary (for future reference)
- Snapshot DOES persist appinfo media (`startupSnapshotService.ts:85-122` `normalizeAppInfoMedia`; Rust `validate_snapshot_media_paths` returns the ORIGINAL relative path + `*Exists` flags, never rewrites to absolute).
- The boot is correct — the data existed but was dropped at the mapper boundary and re-formatted by the canonical resolver.
- Frame 1 hero now converges to the same asset as the blurred backdrop; when canonical resolves the same file, the string is preserved → no remount → no gap.

### Key Files Changed
- `src/context/LibraryGamesContext.tsx` — `SnapshotGame` import, `snapshotGameToLibraryGame` media mapping, `[LIBRARY_CONTEXT][SNAPSHOT_MEDIA_BRIDGE]` in `load()`
- `src/components/library/LibraryGameDetails.tsx` — `sameHeroFile()` helper, stable `setImageUrl` in resolution effect

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.76s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Hero logo: kill title flash + responsive sizing

### Problem
Two issues in the hero bottom-content logo block (`LibraryGameDetails.tsx`):

1. **Title flash before logo**: `resolvedLogoUrl` was resolved in a `useEffect` (default state `undefined`). The whole block is gated by `canonicalLoaded`; on the first render after it flips true, `canonicalAppInfo.media.logoPath` was already resolved (absolute) but `logoUrl` was still `undefined` → JSX `logoUrl ? <img> : <h1>` rendered the title for ~1 frame (16ms). For relative paths (`games/`,`media/`,`img/`) the effect also did a dynamic `import()` + async Tauri invoke, stretching the flash to tens of ms.
2. **Non-responsive logo sizing**: `logoDisplayHeight` clamped to fixed pixels (`Math.max(80, Math.min(200, naturalHeight))`) — same size regardless of viewport width.

### Fix

#### Part 1: Render-phase synchronous logo resolution
- Extracted `resolvedLogoSync` via `useMemo` — resolves the logo URL during render for absolute/local/http paths (`isLocalPath` → `localPathToUrl`, else the raw string). Relative paths return `undefined` (async needed).
- The `useEffect` now runs ONLY for relative paths, writing to `resolvedRelativeLogoUrl`.
- `logoUrl = resolvedLogoSync ?? resolvedRelativeLogoUrl` — the first render after `canonicalLoaded=true` already has the logo (canonical paths are absolute) → the title is never painted.

#### Part 2: No title swap when logo pending
- Render branch: `logoUrl ? <img> : rawLogoUrl ? <div placeholder/> : <h1>`.
- The placeholder div (same responsive box as the logo) prevents any title→logo swap; the title only shows when there is genuinely no logo source.

#### Part 3: `loading="lazy"` → `eager`
- The hero logo is the main visual above the fold; eager removes the extra load delay.

#### Part 4: Responsive logo sizing (replaces fixed-pixel clamp)
- `logoWidth = clamp(160px, 44vw, 540px)` — scales with viewport, min/max caps.
- `height: auto` once loaded (`logoNaturalHeight != null`) — proportional to intrinsic aspect ratio.
- `max-height: clamp(80px, 18vh, 240px)` + `object-contain` — caps extreme ratios without distortion.
- Pre-load reservation `height: clamp(80px, 14vh, 200px)` — no layout collapse/pop before intrinsic size is known.
- `logoNaturalHeight` retained only as a "loaded" marker (resets on `logoUrl` change).

### Key Files Changed
- `src/components/library/LibraryGameDetails.tsx` — `resolvedLogoSync` useMemo, relative-only effect → `resolvedRelativeLogoUrl`, `logoUrl` derivation, placeholder branch, `loading="eager"`, responsive `logoWidth`/`logoHeightFallback`/`logoMaxHeight` constants, `<img>` style

### Build
- `tsc --noEmit` ✅ (no errors in `LibraryGameDetails.tsx`)
- `vite build` ✅ (1.70s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Manual game favorite keys: unify via getFavoriteKey + delete-only reconciler

### Problem
A manual game that gained a Steam appId lost its favorite marker and, when re-toggled, rendered twice.

### Root cause
- manualGameLibraryMapper.ts:127 assigns ppId: entry.appId ?? entry.linkedSteamAppId to manual games.
- Favorite-key consumers computed the key inline with game.appId || game.id — so a manual game that now has a numeric ppId read the appId instead of its canonical manual:<uuid> libraryId.
- Result: the existing favorite (manual:<uuid>) no longer matched (heart unchecked), and toggling created a NEW favorite under the appId. FavoritesSection resolves both keys against its identityMap → card rendered twice.

### Fixes

#### Part 1: Unified favorite key everywhere
- Added getFavoriteKey() usage at all inline sites (game.appId || game.id → getFavoriteKey(game) ?? game.id):
  - LibraryGameDetails.tsx L281 (avoriteId)
  - GameLauncherTile.tsx L142 (_favKey) + L818 toggle
  - SidebarLibraryList.tsx L718 (_sfk) + L771 toggle
  - FavoritesSection.tsx L217 (handleToggleFavorite)
  - ConsoleGameCard.tsx L22, ConsoleGameDetails.tsx L389/L723, ConsoleGameOptionsOverlay.tsx L49/L87, ConsoleGridLayout.tsx L68, ConsoleSpotlightLayout.tsx L81, ConsoleSwitchSpotlightLayout.tsx L118/L427
- getFavoriteKey (already in gameCacheService.ts:350): manual → libraryId, Steam → appId, Epic/other → libraryId, fallback id.

#### Part 2: Delete-only reconciler
- New econcileManualFavoriteKeys(manualGames) in gameCacheService.ts (after getFavoriteKey):
  - Rule: if BOTH ppId AND libraryId are in the favorites set → delete the ppId key.
  - "appId-only" case untouched (could be a real Steam favorite).
  - Idempotent; on change writes localStorage + dispatches lumaforge-data-changed with detail.key = "lumaforge-favorites-v1" (triggers FavoritesContext reload at L67).
- Hooked in LibraryGamesContext.tsx manual-games subscription effect: one-shot boot-time reconcile + per-change reconcile. Log [FAVORITES][RECONCILE].

#### Part 3: FavoritesSection defensive dedup
- FavoritesSection.tsx favoriteIds loop now also tracks libGame.libraryId || libGame.id in seen — a game reachable via both appId and libraryId renders only once.

### Key Files Changed
- src/services/gameCacheService.ts — FAVORITES_STORAGE_KEY + econcileManualFavoriteKeys()
- src/context/LibraryGamesContext.tsx — boot-time + per-change reconcile in manual subscription effect
- src/components/library/LibraryGameDetails.tsx, src/components/games/GameLauncherTile.tsx, src/components/layout/SidebarLibraryList.tsx, src/components/dashboard/FavoritesSection.tsx — getFavoriteKey call sites
- src/features/console/ConsoleGameCard.tsx, ConsoleGameDetails.tsx, ConsoleGameOptionsOverlay.tsx, ConsoleGridLayout.tsx, ConsoleSpotlightLayout.tsx, ConsoleSwitchSpotlightLayout.tsx — getFavoriteKey call sites + imports

### Build
- 	sc --noEmit ✅ (only pre-existing extension/test errors, none in touched files)
- ite build ✅ (2.93s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- cargo check ⏭️ skipped (no Rust changes)

## Session — Dashboard hero Ken Burns motion (continuous slow zoom/pan)

### Goal
Add ambient motion to the dashboard/home hero background without touching layout, matching the Console Spotlight Ken Burns already in the app.

### Changes
- `src/App.css` — new `@keyframes heroKenburns` (scale 1→1.06 + translate(-1%, 0.5%), origin center, 25s ease-in-out infinite alternate) + `.animate-hero-kenburns` class next to the other hero keyframes, with a `prefers-reduced-motion: reduce` guard that disables the animation.
- `src/components/dashboard/GameHero.tsx` — `data-hero-bg-layer` div (L780) now uses `className="animate-hero-kenburns absolute inset-0"`.

### Behavior
- Only the background art layer moves; gradient overlays (bottom `:795`, left `:798`) and `z-10` content (title/buttons/stats) stay static.
- Continuous (`infinite alternate`) — no restart on game switch; the section's `overflow-hidden` clips scaled edges so no gaps appear.
- Fallback gradient (no bgUrl) stays static; reduced-motion users get no animation.
- No layout shift, no JS, no new dependencies.

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.07s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Merge AppTitleBar into TopBar (unified toolbar, no divider)

### Goal
Make the window title bar visually disappear — no border divider — and merge it into the main toolbar so the app reads as a single 56px bar: search … drag · console · bell · [min][max][close], with the sidebar spanning full height (Discord/Slack style).

### Changes
- **`TopBar.tsx`** — absorbed the Tauri window-control logic and buttons from `AppTitleBar.tsx`:
  - Added `isMaximized` state, `syncIsMaximized()` (driven by `onResized`), `exec()` helper, minimize/maximize/close/double-click handlers, dynamic `getCurrentWindow` import, `DEBUG_WINDOW_CONTROLS` flag.
  - `<header>` restructured (`h-14`, `bg-(--shell-bg)`, backdrop-filter, added `select-none`): left group (menu + search, `px-4 lg:px-6` moved here) → drag spacer (`data-tauri-drag-region flex-1 self-stretch` + double-click maximize) → right group (console + bell, `pr-2`) → 3 square window-control buttons (46px each, flush right, hover/close styles preserved).
- **`AppLayout.tsx`** — removed `<AppTitleBar />` (was L128) and its import; the sidebar/content row now starts at the top of the window.
- **`AppTitleBar.tsx`** — deleted (dead code, only imported by AppLayout).

### Behavior
- No divider/border; the sidebar top area is no longer draggable (drag region is the middle stretch of the top bar, double-click = maximize).
- Notification + console icons sit directly left of minimize/maximize/close.
- Everything raises ~36px; sidebar spans full height.

### Key Files Changed
- `src/components/layout/TopBar.tsx` — window controls + drag region merged in
- `src/components/layout/AppLayout.tsx` — AppTitleBar removed
- `src/components/layout/AppTitleBar.tsx` — deleted

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.32s, Rolldown; only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Fluent theme + Ambient background

### Goal
Add a Windows 11-style "Fluent" theme (neutral Mica-like backdrop optimized for Liquid Glass) and a global ambient background: the active game's artwork shown blurred behind the whole UI, with translucent shell surfaces so the art shows through (acrylic effect) on every screen.

### Part 1: Fluent theme
- `src/theme/themes.ts` — new `fluent` theme added to the `themes` list + `themeVariables` (neutral dark grays: bg `#1f1f1f`, surface `#2b2b2b`, accent `#60cdff`); description "Estilo Windows 11 con acento azul y superficies de vidrio. Ideal con Liquid Glass."
- `src/types/theme.ts` — `"fluent"` added to `ThemeId` union
- `src/App.css` — neutral Mica-like backdrop for `:root[data-theme="fluent"] body` + `.lf-backdrop` (blue-tinted radial glows over a `#23252a → bg` linear gradient); `:root[data-theme="fluent"][data-surface="liquid-glass"]` gets `--shell-border: rgba(255,255,255,0.14)` + deeper `--surface-active-shadow`
- Renders through the existing theme grid in Settings automatically (no new UI)

### Part 2: Ambient background store (`src/services/ambientBackgroundStore.ts` — **new**)
- Module-level store: `url`, `scope`, `enabled` + listener set; snapshot object consumed via `useSyncExternalStore`
- localStorage key `lumaforge-ambient-background` (`"1"`/`"0"`), read once at module init
- `setAmbientSource(scope, url)` — scoped writes, last-scope-wins, emits only on change; `clearAmbientSource(scope)`
- `setAmbientEnabled(bool)` — persists + emits; `isAmbientEnabled()`, `subscribeAmbient()`, `getAmbientSnapshot()`
- Syncs `document.documentElement.dataset.ambient = "on" | "off"` on every emit

### Part 3: AmbientBackground component (`src/components/layout/AmbientBackground.tsx` — **new**)
- `useSyncExternalStore` on the store; renders `null` when disabled or no URL
- Fixed full-screen `pointer-events-none absolute inset-0 z-[1] overflow-hidden` layer, mounted in `AppLayout.tsx` right after `.lf-backdrop` in BOTH the Desktop layout and the Console Mode layout
- Art `<img>`: `animate-ambient-in h-full w-full scale-110 object-cover blur-2xl` at `opacity-40`, crossfade handled by `key={url}` remount
- Overlays: `bg-black/45` dim + `bg-linear-to-t from-(--color-bg)/75 via-transparent to-(--color-bg)/40` bottom blend into the UI background

### Part 4: Translucent shell CSS (`src/App.css`)
- `:root[data-ambient="on"]` makes the shell/page translucent so the art shows through: `--page-bg: transparent`, `--shell-bg: color-mix(in srgb, var(--color-bg) 55%, transparent)`, `--shell-blur: blur(24px)`, `--shell-border: color-mix(in srgb, var(--color-border) 60%, transparent)`
- `ambientIn` keyframes (opacity 0→1) + `.animate-ambient-in` (500ms ease-out both); disabled under `prefers-reduced-motion`

### Part 5: Source feeding (3 surfaces)
- **GameHero.tsx (dashboard)** — every background resolution path now also calls `setAmbientSource("dashboard", url)` on success and `clearAmbientSource("dashboard")` on null/error; unmount effect clears
- **LibraryGameDetails.tsx** — feeds the resolved `imageUrl` as scope `"library-details"`; clears on `game.appId` change + unmount
- **ConsoleGameDetails.tsx** — feeds `heroSrc` as scope `"console-details"`; clears on game change + unmount

### Part 6: Settings toggle
- `src/pages/Settings.tsx` — "Fondo ambiental" `ToggleOption` in the Apariencia section ("Muestra el arte del juego activo (difuminado) detrás de la interfaz en todas las pantallas."), bound via `useSyncExternalStore` + `setAmbientEnabled`

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` — **new** — ambient store + dataset sync
- `src/components/layout/AmbientBackground.tsx` — **new** — ambient art layer component
- `src/App.css` — fluent backdrop, `:root[data-ambient=on]` shell overrides, `ambientIn` keyframes
- `src/components/layout/AppLayout.tsx` — AmbientBackground mounted (Desktop + Console)
- `src/components/dashboard/GameHero.tsx` — ambient source feed for dashboard hero
- `src/components/library/LibraryGameDetails.tsx` — ambient source feed for library details
- `src/features/console/ConsoleGameDetails.tsx` — ambient source feed for console details
- `src/pages/Settings.tsx` — "Fondo ambiental" toggle
- `src/theme/themes.ts` + `src/types/theme.ts` — Fluent theme

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (Rolldown; verified in dist: `animate-ambient-in` + `ambientIn` keyframes, `:root[data-ambient=on]` overrides, `from-(--color-bg)` gradient utilities, AmbientBackground module + "Fondo ambiental" settings row all present)
- `cargo check` ⏭️ skipped (no Rust changes)


## Session � Ambient latency fix + editable accent + blur intensity + Fluent 2/Mica/Acrylic audit

### Goal
(1) Fix ambient background updating late/stale across page navigation, (2) make the theme accent color user-editable, (3) add subtle blur intensity levels, (4) audit a Fluent 2 + Mica/Acrylic + Dynamic Effect global theme overhaul (spec only � no UI overhaul executed).

### Part 1: Ambient store � two-slot source model
- `src/services/ambientBackgroundStore.ts` rewritten:
  - **`_detail` slot** � active-page scoped source (`dashboard`, `library-details`, `console-details`) set via `setAmbientSource(scope, url)` while a surface is mounted; cleared on unmount.
  - **`_context` slot** � navigation-level fallback set via `setPageContextSource(url)` on every page change (`page-context` scope); `clearPageContextSource()` resets it.
  - `clearAmbientSource(scope)` now falls back to the context URL instead of nulling the ambient entirely � fixes the flash-to-black when navigating between games/pages while detail art is still resolving.
  - Snapshot shape `{ url, enabled, intensity }`; same `subscribeAmbient`/`getAmbientSnapshot` contract (backward compatible).
- **Sync first-paint feeds** (before async resolution):
  - `LibraryGameDetails.tsx` � first effect feeds from `imageUrl` OR raw in-memory snapshot path (`game.backgroundPath ?? landscapePath ?? coverPath`) via `localPathToUrl`/`isLocalPath`, skipping relative `media/`/`img/`/`games/` prefixes (async effect upgrades those later).
  - `GameHero.tsx` � parallel synchronous feed effect (deps: `runningLibGame, heroAppId, heroGame?.media.*, heroManualGame, heroEpicGame`); new imports `localPathToUrl`, `isLocalPath`.
- **Nav fallback** (`App.tsx`): new `AmbientNavFallback({ activePage })` mounted inside `GameDetailsProvider` after `GameSessionHUD`; feeds `selectedGame.imageUrl` if present, else first snapshot game with `backgroundPath ? landscapePath ? coverPath`, else `games[0]`; skips relative provider paths; clears context otherwise.

### Part 2: Editable accent color
- `src/context/ThemeContext.tsx` � new `accentOverride: string | null` + `setAccentOverride(hex | null)`; storage key `lumaforge-accent` (validates `HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`); theme effect applies `--color-accent` + derived `--color-accent-text` (luminance threshold 0.62 ? near-black vs white) after `themeVariables[theme]`; synced across windows via `lumaforge-data-changed`; `useMemo` value includes the new members.
- `src/components/settings/AccentColorPicker.tsx` � **new** � native `<input type="color">` bound to `useTheme().accentOverride`/`setAccentOverride`, live hex display, "Restaurar" button clearing to null; `lf-surface rounded-2xl border p-4` styling; swatch shows theme accent (`themeVariables[selectedTheme]["--color-accent"]`) when no override.
- `src/pages/Settings.tsx` � picker mounted in Apariencia section (below theme grid, above surface modes); `themeVariables` + `accentOverride`/`setAccentOverride` destructured.

### Part 3: Ambient blur intensity
- `ambientBackgroundStore.ts` � `AmbientIntensity = "sutil" | "equilibrado" | "vivido"` (default `equilibrado`), `setAmbientIntensity`/`getAmbientIntensity`, localStorage `lumaforge-ambient-intensity`.
- `src/components/layout/AmbientBackground.tsx` � reads `intensity`; mapping: `sutil` ? `blur-xl` + art `opacity-30` + `bg-black/50`; `equilibrado` ? `blur-2xl` + `opacity-40` + `bg-black/45`; `vivido` ? `blur-3xl` + `opacity-55` + `bg-black/40`.
- `src/pages/Settings.tsx` � 3-option segmented control (Sutil/Equilibrado/V�vido) under the ambient toggle, hidden when ambient disabled.

### Part 4: Fluent 2 + Mica/Acrylic + Dynamic Effect audit (spec � no overhaul)
Mapping of Windows 11 Fluent 2 concepts to existing LumaForge infrastructure:

| Fluent 2 concept | Current LumaForge infra | Status |
|---|---|---|
| **Mica backdrop** (desktop wallpaper bleed) | `:root[data-theme="fluent"] .lf-backdrop` neutral radial glows; `data-ambient=on` makes shell translucent showing ambient art | Partial � Mica reads OS wallpaper, we use ambient art instead |
| **Acrylic material** (translucent blur) | `--shell-blur: blur(24px)` + `--shell-bg: color-mix(... 55%, transparent)` when `data-ambient=on` | Present via CSS `backdrop-filter` |
| **Reveal/Hover glow** | `--surface-active-border`, `hover:bg-white/10`, accent hovers | Partial � no dynamic pointer-lighting |
| **Dynamic Effect** (accent flows through UI, but keep solid surfaces opaque) | `--color-accent` theming + new `accentOverride`; solid surface mode keeps `--shell-bg` opaque | Accent editable now; effect flow = theme+accent vars |
| **Accent color picker** | Settings ? Apariencia ? AccentColorPicker | Implemented (Part 2) |
| **Mica/acrylic tint** | `--color-bg` + `--shell-border: rgba(255,255,255,0.14)` for liquid-glass | Present |
| **Window chrome** | `TopBar.tsx` merged window controls, `--shell-bg` header | Present |
| **Dynamic Effect per-surface** | No per-surface accent derivation (e.g. buttons vs selected nav pill) | **Gap** � future: compute `--color-accent-soft`/`--color-accent-strong` variants |
| **System accent detection** | None � accent always from theme | **Gap** � future: read `windows` registry accent via Rust |
| **Mica OS wallpaper capture** | None � uses ambient art instead | **Gap** � future: Tauri `windows` crate capture |

**No UI overhaul executed** � Parts 1-3 are the deliverable; Part 4 documents the roadmap (per-surface Dynamic Effect variants, system-accent detection, Mica OS capture) for a future session.

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` � two-slot model, page-context API, intensity state/persistence
- `src/components/layout/AmbientBackground.tsx` � intensity ? blur/dim/opacity mapping
- `src/components/settings/AccentColorPicker.tsx` � **new** � accent picker + reset
- `src/pages/Settings.tsx` � accent picker mount + intensity segmented control
- `src/context/ThemeContext.tsx` � accentOverride apply/persist/sync
- `src/App.tsx` � `AmbientNavFallback` component
- `src/components/library/LibraryGameDetails.tsx` � synchronous ambient feed from snapshot path
- `src/components/dashboard/GameHero.tsx` � synchronous ambient feed + `localPathToUrl`/`isLocalPath` imports

### Build
- `tsc --noEmit` ? (only 23 pre-existing extension/test errors, none in touched files)
- `vite build` ? (2.00s, Rolldown; verified `sutil/equilibrado/vivido` + "Color de acento" strings in bundle)
- `cargo check` ?? skipped (no Rust changes)

## Session � Ambient reactividad real + crossfade premium + feeds de Store

### Goal
Arreglar el fondo ambiental para que reaccione en tiempo real (antes solo cambiaba al navegar de página o al minimizar/maximizar), y hacer que la página Store alimente el fondo desde el carrusel hero de Discover y la galería de medios de detalles, con crossfade suave premium al cambiar de imagen.

### Part 1: Root cause del no-re-render (fix cr�tico)
- `src/services/ambientBackgroundStore.ts` � `emit()` mutaba el MISMO objeto `_snapshot` en cada llamada; `useSyncExternalStore` compara con `Object.is` y, al ser la misma referencia, jam�s re-renderizaba el componente. El refresh al minimizar/maximizar era un efecto secundario de un re-render por resize que rele�a el objeto mutado.
- Fix: `_snapshot` pasa de `const` a `let`; `emit()` asigna un objeto NUEVO `{ url, enabled, intensity }` cada vez (con comentario explicando el bug de `Object.is`).

### Part 2: Feeds de Store (nuevos scopes del slot `_detail`)
- `StoreDiscoverHeroCarousel.tsx` � deriva `ambientImage = getGameImage(activeGame, storeMetadataByAppId)` y llama `setAmbientSource("store-hero", ambientImage ?? null)` en efecto por cambio de imagen; cleanup al unmount.
- `StoreGameMediaGallery.tsx` � nueva prop opcional `onMediaSelect?: (imageUrl: string | null) => void`; reporta la imagen actualmente mostrada via ref (`onMediaSelectRef`) en efecto por `currentMediaImage` (screenshot ? `image`; trailer ? `thumbnail ?? poster`; null cuando no hay item).
- `StoreGameDetailsPage.tsx` � wired: `handleAmbientMedia = useCallback((u) => setAmbientSource("store-details", u), [])` + cleanup al unmount; pasa `onMediaSelect` a la galer�a. Cubre AMBAS rutas que renderizan esta p�gina: `Store.tsx` (L3351) y `GameDetails.tsx` (L440, b�squeda global).

### Part 3: Crossfade premium en AmbientBackground
- `src/components/layout/AmbientBackground.tsx` � reemplaza el remount `key={url}` por dos capas apiladas: estado `prevUrl`; cuando `url` cambia, la capa anterior queda montada con `animate-ambient-out` (fade-out) mientras la nueva entra con `animate-ambient-in` (fade-in); ambas `absolute inset-0 scale-110 object-cover` bajo los overlays compartidos (dim + gradiente). `prevUrl` se limpia tras ~650ms (`CROSSFADE_MS`). Null-safe cuando `!enabled || !url`.
- `src/App.css` � `@keyframes ambientOut` (to opacity 0) + `.animate-ambient-out` (600ms ease-in forwards); `ambientIn` pasa a 600ms ease-out; ambos dentro del guard `prefers-reduced-motion`.

### Build
- `tsc --noEmit` ? (solo los 23 errores preexistentes de extensions/tests; los errores temporales de `StoreMediaItem.image` en la galer?a se resolvieron con narrowing por tipo `trailer` vs `screenshot`)
- `vite build` ? (2.19s, Rolldown; solo warnings preexistentes + INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ?? skipped (no Rust changes)

## Session — Apartado "Animaciones": selector de transición de hero/fondo (crossfade default)

### Goal
Añadir el apartado **"Animaciones"** en Ajustes con un selector de transición de hero/fondo (3 opciones) y aplicarlo a los 4 heros: LibraryGameDetails, GameHero (dashboard), StoreDiscoverHeroCarousel y ConsoleGameDetails.

### Decisiones (confirmadas por el usuario)
- **Crossfade = default en todos los heros** (incluye dashboard; el Ken Burns deja de ser fijo y pasa a ser opción).
- El **ambient global** siempre usa el crossfade premium — queda fuera del selector.
- El apartado Animaciones contiene solo el selector (sin toggles globales de animaciones menores).

### Part 1: `src/services/heroTransitionStore.ts` (nuevo)
- `HeroTransitionId = "crossfade" | "kenburns" | "focus"`; `HERO_TRANSITION_OPTIONS` (label + description por opción).
- localStorage `lumaforge-hero-transition`; `setHeroTransition` / `getHeroTransition` / `subscribeHeroTransition` / `getHeroTransitionSnapshot`.
- `emit()` asigna snapshot NUEVO por llamada (lección aprendida del bug `Object.is` del ambient store).

### Part 2: `src/hooks/useCrossfadeSrc.ts` (nuevo)
- `CROSSFADE_HOLD_MS = 650`; dos capas `{ prevSrc, currentSrc }`; la capa previa se mantiene montada (fade-out) mientras la nueva hace fade-in, y se limpia tras `holdMs`.
- `prevSrc` es `null` cuando no hay capa previa que conservar.

### Part 3: CSS en App.css
- `heroCrossfadeIn` (600ms ease-out both) → `.animate-hero-crossfade-in`
- `heroMediaOut` (600ms ease-in forwards) → `.animate-hero-media-out`
- `.animate-hero-kenburns-in` (combina `heroKenburns` 25s infinite alternate + `heroCrossfadeIn` 600ms)
- Guard `prefers-reduced-motion` con `animation: none !important` para las tres.

### Part 4: Aplicación en los 4 heros
- **LibraryGameDetails.tsx**: suscripción `useSyncExternalStore`; `sharpHeroClass` (kenburns→`animate-hero-kenburns-in`, focus→`animate-hero-focus-in`, else→`animate-hero-crossfade-in`) en la capa nítida.
- **GameHero.tsx** (dashboard): `heroBgClass` (kenburns→`animate-hero-kenburns`, focus→`animate-hero-focus-in`, else→`animate-hero-crossfade-in`) en el div `data-hero-bg-layer`.
- **StoreDiscoverHeroCarousel.tsx**: crossfade real de dos capas con `useCrossfadeSrc(ambientImage)` — capa previa `animate-hero-media-out` + capa actual `animate-hero-crossfade-in`; modos kenburns/focus con clase única. Reactivo a clicks y auto-advance de 7s.
- **ConsoleGameDetails.tsx**: `consoleHeroClass` (misma lógica) en el `<img>` del hero backdrop.

### Part 5: Settings.tsx — sección "Animaciones"
- Insertada justo después de la sección Apariencia (antes de Display).
- Selector segmentado de 3 columnas (mismo patrón que "Intensidad del fondo ambiental") con label + descripción por opción.
- Nota: "El fondo ambiental siempre usa la transición de fundido premium, independientemente de esta selección."

### Key Files Changed
- `src/services/heroTransitionStore.ts` — **nuevo** — store de la preferencia + opciones
- `src/hooks/useCrossfadeSrc.ts` — **nuevo** — hook de dos capas para surfaces de imagen única
- `src/App.css` — `heroCrossfadeIn`, `heroMediaOut`, `.animate-hero-kenburns-in`, reduced-motion guard
- `src/components/library/LibraryGameDetails.tsx` — `sharpHeroClass` en capa nítida
- `src/components/dashboard/GameHero.tsx` — `heroBgClass` en bg layer
- `src/components/store/StoreDiscoverHeroCarousel.tsx` — crossfade de dos capas + modos
- `src/features/console/ConsoleGameDetails.tsx` — `consoleHeroClass` en hero backdrop
- `src/pages/Settings.tsx` — sección Animaciones + suscripción al store

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.97s, Rolldown; solo warnings preexistentes + INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session � Library search/footer/dropdown polish + Liquid Glass console
### Goal
Centered topbar search with drag on both sides, fixed pagination footer that hides with Show All, glass dropdown with enter/exit animation, and Liquid Glass look applied to main console surfaces respecting `data-console-theme` overrides.

### Part A: TopBar + PackagesToolbarSearch
- `TopBar.tsx` � new 5-zone header: left group (hamburger only in drawer mode) ? left drag-spacer (`flex-1` + `data-tauri-drag-region` + double-click maximize) ? centered search wrapper (`flex min-w-0 flex-1 items-center justify-center px-2` around `w-full max-w-[540px]`) ? right drag-spacer (identical) ? right group + window controls.
- `showSearch = activePage !== "store"`.
- `PackagesToolbarSearch.tsx` L121 � topbar variant `h-9 w-full` (width controlled by centered wrapper); dropdown unchanged `lf-popover-enter absolute z-50 w-[400px]`.

### Part B: Library pagination footer
- `Library.tsx` � footer renders only when `visibleGames.length > 0 && pageSize !== SHOW_ALL`; `sticky bottom-0 z-10 shrink-0 border-t border-(--surface-active-border)/40 bg-(--color-bg)/70 backdrop-blur-lg`; inner div preserves `mx-auto flex w-full items-center justify-between px-6 py-2.5 lg:px-8 xl:px-10` + `max-w-[1900px]` only when `!settings.libraryUseFullWidth`.

### Part C: CardActionMenu glass + exit animation
- `CardActionMenu.tsx` � `EXIT_MS = 140`, `closing` state + `wasOpenRef` + `closeTimerRef`; render guard `if ((!open && !closing) || !pos) return null`; menu and submenu use `bg-(--color-surface)/95 backdrop-blur-xl`; animation class `closing ? "lf-popover-exit" : "lf-popover-enter"`.
- `App.css` � `@keyframes lfPopoverExit` (140ms ease-in forwards, reverse of enter) + `.lf-popover-exit`.

### Part D: Liquid Glass console surfaces
- `App.css` � `.lf-console-glass` (`color-mix(in srgb, var(--color-surface) 55%, transparent)` + `blur(28px) saturate(1.4)` + inset top highlight) and `.lf-console-glass-strong` (72% + blur(32px) + highlight 0.08); both with `-webkit-backdrop-filter` and `prefers-reduced-motion` guard. Use `--color-surface` so `data-console-theme` overrides are respected.
- Applied to: `ConsoleGridLayout.tsx` right panel (L328) + bottom bar (L567); `ConsoleTopHud.tsx` clock badge + buttons; `ConsoleSpotlightDock.tsx` (L22, kept `ring-white/[0.12]`); `ConsoleGameOptionsOverlay.tsx` panel (L425); `ConsoleSearchOverlay.tsx` sheet (L465); `ConsoleInstallModal.tsx` modal (L186); `ConsoleGameDetails.tsx` panel via `surfaceBg` (liquid-glass?`lf-console-glass`, default?`lf-console-glass-strong`, solid?opaque unchanged).
- Out of scope (kept hardcoded): badge/chip fills (`bg-black/40` dim backdrops, `bg-amber-600/85` toast, `bg-cyan-500/20` rings, category pill hovers).

### Build
- `tsc --noEmit` (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` (1.74s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)

## Session — Console Grid hover backdrop + Library hover ambient + always-fixed footer

### Goal
(1) En Console Mode grid: backdrop dinámico del panel derecho según la card enfocada/hovered, con cambio **instantáneo** y alimentación del ambient store global. (2) En Library: footer de paginación **siempre fijo** abajo (también con "Show All" y 0 resultados). (3) Disparar el fondo ambiental global al hacer hover sobre cualquier card de Library.

### Part 1: ConsoleGameCard hover hooks
- `ConsoleGameCard.tsx` — props opcionales `onHover?: (game) => void` / `onHoverEnd?: () => void`; root div (rol button) conecta `onMouseEnter={() => onHover?.(game)}` + `onMouseLeave={() => onHoverEnd?.()}`. Backward-compatible (nada cambia si las props no se pasan).

### Part 2: ConsoleGridLayout instant backdrop + ambient feed
- `ConsoleGridLayout.tsx` — imports `localPathToUrl`, `isLocalPath`, `setAmbientSource`, `clearAmbientSource`.
- Estado `hoverGame`; `backdropGame = hoverGame ?? previewGame` (hover gana, fallback al preview).
- `backdropSrc = getConsoleHeroBackground(backdropGame)` (síncrono desde consoleMedia).
- `useEffect` ambient: feed scope `"console-grid-focus"` con skip de prefijos relativos `games/`/`media/`/`img/`, `isLocalPath ? localPathToUrl : raw`; cleanup `clearAmbientSource` al desmontar. Cambio instantáneo: el backdrop del panel derecho NO está debounced.
- Panel derecho (L328) restructurado a `relative overflow-hidden` + capa backdrop `<img>` (`scale-110 object-cover blur-2xl opacity-40`) + overlay `bg-(--color-bg)/70` + wrapper interno `relative h-full overflow-y-auto`.
- Cards reciben `onHover={setHoverGame}` / `onHoverEnd={() => setHoverGame(null)}`.

### Part 3: Library footer always fixed
- `Library.tsx` — condición del footer eliminada; el div `sticky bottom-0 z-10 shrink-0 border-t ... backdrop-blur-lg` se renderiza **siempre** (también con `pageSize === SHOW_ALL` y con 0 resultados). Root `flex h-full flex-col lf-page-in` (L574) garantiza posición inferior. Cierre `</>` ajustado.

### Part 4: GameLauncherTile hover → ambient global (debounced)
- `GameLauncherTile.tsx` — imports `localPathToUrl` (gameCacheService) + `setAmbientSource`/`clearAmbientSource` (ambientBackgroundStore).
- Constantes módulo: `AMBIENT_LIBRARY_HOVER_SCOPE = "library-grid-hover"`, `AMBIENT_HOVER_DEBOUNCE_MS = 150`, timer único `_libraryHoverTimer`.
- `handleHoverEnter` (envuelve `onMouseEnter` de useHoverPrefetch): debounce 150ms → raw `game.backgroundPath ?? game.landscapePath ?? displayImage ?? game.imageUrl`, skip prefijos relativos, `isLocalPath ? localPathToUrl : raw` → `setAmbientSource("library-grid-hover", url)`.
- `handleHoverLeave`: cancela timer + `clearAmbientSource("library-grid-hover")`.
- `useEffect` unmount: cancela timer + limpia el scope.
- Root div (L473): `onMouseEnter={handleHoverEnter}` / `onMouseLeave={handleHoverLeave}`.
- Ambos scopes (`"console-grid-focus"` y `"library-grid-hover"`) son del slot `_detail` del ambient store → último gana; al salir de hover se restaura el fallback de página (`_context`).

### Key Files Changed
- `src/features/console/ConsoleGameCard.tsx` — onHover/onHoverEnd props
- `src/features/console/ConsoleGridLayout.tsx` — hoverGame, backdrop instantáneo, feed `"console-grid-focus"`, panel derecho con capa backdrop
- `src/pages/Library.tsx` — footer sticky incondicional
- `src/components/games/GameLauncherTile.tsx` — hover → ambient con debounce 150ms + cleanup

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.83s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Ambient z-index fix en Console Mode + corrección de alcance del hover desktop

### Goal
(1) Arreglar que el fondo ambiental global se renderizaba POR ENCIMA de toda la UI de Console Mode ("el dynamic se ve por encima de todo en vez de comportarse como fondo"). (2) Corregir el alcance del hover → ambient: solo en Library (única superficie sin hero); Dashboard y Store ya alimentan el ambient vía sus héroes.

### Part 1: Causa raíz del z-index console (confirmada)
- `AppLayout.tsx` rama console (L44-57): `<AmbientBackground />` (root `absolute inset-0 z-[1]`) se renderizaba como hermano ANTES de `<RouteErrorBoundary>{children}</RouteErrorBoundary>`, y el root de `ConsoleModePage` es `relative` con z-auto.
- En CSS, un elemento con z-index positivo (z-[1]) pinta POR ENCIMA de hermanos positioned z-auto → la capa ambient (arte blur opacity 30-55% + dim + gradiente) cubría toda la UI de console. Desktop no sufría el bug porque su contenido está envuelto en `relative z-10` (L132).
- El backdrop interno del panel derecho de `ConsoleGridLayout.tsx` (L351-357, `absolute inset-0` DOM-first + contenido `relative` DOM-later) estaba internamente correcto — el culpable era la capa global.

### Part 2: Fix
- `src/components/layout/AppLayout.tsx` rama console: `{children}` (providers + RouteErrorBoundary) envuelto en `<div className="relative z-10 h-full w-full">` — espejo del wrapper desktop L132.
- El ambient pasa a fondo real visible a través de las superficies `lf-console-glass`; los overlays internos console (z-[100]/z-[200]/z-[300]) quedan intactos por encima.

### Part 3: Alcance del hover desktop (corrección de alcance)
- Hover → ambient SOLO en Library (`GameLauncherTile.tsx`, ya implementado en la sesión previa: debounce 150ms, scope `"library-grid-hover"`). Library es la única superficie desktop sin hero propio.
- **Dashboard NO necesita hover**: `GameHero` ya alimenta el ambient (`setAmbientSource("dashboard", ...)` en todas sus rutas de resolución). Hover en sus cards (`lf-dash-card`, 6 secciones montadas en Home) sería redundante y ruidoso (parpadeo card→hero).
- **Store NO necesita hover**: `StoreDiscoverHeroCarousel` (hero del Discover) y `StoreGameDetailsPage` (galería de medios vía `onMediaSelect`) ya alimentan el ambient. Las cards `PackageCard`/`lf-virtual-card` no se tocaron.
- No se creó `AmbientHoverSurface` ni slot `_hover` en `ambientBackgroundStore.ts` — se descartaron por innecesarios.

### Key Files Changed
- `src/components/layout/AppLayout.tsx` — rama console: wrapper `relative z-10 h-full w-full` alrededor de children

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.42s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Console Mode: ambient background visible en toda la página (variable --console-bg)

### Goal
Que el fondo ambiental global se muestre en TODA la página de Console Mode desktop (zona de cards del grid, spotlight, details), no solo en el panel de detalles glass. El dynamic ya se veía en el panel; la zona de cards quedaba opaca.

### Part 1: Causa raíz
- Desktop logra transparencia porque `.lf-page { background: var(--page-bg) }` (App.css L209-211) y `:root[data-ambient="on"]` (L399-404) vuelve `--page-bg: transparent`. `--color-bg` NO se reasigna.
- Los roots de los layouts console usan `bg-(--color-bg)` OPACO directo, que tapa la capa ambient (z-[1] por detrás del wrapper z-10). No existen variables `--console-*` previas.

### Part 2: Variable `--console-bg` ambient-aware (App.css)
- `[data-console-theme] { --console-bg: var(--color-bg) }` — por defecto, el bg del tema console (se resuelve al color del mismo elemento donde el tema fija `--color-bg`).
- `:root[data-ambient="on"] [data-console-theme] { --console-bg: transparent }` — bajo ambient, el fondo de página console se vuelve transparente (espejo del contrato `--page-bg`).
- Definida tras el tema neon-noir (L1619+), antes de la sección de texturas.

### Part 3: Aplicación en los roots de layouts console
- `ConsoleGridLayout.tsx` L298 root → `bg-(--console-bg)` (zona de cards, cambio principal).
- `ConsoleSwitchSpotlightLayout.tsx` L186 root → `bg-(--console-bg)`.
- `ConsoleSpotlightLayout.tsx` L125 root → `bg-(--console-bg)`.
- `ConsoleGameDetails.tsx` L950 fallback del hero (sin heroSrc) → `bg-(--console-bg)`.

### Sin cambios (intencional)
- `AppLayout.tsx` rama console L46 `bg-(--color-bg)`: es la base POR DETRÁS de la capa ambient — queda como fallback.
- `ConsoleGridLayout.tsx` L355 overlay `bg-(--color-bg)/70`: dim del backdrop interno del panel derecho para legibilidad.
- `ConsoleSettingsPanelV2.tsx` L1914 `bg-(--color-bg)/95`: panel lateral interactivo — se mantiene opaco.
- Tarjetas (`ConsoleGameCard.tsx` `bg-(--color-surface)/40` + overlays) sin tocar: legibilidad intacta sobre el ambient.

### Key Files Changed
- `src/App.css` — `[data-console-theme]`/`:root[data-ambient=on] [data-console-theme]` + `--console-bg` (default/transparent)
- `src/features/console/ConsoleGridLayout.tsx` — root `bg-(--console-bg)`
- `src/features/console/ConsoleSwitchSpotlightLayout.tsx` — root `bg-(--console-bg)`
- `src/features/console/ConsoleSpotlightLayout.tsx` — root `bg-(--console-bg)`
- `src/features/console/ConsoleGameDetails.tsx` — fallback hero `bg-(--console-bg)`

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.43s, Rolldown; verificado en dist: `[data-console-theme]{--console-bg:var(--color-bg)}`, `:root[data-ambient=on] [data-console-theme]{--console-bg:transparent}`, `background-color:var(--console-bg)`)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session � Library grid hover -> ambient fallthrough fix

### Problem
Library grid cards did not feed the global ambient background on hover (desktop). The console-mode ambient background was already visible; only the Library hover feed was dead.

### Root cause
`GameLauncherTile.tsx` hover handler picked `raw = game.backgroundPath ?? game.landscapePath ?? displayImage ?? game.imageUrl` and early-returned on any relative prefix (`games/`/`media/`/`img/`). For Steam games, `game.backgroundPath`/`game.landscapePath` are the RELATIVE snapshot media paths (e.g. `media/landscape.jpg`) -> truthy -> early return fired before ever reaching the absolute canonical `displayImage` (which `getCardImage` returns from `canonicalInfo.media.*` as absolute resolved paths). Result: no candidate ever fed `setAmbientSource`.

### Fix
- `handleHoverEnter` now iterates a candidate list (`game.backgroundPath`, `game.landscapePath`, `game.coverPath`, `displayImage`, `game.imageUrl`) and FALLS THROUGH relative prefixes instead of returning on the first relative path.
- First usable candidate wins; local absolute paths converted via `localPathToUrl`, remote/provider URLs used raw.
- Added `DEBUG_AMBIENT_HOVER = false` flag + `[AMBIENT][HOVER] appid=... raw=... url=...` diagnostic.

### Key Files Changed
- `src/components/games/GameLauncherTile.tsx` � candidate-fallthrough loop in `handleHoverEnter`, `game.coverPath` added to candidates, debug flag.

### Build
- `tsc --noEmit` ? (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ? (1.38s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ?? skipped (no Rust changes)

## Session � Remove desktop Library hover -> ambient feed (console-only keeps it)

### Problem
The desktop Library/Games grid hover?ambient feed (`library-grid-hover` scope) changed the whole window background on card hover. User decision: that behavior is only acceptable inside Console Mode � on desktop it is distracting.

### Fix
- `src/components/games/GameLauncherTile.tsx` (used by `Library.tsx` and `Games.tsx`):
  - Removed `setAmbientSource`/`clearAmbientSource` import from `ambientBackgroundStore`.
  - Removed `localPathToUrl` from the `gameCacheService` import (was only used by the hover handler; `isLocalPath` kept for `fallbackLocalPath` memo).
  - Removed module constants `AMBIENT_LIBRARY_HOVER_SCOPE`, `AMBIENT_HOVER_DEBOUNCE_MS`, and the shared `_libraryHoverTimer`.
  - Removed `handleHoverEnter`/`handleHoverLeave` and the unmount cleanup effect.
  - Root `<div>` handlers back to `onMouseEnter={onMouseEnter}` / `onMouseLeave={onMouseLeave}` (the `useHoverPrefetch` data prefetch is preserved).

### Unchanged
- Console Mode feed `console-grid-focus` + right-panel backdrop in `ConsoleGridLayout.tsx`.
- `AmbientNavFallback` page-context in `App.tsx` (navigation-level, not hover).
- Dashboard/hero feeds and `--console-bg` ambient behavior.

### Result
- Desktop: ambient background is stable (page-context fallback) � hovering Library/Games cards no longer changes it.
- Console Mode: hover/focus still drives the background.

### Build
- `tsc --noEmit` ? (only pre-existing extension/test errors)
- `vite build` ? (1.41s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ?? skipped (no Rust changes)

## Session � Dashboard hero Steam-style: blurred backdrop + centered sharp image + taller heights

### Goal
Fix the home/dashboard hero looking like a short wide strip in fullscreen by applying the LibraryGameDetails 3-layer hero recipe, and increase hero height on large screens.

### Changes (src/components/dashboard/GameHero.tsx)
- **Height**: section + content div bumped from `min-h-[300px] sm:min-h-[340px]` to `sm:min-h-[380px] lg:min-h-[440px] xl:min-h-[480px]` (content stays anchored bottom via `items-end`).
- **Layer 1 � Blurred backdrop**: `data-hero-bg-layer` div removed; backdrop now static `overflow-hidden brightness-[0.65] saturate-[1.1]` with AsyncImage `h-full w-full scale-105 blur-2xl` (full-bleed color field, same fallback gradient).
- **Layer 2 � Sharp image centered**: plain `<img>` (AsyncImage forces `object-cover`, so a raw img is used) with `h-full w-auto max-w-none shrink-0`, `key={bgUrl}`, `loading="eager"`, `onError` ? `setSharpImgError(true)` (hides only the sharp layer, blurred backdrop stays), and horizontal mask `[mask-image:linear-gradient(to_right,transparent 0%,transparent 4%,black 12%,black 88%,transparent 96%,transparent 100%)]`. `heroBgClass` (Settings ? Animaciones: crossfade/kenburns/focus) now applies here.
- **Layer 3 � Gradients**: bottom readability gradient kept (`from-black/90 via-black/50 to-black/30`); left emphasis softened `from-black/60` ? `from-black/40` so the blur fade shows.
- Same `bgUrl` on both layers ? one download (browser cache). `EmptyHero` untouched.

### Result
Sharp image no longer stretches edge-to-edge; sides show the blurred backdrop (Library-style). Hero reads cinematic instead of a wide strip in fullscreen.

### Build
- `tsc --noEmit` ? (only pre-existing extension/test errors)
- `vite build` ? (1.59s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ?? skipped (no Rust changes)

## Session — Ambient en Library: último game-details-library (opción B)

### Goal
Que el fondo ambiental de la página Library (grid) muestre el arte del último juego abierto en GameDetails en vez de quedarse en el fallback estático (primer juego del snapshot con media).

### Contexto
- El grid de Library no alimentaba el slot `_detail` del ambient store → al navegar a Library el fondo caía a `_context` (fallback de `AmbientNavFallback`: `selectedGame?.imageUrl` global o primer juego del snapshot). Estático, no reaccionaba a Library.
- `LibraryGameDetails` alimentaba `setAmbientSource("library-details", ...)` pero en unmount hacía `clearAmbientSource("library-details")` → al volver al grid el fondo volvía al fallback estático.
- El feed hover→ambient de desktop se eliminó intencionalmente por ruidoso (solo Console lo conserva) — esta sesión NO reintroduce hover.

### Part 1: Memoria del último game-details-library (`ambientBackgroundStore.ts`)
- Añadido `_lastLibraryDetailsUrl: string | null` a nivel de módulo (sesión, como el resto del store). NO se limpia en unmount del detalle.
- Exportados:
  - `rememberLibraryDetails(url: string | null)` — guarda vía `normalizeUrl` (solo valores no vacíos).
  - `getLastLibraryDetailsUrl(): string | null` — lectura para `Library.tsx`.
- No toca el modelo de dos slots (`_detail`/`_context`); es memoria auxiliar.

### Part 2: `LibraryGameDetails.tsx` — recordar al alimentar
- `rememberLibraryDetails` importada; llamada junto a ambos `setAmbientSource("library-details", ...)`:
  - Con `imageUrl` resuelto (alta calidad).
  - Con el path sincrónico de primer paint (cubre manuales sin resolución async).
- La memoria se actualiza en cada resolución (incluye cambio de juego). Los cleanups (L450-456) NO la limpian — intencional.

### Part 3: `Library.tsx` — feed `library-page`
- Nuevo efecto mount (junto a `consumePendingLibraryFocus`):
  ```ts
  useEffect(() => {
    const url = getLastLibraryDetailsUrl();
    if (url) setAmbientSource("library-page", url);
    return () => clearAmbientSource("library-page");
  }, []);
  ```
- Al volver del detalle, el cleanup de `library-details` corre antes de que monte el efecto de `Library.tsx` → último estado visible es `library-page` → el grid conserva el arte.

### Comportamiento
- **Ida y vuelta**: abrir un juego → volver al grid → el fondo sigue mostrando ese juego.
- **Primera visita (sin detalle previo en la sesión)**: memoria vacía → no alimenta → fallback actual (primer juego del snapshot). Sin regresión.
- **Library → Dashboard → Library**: la memoria persiste; al remontar Library re-alimenta `library-page`.
- **Sin hover noise**: valor estable por página, no reintroduce el feed por hover de desktop.

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` — `_lastLibraryDetailsUrl`, `rememberLibraryDetails()`, `getLastLibraryDetailsUrl()`
- `src/components/library/LibraryGameDetails.tsx` — import + `rememberLibraryDetails` en ambos feeds del efecto ambient
- `src/pages/Library.tsx` — import + efecto mount `library-page`

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.86s, Rolldown; solo warnings INEFFECTIVE_DYNAMIC_IMPORT + chunk)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Debrid: refresh/restart pierde path instalado + Download Metadata no hace nada

### Problema
1. Con el path del ejecutable ya guardado en `debrid-games.json`, al refrescar/reiniciar el juego aparecía como "instalar" (sin `isInstalled`, sin `executablePath`) y el diálogo de edición no traía el path — no se leía lo guardado.
2. "Download Metadata"→Steam no hacía nada en juegos Debrid.

### Causa raíz Bug 1 (Download Metadata)
- El guard de `handleDownloadMetadata` (`GameEditDialog.tsx`) hacía early-return silencioso en Debrid porque `appId` llega vacío (los call sites solo pasan `appId` para `steam`/`lua`); `isManualMode`/`isCreateMode`/`isEpicMode` eran false → guard `if (!appId && !isManualMode && !isCreateMode && !isEpicMode) return;` bloqueaba.

### Causa raíz Bug 2 (path perdido)
- La restauración vive en `refreshDebridGames()` (`debridGameStore.ts`), que lee `getDebridLaunchMetadata()` → el mapa `_launchMetadataByProviderGameId`, que SOLO se puebla en `loadDebridGamesFromDisk()` y en `updateDebridGame`.
- Carrera: `refreshDebridGames()` (context, `LibraryGamesContext.tsx`) vs Stage 3.35 del boot (`appBootCoordinator.ts`). Si refresh corre primero → mapa vacío → loop de restauración no hace nada → entradas `isInstalled=false` sin path; el loader corre después pero NUNCA re-mapea `_debridGames` → roto toda la sesión.
- El guardado era correcto (`updateDebridGame` setea mapa + `_userLibraryAppIds` + statuses); el JSON en disco tenía el path. El diálogo pre-rellenaba SOLO desde el prop `game` (entrada rota) sin consultar el store.

### Fixes

#### `debridGameStore.ts`
- `refreshDebridGames()`: `await loadDebridGamesFromDisk()` como primera línea del `try` (idempotente vía `_loadedFromDisk` → ambos órdenes de boot convergen).
- `loadDebridGamesFromDisk()`: `_loadedFromDisk = true` movido a DESPUÉS de un `readDebridGames()` exitoso (fail-open ante fallo transitorio — antes estaba antes del try, congelando el estado vacío toda la sesión).
- `loadDebridGamesFromDisk()`: restaura `_debridAppIdOverrides` desde disco (`if (entry.appId) _debridAppIdOverrides.set(entry.id, String(entry.appId))`) — el `appId` en disco es autoritativo.
- Nueva `updateDebridGameTitle(providerGameId, title)`: persiste el título (decisión: solo nombre + diálogo, sin tocar schema Rust); no-op si vacío/inexistente.

#### `GameEditDialog.tsx`
- Guard `:487` → añadido `&& !isDebridMode`.
- Rama explícita `if (isDebridMode)` en `handleDownloadMetadata` antes del flujo Steam: resuelve por `appIdDraft || game?.appId`; `steam` → `resolveGameMetadata` → `fillDraftsFromMetadata` + `setMetadata` + toast; `igdb`/`rawg` por appId; appId vacío → `showError("No Steam App ID — introduce uno en el campo App ID")`; `appIdDraft` en deps del useCallback.
- Mount Debrid (rama ~`:407`): fallback a `getDebridLaunchMetadata()` + `getDebridGame()` cuando `game` no traiga path/appId/título → el diálogo siempre muestra lo guardado en disco; añadido `setNameDraft(game?.title ?? savedGame?.title ?? "")` (antes el nombre quedaba vacío en Debrid).
- Rama Debrid de `handleSave`: añadido `updateDebridGameTitle(debridProviderGameId, nameDraft)` junto a path/appId.

### Key Files Changed
- `src/services/debridGameStore.ts` — await del loader en refresh, fail-open `_loadedFromDisk`, restore de overrides, `updateDebridGameTitle()`
- `src/components/games/GameEditDialog.tsx` — guard `!isDebridMode`, rama Debrid de metadata, fallback del mount al store, persistencia de título en save

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.82s, Rolldown; solo warnings INEFFECTIVE_DYNAMIC_IMPORT)
- `cargo check` ⏭️ skipped (no Rust changes — decisión del usuario: no extender schema Rust)

## Session — Importación de feeds de repack (URL/raw pegado) con parser Rust tolerante

### Objetivo
Permitir importar feeds de repack (URL o raw pegado) leyendo los JSON scrapeados (`fitgirl.json`/`steamrip.json`) preservando sus links de descarga en `download_uris_json` para que el instalador Debrid los use. Plan de 4 partes aprobado.

### Datos verificados
- `steamrip.json`: raíz `{name:"SteamRip", downloads[]}` (~1,239 items), items `{title, uploadDate, fileSize:"33 GB" string, uris[]}` HTTP tipo `https://gofile.io/d/...`.
- `fitgirl.json`: raíz `{name:"FitGirl", downloads[]}` (8,548 items), uris `magnet:?xt=urn:btih:...` → `installer_type = "torrent"`.
- Ambos sin `appId` ni `repacker` → `repacker` inferido del `name` de la raíz (lowercase); `app_id = 0` (resolución por título queda FUERA de fase 1, es fase 2 con `matchIndexer.ts`).
- 3 formatos detectados por clave raíz: `games` (Hydra), `records` (artefacto oficial), `downloads` (scrapeado).

### Part 1 — Parser Rust tolerante (`hydra_source.rs`)
- `RepackRowData` struct: title, app_id, repacker, repack_group, installer_type, file_size/install_size `Option<i64>`, languages, selective_features, uris, checksum, updated_at, tags.
- Helpers: `parse_human_size(s)` (TB/GB/MB/KB/B → bytes), `infer_installer_type(uris)` (magnet→"torrent", else "zip"), `parse_repack_feed_value(value, fallback_name)` con despacho a `parse_hydra_feed` / `parse_artifact_feed` / `parse_scraped_feed`.
- `parse_artifact_feed` usa `RepackCatalogArtifact`; `parse_scraped_feed` infiere repacker del `name` raíz, `parse_human_size` en `fileSize`, `uploadDate`→`updated_at`.
- `insert_repack_rows(db, rows, source_url, source_name) -> (u32, u32)` — UPSERT de 18 columnas, devuelve `(imported, updated)`; `id` canónico `"{normalized_title}-{repacker}"`.
- `fetch_and_import_hydra_source`, `validate_hydra_source_url` e `import_hydra_source_entries` (path refresh) refactorizados para usar el parser compartido.
- **Nuevo comando `import_repack_feed(app_handle, contents, source_name?, source_url?)`** — parsea raw pegado y lo inserta (fallback name `"pasted-feed"`, sin cache de raw).

### Part 2 — Registro en `lib.rs` (L288, entre `clear_hydra_cache` y `webview_fetch_callback`).

### Part 3 — TS (`hydraSourceService.ts`)
- `tauriImportRepackFeed(contents, sourceName?, sourceUrl?)` — invoke directo a `"import_repack_feed"` con args camelCase `{contents, sourceName, sourceUrl}` (patrón del archivo, sin binding en `tauri.ts`).
- Público `importRepackFeed(contents, options?) → HydraImportResult`.

### Part 4 — UI (`DebridProvidersCard.tsx`)
- Bloque "Importar feed repack": textarea (font-mono, placeholder con ejemplo de steamrip), botón "Importar" (estado `importingFeed`, icono `Download`/`Loader2`), texto explicativo de que los links se conservan.
- Post-import: `showSuccess("Feed importado: N nuevos, M actualizados")` + `await refreshDebridGames()` para refrescar la librería.

### Key Files Changed
- `src-tauri/src/commands/hydra_source.rs` — parser tolerante, `insert_repack_rows`, comando `import_repack_feed`, refactor de los 3 paths de import
- `src-tauri/src/lib.rs` — comando registrado
- `src/services/hydraSourceService.ts` — `importRepackFeed` + `tauriImportRepackFeed`
- `src/components/settings/DebridProvidersCard.tsx` — UI de importación de feed + `refreshDebridGames` post-import

### Build
- `cargo check` ✅ (0 errores; 2 warnings preexistentes dead-code)
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en archivos tocados)
- `vite build` ✅ (1.73s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)

## Session — Gofile resolver: `.my` v1 → `.io` API + guest token + website-token (fix descarga 302→HTML)

### Objetivo
Reemplazar la resolución gofile rota (`.my/v1/content` muerta) por el flujo oficial `.io` verificado end-to-end: cuenta guest → `X-Website-Token` → `contents/{id}` → link CDN que requiere Bearer.

### Verificación en vivo (previo a la implementación)
- `api.gofile.my` NO sirve la API (404 HTML). La base correcta es `https://api.gofile.io`.
- `POST https://api.gofile.io/accounts` `{"email":null,"pass":null}` → `data.token` (guest, sin email).
- `wt = sha256("{ua}::en-US::{token}::{floor(unix/14400)}::{salt}")`; salt vigente `9844d94d963d30` (byte-exacto vs `wt.obf.js`); `5d4f7g8sd45fsd` (gallery-dl) NO coincide.
- El token `"0"` no sirve → 401 `error-token`; hace falta cuenta guest real.
- `GET /contents/{id}` con `User-Agent` + `Authorization: Bearer` + `X-Website-Token` + `X-BL: en-US` → 200; `data.children` es MAPA de objetos (legacy `data.childs` era array).
- El link CDN requiere `Authorization: Bearer` en la descarga: sin token → 302 → HTML (login page); con token → 206 `application/vnd.rar`.

### Part 1 — Constantes + imports
- `use sha2::{Digest, Sha256}` y `std::time::{Instant, SystemTime, UNIX_EPOCH}` (sha2 0.10 ya en Cargo.toml).
- `GOFILE_UA` (Chrome 124, extraída del string inline), `GOFILE_SALTS = ["9844d94d963d30", "5d4f7g8sd45fsd"]` (vigente + fallback rotación), `GOFILE_WINDOW_SECS = 14_400`.

### Part 2 — Helpers nuevos
- `gofile_website_token(token, salt, ua)` — sha256 hex del formato verificado.
- `gofile_create_guest_token(client)` — POST `/accounts` json `{"email":null,"pass":null}`, parsea `data.token`, log tier.
- `gofile_bearer_token(client)` — env `GOFILE_TOKEN` override primero; si no, cache de guest token en `OnceLock<Mutex<Option<(String, Instant)>>>` con TTL 4h; refresca al caducar.
- `gofile_get_contents(client, token, salt, content_id)` — GET `.io/contents/{id}` con los 4 headers, errores hint 401/403/404/429.
- `GofileResolved { url, bearer: Option<String> }`.

### Part 3 — `resolve_gofile_url` → `Result<GofileResolved, String>`
- Page URL `/d/{id}`: itera `GOFILE_SALTS`; en el 401 del primer salt refresca el guest token una vez y reintenta; parsea `data.children` (mapa) con fallback a `data.childs` (array) → primer child `.link`.
- Direct URL: devuelve la URL igual PERO con bearer (el CDN lo exige).
- `[DEBRID][GOFILE]` logs de resolución.

### Part 4 — `download_file_to_dest` + bearer
- Nuevo parámetro `bearer: Option<&str>`; añade `Authorization: Bearer <token>` al GET solo cuando Some y no vacío.
- Call site en `download_debrid_package`: `let (effective_uri, gofile_bearer)` desde `resolve_gofile_url`; pasa `gofile_bearer.as_deref()`.
- El guard de Content-Type `text/html` se mantiene (con auth correcta el CDN responde `application/vnd.rar`).

### Alcance
- Solo primer archivo (multi-parte fuera de scope, decisión del usuario).
- Solo Rust; sin cambios TS/UI.

### Part 5 — Tests de regresión del WT
- `gofile_website_token` refactorizada: núcleo puro `gofile_website_token_for_window(token, salt, ua, window)` (window inyectada, testable) + wrapper que computa `now / GOFILE_WINDOW_SECS`.
- Vector conocido independiente: hash sha256 calculado con PowerShell (implementación independiente) para `window=12345, token="testtoken", salt="9844d94d963d30"` → `26c3eb17...a757aaa`.
- 6 tests en `#[cfg(test)] mod tests`: vector conocido, formato (64 hex lowercase), determinismo, sensibilidad a salt, sensibilidad a window, comportamiento de rotación de salts.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — toda la resolución gofile reescrita + threading del bearer a `download_file_to_dest` + núcleo puro del WT + 6 tests de regresión

### Build
- `cargo check` ✅ (0 errores; 2 warnings preexistentes dead-code)
- `cargo test` ✅ (141 passed / 0 failed — 135 preexistentes + 6 nuevos)
- `tsc --noEmit` ⏭️ (sin cambios TS)
- `vite build` ⏭️ (sin cambios TS)

## Session — RAR5 signature detection fix (download RAR5 ya funcionaba; solo el detector fallaba)

### Problema
Descarga gofile correcta (bearer ya funcional) de un repack con archivo **RAR5** (`The-Operator-SteamRIP.com.rar`). Error al final del download: `Unknown file type (magic bytes: 52 61 72 21 1A 07 01 00). Expected RAR, ZIP, or Windows executable.`

### Causa raíz
`detect_file_type` (`debrid_installer.rs:56`) solo comparaba la firma **RAR4** (`Rar!\x1A\x07\x00` — byte[6]=0x00). El archivo descargado era **RAR5** (`Rar!\x1A\x07\x01\x00` — byte[6]=0x01) → caía al brazo `Unknown` → error. El download en sí fue un éxito (los magic bytes del archivo en disco son RAR válido); el fix del bearer de la sesión previa funciona.

### Fix
- Check RAR ampliado: primeros 6 bytes `52 61 72 21 1A 07` + byte[6] ∈ `{0x00, 0x01}` (cubre RAR4 y RAR5). Doc del enum actualizado.
- Extracción ya soporta RAR5 en los 3 fallbacks (verificado, sin cambios): `extract_rar_with_cli` (unrar.exe/7z.exe/unar modernos), `extract_rar_with_unrar` (unrar crate 0.5.8 → unrar_sys 0.5.8 bundlea UnRAR 6.x), `extract_rar_via_7z` (7-Zip 15.06+).
- Retry tras el fix: `download_file_to_dest` short-circuita con archivo existente (L1222) → salta re-descarga y va directo a detección → extracción.

### Tests (3 nuevos en `mod tests`)
- `detect_rar5_signature` — fichero 16B con firma RAR5 → `DetectedFileType::Rar` (regresión del bug).
- `detect_rar4_signature` — firma RAR4 → `Rar` (evita regresión en sentido contrario).
- `detect_unknown_signature` — magic no relacionado → `Unknown(_)`.
- Ojo: fixtures deben tener ≥16 bytes (el detector hace `read_exact` de 16); con 8 bytes daba `cannot_read` y fallaba el test (no el código).

### Build
- `cargo test` ✅ (144 passed / 0 failed — 141 previos + 3 nuevos)
- `cargo check` ✅ (solo 2 warnings preexistentes dead-code)
- `tsc --noEmit` ⏭️ (sin cambios TS)
- `vite build` ⏭️ (sin cambios TS)

## Session — Store repacks: dynamic repacker filters + browse-all default + card images

### Goal
Fix the Store → Debrid Catalog repacker filter chips (they were a hardcoded list with no real data), make the default view a paginated browse-all (24/page, "Load more"), and show Steam CDN card images with the existing gradient header as fallback.

### Rust (src-tauri/src/commands/repack_catalog.rs)
- RepackGroupStat { repacker, count } struct (serde camelCase).
- query_by_repacker now case-insensitive: WHERE lower(repacker) = lower(?1) (chips previously returned 0 rows because stored repacker is lowercase, e.g. itgirl vs chip FitGirl).
- query_repacker_groups(conn) — SELECT repacker, COUNT(*) ... GROUP BY lower(repacker) ORDER BY count DESC, lower(repacker) ASC, excluding empty repacker.
- query_page(conn, limit, offset) — browse-all ORDER BY CASE WHEN app_id > 0 THEN 0 ELSE 1 END, updated_at DESC LIMIT ?1 OFFSET ?2 (games with Steam appIds first, then recent).
- New Tauri commands query_repack_catalog_page(limit, offset) + query_repack_repackers(), registered in src-tauri/src/lib.rs after query_repack_catalog_by_repacker.

### TS bindings (src/services/tauri.ts)
- RepackGroupStat type; queryRepackCatalogPage(limit, offset) → query_repack_catalog_page; queryRepackRepackers() → query_repack_repackers.

### Frontend (src/components/store/DebridCatalogSection.tsx)
- **Dynamic chips**: on mount loads queryRepackRepackers(); chips show display-capitalized repacker name + count badge (epackerLabel). Falls back to the hardcoded REPACKERS list only on query failure/empty DB.
- **Browse-all default**: loadGames(null, "", page) now calls queryRepackCatalogPage(GAMES_PER_PAGE, page * GAMES_PER_PAGE) (was setGames([]) dead branch). Page-0 effect on mount + on ctiveRepacker/searchQuery change; appends on "Load More"; hasMore = results.length === GAMES_PER_PAGE.
- handleRepackerClick toggles case-insensitively (clicking the active chip clears the filter → browse-all).
- Card images: heroUrl = buildSteamCdnUrl(String(game.appId), "capsule") for ppId > 0; top spect-video + object-cover <img> with onError → imgFailed state → existing gradient header fallback (Package icon + repacker chip). Repacker chip overlaid on the image (g-black/60 backdrop-blur-sm). No MediaIndex/snapshot writes (keyless Steam CDN derivation).
- Empty-state copy updated; header subtitle → "browse all or filter by repacker".

### Build
- cargo check ✅ (0 errors; 2 pre-existing dead-code warnings)
- 	sc --noEmit ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- ite build ✅ (1.71s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

## Session — Debrid download resume/checkpointing (Phase A) + combined repacker+search filter

### Goal
Resumable Debrid downloads: keep a `.part` file + checkpoint meta on cancel/error so retries resume via HTTP Range instead of restarting. Also complete the combined repacker+search composition for the Debrid Catalog (Phase B/C deferred).

### Part 1: Combined repacker + search filter
- Rust `query_by_repacker_fuzzy_title(conn, repacker, query, limit)` in `repack_catalog.rs` — `WHERE lower(repacker) = lower(?1) AND normalized_title LIKE '%' || ?2 || '%'`, ordered by has-appId then title length.
- Command `query_repack_catalog_by_repacker_fuzzy(repacker, query, limit, db)` registered in `lib.rs`; TS binding `queryRepackCatalogByRepackerFuzzy`.
- `DebridCatalogSection.tsx` — combined branch calls the new query with `setHasMore(false)`; effect always calls `loadGames(activeRepacker, searchQuery, 0)`; `handleRepackerClick` no longer clears search; `handleSearch` no longer clears repacker (symmetric, confirmed UX).

### Part 2: Download resume/checkpointing (Phase A)
- New types/helpers in `debrid_installer.rs`:
  - `DownloadCheckpoint { uri, total_bytes, downloaded_bytes, started_at }` (serde) + `ResumeDecision` enum (`ResumeFrom(u64) | FreshStart | AlreadyComplete`).
  - `part_path()` / `meta_path()` → `tmp/<file>.part` + `.part.meta`.
  - `load_checkpoint()` — returns on-disk part size only when meta parses, `cp.uri == uri`, and part is non-empty; cleans stale/corrupt/mismatched part+meta.
  - `write_checkpoint()` — atomic via `.meta.tmp` + rename; called on cancel and stream/write errors, not per-chunk.
  - `decide_resume()` — 206 → ResumeFrom (Content-Length = remaining bytes; `Some(0)` → AlreadyComplete); 416 → FreshStart; anything else (incl. 200) → FreshStart; `resume_from == 0` → FreshStart.
- `download_file_to_dest` rewritten:
  - Bounded request loop (async recursion not allowed → loop instead of recursion): Range header on resume; 416 with offset > 0 → delete partial+meta, retry once from 0; non-2xx → error; Content-Type text/html rejected as before.
  - `AlreadyComplete` → rename part → dest, remove meta+tmp dir.
  - Totals: `total_bytes = resume_from + server_total` on 206; `remaining` passed to `check_disk_space` (skips at 0).
  - File opened append-mode when resuming, else `File::create`; `bytes_read` seeded to `resume_from`.
  - Cancel/stream/write errors keep partial + checkpoint (resumable later).
  - Completion: flush → drop (Windows) → rename part → dest → remove meta + empty tmp dir.
- GoFile bearer threaded through the resume request.

### Tests
- 12 new unit tests: `decide_resume` matrix (no-resume fresh, 206 append, 206 no-length append, 206 zero-remaining complete, 200 restart, 416 restart) + `load_checkpoint` (resume from part size, URI mismatch cleanup, corrupt meta cleanup, meta-without-part, empty part, write→load roundtrip).
- Full suite: 160 passed / 0 failed.

### Build
- cargo check (0 errors; 2 pre-existing dead-code warnings)
- cargo test (160 passed / 0 failed; 21 in debrid_installer)
- tsc --noEmit (only the 23 pre-existing extension/test errors, none in touched files)
- vite build (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

## Session — Debrid Phase C: magnet/torrent resolution via debrid providers

### Goal
Wire magnet/torrent repack downloads through `resolveDebridUri()` — when a download URI starts with `magnet:`, resolve it to a direct URL via a configured debrid provider (TorBox / Real-Debrid / AllDebrid / Premiumize) before starting the install download.

### Part 1: TorBox magnet + direct-HTTP flows (`debrid_resolver.rs`)
- `resolve_via_torbox_magnet()` — addMagnet (multipart) → poll `mylist` until ready states (`cached`/`download_finished`/`uploading`/`completed`; errors `error`/`metaDL_error`) → pick largest non-sample file via `torbox_largest_file` → `torrents/requestdl` with `?token=&torrent_id=&file_id=` (or without `file_id` when only the root file exists).
- `resolve_via_torbox_webdl()` — direct-HTTP flow: `webdl/createwebdownload` → `webdl/requestdl?token=&download_id=` → reads `data.url` / `data` / `data.permalink` and `data.filename`/`data.size`.
- Poll constants: `TORBOX_POLL_MAX_ATTEMPTS: u64 = 40`, `TORBOX_POLL_INTERVAL_SECS: u64 = 3`.

### Part 2: Real-Debrid magnet + HTTP flows (`debrid_resolver.rs`)
- `resolve_via_real_debrid()` now dispatches: `magnet:` → `resolve_via_real_debrid_magnet()`; HTTP direct → `POST /unrestrict/link` directly (previous flow preserved).
- `resolve_via_real_debrid_magnet()` — addMagnet → error code 22 (`magnet_infohash` + active-torrent list to reuse an existing id) → selectFiles `files="all"` → poll `torrents/info/{id}` until `progress >= 100.0` / `downloadFinished` / status `2|6|7` → `GET /torrents/links/{id}` → first link → `POST /unrestrict/link`.
- Poll constants: `REAL_DEBRID_POLL_MAX_ATTEMPTS: u64 = 40`, `REAL_DEBRID_POLL_INTERVAL_SECS: u64 = 3`.

### Part 3: Helpers + unit tests (`debrid_resolver.rs`)
- `magnet_infohash(uri)` — extracts 40-hex lowercase infohash from `xt=urn:btih:...`; accepts dash-separated hashes (strips `-`); rejects missing/short/non-hex.
- `json_u64()` — reads numeric fields that arrive as number OR string.
- `torbox_largest_file()` — largest non-sample file, excludes `.txt`/`.nfo`/`.diz`.
- `torbox_error_message()` — prefers `detail`, then `message`, falls back to status string.
- 8 unit tests (`#[cfg(test)] mod tests`): infohash extraction, dash-separated hash, missing/short rejection, non-hex rejection, json_u64 number/string, largest-file filtering, empty/metadata-only → None, error message precedence.
- Fixed `TORBOX_API_BASE` → `https://api.torbox.app/v1/api`; reqwest feature `multipart` added.

### Part 4: Frontend wiring (`useDebridInstallSync.ts`)
- `resolveInstallUri(downloadUri)` helper — non-magnet URIs pass through; `magnet:` URIs load settings via dynamic `import("../context/SettingsContext")` → `loadSettings()`, build `DebridProviderConfig` from `settings.debridProviders`, call `resolveDebridUri()`, return `result.resolvedUrl` when successful (gated `[DEBRID_INSTALL] magnet resolved provider=...` log), else warn and fall back to the raw magnet.
- `startInstall` now calls `resolveInstallUri(downloadUri)` before `downloadDebridPackage` → magnet downloads resolve through the configured provider chain (TorBox → Real-Debrid → AllDebrid → Premiumize, preferred-provider aware).

### Build
- cargo check ✅ (0 errors; 2 pre-existing dead-code warnings)
- cargo test ✅ 168 passed / 0 failed (8 new in debrid_resolver; 21 in debrid_installer)
- tsc --noEmit ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- vite build ✅ (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

## Session — Debrid integrated torrent client (librqbit) + 3-way install method choice

### Goal
Add a built-in torrent path for Debrid repack installs: when the source is a magnet (FitGirl/DODI), let the user pick "direct download" | "resolve via Debrid provider" | "download with the integrated torrent client" (librqbit). Rust command returns the same `DebridDownloadResult` so the TS pipeline contract is unchanged.

### Rust
- **`Cargo.toml`**: `librqbit = "8"` (vendored native client — no external binary) + `dashmap = "6"` (declared explicitly; was already transitive).
- **`src-tauri/src/commands/torrent.rs`** (**new**; `pub mod torrent` in commands/mod.rs; registered in lib.rs):
  - `start_torrent_download(job_id, magnet, dest_dir)` Tauri command returning `DebridDownloadResult`.
  - `Session::new_with_opts(PathBuf, SessionOptions)` — `disable_dht: false` (real swarm), `disable_dht_persistence: true`, `defer_writes_up_to: None`, fastresume + persistence on.
  - `AddTorrent::from_url(magnet)` (Cow<String>) → `add_torrent` → `AddTorrentResponse::into_handle()` → `ManagedTorrent`.
  - Poll `handle.stats()` every 1s (max ~10 min) emitting `emit_installer_progress` (status `"downloading"`, %, bytes). `TorrentStatsState` has no `PartialEq` → `matches!()` comparison. On `Error` state read `stats.error`.
  - Cancellation reuses the SAME `OnceLock<Mutex<HashSet<String>>>` as `cancel_debrid_download`/`is_job_cancelled` in `debrid_installer.rs` — existing cancel command works for torrents, no new binding.
  - Completion → `session.delete(id, false)` (drop torrent, keep files) → post-process via `debrid_installer.rs` helpers (all made `pub(crate)`): `auto_run_installer`, `extract_rar_with_unrar`, `extract_rar_with_cli`, `flatten_single_root_folder`, `extract_rar_via_7z`, `extract_zip_with_zip_crate`, `find_largest_exe`.
- **`debrid_installer.rs`**: 11 helpers + `cancelled_jobs()` accessor made `pub(crate)`. No behavior changes.
- `cargo check` ✅ (only 2 pre-existing dead-code warnings).

### TS
- **`src/services/tauri.ts`**: `startTorrentDownload({ jobId, magnet, destDir })` → invoke `"start_torrent_download"` → `Promise<DebridDownloadResult>`.
- **`src/services/debridInstallChoice.ts`**: `DebridInstallMethod = "direct" | "debrid" | "torrent"`; `DebridInstallResolution = { ok: true; uri; method } | { ok: false; reason }`.
  - `resolveDebridInstallUri(uris, confirm, title)`: direct+magnet both present → 3-way dialog; magnet-only → debrid (unchanged auto path); direct-only → "direct"; none → `{ ok:false, reason:"no-uri" }`.
  - Dialog labels: primary "Descarga directa" (`"direct"`), secondary "Resolver con Debrid" (`"debrid"`), tertiary "Descargar vía torrent" (`"torrent"`).
- **`src/services/confirmService.tsx`**: `ConfirmOptions` + `ConfirmResult` gain `tertiaryLabel`/`tertiaryVariant`/`tertiary?`; `handleTertiary`.
- **`src/components/common/ConfirmModal.tsx`**: `tertiaryLabel`/`onTertiary`/`tertiaryVariant` props; tertiary button in the `.mr-auto` action group.
- **`src/types/download.ts`**: `installMethod?: DebridInstallMethod` on `DownloadJob` (after `repacker`).
- **`src/context/DownloadQueueContext.tsx`**: `addDebridInstallJob(providerGameId, title, downloadUri, installerType, appId?, artworkUrl?, repacker?, installMethod?)`; job carries `installMethod`; `startInstall(..., installMethod?)` forwards it.
- **`src/hooks/useDebridInstallSync.ts`**: `startInstall` — `installMethod === "torrent"` → `startTorrentDownload({ jobId, magnet: downloadUri, destDir })` (skips `resolveInstallUri`); else → `resolveInstallUri` + `downloadDebridPackage` (previous behavior).
- **Call sites (8)** pass `resolved.method`: `DebridCatalogSection.tsx`, `LibraryGameDetailPage.tsx` (×3 incl. `DebridSourceSelectorModal`), `Library.tsx` (×3 incl. modal), `StoreGameDetailsPage.tsx`. Console Mode (`consoleGameActions.ts`) uses `pickInstallUriWithoutDialog` + own `addJob` — out of scope, unchanged.

### Decisions
- `DEBRID_TORRENT_ENABLED` kill-switch documented; torrent is a dialog *option*, not the default — debrid providers stay primary when configured.
- `start_torrent_download` is a long-running Tauri command (poll loop on its own thread) — returns only after completion + post-process, same contract as `download_debrid_package`.
- **Reachability note**: torrent only appears when an entry has BOTH a direct URI and a magnet URI. Magnet-only repacks (the typical FitGirl/DODI case) still auto-resolve via the configured debrid provider without a dialog — a future follow-up can offer torrent as fallback when debrid resolution fails or no provider is configured.

### Key Files Changed
- `src-tauri/Cargo.toml` — `librqbit = "8"` + `dashmap = "6"`
- `src-tauri/src/commands/torrent.rs` — **new** — `start_torrent_download` (session init, add_torrent, poll+progress, cancel, post-process)
- `src-tauri/src/commands/mod.rs` + `src-tauri/src/lib.rs` — module + command registration
- `src-tauri/src/commands/debrid_installer.rs` — helpers `pub(crate)` + `cancelled_jobs()`
- `src/services/tauri.ts` — `startTorrentDownload` binding
- `src/services/debridInstallChoice.ts` — `DebridInstallMethod`, `method` on resolution, 3-way `resolveDebridInstallUri`
- `src/services/confirmService.tsx` + `src/components/common/ConfirmModal.tsx` — tertiary button support
- `src/types/download.ts` + `src/context/DownloadQueueContext.tsx` — `installMethod` on job, threaded through `addDebridInstallJob`/`startInstall`
- `src/hooks/useDebridInstallSync.ts` — torrent branch in `startInstall`
- `src/components/store/DebridCatalogSection.tsx`, `src/pages/LibraryGameDetailPage.tsx`, `src/pages/Library.tsx`, `src/components/store/StoreGameDetailsPage.tsx` — 8 call sites pass `resolved.method`

### Build
- `cargo check` ✅ (0 errors; 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.53s, Rolldown; verified in bundle: `start_torrent_download` invoke string, "Descargar vía torrent" tertiary label, `installMethod` field)

## Session — Debrid: magnet-only dialog + automatic torrent fallback + metadata stall-detector

### Goal
Close the reachability gaps in the Debrid install flow: (1) magnet-only repacks (the typical FitGirl/DODI case) now show the method dialog instead of silently using debrid, (2) if Debrid resolution fails the install falls back to the built-in torrent client so the download always proceeds, and (3) the torrent connect phase stops after ~3 min without peers instead of hanging forever.

### Part 1: Magnet-only dialog (`debridInstallChoice.ts`)
- `resolveDebridInstallUri` restructured: `direct && magnet` → 3-way dialog (unchanged); `magnet` only → new 2-way dialog ("Resolver con Debrid" primary / "Descargar vía torrent" tertiary / Cancelar); `direct` only → no dialog.
- Mapping: `tertiary` → `"torrent"`, `confirmed`/`secondary` → `"debrid"`, else cancelled. Direct-only remains `"direct"` without a dialog.
- Header doc comment updated ("only one kind present → no dialog" no longer applies to magnet-only).
- `pickInstallUriWithoutDialog` unchanged — Console Mode still bypasses the dialog.

### Part 2: Automatic torrent fallback (`useDebridInstallSync.ts`)
- `startInstall` else-branch: `resolveInstallUri(downloadUri)` wrapped in try/catch. On resolution failure for a `magnet:` URI → logs `[DEBRID_INSTALL] debrid-resolve-failed reason=<msg> → torrent fallback jobId=<id>` and calls `startTorrentDownload({ jobId, magnet: downloadUri, destDir })`. Non-magnet URIs rethrow (can't meaningfully fail).
- Result handling extracted into a shared `handleInstallResult(result, providerGameId, jobId, title)` helper so the fallback path and the debrid/torrent path converge on the same `ready`/`installing`/`needs-setup`/failed handling.
- `result` typed `DebridDownloadResult | null` (guard `if (result)`) to satisfy TS definite-assignment across the try/catch rethrow.
- `resolveInstallUri` doc comment updated — the "raw magnet can never be downloaded" note is superseded by the torrent fallback.

### Part 3: Metadata stall-detector (`torrent.rs`)
- New `TORRENT_METADATA_STALL_SECS: u64 = 3 * 60` + pure helper `metadata_stall_exceeded(first_seen, threshold)`.
- In `poll_torrent_until_done`, `metadata_stalled: Option<Instant>` is set on the first `Initializing` observation; when elapsed exceeds the threshold → `Err("Could not connect to torrent swarm (no peers/seeds).")`.
- The stall guard resets to `None` as soon as the state leaves `Initializing` (bytes flowing) — a large in-progress download is never cut; `TORRENT_MAX_WAIT_SECS = 6h` still caps the full download.

### Key Files Changed
- `src/services/debridInstallChoice.ts` — magnet-only dialog branch, doc update
- `src/hooks/useDebridInstallSync.ts` — torrent fallback in `startInstall`, extracted `handleInstallResult`, `DebridDownloadResult | null` guard
- `src-tauri/src/commands/torrent.rs` — `TORRENT_METADATA_STALL_SECS`, `metadata_stall_exceeded`, stall tracking in poll loop

### Build
- `cargo test` ✅ (174 passed / 0 failed; 3 new torrent stall tests)
- `cargo check` ✅ (0 errors; 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings + chunk-size warning)

## Session — Debrid Pause/Resume (Cancel/Pause/Resume for HTTP + torrent installs)

### Goal
Add Cancel/Pause/Resume for Debrid repack installs (HTTP/SteamRip/gofile and torrent via librqbit) with persistence that survives app restart / PC shutdown. Paused downloads resume manually (never auto-restart); a resumed torrent deletes stale partial data from other torrents recorded this session (TS job queue is the single source of truth).

### Decisions (user-confirmed)
- After app restart with active debrid downloads → they show **"Paused" with manual resume**; nothing downloads automatically.
- Resuming a torrent **deletes orphaned partial data** of other torrents remembered this session.
- **Pause/Resume only for `debrid-install` jobs**; Steam installs and others stay cancel-only.
- Pause → the in-flight command returns `DebridDownloadResult { success:false, status:"paused" }` (HTTP) or `Ok(PollOutcome::Paused)` (torrent); resume → re-invokes the same entry point (`download_debrid_package` / `start_torrent_download`). HTTP resumes via `.part`/`.part.meta`; torrent via fastresume + Json persistence.
- **Root-cause bug**: `cancelled_jobs()` was never cleared → `is_job_cancelled` stayed `true` forever and a re-invocation aborted on the first chunk. Fix: `clear_job_flags(job_id)` at the start of `download_debrid_package` and `start_torrent_download` (clears both cancel **and** pause).
- `job_id = debrid-install-${providerGameId}`; `DownloadStatus` already included `"paused"` and `activeStatuses` includes it, so dedup doesn't block resume.

### Part 1 (Rust HTTP) — `debrid_installer.rs`
- `DownloadFileOutcome { File(DownloadedFile), Paused }`; pause tracker `paused_jobs()` + `is_job_paused(job_id)` + `#[tauri::command] pause_debrid_download(job_id)` + `clear_job_flags(job_id)`.
- `download_debrid_package` calls `clear_job_flags(&job_id)`; dispatches `Paused` → emits `emit_installer_progress(..., "paused", 0,0,0, "Download paused")` and returns `Ok(DebridDownloadResult { success:false, status:"paused", message:"Download paused." })`.
- `download_file_to_dest` returns `Result<DownloadFileOutcome, String>`; checks `is_job_paused(job_id)` in the loop (next to cancel) → `drop(file)` + `write_checkpoint` + `Ok(Paused)`.

### Part 2 (Rust torrent) — `torrent.rs`
- New imports: `use std::collections::HashSet;`, `use tokio::time::{sleep, Duration}`, `use crate::utils::progress_utils::emit_installer_progress`, `use tauri::{AppHandle, Manager}`.
- `get_session(&app_handle)` → `Session::new_with_opts(base_dir, opts)` with `base_dir = app_data_dir()/librqbit`, `fastresume: true`, `persistence: Some(SessionPersistenceConfig::Json { folder: Some(base_dir.clone()) })` (removed `disable_dht_persistence`/`persistence: None`).
- `cleanup_orphan_torrents(session, current)`: collects `HashSet` of ids from `active_torrents()`, uses `session.with_torrents(|it| -> Vec<TorrentId>)` and deletes via `session.delete(TorrentIdOrHash::Id(id), true)`.
- `start_torrent_download`: `clear_job_flags(&job_id)`; `get_session(&app_handle)`; `session.unpause(&torrent)` if `stats.state == Paused`; `cleanup_orphan_torrents`; match `poll_result` → `Ok(Done) => process_torrent_files`, `Ok(Paused) => session.pause(&torrent)` + result `status:"paused"` (torrent stays in `active_torrents()`), `Err(e) => session.delete(..., true)` + remove from `active_torrents()`.
- `PollOutcome { Done, Paused }`; `poll_torrent_until_done` returns `Result<PollOutcome, String>` and adds `if is_job_paused(job_id) { return Ok(PollOutcome::Paused); }`.

### Part 3 (TS)
- `src/services/tauri.ts` — `pauseDebridDownload(jobId)` → `invoke("pause_debrid_download", { jobId })`; `DebridDownloadResult.status` union extended with `"paused"`.
- `src/hooks/useDebridInstallSync.ts` — early branch in `handleInstallResult`: `if (!result.success && result.status === "paused")` → `updateJobRef(jobId, { status:"paused", message })` and return (Debrid store untouched).
- `src/context/DownloadQueueContext.tsx` — `loadJobs()` converts active `debrid-install` jobs after reload → `status:"paused", error:undefined, message:"Download paused"` (Steam installs stay `"failed"`); `pauseJob(jobId)` (sets `"paused"`, invokes Rust, reverts on failure); `resumeJob(jobId)` (derives `providerGameId` from `debrid-install-`, sets `"queued"`, re-calls `debridInstallRef.current.startInstall(jobId, providerGameId, job.downloadUrl, "zip", job.gameTitle, job.installMethod)`); exposed in types + provider value.

### Part 4 (UI)
- `src/components/downloads/DownloadJobCard.tsx` — destructured `onPause`/`onResume`; `canPause`/`canResume` (only `debrid-install`; pause when active, resume when `"paused"`); Pause/Play buttons in the action row before Cancelar.
- `src/pages/Downloads.tsx` — `pauseJob`/`resumeJob` destructured; `onPause`/`onResume` passed to both card render sites. `paused` already in the active section filter.

### Tests (4 new in debrid_installer)
- `pause_flag_tracked_and_checked` — pause sets paused flag, paused ≠ cancelled.
- `clear_job_flags_removes_both_cancel_and_pause` — fresh attempt clears both so re-invocation proceeds.
- `clear_job_flags_only_affects_target_job` — other jobs' flags untouched.
- `clear_job_flags_idempotent` — clearing empty state is safe.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — `DownloadFileOutcome`, pause tracker + `clear_job_flags`, `pause_debrid_download` command, dispatch `Paused`, pause check in download loop
- `src-tauri/src/commands/torrent.rs` — persistent session (`get_session(&app_handle)`), `cleanup_orphan_torrents`, `unpause`/`pause`, `PollOutcome { Done, Paused }`
- `src-tauri/src/lib.rs` — `pause_debrid_download` registered (~276-278)
- `src/services/tauri.ts` — `pauseDebridDownload` binding + `"paused"` in `DebridDownloadResult.status`
- `src/hooks/useDebridInstallSync.ts` — `paused` early branch in `handleInstallResult`
- `src/context/DownloadQueueContext.tsx` — `loadJobs()` pause-on-reload, `pauseJob`/`resumeJob`, types + provider value
- `src/components/downloads/DownloadJobCard.tsx` — Pause/Resume buttons
- `src/pages/Downloads.tsx` — wiring

### Build
- `cargo test` ✅ (185 passed / 0 failed; 4 new pause/flag tests)
- `cargo check` ✅ (0 errors; 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings + chunk-size warning)

## Session — Premium Downloads redesign: ActiveDownloadCard hero + live speed chart + mock

### Goal
Redesign the Downloads page into a premium launcher-style dashboard (INZOI reference): `ActiveDownloadCard` hero with game artwork, thick white progress bar, glass Pause/Cancel buttons, a glassmorphism stats panel (RED/PICO/SEEDS/PEERS + "Torrent" badge), and a live speed bar chart fed from a TS ring buffer. Completed/failed cards also restyled to glass premium.

### Scope decisions (user-confirmed)
- Full scope: component + dev mock + real wiring. Seeds/peers hidden when not applicable (no Rust changes — deferred to future follow-up).
- Completed/failed card rows also redesigned to glass premium.

### Part 1: `src/hooks/useActiveDownload.ts` (new)
- `ActiveDownload` type: `{ id, appId, gameName, coverImageUrl?, downloadedBytes, totalBytes, percentage, timeRemaining?, status, currentSpeedBytes?, peakSpeedBytes?, seeds?, peers?, isTorrent, isSteam, isDebrid, repacker?, speedHistory: number[], progressMode, message? }`.
- Module-level ring buffer `_samplesByJob: Map<string, {t, bytes}[]>` (cap `MAX_RAW_SAMPLES = 200`; entry deleted on terminal states `done/failed/cancelled`).
- `useActiveDownload(job)` — `useMemo` per `job`; `speedHistory` = last 40 deltas `Δbytes/Δt`; `currentSpeed` from `job.speedBytesPerSec` if > 0 else last sample; `peakSpeed` = buffer max; `timeRemaining = "en ${formatEtaLong((total-read)/speed)}"`; `percentage = (downloaded/total)*100` or `job.progress`; `isTorrent = job.installMethod === "torrent"`; seeds/peers stay `undefined`.
- Exported helpers: `formatBytes`, `formatSpeed`, `formatEtaLong` (`d h` / `h m` / `m s`).
- `resolveDisplayTitle` reads `getBootSnapshot().library.games` (Steam gameTitle is numeric); `resolveCoverUrl` uses `artworkUrl` or `localPathToUrl(media.landscapePath || coverPath || backgroundPath)` for `steam-install`.
- `MOCK_ACTIVE_DOWNLOAD` (dev): Cuphead 268910, 12.1/28.6 GB via `1024**3`, 42.43%, "en 1 día", 3.4 MB/s, peak 8.7 MB/s, seeds 39/peers 45, isTorrent, `speedHistory` ~40 sinusoid+noise values, repacker "SteamRip".

### Part 2: `src/components/downloads/ActiveDownloadCard.tsx` (new)
- Presentational `ActiveDownloadCardProps { download, onPause?, onResume?, onCancel? }`; `imgFailed` state → degraded `bg-(--color-bg)` fallback.
- Hero: full-width with `brightness(0.3)` + dark overlay; large white title; "12.1 GB / 28.6 GB · en 1 día"; big percentage right ("42.43%"); bar `h-2.5 rounded-full bg-white/25` + fill `bg-white`; 2 dark glass buttons `bg-black/50 backdrop-blur rounded-full` (Pausar = pause icon, Cancelar = circle-X).
- Stats panel `rounded-2xl border-white/10 bg-black/30 backdrop-blur-xl`: RED (down arrow), PICO (chart icon), "SEEDS: 39 · PEERS: 45" (hidden when undefined), "Torrent" label bottom-left only if `isTorrent`.
- Speed chart ~40 bars `flex-1 rounded-t bg-linear-to-t from-white/20 to-white/70`, `height: (v/max)*100 + "%"`, `transition-[height] duration-300 ease-out`.
- `canPause = isDebrid && status !== "paused" && CANCELLABLE`, `canResume = isDebrid && status === "paused"`, `canCancel = CANCELLABLE` (queued/waiting/checking/downloading/extracting/installing/paused); "Open Steam" (`steam://install/${appId}`) only if `isSteam && (waiting || downloading)`; `StatRow` `text-[10px] uppercase tracking-[0.16em] text-white/50`; indeterminate → `animate-pulse bg-white/70` bar.
- Correct nested HTML (article → divs → p; no `<p>` wrapping divs).

### Part 3: `src/pages/Downloads.tsx` wiring
- `ActiveDownloadRow` subcomponent (component-level, needed for hooks in `.map`) → `useActiveDownload(job)` → `ActiveDownloadCard`.
- Active jobs no longer use `DownloadJobCard`. Dev mock rendered above everything under "Vista previa (mock)" via `import.meta.env.DEV` (stripped from prod bundle).

### Part 4: `DownloadJobCard.tsx` completed/failed glass restyle
- Debrid-done, Steam-done, and generic branches: `lf-surface` → `rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/70 p-4 backdrop-blur-md`; artwork `h-14 w-14 rounded-xl` → `h-16 w-16 rounded-2xl`.

### No Rust changes (user decision)
- Future follow-up documented: extend `InstallProgressEvent` + `torrent.rs` reading `stats.live.snapshot.peer_stats.live` from librqbit 8.1.1 for real seeds/peers.

### Key Files Changed
- `src/hooks/useActiveDownload.ts` — **new** — `ActiveDownload` type, `useActiveDownload`, ring buffer, format helpers, `MOCK_ACTIVE_DOWNLOAD`
- `src/components/downloads/ActiveDownloadCard.tsx` — **new** — premium hero + stats panel + speed chart
- `src/pages/Downloads.tsx` — imports, dev mock preview, `ActiveDownloadRow` subcomponent, active map → `ActiveDownloadCard`
- `src/components/downloads/DownloadJobCard.tsx` — completed/failed branches → glass premium

### Build
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.85s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings; verified "SEEDS:"/"PICO"/"RED" + "Torrent" in bundle; "Vista previa" correctly absent from prod via `import.meta.env.DEV`)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — ActiveDownloadCard redesign: 2 floating glass panels + hero transition + ambient feed

### Goal
Refactor `ActiveDownloadCard.tsx` into a premium 2-panel Glassmorphism layout over the game''s immersive art (CSS Grid responsive): left panel = live speed bar chart, right panel = title/size, torrent stats (RED/PICO/SEEDS/PEERS) and a bottom row with progress bar + percentage + Pause/Cancel buttons. Wire the page hero to the hero-transition preference (Ajustes → Animaciones) and feed the global ambient background.

### Part 1: Generic theme-driven glass utilities (App.css)
- `.lf-glass` / `.lf-glass-strong` added next to `.lf-console-glass*` (same recipe: `color-mix(in srgb, var(--color-surface) 55/72%, transparent)` + `blur(28/32px) saturate(1.4)` + inset top highlight), plus a `prefers-reduced-motion` guard.
- Uses `--color-surface` so themes and `[data-console-theme]` overrides are respected. Desktop surfaces now get real glass without hardcoded `bg-black/40`.

### Part 2: ActiveDownloadCard.tsx — full rewrite
- **Layout**: `<article>` (rounded-2xl, `border-(--surface-active-border)`) → art layers + 2 overlays → `<div class="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2 lg:min-h-[380px]">`.
- **Left panel** (`lf-glass-strong`): "Velocidad en vivo" header + `Torrent` accent pill (only if `isTorrent`); chart `h-[clamp(130px,22vh,200px)]` of ~40 bars `from-(--color-accent)/25 to-(--color-accent)/70`, `height:(v/max)*100%`, `transition-[height] duration-300 ease-out`; pulse bar when no samples; footer shows `timeRemaining ?? message ?? status`.
- **Right panel** (`lf-glass-strong`): big game title + `sizeLine` (+ `timeRemaining`); repacker pill; torrent data row (RED/PICO/SEEDS·PEERS via theme `StatRow`); bottom row (`xl:flex-row`) = accent progress bar (`bg-(--color-accent)`, h-3, `transition-[width]`) + `formatPct` % + glass buttons (`GLASS_BTN` const: `bg-(--color-surface)/40 backdrop-blur-md`); Cancel gets `hover:bg-red-500/30`.
- **Hero transition** (`useSyncExternalStore` on `heroTransitionStore`): `crossfade` → two-layer `useCrossfadeSrc(artSrc)` (prev `animate-hero-media-out`, current `animate-hero-crossfade-in`); `kenburns` → `animate-hero-kenburns-in`; `focus` → `animate-hero-focus-in`. `brightness-[0.45]` on art.
- **Ambient feed**: `setAmbientSource("downloads-hero", currentSrc)` on art change (no clear on change); `clearAmbientSource("downloads-hero")` on unmount only — mirrors GameHero pattern. `imgFailed` → `artSrc = null` → fallback `bg-(--color-bg)` layer + ambient stops updating.
- All action logic preserved (canPause/canResume/canCancel, Open Steam for `isSteam && waiting|downloading`, indeterminate pulse bar).

### Key Files Changed
- `src/App.css` — `.lf-glass` / `.lf-glass-strong` utilities + reduced-motion guard
- `src/components/downloads/ActiveDownloadCard.tsx` — full rewrite (2-panel glass grid, hero transition modes, ambient feed, theme StatRow/GLASS_BTN)

### Build
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.14s, Rolldown; verified in bundle: "Velocidad en vivo"/"SEEDS:"/"RED"/"PICO", scope "downloads-hero", `.lf-glass-strong`, `animate-hero-crossfade-in`/`media-out`; compiled CSS has `.from-\(--color-accent\)/25`, `.to-\(--color-accent\)/70`, `bg-\(--color-surface\)/40|60`)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — ActiveDownloadCard polish: fixed 220px floating glass cards + entry animation
### Goal
Pulir el ActiveDownloadCard tras el rediseño premium: cards fijas y compactas que flotan sobre el arte del juego, stats en una sola fila, fila de controles en orden exacto y animación de entrada de barras/progreso.

### Decisiones del usuario
- Dark glass HARDCODEADO (bg-black/40 + texto blanco) — sustituye el glass theme-driven (.lf-glass-strong) de la sesión anterior; ignora temas intencionalmente.
- Altura fija h-[220px] en ambas cards.

### Part 1: Layout / altura / floating (ActiveDownloadCard.tsx)
- Grid wrapper: px-4 py-10 sm:px-6 md:grid-cols-2 md:py-12 (sin lg:min-h-[380px]) → arte del juego visible arriba/abajo de las cards.
- Cards: flex h-[220px] flex-col justify-between rounded-xl border border-white/10 bg-black/40 p-5 shadow-xl shadow-black/40 backdrop-blur-xl.

### Part 2: Card izquierda (gráfico)
- Header compacto ("Velocidad en vivo" text-white/50 + pill "Torrent" accent).
- Gráfico flex-1 items-end gap-[3px] (≈80% de la altura), barras from-(--color-accent)/25 to-(--color-accent)/70, transition-[height] duration-500 ease-out.
- Footer eliminado (el timeRemaining vive en la card derecha).

### Part 3: Card derecha (controles)
- Header: título truncate text-white + línea de tamaño text-white/60; pill repacker + botón Open Steam icono (ICON_BTN h-7 w-7) movidos aquí.
- Stats RED · PICO · SEEDS·PEERS en UNA fila compacta (gap-x-4, StatRow blanco, icono opcional).
- Fila inferior única flex items-center gap-3 en orden exacto: barra h-3.5 flex-1 rounded-full bg-white/15 → % w-16 font-bold tabular-nums → botón Pausar/Reanudar → Cancelar.
- CTRL_BTN = inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md transition hover:bg-black/70; Cancelar + hover:bg-red-500/40.

### Part 4: Animación de entrada
- const [entered, setEntered] = useState(false) + requestAnimationFrame(() => setEntered(true)) en mount.
- Barra: width entered ? pct : "0%" (transition-[width] duration-500 ease-out); barras: height entered ? h : 0%.
- Se reproduce al entrar a la página y al cambiar de descarga activa (ActiveDownloadRow keyed por job.id).
- Indeterminado: animate-pulse bg-white/60.

### Intacto
- Estado, mock, ambient feed "downloads-hero" (set/clear solo en unmount), hero-transition (crossfade useCrossfadeSrc / kenburns / focus), lógica canPause/canResume/canCancel/isOpenSteam, imgFailed → bg-(--color-bg).

### Key Files Changed
- src/components/downloads/ActiveDownloadCard.tsx — rewrite completo (layout, stats, controles, animación de entrada)

### Build
- tsc --noEmit ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- vite build ✅ (2.07s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos; verificadas strings "Velocidad en vivo"/"SEEDS:"/"RED"/"PICO"/"downloads-hero"/"Open Steam" + clases CSS .from-\(--color-accent\)\/25, .to-\(--color-accent\)\/70, .bg-white\/15, .bg-black\/40, .border-white\/20, .shadow-black\/40)
- cargo check ⏭️ skipped (no Rust changes)

## Session — Downloads page polish: done-card cleanup + active mock buttons (post-premium-redesign)

### Goal
Close the remaining gaps after the ActiveDownloadCard premium redesign: remove the misleading 100% blue bar in completed cards, only show the progress bar for active statuses, make rows compact (single badge, provider+type as metadata, larger hit targets), and make the dev mock preview's Pause/Cancel actually do something.

### Part 1: `DownloadJobCard.tsx` — completed-card cleanup
- **Removed the 100% blue bar** in both done branches (Debrid and Steam): previously rendered a full-width accent bar + "100%" label. Replaced with a compact completion row: `CheckCircle2` emerald icon + "Completada" label + installed size (`· {formatBytes(job.installedSize)}`) when available.
- **Single badge in done branches**: removed the hardcoded "Debrid"/"Steam" pill and (for Debrid) the separate repacker pill from the title row — kept only `DownloadStatusBadge`. Provider+repacker+message folded into the metadata line: `["Debrid", job.repacker?.toUpperCase(), job.message || "Instalado · Listo para jugar"].filter(Boolean).join(" · ")` for Debrid; `Steam · Instalado · Listo para jugar` for Steam.
- **Removed the separate "Tamaño instalado" `<p>`** in both done branches — the installed-size metadata now lives only in the completion row.
- **Generic branch progress bar gated**: `DownloadProgressBar` now only renders when `canCancel(job.status)` (queued/waiting/checking/downloading/extracting/installing/paused). done/failed/cancelled are terminal — no progress bar. Comment updated.
- **Generic branch single badge**: removed the extra `debrid-install` repacker pill; repacker+provider+type folded into the metadata fallback line: `{job.repacker.toUpperCase()} · {job.providerName || "Debrid"} · .{job.fileType}` when no message, debrid, and repacker present.
- **All three subtitle lines** (`job.message`, steam-install, debrid, generic) now use `truncate` to prevent long repacker/message strings from breaking the compact layout.
- **Hit target bump**: trash (Quitar) buttons in both done branches bumped from `p-2` → `p-2.5` (40px hit target).
- Added `CheckCircle2` to the lucide imports.

### Part 2: ActiveDownloadCard cancel menu gating
- The `•••` menu's "Cancelar descarga" `MenuItem` is now rendered only when `canCancel` (active + cancellable status), matching the Pause/Resume buttons. Previously it always showed (the mock preview is in `downloading` state, so the item stays visible there).
- `canCancel` local (CANCELLABLE.has) is now actually read — fixes the TS6133 unused-var.

### Part 3: `useDynamicPalette.ts` fix
- Fixed TS2300 duplicate identifier in `srgbToOklch`: the OKLCH `b` axis local conflicted with the function's `b` parameter. Renamed the local to `bAxis` (3 references: the axis computation, `C = sqrt(a²+bAxis²)`, and `H = atan2(bAxis, a)`).

### Key Files Changed
- `src/components/downloads/DownloadJobCard.tsx` — done-branch cleanup (no 100% bar, single badge, compact metadata, `truncate`), generic progress bar gated by `canCancel`, trash hit targets 40px, `CheckCircle2` import
- `src/components/downloads/ActiveDownloadCard.tsx` — cancel menu item gated by `canCancel`
- `src/hooks/useDynamicPalette.ts` — `b` → `bAxis` rename in `srgbToOklch`

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- `vite build` ✅ (2.24s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `vitest run` ✅ 802 passed / 4 failed (solo los 4 preexistentes: sourceManagerDeclarativeWiring ×3 + tools.test extractToolConfig)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Grow-on-mount: barra de progreso ActiveDownloadCard + barra de achievements del GameDetails

### Goal
Restaurar la animación de entrada (grow desde 0) de las barras de progreso, perdida en el rediseño premium del ActiveDownloadCard, y extenderla a la barra de progreso del panel de achievements del GameDetails de Library. Patrón replicado del de Stats/Logros (transición CSS de width/height sobre un estado `entered` activado tras el primer paint).

### Part 1: Hook `useGrowOnMount` (`src/hooks/useGrowOnMount.ts` — **nuevo**)
- Devuelve `false` en el primer render y `true` tras el siguiente `requestAnimationFrame`.
- Bajo `prefers-reduced-motion: reduce` resuelve a `true` inmediatamente (barra al valor final, sin flash de barra vacía).
- Se empareja con las transiciones CSS ya existentes en el elemento objetivo.

### Part 2: ActiveDownloadCard.tsx
- **Barra de progreso principal** — `transform: scaleX(${grow ? progressValue : 0})` (el fill ya usa `origin-left` y la transición `.lf-download-progress-fill`).
- **SpeedChart** — mismo hook dentro del subcomponente; barras `style={{ height: ${grow ? h : 0}% }}` (transición `.lf-download-chart-bar` ya existente).
- **Sin `transition-delay`/stagger**: el delay persistiría en las actualizaciones en vivo del chart. Todas las barras crecen juntas.
- Doc comment del SpeedChart actualizado.
- Sin cambios en `App.css` (transiciones y guards reduced-motion ya existen).

### Part 3: LibraryGameDetails.tsx — barra de achievements
- Bloque de la barra de progreso del panel extraído a subcomponente interno `AchievementProgressBar({ unlocked, total, isPerfected, syncing })`.
- Usa `useGrowOnMount()` internamente → `width: ${grow ? percent : 0}%` con el `transition-all duration-500` existente.
- La extracción es necesaria porque el panel aparece de forma asíncrona (`achievementsSummary` puede cargar después del mount raíz); un estado en el raíz ya estaría `true` antes de que la barra monte y no se vería la animación.
- Solo la barra — el contenedor del panel NO se anima (decisión del usuario).
- Re-mount keyed (`LibraryGameDetailPage.tsx:1233`, `key=library:game-details:{source}:{appId}`) re-ejecuta la animación al cambiar de juego.

### Sin cambios en Downloads.tsx
- `ActiveDownloadRow` ya keyed por `job.id` → re-mount al cambiar descarga activa re-ejecuta la animación; el mock preview la muestra al entrar.

### Key Files Changed
- `src/hooks/useGrowOnMount.ts` — **nuevo** — hook de grow-on-mount con guard reduced-motion
- `src/components/downloads/ActiveDownloadCard.tsx` — `scaleX` condicional en la barra de progreso + `height` condicional en las barras del SpeedChart
- `src/components/library/LibraryGameDetails.tsx` — subcomponente `AchievementProgressBar` con grow-on-mount

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- `vite build` ✅ (2.13s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Grow-on-mount en páginas LauncherAchievements y ActivityStats (barras + gráficos)

### Goal
Extender la animación de entrada grow-on-mount (sesión previa) a los pages de Achievements (`LauncherAchievements.tsx`) y Stats (`ActivityStats.tsx`), que no tenían animación al entrar: animar todas las barras de progreso y gráficos con `useGrowOnMount`.

### Part 1: Componente compartido `LevelRing` (`src/components/activity/LevelRing.tsx` — nuevo)
- Anillo de nivel/XP reutilizable que crece el stroke desde vacío hasta `percent` al montar (page-entry) vía `useGrowOnMount` + `transition-all duration-700` existente.
- Props opcionales: `svgClassName` (default `h-24 w-24`), `levelClassName` (default `text-2xl`), `labelClassName` (default `text-[8px]`) — permite ambos tamaños (Stats h-24, Achievements h-28).
- `strokeDashoffset = C * (1 - percent/100)` con `C = 2π·38`; `grow ? percent : 0`.

### Part 2: Componente compartido `GrowBar` (`src/components/common/GrowBar.tsx` — nuevo)
- Barra de ancho genérica que crece de 0 a `percent` al montar vía `useGrowOnMount` + `transition-all duration-700` en el fill.
- Props: `percent`, `minPercent?` (reserva un sliver visible para valores ~0, p.ej. `Math.max(2, ...)` en XP bars), `trackClassName?`, `fillClassName?`.

### Part 3: ActivityStats.tsx
- **Play Activity Chart** — bloque de barras de altura extraído a subcomponente `PlayActivityBars({ activityByDay, maxDaySeconds })` con `useGrowOnMount()` interno; cada barra `style={{ height: grow ? h% : 0% }}` (transición `transition-all` existente).
- **Level circle** — reemplazado por `<LevelRing percent={profile.progressPercent} level={profile.level} />`.
- **XP bar** — reemplazada por `<GrowBar percent={profile.progressPercent} minPercent={2} trackClassName="h-2.5 rounded-full bg-white/[0.06]" fillClassName="bg-linear-to-r from-amber-500 to-amber-400" />`.
- La extracción a subcomponentes es necesaria porque `games` (context) llega async; un estado raíz ya estaría `true` antes de que los gráficos monten.

### Part 4: LauncherAchievements.tsx
- **Level circle** — reemplazado por `<LevelRing ... svgClassName="h-28 w-28" levelClassName="text-3xl" labelClassName="text-[9px]" />`.
- **XP bar** (featured card) — reemplazada por `GrowBar` con `minPercent={2}`.
- **Completion bar** — reemplazada por `GrowBar` (track `h-2`, fill `from-(--color-accent) to-(--color-accent)/70`).
- **Category bars** — cada barra de categoría (en `.map`) reemplazada por `GrowBar` (track `h-1`, fill `bg-(--color-accent)/50`).
- Sin cambios en Achievement cards ni contenedores de panel.

### Key Files Changed
- `src/components/activity/LevelRing.tsx` — **nuevo** — anillo de nivel animado compartido
- `src/components/common/GrowBar.tsx` — **nuevo** — barra de progreso animada compartida
- `src/pages/ActivityStats.tsx` — `PlayActivityBars` subcomponente, `LevelRing`, `GrowBar` (chart + anillo + XP)
- `src/pages/LauncherAchievements.tsx` — `LevelRing` + `GrowBar` (anillo + XP + completion + categorías)

### Build
- `tsc --noEmit` ✅ (solo los 23 errores preexistentes de extensions/tests, ninguno en tocados)
- `vite build` ✅ (2.15s, Rolldown; solo INEFFECTIVE_DYNAMIC_IMPORT informativos)
- `vitest run` ✅ 802 passed / 4 failed (solo los 4 preexistentes: sourceManagerDeclarativeWiring ×3 + tools.test extractToolConfig)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session � Consistent page/tab entry transitions (lf-page-in coverage + Store tab re-mount fix)

### Problem
Several pages and content switches had no entry animation while the rest of the app animates (`lf-page-in` 400ms translateY/fade). Root cause analysis found two issues:

1. **Missing `lf-page-in`**: `ActivityStats`, `LauncherAchievements`, `Tools`, `Verification` roots, and `StoreGameDetailsPage` roots (timeout/loading/main) lacked the class. `StoreGameDetailsPage` opened from Store.tsx (`selectedDetailGameWithOverlay`, routeKey stays "store") had zero entry transition.
2. **Store tabs dead animation**: All 5 tab branches already had `<div className="lf-tab-panel-in">`, BUT React reconciles the div (same position [0], same element type) across branches � the DOM node is recycled, the CSS animation only runs on first mount of the tab area, never re-fires on tab switch. Adding a unique `key` forces unmount/remount ? animation replays.

### Part 1: `lf-page-in` on page roots
- `src/pages/ActivityStats.tsx` � root `w-full px-6...` + `lf-page-in`
- `src/pages/LauncherAchievements.tsx` � root idem
- `src/pages/Tools.tsx` � root `space-y-6 p-5 lg:p-7` + `lf-page-in`
- `src/pages/Verification.tsx` � root `p-5 lg:p-7` + `lf-page-in`

### Part 2: `lf-page-in` on StoreGameDetailsPage
- `src/components/store/StoreGameDetailsPage.tsx` � all 3 roots (`space-y-6`): timeout (L1165), metadataLoading (L1189), main (L1221) + `lf-page-in`
- Covers Store.tsx?details (no routeKey change) and is harmless under GameDetails.tsx wrapper (already has `lf-page-in`)

### Part 3: Store tab re-mount via keys
- `src/pages/Store.tsx` � unique `key` on each tab wrapper: `store-tab-browse`, `store-tab-repacks`, `store-tab-lua`, `store-tab-news`, `store-tab-discover`
- Forces React to destroy/recreate the `<div className="lf-tab-panel-in">` on tab switch so `lfTabPanelIn` animation re-fires (was silent before)

### Part 4: Store in-page sections
- `src/pages/Store.tsx` � viewAll section (`space-y-5` ? + `lf-page-in`) and search results section (`space-y-4` ? + `lf-page-in`)

### Build
- `tsc --noEmit` ? (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ? (2.16s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ?? skipped (no Rust changes)

## Session — Ambient background color mode (dominant color instead of blurred image)

### Goal
Add an opt-in display mode for the global ambient background: instead of showing the active game's artwork blurred, extract its dominant color and render a premium radial gradient + glow field (Dynamic Effect / Mica style). User chose "Gradiente con glow" and image mode stays the default.

### Part 1: `ambientBackgroundStore.ts`
- `export type AmbientMode = "image" | "color"`; storage key `lumaforge-ambient-mode`, default `"image"`.
- `_mode` module state + `setAmbientMode()` / `getAmbientMode()` (persist + `emit()`).
- `AmbientSnapshot` gains `mode: AmbientMode`; `emit()` includes it (new object each call — Object.is contract preserved).

### Part 2: `useDynamicPalette.ts`
- Exported `getCachedDynamicPalette(url)` — synchronous read of `_paletteCache`, returns `null` when not sampled yet. Lets the crossfade's *previous* layer render its real color (already cached) without a fallback flash.
- Exported `FALLBACK_PALETTE` (used by AmbientBackground for the current layer before sampling refines).

### Part 3: `AmbientBackground.tsx` — color mode branch
- Reads `mode` from the snapshot; `useDynamicPalette(url)` only when `mode === "color"`.
- `ColorField` sub-component: a div with `lf-ambient-color` (radial `--ambient-secondary → --ambient-primary` gradient) plus a `lf-ambient-glow` child (radial localized glow), driven by `--ambient-primary/secondary/glow` CSS vars.
- Keeps the two-layer crossfade (prev/current with `animate-ambient-out`/`in`, `CROSSFADE_MS`): prev layer uses `getCachedDynamicPalette(prevUrl) ?? currentPalette`, current layer uses `useDynamicPalette(url)`.
- Overlays (dim + bottom gradient) and `style.artOpacity` (intensity) apply identically; no `<img>`, no blur in color mode. `data-ambient=on` still set → shell translucency works.

### Part 4: `Settings.tsx`
- New "Modo del fondo ambiental" 2-column segmented control (Imagen difuminado / Color dominante) inside the ambient block, visible when enabled. Intensity description reworded to cover both modes.

### Part 5: `App.css`
- Registered `@property --ambient-primary/secondary/glow` (syntax `<color>`, initial-values from the download dynamic palette) so palette swaps interpolate smoothly (`--motion-palette` 600ms).
- `.lf-ambient-color` radial gradient + transition on the three vars; `.lf-ambient-glow` localized radial glow. Reuses existing `ambientIn`/`ambientOut` keyframes.

### Behavior
- **Image mode (default)**: unchanged — blurred art crossfade.
- **Color mode**: dominant hue of the current ambient `url` → radial gradient with glow; crossfades smoothly between games; intensity controls opacity; works across all ambient feeds (dashboard, library-details, store, console, page-context fallback) since they all flow the same `url` into the store.
- Canvas sampling may fall back to the blue-cyan `FALLBACK_PALETTE` for CORS-tainted remote URLs (same as the Downloads hero).

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` — `AmbientMode`, `setAmbientMode`/`getAmbientMode`, snapshot `mode`
- `src/hooks/useDynamicPalette.ts` — `getCachedDynamicPalette`, exported `FALLBACK_PALETTE`
- `src/components/layout/AmbientBackground.tsx` — `ColorField`, color branch, `useDynamicPalette`/`getCachedDynamicPalette` wiring
- `src/pages/Settings.tsx` — mode segmented control
- `src/App.css` — `@property --ambient-*`, `.lf-ambient-color`, `.lf-ambient-glow`

### Build
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.14s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings; verified `Color dominante`, `lumaforge-ambient-mode`, `lf-ambient-color`/`lf-ambient-glow`/`--ambient-primary` in bundle)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Ambient color mode: dominant-hue fix (yellow showed as red/pink)

### Problem
In "Color dominante" ambient mode, yellow-dominant art (e.g. Cuphead) sampled as reddish/pinkish instead of yellow. Both consumers affected: `AmbientBackground` (color mode) and `ActiveDownloadCard` (Downloads hero).

### Root cause (`useDynamicPalette.ts` `samplePaletteFromCanvas`)
- Line 171 denominator `bucketCount[best] * (1 + bestScore / Math.max(1, bucketWeight[best]))` — since `best` is the argmax of `bucketWeight`, `bestScore === bucketWeight[best]` → `1 + ratio` **always collapses to 2** → denominator = `2 * count`.
- Numerator `bucketHue[best]` accumulates `Σ H·(1+C)` (chroma-weighted hue sum). So computed hue ≈ `ΣH·(1+C)/(2·count)` ≈ **half the real dominant hue**. Yellow (OKLCH `H≈110`) → ~55 = red-orange; the bright low-chroma `secondary`/`glow` render that as pinkish.
- Line 154 `bucketSum[bucket] += H` was dead code (never read) — leftover from a plain-average attempt.

### Fix (`src/hooks/useDynamicPalette.ts`)
- **Proper chroma-weighted mean**: added `bucketDenom = new Float32Array(HUE_BUCKETS)`; accumulate `bucketDenom[bucket] += 1 + C;` next to `bucketHue[bucket] += H * (1 + C);`; compute `hue = bucketHue[best] / (bucketDenom[best] || 1)`.
- Removed dead `bucketSum` accumulation + declaration.
- **Brand blend reduced** `SAMPLE_BLEND` `0.18` → `0.10` (user decision) so yellows read yellow instead of drifting green toward the blue accent; doc comment updated.
- Extracted the argmax+guard+mean+blend into **pure, exported `dominantBlendedHue(bucketCount, bucketHue, bucketWeight, bucketDenom)`** (returns `number | null`), used by `samplePaletteFromCanvas` — testable without canvas.

### Regression tests (`src/__tests__/dynamicPalette.test.ts` — new, 5 tests)
- Yellow art stays yellow (asserts result > 80 — NOT the buggy ~55 red-orange).
- Red art stays red.
- **Chroma weighting exact-bug test**: same bucket, 1000 low-chroma pixels (H=106, C=0.05) + 5 vivid (H=118, C=0.5) → weighted mean ≈ 106.08 + 10% blend ≈ 119 (old 2·count denominator gave ≈55.8).
- Empty data → null; single-pixel bucket → null.

### Key Files Changed
- `src/hooks/useDynamicPalette.ts` — `bucketDenom`, proper weighted mean, removed `bucketSum`, `SAMPLE_BLEND` 0.10, exported `dominantBlendedHue`
- `src/__tests__/dynamicPalette.test.ts` — **new** — 5 regression tests

### Build
- `vitest run src/__tests__/dynamicPalette.test.ts` ✅ 5/5 passed
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.23s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)

## Session — Folder picker: start from the input path, fall back to games/debrid root

### Problem
The folder-picker button opened at the OS last-used folder ("a game's path") instead of the path typed in the input — even in GameEditDialog. Root cause: `pick_folder` (Rust) called `dialog.set_directory(&d)` with whatever `start_dir` arrived; when the path didn't exist on disk (e.g. the repack default `games/debrid/<entryId>` before download), rfd silently fell back to last-used. GameEditDialog's 4 folder-Browse buttons passed no `start_dir` at all.

### Part 1: Rust `pick_folder` — robust start_dir (`src-tauri/src/commands/process.rs`)
- Added injected `app_handle: tauri::AppHandle` (Tauri injects automatically — no `lib.rs` change).
- Relative `start_dir` (e.g. `games/debrid/<id>`) resolved against `app_data_dir()`.
- When the path doesn't exist, walks up to the **nearest existing ancestor** so the native dialog doesn't fall back to last-used. For a repack default this lands on `<appData>/games/debrid` (the root the user wants).
- Only calls `set_directory` with an existing dir; Windows drive root handled (`pop()` false → stop).
- `use tauri::{AppHandle, Manager}` imports added.

### Part 2: GameEditDialog — pass the typed value as startDir
- All 4 folder-Browse buttons now pass the draft value as `startDir`:
  - `pickFolder("Select Install Folder", installDirDraft.trim() || undefined)` (×2)
  - `pickFolder("Select Working Directory", workingDirectoryDraft.trim() || undefined)` (×2)

### Part 3: StoreRepackInstallModal — explicit root on empty input
- Caches the resolved `appDataDir` in state (`resolvedAppDataDir`) from the existing `resolveAppDataDir()` effect.
- `handlePickFolder`: `pickFolder("Elige la carpeta de destino", destDir.trim() || (resolvedAppDataDir ? \`${resolvedAppDataDir}/games/debrid\` : undefined))` — empty input opens at the root `games/debrid`; non-empty missing path handled by the Rust walk-up.

### Key Files Changed
- `src-tauri/src/commands/process.rs` — `pick_folder` robust start_dir (relative→appData, walk-up to existing ancestor)
- `src/components/games/GameEditDialog.tsx` — 4 Browse buttons pass input draft as `startDir`
- `src/components/store/StoreRepackInstallModal.tsx` — `resolvedAppDataDir` state + root fallback in `handlePickFolder`

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 22 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.12s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

## Session — Debrid: native appId/title persistence + auto artwork refresh (Parts A–D+F)
### Goal
Make a Debrid-installed repack game feel "native" in the Library desktop grid + detail by persisting the clean Steam `title` and a valid numeric `appId` onto the Debrid store entry, and auto-materializing Steam artwork after install. All media/title surfaces are keyed by `appId` (Steam) with no source filter, so persisting the appId unlocks the whole appInfo/media pipeline automatically.

### Part A: Thread appId through the Debrid install flow (`useDebridInstallSync.ts`)
- `persistDebridIdentity(providerGameId, title, appId?)` — module helper: `updateDebridGameAppId(String(num))` when `Number.isInteger(num) && num > 0`; `updateDebridGameTitle(title)` when non-empty and not placeholder (`/^Steam App \d+$/`); then `queueNativeArtworkRefresh` when valid appId.
- `queueNativeArtworkRefresh(appId?)` — dynamic `import("../services/gameCacheService").detectAndQueueMissingMedia(validAppId, "refresh-artwork")`. `"refresh-artwork"` is a MANUAL_ARTWORK_SOURCE (gameCacheService.ts:1688) which passes the emergency-stabilization gate (L1845: `isManualArtworkSource`), so it runs despite `AUTO_MEDIA_REPAIR_GLOBAL=false`. It checks disk, resolves Steam metadata + SGDB, and queues `enqueueMediaDownload` (low priority, `target:"canonical"`) per missing of the 5 roles → writes `games/steam/<appId>/media/`.
- `startInstall` (DebridInstallHandle type + body) gained optional `appId?: string` param; forwarded to `handleInstallResult`.
- `pollInstallerUntilDone(pid, installDir, jobId, providerGameId, title, appId?)` — calls `persistDebridIdentity` on the `ready` success path and the registry-detect success path; passes `appId` in the `setPendingCompletionNeedsPath(..., { title, appId })` extras (both needs-path modal and timeout paths).
- `handleInstallResult(..., appId?)` — `persistDebridIdentity` in the `ready`, `installing` (early, right after `markDebridGameInstalling`), and `needs-setup` branches; `markDebridGameExtracted` extras gain `appId`.

### Part B: persist appId + forward on resume (`DownloadQueueContext.tsx`)
- `addDebridInstallJob` already persisted `job.appId`/`job.gameTitle`; the `startInstall` invocation (line 278) now appends `job.appId` as the new final arg.
- `resumeJob` reforward now also passes `job.appId` (line 368).
- No `addDebridInstallJob` signature change — `appId` was already the 5th param.

### Part C: clean title at the Store call site (`StoreGameDetailsPage.tsx`)
- `handleInstallRepack` passes `getTitle(game, metadata)` instead of `entry.title` (metadata is in component scope as a prop); added `metadata?.name` to the useCallback deps. Toast still shows the descriptive `entry.title`.

### Why it works now
- `appId` and `title` persist on the Debrid entry (`updateDebridGameAppId` trims and survives catalog refresh + restart via `debrid-games.json`), so the Library grid/detail resolve `appId`-keyed appInfo + media. The artwork refresh (Part F) materializes the Steam media on install completion without requiring the user to open the detail page.

### Key Files Changed
- `src/hooks/useDebridInstallSync.ts` — `persistDebridIdentity`, `queueNativeArtworkRefresh`, `appId` threading through startInstall/handleInstallResult/pollInstalledForDone, `appId` in needs-path extras
- `src/context/DownloadQueueContext.tsx` — startInstall + resumeJob reforward `job.appId`
- `src/components/store/StoreGameDetailsPage.tsx` — `getTitle(game, metadata)` at install call, deps

### Build
- `tsc --noEmit` ✅ (only the 22 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.04s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings; verified `useDebridGameAppId`/`updateDebridGameTitle`/`refresh-artwork`/`detectAndQueueMissingMedia` in bundle)

## Session — Debrid download `os error 3` root cause: unsanitized nested filename

### Problem
Debrid repack install failed instantly with `Failed to create file: The system cannot find the path specified. (os error 3)` — before any byte downloaded. Confirmed the message comes only from `download_file_to_dest` at `debrid_installer.rs:1790` (`tokio::fs::File::create(&part)`), where `part = tmp_dir.join(format!("{}.part", file_name))` with `tmp_dir = dest_dir/tmp` created OK. Failing before the first chunk means `file_name` contained a path separator → parent dir `tmp/<sub>` didn't exist.

### Root cause
- `file_name` comes from `clean_download_filename(preferred_filename.or(extract_filename_from_uri(uri)))`. Debrid resolvers (`debrid_resolver.rs`) return the full **in-archive path** (e.g. `Game Folder/Setup.exe`) or Windows-invalid characters for magnet/torrent files.
- Old `clean_download_filename` only checked non-empty + `len ≤ 50` + `has_file_extension` — it did NOT sanitize `/ \ < > : " | ? *` or control chars, trailing dots/spaces, `.`/`..`, or reserved device names. A slash-carrying token passed straight through → `.part` built a nested path → `os error 3`.

### Fix (pure Rust, `debrid_installer.rs`)
- **`normalize_download_filename(name)`** — single sanitizer:
  1. Keep only the last path segment (`split(['/', '\\']).last()`).
  2. Replace Windows-invalid + control chars (`<>:"/\|?*` + C0 controls) with `_`.
  3. Trim trailing dots/spaces (Windows terminators).
  4. Fall back to `"repack"` for empty / `.` / `..` / reserved device names (`con`/`nul`/`prn`/`aux`/`con.`/`lpt`/`com`).
  5. Cap at `MAX_LEN = 50` preserving the extension when present; bare over-long tokens (gofile CDN) → `"repack"`.
- **`clean_download_filename`** — now always routes through `normalize_download_filename` (no more extension-only fast path; bare/over-long names still sanitize instead of passing raw). The old `has_file_extension` helper was removed (unused).
- **Defense-in-depth** — before the `File::create`/`OpenOptions` branch in `download_file_to_dest`, `fs::create_dir_all(part.parent())` ensures a residual nested name can never surface as a silent `os error 3`.
- **7 new regression tests** in `debrid_installer::tests`: nested subdir strip (the exact bug), invalid-char replacement, trailing dot/space trim, `"repack"` fallback (empty/`.`/`..`/reserved/over-long/slash-only), length-cap-preserving-extension, valid names unchanged, `clean_download_filename` sanitizes all inputs.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — `normalize_download_filename`, `clean_download_filename` rewrite, `has_file_extension` removed, part-parent `create_dir_all` guard, 7 tests

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `cargo test` ✅ **197 passed / 0 failed** (was 190; 7 new)

## Session — Debrid bugs: multivolume routing, installer CWD, missing-exe launch error

### Goal
Fix 3 Debrid install/launch bugs: (1) multivolume repacks downloaded only the first `.bin` via the resolved direct link instead of running through the integrated torrent client, (2) `spawn_installer_detached` ran the repack installer without anchoring its working directory, and (3) launching a Debrid game with a stale/missing `executablePath` surfaced a cryptic `os error 2`.

### Part 1 — Multivolume resolve → torrent routing (Rust + TS)
- **Root cause**: `DebridResolveResult` only exposed `resolved_url: Option<String>`; TorBox used `torbox_largest_file` (single largest file) and Real-Debrid used `.first()` → a single link, so a multivolume repack resolved to only its first part (`.rar` correctly left in place as incomplete).
- **Rust** (`debrid_resolver.rs`):
  - `DebridResolveResult` gained `resolved_urls: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`) and `file_count: Option<usize>`.
  - Helper `torbox_usable_files` collects non-sample/non-metadata TorBox files; when >1, `file_count = Some(usable.len())` and `picked = Some((0, name, size))` (whole-torrent); single file → `file_count = Some(1)`.
  - Real-Debrid magnet: enumerate `torrents/links/{id}` → `all_links: Vec<String>` + `file_count = Some(len)` when several. WebDL (direct-HTTP, single-file) keeps `resolved_urls::new()`, `file_count: None`.
- **TS**: `DebridResolveResult` type gained `resolvedUrls?`/`fileCount?` (`debridProviderService.ts:14-25`); `resolveInstallUri` returns `{ url, fileName?, fileCount? }` (`useDebridInstallSync.ts:74-82`); `startInstall` routes to `startTorrentDownload` when `resolved.fileCount > 1` and `downloadUri.startsWith("magnet:")` (~line 475).

### Part 2 — Installer working directory (`debrid_installer.rs:1162`)
- `spawn_installer_detached` now anchors to the installer's own directory via `current_dir` and, on the elevated PowerShell path, `Start-Process -WorkingDirectory '<workdir>'` with `''` quoting escapes.

### Part 3 — Missing executable path clear error (`process.rs:113`)
- **Root cause**: `spawn_game_with_elevation_fallback` only special-cased `os error 740`; a nonexistent `executablePath` returned the cryptic `os error 2` from both the plain spawn AND the `Start-Process -Verb RunAs` retry (which would also fail identically).
- **Fix**: upfront existence validation — resolve the exe against `working_directory` when relative, and `return Err("Executable not found: '<resolved>'. The installed path may be missing or stale — reinstall the game or pick a valid executable.")` before building the command. Fails fast with a clear message instead of dragging the user through an elevation prompt that can never succeed.

### Build
- `cargo check` ✅ (0 errors)
- `cargo test` ✅ 197 passed / 0 failed

## Session — Debrid torrent post-process fixes (Part A: multivolume routing + Part B: installer/volume selection)

### Goal
Fix the FitGirl-via-debrid install pipeline after the integrated torrent client was introduced: multivolume repacks were resolving to a single direct link (only the first `.bin` downloaded) instead of routing through the torrent client, and the torrent post-process picked wrong installers/misplaced files.

### Part A — Multivolume repacks route to torrent client (completed, validated)
- **Root cause**: `DebridResolveResult` only exposed `resolved_url: Option<String>`; TorBox used `torbox_largest_file` (single largest file) and Real-Debrid used `.first()` → multivolume repack resolved to only its first part.
- **Rust** (`debrid_resolver.rs`):
  - `DebridResolveResult` gained `resolved_urls: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`) and `file_count: Option<usize>`.
  - Helper `torbox_usable_files` collects non-sample/non-metadata TorBox files; when >1, `file_count = Some(usable.len())` and `picked = Some((0, name, size))` (whole-torrent); single file → `file_count = Some(1)`.
  - Real-Debrid magnet: enumerate `torrents/links/{id}` → `all_links: Vec<String>` + `file_count = Some(len)` when several. WebDL (direct-HTTP, single-file) keeps `resolved_urls::new()`, `file_count: None`.
- **TS**: `DebridResolveResult` type gained `resolvedUrls?`/`fileCount?` (`debridProviderService.ts:14-25`); `resolveInstallUri` returns `{ url, fileName?, fileCount? }` (`useDebridInstallSync.ts:74-82`); `startInstall` routes to `startTorrentDownload` when `resolved.fileCount > 1` and `downloadUri.startsWith("magnet:")` (~line 475).

### Part B — Torrent post-process: installer + volume selection (B1 done, B2 pending)
- **B1a — installer selection uses canonical helper**: local `find_installer_file_recursive` in `torrent.rs` was a naive DFS that did NOT skip `_Redist` nor prefer the root → could pick a redistributable's `setup.exe` over the repack's real installer (misplaced files, "setup.exe que no funciona"). Replaced all 3 call sites (short-circuit step 0, `process_torrent_files` Priority 1, post-extraction re-scan) with the canonical `find_installer_exe_recursive` (root-first, skips `_Redist`, depth cap) from `debrid_installer.rs`; removed the local function + the now-unused `INSTALLER_EXE_NAMES`/`REPACK_UTILITY_EXES` imports.
- **B1b — multivolume RAR extraction picks the first volume**: unrar/7-Zip must be pointed at the FIRST volume of a `Game.partNNN.rar` set (auto-follows the rest); picking the largest fails/partial. New `archive_is_first_volume(path)` (`rsplit_once(".part")` on the stem, trims leading zeros, parses u64, `== 1`; covers `part01`/`part1`/`part001`). `find_largest_archive_recursive` → `find_archive_to_extract`: if any RAR first-volumes exist, returns the largest of them; otherwise the largest single archive (legacy `.r00` sets only expose the `.rar`, which IS the first volume).
- **B2 — pending** (`debrid_installer.rs:1162` `spawn_installer_detached`): validate the installer spawn + working dir for the actual "setup.exe que no funciona" symptom. Not started.
- **Canonical helpers (verified)**: `REPACK_UTILITY_EXES` `:2517`; `INSTALLER_EXE_NAMES` `:2525` (`setup.exe`, `installer.exe`, `setup_x64.exe`, `setup_x86.exe`, `autorun.exe`); `find_installer_exe_in_dir` `:2535` (priority setup.exe → other installers → repack utilities); `auto_run_installer` `:1118` (detached spawn; success → `status:"installing"` + `installer_pid`; failure → `status:"needs-setup"` + `installer_path`; after installer exit re-scans via `find_largest_exe_in_dir` `:1102`); `flatten_single_root_folder` `:2314`.
- **TS poll loop**: `pollInstallerUntilDone` (`useDebridInstallSync.ts:165`) polls `checkInstallerStatus({ pid, installDir })`; `"ready"` → `updateDebridGame(...)`; `"needs-path"` → registry auto-detect.
- **Pipeline** `process_torrent_files`: `flatten_single_root_folder` → Priority 1 installer (`auto_run_installer`) → Priority 2 largest game exe → Priority 3 archive extraction → `delete_archive` → re-scan.
- **Kill-switch**: `DEBRID_TORRENT_ENABLED = true` (`torrent.rs:37`).

### Tests
- 7 new regression tests in `torrent.rs`: `archive_is_first_volume` (part01/part1/part001 recognized; later/plain/zip rejected) + `find_archive_to_extract` (prefers first volume over larger later volume, largest first-volume across sets, largest single archive, recursive zip fallback, empty dir → None). Use temp-dir fixtures with `SystemTime`-based unique names.
- Full suite: **210 passed / 0 failed** (203 previos + 7 nuevos).

### Build
- `cargo check` ✅ (0 errors; only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ✅ 210 passed / 0 failed


## Session � Torrent stall/resume/file-lock fixes (stuck old download + locked folder)

### Problem
1. Launcher stuck on an old torrent download ("little-big-adventure-...-fitgirl") that never finished and blocked starting new downloads.
2. Corrupt files could not be deleted until the launcher closed (file lock).

### Root causes
- **C1**: The metadata stall guard only applied to \Initializing\. Once metadata resolved with no seeds/peers, the poll loop spun at pct 0 emitting nothing until \TORRENT_MAX_WAIT_SECS\ (6h) � job stuck in "downloading" forever with no TS poller to cancel it.
- **C2**: librqbit session is process-lifetime (\TORRENT_SESSION\/\ACTIVE_TORRENTS\ OnceLock); persistent dir \<appData>/librqbit\ with fastresume + JSON restores old torrents on boot, which resume downloading in the background with no TS job tracking them.
- **C3**: Torrents remaining in the session hold open file handles on Windows, blocking folder deletion until the launcher closes. The Paused path (\session.pause\) kept the torrent in the session too.

### Fixes (torrent.rs)
- **Fix 1 � data-stall guard**: new \TORRENT_DATA_STALL_SECS = 2 * 60\, generic \stall_exceeded(first_seen, threshold_secs)\ + \metadata_stall_exceeded\/\data_stall_exceeded\ wrappers. \poll_torrent_until_done\ tracks \data_stalled: Option<Instant>\, reset when \stats.progress_bytes\ advances, \Err("No download progress (no seeds/peers).")\ after 2 min without new bytes in the non-Initializing branch. A download producing bytes is never cut; \metadata_stalled\ clears as soon as the state leaves Initializing.
- **Fix 2 � restored-torrent sweep**: \sweep_restored_torrents(session)\ called in \get_session\ right after session creation. A fresh process has empty \ctive_torrents()\, so every torrent librqbit restored from persistence belongs to a PREVIOUS session � they are deleted with \session.delete(id, false)\ (files kept on disk; only the session reference + file handles released). Download queue is the source of truth; an explicit resume re-adds its magnet below.
- **Fix 3 � release handles on pause**: \PollOutcome::Paused\ path now \session.delete(torrent.id(), false)\ + \ctive_torrents().remove(&job_id)\ instead of \session.pause\. Partial data + fastresume stay on disk; resume re-adds the magnet via \start_torrent_download\ and librqbit reuses existing files (piece verification on add).
- **Fix 4 � verified**: \startInstall\ catch in \useDebridInstallSync.ts\ already marks the job \"failed"\ when \start_torrent_download\ returns \Err\ (stall ? job fails, no eternal "downloading"); Rust \Err\ branch already cleans partial files + removes from \ACTIVE_TORRENTS\.

### Tests
- 3 new regression tests in \	orrent.rs\: \data_stall_below/at/over_threshold\ (parity with the existing metadata-stall tests). 20 torrent tests total.
- Full suite: **213 passed / 0 failed** (210 previos + 3 nuevos).

### Build
- \cargo check\ ? (only 2 pre-existing dead-code warnings: \HydraSourceList\, \DebridProviderConfig\)
- \cargo test\ ? 213 passed / 0 failed
- \	sc --noEmit\ ? (only the 22 pre-existing extension/test errors, none in touched files)
- \ite build\ ?? skipped (no TS changes)

## Session — Torrent metadata-fetch timeout (endless "Connecting to torrent swarm...")

### Problem
A dead/swarmless magnet (FitGirl/DODI repack with no reachable peers, or blocked DHT ports) left the job stuck forever on "Connecting to torrent swarm...". The previous metadata-stall guard (3-min) never fired for this case.

### Root cause
`add_torrent().await` (magnet without embedded info dict) is UNBOUNDED inside librqbit: `add_torrent` to `add_torrent_internal` (`metadata: None`) to `resolve_magnet` to `read_metainfo_from_peer_receiver` (dht_utils.rs:30), which blocks until a peer delivers the info-hash metadata OR the peer-address stream ends. With DHT enabled (our default — `SessionOptions` derives `Default` with `disable_dht: false`), that stream stays open forever (DHT keeps discovering peers), so individual peer connect failures never terminate the loop. The poll-loop metadata-stall guard (`torrent.rs:376`) runs only AFTER `add_torrent` returns — it never got the chance.

### Fix (`src-tauri/src/commands/torrent.rs`)
- Wrapped the `session.add_torrent(...)` call in `tokio::time::timeout(Duration::from_secs(TORRENT_METADATA_STALL_SECS), ...)` — the same 3-min budget the poll-loop connect guard uses, so BOTH phases are bounded identically.
- On timeout: logs `[TORRENT][METADATA_TIMEOUT] job_id=... no swarm metadata after 180s`, emits `emit_installer_progress(..., "failed", ..., "Could not connect to torrent swarm (no peers/seeds).")`, and returns `Err("Could not connect to torrent swarm (no peers/seeds).")` — the TS `startInstall` catch already marks the job failed on command `Err`.
- No cleanup needed on timeout: the torrent is only inserted into `active_torrents()` (and registered in the session) after `add_torrent` returns; dropping the timed-out future leaves no orphaned ManagedTorrent. Lingering DHT info-hash lookups are harmless (keyed by hash, never registered).
- `Duration`/`tokio::time::timeout` were already used in this file — no new imports.

### Regression test (torrent.rs)
- `add_metadata_timeout_reuses_connect_guard_budget` — asserts `TORRENT_METADATA_STALL_SECS == 180` and that it is 60s longer than `TORRENT_DATA_STALL_SECS`, guarding the invariant that the add-phase budget mirrors the poll-loop connect budget.

### Build
- `cargo check` (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` 214 passed / 0 failed (213 previos + 1 nuevo; 15 torrent tests total)
- `tsc --noEmit` skipped (no TS changes)
- `vite build` skipped (no TS changes)

## Session — Bug 4: resume after pause/cancel/network-cut corrupts `.part` files

### Problem
A Debrid repack download paused/cancelled/hit a network-cut mid-chunk left a `.part` file that, on resume, reassembled the file with corruption (gap/wrong offset). The corruption came from `.part` being dropped WITHOUT truncating to the acknowledged byte count.

### Root cause
- The download loop writes each chunk via `file.write_all(&chunk)` and only then bumps `bytes_read += chunk.len()`. A `write_all` that FAILS PARTIALLY (or a stream-error path) can leave the on-disk `.part` LONGER than `bytes_read`.
- The cancel/pause/stream-error/write-error exit branches all did `drop(file)` + `write_checkpoint(bytes_read, ...)` WITHOUT truncating the file first — so the on-disk part size diverged from the checkpointed offset. `load_checkpoint` uses the on-disk `.part` size as authoritative, so a resume from that stale length re-fetched bytes starting at the wrong position → corrupted output.
- The write-error path used a `map_err(|e| { write_checkpoint(...); format!(...) })` closure, which cannot `await` a truncation — it checkpointed with a file that might still hold an oversized tail.

### Fix (`src-tauri/src/commands/debrid_installer.rs`)
- **New `truncate_part_to(file, bytes_read)`** async helper: `flush()` then `set_len(bytes_read)` but ONLY when `meta.len() > bytes_read` (shrink-only — never extends, so a larger `bytes_read` can't insert a zero-gap on resume). Placed just before `decide_resume`.
- **Cancel branch** (in-loop): `truncate_part_to` → `write_checkpoint` → `drop(file)` → `Err`.
- **Pause branch** (in-loop): `truncate_part_to` → `write_checkpoint` → `drop(file)` → `Ok(DownloadFileOutcome::Paused)`.
- **Stream-error branch** (chunk read failure): `truncate_part_to` before `write_checkpoint` so the retry/backoff path resumes from a size consistent with the checkpoint.
- **Write-error path** restructured from `map_err` closure into a `if let Err(e) = file.write_all(&chunk).await { truncate_part_to(...); write_checkpoint(...); return Err(...) }` so truncation can `await` before checkpointing.
- The HTTP-416 and FreshStart branches already delete part+meta and restart from zero — unchanged.

### Regression tests (4 new in `debrid_installer::tests`)
- `truncate_part_shrinks_to_acknowledged_bytes` — file 8192B, `bytes_read` 4096 → on-disk becomes 4096 (the exact corruption case).
- `truncate_part_noop_when_aligned` — on-disk == `bytes_read` → unchanged.
- `truncate_part_never_extends` — `bytes_read` > on-disk → file NOT extended (guards the zero-gap corruption).
- `truncate_part_missing_file_no_panic` — newly created empty file truncates to 0, no panic.

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ✅ **218 passed / 0 failed** (214 previos + 4 nuevos)
- `tsc --noEmit` ✅ (only the 22 pre-existing extension/test errors, none in touched files)
- `vite build` ⏭️ skipped (no TS changes)

## Session — Debrid: gofile resume via stable source_key + never trust partial files

### Problem
1. **Resume never resumes (Bug 1)**: `download_debrid_package` re-resolved `resolve_gofile_url` on EVERY call (fresh CDN link each time). `load_checkpoint` compared `cp.uri != uri`, so the newly-rotated CDN link never matched the checkpoint → `.part`/`.part.meta` discarded → `resume_from = 0` → the saved progress was never used. The user's whole point of "continue from the saved progress after relaunch" was silently broken.
2. **Corrupt data trusted (Bug 3 gate)**: Step 0 short-circuited to "already extracted" when `find_installer_exe_*` found ANY exe in `dest_dir`, and `download_file_to_dest` short-circuited "already downloaded" whenever `dest_path` existed with `len > 0`. A leftover `.part` renamed to final (or a partial extraction) was treated as good → setup auto-ran on corrupt files.

### Part 1 — Fix A: checkpoint keyed on stable `source_key`
- `download_debrid_package` (Rust) gained `source_key: Option<String>` param; `checkpoint_key = source_key.unwrap_or(download_uri)`.
- `DownloadCheckpoint.uri` now stores the STABLE origin key (page/magnet URL), not the volatile CDN link.
- `download_file_to_dest` gained `source_key: &str`; `load_checkpoint`/`write_checkpoint` calls now pass `source_key` (the HTTP GET still uses `uri` = CDN).
- Frontend: `tauri.ts` binding gained `sourceKey?: string`; `useDebridInstallSync.ts` `downloadDebridPackage` call passes `sourceKey: downloadUri` (the job's stable `downloadUrl`).
- Old-format checkpoints (CDN keyed) are discarded once on first resume (mismatch → restart); direct-HTTP resumes keep working (source_key == original URI).

### Part 2 — Fix B: never trust partial files
- `has_partial_install_artifacts(dest_dir)` — new helper: true when `tmp/` exists and is non-empty (any `.part`/`.part.meta`/`.meta.tmp`). The completion path removes `tmp/`, so non-empty `tmp/` ⇔ in-flight/interrupted download.
- Step 0: when partial artifacts are present, logs `[DEBRID][SHORTCIRCUIT_SKIP]` and falls through to the full download+extract pipeline (never auto-runs setup on corrupt data).
- `download_file_to_dest` "already downloaded" short-circuit now requires `!part.exists() && !meta.exists()` — a leftover partial triggers checkpoint resume instead of trusting the final file. `part`/`meta` computed once before the gate (duplicate computation removed).

### Regression tests (6 new in `debrid_installer::tests`)
- `checkpoint_load_resumes_across_cdn_rotation` — checkpoint keyed on page URL matches the stable `source_key` (exact Bug 1 case).
- `checkpoint_load_source_key_mismatch_starts_fresh` — different origin discards the stale partial.
- `has_partial_artifacts_no_tmp_false` / `has_partial_artifacts_empty_tmp_false` / `has_partial_artifacts_part_file_true` / `has_partial_artifacts_meta_only_true` — Step 0 guard matrix.

### Fix C (verified, no change needed)
- `start_torrent_download` (librqbit) already resumes via fastresume + piece verification; a resumed torrent re-verifies existing files and never marks corrupt data ready. No analogous trust bug on the torrent path.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — `source_key` param on `download_debrid_package`/`download_file_to_dest`, `checkpoint_key`, `has_partial_install_artifacts`, Step 0 gate, dest_path gate, 6 tests
- `src/services/tauri.ts` — `sourceKey?: string` on `downloadDebridPackage` params
- `src/hooks/useDebridInstallSync.ts` — `sourceKey: downloadUri` at the call site

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ✅ **224 passed / 0 failed** (218 previos + 6 nuevos)
- `tsc --noEmit` ✅ (only the 22-23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.25s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

## Session � Torrent resume: never trust partial files (completion marker)

### Problem
Pausing a torrent/torque (librqbit) download and starting it again falsely reported the game as "descargado" and left a broken `setup.exe`. Uninterrupted downloads worked fine; the bug was isolated to the torrent/TorBox path (the steamrip/gofile HTTP path was fine).

### Root cause
The torrent Step 0 short-circuit (`torrent.rs:184-204`) trusted any on-disk installer/game exe as "already installed": it ran `find_installer_exe_recursive(&dest_path)` ? `auto_run_installer(...)`. librqbit writes pieces **in place** into `dest_dir` (no `tmp/` folder like the HTTP path), so a paused mid-download leaves a partial-but-real `setup.exe` (correct name, non-zero size). On resume, Step 0 found that corrupt exe ? auto-ran it ? false "installing/descargado". The HTTP path already had the analogous guard (`has_partial_install_artifacts`), but the torrent path had no interrupt signal.

### Fix
Torrent-specific **completion marker** stored in the librqbit session dir (`<appData>/librqbit/<job_id>.done`), NOT in `dest_dir` (a marker in dest would break `flatten_single_root_folder`, which requires the root to contain only the game folder):

- `torrent_base_dir(app_handle)` � shared resolve/create of the session dir (extracted from `get_session`).
- `marker_file_name(job_id)` � sanitizes the job id for the filename.
- `torrent_marker_path` / `torrent_marker_exists` / `write_torrent_marker` / `remove_torrent_marker`.
- **Step 0 gated**: only short-circuits when the marker exists. Without it (pause/cancel/first run), the short-circuit is skipped and the torrent is actually (re)added/resumed � partial files are re-verified by librqbit piece verification.
- **Marker written** on `Ok(PollOutcome::Done)` after the flush + `session.delete(..., false)`, before the `auto_extract`/`process_torrent_files` branch.
- **Marker removed** on the `Err` cancel/fail path (next to `delete(..., true)` partial cleanup).
- **Pause path unchanged**: no marker ? resume re-adds the magnet.

### Behavior after fix
- Pause ? resume ? Step 0 skipped ? torrent re-added ? real resume/re-download ? only after `Done` does post-processing run ? valid `setup.exe`.
- First-time download ? no marker ? normal flow (same as before).
- Cancelled/failed ? marker removed ? a later attempt re-downloads instead of trusting leftover partials.

### Tests (3 new in torrent::tests)
- `marker_file_name_sanitizes_job_id` � safe filename from alnum/-/_. and sanitized separators.
- `torrent_marker_roundtrip` � write ? exists ? remove ? gone.
- `torrent_marker_lives_in_session_dir_not_dest_dir` � marker never leaks into dest_dir (protects `flatten_single_root_folder`).

### Build
- `cargo check` ? (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ? **227 passed / 0 failed** (224 previos + 3 nuevos)
- `tsc --noEmit` ?? skipped (no TS changes)
- `vite build` ?? skipped (no TS changes)

## Session � Multivolume Debrid repacks: sequential per-file downloads (Option A)
### Goal
Replace the automatic `fileCount > 1` ? librqbit torrent fallback (user''s local swarm fails with "Could not connect to torrent swarm (no peers/seeds)") with sequential per-file direct downloads through the debrid provider: multivolume FitGirl repacks (magnet, setup.exe + `.bin` parts) download one-by-one via the existing `downloadDebridPackage` pipeline.

### Rust (already complete, verified this session)
- `DebridResolveResult` (`debrid_resolver.rs:16-38`) gained `file_names: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`) � aligned 1:1 with `resolved_urls`. Frontend downloads anything `> 1` sequentially per-file; primary part chosen by filename.
- TorBox magnet: multivolume branch emits a per-file `GET /torrents/requestdl` for every usable file + aligned `file_names`; skipped files ? early error result.
- Real-Debrid magnet: unrestricts EVERY link from `/torrents/links/{id}` (sequential `.form` loop) ? `resolved_urls`/`file_names` aligned 1:1; `file_size=None`; `file_count=Some(n)` only when n > 1.
- Premiumize: `premiumize_files_from_body` ? 6-tuple (first_url, first_name, first_size, all_urls, all_names, count); `file_names` aligned; links-less entries filtered. AllDebrid stays single-file (`file_names: Vec::new()`).
- `download_debrid_package` (`debrid_installer.rs:389`) supports `auto_extract=false` ? status `"downloaded"` (archive saved, no extraction). Loop calls it per part with the SAME `job_id`/`destDir`; each call starts with `clear_job_flags(&job_id)` so cancel mid-loop aborts only the in-flight part.

### TS (this session)
- `debridProviderService.ts` � `DebridResolveResult` mirror gained `fileNames?: string[]`; doc comment updated (per-file sequential semantics + primary-part-by-filename).
- `useDebridInstallSync.ts`:
  - `resolveInstallUri` return type + pass-through now include `resolvedUrls`/`fileNames`.
  - New `pickPrimaryPartIndex(fileNames)` helper � priority: (1) installer exe (setup/installer/`.exe$`, last match wins so volumes precede it), (2) first-volume archive (`part0*1.rar`/`.rar`/`.r00`), (3) fallback last index.
  - `startInstall` multivolume branch: when `resolved.resolvedUrls.length > 1` and `downloadUri.startsWith("magnet:")`, downloads each part sequentially via `downloadDebridPackage` � every non-primary part with `autoExtract=false` (just saved to disk), then the primary part LAST with `autoExtract=true` (reassembles + auto-runs setup). Same `jobId` (single progress bar via `InstallerProgressListener`), `destDir`, and `sourceKey: downloadUri` (stable checkpoint key). Breaks on `!result?.success` so `handleInstallResult` (called once after the loop) marks failed.
  - Explicit `installMethod === "torrent"` route and the resolve-failed ? torrent fallback remain unchanged (librqbit stays for the user''s explicit choice only).

### Behavior
- Multivolume repack via debrid: all `.bin`/volume parts land on disk first (no extraction), then setup.exe (or first-volume archive) downloads last and extracts ? setup runs once every part is present.
- Single-file repack: unchanged direct download path.
- Resume: checkpoint keyed on the stable `sourceKey` (job downloadUrl) per part � a CDN rotation on resume continues the same `.part` for the part in flight.
- Cancel mid-loop: only the in-flight part''s Rust call is aborted (clear_job_flags per call).

### Build
- `tsc --noEmit` ? (22 pre-existing extension/test errors only, none in touched files)
- `vite build` ? (2.35s, Rolldown; verified `pickPrimaryPartIndex` regex `/setup|installer|\.exe$/` + 3 `sourceKey` call sites in `index-*.js`; debug string dead-code-eliminated since `DEBUG_DEBRID_INSTALL=false`)
- `cargo test` ? 227 passed / 0 failed (verified prior session)
- `cargo check` ? (only 2 pre-existing dead-code warnings)

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


## Session - Torrent speed chart sparse: time-based progress emits + fixed slot-grid SpeedChart

### Problem
The Downloads page speed chart looked nearly empty for FitGirl-style repacks. Root cause was double:

1. **Sparse event cadence (torrent path)**: `SpeedChart` renders exactly `values.length` bars (`display = values.slice(-barCount)`), and `values` = `speedHistory` sampled once per `installer-progress` event that carries a changed `bytesRead` (`useActiveDownload.ts:119-130`). The torrent poll loop emitted progress ONLY on percent change (`pct != last_pct`), so a 30 GB repack at ~10 MB/s moved 1% every ~30s -> ~2 bars/min -> chart mostly blank. HTTP/debrid emits every 250ms (throttle in `debrid_installer.rs`), so it always looked dense.
2. **Chart rendered variable-length**: no placeholders, so young/fast downloads and the torrent path left a huge blank area on the right.

### Part 1 - Time-based torrent progress emits (`src-tauri/src/commands/torrent.rs`)
- New `TORRENT_PROGRESS_EMIT_SECS: u64 = 1` constant (next to `TORRENT_DATA_STALL_SECS`).
- Pure helper `progress_emit_due(last_pct, pct, elapsed_secs, throttle_secs) -> bool` - emits when the percent changed OR the throttle window elapsed (same budget the stall guards use).
- Poll loop: added `let mut last_emit: Option<Instant> = None;`; the downloading branch now computes `emit_due` from `last_emit.elapsed()` and emits when `pct != last_pct || due`, updating both `last_pct` and `last_emit = Some(Instant::now())`.
- `Initializing` branch untouched (still emits once at pct 0).
- 4 new regression tests: percent-change, throttle-elapsed, unchanged-within-throttle, first-real-percent (last_pct=-1 -> due).

### Part 2 - Fixed slot-grid SpeedChart (`src/components/downloads/ActiveDownloadCard.tsx`)
- `SpeedChart` now always renders exactly `barCount` slots (24 / 18 / 12 responsive): real samples left-aligned, trailing slots are zero-height placeholders (`bg-white/10`, `height: 0%`, key `empty-${n}`) that occupy width+gap so the chart always spans full width and visibly fills left -> right as samples arrive.
- Newest real bar still gets the `new-${values.length}` key + slide-in animation; grow-on-mount (`useGrowOnMount`) and `lf-download-chart-frozen`/pulse empty-state preserved.
- Tooltip now positions over the fixed grid: `left: ((hovered + 0.5) / barCount) * 100%` and only shows for slots with a real value.

### Not changed
- HTTP/debrid path, sample ring buffer, `useActiveDownload`, `InstallerProgressListener`, `DownloadQueueContext`.

### Build
- `cargo test` ? **241 passed / 0 failed** (237 previos + 4 nuevos; first attempt had a wrong test - `progress_emit_due_first_emit_is_due` passed `pct=-1` == last_pct -> false; fixed to `first_real_percent` with `pct=0` -> true)
- `cargo check` ? (only 2 pre-existing dead-code warnings)
- `tsc --noEmit` ? (only pre-existing extension/test errors, none in touched files)
- `vite build` ? (2.66s, Rolldown; verified in bundle: slot array with null placeholders, `empty-${n}` key + `bg-white/10` at `height:0%`, tooltip `(o+.5)/i*100`)

## Session - Real torrent seeds/peers (librqbit live snapshot) on the Active Download Card

### Goal
Replace the mocked seeds/peers on the Downloads hero with real swarm stats read from the librqbit session (`per_peer_stats_snapshot`), using a new dedicated `"installer-network"` Tauri event so the progress emit path stays untouched.

### Model
- **PEERS** = connected live peers (`snap.peers.len()`); **SEEDS** = live peers serving data (`counters.downloaded_and_checked_pieces > 0`).
- `PeerStatsFilter` is `Default` -> `PeerStatsFilterState::Live`, so `torrent.live()?.per_peer_stats_snapshot(Default::default())` reads the live registry without naming unexported filter types.

### Rust
- `src-tauri/src/models/install_progress.rs` — `InstallerNetworkEvent { job_id: String, peers: u32, seeds: u32 }` (Clone + Serialize).
- `src-tauri/src/utils/progress_utils.rs` — `emit_installer_network(app_handle, job_id, peers, seeds)` emits `"installer-network"`; `emit_installer_progress` signature unchanged (46 existing call sites).
- `src-tauri/src/commands/torrent.rs` — in `poll_torrent_until_done` downloading branch, inside the existing `if emit_due { ... }` (~1s throttle), computes `(peers, seeds)` via `torrent.live().map(...).unwrap_or((0,0))` and emits after the progress emit. Noise gated by the same cadence; `live()` is cheap (borrows peer registry).

### TS
- `src/types/download.ts` — `InstallerNetworkEvent { job_id, peers, seeds }` type; `peers?: number` / `seeds?: number` added to `DownloadJob` (backward compatible).
- `src/context/DownloadQueueContext.tsx` — `UpdateDownloadJobInput` gains `peers?`/`seeds?` (fixes the TS2353 from the listener passing unknown props).
- `src/components/downloads/InstallerProgressListener.tsx` — second Tauri listener for `"installer-network"` calling `updateJob(payload.job_id, { peers, seeds })`; separate `unlistenProgress`/`unlistenNetwork` cleanup.
- `src/hooks/useActiveDownload.ts` — `ActiveDownload` gains `peers?`/`seeds?`, mapped from `job.peers`/`job.seeds`.
- `src/components/downloads/ActiveDownloadCard.tsx` — Zone C swarm stats block (Seeds/Peers, tabular-nums, `"—"` fallback) between the speed chart and the controls, gated by `download.isTorrent && (download.peers != null || download.seeds != null)`.

### Build
- `cargo test --lib torrent` ? **28 passed / 0 failed** (torrent module)
- `cargo check` ? (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `tsc --noEmit` ? (zero errors in touched files; only pre-existing extension/test errors remain)
- `vite build` ? (2.43s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

## Session — Tools page → ToolsModal: per-game fix application, no persistent tracking

### Goal
Replace the Tools page (`src/pages/Tools.tsx`) with a modal opened from the game context menu (`GameLauncherTile`), the library detail page, and the sidebar. Remove all persistent fix tracking (`AppliedFix`, `APPLIED_FIXES_KEY`, `MAX_APPLIED_FIXES`, history, `gameId` in `applyTool`/`revertTool`). The modal only detects/applies fixes per game.

### Part 1: types.ts cleanup
- Removed `AppliedFix`, `APPLIED_FIXES_KEY`, `MAX_APPLIED_FIXES`.
- Kept `ToolId`, `ToolGameStatus`, `ToolDetectionResult`, `ToolApplyResult`, `ToolRegistrySnapshot`.

### Part 2: ToolManager.ts cleanup
- Removed `_appliedFixes`, `_loadAppliedFixes`/`_persistAppliedFixes`, `gameMeta` in `applyTool`, `gameId` in `revertTool`.
- Removed exports: `getAppliedFixes`, `getAppliedFixesForGame`, `isToolApplied`, `clearAppliedFixes`.
- Signatures now: `applyTool(toolId, gameInstallDir, extensionInstallDir)`, `revertTool(toolId, gameInstallDir)`.
- `resetToolManagerForTest` without fix cleanup; `getToolManagerDiagnostics` reduced to `{ toolCount, toolIds }`.
- `showSuccess` toasts kept in apply/revert.

### Part 3: tests updated
- `tools.test.ts`: removed "Applied fixes persistence" describe (4 tests), game-removal tests, "Tool constants"; `applyTool`/`revertTool` describes use new signatures.
- `criteriaToolManagerIntegration.test.ts`: does not use the fixes API — no changes.

### Part 4: ToolsModal.tsx (new)
- Props `{ open: boolean; game: LibraryGame | null; onClose: () => void }`.
- `initToolManager()` + `subscribeToolManager`; detection via `detectToolsForGame(game.installDir)` with `cancelled` flag.
- Default selection = not-applied fixes; `handleApply` iterates `applyTool(tool.id, game.installDir!, extensionDir)` + re-detection.
- Overlay via `createPortal`; applied fixes shown checked+disabled (no revert from modal); empty state; detection spinner.
- "Opciones avanzadas" = disabled visual placeholder (no version selector / install pipeline).
- Footer: `[Cancelar]` left, `[Aplicar Fixes]` right, `[✕]` right of title.

### Part 5: Triggers wired
- **GameLauncherTile.tsx**: "Game Fixes" item in Manage submenu (`setMenuOpen(false); setToolsModalOpen(true);`), `ToolsModal` rendered alongside `GameEditDialog`.
- **LibraryGameDetailPage.tsx** + **LibraryGameDetails.tsx**: optional `onOpenTools?: (game: LibraryGame) => void` prop; "Game Fixes" `DropdownItem` after "Manage Artwork"/"Refresh Artwork"; render with `displayGame = resolvedGame || selectedGame`.
- **SidebarLibraryList.tsx** (context menu — user correction: no nav icon in sidebar): "Game Fixes" `MenuItem` (`Wrench` icon) after "Browse Local Files"; opens `ToolsModal` with `menuGame`; `ToolsModal` rendered in collapsed/list/full branches alongside `GameEditDialog`.
- **Sidebar.tsx**: unchanged (no "Herramientas" nav item — the earlier item was removed per user clarification).

### Part 6: Tools page removed
- `src/pages/Tools.tsx` deleted; `App.tsx` without import / `KNOWN_PAGES` / `case "tools"`; `navigation.ts` without `| "tools"`.
- Remaining `"tools"` references are only the extension `ExtensionSurface = "settings" | "tools" | "library"` concept — unrelated.

### Key Files Changed
- `src/extensions/tools/types.ts` — cleaned
- `src/extensions/tools/ToolManager.ts` — cleaned
- `src/__tests__/tools.test.ts` — updated
- `src/components/tools/ToolsModal.tsx` — **new**
- `src/components/games/GameLauncherTile.tsx` — trigger 1 (+ sibling-modals fragment fix)
- `src/pages/LibraryGameDetailPage.tsx`, `src/components/library/LibraryGameDetails.tsx` — trigger 2
- `src/components/layout/SidebarLibraryList.tsx` — trigger 3 (context menu "Game Fixes")
- `src/pages/Tools.tsx` — deleted
- `src/App.tsx`, `src/types/navigation.ts` — no "tools" page

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vitest run` ✅ (only pre-existing `tools.test.ts extractToolConfig` failure: expected `{…(5)}` vs actual `{…(15)}`)
- `vite build` ✅ (only pre-existing chunk warnings)

## Session — Native fixes: Rust backend (GameFixManager + Third-party tools)

### Goal
Build the Rust backend for the native fixes feature: a `GameFixManager` handling SmokeAPI/Steamless/Online-Fix/Koaloader, plus third-party tool install/update/remove commands (`thirdparty.rs`). No frontend in this session.

### Part 1: `game_fix.rs` (core manager)
- **SmokeAPI**: versioned asset download from SmokeAPI releases; `get_game_fix_info` reports `smokeApiInstalled`/version; `apply_smoke_api_fix` (32/64 arch) copies SmokeAPI.dll + `.ini` variants into game dir; `unfix_smoke_api` removes them.
- **Steamless**: portable per-game unpacker (no global install needed); `install_steamless` downloads + runs per game; `unfix_steamless` removes `steamless.exe` + its output files (exe, ini, log).
- **Online-Fix**: patched-steam_api offline files; `apply_online_fix` copies `steam_api64.dll`/`steam_api.dll` + SteamConfig; `unfix_online_fix` restores originals from backup.
- **Koaloader**: plugin loader for game dirs; auto-installed into plugins dir when smoke_api/steamless present; versioned asset download.
- Backup semantics: fixes that overwrite `steam_api64.dll` back up the original once (restored by unfix); Idempotent apply; `[FIX][...]` progress events.
- `emit_fix_progress(app_handle, app_id, tool, progress, message)` — 31 emit sites with `{appId, tool, progress, message}` payload.
- Tool download/update emits use `appId: 0` (fetch 10%, download 30%, extract 60%); per-game applies use the real appId.

### Part 2: `thirdparty.rs` (tool registry)
- GitHub release resolver: `fetch_release_info` (repo owner/name from constants), asset URL extraction by extension; `download_and_extract_to_plugins` for `.7z`/`.zip`; `extract_archive_smart`.
- Commands: `install_third_party_tool`, `update_third_party_tool`, `remove_third_party_tool`, `get_third_party_tool_status`, `get_all_third_party_tools`, `get_third_party_tool_github_info`.
- Status returns `{ installed: bool, installedPath?, version? }`; install/update download to `<appData>/thirdparty/<tool>`, remove deletes dir.
- All 6 commands registered in `lib.rs` (L345-350).

### Part 3: Frontend
- 16 `game_fix` + 6 `thirdparty` TS bindings in `src/services/tauri.ts` (~L3244-3322); `GameFixInfo`/`GameFixResult`/`FixInstallationStatus` types at L3195-3235.
- User decision: ToolsModal gating = disabled-with-hint when tool missing/not applicable — do NOT auto-install missing tools; plus one-click "Quitar fix" via unfix commands.
- `LibraryGame` has NO `luaCount` — pass `luaCount: game.luaScripts?.length ?? 0` to `libraryGetGameFixInfo`.
- `npm run tauri dev` runs + registers fine.

### Part 4: Fix-progress toast listener (optional, added later)
- `src/components/fixes/FixProgressListener.tsx` — **new** — listens `library://fix-progress`, shows success toast at progress ≥100, one-shot info toast at first progress event per `tool:appId` (dedup via `seenInitial`); `TOOL_LABELS` maps `smoke_api`/`steamless`/`online_fix`/`koaloader`; returns null, unlisten on unmount.
- Mounted in `src/App.tsx` next to `<InstallerProgressListener />` (L350).

### Key Files Changed
- `src-tauri/src/commands/game_fix.rs` — **new** — GameFixManager core
- `src-tauri/src/commands/thirdparty.rs` — **new** — tool registry
- `src-tauri/src/lib.rs` — command registration
- `src/services/tauri.ts` — bindings + types
- `src/components/fixes/FixProgressListener.tsx` — **new** — progress toast listener
- `src/App.tsx` — mount FixProgressListener

### Build
- `cargo clippy --message-format short` ✅ (0 errors; game_fix.rs/thirdparty.rs/lib.rs at 0 warnings)
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (only pre-existing chunk warnings)

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

## Session — ToolsModal premium redesign: landscape hero + native-fix glass rows, footer buttons removed

### Goal
Redesign `ToolsModal.tsx` into a premium modal: remove the extension-tools section and the two footer buttons ("Cancelar" + "Aplicar Fixes", user-confirmed), add a landscape hero of the game with the hero-transition preference, glass rows for native fixes, Escape to close, and ambient background feed. Also fix the `goldberg_fork` third-party tool install asset (`.7z`, not `.zip`).

### Part 1 — Rust: `preferred_asset` on ToolDef (`thirdparty.rs`)
- `ToolDef` gained `preferred_asset: Option<&'static str>` (doc: repos that publish e.g. `emu-win-release.7z`).
- `TOOL_DEFS`: `goldberg_fork` → `Some("emu-win-release.7z")`; `smokeapi`/`steamless` → `None`.
- Asset selection (~250-260) priority: exact `preferred_asset` name match → `.zip` → `.7z`.
- `get_latest_github_release`/`get_github_release_tag` signatures gained `preferred_asset: Option<&str>`; all 3 call sites (~475 list-version, ~551 auto-detect, ~592 install) pass `def.preferred_asset`.
- `game_fix.rs`'s own local `get_latest_github_release` (no `preferred_asset`) untouched.

### Part 2 — ToolsModal rewrite (`src/components/tools/ToolsModal.tsx`)
- **Removed** all extension-tools code: `initToolManager`/`subscribeToolManager`/`getAllTools`/`detectToolsForGame`/`applyTool`, `Tool`/`ToolDetectionResult`/`ToolId` types, `TOOL_ICONS`/`getToolIcon`, detection/checkbox/placeholder UI, "Opciones avanzadas", `appliedCount`/`canApply`/`toggleSelected`/`handleApply`.
- **Removed** footer "Cancelar" + "Aplicar Fixes" buttons (user-confirmed); close is via ✕ header button + backdrop click + **Escape** key.
- **Landscape hero**: resolves `game.landscapePath ?? backgroundPath ?? coverPath` via `resolveGameMediaUrl(appId, path)`; `heroClass` from `heroTransitionStore` (`crossfade`→`animate-hero-crossfade-in`, `kenburns`→`animate-hero-kenburns-in`, `focus`→`animate-hero-focus-in`); `brightness-[0.35]` + bottom gradient into `--color-bg`; `heroError` state hides the layer.
- **Ambient feed**: `setAmbientSource("tools-modal", heroUrl)` on mount/art change; `clearAmbientSource("tools-modal")` on unmount only (mirrors GameHero pattern).
- **Native fixes section**: only renders when `!nativeInfo` has any applicable/applied row (`SmokeAPI` if steam_api present, `Steamless` if installed, `OnlineFix` if `hasOnlineFix`). Glass rows (`GLASS_ROW` bg-black/40 backdrop-blur) with accent icon chip, applied state (`CheckCircle2` + emerald border), busy spinner, "Aplicar fix"/"Quitar fix" buttons (`GLASS_BUTTON`), disabled-with-hint when tool not installed/not applicable.
- Styling uses hardcoded dark glass (bg-black/40, white text) consistent with the ActiveDownloadCard premium design — ignores theme intentionally.

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `tsc --noEmit` ✅ (only 22 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.46s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)

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

## Session — Achievement Watcher: autonomous unlock detection + progress.json + binary stats fallback

### Goal
Improve the achievement watcher to detect autonomous/unexpected achievement unlocks (e.g., via external unlocker apps, Steam background activity), adapting patterns from the reference implementation (Achievements-1.2.2). Fix the Stop button for some games.

### Problem
- **Stop button broken**: `if (!owned && isEpic)` prevented non-Epic non-owned games from stopping.
- **No startup baseline**: `ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP = false` meant snapshots never seeded from disk at boot — new installs always started empty.
- **Global progress index ignored**: `achievement_progress.json` (global cross-game progress index at `config/librarycache/achievement_progress.json`) was not wired into the watcher pipeline.
- **Binary stats files unhandled**: `appcache/stats/UserGameStats_*.bin` files written by Steam on achievement unlock existed but the TS pipeline had no fallback when `librarycache/<appid>.json` was missing or partial.
- **Partial librarycache gate blocked merge**: When `isPartial && !current`, the `patchUnlockedAchievements` function returned early without merging into the canonical summary or saving a snapshot.

### Fixes implemented

#### Fix 1: Stop button (`GameSessionContext.tsx`)
- Changed `if (!owned && isEpic)` to `if (!owned)` — all non-owned games can now be stopped.
- Removed unused `const isEpic`; added debug logging.

#### Fix 2: Partial librarycache gate (`achievementStore.ts:230`)
- Removed early return when `isPartial && !current`. Now creates minimal summary but falls through to the merge/snapshot section instead of returning early. Ensures even partial data is merged into the canonical summary and saved as snapshot.

#### Fix 3: Rust `extract_info` for `achievement_progress.json` (`achievement_watcher.rs:223-248`)
- Added special case in `extract_info` for `achievement_progress.json`: emits event with `source="achievement-progress"`, `appid=0` (global index, not per-game).
- Added `processAchievementProgressChange()` in `achievementWatcherService.ts` that reads the global progress index, diffs against `_progressIndexCache`, and triggers `processLibrarycacheChange` per changed appId.

#### Fix 4: Global progress index Rust command (`steam_achievements.rs`)
- Added `read_achievement_progress_index` Tauri command: reads/parses global `achievement_progress.json`, returns `Vec<AchievementProgressEntry>`.
- Added `AchievementProgressEntry` struct with `app_id`, `unlocked`, `total`, `percentage`, `all_unlocked`, `cache_time`, `vetted`.
- Registered in `lib.rs`.

#### Fix 5: Binary stats fallback in `processLibrarycacheChange` (`achievementWatcherService.ts:955+`)
- After `buildProgressPatchFromLibraryCache` returns null, now tries `parseUserGameStatsRaw` binary stats parse before falling back to heavy resolver refresh.
- Builds ProgressPatch from `achievement_entries` if found. Updated all `patch` references to `effectivePatch`.

#### Fix 6: Enable startup baseline scan (`achievementWatcherService.ts:49`)
- Changed `ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP = false` → `true`.
- `runBaselineScan()` (already implemented at L715) reads librarycache files and calls `processLibrarycacheChange` with `source="baseline"` to seed snapshots at boot without firing notifications.

### Key files changed
- `src/context/GameSessionContext.tsx` — Stop button fix + debug logging
- `src/services/achievementStore.ts` — Fixed partial librarycache gate (L230)
- `src/services/achievementWatcherService.ts` — Added `processAchievementProgressChange()`, `_progressIndexCache`, `parseUserGameStatsRaw` fallback, enabled baseline scan, updated event handler for `achievement-progress` source
- `src/services/tauri.ts` — Added `AchievementProgressEntry` interface + `readAchievementProgressIndex()` binding (binary stats binding pre-existing)
- `src-tauri/src/commands/achievement_watcher.rs` — `extract_info` now handles `achievement_progress.json`
- `src-tauri/src/commands/steam_achievements.rs` — Added `read_achievement_progress_index` command + `AchievementProgressEntry` struct
- `src-tauri/src/lib.rs` — Registered `read_achievement_progress_index` command

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `cargo test --lib` ✅ 271 passed / 1 failed (pre-existing `crc32_matches_javascript`)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)

## Session — SQLite-only migration: eliminate all JSON file I/O for fresh installs

### Goal
Remove JSON file writes and fallbacks from `appinfo.json`, `media_manifest.json`, and `startup_snapshot.json` so fresh installs use SQLite exclusively. Migration code runs once for upgraders, then JSON is dead.

### Problem
Fresh installs were writing JSON files to disk (`appinfo.json`, `media_manifest.json`, `startup_snapshot.json`) because commands had dual-write paths (SQLite + JSON) and read fallbacks (SQLite → JSON). This was unnecessary — SQLite is the only source of truth.

### Bug fixes (pre-migration)

#### `steam_index.rs` — collect all Steam library paths
- `collect_all_steamapps_dirs()` was only finding the primary Steam directory
- Added `collect_safe_fallback_steam_paths()` to also scan secondary Steam library folders (`E:\SteamLibrary`, `D:\SteamLibrary`, etc.)
- Fixed: 41 installed games now found (was 10)

#### `gameDetectionCache.ts` — extract `cache_value` from LibraryCacheEntry object
- `readFromSqlite()` was treating the Rust response as a string instead of extracting the `cache_value` field
- Was always returning `null` → detection cache never loaded from SQLite

### Schema additions (`sqlite_cache/mod.rs`)
- 5 new columns on `games` table: `provider TEXT DEFAULT 'steam'`, `media_json TEXT`, `media_sources_json TEXT`, `remote_json TEXT`, `user_data_json TEXT`
- New `media_manifests` table: `app_id TEXT PRIMARY KEY`, `version INTEGER`, `manifest_json TEXT NOT NULL`, `updated_at INTEGER`
- New `startup_snapshots` table: `id INTEGER PRIMARY KEY DEFAULT 1`, `version INTEGER`, `snapshot_json TEXT NOT NULL`, `updated_at INTEGER`
- `migrate_json_to_sqlite()` scans existing JSON files on first boot after update, copies to SQLite tables, runs once

### SQLite layers created
- `sqlite_cache/game_appinfo.rs` — `read_game_appinfo`, `read_batch_appinfo`, `write_game_appinfo`, `merge_and_write_appinfo`, `upsert_game_base`
- `sqlite_cache/media_manifests.rs` — `read_media_manifest_sqlite`, `read_media_manifests_batch_sqlite`, `write_media_manifest_sqlite`
- `sqlite_cache/startup_snapshots.rs` — `read_startup_snapshot_sqlite`, `write_startup_snapshot_sqlite`, `clear_startup_snapshot_sqlite`

### Commands re-cableados (`game_cache.rs`)
| Command | Before | After |
|---|---|---|
| `get_game_app_info` | SQLite → JSON fallback | SQLite only |
| `save_game_app_info` | SQLite + JSON dual-write | SQLite only |
| `read_canonical_appinfos` | SQLite → JSON fallback | SQLite batch only |
| `update_game_appinfo_media` | JSON read + write | SQLite no-op guard (field comparison) |
| `read_media_manifest` | SQLite → JSON fallback | SQLite only |
| `write_media_manifest` | SQLite + JSON dual-write | SQLite only |
| `get_media_manifests_batch` | SQLite → JSON fallback | SQLite batch only |

### Commands re-cableados (`startup_snapshot.rs`)
| Command | Before | After |
|---|---|---|
| `read_startup_snapshot` | SQLite → JSON fallback | SQLite only |
| `write_startup_snapshot` | SQLite + JSON dual-write | SQLite only |
| `clear_startup_snapshot` | SQLite + JSON dual-delete | SQLite only |

### No-op guard for `update_game_appinfo_media`
- Compares existing SQLite fields (`media`, `media_sources`, `remote`, `name`, `user_data`) against new values
- Skips write when all fields match → no unnecessary `[APPINFO_WRITE]` logs
- Added `PartialEq` derive to `GameAppInfo`, `GameMediaPaths`, `GameMediaSources`, `GameRemoteRefs`

### Key files changed
- `src-tauri/src/commands/sqlite_cache/mod.rs` — Schema + migration + module registration
- `src-tauri/src/commands/sqlite_cache/game_appinfo.rs` — New SQLite layer for GameAppInfo
- `src-tauri/src/commands/sqlite_cache/media_manifests.rs` — New SQLite layer for MediaManifest
- `src-tauri/src/commands/sqlite_cache/startup_snapshots.rs` — New SQLite layer for StartupSnapshot
- `src-tauri/src/commands/game_cache.rs` — 5 commands SQLite-only, no-op guard, removed JSON fallback/write
- `src-tauri/src/commands/startup_snapshot.rs` — 3 commands SQLite-only, removed JSON fallback/write
- `src-tauri/src/commands/steam_index.rs` — Fixed `collect_all_steamapps_dirs` fallback paths
- `src-tauri/src/models/game_cache.rs` — Added `PartialEq` to 4 structs
- `src/services/gameDetectionCache.ts` — Fixed `readFromSqlite()` to extract `cache_value` from LibraryCacheEntry object
- `src-tauri/src/lib.rs` — Registered `migrate_json_to_sqlite` module

### Fresh install flow
1. Boot → SQLite creates empty tables → `migrate_json_to_sqlite()` finds no JSON files → no-op
2. Steam scan → `scan_and_build_full_dataset()` writes to `games` table
3. Reads → SQLite direct (1 query vs 82 file reads)
4. Writes → SQLite direct (zero `fs::write`)

### Upgrader flow (migrating from JSON)
1. Boot → `migrate_json_to_sqlite()` detects existing appinfo.json files → copies to SQLite tables
2. Next boot → SQLite has data → reads go to SQLite

### Build
- `cargo check` ✅ (28 pre-existing warnings, 0 errors)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅

## Session — P0+P1+P2 JSON→SQLite migration: eliminate all remaining JSON file I/O

### Goal
Migrate all remaining JSON file stores to SQLite so fresh installs use SQLite exclusively. Covers playtime, source availability, store cache, provider status, debrid games, manual games, store details, library game details, and store blobs.

### Schema additions (`sqlite_cache/mod.rs`)

**11 new tables:**

| Table | DB | Type | Purpose |
|-------|-----|------|---------|
| `playtime_entries` | core.db | Per-game rows | Playtime store (was `playtime.json`) |
| `playtime_sessions` | core.db | Per-session rows | Session history per game |
| `source_availability` | store.db | Per-game rows | Source index (was `source-index.json`) |
| `store_appinfo` | store.db | Per-game rows | Store appdetails cache (was `store/appinfo.json`) |
| `store_media_cache` | store.db | Per-game rows | Store media metadata (was `store/media/*/metadata.json`) |
| `provider_status_snapshot` | store.db | Singleton row | Provider status index (was `snapshot.json`) |
| `debrid_games` | core.db | Singleton row | Debrid game registry (was `debrid-games.json`) |
| `manual_games` | core.db | Singleton row | Manual game registry (was `manual-games.json`) |
| `store_details` | core.db | Per-game rows | Store details (was `store-details.json`) |
| `library_game_details` | core.db | Per-game rows | Library game details (was `library/details/*.json`) |

**5 blobs moved to `game_catalog_blobs`:** `discovery-index`, `catalog-sections-cache`, `sgdb-artwork-cache` (store.db); `scan-state`, `library-cache-index` (store.db)

### SQLite layers created (`sqlite_cache/`)

| File | Functions |
|------|-----------|
| `playtime.rs` | `read_all_playtime_entries`, `upsert_playtime_entry`, `read_playtime_sessions_for_game`, `upsert_playtime_session`, `delete_playtime_sessions_older_than` |
| `source_availability.rs` | `read_source_availability`, `write_source_availability`, `read_all_source_availability`, `delete_source_availability` |
| `store_appinfo_cache.rs` | `read_store_appinfo`, `write_store_appinfo`, `read_all_store_appinfo`, `delete_store_appinfo` |
| `store_media_cache.rs` | `read_store_media_cache`, `write_store_media_cache`, `read_all_store_media_cache`, `delete_store_media_cache` |
| `provider_snapshot.rs` | `read_provider_status_snapshot`, `write_provider_status_snapshot` |
| `debrid_games_cache.rs` | `read_debrid_games`, `write_debrid_games` |
| `manual_games_cache.rs` | `read_manual_games`, `write_manual_games` |
| `store_details_cache.rs` | `read_store_details`, `write_store_details`, `read_library_game_details`, `write_library_game_details` |

### Commands re-cableados

| File | Commands migrated |
|------|------------------|
| `playtime.rs` | 5 commands: `read/write_playtime_store`, `record_start/end`, `import_external` — full rewrite from JSON store to SQLite queries |
| `debrid_games.rs` | 3 commands: `read/write/backup_debrid_games` — singleton blob |
| `manual_games.rs` | 3 commands: `read/write/backup_manual_games` — singleton blob |
| `provider_status_cache.rs` | 2 commands: `read/write_provider_status_snapshot` — singleton blob; per-game status already in SQLite |
| `source_cache.rs` | 2 commands: `read/write_source_availability_index` — per-game rows |
| `store_cache.rs` | 8 commands: appinfo→`store_appinfo`, media→`store_media_cache`, discovery/catalog/sgdb→`game_catalog_blobs` |
| `game_cache.rs` | 2 commands: `get/save_store_details` → SQLite; GameArtwork 3 commands deprecated (return Ok/None) |
| `library_cache.rs` | 2 commands: `read/write_library_game_details` → SQLite; LibraryAppInfoMap/media/cache_index all deprecated |

### Dead code eliminated
- `library_cache.rs`: `read/write/update_library_appinfo` → no-op (superseded by `games` table)
- `library_cache.rs`: `library_*_game_media_cache` → no-op (superseded by `media_manifests` table)
- `library_cache.rs`: `read/write_library_cache_index` → no-op
- `library_cache.rs`: `cache_library_game_media` → no-op (downloads removed)
- `game_cache.rs`: `get/save/update_game_artwork` → deprecated (was duplicating GameAppInfo.media)

### Migration (`migrate_remaining_json_to_sqlite`)
- Runs once on first boot after update (same pattern as existing `migrate_json_to_sqlite`)
- Reads each JSON file, parses, writes to SQLite tables
- Per-game files: iterates `games/steam/*/store-details.json`, `library/details/*.json`
- Singleton files: reads `debrid-games.json`, `manual-games.json`, `provider-status/snapshot.json`, `store/appinfo.json`, `sources/source-index.json`
- Blobs: reads `discovery-index.json`, `catalog-sections-cache.json`, `sgdb-artwork-cache.json`
- Idempotent: checks count before migrating

### Key files changed
- `src-tauri/src/commands/sqlite_cache/mod.rs` — 11 new tables, `migrate_remaining_json_to_sqlite`, module registrations
- `src-tauri/src/commands/sqlite_cache/playtime.rs` — **new** — SQLite layer for playtime
- `src-tauri/src/commands/sqlite_cache/source_availability.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/store_appinfo_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/store_media_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/provider_snapshot.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/debrid_games_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/manual_games_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/store_details_cache.rs` — **new**
- `src-tauri/src/commands/playtime.rs` — full rewrite: JSON → SQLite queries
- `src-tauri/src/commands/debrid_games.rs` — JSON → SQLite singleton
- `src-tauri/src/commands/manual_games.rs` — JSON → SQLite singleton
- `src-tauri/src/commands/provider_status_cache.rs` — snapshot → SQLite singleton
- `src-tauri/src/commands/source_cache.rs` — JSON → SQLite per-game rows
- `src-tauri/src/commands/store_cache.rs` — appinfo/media/blobs → SQLite
- `src-tauri/src/commands/game_cache.rs` — StoreDetails → SQLite, GameArtwork deprecated
- `src-tauri/src/commands/library_cache.rs` — LibraryGameDetails → SQLite, dead functions deprecated

### Build
- `cargo check` ✅ (47 pre-existing warnings, 0 errors)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅

### What was NOT migrated (intentional)
- `backup.rs` — JSON IS the export format
- `game_fix.rs` — plain-text fix logs inside game dirs
- `debrid_installer.rs` — temporary `.part.meta` checkpoints
- `epic.rs` / `steam_user_stats.rs` — external read-only files
- `thirdparty.rs` / `extension_lifecycle.rs` — infrequent singletons (P3)
- `installed_games_registry.rs` — infrequent singleton (P3)
- `hydra_source.rs` — infrequent (P3)

## Session — P0+P1+P2 JSON→SQLite migration: eliminate all remaining JSON file I/O

### Goal
Migrate all remaining JSON file stores to SQLite so fresh installs use SQLite exclusively. Covers playtime, source availability, store cache, provider status, debrid games, manual games, store details, library game details, and store blobs.

### Schema additions (`sqlite_cache/mod.rs`)

**11 new tables:**

| Table | DB | Type | Purpose |
|-------|-----|------|---------|
| `playtime_entries` | core.db | Per-game rows | Playtime store (was `playtime.json`) |
| `playtime_sessions` | core.db | Per-session rows | Session history per game |
| `source_availability` | store.db | Per-game rows | Source index (was `source-index.json`) |
| `store_appinfo` | store.db | Per-game rows | Store appdetails cache (was `store/appinfo.json`) |
| `store_media_cache` | store.db | Per-game rows | Store media metadata (was `store/media/*/metadata.json`) |
| `provider_status_snapshot` | store.db | Singleton row | Provider status index (was `snapshot.json`) |
| `debrid_games` | core.db | Singleton row | Debrid game registry (was `debrid-games.json`) |
| `manual_games` | core.db | Singleton row | Manual game registry (was `manual-games.json`) |
| `store_details` | core.db | Per-game rows | Store details (was `store-details.json`) |
| `library_game_details` | core.db | Per-game rows | Library game details (was `library/details/*.json`) |

**5 blobs moved to `game_catalog_blobs`:** `discovery-index`, `catalog-sections-cache`, `sgdb-artwork-cache` (store.db); `scan-state`, `library-cache-index` (store.db)

### SQLite layers created (`sqlite_cache/`)

| File | Functions |
|------|-----------|
| `playtime.rs` | `read_all_playtime_entries`, `upsert_playtime_entry`, `read_playtime_sessions_for_game`, `upsert_playtime_session`, `delete_playtime_sessions_older_than` |
| `source_availability.rs` | `read_source_availability`, `write_source_availability`, `read_all_source_availability`, `delete_source_availability` |
| `store_appinfo_cache.rs` | `read_store_appinfo`, `write_store_appinfo`, `read_all_store_appinfo`, `delete_store_appinfo` |
| `store_media_cache.rs` | `read_store_media_cache`, `write_store_media_cache`, `read_all_store_media_cache`, `delete_store_media_cache` |
| `provider_snapshot.rs` | `read_provider_status_snapshot`, `write_provider_status_snapshot` |
| `debrid_games_cache.rs` | `read_debrid_games`, `write_debrid_games` |
| `manual_games_cache.rs` | `read_manual_games`, `write_manual_games` |
| `store_details_cache.rs` | `read_store_details`, `write_store_details`, `read_library_game_details`, `write_library_game_details` |

### Commands re-cableados

| File | Commands migrated |
|------|------------------|
| `playtime.rs` | 5 commands: `read/write_playtime_store`, `record_start/end`, `import_external` — full rewrite from JSON store to SQLite queries |
| `debrid_games.rs` | 3 commands: `read/write/backup_debrid_games` — singleton blob |
| `manual_games.rs` | 3 commands: `read/write/backup_manual_games` — singleton blob |
| `provider_status_cache.rs` | 2 commands: `read/write_provider_status_snapshot` — singleton blob; per-game status already in SQLite |
| `source_cache.rs` | 2 commands: `read/write_source_availability_index` — per-game rows |
| `store_cache.rs` | 8 commands: appinfo→`store_appinfo`, media→`store_media_cache`, discovery/catalog/sgdb→`game_catalog_blobs` |
| `game_cache.rs` | 2 commands: `get/save_store_details` → SQLite; GameArtwork 3 commands deprecated (return Ok/None) |
| `library_cache.rs` | 2 commands: `read/write_library_game_details` → SQLite; LibraryAppInfoMap/media/cache_index all deprecated |

### Dead code eliminated
- `library_cache.rs`: `read/write/update_library_appinfo` → no-op (superseded by `games` table)
- `library_cache.rs`: `library_*_game_media_cache` → no-op (superseded by `media_manifests` table)
- `library_cache.rs`: `read/write_library_cache_index` → no-op
- `library_cache.rs`: `cache_library_game_media` → no-op (downloads removed)
- `game_cache.rs`: `get/save/update_game_artwork` → deprecated (was duplicating GameAppInfo.media)

### Migration (`migrate_remaining_json_to_sqlite`)
- Runs once on first boot after update (same pattern as existing `migrate_json_to_sqlite`)
- Reads each JSON file, parses, writes to SQLite tables
- Per-game files: iterates `games/steam/*/store-details.json`, `library/details/*.json`
- Singleton files: reads `debrid-games.json`, `manual-games.json`, `provider-status/snapshot.json`, `store/appinfo.json`, `sources/source-index.json`
- Blobs: reads `discovery-index.json`, `catalog-sections-cache.json`, `sgdb-artwork-cache.json`
- Idempotent: checks count before migrating

### Key files changed
- `src-tauri/src/commands/sqlite_cache/mod.rs` — 11 new tables, `migrate_remaining_json_to_sqlite`, module registrations
- `src-tauri/src/commands/sqlite_cache/playtime.rs` — **new** — SQLite layer for playtime
- `src-tauri/src/commands/sqlite_cache/source_availability.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/store_appinfo_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/store_media_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/provider_snapshot.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/debrid_games_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/manual_games_cache.rs` — **new**
- `src-tauri/src/commands/sqlite_cache/store_details_cache.rs` — **new**
- `src-tauri/src/commands/playtime.rs` — full rewrite: JSON → SQLite queries
- `src-tauri/src/commands/debrid_games.rs` — JSON → SQLite singleton
- `src-tauri/src/commands/manual_games.rs` — JSON → SQLite singleton
- `src-tauri/src/commands/provider_status_cache.rs` — snapshot → SQLite singleton
- `src-tauri/src/commands/source_cache.rs` — JSON → SQLite per-game rows
- `src-tauri/src/commands/store_cache.rs` — appinfo/media/blobs → SQLite
- `src-tauri/src/commands/game_cache.rs` — StoreDetails → SQLite, GameArtwork deprecated
- `src-tauri/src/commands/library_cache.rs` — LibraryGameDetails → SQLite, dead functions deprecated

### Build
- `cargo check` ✅ (47 pre-existing warnings, 0 errors)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅

### What was NOT migrated (intentional)
- `backup.rs` — JSON IS the export format
- `game_fix.rs` — plain-text fix logs inside game dirs
- `debrid_installer.rs` — temporary `.part.meta` checkpoints
- `epic.rs` / `steam_user_stats.rs` — external read-only files
- `thirdparty.rs` / `extension_lifecycle.rs` — infrequent singletons (P3)
- `installed_games_registry.rs` — infrequent singleton (P3)
- `hydra_source.rs` — infrequent (P3)

## Session — Boot performance: batch name writes + debrid table fix + SQLite-first reads

### Problem
1. **debrid_games table in wrong DB** — created in `init_store_tables` (store.db) but commands use `SqliteCoreDb` (core.db)
2. **Boot I/O massif** — N sequential `updateGameAppinfoMediaIfChanged` calls for N games with placeholder titles, each = 1 Tauri IPC + 10-15 fs ops + 2 Mutex locks
3. **update_game_appinfo_media reads JSON file** — stale path reads on fresh boot

### Fixes

#### Fix 1: debrid_games table → core.db
- Moved `debrid_games_cache::create_tables` from `init_store_tables` to `init_core_tables` in `sqlite_cache/mod.rs`

#### Fix 2: SQLite-first appinfo read
- `update_game_appinfo_media` now reads from SQLite first via `read_game_appinfo(&db, &app_id)` 
- Falls back to JSON file only when SQLite returns None (upgraders)
- Store-details name resolution also uses SQLite

#### Fix 3: batch_update_game_names command
- New Rust command: single SQLite transaction for all name updates
- Only updates when current name is empty/placeholder (no overwrite)
- Reduces N sequential IPC calls to 1

#### Fix 4: Boot stages 3.5/4.5 use batch
- Stage 3.5 (enrich-snapshot-titles): collects names, calls `batchUpdateGameNames` once
- Stage 4.5 (reconcile-lua-games): collects names, calls `batchUpdateGameNames` once
- Eliminates ~60-90 Tauri IPC invocations on fresh boot

### Key files changed
- `src-tauri/src/commands/sqlite_cache/mod.rs` — debrid_games moved to init_core_tables
- `src-tauri/src/commands/game_cache.rs` — SQLite-first read + batch_update_game_names
- `src-tauri/src/lib.rs` — registered batch_update_game_names
- `src/services/tauri.ts` — batchUpdateGameNames TS binding
- `src/services/appBootCoordinator.ts` — stages 3.5/4.5 use batch writes

### Build
- `cargo check` ✅
- `tsc --noEmit` ✅

## Session — SQLite → React reactive notification bus (dataChangeBus)

### Problem
SQLite writes (games, media, appinfo) don't trigger React re-renders. UI shows stale/empty data until F5. Three symptoms:
1. Images don't appear after download completes
2. Library empty on first boot (background scan populates SQLite but context doesn't re-read)
3. General staleness requiring F5

### Solution: Unified change notification

#### Rust side: `emit_data_changed()`
- New function in `progress_utils.rs` emits `sqlite-data-changed` Tauri event
- `steam_index.rs` emits `games-upserted` after `scan_and_build_full_dataset`
- `game_cache.rs` emits `appinfo-changed` / `names-upserted` after writes

#### TS side: `dataChangeBus.ts` (new)
- `subscribeDataChanges(handler)` — returns unsubscribe fn
- `initDataChangeBus()` — mounts in App.tsx, listens to `sqlite-data-changed`
- Fans out to registered handlers

#### React integration
- `LibraryGamesContext.tsx` subscribes to `games-upserted` → reads directly from SQLite via `readAllGames()` + `loadSteamGameIndex()` + `indexEntryToLibraryGame()`
- Preserves Lua state, metadata, favorites from existing games
- `applyGamesSafely(games, "sqlite-refresh")` applies without re-scanning Steam

### Key files changed
- `src-tauri/src/utils/progress_utils.rs` — `emit_data_changed()`
- `src-tauri/src/commands/steam_index.rs` — emit games-upserted
- `src-tauri/src/commands/game_cache.rs` — emit appinfo-changed/names-upserted
- `src/services/dataChangeBus.ts` — **new** — TS event bus
- `src/App.tsx` — mount bus on startup
- `src/context/LibraryGamesContext.tsx` — subscribe to games-upserted → SQLite read + apply

### Build
- `cargo check` ✅
- `tsc --noEmit` ✅

## Session — Boot scan cascade fix + force initial scan

### Problem
1. **10+ concurrent Steam scans** — `scanSteamInstalledGames` called from 4 different places simultaneously, each taking ~3s
2. **Splash freeze** — concurrent scans block Tauri thread pool
3. **TTL blocks first scan** — `_lastSteamScanAt` persists in memory across cache clears, so `resolveLibraryGames` returns empty on fresh boot

### Fixes

#### Global scan guard
- `scanSteamInstalledGames` in `tauri.ts` now deduplicates concurrent calls via shared Promise
- Second caller waits for first scan result instead of starting new scan
- Reduces 10+ concurrent scans to 1

#### Force initial scan
- Initial `resolveLibraryGames` call in `LibraryGamesContext.load()` now uses `force: true`
- Bypasses TTL check that was blocking first scan after cache clear

#### Remove redundant triggerBackgroundScan
- Removed `triggerBackgroundScan()` call from context load — it was causing a second redundant scan
- The initial scan via `resolveLibraryGames` already returns all games
- `triggerBackgroundScan` was also emitting `games-upserted` which triggered a third scan

### Key files changed
- `src/services/tauri.ts` — global scan guard in `scanSteamInstalledGames`
- `src/context/LibraryGamesContext.tsx` — `force: true` on initial scan, removed triggerBackgroundScan

### Build
- `cargo check` ✅
- `tsc --noEmit` ✅

## Session — TopBar navigation history + sidebar refactor + Store metadata merge fix

### Goal
Add browser-like back/forward navigation to the TopBar, restructure layout so TopBar spans full width above sidebar, fix the Store metadata flash-to-skeleton bug when navigating from global search, and unify the SearchProvider.

### Part 1: Navigation history (`src/services/navigationHistory.ts` — **new**)
- Module-level `history: AppPage[]` stack with `currentIndex`
- `pushToHistory(page)` — truncates forward history, deduplicates consecutive
- `goBack()` / `goForward()` — return the target page
- `subscribeHistory` / `getHistorySnapshot` — `useSyncExternalStore` contract
- No localStorage persistence (resets on restart)

### Part 2: TopBar ← → buttons (`src/components/layout/TopBar.tsx`)
- Logo moved to leftmost position (was in Sidebar header)
- `<ChevronLeft>` / `<ChevronRight>` buttons using `historyGoBack` / `historyGoForward`
- Disabled state when `!historySnapshot.canGoBack` / `canGoForward`
- Removed: `BackButton` component, `BackButtonContext` imports, `onBack`/`backLabel` props, `onOpenSidebar`/`sidebarDrawerMode` props

### Part 3: Sidebar simplified (`src/components/layout/Sidebar.tsx`)
- Removed: header block (logo, title, collapse/expand toggle, `PanelLeftOpen`/`PanelLeftClose`, `Flame` icon)
- Drawer mode: close button moved to `absolute right-3 top-3` (was in header)
- Removed `onToggleCollapse` prop (collapse now via TopBar hamburger only)

### Part 4: AppLayout restructure (`src/components/layout/AppLayout.tsx`)
- TopBar rendered **above** sidebar as `relative z-20` full-width row
- Sidebar + content below as `relative z-10 flex-1`
- Removed: `BackButtonProvider`, `handleToggleCollapse`, `handleOpenSidebar`
- **Unified `SearchProvider`** — single instance wraps both TopBar and page content (was two separate instances → search query never reached GlobalSearchResults)

### Part 5: Store metadata merge fix (`src/pages/Store.tsx`)
- **Root cause**: batch metadata effect `setStoreMetadataByAppId(metadata)` did full replacement; detail game excluded from `visibleAppIds` → metadata wiped → skeleton
- **Fix**: `setStoreMetadataByAppId((prev) => ({ ...prev, ...metadata }))` — merge instead of replace
- Empty-visibleAppIds path preserves detail game metadata
- Error path no longer wipes entire map
- Detail metadata fetch extracted to `fetchDetailMetadata()` with 2s retry
- Change detection guard simplified (no more key-count comparison)
- Detail game back handler via `lumaforge-store-detail-back` custom event
- Search dedup ref prevents re-opening same game details

### Part 6: StoreGameDetailsPage cleanup (`src/components/store/StoreGameDetailsPage.tsx`)
- Removed per-render `console.log` statements (PROPS_RECEIVED, SOURCE_CHECK_STATE, REVIEWS_STATE, SUMMARY_PROPS_FORWARD)
- Gated remaining logs behind `ENABLE_VERBOSE_SOURCE_LOGS`
- Metadata timeout reduced from 30s error state to 5s slow warning
- Added subtle loading indicator during metadata fetch

### Part 7: Search clear fix (`src/components/packages/PackagesToolbarSearch.tsx`)
- `handleSelectItem` now calls `setQuery("")` to clear the input after selection
- `TopBar.handleSelectItem` no longer calls `setQuery(item.title)` or auto-focuses after navigation

### Part 8: Global search navigation (`src/App.tsx`, `src/types/navigation.ts`)
- Added `"store-detail"` virtual page type
- `handleNavigate` supports `fromHistory` param for ← → buttons
- `lumaforge-store-detail-open` / `lumaforge-store-detail-back` custom events for Store inline detail navigation
- `pushToHistory` called on all forward navigation (not ← →)

### Part 9: Other files
- `src/pages/GameDetails.tsx` — removed `BackButtonContext` usage, `onBack` now optional
- `src/pages/GlobalSearchResults.tsx` — removed `BackButtonContext` usage
- `src/pages/LibraryGameDetailPage.tsx` — removed `BackButtonContext` usage
- `src/services/tauri.ts` — added 25s timeout wrapper for `resolveSteamAppMetadata`

### Key Files Changed
- `src/services/navigationHistory.ts` — **new** — browser-like back/forward stack
- `src/components/layout/TopBar.tsx` — logo + nav buttons + removed BackButton/sidebar deps
- `src/components/layout/Sidebar.tsx` — removed header/logo/collapse
- `src/components/layout/AppLayout.tsx` — layout restructure + unified SearchProvider
- `src/pages/Store.tsx` — metadata merge fix + detail fetch retry + back event
- `src/components/store/StoreGameDetailsPage.tsx` — log cleanup + loading indicator
- `src/components/packages/PackagesToolbarSearch.tsx` — query clear on select
- `src/App.tsx` — store-detail page type + history push + back event listener
- `src/types/navigation.ts` — added `"store-detail"`
- `src/pages/GameDetails.tsx` — removed BackButtonContext
- `src/pages/GlobalSearchResults.tsx` — removed BackButtonContext
- `src/pages/LibraryGameDetailPage.tsx` — removed BackButtonContext
- `src/services/tauri.ts` — metadata timeout wrapper

### Build
- `cargo check` ✅
- `tsc --noEmit` ✅
- `vite build` ✅

## Session — Store sub-view back/forward navigation + search fixes

### Goal
Fix TopBar ← → navigation for Store sub-views (Repacks tab, View All sections, game detail, search) and fix global search showing empty query. Add sub-view stack so detail-to-detail back navigation works correctly.

### Part 1: Tagged history entries (`src/services/navigationHistory.ts`)
- Entries changed from `AppPage` strings to `{ page: AppPage; tag?: string }` objects
- `pushToHistory(page, tag?)` — dedup only when both page AND tag match
- `goBack()` / `goForward()` return `HistoryEntry` objects

### Part 2: TopBar back/forward with tags (`src/components/layout/TopBar.tsx`)
- `handleGoBack` reads `HistoryEntry`; if same page + tag, dispatches `lumaforge-store-detail-back`
- `handleGoForward` dispatches `lumaforge-store-forward` with `{ detail: { tag } }`
- Removed auto-focus after search selection (was re-opening dropdown)

### Part 3: Store sub-view stack (`src/pages/Store.tsx`)
- `StoreSubView` type: `"tab"` | `"section"` | `"search"` | `"detail"` (detail includes full `PackageGame`)
- `_subViewStackRef` tracks all sub-view openings in order
- `pushStoreHistory(tag)` dispatches `lumaforge-store-push-history` for App.tsx
- `pushSubView()` / `popSubView()` / `clearSubViewStack()` helpers

### Part 4: Back handler — detail-to-detail restoration
- Pops top of stack, peeks at remaining entries
- If another `"detail"` is below, restores that game (`setSelectedDetailGame(newTop.game)`)
- If no detail below, clears detail panel (`setSelectedDetailGame(null)`)
- Tab change clears entire stack

### Part 5: Forward handler
- Listens to `lumaforge-store-forward` event
- Parses tag string: `detail:A` → find game in `browseGames`/`providerOverlay` → push + restore
- `section:X` → push + `setActiveSectionId`; `tab:X` → push + `setActiveStoreTab`

### Part 6: Search fixes
- **Global search empty query**: `AppLayout.tsx` had TWO separate `SearchProvider` instances (TopBar and page content). Unified to single `SearchProvider` wrapping both.
- **Search input not clearing**: `PackagesToolbarSearch.handleSelectItem` now calls `setQuery("")` to clear local `useGameSearch` state.

### Part 7: App.tsx generalization
- `lumaforge-store-detail-open` replaced by `lumaforge-store-push-history` event
- Removed dead `store-detail` virtual page type from `AppPage` union

### Key Files Changed
- `src/services/navigationHistory.ts` — tagged entries `{ page, tag? }`
- `src/components/layout/TopBar.tsx` — tagged back/forward, removed auto-focus
- `src/pages/Store.tsx` — sub-view stack, back/forward handlers, `openDetailsForGame` pushes game
- `src/App.tsx` — `lumaforge-store-push-history` listener, removed `store-detail` page type
- `src/types/navigation.ts` — removed `"store-detail"`
- `src/components/layout/AppLayout.tsx` — unified single `SearchProvider`
- `src/components/packages/PackagesToolbarSearch.tsx` — `setQuery("")` in `handleSelectItem`

### Build
- `cargo check` ✅
- `tsc --noEmit` ✅
- `vite build` ✅

## Session — Library hover preview card (Steam-style)

### Goal
Add a Steam-style hover preview popup to Library grid cards showing screenshot carousel, playtime, and last played time.

### Part 1: `src/components/games/GameHoverPreview.tsx` (new)
- Portal-based popup rendered to `document.body` via `createPortal`
- Positioned to the right of the hovered card (Steam-style), with viewport boundary clamping
- **Screenshot carousel**: 2 `<img>` stacked (prev + current) with `opacity` crossfade (400ms), 5s per screenshot, dots indicator (max 8 dots), pauses on hover
- **Fallback**: no screenshots → cover/landscape/background art as static image
- **Playtime**: reads `getPlaytimeEntryByAppId()` → `formatPlaytime()` + relative `lastPlayedAt`
- **Info**: game title, developer, publisher
- Inline SVG icons for Clock/Calendar (no lucide dependency)

### Part 2: `src/components/games/GameLauncherTile.tsx`
- Added `onHoverStart?: (game, rect)` and `onHoverEnd?: () => void` props
- Added `useCallback` import, `rootRef` for DOMRect measurement
- Combined ref merge: `(node) => { ref.current = node; rootRef.current = node; }`
- `handleHoverEnter` calls both prefetch + `onHoverStart` with `getBoundingClientRect()`
- `handleHoverLeave` calls both prefetch cleanup + `onHoverEnd`
- Memo comparison updated to include new callback props

### Part 3: `src/pages/Library.tsx`
- Added hover state: `hoveredGame`, `gamePosition`, `hoverTimerRef`
- 500ms enter delay before showing popup (debounced via `setTimeout`)
- `handleHoverStart` / `handleHoverEnd` callbacks passed to all `GameLauncherTile` instances
- `GameHoverPreview` rendered when `hoveredGame && gamePosition` are set
- Preview pauses on mouse-enter, hides on mouse-leave

### Part 4: `src/App.css`
- `@keyframes hoverPreviewFadeIn` / `hoverPreviewFadeOut` for crossfade
- `prefers-reduced-motion` guard disables animation

### Data sources (no additional fetching)
| Data | Source |
|------|--------|
| Screenshots | `game.metadata?.screenshots[]` (Steam CDN URLs) |
| Playtime | `getPlaytimeEntryByAppId(appId).totalPlaytimeSeconds` |
| Last played | `getPlaytimeEntryByAppId(appId).lastPlayedAt` (Unix seconds) |
| Title | `game.title` |
| Developer/Publisher | `game.metadata?.developer`, `game.metadata?.publishers` |

### Key Files Changed
- `src/components/games/GameHoverPreview.tsx` — **new** — portal popup with carousel
- `src/components/games/GameLauncherTile.tsx` — `onHoverStart`/`onHoverEnd` props + combined ref
- `src/pages/Library.tsx` — hover state management + preview rendering
- `src/App.css` — crossfade keyframes

### Build
- `tsc --noEmit` ✅
- `vite build` ✅

## Session — Settings simplification + auto-sync hardcode + HUD toggle + toast dedup

### Goal
Remove overly-technical settings from user-facing UI, hardcode auto-sync achievement ON, add GameSessionHUD toggle, and fix duplicate achievement toasts.

### Part 1: Remove HomeLayout Performance tab
- `HomeLayoutEditor.tsx` — removed Performance tab from tabs array, removed `resetPerformance()`, removed `Timer` import
- `Home.tsx` — removed `DeferredSection` component, removed `deferredRendering`/`initialVisibleSections` variables, `SectionWrap` now always renders children immediately
- Removed `dashboardDeferredRendering` and `dashboardInitialVisibleSections` settings from user-facing UI (kept in types/defaults for backward compatibility)

### Part 2: Hardcode auto-sync achievement ON
- `achievementAutoFlags.ts` — `ACHIEVEMENT_AUTO_SYNC_ENABLED = true` (was `false`, making the Settings toggle a no-op)
- `achievementAutoSyncService.ts` — default `intervalSeconds = 30` (was `10`, UI said `300`, service capped at `60`)
- `Settings.tsx` — removed "Auto-sync progress" toggle and "Sync interval" input from Notifications section

### Part 3: GameSessionHUD toggle
- `settings.ts` — added `gameSessionHudEnabled: boolean` to `AppSettings`
- `SettingsContext.tsx` — default `gameSessionHudEnabled: true`
- `Settings.tsx` — added toggle in Session Overlay section: "Game session HUD — Show a floating pill during gameplay with game info, elapsed time, and stop/resume buttons"
- `App.tsx` — gated `GameSessionHUD` with `settings.gameSessionHudEnabled !== false`

### Part 4: Achievement toast dedup
- `library/AchievementToast.tsx` — added session-level dedup (`_shownThisSession` Set keyed by `appId:apiName`) with 5-minute auto-cleanup to prevent memory leak
- Prevents duplicate toasts when watcher + session-end resolver fire for the same achievement

### Part 5: Settings.tsx JSX fix
- Fixed pre-existing missing `</label>` close tag in Bing Search API key section

### Key Files Changed
- `src/components/settings/HomeLayoutEditor.tsx` — removed Performance tab
- `src/pages/Home.tsx` — removed DeferredSection, deferredRendering, SectionWrap passthrough
- `src/services/achievementAutoFlags.ts` — ACHIEVEMENT_AUTO_SYNC_ENABLED = true
- `src/services/achievementAutoSyncService.ts` — intervalSeconds = 30
- `src/pages/Settings.tsx` — removed auto-sync config, added HUD toggle, fixed JSX
- `src/types/settings.ts` — added gameSessionHudEnabled
- `src/context/SettingsContext.tsx` — default gameSessionHudEnabled: true
- `src/App.tsx` — gated GameSessionHUD
- `src/components/library/AchievementToast.tsx` — session dedup

### Build
- `tsc --noEmit` ✅
- `vite build` ✅
