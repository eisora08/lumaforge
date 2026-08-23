## Session — Library GameDetails hero pull-focus (blur-to-sharp reveal)

### Problem
Steam/Lua game heroes showed a visible "low-res flash": the hero mounted with the snapshot's low-res landscape/header asset (e.g. `header.jpg` ~460×215) on frame 1, then swapped to the real high-res background (~1920×620) once the async canonical pipeline resolved. Manual games were immune because their artwork arrives in one pass. The existing `animate-hero-sharp-in` (1000ms opacity fade) went unnoticed because by the time the sharp layer mounted, the low-res asset was already showing — the swap itself was the visible artifact.

### Root cause
- `getHeroImageUrl` (LibraryGameDetails.tsx) preferred `appInfoEntry.header_image` (metadataSecondary, low-res) over `game.backgroundPath` (snapshot high-res path, always available in memory)
- `rawPlaceholder` preferred `coverPath` → `landscapePath` over `backgroundPath`, so even the blurred backdrop layer started from low-res assets
- The sharp layer's animation (opacity 0→1) was a pure fade, not tied to a "focus" metaphor — the asset swap between backdrop and sharp was still perceptible

### Fix — pull-focus (blur-to-sharp) reveal

#### Part 1: `getHeroImageUrl` priority reorder
- `game.backgroundPath` (snapshot high-res) now checked BEFORE `appInfoEntry.header_image` (metadataSecondary low-res) and before the rest of the metadata chain
- If no background, `game.landscapePath` still beats the low-res header fallback
- Result: the sharp layer targets the SAME high-res asset the blurred backdrop shows from frame 1 → same image, same crop, only sharpness changes

#### Part 2: `rawPlaceholder` background-first
- Order changed from `coverPath || landscapePath || backgroundPath` → `backgroundPath || landscapePath || coverPath`
- The blurred backdrop layer (frame 1) now starts from the high-res background instead of a low-res cover/landscape

#### Part 3: `heroFocusIn` keyframe (src/App.css)
- New `@keyframes heroFocusIn`: `from { opacity: 0; filter: blur(24px); transform: scale(1.05); }` → `to { opacity: 1; filter: blur(0); transform: scale(1); }`
- 1400ms, `cubic-bezier(0.33, 0, 0.2, 1)` (gentle ease), `both` fill mode
- Starts at `opacity: 0` — seamless with the blurred backdrop beneath (same asset), so no visible "pop"; the sharp layer fades in while unfocusing
- Blur+scale match the backdrop's own `blur-2xl scale-110` state, so the sharp layer "focuses in" from the identical visual state
- **Smoothing pass** (user: "se siente brusco"): was originally 900ms + `cubic-bezier(.2,.8,.2,1)` + starting `opacity: 0.4`; the 0→0.4 opacity jump read as abrupt. Now starts at 0 with a slower, softer ease for a continuous focus pull

#### Part 4: Sharp layer class swap
- `animate-hero-sharp-in` → `animate-hero-focus-in` on the sharp `<img>` (Layer 2), keeping the `imageUrl === loadedHeroUrl` opacity gate
- `heroSharpIn` keyframe + `.animate-hero-sharp-in` class retained in App.css (unused, no removal)

### Design decisions
- **Sutil, no "presentation"**: user chose the subtle variant — blur 24px, scale 1.05, 900ms. No dramatic zoom or full-opacity start
- **Same-asset principle**: backdrop and sharp now resolve to the same background URL, so the transition reads as "the image gained sharpness" rather than an asset swap
- **Backdrop layers unchanged**: `backdropLayers` crossfade (max 2, 600ms prune) confirmed intentional and left as-is
- **`animate-hero-entrance` on the container** (replays on keyed remount `source:appId`) retained

### Key Files Changed
- `src/components/library/LibraryGameDetails.tsx` — `getHeroImageUrl` priority reorder (backgroundPath above metadataSecondary), `rawPlaceholder` background-first, sharp layer class → `animate-hero-focus-in`
- `src/App.css` — `@keyframes heroFocusIn` + `.animate-hero-focus-in`

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.82s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
