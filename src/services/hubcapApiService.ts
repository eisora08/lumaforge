import { hubcapHealth, hubcapUserStats, hubcapDepotKeys, hubcapAppStatus } from "./tauri";
import type {
  HubcapHealthResponse,
  HubcapUserStatsResponse,
  HubcapDepotKeysResponse,
  HubcapAppStatusResponse,
} from "./tauri";

const ENABLE_VERBOSE_LOGS = false;
const CACHE_TTL_MS = 5 * 60 * 1000;
const ERROR_CACHE_TTL_MS = 60_000;
const STORAGE_KEY = "lumaforge_hubcap_provider_status";
const PERSIST_TTL_MS = 5 * 60 * 1000;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_LOGS) {
    console.log("[HUBCAP]", ...args);
  }
}

// --- Exported types ---

export type HubcapHealthStatus = "online" | "offline" | "degraded" | "error" | "unknown";

export interface HubcapHealthResult {
  status: HubcapHealthStatus;
  elapsedMs: number;
}

export interface HubcapUsageStats {
  username?: string;
  todayUsage?: number;
  dailyLimit?: number;
  totalKeyUsage?: number;
  generationUsed?: number;
  generationLimit?: number;
  depotKeysCount?: number;
  resetAt?: number | string;
  resetInSeconds?: number;
  remaining?: number;
  plan?: string;
  lastUsedAt?: string;
  apiKeyUsageCount?: number;
  apiKeyExpiresAt?: string;
  canMakeRequests?: boolean;
  userId?: string;
  roleDailyLimit?: number;
  customApiLimit?: number;
  usingCustomApiLimit?: boolean;
  autoUpdateEnabled?: boolean;
}

export interface HubcapDepotKeyStatus {
  status: "ok" | "unauthorized" | "forbidden" | "error" | "no_key" | "network_error";
  count: number;
}

export interface HubcapProviderStatus {
  healthStatus: HubcapHealthStatus;
  apiKeyStatus: "unknown" | "ok" | "missing" | "unauthorized" | "forbidden" | "rate_limited" | "error";
  todayUsage: number | null;
  dailyLimit: number | null;
  totalKeyUsage: number | null;
  resetInSeconds: number | null;
  resetAt: number | string | null;
  resetLabel: string | null;
  lastCheckedAt: number;
  apiKeyUsageCount: number | null;
  apiKeyExpiresAt: string | null;
  canMakeRequests: boolean | null;
  roleDailyLimit: number | null;
  customApiLimit: number | null;
  usingCustomApiLimit: boolean | null;
  plan: string | null;
}

// --- In-memory cache (internal, per-endpoint) ---

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

let healthCache: CacheEntry<HubcapHealthResult> | null = null;
const statsCache = new Map<string, CacheEntry<HubcapUsageStats>>();
let depotCache: CacheEntry<HubcapDepotKeyStatus> | null = null;

function isCacheValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  return entry != null && Date.now() < entry.expiresAt;
}

function createCacheEntry<T>(value: T, ttlMs = CACHE_TTL_MS): CacheEntry<T> {
  return { value, expiresAt: Date.now() + ttlMs };
}

export function clearHubcapCaches(): void {
  healthCache = null;
  statsCache.clear();
  depotCache = null;
  log("caches cleared");
}

// --- Shared persisted provider status + pub/sub ---

let _providerStatus: HubcapProviderStatus | null = null;
let _loadAttempted = false;
const _statusListeners = new Set<(status: HubcapProviderStatus) => void>();

function defaultProviderStatus(): HubcapProviderStatus {
  return {
    healthStatus: "unknown",
    apiKeyStatus: "unknown",
    todayUsage: null,
    dailyLimit: null,
    totalKeyUsage: null,
    resetInSeconds: null,
    resetAt: null,
    resetLabel: null,
    lastCheckedAt: 0,
    apiKeyUsageCount: null,
    apiKeyExpiresAt: null,
    canMakeRequests: null,
    roleDailyLimit: null,
    customApiLimit: null,
    usingCustomApiLimit: null,
    plan: null,
  };
}

