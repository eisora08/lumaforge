/**
 * playtimeService.ts — Playtime data layer backed by games_v2.
 *
 * Maintains the existing synchronous API for backward compatibility.
 * Internally reads/writes to games_v2 via the unified Tauri commands.
 * The in-memory cache is populated on load from games_v2, making reads synchronous.
 */
import { invoke } from "@tauri-apps/api/core";
import { getAllGamesV2, updatePlaytimeV2, incrementPlayCountV2, addPlaytimeV2 } from "./tauri";
import type { GameV2 } from "../types/gameV2";

// ---------------------------------------------------------------------------
// Types — kept identical for backward compatibility
// ---------------------------------------------------------------------------

export type PlaytimeEntry = {
  gameKey: string;
  appId: string | null;
  provider: string;
  title: string;
  playtimeSource: string | null;
  externalPlaytimeSeconds: number;
  externalSource: string | null;
  externalImportedAt: number | null;
  localPlaytimeSeconds: number;
  totalPlaytimeSeconds: number;
  lastPlayedAt: number | null;
  lastSessionSeconds: number | null;
  sessions: PlaytimeSession[];
};

export type PlaytimeSession = {
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  exitReason: string | null;
};

export type PlaytimeStore = {
  version: number;
  updatedAt: number;
  games: Record<string, PlaytimeEntry>;
};

export type ActivePlaySession = {
  sessionId: string;
  startedAt: number;
  gameKey: string;
};

export type PlaySessionStart = {
  gameKey: string;
  appId?: string;
  provider: string;
  title: string;
  startedAt: number;
};

export type PlaySessionEnd = {
  sessionId: string;
  gameKey: string;
  endedAt: number;
  exitReason: "stopped" | "process-exited" | "crashed" | "unknown";
};

export type ExternalPlaytimeImport = {
  gameKey: string;
  appId?: string;
  provider: string;
  title?: string;
  externalPlaytimeSeconds: number;
  externalSource: "steam" | "epic" | "gog" | "manual" | "unknown";
  lastPlayedAtSeconds?: number;
};

// ---------------------------------------------------------------------------
// In-memory cache — populated from games_v2
// ---------------------------------------------------------------------------

let cachedStore: PlaytimeStore | null = null;
let loadPromise: Promise<PlaytimeStore> | null = null;

/** Convert a GameV2 to PlaytimeEntry for backward compat. */
function gameV2ToPlaytimeEntry(game: GameV2): PlaytimeEntry {
  const provider = game.source || "steam";
  const playtimeSource = provider === "steam" ? "external" : provider === "local" ? "local" : null;
  // DB stores lastPlayedAt as milliseconds (see libraryGameToGameV2), store expects seconds
  let lastPlayedSeconds: number | null = null;
  if (game.lastPlayedAt) {
    // DB should always store ms now. Handle legacy seconds (<1e10) for safety.
    const ms = game.lastPlayedAt > 1e10 ? game.lastPlayedAt : game.lastPlayedAt * 1000;
    lastPlayedSeconds = Math.floor(ms / 1000);
  }
  return {
    gameKey: game.id,
    appId: game.appId ?? null,
    provider,
    title: game.title || "",
    playtimeSource,
    externalPlaytimeSeconds: game.playtimeSeconds,
    externalSource: provider === "steam" ? "steam" : null,
    externalImportedAt: null,
    localPlaytimeSeconds: 0,
    totalPlaytimeSeconds: game.playtimeSeconds,
    lastPlayedAt: lastPlayedSeconds,
    lastSessionSeconds: null,
    sessions: [],
  };
}

/** Build a PlaytimeStore from all games_v2. */
function buildStoreFromGamesV2(games: GameV2[]): PlaytimeStore {
  const store: PlaytimeStore = {
    version: 1,
    updatedAt: Math.floor(Date.now() / 1000),
    games: {},
  };
  for (const game of games) {
    // Only include games with playtime or that have been played
    if (game.playtimeSeconds > 0 || game.lastPlayedAt) {
      store.games[game.id] = gameV2ToPlaytimeEntry(game);
    }
  }
  return store;
}

