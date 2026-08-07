## Session — Hero logo: kill title flash + responsive sizing

### Problem
Two issues in the hero bottom-content logo block (`LibraryGameDetails.tsx`):

1. **Title flash before logo**: `resolvedLogoUrl` was resolved in a `useEffect` (default state `undefined`). The whole block is gated by `canonicalLoaded`; on the first render after it flips true, `canonicalAppInfo.media.logoPath` was already resolved (absolute) but `logoUrl` was still `undefined` → JSX `logoUrl ? <img> : <h1>` rendered the title for ~1 frame (16ms). For relative paths (`games/`,`media/`,`img/`) the effect also did a dynamic `import()` + async Tauri invoke, stretching the flash to tens of ms.
2. **Non-responsive logo sizing**: `logoDisplayHeight` clamped to fixed pixels (`Math.max(80, Math.min(200, naturalHeight))`) — same size regardless of viewport width.

### Fix

#### Part 1: Render-phase synchronous logo resolution
- Extracted `resolvedLogoSync` via `useMemo` — resolves the logo URL during render for absolute/local/http paths (`isLocalPath` → `localPathToUrl`, else the raw string). Relative paths return `undefined` (async needed).
- The `useEffect` now runs ONLY for relative paths, writing to `resolvedRelativeLogoUrl`.
- `logoUrl = resolvedLogoSync ?? resolvedRelativeLogoUrl` — the first render after `canonicalLoaded=true` already has the logo (canonical paths are absolute) → the title is never painted.

#### Part 2: No title swap when logo pending
- Render branch: `logoUrl ? <img> : rawLogoUrl ? <div placeholder/> : <h1>`.
- The placeholder div (same responsive box as the logo) prevents any title→logo swap; the title only shows when there is genuinely no logo source.

#### Part 3: `loading="lazy"` → `eager`
- The hero logo is the main visual above the fold; eager removes the extra load delay.

#### Part 4: Responsive logo sizing (replaces fixed-pixel clamp)
- `logoWidth = clamp(160px, 44vw, 540px)` — scales with viewport, min/max caps.
- `height: auto` once loaded (`logoNaturalHeight != null`) — proportional to intrinsic aspect ratio.
- `max-height: clamp(80px, 18vh, 240px)` + `object-contain` — caps extreme ratios without distortion.
- Pre-load reservation `height: clamp(80px, 14vh, 200px)` — no layout collapse/pop before intrinsic size is known.
- `logoNaturalHeight` retained only as a "loaded" marker (resets on `logoUrl` change).

### Key Files Changed
- `src/components/library/LibraryGameDetails.tsx` — `resolvedLogoSync` useMemo, relative-only effect → `resolvedRelativeLogoUrl`, `logoUrl` derivation, placeholder branch, `loading="eager"`, responsive `logoWidth`/`logoHeightFallback`/`logoMaxHeight` constants, `<img>` style

### Build
- `tsc --noEmit` ✅ (no errors in `LibraryGameDetails.tsx`)
- `vite build` ✅ (1.70s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
