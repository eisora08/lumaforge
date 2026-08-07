## Session � Remove desktop Library hover -> ambient feed (console-only keeps it)

### Problem
The desktop Library/Games grid hover?ambient feed (`library-grid-hover` scope) changed the whole window background on card hover. User decision: that behavior is only acceptable inside Console Mode � on desktop it is distracting.

### Fix
- `src/components/games/GameLauncherTile.tsx` (used by `Library.tsx` and `Games.tsx`):
  - Removed `setAmbientSource`/`clearAmbientSource` import from `ambientBackgroundStore`.
  - Removed `localPathToUrl` from the `gameCacheService` import (was only used by the hover handler; `isLocalPath` kept for `fallbackLocalPath` memo).
  - Removed module constants `AMBIENT_LIBRARY_HOVER_SCOPE`, `AMBIENT_HOVER_DEBOUNCE_MS`, and the shared `_libraryHoverTimer`.
  - Removed `handleHoverEnter`/`handleHoverLeave` and the unmount cleanup effect.
  - Root `<div>` handlers back to `onMouseEnter={onMouseEnter}` / `onMouseLeave={onMouseLeave}` (the `useHoverPrefetch` data prefetch is preserved).

### Unchanged
- Console Mode feed `console-grid-focus` + right-panel backdrop in `ConsoleGridLayout.tsx`.
- `AmbientNavFallback` page-context in `App.tsx` (navigation-level, not hover).
- Dashboard/hero feeds and `--console-bg` ambient behavior.

### Result
- Desktop: ambient background is stable (page-context fallback) � hovering Library/Games cards no longer changes it.
- Console Mode: hover/focus still drives the background.

### Build
- `tsc --noEmit` ? (only pre-existing extension/test errors)
- `vite build` ? (1.41s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ?? skipped (no Rust changes)
