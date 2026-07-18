# LumaForge — Epic Games Store & GOG Galaxy Integration Audit

**Date:** 2026-07-15
**Branch:** `feature/external-launcher-import`
**Status:** Analysis-only — zero source files modified

---

## PART 1: Current Game Architecture

### 1.1 LibraryGame — The Unified Model

**File:** `src/types/libraryGame.ts` (66 lines)

```typescript
export type LibraryGameSource = "steam" | "local" | "lua" | "manual";
```

`LibraryGame` is a **43-field unified model** shared by all surfaces (Dashboard, Library Grid, Sidebar, Console Mode, Store). Key identity fields:

| Field | Purpose | Steam-only? |
|-------|---------|------------|
| `id` | Unique key: `"steam-480"`, `"manual:<uuid>"`, `"local-<hash>"` | No — pattern per source |
| `appId` | **Steam numeric ID** (e.g. `"480"`) | **YES** — undefined for non-Steam |
| `libraryId` | Stable library-scoped ID: `"steam-480"`, `"manual:<uuid>"` | No — generic |
| `providerId` | Provider identifier: `"steam"`, `"manual"`, `"epic"`, `"gog"` | **No — exists but unused** |
| `providerGameId` | Provider's own game ID | **No — exists but unused** |
| `linkedSteamAppId` | Optional Steam appId for metadata resolution | No — metadata only |
| `linkedIgdbId` | Optional IGDB ID for metadata resolution | No — metadata only |
| `source` | `LibraryGameSource` enum | **YES — missing `"epic"` and `"gog"`** |
| `steamInstalled` | Whether installed via Steam | **YES** |
| `isPlayable` | Whether game can be launched | No — generic |
| `isInstallable` | Whether game can be installed | No — generic |

**Steam-specific fields (14):**
- `steamInstalled`, `steamLastPlayedAt`, `steamPlaytimeMinutes`, `steamPlaytime2Weeks`, `steamCloudStatus`
- `achievementUnlocked`, `achievementTotal`, `achievementsSupported`
- All `hasLua*`/`isLuaActive*` fields (Lua overlay, not source-specific)

**Key architectural decision from AGENTS.md:**
> appId remains Steam-only; external providers get `source`, `providerId`, `providerGameId`, `libraryId` fields with `appId = undefined`

### 1.2 Source → Surface Flow

```
libraryGameResolver.ts
  buildFromSteam()     → source: "steam",    appId: string
  buildFromLocalExe()  → source: "local",    appId: undefined
  buildFromLua()       → source: "lua",      appId: string (Steam appId)
  buildFromOwned()     → source: "steam",    appId: string
  → mergeGames()       → dedupeLibraryGames()
  → LibraryGamesContext → useLibraryGames() → all consumers
```

**No `buildFromEpic()` or `buildFromGog()` functions exist.**

### 1.3 Fingerprint Functions

```typescript
// libraryGameResolver.ts (for rendering dedup)
`${g.appId}:${g.title}:${g.source}:${!!g.steamInstalled}:${!!g.isPlayable}:${!!g.isFavorite}:${!!g.hasLua}:${g.steamLastPlayedAt}:${g.steamPlaytimeMinutes}:${g.achievementTotal}:${g.imageUrl}`

// libraryGamesContext.tsx (for snapshot dedup)
`${g.appId}:${!!g.steamInstalled}:${!!g.isPlayable}:${!!g.isFavorite}:${g.steamLastPlayedAt}:${g.steamPlaytimeMinutes}:${g.achievementTotal}`
```

Both use `g.appId` as primary key. Epic/GOG games (with `appId = undefined`) would produce `"undefined:..."` fingerprints — **collision risk**.

---

## PART 2: Existing Provider Abstractions

### 2.1 Provider Capabilities (Dead Code)

**File:** `src/types/gameProviderCapabilities.ts` (98 lines)

15 boolean capability flags. **6 are Steam-prefixed:**
```typescript
canUseSteamAppInfo, canUseSteamCloud, canUseSteamAchievements,
canUseSteamUpdates, canUseSteamInstall, canUseSteamOwned
```

