## Session — Console Quick Menu Tools + Power Actions

### Problem
The Quick Menu (Console Mode) Tools sub-panel was a placeholder with "coming soon" entries. Power actions (Shutdown/Suspend/Hibernate/Restart) were also "coming soon" with no real implementation.

### Part 1: Rust power commands
- `src-tauri/src/commands/power.rs` — **new** — `power_shutdown`, `power_suspend`, `power_hibernate`, `power_restart` commands using `std::process::Command` calling Windows `shutdown.exe`
- `src-tauri/src/lib.rs` — registered all 4 power commands
- `src/services/tauri.ts` — added TS bindings

### Part 2: Rust utility commands
- `src-tauri/src/commands/tools.rs` — **new** — `open_app_data` (opens `<appData>/games/steam/` in Explorer), `open_logs` (opens log directory), `clear_temp_cache` (removes `<appData>/cache/temp/`), `get_system_info` (returns CPU/OS/memory/uptime/totalGames info)
- All commands registered in `lib.rs`
- `src/services/tauri.ts` — added TS bindings

### Part 3: ConsoleToolsSubPanel — real entries
- `ConsoleToolsSubPanel.tsx` — 5 real entries instead of placeholders:
  - **Open App Data Folder** — calls `openAppData()` (Rust → `open::that`)
  - **Open Logs Folder** — calls `openLogs()` (Rust → log dir)
  - **Clear Temp Cache** — calls `clearTempCache()` + toast result
  - **System Information** — calls `getSystemInfo()` + displays modal with CPU/OS/RAM/Uptime/Total Games
  - **Run Diagnostics** — calls existing `window.__runDiagnostics?.()` placeholder

### Part 4: MAIN_OPTIONS — power actions wired
- `MAIN_OPTIONS` entries changed from `action: "coming-soon"` to `action: "power"` for Shutdown, Suspend, Hibernate, Restart
- Three dispatch points wired with `case "power":`:
  1. `handleMainKeyDown` — React keyboard handler
  2. Window keydown handler (`Enter` on focused option)
  3. Main option click handler
- All dispatch points call `executePowerAction(key, handleClose)` which shows confirm dialog, then calls the corresponding Rust command

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