function loadPersistedProviderStatus(): HubcapProviderStatus | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HubcapProviderStatus;
    if (parsed && typeof parsed.lastCheckedAt === "number") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function savePersistedProviderStatus(status: HubcapProviderStatus): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(status));
  } catch {
    /* ignore */
  }
}

export function getCachedProviderStatus(): HubcapProviderStatus {
  if (!_loadAttempted) {
    _loadAttempted = true;
    const persisted = loadPersistedProviderStatus();
    if (persisted) {
      _providerStatus = persisted;
      const isStale = Date.now() - persisted.lastCheckedAt > PERSIST_TTL_MS;
      console.log(
        `[HUBCAP][STATUS_CACHE] loaded=true stale=${isStale} today=${persisted.todayUsage} limit=${persisted.dailyLimit} reset=${persisted.resetLabel}`
      );
    } else {
      console.log(`[HUBCAP][STATUS_CACHE] loaded=false stale=false`);
    }
  }
  return _providerStatus ?? defaultProviderStatus();
}

export function subscribeProviderStatus(listener: (status: HubcapProviderStatus) => void): () => void {
  _statusListeners.add(listener);
  return () => {
    _statusListeners.delete(listener);
  };
}

function notifyProviderStatusListeners(status: HubcapProviderStatus): void {
  for (const fn of _statusListeners) {
    try {
      fn(status);
    } catch {
      /* ignore */
    }
  }
}

function computeResetLabel(
  resetInSeconds: number | null | undefined,
  resetAt: number | string | null | undefined,
): string | null {
  if (resetInSeconds != null && resetInSeconds > 0) {
    const d = Math.floor(resetInSeconds / 86400);
    const h = Math.floor((resetInSeconds % 86400) / 3600);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h`;
    return `${Math.floor(resetInSeconds / 60)}m`;
  }
  if (resetAt != null) {
    const ts = typeof resetAt === "number" ? resetAt * 1000 : new Date(resetAt).getTime();
    if (Number.isFinite(ts)) {
      const diff = ts - Date.now();
      if (diff > 0) {
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h`;
        return `${Math.floor(diff / 60000)}m`;
      }
    }
  }
  return null;
}

