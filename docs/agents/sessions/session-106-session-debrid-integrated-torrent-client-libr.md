## Session — Debrid integrated torrent client (librqbit) + 3-way install method choice

### Goal
Add a built-in torrent path for Debrid repack installs: when the source is a magnet (FitGirl/DODI), let the user pick "direct download" | "resolve via Debrid provider" | "download with the integrated torrent client" (librqbit). Rust command returns the same `DebridDownloadResult` so the TS pipeline contract is unchanged.

### Rust
- **`Cargo.toml`**: `librqbit = "8"` (vendored native client — no external binary) + `dashmap = "6"` (declared explicitly; was already transitive).
- **`src-tauri/src/commands/torrent.rs`** (**new**; `pub mod torrent` in commands/mod.rs; registered in lib.rs):
  - `start_torrent_download(job_id, magnet, dest_dir)` Tauri command returning `DebridDownloadResult`.
  - `Session::new_with_opts(PathBuf, SessionOptions)` — `disable_dht: false` (real swarm), `disable_dht_persistence: true`, `defer_writes_up_to: None`, fastresume + persistence on.
  - `AddTorrent::from_url(magnet)` (Cow<String>) → `add_torrent` → `AddTorrentResponse::into_handle()` → `ManagedTorrent`.
  - Poll `handle.stats()` every 1s (max ~10 min) emitting `emit_installer_progress` (status `"downloading"`, %, bytes). `TorrentStatsState` has no `PartialEq` → `matches!()` comparison. On `Error` state read `stats.error`.
  - Cancellation reuses the SAME `OnceLock<Mutex<HashSet<String>>>` as `cancel_debrid_download`/`is_job_cancelled` in `debrid_installer.rs` — existing cancel command works for torrents, no new binding.
  - Completion → `session.delete(id, false)` (drop torrent, keep files) → post-process via `debrid_installer.rs` helpers (all made `pub(crate)`): `auto_run_installer`, `extract_rar_with_unrar`, `extract_rar_with_cli`, `flatten_single_root_folder`, `extract_rar_via_7z`, `extract_zip_with_zip_crate`, `find_largest_exe`.
- **`debrid_installer.rs`**: 11 helpers + `cancelled_jobs()` accessor made `pub(crate)`. No behavior changes.
- `cargo check` ✅ (only 2 pre-existing dead-code warnings).

### TS
- **`src/services/tauri.ts`**: `startTorrentDownload({ jobId, magnet, destDir })` → invoke `"start_torrent_download"` → `Promise<DebridDownloadResult>`.
- **`src/services/debridInstallChoice.ts`**: `DebridInstallMethod = "direct" | "debrid" | "torrent"`; `DebridInstallResolution = { ok: true; uri; method } | { ok: false; reason }`.
  - `resolveDebridInstallUri(uris, confirm, title)`: direct+magnet both present → 3-way dialog; magnet-only → debrid (unchanged auto path); direct-only → "direct"; none → `{ ok:false, reason:"no-uri" }`.
  - Dialog labels: primary "Descarga directa" (`"direct"`), secondary "Resolver con Debrid" (`"debrid"`), tertiary "Descargar vía torrent" (`"torrent"`).
- **`src/services/confirmService.tsx`**: `ConfirmOptions` + `ConfirmResult` gain `tertiaryLabel`/`tertiaryVariant`/`tertiary?`; `handleTertiary`.
- **`src/components/common/ConfirmModal.tsx`**: `tertiaryLabel`/`onTertiary`/`tertiaryVariant` props; tertiary button in the `.mr-auto` action group.
- **`src/types/download.ts`**: `installMethod?: DebridInstallMethod` on `DownloadJob` (after `repacker`).
- **`src/context/DownloadQueueContext.tsx`**: `addDebridInstallJob(providerGameId, title, downloadUri, installerType, appId?, artworkUrl?, repacker?, installMethod?)`; job carries `installMethod`; `startInstall(..., installMethod?)` forwards it.
- **`src/hooks/useDebridInstallSync.ts`**: `startInstall` — `installMethod === "torrent"` → `startTorrentDownload({ jobId, magnet: downloadUri, destDir })` (skips `resolveInstallUri`); else → `resolveInstallUri` + `downloadDebridPackage` (previous behavior).
- **Call sites (8)** pass `resolved.method`: `DebridCatalogSection.tsx`, `LibraryGameDetailPage.tsx` (×3 incl. `DebridSourceSelectorModal`), `Library.tsx` (×3 incl. modal), `StoreGameDetailsPage.tsx`. Console Mode (`consoleGameActions.ts`) uses `pickInstallUriWithoutDialog` + own `addJob` — out of scope, unchanged.

### Decisions
- `DEBRID_TORRENT_ENABLED` kill-switch documented; torrent is a dialog *option*, not the default — debrid providers stay primary when configured.
- `start_torrent_download` is a long-running Tauri command (poll loop on its own thread) — returns only after completion + post-process, same contract as `download_debrid_package`.
- **Reachability note**: torrent only appears when an entry has BOTH a direct URI and a magnet URI. Magnet-only repacks (the typical FitGirl/DODI case) still auto-resolve via the configured debrid provider without a dialog — a future follow-up can offer torrent as fallback when debrid resolution fails or no provider is configured.

### Key Files Changed
- `src-tauri/Cargo.toml` — `librqbit = "8"` + `dashmap = "6"`
- `src-tauri/src/commands/torrent.rs` — **new** — `start_torrent_download` (session init, add_torrent, poll+progress, cancel, post-process)
- `src-tauri/src/commands/mod.rs` + `src-tauri/src/lib.rs` — module + command registration
- `src-tauri/src/commands/debrid_installer.rs` — helpers `pub(crate)` + `cancelled_jobs()`
- `src/services/tauri.ts` — `startTorrentDownload` binding
- `src/services/debridInstallChoice.ts` — `DebridInstallMethod`, `method` on resolution, 3-way `resolveDebridInstallUri`
- `src/services/confirmService.tsx` + `src/components/common/ConfirmModal.tsx` — tertiary button support
- `src/types/download.ts` + `src/context/DownloadQueueContext.tsx` — `installMethod` on job, threaded through `addDebridInstallJob`/`startInstall`
- `src/hooks/useDebridInstallSync.ts` — torrent branch in `startInstall`
- `src/components/store/DebridCatalogSection.tsx`, `src/pages/LibraryGameDetailPage.tsx`, `src/pages/Library.tsx`, `src/components/store/StoreGameDetailsPage.tsx` — 8 call sites pass `resolved.method`

### Build
- `cargo check` ✅ (0 errors; 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.53s, Rolldown; verified in bundle: `start_torrent_download` invoke string, "Descargar vía torrent" tertiary label, `installMethod` field)
