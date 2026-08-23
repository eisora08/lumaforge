import type { SteamAppMetadata } from "../types/gameMetadata";
import { getStoreGameDetails } from "./storeLocalCacheService";
import type { StoreCatalogGame } from "./storeCatalogProvider";

/**
 * Bridge: convert a StoreCatalogGame (from the orchestrator's canonical sections)
 * into a NormalizedCatalogGame for dashboard card rendering.
 * Media fields are derived from the orchestrator's imageUrl/backgroundImageUrl.
 * Metadata is null — callers that need full metadata should use enrichEntry/normalizeEntry.
 */
export function mapStoreCatalogGameToCard(game: StoreCatalogGame): NormalizedCatalogGame {
  const appId = game.steamAppId ?? game.id;
  const releaseTs = game.releaseTimestamp ?? 0;
  const now = Date.now();
  const isNew = releaseTs > 0 && (now - releaseTs) < 30 * 24 * 60 * 60 * 1000;

  return {
    appId,
    title: game.title,
    releaseDate: game.releaseDate ?? null,
    releaseTimestamp: releaseTs,
    isNew,
    media: {
      headerImage: game.backgroundImageUrl ?? null,
      capsuleImage: game.imageUrl ?? null,
      capsuleImageV5: null,
      libraryHeroImage: null,
      backgroundImage: game.backgroundImageUrl ?? null,
    },
    metadata: null,
  };
}

export type SteamDbEntry = {
  appid: number;
  name: string;
};

export type NormalizedCatalogGame = {
  appId: string;
  title: string;
  releaseDate: string | null;
  releaseTimestamp: number;
  isNew: boolean;
  media: {
    headerImage: string | null;
    capsuleImage: string | null;
    capsuleImageV5: string | null;
    libraryHeroImage: string | null;
    backgroundImage: string | null;
  };
  metadata: SteamAppMetadata | null;
};

export type CatalogStatus =
  | "loading"
  | "ready"
  | "unavailable"
  | "empty"
  | "error";

type CatalogState = {
  status: CatalogStatus;
  total: number;
  source: string;
};

let _catalogPromise: Promise<SteamDbEntry[]> | null = null;
let _cachedRaw: SteamDbEntry[] | null = null;
let _cachedNormalized: NormalizedCatalogGame[] | null = null;
let _catalogState: CatalogState = { status: "loading", total: 0, source: "steamdb.json" };
let _stateListeners: Set<(state: CatalogState) => void> = new Set();

function notifyState() {
  for (const fn of _stateListeners) fn(_catalogState);
}

export function subscribeCatalogState(fn: (state: CatalogState) => void): () => void {
  _stateListeners.add(fn);
  return () => { _stateListeners.delete(fn); };
}

export function getCatalogState(): CatalogState {
  return { ..._catalogState };
}

export function getCachedCatalog(): NormalizedCatalogGame[] {
  return _cachedNormalized ?? [];
}

function normalizeEntry(entry: SteamDbEntry, meta: SteamAppMetadata | null): NormalizedCatalogGame {
  const releaseDate = meta?.release_date || null;
  const ts = releaseDate ? parseReleaseDate(releaseDate) : 0;
  return {
    appId: String(entry.appid),
    title: entry.name,
    releaseDate,
    releaseTimestamp: ts,
    isNew: false,
    media: {
      headerImage: meta?.header_image || null,
      capsuleImage: meta?.capsule_image || null,
      capsuleImageV5: meta?.capsule_image_v5 || null,
      libraryHeroImage: meta?.library_hero_image || null,
      backgroundImage: meta?.background_image || null,
    },
    metadata: meta,
  };
}

export function parseReleaseDate(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const lower = dateStr.toLowerCase();
  if (lower.includes("coming") || lower.includes("announce") || lower.includes("soon") || lower.includes("tba")) return 0;
  const iso = Date.parse(dateStr);
  if (!isNaN(iso)) return iso;
  const cleaned = dateStr.replace(/,/g, "").trim();
  const parsed = Date.parse(cleaned);
  if (!isNaN(parsed)) return parsed;
  return 0;
}

async function enrichEntry(entry: SteamDbEntry): Promise<NormalizedCatalogGame> {
  let meta: SteamAppMetadata | null = null;
  try {
    const cached = await getStoreGameDetails(entry.appid);
    if (cached?.data) {
      meta = cached.data as SteamAppMetadata;
    }
  } catch { /* metadata not cached */ }
  return normalizeEntry(entry, meta);
}

export async function loadGlobalCatalog(): Promise<SteamDbEntry[]> {
  if (_cachedRaw) {
    // Ensure subscribers see the current ready state even if they subscribed late
    if (_catalogState.status !== "ready") {
      _catalogState = { ..._catalogState, status: "ready", total: _cachedRaw.length };
      notifyState();
    }
    return _cachedRaw;
  }
  if (_catalogPromise) return _catalogPromise;

  console.log("[DASH][GLOBAL_CATALOG_STATE] status=loading total=0 source=steamdb.json");
  _catalogState = { ..._catalogState, status: "loading", total: 0 };
  notifyState();

  _catalogPromise = fetch("/data/steamdb.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SteamDbEntry[]>;
    })
    .then((data) => {
      _cachedRaw = data;
      if (data.length === 0) {
        _catalogState = { status: "empty", total: 0, source: "steamdb.json" };
        console.log("[DASH][GLOBAL_CATALOG_STATE] status=empty total=0 reason=empty-file");
      } else {
        _catalogState = { status: "ready", total: data.length, source: "steamdb.json" };
        console.log(`[DASH][GLOBAL_CATALOG_STATE] status=ready total=${data.length} source=steamdb.json`);
      }
      notifyState();
      return data;
    })
    .catch((err) => {
      _catalogPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[GLOBAL_CATALOG] Failed to load steamdb.json", msg);
      _catalogState = { status: "error", total: 0, source: "steamdb.json" };
      console.log(`[DASH][GLOBAL_CATALOG_STATE] status=error error=${msg}`);
      notifyState();
      return [] as SteamDbEntry[];
    });

  return _catalogPromise;
}

export async function loadNormalizedCatalog(
  limit = 500,
): Promise<{ entries: NormalizedCatalogGame[]; state: CatalogState }> {
  const catalog = await loadGlobalCatalog();
  if (catalog.length === 0) {
    return { entries: [], state: { ..._catalogState } };
  }

  const slice = catalog.slice(0, limit);
  const batchSize = 50;
  const results: NormalizedCatalogGame[] = [];
  for (let i = 0; i < slice.length; i += batchSize) {
    const batch = slice.slice(i, i + batchSize);
    const entries = await Promise.all(batch.map(enrichEntry));
    results.push(...entries);
  }

  _cachedNormalized = results;
  return { entries: results, state: { ..._catalogState } };
}

export function getCatalogSample(): NormalizedCatalogGame[] {
  if (!_cachedNormalized || _cachedNormalized.length === 0) return [];
  return _cachedNormalized.slice(0, 5);
}

/**
 * Start global catalog loading without waiting for normalized enrichment.
 * Safe to call from useEffect. Idempotent — subsequent calls return cached state.
 * Returns the raw catalog promise so callers can await if needed.
 */
export function discoverGlobalCatalog(): Promise<SteamDbEntry[]> {
  return loadGlobalCatalog();
}
