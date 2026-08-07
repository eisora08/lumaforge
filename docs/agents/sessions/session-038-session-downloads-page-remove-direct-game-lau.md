## Session — Downloads page: remove direct game launch, navigate to GameDetails instead

### Problem
The Downloads page "Jugar" button called `session.launchGame()` directly, creating a semi-direct launch path. This caused mismatched behavior: overlay routing logic in GameDetails was bypassed, and the session managed state (running in foreground, overlay cleared on navigation) was never established.

### Fix

#### Part 1: Remove `onPlay` from `DownloadJobCard`, replace with `onOpenDetails`
- Removed `onPlay: (appId: string) => void` prop from `DownloadJobCardProps`
- Added `onOpenDetails: (appId: string) => void` prop
- Changed "Jugar" button (Play icon) → "Ver detalles" button (Eye icon)
- Removed unused `Play` import, added `Eye` import from `lucide-react`
- No changes to Open Steam, Open folder, Remove actions

#### Part 2: Remove `handlePlay` from `Downloads.tsx`, add `handleOpenGame` with navigation
- Removed imports: `useGameSession`, `LibraryGame`, `showError`
- Removed `session = useGameSession()`
- Removed `handlePlay` (was building a `LibraryGame` from snapshot data and calling `session.launchGame()`)
- Removed `[DOWNLOAD_PLAY]`, `[GAME_SESSION_START]` diagnostic logs
- Added `useLibraryGames()` for `setSelectedGame` and `games`
- Added `onNavigate?: (page: AppPage) => void` prop to the component
- Added `handleOpenGame(appId)` — finds game in `games` by appId, calls `setSelectedGame(game)` then `onNavigate("library-game-detail")`
- Snapshot fallback: if game not in library, retries lookup via `getBootSnapshot`
- All `DownloadJobCard` instances now pass `onOpenDetails={handleOpenGame}`

#### Part 3: App.tsx wiring + log cleanup
- Changed `<Downloads />` → `<Downloads onNavigate={handleNavigate} />`
- Removed two `[SESSION_OVERLAY_ROUTE]` console.log statements from `SessionOverlayWrapper` (added for the Downloads play path)

### Key Files Changed
- `src/components/downloads/DownloadJobCard.tsx` — `onPlay` → `onOpenDetails`, Jugar → Ver detalles, `Play` → `Eye` icon
- `src/pages/Downloads.tsx` — replaced `handlePlay`/`useGameSession` with `handleOpenGame`/`useLibraryGames`/`onNavigate`
- `src/App.tsx` — pass `onNavigate` to `<Downloads>`, removed `[SESSION_OVERLAY_ROUTE]` logs

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
