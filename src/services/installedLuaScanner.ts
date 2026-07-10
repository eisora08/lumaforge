import { getFileMetadata, readScanState, writeScanState, readProviderStatus, writeProviderStatus, hubcapAppStatus } from "./tauri";
import type { FileMetadata, ScanState } from "./tauri";
import type { ProviderStatusFile, ProviderStatusLocal, ProviderStatusRemote } from "./tauri";
import { normalizeProviderId } from "./providerStatusService";
import {
  addOrUpdateEntry as storeAddOrUpdateEntry,
  clearAllEntries as storeClearAllEntries,
  applyScanResults as storeApplyScanResults,
  notifyProviderStatusWritten as storeNotifyProviderStatusWritten,
  getLastResultHash as storeGetLastResultHash,
} from "./providerStatusStore";

// Re-export the reactive store's public API so existing components keep working.
export type { UpdateStatus, UpdateEntry } from "./providerStatusStore";
export {
  subscribeUpdateStatus,
  getUpdateStatus,
  getUpdateCount,
  getUpdateEntries,
  getUpdateEntry,
  getTotalScanned,
  getLastResultHash,
  hasNewUpdatesSinceLastNotification,
  markUpdatesNotified,
  clearNotifiedHash,
} from "./providerStatusStore";

const SCAN_INTERVAL_HOURS = 24;
const ENABLE_VERBOSE = false;
const ENABLE_HUBCAP_CHECK_LOGS = false;

function hubcapLog(...args: unknown[]) {
  if (ENABLE_HUBCAP_CHECK_LOGS) {
    console.log("[HUBCAP_CHECK]", ...args);
  }
}

// --- Lua file discovery ---

export interface LuaFileEntry {
  appId: string;
  filePath: string;
}

/** List all *.lua files in the configured lua directory, returning appId + full path.
 *  Only processes files with numeric names (e.g. "268910.lua"). Skips non-numeric,
 *  temp files, backup files, and directories.
 */
export async function scanLuaDirectory(luaDir: string): Promise<LuaFileEntry[]> {
  const results: LuaFileEntry[] = [];

  try {
    // Use Tauri's built-in file listing via the filesystem plugin if available,
    // otherwise fall back to a Rust command. Since we can't enumerate dirs from TS,
    // we use the existing scan_installed_lua_scripts command which already lists .lua files.
    const { scanInstalledLuaScripts } = await import("./tauri");
    const scripts = await scanInstalledLuaScripts(luaDir);

    for (const script of scripts) {
      const name = script.file_name;
      if (!name.endsWith(".lua")) continue;
      if (name.endsWith(".tmp.lua") || name.endsWith(".bak.lua") || name.endsWith("~")) continue;

      const appId = name.slice(0, -4);
      if (!/^\d+$/.test(appId)) continue;

      const filePath = `${luaDir.replace(/\\/g, "/")}/${name}`;
      results.push({ appId, filePath });
    }
  } catch (err) {
    console.log(`[PACKAGE_SCAN][LUA_DISCOVERY] dir=${luaDir} error="${String(err)}"`);
    return [];
  }

  const appIds = results.map((r) => r.appId);
  console.log(`[PACKAGE_SCAN][LUA_DISCOVERY] dir=${luaDir} count=${results.length} appids=[${appIds.join(",")}]`);
  return results;
}

// --- Provider resolution ---

export interface ProviderResolution {
  providerId: string;
  providerName: string;
}

/** Resolve provider for a given app. Priority:
 *  1. Existing provider-status file's providerId
 *  2. hubcapdb if configured and API key exists
 *  Returns null if no provider can be resolved.
 */
export async function resolveProviderForApp(
  appId: string,
  hubcapConfig?: { baseUrl: string; apiKey: string },
): Promise<ProviderResolution | null> {
  // Check existing provider-status files for this appId
  // Try hubcapdb first (most common)
  const hubcapId = "hubcapdb";
  try {
    const existing = await readProviderStatus(appId, hubcapId);
    if (existing?.providerId) {
      return { providerId: existing.providerId, providerName: existing.providerName };
    }
  } catch {
    // ignore
  }

  // Try ryuu next
  try {
    const existing = await readProviderStatus(appId, "ryuu");
    if (existing?.providerId) {
      return { providerId: existing.providerId, providerName: existing.providerName };
    }
  } catch {
    // ignore
  }

  // Fall back to hubcapdb if configured
  if (hubcapConfig?.apiKey && hubcapConfig?.baseUrl) {
    return { providerId: hubcapId, providerName: hubcapId };
  }

  return null;
}