// ---------------------------------------------------------------------------
// Load / subscribe — same pattern as before
// ---------------------------------------------------------------------------

async function readStoreFromGamesV2(): Promise<PlaytimeStore> {
  const games = await getAllGamesV2();
  return buildStoreFromGamesV2(games);
}

export async function loadPlaytimeStore(forceRefresh = false): Promise<PlaytimeStore> {
  if (cachedStore && !forceRefresh) return cachedStore;
  if (loadPromise && !forceRefresh) return loadPromise;
  loadPromise = readStoreFromGamesV2().then((store) => {
    cachedStore = store;
    loadPromise = null;
    return store;
  });
  return loadPromise;
}

export function getCachedPlaytimeStore(): PlaytimeStore | null {
  return cachedStore;
}

export function getPlaytimeEntry(gameKey: string): PlaytimeEntry | null {
  if (!cachedStore) return null;
  return cachedStore.games[gameKey] ?? null;
}

// Subscription for React re-render notifications
type PlaytimeStoreListener = () => void;
const _playtimeListeners = new Set<PlaytimeStoreListener>();

export function subscribePlaytimeStore(fn: PlaytimeStoreListener): () => void {
  _playtimeListeners.add(fn);
  return () => { _playtimeListeners.delete(fn); };
}

function notifyPlaytimeStored(): void {
  _playtimeListeners.forEach(fn => fn());
}

/** Mark the appId dirty for snapshot persistence after any playtime update. */
async function markPlaytimeDirty(appId: string | null | undefined): Promise<void> {
  if (!appId) return;
  try {
    const { notifyMediaUpdated } = await import("./startupSnapshotService");
    await notifyMediaUpdated(appId, { source: "playtime-changed" }).catch(() => {});
  } catch {
    // startupSnapshotService not available during early boot
  }
}

// ---------------------------------------------------------------------------
// Write operations — backed by games_v2 commands
// ---------------------------------------------------------------------------

export async function importExternalPlaytime(input: ExternalPlaytimeImport): Promise<PlaytimeEntry> {
  // Update games_v2 with the external playtime — only set lastPlayed if we have a real value
  const gameV2Id = input.gameKey;
  const totalSeconds = input.externalPlaytimeSeconds;
  // Do NOT stamp NOW when lastPlayed is missing — that contaminates every steam game with "Just now"
  const resolvedLastPlayed = input.lastPlayedAtSeconds ?? cachedStore?.games[gameV2Id]?.lastPlayedAt ?? null;
  // Convert seconds to ms for games_v2 (which stores ms)
  const lastPlayedForDb = resolvedLastPlayed ? resolvedLastPlayed * 1000 : 0;
  await updatePlaytimeV2(gameV2Id, totalSeconds, lastPlayedForDb);

  // Build entry from the input
  const entry: PlaytimeEntry = {
    gameKey: input.gameKey,
    appId: input.appId ?? null,
    provider: input.provider,
    title: input.title ?? "",
    playtimeSource: "external",
    externalPlaytimeSeconds: input.externalPlaytimeSeconds,
    externalSource: input.externalSource,
    externalImportedAt: Math.floor(Date.now() / 1000),
    localPlaytimeSeconds: 0,
    totalPlaytimeSeconds: input.externalPlaytimeSeconds,
    lastPlayedAt: resolvedLastPlayed,
    lastSessionSeconds: null,
    sessions: [],
  };

  if (cachedStore) {
    cachedStore.games[input.gameKey] = entry;
    cachedStore.updatedAt = Date.now();
  }
  notifyPlaytimeStored();
  markPlaytimeDirty(input.appId);
  return entry;
}

/** Batch import external playtime for multiple games in a single SQLite transaction. */
export async function batchImportExternalPlaytime(inputs: ExternalPlaytimeImport[]): Promise<number> {
  // For each import, update games_v2 — do not stamp NOW when missing
  for (const input of inputs) {
    const gameV2Id = input.gameKey;
    const totalSeconds = input.externalPlaytimeSeconds;
    const lastPlayed = input.lastPlayedAtSeconds ?? cachedStore?.games[gameV2Id]?.lastPlayedAt ?? 0;
    // Convert seconds to ms for games_v2 (which stores ms)
    await updatePlaytimeV2(gameV2Id, totalSeconds, lastPlayed * 1000);
  }
  // Refresh cache after batch write
  await loadPlaytimeStore(true);
  notifyPlaytimeStored();
  return inputs.length;
}

