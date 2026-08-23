## Session — Manual Game Registry: localStorage → AppData JSON Migration

### Goal
Move manual game registry persistence from browser localStorage to an AppData JSON file (`games/manual/manual-games.json`) via Rust/Tauri commands. Keep the module-level cache pattern and public API unchanged.

### Problem
localStorage is unreliable for app data (WebView storage clear, different browsers, no filesystem access). Manual game data should live on disk like all other game data.

### Implementation

#### Part 1-2: Rust commands (`src-tauri/src/commands/manual_games.rs`)
- `read_manual_games(app_handle) → Vec<ManualGameEntry>` — reads `games/manual/manual-games.json`, returns `[]` if missing. Corrupt files backed up as `manual-games.corrupt.<timestamp>.json`.
- `write_manual_games(app_handle, entries)` — atomic write via temp→rename.
- `backup_manual_games(app_handle) → String` — creates timestamped backup.
- `ManualGameEntry` struct with `#[serde(rename_all = "camelCase")]` matching existing TS type.
- `ManualGamesFile` wrapper with `version: u32` + `entries: Vec<ManualGameEntry>`.

#### Part 3: TS bindings (`src/services/tauri.ts`)
- `readManualGames()`, `writeManualGames(entries)`, `backupManualGames()`.
- `ManualGameEntryJson` type matching the Rust camelCase output.

#### Part 4: manualGameStore.ts rewrite
- **Module-level cache** unchanged (`_cache`, `_listeners`).
- **Sync `ensureCache()`** loads from localStorage as immediate fallback (before boot).
- **`loadManualGamesFromJson()`** async — reads from JSON disk, migrates localStorage if JSON empty, normalizes entries, seeds `_cache`. Called once during boot Stage 3.25.
- **Write operations** (`saveManualGame`, `updateManualGame`, `removeManualGame`) update sync cache + write localStorage + async `persistToDisk()` (fire-and-forget).
- **`persistToDisk()`** creates backup on first write, then calls `writeManualGames()`.
- **`normalizeEntry()`** — strips `"manual:"` prefix, fills defaults, coerces types.
- **`MIGRATION_MARKER_KEY`** — `lumaforge-manual-games-json-migrated-v1` localStorage marker.

#### Part 5-6: Migration
- On first `loadManualGamesFromJson()`: if JSON has entries → use JSON.
- If JSON empty + localStorage has entries → normalize, write to JSON, set marker.
- Both empty → empty array.
- localStorage preserved as backup (not deleted).

#### Part 7-8: Public API preserved
- All 9 public functions unchanged: `loadManualGames`, `getAllManualGames`, `getManualGame`, `saveManualGame`, `updateManualGame`, `removeManualGame`, `subscribeManualGames`, `resetManualGameCache`, `getManualGameCount`.
- `normalizeManualGameId` and `getManualProviderGameId` unchanged.
- All manual flows (create, edit, remove, sidebar, console, details) work without code changes.

#### Boot integration
- Stage 3.25 (`load-manual-games`) added to `BootTaskId` type.
- Runs between Stage 3 (snapshot load) and Stage 3.5 (title enrichment).
- `[BOOT][MANUAL_GAMES]` log with entry count.

### Key Files Changed
- `src-tauri/src/commands/manual_games.rs` — **new** — read/write/backup commands
- `src-tauri/src/commands/mod.rs` — `pub mod manual_games` added
- `src-tauri/src/lib.rs` — 3 commands registered
- `src/services/tauri.ts` — TS bindings + `ManualGameEntryJson` type
- `src/services/manualGameStore.ts` — full rewrite: JSON backend + localStorage fallback + migration
- `src/services/appBootCoordinator.ts` — `load-manual-games` task in BootTaskId + Stage 3.25

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (0 errors, only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
