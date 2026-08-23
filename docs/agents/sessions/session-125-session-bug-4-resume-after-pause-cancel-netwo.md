## Session — Bug 4: resume after pause/cancel/network-cut corrupts `.part` files

### Problem
A Debrid repack download paused/cancelled/hit a network-cut mid-chunk left a `.part` file that, on resume, reassembled the file with corruption (gap/wrong offset). The corruption came from `.part` being dropped WITHOUT truncating to the acknowledged byte count.

### Root cause
- The download loop writes each chunk via `file.write_all(&chunk)` and only then bumps `bytes_read += chunk.len()`. A `write_all` that FAILS PARTIALLY (or a stream-error path) can leave the on-disk `.part` LONGER than `bytes_read`.
- The cancel/pause/stream-error/write-error exit branches all did `drop(file)` + `write_checkpoint(bytes_read, ...)` WITHOUT truncating the file first — so the on-disk part size diverged from the checkpointed offset. `load_checkpoint` uses the on-disk `.part` size as authoritative, so a resume from that stale length re-fetched bytes starting at the wrong position → corrupted output.
- The write-error path used a `map_err(|e| { write_checkpoint(...); format!(...) })` closure, which cannot `await` a truncation — it checkpointed with a file that might still hold an oversized tail.

### Fix (`src-tauri/src/commands/debrid_installer.rs`)
- **New `truncate_part_to(file, bytes_read)`** async helper: `flush()` then `set_len(bytes_read)` but ONLY when `meta.len() > bytes_read` (shrink-only — never extends, so a larger `bytes_read` can't insert a zero-gap on resume). Placed just before `decide_resume`.
- **Cancel branch** (in-loop): `truncate_part_to` → `write_checkpoint` → `drop(file)` → `Err`.
- **Pause branch** (in-loop): `truncate_part_to` → `write_checkpoint` → `drop(file)` → `Ok(DownloadFileOutcome::Paused)`.
- **Stream-error branch** (chunk read failure): `truncate_part_to` before `write_checkpoint` so the retry/backoff path resumes from a size consistent with the checkpoint.
- **Write-error path** restructured from `map_err` closure into a `if let Err(e) = file.write_all(&chunk).await { truncate_part_to(...); write_checkpoint(...); return Err(...) }` so truncation can `await` before checkpointing.
- The HTTP-416 and FreshStart branches already delete part+meta and restart from zero — unchanged.

### Regression tests (4 new in `debrid_installer::tests`)
- `truncate_part_shrinks_to_acknowledged_bytes` — file 8192B, `bytes_read` 4096 → on-disk becomes 4096 (the exact corruption case).
- `truncate_part_noop_when_aligned` — on-disk == `bytes_read` → unchanged.
- `truncate_part_never_extends` — `bytes_read` > on-disk → file NOT extended (guards the zero-gap corruption).
- `truncate_part_missing_file_no_panic` — newly created empty file truncates to 0, no panic.

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ✅ **218 passed / 0 failed** (214 previos + 4 nuevos)
- `tsc --noEmit` ✅ (only the 22 pre-existing extension/test errors, none in touched files)
- `vite build` ⏭️ skipped (no TS changes)
