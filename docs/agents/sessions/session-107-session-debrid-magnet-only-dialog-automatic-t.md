## Session — Debrid: magnet-only dialog + automatic torrent fallback + metadata stall-detector

### Goal
Close the reachability gaps in the Debrid install flow: (1) magnet-only repacks (the typical FitGirl/DODI case) now show the method dialog instead of silently using debrid, (2) if Debrid resolution fails the install falls back to the built-in torrent client so the download always proceeds, and (3) the torrent connect phase stops after ~3 min without peers instead of hanging forever.

### Part 1: Magnet-only dialog (`debridInstallChoice.ts`)
- `resolveDebridInstallUri` restructured: `direct && magnet` → 3-way dialog (unchanged); `magnet` only → new 2-way dialog ("Resolver con Debrid" primary / "Descargar vía torrent" tertiary / Cancelar); `direct` only → no dialog.
- Mapping: `tertiary` → `"torrent"`, `confirmed`/`secondary` → `"debrid"`, else cancelled. Direct-only remains `"direct"` without a dialog.
- Header doc comment updated ("only one kind present → no dialog" no longer applies to magnet-only).
- `pickInstallUriWithoutDialog` unchanged — Console Mode still bypasses the dialog.

### Part 2: Automatic torrent fallback (`useDebridInstallSync.ts`)
- `startInstall` else-branch: `resolveInstallUri(downloadUri)` wrapped in try/catch. On resolution failure for a `magnet:` URI → logs `[DEBRID_INSTALL] debrid-resolve-failed reason=<msg> → torrent fallback jobId=<id>` and calls `startTorrentDownload({ jobId, magnet: downloadUri, destDir })`. Non-magnet URIs rethrow (can't meaningfully fail).
- Result handling extracted into a shared `handleInstallResult(result, providerGameId, jobId, title)` helper so the fallback path and the debrid/torrent path converge on the same `ready`/`installing`/`needs-setup`/failed handling.
- `result` typed `DebridDownloadResult | null` (guard `if (result)`) to satisfy TS definite-assignment across the try/catch rethrow.
- `resolveInstallUri` doc comment updated — the "raw magnet can never be downloaded" note is superseded by the torrent fallback.

### Part 3: Metadata stall-detector (`torrent.rs`)
- New `TORRENT_METADATA_STALL_SECS: u64 = 3 * 60` + pure helper `metadata_stall_exceeded(first_seen, threshold)`.
- In `poll_torrent_until_done`, `metadata_stalled: Option<Instant>` is set on the first `Initializing` observation; when elapsed exceeds the threshold → `Err("Could not connect to torrent swarm (no peers/seeds).")`.
- The stall guard resets to `None` as soon as the state leaves `Initializing` (bytes flowing) — a large in-progress download is never cut; `TORRENT_MAX_WAIT_SECS = 6h` still caps the full download.

### Key Files Changed
- `src/services/debridInstallChoice.ts` — magnet-only dialog branch, doc update
- `src/hooks/useDebridInstallSync.ts` — torrent fallback in `startInstall`, extracted `handleInstallResult`, `DebridDownloadResult | null` guard
- `src-tauri/src/commands/torrent.rs` — `TORRENT_METADATA_STALL_SECS`, `metadata_stall_exceeded`, stall tracking in poll loop

### Build
- `cargo test` ✅ (174 passed / 0 failed; 3 new torrent stall tests)
- `cargo check` ✅ (0 errors; 2 pre-existing dead-code warnings)
- `tsc --noEmit` ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings + chunk-size warning)
