import type { GameAchievement, GameAchievementsSummary } from "../types/gameAchievements";
import {
  fetchSteamPlayerAchievements,
  fetchSteamGlobalAchievementPercentages,
  readAchievementCache,
  writeAchievementCache,
  generateAchievementSchema,
} from "./tauri";
import type { AppAchievementCacheEntry, AppAchievementPercentagesEntry, AppAchievementSummaryData, DebugAchievementReport, GenerateSchemaResult } from "./tauri";
import { achievementStore, isSourceNewerOrEqual } from "./achievementStore";
import { DEBUG_ACH_VERBOSE } from "./achievementAutoFlags";
// Session 403 cache: do not retry GetPlayerAchievements for apps that returned 403
// TTL 30 minutes — transient 403s (rate-limit, temporary privacy) clear after cooldown
const CACHED_403_TTL_MS = 30 * 60 * 1000;
const cached403Apps = new Map<string, number>(); // appId → timestamp

function isCached403(appId: string): boolean {
  const ts = cached403Apps.get(appId);
  if (ts == null) return false;
  if (Date.now() - ts > CACHED_403_TTL_MS) {
    cached403Apps.delete(appId);
    return false;
  }
  return true;
}

function cache403(appId: string): void {
  cached403Apps.set(appId, Date.now());
}

// Temporary diagnostic flag for empty cache investigation (appId 1167630)
const DEBUG_ACH_DIAG = true;

export type UnlockEvent = {
  apiName: string;
  name: string;
  iconUrl?: string;
  iconGrayUrl?: string;
  unlockTime?: number;
  rarityPercent?: number;
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
  // NOTE: globalPctMap intentionally excluded from allApiNames — it can contain
  // DLC/test achievements not in the schema, inflating total (42→45). globalPctMap
  // is only used for rarityPercent values below.

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
    iconUrl: e.icon ?? e.icon_url,
    iconGrayUrl: e.icon_gray ?? e.icon_gray_url,
    unlocked: e.unlocked,
    unlockTime: e.unlock_time ? e.unlock_time * 1000 : undefined,
    rarityPercent: e.rarity_percent ?? pctMap[e.api_name] ?? undefined,
    statId: e.stat_id,
    bit: e.bit,
    progressStatId: e.progress_stat_id,
    progressMin: e.progress_min,
    progressMax: e.progress_max,
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
    icon: a.iconUrl,
    icon_gray: a.iconGrayUrl,
    unlocked: a.unlocked,
    unlock_time: a.unlockTime ? Math.floor(a.unlockTime / 1000) : undefined,
    rarity_percent: a.rarityPercent,
    stat_id: a.statId,
    bit: a.bit,
    progress_stat_id: a.progressStatId,
    progress_min: a.progressMin,
    progress_max: a.progressMax,
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

/** Convert an achievement icon URL from any source format to a CDN URL for download. */
function resolveIconToCdnUrl(appId: string, url: string): string | null {
  // Already an HTTP URL → pass through
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // Relative img/<hash>.jpg or img/<hash>_gray.jpg → extract hash, build CDN URL
  const relMatch = url.match(/^img\/([a-f0-9]{40})(?:_gray)?\.jpg$/i);
  if (relMatch) {
    return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appId}/${relMatch[1]}.jpg`;
  }
  // Bare 40-char hex hash → build CDN URL
  if (/^[a-f0-9]{40}$/i.test(url)) {
    return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appId}/${url}.jpg`;
  }
  // Unknown format → skip
  return null;
}

// ── Background achievement image download (non-blocking, throttled) ──

const ACHIEVEMENT_IMAGE_DOWNLOAD_CONCURRENCY = 3;

/**
 * Download achievement icons in the background after cache write.
 * Fire-and-forget — the caller does NOT await this.
 * Throttled to ACHIEVEMENT_IMAGE_DOWNLOAD_CONCURRENCY concurrent downloads.
 * Uses the existing downloadAchievementImage Tauri command per file.
 */
