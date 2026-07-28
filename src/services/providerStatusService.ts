import { readProviderStatus, writeProviderStatus, hubcapAppStatus, getFileMetadata } from "./tauri";
import type {
  ProviderStatusFile,
  ProviderStatusLocal,
  ProviderStatusRemote,
  ProviderStatusResult,
} from "./tauri";
import { notifyProviderStatusWritten as storeNotifyProviderStatusWritten } from "./providerStatusStore";
import {
  getSnapshotEntry,
  loadSnapshot,
  toSnapshotEntry,
  updateSnapshotEntry,
} from "./providerStatusSnapshotService";

export type {
  ProviderStatusFile,
  ProviderStatusLocal,
  ProviderStatusRemote,
  ProviderStatusResult,
};

export interface HubcapProviderConfig {
  baseUrl: string;
  apiKey: string;
}

const ENABLE_VERBOSE_PROVIDER_STATUS_LOGS = false;

// Session-level cache for loadProviderStatus: key = appId:providerId, value = ProviderStatusFile | null
const _loadCache = new Map<string, ProviderStatusFile | null>();
const _loadInFlight = new Map<string, Promise<ProviderStatusFile | null>>();

export function clearProviderStatusCache(appId?: string, providerId?: string): void {
  if (appId && providerId) {
    const key = `${appId}:${normalizeProviderId(providerId)}`;
    _loadCache.delete(key);
    _loadInFlight.delete(key);
  } else if (appId) {
    for (const key of _loadCache.keys()) {
      if (key.startsWith(`${appId}:`)) _loadCache.delete(key);
    }
    for (const key of _loadInFlight.keys()) {
      if (key.startsWith(`${appId}:`)) _loadInFlight.delete(key);
    }
  } else {
    _loadCache.clear();
    _loadInFlight.clear();
  }
}

export interface ProviderStatusOptions {
  /** Configured Lua directory from Settings → Paths → config/lua */
  luaDir?: string;
  /** Steam root path (fallback for Lua dir when luaDir is empty) */
  steamRoot?: string;
}

/** Resolve Lua metadata for an appId by checking the local Lua file on disk.
 *  Uses configured luaDir, falls back to <steamRoot>/config/lua/<appId>.lua.
 *  Returns null if the Lua file doesn't exist or metadata can't be read.
 */
export async function resolveLuaMetadata(
  appId: string,
  options?: ProviderStatusOptions,
): Promise<{ luaPath: string; fileSizeAtInstall: number; fileModifiedAtInstall: string; fileCreatedAtInstall: string | null } | null> {
  let luaDir: string | undefined;
  if (options?.luaDir) {
    luaDir = options.luaDir;
  } else if (options?.steamRoot) {
    // Fallback: <steamRoot>/config/lua/
    luaDir = `${options.steamRoot.replace(/\\/g, "/")}/config/lua`;
  }
  if (!luaDir) return null;

  const luaPath = `${luaDir}/${appId}.lua`;

  try {
    const meta = await getFileMetadata(luaPath);
    if (!meta.exists || meta.size == null || meta.modified_unix_s == null) {
      if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
        console.log(`[PROVIDER_STATUS][LUA_META] appid=${appId} path=${luaPath} exists=${meta.exists}`);
      }
      return null;
    }

    const fileModifiedAtInstall = new Date(meta.modified_unix_s * 1000).toISOString();
    const fileCreatedAtInstall = meta.created_unix_s != null ? new Date(meta.created_unix_s * 1000).toISOString() : null;
    const result = { luaPath, fileSizeAtInstall: meta.size, fileModifiedAtInstall, fileCreatedAtInstall };
    console.log(
      `[PROVIDER_STATUS][LUA_META] appid=${appId} path=${luaPath} size=${meta.size} modified=${fileModifiedAtInstall}`,
    );
    return result;
  } catch (err) {
    if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
      console.log(`[PROVIDER_STATUS][LUA_META_ERR] appid=${appId} path=${luaPath} err=${String(err)}`);
    }
    return null;
  }
}

