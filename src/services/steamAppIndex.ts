const ENABLE_STEAM_APP_INDEX = false;

export type SteamAppIndexEntry = {
  appid: number;
  name: string;
};

type IndexedEntry = {
  appid: number;
  name: string;
  normalized: string;
};

type SteamAppIndexState =
  | { kind: "unloaded" }
  | { kind: "loading"; promise: Promise<IndexedEntry[]> }
  | { kind: "loaded"; entries: IndexedEntry[]; appIdToName: Map<number, string>; normalizedToEntry: Map<string, SteamAppIndexEntry> }
  | { kind: "error"; error: unknown };

let state: SteamAppIndexState = { kind: "unloaded" };

const STEAMDB_PATH = "/data/steamdb.json";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MIN_QUERY_LENGTH = 3;

function normalizeName(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/[\u2122\u00ae\u00a9]/g, "");
  s = s.replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'");
  s = s.replace(/[\u201c\u201d\u201e\u201f\u2033\u2036]/g, '"');
  s = s.replace(/[\u2013\u2014]/g, "-");
  s = s.replace(/\s+/g, " ");
  s = s.replace(/[^\w\s'-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function loadIndex(): Promise<IndexedEntry[]> {
  if (!ENABLE_STEAM_APP_INDEX) return Promise.resolve([]);
  if (state.kind === "loaded") return Promise.resolve(state.entries);
  if (state.kind === "loading") return state.promise;
  if (state.kind === "error") return Promise.resolve([]);

  const promise = fetch(STEAMDB_PATH)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SteamAppIndexEntry[]>;
    })
    .then((rawEntries) => {
      const appIdToName = new Map<number, string>();
      const normalizedToEntry = new Map<string, SteamAppIndexEntry>();
      const entries: IndexedEntry[] = [];

      for (const entry of rawEntries) {
        appIdToName.set(entry.appid, entry.name);
        const norm = normalizeName(entry.name);
        if (!normalizedToEntry.has(norm)) {
          normalizedToEntry.set(norm, entry);
        }
        entries.push({ appid: entry.appid, name: entry.name, normalized: norm });
      }

      state = { kind: "loaded", entries, appIdToName, normalizedToEntry };
      return entries;
    })
    .catch((err) => {
      console.warn("[SteamAppIndex] failed to load local index", err);
      state = { kind: "error", error: err };
      return [];
    });

  state = { kind: "loading", promise };
  return promise;
}

function clampLimit(limit: number): number {
  if (limit < 1) return 1;
  if (limit > MAX_LIMIT) return MAX_LIMIT;
  return limit;
}

export async function loadSteamAppIndex(): Promise<SteamAppIndexEntry[]> {
  const entries = await loadIndex();
  return entries.map((e) => ({ appid: e.appid, name: e.name }));
}

export async function getSteamAppName(appId: string | number): Promise<string | null> {
  if (!ENABLE_STEAM_APP_INDEX) return null;
  const id = typeof appId === "string" ? Number(appId) : appId;
  await loadIndex();
  if (state.kind !== "loaded") return null;
  return state.appIdToName.get(id) ?? null;
}

export async function findSteamAppsByName(query: string, limit: number = DEFAULT_LIMIT): Promise<SteamAppIndexEntry[]> {
  if (!ENABLE_STEAM_APP_INDEX) return [];
  const q = normalizeName(query);
  if (q.length < MIN_QUERY_LENGTH) return [];

  const entries = await loadIndex();
  if (entries.length === 0) return [];

  const clamped = clampLimit(limit);
  const results: { entry: SteamAppIndexEntry; score: number }[] = [];

  for (const entry of entries) {
    const name = entry.normalized;
    if (name === q) {
      results.push({ entry, score: 100 });
    } else if (name.startsWith(q)) {
      results.push({ entry, score: 80 });
    } else if (name.includes(q)) {
      results.push({ entry, score: 60 });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, clamped).map((r) => r.entry);
}

export async function findSteamAppByExactName(name: string): Promise<SteamAppIndexEntry | null> {
  if (!ENABLE_STEAM_APP_INDEX) return null;
  const norm = normalizeName(name);
  await loadIndex();
  if (state.kind !== "loaded") return null;
  return state.normalizedToEntry.get(norm) ?? null;
}

export async function fuzzyFindSteamApp(name: string, limit: number = DEFAULT_LIMIT): Promise<SteamAppIndexEntry[]> {
  if (!ENABLE_STEAM_APP_INDEX) return [];
  const q = normalizeName(name);
  if (q.length < MIN_QUERY_LENGTH) return [];

  const entries = await loadIndex();
  if (entries.length === 0) return [];

  const clamped = clampLimit(limit);
  const results: { entry: SteamAppIndexEntry; score: number }[] = [];

  for (const entry of entries) {
    const name = entry.normalized;
    if (name === q) {
      results.push({ entry, score: 100 });
    } else if (name.startsWith(q)) {
      results.push({ entry, score: 80 });
    } else if (name.includes(q)) {
      results.push({ entry, score: 60 });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, clamped).map((r) => r.entry);
}

export type SteamAppMatch = {
  appid: number;
  name: string;
  confidence: "exact" | "high" | "medium" | "low";
};

export async function resolveBestSteamAppMatch(name: string): Promise<SteamAppMatch | null> {
  if (!ENABLE_STEAM_APP_INDEX) return null;
  const entries = await loadIndex();
  if (entries.length === 0) return null;

  const q = normalizeName(name);
  const matches: { entry: IndexedEntry; confidence: SteamAppMatch["confidence"]; order: number }[] = [];

  for (const entry of entries) {
    if (entry.normalized === q) {
      matches.push({ entry, confidence: "exact", order: 0 });
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => a.order - b.order);
    const best = matches[0];
    return { appid: best.entry.appid, name: best.entry.name, confidence: best.confidence };
  }

  const fuzzyMatches: { entry: IndexedEntry; score: number }[] = [];
  const qWords = q.split(/\s+/).filter(Boolean);

  for (const entry of entries) {
    const en = entry.normalized;
    if (en.startsWith(q) || en.includes(q)) {
      fuzzyMatches.push({ entry, score: 50 });
      continue;
    }
    const words = en.split(/\s+/).filter(Boolean);
    let matchCount = 0;
    for (const qw of qWords) {
      if (words.some((w) => w.startsWith(qw))) matchCount++;
    }
    if (matchCount > 0) {
      fuzzyMatches.push({ entry, score: Math.round((matchCount / qWords.length) * 40) });
    }
  }

  if (fuzzyMatches.length > 0) {
    fuzzyMatches.sort((a, b) => b.score - a.score);
    const best = fuzzyMatches[0];
    const confidence: SteamAppMatch["confidence"] = best.score >= 40 ? "medium" : "low";
    return { appid: best.entry.appid, name: best.entry.name, confidence };
  }

  return null;
}
