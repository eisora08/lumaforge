// ---------------------------------------------------------------------------
// Module-level Store display image cache.
// Persists across mount/unmount so navigating away/back to Store restores
// hero/featured/browse images without placeholder reset.
//
// This is display-only cache. Do NOT write these URLs to local appinfo media.
// Do NOT schedule BootSnapshot writes from Store image resolution.
// ---------------------------------------------------------------------------

import type { SteamAppMetadata } from "../types/gameMetadata";

export type StoreImageRole = "hero" | "capsule" | "thumbnail" | "header" | "featured" | "featuredThumb" | "browseCard" | "newsCard" | "storeDetailsHero" | "storeDetailsThumb";

export type StoreImageSource = "catalog" | "metadata" | "provider" | "steam-cdn-fallback" | "steam-cdn" | "placeholder";

export type StoreImageCacheEntry = {
  url: string;
  source: StoreImageSource;
  status: "resolved" | "loaded" | "failed";
  resolvedAt: number;
  loadedAt?: number;
  failedAt?: number;
  error?: string;
  appid: string;
  role: StoreImageRole;
};

type StoreImageKey = `storeImage:${string}:${StoreImageRole}`;

// Module-level cache — survives Store mount/unmount
const _storeImageCache = new Map<StoreImageKey, StoreImageCacheEntry>();

// Version counter for reactive re-renders in Store.tsx
let _storeImageCacheVersion = 0;

export function bumpStoreImageCacheVersion(): void {
  _storeImageCacheVersion++;
}

export function getStoreImageCacheVersion(): number {
  return _storeImageCacheVersion;
}

const ENABLE_VERBOSE_LOGS = false;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_LOGS) {
    console.log("[StoreImage]", ...args);
  }
}

function makeKey(appId: string, role: StoreImageRole): StoreImageKey {
  return `storeImage:${appId}:${role}`;
}

export function getStoreImageCacheEntry(
  appId: string,
  role: StoreImageRole,
): StoreImageCacheEntry | undefined {
  return _storeImageCache.get(makeKey(appId, role));
}

export function setStoreImageCacheEntry(
  appId: string,
  role: StoreImageRole,
  entry: StoreImageCacheEntry,
): void {
  _storeImageCache.set(makeKey(appId, role), { ...entry, appid: appId, role });
  bumpStoreImageCacheVersion();
  log(`set appid=${appId} role=${role} status=${entry.status} source=${entry.source}`);
}

export function getStoreDisplayImage(
  appId: string,
  role: StoreImageRole,
): string | undefined {
  const entry = _storeImageCache.get(makeKey(appId, role));
  if (entry && (entry.status === "resolved" || entry.status === "loaded")) {
    return entry.url;
  }
  return undefined;
}

export function markStoreImageLoaded(appId: string, role: StoreImageRole): void {
  const key = makeKey(appId, role);
  const entry = _storeImageCache.get(key);
  if (entry) {
    _storeImageCache.set(key, { ...entry, status: "loaded", loadedAt: Date.now() });
    bumpStoreImageCacheVersion();
  }
}

export function markStoreImageFailed(appId: string, role: StoreImageRole, error?: string): void {
  const key = makeKey(appId, role);
  const entry = _storeImageCache.get(key);
  _storeImageCache.set(key, {
    ...entry,
    url: entry?.url ?? "",
    source: entry?.source ?? "placeholder",
    status: "failed",
    resolvedAt: entry?.resolvedAt ?? Date.now(),
    failedAt: Date.now(),
    error,
    appid: appId,
    role,
  });
}

export function getStoreImageCacheSize(): number {
  return _storeImageCache.size;
}

export function getStoreImageCacheSnapshot(): Record<string, StoreImageCacheEntry> {
  const snapshot: Record<string, StoreImageCacheEntry> = {};
  for (const [key, entry] of _storeImageCache) {
    snapshot[key] = entry;
  }
  return snapshot;
}

