## Session — Dashboard hero Ken Burns motion (continuous slow zoom/pan)

### Goal
Add ambient motion to the dashboard/home hero background without touching layout, matching the Console Spotlight Ken Burns already in the app.

### Changes
- `src/App.css` — new `@keyframes heroKenburns` (scale 1→1.06 + translate(-1%, 0.5%), origin center, 25s ease-in-out infinite alternate) + `.animate-hero-kenburns` class next to the other hero keyframes, with a `prefers-reduced-motion: reduce` guard that disables the animation.
- `src/components/dashboard/GameHero.tsx` — `data-hero-bg-layer` div (L780) now uses `className="animate-hero-kenburns absolute inset-0"`.

### Behavior
- Only the background art layer moves; gradient overlays (bottom `:795`, left `:798`) and `z-10` content (title/buttons/stats) stay static.
- Continuous (`infinite alternate`) — no restart on game switch; the section's `overflow-hidden` clips scaled edges so no gaps appear.
- Fallback gradient (no bgUrl) stays static; reduced-motion users get no animation.
- No layout shift, no JS, no new dependencies.

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.07s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
