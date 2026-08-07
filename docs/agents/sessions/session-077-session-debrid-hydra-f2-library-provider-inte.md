## Session — Debrid/Hydra F2: Library Provider Integration

### Goal
Integrate Debrid/Hydra repack catalog entries into the Library grid as a first-class game source, following the same memory-first provider store pattern as Epic F1B. This is F2 of the 6-phase Debrid plan.

### Parts Implemented

#### Part 1: Types
- `"debrid"` added to `LibraryGameSource` and `LibraryFilter` unions in `libraryGame.ts`
- `"debrid"` added to `IntegrationId`, `ALL_INTEGRATION_IDS`, `DEFAULT_INTEGRATION_SETTINGS.integrations`, and `INTEGRATION_DISPLAY_DESCRIPTIONS` / `INTEGRATION_DISPLAY_NAMES` in `integrations.ts`
- `INTEGRATION_ICONS`, `INTEGRATION_COLORS`, `REFRESH_LABELS`, `DISABLE_CONFIRM` updated in `IntegrationsSection.tsx` (Cloud icon, cyan color)
- `LibraryRail.tsx` `computeCounts` — added `debrid: 0` counter
- `PROVIDER_CAPABILITIES` in `gameProviderCapabilities.ts` — added conservative `debrid` entry (all false except `canRemoveFromLibrary: true`)

#### Part 2: Feature flag (`debridFeatureFlag.ts`)
- 5 flags: `DEBRID_LIBRARY_ENABLED = false`, `DEBRID_LAUNCH_ENABLED = false`, `DEBRID_STORE_ENABLED = false`, `DEBUG_DEBRID_LIBRARY = false`, `DEBUG_DEBRID_LAUNCH = false`
- All defaults OFF for production

#### Part 3: Pure mapper (`debridGameLibraryMapper.ts`)
- `repackEntryToDebridGame(entry)` — maps `RepackQueryResult` → `LibraryGame`
- `computeDebridFingerprint(games)` — deterministic fingerprint (appId + repacker + fileSize combination)
- `isDebridEntryEligible(entry)` — strict filter (valid appId, non-empty title, non-empty repacker)
- Identity: `providerGameId = entry.id`, `libraryId = "debrid:<id>"`
- `appId = String(entry.appId)` — Steam appId for cross-provider dedup
- `source = "debrid"`, `isInstalled = false`, `isInstallable = true`, `isPlayable = false`
- Fields populated from repack catalog: `title`, `lastUpdated`, `sizeOnDisk` (installSize > fileSize), `gameSize` (fileSize)

#### Part 4: Memory-first provider store (`debridGameStore.ts`)
- Module-level state: `_debridGames: LibraryGame[]`, `_debridFingerprint`, `_scanWarning`, `_scanState`
- `refreshDebridGames()` — calls `getAllRepackEntries()`, filters eligible, maps to LibraryGame, replaces state, notifies on fingerprint change
- `getAllDebridGames()`, `getDebridGame()`, `getDebridGameByAppId()`, `getDebridFingerprint()`, `getDebridScanState()`, `getDebridScanWarning()`
- `subscribeDebridGames(listener)` — returns cleanup function
- `resetDebridGameCache()` — clears state + notifies
- Scanner failure: retains previous valid entries, sets warning, notifies once
- Successful empty scan: replaces with empty (stale entries removed)

#### Part 5: Rust catalog query
- `src-tauri/src/commands/repack_catalog.rs` — added `query_all()` internal fn + `query_repack_catalog_all` Tauri command
- `src-tauri/src/lib.rs` — registered new command
- `src/services/tauri.ts` — `queryRepackCatalogAll()` TS binding + `RepackQueryResult` type

#### Part 6: Catalog service
- `src/services/repackCatalogService.ts` — added `getAllRepackEntries()` with 5-min TTL cache (module-level Map), wraps `queryRepackCatalogAll`
- `resetRepackCatalogCache()` exported for testing

#### Part 7: LibraryGamesContext merge boundary
- Imports: `DEBRID_LIBRARY_ENABLED`, `DEBUG_DEBRID_LIBRARY`, `getAllDebridGames`, `subscribeDebridGames`, `refreshDebridGames`
- `getDebridLibraryGames()` — sync read from in-memory Debrid store
- `applyGamesSafely` now appends `...getDebridLibraryGames()` alongside manual + Epic
- Debrid subscription `useEffect` — strips Debrid games from current, re-applies fresh from store on Debrid store change
- Fingerprint change detection prevents duplicate notifications
- Feature-flag gated: subscription returns immediately when `DEBRID_LIBRARY_ENABLED = false`

### Merge behavior
- `dedupeLibraryGames` dedups by appId — Debrid entries with Steam appIds are deduped against Steam games (first occurrence wins, so real Steam games take priority)
- Debrid without appId go through `noAppId` array

### Key Files Created/Changed
- `src/features/debrid/debridFeatureFlag.ts` — **new** — feature flags
- `src/services/debridGameLibraryMapper.ts` — **new** — pure mapper, eligibility, fingerprint
- `src/services/debridGameStore.ts` — **new** — memory-first store with subscriptions
- `src-tauri/src/commands/repack_catalog.rs` — added `query_all()` + `query_repack_catalog_all`
- `src-tauri/src/lib.rs` — registered command
- `src/services/tauri.ts` — `queryRepackCatalogAll` binding + `RepackQueryResult` type
- `src/services/repackCatalogService.ts` — `getAllRepackEntries()` with 5-min TTL
- `src/context/LibraryGamesContext.tsx` — Debrid merge boundary + subscription effect
- `src/types/libraryGame.ts` — `"debrid"` source/filter
- `src/types/integrations.ts` — `"debrid"` IntegrationId + display names + defaults
- `src/types/gameProviderCapabilities.ts` — debrid capabilities entry
- `src/components/library/LibraryRail.tsx` — debrid count
- `src/components/settings/IntegrationsSection.tsx` — Debrid card icon/color/label/confirm/render loop

### What was NOT changed (F2 boundary)
- No launch — `isPlayable = false` for all Debrid entries
- No Store integration — `DEBRID_STORE_ENABLED = false`
- No Console Mode Debrid exposure
- No install/uninstall via LumaForge
- No metadata API, no artwork resolution
- No cross-provider dedup configuration
- No changes to: gameStore, GameSessionContext, Home, Sidebar, GameDetails, GameEditDialog, Store, Console Mode, Steam launch, Epic, manual games, Hubcap

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
