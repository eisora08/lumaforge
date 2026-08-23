## Session — B2: Duplicate readAllGames during boot

### Goal
Eliminate duplicate `readAllGames()` calls during boot by reusing Stage 4's SQLite game index in Stage 4.5.

### Root cause
Stage 4 (`appBootCoordinator.ts:294`) calls `loadSteamGameIndex()` → `readAllGames()` to count and log the game index. Stage 4.5's else branch (`appBootCoordinator.ts:447`) calls `loadSteamGameIndex()` again for name enrichment — causing a second full SQLite scan of the `games` table.

### Part 1: Boot-local cache
- Added `_cachedGameIndex` module-level variable (`SteamGameIndexEntry[] | null`) set by Stage 4, read by Stage 4.5.
- Stage 4 now stores `_cachedGameIndex = index` after loading (line 297).
- Stage 4.5 else branch: checks `_cachedGameIndex` first, falls back to `loadSteamGameIndex()` only if null.
- Consolidated two dynamic imports from `fullSteamGameIndex` into one.
- `[BOOT][SQLITE_REUSED]` diagnostic log when cache is used.
- No global cache — module-level variable scoped to boot lifecycle, same pattern as `_cachedSettings`.

### Key Changes
- `src/services/appBootCoordinator.ts` — type import for `SteamGameIndexEntry`, module-level `_cachedGameIndex`, store in Stage 4, reuse in Stage 4.5 (4 edits).

### Scenario coverage
- **A — warm boot (SQLite populated)**: Stage 4 loads index, Stage 4.5 reuses it. `[BOOT][SQLITE_REUSED]` logged. No second `readAllGames()` call.
- **B — first boot (SQLite empty)**: Stage 4 returns empty array, `_cachedGameIndex` set to empty array. Stage 4.5 still enters the else branch (if `sqliteCache` is populated from detection cache), uses empty index → `reconciledGames` stays null. Fallback paths unchanged.
- **C — Stage 4 fails**: `_cachedGameIndex` stays null. Stage 4.5 falls through to `loadSteamGameIndex()` fallback — behavior identical to before.
- **D — validateStartupCacheHealth**: Post-boot diagnostic, still reads SQLite directly (single read, not a duplicate — intentionally kept).

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
