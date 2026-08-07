## Session — Media provider priority: Steam original assets before SteamGridDB for Steam games

### Problem
For Steam games, media materialization depended too heavily on SteamGridDB, which was checked BEFORE Steam CDN/metadata in all role resolvers. This caused wrong assets to be downloaded (screenshots, storepagebackground) instead of correct role-mapped Steam assets (Hero→background, Header→landscape, Capsule→cover, Logo→logo).

### Root cause
- **`fromSteamCdn` only handled background and logo** — no cover/landscape/icon CDN fallbacks existed
- **SGDB before Steam in all chains** — layout was: local → cached → SGDB → IGDB/RAWG → Steam CDN → metadata → screenshots
- **No `logSteamRoleMap` diagnostic** — no visibility into which Steam metadata fields were available

### Parts implemented

#### Part 1: Steam metadata fields identified
- `SteamAppMetadata` has: `header_image`, `capsule_image`, `capsule_image_v5`, `library_hero_image`, `hero_image`, `logo_image`, `library_logo_image`, `background_image`, `wide_cover_image`, `library_header_image`
- "Original Steam Assets" panel is not a LumaForge component — it's the Steam Store metadata display. All fields come from `appdetails` API via `gameMetadataResolver.ts`
- `buildSteamImageUrl` in `storeImageCache.ts` already supported capsule/header/hero patterns
- No icon field exists in Steam metadata — icon requires Steam Community API hash

#### Part 2: `fromSteamCdn` expanded to cover all 5 roles
- **Cover**: `buildSteamCdnUrl(appId, "capsule")` → `capsule_616x353.jpg` (skipped when metadata has `capsule_image_v5` or `capsule_image`)
- **Landscape**: `buildSteamCdnUrl(appId, "header")` → `header.jpg` (skipped when metadata has `header_image` or `library_header_image`)
- **Background**: unchanged — `library_hero.jpg` (skipped when metadata has `library_hero_image` or `hero_image`)
- **Logo**: unchanged — `logo.png` (skipped when metadata has `logo_image` or `library_logo_image`)
- **Icon**: returns `undefined` (no CDN icon available)
- Added `"capsule"` to `buildSteamCdnUrl` kind union
- Added `logSteamRoleMap(appId, meta)` helper for `[MEDIA_ROLE_MAP]` diagnostics
- Added `logMediaSelect(appId, role, source, url)` helper for `[MEDIA_SELECT]` per-role diagnostics

#### Part 3: Priority chain reordered (Steam before SGDB)

**Cover:** local → cached → **Steam CDN capsule** → **Steam metadata** → SGDB → IGDB → imageUrl
**Landscape:** local → cached → **Steam CDN header** → **Steam metadata** → screenshots → SGDB → IGDB
**Background:** local → cached → **Steam CDN hero** → **Steam metadata** → screenshots → SGDB → RAWG → IGDB → landscapeFallback
**Logo:** local → cached → **Steam CDN logo** → **Steam metadata** → SGDB
**Icon:** local → cached → Steam CDN (none) → SGDB

#### Part 4: No new setting
- Default behavior is Steam-first for all Steam games
- SGDB, RAWG, IGDB remain as fallbacks with their existing `use*` setting controls

#### Part 5: Stale local media (from prior session, verified)
- `refreshGameDetailsArtwork` verifies local paths via `resolveGameMediaPaths` (Rust disk check) before resolution
- Stale paths (file missing on disk but present in appinfo) are filtered out, `[MEDIA_STALE]` diagnostic logged
- Downstream re-resolution picks correct Steam CDN/metadata fallback

#### Part 6: Storepagebackground — only last fallback
- `isStorePageBackground()` + `pickBackgroundUrl()` already filter storepagebackground from `fromMetadata` background chain
- With Steam CDN hero at position 3 (before metadata), `library_hero.jpg` wins even when metadata only has storepagebackground
- Matches user spec: "use storepagebackground only as last ambient fallback"

#### Part 7: Screenshots — fallback only
- Screenshots at position 5 for background (after CDN + metadata)
- Screenshots at position 5 for landscape (after CDN + metadata)
- Screenshots never used for cover, logo, or icon
- Matches user spec: "Do not use screenshots for cover/logo/icon"

#### Part 8: Validation (manual, pending)
- User must delete incorrect files for appId=4717430 and re-open GameDetails to verify

#### Part 9: Debug logs behind `DEBUG_MEDIA_ROLE_MAP = false`
- `[MEDIA_ROLE_MAP]` — per-appId log of Steam metadata fields (header/capsule/hero/logo)
- `[MEDIA_SELECT]` — per-role resolution log with label (steam-cdn-hero/capsule/header/logo or source name)
- `[MEDIA_STALE]` — appinfo path filtered because file missing on disk

#### Part 10: Build validation
- `tsc --noEmit` ✅ (0 errors)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)

### Key Files Changed
- `src/services/gameCacheService.ts` — `buildSteamCdnUrl` expanded with "capsule" kind, `fromSteamCdn` expanded with cover/landscape (returns CDN capsule/header), `fromSteamCdn` icon returns undefined, `logSteamRoleMap()` and `logMediaSelect()` helpers, `DEBUG_MEDIA_ROLE_MAP` constant, `resolveCover`/`resolveLandscape`/`resolveBackground`/`resolveLogo`/`resolveIcon` all reordered (Steam CDN + metadata before SGDB), `appId` param added to `resolveCover`/`resolveLandscape`/`resolveIcon`, `meta` param added to `resolveIcon`, call sites in `resolveMediaByPriority` updated, `[MEDIA_STALE]` per-role log in stale detection block
