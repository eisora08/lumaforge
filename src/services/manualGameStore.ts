// ─── Types ──────────────────────────────────────────────────────────────

export type ManualGameEntry = {
  id: string;
  name: string;
  executablePath?: string;
  workingDirectory?: string;
  launchArguments?: string;
  installDir?: string;
  libraryPath?: string;

  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;

  genres?: string[];
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  description?: string;
  shortDescription?: string;

  categories?: string[];
  features?: string[];
  tags?: string[];
  sortingName?: string;

  userScore?: string;
  criticScore?: string;
  communityScore?: string;
  reviewSummary?: string;
  reviewCount?: string;
  reviewSource?: string;

  series?: string;
  ageRating?: string;
  region?: string;
  completionStatus?: string;

  linkedSteamAppId?: string;
  linkedIgdbId?: string;

  sizeOnDisk?: number;
  isFavorite?: boolean;

  createdAt: number;
  updatedAt: number;
};

type ManualGameStore = {
  version: number;
  entries: ManualGameEntry[];
};

// ─── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "lumaforge-manual-games-v1";

// ─── Module-level cache ─────────────────────────────────────────────────

let _cache: ManualGameEntry[] | null = null;

// ─── Listeners ──────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

// ─── Persistence ────────────────────────────────────────────────────────

function loadFromStorage(): ManualGameEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ManualGameStore;
      if (Array.isArray(parsed.entries)) return parsed.entries;
    }
  } catch {
    // corrupt storage — return empty
  }
  return [];
}

function saveToStorage(entries: ManualGameEntry[]): void {
  try {
    const store: ManualGameStore = { version: 1, entries };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full
  }
}

function ensureCache(): ManualGameEntry[] {
  if (_cache === null) _cache = loadFromStorage();
  return _cache;
}

// ─── Public API ─────────────────────────────────────────────────────────

export function loadManualGames(): ManualGameEntry[] {
  return ensureCache();
}

export function getAllManualGames(): ManualGameEntry[] {
  return [...ensureCache()];
}

export function getManualGame(id: string): ManualGameEntry | undefined {
  return ensureCache().find((e) => e.id === id);
}

export function getManualGameCount(): number {
  return ensureCache().length;
}

export function saveManualGame(entry: ManualGameEntry): ManualGameEntry {
  const entries = ensureCache();
  if (entries.some((e) => e.id === entry.id)) {
    throw new Error(`Manual game "${entry.id}" already exists`);
  }
  entries.push(entry);
  saveToStorage(entries);
  notifyListeners();
  return entry;
}

export function updateManualGame(
  id: string,
  patch: Partial<ManualGameEntry>
): ManualGameEntry {
  const entries = ensureCache();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error(`Manual game "${id}" not found`);
  const updated = { ...entries[idx], ...patch, id, updatedAt: Date.now() };
  entries[idx] = updated;
  saveToStorage(entries);
  notifyListeners();
  return updated;
}

export function removeManualGame(id: string): boolean {
  const entries = ensureCache();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  saveToStorage(entries);
  notifyListeners();
  return true;
}

export function subscribeManualGames(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

export function resetManualGameCache(): void {
  _cache = null;
}
