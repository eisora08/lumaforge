## Session — Store free-catalog hydration gate + inputFp (boot-vs-return stability)

### Problem
Store Discover sections differed between a cold boot and navigating back into the Store: the hydration gate only waited on `featuredGames` (always non-empty via the static curated baseline), so free-catalog sections (Recent/Trending/Top-Players/Leaderboard/Featured/Hidden-Gems/Most-Played/Most-Played-Now/Rising-Stars) built progressively AFTER first paint on boot, but were fully cache-seeded on a return — producing two different compositions.

### Fixes (`src/pages/Store.tsx`)

#### Part 1: Hydration gate awaits `freeCatalogLoading`
- `allCriticalReady` now includes `&& !freeCatalogLoading`. While the post-first-paint free-catalog fetch (SteamSpy / local catalog) is settling, the memo keeps returning the cached `discoverSections`, so boot renders the exact same stable free sections the user sees on navigation-back — the async fetch no longer swaps out cached sections mid-render.

#### Part 2: `inputFp` covers all 9 free datasets
- The skip-path fingerprint (line ~1482) now includes `freeRecentGames`, `freeFeaturedGames`, `freeHiddenGems`, `freeMostPlayed`, `mostPlayedNow`, `risingStars` (was only `freeTrendingGames`/`freeTopByPlayersGames`/`freeLeaderboardGames`), so the memo never returns a stale-build when those datasets update.

#### Part 3: Cache-write guard (verified, no change)
- Confirmed the phase-10 write skip already protects a complete cache (`!existing.isPartialCache && discoverSections.length > 0 && discoverSections.length === existing.discoverSections.length`), so a boot can't stomp a complete cache with a partial one.

#### Part 4: Removed dead `_gateEnriched`
- `const _gateEnriched = enrichedCatalogSections.length > 0;` was declared but never used in `allCriticalReady` (pre-existing TS6133). Removed.

### Build
- `tsc --noEmit` ✅ (only pre-existing `ProviderSearchReport` :14, `providerReports` :384 — untouched)
- `vite build` ✅ (2.97s, Rolldown; only pre-existing chunk-size warning)