/** Normalize provider ID for consistent file naming:
 *   - lowercase
 *   - strip non-alphanumeric (except hyphens)
 *   - "hubcapdb"/"hubcap" variants -> "hubcapdb"
 *   - "ryuu" variants -> "ryuu"
 */
export function normalizeProviderId(id: string): string {
  if (!id) return "unknown";
  const lower = id.toLowerCase().trim();
  // map "hubcap" -> "hubcapdb" (HubcapDB is the canonical provider name)
  if (lower === "hubcap" || lower === "hubcapdb") return "hubcapdb";
  if (lower === "ryuu") return "ryuu";
  return lower.replace(/[^a-z0-9-]/g, "");
}

/** Returns a log-friendly path string */
export function providerStatusLogPath(appId: string, providerId: string): string {
  return `store/provider-status/${appId}/${normalizeProviderId(providerId)}.json`;
}

/** Load cached provider-status JSON from disk. Returns null if not found or corrupt.
 *  Checks snapshot first (fast startup hydration), then session cache, then in-flight,
 *  then falls back to individual file read.
 */
export async function loadProviderStatus(
  appId: string,
  providerId: string,
): Promise<ProviderStatusFile | null> {
  const normalizedId = normalizeProviderId(providerId);
  const cacheKey = `${appId}:${normalizedId}`;

  // Snapshot cache hit (fast startup hydration — no disk I/O)
  const snapshotEntry = getSnapshotEntry(appId, normalizedId);
  if (snapshotEntry) {
    if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
      console.log(`[PROVIDER_STATUS][LOAD_SKIP] appId=${appId} provider=${normalizedId} reason=snapshot`);
    }
    // Build a minimal ProviderStatusFile from the snapshot entry
    return snapshotEntryToProviderStatusFile(snapshotEntry);
  }

  // Session cache hit
  if (_loadCache.has(cacheKey)) {
    if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
      console.log(`[PROVIDER_STATUS][LOAD_SKIP] appId=${appId} provider=${normalizedId} reason=session-cache`);
    }
    return _loadCache.get(cacheKey) ?? null;
  }

  // Ensure snapshot is loaded (may already have been loaded by first call)
  await loadSnapshot();

  // Check snapshot again after load
  const snapshotAfterLoad = getSnapshotEntry(appId, normalizedId);
  if (snapshotAfterLoad) {
    _loadCache.set(cacheKey, snapshotEntryToProviderStatusFile(snapshotAfterLoad));
    if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
      console.log(`[PROVIDER_STATUS][LOAD_SKIP] appId=${appId} provider=${normalizedId} reason=snapshot`);
    }
    return _loadCache.get(cacheKey) ?? null;
  }

  // In-flight dedup
  const inFlight = _loadInFlight.get(cacheKey);
  if (inFlight) {
    if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
      console.log(`[PROVIDER_STATUS][LOAD_SKIP] appId=${appId} provider=${normalizedId} reason=in-flight`);
    }
    return inFlight;
  }

  const promise = (async () => {
    try {
      const data = await readProviderStatus(appId, normalizedId);
      _loadCache.set(cacheKey, data);
      if (data) {
        // Seed snapshot cache so subsequent reads skip file I/O
        const entry = toSnapshotEntry(data);
        updateSnapshotEntry(appId, normalizedId, entry).catch(() => {});
      } else {
        // Negative cache: remember that this file is missing
        _loadCache.set(cacheKey, null);
      }
      if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
        console.log(
          `[PROVIDER_STATUS][LOAD] appId=${appId} provider=${normalizedId} found=${data !== null}`,
        );
      }
      return data;
    } catch (err) {
      console.warn(
        `[PROVIDER_STATUS][LOAD] appId=${appId} provider=${normalizedId} error=${err}`,
      );
      _loadCache.set(cacheKey, null);
      return null;
    } finally {
      _loadInFlight.delete(cacheKey);
    }
  })();

  _loadInFlight.set(cacheKey, promise);
  return promise;
}

