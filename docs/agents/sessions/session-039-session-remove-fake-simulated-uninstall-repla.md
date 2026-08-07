## Session — Remove fake simulated uninstall, replace with safe Steam-managed flow

### Problem
Two context menus had "Uninstall" actions that showed a confirm dialog then a fake success toast `"Game uninstalled (simulated)."` — the user believed the game was uninstalled but nothing happened.

### Root cause
- `GameLauncherTile.tsx` — `handleUninstall()` function called `confirm()` then `showSuccess("Game uninstalled (simulated).")`
- `SidebarLibraryList.tsx` — inline handler with same pattern: `confirm()` then `showSuccess(...)`
- No actual uninstall logic existed — both were no-ops that pretended success

### Fix

#### Part 1: GameLauncherTile.tsx
- Removed `handleUninstall()` function entirely
- Removed `useConfirm` import + `const { confirm }` destructuring
- Removed `Trash2` from lucide imports (only used for uninstall)
- Replaced menu item: `"Uninstall"` with `Trash2` → `"Uninstall in Steam"` with `ExternalLink`
- On click: opens `getSteamStoreUrl(appId)` via `openExternalUrl` + shows info toast
- Toast: `"Steam opened. Complete uninstall in Steam. LumaForge will update automatically."`
- No confirm dialog, no fake success

#### Part 2: SidebarLibraryList.tsx
- Removed inline uninstall handler (confirm + simulated toast)
- Removed `useConfirm` import + `const { confirm }` destructuring
- Removed `Trash2` from lucide imports
- Replaced menu item: `"Uninstall"` with `Trash2` → `"Uninstall in Steam"` with `ExternalLink`
- Same click behavior: opens Steam store page, shows info toast

### Behavior
- **Click "Uninstall in Steam"**: Opens Steam store page in browser. Shows info toast (not success). Game remains installed in LumaForge.
- **User cancels in Steam**: No change — LumaForge still shows installed.
- **User completes in Steam**: 30-second passive poll detects missing appmanifest → game becomes uninstalled.
- **Lua installed Steam game**: Lua metadata preserved through existing uninstall detection path.
- **No remaining fake strings**: Only `simulated://` URL in `achievementWatcherService.ts` dev tool remains (unrelated).

### Key Files Changed
- `src/components/games/GameLauncherTile.tsx` — removed `handleUninstall`, `useConfirm`, `Trash2`; replaced menu item with `"Uninstall in Steam"` + external link + info toast
- `src/components/layout/SidebarLibraryList.tsx` — removed inline uninstall handler, `useConfirm`, `Trash2`; replaced menu item with `"Uninstall in Steam"` + external link + info toast

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ⏭️ skipped (no Rust changes)
