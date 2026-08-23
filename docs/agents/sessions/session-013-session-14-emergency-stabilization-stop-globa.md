## Session 14 — Emergency Stabilization: Stop Global Background Jobs During Navigation

### Problem
App freezes during navigation and Store open due to excessive background work:
1. Achievement schema migration runs per-icon (`[ACH][SCHEMA_MIGRATE]`)
2. BootSnapshot validates every media role per-game (`[BootSnapshot][VALIDATE_PATH]`)
3. Media/appinfo repair runs globally and writes repeatedly (`[MEDIA][APPINFO_WRITE]`)
4. No coalescing guard for background work during visible page navigation

### Part 1: Hard-disable achievement schema migration auto-run
- Added `ACHIEVEMENT_SCHEMA_MIGRATION_AUTO = false`, `ACHIEVEMENT_IMAGE_MIGRATION_AUTO = false`, `DEBUG_ACH_MIGRATION = false` in `achievementStore.ts`
- `repairGrayIconPaths()` returns early when `ACHIEVEMENT_SCHEMA_MIGRATION_AUTO` is false, logs `[ACH][SCHEMA_MIGRATE_SKIP]` once
- `writeCacheInBackground()` (called from `applyProgressPatch`) returns early when flag is false — prevents disk writes that trigger Rust-side `[ACH][SCHEMA_MIGRATE]` per-icon logs

### Part 2: Achievement migration gated in background jobs
- `achievementImageQueue.ts.enqueue()` returns early when `ACHIEVEMENT_IMAGE_MIGRATION_AUTO=false`, logs `[ACH][IMG_MIGRATE_SKIP]` once
- `backgroundJobQueue.ts:executeGenerateAchievementSchema()` checks `ACHIEVEMENT_SCHEMA_MIGRATION_AUTO` and returns early
- `appBootCoordinator.ts` Stage 8 background repair — achievement schema/image jobs and `repairGrayIconPaths` all gated behind the flags
- Manual Refresh Artwork still works (calls `steamAchievementsResolver` directly, bypasses the auto flag)

### Part 3: Disable global media repair during navigation
- Added `AUTO_MEDIA_REPAIR_GLOBAL = false`, `AUTO_MEDIA_REPAIR_VISIBLE_ONLY = true` in `gameCacheService.ts`
- `detectAndQueueMissingMedia` now accepts `source` parameter (`"visible-details"` | `"refresh-artwork"` | `"global"` | `"boot"`)
- When source is not `"visible-details"` or `"refresh-artwork"`, returns early, logs `[MEDIA][GLOBAL_REPAIR_SKIP]` once

### Part 4: Visible GameDetails targeted repair only
- `LibraryGameDetailPage.tsx` calls `detectAndQueueMissingMedia(appId, "visible-details")` — only current visible game repairs
- Manual Refresh Artwork calls with `"refresh-artwork"` — still works

### Part 5: Disable BootSnapshot validation spam
- Modified Rust `startup_snapshot.rs` — added `const DEBUG_BOOTSNAPSHOT_VALIDATE: bool = false` around the `[BootSnapshot][VALIDATE_PATH]` success `println!`
- Missing/invalid path logs (`[VALIDATE_PATH_MISSING]`) still appear

### Part 6: No validate on every snapshot write
- Snapshot write already uses `_dirtyAppIds` (only processes changed appIds)
- No full-rebuild for media-update writes
- Existing coalescing (debounce, `_pendingAfterWrite`, `_coalescedScheduleCount`) retained

### Part 7: Disable MediaCache resolve spam
- `ENABLE_VERBOSE_MEDIA_CACHE_LOGS` already false in TS (`libraryLocalCacheService.ts:34`)
- Changed Rust `game_cache.rs` `ENABLE_VERBOSE_MEDIA_CACHE_LOGS` from `true` to `false` — silences `[MEDIA][APPINFO_WRITE]` and `[MediaCache]` logs from Rust

### Part 8: Store page isolation
- Store page loads cached catalog + renders visible cards — never triggers achievement migration or global media repair
- All flags disable background work before it starts, so Store page never triggers it

### Part 9: Snapshot write debounce
- Changed debounce from 1000ms to 2000ms in `startupSnapshotService.ts:444`

### Key Files Changed
- `src/services/achievementStore.ts` — constants + gating in `repairGrayIconPaths`, `writeCacheInBackground`
- `src/services/achievementImageQueue.ts` — constants + gating in `enqueue`
- `src/services/gameCacheService.ts` — `AUTO_MEDIA_REPAIR_GLOBAL`, `detectAndQueueMissingMedia` source parameter
- `src/services/appBootCoordinator.ts` — gated background repair calls
- `src/services/backgroundJobQueue.ts` — gated `executeGenerateAchievementSchema`
- `src/services/startupSnapshotService.ts` — debounce 2000ms
- `src-tauri/src/commands/startup_snapshot.rs` — `DEBUG_BOOTSNAPSHOT_VALIDATE` guard
- `src-tauri/src/commands/game_cache.rs` — `ENABLE_VERBOSE_MEDIA_CACHE_LOGS` set to false

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes
