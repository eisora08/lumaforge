import { readProviderStatus } from "./tauri";
import type { ProviderStatusFile } from "./tauri";
import { normalizeProviderId } from "./providerStatusService";

const DEBUG_PROVIDER_STATUS_WRITES = false;

// --- Types ---

export type UpdateStatus = "update-available" | "up-to-date" | "unknown" | "provider-unavailable" | "auth-required" | "provider-updating" | "provider-needs-refresh";

export interface UpdateEntry {
  appId: string;
  status: UpdateStatus;
  reason: string;
  providerId: string;
  providerName: string;
  title: string | null;
  remoteUpdatedAt: string | null;
}

export interface ProviderStatusSummary {
  updates: number;
  upToDate: number;
  unknown: number;
  authRequired: number;
  providerUnavailable: number;
  totalScanned: number;
}

// --- Module-level cache ---

const _cache = new Map<string, ProviderStatusFile>();
const _updateEntries = new Map<string, UpdateEntry>();
const _subscribers = new Set<() => void>();
let _notificationHash: string | null = null;
let _summary: ProviderStatusSummary = { updates: 0, upToDate: 0, unknown: 0, authRequired: 0, providerUnavailable: 0, totalScanned: 0 };

/**
 * Installed-appIds filter for update status reads. When set, getUpdateCount(),
 * getUpdateEntries(), and getUpdateStatus() only return data for games that are
 * actually installed (via Steam, local/manual with executable, or any provider).
 * null = no filter (backward compat before wiring).
 */
let _installedAppIds: Set<string> | null = null;

/** Set the installed-appIds filter. Call when library games change. */
export function setInstalledAppIds(ids: Set<string>): void {
  _installedAppIds = ids.size > 0 ? ids : null;
}

/** Check if a specific appId is in the installed set. Returns true when no filter is active. */
export function isAppIdInstalled(appId: string): boolean {
  return _installedAppIds === null || _installedAppIds.has(appId);
}

// --- Subscription ---