export async function refreshHubcapStatus(
  baseUrl: string,
  apiKey: string,
): Promise<HubcapProviderStatus> {
  clearHubcapCaches();

  const [healthResult, statsResult, depotResult] = await Promise.all([
    checkHubcapHealth(baseUrl),
    apiKey ? fetchHubcapUserStats(baseUrl, apiKey) : Promise.resolve(null),
    apiKey ? fetchHubcapDepotKeys(baseUrl, apiKey) : Promise.resolve(null),
  ]);

  let apiKeyStatus: HubcapProviderStatus["apiKeyStatus"] = "unknown";

  if (!apiKey) {
    apiKeyStatus = "missing";
  } else if (depotResult) {
    if (depotResult.status === "ok") apiKeyStatus = "ok";
    else if (depotResult.status === "unauthorized") apiKeyStatus = "unauthorized";
    else if (depotResult.status === "forbidden") apiKeyStatus = "forbidden";
    else if (depotResult.status === "network_error") apiKeyStatus = "error";
  }

  const todayUsage = statsResult?.todayUsage ?? null;
  const dailyLimit = statsResult?.dailyLimit ?? null;
  const totalKeyUsage = (statsResult?.apiKeyUsageCount ?? statsResult?.totalKeyUsage) ?? null;
  const resetInSeconds = statsResult?.resetInSeconds ?? null;
  const resetAt = statsResult?.resetAt ?? null;
  const resetLabel = computeResetLabel(resetInSeconds, resetAt);

  /** Effective daily limit: customApiLimit when usingCustomApiLimit, else dailyLimit or roleDailyLimit */
  const effectiveLimit = statsResult?.usingCustomApiLimit && statsResult?.customApiLimit != null
    ? statsResult.customApiLimit
    : (statsResult?.roleDailyLimit ?? statsResult?.dailyLimit);

  if (statsResult) {
    console.log(
      `[HUBCAP][STATS_MAPPED] todayUsage=${todayUsage} dailyLimit=${dailyLimit} totalKeyUsage=${totalKeyUsage} apiKeyExpiresAt=${statsResult.apiKeyExpiresAt ?? "null"} canMakeRequests=${statsResult.canMakeRequests ?? "null"}`,
    );
  }

  const status: HubcapProviderStatus = {
    healthStatus: healthResult.status,
    apiKeyStatus,
    todayUsage,
    dailyLimit,
    totalKeyUsage,
    resetInSeconds,
    resetAt,
    resetLabel,
    lastCheckedAt: Date.now(),
    apiKeyUsageCount: statsResult?.apiKeyUsageCount ?? null,
    apiKeyExpiresAt: statsResult?.apiKeyExpiresAt ?? null,
    canMakeRequests: statsResult?.canMakeRequests ?? null,
    roleDailyLimit: statsResult?.roleDailyLimit ?? null,
    customApiLimit: statsResult?.customApiLimit ?? null,
    usingCustomApiLimit: statsResult?.usingCustomApiLimit ?? null,
    plan: statsResult?.plan ?? null,
  };

  _providerStatus = status;
  savePersistedProviderStatus(status);
  notifyProviderStatusListeners(status);

  console.log(
    `[HUBCAP][STATUS_SAVE] today=${todayUsage} limit=${effectiveLimit} reset=${resetLabel} plan=${status.plan} canMakeRequests=${status.canMakeRequests}`,
  );
  return status;
}

// --- Per-endpoint fetch functions (with internal cache) ---

function mapHealthResponse(r: HubcapHealthResponse): HubcapHealthResult {
  return { status: r.status as HubcapHealthStatus, elapsedMs: r.elapsed_ms };
}

function mapStatsResponse(r: HubcapUserStatsResponse): HubcapUsageStats {
  return {
    username: r.username ?? undefined,
    todayUsage: r.today_usage ?? undefined,
    dailyLimit: r.daily_limit ?? undefined,
    totalKeyUsage: r.total_key_usage ?? undefined,
    generationUsed: r.generation_used ?? undefined,
    generationLimit: r.generation_limit ?? undefined,
    depotKeysCount: r.depot_keys_count ?? undefined,
    resetAt: r.reset_at ?? undefined,
    resetInSeconds: r.reset_in_seconds ?? undefined,
    remaining: r.remaining ?? undefined,
    plan: r.plan ?? undefined,
    lastUsedAt: r.last_used_at ?? undefined,
    apiKeyUsageCount: r.api_key_usage_count ?? undefined,
    apiKeyExpiresAt: r.api_key_expires_at ?? undefined,
    canMakeRequests: r.can_make_requests ?? undefined,
    userId: r.user_id ?? undefined,
    roleDailyLimit: r.role_daily_limit ?? undefined,
    customApiLimit: r.custom_api_limit ?? undefined,
    usingCustomApiLimit: r.using_custom_api_limit ?? undefined,
    autoUpdateEnabled: r.auto_update_enabled ?? undefined,
  };
}

function mapDepotResponse(r: HubcapDepotKeysResponse): HubcapDepotKeyStatus {
  return { status: r.status as HubcapDepotKeyStatus["status"], count: r.count };
}

