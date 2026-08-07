## Session — Cache Consistency & Memory Fixes (M2, S2, M3, S3, M4)

### Goal
Fix memory and consistency issues across media download queue, snapshot writes, resolved path cache, and media cache invalidation.

### Part 1: M2 — Cancel-vs-completion race in mediaDownloadQueue
- Added module-level `cancelledKeys` Set in `mediaDownloadQueue.ts`.
- `cancelMediaJobsForApp` marks the dedup key before resolving the cancel promise.
- `performDownload` checks `cancelledKeys` after the Rust invoke completes — if cancelled, skips success/failure side effects (no `recentlyCompleted`, no `queueAppInfoUpdate`, no notify).
- `clearMediaQueueState` does **not** clear `cancelledKeys` to avoid reintroducing the race.
- 4 edits across 1 file. `tsc --noEmit` ✅, `vite build` ✅.

### Part 2: S2 — Stale snapshot overwrites fresh in-memory media
- Wired up `trackPendingAppInfoUpdate` / `completePendingAppInfoUpdate` in `mediaDownloadQueue.ts` (3 edits).
- `buildStartupSnapshotFromCurrentState`'s `flushPendingAppInfoUpdates(2000)` now actually waits for in-flight appinfo writes before reading `appinfo.json`.
- Previously the counter was always 0 (exported but never imported — dead code).
- `tsc --noEmit` ✅, `vite build` ✅.

### Part 3: M3 — `resolvedSrcCache` never invalidated on media change
- Added `resolvedSrcCache.clear()` to `invalidateResolvedMediaCache(appId)` in `gameCacheService.ts`.
- Keys are raw filesystem paths (not appIds), so whole-cache clear is required.
- `convertFileSrc()` is cheap (~0.001ms), making this safe.
- 1 edit. `tsc --noEmit` ✅, `vite build` ✅.

### Part 4: S3 — Snapshot writes deferred indefinitely during interaction
- Added `MAX_DEFER_DURATION_MS = 30_000` + `_mediaUpdateDeferStart` / `_fullRebuildDeferStart` timestamps in `startupSnapshotService.ts`.
- After 30s of continuous `isInteractionBusy()` deferral, `_processDirtyAppIds` and `scheduleSnapshotWrite` proceed despite interaction.
- Defer timestamps reset after successful writes.
- Existing `_writeInProgress` guard is not bypassed.
- 5 edits. `tsc --noEmit` ✅, `vite build` ✅.

### Part 5: M4 — `cacheMediaForGame` leaves stale session cache
- `gameCacheService.ts`: after `invalidateResolvedMediaCache(appId)` and `notifyMediaUpdated(appId)`, re-seeds `resolvedMediaSessionCache` with current appinfo paths.
- Calls `getCachedGameAppInfo(appId)` (reads fresh `appinfo.json` from disk since session appinfo cache was invalidated by the write), resolves paths via `resolveMediaPaths`, and calls `setCachedResolvedMedia`.
- If resolve fails, the cache stays empty (no stale data).
- `[MEDIA][SESSION_CACHE_RESEED]` / `[MEDIA][SESSION_CACHE_RESEED_SKIP]` diagnostic logs.
- 1 edit. `tsc --noEmit` ✅, `vite build` ✅.

### Key Files Changed
- `src/services/mediaDownloadQueue.ts` — M2: `cancelledKeys` Set + guard in `performDownload`. S2: `trackPendingAppInfoUpdate` / `completePendingAppInfoUpdate` wiring (3 edits).
- `src/services/gameCacheService.ts` — M3: `resolvedSrcCache.clear()` in `invalidateResolvedMediaCache`. M4: re-seed block after `notifyMediaUpdated` in `cacheMediaForGame`.
- `src/services/startupSnapshotService.ts` — S3: max defer timestamps + threshold check in `_processDirtyAppIds` and `scheduleSnapshotWrite` (5 edits).

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
