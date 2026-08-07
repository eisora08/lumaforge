## Session — Manual Game Removal Root Cause Fix + Debug Tracing

### Problem
Manual game removal (delete from Library) did not actually remove the game from any UI surface. The game persisted in Sidebar, Library grid, Console, and Dashboard despite `removeManualGame()` succeeding in the store.

### Root Cause
`mergeGames()` in `LibraryGamesContext.tsx:341` — the `reconciled-update`/`cached`/`snapshot-fallback`/`reconciled-fallback` merge path (lines 349-371) iterates ALL games from `current` (`gamesRef.current`, which is stale until React renders) and adds them to `byAppId`. The second loop only **adds/replaces** from `incoming` — it never **removes** entries absent from `incoming`. When a manual game is removed:

1. `removeManualGame()` splices from store, calls `notifyListeners()` synchronously
2. Manual subscription fires → strips manual games → calls `applyGamesSafely(nonManual, "manual-update")`
3. `mergeGames(current, withManual, "manual-update")` falls through to `dedupeLibraryGames(incoming)` (correct path — manual-update source skips the merge branch)
4. **But**: if a `reconciled-update` fires before React renders (before `gamesRef.current` updates), `mergeGames(current, reconciled+freshManual, "reconciled-update")` enters the first branch
5. First loop: ALL `current` games (including stale removed manual game) added to `byAppId`
6. Second loop: `incoming` doesn't have the removed game → it's never removed from `byAppId`
7. Result: removed manual game survives the merge

### Fix
**`LibraryGamesContext.tsx` `mergeGames()`** — In the first loop (lines 349-355), manual games (no `appId`) are no longer copied from `current` into `byAppId`. Manual games are always sourced exclusively from `incoming` → `getManualLibraryGames()` (line 222 in `applyGamesSafely`), which reads the latest manualGameStore. This prevents a removed manual game from surviving the merge via a stale `gamesRef.current`.

### Diagnostic Logs Added
- `[MANUAL_REMOVE][STORE]` — Always logged when `removeManualGame()` is called (found/not-found + remaining count)
- `[MANUAL_REMOVE][SIDEBAR]` / `[CONSOLE]` / `[DETAILS]` / `[TILE]` — Click-site traces behind `DEBUG_MANUAL_REMOVE = false` in each file
- `[MANUAL_REMOVE][LIBRARY_SUB]` — Subscription callback trace: prevManual count, freshManual count, removed IDs
- `[MANUAL_REMOVE][APPLY]` — `applyGamesSafely` merge result: prev total/manual, merged total/manual, fingerprint changed

### Downstream Propagation Verified
- **Sidebar**: reads `games` from `useLibraryGames()` → re-renders without removed game
- **Console**: reads `games` from `useLibraryGames()` → re-renders without removed game
- **Library grid**: reads `games` from `useLibraryGames()` → re-renders without removed game
- **Selected game**: `useEffect` at line 191 auto-clears `selectedId` when game disappears from `games`
- **LibraryGameDetails**: `onBack()` called after removal, navigating away from detail page
- **Favorites**: Stale `"manual:<uuid>"` in localStorage is harmless (UI filters by game existence)
- **gameStore/reconciled-update**: `getReconciledGames()` never contains manual games (gameStore has no manual concept)
- **Fingerprint skip**: Bypassed for `"manual-update"` source; for `reconciled-update`, fingerprints differ (current has removed game, incoming doesn't) → skip not triggered → merge proceeds correctly

### Key Files Changed
- `src/context/LibraryGamesContext.tsx` — `mergeGames()` skip manual games from `current`, `DEBUG_MANUAL_REMOVE` flag, subscription trace log, applyGamesSafely merge trace
- `src/services/manualGameStore.ts` — `removeManualGame()` trace log (always-on)
- `src/components/layout/SidebarLibraryList.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace
- `src/components/library/LibraryGameDetails.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace
- `src/features/console/ConsoleGameOptionsOverlay.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace
- `src/components/games/GameLauncherTile.tsx` — `DEBUG_MANUAL_REMOVE` flag + click trace

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