// --- Lua file metadata reading ---

export interface LuaLocalMetadata {
  luaPath: string;
  fileSizeAtInstall: number;
  fileModifiedAtInstall: string;
  fileCreatedAtInstall: string | null;
}

/** Read actual Lua file metadata from disk. Returns null if file doesn't exist or can't be read. */
export async function readLuaFileMetadata(filePath: string): Promise<LuaLocalMetadata | null> {
  let meta: FileMetadata;
  try {
    meta = await getFileMetadata(filePath);
  } catch (err) {
    if (ENABLE_VERBOSE) console.log(`[PACKAGE_SCAN][LUA_META_ERR] path=${filePath} err=${String(err)}`);
    return null;
  }

  if (!meta.exists || meta.size == null || meta.modified_unix_s == null) {
    if (ENABLE_VERBOSE) console.log(`[PACKAGE_SCAN][LUA_META] path=${filePath} exists=${meta.exists}`);
    return null;
  }

  const normalizedPath = filePath.replace(/\//g, "\\");
  const fileModifiedAtInstall = new Date(meta.modified_unix_s * 1000).toISOString();
  const fileCreatedAtInstall = meta.created_unix_s != null ? new Date(meta.created_unix_s * 1000).toISOString() : null;

  console.log(`[PACKAGE_SCAN][LUA_FILE] appid=${extractAppId(filePath)} path=${normalizedPath} found=true size=${meta.size} modified=${fileModifiedAtInstall}`);

  return {
    luaPath: normalizedPath,
    fileSizeAtInstall: meta.size,
    fileModifiedAtInstall,
    fileCreatedAtInstall,
  };
}

function extractAppId(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() || "";
  return name.replace(/\.lua$/, "");
}

// --- Remote metadata fetching ---

/** Fetch remote metadata from HubcapDB. Returns null if not available or error. */
export async function fetchRemoteMetadata(
  appId: string,
  hubcapConfig: { baseUrl: string; apiKey: string },
): Promise<ProviderStatusRemote | null> {
  const endpoint = `${hubcapConfig.baseUrl.replace(/\/+$/, "")}/api/v1/status/${appId}`;
  hubcapLog(`[REMOTE_QUERY] appid=${appId} provider=hubcapdb endpoint=${endpoint}`);
  try {
    const raw = await hubcapAppStatus(hubcapConfig.baseUrl, hubcapConfig.apiKey, appId);
    if (!raw.ok) {
      console.log(`[PACKAGE_SCAN][REMOTE] appid=${appId} status=${raw.status}`);
      hubcapLog(`[REMOTE_RESULT] appid=${appId} found=false status=${raw.status} reason=api-not-ok`);
      return null;
    }

    const remote: ProviderStatusRemote = {
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

    console.log(`[PACKAGE_SCAN][REMOTE] appid=${appId} status=${remote.status} modified=${remote.fileModified ?? "null"} size=${remote.fileSize ?? "null"}`);
    hubcapLog(`[REMOTE_RESULT] appid=${appId} found=true status=${remote.status} modified=${remote.fileModified ?? "null"}`);
    return remote;
  } catch (err) {
    console.log(`[PACKAGE_SCAN][REMOTE] appid=${appId} error="${String(err)}"`);
    hubcapLog(`[REMOTE_RESULT] appid=${appId} found=false reason=error error="${String(err)}"`);
    return null;
  }
}

// --- Comparison ---

function computeResult(
  remote: ProviderStatusRemote | null,
  local: { fileModifiedAtInstall: string; fileSizeAtInstall: number; metadataSource: string } | null,
): { status: string; reason: string } {
  if (!remote) {
    return { status: "unknown", reason: "no-remote-data" };
  }

  // Rule: manifest missing
  if (remote.manifestFileExists === false) {
    return { status: "provider-unavailable", reason: "manifest-missing" };
  }

  // Rule: provider status not available
  if (remote.status !== "available") {
    return { status: "provider-unavailable", reason: `provider-status-${remote.status}` };
  }

  // Rule: update in progress
  if (remote.updateInProgress === true) {
    return { status: "provider-updating", reason: "update-in-progress" };
  }

  // Rule: needs update
  if (remote.needsUpdate === true) {
    return { status: "provider-needs-refresh", reason: remote.updateReason || "provider-needs-update" };
  }

  // No local metadata
  if (!local) {
    return { status: "unknown", reason: "no-local-data-for-comparison" };
  }

  // Local metadata from Lua file — skip fileSize comparison
  if (local.metadataSource === "local-lua-file") {
    if (remote.fileModified && local.fileModifiedAtInstall) {
      const remoteTs = new Date(remote.fileModified).getTime();
      const localTs = new Date(local.fileModifiedAtInstall).getTime();
      if (!isNaN(remoteTs) && !isNaN(localTs) && remoteTs > localTs) {
        return { status: "update-available", reason: "remote-newer-than-local-lua" };
      }
    }
    return { status: "up-to-date", reason: "local-lua-not-older" };
  }

  // Local metadata from remote/package baseline — compare both modified + size
  if (remote.fileModified && local.fileModifiedAtInstall) {
    const remoteTs = new Date(remote.fileModified).getTime();
    const localTs = new Date(local.fileModifiedAtInstall).getTime();
    if (!isNaN(remoteTs) && !isNaN(localTs) && remoteTs > localTs) {
      return { status: "update-available", reason: "remote-newer" };
    }
  }

  if (remote.fileSize != null && remote.fileSize !== local.fileSizeAtInstall) {
    return { status: "update-available", reason: "size-differs" };
  }

  return { status: "up-to-date", reason: "remote-not-newer" };
}

// --- Provider-status creation/update ---

async function saveProviderStatusForLua(
  appId: string,
  providerId: string,
  providerName: string,
  luaMeta: LuaLocalMetadata,
  remote: ProviderStatusRemote | null,
  result: { status: string; reason: string },
): Promise<void> {
  const now = Date.now();
  const normalizedId = normalizeProviderId(providerId);

  // Load existing to preserve any extra fields
  let existing: ProviderStatusFile | null = null;
  try {
    existing = await readProviderStatus(appId, normalizedId);
  } catch {
    // ignore
  }

  const local: ProviderStatusLocal = {
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

  const status: ProviderStatusFile = {
    appId,
    providerId: normalizedId,
    providerName,
    checkedAt: now,
    installedAt: existing?.installedAt ?? now,
    local,
    remote,
    result: { status: result.status, reason: result.reason },
  };

  try {
    await writeProviderStatus(appId, normalizedId, JSON.stringify(status));
    console.log(`[PACKAGE_SCAN][SAVE] appid=${appId} provider=${normalizedId} result=${result.status} reason=${result.reason}`);
    hubcapLog(`[WRITE] appid=${appId} path=store/provider-status/${appId}/${normalizedId}.json remotePresent=${remote !== null} result=${result.status}`);
  } catch (err) {
    console.log(`[PACKAGE_SCAN][SAVE_ERR] appid=${appId} provider=${normalizedId} err=${String(err)}`);
  }

  // Update the reactive store
  storeAddOrUpdateEntry(appId, result.status as any, result.reason, normalizedId, providerName, remote?.gameName ?? null, remote?.fileModified ?? null);
  await storeNotifyProviderStatusWritten(appId, normalizedId);
}

// --- Scan orchestration ---

export interface ScanOptions {
  luaDir: string;
  hubcapConfig?: { baseUrl: string; apiKey: string };
  /** Force scan even if interval hasn't expired */
  force?: boolean;
}

export interface ScanResult {
  appId: string;
  status: string;
  reason: string;
}

export interface ScanSummary {
  total: number;
  updates: number;
  upToDate: number;
  unknown: number;
  authRequired: number;
  providerUnavailable: number;
  results: ScanResult[];
}

/** Main entry point: discover installed Lua files, fetch remote metadata, save provider-status. */
export async function runInstalledLuaScan(options: ScanOptions): Promise<ScanSummary> {
  const { luaDir, hubcapConfig, force } = options;

  if (!luaDir) {
    console.log("[PACKAGE_SCAN][SKIP] reason=no-lua-dir");
    return emptySummary();
  }

  // Check scan state (skip if recent and not forced)
  if (!force) {
    const state = await readScanState();
    if (state && state.lastScanAt > 0) {
      const elapsed = Date.now() - state.lastScanAt;
      const intervalMs = (state.intervalHours || SCAN_INTERVAL_HOURS) * 60 * 60 * 1000;
      if (elapsed < intervalMs) {
        console.log(`[PACKAGE_SCAN][SKIP] reason=recent-check lastScanAt=${state.lastScanAt} intervalHours=${state.intervalHours || SCAN_INTERVAL_HOURS}`);
        // Still update in-memory status from existing provider-status files
        await refreshInMemoryStatus(luaDir, hubcapConfig);
        // Re-check games with stale "unknown/no-remote-data" status — provider may now have data
        if (hubcapConfig?.apiKey && hubcapConfig?.baseUrl) {
          await recheckStaleUnknownGames(luaDir, hubcapConfig);
        }
        return emptySummary();
      }
    }
  }

  console.log(`[PACKAGE_SCAN][START] reason=${force ? "manual" : "startup"} luaDir=${luaDir}`);
  hubcapLog(`[START] reason=${force ? "manual" : "boot"} luaDir=${luaDir}`);

  // Discover installed Lua files
  const entries = await scanLuaDirectory(luaDir);
  if (entries.length === 0) {
    console.log("[PACKAGE_SCAN][DONE] reason=no-lua-files total=0");
    const summary: ScanSummary = { total: 0, updates: 0, upToDate: 0, unknown: 0, authRequired: 0, providerUnavailable: 0, results: [] };
    await saveScanStateToDisk(summary);
    storeClearAllEntries();
    return summary;
  }

  // Process each Lua file sequentially (avoid rate limiting HubcapDB)
  const results: ScanResult[] = [];
  for (const entry of entries) {
    const { appId, filePath } = entry;

    // Read local Lua file metadata
    const luaMeta = await readLuaFileMetadata(filePath);
    if (!luaMeta) {
      results.push({ appId, status: "unknown", reason: "lua-file-not-found" });
      continue;
    }
    hubcapLog(`[LOCAL] appid=${appId} luaPath=${luaMeta.luaPath} modified=${luaMeta.fileModifiedAtInstall}`);

    // Resolve provider
    const provider = await resolveProviderForApp(appId, hubcapConfig);
    if (!provider) {
      results.push({ appId, status: "unknown", reason: "no-provider-resolved" });
      continue;
    }

    // Fetch remote metadata (only for hubcapdb for now)
    let remote: ProviderStatusRemote | null = null;
    if (hubcapConfig?.apiKey && hubcapConfig?.baseUrl && provider.providerId === "hubcapdb") {
      remote = await fetchRemoteMetadata(appId, hubcapConfig);
    }

    // Compute comparison result
    const result = computeResult(remote, {
      fileModifiedAtInstall: luaMeta.fileModifiedAtInstall,
      fileSizeAtInstall: luaMeta.fileSizeAtInstall,
      metadataSource: "local-lua-file",
    });
    hubcapLog(`[COMPARE] appid=${appId} status=${result.status} reason=${result.reason}`);

    // Save provider-status JSON (also updates the reactive store)
    await saveProviderStatusForLua(appId, provider.providerId, provider.providerName, luaMeta, remote, result);

    results.push({ appId, status: result.status, reason: result.reason });
  }

  // Build summary
  const summary: ScanSummary = {
    total: results.length,
    updates: results.filter((r) => r.status === "update-available").length,
    upToDate: results.filter((r) => r.status === "up-to-date").length,
    unknown: results.filter((r) => r.status === "unknown").length,
    authRequired: results.filter((r) => r.status === "auth-required").length,
    providerUnavailable: results.filter((r) => r.status === "provider-unavailable" || r.status === "provider-updating" || r.status === "provider-needs-refresh").length,
    results,
  };

  // Persist scan state (reads hash from store)
  await saveScanStateToDisk(summary);

  // Ensure all entries are in the store (saveProviderStatusForLua already added each)
  storeApplyScanResults(summary.results);

  console.log(
    `[PACKAGE_SCAN][DONE] total=${summary.total} updates=${summary.updates} upToDate=${summary.upToDate} unknown=${summary.unknown} authRequired=${summary.authRequired} providerUnavailable=${summary.providerUnavailable}`,
  );

  return summary;
}

// --- Scan state persistence ---

async function saveScanStateToDisk(summary: ScanSummary): Promise<void> {
  const resultHash = storeGetLastResultHash() ?? "";
  const state: ScanState = {
    lastScanAt: Date.now(),
    intervalHours: SCAN_INTERVAL_HOURS,
    lastResultHash: resultHash,
    lastSummary: {
      updates: summary.updates,
      upToDate: summary.upToDate,
      unknown: summary.unknown,
      authRequired: summary.authRequired,
      providerUnavailable: summary.providerUnavailable,
    },
  };

  try {
    await writeScanState(JSON.stringify(state));
  } catch (err) {
    console.log(`[PACKAGE_SCAN][STATE_SAVE_ERR] err=${String(err)}`);
  }
}

function emptySummary(): ScanSummary {
  return { total: 0, updates: 0, upToDate: 0, unknown: 0, authRequired: 0, providerUnavailable: 0, results: [] };
}

/** Re-check games with stale "unknown/no-remote-data" hubcapdb.json status.
 *  Runs after interval-skip refresh to detect games newly added to the HubcapDB catalog.
 *  Uses the same fetchRemoteMetadata + saveProviderStatusForLua path as the full scan.
 */
async function recheckStaleUnknownGames(
  luaDir: string,
  hubcapConfig: { baseUrl: string; apiKey: string },
): Promise<void> {
  const entries = await scanLuaDirectory(luaDir);
  let rechecked = 0;

  for (const entry of entries) {
    try {
      const statusFile = await readProviderStatus(entry.appId, "hubcapdb");
      // Only re-check games with stale unknown status (no remote data)
      if (statusFile?.result?.status === "unknown" && statusFile.result.reason === "no-remote-data") {
        hubcapLog(`[RECHECK_STALE] appid=${entry.appId} reason=unknown-no-remote-data`);
        const luaMeta = await readLuaFileMetadata(entry.filePath);
        if (!luaMeta) continue;

        const remote = await fetchRemoteMetadata(entry.appId, hubcapConfig);
        const result = computeResult(remote, {
          fileModifiedAtInstall: luaMeta.fileModifiedAtInstall,
          fileSizeAtInstall: luaMeta.fileSizeAtInstall,
          metadataSource: "local-lua-file",
        });

        if (remote && result.status !== "unknown") {
          await saveProviderStatusForLua(entry.appId, "hubcapdb", "hubcapdb", luaMeta, remote, result);
          console.log(`[PACKAGE_SCAN][RECHECK_OK] appid=${entry.appId} status=${result.status} reason=${result.reason}`);
        } else {
          hubcapLog(`[RECHECK_STALE_SKIP] appid=${entry.appId} reason=still-no-remote-data`);
        }
        rechecked++;
      } else if (!statusFile) {
        // No hubcapdb.json at all — first-time check
        hubcapLog(`[RECHECK_STALE] appid=${entry.appId} reason=no-status-file`);
        const luaMeta = await readLuaFileMetadata(entry.filePath);
        if (!luaMeta) continue;

        const remote = await fetchRemoteMetadata(entry.appId, hubcapConfig);
        const result = computeResult(remote, {
          fileModifiedAtInstall: luaMeta.fileModifiedAtInstall,
          fileSizeAtInstall: luaMeta.fileSizeAtInstall,
          metadataSource: "local-lua-file",
        });

        await saveProviderStatusForLua(entry.appId, "hubcapdb", "hubcapdb", luaMeta, remote, result);
        rechecked++;
      }
    } catch { /* ignore per-app errors */ }
  }

  if (rechecked > 0) {
    console.log(`[PACKAGE_SCAN][RECHECK_DONE] rechecked=${rechecked}`);
  }
}

/** Refresh in-memory status from existing provider-status files on disk (no scan). */
async function refreshInMemoryStatus(luaDir: string, _hubcapConfig?: { baseUrl: string; apiKey: string }): Promise<void> {
  const entries = await scanLuaDirectory(luaDir);
  storeClearAllEntries();

  for (const entry of entries) {
    // Try hubcapdb first, then fallback
    try {
      const statusFile = await readProviderStatus(entry.appId, "hubcapdb");
      if (statusFile?.result) {
        await storeNotifyProviderStatusWritten(entry.appId, "hubcapdb");
        continue;
      }
    } catch { /* ignore */ }

    try {
      const statusFile = await readProviderStatus(entry.appId, "ryuu");
      if (statusFile?.result) {
        await storeNotifyProviderStatusWritten(entry.appId, "ryuu");
        continue;
      }
    } catch { /* ignore */ }

    // No provider-status file found
    storeAddOrUpdateEntry(entry.appId, "unknown", "", "", "", null, null);
  }
}


