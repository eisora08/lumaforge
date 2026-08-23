## Session — Phase 2.13: Console Mode reset defaults + disk size/achievement bar

### Goal
Add reset-to-defaults to Console Settings overlay, show disk size and achievement progress in preview panel using shared pure helpers.

### Part 1: Reset to Defaults
- `consoleSettings.ts` — added `DEFAULT_CONSOLE_SETTINGS` export + `resetConsoleSettings()` (clears localStorage, returns defaults)
- `ConsoleSettingsOverlay.tsx` — added "Reset to Defaults" button below sections; calls `resetConsoleSettings()` then patches full defaults via single `onPatch` call

### Part 2: Shared game stat helpers
- `src/features/console/consoleGameStats.ts` — **new** — pure helpers:
  - `formatBytes(bytes?)` — returns `"Unknown"` for null/undefined, `"X.XX GB"` for ≥1GB, `"XX MB"` otherwise
  - `getGameAchievementSummary(game)` — reads `game.achievementSummary` (unlocked/total), returns `{unlocked, total, percent}` or `null`

### Part 3: Preview panel disk size + achievement bar
- `ConsoleGridLayout.tsx` — imported `formatBytes` and `getGameAchievementSummary`; added "Size" row using `formatBytes(focusedGame.sizeOnDisk)`, achievement progress bar (unlocked/total, percent, accent-fill) when summary available

### Key Files Changed
- `src/features/console/consoleSettings.ts` — `DEFAULT_CONSOLE_SETTINGS` export, `resetConsoleSettings()`
- `src/features/console/ConsoleSettingsOverlay.tsx` — reset-to-defaults button
- `src/features/console/consoleGameStats.ts` — **new** — pure game stat helpers
- `src/features/console/ConsoleGridLayout.tsx` — disk size + achievement bar in panel

### Build
- `tsc --noEmit` ✅ passes (no errors)
- `vite build` ✅ passes (no errors)
- `cargo check` ⏭️ skipped (no Rust changes)
