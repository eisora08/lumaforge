## Session — Ambient background color mode (dominant color instead of blurred image)

### Goal
Add an opt-in display mode for the global ambient background: instead of showing the active game's artwork blurred, extract its dominant color and render a premium radial gradient + glow field (Dynamic Effect / Mica style). User chose "Gradiente con glow" and image mode stays the default.

### Part 1: `ambientBackgroundStore.ts`
- `export type AmbientMode = "image" | "color"`; storage key `lumaforge-ambient-mode`, default `"image"`.
- `_mode` module state + `setAmbientMode()` / `getAmbientMode()` (persist + `emit()`).
- `AmbientSnapshot` gains `mode: AmbientMode`; `emit()` includes it (new object each call — Object.is contract preserved).

### Part 2: `useDynamicPalette.ts`
- Exported `getCachedDynamicPalette(url)` — synchronous read of `_paletteCache`, returns `null` when not sampled yet. Lets the crossfade's *previous* layer render its real color (already cached) without a fallback flash.
- Exported `FALLBACK_PALETTE` (used by AmbientBackground for the current layer before sampling refines).

### Part 3: `AmbientBackground.tsx` — color mode branch
- Reads `mode` from the snapshot; `useDynamicPalette(url)` only when `mode === "color"`.
- `ColorField` sub-component: a div with `lf-ambient-color` (radial `--ambient-secondary → --ambient-primary` gradient) plus a `lf-ambient-glow` child (radial localized glow), driven by `--ambient-primary/secondary/glow` CSS vars.
- Keeps the two-layer crossfade (prev/current with `animate-ambient-out`/`in`, `CROSSFADE_MS`): prev layer uses `getCachedDynamicPalette(prevUrl) ?? currentPalette`, current layer uses `useDynamicPalette(url)`.
- Overlays (dim + bottom gradient) and `style.artOpacity` (intensity) apply identically; no `<img>`, no blur in color mode. `data-ambient=on` still set → shell translucency works.

### Part 4: `Settings.tsx`
- New "Modo del fondo ambiental" 2-column segmented control (Imagen difuminado / Color dominante) inside the ambient block, visible when enabled. Intensity description reworded to cover both modes.

### Part 5: `App.css`
- Registered `@property --ambient-primary/secondary/glow` (syntax `<color>`, initial-values from the download dynamic palette) so palette swaps interpolate smoothly (`--motion-palette` 600ms).
- `.lf-ambient-color` radial gradient + transition on the three vars; `.lf-ambient-glow` localized radial glow. Reuses existing `ambientIn`/`ambientOut` keyframes.

### Behavior
- **Image mode (default)**: unchanged — blurred art crossfade.
- **Color mode**: dominant hue of the current ambient `url` → radial gradient with glow; crossfades smoothly between games; intensity controls opacity; works across all ambient feeds (dashboard, library-details, store, console, page-context fallback) since they all flow the same `url` into the store.
- Canvas sampling may fall back to the blue-cyan `FALLBACK_PALETTE` for CORS-tainted remote URLs (same as the Downloads hero).

### Key Files Changed
- `src/services/ambientBackgroundStore.ts` — `AmbientMode`, `setAmbientMode`/`getAmbientMode`, snapshot `mode`
- `src/hooks/useDynamicPalette.ts` — `getCachedDynamicPalette`, exported `FALLBACK_PALETTE`
- `src/components/layout/AmbientBackground.tsx` — `ColorField`, color branch, `useDynamicPalette`/`getCachedDynamicPalette` wiring
- `src/pages/Settings.tsx` — mode segmented control
- `src/App.css` — `@property --ambient-*`, `.lf-ambient-color`, `.lf-ambient-glow`

### Build
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.14s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings; verified `Color dominante`, `lumaforge-ambient-mode`, `lf-ambient-color`/`lf-ambient-glow`/`--ambient-primary` in bundle)
- `cargo check` ⏭️ skipped (no Rust changes)
