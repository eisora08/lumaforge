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
  params: ProviderSearchParams,
  settings: AppSettings
): Promise<ProviderSearchResult> {
  const normalizedQuery = params.query.trim().toLowerCase();

  const targetProviders = getTargetProviders(
    params.provider,
    params.enabledProviderIds
  );

  const providerReports: ProviderSearchProviderReport[] = [];
  const collectedGames = new Map<string, PackageGame>();

  for (const provider of targetProviders) {
    const userSettings = settings.providers?.[provider.id];

    if (provider.requiresApiKey && !userSettings?.apiKey) {
      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message: "API key requerida",
      });

      continue;
    }

    try {
      const providerResults = await searchMockProvider(
        provider,
        normalizedQuery,
        settings
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

  const results = Array.from(collectedGames.values());

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
  query: string,
  settings: AppSettings
): Promise<PackageGame[]> {
  const results = mockPackages
    .map((game) => filterGameByProvider(game, provider.id, settings))
    .filter((game): game is PackageGame => Boolean(game))
    .filter((game) => matchesQuery(game, query));

  return results;
}

function filterGameByProvider(
  game: PackageGame,
  providerId: ApiProviderId,
  settings: AppSettings
): PackageGame | null {
  const provider = defaultApiProviders.find((item) => item.id === providerId);

  if (!provider) {
    return null;
  }

  const sources = game.sources
    .filter((source) => source.providerId === providerId)
    .map((source) => hydrateSource(source, game.appId, settings));

  if (sources.length === 0) {
    return null;
  }

  return {
    ...game,
    sources,
  };
}

function hydrateSource(
  source: PackageSource,
  appId: string,
  settings: AppSettings
): PackageSource {
  const provider = defaultApiProviders.find(
    (item) => item.id === source.providerId
  );

  if (!provider) {
    return {
      ...source,
      available: false,
      error: "Provider no encontrado",
    };
  }

  const providerSettings = settings.providers?.[provider.id];

  if (provider.requiresApiKey && !providerSettings?.apiKey) {
    return {
      ...source,
      available: false,
      downloadUrl: undefined,
      error: "API key requerida",
    };
  }

  return {
    ...source,
    downloadUrl:
      source.downloadUrl ?? buildProviderDownloadUrl(source, appId, settings),
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

function buildProviderDownloadUrl(
  source: PackageSource,
  appId: string,
  settings: AppSettings
): string | undefined {
  const provider = defaultApiProviders.find(
    (item) => item.id === source.providerId
  );

  if (!provider) {
    return undefined;
  }

  const providerSettings = settings.providers?.[provider.id];
  const apiKey = providerSettings?.apiKey ?? "";

  return provider.urlTemplate
    .replace(/<appid>/g, appId)
    .replace(/<apikey>/g, apiKey)
    .replace(/<moapikey>/g, apiKey);
}