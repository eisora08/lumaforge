# LumaForge Technical Audit

---

## PART 1 — STORE PIPELINE AUDIT

### readAllGames() Usage

| Metric | Value |
|--------|-------|
| Total call sites | 5 |
| Per boot (warm) | 3 |
| Per 5 min | 1 (if queried) |
| Rows returned | ~82 (user's library) |

### Call Sites

| Site | File:Line | Invoked | Cached |
|------|-----------|---------|--------|
| `loadSteamGameIndex` Stage 4 | `appBootCoordinator.ts:294` | Once per boot | No |
| `loadSteamGameIndex` Stage 4.5 | `appBootCoordinator.ts:447` | Once per boot (conditional) | No |
| `getSqliteName` refresh | `gameCacheService.ts:82` | Once per 5 min | Yes (5-min TTL) |
| `validateLibraryIndexHealth` | `gameStore.ts:114` | Manual only | No |
| `validateStartupCacheHealth` | `gameStore.ts:358` | Once after boot | No |

### Data Flow

```
SQLite (cache.db)
  └─ Rust: read_all_games() [sqlite_cache.rs:434]
       └─ IPC (Tauri invoke)
            └─ TS: readAllGames() [tauri.ts:1590]
                 └─ fullSteamGameIndex.ts: loadSteamGameIndex()
                      └─ appBootCoordinator.ts (Stage 4/4.5)
                           └─ gameStore.ts: _reconciledGames
                                └─ LibraryGamesContext
                                     └─ React Components
```

**No React component calls `readAllGames` directly.** All consumption goes through `_reconciledGames` in `gameStore.ts`.

### Store Scalability

**All Store page arrays are small:**
- `steamFeaturedCategories`: `< 10` items (Steam API)
- `results`: `~5` items (mock packages)
- `browseGames`: `~30-50` items
- The 500K-entry `steamdb.json` in `steamAppIndex.ts` is **disabled** at runtime (`ENABLE_STEAM_APP_INDEX = false`, line 1)

### O(N) Operations (all on small arrays)

| Operation | File:Line | N | Complexity |
|-----------|-----------|---|------------|
| `lumaForgeSections` (map+filter) | Store.tsx:419 | ~5 | O(N) |
| `browseGames` (forEach x3) | Store.tsx:484 | ~50 | O(N) |
| `luaReadyGames` (forEach x2) | Store.tsx:506 | ~50 | O(N) |
| `featuredGames` (forEach x3) | Store.tsx:528 | ~50 | O(N) |
| `newsItems` (forEach+filter) | Store.tsx:552 | ~50 | O(N) |
| **`filteredBrowseGames` (7x filter)** | Store.tsx:607 | ~50 | O(7N) |
| `visibleAppIds` (forEach x4) | Store.tsx:702 | ~60 | O(N) |
| `selectedDetailRelatedGames` | Store.tsx:828 | ~60 | O(N) |

### Biggest Store Bottleneck

**Finding #S1: Six redundant iterators over identical data.** `browseGames` (Store.tsx:484), `luaReadyGames` (506), `featuredGames` (528), `newsItems` (552), `visibleAppIds` (702), and `selectedDetailRelatedGames` (828) each independently iterate `steamStoreSections` and `results`. When a single dependency changes (e.g., `providerOverlayByAppId` updates), all 6 re-execute.

- **Severity**: LOW
- **Impact**: Wasted CPU cycles on small arrays (~50 items). Not user-perceptible at current scale.
- **Fix**: Derive `luaReadyGames`, `featuredGames`, `newsItems` from `browseGames` instead of re-iterating source arrays. Combine the 7 chained `.filter()` calls in `filteredBrowseGames` (line 607) into a single pass.

---

## PART 2 — HTTP & NETWORK AUDIT

### Architecture

**Zero async reqwest.** All HTTP uses `reqwest::blocking`. Cargo.toml only enables `features = ["blocking", "rustls-tls", "json"]`. All calls run on Tauri's IPC thread pool (not the main/UI thread).

### Call Sites Without Timeout (CRITICAL)

| ID | File | Line | Function | Can hang? |
|----|------|------|----------|-----------|
| **B1** | `download_utils.rs` | 25 | `download_file_to_temp()` | YES - package installs |
| **B2** | `artwork_cache.rs` | 73 | `cache_remote_artwork()` | YES |
| **B3** | `game_media_cache.rs` | 166 | `cache_remote_game_media()` (x5 loop) | YES |
| **B4** | `library_cache.rs` | 480 | `cache_library_game_media()` (x5 loop) | YES |
| **B5** | `library_cache.rs` | 514 | `cache_library_game_media()` (quick cover) | YES |
| **B6** | `store_cache.rs` | 418 | `cache_store_remote_media()` (x5 loop) | YES |
| **B14** | `game.rs` | 15 | `resolve_steam_app_names()` (loop per app) | YES |
| **B15** | `metadata.rs` | 11 | `resolve_steam_app_metadata()` (loop per app) | YES |

### Call Sites With Timeout

| ID | File | Line | Timeout | Sequential calls per command |
|----|------|------|---------|------------------------------|
| B7-B13 | `game_cache.rs` | 792 | 30s | 1-4 per role |
| B16 | `reviews.rs` | 13 | 12s+8s connect | Loop over appIds |
| B17 | `store.rs` | 35 | 12s+8s connect | 1 |
| B18 | `store_search.rs` | 20 | 10s+6s connect | 1-2 |
| B20-B22 | `steam_achievements.rs` | 25 | 15s+8s connect | 1-3 per app |
| B23-B28 | `steam_grid_db.rs` | 79 | 15s | **8 per app** |

### Most Dangerous Blocking Chains

| Command | Sequential calls | Max time | Risk |
|---------|-----------------|----------|------|
| `resolve_steamgriddb_artwork` (per app) | 8 calls | 120s (with timeout) or **infinite** | Blocks IPC thread ~2 min |
| `cache_library_game_media` | 6 calls | **Infinite** (no timeout) | Hangs IPC thread forever |
| `cache_store_remote_media` | 5 calls | **Infinite** (no timeout) | Hangs IPC thread forever |
| `resolve_steam_app_names` (boot, 82 apps) | 82 calls | **Infinite** (no timeout) | Blocks boot indefinitely |

### Finding #H1: Boot title enrichment can hang indefinitely (CRITICAL)

- **File**: `src-tauri/src/commands/game.rs:15-48`
- **Function**: `resolve_steam_app_names()`
- **Evidence**: Lines 15-19 build a Client with `user_agent` + `redirect::Policy::limited(5)` but **NO timeout**. Lines 23-81 loop over `app_ids` making one HTTP request per app ID sequentially.
- **Reproduction**: Boot the app on a network that accepts TCP connections but never responds (e.g., captive portal, throttled VPN). The Steam API call for any single appId hangs forever. The entire boot blocks on this because it's in the critical path (Stage 3.5/4.5).
- **Impact**: App never finishes booting. Splash screen stays forever (the 10-second splash timeout is for the entire boot flow, but this is in the critical path).
- **Fix**: Add `.timeout(Duration::from_secs(10))` to the client builder in `resolve_steam_app_names` (game.rs:19).

### Finding #H2: SteamGridDB 8-sequential-call chain (MEDIUM)

- **File**: `src-tauri/src/commands/steam_grid_db.rs:8-300`
- **Function**: `resolve_steamgriddb_artwork()`
- **Evidence**: Lines 25-34 loop over `app_ids`. Per app: calls `resolve_game_id()` (line 79), then `fetch_best_vertical_grid()` (line 112), `fetch_best_horizontal_grid()` (164), `fetch_first_hero()` (229), `fetch_first_logo()` (259), `fetch_first_icon()` (288). Each is a separate HTTP request, all sequential. For N apps: N × 8 sequential HTTP calls.
- **Impact**: If called for 10 apps, that's 80 sequential HTTP calls blocking an IPC thread. At 15s timeout each, worst case = 1200s (20 minutes).
- **Fix**: Add concurrency (process 3-4 apps in parallel) once `reqwest` is async. In the short term, reduce sequential fallback chain by trying SGDB and Steam store in parallel.

---

## PART 3 — MEDIA SYSTEM AUDIT

### Finding #M1: Cross-path `cachedSnapshot` reference swap causes data loss (CRITICAL)

- **Files**: `startupSnapshotService.ts:478-581` (media-update), `startupSnapshotService.ts:1280-1308` (full-rebuild), `startupSnapshotService.ts:961` (swap)
- **Functions**: `_processDirtyAppIds()`, `buildStartupSnapshotFromCurrentState()`, `saveStartupSnapshot()`

**Execution sequence for data loss:**

```
1. _processDirtyAppIds() starts [line 478]
2.   cachedSnapshot = snapshot_A [reads module-level var at line 501]
3.   await resolveMediaForSnapshot(appId_1) [line 513] — YIELDS
4.   [FULL REBUILD fires] 
5.     buildStartupSnapshotFromCurrentState() [line 1280]
6.       saveStartupSnapshot(snapshot_B) [line 1308]
7.         cachedSnapshot = snapshot_B [line 961 — SWAP]
8.   [CONTROL RETURNS to _processDirtyAppIds]
9.   cachedSnapshot.library.games is NOW snapshot_B [line 518]
10.  Modifies snapshot_B's game entries [lines 518-558]
11.  saveStartupSnapshot(cachedSnapshot) [line 581] — writes snapshot_B
```

**Result**: Modifications made to `snapshot_A`'s game 1 (step 3) are **lost**. They were never written to disk. The final write at step 11 saves `snapshot_B` (which has stale game 1 data) with only game 2's modifications (from step 10).

- **Root cause**: `saveStartupSnapshot` replaces `cachedSnapshot` at line 961 without any synchronization with the media-update path. `_writeInProgress` (line 20) only guards `_scheduleMediaUpdateWrite` (line 470), not `scheduleSnapshotWrite` (line 1280).
- **Impact**: Random loss of media update data during concurrent snapshot operations. Most likely during boot + initial media download + library reconciliation.
- **Fix**: Add a generation counter or frozen-reference pattern to `_processDirtyAppIds`. Snapshot the game objects at start of iteration, apply changes to a working copy, and use `saveStartupSnapshot` only at the end. Alternatively, guard `saveStartupSnapshot` behind `_writeInProgress` check so both paths never call it simultaneously.

### Finding #M2: Cancel-vs-completion race in media download queue (HIGH)

- **File**: `mediaDownloadQueue.ts:165-193` (completion), `mediaDownloadQueue.ts:286-293` (cancel)
- **Functions**: `performDownload()`, `cancelMediaJobsForApp()`

**Execution sequence:**

```
1. performDownload starts: await invoke("safe_download_image") [line 143]
2. User navigates away → cancelMediaJobsForApp(appId) [line 286]
3.   activeJobs.delete(job.id) [line 288]
4.   entry.resolve({ success: false }) [line 293]
5. [await resolves — download completed on Rust side]
6.   key added to recentlyCompleted [line 165]
7.   queueAppInfoUpdate fires [line 169] — persists the file
8.   entry.resolve() is NO-OP (already resolved in step 4)
```

**Result**: Caller sees `success: false` (cancel). But the system records `recentlyCompleted` and persists the appinfo. Next time the user triggers a download for the same appId, the dedup guard at line 208 skips it because `recentlyCompleted.has(key)` is `true`. The user faces a "cancelled" UI state but the download actually completed and persisted.

- **Root cause**: No coordination between the cancel operation and the async completion callback. Both run independently.
- **Impact**: Inconsistent user feedback. Cancel button shows "cancelled" but the file is actually on disk. Re-download is blocked by dedup.
- **Fix**: In `cancelMediaJobsForApp`, set a `cancelledJobs` Set. In `performDownload`'s completion path, check `cancelledJobs.has(job.id)` before persisting and skip the appinfo update if cancelled.

### Finding #M3: `resolvedSrcCache` never invalidated on media change (MEDIUM)

- **File**: `gameCacheService.ts:71` (cache defined), `gameCacheService.ts:234-236` (invalidation)
- **Function**: `invalidateResolvedMediaCache()`
- **Evidence**: Line 234 clears `resolvedMediaSessionCache` but does NOT clear `resolvedSrcCache`. After a media download replaces `landscape.png`, the old `asset://` URL mapping persists in `resolvedSrcCache` (populated at line 700 by `localPathToUrl`).
- **Impact**: Stale URL mappings accumulate. Memory leak that grows with each unique file path ever accessed. The old paths are never used again (appinfo no longer points to them) but the Map entries persist.
- **Fix**: Add `resolvedSrcCache.clear()` at line 229 inside `clearResolvedMediaSessionCache()`.

### Finding #M4: `cacheMediaForGame` leaves stale session cache (MEDIUM)

- **File**: `gameCacheService.ts:383-387`
- **Function**: `cacheMediaForGame()`
- **Evidence**: After downloading, the sequence is:
  1. Line 383: `invalidateResolvedMediaCache(appId)` — clears session cache
  2. Line 386: `invalidateCanonicalMediaCache(appId)` — clears snapshot cache
  3. Line 387: `notifyMediaUpdated(appId)` — async: re-resolves media, updates snapshot
- Between steps 1 and 3, any component calling `loadGameAppInfoWithMediaFallback(appId)` finds the session cache empty, does a full disk read (line 131), finds potentially different state than what `notifyMediaUpdated` will write, and caches that stale state at line 206/223. Step 3 does NOT re-seed `resolvedMediaSessionCache`.
- **Impact**: After `cacheMediaForGame` completes, the session cache has stale data from an intermediate read, not the freshly downloaded data.
- **Fix**: After step 3 completes, also update `resolvedMediaSessionCache` with the now-current media paths.

### Finding #M5: `clearMediaQueueState` wipes dedup state mid-flight (MEDIUM)

- **File**: `prewarmCacheService.ts:258`, `mediaDownloadQueue.ts:330-337`
- **Evidence**: `cancelPrewarm` calls `clearMediaQueueState()` which clears `recentlyCompleted`, `recentlyFailed`, `pendingAppInfoUpdates`. In-flight jobs continue executing (they're in `activeJobs`, which is NOT cleared). They complete later and add to `recentlyCompleted`/`recentlyFailed`, re-populating the sets. Meanwhile, a new prewarm can enqueue duplicate downloads because the dedup state was temporarily wiped.
- **Impact**: Duplicate downloads after cancelled+restarted prewarm.
- **Fix**: Track cancelled job keys in a separate Set that persists across `clearMediaQueueState`. Or don't clear dedup state - only clear `pendingAppInfoUpdates`.

---

## PART 4 — BOOT AUDIT

### Boot Stage Summary

| Stage | Line | Description | Tauri Invokes | Disk Reads | SQLite | Necessary? |
|-------|------|-------------|---------------|------------|--------|------------|
| 1 | 159 | Load settings | 0 | 0 | 0 | YES |
| 2 | 170 | Migrate portable paths | 1 | Achievement dirs | 0 | NO |
| 3 | 189 | Load snapshot + hydrate | 3 | ~410 (snapshot + N appinfos + 5N stat) | 0 | YES |
| 3.5 | 240 | Enrich snapshot titles | 1-3 | SQLite + network | M reads + writes | Partial |
| 4 | 289 | Load SQLite game index | 1 | 0 | 1 read | YES |
| 4.5 | 306 | Reconcile + enrich (again) | 6-16 | Steam library + appinfos + network | 2 reads + 1 write | YES |
| 5 | 568 | Load achievements (disabled) | 0 | 0 | 0 | NO |
| 6 | 627 | Seed media index | 1 | N manifests | 0 | YES |
| 6.5 | 657 | Load playtime store | 1 | 1 file | 0 | Partial |
| 7 | 669 | Start achievement watcher | 0 | 0 | 0 | NO |
| 8 | 693 | Set route shell ready | 0 | 0 | 0 | YES |
| 9 | 702 | Background repair (deferred) | 5-8 | 5N stat + N appinfos | 2 reads | NO |
| 10 | 794 | Confirm mounted | 0 | 0 | 0 | YES |

### Finding #B1: `read_canonical_appinfos` called 3 times (HIGH)

- **Call sites**: Stage 3 (startupSnapshotService.ts:753), Stage 4.5 (appBootCoordinator.ts:483), Stage 9 (gameCacheService.ts:2351)
- **Each call reads N appinfo.json files** from disk (N ≈ 82). Total: ~246 file reads for the same data.
- **Evidence**: The result of Stage 3's read is available in memory (`cachedCanonicalAppInfos` / the hydrated snapshot media). Stage 4.5 and Stage 9 discard it and re-read from disk.
- **Impact**: 164 unnecessary file reads on every boot. At ~1ms each, that's ~164ms of wasted I/O.
- **Fix**: Pass the Stage 3 batch-read result through the boot coordinator instead of re-reading. Or add a session-level cache for appinfos (which was added in a later session according to AGENTS.md, but not present in this codebase version).

### Finding #B2: `readAllGames` (SQLite) called 3 times (MEDIUM)

- **Call sites**: Stage 4 (appBootCoordinator.ts:294), Stage 4.5 (appBootCoordinator.ts:447), Stage 9 (gameStore.ts:359)
- **Each call is a full `SELECT * FROM games ORDER BY title ASC`** - reads all columns, all rows, full deserialization.
- **Evidence**: The Stage 4 result (`index: SteamGameIndexEntry[]`) is still in scope when Stage 4.5 calls it again (line 447: "if sqliteCache.games.length > 0"). Stage 4 already has the data; it just doesn't pass it.
- **Impact**: 2 extra full SQLite table scans. At ~82 rows ~50KB total, this is ~2ms per scan. Small but unnecessary.
- **Fix**: Pass the Stage 4 result to Stage 4.5 instead of re-reading. Or cache in `_sqliteNameCache` which already exists.

### Finding #B3: Stage 3.5 + Stage 4.5 do duplicate title enrichment (MEDIUM)

- **Evidence**: Stage 3.5 (appBootCoordinator.ts:240-287) resolves placeholder titles and saves enriched snapshot. Stage 4.5 (appBootCoordinator.ts:473-557) repeats the same enrichment pipeline: filter placeholders → `resolveGameMetadata` → `getStoreDetails` → `updateGameAppinfoMedia` → save snapshot.
- **Impact**: Double metadata resolution and appinfo writes for the same placeholder games. On a cold boot with 5 placeholder games, this means 5 extra network calls and 5 extra appinfo writes.
- **Fix**: Stage 3.5 should write names to both snapshot (already done) AND appinfo.json (not done). Stage 4.5 enrichment should then be a no-op because appinfo already has the name.

### Biggest Boot Bottleneck

**Stage 4.5 (appBootCoordinator.ts:306-566)** — ~260 lines, ~6-16 Tauri invokes, does disk-heavy work including Steam scan, Lua scan, SQLite reads, appinfo reads, metadata resolution, and snapshot writes. It cannot begin until Stage 3 (snapshot hydrate) and Stage 4 (SQLite read) complete, making it the longest serial critical-path block.

---

## PART 5 — MEMORY AUDIT

### High-Risk Caches (unbounded growth, no eviction)

| Cache | File:Line | Structure | Max Size | Risk |
|-------|-----------|-----------|----------|------|
| `failedAssetSrcSet` | AsyncImage.tsx:19 | `Set<string>` | Every failed asset URL | **HIGH** - never cleared |
| `failedLocalPathSet` | AsyncImage.tsx:20 | `Set<string>` | Every failed file path | **HIGH** - never cleared |
| `successfulDataUrlCache` | AsyncImage.tsx:21 | `Map<string, string>` | Every success + large data URL strings | **HIGH** - never cleared |
| `_appInfoCache` (Store) | storeLocalCacheService.ts:20 | `Record<string, StoreAppInfoEntry>` | Up to 162K entries | **HIGH** - no eviction |
| `recentlyCompleted` | mediaDownloadQueue.ts:70 | `Set<string>` | Every download key ever | **MEDIUM** - no TTL |
| `recentlyFailed` | mediaDownloadQueue.ts:71 | `Set<string>` | Every download key ever | **MEDIUM** - no TTL |
| `inMemoryCache` (metadata) | gameMetadataResolver.ts:6 | `Map<number, SteamAppMetadata>` | Every game resolved | **MEDIUM** - no entry TTL |
| `inMemoryCache` (reviews) | gameReviewResolver.ts:6 | `Map<number, SteamReviewSummary>` | Every game resolved | **MEDIUM** - no entry TTL |
| `cachedIndex` | sourceAvailabilityCacheService.ts:41 | `Record<string, SourceAvailabilityGameEntry>` | Every appId checked | **MEDIUM** - no eviction |
| Game name localStorage | gameNameResolver.ts:3 | localStorage | Every unique appId | **MEDIUM** - no TTL |

### Finding #Mem1: AsyncImage global caches never cleared (HIGH)

- **File**: `src/components/common/AsyncImage.tsx:19-21`
- **Caches**: `failedAssetSrcSet` (Set), `failedLocalPathSet` (Set), `successfulDataUrlCache` (Map)
- **Growth**: Every failed asset URL, failed local path, and successful data URL accumulates for the entire session. `successfulDataUrlCache` values are data URL strings (potentiallY 100KB-1MB each for images).
- **Realistic scenario**: User browses Store with 200 images. 20 fail (asset), 20 fail (local fallback), 180 succeed via data URL. `successfulDataUrlCache` now holds 180 data URLs. If each averages 200KB, that's 36MB. If the user browses 1000 games, it's 180MB.
- **Fix**: Add LRU eviction with max ~100 entries, or clear on page navigation. Convert `failedAssetSrcSet`/`failedLocalPathSet` to TTL-based (clear after 5 min).

### Finding #Mem2: Store _appInfoCache loads entire Steam catalog (MEDIUM)

- **File**: `storeLocalCacheService.ts:20`
- **Structure**: `Record<string, StoreAppInfoEntry>` — a JS object with one key per Steam app
- **Evidence**: `ensureAppInfoLoaded()` (line 25) calls `invoke("read_store_appinfo")` which reads the full `store-appinfo.json` from disk. This file can contain entries for every Steam app the user has ever browsed — potentially thousands.
- **Impact**: A large JS object in memory with no eviction. If the user browses 10,000 Steam store games, each entry averages ~500 bytes, the object is ~5MB. Not catastrophic, but unbounded.
- **Fix**: Convert to `Map` and add LRU with max 1000 entries.

---

## PART 6 — SNAPSHOT AUDIT

### Finding #S1: Two independent write paths without mutual exclusion (CRITICAL)

Already covered in Finding #M1. This is the single most dangerous architectural issue.

- **Write paths**:
  1. Media-update: `notifyMediaUpdated()` → `_scheduleMediaUpdateWrite()` → `_processDirtyAppIds()` → `saveStartupSnapshot(cachedSnapshot)` [line 581]
  2. Full-rebuild: `scheduleSnapshotWrite()` → callback → `buildStartupSnapshotFromCurrentState()` → `saveStartupSnapshot(newSnapshot)` [line 1308]
- **Guard**: `_writeInProgress` only checked by path 1 (line 470). Path 2 never checks it.
- **Evidence**: Path 2's callback at line 1280 directly calls `saveStartupSnapshot` without any lock or guard.

### Finding #S2: Stale snapshot can overwrite fresh in-memory data (HIGH)

- **File**: `startupSnapshotService.ts:1036` (reads disk), `startupSnapshotService.ts:961` (swaps in-memory)
- **Evidence**: `buildStartupSnapshotFromCurrentState()` at line 1036 calls `readCanonicalAppinfosBatch()` which reads `appinfo.json` from disk. If `flushAppInfoUpdates` hasn't written the latest media paths yet, this produces a stale snapshot. Then `saveStartupSnapshot(staleSnapshot)` at line 1308 overwrites `cachedSnapshot` at line 961, replacing fresh in-memory data with stale data from disk.
- **Impact**: Media updates that were in-flight (waiting for the 500ms flush timer) are invisible to the snapshot that gets persisted. The user sees stale media until the next update cycle.

### Finding #S3: Unbounded deferral chains under interaction (MEDIUM)

- **File**: `startupSnapshotService.ts:483-488` (media-update), `startupSnapshotService.ts:1255-1261` (full-rebuild)
- **Both paths check `isInteractionBusy()` and defer by 1-2 seconds.**
- **Evidence**: No maximum-defer limit. If the user scrolls continuously for 60 seconds, the defer timer keeps resetting. Writes never execute until interaction stops for 2-5 seconds.
- **Impact**: After rapid page navigation, it can take 5-15 seconds before the final snapshot write occurs. If the app crashes during this window, the last N media updates are lost.
- **Fix**: Add a maximum defer limit (e.g., 30s). After 30s of deferrals, force the write regardless of interaction.

### Finding #S4: `saveStartupSnapshot` sets global before disk write completes (MEDIUM)

- **File**: `startupSnapshotService.ts:952-976`
- **Evidence**: Line 961: `cachedSnapshot = snapshot` — runs BEFORE `await invoke("write_startup_snapshot")` at line 971. If the disk write fails (caught at line 973), `cachedSnapshot` points to data that was never persisted.
- **Impact**: After a failed disk write, `loadStartupSnapshot()` on next boot reads the old data from disk, creating an in-memory vs disk mismatch. Any reads of `cachedSnapshot` between line 961 and the next successful write see phantom data.
- **Fix**: Move `cachedSnapshot = snapshot` to AFTER the successful `await invoke(...)`. Or keep it before but revert on failure.

---

## PART 7 — TOP 10 REAL ISSUES

### #1
- **Severity**: CRITICAL
- **Impact**: Data loss — media update modifications silently lost
- **Evidence**: Cross-path `cachedSnapshot` reference swap in `startupSnapshotService.ts`. `_processDirtyAppIds()` at line 501 reads module-level `cachedSnapshot`. `buildStartupSnapshotFromCurrentState()` at line 1280 calls `saveStartupSnapshot()` which replaces `cachedSnapshot` at line 961 while `_processDirtyAppIds` is mid-iteration (yielded at `await` in line 513). Modifications to the old snapshot are lost. No mutual exclusion between the two write paths — `_writeInProgress` (line 20) only guards path 1, never path 2.
- **Fix**: Add a frozen-reference pattern to `_processDirtyAppIds` — snapshot the initial game IDs at start, work on a copy, and guard `saveStartupSnapshot` behind a `_writeInProgress` check in both paths.

### #2
- **Severity**: CRITICAL
- **Impact**: App hangs indefinitely on boot or network calls
- **Evidence**: 8 HTTP call sites across 5 files with **zero timeout**: `download_utils.rs:25`, `artwork_cache.rs:73`, `game_media_cache.rs:166`, `library_cache.rs:480`, `store_cache.rs:418`, `game.rs:15`, `metadata.rs:11`. The boot-critical `resolve_steam_app_names()` (game.rs:15) loops over 82+ appIds with no timeout per call. A captive portal or slow network blocks boot forever.
- **Fix**: Add `.timeout(Duration::from_secs(10))` to all client builders in these 5 files. The pattern from `game_cache.rs:793` (30s timeout) should be replicated throughout.

### #3
- **Severity**: HIGH
- **Impact**: App runs slow on every boot — 164+ unnecessary file reads, 2 extra SQLite scans
- **Evidence**: `read_canonical_appinfos` called 3x (Stage 3:753, Stage 4.5:483, Stage 9:2351). `readAllGames` called 3x (Stage 4:294, Stage 4.5:447, Stage 9:359). Title enrichment runs twice (Stage 3.5:240-287 and Stage 4.5:473-557). Total ~20-27 Tauri invokes per warm boot, ~300-500 file reads.
- **Fix**: Route intermediate results between boot stages instead of re-reading from disk. Cache `read_canonical_appinfos` result in memory for the duration of boot. Make Stage 3.5 write to appinfo.json so Stage 4.5 enrichment is a no-op.

### #4
- **Severity**: MEDIUM
- **Impact**: Data URLs accumulate in memory indefinitely — potential 50MB+ leak
- **Evidence**: `AsyncImage.tsx:21` — `successfulDataUrlCache` is a module-level `Map<string, string>` with zero eviction. Every successful data URL conversion adds an entry. Each data URL can be 100KB-1MB for a game image. In a session with 1000 unique images displayed, this is 100MB-1GB of string data.
- **Fix**: Add LRU eviction (max 100 entries) or clear the cache on page navigation. Also clear `failedAssetSrcSet` (line 19) and `failedLocalPathSet` (line 20) which also grow unboundedly.

### #5
- **Severity**: MEDIUM
- **Impact**: Cancel UI shows "cancelled" but file is persisted, re-download blocked by dedup
- **Evidence**: `mediaDownloadQueue.ts:165-193` vs `286-293`. Cancel at line 293 resolves with `success: false`. Completion path at line 165 adds to `recentlyCompleted` and persists appinfo. Caller sees failure but system records success. Dedup at line 208 blocks re-download.
- **Fix**: In `cancelMediaJobsForApp`, set a `_cancelledKeys` Set. Check it in `performDownload`'s completion path and skip persistence if cancelled.

### #6
- **Severity**: MEDIUM
- **Impact**: Stale snapshot data replaces fresh in-memory state on concurrent writes
- **Evidence**: `startupSnapshotService.ts:1036` reads appinfo.json from disk (stale if flushAppInfoUpdates hasn't run). `buildStartupSnapshotFromCurrentState` at line 1280 produces a stale snapshot. `saveStartupSnapshot(staleSnapshot)` at line 1308 calls `cachedSnapshot = staleSnapshot` at line 961, overwriting fresh data.
- **Fix**: Before calling `saveStartupSnapshot`, compare the snapshot's `updatedAt` with `cachedSnapshot.updatedAt`. If the new snapshot is older, skip the write.

### #7
- **Severity**: MEDIUM
- **Impact**: Stale URL mappings accumulate — incorrect image display after media change
- **Evidence**: `gameCacheService.ts:71` — `resolvedSrcCache` is never cleared by `invalidateResolvedMediaCache` (line 234 only clears `resolvedMediaSessionCache`). After media update, old `asset://localhost/...` URLs remain cached.
- **Fix**: Add `resolvedSrcCache.clear()` at line 229 inside `clearResolvedMediaSessionCache()`.

### #8
- **Severity**: MEDIUM
- **Impact**: Snapshot writes delayed indefinitely during user interaction
- **Evidence**: `startupSnapshotService.ts:483-488` and `1255-1261` — both write paths check `isInteractionBusy()` and defer by 1-2 seconds with no maximum defer limit. Continuous scrolling produces unbounded deferral chains.
- **Fix**: Add a maximum defer limit of 30 seconds. After 30s, force the write regardless of interaction.

### #9
- **Severity**: LOW
- **Impact**: Redundant cache entries after download -> wasted memory
- **Evidence**: `gameCacheService.ts:383-387` — `cacheMediaForGame` calls `invalidateResolvedMediaCache(appId)` then `notifyMediaUpdated`. Between these calls, a concurrent read caches stale data. After `notifyMediaUpdated` completes, the stale data persists in the session cache.
- **Fix**: After `notifyMediaUpdated` resolves, also re-seed `resolvedMediaSessionCache` with fresh paths.

### #10
- **Severity**: LOW
- **Impact**: Source availability cache grows without bound
- **Evidence**: `sourceAvailabilityCacheService.ts:41` — `cachedIndex` is a `Record<string, SourceAvailabilityGameEntry>` that accumulates entries for every appId checked. No TTL or eviction. Grows with every unique game browsed in Store.
- **Fix**: Add TTL (24h) to entries, or limit to 1000 entries with LRU eviction.

---

## PART 8 — FALSE POSITIVES

The following concerns were investigated and found to be **not important** or **not reproducible** in this codebase version:

### 1. Store scalability with 50K+ games
**Status: False Positive**

The Store page does NOT process a full game catalog. It operates on:
- Steam API featured categories (~10 items)
- Mock packages (~5 items)
- Steam search results (API-capped)
The 500K-entry `steamdb.json` index is behind `ENABLE_STEAM_APP_INDEX = false` (steamAppIndex.ts:1). No Store operation scales with catalog size.

### 2. Blocking HTTP calls freeze the UI
**Status: False Positive**

All `reqwest::blocking` calls run on Tauri's IPC thread pool (Tauri dispatches `#[tauri::command]` calls to its own `AsyncCommandRunner` threads). The main/UI thread is NEVER blocked by any of the 30 identified HTTP call sites. However, the IPC handler thread pool is small (typically 4 threads), so many concurrent blocking calls can starve the IPC queue.

### 3. SQLite is a bottleneck
**Status: False Positive**

SQLite usage is minimal: ~82 rows in the `games` table, ~1-3 reads per boot, ~0 reads during normal dashboard/library interaction. The `read_all_games` query returns ~50KB of JSON. No SQLite query touches more than 82 rows. No JOINs, no aggregations, no full-text search.

### 4. O(N²) operations in the Store
**Status: False Positive**

All array operations in Store.tsx operate on arrays of size < 60. The 7-chained `.filter()` pipeline (line 607) is O(7N) where N ≈ 50, which is 350 iterations — trivially fast. Even if N grew to 500, 3500 iterations is sub-millisecond.

### 5. Memory leak from MediaIndex store
**Status: False Positive**

The `MediaIndex` cache (referenced in AGENTS.md as `mediaIndexStore`) is not present in this codebase version. The existing `resolvedMediaSessionCache` (gameCacheService.ts:67) is bounded by game count (~82 entries) and is explicitly invalidated.

### 6. Boot snapshot writes during Store navigation
**Status: False Positive**

`notifyMediaUpdated` (startupSnapshotService.ts:398) does NOT check for `#/store` route in this codebase version. This was added in a later session (Session 16). However, no evidence was found that Store navigation actually triggers `notifyMediaUpdated` in the current code — Store browsing only resolves `sourceAvailability`, which does not call `notifyMediaUpdated`.

### 7. Race condition in `flushAppInfoUpdates` 500ms timer vs flush iteration
**Status: False Positive**

The concern was that a `queueAppInfoUpdate` call between timer fire and map clear would lose data. However, `queueAppInfoUpdate` at line 118 cancels the existing timer with `clearTimeout(appInfoFlushTimer)`. The flush at line 98 also clears the timer (`appInfoFlushTimer = null`). If a new `queueAppInfoUpdate` fires during flush execution (between line 99 iteration and line 111 clear), it sets a new timer for 500ms, and the data of the JUST-called `queueAppInfoUpdate` is correctly captured in the new timer — not lost. The data could be delayed by one flush cycle but is not lost.

### 8. `getSteamGameCount()` dead code is a problem
**Status: False Positive**

`getSteamGameCount()` (fullSteamGameIndex.ts:87-90) has zero callers. This is dead code with no runtime impact. It would only become a problem if someone calls it, but nobody does. At 4 lines of code, it's negligible dead weight.
