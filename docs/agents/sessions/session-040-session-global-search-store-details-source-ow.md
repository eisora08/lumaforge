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
