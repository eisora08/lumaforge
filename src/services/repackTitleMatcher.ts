import type { RepackEntry } from "../types/package";

// ── Raw JSON shapes ──

interface SteamRipFile {
  name: string;
  downloads: SteamRipDownload[];
}

interface SteamRipDownload {
  title: string;
  uploadDate: string;
  fileSize: string;
  uris: string[];
}

interface FitGirlFile {
  name: string;
  downloads: FitGirlDownload[];
}

interface FitGirlDownload {
  title: string;
  uris: string[];
  uploadDate: string;
  fileSize: string;
}

// ── Module-level cache ──

let _steamripReady = false;
let _loadError: Error | null = null;

let _steamripEntries: RepackEntry[] = [];
let _fitgirlEntries: RepackEntry[] = [];

let _steamripIndex = new Map<string, RepackEntry[]>();
let _fitgirlIndex = new Map<string, RepackEntry[]>();

// ── Callbacks — fire when index gets new data ──

let _indexUpdateCallbacks: Array<() => void> = [];

function notifyIndexUpdated() {
  const cbs = _indexUpdateCallbacks;
  _indexUpdateCallbacks = [];
  for (const cb of cbs) {
    try { cb(); } catch { /* ignore callback errors */ }
  }
}

/** Register a callback fired when the repack index gains new data (e.g. FitGirl finished loading). */
export function subscribeRepackIndex(cb: () => void): () => void {
  _indexUpdateCallbacks.push(cb);
  return () => {
    _indexUpdateCallbacks = _indexUpdateCallbacks.filter((c) => c !== cb);
  };
}

// ── Title parsers ──

