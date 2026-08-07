## Session — Fix "render viejo" on Library game switch (hero stale props)

### Problem
When switching to a steam/lua game in LibraryGameDetails, the previous game's hero flashed briefly before self-correcting ("render viejo"). Caused by:
1. `LibraryGameDetailPage` is NOT keyed by game (`App.tsx:273-274`) — its state (`mediaEntry`, `artwork`, `canonicalAppInfo`, `canonicalDiskFallback`, `localDetailsData`, `fallbackBundle`, `resolvedGame`, `canonicalLoaded`) persists from the previous game while the new game's async pipeline loads.
2. Render #1 of the new game received the OLD states as props. Previously Layer 2 (sharp hero) was gated by `canonicalLoaded`; the effect's `setCanonicalLoaded(false)` reset it after paint, hiding the stale frame. After decoupling Layer 2 from `canonicalLoaded`, the stale hero became visible.
3. Two async setters lacked cancellation guards and could write stale state AFTER the reset: `getMediaCacheForAppId(...).then(setMediaEntry)` (`:328`) and `getLibraryGameDetails(...).then(...setLocalDetailsData)` (`:480`).
- Manual games were immune: `canonicalLoaded=true` + asset:// URLs arrive in one pass with `cancelled` guards.

### Fix
1. **Render-phase stale reset** in `LibraryGameDetailPage.tsx` (React "adjusting state when a prop changes" pattern): `_detailKeyRef` compared against `computeGameKey(selectedGame)`; on change, resets `mediaEntry`, `canonicalAppInfo`, `canonicalDiskFallback`, `localDetailsData`, `fallbackBundle`, `artwork`, `resolvedGame`, `canonicalLoaded` during render. Ref guard keeps it idempotent. Render #1 of a new game now always shows the correct placeholder → hero crossfade (matches manual behavior).
2. **`cancelled` guards** added to `getMediaCacheForAppId` (`.then`/`.catch`) and `getLibraryGameDetails` (`.then`) — late resolutions can no longer write stale state.
3. Existing effect resets (`:195-201`) kept as defense in depth (idempotent).

### Key Files Changed
- `src/pages/LibraryGameDetailPage.tsx` — render-phase reset block + 2 cancellation guards

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