export async function checkHubcapHealth(baseUrl: string): Promise<HubcapHealthResult> {
  if (isCacheValid(healthCache)) {
    log("health cache hit");
    return healthCache.value;
  }

  try {
    const raw = await hubcapHealth(baseUrl);
    const result = mapHealthResponse(raw);
    console.log(`[HUBCAP][HEALTH] status=${raw.status} elapsedMs=${raw.elapsed_ms}`);
    healthCache = createCacheEntry(result);
    return result;
  } catch (error) {
    const message = String(error);
    const isTimeout = message.toLowerCase().includes("timeout");
    const status: HubcapHealthStatus = isTimeout ? "offline" : "error";
    const result: HubcapHealthResult = { status, elapsedMs: 0 };
    healthCache = createCacheEntry(result, ERROR_CACHE_TTL_MS);
    console.log(`[HUBCAP][HEALTH] status=${status} error="${message}"`);
    return result;
  }
}

export async function fetchHubcapUserStats(
  baseUrl: string,
  apiKey: string,
): Promise<HubcapUsageStats | null> {
  const cacheKey = `${baseUrl}|${apiKey.slice(0, 8)}`;
  const cached = statsCache.get(cacheKey);
  if (isCacheValid(cached)) {
    log("stats cache hit");
    return cached.value;
  }

  log("fetching user stats");
  console.log(`[HUBCAP][STATS_REQUEST] baseUrl=${baseUrl} hasApiKey=true`);
  console.log(`[HUBCAP][USAGE_REFRESH] started=true`);

  try {
    const raw = await hubcapUserStats(baseUrl, apiKey);
    console.log(`[HUBCAP][USAGE_REFRESH] done=true status=${raw.status}`);

    if (!raw.ok) {
      if (raw.status === "unauthorized") console.log(`[HUBCAP][AUTH] status=unauthorized`);
      else if (raw.status === "forbidden") console.log(`[HUBCAP][AUTH] status=forbidden`);
      else if (raw.status === "rate_limited") console.log(`[HUBCAP][RATE_LIMIT]`);

      statsCache.set(cacheKey, createCacheEntry({}, ERROR_CACHE_TTL_MS));
      return null;
    }

    const stats = mapStatsResponse(raw);
    console.log(
      `[HUBCAP][STATS_RAW] daily_usage=${raw.today_usage ?? "null"} daily_limit=${raw.daily_limit ?? "null"} api_key_usage_count=${raw.api_key_usage_count ?? "null"} expires=${raw.api_key_expires_at ?? "null"} can_make_requests=${raw.can_make_requests ?? "null"}`,
    );
    log("stats fetched", stats);
    statsCache.set(cacheKey, createCacheEntry(stats));
    return stats;
  } catch (error) {
    console.log(`[HUBCAP][USAGE_REFRESH] done=true status=error error="${String(error)}"`);
    statsCache.set(cacheKey, createCacheEntry({}, ERROR_CACHE_TTL_MS));
    return null;
  }
}

export async function fetchHubcapDepotKeys(
  baseUrl: string,
  apiKey: string,
): Promise<HubcapDepotKeyStatus> {
  if (isCacheValid(depotCache)) {
    log("depot cache hit");
    return depotCache.value;
  }

  log("fetching depot keys");

  try {
    const raw = await hubcapDepotKeys(baseUrl, apiKey);
    const entry = mapDepotResponse(raw);
    console.log(`[HUBCAP][DEPOT_KEYS] status=${raw.status} count=${raw.count}`);
    depotCache = createCacheEntry(entry, raw.status === "ok" ? CACHE_TTL_MS : ERROR_CACHE_TTL_MS);
    return entry;
  } catch (error) {
    const entry: HubcapDepotKeyStatus = { status: "error", count: 0 };
    depotCache = createCacheEntry(entry, ERROR_CACHE_TTL_MS);
    console.log(`[HUBCAP][DEPOT_KEYS] status=network_error count=0 error="${String(error)}"`);
    return entry;
  }
}

// ---------------------------------------------------------------------------
// HubcapDB per-app status (/api/v1/status/<appid>)
// Metadata-only — never downloads packages or modifies Lua files.
// ---------------------------------------------------------------------------

