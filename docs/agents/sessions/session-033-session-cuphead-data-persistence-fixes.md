## Session — Cuphead Data Persistence Fixes

### Problem
After playing a game (e.g., Cuphead), session-end data wasn't reflected in the UI:
1. Dashboard `lastPlayedAt` not updated after session ends
2. Detail page playtime not reflecting
3. Achievement percent disappears after page reload

### Root Causes

#### Issue 1: Dashboard lastPlayedAt not updating
- `_processDirtyAppIds` (`startupSnapshotService.ts`) only patched **media fields** (landscapePath, coverPath, etc.)
- After session end, `notifyMediaUpdated` was called with `source: "playtime-changed"`, but `_processDirtyAppIds` never updated `lastPlayed` or `playtime` in the snapshot
- Dashboard reads `heroGame.playtime`/`heroGame.lastPlayed` from snapshot — stale data persisted

#### Issue 2: No React re-render on data change
- `cachedStore` in `playtimeService.ts` is a **module-level variable** — updates via `endPlaySession` or `importExternalPlaytime` don't trigger React re-renders
- `GameHero.tsx` and `LibraryGameDetails.tsx` read from `cachedStore` at render time, but nothing signals a re-render when the store changes
- After session ends, `cachedStore` IS updated correctly, but no component re-renders to reflect the new data

#### Issue 3: Achievement percent lost on reload
- `buildStartupSnapshotFromCurrentState` writes `achievementSummary` to snapshot, but **no component reads it back**
- `LibraryGameDetails.tsx` initializes `achievementsSummary` from in-memory `achievementStore.getSummary()` only
- On page reload: in-memory store is empty, Boot Stage 5 only loads disk cache for top 20 games
- Snapshot's `achievementSummary` (updated by full rebuild after manual refresh) was never used as fallback
- `_processDirtyAppIds` also never updated `achievementSummary` in the snapshot

### Fixes

#### Fix 1: `_processDirtyAppIds` updates playtime + achievement fields
- Added `getPlaytimeEntryByAppId` + `getLastSessionEndForAppId` imports
- Inside dirty appId loop: after media patching, queries playtime store for `lastPlayedAt`/`totalPlaytimeSeconds`, updates snapshot game fields
- Also dynamically imports `achievementStore` and patches `game.achievementSummary` from in-memory store
- Change detection (effectiveChanges) includes playtime/achievement field changes
- `startupSnapshotService.ts`

#### Fix 2: Subscribe/re-render pattern
- **`playtimeService.ts`**: Added `subscribePlaytimeStore()` + `notifyPlaytimeStored()` — called after `importExternalPlaytime`, `startPlaySession`, `endPlaySession`
- **`startupSnapshotService.ts`**: Added `subscribeSnapshotUpdated()` + `notifySnapshotWritten()` — called after both `_processDirtyAppIds` and full-rebuild `saveStartupSnapshot`
- **`GameHero.tsx`**: Subscribes to `subscribeSnapshotUpdated` via a force-update counter — re-renders after snapshot write to pick up fresh `lastPlayed`/`playtime`
- **`LibraryGameDetails.tsx`**: Subscribes to `subscribePlaytimeStore` via a force-update counter — re-renders after playtime store changes to show updated playtime

#### Fix 3: Achievement summary snapshot fallback
- **`_processDirtyAppIds`**: Now also patches `game.achievementSummary` from in-memory achievement store (dynamic import)
- **`LibraryGameDetails.tsx`**: `useState` initializer now falls back to `getCachedSnapshot()` to find the current game's `achievementSummary` when in-memory store is empty

### Key Files Changed
- `src/services/startupSnapshotService.ts` — Fix 1: `_processDirtyAppIds` playtime+achievement update, Fix 2: `subscribeSnapshotUpdated`/`notifySnapshotWritten`
- `src/services/playtimeService.ts` — Fix 2: `subscribePlaytimeStore`/`notifyPlaytimeStored`, calls in `importExternalPlaytime`/`startPlaySession`/`endPlaySession`
- `src/components/dashboard/GameHero.tsx` — Fix 2: `subscribeSnapshotUpdated` subscription for re-render
- `src/components/library/LibraryGameDetails.tsx` — Fix 2: `subscribePlaytimeStore` subscription for re-render; Fix 3: snapshot `achievementSummary` fallback in `useState` initializer

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