The `getCapabilities(source)` function defaults unknown sources to Steam:
```typescript
export function getCapabilities(source: LibraryGameSource): GameProviderCapabilities {
  return PROVIDER_CAPABILITIES[source] ?? PROVIDER_CAPABILITIES.steam;
}
```

**Critical:** `PROVIDER_CAPABILITIES` is only imported by 3 files (`mediaAdapter.ts`, `providerMediaPaths.ts`, `gameEditorDraft.ts`) — all importing the `MediaRole` type only. **The capability map is never read at runtime.** No component gates behavior on capabilities.

### 2.2 Provider Media Paths (Ready)

**File:** `src/services/providerMediaPaths.ts` (320 lines)

```typescript
export type MediaProviderId =
  | "steam" | "manual" | "epic" | "gog"
  | "battle_net" | "ubisoft" | "ea" | "amazon"
  | "local" | "lua" | "unknown";
```

Convention: `games/<provider>/<providerGameId>/media/<role>.<extension>`

**Already complete.** No changes needed for Epic/GOG disk paths.

### 2.3 Media Adapter (Ready)

**File:** `src/services/mediaAdapter.ts` (537 lines)

`createMediaAdapter(game)` factory dispatches by `game.source`:
- `"steam"` → `SteamMediaAdapter`
- `"manual"` → `GenericMediaAdapter`
- Unknown → `GenericMediaAdapter` (catches `"epic"`, `"gog"`)

**Already supports Epic/GOG via GenericMediaAdapter.** Uses `buildProviderMediaPath` from `providerMediaPaths.ts`.

### 2.4 Library Navigation Service

**File:** `src/services/libraryNavigationService.ts` (55 lines)

Uses `appId` as the focus key:
```typescript
export function setPendingLibraryFocus(appId: string, title?: string)
```

**Problem:** Epic/GOG games have `appId = undefined`. Would need `libraryId` or `id` as focus key.

### 2.5 Playtime Service (Ready)

**File:** `src/services/playtimeService.ts`

`ExternalPlaytimeImport.externalSource` already accepts:
```typescript
"steam" | "epic" | "gog" | "manual" | "unknown"
```

`PlaytimeEntry.externalSource` is `string | null` (generic).

**Already supports Epic/GOG playtime import.** No changes needed.

---

## PART 3: Epic/GOG Reference Files

### 3.1 Epic Games

**Zero `.js` files exist** in the entire repo. The "Epic API" files mentioned in older prompts do NOT exist:
- ❌ `src/services/epic-api.js` — does not exist
- ❌ `src/services/epic-auth.js` — does not exist
- ❌ `src/services/epic-local-installations.js` — does not exist

**What DOES exist (string literal placeholders only):**
- `src/types/libraryGame.ts:5` — `"epic"` is NOT in `LibraryGameSource` union
- `src/types/gameProviderCapabilities.ts` — no Epic entry in `PROVIDER_CAPABILITIES`
- `src/services/providerMediaPaths.ts:29` — `"epic"` IS in `MediaProviderId`
- `src/services/playtimeService.ts:60` — `"epic"` IS in `ExternalPlaytimeImport.externalSource`
- `src/services/libraryProgressService.ts:10` — `"epic"` IS in `LibraryLoadSource`
- `src/services/consoleLoggerService.ts` — `"epic"` in logger placeholder

### 3.2 GOG Galaxy

Same pattern — zero implementation, placeholder strings only:
- ❌ No GOG API/auth/import files
- ✅ `"gog"` in `MediaProviderId`, `ExternalPlaytimeImport.externalSource`, `LibraryLoadSource`
- ❌ Not in `LibraryGameSource`, `PROVIDER_CAPABILITIES`

### 3.3 Integration Level Summary

| Layer | Epic/GOG Support |
|-------|------------------|
| `LibraryGameSource` type | ❌ Missing |
| `PROVIDER_CAPABILITIES` map | ❌ Missing |
| `MediaProviderId` | ✅ Ready |
| `ExternalPlaytimeImport` | ✅ Ready |
| `LibraryLoadSource` | ✅ Ready |
| `libraryGameResolver.ts` | ❌ No builder functions |
| `providerMediaPaths.ts` | ✅ Ready |
| `mediaAdapter.ts` | ✅ Ready (GenericMediaAdapter) |
| `launchGame()` dispatch | ❌ Steam-only |
| `isSidebarInstalledGame()` | ❌ Steam-only |
| `getLauncherGamePrimaryAction()` | ❌ Steam-only |
| `computeGameKey()` | ⚠️ Uses `game.id` (could work) |
| `FavoritesContext` | ⚠️ Uses `appId` key (would fail) |
| Snapshot hydration | ❌ Steam-only |

