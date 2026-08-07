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
