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
