## Session — Webview bypass fix + curated Debrid repack catalog

### Goal
Fix Steam Store webview HTML fetch (Cloudflare challenge), then test the Debrid/Hydra repack download/install pipeline end-to-end with manually-curated JSON entries.

### Part 1: Webview bypass
- Increased initial delay from 15s → 30s with modal notification
- Still errors with Cloudflare/Safeguard — deferred
- Modal text updated to inform user about expected Cloudflare interaction

### Part 2: Repack catalog format investigation
- Discovered `steamrip.json` uses `{ downloads: [...] }` format with string fileSizes and no appIds — incompatible with expected `RepackCatalogArtifact` (`{ records: [...] }`)
- Same issue with `fitgirl.json`
- Raw scraper output cannot be read directly by the importer

### Part 3: Curated repack-catalog-v1.json
- Created new `repack-catalog-v1.json` in correct `RepackCatalogArtifact` format with 6 curated entries:
  - GTA V (271590) — steamrip, gofile.io URI
  - Resident Evil 2 (883710) — steamrip, gofile.io URI
  - Palworld (1623730) — steamrip, gofile.io URI
  - Armored Core VI (1971650) — fitgirl, no download URI
  - Alan Wake 2 (1269530) — dodi, no download URI
  - Armored Core VI v2 (1971650) — fitgirl, magnet URI
- All entries have proper numeric `appId`, numeric `fileSize`, and `downloadUris[]`
- Updated `repack-catalog-v1.manifest.json` with correct SHA256 checksum

### Part 4: Checksum re-import detection
- Modified `ensureRepackCatalogImported()` to compare `status.checksum` against `manifest.checksum`
- When checksums differ, re-imports from bundled JSON (instead of skipping because `hasCatalog` is true)
- Logs `[REPACK][AUTO_IMPORT] checksum changed (old... → new...)` on re-import
- Debrid library subscription effect picks up new entries on boot

### Part 5: Status
- Feature flags are `true`: `DEBRID_LIBRARY_ENABLED = true`, `DEBRID_INSTALL_ENABLED = true`
- `debrid` integration defaults to `enabled: true` in `DEFAULT_INTEGRATION_SETTINGS`
- Boot Stage 11 automatically imports repack catalog
- `LibraryGamesContext` subscription appends Debrid games to Library
- **Download will fail**: gofile.io URIs return HTML pages (not binary files) — need direct HTTP links or a configured debrid provider for magnet URIs
- Webview bypass still blocked by Cloudflare — deferred

### Key Files Changed
- `src/services/repackCatalogService.ts` — `ensureRepackCatalogImported()` checksum comparison + re-import
- `public/data/repacks/repack-catalog-v1.json` — replaced with 6 curated entries in `RepackCatalogArtifact` format
- `public/data/repacks/repack-catalog-v1.manifest.json` — updated SHA256 checksum

### Build
- `tsc --noEmit` ✅ (0 new errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (0 errors)
