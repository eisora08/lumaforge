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
