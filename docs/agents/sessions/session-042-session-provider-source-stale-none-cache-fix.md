## Session — Provider/Source stale-none cache fix, Lua inLibrary derivation, source retry

### Problem
1. **Lua inLibrary vs installed confusion**: `isInstalled = luaInstalled || isSteamInstalled` made lua-only games appear "installed", causing `inLibrary = steamOwned && !isInstalled` to exclude them from the "In Library" badge.
2. **Empty "none" result overwrites good cache**: `onEarlyResult` in Store.tsx called `updateSourceAvailability` with `buildSourceAvailabilityFromProviders` which produced `status: "none"` when no available sources yet — overwriting "checking" status before final `.then()` ran, so the preserve-early-return path never fired.
3. **No source rebuild from saved state**: When cache was stale/empty but `getStoreDetailsState` had `selectedProvider` + `providerResults > 0`, no code rebuilt a `PackageSource` from that data.
4. **Provider status blocked by "No Sources"**: `getButtonConfig` checked `isNone`/`needsRetry` before provider-status, blocking "Update Package" button for installed games with valid provider status.

### Part 1: Lua inLibrary derivation
- `StoreGameSummaryPanel.tsx` — `isInstalled = isSteamInstalled` (was `luaInstalled || isSteamInstalled`)
- `inLibrary = steamOwned || luaInstalled` (was `steamOwned && !isInstalled`)
- Status SummaryLine uses `inLibrary` not `steamOwned`
- `[STORE][DETAILS_STATE_DERIVE]` diagnostic log

### Part 2: Block empty "none" cache writes
- `Store.tsx:2572` — `onEarlyResult` guards `updateSourceAvailability` with `if (entry.status !== "none")`
- Same guard in `onRetryEarlyResult`
- `sourceAvailabilityCacheService.ts` `updateSourceAvailability` blocks overwriting existing non-empty cache with empty entry (`[STORE][SOURCE_CACHE_EMPTY_WRITE_BLOCKED]`)
- `markSourceUnavailable` preserves existing sources with `status: "timeout"` instead of clearing

### Part 3: Source rebuild from saved state
- `StoreGameDetailsPage.tsx` `checkSources()` now checks `getStoreDetailsState` for `selectedProvider` + `providerResults > 0`
- On cache miss/stale, tries to find source by provider name and rebuild `PackageSource` with `sourceLog("rebuilt from saved provider")`
- `[STORE][SOURCE_REBUILD_FROM_CACHE]` / `[STORE][SOURCE_RESTORE_START/MISS]` diagnostic logs

### Part 4: Retry clear (already correct)
- Existing `updateSourceAvailability({ status: "checking" })` overwrites stale "none" before discovery starts
- Part 2 guard prevents re-introducing empty "none"

### Part 5: No Sources guard + provider status unblocked
- `StoreGameSummaryPanel.tsx` badge guarded with `!canRetry` — only shows when retry is impossible
- `getButtonConfig` restructured — installed games check provider status FIRST, skip `isNone`/`needsRetry`
- `[PACKAGE][ACTION_RESOLVE]` / `[PACKAGE][MISSING_SOURCE_FOR_PROVIDER]` diagnostics

### Part 7: Global search (already correct)
- `[GLOBAL_SEARCH][RESULT_STATE]` log added in `PackagesToolbarSearch.tsx`

### Key Files Changed
- `src/components/store/details/StoreGameSummaryPanel.tsx` — Lua derivation, No Sources guard, button config
- `src/components/store/StoreGameDetailsPage.tsx` — source rebuild from saved state
- `src/pages/Store.tsx` — `onEarlyResult` empty-save guard
- `src/services/sourceAvailabilityCacheService.ts` — empty-write guard, markSourceUnavailable preserve guard
- `src/services/storeDetailsSourceState.ts` — `getStoreDetailsState` import
- `src/components/packages/PackagesToolbarSearch.tsx` — `[GLOBAL_SEARCH][RESULT_STATE]` log

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
