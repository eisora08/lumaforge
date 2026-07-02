import type { GameAchievement, GameAchievementsSummary } from "../types/gameAchievements";
import {
  fetchSteamPlayerAchievements,
  fetchSteamGlobalAchievementPercentages,
  fetchSteamAchievementSchema,
  scanSteamAppcacheAchievements,
  readAchievementCache,
  writeAchievementCache,
  readAchievementsAppSchemaFolder,
  parseUserGameStatsRaw,
  parseLibraryCacheAchievements,
} from "./tauri";
import type { AppAchievementCacheEntry, AppAchievementPercentagesEntry, AppAchievementSummaryData, SteamAppcacheSchemaEntry, SteamAppcacheParsedProgress, UserGameStatsRawResult, DebugAchievementReport, LibraryCacheProgress } from "./tauri";

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const ACHIEVEMENT_CACHE_VERSION = 6;

// Track previous unlocked state for unlock detection
const previousUnlockedState = new Map<string, Map<string, boolean>>();
// Session 403 cache: do not retry GetPlayerAchievements for apps that returned 403
const cached403Apps = new Set<string>();

export type UnlockEvent = {
  apiName: string;
  name: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  unlockTime?: number;
};

/** Check if a string is a valid image source URL.
 *  Rejects raw apiName values, accepts:
 *  - full Steam icon URL (starts with http/https)
 *  - local img path (starts with file:// or data:)
 *  - valid 40-character hex hash (Steam icon hash)
 */
function isValidImageSource(value: string | undefined | null): value is string {
  if (!value) return false;
  // data: URLs are always valid
  if (value.startsWith("data:")) return true;
  // http/https URLs
  if (value.startsWith("http://") || value.startsWith("https://")) return true;
  // file:// URLs
  if (value.startsWith("file://")) return true;
  // asset:// URLs
  if (value.startsWith("asset://")) return true;
  // 40-character hex hash (Steam icon CDN hash)
  if (/^[a-f0-9]{40}$/i.test(value)) return true;
  // Reject anything that looks like an apiName (no extension, no slashes, has underscores)
  if (/^[A-Za-z0-9_]+$/.test(value) && !value.includes('.')) return false;
  return true;
}

function isLocalizationToken(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^NEW_ACHIEVEMENT/i.test(v)) return true;
  if (/_NAME$|_DESC$|_DESCRIPTION$/i.test(v)) return true;
  // All caps + underscores + digits
  if (/^[A-Z0-9_]+$/.test(v) && v.includes('_')) return true;
  // No lowercase and has underscores
  if (!/[a-z]/.test(v) && v.includes('_')) return true;
  return false;
}

function hasValidDisplayName(name: string): boolean {
  return !isLocalizationToken(name) && /[a-zA-Z]/.test(name) && name.trim().length >= 2;
}

function normalizeValidAppId(value: unknown): string | null {
  const appId = String(value ?? "").trim();
  if (!appId || appId === "0" || appId.toLowerCase() === "undefined" || appId.toLowerCase() === "null" || appId === "NaN") {
    return null;
  }
  const num = Number(appId);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return appId;
}

function buildUnavailableSummary(appId: string, reason?: string): GameAchievementsSummary {
  return {
    appId,
    total: 0,
    unlocked: 0,
    percent: 0,
    progressAvailable: false,
    achievements: [],
    source: "unavailable",
    errorReason: reason,
  };
}

function disabledSummary(appId: string): GameAchievementsSummary {
  return {
    appId,
    total: 0,
    unlocked: 0,
    percent: 0,
    progressAvailable: false,
    achievements: [],
    source: "disabled",
  };
}

