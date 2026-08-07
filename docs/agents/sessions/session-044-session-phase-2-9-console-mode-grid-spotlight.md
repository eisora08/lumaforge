## Session — Phase 2.9: Console Mode Grid & Spotlight Polish

### Problem
The Console Mode Grid view had a narrow right panel and the Spotlight layout needed polish.

### Implementation
- **ConsoleGridLayout** (`src/features/console/ConsoleGridLayout.tsx`): Wider right panel at `w-[420px] xl:w-[460px]` with `overflow-y-auto` for independent scrolling from the grid. Grid uses `grid-template-columns: repeat(auto-fill, minmax(175px, 1fr))` with poster cards. `flex h-screen flex-col` root structure prevents page scroll. Hud at top, grid+panel in middle (`flex flex-1 overflow-hidden`), category bar `shrink-0` at bottom.
- **ConsoleGameCard** (`src/features/console/ConsoleGameCard.tsx`): Focus ring (`ring-2 ring-accent/50`), border accent on focus, title below poster variant, gradient overlay on landscape variant, badges (Installed, Lua, Update), favorite heart, hover dark overlay.
- **ConsoleCategoryBar** (`src/features/console/ConsoleCategoryBar.tsx`): Keyboard hints (Enter=Details, Esc=Back, Tab=Navigate), active category accent highlight, per-category counts.
- **ConsoleSpotlightLayout**: Hero area with background art, centered cards, profile header with display name and playtime, achievement progress bar in preview panel.
- **ConsoleModePage** (`src/features/console/ConsoleModePage.tsx`): Rails-based category system (Continue/Installed/Lua/Favorites/All), keyboard navigation support, layout toggle between spotlight and grid, playtime/achievement stats in Hud.

### Key Files
- `src/features/console/ConsoleGridLayout.tsx` — Grid view with wide panel, scroll behavior, Hud/category bar layout
- `src/features/console/ConsoleModePage.tsx` — Category rails, keyboard nav, layout toggle
- `src/features/console/ConsoleGameCard.tsx` — Card with focus ring, badges, title
- `src/features/console/ConsoleSpotlightLayout.tsx` — Spotlight hero layout
- `src/features/console/ConsoleCategoryBar.tsx` — Category nav + keyboard hints
- `src/features/console/ConsoleProfileHeader.tsx` — Display name + playtime display
- `src/features/console/ConsoleTopHud.tsx` — Top bar with layout toggle
- `src/features/console/consoleMedia.ts` — Card/hero image resolution helpers

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
