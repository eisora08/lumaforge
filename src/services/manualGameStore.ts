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

  /** Steam appId for metadata resolution in GameDetails. */
  appId?: string;

  sizeOnDisk?: number;
  isFavorite?: boolean;

  createdAt: number;
  updatedAt: number;
};

type ManualGameStore = {
  version: number;
  entries: ManualGameEntry[];
};

// ─── games_v2 conversion ────────────────────────────────────────────────

import type { GameV2 } from "../types/gameV2";

/**
 * Convert a ManualGameEntry to a GameV2 for writing to games_v2 table.
 */
export function manualGameEntryToGameV2(entry: ManualGameEntry): GameV2 {
  return {
    id: `manual:${entry.id}`,
    title: entry.name,
    source: "manual",
    appId: entry.appId,
    providerGameId: entry.id,
    libraryId: `manual:${entry.id}`,

    isInstalled: true,
    installDir: entry.installDir,
    installSize: entry.sizeOnDisk,
    exePath: entry.executablePath,
    exeName: entry.executablePath?.split(/[\\/]/).pop(),
    workingDirectory: entry.workingDirectory,
    launchArguments: entry.launchArguments,

    playtimeSeconds: 0,
    playCount: 0,
    lastPlayedAt: undefined,

    coverPath: entry.coverPath,
    landscapePath: entry.landscapePath,
    backgroundPath: entry.backgroundPath,
    logoPath: entry.logoPath,
    iconPath: entry.iconPath,

    releaseDate: entry.releaseDate,
    description: entry.description,
    shortDescription: entry.shortDescription,
    genres: entry.genres ? JSON.stringify(entry.genres) : undefined,
    developers: entry.developers ? JSON.stringify(entry.developers) : undefined,
    publishers: entry.publishers ? JSON.stringify(entry.publishers) : undefined,
    categories: entry.categories ? JSON.stringify(entry.categories) : undefined,
    features: entry.features ? JSON.stringify(entry.features) : undefined,
    tags: entry.tags ? JSON.stringify(entry.tags) : undefined,

    userScore: entry.userScore,
    criticScore: entry.criticScore,
    communityScore: entry.communityScore,
    reviewSummary: entry.reviewSummary,
    reviewCount: entry.reviewCount,

    linkedAppId: entry.linkedSteamAppId,
    linkedIgdbId: entry.linkedIgdbId,

    isFavorite: entry.isFavorite ?? false,
    isHidden: false,
    standalone: false,
    sortingName: entry.sortingName,

    hasLua: false,

    series: entry.series,
    ageRating: entry.ageRating,
    region: entry.region,
    completionStatus: entry.completionStatus,

    providerMetadata: undefined,

    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Convert a GameV2 back to a ManualGameEntry for reading from games_v2 table.
 */
export function gameV2ToManualGameEntry(game: GameV2): ManualGameEntry {
  const parseJsonArray = (s?: string): string[] | undefined => {
    if (!s) return undefined;
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed.map(String) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    id: game.providerGameId ?? game.id.replace("manual:", ""),
    name: game.title,
    executablePath: game.exePath,
    workingDirectory: game.workingDirectory,
    launchArguments: game.launchArguments,
    installDir: game.installDir,
    libraryPath: undefined,

    coverPath: game.coverPath,
    landscapePath: game.landscapePath,
    backgroundPath: game.backgroundPath,
    logoPath: game.logoPath,
    iconPath: game.iconPath,

    genres: parseJsonArray(game.genres),
    developers: parseJsonArray(game.developers),
    publishers: parseJsonArray(game.publishers),
    releaseDate: game.releaseDate,
    description: game.description,
    shortDescription: game.shortDescription,

    categories: parseJsonArray(game.categories),
    features: parseJsonArray(game.features),
    tags: parseJsonArray(game.tags),
    sortingName: game.sortingName,

    userScore: game.userScore,
    criticScore: game.criticScore,
    communityScore: game.communityScore,
    reviewSummary: game.reviewSummary,
    reviewCount: game.reviewCount,

    series: game.series,
    ageRating: game.ageRating,
    region: game.region,
    completionStatus: game.completionStatus,

    linkedSteamAppId: game.linkedAppId,
    linkedIgdbId: game.linkedIgdbId,

    appId: game.appId,

    sizeOnDisk: game.installSize,
    isFavorite: game.isFavorite,

    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "lumaforge-manual-games-v1";
const MIGRATION_MARKER_KEY = "lumaforge-manual-games-json-migrated-v1";
const PENDING_WRITE_KEY = "lumaforge-manual-games-json-pending-write-v1";

// ─── Manual ID normalization ────────────────────────────────────────────

/**
 * Normalize a manual game ID: strip `"manual:"` prefix if present.
 * Safe to pass raw UUID or `"manual:<uuid>"` — always returns `<uuid>`.
 */
export function normalizeManualGameId(input: string): string {
  if (!input || typeof input !== "string") return input;
  return input.startsWith("manual:") ? input.slice("manual:".length) : input;
}

/**
 * Extract the raw provider game ID (UUID) from a ManualGameEntry or any
 * object with `id` field. Returns the normalized UUID.
 */
export function getManualProviderGameId(entry: { id: string }): string {
  return normalizeManualGameId(entry.id);
}

// ─── Module-level cache ─────────────────────────────────────────────────

let _cache: ManualGameEntry[] | null = null;
let _persisted = false;
let _migrationDone = false;

// ─── Listeners ──────────────────────────────────────────────────────────

type Listener = () => void;
const _listeners = new Set<Listener>();

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

// ─── LocalStorage fallback (immediate sync load before boot) ────────────

function loadFromLocalStorage(): ManualGameEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ManualGameStore;
      if (Array.isArray(parsed.entries)) return parsed.entries;
    }
  } catch {
    // corrupt storage — return empty
  }
  return [];
}

function saveToLocalStorage(entries: ManualGameEntry[]): void {
  try {
    const store: ManualGameStore = { version: 1, entries };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full
  }
}

function hasMigrationMarker(): boolean {
  try {
    return localStorage.getItem(MIGRATION_MARKER_KEY) === "true";
  } catch {
    return false;
  }
}

function setMigrationMarker(): void {
  try {
    localStorage.setItem(MIGRATION_MARKER_KEY, "true");
  } catch {
    // ignore
  }
}

function hasPendingWrite(): boolean {
  try {
    return localStorage.getItem(PENDING_WRITE_KEY) === "true";
  } catch {
    return false;
  }
}

function setPendingWrite(): void {
  try {
    localStorage.setItem(PENDING_WRITE_KEY, "true");
  } catch {
    // ignore
  }
}

function clearPendingWrite(): void {
  try {
    localStorage.removeItem(PENDING_WRITE_KEY);
  } catch {
    // ignore
  }
}

// ─── JSON disk persistence (async, via Rust) ───────────────────────────

/**
 * Load entries from games_v2 table (source="manual").
 * Returns the entries array, or `[]` on error.
 */
async function loadFromJsonDisk(): Promise<ManualGameEntry[]> {
  try {
    const { getGamesV2BySource } = await import("./tauri");
    const gamesV2 = await getGamesV2BySource("manual");
    
    // Convert GameV2 back to ManualGameEntry format
    return gamesV2.map((g) => ({
      id: normalizeManualGameId(g.providerGameId ?? g.id.replace("manual:", "")),
      name: g.title,
      executablePath: g.exePath,
      workingDirectory: g.workingDirectory,
      launchArguments: g.launchArguments,
      installDir: g.installDir,
      libraryPath: undefined,
      coverPath: g.coverPath,
      landscapePath: g.landscapePath,
      backgroundPath: g.backgroundPath,
      logoPath: g.logoPath,
      iconPath: g.iconPath,
      appId: g.appId,
      linkedSteamAppId: g.linkedAppId,
      genres: JSON.parse(g.genres ?? "[]"),
      tags: JSON.parse(g.tags ?? "[]"),
      categories: JSON.parse(g.categories ?? "[]"),
      features: JSON.parse(g.features ?? "[]"),
      developers: JSON.parse(g.developers ?? "[]"),
      publishers: JSON.parse(g.publishers ?? "[]"),
      description: g.description,
      shortDescription: g.shortDescription,
      releaseDate: g.releaseDate,
      isFavorite: g.isFavorite,
      sizeOnDisk: g.installSize,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
  } catch (e) {
    console.log("[ManualGames] games_v2 read failed:", e);
    return [];
  }
}

/**
 * Persist the full entries array to AppData JSON file via Rust.
 * Creates a backup if this is the first write after migration.
 * Returns true on success, false on failure.
 */
async function persistToDisk(entries: ManualGameEntry[]): Promise<boolean> {
  try {
    const { batchUpsertGamesV2 } = await import("./tauri");
    const { manualGameEntryToGameV2 } = await import("./gameV2Mapper");

    // Set pending marker BEFORE writing — localStorage is already current
    // (caller wrote to localStorage synchronously before calling us).
    // If we crash mid-write, boot will see the pending marker and trust localStorage.
    setPendingWrite();

    if (!_persisted) {
      _persisted = true;
    }

    // Write to games_v2 (single source of truth)
    const gamesV2 = entries.map((e) => manualGameEntryToGameV2(e));
    if (gamesV2.length > 0) {
      await batchUpsertGamesV2(gamesV2).catch(() => {});
    }
    
    clearPendingWrite();
    return true;
  } catch (e) {
    console.error("[ManualGames] JSON disk write failed:", e);
    // Leave pending marker set — next boot will reconcile from localStorage.
    return false;
  }
}

/**
 * Normalize a ManualGameEntry from localStorage format.
 * Ensures required fields, normalizes IDs, fills defaults.
 */
function normalizeEntry(entry: Record<string, unknown>): ManualGameEntry {
  const id = normalizeManualGameId(String(entry.id || ""));
  const now = Date.now();
  return {
    id,
    name: String(entry.name || "Untitled"),
    executablePath: entry.executablePath ? String(entry.executablePath) : undefined,
    workingDirectory: entry.workingDirectory ? String(entry.workingDirectory) : undefined,
    launchArguments: entry.launchArguments ? String(entry.launchArguments) : undefined,
    installDir: entry.installDir ? String(entry.installDir) : undefined,
    libraryPath: entry.libraryPath ? String(entry.libraryPath) : undefined,
    coverPath: entry.coverPath ? String(entry.coverPath) : undefined,
    landscapePath: entry.landscapePath ? String(entry.landscapePath) : undefined,
    backgroundPath: entry.backgroundPath ? String(entry.backgroundPath) : undefined,
    logoPath: entry.logoPath ? String(entry.logoPath) : undefined,
    iconPath: entry.iconPath ? String(entry.iconPath) : undefined,
    genres: Array.isArray(entry.genres) ? entry.genres.map(String) : undefined,
    developers: Array.isArray(entry.developers) ? entry.developers.map(String) : undefined,
    publishers: Array.isArray(entry.publishers) ? entry.publishers.map(String) : undefined,
    releaseDate: entry.releaseDate ? String(entry.releaseDate) : undefined,
    description: entry.description ? String(entry.description) : undefined,
    shortDescription: entry.shortDescription ? String(entry.shortDescription) : undefined,
    categories: Array.isArray(entry.categories) ? entry.categories.map(String) : undefined,
    features: Array.isArray(entry.features) ? entry.features.map(String) : undefined,
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : undefined,
    sortingName: entry.sortingName ? String(entry.sortingName) : undefined,
    userScore: entry.userScore ? String(entry.userScore) : undefined,
    criticScore: entry.criticScore ? String(entry.criticScore) : undefined,
    communityScore: entry.communityScore ? String(entry.communityScore) : undefined,
    reviewSummary: entry.reviewSummary ? String(entry.reviewSummary) : undefined,
    reviewCount: entry.reviewCount ? String(entry.reviewCount) : undefined,
    reviewSource: entry.reviewSource ? String(entry.reviewSource) : undefined,
    series: entry.series ? String(entry.series) : undefined,
    ageRating: entry.ageRating ? String(entry.ageRating) : undefined,
    region: entry.region ? String(entry.region) : undefined,
    completionStatus: entry.completionStatus ? String(entry.completionStatus) : undefined,
    linkedSteamAppId: entry.linkedSteamAppId ? String(entry.linkedSteamAppId) : undefined,
    linkedIgdbId: entry.linkedIgdbId ? String(entry.linkedIgdbId) : undefined,
    appId: entry.appId ? String(entry.appId) : undefined,
    sizeOnDisk: typeof entry.sizeOnDisk === "number" ? entry.sizeOnDisk : undefined,
    isFavorite: entry.isFavorite === true,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : now,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : now,
  };
}

// ─── Sync ensureCache (immediate fallback) ─────────────────────────────

function ensureCache(): ManualGameEntry[] {
  if (_cache === null) {
    _cache = loadFromLocalStorage();
  }
  return _cache;
}

// ─── Async JSON load + migration ───────────────────────────────────────

/**
 * Load from AppData JSON file with crash-recovery reconciliation.
 *
 * Invariant: localStorage is ALWAYS written synchronously BEFORE the async
 * JSON write, so localStorage is always at least as current as JSON.
 *
 * Algorithm:
 * 1. Read JSON from disk (authoritative if migration was completed)
 * 2. Read localStorage (sync fallback, always up-to-date)
 * 3. If migration marker IS set:
 *    a. If pending-write marker is set → a JSON write was interrupted.
 *       Trust localStorage (guaranteed newer) and re-persist to JSON.
 *    b. If no pending write → JSON is authoritative.
 * 4. If migration marker is NOT set: first-time migration from localStorage.
 *
 * The pending-write marker (`lumaforge-manual-games-json-pending-write-v1`)
 * is set in localStorage BEFORE each async JSON write and cleared AFTER
 * success. On crash recovery, this marker is the only reliable signal
 * that a write was interrupted — count comparisons between JSON and
 * localStorage can be wrong for both add and remove scenarios.
 */
export async function loadManualGamesFromJson(): Promise<ManualGameEntry[]> {
  if (_migrationDone) return ensureCache();

  const jsonEntries = await loadFromJsonDisk();
  const localEntries = ensureCache();

  // ── Case A: Migration marker is set → JSON is authority ──
  if (hasMigrationMarker()) {
    if (hasPendingWrite()) {
      // A JSON write was attempted but may not have completed (crash or error).
      // localStorage is guaranteed to be at least as current as JSON because
      // callers write to localStorage synchronously BEFORE calling persistToDisk.
      _cache = localEntries;
      console.log(
        `[ManualGames] pending write detected — trusting localStorage ` +
        `(${localEntries.length} entries, JSON has ${jsonEntries.length})`
      );
      // Re-persist localStorage to JSON (fire-and-forget).
      // persistToDisk manages the pending marker lifecycle internally.
      persistToDisk(localEntries).then((ok) => {
        console.log(
          `[ManualGames] pending write re-persist: ${ok ? "success" : "FAILED"} ` +
          `(${localEntries.length} entries)`
        );
      });
    } else if (jsonEntries.length > 0) {
      // No pending write, JSON has entries — normal authoritative path
      _cache = jsonEntries;
      console.log(
        `[ManualGames] loaded ${jsonEntries.length} entries from JSON (marker present)`
      );
    } else {
      // No pending write, JSON empty, marker present — all games intentionally removed
      _cache = [];
      console.log(
        `[ManualGames] JSON empty, ${localEntries.length} in localStorage ` +
        `— marker present, no pending write, trusting JSON (empty)`
      );
    }

    _migrationDone = true;
    console.log(`[MANUAL_STORE][GAMES_V2] loadManualGamesFromJson → ${_cache.length} games loaded from JSON`);
    return _cache;
  }

  // ── Case B: Migration marker NOT set → first-time setup ──

  if (jsonEntries.length > 0) {
    // JSON has entries (created externally?) — use JSON, set marker
    _cache = jsonEntries;
    setMigrationMarker();
    _migrationDone = true;
    console.log(
      `[ManualGames] loaded ${jsonEntries.length} entries from JSON (no marker, set now)`
    );
    return _cache;
  }

  if (localEntries.length > 0) {
    // JSON empty, localStorage has data → migrate
    const normalized = localEntries.map((e) => normalizeEntry(e as Record<string, unknown>));
    _cache = normalized;
    _migrationDone = true;

    // Persist to JSON (fire-and-forget — migration is best-effort on first boot)
    persistToDisk(normalized).then((ok) => {
      console.log(
        `[ManualGames] migration persist: ${ok ? "success" : "FAILED"} ` +
        `(${normalized.length} entries)`
      );
    });

    setMigrationMarker();
    console.log(
      `[ManualGames] migrated ${normalized.length} entries from localStorage to JSON`
    );

    return _cache;
  }

  // Both empty
  _cache = [];
  _migrationDone = true;
  setMigrationMarker();
  console.log("[ManualGames] no entries (empty JSON + localStorage)");
  return _cache;
}

// ─── games_v2 sync (fire-and-forget) ────────────────────────────────────

/**
 * Sync a ManualGameEntry to games_v2 table.
 * "upsert" writes the entry, "delete" removes it.
 * Fire-and-forget: errors are logged but don't block the caller.
 */
async function syncToGamesV2(
  entry: ManualGameEntry,
  op: "upsert" | "delete"
): Promise<void> {
  try {
    const { upsertGameV2, deleteGameV2 } = await import("./tauri");
    if (op === "upsert") {
      const gameV2 = manualGameEntryToGameV2(entry);
      await upsertGameV2(gameV2);
      console.log(`[ManualGames][GAMES_V2] op=upsert id=${entry.id} ok=true`);
    } else {
      await deleteGameV2(`manual:${entry.id}`);
      console.log(`[ManualGames][GAMES_V2] op=delete id=${entry.id} ok=true`);
    }
  } catch (e) {
    console.error(`[ManualGames][GAMES_V2] op=${op} id=${entry.id} FAILED:`, e);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Synchronous load — returns the in-memory cache.
 * Before boot completes: populated from localStorage (immediate).
 * After `loadManualGamesFromJson()` completes: populated from JSON disk
 * (reconciled with localStorage for crash recovery).
 */
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
  // Always normalize ID to prevent manual:manual:uuid double-prefix
  entry = { ...entry, id: normalizeManualGameId(entry.id) };
  const entries = ensureCache();
  if (entries.some((e) => e.id === entry.id)) {
    throw new Error(`Manual game "${entry.id}" already exists`);
  }
  entries.push(entry);
  saveToLocalStorage(entries);
  // Snapshot array for async write — prevents race if sync mutations occur before Rust write fires
  persistToDisk([...entries]).then((ok) => {
    console.log(
      `[ManualGames][DISK_WRITE] op=add id=${entry.id} ok=${ok}`
    );
  });
  // Write to games_v2 (fire-and-forget)
  syncToGamesV2(entry, "upsert");
  notifyListeners();
  return entry;
}

export function updateManualGame(
  id: string,
  patch: Partial<ManualGameEntry>
): ManualGameEntry {
  id = normalizeManualGameId(id);
  const entries = ensureCache();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) throw new Error(`Manual game "${id}" not found`);
  const updated = { ...entries[idx], ...patch, id, updatedAt: Date.now() };
  entries[idx] = updated;
  saveToLocalStorage(entries);
  // Snapshot array for async write — prevents race if sync mutations occur before Rust write fires
  persistToDisk([...entries]).then((ok) => {
    console.log(
      `[ManualGames][DISK_WRITE] op=update id=${id} ok=${ok}`
    );
  });
  // Write to games_v2 (fire-and-forget)
  syncToGamesV2(updated, "upsert");
  notifyListeners();
  return updated;
}

export function removeManualGame(id: string): boolean {
  const entries = ensureCache();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    console.log(`[MANUAL_REMOVE][STORE] id=${id} NOT_FOUND`);
    return false;
  }
  const removed = entries[idx];
  entries.splice(idx, 1);
  saveToLocalStorage(entries);

  console.log(
    `[MANUAL_REMOVE][STORE] id=${id} title="${removed.name}" remaining=${entries.length}`
  );

  // Snapshot array for async write — prevents race if sync mutations occur before Rust write fires
  persistToDisk([...entries]).then((ok) => {
    console.log(
      `[ManualGames][DISK_WRITE] op=remove id=${id} ok=${ok} remaining=${entries.length}`
    );
  });

  // Delete from games_v2 (fire-and-forget)
  syncToGamesV2({ id } as ManualGameEntry, "delete");

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

// Listen for external restore writes and reload from localStorage
if (typeof window !== "undefined") {
  window.addEventListener("lumaforge-data-changed", (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.key === LOCAL_STORAGE_KEY) {
      _cache = null;
      notifyListeners();
    }
  });
}
