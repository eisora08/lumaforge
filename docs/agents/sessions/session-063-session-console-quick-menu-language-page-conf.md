## Session — Console Quick Menu: Language page, ConfirmModal, keyboard nav for tools/help

### Objective
- Add App Language placeholder sub-page to Console Settings, replace `window.confirm` with existing `ConfirmModal` component for power actions, add keyboard/gamepad navigation (ArrowUp/Down/Enter) for Tools and Help sub-pages, expand Startup settings with new boolean fields, and remove conflicting local keyboard handlers.

### Changes
- `ConsoleSettings` type in `consoleSettings.ts` extended: `launchMode` now includes `"last-used"`; `windowMode` includes `"minimized"` and `"tray"`; added `startMaximized`, `startInTray`, `closeToTray`, `showDashboard`, `disableUpdate` (all boolean).
- `STARTUP_DEFAULTS` updated with new fields; `LAUNCH_MODE_OPTIONS` now 3 items; `WINDOW_MODE_OPTIONS` now 5 items.
- `SETTING_ROWS_STARTUP` expanded with toggle rows for all 5 new boolean fields.
- `SETTING_ROWS_LANGUAGE` added with `appLanguage` segmented (Follow System only) and `languageComingSoon` button row.
- `SUBPAGE_ROWS`, `SUBPAGE_TITLES`, `subPageLabel()`, `SETTINGS_KEYS`, and `SettingsCategoryGrid` all register `"language"` page.
- `ConfirmModal` imported from `../../components/common/ConfirmModal` and wired for all 4 power actions (shutdown/suspend/hibernate/restart):
  - `POWER_CONFIRM_CONFIGS` map replaces old `confirmLabels` record.
  - `executePowerAction` replaced by `executePowerCommand(key)` (no confirm, no `handleClose`).
  - `powerConfirm` state drives ConfirmModal rendering at bottom of panel.
- Window `keydown` handler restructured for sub-pages: `subPage === "tools"` handles ArrowUp/Down/Enter/Escape; `subPage === "help"` handles ArrowUp/Down/Escape; all other sub-pages handle Escape only.
- Local `handleKeyDown` removed from `ConsoleToolsSubPanel` and `ConsoleHelpSubPanel` to prevent double-firing with window handler.
- Unused `onFocusChange` props renamed to `_onFocusChange` to suppress TS6133.

### Key Files Changed
- `src/features/console/consoleSettings.ts` — type extended, defaults/options updated
- `src/features/console/ConsoleSettingsPanelV2.tsx` — SETTING_ROWS_LANGUAGE, ConfirmModal integration, window handler restructured, local key handlers removed, SETTINGS_KEYS/SETTINGS_CATEGORIES/SUBPAGE_ROWS all updated

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
