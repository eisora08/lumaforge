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