async function downloadAchievementIconsInBackground(
  appIdStr: string,
  appIdNum: number,
  iconCdnUrls: string[],
  grayCdnUrls: string[],
): Promise<void> {
  const startTime = Date.now();

  // Build work list with correct filenames
  type WorkItem = { url: string; fileName: string };
  const items: WorkItem[] = [];

  for (const url of iconCdnUrls) {
    const fileName = url.split("/").pop();
    if (fileName) items.push({ url, fileName });
  }
  for (const url of grayCdnUrls) {
    const baseName = url.split("/").pop();
    if (baseName) {
      // Gray icons need _gray suffix to match normalized cache paths
      const fileName = baseName.replace(/\.jpg$/i, "_gray.jpg").replace(/\.png$/i, "_gray.png");
      items.push({ url, fileName });
    }
  }

  // Deduplicate by destination filename
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    if (seen.has(item.fileName)) return false;
    seen.add(item.fileName);
    return true;
  });

  const totalSources = deduped.length;
  console.log(`[ACH][IMG_REPAIR_START] appid=${appIdStr} totalSources=${totalSources} queued=${deduped.length} skippedExisting=0`);

  let downloaded = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const { downloadAchievementImage } = await import("./tauri");

    const downloadOne = async (item: WorkItem, index: number): Promise<void> => {
      const t0 = Date.now();
      console.log(`[ACH][IMG_DOWNLOAD] appid=${appIdStr} index=${index} filename=${item.fileName} status=start`);
      try {
        const result = await downloadAchievementImage({
          appId: appIdNum,
          url: item.url,
          fileName: item.fileName,
        });
        const elapsed = Date.now() - t0;
        if (result) {
          downloaded++;
          console.log(`[ACH][IMG_DOWNLOAD] appid=${appIdStr} filename=${item.fileName} status=ok elapsedMs=${elapsed}`);
        } else {
          skipped++;
          console.log(`[ACH][IMG_DOWNLOAD] appid=${appIdStr} filename=${item.fileName} status=skipped (exists) elapsedMs=${elapsed}`);
        }
      } catch (err) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[ACH][IMG_DOWNLOAD] appid=${appIdStr} filename=${item.fileName} status=fail error=${errMsg}`);
      }
    };

    // Throttled concurrency: process up to N at a time
    for (let i = 0; i < deduped.length; i += ACHIEVEMENT_IMAGE_DOWNLOAD_CONCURRENCY) {
      const batch = deduped.slice(i, i + ACHIEVEMENT_IMAGE_DOWNLOAD_CONCURRENCY);
      await Promise.all(batch.map((item, bi) => downloadOne(item, i + bi)));
    }
  } catch (err) {
    console.warn(`[ACH][IMG_REPAIR_FAILED] appid=${appIdStr} error=${err}`);
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`[ACH][IMG_REPAIR_DONE] appid=${appIdStr} downloaded=${downloaded} skipped=${skipped} failed=${failed} elapsedMs=${totalElapsed}`);
}

/**
 * Ensure canonical achievement schema exists for a game.
 * Reads from disk cache first, generates from KV binary + Steam API if stale/missing.
 * Returns the full AppAchievementCache (schema + progress + icons).
 * Reference: Achievements-1.2.2 — single authoritative schema file per game.
 */
async function ensureSchemaGenerated(
  appId: string,
  steamPath?: string,
  accountId?: string,
  apiKey?: string,
): Promise<import("./tauri").AppAchievementCache | null> {
  const appIdNum = Number(appId);
  const SCHEMA_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  try {
    const cached = await readAchievementCache(appIdNum);
    // Return cache if: has entries and is fresh (<24h). Accept ANY source including
    // "schema-only" to avoid infinite regeneration loop.
    if (cached && cached.achievements.length > 0) {
      if (cached.summary.updated_at > 0 && Date.now() - (cached.summary.updated_at * 1000) < SCHEMA_TTL_MS) {
        console.debug(`[ACH][SCHEMA_GEN] appid=${appId} cache-fresh source=${cached.summary.source} entries=${cached.achievements.length} progressAvailable=${cached.summary.progress_available}`);
        return cached;
      }
      console.debug(`[ACH][SCHEMA_GEN] appid=${appId} cache-stale age=${Date.now() - (cached.summary.updated_at * 1000)}ms regenerating`);
    }
  } catch { /* cache read failed, generate fresh */ }

  // Step 1: KV binary parser + API enrichment (primary — already works with type fixes)
  console.log(`[ACH][SCHEMA_GEN] appid=${appId} generating from KV binary...`);
  try {
    const result: GenerateSchemaResult = await generateAchievementSchema({
      appId: appIdNum,
      steamPath,
      steamAccountId: accountId,
      steamWebApiKey: apiKey,
    });
    console.log(`[ACH][SCHEMA_GEN] appid=${appId} result=${result.source} entries=${result.entries_count} icons=${result.icons_downloaded} progress=${result.progress_available}`);
    if (result.error) {
      console.warn(`[ACH][SCHEMA_GEN] appid=${appId} error=${result.error}`);
    }
    if (result.entries_count > 0) {
      const generated = await readAchievementCache(appIdNum);
      if (generated && generated.achievements.length > 0) {
        const hasStatId = generated.achievements.some(a => a.stat_id != null);
        const hasDisplayName = generated.achievements.some(a => a.name && a.name !== a.api_name);
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} KV cache: ${generated.achievements.length} entries progressAvailable=${generated.summary.progress_available} hasStatId=${hasStatId} hasDisplayName=${hasDisplayName}`);
        // Only return if we have real data (statId or display names)
        // Don't return text fallback entries (no statId, no display names)
        if (hasStatId || hasDisplayName) {
          return generated;
        }
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} KV cache has no useful data (no statId, no displayName), continuing to tool fallback`);
      }
    }
  } catch (err) {
    console.warn(`[ACH][SCHEMA_GEN] appid=${appId} KV parser failed:`, err);
  }

  // Step 2: Fallback to schema tool (generate_emu_config.exe) — when KV parser fails
  // Only run if we don't already have a good cache (with statId or display names)
  const existingCache = await readAchievementCache(appIdNum).catch(() => null);
  const hasGoodCache = existingCache?.achievements.some(a => a.stat_id != null || (a.name && a.name !== a.api_name));
  if (hasGoodCache) {
    console.log(`[ACH][SCHEMA_GEN] appid=${appId} skipping tool — existing cache has good data`);
    return existingCache;
  }

  console.log(`[ACH][SCHEMA_GEN] appid=${appId} trying schema tool as fallback...`);
  try {
    const { generateSchemaViaTool } = await import("./tauri");
    const toolResult = await generateSchemaViaTool({
      appId: appIdNum,
      steamPath,
    });
    console.log(`[ACH][SCHEMA_GEN] appid=${appId} tool result=${toolResult.source} entries=${toolResult.entries_count} images=${toolResult.images_copied}`);
    if (toolResult.error) {
      console.warn(`[ACH][SCHEMA_GEN] appid=${appId} tool error=${toolResult.error}`);
    }
    if (toolResult.entries_count > 0) {
      const generated = await readAchievementCache(appIdNum);
      if (generated && generated.achievements.length > 0) {
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} returning tool cache ${generated.achievements.length} entries`);
        return generated;
      }
    }
  } catch (err) {
    console.warn(`[ACH][SCHEMA_GEN] appid=${appId} tool failed:`, err);
  }
  return null;
}