---

## PART 4: Desktop Mode Integration Points

### 4.1 Dashboard Sections (Home.tsx)

**Data source:** `snapshot.library.games` — a snapshot taken at boot, containing only Steam games + manual merge.

| Section | Data Source | Epic/GOG Impact |
|---------|-------------|-----------------|
| GameHero | `selectedGame` from context | None — game already resolved |
| ContinuePlaying | snapshot `games` | ❌ Would miss Epic/GOG |
| Favorites | snapshot `games` filtered by `favoriteIds` | ❌ Would miss Epic/GOG |
| Recommended | `libraryGames` from context | ⚠️ Depends on context merge |
| TopPlayed | snapshot `games` | ❌ Would miss Epic/GOG |
| NewNoteworthy | `readAllGames()` SQLite | ❌ SQLite only has Steam |
| FeaturedPicks | `readAllGames()` SQLite | ❌ SQLite only has Steam |

**Home.tsx does NOT call `mergeGames` or `getManualLibraryGames` directly.** It reads snapshot data and context data separately. Epic/GOG games would need to be merged into the snapshot or into the context's game list.

### 4.2 Library Grid (Library.tsx)

**Data source:** `useLibraryGames()` context.

```typescript
const displayGames = useMemo(() => {
  const sorted = [...games].sort((a, b) => a.title.localeCompare(b.title));
  if (focusAppId) return sorted.filter((g) => g.appId === focusAppId);
  return sorted;
}, [games, focusAppId]);
```

**Problem 1:** `focusAppId` filters by `g.appId === focusAppId`. Epic/GOG games have `appId = undefined` — focus mode would never show them.

**Problem 2:** Library filter `"installed"` delegates to `isSidebarInstalledGame(g)` which only checks `steamInstalled`, `local`/`manual` + `executablePath`, legacy `installStatus`, or `luaActive`. **Epic/GOG installed games would be filtered out.**

**Problem 3:** Play action handler:
```typescript
if (game.source === "steam" && game.appId) {
  await session.launchGame(game);
} else if ((game.source === "local" || game.source === "manual") && game.executablePath) {
  // open executable
}
```
**No `"epic"` or `"gog"` branches exist.** Epic/GOG games would fall through to no action.

### 4.3 Sidebar (SidebarLibraryList.tsx)

**Filter:** `isSidebarInstalledGame(game)` — same function as Library.

**Context menu items** (hardcoded):
- "Uninstall in Steam" — opens Steam store URL
- "Open in Steam" — opens Steam store URL
- No Epic/GOG equivalents

**Label:** `getSidebarLabel(game)` produces: `"Steam"`, `"Lua"`, `"Manual"`, `"Local"`, `"Installed"`, `"Not installed"`. No `"Epic"` or `"GOG"` labels.

### 4.4 Game Details (LibraryGameDetailPage.tsx)

- `resolveCanonicalDisplayTitle(appId, game)` — uses `appId` as primary key for canonical appinfo
- Auto-repair: `detectAndQueueMissingMedia(appId)` — Steam metadata resolution
- Hero media: resolved via `resolveMediaByPriority` which uses `game.metadata` (Steam-specific)

**Epic/GOG games would have no metadata resolution path.**

### 4.5 Store Details (StoreGameDetailsPage.tsx)

- Source availability: `sourceAvailabilityCacheService` — provider-agnostic
- Download: `downloadFromSource()` — provider-agnostic (calls `downloadAndInstallPackage` Rust command)
- DRM info: Steam Store HTML parser — Steam-only

**Store download flow is already provider-agnostic.** Epic/GOG could use the existing download pipeline if they provide `PackageSource` entries.

---

## PART 5: Console Mode Integration

### 5.1 Console Mode Compatibility

