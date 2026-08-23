## Session — getHeroImageUrl priority: snapshot/disk paths before remote sources (no Steam→SGDB swap)

### Problem
Hero still showed a visible swap: frame 1 rendered the low-res Steam `appInfoEntry.header_image` (from `appInfoMap`), then `setFallbackBundle()` resolved SGDB and `fallbackBundle.background.url` replaced it ("primero llega una media de steam y luego carga el de steamgriddb"). Root cause: `game.backgroundPath` (snapshot high-res, the same asset the blurred backdrop shows) sat at the BOTTOM of the priority chain (after `appInfoEntry.header_image`, `artwork`, `metaPrimary`, and all `fallbackBundle` local/url sources) — so the sharp layer never converged to the backdrop asset.

### Fix — getHeroImageUrl reorder (LibraryGameDetails.tsx:127-170)
- Snapshot/canonical local disk paths moved to the TOP, interleaved by role, so the sharp hero targets the SAME high-res asset the blurred backdrop shows from frame 1:
  1. `canonicalAppInfo.media.backgroundPath`
  2. `game.backgroundPath` ← moved up
  3. `canonicalAppInfo.media.landscapePath`
  4. `game.landscapePath` ← moved up
  5. `canonicalAppInfo.media.coverPath`
  6. `game.coverPath` ← moved up
  7. `mediaEntry.hero_path` / `grid_path`
  8. `fallbackBundle.*.localPath` (materialized on disk)
  9. `metaPrimary` (Steam metadata background fields)
  10. `appInfoEntry.header_image` (Steam low-res — only when no snapshot/disk media)
  11. `artwork.sgdbHeroUrl` / `sgdbGridUrl`
  12. `fallbackBundle.*.url` (remote SGDB/IGDB/RAWG — last remote)
  13. `metaSecondary` / `imageUrl` / `cover_path` / `canonicalDiskFallback`
- Comment block updated to document the new priority and why (no visible swap when remote sources resolve later).
- No change to `rawPlaceholder` (already background-first) or any other surface.

### Scenario coverage
- **A — Game with snapshot background**: sharp = `game.backgroundPath` from frame 1, identical to backdrop. When `fallbackBundle`/SGDB resolve later they're below the snapshot path → no swap.
- **B — Game with no background but landscape/cover**: falls to `game.landscapePath`/`game.coverPath` before any remote source — still same asset as backdrop.
- **C — Game with only remote sources (no snapshot media)**: `metaPrimary` → `appInfoEntry.header_image` → SGDB → `fallbackBundle.url` chain preserved exactly as before.
- **D — canonicalAppInfo loads with fresh downloaded media**: `canonicalAppInfo.media.*` already outranks snapshot paths; since both usually point to the same file, no visible change.
- **E — Stale snapshot path**: same behavior as before — sharp error leaves the blurred backdrop, which uses the same path.

### Key Files Changed
- `src/components/library/LibraryGameDetails.tsx` — `getHeroImageUrl` reordered (snapshot/disk role paths first, remote sources last)

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.69s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
