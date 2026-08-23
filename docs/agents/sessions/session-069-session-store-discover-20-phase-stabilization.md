## Session — Store Discover 20-Phase Stabilization + P0/P1 Fixes

### Goal
Full stabilization audit of the Store Discover pipeline: 20 phases covering route restoration, single-flight discovery builds, fingerprinting, cache quality, movie caching, metadata dedup, enrichment limits, interaction performance, layout stability, log noise, and boot dedup.

### P0/P1 Priority Fixes (pre-Stabilization)

#### P0-1: Dead media debug flag
- `gameCacheService.ts:3167` — `_DEBUG_MEDIA_APPID_ENABLED = false`
- Removed 3 dead exports

#### P0-2: Movie metadata negative cache
- `gameMetadataResolver.ts` — `_moviesCheckedThisSession` Set
- Prevents re-fetching movies for apps that have none

#### P0-3: Discovery index disk-save dedup
- `Store.tsx` — content fingerprint before `saveDiscoveryIndexToDisk`
- Skips disk write when index unchanged

#### P0-4: Background job watchdog
- `backgroundJobQueue.ts:60_000ms` `Promise.race` watchdog
- Detects stuck jobs, suppresses idle drain log noise

#### P1-1: Per-appId metadata dedup
- `gameMetadataResolver.ts` — `metadataInFlightByAppId` Map replaces batch-keyed dedup
- Per-appId Map dedup prevents duplicate loads across boot enrichment + Store mount

#### P1-2: Dead dashboardSectionCache
- Deleted entirely — `dashboardSectionCache.ts`

#### P1-3: Dead tauri.ts bindings
- Removed 6 dead exports from `tauri.ts`

#### P1-4: Redundant cache guard
- `storeDiscoverCache.ts` — removed dead redundant check

#### P1-5: dirtyAppIds dedup
- Already sufficient — no fix needed

### Store Discover Stabilization (20 Phases)

#### Phase 1: Fix Store route restoration
- `App.tsx:53-69` — removed `restoreActivePage()` Store→Home redirect
- Store now stays on best available cache (no redirect to Home)

#### Phase 2+3: Input fingerprint for discoverSections
- `Store.tsx` — `_sectionBuildFpRef` input fingerprint for `discoverSections` useMemo
- Computes lightweight fingerprint from metadata count, review count, installed count, interaction count, provider overlay count, featured count, enriched sections, discovery index hash, catalog fingerprint
- Skips 300-line section builder when inputs unchanged

#### Phase 7: Cap metadata fetch to 200 IDs max per batch
- `Store.tsx:METADATA_WINDOW_MAX = 200`
- Prevents loading metadata for 500+ games per batch

#### Phase 10: Gate verbose Store logs
- `FINAL_SECTION` gated behind `DEBUG_STORE_DISCOVERY`
- `ALL_SECTIONS_SOURCE` gated behind `DEBUG_STORE_RENDER_VERBOSE`
- `MORE_RENDER`/`MORE_WINDOW` gated behind `DEBUG_STORE_RENDER_VERBOSE`
- `SHOW_MORE` gated behind `DEBUG_STORE_RENDER_VERBOSE`

#### Phases 4-6, 8-9, 11-19: Verified already sound
- Cache quality gate: already checks `metadataReady`
- Interaction perf: already has `isInteractionBusy()` guards
- Layout stability: section IDs already stable
- Boot dedup: P1-1 per-appId Map handles this
- Store state: DiscoverState + CacheEntry set in same effect
- Featured games: stable priority chain
- Genre sections: adaptive threshold fallback already implemented
- More to Explore: already dedupes via seen Set + excludeIds

#### Phase 20: Build verification
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)

### Key Files Changed
- `src/App.tsx` — removed `restoreActivePage()` Store→Home redirect, removed unused `getCachedStoreDiscover`/`isCacheComplete` import
- `src/pages/Store.tsx` — `_sectionBuildFpRef` input fingerprint, `METADATA_WINDOW_MAX = 200`, gated `FINAL_SECTION`/`ALL_SECTIONS_SOURCE`/`MORE_RENDER`/`MORE_WINDOW`/`SHOW_MORE` logs
- `src/services/gameMetadataResolver.ts` — `_moviesCheckedThisSession` negative cache, `metadataInFlightByAppId` per-appId dedup
- `src/services/gameCacheService.ts` — `_DEBUG_MEDIA_APPID_ENABLED = false`, removed 3 dead exports
- `src/services/backgroundJobQueue.ts` — `JOB_WATCHDOG_TIMEOUT_MS = 60_000` watchdog timer
- `src/services/storeDiscoverCache.ts` — removed dead redundant check
- `src/services/dashboardSectionCache.ts` — **deleted**
- `src/services/tauri.ts` — removed 6 dead exports

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
