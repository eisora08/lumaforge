## Session 8 — Dashboard global catalog expansion (Step 28)

### Problem
Dashboard discovery sections were limited to the user's library games. Recommended for You had no way to suggest games the user doesn't own. No "New & Noteworthy" section existed. The "Popular Picks" label was misleading (no real popularity signal).

### Global catalog audit (complete)
Store page uses 4 sources — `steamdb.json` static file (primary 500K app catalog), `providerSearch` (mockPackages→real package registry), Steam store API for search, `sourceAvailabilityCache` for Lua-ready overlays. No rating/popularity/trending signal exists in any data source.

### Data source decisions
- `readAllGames()` from SQLite is the global catalog for dashboard discovery sections (not steamdb.json which is 500K+ entries).
- No "Trending Right Now" section — no real trending/popularity signal exists.
- PopularPicks → Featured Picks: per rule "Do not label as Popular if there is no popularity/rating signal".

### Part 1: Recommended for You — global catalog fill
- Added `getRecommendedWithGlobalFill()` in `recommendationService.ts` — first runs personalized scoring on libraryGames, then fills remaining slots (up to limit) from global catalog scored by genre/category match against user profile.
- Catalog entries from `readAllGames()` have `metadataJson` parsed for `genres`/`categories` — scored the same way as library games.
- Excludes library games, favorites, continuePlaying, and already-recommended from fill pool.
- `RecommendedSection.tsx` updated to load `readAllGames()` on mount, use `getRecommendedWithGlobalFill`.
- `handleOpen` navigates to store for catalog-only games (not in library).
- Subtitle updated: `"Genre-matched games from the catalog"` for fallback mode.
- `[DASH][GLOBAL_CATALOG]` diagnostic log reports total catalog size, metadata coverage, installed count.
- `[DASH][RECOMMEND]` log enhanced with `personal=N` and `global=N` counts.

### Part 2: PopularPicks → FeaturedPicks rename
- `PopularPicksSection.tsx` → `FeaturedPicksSection.tsx` (file deleted, new file created).
- Heading changed from "Popular Picks" to "Featured Picks".
- Subtitle changed to "Curated games from the global catalog".
- Added `[DASH][GLOBAL_CATALOG] section=featured` diagnostic log.
- All imports in `Home.tsx` updated.

### Part 3: NewNoteworthySection created
- New `NewNoteworthySection.tsx` reads `readAllGames()` catalog, filters library games and tool apps.
- Parses `release_date` from `SteamAppMetadata` (handles ISO dates, Steam text format like "Jan 15, 2024", "Coming Soon"/"TBA").
- Sorts by `release_date` descending, prefers games with media.
- Shows release date as pill badge on each card.
- Navigation: library games → game detail, catalog-only → store.

### Part 4: Heart/badge style refinement
- **RecommendedSection**: Changed from `rounded-lg bg-black/50 p-1.5 text-yellow-400` (old star style) → `rounded-full bg-black/60 px-1.5 py-1 text-rose-400/80 backdrop-blur-sm` matching store minimal pill style.
- **FavoritesSection**: Same style update for consistency.

### Part 5: Home.tsx section ordering
- New order: GameHero → ContinuePlaying → Favorites → Recommended → **NewNoteworthy** → **FeaturedPicks** → TopPlayed → StoreHighlights → QuickActions → System strip.
- Discovery sections (NewNoteworthy, FeaturedPicks) placed after personalized sections, before playtime sections.

### Key Files Changed
- `src/services/recommendationService.ts` — `getRecommendedWithGlobalFill()`, `parseMetadataJson()`
- `src/components/dashboard/RecommendedSection.tsx` — global catalog loading, fill candidates, catalog nav, heart style, diagnostic logs
- `src/components/dashboard/FavoritesSection.tsx` — heart style consistency
- `src/components/dashboard/PopularPicksSection.tsx` → deleted
- `src/components/dashboard/FeaturedPicksSection.tsx` — new file (renamed + enhanced)
- `src/components/dashboard/NewNoteworthySection.tsx` — new file
- `src/pages/Home.tsx` — updated imports and section ordering

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
