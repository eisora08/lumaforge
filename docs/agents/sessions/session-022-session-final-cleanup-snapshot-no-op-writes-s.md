## Session — Final Cleanup: Snapshot No-Op Writes, Sidebar Filter Logging, and No-Source Media Repair Noise

### Goal
Reduce unnecessary writes and misleading logs without changing working Library/Sidebar/Store behavior. Library stays 82, Sidebar stays 34.

### Step 1: Full-rebuild no-op guard in scheduleSnapshotWrite
- Added `computeSnapshotFingerprint` check immediately after `buildStartupSnapshotFromCurrentState` in `scheduleSnapshotWrite`.
- When fingerprint matches `_lastWriteFingerprint`, skips calling `saveStartupSnapshot` entirely.
- Log: `[BootSnapshot][WRITE_SKIP] reason=no-content-change-full-rebuild games=<n> sidebarItems=<n>`.
- Also moved `SIDEBAR_FILTER`/`SIDEBAR_REPAIR` log inside this guard block so it only fires when a write actually happens.
- `startupSnapshotService.ts:1210-1221`

### Step 2: Rename misleading SIDEBAR_REPAIR log
- `SIDEBAR_REPAIR` only logs when `cachedSnapshot?.sidebar.items.length === deduped.length` (was full-library — old bad snapshot).
- Normal installed-only filtering logs as `[BootSnapshot][SIDEBAR_FILTER]`.
- Removed duplicate `SIDEBAR_FILTER` log from `buildStartupSnapshotFromCurrentState` (now gated behind `ENABLE_VERBOSE`).
- `startupSnapshotService.ts:1222-1229`

### Step 3: Input fingerprint to skip scheduling identical games
- Added `computeGamesFingerprint` in `LibraryGamesContext.tsx` — tracks appId + key status flags.
- Added module-level `_lastGamesFingerprint` to compare against.
- When fingerprint unchanged, logs `[LIBRARY_CONTEXT][SNAPSHOT_SCHEDULE_SKIP] reason=unchanged-games games=<n>` and returns early.
- `LibraryGamesContext.tsx:28-34`, `LibraryGamesContext.tsx:434-440`

### Step 4: No-source cooldown before repair scan
- Moved `isNoSourceCooldown` check to the VERY top of `detectAndQueueMissingMedia`, above display-only/Store/system/global checks.
- When cooldown active, logs `[MEDIA][AUTO_REPAIR_COOLDOWN] appid=<appid> reason=no-source-url` and returns immediately.
- No `AUTO_REPAIR_SCAN`, `AUTO_REPAIR_FAILED`, or disk scan while cooldown active.
- `gameCacheService.ts:1552-1556`

### Step 5: Optional persistence (skipped)
- No existing suitable persistent store for session-only cooldown. Creating a new DB/file is overkill. Session cooldown is sufficient.

### Step 6: Gate achievement ACH logs behind DEBUG flag
- Added `DEBUG_ACH_DETAILS = false` constant in `LibraryGameDetails.tsx`.
- `[ACH][STATE_PRESERVE]`, `[ACH][VISIBLE_CACHE_HIT]`, `[ACH][VISIBLE_CACHE_MISS]`, `[ACH][VISIBLE_CACHE_READ]`, `[ACH][SUMMARY_DERIVED_FROM_LIST]` all gated behind flag.
- `LibraryGameDetails.tsx:1`, `:504`, `:530`, `:544`, `:580`, `:583`, `:588`