function parseSteamripTitle(raw: string): string {
  let s = raw
    .replace(/ Free Download/i, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  return s.replace(/\s+/g, " ").trim();
}

function parseFitgirlTitle(raw: string): string {
  let s = raw.replace(/[,–-]\s*v?\d[\d.]*.*$/, "").trim();
  return s.replace(/\s+/g, " ").trim();
}

// ── Normalizer ──

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── File size parser ──

function parseFileSize(size: string): number {
  const m = size.match(/^([\d.]+)\s*(TB|GB|MB|KB)$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2].toUpperCase();
  if (u === "TB") return n * 1024 * 1024 * 1024 * 1024;
  if (u === "GB") return n * 1024 * 1024 * 1024;
  if (u === "MB") return n * 1024 * 1024;
  if (u === "KB") return n * 1024;
  return 0;
}

// ── SteamRip loader (fast, ~212 KB) ──

let _steamripLoadPromise: Promise<void> | null = null;

async function ensureSteamripLoaded(): Promise<void> {
  if (_steamripReady) return;
  if (_steamripLoadPromise) return _steamripLoadPromise;

  _steamripLoadPromise = (async () => {
    try {
      const res = await fetch("/data/repacks/steamrip.json");
      if (!res.ok) {
        console.warn(`[REPACK_MATCHER] steamrip.json fetch failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as SteamRipFile;
      for (const dl of data.downloads) {
        const cleanTitle = parseSteamripTitle(dl.title);
        const key = normalizeName(cleanTitle);
        const entry: RepackEntry = {
          id: `steamrip-${key}-${_steamripEntries.length}`,
          title: dl.title,
          appId: 0,
          repacker: "steamrip",
          installerType: "unknown",
          fileSize: parseFileSize(dl.fileSize),
          installSize: null,
          languages: [],
          downloadUris: dl.uris,
          sourceUrl: dl.uris[0] || "",
          checksum: null,
          updatedAt: dl.uploadDate,
          tags: ["repack", "steamrip"],
        };
        _steamripEntries.push(entry);
        if (!_steamripIndex.has(key)) _steamripIndex.set(key, []);
        _steamripIndex.get(key)!.push(entry);
      }
      console.log(`[REPACK_MATCHER] Loaded ${_steamripEntries.length} SteamRip entries`);
    } catch (err) {
      _loadError = err instanceof Error ? err : new Error(String(err));
      console.error("[REPACK_MATCHER] SteamRip load failed:", err);
    }
  })();

  return _steamripLoadPromise;
}

// ── FitGirl loader (slow, ~10.5 MB — runs in background) ──

async function loadFitgirlInBackground(): Promise<void> {
  try {
    const res = await fetch("/data/repacks/fitgirl.json");
    if (!res.ok) {
      console.warn(`[REPACK_MATCHER] fitgirl.json fetch failed: ${res.status}`);
      return;
    }
    const data = (await res.json()) as FitGirlFile;
    for (const dl of data.downloads) {
      const cleanTitle = parseFitgirlTitle(dl.title);
      const key = normalizeName(cleanTitle);
      const entry: RepackEntry = {
        id: `fitgirl-${key}-${_fitgirlEntries.length}`,
        title: dl.title,
        appId: 0,
        repacker: "fitgirl",
        installerType: "unknown",
        fileSize: parseFileSize(dl.fileSize),
        installSize: null,
        languages: [],
        downloadUris: dl.uris,
        sourceUrl: dl.uris[0] || "",
        checksum: null,
        updatedAt: dl.uploadDate,
        tags: ["repack", "fitgirl"],
      };
      _fitgirlEntries.push(entry);
      if (!_fitgirlIndex.has(key)) _fitgirlIndex.set(key, []);
      _fitgirlIndex.get(key)!.push(entry);
    }
    console.log(`[REPACK_MATCHER] Loaded ${_fitgirlEntries.length} FitGirl entries`);
  } catch (err) {
    console.error("[REPACK_MATCHER] FitGirl load failed:", err);
    } finally {
      notifyIndexUpdated();
    }
}

// Kick off FitGirl load at module init (background, never awaited)
loadFitgirlInBackground();

// ── All-entry scanner (contains-based fallback) ──

const _MATCH_CACHE = new Map<string, RepackEntry[]>();

function scanByContains(gameName: string): RepackEntry[] {
  const baseKey = normalizeName(gameName);
  if (!baseKey) return [];

  const cached = _MATCH_CACHE.get(baseKey);
  if (cached) return cached;

  const results: RepackEntry[] = [];
  const seen = new Set<string>();

  for (const [repackKey, entries] of _steamripIndex) {
    if (repackKey.includes(baseKey) || baseKey.includes(repackKey)) {
      for (const e of entries) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          results.push(e);
        }
      }
    }
  }

  for (const [repackKey, entries] of _fitgirlIndex) {
    if (repackKey.includes(baseKey) || baseKey.includes(repackKey)) {
      for (const e of entries) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          results.push(e);
        }
      }
    }
  }

  _MATCH_CACHE.set(baseKey, results);
  return results;
}

// ── Public API ──

/**
 * Find repack entries matching a game by its canonical name.
 * Loads steamrip.json (fast) first — does NOT wait for fitgirl.json.
 * FitGirl entries are included once they finish loading in background.
 * Subscribe via `subscribeRepackIndex()` to be notified when the index updates.
 */
export async function getRepacksForGameName(
  appId: number,
  gameName: string,
): Promise<RepackEntry[]> {
  await ensureSteamripLoaded();
  if (_loadError) return [];

  const key = normalizeName(gameName);
  if (!key) return [];

  // Phase 1 — exact match
  const exact: RepackEntry[] = [];

  const steamripExact = _steamripIndex.get(key);
  if (steamripExact) {
    for (const e of steamripExact) exact.push({ ...e, appId });
  }

  const fitgirlExact = _fitgirlIndex.get(key);
  if (fitgirlExact) {
    for (const e of fitgirlExact) exact.push({ ...e, appId });
  }

  if (exact.length > 0) return exact;

  // Phase 2 — contains-based fallback
  const fuzzy = scanByContains(gameName);
  if (fuzzy.length > 0) {
    console.log(`[REPACK_MATCHER] contains match: "${gameName}" → ${fuzzy.length} entries`);
    return fuzzy.map((e) => ({ ...e, appId }));
  }

  return [];
}

export function getRepackMatcherStats(): { steamrip: number; fitgirl: number } {
  return {
    steamrip: _steamripEntries.length,
    fitgirl: _fitgirlEntries.length,
  };
}

export function clearRepackMatcherCache(): void {
  _steamripReady = false;
  _loadError = null;
  _steamripLoadPromise = null;
  _steamripEntries = [];
  _fitgirlEntries = [];
  _steamripIndex.clear();
  _fitgirlIndex.clear();
  _MATCH_CACHE.clear();
  _indexUpdateCallbacks = [];
}
