## Session � Store hero Featured: cache-restore gate (boot == navigating-back)

### Problem
Store Discover hero carousel (`featuredGames`) showed different games than navigating back: at first boot the hero rendered the curated baseline (Sekiro/Cyberpunk), but on return-from/away it showed the enriched provider set (Hades/CS2). Root cause: the hero memo recomputed from the LIVE pool with no cache-restore, so its content depended on async hydration timing. The `discoverSections` rails memo already had a hydration gate (`allCriticalReady` ~1478) that restored from cache on boot; the hero had none.

### Root cause
- `_curatedBaseline = buildCuratedCatalogSections()` line ~197 (Sekiro/Cyberpunk) is the pool fallback when `enrichedCatalogSections` (provider games Hades/CS2) is empty.
- On boot, `enrichedCatalogSections` populates late (~500ms via `storeCatalogOrchestrator`, gated by `storeFirstPaintDone`), so the hero first built from the curated pool, then swapped to enriched � while the rails held the cached index through `allCriticalReady` and produced the same sections as a return.
- Net effect: boot hero != return hero (two different final compositions).

### Fix (`src/pages/Store.tsx`, `featuredGames` memo ~1324)
- Added a hydration gate mirroring the rails: `featuredInputsReady` = metadata > 20 && reviews > 0 && installed > 0 && providers > 0 && `!freeCatalogLoading`.
- When NOT ready, restore the hero from `getCachedStoreDiscover().featuredGames` if a complete cache exists (fingerprint match `catalogFingerprint`, `length >= 4`, `!isPartialCache`) � returns the stable cached set so boot == return.
- When ready, falls through to the existing live-pool logic (curated baseline ? enriched ? highQualityPool ? pick HERO_MAX via day-seeded shuffle). Deps already included `catalogFingerprint`, `enrichedCatalogSections`, `highQualityPool` � unchanged.
- Cold-cold boot (no complete cache ever) still builds from curated then enriches (acceptable, one-time); the reported bug (cache present) is fixed by the restore.

### Key Files Changed
- `src/pages/Store.tsx` � `featuredGames` memo: hydration gate + cache restore at the top

### Follow-up: persisted hero source (fixes the cold-boot case that "seguia igual")
The gate above only helped warm boots / same-session returns. On a **cold boot** it still failed for two reasons, both confirmed by reading the source:
1. `catalogFingerprint = steamCatalog.length > 0 ? buildCatalogFingerprint(steamCatalog) : ""` (Store.tsx L505) — on the FIRST render `steamCatalog` hasn't awaited steamdb.json yet, so the fingerprint is `""` and the gate's `catalogFingerprint === catalogFingerprint` equality never held.
2. `getCachedStoreDiscover()` and `getDiscoverState()` are BOTH module-level in-memory only (no localStorage) — a cold start has nothing to restore, so the hero fell to the curated baseline.

**Fix: persist the hero's unified source.** Both cache modules died on restart, so boot != return was structurally unfixable in-memory alone. Added localStorage persistence of the featured list (compact `StoreGame[]`, <= 8 items) in `storeDiscoverCache.ts`:
- `FEATURED_PERSIST_KEY = "lumaforge-store-featured-v1"`, `persistDiscoverFeatured()` (strips `sources`, guards `length >= 4`, try/catch quota), `getPersistedDiscoverFeatured()` (validates shape, returns `sources: []` re-wrapped).
- `setCachedStoreDiscover()` calls `persistDiscoverFeatured(entry.featuredGames)` after writing `_cachedDiscover`.
- `Store.tsx` `featuredGames` memo gate: after the in-memory restore, falls back to `getPersistedDiscoverFeatured()` (len >= 4) while `!featuredInputsReady`. On a cold boot this restores the previously-built enriched set (Hades/CS2), so boot renders the SAME hero a return recomputes for that day.

### Build
- `tsc --noEmit` ? (only pre-existing `ProviderSearchReport` :14, `providerReports` :384 � untouched)
- `vite build` ? (2.83s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
