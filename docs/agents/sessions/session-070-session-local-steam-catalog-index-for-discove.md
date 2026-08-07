## Session — Local Steam Catalog Index for Discover/View All

### Goal
Replace runtime-enriched genre sections (which depend on remote Steam appdetails API) with a local SQLite catalog index queried from Rust, enabling instant genre rail population without network calls.

### Architecture
- Offline Node.js catalog builder → versioned JSON artifact → Rust SQLite import → fast local queries → Discover genre sections populated from index → fallback to runtime metadata when catalog unavailable
- **No scraping, no remote API server, no automatic remote updates** — offline import only
- **Preserve scope**: no changes to Home, Library, Desktop Library Game Details, Console Mode, Favorites, Continue Playing, launch/Stop flows, Epic integration, manual games, achievements, package flows, Hubcap

### Parts Implemented

#### Phase 1-2: Checkpoint + Audit
- Clean working tree confirmed; commits 413cd13, ede05f8, bacc016 preserved
- Full audit: steamdb.json has 162K entries with only `{appid, name}`; 3 separate normalization systems found; genre sections depend entirely on runtime metadata enrichment; curated catalog has ~6 unique Adventure games
- `DISPLAY_GENRES` in Store.tsx lists 6 genres (Action, Indie, Racing, Shooter, RPG, Adventure)

#### Phase 3-8: Builder tool
- `tools/steam-catalog-builder/taxonomy.ts` — CANONICAL_GENRES (10), GENRE_ALIASES, STEAM_CATEGORY_IDS, `normalizeGenreName()`, `normalizeGenres()`, GENRE_SECTION_IDS, ACTIVE_GENRE_SECTIONS
- `tools/steam-catalog-builder/catalogSchema.ts` — SteamCatalogRecord, SteamCatalogArtifact, SteamCatalogManifest, BuilderCheckpoint types
- `tools/steam-catalog-builder/build.ts` — checkpoint/resume, bounded concurrency, retry, atomic artifact writes, manifest generation
- `tools/steam-catalog-builder/package.json` — builder package config

#### Phase 9: Rust catalog tables + queries
- `src-tauri/src/commands/store_catalog.rs` — full implementation:
  - Schema: `store_catalog_games` (15 columns + 6 indexes), `store_catalog_genres` (composite PK), `store_catalog_categories`, `store_catalog_meta`
  - Import: atomic drop+recreate via transaction, batch insert records/genres/categories/metadata
  - Queries: by genre (JOIN + ORDER BY reviews), by name (LIKE search), by appId, featured (review threshold), new & noteworthy (180-day window)
  - All functions use `tauri::State<'_, SqliteDb>` pattern with graceful None fallback

#### Phase 10: Tauri commands + TS bindings
- 7 commands registered in `src-tauri/src/lib.rs`: `get_catalog_meta`, `import_steam_catalog`, `query_catalog_by_genre`, `query_catalog_search`, `query_catalog_game`, `query_catalog_featured`, `query_catalog_new_noteworthy`
- Catalog tables auto-created in `sqlite_cache.rs` `init_tables()`
- TS types in `tauri.ts`: `CatalogMetaResult`, `CatalogGameResult` with camelCase mapping
- 7 async TS functions for each command

#### Phase 11: TS catalog query service
- `src/services/steamCatalogService.ts`:
  - `getLocalCatalogStatus()` — version check with 5-min cache
  - `queryByGenre()`, `queryFeaturedGames()`, `queryNewNoteworthyGames()`, `querySearch()`, `getCatalogGame()` — each with 5-min TTL in-memory cache
  - `preFetchGenreGroups(genres, limit)` — parallel genre pre-fetch for synchronous reads
  - `getLocalGenreGroups()` / `isLocalCatalogReady()` — synchronous getters for Store useMemo
  - `clearCatalogCaches()` + `_localGenreGroups.clear()` on import

#### Phase 12-13: Store.tsx integration
- Mount effect pre-fetches genre groups via `preFetchGenreGroups(DISPLAY_GENRES, 20)`
- `rawGenreGroups` computation: local catalog data merged first, then runtime metadata supplements (deduped by appId)
- When catalog unavailable: falls back to existing runtime metadata path (zero behavior change)
- `[STORE][GENRE_INDEX_READY] source=local-catalog` / `source=metadata` diagnostic logs

### Key Decisions
- **Merge, don't replace**: local catalog data supplements runtime metadata (catalog fills genres, metadata adds images/reviews)
- **Synchronous read**: `getLocalGenreGroups()` returns cached Map for useMemo consumption (no async in useMemo)
- **Graceful fallback**: when no catalog imported, Store behaves identically to before (runtime enrichment continues)
- **5-min TTL cache**: consistent across all query functions (genre, search, featured, status)

#### Phase 14: Section wiring — Featured, New & Noteworthy, View All
- `DISPLAY_GENRES` hoisted to module-level constant (was duplicated in two closures)
- `catalogGameToStoreGame()` helper converts `CatalogGameResult` → `StoreGame`
- `catalogFeaturedGames` state + `queryFeaturedGames(8)` on boot; used as primary in `discoverSections` useMemo; runtime `queryIndexFeatured` is fallback
- `catalogNewNoteworthyGames` state + `queryNewNoteworthyGames(8)` on boot; used as primary in `discoverSections` useMemo; runtime `parseReleaseDate` is fallback
- View All: `viewAllGames` + `viewAllLoading` + `viewAllPage` + `viewAllHasMore` state; `queryByGenre(genre, 24, offset)` with pagination; `loadMoreViewAll` callback; "Load More" button at bottom
- Mount effect: `ensureCatalogImported()` → `preFetchGenreGroups()` → `Promise.all([queryFeaturedGames(8), queryNewNoteworthyGames(8)])`

### Key Files Created/Changed
- `tools/steam-catalog-builder/taxonomy.ts` — **new** — genre/category taxonomy
- `tools/steam-catalog-builder/catalogSchema.ts` — **new** — record/artifact/manifest types
- `tools/steam-catalog-builder/build.ts` — **new** — offline builder with checkpoint/resume
- `tools/steam-catalog-builder/generate.cjs` — **new** — standalone CJS runner with rate-limit handling
- `tools/steam-catalog-builder/package.json` — **new** — builder package
- `public/data/catalog/steam-catalog-v1.json` — **new** — bundled 1,984-record artifact
- `public/data/catalog/steam-catalog-v1.json.gz` — **new** — compressed artifact
- `public/data/catalog/steam-catalog-v1.manifest.json` — **new** — manifest with checksum
- `src-tauri/src/commands/store_catalog.rs` — **new** — schema, import, queries, 7 Tauri commands, 20 unit tests
- `src-tauri/src/commands/mod.rs` — `pub mod store_catalog` added
- `src-tauri/src/commands/sqlite_cache.rs` — catalog tables in `init_tables()`
- `src-tauri/src/lib.rs` — 7 commands registered
- `src/services/tauri.ts` — CatalogMetaResult, CatalogGameResult types + 7 TS bindings
- `src/services/steamCatalogService.ts` — **new** — query service with TTL cache + pre-fetch + ensureCatalogImported
- `src/__tests__/steamCatalogService.test.ts` — **new** — 16 TS contract tests
- `vitest.config.ts` — **new** — vitest configuration
- `src/pages/Store.tsx` — mount auto-import + featured/noteworthy pre-fetch, DISPLAY_GENRES module constant, catalogGameToStoreGame helper, catalogFeaturedGames/catalogNewNoteworthyGames state, discoverSections with catalog-primary/fallback logic, View All pagination

### Build
- `tsc --noEmit` ✅ (0 new errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
