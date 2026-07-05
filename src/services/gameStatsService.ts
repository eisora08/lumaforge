import { scanSteamUserGameStats } from "./tauri";
import { getGameStats } from "./gamePlayStats";
import type { LibraryGame } from "../types/libraryGame";
import type { SteamUserGameStats } from "../types/steamUserStats";
import { STEAM_USER_STATS_AUTO_SCAN, logStatsScanSkipOnce } from "./achievementAutoFlags";

const STEAM_CACHE_KEY = "lumaforge-steam-user-stats-cache-v1";
let cachedSteamStats: SteamUserGameStats[] | null = null;

// Startup guard: prevent stats scanning in the first 30 seconds after module load.
// This ensures boot tasks and initial render complete before any stats work.
const STATS_STARTUP_GUARD_MS = 30_000;
const moduleLoadedAt = Date.now();

function isWithinStartupGuard(): boolean {
  return Date.now() - moduleLoadedAt < STATS_STARTUP_GUARD_MS;
}

type SteamStatsMap = Map<number, SteamUserGameStats>;

function loadCachedSteamStats(): SteamStatsMap {
  if (cachedSteamStats) {
    return buildSteamMap(cachedSteamStats);
  }
  try {
    const raw = sessionStorage.getItem(STEAM_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SteamUserGameStats[];
      cachedSteamStats = parsed;
      return buildSteamMap(parsed);
    }
  } catch {
    /* ignore */
  }
  return new Map();
}

function cacheSteamStats(stats: SteamUserGameStats[]) {
  cachedSteamStats = stats;
  try {
    sessionStorage.setItem(STEAM_CACHE_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

function buildSteamMap(stats: SteamUserGameStats[]): SteamStatsMap {
  const map: SteamStatsMap = new Map();
  for (const s of stats) {
    map.set(s.appId, s);
  }
  return map;
}

const ENABLE_VERBOSE_STATS_LOGS = false;

export async function loadSteamStats(
  steamPath?: string,
  appIds?: number[],
  options?: { forceRefresh?: boolean },
): Promise<SteamStatsMap> {
  try {
    if (!appIds || appIds.length === 0) {
      if (ENABLE_VERBOSE_STATS_LOGS) {
        console.debug("[SteamStats] No appIds provided, skipping full scan");
      }
      return new Map();
    }

    // Auto-scan gating: STEAM_USER_STATS_AUTO_SCAN=false prevents non-manual scans
    // Targeted calls with forceRefresh=true bypass this gate.
    const isManualRefresh = options?.forceRefresh === true;
    if (!isManualRefresh && !STEAM_USER_STATS_AUTO_SCAN) {
      logStatsScanSkipOnce(String(appIds[0] ?? "?"), "loadSteamStats");
      const cached = loadCachedSteamStats();
      if (cached.size > 0) return cached;
      return new Map();
    }

    // Startup guard: skip any stats scan during first 30s after module load
    if (isWithinStartupGuard()) {
      if (ENABLE_VERBOSE_STATS_LOGS) {
        console.debug(`[SteamStats] Within startup guard (${Date.now() - moduleLoadedAt}ms), deferring stats for ${appIds.length} apps`);
      }
      const cached = loadCachedSteamStats();
      if (cached.size > 0) return cached;
      return new Map();
    }

    if (ENABLE_VERBOSE_STATS_LOGS) {
      console.debug(`[SteamStats] Loading for ${appIds.length} apps, steamPath=${steamPath ?? "auto"}`);
    }
    const stats = await scanSteamUserGameStats({ steamPath, appIds });
    if (ENABLE_VERBOSE_STATS_LOGS) {
      console.debug(`[SteamStats] Backend returned ${stats.length} entries`);
      if (stats.length > 0) {
        console.debug(`[SteamStats] First 3:`, stats.slice(0, 3).map(s => ({ appId: s.appId, lastPlayed: s.lastPlayed, playtime: s.playtimeMinutes, cloud: s.cloudStatus })));
      }
    }
    cacheSteamStats(stats);
    return buildSteamMap(stats);
  } catch (err) {
    console.warn("[gameStatsService] Failed to load Steam stats:", err);
    const cached = loadCachedSteamStats();
    if (ENABLE_VERBOSE_STATS_LOGS) {
      console.debug(`[SteamStats] Falling back to cache: ${cached.size} entries`);
    }
    return cached;
  }
}

export function normalizeAppId(value: unknown): string {
  return String(value ?? "").trim();
}

export function mergeSteamStatsIntoGames(
  games: LibraryGame[],
  steamStats: SteamStatsMap,
): void {
  let matched = 0;
  for (const game of games) {
    const appIdStr = normalizeAppId(game.appId);
    if (!appIdStr) continue;
    const appIdNum = Number(appIdStr);
    if (!Number.isFinite(appIdNum)) continue;

    const stat = steamStats.get(appIdNum);
    if (!stat) continue;
    matched++;

    if (stat.lastPlayed != null && stat.lastPlayed > 0) {
      // Steam localconfig stores in seconds — convert to ms
      game.steamLastPlayedAt = stat.lastPlayed < 1000000000000
        ? stat.lastPlayed * 1000
        : stat.lastPlayed;
    }
    if (stat.playtimeMinutes != null) {
      game.steamPlaytimeMinutes = stat.playtimeMinutes;
    }
    if (stat.playtime2Weeks != null) {
      game.steamPlaytime2Weeks = stat.playtime2Weeks;
    }
    if (stat.cloudStatus) {
      game.steamCloudStatus = stat.cloudStatus;
    }
  }
  if (ENABLE_VERBOSE_STATS_LOGS) {
    console.debug(`[SteamStats] Merged stats for ${matched}/${games.length} games`);
    if (matched === 0 && steamStats.size > 0) {
      console.debug(`[SteamStats] Stats available for appIds:`, Array.from(steamStats.keys()));
      console.debug(`[SteamStats] Game appIds:`, games.map(g => ({ id: g.id, appId: g.appId })));
    }
  }
}

export function mergeLocalStatsIntoGames(games: LibraryGame[]): void {
  for (const game of games) {
    const local = getGameStats(game.id);
    if (!local) continue;

    if (local.lastPlayedAt != null && local.lastPlayedAt > 0) {
      game.localLastPlayedAt = local.lastPlayedAt;
    }
    if (local.playtimeMinutes != null && local.playtimeMinutes > 0) {
      game.localPlaytimeMinutes = local.playtimeMinutes;
    }
  }
}

export function setAchievementsSupportedFlag(games: LibraryGame[]): void {
  for (const game of games) {
    if (game.metadata?.categories?.includes("Steam Achievements")) {
      game.achievementsSupported = true;
    }
  }
}
