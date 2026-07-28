import {
  readProviderStatusSnapshot,
  writeProviderStatusSnapshot,
} from "./tauri";
import type {
  ProviderStatusSnapshot,
  ProviderStatusSnapshotEntry,
} from "./tauri";

const _cache = new Map<string, ProviderStatusSnapshotEntry>();
let _loaded = false;
let _loading: Promise<void> | null = null;

function _entryKey(appId: string, providerId: string): string {
  return `${appId}::${providerId}`;
}

/** Load the snapshot from disk once. Subsequent calls are no-ops. */
export async function loadSnapshot(): Promise<void> {
  if (_loaded) return;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const snapshot = await readProviderStatusSnapshot();
      if (snapshot && snapshot.schemaVersion === 1) {
        for (const [key, entry] of Object.entries(snapshot.entries)) {
          _cache.set(key, entry);
        }
        console.log(
          `[PROVIDER_STATUS][SNAPSHOT_LOAD] found=true entries=${Object.keys(snapshot.entries).length}`,
        );
      } else if (snapshot) {
        console.log(
          "[PROVIDER_STATUS][SNAPSHOT_LOAD] found=true valid=false reason=bad-schema",
        );
      } else {
        console.log("[PROVIDER_STATUS][SNAPSHOT_LOAD] found=false");
      }
    } catch (err) {
      console.warn(
        `[PROVIDER_STATUS][SNAPSHOT_LOAD] error=${String(err)}`,
      );
    } finally {
      _loaded = true;
      _loading = null;
    }
  })();

  return _loading;
}

/** Get a snapshot entry for an appId+provider. Returns undefined if not cached. */
export function getSnapshotEntry(
  appId: string,
  providerId: string,
): ProviderStatusSnapshotEntry | undefined {
  return _cache.get(_entryKey(appId, providerId));
}

/** Check if the snapshot has an entry for appId+provider. */
export function hasSnapshotEntry(
  appId: string,
  providerId: string,
): boolean {
  return _cache.has(_entryKey(appId, providerId));
}

/** Update an entry in the in-memory cache and write the snapshot to disk.
 *  Does NOT throw — logs warning on write failure.
 */
export async function updateSnapshotEntry(
  appId: string,
  providerId: string,
  entry: ProviderStatusSnapshotEntry,
): Promise<void> {
  const key = _entryKey(appId, providerId);
  _cache.set(key, entry);

  _loaded = true;

  try {
    const entries: Record<string, ProviderStatusSnapshotEntry> = {};
    for (const [k, v] of _cache) {
      entries[k] = v;
    }
    const snapshot: ProviderStatusSnapshot = {
      schemaVersion: 1,
      updatedAt: Date.now(),
      entries,
    };
    await writeProviderStatusSnapshot(JSON.stringify(snapshot));
  } catch (err) {
    console.warn(
      `[PROVIDER_STATUS][SNAPSHOT_UPDATE_FAILED] appid=${appId} provider=${providerId} error=${String(err)}`,
    );
  }
}

/** Convert a full ProviderStatusFile to a lightweight snapshot entry. */
export function toSnapshotEntry(
  statusFile: import("./tauri").ProviderStatusFile,
): ProviderStatusSnapshotEntry {
  return {
    appId: statusFile.appId,
    providerId: statusFile.providerId,
    providerName: statusFile.providerName || undefined,
    status: statusFile.result?.status ?? "unknown",
    reason: statusFile.result?.reason || undefined,
    checkedAt: statusFile.checkedAt || undefined,
    installedAt: statusFile.installedAt ?? undefined,
    local: statusFile.local
      ? {
          fileSizeAtInstall: statusFile.local.fileSizeAtInstall,
          fileModifiedAtInstall: statusFile.local.fileModifiedAtInstall,
          versionAtInstall: statusFile.local.versionAtInstall,
          metadataSource: statusFile.local.metadataSource,
        }
      : undefined,
    remote: statusFile.remote
      ? {
          status: statusFile.remote.status,
          fileSize: statusFile.remote.fileSize,
          fileModified: statusFile.remote.fileModified,
          needsUpdate: statusFile.remote.needsUpdate,
          updateReason: statusFile.remote.updateReason,
        }
      : undefined,
  };
}

/** Get total snapshot entry count (for diagnostics). */
export function getSnapshotEntryCount(): number {
  return _cache.size;
}

/** Manually rebuild snapshot from in-memory caches (dev tool). */
export async function rebuildSnapshot(): Promise<void> {
  // only clears — caller re-populates by loading statuses
  _cache.clear();
  _loaded = false;
  _loading = null;
}

export function isSnapshotLoaded(): boolean {
  return _loaded;
}