export async function startPlaySession(input: PlaySessionStart): Promise<ActivePlaySession> {
  const now = Math.floor(Date.now() / 1000);
  const fallbackSessionId = `session-${now}-${Math.random().toString(36).slice(2, 8)}`;

  // Update games_v2: increment play count, set last played (preserve existing playtime)
  await incrementPlayCountV2(input.gameKey);
  const existingSeconds = cachedStore?.games[input.gameKey]?.totalPlaytimeSeconds ?? 0;
  await updatePlaytimeV2(input.gameKey, existingSeconds, now * 1000); // preserve playtime, update last_played_at (ms)

  // Record session start — capture Rust-returned session ID so endPlaySession can find it
  let sessionId = fallbackSessionId;
  try {
    const rustSession = await invoke<ActivePlaySession>("record_play_session_start", { input });
    if (rustSession?.sessionId) {
      sessionId = rustSession.sessionId;
    }
  } catch {
    // non-critical — session tracking is optional
  }

  // Update cache
  if (cachedStore?.games[input.gameKey]) {
    cachedStore.games[input.gameKey].lastPlayedAt = now;
  }

  const result: ActivePlaySession = {
    sessionId,
    startedAt: now,
    gameKey: input.gameKey,
  };

  notifyPlaytimeStored();
  markPlaytimeDirty(input.appId);
  return result;
}

export async function endPlaySession(input: PlaySessionEnd): Promise<PlaytimeEntry> {
  const now = Math.floor(Date.now() / 1000);

  // Try to end session in legacy table
  let entry: PlaytimeEntry;
  try {
    entry = await invoke<PlaytimeEntry>("record_play_session_end", { input });
  } catch {
    // Build entry from cache if legacy command fails
    entry = cachedStore?.games[input.gameKey] ?? {
      gameKey: input.gameKey,
      appId: null,
      provider: "steam",
      title: "",
      playtimeSource: null,
      externalPlaytimeSeconds: 0,
      externalSource: null,
      externalImportedAt: null,
      localPlaytimeSeconds: 0,
      totalPlaytimeSeconds: 0,
      lastPlayedAt: now,
      lastSessionSeconds: null,
      sessions: [],
    };
  }

  // Preserve accumulated playtime before stub overwrites the cache
  const existingEntry = cachedStore?.games[input.gameKey];
  const preservedTotal = existingEntry?.totalPlaytimeSeconds ?? 0;
  const preservedLocal = existingEntry?.localPlaytimeSeconds ?? 0;

  if (cachedStore) {
    cachedStore.games[input.gameKey] = entry;
    cachedStore.updatedAt = Date.now();
  }

  // Persist local session duration to games_v2 for non-Steam games.
  // Steam/lua playtime is authoritative from Steam localconfig.vdf, so skip for steam.
  const sessionSeconds = entry.lastSessionSeconds ?? 0;
  if (sessionSeconds >= MIN_SESSION_SECONDS && entry.provider !== "steam") {
    try {
      await addPlaytimeV2(input.gameKey, sessionSeconds);
      // Restore accumulated playtime + new session duration
      if (cachedStore?.games[input.gameKey]) {
        cachedStore.games[input.gameKey].totalPlaytimeSeconds = preservedTotal + sessionSeconds;
        cachedStore.games[input.gameKey].localPlaytimeSeconds = preservedLocal + sessionSeconds;
      }
    } catch {
      // non-critical
    }
  } else {
    // Even if not persisted to games_v2 (Steam), restore the preserved total
    if (cachedStore?.games[input.gameKey]) {
      cachedStore.games[input.gameKey].totalPlaytimeSeconds = preservedTotal;
      cachedStore.games[input.gameKey].localPlaytimeSeconds = preservedLocal;
    }
  }

  notifyPlaytimeStored();
  markPlaytimeDirty(entry.appId);
  return entry;
}

export const MIN_SESSION_SECONDS = 15;

