## Session — Final Polish: Console log throttling + MediaIndex no-op guard

### Goal
Reduce console noise from `ASYNC_IMAGE_ERROR`, `GENRE_GROUPS_RAW`, and false `notifyMediaUpdated` calls for `has*`-only MediaIndex updates.

### Step 3: Throttle ASYNC_IMAGE_ERROR
- Only logs when terminal (no parent `onError` handler) or has `fallbackLocalPath`.
- For Store cards with fallback chains (`onError` set), errors are expected fallback retries — log suppressed.
- `AsyncImage.tsx:197`

### Step 4: Throttle [STORE][GENRE_GROUPS_RAW]
- Module-level `_lastGenreGroupsLog` tracks genre composition fingerprint.
- Only logs when `rawGenreGroups.size` or per-genre counts change.
- `Store.tsx:963`

### Step 7: Suppress false notifyMediaUpdated for has*-only changes
- `flushAppInfoUpdates` in `mediaDownloadQueue.ts` now distinguishes path changes from `has*` flag fixes.
- When `pathActuallyChanged === 0` and `mediaIndexChanged > 0`: skips `notifyMediaUpdated`, logs `[MEDIA_INDEX][UPDATE_SKIP] reason=snapshot-already-synced`.

### Build
- `tsc --noEmit` ✅ passes (only pre-existing `LibraryGameDetails.tsx` unused-variable warnings)
- `vite build` ✅ passes (only pre-existing chunk warnings)
