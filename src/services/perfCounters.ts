// ---------------------------------------------------------------------------
// Lightweight performance counters for boot/route/idle diagnostics.
// Module-level — survives mount/unmount. Logs summary once after boot settles.
// Also includes React render audit counters — dev-only, no behavior impact.
// Also includes disk/JSON audit counters for Prompt 8.
// ---------------------------------------------------------------------------

let _started = false;
let _bootStart = 0;
let _invokes = 0;
let _appinfoAttempts = 0;
let _appinfoPreRustSkips = 0;
let _appinfoRustSkips = 0;
let _appinfoWrites = 0;
let _snapshotWrites = 0;
let _snapshotSkips = 0;
let _mediaClassify = 0;
let _jobsQueued = 0;
let _storeCacheSource: "complete-cache" | "partial-cache" | "rebuild" | "skeleton" = "skeleton";
let _bootPhaseLabel = "init";
let _summaryLogged = false;

// Library state machine counters
let _libraryApplied = 0;
let _librarySkipped = 0;
let _libraryReconciledDiffs = 0;
let _libraryEmptyBlocked = 0;

// ── Disk/JSON audit counters (Prompt 8) ──
let _diskReadsBoot = 0;
let _diskWritesBoot = 0;
let _diskReadsRoute = 0;
let _diskWritesRoute = 0;
let _appinfoReads = 0;
let _appinfoBatchReads = 0;
let _appinfoCacheHits = 0;
let _manifestReads = 0;
let _storeJsonReads = 0;
let _achievementReads = 0;
let _mediaPathChecksBatch = 0;
let _mediaPathChecksSingle = 0;
let _storeDetailsReads = 0;
let _sqliteReads = 0;

// ── Render audit counters (Phase 1) ──
const _renderCounts: Record<string, number> = {};
let _renderSession = 0;
let _lastRenderLog = 0;
const RENDER_LOG_INTERVAL = 5000; // ms between auto-logs

export function countRender(componentName: string): void {
  _renderCounts[componentName] = (_renderCounts[componentName] ?? 0) + 1;
}
export function startRenderSession(): void {
  _renderSession++;
  // Reset per-route render counts — prevents misleading cumulative totals
  // across route transitions (Phase 8: Critical Route Isolation).
  for (const key of Object.keys(_renderCounts)) delete _renderCounts[key];
  _lastRenderLog = 0;
}
export function getRenderCount(name: string): number { return _renderCounts[name] ?? 0; }
export function getAllRenderCounts(): Record<string, number> {
  const snapshot: Record<string, number> = {};
  for (const key of Object.keys(_renderCounts)) {
    snapshot[key] = _renderCounts[key];
  }
  return snapshot;
}

export function logRenderSummary(label?: string): void {
  const now = Date.now();
  if (_lastRenderLog !== 0 && now - _lastRenderLog < RENDER_LOG_INTERVAL) return;
  _lastRenderLog = now;
  const sorted = Object.entries(_renderCounts)
    .filter(([, c]) => c > 0)
    .sort(([, a], [, b]) => b - a);
  const top = sorted.slice(0, 20).map(([n, c]) => `${n}=${c}`).join(" ");
  if (sorted.length > 0) {
    console.log(`[RENDER][SUM]${label ? ` ${label}` : ""} total=${sorted.reduce((s, [, c]) => s + c, 0)} components=${sorted.length} session=${_renderSession} ${top}`);
  }
}

export function initPerfCounters(): void {
  if (_started) return;
  _started = true;
  _bootStart = Date.now();
  _invokes = 0;
  _appinfoAttempts = 0;
  _appinfoPreRustSkips = 0;
  _appinfoRustSkips = 0;
  _appinfoWrites = 0;
  _snapshotWrites = 0;
  _snapshotSkips = 0;
  _mediaClassify = 0;
  _jobsQueued = 0;
  _storeCacheSource = "skeleton";
  _summaryLogged = false;
  _bootPhaseLabel = "init";
  _libraryApplied = 0;
  _librarySkipped = 0;
  _libraryReconciledDiffs = 0;
  _libraryEmptyBlocked = 0;
  // Reset disk counters
  _diskReadsBoot = 0;
  _diskWritesBoot = 0;
  _diskReadsRoute = 0;
  _diskWritesRoute = 0;
  _appinfoReads = 0;
  _appinfoBatchReads = 0;
  _appinfoCacheHits = 0;
  _manifestReads = 0;
  _storeJsonReads = 0;
  _achievementReads = 0;
  _mediaPathChecksBatch = 0;
  _mediaPathChecksSingle = 0;
  _storeDetailsReads = 0;
  _sqliteReads = 0;
  // Reset render counters
  for (const key of Object.keys(_renderCounts)) delete _renderCounts[key];
  _renderSession = 0;
  _lastRenderLog = 0;
}

