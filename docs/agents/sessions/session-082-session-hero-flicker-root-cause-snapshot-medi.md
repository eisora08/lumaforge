## Session — Hero flicker root cause: snapshot media never reaches LibraryGame + relative/absolute path mismatch

### Problem
The blur→sharp hero flicker for Steam/Lua games persisted even after `getHeroImageUrl` was reordered to prioritize snapshot paths. Root cause had 2 gaps + 1 mismatch:

1. **Brecha 1 — `snapshotGameToLibraryGame` discarded `sg.media`** (`LibraryGamesContext.tsx:574-598`): only mapped appId/title/source/installed/playable/lastPlayed/playtime. `backgroundPath`/`landscapePath`/`coverPath` were never copied → `getHeroImageUrl` frame 1 fell to `appInfoEntry.header_image` (low-res) or placeholder. SQLite/reconciled games (`loadCachedGames`) don't populate media paths either.
2. **Mismatch — relative vs absolute path strings**: snapshot stores relative (`media/background.jpg`); `canonicalAppInfo.media` from `loadGameAppInfoWithMediaFallback` resolves to absolute (`resolveMediaPaths`, `gameCacheService.ts:1159`). Both point to the SAME file but the string changes → `key={imageUrl}` (`LibraryGameDetails.tsx:1203`) remounts the `<img>` with `opacity-0` → visible gap.
3. **Brecha 2 (cosmética)**: `rawPlaceholder` already prioritized `game.backgroundPath` but it was empty (gap 1).

Manual games never flickered: their flow (`LibraryGameDetailPage.tsx:244-280`) sets `canonicalAppInfo` + `canonicalLoaded=true` in ONE pass with stable `asset://` URLs.

### Fix

#### Part 1: `snapshotGameToLibraryGame` maps media (LibraryGamesContext.tsx)
- Param type changed from inline shape to `SnapshotGame` (imported from `startupSnapshotService`).
- Copies `backgroundPath`, `landscapePath`, `coverPath`, `logoPath`, `iconPath` from `sg.media` into the `LibraryGame` (fields already exist in `libraryGame.ts:61-68`).

#### Part 2: Snapshot media bridge for SQLite/reconciled path (LibraryGamesContext.tsx `load()`)
- After `loadedGames` is resolved from ANY source (cached/reconciled/snapshot), bridges `snapshot.library.games[i].media` into each game **only when the field is missing** (`!game.backgroundPath && sm.backgroundPath`, etc.).
- Logs `[LIBRARY_CONTEXT][SNAPSHOT_MEDIA_BRIDGE] bridged=N games=N`.
- Covers the common warm-boot case where games come from SQLite (which never populates media paths).

#### Part 3: Stable hero key by basename identity (LibraryGameDetails.tsx)
- Added `sameHeroFile(a, b)` helper — compares normalized basenames (case-insensitive, strips `?`/`#`, splits on `/` and `\`).
- In the `imageUrl` resolution effect (L375-406): `setImageUrl((prev) => (prev && url && sameHeroFile(prev, url) ? prev : url))` — keeps the current string when the newly-resolved URL points to the same file (relative snapshot vs absolute canonical). This prevents the `key={imageUrl}` remount and its opacity-0 gap.
- Functional update avoids adding `imageUrl` to the effect deps.
- Existing `imageUrl === loadedHeroUrl` opacity gate + backdrop crossfade remain as safety net when the file genuinely changes (e.g. header→background).

### Root-cause summary (for future reference)
- Snapshot DOES persist appinfo media (`startupSnapshotService.ts:85-122` `normalizeAppInfoMedia`; Rust `validate_snapshot_media_paths` returns the ORIGINAL relative path + `*Exists` flags, never rewrites to absolute).
- The boot is correct — the data existed but was dropped at the mapper boundary and re-formatted by the canonical resolver.
- Frame 1 hero now converges to the same asset as the blurred backdrop; when canonical resolves the same file, the string is preserved → no remount → no gap.

### Key Files Changed
- `src/context/LibraryGamesContext.tsx` — `SnapshotGame` import, `snapshotGameToLibraryGame` media mapping, `[LIBRARY_CONTEXT][SNAPSHOT_MEDIA_BRIDGE]` in `load()`
- `src/components/library/LibraryGameDetails.tsx` — `sameHeroFile()` helper, stable `setImageUrl` in resolution effect

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.76s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
