## Session — Achievement Watcher: autonomous unlock detection + progress.json + binary stats fallback

### Goal
Improve the achievement watcher to detect autonomous/unexpected achievement unlocks (e.g., via external unlocker apps, Steam background activity), adapting patterns from the reference implementation (Achievements-1.2.2). Fix the Stop button for some games.

### Problem
- **Stop button broken**: `if (!owned && isEpic)` prevented non-Epic non-owned games from stopping.
- **No startup baseline**: `ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP = false` meant snapshots never seeded from disk at boot — new installs always started empty.
- **Global progress index ignored**: `achievement_progress.json` (global cross-game progress index at `config/librarycache/achievement_progress.json`) was not wired into the watcher pipeline.
- **Binary stats files unhandled**: `appcache/stats/UserGameStats_*.bin` files written by Steam on achievement unlock existed but the TS pipeline had no fallback when `librarycache/<appid>.json` was missing or partial.
- **Partial librarycache gate blocked merge**: When `isPartial && !current`, the `patchUnlockedAchievements` function returned early without merging into the canonical summary or saving a snapshot.

### Fixes implemented

#### Fix 1: Stop button (`GameSessionContext.tsx`)
- Changed `if (!owned && isEpic)` to `if (!owned)` — all non-owned games can now be stopped.
- Removed unused `const isEpic`; added debug logging.

#### Fix 2: Partial librarycache gate (`achievementStore.ts:230`)
- Removed early return when `isPartial && !current`. Now creates minimal summary but falls through to the merge/snapshot section instead of returning early. Ensures even partial data is merged into the canonical summary and saved as snapshot.

#### Fix 3: Rust `extract_info` for `achievement_progress.json` (`achievement_watcher.rs:223-248`)
- Added special case in `extract_info` for `achievement_progress.json`: emits event with `source="achievement-progress"`, `appid=0` (global index, not per-game).
- Added `processAchievementProgressChange()` in `achievementWatcherService.ts` that reads the global progress index, diffs against `_progressIndexCache`, and triggers `processLibrarycacheChange` per changed appId.

#### Fix 4: Global progress index Rust command (`steam_achievements.rs`)
- Added `read_achievement_progress_index` Tauri command: reads/parses global `achievement_progress.json`, returns `Vec<AchievementProgressEntry>`.
- Added `AchievementProgressEntry` struct with `app_id`, `unlocked`, `total`, `percentage`, `all_unlocked`, `cache_time`, `vetted`.
- Registered in `lib.rs`.

#### Fix 5: Binary stats fallback in `processLibrarycacheChange` (`achievementWatcherService.ts:955+`)
- After `buildProgressPatchFromLibraryCache` returns null, now tries `parseUserGameStatsRaw` binary stats parse before falling back to heavy resolver refresh.
- Builds ProgressPatch from `achievement_entries` if found. Updated all `patch` references to `effectivePatch`.

#### Fix 6: Enable startup baseline scan (`achievementWatcherService.ts:49`)
- Changed `ACHIEVEMENT_WATCHER_FULL_SCAN_ON_STARTUP = false` → `true`.
- `runBaselineScan()` (already implemented at L715) reads librarycache files and calls `processLibrarycacheChange` with `source="baseline"` to seed snapshots at boot without firing notifications.

### Key files changed
- `src/context/GameSessionContext.tsx` — Stop button fix + debug logging
- `src/services/achievementStore.ts` — Fixed partial librarycache gate (L230)
- `src/services/achievementWatcherService.ts` — Added `processAchievementProgressChange()`, `_progressIndexCache`, `parseUserGameStatsRaw` fallback, enabled baseline scan, updated event handler for `achievement-progress` source
- `src/services/tauri.ts` — Added `AchievementProgressEntry` interface + `readAchievementProgressIndex()` binding (binary stats binding pre-existing)
- `src-tauri/src/commands/achievement_watcher.rs` — `extract_info` now handles `achievement_progress.json`
- `src-tauri/src/commands/steam_achievements.rs` — Added `read_achievement_progress_index` command + `AchievementProgressEntry` struct
- `src-tauri/src/lib.rs` — Registered `read_achievement_progress_index` command

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `cargo test --lib` ✅ 271 passed / 1 failed (pre-existing `crc32_matches_javascript`)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
