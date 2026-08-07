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