**File:** `src/features/console/consoleLibraryAdapter.ts`

No `isConsoleModeCompatible` function exists. The file provides:
- `ConsoleLibraryGame` type (extends `LibraryGame` with `_consoleMedia`/`_consoleMeta`)
- `resolveConsoleMedia(appId)` — async media URL resolver
- `useConsoleLibraryMedia(games)` — React hook enriching games with resolved media

**Media resolution for manual games** (lines 90-108):
```typescript
if (g.source === "manual" && g.providerGameId) {
  const entry = getManualGame(g.providerGameId);
  // resolve 5 media paths from ManualGameEntry
}
```

**Epic/GOG games would need a similar branch** — or better, a generic `resolveProviderGameMedia(game)` function.

### 5.2 Console Game Key

**File:** `src/context/GameSessionContext.tsx:152-161`

```typescript
export function computeGameKey(game: {
  id?: string;
  appId?: string;
  executablePath?: string;
}): string {
  if (game.id) return game.id;         // "steam-480", "manual:<uuid>"
  if (game.appId) return `app-${game.appId}`;
  if (game.executablePath) return `path-${game.executablePath}`;
  return `unknown-${Date.now()}`;
}
```

**Epic/GOG games** would use `game.id` (e.g. `"epic-<catalogId>"` or `"gog-<galaxyId>"`) — **works if `id` is set correctly by the builder.**

### 5.3 Console Launch

**File:** `src/context/GameSessionContext.tsx:842`

`launchGame(game)` dispatches by `game.source`:
- `"steam"` → `launch_steam_app` Rust command
- `"manual"` → `open execPath` via `open` crate
- Default → no-op (logs warning)

**No `"epic"` or `"gog"` dispatch exists.** Would need new Rust commands or external process launch.

### 5.4 Console Media Resolution

**File:** `src/features/console/consoleMedia.ts` (75 lines)

Three sync extractors read from `_consoleMedia` or `game.metadata`:
- `getConsoleHeroBackground(game)` — heroSrc → metadata.hero → background → header → imageUrl
- `getConsoleCardSrc(game, variant)` — cover/landscape from `_consoleMedia` → metadata
- `getConsoleLogoSrc(game)` — logoSrc → metadata

**Already generic** — reads `_consoleMedia` which is populated by `useConsoleLibraryMedia`. No Steam-specific logic. **Works for Epic/GOG if `_consoleMedia` is populated.**

### 5.5 Console Game Actions

**File:** `src/features/console/consoleGameActions.ts`

`getConsoleGameActionModel(game)` maps `getLauncherGamePrimaryAction(game)` → `ConsolePrimaryAction`.

The action derivation uses `game.appId` for update status:
```typescript
const updateStatus = game.appId ? getUpdateStatus(game.appId) : undefined;
```

**Epic/GOG games** with `appId = undefined` would always get `updateStatus = undefined` → `showCheckUpdateRow = true`. This is acceptable (no update checking for these providers yet).

Install action check:
```typescript
const hasNumericAppId = !!game.appId && /^\d+$/.test(game.appId);
if (hasNumericAppId) { enabled = true; }
```

**Epic/GOG games** would have `enabled = false` for install — **wrong if we have a way to install them.**

---

## PART 6: Launch Architecture

### 6.1 GameSessionContext.launchGame()

**File:** `src/context/GameSessionContext.tsx:842-874`

```typescript
const launchGame = useCallback(async (game: LibraryGame) => {
  const computedKey = computeGameKey(game);
  // guard: already launching/running/stopping → return
  // snapshot processes for diff
  // set "launching" state
  // dispatch by source...
```

The dispatch happens later in the function (not shown in the 30-line excerpt). Based on the pattern, it's:
```typescript
if (game.source === "steam" && game.appId) → launch_steam_app
if (game.source === "manual" && game.executablePath) → open via open crate
else → log warning
```

### 6.2 Session Management

Sessions are keyed by `computeGameKey(game)`. For Epic/GOG:
- Key would be `game.id` (e.g. `"epic-<catalogId>"`)
- Session state tracked in `sessions` Record
- Playtime recorded via `recordPlaytime(gameKey)`

**Session management is already generic** — works for any key format.

