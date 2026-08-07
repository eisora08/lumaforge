## Session — M5: clearMediaQueueState wipes dedup state while active downloads may be in flight

### Goal
Prevent duplicate downloads when `clearMediaQueueState()` is called while active Rust `safe_download_image` invokes are still running (either in `activeJobs` or orphaned in `cancelledKeys`).

### Root cause
`clearMediaQueueState()` unconditionally cleared `recentlyCompleted`/`recentlyFailed`, removing dedup protection for previously-completed jobs. After `cancelMediaJobsForApp` removes jobs from `activeJobs` and adds keys to `cancelledKeys`, `enqueueMediaDownload` had no way to detect orphaned in-flight Rust invokes — the key was not in `recentlyCompleted`, `recentlyFailed`, `activeJobs`, or `pendingQueue`. Re-enqueuing the same job created a second `safe_download_image` invoke for the same URL.

### Part 1: clearMediaQueueState — conditional dedup clear
- `clearMediaQueueState()` now preserves `recentlyCompleted`/`recentlyFailed` when `activeJobs.size > 0 || cancelledKeys.size > 0`.
- Logs `[MEDIA_QUEUE][CLEAR_DEFERRED] active=N orphaned=N` when skipping clearance.
- `pendingAppInfoUpdates` and `appInfoFlushTimer` are still always cleared (safe to clear — completions re-add their pending updates).
- `cancelledKeys` is still NOT cleared (M2 preservation).

### Part 2: enqueueMediaDownload — cancelledKeys dedup check
- After `recentlyCompleted`/`recentlyFailed` checks, added `cancelledKeys.has(key)` check.
- When found, polls at 100ms intervals until the orphaned Rust invoke completes and `performDownload` removes the key from `cancelledKeys`.
- Resolves with `{ success: false, error: "Previously cancelled" }` so the caller knows the previous attempt did not succeed.
- Only fires when `!job.forceRefresh`, matching the other dedup checks.

### Key Changes
- `src/services/mediaDownloadQueue.ts` — `clearMediaQueueState()` conditional dedup clear (line 568-583); `enqueueMediaDownload()` cancelledKeys dedup check (line 435-451).

### Scenario coverage
- **A — clear while active job in flight**: `activeJobs.size > 0` → `recentlyCompleted`/`recentlyFailed` preserved. Re-enqueue hits `activeJobs` loop → deduped.
- **B — cancel prewarm then restart**: `cancelMediaJobsForApp` removes from `activeJobs`, adds to `cancelledKeys`. `clearMediaQueueState` sees `cancelledKeys.size > 0` → preserves `recentlyCompleted`/`recentlyFailed`. Re-enqueue hits `cancelledKeys` check → polls until orphaned job resolves → returns cancelled result.
- **C — clear when idle**: `activeJobs.size === 0 && cancelledKeys.size === 0` → clears dedup state as before.
- **D — normal success/failure**: No changes to `performDownload` or `tryProcessNext` — behavior unchanged.

### M2 preservation
- `cancelledKeys` is never cleared by `clearMediaQueueState`.
- Orphaned job completions still check `cancelledKeys.has(key)` in `performDownload` and return without side effects.

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
