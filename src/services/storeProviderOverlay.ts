import type { PackageGame } from "../types/package";
import type { AppSettings } from "../types/settings";

import {
  getEnabledProviderIds,
  searchPackagesByProviders,
} from "./providerSearch";

const CACHE_KEY = "lumaforge-store-provider-overlay-cache-v2";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

const MAX_OVERLAY_CHECKS = 24;
const OVERLAY_CONCURRENCY = 3;
const OVERLAY_TIMEOUT_MS = 12000;

type OverlayWorkerResult = {
  appId: string;
  game: PackageGame;
  cacheable: boolean;
};

const inflightProviderChecks = new Map<string, Promise<OverlayWorkerResult>>();

type OverlayCacheItem = {
  savedAt: number;
  game: PackageGame;
};

type OverlayCache = Record<string, OverlayCacheItem>;

function getProviderSignature(enabledProviderIds: string[]) {
  return enabledProviderIds.slice().sort().join(",");
}

function getCacheKey(appId: string, enabledProviderIds: string[]) {
  return `${appId}::${getProviderSignature(enabledProviderIds)}`;
}

function loadCache(): OverlayCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);

    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as OverlayCache;
  } catch {
    return {};
  }
}

function saveCache(cache: OverlayCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function isCacheValid(item?: OverlayCacheItem) {
  if (!item) {
    return false;
  }

  return Date.now() - item.savedAt < CACHE_TTL_MS;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const output: R[] = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;

      output[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker()
  );

  await Promise.all(workers);

  return output;
}

function mergeSteamGameWithProviderGame(
  steamGame: PackageGame,
  providerGame: PackageGame
): PackageGame {
  return {
    ...steamGame,

    title: steamGame.title || providerGame.title,
    developer: steamGame.developer || providerGame.developer,
    imageUrl: steamGame.imageUrl || providerGame.imageUrl,

    platforms:
      steamGame.platforms.length > 0
        ? steamGame.platforms
        : providerGame.platforms,

    sources: providerGame.sources,
  };
}

function createNoSourceGame(game: PackageGame): PackageGame {
  return {
    ...game,
    sources: [],
  };
}

export async function resolveProviderOverlaysForStoreGames(
  games: PackageGame[],
  settings: AppSettings
): Promise<Record<string, PackageGame>> {
  const enabledProviderIds = getEnabledProviderIds(settings);
  const output: Record<string, PackageGame> = {};

  if (enabledProviderIds.length === 0 || games.length === 0) {
    return output;
  }

  const cache = loadCache();

  const uniqueGames = Array.from(
    new Map(games.map((game) => [game.appId, game])).values()
  );

  const candidates = uniqueGames
    .filter((game) => game.sources.length === 0)
    .slice(0, MAX_OVERLAY_CHECKS);

  const gamesToCheck: PackageGame[] = [];

  for (const game of candidates) {
    const cacheKey = getCacheKey(game.appId, enabledProviderIds);
    const cached = cache[cacheKey];

    if (isCacheValid(cached)) {
      output[game.appId] = cached.game;
      continue;
    }

    gamesToCheck.push(game);
  }

  if (gamesToCheck.length === 0) {
    return output;
  }

  const resolvedGames = await runWithConcurrency(
    gamesToCheck,
    OVERLAY_CONCURRENCY,
    async (game) => {
      const existing = inflightProviderChecks.get(game.appId);
      if (existing) return existing;

      const promise = (async (): Promise<OverlayWorkerResult> => {
        try {
          const response = await withTimeout(
            searchPackagesByProviders(
              {
                query: game.appId,
                provider: "all",
                enabledProviderIds,
              },
              settings
            ),
            OVERLAY_TIMEOUT_MS,
            `Timeout revisando providers para AppID ${game.appId}.`
          );

          const providerGame = response.results.find(
            (item) => item.appId === game.appId
          );

          if (!providerGame) {
            const noSourceGame = createNoSourceGame(game);

            return {
              appId: game.appId,
              game: noSourceGame,
              cacheable: true,
            };
          }

          return {
            appId: game.appId,
            game: mergeSteamGameWithProviderGame(game, providerGame),
            cacheable: true,
          };
        } catch (error) {
          console.error(error);

          return {
            appId: game.appId,
            game: createNoSourceGame(game),
            cacheable: false,
          };
        }
      })();

      inflightProviderChecks.set(game.appId, promise);
      promise.finally(() => inflightProviderChecks.delete(game.appId));
      return promise;
    }
  );

  resolvedGames.forEach((resolved) => {
    output[resolved.appId] = resolved.game;

    if (resolved.cacheable) {
      const cacheKey = getCacheKey(resolved.appId, enabledProviderIds);

      cache[cacheKey] = {
        savedAt: Date.now(),
        game: resolved.game,
      };
    }
  });

  saveCache(cache);

  return output;
}

export function loadStoreProviderOverlayCache(): OverlayCache {
  return loadCache();
}

export function clearStoreProviderOverlayCache() {
  localStorage.removeItem(CACHE_KEY);
}