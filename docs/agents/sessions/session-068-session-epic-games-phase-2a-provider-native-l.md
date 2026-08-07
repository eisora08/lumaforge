## Session — Epic Games Phase 2A: Provider-Native Launch + Play Activation

### Goal
Enable playing Epic Games from LumaForge's Library via the Epic Games Launcher protocol, with full session tracking, process detection, and playtime recording — identical to the Steam launch experience.

### Architecture
- **Dual-mode launch**: Protocol URI first (`com.epicgames.launcher:/apps/<appName>?action=launch`), direct executable fallback
- **Provider launch adapter**: `dispatchProviderLaunch()` in `src/utils/providerLaunchAdapter.ts` — provider-neutral dispatch boundary called from GameSessionContext
- **Feature-flag gated**: `EPIC_LAUNCH_ENABLED` (off by default), requires `EPIC_LIBRARY_ENABLED` also enabled
- **Launch metadata retention**: `epicGameStore.ts` retains per-game `EpicLaunchMetadata` (appName, executablePath, launchArguments, processNames) from scanner results
- **Session tracking**: Same process-detection retry pattern as Steam (2s → 3s → 5s scan, soft-session fallback)

### Parts Implemented

#### Part 1: Rust `launch_epic_game` command
- `src-tauri/src/commands/epic.rs` — new `launch_epic_game` Tauri command
- `EpicLaunchResult` struct: `{ success, method: "protocol"|"direct-executable", error? }`
- Protocol attempt: `open::that_detached("com.epicgames.launcher:/apps/{appName}?action=launch")`
- Direct executable fallback: `Command::new(exe).args(args).spawn()` with detached child
- Registered in `src-tauri/src/lib.rs`

#### Part 2: TS binding
- `src/services/tauri.ts` — `launchEpicGame(appName, executablePath?, launchArguments?)` binding + `EpicLaunchResult` type

#### Part 3: Feature flags
- `src/services/epicFeatureFlag.ts` — added `EPIC_LAUNCH_ENABLED = false` and `DEBUG_EPIC_LAUNCH = false`

#### Part 4: Launch metadata retention
- `src/services/epicGameStore.ts` — `_launchMetadataByProviderGameId` Map retains `{ appName, executablePath, launchArguments, processNames, installLocation, manifestPath }` per eligible game
- `getEpicLaunchMetadata(providerGameId)` public getter
- Metadata populated during `refreshEpicGames()` scan, cleared on `resetEpicGameCache()`

#### Part 5: Provider launch adapter
- `src/utils/providerLaunchAdapter.ts` — **new** — `dispatchProviderLaunch(game)` returns `{ dispatched, method, error }`
- Dynamic imports of `getEpicLaunchMetadata` and `launchEpicGame` to avoid circular deps
- Returns `{ dispatched: false }` for non-Epic or disabled cases

#### Part 6: GameSessionContext Epic dispatch
- `src/context/GameSessionContext.tsx`:
  - Import `dispatchProviderLaunch`
  - Source mapping: `"epic"` added to session creation
  - Dispatch delay: Epic uses 1500ms (same as Steam)
  - New `else if (game.source === "epic")` branch: calls `dispatchProviderLaunch`, then scans for process with 2s/3s/5s retry
  - On dispatch failure: session cleaned up immediately
  - Provider labels: `"Epic"` in overlay events (launch/end)
  - Playtime provider: `"epic"` for start/end sessions
  - Activity source: `"epic"` for session history records
  - Hydrate: Epic soft sessions already handled (`s.source === "epic"` at line 265)

#### Part 7: `isPlayable` derivation
- `src/services/epicGameLibraryMapper.ts` — `isPlayable = EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED && (appName || executablePath)`
- When flags are OFF: `isPlayable = false` (Phase 1B behavior preserved)

#### Part 8: Primary action
- `src/utils/launcherGameActions.ts` — Epic launchable games return `"play"` as primary action (before Steam appId check)

#### Part 9: Steam-only action gating
- `src/components/games/GameLauncherTile.tsx` — "Open in Steam" hidden for `game.source === "epic"`

#### Part 10: Activity source type
- `src/types/gameActivity.ts` — added `"epic"` to `GameActivityItem.source` union

### What was NOT changed (Phase 2A boundary)
- No achievements for Epic games
- No cloud saves, DLC detection, or ownership tracking
- No Console Mode Epic exposure
- No metadata API, no artwork resolution for Epic
- No install/uninstall via LumaForge
- No cross-provider dedup between Steam and Epic
- No changes to: startupSnapshotService, gameStore, FavoritesContext, Home, Settings, Store

### Scenario Coverage
- **A — Feature disabled**: Both flags OFF → `isPlayable = false`, Play button never shown, no launch dispatch
- **B — Protocol launch**: `dispatchProviderLaunch` → `launchEpicGame(appName)` → `open::that_detached` → process detected → running session
- **C — Direct executable fallback**: Protocol fails → `Command::new(exe).spawn()` → process spawned → running session
- **D — Both methods fail**: Error returned → session cleaned up → user sees no running state
- **E — Process detection timeout**: No process found after 10s → soft session (same as Steam)
- **F — Steam-only actions hidden**: "Open in Steam" hidden for Epic games
- **G — Play button**: Appears when `EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED` and game has `appName` or `executablePath`
- **H — Activity history**: Session records use `"epic"` source, overlay shows `"Epic"` provider

### Key Files Changed
- `src-tauri/src/commands/epic.rs` — `launch_epic_game` command, `EpicLaunchResult` type
- `src-tauri/src/lib.rs` — registered `launch_epic_game`
- `src/services/tauri.ts` — `launchEpicGame` binding, `EpicLaunchResult` type
- `src/services/epicFeatureFlag.ts` — `EPIC_LAUNCH_ENABLED`, `DEBUG_EPIC_LAUNCH`
- `src/services/epicGameStore.ts` — `_launchMetadataByProviderGameId`, `getEpicLaunchMetadata()`, metadata retention in scan
- `src/services/epicGameLibraryMapper.ts` — `isPlayable` derivation from feature flags + manifest
- `src/utils/providerLaunchAdapter.ts` — **new** — `dispatchProviderLaunch()` adapter
- `src/utils/launcherGameActions.ts` — Epic primary action "play"
- `src/context/GameSessionContext.tsx` — Epic dispatch branch, provider labels, playtime/activity source
- `src/components/games/GameLauncherTile.tsx` — "Open in Steam" gated for Epic
- `src/types/gameActivity.ts` — `"epic"` added to source union

### Build
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
