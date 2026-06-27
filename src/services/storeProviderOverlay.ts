import type { PackageGame } from "../types/package";
import type { AppSettings } from "../types/settings";

import {
  getEnabledProviderIds,
  searchPackagesByProviders,
} from "./providerSearch";

const CACHE_KEY = "lumaforge-store-provider-overlay-cache";
const CACHE_TTL_MS = 1000 * 60 * 30;
const MAX_OVERLAY_CHECKS = 40;

type OverlayCacheItem = {
  savedAt: number;
  game: PackageGame;
};

type OverlayCache = Record<string, OverlayCacheItem>;

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

export async function resolveProviderOverlaysForStoreGames(
  games: PackageGame[],
  settings: AppSettings
): Promise<Record<string, PackageGame>> {
  const enabledProviderIds = getEnabledProviderIds(settings);
  const cache = loadCache();
  const output: Record<string, PackageGame> = {};

  const uniqueGames = Array.from(
    new Map(games.map((game) => [game.appId, game])).values()
  );

  const gamesToCheck = uniqueGames
    .filter((game) => game.sources.length === 0)
    .slice(0, MAX_OVERLAY_CHECKS);

  for (const game of gamesToCheck) {
    const cached = cache[game.appId];

    if (isCacheValid(cached)) {
      output[game.appId] = cached.game;
      continue;
    }

    try {
      const response = await searchPackagesByProviders(
        {
          query: game.appId,
          provider: "all",
          enabledProviderIds,
        },
        settings
      );

      const providerGame = response.results.find(
        (item) => item.appId === game.appId
      );

      if (!providerGame) {
        const noSourceGame: PackageGame = {
          ...game,
          sources: [],
        };

        cache[game.appId] = {
          savedAt: Date.now(),
          game: noSourceGame,
        };

        output[game.appId] = noSourceGame;
        continue;
      }

      const mergedGame = mergeSteamGameWithProviderGame(game, providerGame);

      cache[game.appId] = {
        savedAt: Date.now(),
        game: mergedGame,
      };

      output[game.appId] = mergedGame;
    } catch (error) {
      console.error(error);

      const failedGame: PackageGame = {
        ...game,
        sources: [],
      };

      output[game.appId] = failedGame;
    }
  }

  saveCache(cache);

  return output;
}

export function clearStoreProviderOverlayCache() {
  localStorage.removeItem(CACHE_KEY);
}