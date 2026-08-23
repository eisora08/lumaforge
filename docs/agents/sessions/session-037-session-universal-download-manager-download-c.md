## Session — Universal Download Manager (Download center redesign)

### Goal
Upgrade the Downloads page into a universal download/install activity center supporting Steam install status tracking, Lua/ZIP/manifest packages, and future providers.

### Architecture
- **No new Rust code** — all changes are TypeScript/React only
- **No new services** — reuses existing `DownloadQueueContext` (localStorage-persisted queue) and `installTrackerService` (in-memory Steam install tracker)
- **No duplicate queue model** — unified `DownloadQueueContext` handles both Steam installs and package downloads
- **Steam install progress is observational only** — opens `steam://install/<appid>`, monitors via `checkSteamGameInstalled` (existing Rust command), never downloads Steam files or edits appmanifests

### Part 1 — Generic download/install model
- Extended `DownloadJob` type in `types/download.ts`:
  - `type?: "steam-install" | "lua-package" | "zip" | "manifest" | "media" | "other"`
  - `progressMode?: "determinate" | "indeterminate"` (indeterminate when no reliable percentage)
  - `speedBytesPerSec?: number`, `etaSeconds?: number`, `message?: string`, `artworkUrl?: string`, `parentId?: string`
  - Added `"waiting"` and `"paused"` to `DownloadStatus`
- All new fields are optional — backward compatible with existing serialized localStorage jobs

### Part 2 — Steam install status tracking via existing tracker
- `installTrackerService` already tracks Steam installs: opens URL, polls `checkSteamGameInstalled`, detects `downloadProgress` (BytesDownloaded/BytesToDownload from appmanifest), 5-min timeout
- **New `useSteamInstallSync` hook** (`src/hooks/useSteamInstallSync.ts`) bridges tracker → download queue:
  - `onAny()` callback listens to all tracker events
  - `opening-steam` → adds `addSteamInstallJob(appId, title)` to queue with `status="waiting"`
  - `waiting` with `downloadProgress.percent > 0` → switches to `status="downloading"`, `progressMode="determinate"`, displays real %
  - `waiting` without progress → keeps `status="waiting"`, `progressMode="indeterminate"`, updates message ("Starting…" or "Waiting for Steam…")
  - `installed` → marks `status="done"`, `progress=100`, `message="Installed · Ready to play"`
  - `timeout` → marks `status="failed"`, error "Timeout waiting for Steam to begin downloading."
  - `dismissed` → removes job from queue
- Mounted in `DownloadQueueProvider` via stable `syncRef` pattern — never duplicates `onAny` listener

### Part 3 — Real percentage (observational, determinate when available)
- `checkSteamGameInstalled` Rust command already returns `downloadProgress: { bytesDownloaded, bytesToDownload, percent }` from appmanifest fields
- When `percent > 0 && bytesToDownload > 0`: `progressMode="determinate"` with real percentage
- When unavailable: `progressMode="indeterminate"` using existing `lf-launch-bar` CSS animation (`lf-progress-indeterminate` keyframe)
- No fake percentages ever

### Part 4 — Lua/ZIP/Manifest integration
- `DownloadQueueContext` already handles these via `addJob()` with `fileType`
- `InstallerProgressListener.tsx` listens to Tauri `installer-progress` events and updates jobs
- No changes to the existing package download flow — UI shows both Steam installs and package downloads in the same unified queue

### Part 5 — UI redesign
- **`Downloads.tsx`**: Premium layout with header badge, subtitle, 4-column stats (Active/Queued/Completed/Failed), collapsible completed section with "Limpiar" button, improved empty state with "Explorar biblioteca" link
- **`DownloadJobCard.tsx`**: Unified card supporting both Steam and package items:
  - Shows game artwork when `artworkUrl` available (Steam installs), file-type icon otherwise
  - Provider badge: Steam (blue), Lua (purple), ZIP (amber), Manifest (cyan)
  - Status message below title
  - Determinate or indeterminate progress bar
  - Stats row: downloaded bytes, speed (if available), ETA (if available), installation status
  - Active Steam installs show "Open Steam" action link
  - Cancel active jobs, remove completed jobs
  - Error display
- **`DownloadProgressBar.tsx`**: Supports both `determinate` (percentage + width bar) and `indeterminate` (animated `lf-launch-bar` shimmer)
- **`DownloadStatusBadge.tsx`**: Added `waiting` (amber/clock) and `paused` (zinc/pause) statuses
- All styling uses existing theme variables — compatible with all themes (OLED/Midnight/Crimson/Steam Gray)

### Part 6 — State persistence
- Package downloads persisted to localStorage via existing `DownloadQueueContext`
- Steam install items use a **stable job ID** (`steam-install-<appId>`) — single job per appId, replaces previous terminal jobs
- On app reload, active jobs (including Steam) are marked `failed` with clear message — no fake active items
- Completed items persist until "Limpiar" is clicked
- Failed items persist until dismissed

### Part 7 — Sidebar/library update (already works)
- Steam installs already trigger the `onInstalled` handler in `LibraryGamesContext.tsx` — the real installed pipeline (from the previous session) re-ingests via `checkSteamGameInstalled`, persists to all layers
- Sidebar, library grid, and game details update via React re-render from `useLibraryGames()` context
- No additional work needed — the Downloads page is observational only

### Key Files Changed
- `src/types/download.ts` — Extended `DownloadJob` with `type`, `progressMode`, `speedBytesPerSec`, `etaSeconds`, `message`, `artworkUrl`, `parentId`; added `waiting`/`paused` to `DownloadStatus`
- `src/context/DownloadQueueContext.tsx` — `addSteamInstallJob()`, `getJobByAppId()`, migration in `loadJobs()`, extended `UpdateDownloadJobInput`, `useSteamInstallSync` mount
- `src/hooks/useSteamInstallSync.ts` — **new** — bridges `installTrackerService` → `DownloadQueueContext`
- `src/components/downloads/DownloadProgressBar.tsx` — Added `mode` prop for determinate/indeterminate
- `src/components/downloads/DownloadStatusBadge.tsx` — Added `waiting`/`paused` statuses
- `src/components/downloads/DownloadJobCard.tsx` — Redesigned as unified card (Steam artwork, provider badge, speed/ETA, Open Steam action)
- `src/pages/Downloads.tsx` — Redesigned with premium layout, 4-column stats, collapsible completed, empty state with link

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (no errors)
- `cargo check` ✅ (no Rust changes)
