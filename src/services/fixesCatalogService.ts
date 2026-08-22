/**
 * Fixes Catalog Service
 * Fetches the LumaForge fixes catalog from Cloudflare Pages.
 * catalog.json is protected by API key; HTML page is public.
 */

const CATALOG_URL = "https://lumaforge-fixes.pages.dev/catalog.json";
const CATALOG_KEY = "lf_e2ecff2175c36048d05a950d8c1d21bbf6a9dea8608ac47f";
const CATALOG_PAGE_URL = "https://lumaforge-fixes.pages.dev/";

export type FixType = "fix" | "repack";

export interface FixesCatalogEntry {
  id: string;
  appId: string;
  title: string;
  provider: string;
  type: FixType;
  downloadUrl: string;
  filename: string;
  fileSizeHuman?: string;
  installerType?: string;
  tags?: string[];
}

export interface FixesCatalogProvider {
  name: string;
  type: FixType;
  description: string;
}

export interface FixesCatalog {
  schemaVersion: number;
  generatedAt: string;
  providers: Record<string, FixesCatalogProvider>;
  entries: FixesCatalogEntry[];
}

let _cache: FixesCatalog | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchFixesCatalog(forceRefresh = false): Promise<FixesCatalog | null> {
  if (!forceRefresh && _cache && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cache;
  }

  try {
    const resp = await fetch(CATALOG_URL, {
      headers: { "X-LumaForge-Key": CATALOG_KEY },
    });

    if (!resp.ok) {
      console.warn("[FIXES_CATALOG] fetch failed:", resp.status);
      return _cache;
    }

    const catalog: FixesCatalog = await resp.json();
    _cache = catalog;
    _cacheTimestamp = Date.now();
    return catalog;
  } catch (e) {
    console.warn("[FIXES_CATALOG] fetch error:", e);
    return _cache;
  }
}

export function getFixesForAppId(appId: string): FixesCatalogEntry[] {
  if (!_cache) return [];
  return _cache.entries.filter((e) => e.appId === appId);
}

export function getFixesByType(type: FixType): FixesCatalogEntry[] {
  if (!_cache) return [];
  return _cache.entries.filter((e) => e.type === type);
}

export function getFixesByProvider(provider: string): FixesCatalogEntry[] {
  if (!_cache) return [];
  return _cache.entries.filter((e) => e.provider === provider);
}

export function searchFixesCatalog(query: string): FixesCatalogEntry[] {
  if (!_cache) return [];
  const q = query.toLowerCase();
  return _cache.entries.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.appId.includes(q) ||
      e.provider.toLowerCase().includes(q) ||
      e.tags?.some((t) => t.includes(q))
  );
}

export function getCatalogPageUrl(): string {
  return CATALOG_PAGE_URL;
}

export function clearFixesCatalogCache(): void {
  _cache = null;
  _cacheTimestamp = 0;
}
