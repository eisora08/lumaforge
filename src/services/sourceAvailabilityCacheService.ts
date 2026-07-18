import { invoke } from "@tauri-apps/api/core";
import type { PackageSource } from "../types/package";

const ENABLE_VERBOSE_SOURCE_LOGS = false;
const SOURCE_AVAILABILITY_CACHE_TTL_S = 86400; // 24 hours
const SOURCE_AVAILABILITY_CACHE_MAX = 1000;
const DEBUG_SOURCE_CACHE = false;

export type SourceCheckStatus =
  | "idle"
  | "checking"
  | "ready"
  | "none"
  | "needs-configuration"
  | "error"
  | "timeout";

const CURRENT_SCHEMA_VERSION = 2;

export interface SourceAvailabilitySourceEntry {
  id: string;
  name: string;
  type: string;
  status: string;
  packageUrl?: string;
  updatedAt?: number;
}

export interface SourceAvailabilityGameEntry {
  appId: string;
  title: string;
  status: SourceCheckStatus;
  luaReady: boolean;
  selectedSourceId?: string;
  availableSources: SourceAvailabilitySourceEntry[];
  sourceCount: number;
  totalProviderCount: number;
  updatedAt: number;
}

export interface SourceAvailabilityIndex {
  version: number;
  updatedAt: number;
  games: Record<string, SourceAvailabilityGameEntry>;
}

/**
 * Classify provider outcomes into a SourceCheckStatus.
 * - "ready"                 → at least one provider returned an available source
 * - "needs-configuration"   → no available source, but at least one provider was skipped
 *                             due to missing API key or not enabled (requiresApiKey && !hasAuth)
 * - "error"                 → no available source, at least one provider returned an HTTP error
 * - "timeout"               → no available source, at least one provider timed out
 * - "none"                  → no available source, all providers returned empty results
 *                             (game genuinely does not exist on any configured provider)
 */
export function classifyProviderOutcomes(sources: PackageSource[]): SourceCheckStatus {
  const hasAvailable = sources.some((s) => s.available);
  if (hasAvailable) return "ready";

  // No available sources — determine WHY based on provider signals
  let hasConfigIssue = false;
  let hasError = false;
  let hasTimeout = false;
  let hasSkipped = false;

  for (const s of sources) {
    if (s.available) continue;
    const err = (s.error ?? "").toLowerCase();
    if (s.requiresApiKey && !s.hasAuth) {
      hasConfigIssue = true;
    } else if (s.statusCode && s.statusCode >= 400) {
      hasError = true;
    } else if (err.includes("timeout")) {
      hasTimeout = true;
    } else if (err.includes("cooldown") || err.includes("skipped") || err.includes("disabled")) {
      hasSkipped = true;
    } else if (err.includes("missing api key") || err.includes("api key") || err.includes("no key")) {
      hasConfigIssue = true;
    } else if (err.includes("unauthorized") || err.includes("forbidden")) {
      hasError = true;
    }
  }

  // Priority: config issue first (most actionable for user), then error, timeout, skipped
  if (hasConfigIssue) return "needs-configuration";
  if (hasError) return "error";
  if (hasTimeout) return "timeout";
  if (hasSkipped) return "needs-configuration"; // all providers skipped = config issue
  return "none";
}

let cachedIndex: SourceAvailabilityIndex | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loadPromise: Promise<SourceAvailabilityIndex> | null = null;
let _migratedSchemaV1 = false;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log("[SourceCache]", ...args);
  }
}

function migrateSchemaV1(index: SourceAvailabilityIndex): void {
  if (index.version >= CURRENT_SCHEMA_VERSION || _migratedSchemaV1) return;
  _migratedSchemaV1 = true;
  const poisoned: string[] = [];
  for (const [appId, entry] of Object.entries(index.games)) {
    // Remove poisoned "none" entries (status=none but no query was possible)
    // These will be re-classified correctly on next access
    if (entry.status === "none" && entry.availableSources.length === 0 && entry.totalProviderCount === 0) {
      poisoned.push(appId);
      delete index.games[appId];
    }
  }
  index.version = CURRENT_SCHEMA_VERSION;
  if (poisoned.length > 0) {
    console.log(`[SOURCE_AVAIL][SCHEMA_MIGRATE] v1→v2 removed-poisoned=${poisoned.length} remaining=${Object.keys(index.games).length}`);
  }
}

async function loadFromDisk(): Promise<SourceAvailabilityIndex> {
  try {
    const result = await invoke<SourceAvailabilityIndex | null>(
      "read_source_availability_index"
    );
    if (result) {
      migrateSchemaV1(result);
      log(`loaded entries ${Object.keys(result.games).length}`);
      return result;
    }
  } catch {
    log("load failed");
  }
  return { version: CURRENT_SCHEMA_VERSION, updatedAt: 0, games: {} };
}

export async function loadSourceAvailabilityIndex(): Promise<SourceAvailabilityIndex> {
  if (cachedIndex) return cachedIndex;
  if (loadPromise) return loadPromise;
  loadPromise = loadFromDisk().then((idx) => {
    cachedIndex = idx;
    return idx;
  });
  return loadPromise;
}

function pruneCache(): number {
  if (!cachedIndex) return 0;
  const games = cachedIndex.games;
  const entries = Object.entries(games);
  const now = Math.floor(Date.now() / 1000);
  const expiredThreshold = now - SOURCE_AVAILABILITY_CACHE_TTL_S;

  const active = entries.filter(([_, v]) => v.updatedAt >= expiredThreshold);
  if (active.length > SOURCE_AVAILABILITY_CACHE_MAX) {
    active.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    active.length = SOURCE_AVAILABILITY_CACHE_MAX;
  }

  const removed = entries.length - active.length;
  if (removed > 0) {
    cachedIndex.games = Object.fromEntries(active);
    console.log(`[SOURCE_AVAIL][CACHE_PRUNE] removed=${removed} size=${active.length}`);
  }
  return removed;
}