/** Convert a lightweight snapshot entry to a minimal ProviderStatusFile.
 *  Callers (StoreGameDetailsPage) use this for fast hydration.
 */
function snapshotEntryToProviderStatusFile(
  entry: import("./tauri").ProviderStatusSnapshotEntry,
): ProviderStatusFile {
  return {
    appId: entry.appId,
    providerId: entry.providerId,
    providerName: entry.providerName ?? entry.providerId,
    checkedAt: entry.checkedAt ?? 0,
    installedAt: entry.installedAt ?? null,
    local: entry.local
      ? {
          packagePath: null,
          luaPath: null,
          fileSizeAtInstall: entry.local.fileSizeAtInstall ?? null,
          fileModifiedAtInstall: entry.local.fileModifiedAtInstall ?? null,
          fileCreatedAtInstall: null,
          metadataSource: entry.local.metadataSource ?? null,
          providerTimestampAtInstall: null,
          checksumAtInstall: null,
          versionAtInstall: entry.local.versionAtInstall ?? null,
          manifestIdsAtInstall: [],
          depotIdsAtInstall: [],
        }
      : null,
    remote: entry.remote
      ? {
          status: entry.remote.status ?? "",
          gameName: null,
          manifestFileExists: null,
          autoUpdateEnabled: null,
          updateInProgress: null,
          fileSize: entry.remote.fileSize ?? null,
          fileModified: entry.remote.fileModified ?? null,
          fileAgeDays: null,
          needsUpdate: entry.remote.needsUpdate ?? null,
          updateReason: entry.remote.updateReason ?? null,
          timestamp: null,
        }
      : null,
    result: {
      status: entry.status,
      reason: entry.reason ?? "",
    },
  };
}

/** Save (write) a full ProviderStatusFile to disk as sidecar JSON. */
export async function saveProviderStatus(
  appId: string,
  providerId: string,
  status: ProviderStatusFile,
): Promise<void> {
  const normalizedId = normalizeProviderId(providerId);
  const payload = JSON.stringify(status);

  try {
    await writeProviderStatus(appId, normalizedId, payload);
    // Update snapshot cache so subsequent loadProviderStatus skips file I/O
    const entry = toSnapshotEntry(status);
    updateSnapshotEntry(appId, normalizedId, entry).catch(() => {});
    // Invalidate session cache so next loadProviderStatus reads fresh data
    clearProviderStatusCache(appId, providerId);
    if (ENABLE_VERBOSE_PROVIDER_STATUS_LOGS) {
      console.log(
        `[PROVIDER_STATUS][SAVE] appId=${appId} provider=${normalizedId} path=${providerStatusLogPath(appId, providerId)}`,
      );
    }
    // Notify the reactive store so subscribers update immediately.
    await storeNotifyProviderStatusWritten(appId, normalizedId).catch(() => {});
  } catch (err) {
    console.warn(
      `[PROVIDER_STATUS][SAVE] appId=${appId} provider=${normalizedId} error=${err}`,
    );
  }
}

/** Called after Check for Updates: saves remote status data + comparison result.
 *  Preserves any existing local/installedAt fields.
 *  If local is missing, first checks for a local Lua file (via resolveLuaMetadata).
 *  If no local Lua, auto-baselines local from remote.
 */