// Build a display image URL from catalog metadata / provider / fallback
// Does NOT touch local MediaIndex or appinfo.
export function resolveStoreDisplayImage(
  appId: string,
  role: StoreImageRole,
  options: {
    catalogCapsule?: string | null;
    catalogHeader?: string | null;
    metadataCapsule?: string | null;
    metadataHeader?: string | null;
    providerImage?: string | null;
  },
): string | undefined {
  // Check cache first
  const cached = getStoreDisplayImage(appId, role);
  if (cached) {
    log(`cache-hit appid=${appId} role=${role}`);
    return cached;
  }

  // Fallback chain
  const fallbacks = [
    { url: options.catalogCapsule, source: "catalog" as StoreImageSource },
    { url: options.catalogHeader, source: "catalog" as StoreImageSource },
    { url: options.metadataCapsule, source: "metadata" as StoreImageSource },
    { url: options.metadataHeader, source: "metadata" as StoreImageSource },
    { url: options.providerImage, source: "provider" as StoreImageSource },
  ];

  for (const { url, source } of fallbacks) {
    if (url) {
      setStoreImageCacheEntry(appId, role, {
        url,
        source,
        status: "resolved",
        resolvedAt: Date.now(),
        appid: appId,
        role,
      });
      return url;
    }
  }

  // Steam CDN fallback
  const appIdNum = Number(appId);
  if (Number.isFinite(appIdNum) && appIdNum > 0) {
    let cdnUrl: string | null = null;
    // Steam CDN URL patterns
    if (role === "hero") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/library_hero.jpg`;
    } else if (role === "capsule") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/capsule_231x87.jpg`;
    } else if (role === "header") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/header.jpg`;
    } else if (role === "featured" || role === "featuredThumb") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/capsule_616x353.jpg`;
    } else if (role === "thumbnail" || role === "browseCard") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/capsule_184x69.jpg`;
    } else if (role === "newsCard") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/header.jpg`;
    } else if (role === "storeDetailsHero") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/library_hero.jpg`;
    } else if (role === "storeDetailsThumb") {
      cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/capsule_184x69.jpg`;
    }
    if (cdnUrl) {
      setStoreImageCacheEntry(appId, role, {
        url: cdnUrl,
        source: "steam-cdn",
        status: "resolved",
        resolvedAt: Date.now(),
        appid: appId,
        role,
      });
      return cdnUrl;
    }
  }

  return undefined;
}

/**
 * Get the best image URL for a Store game by checking cached images first,
 * then metadata fields, then Steam CDN fallback. Checks multiple role
 * priorities so hero/header/capsule all resolve from the same cache.
 *
 * Does NOT touch MediaIndex or BootSnapshot.
 *
 * @param rolePriority  Ordered list of roles to check in the cache (e.g. ["hero","header","capsule"])
 * @param metadata      Optional SteamAppMetadata for metadata-based fallback
 */
export function getBestStoreImage(
  appId: string,
  rolePriority: StoreImageRole[],
  metadata?: SteamAppMetadata | null,
): string | undefined {
  for (const role of rolePriority) {
    const cached = getStoreDisplayImage(appId, role);
    if (cached) return cached;
  }

  if (metadata) {
    const pairs: Array<{ url: string | null | undefined; role: StoreImageRole }> = [
      { url: metadata.header_image, role: "header" },
      { url: metadata.capsule_image_v5, role: "capsule" },
      { url: metadata.capsule_image, role: "capsule" },
    ];
    for (const { url, role } of pairs) {
      if (url) {
        setStoreImageCacheEntry(appId, role, {
          url,
          source: "metadata",
          status: "resolved",
          resolvedAt: Date.now(),
          appid: appId,
          role,
        });
        return url;
      }
    }
  }

  const appIdNum = Number(appId);
  if (Number.isFinite(appIdNum) && appIdNum > 0) {
    for (const role of rolePriority) {
      let cdnUrl: string | null = null;
      if (role === "hero" || role === "storeDetailsHero") {
        cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/library_hero.jpg`;
      } else if (role === "featured" || role === "capsule") {
        cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/capsule_616x353.jpg`;
      } else if (role === "header") {
        cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/header.jpg`;
      } else if (role === "thumbnail" || role === "browseCard") {
        cdnUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}/capsule_184x69.jpg`;
      }
      if (cdnUrl) {
        setStoreImageCacheEntry(appId, role, {
          url: cdnUrl,
          source: "steam-cdn-fallback",
          status: "resolved",
          resolvedAt: Date.now(),
          appid: appId,
          role,
        });
        return cdnUrl;
      }
    }
  }

  return undefined;
}
