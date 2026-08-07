## Session — Background Queue and Boot Side Effects (Part 4)

### Part 4/5 — Background Queue and Boot Side Effects

#### Steps 1-2: Fix Store-active job deferral
- **Moved Store route check from `executeJob` to `processNext`** (`backgroundJobQueue.ts`) — check happens BEFORE `job.status = "running"`, preventing the job from being marked as "started" then "completed" when deferred.
- **Re-enqueue with "queued" status** — deferred jobs reuse a fresh status object, not a mutated "completed" one.
- **Dedup for deferred jobs** — `queue.some()` check prevents pushing a duplicate with the same id when Store-blocked.
- **Removed old Store-route block from `executeJob`** — no longer necessary, avoids dual-check confusion.
- Log format: `[JOB][DEFER] key=<key> reason=store-active retryMs=2000` / `[JOB][DEFER_SKIP] key=<key> reason=already-queued`.

#### Step 5: Remove unsafe clearReconciledGames from normal boot
- **Removed `clearReconciledGames()` call** (`appBootCoordinator.ts` line 436) in the `else` branch (games already in SQLite). Previously, if the game index was empty after the rebuild, `clearReconciledGames()` had already wiped healthy state with no recovery path.
- **Removed unused `clearReconciledGames` import** from the dynamic import at line 304.

#### Step 6: Guarantee setReconciledGames after reconcile
- Changed `if (reconciledGames && reconciledGames.length > 0)` to `if (reconciledGames)` — `setReconciledGames` now always fires in the `else` branch (with the empty-overwrite guard in `gameStore.ts` preventing actual wipe if runtime has healthy state).

#### Step 7: Remove name-only media wipe pattern
- **`updateGameAppinfoMedia` now preserves existing media** (`appBootCoordinator.ts:507-511`). Instead of passing all-null media paths, reads `appinfos[game.appId].media` and passes existing paths through, only updating the `name` field.
- Prevents erasing background/logo/icon/cover/landscape paths that were set by a previous repair or import.

#### Step 8: Make hydrateMediaOnStartup idle/no-op aware
- **Store route guard** — checks `window.location.hash` before running; logs `[BOOT][MEDIA_HYDRATE_SKIP] reason=store-active` when on Store.
- **Chunking** — processes appIds in chunks of 10 to avoid blocking the main thread during boot.
- **Lazy import** — `hydrateMediaOnStartup` only imported when not on Store route.

#### Step 9: Gate validate-cache-health for navigation
- **Store route guard** — skips `validateStartupCacheHealth()` when `#/store` is active, logs `[BOOT][HEALTH_SKIP] reason=store-active`.

### Build
- `tsc --noEmit` ✅ passes (only pre-existing unused-variable warnings in `LibraryGameDetails.tsx`)
- `vite build` ✅ passes (only pre-existing chunk warnings)
