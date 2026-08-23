## Session — Rich Store Discover Sections

### Goal
Transform the flat Discover tab (Hero + sections + More to Explore) into a rich store home with 12 curated sections: Hero, Featured, For You, Top Picks, New and Noteworthy, Popular Genres, Action, Indie, Racing, Shooter, Lua Ready Picks, More to Explore.

### Part 1: StoreDiscoverSection model
- Added `StoreDiscoverSection` type to `storeDiscoverCache.ts`: `{ id, title, type, items, source }`
- Added `StoreGame` (simplified game item) and `SectionSource` ("catalog" | "personalized" | "genre" | "lua" | "fallback")
- Added `discoverSections` field to `CacheEntry` for caching
- Added `buildDiscoverSectionsFingerprint()` helper for composite fingerprint

### Part 2: Section builder
- Replaced the old `dynamicDiscoverSections` useMemo (produced `StoreSectionModel[]`) with `discoverSections` (produces `StoreDiscoverSection[]`)
- Added backward-compat `sectionModels` shim for cache/other consumers
- New sections:
  - **For You** — personalized genre overlap (was "Recommended for You")
  - **Top Picks** — top scored from high quality pool
  - **New and Noteworthy** — sorted by `release_date` via `parseReleaseDate`
  - **Popular Genres** — genre overview rail
  - **Action, Indie, Racing, Shooter** — genre rails from metadata tags (Racing added)
  - **Featured** — high-quality with media (was "Top Rated")
  - **Lua Ready Picks** — catalog games with available download sources
- Removed "Trending Now" section (no real trending signal)
- Reduced genre count from 7 (Action, RPG, Shooter, Indie, Simulation, Adventure, Strategy) to 4 (Action, Indie, Racing, Shooter)

### Part 3: Discover tab render
- Hero carousel stays rendered separately
- All 11 section rails rendered via `StoreHorizontalSection` with per-section descriptions
- More to Explore rendered as the LAST section, unaffected by section dedup
- Show More button only affects More to Explore's `visibleCount`

### Part 4: Image resolver
- All Store sections use `resolveStoreDisplayImage` via existing `renderStoreCard` path
- No MediaIndex or BootSnapshot updates from Store images (pre-existing guards confirmed)

### Part 5: Caching
- `discoverSections` cached in `CacheEntry.discoverSections`
- Cache restored by `catalogFingerprint` match
- `sectionModels` saved as `dynamicDiscoverSections` in cache for backwards compat

### Key Decisions
- **Inherit existing scoring** — For You, Top Picks, Featured all reuse existing `highQualityPool`, `interactionScoreByAppId`, `genreConfidence` scoring
- **No fake trending** — "Trending Now" removed instead of showing stale data
- **4 genre rails** — Reduced from 7 to 4 (Action, Indie, Racing, Shooter) to match requirements
- **More to Explore last** — Always rendered after all discover sections, unaffected by section dedup

### Key Files Changed
- `src/services/storeDiscoverCache.ts` — `StoreDiscoverSection`, `StoreGame`, `SectionSource` types; `discoverSections` field on `CacheEntry`; `buildDiscoverSectionsFingerprint`
- `src/pages/Store.tsx` — `discoverSections` useMemo replaces `dynamicDiscoverSections`; `sectionModels` shim; updated render loop; `parseReleaseDate` import; Lua Ready Picks section; description mapping

### Build
- `tsc --noEmit` ✅ passes (only pre-existing unused-import warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)
