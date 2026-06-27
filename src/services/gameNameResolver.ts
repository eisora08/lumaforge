import { resolveSteamAppNames } from "./tauri";

const CACHE_KEY = "lumaforge-game-name-cache";

type GameNameCache = Record<string, string>;

function loadCache(): GameNameCache {
  try {
    const rawCache = localStorage.getItem(CACHE_KEY);

    if (!rawCache) {
      return {};
    }

    return JSON.parse(rawCache) as GameNameCache;
  } catch {
    return {};
  }
}

function saveCache(cache: GameNameCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export async function resolveGameNames(
  appIds: number[]
): Promise<Record<number, string>> {
  const uniqueAppIds = Array.from(new Set(appIds));
  const cache = loadCache();

  const missingAppIds = uniqueAppIds.filter(
    (appId) => !cache[String(appId)]
  );

  if (missingAppIds.length > 0) {
    const resolvedNames = await resolveSteamAppNames(missingAppIds);

    resolvedNames.forEach((item) => {
      cache[String(item.app_id)] = item.name;
    });

    saveCache(cache);
  }

  return uniqueAppIds.reduce<Record<number, string>>((result, appId) => {
    result[appId] = cache[String(appId)] || `Steam App ${appId}`;
    return result;
  }, {});
}

export function clearGameNameCache() {
  localStorage.removeItem(CACHE_KEY);
}