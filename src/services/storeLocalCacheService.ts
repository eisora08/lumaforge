import {
  readStoreAppinfo,
  updateStoreAppinfoEntry,
  getStoreDetails,
  readStoreReviewSummary,
} from "./tauri";
import {
  persistStoreDetails,
} from "./gameCacheService";

import type { StoreAppInfoEntry, StoreAppInfoMap, GameStoreDetails, StoreReviewEntry } from "./tauri";
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

export async function getStoreGameDetails(appId: number): Promise<GameStoreDetails | null> {
  try {
    return await getStoreDetails(String(appId));
  } catch {
    return null;
  }
}

export async function saveStoreGameDetails(appId: number, metadata: SteamAppMetadata): Promise<boolean> {
  try {
    // Single canonical write — no more dual-write to store/details/
    await persistStoreDetails(String(appId), {
      app_id: String(appId),
      source: "steam-store",
      updated_at: Math.floor(Date.now() / 1000),
      data: metadata as unknown,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getStoreReviewSummary(appId: number): Promise<StoreReviewEntry | null> {
  // SQLite-first fallback: fast boot reads without scanning JSON files
  try {
    const { getStoreReviewFromDb } = await import("./tauri");
    const dbRow = await getStoreReviewFromDb(String(appId));
    if (dbRow && dbRow.data) {
      return { app_id: Number(dbRow.appId), data: JSON.parse(dbRow.data), updated_at: dbRow.updatedAt, version: 1 };
    }
  } catch {
    // not in SQLite yet
  }
  // JSON fallback
  try {
    return await readStoreReviewSummary(appId);
  } catch {
    return null;
  }
}

export async function saveStoreReviewSummary(appId: number, data: unknown): Promise<boolean> {
  try {
    const { upsertStoreReview } = await import("./tauri");
    await upsertStoreReview({
      appId: String(appId),
      data: JSON.stringify(data),
      updatedAt: Date.now(),
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
 * @deprecated library/appinfo.json is no longer maintained.
 * Games get their data from games/{appid}/appinfo.json (canonical) or SQLite.
 * Kept as no-op stub to avoid import errors in any remaining call sites.
 */
export async function promoteStoreCacheToLibrary(_appId: string): Promise<boolean> {
  return false;
}
