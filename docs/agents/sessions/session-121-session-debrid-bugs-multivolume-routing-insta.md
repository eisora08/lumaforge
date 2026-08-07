## Session — Debrid bugs: multivolume routing, installer CWD, missing-exe launch error

### Goal
Fix 3 Debrid install/launch bugs: (1) multivolume repacks downloaded only the first `.bin` via the resolved direct link instead of running through the integrated torrent client, (2) `spawn_installer_detached` ran the repack installer without anchoring its working directory, and (3) launching a Debrid game with a stale/missing `executablePath` surfaced a cryptic `os error 2`.

### Part 1 — Multivolume resolve → torrent routing (Rust + TS)
- **Root cause**: `DebridResolveResult` only exposed `resolved_url: Option<String>`; TorBox used `torbox_largest_file` (single largest file) and Real-Debrid used `.first()` → a single link, so a multivolume repack resolved to only its first part (`.rar` correctly left in place as incomplete).
- **Rust** (`debrid_resolver.rs`):
  - `DebridResolveResult` gained `resolved_urls: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`) and `file_count: Option<usize>`.
  - Helper `torbox_usable_files` collects non-sample/non-metadata TorBox files; when >1, `file_count = Some(usable.len())` and `picked = Some((0, name, size))` (whole-torrent); single file → `file_count = Some(1)`.
  - Real-Debrid magnet: enumerate `torrents/links/{id}` → `all_links: Vec<String>` + `file_count = Some(len)` when several. WebDL (direct-HTTP, single-file) keeps `resolved_urls::new()`, `file_count: None`.
- **TS**: `DebridResolveResult` type gained `resolvedUrls?`/`fileCount?` (`debridProviderService.ts:14-25`); `resolveInstallUri` returns `{ url, fileName?, fileCount? }` (`useDebridInstallSync.ts:74-82`); `startInstall` routes to `startTorrentDownload` when `resolved.fileCount > 1` and `downloadUri.startsWith("magnet:")` (~line 475).

### Part 2 — Installer working directory (`debrid_installer.rs:1162`)
- `spawn_installer_detached` now anchors to the installer's own directory via `current_dir` and, on the elevated PowerShell path, `Start-Process -WorkingDirectory '<workdir>'` with `''` quoting escapes.

### Part 3 — Missing executable path clear error (`process.rs:113`)
- **Root cause**: `spawn_game_with_elevation_fallback` only special-cased `os error 740`; a nonexistent `executablePath` returned the cryptic `os error 2` from both the plain spawn AND the `Start-Process -Verb RunAs` retry (which would also fail identically).
- **Fix**: upfront existence validation — resolve the exe against `working_directory` when relative, and `return Err("Executable not found: '<resolved>'. The installed path may be missing or stale — reinstall the game or pick a valid executable.")` before building the command. Fails fast with a clear message instead of dragging the user through an elevation prompt that can never succeed.

### Build
- `cargo check` ✅ (0 errors)
- `cargo test` ✅ 197 passed / 0 failed
