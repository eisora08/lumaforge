## Session 9 — Mount global discovery sections with fallback catalog (Step 29)

### Problem
Sections from Session 8 (FeaturedPicks, NewNoteworthy) were mounted in JSX but returned `null` because `readAllGames()` SQLite table is empty on first boot / before full scan. `libraryGames` from context was already populated but not used as catalog fallback. Recommended for You also had no fallback for empty SQLite. No Trending Right Now section existed at all.

### Root Cause
- `readAllGames()` reads SQLite `games` table that may be empty until a full library scan completes
- All three discovery sections only used `readAllGames()` — when empty, `displayGames.length === 0` → `return null`
- No `[DASH][SECTION_SKIP]` diagnostic logs to explain missing sections
- TrendingRightNowSection didn't exist (not even a placeholder)

### Part 1: Fallback catalog from libraryGames
- **FeaturedPicksSection**: Added `libraryGameToCatalogGame()` converter. `displayGames` computed from SQLite catalog when non-empty, else from `libraryGames` context (always populated after boot).
- **NewNoteworthySection**: Same fallback pattern. Parse `release_date` from `LibraryGame.metadata` when SQLite is empty.
- **RecommendedSection**: SQLite catalog loading now falls back to `libraryGames` converted to `GameEntry[]` format.
- All three sections emit `[DASH][GLOBAL_CATALOG] loaded=N source=<sqlite|context-fallback>`.

### Part 2: [DASH][SECTION_SKIP] diagnostic logs
- **FeaturedPicks**: Logs `[DASH][SECTION_SKIP] section=FeaturedPicks reason=no-catalog-data|all-candidates-filtered` when hidden.
- **NewNoteworthy**: Logs `[DASH][SECTION_SKIP] section=NewNoteworthy reason=no-release-date-metadata|all-candidates-filtered` when hidden.
- **TrendingRightNow**: Logs `[DASH][SECTION_SKIP] section=TrendingRightNow reason=no-trending-signal` on mount.
- Impossible for any section to disappear silently.

### Part 3: [DASH][POPULAR] and [DASH][NEW] diagnostic logs
- **FeaturedPicks**: `[DASH][POPULAR] candidates=N rendered=N source=<sqlite-catalog|context-fallback>` on each recompute.
- **NewNoteworthy**: `[DASH][NEW] candidates=N rendered=N source=<metadata-releaseDate|context-fallback>` on each recompute.

### Part 4: TrendingRightNowSection created (skip-only)
- New `TrendingRightNowSection.tsx` — always logs skip and returns null.
- No fake trending data. No fake cards. No random data.
- Mounted in `Home.tsx` between FeaturedPicks and TopPlayed.

### Part 5: Per-game source logs in RecommendedSection
- First-time mount logs `[DASH][RECOMMEND] appid=<id> title=<title> source=<local|global-catalog> score=N reasons=<genres>` per final recommendation.
- Source determination: `local` if game is in libraryGames, `global-catalog` if filled from catalog.

### Part 6: Empty state behavior
- All sections with no real data hide silently (return null).
- TrendingRightNowSection always hides with a console log.
- Diagnostic logs explain why any section is missing.
- No mock cards, no random data, no fake content.

### Key Files Changed
- `src/components/dashboard/FeaturedPicksSection.tsx` — `libraryGameToCatalogGame` fallback, `[DASH][SECTION_SKIP]` + `[DASH][POPULAR]` logs
- `src/components/dashboard/NewNoteworthySection.tsx` — `libraryGameToCatalogGame` fallback, `[DASH][SECTION_SKIP]` + `[DASH][NEW]` logs
- `src/components/dashboard/RecommendedSection.tsx` — libraryGames fallback catalog, per-game source logs
- `src/components/dashboard/TrendingRightNowSection.tsx` — new (skip-only with log)
- `src/pages/Home.tsx` — TrendingRightNowSection mount, `[DASH][GLOBAL_CATALOG]` snapshot log

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