function _normalizeProviderId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find a cached PackageSource by appId + providerId from the source
 * availability cache. Returns undefined if no cached source matches.
 */
export async function findCachedSourceForApp(
  appId: string,
  providerId: string
): Promise<PackageSource | undefined> {
  await loadSourceAvailabilityIndex();
  const entry = getSourceAvailability(appId);
  if (!entry) return undefined;
  const norm = _normalizeProviderId(providerId);
  const cached = entry.availableSources.find(
    (s) => _normalizeProviderId(s.id) === norm
  );
  if (!cached) return undefined;
  return {
    providerId: cached.id as any,
    providerName: cached.name,
    fileType: (cached.type === "lua" || cached.type === "zip" || cached.type === "manifest")
      ? cached.type
      : "zip",
    available: cached.status === "ready",
    downloadUrl: cached.packageUrl,
  };
}

export function getSourceAvailability(
  appId: string
): SourceAvailabilityGameEntry | undefined {
  const entry = cachedIndex?.games[appId];
  if (!entry) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (entry.updatedAt < now - SOURCE_AVAILABILITY_CACHE_TTL_S) {
    delete cachedIndex!.games[appId];
    return undefined;
  }
  return entry;
}

export function getCachedSourceAvailabilityIndex(): SourceAvailabilityIndex | null {
  return cachedIndex;
}

export async function updateSourceAvailability(
  appId: string,
  entry: SourceAvailabilityGameEntry
): Promise<void> {
  await loadSourceAvailabilityIndex();
  if (!cachedIndex) return;

  // Guard: do not overwrite a non-empty cache with an empty result
  // Prevents transient "none" results from permanently blocking known providers
  const existing = cachedIndex.games[appId];
  const wouldBeEmptyWrite = entry.availableSources.length === 0 && entry.status !== "checking";
  const hadGoodData = existing && existing.availableSources.length > 0 && existing.status !== "checking";
  if (wouldBeEmptyWrite && hadGoodData) {
    console.log(`[STORE][SOURCE_CACHE_EMPTY_WRITE_BLOCKED] appid=${appId} previousCount=${existing.availableSources.length} newCount=0`);
    // Bump TTL on existing entry so it doesn't expire from under a retrying user
    existing.updatedAt = Math.floor(Date.now() / 1000);
    // Preserve the new status instead of collapsing everything to "none"
    existing.status = entry.status;
    if (DEBUG_SOURCE_CACHE) {
      console.log(`[SOURCE_CACHE][PRESERVE] appid=${appId} preservedSources=${existing.availableSources.length} newStatus=${entry.status}`);
    }
    pruneCache();
    scheduleSave();
    return;
  }

  cachedIndex.games[appId] = entry;
  cachedIndex.updatedAt = Math.floor(Date.now() / 1000);
  pruneCache();
  scheduleSave();
  log(`updated ${appId} (${entry.title})`);
}

export async function markSourceUnavailable(
  appId: string,
  _reason: string
): Promise<void> {
  await loadSourceAvailabilityIndex();
  if (!cachedIndex) return;
  const existing = cachedIndex.games[appId];
  if (existing && existing.availableSources.length > 0) {
    // Preserve good cache: just mark status as timeout instead of clearing sources
    existing.status = "timeout";
    existing.updatedAt = Math.floor(Date.now() / 1000);
    console.log(`[STORE][SOURCE_NONE_PERSIST_BLOCKED] appid=${appId} reason=preserving-existing-sources`);
  } else if (existing) {
    existing.status = "needs-configuration";
    existing.luaReady = false;
    existing.availableSources = [];
    existing.sourceCount = 0;
    existing.updatedAt = Math.floor(Date.now() / 1000);
  }
  scheduleSave();
  log(`marked unavailable ${appId}: ${_reason}`);
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (cachedIndex) {
      try {
        await invoke("write_source_availability_index", {
          index: cachedIndex,
        });
        log(
          `saved source-index (${Object.keys(cachedIndex.games).length} entries)`
        );
      } catch {
        console.warn("[SourceCache] save failed");
      }
    }
  }, 2000);
}

export function buildSourceAvailabilityFromProviders(
  appId: string,
  title: string,
  sources: PackageSource[],
  totalProviderCount: number
): SourceAvailabilityGameEntry {
  const availableSources = sources.filter((s) => s.available);
  // Safety guard: never cache auth headers
  for (const s of availableSources) {
    if (s.authHeaders) {
      console.log(`[SOURCE_CACHE][AUTH_STRIPPED] provider=${s.providerName} reason=do-not-cache-secrets`);
    }
  }
  const status: SourceCheckStatus = classifyProviderOutcomes(sources);
  if (DEBUG_SOURCE_CACHE) {
    console.log(`[SOURCE_CACHE][CLASSIFY] appid=${appId} status=${status} available=${availableSources.length} total=${sources.length} totalProviderCount=${totalProviderCount}`);
  }
  return {
    appId,
    title,
    status,
    luaReady: availableSources.length > 0,
    selectedSourceId:
      availableSources.length > 0 ? availableSources[0].providerId : undefined,
    availableSources: availableSources.map((s) => ({
      id: s.providerId,
      name: s.providerName,
      type: s.fileType,
      status: s.available ? "ready" : "unavailable",
      packageUrl: s.downloadUrl,
      updatedAt: s.checkedAt
        ? Math.floor(new Date(s.checkedAt).getTime() / 1000)
        : undefined,
    })),
    sourceCount: availableSources.length,
    totalProviderCount,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}
