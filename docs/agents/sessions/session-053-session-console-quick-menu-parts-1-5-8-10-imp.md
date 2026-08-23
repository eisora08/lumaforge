## Session — Console Quick Menu Parts 1-5, 8-10 Implementation

### Goal
Add controller connection/disconnection toasts (Part 1), top system bar with network/controller/jobs indicators (Part 2+3), time format settings (Part 4), startup settings page (Part 5), hover/focus visual polish (Part 8), system bar settings sub-page (Part 9), and input ownership enforcement (Part 10).

### Parts implemented

#### Part 1: Controller connection/disconnection toasts
- `src/features/console/useControllerDetection.ts` — **new** — listens to `gamepadconnected`/`gamepaddisconnected` events, fires `showInfo` toasts with controller name, calls `setGamepadDetected()` for auto hint detection. One-shot dedup via `knownRef` Set.

#### Part 2+3: Top System Bar indicators
- `ConsoleTopHud.tsx` fully rewritten:
  - **network indicator**: `useNetworkStatus()` hook returns "online"/"offline", shows `Wifi` (emerald) or `WifiOff` (rose) icon
  - **controller indicator**: `ControllerIndicator` sub-component listens to gamepad events, shows `Gamepad2` emerald/ muted
  - **jobs indicator**: polls `backgroundJobQueue.getStatus()` every 5s, shows `HardDrive` icon + badge count, hidden when 0
  - **enhanced clock**: `useClock(format, showSeconds)` — uses `Intl.DateTimeFormat` with 12h/24h/system/hidden modes, 1s or 60s interval

#### Part 4: Time format settings
- `ConsoleSettings` type extended with: `timeFormat: "12h"|"24h"|"system"|"hidden"`, `showSeconds: boolean`
- `CONSOLE_TIME_FORMAT_OPTIONS` in ConsoleSettingsPanelV2
- `TIME_FORMAT_DEFAULTS` + `resetConsoleTimeFormatSettings()` export from consoleSettings.ts
- `SETTING_ROWS_TIME` with time format segmented row, show seconds toggle, show clock toggle, reset button

#### Part 5: Startup settings page
- `ConsoleSettings` type extended with: `autostart: boolean`, `launchMode: "console"|"desktop"`, `windowMode: "fullscreen"|"maximized"|"windowed"`
- `LAUNCH_MODE_OPTIONS` / `WINDOW_MODE_OPTIONS` in ConsoleSettingsPanelV2
- `STARTUP_DEFAULTS` + `resetConsoleStartupSettings()` export
- `SETTING_ROWS_STARTUP` with launch mode segmented, window mode segmented, autostart toggle, reset button

#### Part 8+9: System bar settings sub-page
- `ConsoleSettings` type extended with: `showNetworkIndicator`, `showControllerIndicator`, `showJobIndicator`
- `SYSTEM_BAR_DEFAULTS` + `resetConsoleSystemBarSettings()` export
- `SETTING_ROWS_SYSTEM_BAR` with toggles for profile, clock, network, controller, jobs indicators, reset button
- Both "Time & Clock" and "System Bar" added to `SettingsCategoryGrid` and `SETTINGS_KEYS`

#### Part 10: Input ownership enforcement (already correct)
- Page-level handler returns early when `profileOpen` is true; settings panel's `handleGlobalKeyDown` uses `stopPropagation`
- `SETTINGS_KEYS` updated to include `"time"`, `"startup"`, `"system-bar"` for gamepad navigation

### Key Files Changed/Created
- `src/features/console/consoleSettings.ts` — extended type (8 fields), time/startup/system-bar defaults + reset functions
- `src/features/console/useControllerDetection.ts` — **new**
- `src/features/console/useNetworkStatus.ts` — **new**
- `src/features/console/ConsoleTopHud.tsx` — full rewrite with indicators + enhanced clock
- `src/features/console/ConsoleModePage.tsx` — `useControllerDetection` wired
- `src/features/console/ConsoleSettingsPanelV2.tsx` — 3 new sub-pages (time, startup, system-bar), 3 setting row groups, expanded SETTINGS_KEYS

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors, no Rust changes)
