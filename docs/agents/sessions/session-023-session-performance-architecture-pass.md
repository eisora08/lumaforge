## Session — Performance Architecture Pass

### Goal
Separate boot critical path from idle work, batch Tauri commands, consolidate Store state, and add performance counters to make the app feel native-fast.

### Constraints
- Do not change Library game count (82) or Sidebar installed-only behavior (34).
- Do not make Sidebar mirror Library or re-enable achievement auto-scans.
- Do not create new services or databases; reuse existing patterns.
- Prefer batch APIs, early no-op skips, idle scheduling, stable cache restoration, small incremental changes.

### Phase 0+11: Performance counters + boot summary
- Created `src/services/perfCounters.ts` — module-level counters for Tauri invokes, appinfo attempts/skips/writes, snapshot writes/skips, media classify, jobs queued, store cache source.
- `initPerfCounters()` called at boot start, `logBootPerfSummary()` runs 100ms after boot transitions to `ready`.
- `[PERF][BOOT]` log with all counter values and elapsed time.

### Phase 1: Boot phase boundaries
- Added phase markers: `critical-start` → `critical-done` → `post-shell-start` → `post-shell-done` → `idle-ready`.
- Each phase logged via `setBootPhaseLabel()` in `perfCounters.ts` and `[BOOT] phase=<phase>` console log.
- `critical-start`: before Stage 1 (load settings).
- `critical-done`: after Stage 3 (snapshot loaded + hydrate).
- `post-shell-start`: after Stage 7 (achievement watcher started).
- `post-shell-done`: after Stage 10 (confirm-mounted).
- `idle-ready`: when `_bootStatus = "ready"`.

### Phase 2: Idle scheduler
- `backgroundJobQueue.ts` — added `_routeShellReady`, `_bootCompleted`, `_lastNavigationChange`, `_idleAcknowledged` flags.
- `isIdleReady()` checks: routeShellReady && bootCompleted && no-navigation-5s && store-inactive && no-max-active-jobs.
- `setRouteShellReady(v)`, `setBootCompleted(v)`, `setNavigationChanged()` methods on the queue.
- `processNext()` defers P4-P6 jobs (background-repair, achievement, cleanup) when not idle ready, logs `[IDLE][DEFER]` with reasons.
- P0-P3 jobs always run regardless — user-initiated and visible-page actions are never blocked.
- `[IDLE][READY]`, `[IDLE][RUN]`, `[IDLE][DONE]` diagnostic logs.
- Boot coordinator calls `setRouteShellReady(true)` at Stage 8, `setBootCompleted(true)` when boot transitions to ready.

### Phase 3: Batch Tauri commands
- Stage 5 (achievement cache reads): switched from sequential `for..await` to `Promise.allSettled` for 20 concurrent reads in boot critical path.
- Stage 4.5 already uses `readCanonicalAppinfos(appIds)` batch API.
- Stage 6 already uses batch `getMediaManifestsBatch`.
- Idle scheduler's `_bootCompleted` guard prevents premature background work.

### Phase 6: Store state consolidation
- `DiscoverState` in `storeDiscoverStateCache.ts` already serves as unified single source of truth with fingerprint + status validation.
- `CacheEntry` in `storeDiscoverCache.ts` handles persistent caching with partial-cache guard.
- No additional consolidation needed.

### Phase 7: Store large catalog guard
- `rankedSteamCatalog`, `catalogGames`, `allStoreSections`, `moreToExploreGames` all use `useMemo` with stable `catalogFingerprint` dependency.
- `allStoreSections` checks cached version first via fingerprint match, skips recomputation.
- No additional guards needed.

### Phase 10: Background validation deferral
- `validate-portable-paths`, `generate-achievement-schema`, `ensure-achievement-images` all deferred via idle scheduler (P4-P6 tiers).
- Store-active check in processNext blocks `STORE_BLOCKED_JOB_TYPES` before marking jobs running.

### Key Files Changed
- `src/services/perfCounters.ts` — **new** — counters + boot summary log
- `src/services/appBootCoordinator.ts` — phase markers, setRouteShellReady/setBootCompleted integration, Promise.all batch for achievement cache reads, perf summary log after boot
- `src/services/backgroundJobQueue.ts` — idle scheduler (isIdleReady, setRouteShellReady, setBootCompleted, setNavigationChanged), P4-P6 deferral in processNext, [IDLE] logs, countJobQueued integration
