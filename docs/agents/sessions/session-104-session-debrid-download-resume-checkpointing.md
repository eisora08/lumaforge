## Session — Debrid download resume/checkpointing (Phase A) + combined repacker+search filter

### Goal
Resumable Debrid downloads: keep a `.part` file + checkpoint meta on cancel/error so retries resume via HTTP Range instead of restarting. Also complete the combined repacker+search composition for the Debrid Catalog (Phase B/C deferred).

### Part 1: Combined repacker + search filter
- Rust `query_by_repacker_fuzzy_title(conn, repacker, query, limit)` in `repack_catalog.rs` — `WHERE lower(repacker) = lower(?1) AND normalized_title LIKE '%' || ?2 || '%'`, ordered by has-appId then title length.
- Command `query_repack_catalog_by_repacker_fuzzy(repacker, query, limit, db)` registered in `lib.rs`; TS binding `queryRepackCatalogByRepackerFuzzy`.
- `DebridCatalogSection.tsx` — combined branch calls the new query with `setHasMore(false)`; effect always calls `loadGames(activeRepacker, searchQuery, 0)`; `handleRepackerClick` no longer clears search; `handleSearch` no longer clears repacker (symmetric, confirmed UX).

### Part 2: Download resume/checkpointing (Phase A)
- New types/helpers in `debrid_installer.rs`:
  - `DownloadCheckpoint { uri, total_bytes, downloaded_bytes, started_at }` (serde) + `ResumeDecision` enum (`ResumeFrom(u64) | FreshStart | AlreadyComplete`).
  - `part_path()` / `meta_path()` → `tmp/<file>.part` + `.part.meta`.
  - `load_checkpoint()` — returns on-disk part size only when meta parses, `cp.uri == uri`, and part is non-empty; cleans stale/corrupt/mismatched part+meta.
  - `write_checkpoint()` — atomic via `.meta.tmp` + rename; called on cancel and stream/write errors, not per-chunk.
  - `decide_resume()` — 206 → ResumeFrom (Content-Length = remaining bytes; `Some(0)` → AlreadyComplete); 416 → FreshStart; anything else (incl. 200) → FreshStart; `resume_from == 0` → FreshStart.
- `download_file_to_dest` rewritten:
  - Bounded request loop (async recursion not allowed → loop instead of recursion): Range header on resume; 416 with offset > 0 → delete partial+meta, retry once from 0; non-2xx → error; Content-Type text/html rejected as before.
  - `AlreadyComplete` → rename part → dest, remove meta+tmp dir.
  - Totals: `total_bytes = resume_from + server_total` on 206; `remaining` passed to `check_disk_space` (skips at 0).
  - File opened append-mode when resuming, else `File::create`; `bytes_read` seeded to `resume_from`.
  - Cancel/stream/write errors keep partial + checkpoint (resumable later).
  - Completion: flush → drop (Windows) → rename part → dest → remove meta + empty tmp dir.
- GoFile bearer threaded through the resume request.

### Tests
- 12 new unit tests: `decide_resume` matrix (no-resume fresh, 206 append, 206 no-length append, 206 zero-remaining complete, 200 restart, 416 restart) + `load_checkpoint` (resume from part size, URI mismatch cleanup, corrupt meta cleanup, meta-without-part, empty part, write→load roundtrip).
- Full suite: 160 passed / 0 failed.

### Build
- cargo check (0 errors; 2 pre-existing dead-code warnings)
- cargo test (160 passed / 0 failed; 21 in debrid_installer)
- tsc --noEmit (only the 23 pre-existing extension/test errors, none in touched files)
- vite build (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
