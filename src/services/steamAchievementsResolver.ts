import type { GameAchievement, GameAchievementsSummary } from "../types/gameAchievements";
import {
  fetchSteamPlayerAchievements,
  fetchSteamGlobalAchievementPercentages,
  fetchSteamAchievementSchema,
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
const DEBUG_ACH_DIAG = false;

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

function normalizeValidAppId(value: unknown, gameSource?: string): string | null {
  const appId = String(value ?? "").trim();
  if (!appId || appId === "0" || appId.toLowerCase() === "undefined" || appId.toLowerCase() === "null" || appId === "NaN") {
    return null;
  }
  // Epic/GOG/other non-Steam games use string app IDs (e.g. "Fortnite", "Sugar")
  if (gameSource === "epic" || gameSource === "gog") {
    return appId;
  }
  const num = Number(appId);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return appId;
}

/**
 * Convert a string appId to a stable numeric hash for cache operations.
 * Steam apps already have numeric IDs; Epic/GOG apps get a deterministic hash.
 */
export function numericAppIdHash(str: string): number {
  const num = Number(str);
  if (Number.isFinite(num) && num > 0) return num;
  // FNV-1a 32-bit hash — deterministic and well-distributed
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return (hash >>> 0) || 1; // unsigned 32-bit — matches Rust u32
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
  progressAvailable = false,
  errorReason?: string,
): GameAchievementsSummary {
  return {
    ...mergeAchievements({
      playerAchievements: [],
      schemaMap,
      globalPctMap,
      source: "schema-only",
      progressAvailable,
      appId,
    }),
    errorReason,
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
  achievements: Array<{ apiName: string; iconUrl?: string; iconGrayUrl?: string }>,
  platform?: string,
): Promise<void> {
  const startTime = Date.now();

  // Pre-check: which icons already exist on disk?
  let existingByApiName: Map<string, { icon_exists: boolean; icon_gray_exists: boolean }> | null = null;
  try {
    const { resolveAchievementImagePaths } = await import("./tauri");
    const statuses = await resolveAchievementImagePaths(appIdNum);
    existingByApiName = new Map(statuses.map((s) => [s.api_name, s]));
  } catch {
    // Non-critical — proceed with full download
  }

  // Build work list with correct filenames, skipping existing
  type WorkItem = { url: string; fileName: string };
  const items: WorkItem[] = [];
  let skippedExisting = 0;

  for (const a of achievements) {
    const status = existingByApiName?.get(a.apiName);

    if (a.iconUrl) {
      if (status?.icon_exists) {
        skippedExisting++;
      } else {
        const iconCdn = resolveIconToCdnUrl(appIdStr, a.iconUrl);
        if (iconCdn) {
          const fileName = iconCdn.split("/").pop();
          if (fileName) items.push({ url: iconCdn, fileName });
        }
      }
    }

    if (a.iconGrayUrl) {
      if (status?.icon_gray_exists) {
        skippedExisting++;
      } else {
        const grayCdn = resolveIconToCdnUrl(appIdStr, a.iconGrayUrl);
        if (grayCdn) {
          const baseName = grayCdn.split("/").pop();
          if (baseName) {
            const fileName = baseName.replace(/\.jpg$/i, "_gray.jpg").replace(/\.png$/i, "_gray.png");
            items.push({ url: grayCdn, fileName });
          }
        }
      }
    }
  }

  // Deduplicate by destination filename
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    if (seen.has(item.fileName)) return false;
    seen.add(item.fileName);
    return true;
  });

  const totalSources = deduped.length + skippedExisting;
  console.log(`[ACH][IMG_REPAIR_START] appid=${appIdStr} totalAchievements=${achievements.length} totalSources=${totalSources} queued=${deduped.length} skippedExisting=${skippedExisting}`);

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
          platform,
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
export async function ensureSchemaGenerated(
  appId: string,
  steamPath?: string,
  accountId?: string,
  apiKey?: string,
  platform?: string,
): Promise<import("./tauri").AppAchievementCache | null> {
  const appIdNum = Number(appId);
  const SCHEMA_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  try {
    const cached = await readAchievementCache(appIdNum, platform);
    // Return cache if: has entries and is fresh (<24h) AND has real schema data (stat_id present).
    // Reject librarycache-only caches (no stat_id) — these are degraded and should be
    // regenerated from the KV binary when it becomes available.
    if (cached && cached.achievements.length > 0) {
      const hasStatId = cached.achievements.some(a => a.stat_id != null);
      const hasDisplayName = cached.achievements.some(a => a.name && a.name !== a.api_name);
      const isFresh = cached.summary.updated_at > 0 && Date.now() - (cached.summary.updated_at * 1000) < SCHEMA_TTL_MS;
      if (isFresh && hasStatId && hasDisplayName) {
        console.debug(`[ACH][SCHEMA_GEN] appid=${appId} cache-fresh source=${cached.summary.source} entries=${cached.achievements.length} progressAvailable=${cached.summary.progress_available} hasStatId=true hasDisplayName=true`);
        return cached;
      }
      if (isFresh && hasStatId && !hasDisplayName) {
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} cache-fresh but NO display names (api_name used as name), forcing regeneration with API enrichment`);
      } else if (isFresh && !hasStatId) {
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} cache-fresh but NO stat_id (librarycache-only), forcing regeneration from KV binary`);
      } else {
        console.debug(`[ACH][SCHEMA_GEN] appid=${appId} cache-stale age=${Date.now() - (cached.summary.updated_at * 1000)}ms regenerating`);
      }
    }
  } catch { /* cache read failed, generate fresh */ }

  // Step 1: KV binary parser + API enrichment (primary — already works with type fixes)
  console.log(`[ACH][SCHEMA_GEN] appid=${appId} generating from KV binary... platform=${platform ?? "steam-official"} apiKey_present=${!!apiKey} apiKey_len=${apiKey?.length ?? 0}`);
  let result: GenerateSchemaResult;
  try {
    result = await generateAchievementSchema({
      appId: appIdNum,
      steamPath,
      steamAccountId: accountId,
      steamWebApiKey: apiKey,
      platform,
    });
    console.log(`[ACH][SCHEMA_GEN] appid=${appId} result=${result.source} entries=${result.entries_count} icons=${result.icons_downloaded} progress=${result.progress_available}`);
    if (result.error) {
      console.warn(`[ACH][SCHEMA_GEN] appid=${appId} error=${result.error}`);
    }

    // Retry up to 3 times (2s each) if schema not ready — Steam creates the bin empty, then fills it asynchronously.
    // "schema-not-ready" = file too small (Steam still writing)
    // "no-schema-file"  = file not found or parsed empty
    const needsRetry = (result.source === "no-schema-file" || result.source === "schema-not-ready") && result.entries_count === 0;
    if (needsRetry) {
      console.log(`[ACH][SCHEMA_GEN] appid=${appId} schema not ready, waiting 1s...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await generateAchievementSchema({
        appId: appIdNum,
        steamPath,
        steamAccountId: accountId,
        steamWebApiKey: apiKey,
        platform,
      });
      console.log(`[ACH][SCHEMA_GEN] appid=${appId} retry result=${result.source} entries=${result.entries_count}`);
      if (result.error) {
        console.warn(`[ACH][SCHEMA_GEN] appid=${appId} retry error=${result.error}`);
      }
    }
    if (result.entries_count > 0) {
      const generated = await readAchievementCache(appIdNum, platform);
      if (generated && generated.achievements.length > 0) {
        const hasStatId = generated.achievements.some(a => a.stat_id != null);
        const hasDisplayName = generated.achievements.some(a => a.name && a.name !== a.api_name);
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} KV cache: ${generated.achievements.length} entries progressAvailable=${generated.summary.progress_available} hasStatId=${hasStatId} hasDisplayName=${hasDisplayName}`);
        // Return if we have real data: statId, display names, or progress_available.
        // progress_available means the schema was generated from KV binary with unlock status.
        // The v7 version guard in write_achievement_cache prevents background writes from
        // overwriting schema data, so stat_id should be preserved once generated.
        if (hasStatId || hasDisplayName || generated.summary.progress_available) {
          return generated;
        }
        console.log(`[ACH][SCHEMA_GEN] appid=${appId} KV cache has no useful data (no statId, no displayName, no progress), continuing to tool fallback`);
      }
    }
  } catch (err) {
    console.warn(`[ACH][SCHEMA_GEN] appid=${appId} KV parser failed:`, err);
  }

  // KV parser failed or produced no useful data — no schema available
  // (generate_emu_config.exe removed — was unreliable and blocked boot)
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
  platform?: string; // "steam" | "steam-official" | "epic-official" — force platform, skip auto-detect
  installDir?: string; // game install directory — used for Tenoke crack detection
  epicNamespace?: string; // Epic namespace (first segment of providerGameId)
}): Promise<GameAchievementsSummary> {
  const appIdStr = normalizeValidAppId(params.appId, params.gameSource);

  if (!appIdStr) {
    return buildUnavailableSummary(String(params.appId ?? ""), "missing-appid");
  }

  const appIdNum = numericAppIdHash(appIdStr);

  // Epic: the real productId from the API (may differ from appName)
  let epicProductId = appIdStr;

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
  let gameConfig = await getOrCreateConfig(appIdStr, undefined, params.gameSource, params.installDir);

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

  // Platform detection — respect explicit user choice, otherwise auto-detect
  const { detectCrackType, updateConfigForCrack } = await import("./achievementConfigService");
  let readPlatform = gameConfig?.platform ?? "steam-official";
  let readSavePath = gameConfig?.save_path ?? "";

  if (params.platform === "steam-official") {
    // User explicitly chose "Steam Official" — skip crack detection entirely
    readPlatform = "steam-official";
    const steamPath = effectiveSteamPath || await (async () => {
      const { resolveSteamPath } = await import("./achievementConfigService");
      return resolveSteamPath();
    })();
    readSavePath = steamPath ? `${steamPath}\\appcache\\stats` : "";
    console.log(`[ACH][RESOLVE] appid=${appIdStr} user chose steam-official, skipping crack detect`);
  } else if (params.platform === "steam") {
    // User explicitly chose crack — force crack path
    readPlatform = "steam";
    const crackResult = await detectCrackType(appIdStr, params.installDir).catch(() => null);
    if (crackResult?.savePath) {
      readSavePath = crackResult.savePath;
      console.log(`[ACH][RESOLVE] appid=${appIdStr} user chose crack, savePath=${readSavePath}`);
      try {
        gameConfig = await updateConfigForCrack(appIdStr, readSavePath, gameConfig?.name) ?? gameConfig;
      } catch { /* config update failed, continue with local vars */ }
    }
  } else if (params.platform === "epic-official" || params.gameSource === "epic") {
    // Epic Official — no local save_path needed (progress fetched from Epic API)
    readPlatform = "epic-official";
    readSavePath = ""; // Epic achievements are fetched from API, not local files
    console.log(`[ACH][RESOLVE] appid=${appIdStr} Epic Official platform, skipping Steam-specific checks`);
  } else {
    // Auto-detect (default behavior)
    const crackResult = await detectCrackType(appIdStr, params.installDir).catch(() => null);
    if (crackResult?.savePath) {
      // If the game is official Steam (source="steam"/"lua"), keep steam-official as default.
      // The crack saves exist but the game has a Steam install — use official for schema.
      const isOfficialSteam = gameConfig?.platform === "steam-official" ||
        params.gameSource === "steam" || params.gameSource === "lua";
      if (isOfficialSteam) {
        readPlatform = "steam-official";
        const steamPath = effectiveSteamPath || await (async () => {
          const { resolveSteamPath } = await import("./achievementConfigService");
          return resolveSteamPath();
        })();
        readSavePath = steamPath ? `${steamPath}\\appcache\\stats` : "";
        console.log(`[ACH][RESOLVE] appid=${appIdStr} crack detected but game is official steam, using steam-official savePath=${readSavePath}`);
        // Still create/update both configs so user can switch
        try {
          gameConfig = await updateConfigForCrack(appIdStr, crackResult.savePath, gameConfig?.name) ?? gameConfig;
        } catch { /* config update failed, continue with local vars */ }
      } else {
        readPlatform = "steam";
        readSavePath = crackResult.savePath;
        console.log(`[ACH][RESOLVE] appid=${appIdStr} crack save detected platform=steam savePath=${readSavePath}`);
        try {
          gameConfig = await updateConfigForCrack(appIdStr, readSavePath, gameConfig?.name) ?? gameConfig;
        } catch { /* config update failed, continue with local vars */ }
      }
    } else if (!readSavePath || readSavePath.includes("appcache")) {
      readPlatform = "steam-official";
      const steamPath = effectiveSteamPath || await (async () => {
        const { resolveSteamPath } = await import("./achievementConfigService");
        return resolveSteamPath();
      })();
      readSavePath = steamPath ? `${steamPath}\\appcache\\stats` : "";
    }
  }

  console.log(`[ACH][RESOLVE] appid=${appIdStr} effectiveAccountId=${effectiveAccountId || "EMPTY"} steamPath=${effectiveSteamPath || "EMPTY"} platform=${readPlatform} savePath=${readSavePath}`);

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
  // Split by platform: crack → Steam Web API (writes to steam/<appId>/), official → KV binary (writes to steam-official/<appId>/)
  let generatedCache: import("./tauri").AppAchievementCache | null = null;
  try {
    if (readPlatform === "steam") {
      // Crack path: Steam Web API schema → steam/<appId>/ (crack schema — names/icons/descriptions)
      if (hasApiKey) {
        console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} crack detected, using Steam Web API → steam/${appIdStr}/`);
        try {
          const schemaResponse = await fetchSteamAchievementSchema({
            appId: appIdNum,
            apiKey: params.steamWebApiKey!,
            language: params.language,
          });
          // Steam GetSchemaForGame/v2 returns { "game": { "availableGameStats": { "achievements": [...] } } }
          const gameData = (schemaResponse as any)?.game ?? (schemaResponse as any);
          const achievementList = gameData?.availableGameStats?.achievements ?? gameData?.achievements?.highlighted ?? gameData?.achievements ?? [];
          if (Array.isArray(achievementList) && achievementList.length > 0) {
            const entries: import("./tauri").AppAchievementCacheEntry[] = achievementList.map((a: any) => ({
              id: a.name,
              api_name: a.name,
              name: a.displayName ?? a.name ?? "",
              description: a.description ?? "",
              icon: a.icon ?? undefined,
              icon_gray: a.icongray ?? undefined,
              unlocked: false,
              unlock_time: undefined,
            }));
            // Build cache in-memory — do NOT write to disk here.
            // Writing an intermediate summary with source="steam-web-api" and unlocked=0
            // causes a visible flash in summary.json before the crack reader runs and
            // overwrites with real progress. The final writeAchievementCache at line ~1433
            // persists the correct data with crack progress.
            generatedCache = {
              achievements: entries,
              achievement_percentages: [],
              summary: {
                app_id: appIdStr,
                total: entries.length,
                unlocked: 0,
                percent: 0,
                progress_available: false,
                source: "steam-web-api",
                updated_at: Math.floor(Date.now() / 1000),
              },
            };
            console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} Steam Web API schema: ${entries.length} achievements (in-memory, disk write deferred)`);
          } else {
            console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} Steam Web API returned no achievements`);
          }
        } catch (e) {
          console.warn(`[ACH][SCHEMA_GEN] appid=${appIdStr} Steam Web API failed: ${String(e)}`);
        }
      } else {
        console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} crack detected but no Steam Web API key — skipping schema`);
      }

      // Do NOT create steam-official schema for cracked games.
      // The crack schema (steam/<appId>/) already contains icon URLs from the Steam Web API.
      // Icon resolution (resolveAchievementIconPath) falls back from steam-official/ to steam/.
      // Writing to steam-official/ for cracked games would contaminate the official schema
      // with crack-sourced data and cause cross-platform interference.

      // Read from crack schema (primary for crack progress)
      generatedCache = generatedCache ?? await readAchievementCache(appIdNum, readPlatform);
    } else if (readPlatform === "epic-official") {
      // Epic Official path: fetch schema from Epic API → writes to epic-official/<appId>/
      console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} Epic Official, fetching schema from Epic API → epic-official/${appIdStr}/`);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const epicSchema = await invoke<{
          product_id: string;
          sandbox_id: string;
          achievements: Array<{
            api_name: string;
            display_name: string;
            description: string;
            icon_url: string | null;
            icon_gray_url: string | null;
            hidden: boolean;
            xp: number | null;
          }>;
        }>("epic_fetch_achievement_schema", {
          productId: appIdStr,
          namespaceId: params.epicNamespace ?? "",
        });

        // Capture the real Epic productId discovered by the API (different from appName)
        epicProductId = epicSchema.product_id || appIdStr;
        console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} Epic discovered productId=${epicProductId} sandboxId=${epicSchema.sandbox_id}`);

        if (epicSchema && epicSchema.achievements.length > 0) {
          const entries: import("./tauri").AppAchievementCacheEntry[] = epicSchema.achievements.map((a) => ({
            id: a.api_name,
            api_name: a.api_name,
            name: a.display_name,
            description: a.description,
            icon: a.icon_url ?? undefined,
            icon_gray: a.icon_gray_url ?? undefined,
            unlocked: false,
            unlock_time: undefined,
          }));
          await writeAchievementCache(appIdNum, {
            achievements: entries,
            achievement_percentages: [],
            summary: {
              app_id: appIdStr,
              total: entries.length,
              unlocked: 0,
              percent: 0,
              progress_available: false,
              source: "epic-official",
              updated_at: Math.floor(Date.now() / 1000),
            },
          }, false, "epic-official");
          console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} Epic schema: ${entries.length} achievements written to epic-official/${appIdStr}/`);
          generatedCache = await readAchievementCache(appIdNum, readPlatform);
        } else {
          console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} Epic API returned no achievements`);
        }
      } catch (e) {
        console.warn(`[ACH][SCHEMA_GEN] appid=${appIdStr} Epic API failed: ${String(e)}`);
      }
    } else {
      // Official path: KV binary + API enrichment → writes schema to steam-official/<appId>/
      generatedCache = await ensureSchemaGenerated(appIdStr, effectiveSteamPath, effectiveAccountId, params.steamWebApiKey, "steam-official");
    }
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
      // Schema progress data is baked-in at generation time — by the time the resolver
      // runs, the binary stats / librarycache / crack reader may have fresher data.
      // Skip early return so the pipeline below can produce an authoritative source
      // (binary-stats, librarycache, crack) with current unlock counts.
      // Schema data is still used for names/icons/descriptions via schemaMap above.
      // NOTE: the old early-return with "schema-generated" source was disabled because
      // the 24h TTL cache in ensureSchemaGenerated could return stale unlock counts,
      // and the 5-icon download bug (getSummary without platform) prevented image jobs.
      console.debug(`[ACH][SCHEMA_GEN] appid=${appIdStr} schema-only=${!generatedCache.summary.progress_available} continuing to progress sources`);

      // 1c. TS-side API enrichment — fill missing display names/descriptions/icons
      // When Rust returns kv-binary (API enrichment failed), cache has api_name as display name.
      // Call Steam Web API directly from TS to get real names, then merge by api_name.
      if (hasApiKey && generatedCache.summary.source === "kv-binary") {
        const missingNames = generatedCache.achievements.filter(a => !a.name || a.name === a.api_name);
        if (missingNames.length > 0) {
          console.log(`[ACH][SCHEMA_ENRICH] appid=${appIdStr} kv-binary has ${missingNames.length}/${generatedCache.achievements.length} missing names, fetching from Steam API...`);
          try {
            const apiResponse = await fetchSteamAchievementSchema({
              appId: appIdNum,
              apiKey: params.steamWebApiKey!,
              language: params.language,
            });
            console.log(`[ACH][SCHEMA_ENRICH] appid=${appIdStr} API response received, parsing...`);
            // Parse: GetSchemaForGame/v2 → { "game": { "availableGameStats": { "achievements": [...] } } }
            const gameData = (apiResponse as any)?.game ?? (apiResponse as any);
            const achievementList = gameData?.availableGameStats?.achievements ?? gameData?.achievements?.highlighted ?? gameData?.achievements ?? [];
            if (Array.isArray(achievementList) && achievementList.length > 0) {
              // Build lookup by api_name
              const apiByName = new Map<string, { displayName?: string; description?: string; icon?: string; icongray?: string }>();
              for (const a of achievementList) {
                const name = a.name;
                if (name) {
                  apiByName.set(name, {
                    displayName: a.displayName,
                    description: a.description,
                    icon: a.icon,
                    icongray: a.icongray,
                  });
                }
              }

              // Merge into appSchemaAchievements
              let enrichedCount = 0;
              for (let i = 0; i < generatedCache.achievements.length; i++) {
                const entry = generatedCache.achievements[i];
                const apiData = apiByName.get(entry.api_name);
                if (apiData) {
                  if (apiData.displayName && (!entry.name || entry.name === entry.api_name)) {
                    generatedCache.achievements[i] = { ...entry, name: apiData.displayName };
                  }
                  if (apiData.description && !entry.description) {
                    generatedCache.achievements[i] = { ...generatedCache.achievements[i], description: apiData.description };
                  }
                  if (apiData.icon) {
                    generatedCache.achievements[i] = { ...generatedCache.achievements[i], icon: apiData.icon };
                  }
                  if (apiData.icongray) {
                    generatedCache.achievements[i] = { ...generatedCache.achievements[i], icon_gray: apiData.icongray };
                  }
                  enrichedCount++;
                }
              }

              // Rebuild schemaMap with enriched data
              schemaMap.clear();
              for (const a of generatedCache.achievements) {
                schemaMap.set(a.api_name, {
                  name: a.api_name,
                  displayName: a.name,
                  description: a.description,
                  icon: a.icon ?? a.icon_url,
                  icongray: a.icon_gray ?? a.icon_gray_url,
                });
              }

              console.log(`[ACH][SCHEMA_ENRICH] appid=${appIdStr} enriched ${enrichedCount}/${generatedCache.achievements.length} entries from Steam API`);
            } else {
              console.log(`[ACH][SCHEMA_ENRICH] appid=${appIdStr} Steam API returned no achievements`);
            }
          } catch (apiErr) {
            console.warn(`[ACH][SCHEMA_ENRICH] appid=${appIdStr} Steam API enrichment failed (non-critical):`, apiErr);
          }
        }
      } else {
        console.log(`[ACH][SCHEMA_ENRICH] appid=${appIdStr} SKIPPED hasApiKey=${hasApiKey} source=${generatedCache.summary.source}`);
      }
    }
  } catch (err) {
    console.warn(`[ACH][SCHEMA_GEN] appid=${appIdStr} failed:`, err);
  }

  // 1b. Schema generation failed — try to recover from store data (watcher may have processed bins)
  if ((!appSchemaAchievements || appSchemaAchievements.length === 0) && schemaMap.size === 0) {
    try {
      const { achievementStore } = await import("./achievementStore");
      const watcherSummary = achievementStore.getSummary(appIdStr, params.platform);
      if (watcherSummary && watcherSummary.total > 0 && watcherSummary.achievements?.length > 0) {
        appSchemaAchievements = watcherSummary.achievements.map(a => ({
          id: a.id,
          api_name: a.apiName,
          name: a.name,
          description: a.description,
          icon: a.iconUrl,
          icon_gray: a.iconGrayUrl,
          unlocked: a.unlocked,
          unlock_time: a.unlockTime,
          stat_id: a.statId,
          bit: a.bit,
        }));
        for (const a of appSchemaAchievements) {
          if (!schemaMap.has(a.api_name)) {
            schemaMap.set(a.api_name, {
              name: a.api_name,
              displayName: a.name,
              description: a.description,
              icon: a.icon,
              icongray: a.icon_gray,
            });
          }
        }
        console.log(`[ACH][SCHEMA_GEN] appid=${appIdStr} recovered from store: ${appSchemaAchievements.length} entries`);
      }
    } catch { /* store read failed */ }
  }

  // 2. Global achievement percentages (for rarity display only)
  try {
    const globalData = await fetchSteamGlobalAchievementPercentages(appIdNum);
    globalPctMap = parseGlobalPercentages(globalData);
  } catch (err) {
    console.warn(`[ACH][RARITY] App ${appIdStr}: global percentages failed:`, err);
  }

  // 2b. Binary-stats — read directly from .bin files (more reliable than librarycache)
  // Uses appSchemaAchievements (step 1) for icons/names + parseUserGameStatsRaw for bitmask.
  // Falls through to librarycache (step 3) when .bin is empty or schema unavailable.
  // SKIP for readPlatform === "steam": user chose crack saves — Steam binary stats are
  // irrelevant and would overwrite the crack reader result with stale Steam data.
  if (!localProgressSummary && readPlatform !== "steam" && effectiveSteamPath && effectiveAccountId) {
    try {
      const { parseUserGameStatsRaw } = await import("./tauri");

      // Read bitmask from .bin file
      const statsResult = await parseUserGameStatsRaw({
        steamPath: effectiveSteamPath,
        steamAccountId: effectiveAccountId,
        appId: appIdNum,
      });

      if (statsResult.file_found && statsResult.stat_pairs.length > 0) {
        // Build stat_id → bitmask map
        const statsMap = new Map<number, number>();
        const timestampMap = new Map<string, number>();
        for (const pair of statsResult.stat_pairs) {
          statsMap.set(pair.stat_id, pair.value);
          if (pair.times) {
            for (const [bit, ts] of Object.entries(pair.times)) {
              timestampMap.set(`${pair.stat_id}:${bit}`, ts);
            }
          }
        }

        if (appSchemaAchievements && appSchemaAchievements.length > 0) {
          // Schema available — cross-reference schema (with icons) + bitmask
          const achievements: GameAchievement[] = [];
          let unlocked = 0;
          for (const entry of appSchemaAchievements) {
            let isUnlocked = false;
            let unlockTime: number | undefined;
            if (entry.stat_id != null && entry.bit != null) {
              // Bitmask is authoritative — Steam clears bits when resetting achievements
              const statValue = statsMap.get(entry.stat_id) ?? 0;
              const bitSet = ((statValue >>> entry.bit) & 1) === 1;
              if (bitSet) {
                isUnlocked = true;
                // Timestamp is supplementary (provides unlock time, not unlock status)
                const ts = timestampMap.get(`${entry.stat_id}:${entry.bit}`);
                if (ts) unlockTime = ts * 1000;
              }
            }
            if (isUnlocked) unlocked++;
            achievements.push({
              id: entry.api_name,
              apiName: entry.api_name,
              name: entry.name ?? entry.api_name,
              description: entry.description,
              iconUrl: entry.icon,
              iconGrayUrl: entry.icon_gray,
              unlocked: isUnlocked,
              unlockTime,
              rarityPercent: globalPctMap[entry.api_name] ?? undefined,
              statId: entry.stat_id,
              bit: entry.bit,
            });
          }

          const total = achievements.length;
          localProgressSummary = {
            appId: appIdStr,
            achievements,
            total,
            unlocked,
            percent: total > 0 ? Math.round((unlocked / total) * 100) : 0,
            progressAvailable: true,
            source: "binary-stats",
            updatedAt: Date.now(),
          };
          console.log(`[ACH][PROGRESS_SOURCE] appid=${appIdStr} source=binary-stats(direct) unlocked=${unlocked}/${total}`);
        } else {
          // No schema yet (first boot) — build minimal achievements from bitmask only
          // Names/icons will be enriched by librarycache fallback or next schema generation
          console.log(`[ACH][PROGRESS] App ${appIdStr}: binary-stats .bin has data but no schema — building minimal list from bitmask`);
        }
      } else {
        console.log(`[ACH][PROGRESS] App ${appIdStr}: binary-stats .bin not found or empty`);
      }
    } catch (err) {
      console.debug(`[ACH][PROGRESS] App ${appIdStr}: binary-stats direct read failed:`, err);
    }
  }

  // 3. Librarycache — REMOVED: reference implementation does not use librarycache/*.json
  // for achievement data. librarycache/ is only used for cover images (header.jpg, etc.)
  // Achievement data comes exclusively from KV binary (UserGameStatsSchema_*.bin + UserGameStats_*.bin)
  // If binary stats are unavailable, fall through to achievementStore cache.

  // 4. Binary stats — FALLBACK only when librarycache didn't provide data
  // But first check if the achievementStore has better data (from previous read)
  if (!localProgressSummary) {
    const cached = achievementStore.getSummary(appIdStr, readPlatform);
    if (cached && (cached.unlocked ?? 0) > 0 && cached.progressAvailable
        && !(readPlatform === "steam-official" && cached.source === "crack")) {
      localProgressSummary = cached;
      console.log(`[ACH][PROGRESS] App ${appIdStr}: using cached summary ${cached.unlocked}/${cached.total} source=${cached.source}`);
    }
  }

  // 3c. Crack achievements (GSE/RUNE/OnlineFix/Goldberg)
  // Always try crack reader when we have a save path with real achievement data
  if (readPlatform === "steam" && readSavePath) {
    console.log(`[ACH][CRACK_READ] appid=${appIdStr} platform=${readPlatform} savePath=${readSavePath}`);
    try {
      const { readCrackAchievements } = await import("./crackAchievementReader");
      const crackData = await readCrackAchievements(readSavePath, appIdStr);
      if (crackData && crackData.achievements.length > 0) {
        console.log(`[ACH][CRACK_READ] appid=${appIdStr} found ${crackData.achievements.length} achievements, ${crackData.unlocked}/${crackData.total} unlocked, schemaMap.size=${schemaMap.size}`);
        // Enrich crack achievements with schema metadata (names, descriptions, icons)
        // Use normalized matching for Tenoke/OnlineFix name mismatches
        const enrichNormalize = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, "");
        const schemaNormalizedMap = new Map<string, SchemaAchievement>();
        for (const [key, val] of schemaMap.entries()) {
          schemaNormalizedMap.set(enrichNormalize(key), val);
        }
        let enrichedCount = 0;
        for (const ach of crackData.achievements) {
          const schema = schemaMap.get(ach.apiName) ?? schemaNormalizedMap.get(enrichNormalize(ach.apiName));
          if (schema) {
            ach.name = schema.displayName || ach.name;
            ach.description = schema.description || ach.description;
            ach.iconUrl = schema.icon || ach.iconUrl;
            ach.iconGrayUrl = schema.icongray || ach.iconGrayUrl;
            enrichedCount++;
          }
        }
        console.log(`[ACH][CRACK_READ] appid=${appIdStr} enriched ${enrichedCount}/${crackData.achievements.length} with schema data`);

        // CRITICAL: RUNE/CODEX/OnlineFix INI formats only list UNLOCKED achievements.
        // When schemaMap has MORE entries than the crack data, the crack total is wrong
        // (e.g. 5 unlocked out of 50 total → crack reports 5/5 = 100% instead of 5/50 = 10%).
        // Rebuild the full achievement list from schemaMap, overlaying crack unlock status.
        if (schemaMap.size > crackData.achievements.length) {
          const crackUnlockMap = new Map(crackData.achievements.map(a => [a.apiName, { unlocked: a.unlocked, unlockTime: a.unlockTime }]));
          // Normalized lookup: lowercase + strip underscores/dashes/spaces for Tenoke/OnlineFix name mismatches
          const normalizeKey = (s: string) => s.toLowerCase().replace(/[_\-\s]/g, "");
          const crackNormalizedMap = new Map<string, string>();
          for (const name of crackUnlockMap.keys()) {
            crackNormalizedMap.set(normalizeKey(name), name);
          }
          const fullAchievements: GameAchievement[] = [];
          let normalizedMatches = 0;
          for (const [apiName, schema] of schemaMap.entries()) {
            // Try exact match first, then normalized match
            let crackState = crackUnlockMap.get(apiName);
            if (!crackState) {
              const normalizedKey = crackNormalizedMap.get(normalizeKey(apiName));
              if (normalizedKey) {
                crackState = crackUnlockMap.get(normalizedKey);
                if (crackState) normalizedMatches++;
              }
            }
            fullAchievements.push({
              id: apiName,
              apiName,
              name: schema.displayName || apiName,
              description: schema.description,
              iconUrl: schema.icon,
              iconGrayUrl: schema.icongray,
              unlocked: crackState?.unlocked ?? false,
              unlockTime: crackState?.unlockTime,
              rarityPercent: globalPctMap[apiName] ?? undefined,
            });
          }
          const oldCount = crackData.achievements.length;
          crackData.achievements = fullAchievements;
          crackData.total = schemaMap.size;
          crackData.unlocked = fullAchievements.filter(a => a.unlocked).length;
          console.log(`[ACH][CRACK_READ] appid=${appIdStr} REBUILT from schema: total=${crackData.total} unlocked=${crackData.unlocked} exact=${crackUnlockMap.size} normalized=${normalizedMatches} (crack had ${oldCount} entries, schemaMap.size=${schemaMap.size})`);
        }

        // Crack reader found real data — force platform to "steam"
        readPlatform = "steam";
        // Enrich crack achievements with rarity from globalPctMap (fetched at line ~989)
        for (const ach of crackData.achievements) {
          if (ach.rarityPercent == null && globalPctMap[ach.apiName] != null) {
            ach.rarityPercent = globalPctMap[ach.apiName];
          }
        }
        localProgressSummary = {
          appId: appIdStr,
          achievements: crackData.achievements,
          total: crackData.total,
          unlocked: crackData.unlocked,
          percent: crackData.total > 0 ? Math.round((crackData.unlocked / crackData.total) * 100) : 0,
          progressAvailable: true,
          source: "crack" as GameAchievementsSummary["source"],
          updatedAt: Date.now(),
        };
        console.log(`[ACH][PROGRESS_SOURCE] appid=${appIdStr} source=crack-${crackData.source} unlocked=${crackData.unlocked}/${crackData.total}`);
      } else {
        console.log(`[ACH][CRACK_READ] appid=${appIdStr} crackData=${crackData ? `null or empty (achievements.length=${crackData?.achievements?.length ?? 0})` : "null"}`);
      }
    } catch (err) {
      console.warn(`[ACH][PROGRESS] App ${appIdStr}: crack achievement read failed (non-critical):`, err);
    }
  } else {
    console.log(`[ACH][CRACK_READ] appid=${appIdStr} skipped — platform=${readPlatform} savePath=${readSavePath ?? "null"}`);
  }

  // 3d. Epic Official player achievements — fetch from Epic GraphQL API
  if (!localProgressSummary && readPlatform === "epic-official") {
    console.log(`[ACH][EPIC_READ] appid=${appIdStr} Epic Official, fetching player achievements from Epic API`);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Get Epic account ID from config or token
      let epicAccountId = "";
      try {
        const accountInfo = await invoke<{ id: string; display_name: string }>("epic_get_account_info");
        epicAccountId = accountInfo.id;
        console.log(`[ACH][EPIC_READ] appid=${appIdStr} epic_get_account_info OK id=${epicAccountId.slice(0,8)}... display=${accountInfo.display_name}`);
      } catch (err) {
        console.warn(`[ACH][EPIC_READ] appid=${appIdStr} epic_get_account_info FAILED:`, err);
      }

      if (epicAccountId) {
        // Helper to fetch player progress for a given productId
        const fetchProgress = async (pid: string) => {
          console.log(`[ACH][EPIC_READ] appid=${appIdStr} fetching player progress productId=${pid} epicAccountId=${epicAccountId.slice(0,8)}...`);
          return invoke<Array<{
            achievement_name: string;
            unlocked: boolean;
            unlock_date: string | null;
            xp: number | null;
          }>>("epic_fetch_player_achievements", {
            productId: pid,
            epicAccountId,
          });
        };

        // Try all possible IDs: namespace, discovered product_id, and appIdStr (appName/catalogItemId)
        // The GraphQL productAchievements query may need a specific ID format
        const idsToTry = [
          params.epicNamespace ?? "",
          epicProductId,
          appIdStr,
        ].filter(id => id.length > 0);
        const uniqueIds = [...new Set(idsToTry)];
        console.log(`[ACH][EPIC_READ] appid=${appIdStr} trying ${uniqueIds.length} product IDs: ${uniqueIds.join(", ")}`);
        let epicProgress: Array<{ achievement_name: string; unlocked: boolean; unlock_date: string | null; xp: number | null }> = [];

        for (const tryId of uniqueIds) {
          try {
            epicProgress = await fetchProgress(tryId);
            if (epicProgress.length > 0) {
              console.log(`[ACH][EPIC_READ] appid=${appIdStr} got ${epicProgress.length} player achievements with productId=${tryId}`);
              break;
            }
            console.log(`[ACH][EPIC_READ] appid=${appIdStr} 0 achievements with productId=${tryId}, trying next...`);
          } catch (progressErr) {
            console.warn(`[ACH][EPIC_READ] appid=${appIdStr} player progress failed with productId=${tryId}:`, progressErr);
          }
        }

        if (epicProgress && epicProgress.length > 0) {
          // Build achievements list from schema + player progress
          const achievements: GameAchievement[] = [];
          let unlocked = 0;

          for (const [apiName, schema] of schemaMap.entries()) {
            const playerAch = epicProgress.find(p => p.achievement_name === apiName);
            const isUnlocked = playerAch?.unlocked ?? false;
            if (isUnlocked) unlocked++;

            achievements.push({
              id: apiName,
              apiName,
              name: schema.displayName || apiName,
              description: schema.description,
              iconUrl: schema.icon,
              iconGrayUrl: schema.icongray,
              unlocked: isUnlocked,
              unlockTime: playerAch?.unlock_date ? new Date(playerAch.unlock_date).getTime() : undefined,
            });
          }

          const total = schemaMap.size;
          localProgressSummary = {
            appId: appIdStr,
            achievements,
            total,
            unlocked,
            percent: total > 0 ? Math.round((unlocked / total) * 100) : 0,
            progressAvailable: true,
            source: "epic-official" as GameAchievementsSummary["source"],
            updatedAt: Date.now(),
          };
          console.log(`[ACH][PROGRESS_SOURCE] appid=${appIdStr} source=epic-official unlocked=${unlocked}/${total}`);
        } else {
          console.log(`[ACH][EPIC_READ] appid=${appIdStr} Epic API returned no player achievements (progress len=${epicProgress?.length ?? 0})`);
        }
      } else {
        console.warn(`[ACH][EPIC_READ] appid=${appIdStr} no Epic account ID available — user may not be logged in via Epic settings`);
      }
    } catch (err) {
      console.warn(`[ACH][EPIC_READ] appid=${appIdStr} Epic player achievements failed:`, err);
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
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=${summary.source} reason=local-progress unlocked=${summary.unlocked}/${summary.total}`);
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
    const schemaProgressAvailable = generatedCache?.summary?.progress_available ?? false;
    summary = buildSchemaOnlySummary(appIdStr, schemaMap, globalPctMap, schemaProgressAvailable, errorReason);
    console.log(`[ACH][PROGRESS_DECISION] appid=${appIdStr} selected=schema-only reason=no-progress-sources unlocked=0/${summary.total} progressAvailable=${schemaProgressAvailable}`);
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
  // EXCEPTION: crack-sourced data (crack-stale, crack-tenoke-user-stats, etc.) is NOT
  // preserved — if the crack file is gone/empty, stale progress must be cleared.
  const existingStore = achievementStore.getSummary(appIdStr, params.platform);
  if (existingStore?.progressAvailable && !summary.progressAvailable && !params.forceRefresh
      && !existingStore.source?.startsWith("crack")) {
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
  if (DEBUG_ACH_DIAG) {
    console.log(`[ACH][DIAG] appid=${appIdStr} writeCheck achievementsLength=${summary.achievements.length} willWrite=${summary.achievements.length > 0}`);
  }
  if (summary.achievements.length > 0) {
    // Protect against overwriting cache with no-progress result when valid progress exists
    // Covers: schema-only, appcache-unparseable, any source with progressAvailable=false
    // SKIP when forceRefresh=true — manual refresh should NOT preserve stale progress
    // EXCEPTION: crack-sourced data — if the crack file is gone/empty, stale progress must be cleared
    if (!summary.progressAvailable && !params.forceRefresh) {
      try {
        const existing = await readAchievementCache(appIdNum, readPlatform);
        if (existing?.summary?.progress_available === true
            && !(existing.summary.source ?? "").startsWith("crack")) {
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
      }, _migrateIcons, readPlatform);
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

  // Image download — fire-and-forget, does NOT block refresh
  // Always trigger icon downloads when the resolver has achievements with icon URLs,
  // not just on Manual Refresh. This ensures icons are created on first boot too.
  if (summary.achievements.length > 0) {
    // Fire background download — NOT awaited, refresh continues immediately
    downloadAchievementIconsInBackground(appIdStr, appIdNum, summary.achievements, readPlatform);
    console.log(`[ACH][IMG_REPAIR_NON_BLOCKING] appid=${appIdStr} source=${summary.source} icons=${summary.achievements.filter(a => a.iconUrl).length}/${summary.achievements.length} refreshContinued=true`);
  }

  // Check store freshness before returning — prefer newer data from watcher/auto-sync
  // BUT: when user explicitly chose a platform, never override with cross-platform stale data
  const stored = achievementStore.getSummary(appIdStr, params.platform);
  if (stored) {
    const crossPlatformConflict = params.platform === "steam-official" && stored.source === "crack";
    if (crossPlatformConflict) {
      console.log(`[ACH][SUMMARY_SOURCE] appid=${appIdStr} SKIP store freshness — user chose steam-official but store has crack data, not overriding`);
    } else {
      const accept = isSourceNewerOrEqual(summary.source, summary.updatedAt, stored.source, stored.updatedAt);
      if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_SOURCE] appid=${appIdStr} source=${summary.source} unlocked=${summary.unlocked}/${summary.total} updatedAt=${summary.updatedAt} progressAvailable=${summary.progressAvailable} accepted=${accept} existingSource=${stored.source} existingUnlocked=${stored.unlocked}/${stored.total}`);
      if (!accept) {
        if (DEBUG_ACH_VERBOSE) console.log(`[ACH][SUMMARY_MERGE] appid=${appIdStr} accepted=false reason=store-has-newer returning store summary`);
        return stored;
      }
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