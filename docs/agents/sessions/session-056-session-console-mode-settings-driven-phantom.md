## Session — Console Mode settings-driven phantom widgets + sub-panel keyboard fix

### Problem
Console Grid/Spotlight layouts had hardcoded values for left padding, card width, scroll behavior, and scroll-snap that should have been driven by `ConsoleSettings` fields (`leftPadding`, `spotlightCardWidth`, `smoothScrolling`, `horizontalScrolling`, `bottomBarPosition`, `backgroundTexture`). Sub-panel keyboard navigation had a window handler conflict where ArrowLeft/ArrowRight fired after sub-panel handlers, overwriting selection.

### Part 1: Analysis
- `leftPadding`: hardcoded `clamp(64px, 5vw, 120px)` in GridLayout scroll container
- `spotlightCardWidth`: hardcoded `w-[clamp(180px,16vw,220px)]`/`w-[clamp(280px,26vw,360px)]` for poster/landscape in SwitchSpotlightLayout
- `backgroundTexture`: defined in type/defaults but never applied as CSS class
- `smoothScrolling`/`horizontalScrolling`: never read by either layout
- `bottomBarPosition`: never read by ConsoleCategoryBar
- Tools/Help sub-panels accepted no shared props, had no keyboard navigation
- Panel `handleKeyDown` processed ArrowLeft/ArrowRight for sub-panel navigation, but window `keydown` handler ALSO processed ArrowLeft/ArrowRight for page-level navigation — sub-panel's action ran first, then window handler overwrote the selection

### Part 2: Panel keyboard fix — remove Left/Right from window handler
- Removed ArrowLeft/ArrowRight case from window `keydown` listener's sub-page section in `ConsoleSettingsPanelV2.tsx`
- Added ArrowLeft/ArrowRight to Layout, Visuals, Media, and Input sub-panel `handleKeyDown` functions for intra-panel navigation
- Added ArrowLeft to `SettingsCategoryGrid` as back-navigation
- All sub-panel handlers now process Left/Right without window handler overwrite

### Part 3: Background texture CSS
- `App.css` — added 4 texture classes: `[data-console-texture="none"]` (no background), `grain-soft` (repeating SVG noise pattern), `vignette` (radial gradient dark edges), `blur` (backdrop-filter blur with brightness)
- `ConsoleModePage.tsx` — reads `consoleSettings.backgroundTexture` and applies `data-console-texture` attribute on root wrapper

### Part 4: Widget settings integration
- **GridLayout**: `paddingLeft` changed from `clamp(64px,5vw,120px)` to `${settings.leftPadding}px`; `scrollBy` behavior uses `settings.smoothScrolling`; passes `bottomBarPosition` to ConsoleCategoryBar
- **SwitchSpotlightLayout**: card width uses `settings.spotlightCardWidth` (landscape), `settings.spotlightCardWidth * 0.625` (poster); `scroll-smooth` and `snap-x` classes conditionally applied from `settings.smoothScrolling`/`settings.horizontalScrolling`; `scrollIntoView` behavior uses `settings.smoothScrolling`
- **ConsoleCategoryBar**: accepts `bottomBarPosition` prop; `justify-start` for left, `justify-end` with reversed DOM order for right, `justify-between` with spacer for center

### Part 6+7: Help/Tools sub-pages improvements
- `ConsoleSettingsPanelV2.tsx` — both Tools and Help sub-panels now accept `navigateTo`, `onOpenSettings`, `onBack` shared props
- Tools: keyboard navigation to switch tabs (Keyboard/Media), Esc back to grid, real tab content
- Help: keyboard navigation, Esc back to grid

### Key Files Changed
- `src/App.css` — grain-soft, vignette, blur texture classes
- `src/features/console/ConsoleModePage.tsx` — `data-console-texture` attribute
- `src/features/console/ConsoleSettingsPanelV2.tsx` — Left/Right sub-panel navigation, removed window handler Left/Right conflict, Tools/Help shared props
- `src/features/console/ConsoleGridLayout.tsx` — settings-driven leftPadding, smoothScrolling, bottomBarPosition pass
- `src/features/console/ConsoleSwitchSpotlightLayout.tsx` — settings-driven spotlightCardWidth, smoothScrolling, horizontalScrolling
- `src/features/console/ConsoleCategoryBar.tsx` — bottomBarPosition alignment

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)

### Objective 2: Fix provider status / Check Update flow

### Problem
`LibraryGame` fields (`steamInstalled`, `isPlayable`, `isInstallable`, `source`) are set once during snapshot hydration (`snapshotGameToLibraryGame` in `LibraryGamesContext.tsx` line ~428) and never refreshed. `getLauncherGamePrimaryAction` reads these stale fields directly — no async provider status verification. Games loaded as `source=lua`/`steamInstalled=false`/`isPlayable=false`/`isInstallable=false` show `primaryAction=install` even when the game is actually installed via Steam. No post-hydration Steam install status reconciliation ran.

### Root Cause
- `snapshotGameToLibraryGame` maps `sg.installed` → `steamInstalled`, `sg.playable` → `isPlayable`, `sg.source` → `source`. These are set once and never rechecked.
- No post-snapshot provider status reconciliation step exists in `LibraryGamesContext.load()`.
- `scanSteamInstalledGames` Rust command (single invoke, <50ms for 80+ games) exists but is only used by uninstall detection (30s poll with 5s initial delay) and full library resolver — never as a lightweight post-hydration check.
- `providerStatusStore`/`providerStatusService` track update-check status (update-available/up-to-date) but NOT the fundamental installed/playable/installable `LibraryGame` fields.

### Fixes

#### Part 2: Post-snapshot Steam install reconciliation
- Created `src/services/providerStatusReconciliation.ts`:
  - `schedulePostSnapshotSteamReconciliation(games, updateGame, options)` — runs 2s after games are hydrated. Calls `scanSteamInstalledGames({ steamPath })`, diffs against current games, calls `updateGame()` for games with mismatched `steamInstalled`/`isPlayable`/`isInstallable`/`source`.
  - `refreshSingleGameSteamStatus(appId, options)` — per-game check with 5min TTL dedup. Returns `{ steamInstalled } | null`. Used by `checkGameProviderStatus` in context.
  - `resetProviderStatusReconciliation()` — clears state for testing.
  - `[PROVIDER][RECONCILE]` / `[PROVIDER][RECONCILE_SKIP]` / `[PROVIDER][RECONCILE_DONE]` / `[PROVIDER][RECONCILE_FAILED]` / `[PROVIDER][REFRESH]` / `[PROVIDER][REFRESH_SKIP]` / `[PROVIDER][REFRESH_FAILED]` diagnostic logs.

#### Part 4: `checkGameProviderStatus` on context
- `LibraryGamesContextValue` exposes `checkGameProviderStatus(appId, force?)` — calls `refreshSingleGameSteamStatus`, then `updateGame()` with corrected fields when status changed.
- Called from `LibraryGamesContext.load()` right after `applyGamesSafely` (before background scan), using `settings.steamRoot`.
- Module-level guard prevents duplicate scheduling.

### Key Files Changed
- `src/services/providerStatusReconciliation.ts` — **new** — post-snapshot Steam reconciliation + per-game refresh
- `src/context/LibraryGamesContext.tsx` — import + call reconciliation after games load; `checkGameProviderStatus` function + context value