/** Compute total playtime — Rust already maintains totalPlaytimeSeconds correctly */
export function computeTotalPlaytime(entry: PlaytimeEntry): number {
  return entry.totalPlaytimeSeconds;
}

// ---------------------------------------------------------------------------
// Read helpers — all backed by in-memory cache (populated from games_v2)
// ---------------------------------------------------------------------------

const DEBUG_ACTIVITY = false;

export function getPlaytimeEntryByAppId(appId: string | null | undefined): PlaytimeEntry | null {
  if (!appId) return null;
  if (!cachedStore) return null;
  // Primary: canonical key
  let entry = cachedStore.games[`app-${appId}`] ?? null;
  if (entry) return entry;
  // Legacy aliases
  entry = cachedStore.games[`steam:${appId}`] ?? null;
  if (entry) { if (DEBUG_ACTIVITY) console.log(`[ACTIVITY][KEY_MATCH] appid=${appId} matchedKey=steam:${appId} totalSeconds=${entry.totalPlaytimeSeconds}`); return entry; }
  entry = cachedStore.games[`steam-${appId}`] ?? null;
  if (entry) { if (DEBUG_ACTIVITY) console.log(`[ACTIVITY][KEY_MATCH] appid=${appId} matchedKey=steam-${appId} totalSeconds=${entry.totalPlaytimeSeconds}`); return entry; }
  entry = cachedStore.games[`lua-${appId}`] ?? null;
  if (entry) { if (DEBUG_ACTIVITY) console.log(`[ACTIVITY][KEY_MATCH] appid=${appId} matchedKey=lua-${appId} totalSeconds=${entry.totalPlaytimeSeconds}`); return entry; }
  entry = cachedStore.games[`lua:${appId}`] ?? null;
  if (entry) { if (DEBUG_ACTIVITY) console.log(`[ACTIVITY][KEY_MATCH] appid=${appId} matchedKey=lua:${appId} totalSeconds=${entry.totalPlaytimeSeconds}`); return entry; }
  entry = cachedStore.games[appId] ?? null;
  if (entry) { if (DEBUG_ACTIVITY) console.log(`[ACTIVITY][KEY_MATCH] appid=${appId} matchedKey=${appId} totalSeconds=${entry.totalPlaytimeSeconds}`); return entry; }
  return null;
}

/** Get total playtime seconds for a game by appId, or 0 if not found */
export function getPlaytimeSecondsForAppId(appId: string | null | undefined): number {
  const entry = getPlaytimeEntryByAppId(appId);
  return entry ? entry.totalPlaytimeSeconds : 0;
}

// ── Game-key-based lookups (provider-aware, works for manual games) ──

/** Resolve a LibraryGame to its playtime store key */
export function resolvePlaytimeKey(game: {
  id?: string;
  appId?: string;
  libraryId?: string;
  providerId?: string;
  providerGameId?: string;
  source?: string;
}): string | null {
  if (!game) return null;
  // Source-specific keys MUST come before appId — these games write
  // playtime under their source-specific key, not "app-{appId}"
  if (game.source === "manual" && game.libraryId) return game.libraryId;
  if (game.source === "debrid" && game.libraryId) return game.libraryId;
  if (game.source === "epic" && game.id) return game.id;
  // Steam/Lua: prefer the canonical games_v2 id (steam-xxx / lua-xxx) so the
  // store key matches the DB row. app-xxx is kept as legacy alias in lookups.
  if (game.id && (game.id.startsWith("steam-") || game.id.startsWith("lua-"))) return game.id;
  if (game.appId) return `app-${game.appId}`;
  // Fallback: game.id
  if (game.id) return game.id;
  return null;
}

/** Look up a playtime entry by arbitrary game key */
export function getPlaytimeEntryByGameKey(gameKey: string | null | undefined): PlaytimeEntry | null {
  if (!gameKey) return null;
  if (!cachedStore) return null;
  return cachedStore.games[gameKey] ?? null;
}

/**
 * Look up a playtime entry by appId across ALL keys.
 * Tries `app-${appId}` first, then scans all entries for matching `appId` field.
 * Used by snapshot enrichment where the entry may be under `debrid:<id>` or `manual:<uuid>`.
 */