function parseGlobalPercentages(data: unknown): Record<string, number> {
  const map: Record<string, number> = {};
  try {
    const d = data as { achievementpercentages?: { achievements?: { name: string; percent: unknown }[] } };
    const list = d?.achievementpercentages?.achievements;
    if (list) {
      for (const a of list) {
        const p = Number(a.percent);
        if (Number.isFinite(p)) {
          map[a.name] = p;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

type SchemaAchievement = {
  name: string;
  defaultvalue?: number;
  displayName?: string;
  hidden?: number;
  description?: string;
  icon?: string;
  icongray?: string;
};

function parseSchema(data: unknown): Map<string, SchemaAchievement> {
  const map = new Map<string, SchemaAchievement>();
  try {
    const d = data as { game?: { availableGameStats?: { achievements?: SchemaAchievement[] } } };
    const list = d?.game?.availableGameStats?.achievements;
    if (list) {
      for (const a of list) {
        map.set(a.name, a);
      }
    }
  } catch {
    /* ignore */
  }
  return map;
}

type PlayerAchievement = {
  apiname: string;
  achieved: number | string;
  unlocktime?: number;
  name?: string;
  description?: string;
};

function isAchieved(value: number | string | undefined | null): boolean {
  if (value == null) return false;
  const num = typeof value === "number" ? value : Number(value);
  return num === 1;
}

function parsePlayerAchievements(data: unknown): { achievements: PlayerAchievement[]; error?: string } {
  try {
    const d = data as { playerstats?: { achievements?: PlayerAchievement[]; error?: string; success?: boolean } };
    const ps = d?.playerstats;
    if (!ps) return { achievements: [] };
    if (ps.error) {
      console.warn("[ACH][PROGRESS] PlayerStats error:", ps.error);
      return { achievements: [], error: ps.error };
    }
    if (ps.success === false) {
      return { achievements: [], error: "Profile may be private" };
    }
    return { achievements: ps.achievements ?? [] };
  } catch {
    return { achievements: [] };
  }
}

function mergeAchievements(params: {
  playerAchievements: PlayerAchievement[];
  schemaMap: Map<string, SchemaAchievement>;
  globalPctMap: Record<string, number>;
  source: GameAchievementsSummary["source"];
  progressAvailable: boolean;
  appId: string;
}): GameAchievementsSummary {
  const { playerAchievements, schemaMap, globalPctMap, source, progressAvailable, appId } = params;

  const allApiNames = new Set<string>();
  for (const pa of playerAchievements) {
    allApiNames.add(pa.apiname);
  }
  for (const [apiName] of schemaMap) {
    allApiNames.add(apiName);
  }
  for (const apiName of Object.keys(globalPctMap)) {
    allApiNames.add(apiName);
  }

  const achievements: GameAchievement[] = [];
  for (const apiName of allApiNames) {
    const pa = playerAchievements.find((p) => p.apiname === apiName);
    const schema = schemaMap.get(apiName);
    const rarity = globalPctMap[apiName];

    const iconUrl = isValidImageSource(schema?.icon) ? schema!.icon : undefined;
    const iconGrayUrl = isValidImageSource(schema?.icongray) ? schema!.icongray : undefined;

    achievements.push({
      id: apiName,
      apiName,
      name: schema?.displayName ?? pa?.name ?? apiName,
      description: schema?.description ?? pa?.description,
      iconUrl,
      iconGrayUrl,
      unlocked: pa ? isAchieved(pa.achieved) : false,
      unlockTime: pa?.unlocktime && pa.unlocktime > 0 ? pa.unlocktime * 1000 : undefined,
      rarityPercent: rarity != null ? rarity : undefined,
    });
  }

  achievements.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const total = achievements.length;

  return {
    appId,
    total,
    ...(progressAvailable
      ? {
          unlocked: achievements.filter((a) => a.unlocked).length,
          percent: total > 0 ? Math.round((achievements.filter((a) => a.unlocked).length / total) * 100) : 0,
        }
      : {}),
    progressAvailable,
    achievements,
    source,
    updatedAt: Date.now(),
  };
}

function buildSchemaOnlySummary(
  appId: string,
  schemaMap: Map<string, SchemaAchievement>,
  globalPctMap: Record<string, number>,
  errorReason?: string,
): GameAchievementsSummary {
  return {
    ...mergeAchievements({
      playerAchievements: [],
      schemaMap,
      globalPctMap,
      source: "schema-only",
      progressAvailable: false,
      appId,
    }),
    errorReason,
  };
}

function buildAppcacheSummary(
  appId: string,
  localAchievements: { api_name: string; unlocked: boolean; unlock_time?: number }[],
  schemaEntries: SteamAppcacheSchemaEntry[],
  progressAvailable: boolean,
  parsedProgress?: SteamAppcacheParsedProgress[],
  parserConfidence?: string,
): GameAchievementsSummary {
  // Filter out schema entries with token-only display names (safety net for Rust side)
  const cleanSchema = schemaEntries.filter((s) => !s.display_name || hasValidDisplayName(s.display_name));

  // Determine if v2 binary parser data should be used
  const useV2Progress = parserConfidence === "high" || parserConfidence === "medium";

  const v2ProgressMap: Map<string, SteamAppcacheParsedProgress> = new Map();
  if (useV2Progress && parsedProgress) {
    for (const p of parsedProgress) {
      v2ProgressMap.set(p.api_name, p);
    }
  }

  const apiNameSet = new Set<string>();
  for (const a of localAchievements) apiNameSet.add(a.api_name);
  for (const s of cleanSchema) apiNameSet.add(s.api_name);

  const achievements: GameAchievement[] = [];
  for (const apiName of apiNameSet) {
    const local = localAchievements.find((a) => a.api_name === apiName);
    const schema = cleanSchema.find((s) => s.api_name === apiName);
    const v2p = v2ProgressMap.get(apiName);

    // Use v2 binary progress when available, otherwise fall back to v1 text parser
    const unlocked = v2p !== undefined ? v2p.unlocked : (local?.unlocked ?? false);
    const unlockTime = local?.unlock_time ? local.unlock_time * 1000 : undefined;

    const iconUrl = isValidImageSource(schema?.icon) ? schema!.icon : undefined;
    const iconGrayUrl = isValidImageSource(schema?.icon_gray) ? schema!.icon_gray : undefined;

    achievements.push({
      id: apiName,
      apiName,
      name: schema?.display_name ?? apiName,
      description: schema?.description,
      iconUrl,
      iconGrayUrl,
      unlocked,
      unlockTime,
      statId: schema?.stat_id,
      bit: schema?.bit,
    });
  }

  achievements.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const total = achievements.length;

  return {
    appId,
    total,
    ...(progressAvailable
      ? {
          unlocked: achievements.filter((a) => a.unlocked).length,
          percent: total > 0 ? Math.round((achievements.filter((a) => a.unlocked).length / total) * 100) : 0,
        }
      : {}),
    progressAvailable,
    achievements,
    source: "steam-appcache",
    updatedAt: Date.now(),
  };
}

/**
 * Build progress map from librarycache JSON result.
 * Librarycache provides real unlock state, unlock time, and rarity.
 */
function buildLibraryCacheProgress(
  libResult: LibraryCacheProgress,
): { progressMap: Map<string, { unlocked: boolean; unlockTime?: number }>; rarityMap: Map<string, number>; nTotal: number; nAchieved: number } {
  const progressMap = new Map<string, { unlocked: boolean; unlockTime?: number }>();
  const rarityMap = new Map<string, number>();

  for (const entry of libResult.entries) {
    const apiName = entry.str_id ?? "";
    if (!apiName) continue;

    const unlocked = entry.b_achieved === true;
    const rawUnlockTime = entry.rt_unlocked ?? 0;
    // Librarycache rtUnlocked is Unix seconds; frontend expects ms
    const unlockTime = rawUnlockTime > 0 && rawUnlockTime < 1000000000000 ? rawUnlockTime * 1000 : rawUnlockTime > 0 ? rawUnlockTime : undefined;

    progressMap.set(apiName, { unlocked, unlockTime });

    if (entry.fl_achieved != null) {
      rarityMap.set(apiName, entry.fl_achieved);
    }
  }

  console.debug(`[ACH][LIBRARYCACHE] progressMap=${progressMap.size} entries`);
  const nTotal = libResult.n_total ?? 0;
  const nAchieved = libResult.n_achieved ?? 0;
  console.debug(`[ACH][LIBRARYCACHE] nTotal=${nTotal} nAchieved=${nAchieved}`);

  return { progressMap, rarityMap, nTotal, nAchieved };
}

function buildLocalProgressFromStats(
  appId: string,
  schemaEntries: AppAchievementCacheEntry[],
  statsResult: UserGameStatsRawResult,
  globalPctMap: Record<string, number>,
): { summary: GameAchievementsSummary; progressAvailable: boolean } {
  const statsMap = new Map<number, number>();
  for (const p of statsResult.stat_pairs) {
    statsMap.set(p.stat_id, p.value);
  }

  const unlockTimeMap = new Map<string, number | undefined>();
  for (const a of statsResult.achievement_entries) {
    unlockTimeMap.set(a.api_name, a.unlock_time);
  }

  let matchedCount = 0;
  const achievements: GameAchievement[] = [];

  for (const entry of schemaEntries) {
    let unlocked = false;
    let statValue = 0;

    if (entry.stat_id != null && entry.bit != null) {
      statValue = statsMap.get(entry.stat_id) ?? 0;
      unlocked = (statValue & (1 << entry.bit)) !== 0;
      matchedCount++;
    }

    const unlockTime = unlockTimeMap.get(entry.api_name);

    achievements.push({
      id: entry.api_name,
      apiName: entry.api_name,
      name: entry.name,
      description: entry.description,
      iconUrl: entry.icon_url,
      iconGrayUrl: entry.icon_gray_url,
      unlocked,
      unlockTime: unlockTime != null && unlockTime > 0 ? unlockTime * 1000 : undefined,
      rarityPercent: globalPctMap[entry.api_name] ?? entry.rarity_percent ?? undefined,
      statId: entry.stat_id,
      bit: entry.bit,
    });
  }

  const total = achievements.length;
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const progressAvailable = matchedCount > 0;

  console.debug(`[ACH][PROGRESS] appid=${appId} statsFileFound=${statsResult.file_found} size=${statsResult.file_size}`);
  console.debug(`[ACH][PROGRESS] parsedStats=${statsResult.stat_pairs.length}`);
  const schemaWithStatIds = schemaEntries.filter((e) => e.stat_id != null).length;
  console.debug(`[ACH][PROGRESS] schemaWithStatIds=${schemaWithStatIds}`);
  console.debug(`[ACH][PROGRESS] matchedStats=${matchedCount}`);
  console.debug(`[ACH][PROGRESS] unlocked=${unlockedCount}/${total}`);
  console.debug(`[ACH][PROGRESS] progressAvailable=${progressAvailable}`);

  for (let i = 0; i < Math.min(5, achievements.length); i++) {
    const a = achievements[i];
    const entryRaw = schemaEntries.find((e) => e.api_name === a.apiName);
    const sid = entryRaw?.stat_id;
    const sv = sid != null ? (statsMap.get(sid) ?? 0) : 0;
    console.debug(`[ACH][PROGRESS_TEST] apiName=${a.apiName} statId=${sid} bit=${entryRaw?.bit} statValue=${sv} unlocked=${a.unlocked}`);
  }

  return {
    summary: {
      appId,
      total,
      ...(progressAvailable
        ? { unlocked: unlockedCount, percent: total > 0 ? Math.round((unlockedCount / total) * 100) : 0 }
        : {}),
      progressAvailable,
      achievements,
      source: "schema-only",
      updatedAt: Date.now(),
    },
    progressAvailable,
  };
}

function cacheEntryToSummary(
  appId: string,
  cacheData: AppAchievementCacheEntry[],
  pcts: AppAchievementPercentagesEntry[],
  summaryData: AppAchievementSummaryData,
): GameAchievementsSummary {
  const pctMap: Record<string, number> = {};
  for (const p of pcts) {
    pctMap[p.name] = p.percent;
  }

  const achievements: GameAchievement[] = cacheData.map((e) => ({
    id: e.api_name,
    apiName: e.api_name,
    name: e.name,
    description: e.description,
    iconUrl: e.icon_url,
    iconGrayUrl: e.icon_gray_url,
    unlocked: e.unlocked,
    unlockTime: e.unlock_time ? e.unlock_time * 1000 : undefined,
    rarityPercent: e.rarity_percent ?? pctMap[e.api_name] ?? undefined,
    statId: e.stat_id,
    bit: e.bit,
  }));

  return {
    appId,
    total: summaryData.total,
    unlocked: summaryData.unlocked,
    percent: summaryData.percent,
    progressAvailable: summaryData.progress_available,
    achievements,
    source: summaryData.source as GameAchievementsSummary["source"],
    updatedAt: summaryData.updated_at,
  };
}

function summaryToCacheData(summary: GameAchievementsSummary): {
  achievements: AppAchievementCacheEntry[];
  pcts: AppAchievementPercentagesEntry[];
  summaryData: AppAchievementSummaryData;
} {
  const achievements: AppAchievementCacheEntry[] = summary.achievements.map((a) => ({
    id: a.apiName,
    api_name: a.apiName,
    name: a.name,
    description: a.description,
    icon_url: a.iconUrl,
    icon_gray_url: a.iconGrayUrl,
    unlocked: a.unlocked,
    unlock_time: a.unlockTime ? Math.floor(a.unlockTime / 1000) : undefined,
    rarity_percent: a.rarityPercent,
    stat_id: a.statId,
    bit: a.bit,
  }));

  const pcts: AppAchievementPercentagesEntry[] = summary.achievements
    .filter((a) => a.rarityPercent != null)
    .map((a) => {
      const p = Number(a.rarityPercent);
      if (!Number.isFinite(p)) return null;
      return { name: a.apiName, percent: p };
    })
    .filter((e): e is AppAchievementPercentagesEntry => e !== null);

  const summaryData: AppAchievementSummaryData = {
    app_id: summary.appId,
    total: summary.total,
    unlocked: summary.unlocked ?? 0,
    percent: summary.percent ?? 0,
    progress_available: summary.progressAvailable,
    source: summary.source,
    updated_at: summary.updatedAt ?? Date.now(),
  };

  console.debug(`[ACH][CACHE] write validated appid=${summary.appId}`);

  return { achievements, pcts, summaryData };
}

export async function resolveSteamAchievements(params: {
  appId: string | number;
  steamWebApiKey?: string;
  steamId64?: string;
  accountId?: string;
  steamPath?: string;
  language?: string;
  forceRefresh?: boolean;
  steamAchievementsEnabled?: boolean;
  achievementSchemaPath?: string;
}): Promise<GameAchievementsSummary> {
  const appIdStr = normalizeValidAppId(params.appId);

  if (!appIdStr) {
    return buildUnavailableSummary(String(params.appId ?? ""), "missing-appid");
  }

  const appIdNum = Number(appIdStr);

  const achievementsEnabled = params.steamAchievementsEnabled !== false;
  const hasApiKey = typeof params.steamWebApiKey === "string" && params.steamWebApiKey.trim().length > 0;
  const hasSteamId64 = typeof params.steamId64 === "string" && params.steamId64.trim().length > 0;
  const hasFullAccess = hasApiKey && hasSteamId64;

  if (!achievementsEnabled) {
    return disabledSummary(appIdStr);
  }

  const lang = params.language ?? "english";

  // --- Resolver source order ---
  // 1. Disk cache
  // 2. Achievements App schema folder (local JSON)
  // 3. Steam API schema (if API key exists)
  // 4. Global achievement percentages
  // 5. Librarycache JSON — local real progress, no API key needed
  // 6. Web API player progress — only if librarycache has no progress
  // 7. UserGameStats statId/bit matching
  // 8. Steam appcache VDF fallback
  // Do not return early unless: invalid appId, achievements disabled

  let playerAchievements: PlayerAchievement[] = [];
  let schemaMap = new Map<string, SchemaAchievement>();
  let globalPctMap: Record<string, number> = {};
  let playerHttpStatus: string | null = null;
  let appcacheSummary: GameAchievementsSummary | null = null;
  let appSchemaAchievements: AppAchievementCacheEntry[] | null = null;



  // 1. Try disk cache first — but do NOT return for schema-only cache, continue to progress sources
  let cachedSchemaAchievements: AppAchievementCacheEntry[] | null = null;
  try {
    const cached = await readAchievementCache(appIdNum);
    if (cached && cached.summary.cache_version === ACHIEVEMENT_CACHE_VERSION) {
      if (!params.forceRefresh && cached.summary.progress_available && Date.now() - cached.summary.updated_at < CACHE_TTL_MS) {
        console.debug(`[ACH][CACHE] App ${appIdStr}: using disk cache (${cached.achievements.length} achievements, progress=${cached.summary.progress_available})`);
        return cacheEntryToSummary(appIdStr, cached.achievements, cached.achievement_percentages, cached.summary);
      }
      // Always populate cached schema metadata — even with forceRefresh, this ensures progress
      // sources like librarycache have schema entries to match against
      cachedSchemaAchievements = cached.achievements;
      for (const a of cached.achievements) {
        if (!schemaMap.has(a.api_name)) {
          schemaMap.set(a.api_name, {
            name: a.api_name,
            displayName: a.name,
            description: a.description,
            icon: a.icon_url,
            icongray: a.icon_gray_url,
          });
        }
      }
      if (cached.summary.progress_available) {
        console.debug(`[ACH][CACHE] App ${appIdStr}: cached progress found; forceRefresh=${!!params.forceRefresh} — using as metadata fallback`);
      } else if (cached.summary.source === "schema-only") {
        console.debug(`[ACH][MERGE] schemaOnlyCache=true continuing to progress sources (${cached.achievements.length} schema entries)`);
      }
      // Do NOT return on progress_available when forceRefresh, nor on schema-only — continue to progress sources
    }
  } catch (err) {
    console.warn(`[ACH][CACHE] App ${appIdStr}: disk cache read failed:`, err);
  }

  // 2. Achievements App schema folder (local JSON) - works without API key
  if (params.achievementSchemaPath) {
    try {
      const appSchema = await readAchievementsAppSchemaFolder(params.achievementSchemaPath, appIdNum);
      if (appSchema.achievements.length > 0) {
        appSchemaAchievements = appSchema.achievements;
        for (const a of appSchema.achievements) {
          schemaMap.set(a.api_name, {
            name: a.api_name,
            displayName: a.name,
            description: a.description,
            icon: a.icon_url,
            icongray: a.icon_gray_url,
          });
        }
        for (const p of appSchema.achievement_percentages) {
          if (globalPctMap[p.name] == null) {
            globalPctMap[p.name] = p.percent;
          }
        }
        console.debug(`[ACH][SCHEMA] App ${appIdStr}: loaded ${appSchema.achievements.length} achievements from app schema folder`);
      }
    } catch (err) {
      console.warn(`[ACH][SCHEMA] App ${appIdStr}: app schema folder failed:`, err);
    }
  }

  // Fallback: use cached schema metadata if no app schema folder provided
  if (!appSchemaAchievements && cachedSchemaAchievements) {
    console.debug(`[ACH][MERGE] using cached schema metadata (${cachedSchemaAchievements.length} entries) as fallback`);
    appSchemaAchievements = cachedSchemaAchievements;
  }

  // 3. Steam API schema (only if API key exists)
  if (hasApiKey) {
    try {
      const schemaData = await fetchSteamAchievementSchema({
        appId: appIdNum,
        apiKey: params.steamWebApiKey!,
        language: lang,
      });
      const apiSchema = parseSchema(schemaData);
      // Only overwrite if API returned results
      if (apiSchema.size > 0) {
        schemaMap = apiSchema;
      }
    } catch (err) {
      console.warn(`[ACH][SCHEMA] App ${appIdStr}: schema API failed:`, err);
    }
  }

  // 4. Global achievement percentages
  try {
    const globalData = await fetchSteamGlobalAchievementPercentages(appIdNum);
    globalPctMap = parseGlobalPercentages(globalData);
  } catch (err) {
    console.warn(`[ACH][RARITY] App ${appIdStr}: global percentages failed:`, err);
  }

  // 5. Librarycache JSON progress (local real progress, no API key needed)
  let localProgressSummary: GameAchievementsSummary | null = null;
  let progressFromLibraryCache = false;
  if (params.accountId && appSchemaAchievements) {
    console.debug(`[ACH][LIBRARYCACHE] appid=${appIdStr} trying librarycache...`);
    try {
      const libResult = await parseLibraryCacheAchievements({
        steamPath: params.steamPath,
        steamAccountId: params.accountId,
        appId: appIdNum,
      });
      if (libResult.progress_available && libResult.n_total && libResult.n_total > 0) {
        const { progressMap, rarityMap, nTotal, nAchieved } = buildLibraryCacheProgress(libResult);
        console.debug(`[ACH][LIBRARYCACHE] appid=${appIdStr} nTotal=${nTotal} nAchieved=${nAchieved} progressMap=${progressMap.size}`);
        console.debug(`[ACH][MERGE] librarycache progress found total=${nTotal} achieved=${nAchieved} progressMap=${progressMap.size}`);
        console.debug(`[ACH][MERGE] applying librarycache progress to canonical schema (${appSchemaAchievements.length} entries)`);
        const achievements: GameAchievement[] = appSchemaAchievements.map((entry) => {
          const progress = progressMap.get(entry.api_name);
          const libRarity = rarityMap.get(entry.api_name);
          const rawUnlockTime = progress?.unlockTime;
          return {
            id: entry.api_name,
            apiName: entry.api_name,
            name: entry.name,
            description: entry.description,
            iconUrl: entry.icon_url,
            iconGrayUrl: entry.icon_gray_url,
            unlocked: progress?.unlocked ?? false,
            unlockTime: rawUnlockTime != null && rawUnlockTime > 0 ? rawUnlockTime : undefined,
            rarityPercent: entry.rarity_percent ?? libRarity ?? undefined,
          };
        });
        const total = appSchemaAchievements.length > 0 ? appSchemaAchievements.length : (nTotal > 0 ? nTotal : 0);
        const unlocked = nAchieved > 0 ? nAchieved : achievements.filter((a) => a.unlocked).length;
        localProgressSummary = {
          appId: appIdStr,
          achievements,
          total,
          unlocked,
          percent: total > 0 ? Math.round((unlocked / total) * 100) : 0,
          progressAvailable: true,
          source: "librarycache",
          updatedAt: Date.now(),
          errorReason: undefined,
        };
        progressFromLibraryCache = true;
        console.debug(`[ACH][LIBRARYCACHE] appid=${appIdStr} progress=${unlocked}/${total} source=librarycache`);
        console.debug(`[ACH][FINAL] source=librarycache total=${total} unlocked=${unlocked} progressAvailable=true`);
      } else {
        console.debug(`[ACH][LIBRARYCACHE] appid=${appIdStr} no progress data found (nTotal=${libResult.n_total})`);
      }
    } catch (err) {
      console.warn(`[ACH][LIBRARYCACHE] appid=${appIdStr} parse failed:`, err);
    }
  }

  // 6. Web API player progress (only if librarycache did not provide progress, unless forceRefresh)
  const tryWebApi = hasFullAccess && !progressFromLibraryCache && !cached403Apps.has(appIdStr);
  if (tryWebApi) {
    try {
      const playerData = await fetchSteamPlayerAchievements({
        appId: appIdNum,
        steamId: params.steamId64!,
        apiKey: params.steamWebApiKey!,
        language: lang,
      });
      const parsed = parsePlayerAchievements(playerData);
      playerAchievements = parsed.achievements;
      if (parsed.error) {
        console.warn(`[ACH][PROGRESS_API] App ${appIdStr}: player achievements error: ${parsed.error}`);
      }
    } catch (err) {
      const msg = String(err);
      console.warn(`[ACH][PROGRESS_API] App ${appIdStr}: player achievements failed:`, msg);
      if (msg.includes("HTTP 403")) {
        playerHttpStatus = "403";
        cached403Apps.add(appIdStr);
        console.debug(`[ACH][PROGRESS_API] appid=${appIdStr} status=403 cachedFailure=true`);
      }
    }
  }

  const playerProgressFailed = hasFullAccess && playerAchievements.length === 0 && playerHttpStatus !== "403";

  // 7. Local stats progress matching using schema statId/bit (if librarycache and Web API both failed)
  if (!localProgressSummary && params.accountId && appSchemaAchievements && appSchemaAchievements.some((a) => a.stat_id != null)) {
    console.debug(`[ACH][PROGRESS] App ${appIdStr}: trying local UserGameStats...`);
    try {
      const statsResult = await parseUserGameStatsRaw({
        steamPath: params.steamPath,
        steamAccountId: params.accountId,
        appId: appIdNum,
      });
      if (statsResult.file_found && statsResult.stat_pairs.length > 0) {
        const built = buildLocalProgressFromStats(appIdStr, appSchemaAchievements, statsResult, globalPctMap);
        if (built.progressAvailable) {
          localProgressSummary = built.summary;
          console.debug(`[ACH][PROGRESS] App ${appIdStr}: local stats progress matched ${built.summary.achievements.filter((a) => a.unlocked).length}/${built.summary.total} unlocked`);
        } else {
          console.debug(`[ACH][PROGRESS] App ${appIdStr}: local stats found but no statIds matched schema`);
        }
      } else {
        console.debug(`[ACH][PROGRESS] App ${appIdStr}: local stats file not found or empty`);
      }
    } catch (err) {
      console.warn(`[ACH][PROGRESS] App ${appIdStr}: local UserGameStats parse failed:`, err);
    }
  }

  // 8. Fallback: old-style appcache scan (when no App schema stats, or no accountId)
  if (!localProgressSummary && (params.accountId || params.steamPath)) {
    console.debug(`[ACH][APPCACHE] App ${appIdStr}: trying legacy appcache scan...`);
    try {
      const appcacheResult = await scanSteamAppcacheAchievements({
        appId: appIdNum,
        steamAccountId: params.accountId,
        steamPath: params.steamPath,
      });

      if (appcacheResult.parsed_achievements.length > 0 || appcacheResult.parsed_schema.length > 0) {
        appcacheSummary = buildAppcacheSummary(
          appIdStr,
          appcacheResult.parsed_achievements,
          appcacheResult.parsed_schema,
          appcacheResult.progress_available,
          appcacheResult.parsed_progress,
          appcacheResult.parser_confidence,
        );
        console.debug(`[ACH][APPCACHE] App ${appIdStr}: appcache gave ${appcacheSummary.achievements.length} achievements, progressAvailable=${appcacheSummary.progressAvailable}`);
      } else if (appcacheResult.stats_file_found || appcacheResult.schema_file_found) {
        console.debug(`[ACH][APPCACHE] App ${appIdStr}: appcache files found but unparseable`);
      } else {
        console.debug(`[ACH][APPCACHE] App ${appIdStr}: no appcache files found`);
      }
    } catch (err) {
      console.warn(`[ACH][APPCACHE] App ${appIdStr}: local appcache scan failed:`, err);
    }
  }

  // --- Determine final source and summary ---

  let summary: GameAchievementsSummary;
  const metadataCount = schemaMap.size;
  const progressCount = playerAchievements.length;
  const rarityCount = Object.keys(globalPctMap).length;

  if (playerAchievements.length > 0) {
    summary = mergeAchievements({
      playerAchievements,
      schemaMap,
      globalPctMap,
      source: "steam-web-api",
      progressAvailable: true,
      appId: appIdStr,
    });
  } else if (localProgressSummary?.progressAvailable) {
    summary = localProgressSummary;
  } else if (appcacheSummary && appcacheSummary.progressAvailable) {
    summary = appcacheSummary;
  } else if (localProgressSummary) {
    summary = localProgressSummary;
  } else if (appcacheSummary && appcacheSummary.achievements.length > 0) {
    appcacheSummary.errorReason = playerHttpStatus === "403" ? "api-403-fallback" : undefined;
    summary = appcacheSummary;
  } else if (schemaMap.size > 0) {
    const errorReason = playerHttpStatus === "403" ? "api-403-fallback" : playerProgressFailed ? "api-progress-unavailable" : undefined;
    summary = buildSchemaOnlySummary(appIdStr, schemaMap, globalPctMap, errorReason);
  } else {
    summary = buildUnavailableSummary(appIdStr, playerHttpStatus === "403" ? "api-403" : "no-data");
  }

  // Debug logs
  const iconCount = summary.achievements.filter(a => a.iconUrl).length;
  const grayIconCount = summary.achievements.filter(a => a.iconGrayUrl).length;
  console.debug(`[ACH][RESOLVE] metadata=${metadataCount} progress=${progressCount} rarity=${rarityCount}`);
  console.debug(`[ACH][FINAL] total=${summary.achievements.length} icons=${iconCount} grayIcons=${grayIconCount} progressAvailable=${summary.progressAvailable}`);

  // Unlock event detection: compare with previous snapshot
  // PART 3+4: Only detect new unlocks when a previous snapshot exists,
  //            to avoid toast spam on first load
  const newlyUnlockedList: UnlockEvent[] = [];
  if (summary.progressAvailable && summary.achievements.length > 0) {
    const prevAppState = previousUnlockedState.get(appIdStr);
    if (prevAppState) {
      for (const a of summary.achievements) {
        if (a.unlocked) {
          const wasUnlocked = prevAppState.get(a.apiName) ?? false;
          if (!wasUnlocked) {
            newlyUnlockedList.push({
              apiName: a.apiName,
              name: a.name,
              iconUrl: a.iconUrl,
              iconGrayUrl: a.iconGrayUrl,
              unlockTime: a.unlockTime,
            });
          }
        }
      }
      if (newlyUnlockedList.length > 0) {
        console.debug(`[ACH][UNLOCK] appId=${appIdStr} newlyUnlocked=${newlyUnlockedList.length}`, newlyUnlockedList.map(a => a.name));
      }
    } else {
      console.debug(`[ACH][UNLOCK] appId=${appIdStr} first load — saving state, no toasts`);
    }
    // Save current state
    const currentState = new Map<string, boolean>();
    for (const a of summary.achievements) {
      currentState.set(a.apiName, a.unlocked);
    }
    previousUnlockedState.set(appIdStr, currentState);
  }
  summary.newlyUnlocked = newlyUnlockedList;

  // Save to disk cache if we have achievements (progress or schema-only)
  if (summary.achievements.length > 0) {
    // Protect against overwriting cache with schema-only when valid progress exists
    if (!params.forceRefresh && summary.source === "schema-only" && !summary.progressAvailable) {
      try {
        const existing = await readAchievementCache(appIdNum);
        if (existing?.summary?.progress_available === true && existing.summary.source !== "schema-only") {
          console.debug(`[ACH][CACHE] write protected reason=would-downgrade-progress appid=${appIdStr} (existing progress_available=true source=${existing.summary.source})`);
          // Merge existing progress with refreshed metadata
          const mergedAchievements: GameAchievement[] = summary.achievements.map((a) => {
            const existingA = existing.achievements.find((ea) => ea.api_name === a.apiName);
            const existingUnlocked = existingA?.unlocked ?? false;
            const existingUnlockTime = existingA?.unlock_time ? existingA.unlock_time * 1000 : undefined;
            return {
              ...a,
              unlocked: existingUnlocked,
              unlockTime: existingUnlockTime,
              rarityPercent: a.rarityPercent ?? existingA?.rarity_percent,
            };
          });
          summary = {
            appId: appIdStr,
            achievements: mergedAchievements,
            total: existing.summary.total || summary.achievements.length,
            unlocked: existing.summary.unlocked ?? mergedAchievements.filter((a) => a.unlocked).length,
            percent: existing.summary.percent ?? 0,
            progressAvailable: true,
            source: (existing.summary.source === "librarycache" ? "librarycache-stale" : (existing.summary.source + "-stale")) as GameAchievementsSummary["source"],
            updatedAt: Date.now(),
            errorReason: "schema-only-refresh",
          };
          console.debug(`[ACH][CACHE] App ${appIdStr}: merged existing progress (${summary.unlocked}/${summary.total}) with refreshed metadata`);
        }
      } catch (err) {
        console.warn(`[ACH][CACHE] App ${appIdStr}: cache read for downgrade check failed:`, err);
      }
    }
    try {
      const { achievements, pcts, summaryData } = summaryToCacheData(summary);
      await writeAchievementCache(appIdNum, {
        achievements,
        achievement_percentages: pcts,
        summary: summaryData,
      });
      console.debug(`[ACH][CACHE] App ${appIdStr}: cached ${achievements.length} achievements to disk (progress=${summary.progressAvailable})`);
    } catch (err) {
      console.warn(`[ACH][CACHE] App ${appIdStr}: failed to write disk cache:`, err);
    }
  }

  return summary;
}

export function clearAchievementsCache() {
  // No-op for now; disk cache will be managed separately
}

/** Quick debug report for a given appId — call from dev console: debugAchievements("976310", { steamId: "7656119...", accountId: "12345", steamPath: "C:/..." }) */
export async function debugAchievements(
  appId: string,
  options?: { steamId?: string; accountId?: string; steamPath?: string; achievementSchemaPath?: string; steamWebApiKey?: string },
): Promise<void> {
  try {
    const appIdNum = Number(appId);
    if (!Number.isFinite(appIdNum)) { console.error("[ACH][DEBUG] invalid appId"); return; }
    const { readAchievementCache, scanSteamAppcacheAchievements, debugAchievementProgress } = await import("./tauri");
    const [cached, scan, deepReport] = await Promise.all([
      readAchievementCache(appIdNum).catch(() => null),
      scanSteamAppcacheAchievements({ appId: appIdNum }).catch(() => null),
      options?.accountId
        ? debugAchievementProgress({
            steamPath: options.steamPath,
            steamAccountId: options.accountId,
            appId: appIdNum,
            achievementSchemaPath: options.achievementSchemaPath,
          }).catch((e: unknown) => { console.warn("[ACH][DEBUG] deep report failed:", e); return null; })
        : Promise.resolve(null),
    ]);
    console.log(
      `%c[ACH][DEBUG] appid=${appId}`,
      "font-weight:bold; color:#ff6b35",
      "\n  cacheExists:", !!cached,
      "\n  cacheSize:", cached?.achievements.length ?? 0,
      "\n  cacheProgress:", cached?.summary.progress_available ?? false,
      "\n  cachedSource:", cached?.summary.source ?? "N/A",
      "\n  statsFileFound:", scan?.stats_file_found ?? false,
      "\n  statsFileSize:", scan?.stats_file_size ?? "N/A",
      "\n  parsedStats:", scan?.parsed_achievements.length ?? 0,
      "\n  parsedSchema:", scan?.parsed_schema.length ?? 0,
      "\n  parsedProgressCount:", scan?.parsed_progress.length ?? 0,
      "\n  parserConfidence:", scan?.parser_confidence ?? "N/A",
      "\n  progressAvailable:", scan?.progress_available ?? false,
    );
    if (deepReport) {
      const lib = deepReport.library_cache;
      console.log(
        `%c[ACH][DEBUG] deep report appid=${appId}`,
        "font-weight:bold; color:#ff6b35",
        "\n  statsFile:", deepReport.stats_file.found ? `${deepReport.stats_file.path} (${deepReport.stats_file.size} bytes)` : "NOT FOUND",
        "\n  schemaFile:", deepReport.schema_file.found ? `${deepReport.schema_file.path} (${deepReport.schema_file.size} bytes)` : "NOT FOUND",
        "\n  statPairs:", deepReport.stat_pairs.length,
        "\n  v1AchievementEntries:", deepReport.achievement_entries.length,
        "\n  schemaEntries:", deepReport.schema_entries.length,
        "\n  matchResults:", deepReport.match_results.length,
        "\n  appSchema:", !!deepReport.app_schema,
        "\n  libraryCache:", lib?.file_found ? `${lib.file_path} (nTotal=${lib.n_total})` : "NOT FOUND",
      );
      if (lib?.file_found && lib.progress_available) {
        console.log(
          `%c[ACH][LIBRARYCACHE] nTotal=${lib.n_total} nAchieved=${lib.n_achieved} entries=${lib.entries.length}`,
          "font-weight:bold; color:#4caf50",
        );
      }
      if (deepReport.match_results.length > 0) {
        console.table(
          deepReport.match_results.map((m: DebugAchievementReport['match_results'][number]) => ({
            apiName: m.api_name,
            statId: m.stat_id,
            bit: m.bit,
            statValue: m.stat_value,
            unlocked: m.unlocked_by_bit,
          })),
        );
      }
      // Full JSON dump as collapsed group
      console.groupCollapsed(`%c[ACH][DEBUG] full JSON report`, "font-weight:bold; color:#888");
      console.log(JSON.stringify(deepReport, null, 2));
      console.groupEnd();
    }
  } catch (err) {
    console.error("[ACH][DEBUG] debugAchievements failed:", err);
  }
}
// Expose to window for dev console access
if (typeof window !== "undefined") {
  (window as any).debugAchievements = debugAchievements;
}
