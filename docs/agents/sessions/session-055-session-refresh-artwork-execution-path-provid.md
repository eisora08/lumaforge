## Session — Refresh Artwork Execution Path + Provider Status Reconciliation

### Objective 1: Fix Refresh Artwork execution path
Parts 1–8 of the media/artwork fix for the `refreshGameDetailsArtwork`/`detectAndQueueMissingMedia`/`executeRepairGameMedia` pipeline.

### Problem
- `loadGameAppInfoWithMediaFallback` check fixed local-source disk verification correctly, but `refreshGameDetailsArtwork` and `detectAndQueueMissingMedia` did NOT
- `refreshGameDetailsArtwork` checked `resolveMediaPaths` (TS-side, returns appinfo paths, not actual files on disk) instead of `resolveGameMediaPaths` (Rust, checks actual disk)
- `resolveMediaByPriority` candidate loop had `continue` at line ~2772 that skipped fallback candidates after the first pick — `findFirstUrl` never reached lower-priority sources
- `executeRepairGameMedia` did NOT go through Steam metadata resolution at all — only checked `mediaSources` (user-configured URLs)
- `performDownload` in `mediaDownloadQueue.ts` wrote stale relative paths to appinfo manifest even for fresh refresh-artwork downloads

### Parts implemented

#### Part 1: Local-source disk verification
- `refreshGameDetailsArtwork` checks `resolveGameMediaPaths` (Rust disk check) before resolution. Stale paths filtered out, `[MEDIA_STALE]` per-role diagnostic logged.
- Downstream re-resolution picks correct Steam CDN/metadata fallback.

#### Parts 4-5: Candidate fallback loop fix
- `resolveMediaByPriority` candidate loop restructured — `findFirstUrl` removed, replaced with `pickFirstUrl` that continues to next candidate when `!url || url === "undefined"`. Fallback candidates now reached.
- `[CANDIDATE_CONTINUE]` / `[FALLBACK_PICK]` diagnostic logs.

#### Part 6: Manifest write guard
- `performDownload` in `mediaDownloadQueue.ts` — when `_freshRefreshAppIds.has(appId)`, nulls non-current-role paths in the appinfo update to prevent stale path overwrites.
- `[MEDIA][MANIFEST_GUARD]` diagnostic log.

#### Part 7: `detectAndQueueMissingMedia` refactored
- Uses `resolveGameDetailsArtwork` (Steam metadata + full priority chain) instead of old `resolveGameMedia`.

#### Part 8: `executeRepairGameMedia` refactored
- Resolves Steam metadata via `resolveGameMetadata` before calling `resolveGameDetailsArtwork` for each role. `mediaSources` used only as last fallback.

#### Background candidate order fix
- storepagebackground deferred to last background candidate (after Steam CDN hero → metadata → screenshots → SGDB → RAWG → IGDB → landscape fallback).
- `[ARTWORK_BACKGROUND_SKIP]` / `[ARTWORK_BACKGROUND_CANDIDATES]` / `[ARTWORK_BACKGROUND_SELECTED]` diag logs.

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
