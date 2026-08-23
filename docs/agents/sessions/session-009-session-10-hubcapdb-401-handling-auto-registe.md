## Session 10 — HubcapDB 401 handling + auto-register Lua packages (Step 37)

### Part 1: 401/403 download failure handling
- `downloadFromSource` in Store.tsx now parses `Status: <code>` from Rust error messages
- Auth errors (401/403) mark source availability as `"error"` via `updateSourceAvailability` (preserves available sources for "Change Source")
- Clear error toast shows provider name + status code + suggestion ("Verifica la API key o permisos")
- Non-auth errors show the default error message unchanged
- `[STORE][PROVIDER_DOWNLOAD_FAILED]` diagnostic log with appId, provider, status, title
- Same pattern in `PackageCard.tsx` `internalDownload` with `[CARD][PROVIDER_DOWNLOAD_FAILED]` log

### Part 2: Auto-register installed Lua packages (no manual rescan needed)
- After successful `downloadAndInstallPackage` in Store.tsx: immediately calls `refreshInstalledScripts()` (updates Store UI) then `libraryRefresh()` from `useLibraryGames()` (updates library/sidebar/dashboard)
- `[LUA][REGISTER_PACKAGE]` log on install success
- `[LIBRARY][GAME_UPSERT]` log after library refresh completes
- Debounced `scheduleSnapshotWrite` in `LibraryGamesContext` persists state automatically

### Part 3: Tauri async cancellation guards
- `_mountedRef` pattern added to Store.tsx (`downloadFromSource`) and PackageCard.tsx (`internalDownload`)
- All `setState` calls guarded by `_mountedRef.current` check
- `[STORE][ASYNC_CANCELLED]` / `[CARD][ASYNC_CANCELLED]` log when component unmounts during async operation

### Key Files Changed
- `src/pages/Store.tsx` — `useLibraryGames` import, `_mountedRef` + cleanup, `downloadFromSource` refactored with 401 handling, cancellation guard, library refresh
- `src/components/packages/PackageCard.tsx` — `_mountedRef` + cleanup, `internalDownload` with 401 handling and cancellation guard

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes
