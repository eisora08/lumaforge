## Session — Folder picker: start from the input path, fall back to games/debrid root

### Problem
The folder-picker button opened at the OS last-used folder ("a game's path") instead of the path typed in the input — even in GameEditDialog. Root cause: `pick_folder` (Rust) called `dialog.set_directory(&d)` with whatever `start_dir` arrived; when the path didn't exist on disk (e.g. the repack default `games/debrid/<entryId>` before download), rfd silently fell back to last-used. GameEditDialog's 4 folder-Browse buttons passed no `start_dir` at all.

### Part 1: Rust `pick_folder` — robust start_dir (`src-tauri/src/commands/process.rs`)
- Added injected `app_handle: tauri::AppHandle` (Tauri injects automatically — no `lib.rs` change).
- Relative `start_dir` (e.g. `games/debrid/<id>`) resolved against `app_data_dir()`.
- When the path doesn't exist, walks up to the **nearest existing ancestor** so the native dialog doesn't fall back to last-used. For a repack default this lands on `<appData>/games/debrid` (the root the user wants).
- Only calls `set_directory` with an existing dir; Windows drive root handled (`pop()` false → stop).
- `use tauri::{AppHandle, Manager}` imports added.

### Part 2: GameEditDialog — pass the typed value as startDir
- All 4 folder-Browse buttons now pass the draft value as `startDir`:
  - `pickFolder("Select Install Folder", installDirDraft.trim() || undefined)` (×2)
  - `pickFolder("Select Working Directory", workingDirectoryDraft.trim() || undefined)` (×2)

### Part 3: StoreRepackInstallModal — explicit root on empty input
- Caches the resolved `appDataDir` in state (`resolvedAppDataDir`) from the existing `resolveAppDataDir()` effect.
- `handlePickFolder`: `pickFolder("Elige la carpeta de destino", destDir.trim() || (resolvedAppDataDir ? \`${resolvedAppDataDir}/games/debrid\` : undefined))` — empty input opens at the root `games/debrid`; non-empty missing path handled by the Rust walk-up.

### Key Files Changed
- `src-tauri/src/commands/process.rs` — `pick_folder` robust start_dir (relative→appData, walk-up to existing ancestor)
- `src/components/games/GameEditDialog.tsx` — 4 Browse buttons pass input draft as `startDir`
- `src/components/store/StoreRepackInstallModal.tsx` — `resolvedAppDataDir` state + root fallback in `handlePickFolder`

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 22 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.12s, Rolldown; only pre-existing chunk warnings + informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
