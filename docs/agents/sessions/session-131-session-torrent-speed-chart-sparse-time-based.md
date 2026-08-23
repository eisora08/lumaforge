## Session - Torrent speed chart sparse: time-based progress emits + fixed slot-grid SpeedChart

### Problem
The Downloads page speed chart looked nearly empty for FitGirl-style repacks. Root cause was double:

1. **Sparse event cadence (torrent path)**: `SpeedChart` renders exactly `values.length` bars (`display = values.slice(-barCount)`), and `values` = `speedHistory` sampled once per `installer-progress` event that carries a changed `bytesRead` (`useActiveDownload.ts:119-130`). The torrent poll loop emitted progress ONLY on percent change (`pct != last_pct`), so a 30 GB repack at ~10 MB/s moved 1% every ~30s -> ~2 bars/min -> chart mostly blank. HTTP/debrid emits every 250ms (throttle in `debrid_installer.rs`), so it always looked dense.
2. **Chart rendered variable-length**: no placeholders, so young/fast downloads and the torrent path left a huge blank area on the right.

### Part 1 - Time-based torrent progress emits (`src-tauri/src/commands/torrent.rs`)
- New `TORRENT_PROGRESS_EMIT_SECS: u64 = 1` constant (next to `TORRENT_DATA_STALL_SECS`).
- Pure helper `progress_emit_due(last_pct, pct, elapsed_secs, throttle_secs) -> bool` - emits when the percent changed OR the throttle window elapsed (same budget the stall guards use).
- Poll loop: added `let mut last_emit: Option<Instant> = None;`; the downloading branch now computes `emit_due` from `last_emit.elapsed()` and emits when `pct != last_pct || due`, updating both `last_pct` and `last_emit = Some(Instant::now())`.
- `Initializing` branch untouched (still emits once at pct 0).
- 4 new regression tests: percent-change, throttle-elapsed, unchanged-within-throttle, first-real-percent (last_pct=-1 -> due).

### Part 2 - Fixed slot-grid SpeedChart (`src/components/downloads/ActiveDownloadCard.tsx`)
- `SpeedChart` now always renders exactly `barCount` slots (24 / 18 / 12 responsive): real samples left-aligned, trailing slots are zero-height placeholders (`bg-white/10`, `height: 0%`, key `empty-${n}`) that occupy width+gap so the chart always spans full width and visibly fills left -> right as samples arrive.
- Newest real bar still gets the `new-${values.length}` key + slide-in animation; grow-on-mount (`useGrowOnMount`) and `lf-download-chart-frozen`/pulse empty-state preserved.
- Tooltip now positions over the fixed grid: `left: ((hovered + 0.5) / barCount) * 100%` and only shows for slots with a real value.

### Not changed
- HTTP/debrid path, sample ring buffer, `useActiveDownload`, `InstallerProgressListener`, `DownloadQueueContext`.

### Build
- `cargo test` ? **241 passed / 0 failed** (237 previos + 4 nuevos; first attempt had a wrong test - `progress_emit_due_first_emit_is_due` passed `pct=-1` == last_pct -> false; fixed to `first_real_percent` with `pct=0` -> true)
- `cargo check` ? (only 2 pre-existing dead-code warnings)
- `tsc --noEmit` ? (only pre-existing extension/test errors, none in touched files)
- `vite build` ? (2.66s, Rolldown; verified in bundle: slot array with null placeholders, `empty-${n}` key + `bg-white/10` at `height:0%`, tooltip `(o+.5)/i*100`)
