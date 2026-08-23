## Session — Torrent metadata-fetch timeout (endless "Connecting to torrent swarm...")

### Problem
A dead/swarmless magnet (FitGirl/DODI repack with no reachable peers, or blocked DHT ports) left the job stuck forever on "Connecting to torrent swarm...". The previous metadata-stall guard (3-min) never fired for this case.

### Root cause
`add_torrent().await` (magnet without embedded info dict) is UNBOUNDED inside librqbit: `add_torrent` to `add_torrent_internal` (`metadata: None`) to `resolve_magnet` to `read_metainfo_from_peer_receiver` (dht_utils.rs:30), which blocks until a peer delivers the info-hash metadata OR the peer-address stream ends. With DHT enabled (our default — `SessionOptions` derives `Default` with `disable_dht: false`), that stream stays open forever (DHT keeps discovering peers), so individual peer connect failures never terminate the loop. The poll-loop metadata-stall guard (`torrent.rs:376`) runs only AFTER `add_torrent` returns — it never got the chance.

### Fix (`src-tauri/src/commands/torrent.rs`)
- Wrapped the `session.add_torrent(...)` call in `tokio::time::timeout(Duration::from_secs(TORRENT_METADATA_STALL_SECS), ...)` — the same 3-min budget the poll-loop connect guard uses, so BOTH phases are bounded identically.
- On timeout: logs `[TORRENT][METADATA_TIMEOUT] job_id=... no swarm metadata after 180s`, emits `emit_installer_progress(..., "failed", ..., "Could not connect to torrent swarm (no peers/seeds).")`, and returns `Err("Could not connect to torrent swarm (no peers/seeds).")` — the TS `startInstall` catch already marks the job failed on command `Err`.
- No cleanup needed on timeout: the torrent is only inserted into `active_torrents()` (and registered in the session) after `add_torrent` returns; dropping the timed-out future leaves no orphaned ManagedTorrent. Lingering DHT info-hash lookups are harmless (keyed by hash, never registered).
- `Duration`/`tokio::time::timeout` were already used in this file — no new imports.

### Regression test (torrent.rs)
- `add_metadata_timeout_reuses_connect_guard_budget` — asserts `TORRENT_METADATA_STALL_SECS == 180` and that it is 60s longer than `TORRENT_DATA_STALL_SECS`, guarding the invariant that the add-phase budget mirrors the poll-loop connect budget.

### Build
- `cargo check` (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` 214 passed / 0 failed (213 previos + 1 nuevo; 15 torrent tests total)
- `tsc --noEmit` skipped (no TS changes)
- `vite build` skipped (no TS changes)
