## Session — Debrid: gofile resume via stable source_key + never trust partial files

### Problem
1. **Resume never resumes (Bug 1)**: `download_debrid_package` re-resolved `resolve_gofile_url` on EVERY call (fresh CDN link each time). `load_checkpoint` compared `cp.uri != uri`, so the newly-rotated CDN link never matched the checkpoint → `.part`/`.part.meta` discarded → `resume_from = 0` → the saved progress was never used. The user's whole point of "continue from the saved progress after relaunch" was silently broken.
2. **Corrupt data trusted (Bug 3 gate)**: Step 0 short-circuited to "already extracted" when `find_installer_exe_*` found ANY exe in `dest_dir`, and `download_file_to_dest` short-circuited "already downloaded" whenever `dest_path` existed with `len > 0`. A leftover `.part` renamed to final (or a partial extraction) was treated as good → setup auto-ran on corrupt files.

### Part 1 — Fix A: checkpoint keyed on stable `source_key`
- `download_debrid_package` (Rust) gained `source_key: Option<String>` param; `checkpoint_key = source_key.unwrap_or(download_uri)`.
- `DownloadCheckpoint.uri` now stores the STABLE origin key (page/magnet URL), not the volatile CDN link.
- `download_file_to_dest` gained `source_key: &str`; `load_checkpoint`/`write_checkpoint` calls now pass `source_key` (the HTTP GET still uses `uri` = CDN).
- Frontend: `tauri.ts` binding gained `sourceKey?: string`; `useDebridInstallSync.ts` `downloadDebridPackage` call passes `sourceKey: downloadUri` (the job's stable `downloadUrl`).
- Old-format checkpoints (CDN keyed) are discarded once on first resume (mismatch → restart); direct-HTTP resumes keep working (source_key == original URI).

### Part 2 — Fix B: never trust partial files
- `has_partial_install_artifacts(dest_dir)` — new helper: true when `tmp/` exists and is non-empty (any `.part`/`.part.meta`/`.meta.tmp`). The completion path removes `tmp/`, so non-empty `tmp/` ⇔ in-flight/interrupted download.
- Step 0: when partial artifacts are present, logs `[DEBRID][SHORTCIRCUIT_SKIP]` and falls through to the full download+extract pipeline (never auto-runs setup on corrupt data).
- `download_file_to_dest` "already downloaded" short-circuit now requires `!part.exists() && !meta.exists()` — a leftover partial triggers checkpoint resume instead of trusting the final file. `part`/`meta` computed once before the gate (duplicate computation removed).

### Regression tests (6 new in `debrid_installer::tests`)
- `checkpoint_load_resumes_across_cdn_rotation` — checkpoint keyed on page URL matches the stable `source_key` (exact Bug 1 case).
- `checkpoint_load_source_key_mismatch_starts_fresh` — different origin discards the stale partial.
- `has_partial_artifacts_no_tmp_false` / `has_partial_artifacts_empty_tmp_false` / `has_partial_artifacts_part_file_true` / `has_partial_artifacts_meta_only_true` — Step 0 guard matrix.

### Fix C (verified, no change needed)
- `start_torrent_download` (librqbit) already resumes via fastresume + piece verification; a resumed torrent re-verifies existing files and never marks corrupt data ready. No analogous trust bug on the torrent path.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — `source_key` param on `download_debrid_package`/`download_file_to_dest`, `checkpoint_key`, `has_partial_install_artifacts`, Step 0 gate, dest_path gate, 6 tests
- `src/services/tauri.ts` — `sourceKey?: string` on `downloadDebridPackage` params
- `src/hooks/useDebridInstallSync.ts` — `sourceKey: downloadUri` at the call site

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings: `HydraSourceList`, `DebridProviderConfig`)
- `cargo test` ✅ **224 passed / 0 failed** (218 previos + 6 nuevos)
- `tsc --noEmit` ✅ (only the 22-23 pre-existing extension/test errors, none in touched files)
- `vite build` ✅ (2.25s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