export interface HubcapAppStatusRemote {
  status: string;
  gameName?: string;
  manifestFileExists?: boolean;
  autoUpdateEnabled?: boolean | null;
  updateInProgress?: boolean;
  fileSize?: number;
  fileModified?: string;
  fileAgeDays?: number;
  needsUpdate?: boolean;
  updateReason?: string | null;
  timestamp?: string;
}

export type HubcapAppUpdateStatus =
  | "provider-unavailable"
  | "provider-updating"
  | "provider-needs-refresh"
  | "unknown"
  | "update-available"
  | "up-to-date";

export interface HubcapAppUpdateResult {
  status: HubcapAppUpdateStatus;
  reason: string;
  remote: HubcapAppStatusRemote | null;
}

export interface LocalPackageMetadata {
  fileModifiedAtInstall?: string;
  fileSizeAtInstall?: number;
  metadataSource?: "local-lua" | "remote" | "unknown";
}

// --- In-memory caches ---

const _appStatusCache = new Map<string, HubcapAppStatusRemote>();
const _localPackageMetadata = new Map<string, LocalPackageMetadata>();

/** Register local install metadata for an appId so update checks can compare. */
export function setLocalPackageMetadata(appId: string, meta: LocalPackageMetadata): void {
  _localPackageMetadata.set(appId, meta);
}

/** Fetch remote app status from HubcapDB. */
export async function fetchHubcapAppStatus(
  baseUrl: string,
  apiKey: string,
  appId: string,
): Promise<HubcapAppStatusRemote | null> {
  if (!apiKey) {
    console.log(`[PACKAGE][CHECK_REMOTE] appid=${appId} skipped=no-api-key`);
    return null;
  }

  let raw: HubcapAppStatusResponse;
  try {
    raw = await hubcapAppStatus(baseUrl, apiKey, appId);
  } catch (error) {
    console.log(`[PACKAGE][CHECK_REMOTE] appid=${appId} error="${String(error)}"`);
    return null;
  }

  if (!raw.ok) {
    console.log(`[PACKAGE][CHECK_REMOTE] appid=${appId} status=${raw.status}`);
    return null;
  }

  const remote: HubcapAppStatusRemote = {
    status: raw.status,
    gameName: raw.game_name ?? undefined,
    manifestFileExists: raw.manifest_file_exists ?? undefined,
    autoUpdateEnabled: raw.auto_update_enabled,
    updateInProgress: raw.update_in_progress ?? undefined,
    fileSize: raw.file_size ?? undefined,
    fileModified: raw.file_modified ?? undefined,
    fileAgeDays: raw.file_age_days ?? undefined,
    needsUpdate: raw.needs_update ?? undefined,
    updateReason: raw.update_reason ?? undefined,
    timestamp: raw.timestamp ?? undefined,
  };

  _appStatusCache.set(appId, remote);

  console.log(
    `[PACKAGE][CHECK_REMOTE] appid=${appId} status=${remote.status} manifestExists=${remote.manifestFileExists} updateInProgress=${remote.updateInProgress} needsUpdate=${remote.needsUpdate} fileModified=${remote.fileModified ?? "null"} fileSize=${remote.fileSize ?? "null"}`,
  );
  return remote;
}

/** Get the last-fetched remote status without re-fetching. */
export function getCachedHubcapAppStatus(appId: string): HubcapAppStatusRemote | undefined {
  return _appStatusCache.get(appId);
}

/**
 * Compare remote HubcapDB status against local install metadata.
 * Returns a result with status + reason string.
 *
 * Rules (modelled after the spec):
 *   1. manifest_file_exists === false   → provider-unavailable / manifest-missing
 *   2. status !== "available"            → provider-unavailable / provider-status-<status>
 *   3. update_in_progress === true       → provider-updating / update-in-progress
 *   4. needs_update === true             → provider-needs-refresh / <reason>
 *   5. No local metadata                → unknown / no-local-data-for-comparison
 *   6. local metadata from local Lua file:
 *      a. remote fileModified > local   → update-available / remote-newer-than-local-lua
 *      b. remote fileModified <= local  → up-to-date / local-lua-not-older
 *      c. fileSize skipped (Lua file size != package ZIP size)
 *   7. local metadata from remote/package:
 *      a. remote fileModified > local   → update-available / remote-newer
 *      b. remote fileSize !== local     → update-available / size-differs
 *      c. Otherwise                     → up-to-date / remote-not-newer
 */
