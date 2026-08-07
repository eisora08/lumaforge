## Session — Steam Store HTML DRM fallback + Curated Denuvo JSON index

### Goal
Add a read-only Denuvo/DRM badge in `StoreGameDetailsPage` using official Steam Store data as primary source, with curated Denuvo JSON index as secondary fallback.

### Problem
The DRM notice (`"Incorporates 3rd-party DRM: Denuvo Anti-Tamper"`) exists on the public Steam Store HTML (`<div class="DRM_notice">`) but is absent from the `appdetails` API `legal_notice` field for many games (confirmed for 3768760).

### Phase 1 — Rust HTML parser + Tauri command
- `src-tauri/src/commands/metadata.rs`:
  - `extract_drm_notice_from_html` — parses `<div class="DRM_notice">` from Steam Store HTML, returns inner text or null
  - `fetch_steam_store_drm_notice(app_id)` — fetches `https://store.steampowered.com/app/<appId>/` with `Accept-Language: en-US`, extracts DRM notice, logs `[STORE][DRM_HTML_FETCH]`
- `src-tauri/src/models/steam_app_metadata.rs` — added `store_drm_notice: Option<String>` to `SteamAppMetadata`
- `src-tauri/src/lib.rs` — registered `fetch_steam_store_drm_notice` command
- `src/services/tauri.ts` — added `fetchSteamStoreDrmNotice(appId: number)` TS binding

### Phase 2 — Post-step DRM HTML fetch in metadata resolver
- `src/services/gameMetadataResolver.ts`:
  - Post-step DRM notice fetch runs AFTER `resolveGameMetadata` returns when `meta.resolved === true` and `store_drm_notice` is missing from the response
  - `_drmFetchedThisSession: Set<number>` module-level dedup — one fetch per appId per session
  - `clearGameMetadataCache(appId)` clears the dedup entry for that appId
  - `[STORE][DRM_HTML_POST_STEP]` diagnostic log on fetch
  - Cache schema check for `store_drm_notice` field in `loadFromAppCache` — missing field triggers re-fetch

### Phase 3 — DRM extraction helper
- `src/features/drm/storeDrmInfo.ts`:
  - `extractStoreDrmInfo(metadata)` — priority chain with short-circuit return:
    1. `legal_notice` (steam-metadata)
    2. `store_drm_notice` (steam-html)
    3. `detailed_description` (steam-metadata)
    4. `about_the_game` (steam-metadata)
    5. `short_description` (steam-metadata)
  - `searchField()` helper — strips HTML, checks Denuvo patterns first, checks 3rd-party DRM patterns second
  - Denuvo patterns: `\bdenuvo\b`, `\bdenuvo anti-tamper\b`
  - 3rd-party DRM patterns: `incorporates 3rd.party drm`, `3rd.party drm`, `third.party drm`

### Phase 4 — Curated Denuvo JSON index (tertiary fallback)
- `public/data/drm/denuvo-index.json` — bundled JSON with schema v1, 11 curated entries (007 First Light, Resident Evil Village, MH Rise, Tales of Arise, Persona 5 Royal, Sonic Frontiers, Street Fighter 6, Tekken 8, Hogwarts Legacy, S.T.A.L.K.E.R. 2, Dead Space)
- `src/features/drm/curatedDenuvoIndex.ts` — types + helpers:
  - `CuratedDenuvoIndex`, `CuratedDenuvoEntry`, `CuratedDenuvoDrmInfo`, `CuratedDenuvoSource`
  - `normalizeDenuvoTitle(title)` — strips punctuation, lowercase, single spaces
  - `matchCuratedDenuvoEntry(params)` — priority: exact appId → exact normalized title → title + developer/publisher overlap
- `src/features/drm/curatedDenuvoService.ts` — module-level cache, `loadCuratedDenuvoIndex()` (fetch once), `getCuratedDenuvoIndexCached()`, `clearCuratedDenuvoCache()`
  - `[STORE][DRM_CURATED_INDEX_LOAD]` diagnostic log on load

### Phase 5 — Integration in StoreGameDetailsPage.tsx
- Loads curated index on mount via `loadCuratedDenuvoIndex` → `setCuratedIndexReady(true)`
- Second effect matches curated entry when index + metadata are ready: `matchCuratedDenuvoEntry({ appId, title, developerNames, publisherNames, index })`
- `drmInfo` useMemo applies `applyCuratedDenuvoFallback(base, curatedEntry)` — only fires when `source === "none"`
- `[STORE][DRM_CURATED_MATCH]` diagnostic log with confidence and status
- Existing `[STORE][DRM_INFO]` log automatically reflects `source=curated-denuvo-index` when fallback applied

### Source priority (final)
1. **Steam `appdetails` API** — `legal_notice` field (authoritative Steam data)
2. **Steam Store HTML** — `<div class="DRM_notice">` parsed by Rust (official source, enforces English)
3. **Curated Denuvo index** — local bundled JSON (tertiary fallback, no auto-scraping)
4. **Fallback text search** — `detailed_description` → `about_the_game` → `short_description`

### Key Files Changed (this session)
- `src-tauri/src/commands/metadata.rs` — `extract_drm_notice_from_html`, `fetch_steam_store_drm_notice`
- `src-tauri/src/models/steam_app_metadata.rs` — `store_drm_notice` field
- `src-tauri/src/lib.rs` — command registration
- `src/services/tauri.ts` — TS binding
- `src/services/gameMetadataResolver.ts` — post-step DRM fetch + cache schema check
- `src/features/drm/storeDrmInfo.ts` — `applyCuratedDenuvoFallback`, `"curated-denuvo-index"` source, updated `StoreDrmInfo.source` type
- `src/features/drm/curatedDenuvoIndex.ts` — **new** — types + matching helpers
- `src/features/drm/curatedDenuvoService.ts` — **new** — index loader with module-level cache
- `public/data/drm/denuvo-index.json` — **new** — 11 curated Denuvo entries
- `src/components/store/StoreGameDetailsPage.tsx` — curated index integration, matching effects, diagnostic logs

### Build
- `tsc --noEmit` ✅ (no errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (only pre-existing unused-variable warnings)