export function countInvoke(): void { _invokes++; }
export function countAppinfoAttempt(): void { _appinfoAttempts++; }
export function countAppinfoPreRustSkip(): void { _appinfoPreRustSkips++; }
export function countAppinfoRustSkip(): void { _appinfoRustSkips++; }
export function countAppinfoWrite(): void { _appinfoWrites++; }
export function countSnapshotWrite(): void { _snapshotWrites++; }
export function countSnapshotSkip(): void { _snapshotSkips++; }
export function countMediaClassify(): void { _mediaClassify++; }
export function countJobQueued(): void { _jobsQueued++; }
export function setStoreCacheSource(source: typeof _storeCacheSource): void { _storeCacheSource = source; }
export function setBootPhaseLabel(label: string): void { _bootPhaseLabel = label; }
export function countLibraryApplied(): void { _libraryApplied++; }
export function countLibrarySkipped(): void { _librarySkipped++; }
export function countLibraryReconciledDiff(): void { _libraryReconciledDiffs++; }
export function countLibraryEmptyBlocked(): void { _libraryEmptyBlocked++; }

// ── Disk audit counters ──
export function countDiskReadBoot(n = 1): void { _diskReadsBoot += n; }
export function countDiskWriteBoot(n = 1): void { _diskWritesBoot += n; }
export function countDiskReadRoute(n = 1): void { _diskReadsRoute += n; }
export function countDiskWriteRoute(n = 1): void { _diskWritesRoute += n; }

// ── Interaction state (Phase 1: Interaction First Pass) ──
// Tracks all user interaction types to hard-pause background work.
// Navigation: 5s cooldown; Scroll/Input/Click: 2s cooldown.
let _lastNavigationTime = 0;
let _lastScrollTime = 0;
let _lastInputTime = 0;
const INTERACTION_NAV_IDLE_MS = 5000;
const INTERACTION_SCROLL_INPUT_IDLE_MS = 2000;

let _lastInteractionTime = 0;

export function markNavigation(): void {
  _lastNavigationTime = Date.now();
  _lastInteractionTime = Date.now();
}

export function markUserInteraction(reason: string): void {
  _lastInteractionTime = Date.now();
  if (reason === "navigation") {
    _lastNavigationTime = Date.now();
  } else if (reason === "scroll") {
    _lastScrollTime = Date.now();
  } else if (["click", "key", "pointer", "touch"].includes(reason)) {
    _lastInputTime = Date.now();
  }
}

export function isRecentlyNavigated(thresholdMs = 2000): boolean {
  return Date.now() - _lastNavigationTime < thresholdMs;
}

export function getMsSinceLastNavigation(): number {
  return _lastNavigationTime === 0 ? Infinity : Date.now() - _lastNavigationTime;
}

export function isInteractionBusy(): boolean {
  const now = Date.now();
  if (_lastNavigationTime > 0 && now - _lastNavigationTime < INTERACTION_NAV_IDLE_MS) return true;
  if (_lastScrollTime > 0 && now - _lastScrollTime < INTERACTION_SCROLL_INPUT_IDLE_MS) return true;
  if (_lastInputTime > 0 && now - _lastInputTime < INTERACTION_SCROLL_INPUT_IDLE_MS) return true;
  return false;
}

export function getMsSinceLastInteraction(): number {
  return _lastInteractionTime === 0 ? Infinity : Date.now() - _lastInteractionTime;
}

// ── Module-level interaction listeners ──
// These fire-and-set-timestamp only; no references held, no cleanup needed during app lifetime.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("scroll", () => markUserInteraction("scroll"), { passive: true, capture: true });
  document.addEventListener("click", () => markUserInteraction("click"), { passive: true, capture: true });
  document.addEventListener("keydown", () => markUserInteraction("key"), { passive: true, capture: true });
  document.addEventListener("pointerdown", () => markUserInteraction("pointer"), { passive: true, capture: true });
  document.addEventListener("touchstart", () => markUserInteraction("touch"), { passive: true, capture: true });
}

