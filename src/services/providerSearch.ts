import { mockPackages } from "../data/mockPackages";
import { defaultApiProviders } from "../data/providers";
import { AppSettings } from "../types/settings";
import { ApiProviderId } from "../types/provider";
import {
  ProviderSearchParams,
  ProviderSearchResult,
} from "../types/providerSearch";
import { PackageGame, PackageSource } from "../types/package";

export function getEnabledProviderIds(settings: AppSettings): ApiProviderId[] {
  return defaultApiProviders
    .filter((provider) => {
      const userSettings = settings.providers[provider.id];

      if (!userSettings) {
        return provider.enabledByDefault;
      }

      return userSettings.enabled;
    })
    .map((provider) => provider.id);
}

export async function searchPackagesByProviders(
  params: ProviderSearchParams
): Promise<ProviderSearchResult> {
  const normalizedQuery = params.query.trim().toLowerCase();

  const searchedProviders =
    params.provider === "all"
      ? params.enabledProviderIds
      : params.enabledProviderIds.includes(params.provider)
        ? [params.provider]
        : [];

  const results = mockPackages
    .map((game) => filterGameSources(game, searchedProviders))
    .filter((game): game is PackageGame => Boolean(game))
    .filter((game) => matchesQuery(game, normalizedQuery))
    .map((game) => hydrateDownloadUrls(game));

  return {
    query: params.query,
    provider: params.provider,
    searchedProviders,
    results,
    totalResults: results.length,
  };
}

function filterGameSources(
  game: PackageGame,
  providerIds: ApiProviderId[]
): PackageGame | null {
  const sources = game.sources.filter((source) =>
    providerIds.includes(source.providerId)
  );

  if (sources.length === 0) {
    return null;
  }

  return {
    ...game,
    sources,
  };
}

function matchesQuery(game: PackageGame, query: string) {
  if (!query) {
    return true;
  }

  return (
    game.title.toLowerCase().includes(query) ||
    game.appId.includes(query) ||
    game.developer?.toLowerCase().includes(query) ||
    game.sources.some((source) =>
      source.providerName.toLowerCase().includes(query)
    )
  );
}

function hydrateDownloadUrls(game: PackageGame): PackageGame {
  return {
    ...game,
    sources: game.sources.map((source) => ({
      ...source,
      downloadUrl:
        source.downloadUrl ?? buildProviderDownloadUrl(source, game.appId),
    })),
  };
}

function buildProviderDownloadUrl(
  source: PackageSource,
  appId: string
): string | undefined {
  const provider = defaultApiProviders.find(
    (item) => item.id === source.providerId
  );

  if (!provider) {
    return undefined;
  }

  return provider.urlTemplate
    .replace(/<appid>/g, appId)
    .replace(/<apikey>/g, "")
    .replace(/<moapikey>/g, "");
}