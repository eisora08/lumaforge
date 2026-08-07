## Session — Phase 2.12: Console Mode Settings Overlay & Grid Polish

### Goal
Add Console Mode frontend settings overlay and polish Grid/Solaris layout: wider cards/panel, live-adjustable card size/gap/columns via sliders, input glyph system (Xbox/PlayStation/Keyboard), theme inheritance from app settings, centered bottom nav, and focus shine animation.

### Part 1: consoleSettings.ts — settings store
- **New file** `src/features/console/consoleSettings.ts`
- Types: `ConsoleSettings`, `ConsoleLayoutMode`, `ConsoleThemeMode`, `ConsoleInputGlyphStyle`
- localStorage persistence under key `lumaforge-console-settings-v1`
- `getConsoleSettings()` sync read, `saveConsoleSettings()`, `useConsoleSettings()` React hook
- Defaults: layoutMode=spotlight, theme=follow-app, inputGlyphs=xbox, cardSize=210, gridColumns=8, gridGap=36, sidePanelWidth=680, enableShineAnimation=true

### Part 2: ConsoleSettingsOverlay.tsx — settings UI
- **New file** `src/features/console/ConsoleSettingsOverlay.tsx`
- Fixed overlay with backdrop blur, max-h 85vh scrollable
- Sections: Theme (5 options), Input Hints (3 options), Grid Layout (4 sliders), Shine Animation toggle
- Sliders: Card Size (180–260px, step 5), Grid Columns (4–14, step 1), Grid Gap (16–64px, step 4), Side Panel Width (560–780px, step 10)
- Live apply + auto-persist via `onPatch` → `useConsoleSettings`

### Part 3: consoleInputHints.ts — revised labels
- Removed `DEFAULT_STYLE` constant and `ConsoleThemeMode` type (themes moved to settings)
- Labels per spec: Xbox (A/X/Y/Menu/B/LB RB), PS (Cross/Box/Triangle/Options/Circle/L1 R1), Keyboard (Enter/Enter// /Esc/Esc/F)
- `getConsoleInputHints(style)` accepts glyph style directly

### Part 4: ConsoleGridLayout.tsx — settings-driven layout
- `settings` and `onSettingsPatch` props consumed from ConsoleModePage
- Grid uses `cardSize` for `minmax(cardSize, 1fr)`, `gridGap` for gap
- Panel width set from `sidePanelWidth` (fixed, not clamp)
- Left padding changed from `clamp(40px, 4vw, 90px)` → `clamp(64px, 5vw, 120px)`
- Input hints in panel driven by `settings.inputGlyphs`
- Settings overlay opened from HUD via `onOpenSettings`
- Added `useState` for settingsOpen local state

### Part 5: ConsoleGameCard.tsx — focus shine (already done)
- Phase 2.11 already implemented `console-card-shine` CSS animation and `prefers-reduced-motion` guard
- No changes needed

### Part 6: ConsoleCategoryBar.tsx — centered nav + glyph hints
- Layout changed from `justify-center` with hints inline to `justify-between` with left spacer, centered pills, right-side glyph hints
- Added `inputGlyphs` prop to drive hint rendering
- `showHints` and `inputGlyphs` passed from both Grid and Spotlight layouts

### Part 7: ConsoleTopHud.tsx — settings gear button
- Added `Settings` icon import from lucide-react
- Added `onOpenSettings?: () => void` prop
- Settings gear rendered before the time display when callback is provided
- Passes `onOpenSettings` from both Grid and Spotlight layouts

### Part 8: ConsoleModePage.tsx — settings integration
- Layout mode persisted via `useConsoleSettings` instead of standalone localStorage key
- `data-console-theme` attribute on root wrapper div for CSS theme targeting
- Removed `RAIL_CONFIGS`, `ConsoleProfileHeader`, `ConsoleHomeRail` (unused)
- `layoutMode` and `toggleLayout` driven by `consoleSettings` + `patchConsoleSettings`
- Shared props include `settings` and `onSettingsPatch`

### Part 9: ConsoleSpotlightLayout.tsx — settings integration
- Added `settings` and `onSettingsPatch` props matching GridLayout interface
- Input hints removed (not rendered in Spotlight, uses ConsoleCategoryBar instead)
- Passes `onOpenSettings` to `ConsoleTopHud`
- Passes `inputGlyphs` to `ConsoleCategoryBar`
- Mounts `ConsoleSettingsOverlay` (same component as Grid)

### Key Files Changed
- `src/features/console/consoleSettings.ts` — **new** — settings store with types, defaults, localStorage, React hook
- `src/features/console/ConsoleSettingsOverlay.tsx` — **new** — settings UI with theme, glyphs, sliders, animation toggle
- `src/features/console/consoleInputHints.ts` — revised labels, removed redundant types
- `src/features/console/ConsoleGridLayout.tsx` — settings-driven card size/gap/panel, wider left padding, glyph hints from settings
- `src/features/console/ConsoleCategoryBar.tsx` — centered layout, right-side glyph hints, `inputGlyphs` prop
- `src/features/console/ConsoleTopHud.tsx` — settings gear button, `onOpenSettings` prop
- `src/features/console/ConsoleModePage.tsx` — `useConsoleSettings`, `data-console-theme`, removed dead code
- `src/features/console/ConsoleSpotlightLayout.tsx` — settings props, overlay, glyph hints in category bar

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ⏭️ skipped (no Rust changes)
