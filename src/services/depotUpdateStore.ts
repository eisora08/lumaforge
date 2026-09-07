/**
 * Depot Update Store
 *
 * Tracks which manifest IDs were used for depot downloads.
 * When a Lua file's manifest_ids change, we can detect the update
 * and show a badge.
 */

const STORAGE_KEY = "lumaforge-depot-manifests";

type DepotManifestEntry = {
  appId: string;
  /** Map of depotId -> manifestId used during download */
  depots: Record<string, string>;
  /** The destDir where the game was downloaded */
  destDir: string;
  /** Auto-detected executable path */
  executablePath?: string;
  /** When this was last downloaded */
  downloadedAt: number;
};

let _cache: Map<string, DepotManifestEntry> | null = null;

function loadAll(): Map<string, DepotManifestEntry> {
  if (_cache) return _cache;
  _cache = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry.appId) _cache.set(entry.appId, entry);
        }
      }
    }
  } catch { /* corrupted — start fresh */ }
  return _cache;
}

function saveAll(entries: Map<string, DepotManifestEntry>): void {
  _cache = entries;
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...entries.values()]));
  window.dispatchEvent(new CustomEvent("lumaforge-data-changed", { detail: { key: STORAGE_KEY } }));
}

/** Save manifest IDs used for a depot download. */
export function saveDepotManifests(
  appId: string,
  depots: Record<string, string>,
  destDir: string,
  executablePath?: string,
): void {
  const all = loadAll();
  all.set(appId, { appId, depots, destDir, executablePath, downloadedAt: Date.now() });
  saveAll(all);
}

/** Get the manifest IDs stored for a depot download. */
export function getDepotManifests(appId: string): DepotManifestEntry | undefined {
  return loadAll().get(appId);
}

/** Check if a depot has an update available by comparing Lua manifest_ids vs stored. */
export function hasDepotUpdate(
  appId: string,
  luaManifestIds: Record<string, string>,
): boolean {
  const stored = loadAll().get(appId);
  if (!stored) return false;

  // Compare each depot's manifest ID
  for (const [depotId, luaManifestId] of Object.entries(luaManifestIds)) {
    const storedManifestId = stored.depots[depotId];
    if (storedManifestId && storedManifestId !== luaManifestId) {
      return true; // Manifest changed — update available
    }
  }
  return false;
}

/** Get all depot app IDs that have stored manifests. */
export function getDepotAppIds(): string[] {
  return [...loadAll().keys()];
}

/** Remove depot install info for an appId (used by "Remove from Library"). */
export function removeDepotInstallInfo(appId: string): boolean {
  const all = loadAll();
  const existed = all.delete(appId);
  if (existed) saveAll(all);
  return existed;
}