export async function resolveSteamAchievements(params: {
  appId: string | number;
  steamWebApiKey?: string;
  steamId64?: string;
  accountId?: string;
  steamPath?: string;
  language?: string;
  forceRefresh?: boolean;
  skipImageDownload?: boolean;
  steamAchievementsEnabled?: boolean;
  achievementSchemaPath?: string;
  gameSource?: string; // "steam" | "lua" | "debrid" | "manual" | "epic"
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

  // --- Config-based resolution: auto-detect steamPath + accountId ---
  const { getOrCreateConfig, resolveSteamPath, getAccountId } = await import("./achievementConfigService");
  const effectiveSteamPath = params.steamPath || await resolveSteamPath();

  // Auto-convert steamId64 → 32-bit accountId when accountId looks like a 64-bit ID
  const STEAM_ID64_BASE = 76561197960265728n;
  let effectiveAccountId = params.accountId?.trim() || "";
  if (effectiveAccountId && /^\d{17,20}$/.test(effectiveAccountId)) {
    try {
      const val = BigInt(effectiveAccountId);
      if (val >= STEAM_ID64_BASE) {
        const old = effectiveAccountId;
        effectiveAccountId = (val - STEAM_ID64_BASE).toString();
        console.log(`[ACH][ACCOUNT_ID] auto-converted steamId64 ${old} → accountId ${effectiveAccountId}`);
      }
    } catch { /* not a valid BigInt, use as-is */ }
  }

  // Auto-detect accountId from config or stats files
  if (!effectiveAccountId) {
    const detected = await getAccountId(appIdStr);
    if (detected) {
      effectiveAccountId = detected;
      console.log(`[ACH][ACCOUNT_ID] auto-detected accountId=${effectiveAccountId}`);
    }
  }

  // Get or create achievement config for this game
  let gameConfig = await getOrCreateConfig(appIdStr, undefined, params.gameSource);

  // Try to get game name from snapshot if config has placeholder name
  if (gameConfig && gameConfig.name.startsWith("Game ")) {
    try {
      const { getCachedSnapshot } = await import("./startupSnapshotService");
      const snapshot = getCachedSnapshot();
      const snapGame = snapshot?.library?.games?.find((g: any) => g.appId === appIdStr);
      if (snapGame?.title) {
        gameConfig.name = snapGame.title;
        const { writeConfig } = await import("./achievementConfigService");
        await writeConfig(gameConfig);
      }
    } catch { /* snapshot not available */ }
  }

  console.log(`[ACH][RESOLVE] appid=${appIdStr} effectiveAccountId=${effectiveAccountId || "EMPTY"} steamPath=${effectiveSteamPath || "EMPTY"} platform=${gameConfig?.platform ?? "none"} savePath=${gameConfig?.save_path ?? "none"}`);

  if (!achievementsEnabled) {
    return disabledSummary(appIdStr);
  }

  const lang = params.language ?? "english";

  // --- Resolver source order (following reference: schema + binary stats) ---
  // 1. Canonical schema (KV binary + API enrichment) — auto-generated, cached 24h
  // 2. Global achievement percentages (rarity display)
  // 3. Binary stats (UserGameStats_*.bin) — primary progress via bitfield extraction
  // 4. Web API player progress — fallback when forceRefresh=true and no binary stats

  let playerAchievements: PlayerAchievement[] = [];
  let schemaMap = new Map<string, SchemaAchievement>();
  let globalPctMap: Record<string, number> = {};
  let playerHttpStatus: string | null = null;
  let localProgressSummary: GameAchievementsSummary | null = null;
  let appSchemaAchievements: AppAchievementCacheEntry[] | null = null;

  // 1. Canonical schema — single source of truth for achievement list + optional progress
  let generatedCache: import("./tauri").AppAchievementCache | null = null;
  try {
    generatedCache = await ensureSchemaGenerated(appIdStr, effectiveSteamPath, effectiveAccountId, params.steamWebApiKey);
    if (generatedCache && generatedCache.achievements.length > 0) {
      appSchemaAchievements = generatedCache.achievements;
      for (const a of generatedCache.achievements) {
        if (!schemaMap.has(a.api_name)) {
          schemaMap.set(a.api_name, {
            name: a.api_name,
            displayName: a.name,
            description: a.description,
            icon: a.icon ?? a.icon_url,
            icongray: a.icon_gray ?? a.icon_gray_url,
          });
        }
      }
      // If schema generation included progress (binary stats available), use it directly
      // Only return early if the cache has actual unlock data (unlocked > 0)
      // If all entries are locked, continue to binary stats path for fresh unlock detection
      if (generatedCache.summary.progress_available && !params.forceRefresh && (generatedCache.summary.unlocked ?? 0) > 0) {
        const cacheSummary = cacheEntryToSummary(appIdStr, generatedCache.achievements, generatedCache.achievement_percentages, generatedCache.summary);
        // Check store freshness
        const stored = achievementStore.getSummary(appIdStr);
        if (stored) {
          const accept = isSourceNewerOrEqual(cacheSummary.source, cacheSummary.updatedAt, stored.source, stored.updatedAt);
          if (!accept) {
            console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} store-has-newer returning store summary`);
            return stored;
          }
        }
        console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} returning cache summary ${cacheSummary.unlocked}/${cacheSummary.total} source=${cacheSummary.source}`);
        return cacheSummary;
      }
      console.debug(`[ACH][SCHEMA_GEN] appid=${appIdStr} schema-only=${!generatedCache.summary.progress_available} continuing to progress sources`);
    }
  } catch (err) {
    console.warn(`[ACH][SCHEMA_GEN] appid=${appIdStr} failed:`, err);
  }

  // 2. Global achievement percentages (for rarity display only)
  try {
    const globalData = await fetchSteamGlobalAchievementPercentages(appIdNum);
    globalPctMap = parseGlobalPercentages(globalData);
  } catch (err) {
    console.warn(`[ACH][RARITY] App ${appIdStr}: global percentages failed:`, err);
  }

  // 3. Librarycache — PRIMARY source for unlock status (authoritative Steam data)
  if (effectiveAccountId && effectiveSteamPath) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const libcacheResult = await invoke<{
        n_total: number | null;
        n_achieved: number | null;
        entries: Array<{ str_id?: string; b_achieved?: boolean; rt_unlocked?: number }>;
      } | null>(
        "parse_librarycache_achievements",
        { steamPath: effectiveSteamPath, steamAccountId: effectiveAccountId, appId: appIdNum }
      );

      if (libcacheResult && libcacheResult.n_achieved != null && libcacheResult.n_total != null && libcacheResult.n_total > 0) {
        const libcacheUnlocked = libcacheResult.n_achieved;
        const libcacheTotal = libcacheResult.n_total;

        console.log(`[ACH][PROGRESS] App ${appIdStr}: librarycache ${libcacheUnlocked}/${libcacheTotal} entries=${libcacheResult.entries?.length ?? 0}`);

        // Build per-achievement unlock map from librarycache entries
        const libcacheMap = new Map<string, boolean>();
        for (const entry of libcacheResult.entries ?? []) {
          if (entry.str_id) {
            libcacheMap.set(entry.str_id, entry.b_achieved === true);
          }
        }

        // Build achievements list with librarycache unlock status
        const achievements: GameAchievement[] = (appSchemaAchievements ?? []).map(entry => {
          const libAchieved = libcacheMap.get(entry.api_name);
          return {
            id: entry.api_name,
            apiName: entry.api_name,
            name: entry.name,
            description: entry.description,
            iconUrl: entry.icon ?? entry.icon_url,
            iconGrayUrl: entry.icon_gray ?? entry.icon_gray_url,
            unlocked: libAchieved ?? false,
            rarityPercent: globalPctMap[entry.api_name] ?? entry.rarity_percent ?? undefined,
            statId: entry.stat_id,
            bit: entry.bit,
            progressStatId: entry.progress_stat_id,
            progressMin: entry.progress_min,
            progressMax: entry.progress_max,
          };
        });

        let computedUnlocked = achievements.filter(a => a.unlocked).length;

        // nAchieved is authoritative: when it's higher than our count,
        // mark remaining achievements as unlocked (hidden achievements
        // that Steam doesn't list in per-achievement arrays).
        if (libcacheUnlocked > computedUnlocked) {
          const remaining = libcacheUnlocked - computedUnlocked;
          let marked = 0;
          for (const a of achievements) {
            if (!a.unlocked && marked < remaining) {
              a.unlocked = true;
              marked++;
              computedUnlocked++;
            }
          }
          if (marked > 0) {
            console.log(`[ACH][PROGRESS] App ${appIdStr}: marked ${marked} hidden achievements as unlocked from nAchieved`);
          }
        }

        localProgressSummary = {
          appId: appIdStr,
          achievements,
          total: libcacheTotal,
          unlocked: computedUnlocked,
          percent: libcacheTotal > 0 ? Math.round((computedUnlocked / libcacheTotal) * 100) : 0,
          progressAvailable: true,
          source: "librarycache",
          updatedAt: Date.now(),
        };
        console.log(`[ACH][PROGRESS_SOURCE] appid=${appIdStr} source=librarycache unlocked=${computedUnlocked}/${libcacheTotal}`);
      } else {
        console.log(`[ACH][PROGRESS] App ${appIdStr}: librarycache empty or invalid`);
      }
    } catch (err) {
      console.debug(`[ACH][PROGRESS] App ${appIdStr}: librarycache read failed:`, err);
    }
  }

  // 4. Binary stats — FALLBACK only when librarycache didn't provide data
  // But first check if the achievementStore has better data (from previous librarycache read)
  if (!localProgressSummary) {
    const cached = achievementStore.getSummary(appIdStr);
    if (cached && (cached.unlocked ?? 0) > 0 && cached.progressAvailable) {
      localProgressSummary = cached;
      console.log(`[ACH][PROGRESS] App ${appIdStr}: using cached summary ${cached.unlocked}/${cached.total} source=${cached.source}`);
    }
  }

  // 3c. Crack achievements (GSE/RUNE/OnlineFix/Goldberg) — for non-official games
  if (!localProgressSummary && gameConfig && gameConfig.platform === "steam" && gameConfig.save_path) {
    try {
      const { readCrackAchievements } = await import("./crackAchievementReader");
      const crackData = await readCrackAchievements(gameConfig.save_path, appIdStr);
      if (crackData && crackData.achievements.length > 0) {
        localProgressSummary = {
          appId: appIdStr,
          achievements: crackData.achievements,
          total: crackData.total,
          unlocked: crackData.unlocked,
          percent: crackData.total > 0 ? Math.round((crackData.unlocked / crackData.total) * 100) : 0,
          progressAvailable: true,
          source: "librarycache" as GameAchievementsSummary["source"],
          updatedAt: Date.now(),
        };
        console.log(`[ACH][PROGRESS_SOURCE] appid=${appIdStr} source=crack-${crackData.source} unlocked=${crackData.unlocked}/${crackData.total}`);
      }
    } catch (err) {
      console.debug(`[ACH][PROGRESS] App ${appIdStr}: crack achievement read failed (non-critical):`, err);
    }
  }

  // 4. Web API player progress — fallback when forceRefresh=true and no binary stats
  if (!localProgressSummary && params.forceRefresh && hasFullAccess && !isCached403(appIdStr)) {
    console.debug(`[ACH][PROGRESS] App ${appIdStr}: trying Web API (forceRefresh fallback)...`);
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
        cache403(appIdStr);
      }
    }
    console.log(`[ACH][PROGRESS_SOURCE] appid=${appIdStr} source=web-api achievements=${playerAchievements.length} status=${playerHttpStatus ?? "ok"}`);
  }

  // --- Determine final source and summary ---

  let summary: GameAchievementsSummary;

  if (localProgressSummary?.progressAvailable) {
    summary = localProgressSummary;
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=binary-stats reason=local-progress unlocked=${summary.unlocked}/${summary.total}`);
  } else if (playerAchievements.length > 0) {
    summary = mergeAchievements({
      playerAchievements,
      schemaMap,
      globalPctMap,
      source: "steam-web-api",
      progressAvailable: true,
      appId: appIdStr,
    });
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=steam-web-api reason=player-achievements unlocked=${summary.unlocked}/${summary.total}`);
  } else if (localProgressSummary) {
    summary = localProgressSummary;
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=binary-stats-fallback reason=no-progress-field unlocked=${summary.unlocked}/${summary.total}`);
  } else if (schemaMap.size > 0) {
    const errorReason = playerHttpStatus === "403" ? "api-403-fallback" : undefined;
    summary = buildSchemaOnlySummary(appIdStr, schemaMap, globalPctMap, errorReason);
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=schema-only reason=no-progress-sources unlocked=0/${summary.total} progressAvailable=false`);
  } else {
    const unavailableReason = playerHttpStatus === "403" ? "api-403" : "no-data";
    summary = buildUnavailableSummary(appIdStr, unavailableReason);
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=unavailable reason=${unavailableReason}`);
  }

  // Debug logs
  const iconCount = summary.achievements.filter(a => a.iconUrl).length;
  const unlockedCount = summary.achievements.filter(a => a.unlocked).length;
  console.log(`[ACH][RESOLVE_DONE] appid=${appIdStr} total=${summary.achievements.length} unlocked=${unlockedCount}/${summary.total} source=${summary.source} icons=${iconCount} progressAvailable=${summary.progressAvailable}`);

  // Unlock detection handled by achievementStore.applyProgressPatch (snapshot-based).
  // Resolver does not detect unlocks — it only returns the summary.
  summary.newlyUnlocked = [];

  // CRITICAL GUARD: Never overwrite existing progress with schema-only data.
  // If the store already has progress_available=true data, keep it.
  const existingStore = achievementStore.getSummary(appIdStr);
  if (existingStore?.progressAvailable && !summary.progressAvailable && !params.forceRefresh) {
    console.log(`[ACH][PROGRESS_PRESERVE] appid=${appIdStr} keeping existing ${existingStore.unlocked}/${existingStore.total} source=${existingStore.source} over schema-only ${summary.unlocked}/${summary.total}`);
    // Still write the enriched metadata (icons, names) from the new summary to the store,
    // but preserve the progress counts from the existing store
    summary = {
      ...existingStore,
      achievements: summary.achievements.map(a => {
        const existingAch = existingStore.achievements?.find(e => e.apiName === a.apiName);
        if (existingAch?.unlocked) {
          return { ...a, unlocked: true, unlockTime: existingAch.unlockTime };
        }
        return a;
      }),
      total: existingStore.total || summary.total,
      unlocked: existingStore.unlocked ?? summary.unlocked,
      percent: existingStore.percent ?? summary.percent,
      updatedAt: Date.now(),
    };
  }

  // Save to disk cache if we have achievements (progress or schema-only)
  // Only write cache with icon migration when forceRefresh=true (explicit manual/developer action)
  const _migrateIcons = params.forceRefresh === true;
  const _downloadImages = params.forceRefresh === true && !params.skipImageDownload;
  if (DEBUG_ACH_DIAG) {
    console.log(`[ACH][DIAG] appid=${appIdStr} writeCheck achievementsLength=${summary.achievements.length} willWrite=${summary.achievements.length > 0}`);
  }
  if (summary.achievements.length > 0) {
    // Protect against overwriting cache with no-progress result when valid progress exists
    // Covers: schema-only, appcache-unparseable, any source with progressAvailable=false
    // SKIP when forceRefresh=true — manual refresh should NOT preserve stale progress
    if (!summary.progressAvailable && !params.forceRefresh) {
      try {
        const existing = await readAchievementCache(appIdNum);
        if (existing?.summary?.progress_available === true) {
          const existingUnlocked = existing.summary.unlocked ?? 0;
          const existingTotal = existing.summary.total ?? 0;
          console.debug(`[ACH][CACHE] write protected reason=would-downgrade-progress appid=${appIdStr} (existing progress_available=true source=${existing.summary.source} unlocked=${existingUnlocked}/${existingTotal} new-source=${summary.source})`);
          console.log(`[ACH][PROGRESS_PRESERVE] appid=${appIdStr} reason=no-new-progress existing=${existingUnlocked}/${existingTotal} new-source=${summary.source}`);
          // Merge existing progress with refreshed metadata
          const mergedAchievements: GameAchievement[] = summary.achievements.map((a) => {
            const existingA = existing.achievements.find((ea) => ea.api_name === a.apiName);
            const existingUnlockedVal = existingA?.unlocked ?? false;
            const existingUnlockTime = existingA?.unlock_time ? existingA.unlock_time * 1000 : undefined;
            return {
              ...a,
              unlocked: existingUnlockedVal,
              unlockTime: existingUnlockTime,
              rarityPercent: a.rarityPercent ?? existingA?.rarity_percent,
            };
          });
          summary = {
            appId: appIdStr,
            achievements: mergedAchievements,
            total: existingTotal || summary.achievements.length,
            unlocked: existingUnlocked || mergedAchievements.filter((a) => a.unlocked).length,
            percent: existing.summary.percent ?? 0,
            progressAvailable: true,
            source: (existing.summary.source === "librarycache" ? "librarycache-stale" : (existing.summary.source + "-stale")) as GameAchievementsSummary["source"],
            updatedAt: Date.now(),
            errorReason: "no-new-progress-preserved",
          };
          console.debug(`[ACH][CACHE] App ${appIdStr}: merged existing progress (${summary.unlocked}/${summary.total}) with refreshed metadata`);
        } else {
          // Existing cache is also no-progress — safe to overwrite
          console.debug(`[ACH][CACHE] App ${appIdStr}: no-progress result — no existing real progress to preserve (existing-progress=${existing?.summary?.progress_available ?? false})`);
        }
      } catch (err) {
        console.warn(`[ACH][CACHE] App ${appIdStr}: cache read for downgrade check failed:`, err);
      }
    }
    try {
      if (!_migrateIcons) {
        const { logMigrateIconsForcedOff } = await import("./achievementAutoFlags");
        logMigrateIconsForcedOff(appIdStr, "resolveSteamAchievements");
      }
      const { achievements, pcts, summaryData } = summaryToCacheData(summary);
      await writeAchievementCache(appIdNum, {
        achievements,
        achievement_percentages: pcts,
        summary: summaryData,
      }, _migrateIcons);
      if (appIdStr === "268910") {
        const unlocked = achievements.filter((a: any) => a.unlocked).length;
        console.log(`[ACH][TRACE_DISK_WRITE] appid=268910 unlocked=${unlocked}/${achievements.length} progressAvailable=${summary.progressAvailable} updatedAt=${summaryData.updated_at}`);
      }
      console.debug(`[ACH][CACHE] App ${appIdStr}: cached ${achievements.length} achievements to disk (progress=${summary.progressAvailable})`);
    } catch (err) {
      console.warn(`[ACH][CACHE] App ${appIdStr}: failed to write disk cache:`, err);
    }

    // SQLite dual-write — populate achievement tables for fast reads
    try {
      const { upsertAchievementSummary, batchUpsertAchievementEntries } = await import("./tauri");
      const now = Date.now();
      await Promise.all([
        upsertAchievementSummary({
          appId: appIdStr,
          unlocked: summary.unlocked ?? 0,
          total: summary.achievements.length > 0 ? summary.achievements.length : (summary.total ?? 0),
          inProgress: summary.unlocked ?? 0,
          completionTime: null,
          lastUnlockAt: null,
          updatedAt: now,
        }),
        batchUpsertAchievementEntries(summary.achievements.map(a => ({
          appId: appIdStr,
          apiName: a.apiName,
          name: a.name,
          description: a.description ?? null,
          iconUrl: a.iconUrl ?? null,
          iconGray: a.iconGrayUrl ?? null,
          hidden: false,
          unlocked: a.unlocked,
          unlockTime: a.unlockTime ? Math.floor(a.unlockTime / 1000) : null,
          unlockedAt: a.unlockTime ? Math.floor(a.unlockTime / 1000) : null,
          globalPct: a.rarityPercent ?? null,
          updatedAt: now,
        }))),
      ]);
      console.debug(`[ACH][SQLITE] resolver dual-write complete appid=${appIdStr}`);
    } catch (sqlErr) {
      console.debug(`[ACH][SQLITE] resolver dual-write failed appid=${appIdStr} error=${sqlErr}`);
    }
  } else if (DEBUG_ACH_DIAG) {
    console.log(`[ACH][DIAG] appid=${appIdStr} writeSkipped reason=empty-achievements`);
  }

  // Image download for manual refresh — fire-and-forget, does NOT block refresh
  if (_downloadImages && summary.achievements.length > 0) {
    const iconUrls: string[] = [];
    const grayUrls: string[] = [];
    for (const a of summary.achievements) {
      const iconCdn = a.iconUrl ? resolveIconToCdnUrl(appIdStr, a.iconUrl) : null;
      if (iconCdn) iconUrls.push(iconCdn);
      const grayCdn = a.iconGrayUrl ? resolveIconToCdnUrl(appIdStr, a.iconGrayUrl) : null;
      if (grayCdn) grayUrls.push(grayCdn);
    }
    // Fire background download — NOT awaited, refresh continues immediately
    downloadAchievementIconsInBackground(appIdStr, appIdNum, iconUrls, grayUrls);
    console.log(`[ACH][IMG_REPAIR_NON_BLOCKING] appid=${appIdStr} refreshContinued=true`);
  }

  // Check store freshness before returning — prefer newer data from watcher/auto-sync
  const stored = achievementStore.getSummary(appIdStr);
  if (stored) {
    const accept = isSourceNewerOrEqual(summary.source, summary.updatedAt, stored.source, stored.updatedAt);
    if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_SOURCE] appid=${appIdStr} source=${summary.source} unlocked=${summary.unlocked}/${summary.total} updatedAt=${summary.updatedAt} progressAvailable=${summary.progressAvailable} accepted=${accept} existingSource=${stored.source} existingUnlocked=${stored.unlocked}/${stored.total}`);
    if (!accept) {
      if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_MERGE] appid=${appIdStr} accepted=false reason=store-has-newer returning store summary`);
      return stored;
    }
  } else {
    if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_SOURCE] appid=${appIdStr} source=${summary.source} unlocked=${summary.unlocked}/${summary.total} updatedAt=${summary.updatedAt} progressAvailable=${summary.progressAvailable} accepted=true reason=first-summary`);
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