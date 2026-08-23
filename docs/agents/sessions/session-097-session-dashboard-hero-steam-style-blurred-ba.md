## Session � Dashboard hero Steam-style: blurred backdrop + centered sharp image + taller heights

### Goal
Fix the home/dashboard hero looking like a short wide strip in fullscreen by applying the LibraryGameDetails 3-layer hero recipe, and increase hero height on large screens.

### Changes (src/components/dashboard/GameHero.tsx)
- **Height**: section + content div bumped from `min-h-[300px] sm:min-h-[340px]` to `sm:min-h-[380px] lg:min-h-[440px] xl:min-h-[480px]` (content stays anchored bottom via `items-end`).
- **Layer 1 � Blurred backdrop**: `data-hero-bg-layer` div removed; backdrop now static `overflow-hidden brightness-[0.65] saturate-[1.1]` with AsyncImage `h-full w-full scale-105 blur-2xl` (full-bleed color field, same fallback gradient).
- **Layer 2 � Sharp image centered**: plain `<img>` (AsyncImage forces `object-cover`, so a raw img is used) with `h-full w-auto max-w-none shrink-0`, `key={bgUrl}`, `loading="eager"`, `onError` ? `setSharpImgError(true)` (hides only the sharp layer, blurred backdrop stays), and horizontal mask `[mask-image:linear-gradient(to_right,transparent 0%,transparent 4%,black 12%,black 88%,transparent 96%,transparent 100%)]`. `heroBgClass` (Settings ? Animaciones: crossfade/kenburns/focus) now applies here.
- **Layer 3 � Gradients**: bottom readability gradient kept (`from-black/90 via-black/50 to-black/30`); left emphasis softened `from-black/60` ? `from-black/40` so the blur fade shows.
- Same `bgUrl` on both layers ? one download (browser cache). `EmptyHero` untouched.

### Result
Sharp image no longer stretches edge-to-edge; sides show the blurred backdrop (Library-style). Hero reads cinematic instead of a wide strip in fullscreen.

### Build
- `tsc --noEmit` ? (only pre-existing extension/test errors)
- `vite build` ? (1.59s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ?? skipped (no Rust changes)
