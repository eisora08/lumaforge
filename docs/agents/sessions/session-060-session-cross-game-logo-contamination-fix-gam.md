## Session — Cross-game logo contamination fix + GameEditDialog/ImageSearchDialog polish

### Problem
**Cross-game logo contamination**: When user switches games rapidly (e.g. Cuphead → Cricket), a stale `setFallbackBundle` callback from the previous game's async `handleRefreshArtwork` could fire while the new game is active. The materialize effect at `LibraryGameDetailPage.tsx:467` called `materializeResolvedGameMedia(appId, fallbackBundle, "steam")` where `appId` = current game (Cricket) and `fallbackBundle` = previous game's bundle (Cuphead). This enqueued Cuphead's logo URL for download into Cricket's media directory — the file was saved to `games/steam/4717430/media/logo.png` instead of `games/steam/268910/media/logo.png`.

**Root cause**: `fallbackBundle.appId` was set by `resolveMediaByPriority` at bundle creation time, but no code verified bundle ownership before materialization.

### Fix

#### Part 1: Web Image Search browser fix
- `GameImageSearchDialog.tsx` — replaced `window.open(url, "_blank")` (blocked in Tauri WebView) with `openExternalUrl` from `src/services/externalLinks.ts`
- Added `[WEB_IMAGE_SEARCH][OPEN_EXTERNAL]` diagnostic log
- Added instruction text below browser buttons: "Open image search in your browser…"

#### Part 2: Set URL download fix
- `GameEditDialog.tsx` `handleUrlDownload` — fixed Tauri invoke to include `target: ""` (required String) and `forceRefresh: true` (required bool) params
- Added `[GAME_EDIT_URL]` diagnostic logs behind `DEBUG_MEDIA_EDIT` flag

#### Part 3: Open Media Folder button
- `GameEditDialog.tsx` — added `handleOpenMediaFolder` callback using `openGameMediaFolder(appId)` (Rust command → `get_media_dir` → `open::that`)
- Footer restructured to `justify-between` with left-aligned `FolderOpen` icon button
- Try/catch shows "Could not open media folder" toast on failure

#### Part 4: Context menu access to GameEditDialog
- `GameLauncherTile.tsx` — added "Edit Game Details" (initialTab="general") and "Manage Artwork" (initialTab="media") inside the existing Manage submenu, wired to existing `GameEditDialog`

#### Part 5: Stale-bundle appId guards (3 layers)
- **Layer 1 — Materialize effect** (`LibraryGameDetailPage.tsx:470`): checks `fallbackBundle.appId !== appId` before materializing. Logs `[MEDIA][MATERIALIZE_GUARD]` with appId/bundleAppId.
- **Layer 2 — Media queue subscription** (`LibraryGameDetailPage.tsx:494`): checks `bundle.appId !== appId` from `_fallbackBundleRef.current` before re-materializing on download success.
- **Layer 3 — Defensive guard in materializeResolvedGameMedia** (`gameCacheService.ts:3075`): checks `bundle.appId !== appId` and returns early with `[MEDIA_MATERIALIZE][GUARD]` log.

### Scenario coverage
- **A — Normal single game flow**: Bundle.appId === current appId, all 3 layers pass, materialization proceeds normally.
- **B — Rapid game switch during Refresh**: Old `setFallbackBundle(cupheadBundle)` fires while Cricket is active. Layer 1 detects mismatch, skips materialization. No Cuphead URLs enqueued for Cricket.
- **C — Media queue callback race**: Cuphead's download completes while on Cricket. Layer 2 checks ref bundle's appId vs current appId, skips re-materialization.
- **D — Third-party caller**: Any other caller of `materializeResolvedGameMedia` with mismatched appId/bundle is caught by Layer 3 defensive guard.

### Key Files Changed
- `src/components/games/GameImageSearchDialog.tsx` — `openExternalUrl`, instruction text, diagnostics
- `src/components/games/GameEditDialog.tsx` — Set URL invoke fix, diagnostics, Open Media Folder button
- `src/components/games/GameLauncherTile.tsx` — Edit Game Details / Manage Artwork context menu items
- `src/pages/LibraryGameDetailPage.tsx` — Layers 1+2 stale-bundle guards
- `src/services/gameCacheService.ts` — Layer 3 defensive guard in `materializeResolvedGameMedia`

### Build
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