### 6.3 Activity Feed

**File:** `src/services/activityFeed.ts` (not read in detail)

Reads from `sessions` Record. Keys are `computeGameKey` outputs. **Generic — works for Epic/GOG keys.**

### 6.4 Favorites

**File:** `src/context/FavoritesContext.tsx` (72 lines)

```typescript
const STORAGE_KEY = "lumaforge-favorites-v1";
type FavoritesState = {
  favoriteIds: Set<string>;
  isFavorite: (appId: string) => boolean;
  toggleFavorite: (appId: string) => void;
};
```

**Critical:** `isFavorite` and `toggleFavorite` take `appId: string`. Epic/GOG games have `appId = undefined`.

**Fix needed:** Change to `isFavorite(key: string)` where `key = game.appId || game.id`. Update all call sites.

---

## PART 7: Installation Detection

### 7.1 Steam Detection

**File:** `src/services/providerStatusReconciliation.ts`

```typescript
schedulePostSnapshotSteamReconciliation(games, updateGame, { steamRoot })
  → scanSteamInstalledGames({ steamPath: steamRoot })
  → diff against games with appId
  → updateGame(appId, { steamInstalled, isPlayable, isInstallable, source, installDir })
```

**Steam-only.** Uses `scanSteamInstalledGames` Rust command (reads all appmanifests).

`resolveSourceForInstallState(currentSource, steamInstalled, hasLua)`:
```typescript
if (steamInstalled) return "steam";
if (hasLua) return "lua";
return currentSource;
```

**No Epic/GOG detection exists.** Would need:
- Epic: Read `*.item` files from `ProgramData/Epic/EpicGamesLauncher/Data/Manifests/`
- GOG: Read `galaxy-*.json` from `C:\ProgramData\GOG.com\Galaxy\Storage\`

### 7.2 Sidebar Filter

**File:** `src/services/gameCacheService.ts:437-478`

```typescript
export function isSidebarInstalledGame(game: LibraryGame): boolean {
  const steamInstalled = game.steamInstalled === true;
  const localInstalled = (game.source === "local" || game.source === "manual") &&
    typeof game.executablePath === "string" && game.executablePath.length > 0;
  const explicitInstalledStatus = (game as any).installedStatus === "active" || ...;
  const luaActive = hasActiveInstalledLuaScript(game);
  return Boolean(steamInstalled || localInstalled || explicitInstalledStatus || luaActive);
}
```

**Epic/GOG games** would need a new branch:
```typescript
const providerInstalled = (game.source === "epic" || game.source === "gog") &&
  game.isPlayable;  // or a new installed boolean
