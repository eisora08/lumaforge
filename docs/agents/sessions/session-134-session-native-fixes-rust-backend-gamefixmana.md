## Session — Native fixes: Rust backend (GameFixManager + Third-party tools)

### Goal
Build the Rust backend for the native fixes feature: a `GameFixManager` handling SmokeAPI/Steamless/Online-Fix/Koaloader, plus third-party tool install/update/remove commands (`thirdparty.rs`). No frontend in this session.

### Part 1: `game_fix.rs` (core manager)
- **SmokeAPI**: versioned asset download from SmokeAPI releases; `get_game_fix_info` reports `smokeApiInstalled`/version; `apply_smoke_api_fix` (32/64 arch) copies SmokeAPI.dll + `.ini` variants into game dir; `unfix_smoke_api` removes them.
- **Steamless**: portable per-game unpacker (no global install needed); `install_steamless` downloads + runs per game; `unfix_steamless` removes `steamless.exe` + its output files (exe, ini, log).
- **Online-Fix**: patched-steam_api offline files; `apply_online_fix` copies `steam_api64.dll`/`steam_api.dll` + SteamConfig; `unfix_online_fix` restores originals from backup.
- **Koaloader**: plugin loader for game dirs; auto-installed into plugins dir when smoke_api/steamless present; versioned asset download.
- Backup semantics: fixes that overwrite `steam_api64.dll` back up the original once (restored by unfix); Idempotent apply; `[FIX][...]` progress events.
- `emit_fix_progress(app_handle, app_id, tool, progress, message)` — 31 emit sites with `{appId, tool, progress, message}` payload.
- Tool download/update emits use `appId: 0` (fetch 10%, download 30%, extract 60%); per-game applies use the real appId.

### Part 2: `thirdparty.rs` (tool registry)
- GitHub release resolver: `fetch_release_info` (repo owner/name from constants), asset URL extraction by extension; `download_and_extract_to_plugins` for `.7z`/`.zip`; `extract_archive_smart`.
- Commands: `install_third_party_tool`, `update_third_party_tool`, `remove_third_party_tool`, `get_third_party_tool_status`, `get_all_third_party_tools`, `get_third_party_tool_github_info`.
- Status returns `{ installed: bool, installedPath?, version? }`; install/update download to `<appData>/thirdparty/<tool>`, remove deletes dir.
- All 6 commands registered in `lib.rs` (L345-350).

### Part 3: Frontend
- 16 `game_fix` + 6 `thirdparty` TS bindings in `src/services/tauri.ts` (~L3244-3322); `GameFixInfo`/`GameFixResult`/`FixInstallationStatus` types at L3195-3235.
- User decision: ToolsModal gating = disabled-with-hint when tool missing/not applicable — do NOT auto-install missing tools; plus one-click "Quitar fix" via unfix commands.
- `LibraryGame` has NO `luaCount` — pass `luaCount: game.luaScripts?.length ?? 0` to `libraryGetGameFixInfo`.
- `npm run tauri dev` runs + registers fine.

### Part 4: Fix-progress toast listener (optional, added later)
- `src/components/fixes/FixProgressListener.tsx` — **new** — listens `library://fix-progress`, shows success toast at progress ≥100, one-shot info toast at first progress event per `tool:appId` (dedup via `seenInitial`); `TOOL_LABELS` maps `smoke_api`/`steamless`/`online_fix`/`koaloader`; returns null, unlisten on unmount.
- Mounted in `src/App.tsx` next to `<InstallerProgressListener />` (L350).

### Key Files Changed
- `src-tauri/src/commands/game_fix.rs` — **new** — GameFixManager core
- `src-tauri/src/commands/thirdparty.rs` — **new** — tool registry
- `src-tauri/src/lib.rs` — command registration
- `src/services/tauri.ts` — bindings + types
- `src/components/fixes/FixProgressListener.tsx` — **new** — progress toast listener
- `src/App.tsx` — mount FixProgressListener

### Build
- `cargo clippy --message-format short` ✅ (0 errors; game_fix.rs/thirdparty.rs/lib.rs at 0 warnings)
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (only pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (only pre-existing chunk warnings)
