## Session � Torrent stall/resume/file-lock fixes (stuck old download + locked folder)

### Problem
1. Launcher stuck on an old torrent download ("little-big-adventure-...-fitgirl") that never finished and blocked starting new downloads.
2. Corrupt files could not be deleted until the launcher closed (file lock).

### Root causes
- **C1**: The metadata stall guard only applied to \Initializing\. Once metadata resolved with no seeds/peers, the poll loop spun at pct 0 emitting nothing until \TORRENT_MAX_WAIT_SECS\ (6h) � job stuck in "downloading" forever with no TS poller to cancel it.
- **C2**: librqbit session is process-lifetime (\TORRENT_SESSION\/\ACTIVE_TORRENTS\ OnceLock); persistent dir \<appData>/librqbit\ with fastresume + JSON restores old torrents on boot, which resume downloading in the background with no TS job tracking them.
- **C3**: Torrents remaining in the session hold open file handles on Windows, blocking folder deletion until the launcher closes. The Paused path (\session.pause\) kept the torrent in the session too.

### Fixes (torrent.rs)
- **Fix 1 � data-stall guard**: new \TORRENT_DATA_STALL_SECS = 2 * 60\, generic \stall_exceeded(first_seen, threshold_secs)\ + \metadata_stall_exceeded\/\data_stall_exceeded\ wrappers. \poll_torrent_until_done\ tracks \data_stalled: Option<Instant>\, reset when \stats.progress_bytes\ advances, \Err("No download progress (no seeds/peers).")\ after 2 min without new bytes in the non-Initializing branch. A download producing bytes is never cut; \metadata_stalled\ clears as soon as the state leaves Initializing.
- **Fix 2 � restored-torrent sweep**: \sweep_restored_torrents(session)\ called in \get_session\ right after session creation. A fresh process has empty \ctive_torrents()\, so every torrent librqbit restored from persistence belongs to a PREVIOUS session � they are deleted with \session.delete(id, false)\ (files kept on disk; only the session reference + file handles released). Download queue is the source of truth; an explicit resume re-adds its magnet below.
- **Fix 3 � release handles on pause**: \PollOutcome::Paused\ path now \session.delete(torrent.id(), false)\ + \ctive_torrents().remove(&job_id)\ instead of \session.pause\. Partial data + fastresume stay on disk; resume re-adds the magnet via \start_torrent_download\ and librqbit reuses existing files (piece verification on add).
- **Fix 4 � verified**: \startInstall\ catch in \useDebridInstallSync.ts\ already marks the job \"failed"\ when \start_torrent_download\ returns \Err\ (stall ? job fails, no eternal "downloading"); Rust \Err\ branch already cleans partial files + removes from \ACTIVE_TORRENTS\.

### Tests
- 3 new regression tests in \	orrent.rs\: \data_stall_below/at/over_threshold\ (parity with the existing metadata-stall tests). 20 torrent tests total.
- Full suite: **213 passed / 0 failed** (210 previos + 3 nuevos).

### Build
- \cargo check\ ? (only 2 pre-existing dead-code warnings: \HydraSourceList\, \DebridProviderConfig\)
- \cargo test\ ? 213 passed / 0 failed
- \	sc --noEmit\ ? (only the 22 pre-existing extension/test errors, none in touched files)
- \ite build\ ?? skipped (no TS changes)
