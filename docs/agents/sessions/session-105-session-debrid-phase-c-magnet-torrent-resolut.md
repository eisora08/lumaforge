## Session — Debrid Phase C: magnet/torrent resolution via debrid providers

### Goal
Wire magnet/torrent repack downloads through `resolveDebridUri()` — when a download URI starts with `magnet:`, resolve it to a direct URL via a configured debrid provider (TorBox / Real-Debrid / AllDebrid / Premiumize) before starting the install download.

### Part 1: TorBox magnet + direct-HTTP flows (`debrid_resolver.rs`)
- `resolve_via_torbox_magnet()` — addMagnet (multipart) → poll `mylist` until ready states (`cached`/`download_finished`/`uploading`/`completed`; errors `error`/`metaDL_error`) → pick largest non-sample file via `torbox_largest_file` → `torrents/requestdl` with `?token=&torrent_id=&file_id=` (or without `file_id` when only the root file exists).
- `resolve_via_torbox_webdl()` — direct-HTTP flow: `webdl/createwebdownload` → `webdl/requestdl?token=&download_id=` → reads `data.url` / `data` / `data.permalink` and `data.filename`/`data.size`.
- Poll constants: `TORBOX_POLL_MAX_ATTEMPTS: u64 = 40`, `TORBOX_POLL_INTERVAL_SECS: u64 = 3`.

### Part 2: Real-Debrid magnet + HTTP flows (`debrid_resolver.rs`)
- `resolve_via_real_debrid()` now dispatches: `magnet:` → `resolve_via_real_debrid_magnet()`; HTTP direct → `POST /unrestrict/link` directly (previous flow preserved).
- `resolve_via_real_debrid_magnet()` — addMagnet → error code 22 (`magnet_infohash` + active-torrent list to reuse an existing id) → selectFiles `files="all"` → poll `torrents/info/{id}` until `progress >= 100.0` / `downloadFinished` / status `2|6|7` → `GET /torrents/links/{id}` → first link → `POST /unrestrict/link`.
- Poll constants: `REAL_DEBRID_POLL_MAX_ATTEMPTS: u64 = 40`, `REAL_DEBRID_POLL_INTERVAL_SECS: u64 = 3`.

### Part 3: Helpers + unit tests (`debrid_resolver.rs`)
- `magnet_infohash(uri)` — extracts 40-hex lowercase infohash from `xt=urn:btih:...`; accepts dash-separated hashes (strips `-`); rejects missing/short/non-hex.
- `json_u64()` — reads numeric fields that arrive as number OR string.
- `torbox_largest_file()` — largest non-sample file, excludes `.txt`/`.nfo`/`.diz`.
- `torbox_error_message()` — prefers `detail`, then `message`, falls back to status string.
- 8 unit tests (`#[cfg(test)] mod tests`): infohash extraction, dash-separated hash, missing/short rejection, non-hex rejection, json_u64 number/string, largest-file filtering, empty/metadata-only → None, error message precedence.
- Fixed `TORBOX_API_BASE` → `https://api.torbox.app/v1/api`; reqwest feature `multipart` added.

### Part 4: Frontend wiring (`useDebridInstallSync.ts`)
- `resolveInstallUri(downloadUri)` helper — non-magnet URIs pass through; `magnet:` URIs load settings via dynamic `import("../context/SettingsContext")` → `loadSettings()`, build `DebridProviderConfig` from `settings.debridProviders`, call `resolveDebridUri()`, return `result.resolvedUrl` when successful (gated `[DEBRID_INSTALL] magnet resolved provider=...` log), else warn and fall back to the raw magnet.
- `startInstall` now calls `resolveInstallUri(downloadUri)` before `downloadDebridPackage` → magnet downloads resolve through the configured provider chain (TorBox → Real-Debrid → AllDebrid → Premiumize, preferred-provider aware).

### Build
- cargo check ✅ (0 errors; 2 pre-existing dead-code warnings)
- cargo test ✅ 168 passed / 0 failed (8 new in debrid_resolver; 21 in debrid_installer)
- tsc --noEmit ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- vite build ✅ (Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
