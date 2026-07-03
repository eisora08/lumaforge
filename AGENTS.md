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
