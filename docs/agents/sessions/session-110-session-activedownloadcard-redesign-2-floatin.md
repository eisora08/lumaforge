## Session — ActiveDownloadCard redesign: 2 floating glass panels + hero transition + ambient feed

### Goal
Refactor `ActiveDownloadCard.tsx` into a premium 2-panel Glassmorphism layout over the game''s immersive art (CSS Grid responsive): left panel = live speed bar chart, right panel = title/size, torrent stats (RED/PICO/SEEDS/PEERS) and a bottom row with progress bar + percentage + Pause/Cancel buttons. Wire the page hero to the hero-transition preference (Ajustes → Animaciones) and feed the global ambient background.

### Part 1: Generic theme-driven glass utilities (App.css)
- `.lf-glass` / `.lf-glass-strong` added next to `.lf-console-glass*` (same recipe: `color-mix(in srgb, var(--color-surface) 55/72%, transparent)` + `blur(28/32px) saturate(1.4)` + inset top highlight), plus a `prefers-reduced-motion` guard.
- Uses `--color-surface` so themes and `[data-console-theme]` overrides are respected. Desktop surfaces now get real glass without hardcoded `bg-black/40`.

### Part 2: ActiveDownloadCard.tsx — full rewrite
- **Layout**: `<article>` (rounded-2xl, `border-(--surface-active-border)`) → art layers + 2 overlays → `<div class="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-2 lg:min-h-[380px]">`.
- **Left panel** (`lf-glass-strong`): "Velocidad en vivo" header + `Torrent` accent pill (only if `isTorrent`); chart `h-[clamp(130px,22vh,200px)]` of ~40 bars `from-(--color-accent)/25 to-(--color-accent)/70`, `height:(v/max)*100%`, `transition-[height] duration-300 ease-out`; pulse bar when no samples; footer shows `timeRemaining ?? message ?? status`.
- **Right panel** (`lf-glass-strong`): big game title + `sizeLine` (+ `timeRemaining`); repacker pill; torrent data row (RED/PICO/SEEDS·PEERS via theme `StatRow`); bottom row (`xl:flex-row`) = accent progress bar (`bg-(--color-accent)`, h-3, `transition-[width]`) + `formatPct` % + glass buttons (`GLASS_BTN` const: `bg-(--color-surface)/40 backdrop-blur-md`); Cancel gets `hover:bg-red-500/30`.
- **Hero transition** (`useSyncExternalStore` on `heroTransitionStore`): `crossfade` → two-layer `useCrossfadeSrc(artSrc)` (prev `animate-hero-media-out`, current `animate-hero-crossfade-in`); `kenburns` → `animate-hero-kenburns-in`; `focus` → `animate-hero-focus-in`. `brightness-[0.45]` on art.
- **Ambient feed**: `setAmbientSource("downloads-hero", currentSrc)` on art change (no clear on change); `clearAmbientSource("downloads-hero")` on unmount only — mirrors GameHero pattern. `imgFailed` → `artSrc = null` → fallback `bg-(--color-bg)` layer + ambient stops updating.
- All action logic preserved (canPause/canResume/canCancel, Open Steam for `isSteam && waiting|downloading`, indeterminate pulse bar).

### Key Files Changed
- `src/App.css` — `.lf-glass` / `.lf-glass-strong` utilities + reduced-motion guard
- `src/components/downloads/ActiveDownloadCard.tsx` — full rewrite (2-panel glass grid, hero transition modes, ambient feed, theme StatRow/GLASS_BTN)

### Build
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.14s, Rolldown; verified in bundle: "Velocidad en vivo"/"SEEDS:"/"RED"/"PICO", scope "downloads-hero", `.lf-glass-strong`, `animate-hero-crossfade-in`/`media-out`; compiled CSS has `.from-\(--color-accent\)/25`, `.to-\(--color-accent\)/70`, `bg-\(--color-surface\)/40|60`)
- `cargo check` ⏭️ skipped (no Rust changes)
