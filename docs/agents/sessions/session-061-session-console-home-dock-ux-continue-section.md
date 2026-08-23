## Session — Console Home/Dock UX: Continue section, dock focus, rich empty states, label animation

### Goal
Enhance Console Mode home screen with real session-priority Continue section, dock focus navigation, rich per-section empty states, and animated dock label reveal.

### Part 1: Continue section with active session priority
- `ConsoleModePage.tsx` — `continuePlaying` now reads `GameSessionContext.sessions` + `getPlaytimeEntryByAppId` for active-session priority and accurate playtime.
- Active sessions sorted first, then remaining by `lastPlayedAt` from playtime store, capped at 15.
- `session` hook + `continuePlaying` moved before `rails` useMemo to fix temporal dead zone (TDZ).

### Part 2: Dock focus navigation
- `dockFocusedIndex` state (-1 unfocused, 0-4 when dock item focused).
- `dockFocusedIndexRef` for stable ref inside keyboard handler (avoids re-registration).
- ArrowDown from last rail (index 4) focuses dock. Left/Right wraps dock items. Up/Enter focuses last rail. Escape unfocuses.
- `focusRail` added to keyboard handler dependency array.

### Part 3: Rich empty states
- `ConsoleSwitchSpotlightLayout.tsx` — `RichEmptyState` component with per-section icon (Play/HardDrive/Code/Heart/LayoutGrid), gradient color circle, muted description message.
- Each of the 6 sections (Continue/Installed/Lua/Favorites/All) uses RichEmptyState instead of simple text.

### Part 4: Dock label animation
- `App.css` — `@keyframes dock-label-in` (opacity 0→1, max-width 0→100px, margin-left -4px→6px).
- `ConsoleSpotlightDock.tsx` — focused dock item expands width to show full section label via CSS animation.
- Focus ring (`ring-2 ring-white/50`) on focused dock item.

### Part 5: Bottom hints polish
- `ConsoleSwitchSpotlightLayout.tsx` — bottom hints change to "Arrows · Enter select · Esc unfocus" when dock focused, else "Keyboard · Arrows · Enter".
- `ConsoleGridLayout.tsx` — `dockFocusedIndex?: number` added to Props type.

### Key Files Changed
- `src/features/console/ConsoleModePage.tsx` — session + continuePlaying reordering, dockFocusedIndex state/ref, dock keyboard nav, sharedProps spread.
- `src/features/console/ConsoleSwitchSpotlightLayout.tsx` — RichEmptyState component, dockFocusedIndex prop, bottom hints context text.
- `src/features/console/ConsoleSpotlightDock.tsx` — focusedIndex prop, focus ring, label animation, wider focus width.
- `src/features/console/ConsoleGridLayout.tsx` — dockFocusedIndex added to Props.
- `src/App.css` — @keyframes dock-label-in animation.

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
