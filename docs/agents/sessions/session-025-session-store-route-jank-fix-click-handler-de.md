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
