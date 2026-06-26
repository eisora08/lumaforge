import { mockPackages } from "../data/mockPackages";
import { defaultApiProviders } from "../data/providers";
import { AppSettings } from "../types/settings";
import { ApiProviderDefinition, ApiProviderId } from "../types/provider";
import {
  ProviderSearchParams,
  ProviderSearchProviderReport,
  ProviderSearchResult,
} from "../types/providerSearch";
import { PackageGame, PackageSource } from "../types/package";

export function getEnabledProviderIds(settings: AppSettings): ApiProviderId[] {
  return defaultApiProviders
    .filter((provider) => {
      const userSettings = settings.providers?.[provider.id];

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

  const targetProviders = getTargetProviders(
    params.provider,
    params.enabledProviderIds
  );

  const providerReports: ProviderSearchProviderReport[] = [];
  const collectedGames = new Map<string, PackageGame>();

  for (const provider of targetProviders) {
    try {
      const providerResults = await searchMockProvider(
        provider,
        normalizedQuery
      );

      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: providerResults.length > 0 ? "found" : "not-found",
        resultCount: providerResults.length,
        message:
          providerResults.length > 0
            ? "Resultados encontrados"
            : "No disponible en este provider",
      });

      mergeProviderResults(collectedGames, providerResults);
    } catch (error) {
      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message:
          error instanceof Error
            ? error.message
            : "Error desconocido consultando provider",
      });
    }
  }

  const disabledReports = getDisabledProviderReports(
    params.provider,
    params.enabledProviderIds
  );

  const results = Array.from(collectedGames.values()).map((game) =>
    hydrateDownloadUrls(game)
  );

  return {
    query: params.query,
    provider: params.provider,
    searchedProviders: targetProviders.map((provider) => provider.id),
    providerReports: [...providerReports, ...disabledReports],
    results,
    totalResults: results.length,
  };
}

function getTargetProviders(
  providerFilter: ProviderSearchParams["provider"],
  enabledProviderIds: ApiProviderId[]
): ApiProviderDefinition[] {
  if (providerFilter !== "all") {
    return defaultApiProviders.filter(
      (provider) =>
        provider.id === providerFilter &&
        enabledProviderIds.includes(provider.id)
    );
  }

  return defaultApiProviders.filter((provider) =>
    enabledProviderIds.includes(provider.id)
  );
}

function getDisabledProviderReports(
  providerFilter: ProviderSearchParams["provider"],
  enabledProviderIds: ApiProviderId[]
): ProviderSearchProviderReport[] {
  return defaultApiProviders
    .filter((provider) => {
      const isSelected =
        providerFilter === "all" || providerFilter === provider.id;

      return isSelected && !enabledProviderIds.includes(provider.id);
    })
    .map((provider) => ({
      providerId: provider.id,
      providerName: provider.name,
      status: "disabled",
      resultCount: 0,
      message: "Provider deshabilitado en configuración",
    }));
}

async function searchMockProvider(
  provider: ApiProviderDefinition,
  query: string
): Promise<PackageGame[]> {
  const results = mockPackages
    .map((game) => filterGameByProvider(game, provider.id))
    .filter((game): game is PackageGame => Boolean(game))
    .filter((game) => matchesQuery(game, query));

  return results;
}

function filterGameByProvider(
  game: PackageGame,
  providerId: ApiProviderId
): PackageGame | null {
  const sources = game.sources.filter(
    (source) => source.providerId === providerId
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

function mergeProviderResults(
  collectedGames: Map<string, PackageGame>,
  providerResults: PackageGame[]
) {
  providerResults.forEach((game) => {
    const existingGame = collectedGames.get(game.appId);

    if (!existingGame) {
      collectedGames.set(game.appId, game);
      return;
    }

    collectedGames.set(game.appId, {
      ...existingGame,
      sources: mergeSources(existingGame.sources, game.sources),
    });
  });
}

function mergeSources(
  existingSources: PackageSource[],
  newSources: PackageSource[]
): PackageSource[] {
  const sourceMap = new Map<string, PackageSource>();

  [...existingSources, ...newSources].forEach((source) => {
    const key = `${source.providerId}-${source.fileType}`;
    sourceMap.set(key, source);
  });

  return Array.from(sourceMap.values());
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