function _notify(): void {
  for (const fn of _subscribers) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function subscribeUpdateStatus(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => { _subscribers.delete(fn); };
}

// --- Cache key helpers ---

function _cacheKey(appId: string, providerId: string): string {
  return `${appId}:${normalizeProviderId(providerId)}`;
}

function _entryKey(appId: string): string {
  return appId;
}

// --- Read helpers ---

export function getUpdateStatus(appId: string): UpdateStatus | undefined {
  if (_installedAppIds !== null && !_installedAppIds.has(appId)) return undefined;
  return _updateEntries.get(appId)?.status;
}

export function getUpdateCount(): number {
  if (_installedAppIds === null) return _summary.updates;
  let count = 0;
  for (const entry of _updateEntries.values()) {
    if (entry.status === "update-available" && _installedAppIds!.has(entry.appId)) count++;
  }
  return count;
}

export function getUpdateEntries(): UpdateEntry[] {
  const entries: UpdateEntry[] = [];
  for (const entry of _updateEntries.values()) {
    if (entry.status === "update-available") {
      if (_installedAppIds !== null && !_installedAppIds.has(entry.appId)) continue;
      entries.push(entry);
    }
  }
  return entries;
}

export function getUpdateEntry(appId: string): UpdateEntry | undefined {
  return _updateEntries.get(appId);
}

export function getTotalScanned(): number {
  return _summary.totalScanned;
}

export function getProviderStatusSummary(): ProviderStatusSummary {
  return { ..._summary };
}

// --- Notification dedup ---

export function getLastResultHash(): string | null {
  return _notificationHash;
}

export function hasNewUpdatesSinceLastNotification(): boolean {
  if (_summary.updates === 0 || !_notificationHash) return false;
  try {
    const lastNotified = localStorage.getItem("lumaforge_lua_scan_notified_hash");
    if (lastNotified === _notificationHash) return false;
  } catch { /* ignore */ }
  return true;
}

export function markUpdatesNotified(): void {
  try {
    if (_notificationHash) {
      localStorage.setItem("lumaforge_lua_scan_notified_hash", _notificationHash);
    }
  } catch { /* ignore */ }
}

export function clearNotifiedHash(): void {
  try {
    localStorage.removeItem("lumaforge_lua_scan_notified_hash");
  } catch { /* ignore */ }
}

// --- Cache mutation ---

function _computeHash(): string {
  const parts: string[] = [];
  for (const [appId, entry] of _updateEntries) {
    parts.push(`${appId}:${entry.status}`);
  }
  parts.sort();
  let hash = 0;
  for (let i = 0; i < parts.length; i++) {
    hash = ((hash << 5) - hash) + parts[i].charCodeAt(0);
    hash |= 0;
  }
  return hash.toString(36);
}

function _rebuildSummary(): void {
  let updates = 0, upToDate = 0, unknown = 0, authRequired = 0, providerUnavailable = 0;
  for (const entry of _updateEntries.values()) {
    switch (entry.status) {
      case "update-available": updates++; break;
      case "up-to-date": upToDate++; break;
      case "auth-required": authRequired++; break;
      case "unknown": unknown++; break;
      default: providerUnavailable++; break;
    }
  }
  _summary = { updates, upToDate, unknown, authRequired, providerUnavailable, totalScanned: _updateEntries.size };
  _notificationHash = _computeHash();
}

function _entryFromCacheFile(appId: string, _providerId: string, statusFile: ProviderStatusFile): UpdateEntry {
  const s = (statusFile.result?.status ?? "unknown") as UpdateStatus;
  return {
    appId,
    status: s,
    reason: statusFile.result?.reason ?? "",
    providerId: statusFile.providerId,
    providerName: statusFile.providerName,
    title: statusFile.remote?.gameName ?? null,
    remoteUpdatedAt: statusFile.remote?.fileModified ?? null,
  };
}

// --- Public mutation API ---

/** Directly add or update an entry without disk read. Used by scanner during scan loop. */
export function addOrUpdateEntry(
  appId: string,
  status: UpdateStatus,
  reason: string,
  providerId: string,
  providerName: string,
  title: string | null,
  remoteUpdatedAt: string | null,
): void {
  _updateEntries.set(_entryKey(appId), { appId, status, reason, providerId, providerName, title, remoteUpdatedAt });
  _rebuildSummary();
}

/** Clear all cached entries (before full refresh). Also notifies subscribers. */
export function clearAllEntries(): void {
  _updateEntries.clear();
  _cache.clear();
  _rebuildSummary();
  _notify();
}

/** Force notify all subscribers (e.g. after a batch operation). */
export function forceNotifySubscribers(): void {
  _notify();
}

/** Remove a single appId from cache. */
export function removeEntry(appId: string): void {
  _updateEntries.delete(_entryKey(appId));
  for (const key of _cache.keys()) {
    if (key.startsWith(`${appId}:`)) _cache.delete(key);
  }
  _rebuildSummary();
}

/** Batch-populate from scan results. Callers should have already called addOrUpdateEntry per item. */
export function applyScanResults(results: { appId: string; status: string; reason: string }[]): void {
  for (const r of results) {
    if (!_updateEntries.has(_entryKey(r.appId))) {
      const status = r.status as UpdateStatus;
      _updateEntries.set(_entryKey(r.appId), {
        appId: r.appId,
        status,
        reason: r.reason,
        providerId: "",
        providerName: "",
        title: null,
        remoteUpdatedAt: null,
      });
    }
  }
  _rebuildSummary();
}

// --- Disk-backed cache ---

async function _loadIntoCache(appId: string, normalizedId: string): Promise<ProviderStatusFile | null> {
  try {
    const statusFile = await readProviderStatus(appId, normalizedId);
    const ck = _cacheKey(appId, normalizedId);
    if (statusFile) {
      _cache.set(ck, statusFile);
    } else {
      _cache.delete(ck);
    }
    return statusFile;
  } catch {
    _cache.delete(_cacheKey(appId, normalizedId));
    return null;
  }
}

/** Get cached provider-status for a specific appId+provider. Auto-loads from disk on first access. */
export async function getCachedProviderStatus(appId: string, providerId: string): Promise<ProviderStatusFile | null> {
  const normalizedId = normalizeProviderId(providerId);
  const ck = _cacheKey(appId, normalizedId);
  if (_cache.has(ck)) return _cache.get(ck) ?? null;
  const statusFile = await _loadIntoCache(appId, normalizedId);
  return statusFile;
}

/** Called after ANY provider-status JSON write. Re-reads from disk, updates cache, notifies subscribers. */
export async function notifyProviderStatusWritten(appId: string, providerId: string): Promise<ProviderStatusFile | null> {
  const normalizedId = normalizeProviderId(providerId);
  const statusFile = await _loadIntoCache(appId, normalizedId);
  const sc = _subscribers.size;

  // Update the entry map
  if (statusFile?.result) {
    const entry = _entryFromCacheFile(appId, normalizedId, statusFile);
    _updateEntries.set(_entryKey(appId), entry);
  } else {
    _updateEntries.delete(_entryKey(appId));
    // Also remove cache entry for this provider
    _cache.delete(_cacheKey(appId, normalizedId));
  }
  _rebuildSummary();

  if (DEBUG_PROVIDER_STATUS_WRITES) {
    console.log(`[PROVIDER_STATUS][WRITE_OK] appid=${appId} provider=${normalizedId} result=${statusFile?.result?.status ?? "unknown"} reason=${statusFile?.result?.reason ?? "n/a"}`);
    console.log(`[PROVIDER_STATUS][CACHE_UPDATE] appid=${appId} provider=${normalizedId} status=${statusFile?.result?.status ?? "unknown"} reason=${statusFile?.result?.reason ?? "n/a"}`);
    if (sc > 0) {
      console.log(`[PROVIDER_STATUS][SUBSCRIBERS_NOTIFY] appid=${appId} provider=${normalizedId} subscribers=${sc}`);
    }
  }

  _notify();
  return statusFile;
}
