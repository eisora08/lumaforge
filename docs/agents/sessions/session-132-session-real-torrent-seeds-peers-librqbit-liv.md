## Session - Real torrent seeds/peers (librqbit live snapshot) on the Active Download Card

### Goal
Replace the mocked seeds/peers on the Downloads hero with real swarm stats read from the librqbit session (`per_peer_stats_snapshot`), using a new dedicated `"installer-network"` Tauri event so the progress emit path stays untouched.

### Model
- **PEERS** = connected live peers (`snap.peers.len()`); **SEEDS** = live peers serving data (`counters.downloaded_and_checked_pieces > 0`).
- `PeerStatsFilter` is `Default` -> `PeerStatsFilterState::Live`, so `torrent.live()?.per_peer_stats_snapshot(Default::default())` reads the live registry without naming unexported filter types.

### Rust
- `src-tauri/src/models/install_progress.rs` — `InstallerNetworkEvent { job_id: String, peers: u32, seeds: u32 }` (Clone + Serialize).
- `src-tauri/src/utils/progress_utils.rs` — `emit_installer_network(app_handle, job_id, peers, seeds)` emits `"installer-network"`; `emit_installer_progress` signature unchanged (46 existing call sites).
- `src-tauri/src/commands/torrent.rs` — in `poll_torrent_until_done` downloading branch, inside the existing `if emit_due { ... }` (~1s throttle), computes `(peers, seeds)` via `torrent.live().map(...).unwrap_or((0,0))` and emits after the progress emit. Noise gated by the same cadence; `live()` is cheap (borrows peer registry).

### TS
- `src/types/download.ts` — `InstallerNetworkEvent { job_id, peers, seeds }` type; `peers?: number` / `seeds?: number` added to `DownloadJob` (backward compatible).
- `src/context/DownloadQueueContext.tsx` — `UpdateDownloadJobInput` gains `peers?`/`seeds?` (fixes the TS2353 from the listener passing unknown props).
- `src/components/downloads/InstallerProgressListener.tsx` — second Tauri listener for `"installer-network"` calling `updateJob(payload.job_id, { peers, seeds })`; separate `unlistenProgress`/`unlistenNetwork` cleanup.
- `src/hooks/useActiveDownload.ts` — `ActiveDownload` gains `peers?`/`seeds?`, mapped from `job.peers`/`job.seeds`.
- `src/components/downloads/ActiveDownloadCard.tsx` — Zone C swarm stats block (Seeds/Peers, tabular-nums, `"—"` fallback) between the speed chart and the controls, gated by `download.isTorrent && (download.peers != null || download.seeds != null)`.

### Build
- `cargo test --lib torrent` ? **28 passed / 0 failed** (torrent module)
- `cargo check` ? (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `tsc --noEmit` ? (zero errors in touched files; only pre-existing extension/test errors remain)
- `vite build` ? (2.43s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