export async function updateProviderRemoteStatus(
  appId: string,
  providerId: string,
  remote: ProviderStatusRemote,
  result: ProviderStatusResult,
  options?: ProviderStatusOptions,
): Promise<void> {
  const normalizedId = normalizeProviderId(providerId);

  // Load existing cache to preserve local/installedAt
  const existing = await loadProviderStatus(appId, normalizedId);

  const hasExistingLocal = existing?.local != null && (
    existing.local.fileSizeAtInstall != null ||
    existing.local.fileModifiedAtInstall != null ||
    existing.local.packagePath != null ||
    existing.local.luaPath != null
  );

  // Auto-baseline local from remote when local is missing
  let local: ProviderStatusLocal | null = existing?.local ?? null;
  let effectiveResult: ProviderStatusResult = result;
  let effectiveInstalledAt: number | null = existing?.installedAt ?? null;

  if (!hasExistingLocal) {
    // Try local Lua file first
    const luaMeta = await resolveLuaMetadata(appId, options);
    if (luaMeta) {
      local = {
        packagePath: existing?.local?.packagePath ?? null,
        luaPath: luaMeta.luaPath,
        fileSizeAtInstall: luaMeta.fileSizeAtInstall,
        fileModifiedAtInstall: luaMeta.fileModifiedAtInstall,
        fileCreatedAtInstall: luaMeta.fileCreatedAtInstall,
        metadataSource: "local-lua-file",
        providerTimestampAtInstall: existing?.local?.providerTimestampAtInstall ?? null,
        checksumAtInstall: existing?.local?.checksumAtInstall ?? null,
        versionAtInstall: existing?.local?.versionAtInstall ?? null,
        manifestIdsAtInstall: existing?.local?.manifestIdsAtInstall ?? [],
        depotIdsAtInstall: existing?.local?.depotIdsAtInstall ?? [],
      };
      effectiveInstalledAt = existing?.installedAt ?? Date.now();
      effectiveResult = { status: "up-to-date", reason: "local-lua-file" };
      console.log(
        `[PROVIDER_STATUS][LOCAL_LUA_BASELINE] appid=${appId} provider=${normalizedId} path=${luaMeta.luaPath} fileSize=${luaMeta.fileSizeAtInstall} fileModified=${luaMeta.fileModifiedAtInstall}`,
      );
    } else if (remote.fileSize != null && remote.fileModified != null) {
      local = {
        packagePath: existing?.local?.packagePath ?? null,
        luaPath: existing?.local?.luaPath ?? null,
        fileSizeAtInstall: remote.fileSize ?? null,
        fileModifiedAtInstall: remote.fileModified ?? null,
        fileCreatedAtInstall: existing?.local?.fileCreatedAtInstall ?? null,
        metadataSource: "auto-baseline",
        providerTimestampAtInstall: remote.timestamp ?? null,
        checksumAtInstall: existing?.local?.checksumAtInstall ?? null,
        versionAtInstall: existing?.local?.versionAtInstall ?? null,
        manifestIdsAtInstall: existing?.local?.manifestIdsAtInstall ?? [],
        depotIdsAtInstall: existing?.local?.depotIdsAtInstall ?? [],
      };
      effectiveInstalledAt = existing?.installedAt ?? Date.now();
      effectiveResult = { status: "up-to-date", reason: "auto-baseline-from-remote" };
      console.log(
        `[PROVIDER_STATUS][AUTO_BASELINE_FROM_REMOTE] appid=${appId} provider=${normalizedId} fileModifiedAtInstall=${local.fileModifiedAtInstall} fileSizeAtInstall=${local.fileSizeAtInstall}`,
      );
    }
  }

  const status: ProviderStatusFile = {
    appId,
    providerId: normalizedId,
    providerName: remote.gameName ?? normalizedId,
    checkedAt: Date.now(),
    installedAt: effectiveInstalledAt,
    local,
    remote,
    result: effectiveResult,
  };

  await saveProviderStatus(appId, normalizedId, status);

  console.log(
    `[PROVIDER_STATUS][REMOTE_SAVE] appid=${appId} provider=${normalizedId} fileModified=${remote.fileModified ?? "null"} fileSize=${remote.fileSize ?? "null"}`,
  );
  console.log(
    `[PROVIDER_STATUS][CHECK_SAVED] appId=${appId} provider=${normalizedId} result=${effectiveResult.status} reason="${effectiveResult.reason}" path=${providerStatusLogPath(appId, providerId)}`,
  );
}

/** Adopt remote metadata as local baseline without downloading.
 *  Copies remote.fileSize -> local.fileSizeAtInstall,
 *  remote.fileModified -> local.fileModifiedAtInstall,
 *  remote.timestamp -> local.providerTimestampAtInstall.
 *  Sets installedAt to now.
 */
