## Session 5 — Title enrichment doesn't run when games are in SQLite

### Problem
The name enrichment code written in Session 4 (`appBootCoordinator.ts:303-358`) was inside the `if (missingFromSqlite.length > 0)` block. When games already exist in SQLite from a prior scan, reconciliation is skipped (`missingFromSqlite` is empty), so name enrichment never runs. This means placeholder titles ("Steam App <appid>") never get resolved for the common case of returning users.

### Root Cause
- Stage 4.5 reconciliation only runs when games are missing from SQLite
- Name enrichment was gated on reconciliation
- `rebuildLibraryIndex` (gameStore.ts:453) has zero callers — dead code
- Dashboard sections call `resolveCanonicalDisplayTitle(appId, game)` with only 2 args (no canonicalInfo), so they only see `game.title` from snapshot — if snapshot wasn't enriched, placeholders persist

### Fixes

#### Part 1: Move enrichment outside the `if (missingFromSqlite.length > 0)` block
- `appBootCoordinator.ts` — Restructured Stage 4.5 to always run name enrichment regardless of whether reconciliation was needed
- New `else` branch when `missingFromSqlite.length === 0`: reconstructs games from SQLite index via `indexEntryToLibraryGame`, then runs the same enrichment pipeline
- Enrichment sources (in priority order): canonical appinfo → `resolveGameMetadata` (new) → `getStoreDetails`
- Writes resolved names to canonical appinfo via `updateGameAppinfoMedia` and updates the in-memory snapshot

#### Part 2: Add Stage 3.5 enrichment (before UI renders)
- New boot task `"enrich-snapshot-titles"` added to `BootTaskId` type
- Runs right after snapshot hydration (Stage 3), before SQLite loading (Stage 4)
- Resolves placeholder titles on snapshot games via `resolveGameMetadata` → `getStoreDetails`
- Saves the enriched snapshot to disk via `saveStartupSnapshot`
- Ensures dashboard sections see real names from the start (before `Home.tsx` memoizes the snapshot)

#### Part 3: Remaining enrichment in Stage 4.5 serves the library grid
- Writes resolved names to canonical appinfo → `appinfo.json` on disk
- `GameLauncherTile` reads canonical appinfo via `loadGameAppInfoWithMediaFallback` (deferred until viewport)
- `resolveCanonicalDisplayTitle(appId, game, appInfoEntry, canonicalInfo)` with 4 args uses `canonicalInfo.name` as top priority

### Key Changes
- **`appBootCoordinator.ts`**: Stage 3.5 enrichment added; Stage 4.5 restructured to always run enrichment; `enrich-snapshot-titles` added to `BootTaskId`
- **Dashboard sections**: Get real names immediately because snapshot game.titles are enriched before UI renders (Stage 3.5)
- **Library grid**: Gets real names deferred — `loadGameAppInfoWithMediaFallback` reads enriched `appinfo.json` when card enters viewport
- **`GameLauncherTile.tsx`**: `resolveCanonicalDisplayTitle` with `canonicalInfo.name` as top priority — already works correctly
