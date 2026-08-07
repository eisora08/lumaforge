## Session — Lua Adapter Bypass Fix (+ remote repository install flow)

### Problem
The DeclarativeExtension was hijacking repository-sourced Lua extensions (e.g. OpenSteamTool) during source discovery. When a repository extension had `managedFiles`, `tryCreateDeclarativeExtension` created a DeclarativeExtension runtime for it — which only installs managed DLL files (never saves `extension.lua` to AppData). Meanwhile, the Lua loader (`loadExtensionsFromAppData`) looked for `extension.lua` in AppData but it was never saved there. The DeclarativeExtension should have been bypassed and the Lua adapter (`createLuaExtension`) should have been used instead.

### Root Cause
Two flaws prevented `extension.lua` from being loaded:
1. **ID/Folder mismatch**: remote repo folder was `opensteamtool` but manifest `id` was `opensteamtool-repo`, causing wrong local path resolution in AppData.
2. **Factory hijacking**: `manager.ts` unconditionally fell back to `DeclarativeExtension` when `managedFiles` were present, never leaving room for the Lua adapter.
3. **Missing install flow**: Even with a correct manifest, no code fetched `extension.lua` from the remote repo and saved it to AppData.

### Fixes

#### Part 1: Remote repository ID fix
- `lumaforge-extensions/extensions/opensteamtool/manifest.json` — `id` changed from `"opensteamtool-repo"` to `"opensteamtool"`, `name` changed to `"OpenSteamTool"`.
- `lumaforge-extensions/index.json` — extension entry `id`/`name` changed to `"opensteamtool"`.
- Committed and pushed to `origin/main`.

#### Part 2: manager.ts — Repository extension URL store + DeclarativeExtension skip
- Added module-level `_repositoryExtensionUrls: Map<string, string>` for UI retrieval.
- `setRepositoryManifestUrl(id, url)` / `getRepositoryManifestUrl(id)` / `clearRepositoryManifestUrl(id)` / `clearAllRepositoryManifestUrls()` — public API.
- Repository-sourced extensions (sourceId !== "builtin") with `managedFiles` now SKIP DeclarativeExtension entirely — `ext.extension = undefined`.
- Built-in extensions with `managedFiles` still use DeclarativeExtension (no extension.lua — lifecycle from GitHub releases).
- `[SOURCE_MANAGER] Skipped DeclarativeExtension for "..." (repo-sourced Lua)` diagnostic log.

#### Part 3: ExtensionsSettings.tsx — Remote repository install flow
- New `installRemoteRepositoryExtension()` function (9-step pipeline):
  1. Find existing manifest from extensions list
  2. Derive `extension.lua` URL from manifest URL (`manifest.json` → `extension.lua`)
  3. Fetch both `extension.lua` and `manifest.json` from remote
  4. Re-parse manifest via `loadManifestFromObject` to verify validity
  5. Resolve AppData dir via `resolveAppDataDir()`, create `AppData/extensions/{id}/` via `extensionCreateDir`
  6. Write `extension.lua` and `manifest.json` to AppData directory via `extensionWriteTextFile`
  7. Create Lua extension via `createLuaExtension(manifest, scriptPath)`
  8. Register in runtime Registry via `registerExtension(luaExtension)`
  9. Call Lua install lifecycle via `luaExtension.install({ hostPath: steamRoot })`
- `handleOperation` entry point: when `getExtension(id)` returns null and `getRepositoryManifestUrl(id)` exists, sets "installing" state then delegates to remote install helper.
- UI shows "installing" indicator during fetch, error message on failure, re-detect on success.

### Key Files Changed
- `lumaforge-extensions/extensions/opensteamtool/manifest.json` — id fixed to `opensteamtool`
- `lumaforge-extensions/index.json` — extension entry id fixed to `opensteamtool`
- `src/extensions/sources/manager.ts` — repository URL store, DeclarativeExtension skip for repo extensions
- `src/extensions/ui/ExtensionsSettings.tsx` — `installRemoteRepositoryExtension`, remote install branch in `handleOperation`

### Build
- `cargo check` ✅ (0 errors)
- `tsc --noEmit` ✅ (only pre-existing test/runtime errors)
- `vite build` ✅ (6.88s, only pre-existing chunk warnings)
