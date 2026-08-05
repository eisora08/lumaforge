/**
 * Non-Steam Achievement Service
 *
 * Detects and loads achievements for non-Steam games (Goldberg, CODEX/RUNE, OnlineFix).
 * Converts Rust detection results to the existing GameAchievement/GameAchievementsSummary types.
 */

import {
  readNonSteamConfigs,
  saveNonSteamConfig,
  deleteNonSteamConfig,
  detectNonSteamAchievements,
  readNonSteamAchievements,
  generateAchievementSchema,
  fetchSteamAchievementSchema,
  readNonSteamAchievementPercentages,
  type NonSteamAchievementConfig,
  type NonSteamDetectionResult,
  type NonSteamAchievement,
} from "./tauri";
import { localPathToUrl } from "./gameCacheService";
import type {
  GameAchievement,
  GameAchievementsSummary,
} from "../types/gameAchievements";

// ---------------------------------------------------------------------------
// Source mapping
// ---------------------------------------------------------------------------

const SOURCE_MAP: Record<string, GameAchievementsSummary["source"]> = {
  goldberg: "non-steam-goldberg",
  codex: "non-steam-codex",
  onlinefix: "non-steam-onlinefix",
  "generated-schema": "non-steam-generated",
};

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

let _configsCache: NonSteamAchievementConfig[] | null = null;
let _configsLoadTime = 0;
const CONFIGS_TTL_MS = 30_000;

async function loadConfigs(): Promise<NonSteamAchievementConfig[]> {
  const now = Date.now();
  if (_configsCache && now - _configsLoadTime < CONFIGS_TTL_MS) {
    return _configsCache;
  }
  try {
    _configsCache = await readNonSteamConfigs();
    _configsLoadTime = now;
    return _configsCache;
  } catch (e) {
    console.error("[NON_STEAM_ACH][CONFIG_LOAD_ERROR]", e);
    return [];
  }
}

function invalidateConfigsCache(): void {
  _configsCache = null;
  _configsLoadTime = 0;
}

/** Get the saved config for a specific appId. */
export async function getConfig(appId: number): Promise<NonSteamAchievementConfig | null> {
  const configs = await loadConfigs();
  return configs.find((c) => c.appId === appId) ?? null;
}

/** Save a config entry (upsert by appId). */
export async function saveConfig(config: NonSteamAchievementConfig): Promise<void> {
  await saveNonSteamConfig({
    ...config,
    updatedAt: Math.floor(Date.now() / 1000),
  });
  invalidateConfigsCache();
}

/** Delete a config entry by appId. */
export async function removeConfig(appId: number): Promise<void> {
  await deleteNonSteamConfig(appId);
  invalidateConfigsCache();
}