export async function adoptProviderRemoteAsBaseline(
  appId: string,
  providerId: string,
): Promise<void> {
  const normalizedId = normalizeProviderId(providerId);

  const existing = await loadProviderStatus(appId, normalizedId);
  if (!existing?.remote) {
    console.warn(
      `[PROVIDER_STATUS][BASELINE] appId=${appId} provider=${normalizedId} skipped=no-remote-data path=${providerStatusLogPath(appId, providerId)}`,
    );
    return;
  }

  const now = Date.now();
  const local: ProviderStatusLocal = {
    packagePath: existing.local?.packagePath ?? null,
    luaPath: existing.local?.luaPath ?? null,
    fileSizeAtInstall: existing.remote.fileSize ?? null,
    fileModifiedAtInstall: existing.remote.fileModified ?? null,
    fileCreatedAtInstall: existing.local?.fileCreatedAtInstall ?? null,
    metadataSource: "auto-baseline",
    providerTimestampAtInstall: existing.remote.timestamp ?? null,
    checksumAtInstall: existing.local?.checksumAtInstall ?? null,
    versionAtInstall: existing.local?.versionAtInstall ?? null,
    manifestIdsAtInstall: existing.local?.manifestIdsAtInstall ?? [],
    depotIdsAtInstall: existing.local?.depotIdsAtInstall ?? [],
  };

  const updated: ProviderStatusFile = {
    ...existing,
    installedAt: now,
    local,
  };

  await saveProviderStatus(appId, normalizedId, updated);

  console.log(
    `[PROVIDER_STATUS][BASELINE] appId=${appId} provider=${normalizedId} fileSize=${local.fileSizeAtInstall} fileModified=${local.fileModifiedAtInstall} installedAt=${now} path=${providerStatusLogPath(appId, providerId)}`,
  );
}

/** Called after successful Download or Update: saves new local snapshot.
 *  Merges into existing cached status, preserving remote/result.
 */
export async function updateProviderLocalSnapshot(
  appId: string,
  providerId: string,
  localData: Partial<ProviderStatusLocal>,
): Promise<void> {
  const normalizedId = normalizeProviderId(providerId);

  const existing = await loadProviderStatus(appId, normalizedId);

  const mergedLocal: ProviderStatusLocal = {
    packagePath: localData.packagePath ?? existing?.local?.packagePath ?? null,
    luaPath: localData.luaPath ?? existing?.local?.luaPath ?? null,
    fileSizeAtInstall: localData.fileSizeAtInstall ?? existing?.local?.fileSizeAtInstall ?? null,
    fileModifiedAtInstall: localData.fileModifiedAtInstall ?? existing?.local?.fileModifiedAtInstall ?? null,
    fileCreatedAtInstall: localData.fileCreatedAtInstall ?? existing?.local?.fileCreatedAtInstall ?? null,
    metadataSource: localData.metadataSource ?? existing?.local?.metadataSource ?? null,
    providerTimestampAtInstall: localData.providerTimestampAtInstall ?? existing?.local?.providerTimestampAtInstall ?? null,
    checksumAtInstall: localData.checksumAtInstall ?? existing?.local?.checksumAtInstall ?? null,
    versionAtInstall: localData.versionAtInstall ?? existing?.local?.versionAtInstall ?? null,
    manifestIdsAtInstall: localData.manifestIdsAtInstall ?? existing?.local?.manifestIdsAtInstall ?? [],
    depotIdsAtInstall: localData.depotIdsAtInstall ?? existing?.local?.depotIdsAtInstall ?? [],
  };

  const now = Date.now();

  const updated: ProviderStatusFile = {
    appId,
    providerId: normalizedId,
    providerName: existing?.providerName ?? normalizedId,
    checkedAt: now,
    installedAt: now,
    local: mergedLocal,
    remote: existing?.remote ?? null,
    result: existing?.result ?? null,
  };

  await saveProviderStatus(appId, normalizedId, updated);

  console.log(
    `[PROVIDER_STATUS][LOCAL_UPDATED] appId=${appId} provider=${normalizedId} fileSize=${mergedLocal.fileSizeAtInstall} version=${mergedLocal.versionAtInstall} installedAt=${now} path=${providerStatusLogPath(appId, providerId)}`,
  );
}