export function checkHubcapAppUpdate(
  appId: string,
  remote: HubcapAppStatusRemote,
  local?: LocalPackageMetadata,
): HubcapAppUpdateResult {
  const localMeta = local ?? _localPackageMetadata.get(appId);

  // Rule 1
  if (remote.manifestFileExists === false) {
    const result: HubcapAppUpdateResult = { status: "provider-unavailable", reason: "manifest-missing", remote };
    logResult(appId, result);
    return result;
  }

  // Rule 2
  if (remote.status !== "available") {
    const result: HubcapAppUpdateResult = { status: "provider-unavailable", reason: `provider-status-${remote.status}`, remote };
    logResult(appId, result);
    return result;
  }

  // Rule 3
  if (remote.updateInProgress === true) {
    const result: HubcapAppUpdateResult = { status: "provider-updating", reason: "update-in-progress", remote };
    logResult(appId, result);
    return result;
  }

  // Rule 4
  if (remote.needsUpdate === true) {
    const result: HubcapAppUpdateResult = { status: "provider-needs-refresh", reason: remote.updateReason || "provider-needs-update", remote };
    logResult(appId, result);
    return result;
  }

  // Rule 5 — no local metadata
  if (!localMeta || (localMeta.fileModifiedAtInstall == null && localMeta.fileSizeAtInstall == null)) {
    const result: HubcapAppUpdateResult = { status: "unknown", reason: "no-local-data-for-comparison", remote };
    logResult(appId, result);
    return result;
  }

  const source = localMeta.metadataSource ?? "remote";

  // Rule 6 — local metadata came from a local Lua file
  if (source === "local-lua") {
    if (remote.fileModified && localMeta.fileModifiedAtInstall) {
      const remoteTs = new Date(remote.fileModified).getTime();
      const localTs = new Date(localMeta.fileModifiedAtInstall).getTime();
      if (!isNaN(remoteTs) && !isNaN(localTs) && remoteTs > localTs) {
        const result: HubcapAppUpdateResult = { status: "update-available", reason: "remote-newer-than-local-lua", remote };
        logResult(appId, result);
        return result;
      }
    }
    // fileSize comparison skipped — Lua file size != package ZIP size
    const result: HubcapAppUpdateResult = { status: "up-to-date", reason: "local-lua-not-older", remote };
    logResult(appId, result);
    return result;
  }

  // Rule 7 — local metadata from remote/package download

  // Rule 7a — remote fileModified > local
  if (remote.fileModified && localMeta.fileModifiedAtInstall) {
    const remoteTs = new Date(remote.fileModified).getTime();
    const localTs = new Date(localMeta.fileModifiedAtInstall).getTime();
    if (!isNaN(remoteTs) && !isNaN(localTs) && remoteTs > localTs) {
      const result: HubcapAppUpdateResult = { status: "update-available", reason: "remote-newer", remote };
      logResult(appId, result);
      return result;
    }
  }

  // Rule 7b — fileSize differs
  if (remote.fileSize != null && localMeta.fileSizeAtInstall != null && remote.fileSize !== localMeta.fileSizeAtInstall) {
    const result: HubcapAppUpdateResult = { status: "update-available", reason: "size-differs", remote };
    logResult(appId, result);
    return result;
  }

  // Rule 7c — up to date
  const result: HubcapAppUpdateResult = { status: "up-to-date", reason: "remote-not-newer", remote };
  logResult(appId, result);
  return result;
}

function logResult(appId: string, result: HubcapAppUpdateResult): void {
  console.log(`[PACKAGE][CHECK_RESULT] appid=${appId} status=${result.status} reason=${result.reason}`);
}
