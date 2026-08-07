## Session — Store repacks: dynamic repacker filters + browse-all default + card images

### Goal
Fix the Store → Debrid Catalog repacker filter chips (they were a hardcoded list with no real data), make the default view a paginated browse-all (24/page, "Load more"), and show Steam CDN card images with the existing gradient header as fallback.

### Rust (src-tauri/src/commands/repack_catalog.rs)
- RepackGroupStat { repacker, count } struct (serde camelCase).
- query_by_repacker now case-insensitive: WHERE lower(repacker) = lower(?1) (chips previously returned 0 rows because stored repacker is lowercase, e.g. itgirl vs chip FitGirl).
- query_repacker_groups(conn) — SELECT repacker, COUNT(*) ... GROUP BY lower(repacker) ORDER BY count DESC, lower(repacker) ASC, excluding empty repacker.
- query_page(conn, limit, offset) — browse-all ORDER BY CASE WHEN app_id > 0 THEN 0 ELSE 1 END, updated_at DESC LIMIT ?1 OFFSET ?2 (games with Steam appIds first, then recent).
- New Tauri commands query_repack_catalog_page(limit, offset) + query_repack_repackers(), registered in src-tauri/src/lib.rs after query_repack_catalog_by_repacker.

### TS bindings (src/services/tauri.ts)
- RepackGroupStat type; queryRepackCatalogPage(limit, offset) → query_repack_catalog_page; queryRepackRepackers() → query_repack_repackers.

### Frontend (src/components/store/DebridCatalogSection.tsx)
- **Dynamic chips**: on mount loads queryRepackRepackers(); chips show display-capitalized repacker name + count badge (epackerLabel). Falls back to the hardcoded REPACKERS list only on query failure/empty DB.
- **Browse-all default**: loadGames(null, "", page) now calls queryRepackCatalogPage(GAMES_PER_PAGE, page * GAMES_PER_PAGE) (was setGames([]) dead branch). Page-0 effect on mount + on ctiveRepacker/searchQuery change; appends on "Load More"; hasMore = results.length === GAMES_PER_PAGE.
- handleRepackerClick toggles case-insensitively (clicking the active chip clears the filter → browse-all).
- Card images: heroUrl = buildSteamCdnUrl(String(game.appId), "capsule") for ppId > 0; top spect-video + object-cover <img> with onError → imgFailed state → existing gradient header fallback (Package icon + repacker chip). Repacker chip overlaid on the image (g-black/60 backdrop-blur-sm). No MediaIndex/snapshot writes (keyless Steam CDN derivation).
- Empty-state copy updated; header subtitle → "browse all or filter by repacker".

### Build
- cargo check ✅ (0 errors; 2 pre-existing dead-code warnings)
- 	sc --noEmit ✅ (only the 23 pre-existing extension/test errors, none in touched files)
- ite build ✅ (1.71s, Rolldown; only informational INEFFECTIVE_DYNAMIC_IMPORT warnings)