export function countAppinfoRead(n = 1): void { _appinfoReads += n; }
export function countAppinfoBatchRead(n = 1): void { _appinfoBatchReads += n; }
export function countAppinfoCacheHit(n = 1): void { _appinfoCacheHits += n; }
export function countManifestRead(n = 1): void { _manifestReads += n; }
export function countStoreJsonRead(n = 1): void { _storeJsonReads += n; }
export function countAchievementRead(n = 1): void { _achievementReads += n; }
export function countMediaPathCheckBatch(n = 1): void { _mediaPathChecksBatch += n; }
export function countMediaPathCheckSingle(n = 1): void { _mediaPathChecksSingle += n; }
export function countStoreDetailsRead(n = 1): void { _storeDetailsReads += n; }
export function countSqliteRead(n = 1): void { _sqliteReads += n; }

  export function logBootPerfSummary(): void {
  if (_summaryLogged) return;
  _summaryLogged = true;
  const elapsed = Date.now() - _bootStart;
  console.log(
    `[PERF][BOOT] invokes=${_invokes} appinfoAttempts=${_appinfoAttempts} ` +
    `appinfoPreRustSkips=${_appinfoPreRustSkips} appinfoRustSkips=${_appinfoRustSkips} ` +
    `appinfoWrites=${_appinfoWrites} snapshotWrites=${_snapshotWrites} ` +
    `snapshotSkips=${_snapshotSkips} mediaClassify=${_mediaClassify} ` +
    `jobsQueued=${_jobsQueued} storeCacheSource=${_storeCacheSource} ` +
    `phase=${_bootPhaseLabel} elapsedMs=${elapsed}`
  );
  console.log(
    `[PERF][LIBRARY] applied=${_libraryApplied} skipped=${_librarySkipped} ` +
    `reconciledDiffs=${_libraryReconciledDiffs} emptyBlocked=${_libraryEmptyBlocked} ` +
    `elapsedMs=${Date.now() - _bootStart + "(boot)"}`
  );
  // Phase 14: Disk/JSON hot path summary
  const totalReads = _diskReadsBoot + _diskReadsRoute;
  console.log(
    `[PERF][DISK] bootReads=${_diskReadsBoot} bootWrites=${_diskWritesBoot} ` +
    `routeReads=${_diskReadsRoute} routeWrites=${_diskWritesRoute} ` +
    `appinfoReads=${_appinfoReads} appinfoBatchReads=${_appinfoBatchReads} ` +
    `appinfoCacheHits=${_appinfoCacheHits} manifestReads=${_manifestReads} ` +
    `storeJsonReads=${_storeJsonReads} achievementReads=${_achievementReads} ` +
    `storeDetailsReads=${_storeDetailsReads} mediaPathBatch=${_mediaPathChecksBatch} ` +
    `mediaPathSingle=${_mediaPathChecksSingle} sqliteReads=${_sqliteReads} ` +
    `elapsedMs=${elapsed}`
  );
  const hitRate = totalReads > 0 ? Math.round(_appinfoCacheHits / (_appinfoCacheHits + _appinfoReads) * 100) : 0;
  console.log(
    `[PERF][CACHE_HIT_RATE] area=appinfo hits=${_appinfoCacheHits} misses=${_appinfoReads} hitRate=${hitRate}%`
  );

  // Phase 2: Data source map (logged once on boot)
  console.log(`[DATA_SOURCE_MAP] snapshot=initial-ui sqlite=runtime-index appinfo=persistence manifest=media-index storeCache=discover achievement=visible-only`);

  // Phase 11: Boot disk budget check
  if (_diskReadsBoot > 500) {
    console.warn(`[DISK][BUDGET_WARN] phase=boot reads=${_diskReadsBoot} budget=500 exceeded=${_diskReadsBoot - 500}`);
  }
  if (_diskWritesBoot > 200) {
    console.warn(`[DISK][BUDGET_WARN] phase=boot writes=${_diskWritesBoot} budget=200 exceeded=${_diskWritesBoot - 200}`);
  }
}

// ── Phase 12: Route disk budget ──
// Call at the end of route transitions to check per-route disk I/O.
const ROUTE_READ_BUDGET = 50;
export function checkRouteDiskBudget(routeName: string): void {
  const reads = _diskReadsRoute;
  if (reads > ROUTE_READ_BUDGET) {
    console.warn(`[DISK][BUDGET_WARN] phase=route route=${routeName} reads=${reads} budget=${ROUTE_READ_BUDGET} exceeded=${reads - ROUTE_READ_BUDGET}`);
  }
  _diskReadsRoute = 0;
  _diskWritesRoute = 0;
}