/** Called after successful package download or update.
 *  Automatically creates/refreshes local snapshot + sets result to up-to-date.
 *  Local data is populated from remote (preferred) or previous local fallback.
 *  When remote is missing and hubcapConfig is provided, fetches remote from HubcapDB.
 *  When options.luaDir or options.steamRoot are provided, resolves the correct luaPath
 *  from the configured Lua directory instead of hardcoded stplug-in.
 *  Never blocks the caller — errors are logged but not thrown.
 */
export async function saveProviderStatusAfterInstall(
  appId: string,
  providerId: string,
  hubcapConfig?: HubcapProviderConfig,
  options?: ProviderStatusOptions,
): Promise<void> {
  const normalizedId = normalizeProviderId(providerId);
  const now = Date.now();

  try {
    const existing = await loadProviderStatus(appId, normalizedId);

    // Determine if this is an update (existing local metadata) or first download
    const hasExistingLocal = existing?.local != null && (
      existing.local.fileSizeAtInstall != null ||
      existing.local.fileModifiedAtInstall != null ||
      existing.local.packagePath != null ||
      existing.local.luaPath != null
    );
    const reason = hasExistingLocal ? "update-success" : "download-success";

    // Resolve remote — use existing if present, otherwise fetch from HubcapDB
    let remote: ProviderStatusRemote | null = existing?.remote ?? null;
    if (!remote && hubcapConfig && normalizedId === "hubcapdb") {
      console.log(
        `[PROVIDER_STATUS][DOWNLOAD_REMOTE_FETCH] appid=${appId} provider=${normalizedId} reason=missing-remote`,
      );
      try {
        const raw = await hubcapAppStatus(hubcapConfig.baseUrl, hubcapConfig.apiKey, appId);
        if (raw.ok) {
          remote = {
            status: raw.status,
            gameName: raw.game_name ?? null,
            manifestFileExists: raw.manifest_file_exists ?? null,
            autoUpdateEnabled: raw.auto_update_enabled ?? null,
            updateInProgress: raw.update_in_progress ?? null,
            fileSize: raw.file_size ?? null,
            fileModified: raw.file_modified ?? null,
            fileAgeDays: raw.file_age_days ?? null,
            needsUpdate: raw.needs_update ?? null,
            updateReason: raw.update_reason ?? null,
            timestamp: raw.timestamp ?? null,
          };
          console.log(
            `[PROVIDER_STATUS][DOWNLOAD_REMOTE_FETCH_OK] appid=${appId} provider=${normalizedId} fileModified=${remote.fileModified ?? "null"} fileSize=${remote.fileSize ?? "null"}`,
          );
        } else {
          console.log(
            `[PROVIDER_STATUS][DOWNLOAD_REMOTE_FETCH_FAILED] appid=${appId} provider=${normalizedId} error=not-ok status=${raw.status}`,
          );
        }
      } catch (fetchErr) {
        console.log(
          `[PROVIDER_STATUS][DOWNLOAD_REMOTE_FETCH_FAILED] appid=${appId} provider=${normalizedId} error=${String(fetchErr)}`,
        );
      }
    }

    // Resolve luaPath from configured Lua dir
    let resolvedLuaPath: string | null = existing?.local?.luaPath ?? null;
    if (options && (options.luaDir || options.steamRoot)) {
      const luaMeta = await resolveLuaMetadata(appId, options);
      if (luaMeta) {
        resolvedLuaPath = luaMeta.luaPath;
        console.log(
          `[PROVIDER_STATUS][LUA_PATH_RESOLVED] appid=${appId} provider=${normalizedId} path=${luaMeta.luaPath}`,
        );
      }
    }

    // Build local block — prefer remote data, fallback to existing local
    const mergedLocal: ProviderStatusLocal = {
      packagePath: existing?.local?.packagePath ?? null,
      luaPath: resolvedLuaPath,
      fileSizeAtInstall: remote?.fileSize ?? existing?.local?.fileSizeAtInstall ?? null,
      fileModifiedAtInstall: remote?.fileModified ?? existing?.local?.fileModifiedAtInstall ?? null,
      fileCreatedAtInstall: existing?.local?.fileCreatedAtInstall ?? null,
      metadataSource: existing?.local?.metadataSource ?? null,
      providerTimestampAtInstall: remote?.timestamp ?? existing?.local?.providerTimestampAtInstall ?? null,
      checksumAtInstall: existing?.local?.checksumAtInstall ?? null,
      versionAtInstall: existing?.local?.versionAtInstall ?? null,
      manifestIdsAtInstall: existing?.local?.manifestIdsAtInstall ?? [],
      depotIdsAtInstall: existing?.local?.depotIdsAtInstall ?? [],
    };

    // Determine if local has usable install metadata
    const hasLocalMetadata = mergedLocal.fileSizeAtInstall != null || mergedLocal.fileModifiedAtInstall != null;

    const resultStatus = hasLocalMetadata ? "up-to-date" : "unknown";
    const resultReason = hasLocalMetadata ? reason : "missing-install-metadata";

    const updated: ProviderStatusFile = {
      appId,
      providerId: normalizedId,
      providerName: existing?.providerName ?? normalizedId,
      checkedAt: now,
      installedAt: now,
      local: mergedLocal,
      remote,
      result: {
        status: resultStatus,
        reason: resultReason,
      },
    };

    await saveProviderStatus(appId, normalizedId, updated);

    if (hasLocalMetadata) {
      console.log(
        `[PROVIDER_STATUS][LOCAL_SAVE] appid=${appId} provider=${normalizedId} reason=${resultReason} fileModifiedAtInstall=${mergedLocal.fileModifiedAtInstall} fileSizeAtInstall=${mergedLocal.fileSizeAtInstall}`,
      );
      console.log(
        `[PACKAGE][LOCAL_META_SAVE] appid=${appId} provider=${normalizedId} reason=${resultReason} path=${providerStatusLogPath(appId, providerId)}`,
      );
    } else {
      console.warn(
        `[PROVIDER_STATUS][LOCAL_SAVE_WARNING] appid=${appId} provider=${normalizedId} reason=missing-remote-and-local-metadata`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[PACKAGE][LOCAL_META_SAVE_ERROR] appid=${appId} provider=${normalizedId} reason=install-success error="${msg}"`,
    );
  }
}

/** Called after auth error (401/403) or rate-limit (429) during download.
 *  Saves provider-status sidecar with auth-required or rate-limited result,
 *  preserving any existing remote/local data. Never blocks the caller.
 */
export async function saveProviderStatusAuthError(
  appId: string,
  providerId: string,
  status: "auth-required" | "rate-limited" | "provider-unavailable",
  reason: string,
): Promise<void> {
  const normalizedId = normalizeProviderId(providerId);
  const now = Date.now();

  try {
    const existing = await loadProviderStatus(appId, normalizedId);

    const updated: ProviderStatusFile = {
      appId,
      providerId: normalizedId,
      providerName: existing?.providerName ?? normalizedId,
      checkedAt: now,
      installedAt: existing?.installedAt ?? null,
      local: existing?.local ?? null,
      remote: existing?.remote ?? null,
      result: { status, reason },
    };

    await saveProviderStatus(appId, normalizedId, updated);

    if (status === "rate-limited") {
      console.log(
        `[PACKAGE][DOWNLOAD_RATE_LIMITED] appid=${appId} provider=${normalizedId} status=429`,
      );
    } else {
      const statusCode = reason === "unauthorized" ? 401 : reason === "forbidden" ? 403 : 0;
      console.log(
        `[PACKAGE][DOWNLOAD_AUTH_ERROR] appid=${appId} provider=${normalizedId} status=${statusCode} reason=${reason}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[PACKAGE][LOCAL_META_SAVE_ERROR] appid=${appId} provider=${normalizedId} reason=auth-error error="${msg}"`,
    );
  }
}
