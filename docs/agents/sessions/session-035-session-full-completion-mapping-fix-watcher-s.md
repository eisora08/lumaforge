## Session — Full-Completion Mapping Fix + Watcher Stuck Fix + Log Gating

### Problem
1. **Full-completion mapping stops at partial store**: librarycache says 42/42, but `buildProgressPatchFromLibraryCache` only maps `progressMap` entries (recently-changed subset). With 0 in-progress entries, `mappedUnlocked` stays at 19/42 — store shows incomplete despite librarycache indicating full completion.
2. **Watcher globally stuck after batch**: `_syncPendingAppIds.clear()` in `finally` discarded all pending appIds except the current one. After processing a batch, remaining events were lost — watcher appeared alive but silently dropped queued appIds forever.
3. **Verbose debug logs not gated**: `[ACH][SYNC_TRACE]`, `[ACH][WATCHER_STATE]`, `[ACH][PATCH_MAP]`, `[ACH][UI_COUNT_SOURCE]`, `[ACH][OVERLAY_THEME_VARS]`, `[ACTIVITY][TRACE_*]`, `[MEDIA][MANIFEST_*]` printed on every event/render despite having false-by-default debug flags.

### Part 1: Full-completion authoritative marking
- When `patch.unlocked === patch.total && patch.total > 0 && currentCanonicalTotal === patch.total`, ALL `mergedAchievements` are marked unlocked regardless of `progressMap` coverage
- `[ACH][FULL_COMPLETION]` diagnostic log when triggered
- This is safe because librarycache's `nAchieved` === `nTotal` is authoritative — the map may be partial (only recently-changed entries) but the count tells us everything is unlocked

### Part 2: Watcher _syncPendingAppIds progressive drain
- `_syncPendingAppIds.clear()` replaced with `delete(nextAppId)` — preserves remaining pending appIds for next `finally` block
- Event handler `.then()` chain now has `.catch()` that always calls `_debouncedAppIds.delete(appIdStr)` — prevents permanent debounce lock on rejection
- Removed unused `_syncPending` boolean flag (written but never read)
- Null-patch path now calls `_scheduleResolverRefresh(appId, traceId)` matching stale-librarycache pattern

### Part 3: Log gating
- `[ACH][SYNC_TRACE]` in `achievementWatcherService.ts` → `DEBUG_ACH_WATCHER`
- `[ACH][WATCHER_STATE]` → `DEBUG_ACH_WATCHER`
- `[ACH][PATCH_MAP]` in `achievementStore.ts` → `DEBUG_ACH_VERBOSE`
- `[ACH][UI_COUNT_SOURCE]` in `LibraryGameDetails.tsx` → `DEBUG_ACH_DETAILS`
- `[ACH][OVERLAY_THEME_VARS]` in `achievementNotificationService.ts` → `DEBUG_ACH_VERBOSE`
- `[ACTIVITY][TRACE_*]` in `LibraryGameDetailPage.tsx` → `window.__DEBUG_NAME_TRACE`
- `[MEDIA][MANIFEST_*]` in `LibraryGameDetailPage.tsx` and `gameCacheService.ts` → `ENABLE_VERBOSE_MEDIA_CACHE_LOGS`
- `[MEDIA][MANIFEST]` (single-word, concise write log) remains ungated as production summary
- Important warnings: `[WATCHER_STUCK]`, `[WATCHER_CLEANUP_MISSING]`, `[MANUAL_NEEDED_REASON]`, `[OVERLAY_FALLBACK]` remain ungated
- `[ACH][PATCH_MAP_MISSING]` and `[ACH][STORE_AFTER_PATCH]` remain ungated as actionable diagnostics

### Key Files Changed
- `src/services/achievementStore.ts` — Full-completion marking, `[ACH][FULL_COMPLETION]`, `[ACH][PATCH_MAP]` gated
- `src/services/achievementWatcherService.ts` — `_syncPendingAppIds` drain fix (delete not clear), `.catch()` on event handler, removed `_syncPending`, `[ACH][SYNC_TRACE]`/`[ACH][WATCHER_STATE]` gated
- `src/services/achievementNotificationService.ts` — `[ACH][OVERLAY_THEME_VARS]` gated, added `DEBUG_ACH_VERBOSE` import
- `src/components/library/LibraryGameDetails.tsx` — `[ACH][UI_COUNT_SOURCE]` gated
- `src/pages/LibraryGameDetailPage.tsx` — `[ACTIVITY][TRACE_*]` and `[MEDIA][MANIFEST_*]` gated
- `src/services/gameCacheService.ts` — `[MEDIA][MANIFEST_*]` gated behind `ENABLE_VERBOSE_MEDIA_CACHE_LOGS`

### Build
- `tsc --noEmit` ✅ (only pre-existing LibraryGameDetails.tsx unused-vars)
- `vite build` ✅ (only pre-existing chunk warnings)
- `cargo check` ✅ (no Rust changes)
