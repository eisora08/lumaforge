// ---------------------------------------------------------------------------
// Hard automatic achievement work flags — all default to disabled
// ---------------------------------------------------------------------------
// Manual actions (refresh button, developer command) bypass these flags.
// ---------------------------------------------------------------------------

/** Master switch: if false, all achievement auto work is disabled */
export const ACHIEVEMENTS_AUTO_ENABLED = true;

/** Watcher may start and subscribe to paths, but not process events */
export const ACHIEVEMENT_WATCHER_PROCESS_EVENTS = true;

/** Read achievement cache during boot for first N games */
export const ACHIEVEMENT_READ_CACHE_ON_BOOT = true;

/** Read achievement cache during Store navigation */
export const ACHIEVEMENT_READ_CACHE_ON_STORE = false;

/** Scan achievement schema files automatically */
export const ACHIEVEMENT_SCHEMA_SCAN_AUTO = false;

/** Scan steam user stats automatically */
export const ACHIEVEMENT_STATS_SCAN_AUTO = false;

/** Auto-load achievements when GameDetails mounts (if false, only use cached store data) */
export const ACHIEVEMENT_AUTO_LOAD_GAME_DETAILS = false;

/** Scan steam user game stats automatically during boot/library load */
export const STEAM_USER_STATS_AUTO_SCAN = false;

/** Migrate icon URLs during achievement cache write */
export const ACHIEVEMENT_SCHEMA_MIGRATION_AUTO = false;

/** Download achievement images automatically */
export const ACHIEVEMENT_IMAGE_MIGRATION_AUTO = false;

/** Write achievement cache automatically */
export const ACHIEVEMENT_WRITE_CACHE_AUTO = false;

/** Watch librarycache changes and auto-sync */
export const ACHIEVEMENT_AUTO_SYNC_ENABLED = false;

// ── Debug logging flags (all default false) ──

export const DEBUG_ACH_VERBOSE = false;
export const DEBUG_ACH_SCHEMA = false;
export const DEBUG_ACH_STATS = false;
export const DEBUG_ACH_MIGRATION = false;
export const DEBUG_ACH_CACHE_IO = false;

// ── Skip-log helpers ──

let _watcherProcessSkipLogged = false;
let _cacheReadBootSkipLogged = false;
let _cacheReadStoreSkipLogged = false;
let _schemaScanSkipLogged = false;
let _statsScanSkipLogged = false;
let _schemaMigrateSkipLogged = false;
let _writeCacheSkipLogged = false;
let _autoSyncSkipLogged = false;
let _storeSkipLogged = false;
let _gameDetailsAutoLoadSkipLogged = false;
let _migrateIconsForcedOffLogged = new Set<string>();

export function logWatcherProcessSkipOnce(): void {
  if (!_watcherProcessSkipLogged) {
    _watcherProcessSkipLogged = true;
    console.log("[ACH][WATCHER] processing disabled reason=auto-disabled");
  }
}

export function logCacheReadBootSkipOnce(): void {
  if (!_cacheReadBootSkipLogged) {
    _cacheReadBootSkipLogged = true;
    console.log("[ACH][CACHE_READ_SKIP] reason=auto-disabled surface=boot");
  }
}

export function logCacheReadStoreSkipOnce(): void {
  if (!_cacheReadStoreSkipLogged) {
    _cacheReadStoreSkipLogged = true;
    console.log("[ACH][CACHE_READ_SKIP] reason=auto-disabled surface=store");
  }
}

export function logSchemaMigrateSkipOnce(): void {
  if (!_schemaMigrateSkipLogged) {
    _schemaMigrateSkipLogged = true;
    console.log("[ACH][SCHEMA_MIGRATE_SKIP] reason=disabled-on-cache-write");
  }
}

export function logAutoSyncSkipOnce(): void {
  if (!_autoSyncSkipLogged) {
    _autoSyncSkipLogged = true;
    console.log("[ACH][AUTO_SYNC_SKIP] reason=auto-disabled");
  }
}

export function logStoreSkipOnce(): void {
  if (!_storeSkipLogged) {
    _storeSkipLogged = true;
    console.log("[ACH][STORE_SKIP] reason=store-route-auto-disabled");
  }
}

export function logStatsScanSkipOnce(appId: string, caller: string): void {
  if (!_statsScanSkipLogged) {
    _statsScanSkipLogged = true;
    console.log(`[ACH][STATS_SCAN_SKIP] appid=${appId} reason=auto-disabled caller=${caller}`);
  }
}

export function logSchemaScanSkipOnce(appId: string, caller: string): void {
  if (!_schemaScanSkipLogged) {
    _schemaScanSkipLogged = true;
    console.log(`[ACH][SCHEMA_SCAN_SKIP] appid=${appId} reason=auto-disabled caller=${caller}`);
  }
}

export function logWriteCacheSkipOnce(appId: string, caller: string): void {
  if (!_writeCacheSkipLogged) {
    _writeCacheSkipLogged = true;
    console.log(`[ACH][CACHE_WRITE_SKIP] appid=${appId} reason=auto-disabled caller=${caller}`);
  }
}

export function logGameDetailsAutoLoadSkipOnce(): void {
  if (!_gameDetailsAutoLoadSkipLogged) {
    _gameDetailsAutoLoadSkipLogged = true;
    console.log("[ACH][GAME_DETAILS_AUTO_LOAD_SKIP] reason=auto-disabled");
  }
}

export function logMigrateIconsForcedOff(appId: string, caller: string): void {
  const key = `${appId}:${caller}`;
  if (!_migrateIconsForcedOffLogged.has(key)) {
    _migrateIconsForcedOffLogged.add(key);
    console.log(`[ACH][MIGRATE_ICONS_FORCED_OFF] appid=${appId} caller=${caller} reason=auto-disabled`);
  }
}

export function isStoreRoute(): boolean {
  try {
    return window.location.hash.startsWith("#/store");
  } catch {
    return false;
  }
}
