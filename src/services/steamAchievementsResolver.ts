import type { GameAchievement, GameAchievementsSummary } from "../types/gameAchievements";
import {
  fetchSteamPlayerAchievements,
  fetchSteamGlobalAchievementPercentages,
  fetchSteamAchievementSchema,
  scanSteamAppcacheAchievements,
  readAchievementCache,
  writeAchievementCache,
  readAchievementsAppSchemaFolder,
} from "./tauri";
import type { AppAchievementCacheEntry, AppAchievementPercentagesEntry, AppAchievementSummaryData } from "./tauri";

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

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

function setupRequiredSummary(appId: string): GameAchievementsSummary {
  return {
    appId,
    total: 0,
    unlocked: 0,
    percent: 0,
    progressAvailable: false,
    achievements: [],
    source: "setup-required",
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
    const d = data as { achievementpercentages?: { achievements?: { name: string; percent: number }[] } };
    const list = d?.achievementpercentages?.achievements;
    if (list) {
      for (const a of list) {
        map[a.name] = a.percent;
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
      console.warn("[steamAchievementsResolver] PlayerStats error:", ps.error);
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

    achievements.push({
      id: apiName,
      apiName,
      name: schema?.displayName ?? pa?.name ?? apiName,
      description: schema?.description ?? pa?.description,
      iconUrl: schema?.icon,
      iconGrayUrl: schema?.icongray,
      unlocked: pa ? isAchieved(pa.achieved) : false,
      unlockTime: pa?.unlocktime && pa.unlocktime > 0 ? pa.unlocktime * 1000 : undefined,
      rarityPercent: rarity != null ? rarity : undefined,
    });
  }

  achievements.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const unlocked = achievements.filter((a) => a.unlocked).length;
  const total = achievements.length;

  return {
    appId,
    total,
    unlocked,
    percent: total > 0 ? Math.round((unlocked / total) * 100) : 0,
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
  schemaEntries: { api_name: string; display_name?: string }[],
  progressAvailable: boolean,
): GameAchievementsSummary {
  const apiNameSet = new Set<string>();
  for (const a of localAchievements) apiNameSet.add(a.api_name);
  for (const s of schemaEntries) apiNameSet.add(s.api_name);

  const achievements: GameAchievement[] = [];
  for (const apiName of apiNameSet) {
    const local = localAchievements.find((a) => a.api_name === apiName);
    const schema = schemaEntries.find((s) => s.api_name === apiName);

    achievements.push({
      id: apiName,
      apiName,
      name: schema?.display_name ?? apiName,
      unlocked: local?.unlocked ?? false,
      unlockTime: local?.unlock_time ? local.unlock_time * 1000 : undefined,
    });
  }

  achievements.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const unlocked = achievements.filter((a) => a.unlocked).length;
  const total = achievements.length;

  return {
    appId,
    total,
    unlocked,
    percent: total > 0 ? Math.round((unlocked / total) * 100) : 0,
    progressAvailable,
    achievements,
    source: "steam-appcache",
    updatedAt: Date.now(),
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
    rarityPercent: pctMap[e.api_name] ?? undefined,
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
  }));

  const pcts: AppAchievementPercentagesEntry[] = summary.achievements
    .filter((a) => a.rarityPercent != null)
    .map((a) => ({
      name: a.apiName,
      percent: a.rarityPercent!,
    }));

  const summaryData: AppAchievementSummaryData = {
    app_id: summary.appId,
    total: summary.total,
    unlocked: summary.unlocked,
    percent: summary.percent,
    progress_available: summary.progressAvailable,
    source: summary.source,
    updated_at: summary.updatedAt ?? Date.now(),
  };

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

  if (!hasApiKey || !hasSteamId64) {
    return setupRequiredSummary(appIdStr);
  }

  const lang = params.language ?? "english";

  // Try LumaForge disk cache first (real progress only)
  if (!params.forceRefresh) {
    try {
      const cached = await readAchievementCache(appIdNum);
      if (cached && cached.summary.progress_available && Date.now() - cached.summary.updated_at < CACHE_TTL_MS) {
        console.debug(`[steamAchievementsResolver] App ${appIdStr}: using disk cache (${cached.achievements.length} achievements, progress=${cached.summary.progress_available})`);
        return cacheEntryToSummary(appIdStr, cached.achievements, cached.achievement_percentages, cached.summary);
      }
    } catch (err) {
      console.warn(`[steamAchievementsResolver] App ${appIdStr}: disk cache read failed:`, err);
    }
  }

  let playerAchievements: PlayerAchievement[] = [];
  let schemaMap = new Map<string, SchemaAchievement>();
  let globalPctMap: Record<string, number> = {};
  let playerHttpStatus: string | null = null;

  // 1. Player achievements
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
      console.warn(`[steamAchievementsResolver] App ${appIdStr}: player achievements error: ${parsed.error}`);
    }
  } catch (err) {
    const msg = String(err);
    console.warn(`[steamAchievementsResolver] App ${appIdStr}: player achievements failed:`, msg);
    if (msg.includes("HTTP 403")) {
      playerHttpStatus = "403";
    }
  }

  const playerProgressFailed = !playerHttpStatus && hasFullAccess && playerAchievements.length === 0;

  // 2. Schema
  try {
    const schemaData = await fetchSteamAchievementSchema({
      appId: appIdNum,
      apiKey: params.steamWebApiKey!,
      language: lang,
    });
    schemaMap = parseSchema(schemaData);
  } catch (err) {
    console.warn(`[steamAchievementsResolver] App ${appIdStr}: schema failed:`, err);
  }

  // 2b. If Web API schema was empty, try Achievements app schema folder
  if (schemaMap.size === 0 && params.achievementSchemaPath) {
    console.debug(`[steamAchievementsResolver] App ${appIdStr}: trying Achievements app schema folder: ${params.achievementSchemaPath}`);
    try {
      const appSchema = await readAchievementsAppSchemaFolder(params.achievementSchemaPath, appIdNum);
      if (appSchema.achievements.length > 0) {
        for (const a of appSchema.achievements) {
          schemaMap.set(a.api_name, {
            name: a.api_name,
            displayName: a.name,
            description: a.description,
            icon: a.icon_url,
            icongray: a.icon_gray_url,
          });
        }
        // Merge percentages from app schema folder too
        for (const p of appSchema.achievement_percentages) {
          if (globalPctMap[p.name] == null) {
            globalPctMap[p.name] = p.percent;
          }
        }
        console.debug(`[steamAchievementsResolver] App ${appIdStr}: loaded ${appSchema.achievements.length} achievements from app schema folder`);
      }
    } catch (err) {
      console.warn(`[steamAchievementsResolver] App ${appIdStr}: app schema folder failed:`, err);
    }
  }

  // 3. Global percentages
  try {
    const globalData = await fetchSteamGlobalAchievementPercentages(appIdNum);
    globalPctMap = parseGlobalPercentages(globalData);
  } catch (err) {
    console.warn(`[steamAchievementsResolver] App ${appIdStr}: global percentages failed:`, err);
  }

  // 4. If player progress failed (403 or error), try local Steam appcache
  let appcacheSummary: GameAchievementsSummary | null = null;
  if (playerHttpStatus === "403" || playerProgressFailed) {
    console.debug(`[steamAchievementsResolver] App ${appIdStr}: player progress unavailable, trying local appcache...`);
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
        );
        console.debug(`[steamAchievementsResolver] App ${appIdStr}: appcache gave ${appcacheSummary.achievements.length} achievements, progressAvailable=${appcacheSummary.progressAvailable}`);
      } else if (appcacheResult.stats_file_found || appcacheResult.schema_file_found) {
        console.debug(`[steamAchievementsResolver] App ${appIdStr}: appcache files found but unparseable`);
      } else {
        console.debug(`[steamAchievementsResolver] App ${appIdStr}: no appcache files found`);
      }
    } catch (err) {
      console.warn(`[steamAchievementsResolver] App ${appIdStr}: local appcache scan failed:`, err);
    }
  }

  // Determine final source and summary
  let summary: GameAchievementsSummary;

  if (appcacheSummary && appcacheSummary.progressAvailable) {
    // Local appcache gave us real progress
    summary = appcacheSummary;
  } else if (playerAchievements.length > 0) {
    // Web API player achievements succeeded
    summary = mergeAchievements({
      playerAchievements,
      schemaMap,
      globalPctMap,
      source: "steam-web-api",
      progressAvailable: true,
      appId: appIdStr,
    });
  } else if (appcacheSummary && appcacheSummary.achievements.length > 0) {
    // Appcache gave us a list but no real progress
    appcacheSummary.errorReason = playerHttpStatus === "403" ? "api-403-fallback" : undefined;
    summary = appcacheSummary;
  } else if (schemaMap.size > 0) {
    // Schema only, no progress
    const errorReason = playerHttpStatus === "403" ? "api-403-fallback" : playerProgressFailed ? "api-progress-unavailable" : undefined;
    summary = buildSchemaOnlySummary(appIdStr, schemaMap, globalPctMap, errorReason);
  } else if (Object.keys(globalPctMap).length > 0) {
    summary = mergeAchievements({
      playerAchievements: [],
      schemaMap: new Map(),
      globalPctMap,
      source: "global-percentages",
      progressAvailable: false,
      appId: appIdStr,
    });
  } else {
    summary = buildUnavailableSummary(appIdStr, playerHttpStatus === "403" ? "api-403" : "no-data");
  }

  // Save to disk cache if we have achievements and progress is available
  if (summary.achievements.length > 0 && summary.progressAvailable) {
    try {
      const { achievements, pcts, summaryData } = summaryToCacheData(summary);
      await writeAchievementCache(appIdNum, {
        achievements,
        achievement_percentages: pcts,
        summary: summaryData,
      });
      console.debug(`[steamAchievementsResolver] App ${appIdStr}: cached ${achievements.length} achievements to disk`);
    } catch (err) {
      console.warn(`[steamAchievementsResolver] App ${appIdStr}: failed to write disk cache:`, err);
    }
  }

  return summary;
}

export function clearAchievementsCache() {
  // No-op for now; disk cache will be managed separately
}
