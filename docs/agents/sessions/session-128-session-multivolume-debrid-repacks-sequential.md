## Session � Multivolume Debrid repacks: sequential per-file downloads (Option A)
### Goal
Replace the automatic `fileCount > 1` ? librqbit torrent fallback (user''s local swarm fails with "Could not connect to torrent swarm (no peers/seeds)") with sequential per-file direct downloads through the debrid provider: multivolume FitGirl repacks (magnet, setup.exe + `.bin` parts) download one-by-one via the existing `downloadDebridPackage` pipeline.

### Rust (already complete, verified this session)
- `DebridResolveResult` (`debrid_resolver.rs:16-38`) gained `file_names: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`) � aligned 1:1 with `resolved_urls`. Frontend downloads anything `> 1` sequentially per-file; primary part chosen by filename.
- TorBox magnet: multivolume branch emits a per-file `GET /torrents/requestdl` for every usable file + aligned `file_names`; skipped files ? early error result.
- Real-Debrid magnet: unrestricts EVERY link from `/torrents/links/{id}` (sequential `.form` loop) ? `resolved_urls`/`file_names` aligned 1:1; `file_size=None`; `file_count=Some(n)` only when n > 1.
- Premiumize: `premiumize_files_from_body` ? 6-tuple (first_url, first_name, first_size, all_urls, all_names, count); `file_names` aligned; links-less entries filtered. AllDebrid stays single-file (`file_names: Vec::new()`).
- `download_debrid_package` (`debrid_installer.rs:389`) supports `auto_extract=false` ? status `"downloaded"` (archive saved, no extraction). Loop calls it per part with the SAME `job_id`/`destDir`; each call starts with `clear_job_flags(&job_id)` so cancel mid-loop aborts only the in-flight part.

### TS (this session)
- `debridProviderService.ts` � `DebridResolveResult` mirror gained `fileNames?: string[]`; doc comment updated (per-file sequential semantics + primary-part-by-filename).
- `useDebridInstallSync.ts`:
  - `resolveInstallUri` return type + pass-through now include `resolvedUrls`/`fileNames`.
  - New `pickPrimaryPartIndex(fileNames)` helper � priority: (1) installer exe (setup/installer/`.exe$`, last match wins so volumes precede it), (2) first-volume archive (`part0*1.rar`/`.rar`/`.r00`), (3) fallback last index.
  - `startInstall` multivolume branch: when `resolved.resolvedUrls.length > 1` and `downloadUri.startsWith("magnet:")`, downloads each part sequentially via `downloadDebridPackage` � every non-primary part with `autoExtract=false` (just saved to disk), then the primary part LAST with `autoExtract=true` (reassembles + auto-runs setup). Same `jobId` (single progress bar via `InstallerProgressListener`), `destDir`, and `sourceKey: downloadUri` (stable checkpoint key). Breaks on `!result?.success` so `handleInstallResult` (called once after the loop) marks failed.
  - Explicit `installMethod === "torrent"` route and the resolve-failed ? torrent fallback remain unchanged (librqbit stays for the user''s explicit choice only).

### Behavior
- Multivolume repack via debrid: all `.bin`/volume parts land on disk first (no extraction), then setup.exe (or first-volume archive) downloads last and extracts ? setup runs once every part is present.
- Single-file repack: unchanged direct download path.
- Resume: checkpoint keyed on the stable `sourceKey` (job downloadUrl) per part � a CDN rotation on resume continues the same `.part` for the part in flight.
- Cancel mid-loop: only the in-flight part''s Rust call is aborted (clear_job_flags per call).

### Build
- `tsc --noEmit` ? (22 pre-existing extension/test errors only, none in touched files)
- `vite build` ? (2.35s, Rolldown; verified `pickPrimaryPartIndex` regex `/setup|installer|\.exe$/` + 3 `sourceKey` call sites in `index-*.js`; debug string dead-code-eliminated since `DEBUG_DEBRID_INSTALL=false`)
- `cargo test` ? 227 passed / 0 failed (verified prior session)
- `cargo check` ? (only 2 pre-existing dead-code warnings)
