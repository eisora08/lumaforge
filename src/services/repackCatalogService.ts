/**
 * Repack Catalog Service — queries the SQLite repack index for Store/Library repack sections.
 *
 * Mirrors the steamCatalogService.ts pattern with TTL caching.
 */

import {
  getRepackCatalogMeta,
  importRepackCatalog,
  queryRepackCatalogFuzzy,
  queryRepackCatalogAll,
  queryRepackCatalogByAppId,
  queryRepackCatalogByRepacker,
  type RepackQueryResult,
  type RepackCatalogMeta,
} from "./tauri";
import { rankRepackMatches } from "./repackMatch";

const BUNDLED_ARTIFACT_PATH = "/data/repacks/repack-catalog-v1.json";
const BUNDLED_MANIFEST_PATH = "/data/repacks/repack-catalog-v1.manifest.json";

// ── TTL cache (5 min) ──

const CACHE_TTL_MS = 5 * 60 * 1000;
const _categoryCache = new Map<string, { ts: number; games: RepackQueryResult[] }>();
const _metaCache = new Map<string, { ts: number; meta: RepackCatalogMeta }>();

// The SQL fuzzy query is substring + `LIMIT` ordered by title length ASC, so a
// raw pool can be cut short by unrelated short matches ("SPORTAL" for
// "Portal"). Fetch a larger superset, then re-rank in TS with whole-word
// token matching (`rankRepackMatches`) and slice down to the caller's limit.
const FUZZY_POOL_SIZE = 100;

function isCacheFresh(entry: { ts: number } | undefined): entry is { ts: number } {
  return entry !== undefined && Date.now() - entry.ts < CACHE_TTL_MS;
}

// ── Public API ──

/**
 * Get repack catalog metadata — whether imported, counts, checksum.
 * Cached for 5 minutes.
 */
export async function getRepackStatus(): Promise<RepackCatalogMeta> {
  const cached = _metaCache.get("meta");
  if (isCacheFresh(cached)) return cached.meta;

  try {
    const meta = await getRepackCatalogMeta();
    _metaCache.set("meta", { ts: Date.now(), meta });
    return meta;
  } catch (err) {
    console.error("[REPACK][STATUS] Failed:", err);
    return {
      hasCatalog: false, schemaVersion: 0, recordCount: 0,
      gamesWithAppId: 0, checksum: "", importedAt: "",
    };
  }
}

/**
 * Import a repack catalog artifact (JSON string) into SQLite.
 */
export async function importRepackArtifact(
  artifactJson: string,
  checksum: string,
): Promise<number> {
  const count = await importRepackCatalog(artifactJson, checksum);
  clearRepackCatalogCaches();
  return count;
}

/**
 * Search repacks by fuzzy title match.
 * Returns cached results when available.
 */
export async function searchRepacksByTitle(
  query: string,
  limit = 20,
): Promise<{ results: RepackQueryResult[]; fromCache: boolean }> {
  const cacheKey = `fuzzy:${query}:${limit}`;
  const cached = _categoryCache.get(cacheKey);
  if (isCacheFresh(cached)) {
    return { results: cached.games, fromCache: true };
  }

  try {
    const raw = await queryRepackCatalogFuzzy(query, FUZZY_POOL_SIZE);
    const games = rankRepackMatches(query, raw, limit);
    _categoryCache.set(cacheKey, { ts: Date.now(), games });
    return { results: games, fromCache: false };
  } catch (err) {
    console.error(`[REPACK][SEARCH] Failed for "${query}":`, err);
    return { results: [], fromCache: false };
  }
}

/**
 * Get available repacks for a specific Steam app ID.
 */
export async function getRepacksForAppId(
  appId: number,
): Promise<RepackQueryResult[]> {
  try {
    return await queryRepackCatalogByAppId(appId);
  } catch (err) {
    console.error(`[REPACK][APPID] Failed for ${appId}:`, err);
    return [];
  }
}

/**
 * Get all repack catalog entries.
 * Cached for 5 minutes.
 */
let _allEntriesCache: { ts: number; entries: RepackQueryResult[] } | null = null;

export async function getAllRepackEntries(): Promise<RepackQueryResult[]> {
  if (_allEntriesCache && Date.now() - _allEntriesCache.ts < CACHE_TTL_MS) {
    return _allEntriesCache.entries;
  }

  try {
    const entries = await queryRepackCatalogAll();
    _allEntriesCache = { ts: Date.now(), entries };
    return entries;
  } catch (err) {
    console.error("[REPACK][ALL] Failed:", err);
    return [];
  }
}

/**
 * Get repacks by repacker name with pagination.
 */
export async function getRepacksByRepacker(
  repacker: string,
  limit = 20,
  offset = 0,
): Promise<RepackQueryResult[]> {
  const cacheKey = `repacker:${repacker}:${limit}:${offset}`;
  const cached = _categoryCache.get(cacheKey);
  if (isCacheFresh(cached)) return cached.games;

  try {
    const games = await queryRepackCatalogByRepacker(repacker, limit, offset);
    _categoryCache.set(cacheKey, { ts: Date.now(), games });
    return games;
  } catch (err) {
    console.error(`[REPACK][REPACKER] Failed for ${repacker}:`, err);
    return [];
  }
}

// ── Auto-import on boot ──

let _importInFlight: Promise<boolean> | null = null;

/**
 * Ensure the bundled repack catalog artifact is imported into SQLite.
 * Checks if catalog exists; if not, fetches bundled JSON and imports.
 * Deduplicates concurrent callers.
 */
export async function ensureRepackCatalogImported(): Promise<boolean> {
  const status = await getRepackStatus();

  // Fetch bundled manifest to know the current checksum
  const manifestRes = await fetch(BUNDLED_MANIFEST_PATH);
  let manifestChecksum = "";
  if (manifestRes.ok) {
    try {
      const manifest = await manifestRes.json();
      manifestChecksum = manifest.checksum || "";
    } catch {}
  }

  // If catalog exists and checksum matches, no re-import needed
  if (status.hasCatalog && status.checksum === manifestChecksum) {
    return true;
  }

  // If already importing, wait for that
  if (_importInFlight) return _importInFlight;

  _importInFlight = (async () => {
    try {
      const reason = status.hasCatalog
        ? `checksum changed (${status.checksum.slice(0, 8)} → ${manifestChecksum.slice(0, 8)})`
        : "no catalog found";
      console.log(`[REPACK][AUTO_IMPORT] ${reason}, loading bundled artifact...`);

      const artifactRes = await fetch(BUNDLED_ARTIFACT_PATH);
      if (!artifactRes.ok) {
        console.warn("[REPACK][AUTO_IMPORT] Bundled artifact not found:", artifactRes.status);
        return false;
      }

      const artifactJson = await artifactRes.text();

      const count = await importRepackArtifact(artifactJson, manifestChecksum);
      console.log(`[REPACK][AUTO_IMPORT] Imported ${count} records`);
      return count > 0;
    } catch (err) {
      console.error("[REPACK][AUTO_IMPORT] Failed:", err);
      return false;
    } finally {
      _importInFlight = null;
    }
  })();

  return _importInFlight;
}

// ── Cache clear ──

/**
 * Clear all in-memory repack catalog caches (fuzzy, meta, all-entries).
 * Call after importing/removing repack feeds so fresh rows are immediately searchable.
 */
export function clearRepackCatalogCaches(): void {
  _categoryCache.clear();
  _metaCache.clear();
  _allEntriesCache = null;
}
