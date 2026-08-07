## Session — Premium Downloads redesign: ActiveDownloadCard hero + live speed chart + mock

### Goal
Redesign the Downloads page into a premium launcher-style dashboard (INZOI reference): `ActiveDownloadCard` hero with game artwork, thick white progress bar, glass Pause/Cancel buttons, a glassmorphism stats panel (RED/PICO/SEEDS/PEERS + "Torrent" badge), and a live speed bar chart fed from a TS ring buffer. Completed/failed cards also restyled to glass premium.

### Scope decisions (user-confirmed)
- Full scope: component + dev mock + real wiring. Seeds/peers hidden when not applicable (no Rust changes — deferred to future follow-up).
- Completed/failed card rows also redesigned to glass premium.

### Part 1: `src/hooks/useActiveDownload.ts` (new)
- `ActiveDownload` type: `{ id, appId, gameName, coverImageUrl?, downloadedBytes, totalBytes, percentage, timeRemaining?, status, currentSpeedBytes?, peakSpeedBytes?, seeds?, peers?, isTorrent, isSteam, isDebrid, repacker?, speedHistory: number[], progressMode, message? }`.
- Module-level ring buffer `_samplesByJob: Map<string, {t, bytes}[]>` (cap `MAX_RAW_SAMPLES = 200`; entry deleted on terminal states `done/failed/cancelled`).
- `useActiveDownload(job)` — `useMemo` per `job`; `speedHistory` = last 40 deltas `Δbytes/Δt`; `currentSpeed` from `job.speedBytesPerSec` if > 0 else last sample; `peakSpeed` = buffer max; `timeRemaining = "en ${formatEtaLong((total-read)/speed)}"`; `percentage = (downloaded/total)*100` or `job.progress`; `isTorrent = job.installMethod === "torrent"`; seeds/peers stay `undefined`.
- Exported helpers: `formatBytes`, `formatSpeed`, `formatEtaLong` (`d h` / `h m` / `m s`).
- `resolveDisplayTitle` reads `getBootSnapshot().library.games` (Steam gameTitle is numeric); `resolveCoverUrl` uses `artworkUrl` or `localPathToUrl(media.landscapePath || coverPath || backgroundPath)` for `steam-install`.
- `MOCK_ACTIVE_DOWNLOAD` (dev): Cuphead 268910, 12.1/28.6 GB via `1024**3`, 42.43%, "en 1 día", 3.4 MB/s, peak 8.7 MB/s, seeds 39/peers 45, isTorrent, `speedHistory` ~40 sinusoid+noise values, repacker "SteamRip".

### Part 2: `src/components/downloads/ActiveDownloadCard.tsx` (new)
- Presentational `ActiveDownloadCardProps { download, onPause?, onResume?, onCancel? }`; `imgFailed` state → degraded `bg-(--color-bg)` fallback.
- Hero: full-width with `brightness(0.3)` + dark overlay; large white title; "12.1 GB / 28.6 GB · en 1 día"; big percentage right ("42.43%"); bar `h-2.5 rounded-full bg-white/25` + fill `bg-white`; 2 dark glass buttons `bg-black/50 backdrop-blur rounded-full` (Pausar = pause icon, Cancelar = circle-X).
- Stats panel `rounded-2xl border-white/10 bg-black/30 backdrop-blur-xl`: RED (down arrow), PICO (chart icon), "SEEDS: 39 · PEERS: 45" (hidden when undefined), "Torrent" label bottom-left only if `isTorrent`.
- Speed chart ~40 bars `flex-1 rounded-t bg-linear-to-t from-white/20 to-white/70`, `height: (v/max)*100 + "%"`, `transition-[height] duration-300 ease-out`.
- `canPause = isDebrid && status !== "paused" && CANCELLABLE`, `canResume = isDebrid && status === "paused"`, `canCancel = CANCELLABLE` (queued/waiting/checking/downloading/extracting/installing/paused); "Open Steam" (`steam://install/${appId}`) only if `isSteam && (waiting || downloading)`; `StatRow` `text-[10px] uppercase tracking-[0.16em] text-white/50`; indeterminate → `animate-pulse bg-white/70` bar.
- Correct nested HTML (article → divs → p; no `<p>` wrapping divs).

### Part 3: `src/pages/Downloads.tsx` wiring
- `ActiveDownloadRow` subcomponent (component-level, needed for hooks in `.map`) → `useActiveDownload(job)` → `ActiveDownloadCard`.
- Active jobs no longer use `DownloadJobCard`. Dev mock rendered above everything under "Vista previa (mock)" via `import.meta.env.DEV` (stripped from prod bundle).

### Part 4: `DownloadJobCard.tsx` completed/failed glass restyle
- Debrid-done, Steam-done, and generic branches: `lf-surface` → `rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/70 p-4 backdrop-blur-md`; artwork `h-14 w-14 rounded-xl` → `h-16 w-16 rounded-2xl`.

### No Rust changes (user decision)
- Future follow-up documented: extend `InstallProgressEvent` + `torrent.rs` reading `stats.live.snapshot.peer_stats.live` from librqbit 8.1.1 for real seeds/peers.

### Key Files Changed
- `src/hooks/useActiveDownload.ts` — **new** — `ActiveDownload` type, `useActiveDownload`, ring buffer, format helpers, `MOCK_ACTIVE_DOWNLOAD`
- `src/components/downloads/ActiveDownloadCard.tsx` — **new** — premium hero + stats panel + speed chart
- `src/pages/Downloads.tsx` — imports, dev mock preview, `ActiveDownloadRow` subcomponent, active map → `ActiveDownloadCard`
- `src/components/downloads/DownloadJobCard.tsx` — completed/failed branches → glass premium

### Build
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (1.85s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings; verified "SEEDS:"/"PICO"/"RED" + "Torrent" in bundle; "Vista previa" correctly absent from prod via `import.meta.env.DEV`)
- `cargo check` ⏭️ skipped (no Rust changes)