```

---

## PART 8: Persistence

### 8.1 SQLite Games Table

**File:** `src/services/gameCacheService.ts`

The `games` table stores `LibraryGame` objects with a `source` column. Currently stores `"steam"`, `"local"`, `"lua"`, `"manual"` sources.

**Schema migration needed** to add `"epic"` and `"gog"` to the source CHECK constraint (if any).

### 8.2 Snapshot

**File:** `src/services/startupSnapshotService.ts`

Snapshot contains `library.games` — an array of `LibraryGame` objects. Currently only Steam games + manual merge.

**Epic/GOG games would need to be included in the snapshot** for Dashboard sections to display them.

### 8.3 Playtime Store

**File:** `src/services/playtimeService.ts`

```typescript
ExternalPlaytimeImport.externalSource: "steam" | "epic" | "gog" | "manual" | "unknown"
```

**Already supports Epic/GOG.** No schema changes needed.

---

## PART 9: Auth & Security

### 9.1 Steam Auth

Steam uses `steamWebApiKey` from settings + `fetchSteamOwnedGames` Rust command. No OAuth token storage in the app.

### 9.2 Epic Auth (Planned)

Would need:
- OAuth2 token storage (access token + refresh token)
- Token refresh logic
- Secure storage (not localStorage — use OS keychain or encrypted file)

### 9.3 GOG Auth (Planned)

Would need:
- GOG Galaxy SDK integration or OAuth2
- Token storage same as Epic

### 9.4 API Security

- No API keys committed to repo ✅
- Settings stored in `settings.json` (AppData) — readable but not exposed
- `downloadAndInstallPackage` Rust command handles file I/O — no JS-side file writes

---

## PART 10: Error & Offline States

### 10.1 Provider Status Service

**File:** `src/services/providerStatusService.ts`

Tracks per-provider status: `"unknown"` | `"up-to-date"` | `"update-available"` | `"checking"` | `"provider-unavailable"` | `"auth-required"`.

**Generic** — works for any provider.

### 10.2 Source Availability Cache

**File:** `src/services/sourceAvailabilityCacheService.ts`

24h TTL, 1000-entry max. Tracks `SourceAvailabilityGameEntry` per appId.

**Problem:** Indexed by `appId`. Epic/GOG games need a different key (e.g. `libraryId`).

### 10.3 Offline Behavior

- Snapshot serves as offline fallback ✅
- Store page requires network ⚠️
- Library/Sidebar/Console work offline with snapshot ✅

---

## PART 11: Library Filters & Dedup

### 11.1 LibraryFilter Type

```typescript
export type LibraryFilter = "all" | "steam" | "local" | "lua" | "installed" | "uninstalled" | "lua-ready" | "disabled" | "updates";
```

**Missing:** `"epic"`, `"gog"`, `"provider"` (generic external)

### 11.2 Filter Logic (Library.tsx:185-194)

```typescript
if (filter === "lua" && !g.hasLua) return false;
if (filter === "installed" && !isSidebarInstalledGame(g)) return false;
if (filter === "disabled" && !g.isLuaDisabled) return false;
if (filter === "updates" && g.appId) {
  const s = getUpdateStatus(g.appId);
  if (s !== "update-available") return false;
}
```

**No source-based filter exists.** Would need:
```typescript
if (filter === "epic" && g.source !== "epic") return false;
if (filter === "gog" && g.source !== "gog") return false;
```

### 11.3 Dedup

**File:** `src/services/gameCacheService.ts`

`deduplicateByAppId(items)` — deduplicates by `appId`. **Epic/GOG games** with `appId = undefined` would all collide into one entry.

**Fix:** Dedup by `game.appId || game.id`.

---

## PART 12: Provider Detection — Rust Commands Needed

### 12.1 Epic Games Store

**Discovery:**
- `manifests_dir`: `%PROGRAMDATA%/Epic/EpicGamesLauncher/Data/Manifests/`
- Files: `*.item` (JSON format)
- Key fields: `InstallLocation`, `AppName`, `CatalogNamespace`, `DisplayName`, `ReleaseVersion`, `InstallSize`

**Launch:**
```
com.epicgames.launcher://apps/<AppName> --action=launch
```
Or: `EpicGamesLauncher.exe -opendirect <CatalogNamespace>/<AppName>`

**Rust commands needed:**
1. `scan_epic_installed_games(manifests_dir: Option<String>) → Vec<EpicInstalledGame>`
2. `launch_epic_game(app_name: String) → Result<()>`
3. `read_epic_manifests(dir: String) → Vec<EpicManifest>`

### 12.2 GOG Galaxy

**Discovery:**
- `storage_dir`: `C:\ProgramData\GOG.com\Galaxy\Storage\`
- Files: `galaxy-*_product.json` (JSON format)
- Key fields: `install_path`, `game_id`, `name`, `playtime`, `dlcs`

**Launch:**
```
GalaxyClient.exe /launchGame=<game_id>
```
Or: `GalaxyClient.exe --open=game/<game_id>`

**Rust commands needed:**
1. `scan_gog_installed_games(storage_dir: Option<String>) → Vec<GogInstalledGame>`
2. `launch_gog_game(game_id: String) → Result<()>`
3. `read_gog_product_files(dir: String) → Vec<GogProduct>`

---

## PART 13: API Risk Assessment

### 13.1 Steam API

- **Status:** Stable, well-documented, official API
- **Rate limits:** 100K requests/day (generous)
- **Risk:** Low — already fully integrated

### 13.2 Epic Games API

- **Status:** Unofficial, undocumented, community-maintained
- **Rate limits:** Unknown (no official limits published)
- **Risk:** **High** — API can change without notice
- **Mitigation:** Use local manifest files (no API calls) for discovery; only use API for store metadata

### 13.3 GOG API

- **Status:** Semi-official (Galaxy SDK exists but requires partner agreement)
- **Rate limits:** Not published for unofficial use
- **Risk:** **Medium** — Galaxy SDK is stable but requires authentication
- **Mitigation:** Use local product files for discovery; Galaxy SDK for launch only

### 13.4 SteamGridDB / IGDB / RAWG

- **Status:** Stable, API-key authenticated
- **Risk:** Low — already integrated for metadata

---

## PART 14: Test Plan

### 14.1 Unit Tests

| Component | Test Case |
|-----------|-----------|
| `LibraryGameSource` type | `"epic"` and `"gog"` compile-time acceptance |
| `buildFromEpic(manifest)` | Correct field mapping, `appId = undefined` |
| `buildFromGog(product)` | Correct field mapping, `appId = undefined` |
| `computeGameKey(epicGame)` | Returns `game.id` (not `"app-undefined"`) |
| `isSidebarInstalledGame(epicGame)` | Returns `true` when `isPlayable = true` |
| `getLauncherGamePrimaryAction(epicGame)` | Returns `"play"` when installed |
| `getCapabilities("epic")` | Returns Epic-appropriate capabilities |
| `deduplicateByAppId([epicGames])` | Deduplicates by `id`, not `appId` |
| `FavoritesContext.toggleFavorite(epicGame)` | Stores `game.id`, not `appId` |

### 14.2 Integration Tests

| Flow | Expected Behavior |
|------|-------------------|
| Epic game appears in Library grid | Shows title, cover, "Play" button |
| Epic game appears in Sidebar | Shows "Epic" label, not "Not installed" |
| Epic game in Console Mode | Shows in "Installed" rail, launchable |
| Epic game favorite | Toggle persists, reappears on reload |
| Epic game playtime | Recorded via `importExternalPlaytime` |
| GOG game → Library grid | Same as Epic |
| Epic + Steam same game | Deduped by `linkedSteamAppId` or normalized title |
| Offline mode | Epic/GOG games visible from snapshot |
| Provider unavailable | "Install" button disabled, clear message |

### 14.3 E2E Scenarios

1. **Fresh install → Import Epic library** → Games appear in Library/Sidebar/Console
2. **Import Epic + Steam** → Dedup works → No duplicate cards
3. **Play Epic game** → Session tracked → Playtime recorded → Last played updated
4. **Favorite Epic game** → Persists across restart
5. **Epic game update available** → Badge shows in Library/Console
6. **Epic launcher not running** → Clear error message, not crash
7. **Epic auth expired** → "Auth required" status, re-auth prompt

---

## PART 15: Phased Implementation Plan

### Phase 0: Type System (No Runtime Changes)

1. Add `"epic"` and `"gog"` to `LibraryGameSource` union
2. Add `"epic"` and `"gog"` to `PROVIDER_CAPABILITIES` map
3. Update `getCapabilities()` to return Epic/GOG-specific capabilities
4. Update `LibraryFilter` to include `"epic"`, `"gog"`

### Phase 1: Builder Functions

1. Create `buildFromEpic(manifest): LibraryGame` in `libraryGameResolver.ts`
2. Create `buildFromGog(product): LibraryGame` in `libraryGameResolver.ts`
3. Set `source: "epic"`, `providerId: "epic"`, `providerGameId: <manifest.AppName>`, `id: "epic-<AppName>"`
4. Set `appId: undefined` (per architecture rule)

### Phase 2: Detection (Rust)

1. Implement `scan_epic_installed_games` command
2. Implement `scan_gog_installed_games` command
3. Implement `launch_epic_game` command
4. Implement `launch_gog_game` command
5. Register all commands in `lib.rs`
6. Add TS bindings in `tauri.ts`

### Phase 3: Integration Layer

1. Update `isSidebarInstalledGame()` — add `source === "epic" || source === "gog"` branch
2. Update `getSidebarLabel()` — add `"Epic"` / `"GOG"` labels
3. Update `getLauncherGamePrimaryAction()` — add Epic/GOG branches
4. Update `FavoritesContext` — use `game.appId || game.id` as key
5. Update `computeLibraryFingerprint()` — handle `appId = undefined`
6. Update `computeGamesFingerprint()` — handle `appId = undefined`

### Phase 4: Launch Integration

1. Update `GameSessionContext.launchGame()` — add `"epic"` and `"gog"` dispatch
2. Update `launchGameFromConsole()` — same dispatch
3. Test session tracking with Epic/GOG keys

### Phase 5: Media & Metadata

1. Update `resolveConsoleMedia()` — add Epic/GOG branch (like manual games)
2. Update `detectAndQueueMissingMedia()` — resolve metadata from Epic/GOG APIs
3. Update `refreshArtwork()` — use Epic/GOG metadata sources
4. Test 5-role media (cover, landscape, background, logo, icon) for Epic/GOG

### Phase 6: Dashboard & Library

1. Update `LibraryGamesContext.load()` — merge Epic/GOG games from detection
2. Update snapshot hydration — include Epic/GOG games
3. Update Library filter logic — add source-based filters
4. Update Dashboard sections — ensure Epic/GOG games appear

### Phase 7: Console Mode

1. Test Console Grid with Epic/GOG games
2. Test Console Spotlight with Epic/GOG games
3. Test Console Game Details with Epic/GOG metadata
4. Test Console Quick Menu actions for Epic/GOG

---

## PART 16: Open Questions for User

1. **Epic Games import:** Use local manifests only, or also Epic Online Services API?
2. **GOG Galaxy import:** Use local product files only, or also Galaxy SDK?
3. **Dedup strategy:** When same game exists on Steam + Epic, which wins? Or show both?
4. **Metadata source:** For Epic/GOG games, use Steam metadata (via `linkedSteamAppId`) or provider-specific metadata?
5. **Achievements:** Epic/GOG achievements — track locally or via provider API?
6. **Cloud saves:** Epic/GOG cloud save support — needed or local only?
7. **Priority:** Implement Epic first, GOG first, or both simultaneously?

---

## PART 17: Verification Checklist

- [ ] No source files modified during this audit ✅
- [ ] `git status` clean (only audit document added) — **pending user verification**
- [ ] All TypeScript types compile with new source values — **pending Phase 0**
- [ ] All Rust commands compile — **pending Phase 2**
- [ ] No runtime errors in Desktop Mode — **pending Phase 3-6**
- [ ] No runtime errors in Console Mode — **pending Phase 7**
- [ ] Playtime tracking works for Epic/GOG — **pending Phase 4**
- [ ] Favorites persist for Epic/GOG — **pending Phase 3**
- [ ] Sidebar shows Epic/GOG games — **pending Phase 3**
- [ ] Library grid shows Epic/GOG games — **pending Phase 6**

---

## Key Files Summary

| File | Changes Needed | Priority |
|------|---------------|----------|
| `src/types/libraryGame.ts` | Add `"epic"`, `"gog"` to `LibraryGameSource` | P0 |
| `src/types/gameProviderCapabilities.ts` | Add Epic/GOG capabilities, fix default | P0 |
| `src/services/libraryGameResolver.ts` | Add `buildFromEpic()`, `buildFromGog()` | P1 |
| `src/services/providerStatusReconciliation.ts` | Add Epic/GOG detection | P2 |
| `src/services/gameCacheService.ts` | Update `isSidebarInstalledGame()`, `getSidebarLabel()`, fingerprint functions | P3 |
| `src/utils/launcherGameActions.ts` | Add Epic/GOG launch branches | P3 |
| `src/context/FavoritesContext.tsx` | Use `game.appId \|\| game.id` key | P3 |
| `src/context/GameSessionContext.tsx` | Add Epic/GOG launch dispatch | P4 |
| `src/services/providerMediaPaths.ts` | No changes (already ready) | — |
| `src/services/mediaAdapter.ts` | No changes (GenericMediaAdapter handles it) | — |
| `src/services/playtimeService.ts` | No changes (already supports Epic/GOG) | — |
| `src/features/console/consoleMedia.ts` | No changes (already generic) | — |
| `src-tauri/src/commands/` | New `epic.rs`, `gog.rs` commands | P2 |
| `src/services/tauri.ts` | New TS bindings for Epic/GOG commands | P2 |
