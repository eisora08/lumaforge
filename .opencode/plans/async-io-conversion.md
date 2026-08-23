# Plan: Async I/O conversion + dead code cleanup + boot optimization

## Goal
Convert all blocking `reqwest::blocking` Tauri commands to async, remove dead code, batch manifest writes, and fix the repack catalog. The app should boot in <2s with zero thread-pool starvation.

## Phase 1: Critical boot path (3 commands → async)

### 1a. `resolve_steam_app_metadata` (metadata.rs:10)
- **Current**: `pub fn` with `reqwest::blocking::Client` + `std::thread::scope` (8 concurrent threads per batch)
- **Fix**: Convert to `pub async fn` with `reqwest::Client` (async) + `tokio::spawn` for parallel requests
- **Impact**: Boot Stage 3.5/4.5 title enrichment runs 8-120s faster
- **Files**: `src-tauri/src/commands/metadata.rs`, `src-tauri/src/lib.rs` (no change needed)

### 1b. `fetch_steam_owned_games` (steam_owned.rs:66)
- **Current**: `pub fn` with `reqwest::blocking::Client` + filesystem cache
- **Fix**: Convert to `pub async fn` with async reqwest + `tokio::fs`
- **Impact**: Boot library resolution faster
- **Files**: `src-tauri/src/commands/steam_owned.rs`

### 1c. `scan_and_build_full_dataset` (steam_index.rs:124)
- **Current**: `pub fn` with `reqwest::blocking::Client` (via `resolve_steam_app_metadata`)
- **Fix**: Remove entirely (dead code — `triggerBackgroundScan` has zero callers, boot uses `scanSteamInstalledGames`)
- **Files**: `src-tauri/src/commands/steam_index.rs`, `src-tauri/src/lib.rs`, `src/services/fullSteamGameIndex.ts`, `src/services/tauri.ts`

## Phase 2: Media download pipeline (2 commands → async)

### 2a. `safe_download_image` (game_cache.rs:1089)
- **Current**: `pub fn` with `reqwest::blocking::Client` + filesystem
- **Fix**: Convert to `pub async fn` with async reqwest + `tokio::fs`
- **Impact**: Media downloads don't block thread pool
- **Files**: `src-tauri/src/commands/game_cache.rs`

### 2b. `download_provider_media_from_url` (provider_media.rs:217)
- **Current**: `pub fn` with `reqwest::blocking::Client` + filesystem
- **Fix**: Convert to `pub async fn` with async reqwest + `tokio::fs`
- **Files**: `src-tauri/src/commands/provider_media.rs`

## Phase 3: Store/network commands (batch conversion)

### Commands to convert to async:
- `resolve_steam_review_summaries` (reviews.rs:6)
- `resolve_steam_store_search` (store_search.rs:6)
- `check_provider_availability` (provider.rs:7)
- `resolve_steamgriddb_artwork` (steam_grid_db.rs:8)
- `search_steamgriddb_games` (steam_grid_db.rs:38)
- `resolve_steamgriddb_artwork_by_game_id` (steam_grid_db.rs:101)
- `igdb_get_access_token` (igdb.rs:185)
- `igdb_search_by_steam_app_id` (igdb.rs:223)
- `igdb_search_games_by_name` (igdb.rs:296)
- `igdb_query_catalog` (igdb.rs:449)
- `hubcap_health` (hubcap.rs:68)
- `hubcap_user_stats` (hubcap.rs:110)
- `hubcap_depot_keys` (hubcap.rs:298)
- `hubcap_app_status` (hubcap.rs:391)
- `fetch_steam_news` (steam_news.rs:21)
- `fetch_steam_store_drm_notice` (metadata.rs:497)

### Pattern for each conversion:
```rust
// Before:
pub fn my_command(params: ...) -> Result<T, String> {
    let client = reqwest::blocking::Client::builder().timeout(...).build()?;
    let resp = client.get(url).send()?;
    // ...
}

// After:
pub async fn my_command(params: ...) -> Result<T, String> {
    let client = reqwest::Client::builder().timeout(...).build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await
        .map_err(|e| e.to_string())?;
    // ...
}
```

## Phase 4: Dead code removal

### Commands to remove:
- `resolve_steam_featured_categories` (store.rs:6) — zero TS consumers
- `cache_trailer_file` (game_cache.rs:1126) — zero callers
- `cache_remote_game_media` (game_media_cache.rs:118) — deprecated
- `cache_store_remote_media` (store_cache.rs:291) — deprecated
- `resolve_steam_app_names` (game.rs:11) — unused
- `triggerBackgroundScan` (fullSteamGameIndex.ts:99) — zero callers

### For each removal:
1. Remove the Rust command function
2. Remove from `lib.rs` registration
3. Remove TS binding from `tauri.ts`
4. Remove any dead imports in TS files

## Phase 5: Boot write optimization

### 5a. Batch manifest writes
- `generateMediaManifest` at `gameCacheService.ts:1448` fires per-game during boot
- Fix: Collect appIds during boot, call `generateMediaManifest` once after all games are loaded
- Or: skip manifest generation during boot entirely (manifests are a cache optimization, not correctness)

### 5b. Defer catalog import (already done in prior fix)
- Stage 11 catalog import deferred to post-boot via `scheduleAfterMain(5000)`

## Phase 6: Repack catalog fix

### Root cause
- `public/data/repacks/repack-catalog-v1.json` doesn't exist
- Vite SPA fallback returns HTML → Rust `serde_json::from_str` fails

### Fix
- Either recreate the file (curated entries from prior session)
- Or: guard the fetch in `repackCatalogService.ts` to validate Content-Type before passing to Rust
- Recommended: validate response is JSON before calling Rust import

## Phase 7: tokio dependencies

### Current Cargo.toml
Check if `tokio` is already a dependency. If not, add:
```toml
tokio = { version = "1", features = ["full"] }
```

Most async commands need:
- `tokio::fs` for filesystem I/O
- `tokio::time::timeout` for HTTP timeouts
- `tokio::spawn` for parallel requests

## Execution order
1. Phase 1 (boot-critical async conversion) — highest impact
2. Phase 4 (dead code removal) — no risk, reduces codebase
3. Phase 5 (boot write optimization) — medium impact
4. Phase 6 (repack catalog fix) — low effort
5. Phase 2 (media download async) — medium impact
6. Phase 3 (batch store/network async) — lower priority, many files
7. Phase 7 (tokio deps) — prerequisite for phases 1-3

## Expected results
- Boot time: ~1.3s → <1s (no thread-pool starvation)
- Media downloads: non-blocking (UI stays responsive)
- Store navigation: no freeze (network requests don't block)
- Codebase: ~500 lines of dead code removed
