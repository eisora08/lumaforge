## Session — Achievement Image Download Freeze + Trigger Boundaries

### Problem
1. **Blocking `ensureAchievementImages`** — single Tauri command downloading 54 images sequentially for app 1167630 caused freeze/crash
2. **Auto-sync watcher triggered image downloads** — `achievementAutoSyncService.ts` called `resolveSteamAchievements` with `forceRefresh: true`, which set `_migrateIcons = true`, triggering `downloadAchievementIconsInBackground` on every librarycache change detection

### Root Cause
- `ensureAchievementImages` (Rust) was a single synchronous command that downloaded all images in sequence before returning — blocking the main thread for seconds
- `_migrateIcons` flag did double duty: controlled both cache normalization AND background image download. Every `forceRefresh: true` caller (including auto-sync watcher) triggered image downloads even though only Manual Refresh should
- The watcher (`achievementAutoSyncService.ts` line 329) and the watcher's `_scheduleResolverRefresh` (`achievementWatcherService.ts` line 942) are separate paths — the auto-sync called `resolveSteamAchievements` with `forceRefresh: true`, while the real-time watcher called without it (safe)

### Fix Part 1 — Non-blocking image download
- Replaced blocking `ensureAchievementsImages` → `downloadAchievementIconsInBackground()` fire-and-forget function in `achievementImageQueue.ts`
- Throttled concurrency: max 3 simultaneous `downloadAchievementImage` invokes
- Manual Refresh buttons still trigger downloads (fire-and-forget via `_migrateIcons` flag), but they no longer block UI

### Fix Part 2 — Watcher doesn't trigger image downloads
- Added `skipImageDownload?: boolean` param to `resolveSteamAchievements` params type (`steamAchievementsResolver.ts:662`)
- Added `_downloadImages = params.forceRefresh === true && !params.skipImageDownload` — separates image download control from icon migration
- Changed image download gate from `_migrateIcons` to `_downloadImages` (`steamAchievementsResolver.ts:1160`)
- Auto-sync service passes `skipImageDownload: true` (`achievementAutoSyncService.ts:330`) → schema re-read + normalized cache write WITHOUT image downloads
- Manual Refresh buttons don't pass `skipImageDownload` → full refresh WITH image downloads

### Trigger boundaries enforced
- **GameDetails mount**: lightweight disk cache read only (`shouldAutoLoadAchievements = false`, no `resolveSteamAchievements` call)
- **Manual Refresh (2 buttons in LibraryGameDetails)**: calls `resolveSteamAchievements(forceRefresh: true)` → schema re-read → normalized cache write → fire-and-forget image downloads
- **Watcher (achievementAutoSyncService)**: calls `resolveSteamAchievements(forceRefresh: true, skipImageDownload: true)` → schema re-read → normalized cache write → NO image downloads
- **Real-time watcher (achievementWatcherService._scheduleResolverRefresh)**: calls `resolveSteamAchievements` without `forceRefresh` → schema re-read → cache write WITHOUT normalization → NO image downloads (already safe)

### Key Files Changed
- `src/services/achievementImageQueue.ts` — Replaced `ensureAchievementsImages` with `downloadAchievementIconsInBackground` (fire-and-forget, throttled 3 concurrent)
- `src/services/steamAchievementsResolver.ts` — Added `skipImageDownload` param, `_downloadImages` flag, separated gate
- `src/services/achievementAutoSyncService.ts` — Passes `skipImageDownload: true`

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
