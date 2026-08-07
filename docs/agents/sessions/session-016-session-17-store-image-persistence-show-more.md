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