/** Get all saved configs. */
export async function getAllConfigs(): Promise<NonSteamAchievementConfig[]> {
  return loadConfigs();
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a game directory contains non-Steam achievement data.
 * Returns detection result with source type and achievement count.
 */
export async function detect(
  gameDir: string,
  appId?: number
): Promise<NonSteamDetectionResult> {
  return detectNonSteamAchievements(gameDir, appId);
}

// ---------------------------------------------------------------------------
// Auto-generate schema from Steam API
// ---------------------------------------------------------------------------

/**
 * Try to auto-generate achievement schema from Steam API for a game with a valid appId.
 * Fetches schema JSON from Steam, writes binary VDF files + downloads icons.
 * Returns true if generation succeeded.
 */
export async function autoGenerateSchema(
  appId: number,
  accountId?: string,
  gameDir?: string,
  gameName?: string,
  savePath?: string,
  platform?: string,
): Promise<boolean> {
  try {
    const { loadSettings } = await import("../context/SettingsContext");
    const settings = await loadSettings();
    const apiKey = settings.steamWebApiKey?.trim();
    if (!apiKey) {
      console.log(`[NON_STEAM_ACH][AUTO_GEN_SKIP] appid=${appId} reason=no-api-key`);
      return false;
    }

    // Fetch schema JSON from Steam API via Rust reqwest (no CORS)
    const schemaResponse = await fetchSteamAchievementSchema({ appId, apiKey });
    const data = schemaResponse as any;
    const game = data?.game;
    if (!game || !game.availableGameStats) {
      console.log(`[NON_STEAM_ACH][AUTO_GEN_SKIP] appid=${appId} reason=no-schema-in-response`);
      return false;
    }

    // Parse accountId to number if provided
    const accountIdNum = accountId ? parseInt(accountId, 10) : undefined;

    // Extract achievements array from the Steam API response
    const achievements = game.availableGameStats?.achievements;
    if (!Array.isArray(achievements) || achievements.length === 0) {
      console.log(`[NON_STEAM_ACH][AUTO_GEN_SKIP] appid=${appId} reason=no-achievements-in-schema`);
      return false;
    }
    const result = await generateAchievementSchema(appId, JSON.stringify(achievements), accountIdNum, gameDir, gameName, savePath, platform);
    console.log(`[NON_STEAM_ACH][AUTO_GEN_OK] appid=${appId} result=${result}`);
    return true;
  } catch (e) {
    console.warn(`[NON_STEAM_ACH][AUTO_GEN_ERROR] appid=${appId}`, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Achievement loading
// ---------------------------------------------------------------------------

/**
 * Convert a raw icon path from Rust to a renderable URL.
 * - Absolute Windows/Linux paths (from generated-schema) → asset:// via localPathToUrl
 * - HTTP URLs, relative img/..., or hash-only filenames → pass through
 */
function resolveIconUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("/")) {
    return localPathToUrl(raw) ?? raw;
  }
  return raw;
}

/** Convert raw Rust achievements to the existing GameAchievement type. */
function toGameAchievements(
  raw: NonSteamAchievement[],
  pctMap?: Map<string, number>,
): GameAchievement[] {
  return raw.map((a, i) => ({
    id: a.apiName || String(i),
    apiName: a.apiName,
    name: a.displayName || a.apiName,
    description: a.description || "",
    iconUrl: resolveIconUrl(a.icon),
    iconGrayUrl: resolveIconUrl(a.iconGray),
    unlocked: a.unlocked,
    unlockTime: a.unlockTime || undefined,
    rarityPercent: pctMap?.get(a.apiName) ?? undefined,
    statId: undefined,
    bit: undefined,
  }));
}

/**
 * Load achievements for a game from a specific source.
 * Returns a full GameAchievementsSummary ready for the achievement store.
 */
export async function loadAchievements(
  appId: number,
  gameDir: string,
  source: string
): Promise<GameAchievementsSummary | null> {
  try {
    const raw = await readNonSteamAchievements(gameDir, appId, source);
    if (!raw || raw.length === 0) return null;

    // Load achievementpercentages.json (written during schema generation)
    let pctMap: Map<string, number> | undefined;
    try {
      const pctList = await readNonSteamAchievementPercentages(appId);
      if (pctList.length > 0) {
        pctMap = new Map(pctList.map((e) => [e.name, e.percent]));
      }
    } catch {
      // percentages file may not exist for all sources
    }

    const achievements = toGameAchievements(raw, pctMap);
    const unlocked = achievements.filter((a) => a.unlocked).length;

    return {
      appId: String(appId),
      total: achievements.length,
      unlocked,
      percent: achievements.length > 0 ? Math.round((unlocked / achievements.length) * 100) : 0,
      progressAvailable: true,
      achievements,
      source: SOURCE_MAP[source] || "schema-only",
      updatedAt: Date.now(),
    };
  } catch (e) {
    console.error(`[NON_STEAM_ACH][LOAD_ERROR] appid=${appId} source=${source}`, e);
    return null;
  }
}

/**
 * Auto-detect and load achievements in one call.
 * Tries Goldberg → CODEX → OnlineFix in order.
 * Returns the first successful result.
 */
export async function detectAndLoad(
  appId: number,
  gameDir: string
): Promise<{
  summary: GameAchievementsSummary | null;
  detection: NonSteamDetectionResult;
  config: NonSteamAchievementConfig | null;
}> {
  const detection = await detect(gameDir, appId);
  const config = await getConfig(appId);

  if (!detection.hasAchievements || !detection.source) {
    return { summary: null, detection, config };
  }

  const summary = await loadAchievements(appId, gameDir, detection.source);
  return { summary, detection, config };
}

// ---------------------------------------------------------------------------
// Refresh (re-detect + re-load, updates store)
// ---------------------------------------------------------------------------

/**
 * Re-detect achievements for a game and return updated summary.
 * Used when user manually triggers a refresh for a non-Steam game.
 */
export async function refreshAchievements(
  appId: number,
  gameDir: string
): Promise<GameAchievementsSummary | null> {
  const detection = await detect(gameDir, appId);
  if (!detection.hasAchievements || !detection.source) return null;
  return loadAchievements(appId, gameDir, detection.source);
}

// ---------------------------------------------------------------------------
// Detect + store in one call (used by boot + GameDetails auto-load)
// ---------------------------------------------------------------------------

/**
 * Detect non-Steam achievements, persist to achievementStore, and save config.
 * Returns the summary if any achievements were found.
 * DO NOT call for Steam games (source === "steam") -- use resolveSteamAchievements instead.
 * The auto-generate fallback (appId > 0) will incorrectly create a fake generated-schema
 * entry for real Steam games, overwriting their native achievement data.
 */
export async function detectAndLoadAndStore(
  appId: number,
  gameDir: string
): Promise<GameAchievementsSummary | null> {
  try {
    const { summary, detection } = await detectAndLoad(appId, gameDir);
    if (summary && detection.hasAchievements && detection.source) {
      // Persist to achievement store
      const { achievementStore } = await import("./achievementStore");
      const existing = achievementStore.getSummary(String(appId));
      if (existing) {
        // Don't overwrite higher-priority sources
        const { isSourceNewerOrEqual } = await import("./achievementStore");
        if (!isSourceNewerOrEqual(summary.source, summary.updatedAt, existing.source, existing.updatedAt)) {
          return summary;
        }
      }
      achievementStore.setSummary(String(appId), summary);

      // Persist detection source as a config entry for boot-time re-load
      await saveConfig({
        appId,
        name: gameDir.split(/[/\\]/).filter(Boolean).pop() || `Game ${appId}`,
        gameDir,
        source: detection.source,
        enabled: true,
      }).catch(() => {});

      console.log(`[NON_STEAM_ACH][STORE] appid=${appId} source=${detection.source} total=${summary.total} unlocked=${summary.unlocked}`);
      return summary;
    }

    // No Goldberg/CODEX/OnlineFix data found — try auto-generate from Steam API
    // Skip if a higher-priority source (e.g. "steam") already exists in the store
    if (appId > 0) {
      const { achievementStore } = await import("./achievementStore");
      const existingSteam = achievementStore.getSummary(String(appId));
      if (existingSteam) {
        console.log(`[NON_STEAM_ACH][AUTO_GEN_SKIP] appid=${appId} reason=summary-exists source=${existingSteam.source}`);
        return null;
      }
      const generated = await autoGenerateSchema(appId, undefined, gameDir);
      if (generated) {
        // Re-read with generated-schema source
        const generatedSummary = await loadAchievements(appId, gameDir, "generated-schema");
        if (generatedSummary) {
          achievementStore.setSummary(String(appId), generatedSummary);

          // NOTE: intentionally do NOT call saveConfig() here for auto-generated schemas.
          // Saving a generated-schema config would persist this entry to boot-time reload,
          // causing Steam games to get fake non-Steam achievement data on every launch.

          console.log(`[NON_STEAM_ACH][STORE] appid=${appId} source=generated-schema total=${generatedSummary.total} unlocked=${generatedSummary.unlocked}`);
          return generatedSummary;
        }
      }
    }

    return null;
  } catch (e) {
    console.warn(`[NON_STEAM_ACH][STORE_ERROR] appid=${appId}`, e);
    return null;
  }
}

/**
 * Batch-load achievements for all saved non-Steam configs.
 * Used by boot to populate achievementStore before UI renders.
 */
export async function loadAllSavedConfigs(): Promise<{
  loaded: number;
  total: number;
}> {
  try {
    const configs = await getAllConfigs();
    const enabled = configs.filter((c) => c.enabled !== false);
    if (enabled.length === 0) return { loaded: 0, total: 0 };

    let loaded = 0;
    const results = await Promise.allSettled(
      enabled.map((c) => detectAndLoadAndStore(c.appId, c.gameDir))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) loaded++;
    }
    console.log(`[NON_STEAM_ACH][BOOT_LOAD] loaded=${loaded}/${enabled.length} configs`);
    return { loaded, total: enabled.length };
  } catch (e) {
    console.warn("[NON_STEAM_ACH][BOOT_LOAD_ERROR]", e);
    return { loaded: 0, total: 0 };
  }
}
