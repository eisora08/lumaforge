## Session — Debrid: native appId/title persistence + auto artwork refresh (Parts A–D+F)
### Goal
Make a Debrid-installed repack game feel "native" in the Library desktop grid + detail by persisting the clean Steam `title` and a valid numeric `appId` onto the Debrid store entry, and auto-materializing Steam artwork after install. All media/title surfaces are keyed by `appId` (Steam) with no source filter, so persisting the appId unlocks the whole appInfo/media pipeline automatically.

### Part A: Thread appId through the Debrid install flow (`useDebridInstallSync.ts`)
- `persistDebridIdentity(providerGameId, title, appId?)` — module helper: `updateDebridGameAppId(String(num))` when `Number.isInteger(num) && num > 0`; `updateDebridGameTitle(title)` when non-empty and not placeholder (`/^Steam App \d+$/`); then `queueNativeArtworkRefresh` when valid appId.
- `queueNativeArtworkRefresh(appId?)` — dynamic `import("../services/gameCacheService").detectAndQueueMissingMedia(validAppId, "refresh-artwork")`. `"refresh-artwork"` is a MANUAL_ARTWORK_SOURCE (gameCacheService.ts:1688) which passes the emergency-stabilization gate (L1845: `isManualArtworkSource`), so it runs despite `AUTO_MEDIA_REPAIR_GLOBAL=false`. It checks disk, resolves Steam metadata + SGDB, and queues `enqueueMediaDownload` (low priority, `target:"canonical"`) per missing of the 5 roles → writes `games/steam/<appId>/media/`.
- `startInstall` (DebridInstallHandle type + body) gained optional `appId?: string` param; forwarded to `handleInstallResult`.
- `pollInstallerUntilDone(pid, installDir, jobId, providerGameId, title, appId?)` — calls `persistDebridIdentity` on the `ready` success path and the registry-detect success path; passes `appId` in the `setPendingCompletionNeedsPath(..., { title, appId })` extras (both needs-path modal and timeout paths).
- `handleInstallResult(..., appId?)` — `persistDebridIdentity` in the `ready`, `installing` (early, right after `markDebridGameInstalling`), and `needs-setup` branches; `markDebridGameExtracted` extras gain `appId`.

### Part B: persist appId + forward on resume (`DownloadQueueContext.tsx`)
- `addDebridInstallJob` already persisted `job.appId`/`job.gameTitle`; the `startInstall` invocation (line 278) now appends `job.appId` as the new final arg.
- `resumeJob` reforward now also passes `job.appId` (line 368).
- No `addDebridInstallJob` signature change — `appId` was already the 5th param.

### Part C: clean title at the Store call site (`StoreGameDetailsPage.tsx`)
- `handleInstallRepack` passes `getTitle(game, metadata)` instead of `entry.title` (metadata is in component scope as a prop); added `metadata?.name` to the useCallback deps. Toast still shows the descriptive `entry.title`.

### Why it works now
- `appId` and `title` persist on the Debrid entry (`updateDebridGameAppId` trims and survives catalog refresh + restart via `debrid-games.json`), so the Library grid/detail resolve `appId`-keyed appInfo + media. The artwork refresh (Part F) materializes the Steam media on install completion without requiring the user to open the detail page.

### Key Files Changed
- `src/hooks/useDebridInstallSync.ts` — `persistDebridIdentity`, `queueNativeArtworkRefresh`, `appId` threading through startInstall/handleInstallResult/pollInstalledForDone, `appId` in needs-path extras
- `src/context/DownloadQueueContext.tsx` — startInstall + resumeJob reforward `job.appId`
- `src/components/store/StoreGameDetailsPage.tsx` — `getTitle(game, metadata)` at install call, deps

### Build
- `tsc --noEmit` ✅ (only the 22 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.04s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings; verified `useDebridGameAppId`/`updateDebridGameTitle`/`refresh-artwork`/`detectAndQueueMissingMedia` in bundle)
