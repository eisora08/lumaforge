## Session 15 — Architecture hotfix: snapshot-first, page-scoped, priority-based

### Problem
Previous Session 14 (emergency stabilization) disabled the worst background noise, but the architecture still lacked formal priority tiers, unified repair entry point, media health TTL metadata, dedup key helpers, and page-scoped logging flags.

### Part 1: Formalized P0-P6 job priority tiers
- Added `JobTier` type with 7 levels: `P0-user-action` → `P6-cleanup`
- `tierToPriority()` maps P0-P6 to legacy `high/normal/low`
- `tierLabel()` strips the `P\d-` prefix for display
- `BackgroundJob.tier` field added (optional, backward-compat)
- `enqueue()` accepts optional `tier` alongside `priority`
- Log format: `[JOB] queued key=<key> tier=<tier> priority=<priority>`

### Part 2: Shared refreshArtwork function (Part 7+9)
- Created `refreshArtwork(appId, options)` in `gameCacheService.ts:964` — unified entry point for both manual Refresh Artwork and GameDetails auto-repair
- Options: `roles`, `force`, `tier` (JobTier), `source` (MediaRepairSource)
- Manual: `roles=all, force=true, tier=P0-user-action, source=refresh-artwork`
- GameDetails: `roles=missing, force=false, tier=P1-visible-page, source=visible-details`
- Reuses same 4-tier source chain: resolveGameMedia → game-metadata → SGDB → mediaSources
- Both paths converge on `enqueueMediaDownload` → `UpdateGameAppinfoMedia` → `notifyMediaUpdated`
- Returns `{ queued, failed, skipped }` result

### Part 3: Media health metadata with TTL (Part 4)
- Added `MediaHealth` type: `{ complete, checkedAt, missing, lastRepairAttemptAt?, lastRepairError? }`
- `_mediaHealthStore` Map maintains per-appId health
- `getMediaHealth()`, `setMediaHealth()`, `isMediaHealthStale()`, `isMediaRepairOnCooldown()`
- TTL constants: complete=24h, incomplete=10min retry, failed=5min cooldown
- `detectAndQueueMissingMedia` now checks TTL before repair
- `refreshArtwork` bypasses TTL when `force=true` or `source=refresh-artwork`
- Health updated after each scan with missing/queued roles

### Part 4: BootSnapshot validation — dirty appIds only (Part 14)
- Existing `_processDirtyAppIds` already limited to dirty appIds for media-update
- `ENABLE_VERBOSE_STARTUP_SNAPSHOT_LOGS = false` already gates per-game hydrate logs
- Rust `DEBUG_BOOTSNAPSHOT_VALIDATE = false` gates `[VALIDATE_PATH]` success logs
- No full-rebuild for media-update writes

### Part 5: Logging flags + dedupe keys (Part 18+19)
- Added `DEBUG_MEDIA_DETAILS = false`, `DEBUG_MEDIA_RESOLVE = false` in `gameCacheService.ts`
- Added `DEBUG_ACH_VERBOSE = false` in `achievementStore.ts`
- `backgroundJobQueue.ts`: `mediaRepairKey(provider, appId, role)` and `gameDetailsRepairKey(provider, appId, roles)` helpers
- All logging flags default to false

### Key Files Changed
- `src/services/backgroundJobQueue.ts` — `JobTier`, `tierToPriority`, `tierLabel`, `mediaRepairKey`, `gameDetailsRepairKey`, `BackgroundJob.tier`
- `src/services/gameCacheService.ts` — `refreshArtwork()`, `MediaHealth`, `_mediaHealthStore`, TTL helpers, `DEBUG_MEDIA_DETAILS`, `DEBUG_MEDIA_RESOLVE`
- `src/services/achievementStore.ts` — `DEBUG_ACH_VERBOSE`

### Build
- `tsc --noEmit` ✅ passes
- `vite build` ✅ passes
- `cargo check` ✅ passes
