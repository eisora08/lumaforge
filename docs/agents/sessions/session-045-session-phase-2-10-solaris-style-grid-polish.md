## Session — Phase 2.10: Solaris-style Grid Polish

### Goal
Shift the Console Grid view toward a Solaris-inspired dense grid layout: wider preview panel, tighter card grid with no under-card labels, category icons, visual action buttons.

### Part 1 — Grid spacing and card count
- `ConsoleGridLayout.tsx`: Grid uses `minmax(160px, 180px)` for poster cards with `gap-x-6 gap-y-7` (24px horizontal, 28px vertical gaps)
- Yields 7-10 cards per row on 1920-2560px screens with the wider panel
- Landscape variant uses `minmax(200px, 220px)`

### Part 2 — Grid scroll behavior (structure already correct)
- Root `flex h-screen flex-col` prevents page scroll
- Middle container `flex flex-1 overflow-hidden` constrains grid+panel area
- Grid div `flex-1 overflow-y-auto` scrolls independently
- Hud `shrink-0` stays top, CategoryBar `shrink-0` stays bottom
- Panel `overflow-y-auto` scrolls independently

### Part 3 — Remove fixed title labels in Grid mode
- `ConsoleGameCard.tsx`: Added `noLabel` boolean prop
- Poster variant: title block below image is skipped when `noLabel=true`
- Landscape variant: gradient overlay title remains (acceptable per spec — title is ON the art, not under it)
- ConsoleGridLayout passes `noLabel` to all cards in grid mode

### Part 4 — Card focus glow
- `ConsoleGameCard.tsx`: Focus ring increased from `ring-2` to `ring-3` with stronger opacity
- `ring-3 ring-(--color-accent)/60 shadow-xl shadow-(--color-accent)/25`
- Removed dead `group-hover/card:scale-105` from AsyncImage (no group parent existed)

### Part 5 — Wider right preview panel
- `ConsoleGridLayout.tsx`: Panel uses `width: clamp(400px, 35vw, 600px)` with `min-width: 400px` and `max-width: 600px`
- 400px minimum, ~35vw on mid-range, 600px max — previously 420-460px fixed
- Also switched from `w-[420px]` to `clamp()` for responsive width

### Part 6 — Preview panel content upgrade
- Content (hero image, title, badges, stats grid, dev/publisher, achievements bar, genre chips, description) already comprehensive from Phase 2.9
- Better spacing with `gap-5` between sections

### Part 7 — Visual action buttons
- Added at bottom of panel content, separated by divider:
  - **Play** button (disabled, accent color) — placeholder, no real wiring
  - **Details** button (disabled, outline) — placeholder
  - **Favorite** toggle (wired via `useFavorites().toggleFavorite`) — shows heart icon, fills when favorited
  - **Options** button (disabled, outline) — placeholder
- Non-wired buttons show as disabled with low opacity (`opacity-90` / `opacity-50`)

### Part 8 — Category bar icons
- `ConsoleCategoryBar.tsx`: Each category now has a lucide icon before the label:
  - Continue → `Play`, Installed → `HardDrive`, Lua → `Code`, Favorites → `Heart`, All → `LayoutGrid`
- Icons are `h-3.5 w-3.5` with `opacity-70`
- Applies `inline-flex items-center gap-1.5` for proper alignment

### Part 9 — Spotlight stability
- `ConsoleGameCard` changes are backward-compatible: `noLabel` defaults to `false`
- Spotlight layout does not pass `noLabel` — card rendering unchanged
- Focus glow enhancement applies to both views

### Key Files Changed
- `src/features/console/ConsoleGridLayout.tsx` — Full rewrite: wider responsive panel (clamp), tighter grid gaps (gap-x-6 gap-y-7), noLabel on cards, action buttons row, favor toggle wiring
- `src/features/console/ConsoleGameCard.tsx` — Added `noLabel` prop, stronger focus glow (ring-3 + thicker shadow), removed dead group-hover zoom class
- `src/features/console/ConsoleCategoryBar.tsx` — Category icons (Play, HardDrive, Code, Heart, LayoutGrid), inline-flex alignment

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ⏭️ skipped (no Rust changes)
