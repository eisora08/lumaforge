## Session — Debrid download `os error 3` root cause: unsanitized nested filename

### Problem
Debrid repack install failed instantly with `Failed to create file: The system cannot find the path specified. (os error 3)` — before any byte downloaded. Confirmed the message comes only from `download_file_to_dest` at `debrid_installer.rs:1790` (`tokio::fs::File::create(&part)`), where `part = tmp_dir.join(format!("{}.part", file_name))` with `tmp_dir = dest_dir/tmp` created OK. Failing before the first chunk means `file_name` contained a path separator → parent dir `tmp/<sub>` didn't exist.

### Root cause
- `file_name` comes from `clean_download_filename(preferred_filename.or(extract_filename_from_uri(uri)))`. Debrid resolvers (`debrid_resolver.rs`) return the full **in-archive path** (e.g. `Game Folder/Setup.exe`) or Windows-invalid characters for magnet/torrent files.
- Old `clean_download_filename` only checked non-empty + `len ≤ 50` + `has_file_extension` — it did NOT sanitize `/ \ < > : " | ? *` or control chars, trailing dots/spaces, `.`/`..`, or reserved device names. A slash-carrying token passed straight through → `.part` built a nested path → `os error 3`.

### Fix (pure Rust, `debrid_installer.rs`)
- **`normalize_download_filename(name)`** — single sanitizer:
  1. Keep only the last path segment (`split(['/', '\\']).last()`).
  2. Replace Windows-invalid + control chars (`<>:"/\|?*` + C0 controls) with `_`.
  3. Trim trailing dots/spaces (Windows terminators).
  4. Fall back to `"repack"` for empty / `.` / `..` / reserved device names (`con`/`nul`/`prn`/`aux`/`con.`/`lpt`/`com`).
  5. Cap at `MAX_LEN = 50` preserving the extension when present; bare over-long tokens (gofile CDN) → `"repack"`.
- **`clean_download_filename`** — now always routes through `normalize_download_filename` (no more extension-only fast path; bare/over-long names still sanitize instead of passing raw). The old `has_file_extension` helper was removed (unused).
- **Defense-in-depth** — before the `File::create`/`OpenOptions` branch in `download_file_to_dest`, `fs::create_dir_all(part.parent())` ensures a residual nested name can never surface as a silent `os error 3`.
- **7 new regression tests** in `debrid_installer::tests`: nested subdir strip (the exact bug), invalid-char replacement, trailing dot/space trim, `"repack"` fallback (empty/`.`/`..`/reserved/over-long/slash-only), length-cap-preserving-extension, valid names unchanged, `clean_download_filename` sanitizes all inputs.

### Key Files Changed
- `src-tauri/src/commands/debrid_installer.rs` — `normalize_download_filename`, `clean_download_filename` rewrite, `has_file_extension` removed, part-parent `create_dir_all` guard, 7 tests

### Build
- `cargo check` ✅ (only 2 pre-existing dead-code warnings)
- `cargo test` ✅ **197 passed / 0 failed** (was 190; 7 new)
