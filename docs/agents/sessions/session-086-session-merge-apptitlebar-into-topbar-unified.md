## Session — Merge AppTitleBar into TopBar (unified toolbar, no divider)

### Goal
Make the window title bar visually disappear — no border divider — and merge it into the main toolbar so the app reads as a single 56px bar: search … drag · console · bell · [min][max][close], with the sidebar spanning full height (Discord/Slack style).

### Changes
- **`TopBar.tsx`** — absorbed the Tauri window-control logic and buttons from `AppTitleBar.tsx`:
  - Added `isMaximized` state, `syncIsMaximized()` (driven by `onResized`), `exec()` helper, minimize/maximize/close/double-click handlers, dynamic `getCurrentWindow` import, `DEBUG_WINDOW_CONTROLS` flag.
  - `<header>` restructured (`h-14`, `bg-(--shell-bg)`, backdrop-filter, added `select-none`): left group (menu + search, `px-4 lg:px-6` moved here) → drag spacer (`data-tauri-drag-region flex-1 self-stretch` + double-click maximize) → right group (console + bell, `pr-2`) → 3 square window-control buttons (46px each, flush right, hover/close styles preserved).
- **`AppLayout.tsx`** — removed `<AppTitleBar />` (was L128) and its import; the sidebar/content row now starts at the top of the window.
- **`AppTitleBar.tsx`** — deleted (dead code, only imported by AppLayout).

### Behavior
- No divider/border; the sidebar top area is no longer draggable (drag region is the middle stretch of the top bar, double-click = maximize).
- Notification + console icons sit directly left of minimize/maximize/close.
- Everything raises ~36px; sidebar spans full height.

### Key Files Changed
- `src/components/layout/TopBar.tsx` — window controls + drag region merged in
- `src/components/layout/AppLayout.tsx` — AppTitleBar removed
- `src/components/layout/AppTitleBar.tsx` — deleted

### Build
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.32s, Rolldown; only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
