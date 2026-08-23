## Session — Audit #10: sourceAvailability cache grows without bound

### Goal
Add bounded cache behavior to `sourceAvailabilityCacheService.ts` so the `cachedIndex.games` record cannot grow indefinitely.

### Root cause
`cachedIndex.games` is a `Record<string, SourceAvailabilityGameEntry>` with no TTL, no max size, and no eviction. Entries are added by `updateSourceAvailability()` and persist forever. The cache is persisted to disk and loaded on boot, so stale entries accumulate across sessions.

### Implementation
- Added `SOURCE_AVAILABILITY_CACHE_TTL_S = 86400` (24 hours)
- Added `SOURCE_AVAILABILITY_CACHE_MAX = 1000` entry limit
- Added `pruneCache()` helper that:
  1. Filters entries older than 24h (by `updatedAt` field, already present in the type)
  2. If still over 1000, sorts by `updatedAt` descending and keeps the newest 1000
  3. Replaces `cachedIndex.games` with the pruned set
  4. Logs `[SOURCE_AVAIL][CACHE_PRUNE] removed=N size=N`
- `getSourceAvailability(appId)`: checks TTL before returning; deletes and returns `undefined` if expired
- `updateSourceAvailability()`: calls `pruneCache()` after inserting the new entry
- No changes to data shape, no new fields, no load-from-disk changes
- Existing callers receive the same `SourceAvailabilityGameEntry` shape unchanged

### Key Changes
- `src/services/sourceAvailabilityCacheService.ts` — 2 constants + `pruneCache()` function + TTL check in `getSourceAvailability()` + `pruneCache()` call in `updateSourceAvailability()` (3 edits)

### Scenarios
- **Normal cache hit**: TTL check passes, entry returned as before
- **Expired entry**: TTL check fails, entry deleted, `undefined` returned → refresh path repopulates
- **Overflow**: After inserting the 1001st unique appId, `pruneCache()` removes oldest entries until ≤1000 remain
- **Store browsing**: No behavior change; stale entries are transparently evicted

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
