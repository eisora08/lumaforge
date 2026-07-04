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
