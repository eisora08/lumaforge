## Session — Epic Games Store Phase 1B: Library Provider Integration

### Goal
Integrate Epic Games local scanner results into the Library grid via a memory-first provider store, pure mapper, and isolated merge boundary in LibraryGamesContext. No launch, auth, owned/uninstalled, achievements, GOG, Console Mode, or cross-provider dedup.

### Parts Implemented

#### Part 1: LibraryGame type — provider-neutral `isInstalled` field
- Added `isInstalled?: boolean` to `LibraryGame` type in `src/types/libraryGame.ts`
- Provider-neutral: true when game exists on disk from any provider
- Distinct from `steamInstalled` (Steam-specific), `isPlayable` (launch-ready), `isInstallable` (can be installed via LumaForge)

#### Part 2: Feature flag (`src/services/epicFeatureFlag.ts`) — **new**
- `EPIC_LIBRARY_ENABLED = false` — master gate, defaults OFF for production
- `DEBUG_EPIC_LIBRARY = false` — verbose console diagnostics gate

#### Part 3: Pure mapper (`src/services/epicGameLibraryMapper.ts`) — **new**
- `epicGameToLibraryGame(game: EpicInstalledGame) → LibraryGame` — pure, no side effects
- `buildProviderGameId(game)` — canonical identity: `{namespace}:{catalogItemId}` → `{namespace}:{appName}` → `{appName}`
- `isEpicEntryEligible(game)` — strict filter: baseGame + manifestValid + installed + !incomplete + non-empty providerGameId + non-empty displayName
- `computeEpicFingerprint(games)` — deterministic fingerprint for change detection
- `isPlayable = false` (no launch adapter), `isInstalled = true` (on disk), `steamInstalled = false`, `isInstallable = false`

#### Part 4: Memory-first provider store (`src/services/epicGameStore.ts`) — **new**
- Module-level state: `_epicGames: LibraryGame[]`, `_epicFingerprint: string`, `_scanWarning: string | null`, `_scanState`
- `refreshEpicGames()` — runs Rust scanner, filters eligible, maps to LibraryGame, replaces state, notifies on fingerprint change
- `getAllEpicGames()`, `getEpicGame()`, `getEpicFingerprint()`, `getEpicScanState()`, `getEpicScanWarning()`
- `subscribeEpicGames(listener)` — returns cleanup function, no duplicate listeners
- `resetEpicGameCache()` — clears state + notifies
- Scanner failure: retains previous valid entries, sets warning, notifies once
- Successful empty scan: replaces with empty (stale entries removed)

#### Part 5: Steam-only action gating
- `GameLauncherTile.tsx` — "Uninstall in Steam" hidden when `game.source === "epic"`
- `SidebarLibraryList.tsx` — "Uninstall in Steam" hidden when `menuGame.source === "epic"`
- "Open in Steam" already safe (driven by `getLauncherGamePrimaryAction()` which returns "details" for Epic)

#### Part 6: Fingerprint safety for appId-less entries
- `LibraryGamesContext.tsx` — `computeLibraryFingerprint` and `computeGamesFingerprint` use `g.appId || g.libraryId || g.id` instead of raw `g.appId`
- Prevents `undefined:` prefix in fingerprint strings for Epic/GOG entries

#### Part 7: LibraryGamesContext Epic merge boundary
- `getEpicLibraryGames()` helper — sync read from in-memory Epic store
- `applyGamesSafely` appends Epic games alongside manual games: `[...nextGames, ...getManualLibraryGames(), ...getEpicLibraryGames()]`
- Epic subscription effect (follows manual subscription pattern):
  1. Calls `refreshEpicGames()` on mount (fire-and-forget)
  2. Subscribes to Epic store changes
  3. On change: strips Epic from current, calls `applyGamesSafely(nonEpic, "epic-update")`
  4. Epic games survive manual-update (not stripped, present in `getEpicLibraryGames()`)
  5. Manual games survive epic-update (not stripped, present in `getManualLibraryGames()`)
- Feature-flag gated: subscription effect returns immediately when `EPIC_LIBRARY_ENABLED = false`

#### Part 8: mergeGames compatibility (no changes needed)
- `mergeGames()` first branch (cached/reconciled/snapshot): Epic entries have `appId=undefined` → NOT copied into `byAppId` from current → incoming Epic entries added fresh via `noappid-${game.id}` path
- `mergeGames()` second branch (dedupe): `dedupeLibraryGames` dedupes by appId, doesn't affect appId-less Epic entries
- Replacement, not stale merge: on successful scan, all previous Epic entries replaced

### What was NOT changed (Phase 1B boundary)
- No launch adapter — `isPlayable = false` for all Epic entries
- No auth, no owned/uninstalled games, no Epic store integration
- No achievements, cloud, install/uninstall, cross-provider dedup
- No Console Mode Epic exposure
- No metadata API, no artwork resolution
- No changes to: libraryGameResolver, startupSnapshotService, gameStore, manualGameStore, manualGameLibraryMapper, GameSessionContext, FavoritesContext, Home, Sidebar layout, GameDetails, GameEditDialog, Store, Console Mode, Steam launch, manual launch, Hubcap

### Scenario Coverage
- **A — Feature disabled**: `EPIC_LIBRARY_ENABLED = false` → subscription returns early, `getEpicLibraryGames()` returns `[]`, no behavior change
- **B — Normal scan**: `refreshEpicGames()` → eligible entries mapped → fingerprint change → `applyGamesSafely(nonEpic, "epic-update")` → Epic games appear in Library
- **C — Empty scan**: replace with empty → stale Epic entries removed
- **D — Scanner failure**: retain previous entries, set warning, notify once
- **E — Rapid Epic refresh**: fingerprint change detection prevents duplicate notifications
- **F — Manual refresh**: `refresh()` calls `applyGamesSafely(enriched, "manual-refresh")` → Epic games appended from store via `getEpicLibraryGames()`
- **G — Steam actions**: "Uninstall in Steam" hidden for Epic; "Open in Steam" already safe via `getLauncherGamePrimaryAction()`

### Key Files Changed
- `src/types/libraryGame.ts` — added `isInstalled?: boolean` field
- `src/services/epicFeatureFlag.ts` — **new** — feature flag + debug flag
- `src/services/epicGameLibraryMapper.ts` — **new** — pure mapper + eligibility filter + fingerprint
- `src/services/epicGameStore.ts` — **new** — memory-first provider store with subscription
- `src/context/LibraryGamesContext.tsx` — Epic imports, `getEpicLibraryGames()`, `applyGamesSafely` Epic append, Epic subscription effect, fingerprint fixes
- `src/components/games/GameLauncherTile.tsx` — "Uninstall in Steam" gated for Epic
- `src/components/layout/SidebarLibraryList.tsx` — "Uninstall in Steam" gated for Epic

### Build
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
