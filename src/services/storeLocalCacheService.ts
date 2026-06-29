import {
  readStoreAppinfo,
  updateStoreAppinfoEntry,
  readStoreGameDetails,
  writeStoreGameDetails,
  readStoreReviewSummary,
  writeStoreReviewSummary,
} from "./tauri";
import {
  persistStoreDetails,
} from "./gameCacheService";

import type { StoreAppInfoEntry, StoreAppInfoMap, StoreGameDetailsEntry } from "./tauri";
import type { SteamAppMetadata } from "../types/gameMetadata";

// ---------------------------------------------------------------------------
// In-memory store appinfo cache
// ---------------------------------------------------------------------------

let _appInfoCache: StoreAppInfoMap | null = null;

async function ensureAppInfoLoaded(): Promise<StoreAppInfoMap> {
  if (_appInfoCache === null) {
    try {
      _appInfoCache = await readStoreAppinfo();
    } catch {
      _appInfoCache = {};
    }
  }
  return _appInfoCache!;
}

export function clearStoreAppInfoMemoryCache(): void {
  _appInfoCache = null;
}

export async function loadStoreAppInfo(): Promise<StoreAppInfoMap> {
  return await ensureAppInfoLoaded();
}

export async function getStoreAppInfo(appId: string): Promise<StoreAppInfoEntry | null> {
  const map = await ensureAppInfoLoaded();
  return map[appId] ?? null;
}

export async function updateStoreAppInfo(appId: string, entry: StoreAppInfoEntry): Promise<boolean> {
  try {
    await updateStoreAppinfoEntry(appId, entry);
    if (_appInfoCache) {
      _appInfoCache[appId] = entry;
    }
    return true;
  } catch {
    return false;
  }
}

export async function getStoreGameDetails(appId: number): Promise<StoreGameDetailsEntry | null> {
  try {
    return await readStoreGameDetails(appId);
  } catch {
    return null;
  }
}

export async function saveStoreGameDetails(appId: number, metadata: SteamAppMetadata): Promise<boolean> {
  try {
    await writeStoreGameDetails(appId, {
      app_id: appId,
      data: metadata as unknown,
      updated_at: Date.now(),
      version: 1,
    });
    // Also save to canonical cache
    persistStoreDetails(String(appId), {
      app_id: String(appId),
      source: "steam-store",
      updated_at: Date.now(),
      data: metadata as unknown,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function getStoreReviewSummary(appId: number): Promise<StoreGameDetailsEntry | null> {
  try {
    const entry = await readStoreReviewSummary(appId);
    return entry as unknown as StoreGameDetailsEntry | null;
  } catch {
    return null;
  }
}

export async function saveStoreReviewSummary(appId: number, data: unknown): Promise<boolean> {
  try {
    await writeStoreReviewSummary(appId, {
      app_id: appId,
      data: data,
      updated_at: Date.now(),
      version: 1,
    });
    return true;
  } catch {
    return false;
  }
}

export function nowTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function saveStoreMetadataToStoreCache(metadata: SteamAppMetadata): void {
  const appId = String(metadata.app_id);

  saveStoreGameDetails(metadata.app_id, metadata).catch(() => {});

  updateStoreAppInfo(appId, {
    app_id: appId,
    name: metadata.name || null,
    header_image: metadata.header_image || null,
    capsule_image: metadata.capsule_image_v5 || metadata.capsule_image || null,
    hero_path: null,
    header_path: null,
    capsule_path: null,
    logo_path: null,
    updated_at: nowTimestamp(),
  }).catch(() => {});
}

/**
 * Promote Store cache data to Library cache for an installed/library game.
 * Only call this when the appId belongs to a library game or when the user
 * explicitly requests it (e.g., "Add to Library").
 */
export async function promoteStoreCacheToLibrary(appId: string): Promise<boolean> {
  try {
    const appInfo = await getStoreAppInfo(appId);
    const details = await readStoreGameDetails(Number(appId));

    if (!appInfo && !details) {
      return false;
    }

    const { updateLibraryAppinfoEntry, writeLibraryGameDetails } = await import("./tauri");

    if (appInfo) {
      await updateLibraryAppinfoEntry(appId, {
        app_id: appId,
        name: appInfo.name,
        header_image: appInfo.header_image,
        cover_path: null,
        grid_path: null,
        hero_path: null,
        logo_path: null,
        icon_path: null,
        updated_at: nowTimestamp(),
      });
    }

    if (details) {
      await writeLibraryGameDetails(appId, {
        app_id: appId,
        source: "steam-store",
        updated_at: nowTimestamp(),
        data: details.data,
      });
    }

    return true;
  } catch {
    return false;
  }
}