export function findPlaytimeEntryByAppId(appId: string): PlaytimeEntry | null {
  if (!appId || !cachedStore) return null;
  const direct = cachedStore.games[`app-${appId}`];
  if (direct) return direct;
  // Scan for debrid/manual/epic entries that carry this appId
  for (const entry of Object.values(cachedStore.games)) {
    if (entry.appId === appId) return entry;
  }
  return null;
}

/** Get total playtime seconds for a game by arbitrary key */
export function getPlaytimeSecondsByGameKey(gameKey: string | null | undefined): number {
  const entry = getPlaytimeEntryByGameKey(gameKey);
  return entry ? entry.totalPlaytimeSeconds : 0;
}

/** Get last played timestamp by arbitrary game key */
export function getLastPlayedByGameKey(gameKey: string | null | undefined): number | null {
  const entry = getPlaytimeEntryByGameKey(gameKey);
  if (!entry) return null;
  return entry.lastPlayedAt ?? null;
}

/** Try to load playtime store if not already loaded. Returns true if already loaded. */
export function isPlaytimeStoreLoaded(): boolean {
  return cachedStore !== null;
}

/** Get the last known session end time for an appId, or null */
export function getLastSessionEndForAppId(appId: string | null | undefined): number | null {
  const entry = getPlaytimeEntryByAppId(appId);
  if (!entry) return null;
  if (entry.lastPlayedAt) return entry.lastPlayedAt;
  // Fallback: use latest session end/start
  if (entry.sessions.length > 0) {
    const sorted = [...entry.sessions].sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
    return sorted[0].endedAt ?? sorted[0].startedAt;
  }
  return null;
}

/** Describe the playtime source for UI display */
export function getPlaytimeSourceLabel(appId: string | null | undefined): string {
  const entry = getPlaytimeEntryByAppId(appId);
  if (!entry) return "unknown";
  if (entry.playtimeSource === "external" || entry.externalSource != null) return "external";
  if (entry.localPlaytimeSeconds > 0) return "local";
  return "unknown";
}

export function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return "Not tracked";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    if (secs === 0) return `${minutes}m`;
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  if (hours >= 10) return `${hours}.${Math.round(mins / 6)}h`;
  return `${hours}h ${mins}m`;
}

export function formatPlaytimeMinutes(minutes: number): string {
  if (minutes <= 0) return "Not tracked";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  if (h >= 10) return `${h}.${Math.round(m / 6)}h`;
  return `${h}h ${m}m`;
}

let snapshotImportDone = false;

export async function importSnapshotPlaytime(
  snapshotGames: Array<{ appId: string; playtime: number | null; lastPlayed?: number | null; lastPlayedAt?: number | null }>,
): Promise<void> {
  if (snapshotImportDone) return;
  snapshotImportDone = true;

  await loadPlaytimeStore();

  const imports: ExternalPlaytimeImport[] = [];
  for (const game of snapshotGames) {
    if (!game.appId || !game.playtime || game.playtime <= 0) continue;
    const existing = cachedStore?.games[`app-${game.appId}`];
    if (existing?.externalPlaytimeSeconds && existing.externalPlaytimeSeconds >= game.playtime * 60) continue;
    const lpSeconds = game.lastPlayedAt ?? game.lastPlayed ?? undefined;
    imports.push({
      gameKey: `app-${game.appId}`,
      appId: game.appId,
      provider: "steam",
      title: "",
      externalPlaytimeSeconds: game.playtime * 60,
      externalSource: "steam",
      lastPlayedAtSeconds: lpSeconds && lpSeconds > 0 ? lpSeconds : undefined,
    });
  }

  if (imports.length > 0) {
    try {
      await batchImportExternalPlaytime(imports);
    } catch {
      // non-critical
    }
  }
}

// Listen for external restore writes and force-refresh playtime from games_v2
if (typeof window !== "undefined") {
  window.addEventListener("lumaforge-data-changed", (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.key === "lumaforge-playtime-v1") {
      loadPlaytimeStore(true).then(() => notifyPlaytimeStored()).catch(() => {});
    }
  });
}
