import { mockPackages } from "../data/mockPackages";
import { defaultApiProviders } from "../data/providers";
import { checkProviderAvailability } from "./tauri";
import {
  shouldSkipProvider,
  getHealthyProviders,
  recordProviderSuccess,
  recordProviderFailure,
} from "./providerHealthService";

import type { AppSettings } from "../types/settings";
import type { ApiProviderDefinition, ApiProviderId } from "../types/provider";
import type {
  ProviderProgressCallback,
  ProviderSearchParams,
  ProviderSearchProviderReport,
  ProviderSearchResult,
} from "../types/providerSearch";
import type { PackageGame, PackageSource } from "../types/package";

export type { ProviderProgressCallback };

const ENABLE_VERBOSE_SOURCE_LOGS = false;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log("[ProviderSearch]", ...args);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

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
  const appIdQuery = getAppIdFromQuery(normalizedQuery);

  const targetProviders = getTargetProviders(
    params.provider,
    params.enabledProviderIds
  );

  if (appIdQuery) {
    return await searchRealProviderAvailability(
      appIdQuery,
      params,
      settings,
      targetProviders
    );
  }

  return searchMockCatalog(
    normalizedQuery,
    params,
    settings,
    targetProviders
  );
}

async function searchRealProviderAvailability(
  appId: string,
  params: ProviderSearchParams,
  settings: AppSettings,
  targetProviders: ApiProviderDefinition[]
): Promise<ProviderSearchResult> {
  const providerReports: ProviderSearchProviderReport[] = [];
  const sources: PackageSource[] = [];
  const timeoutMs = params.timeoutMs ?? 10000;

  const sortedProviders = getHealthyProviders(targetProviders);

  for (const provider of sortedProviders) {
    const userSettings = settings.providers?.[provider.id];

    if (shouldSkipProvider(provider.id)) {
      console.log(`[PROVIDER_SKIP] provider=${provider.id} reason=cooldown`);
      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message: "Provider en cooldown",
      });
      sources.push({
        providerId: provider.id,
        providerName: provider.name,
        fileType: provider.supportedFileTypes[0] ?? "zip",
        available: false,
        error: "Temporarily unavailable (cooldown)",
        providerMessage: "Temporarily unavailable (cooldown)",
        checkedAt: new Date().toISOString(),
        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: false,
      });
      continue;
    }

    if (provider.requiresApiKey && !userSettings?.apiKey) {
      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message: "API key requerida",
      });


      sources.push({
        providerId: provider.id,
        providerName: provider.name,
        fileType: provider.supportedFileTypes[0] ?? "zip",
        available: false,
        error: "API key requerida",
        providerMessage: "API key requerida",
        checkedAt: new Date().toISOString(),
        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: false,
      });


      continue;
    }

    const fileType = provider.supportedFileTypes[0] ?? "zip";

    const availabilityUrl = buildProviderAvailabilityUrl(
      provider,
      appId,
      settings
    );

    const downloadUrl = buildProviderDownloadUrl(
      provider,
      appId,
      settings,
      fileType
    );

    const authHeaders = buildProviderAuthHeaders(provider, settings);

    if (!availabilityUrl) {
      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message: "URL de verificación inválida",
      });


      sources.push({
        providerId: provider.id,
        providerName: provider.name,
        fileType,
        available: false,
        error: "URL de verificación inválida",
        providerMessage: "URL de verificación inválida",
        checkedAt: new Date().toISOString(),
        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: false,
      });


      continue;
    }

    if (!downloadUrl) {
      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message: "URL de descarga inválida",
      });


      sources.push({
        providerId: provider.id,
        providerName: provider.name,
        fileType,
        available: false,
        error: "URL de descarga inválida",
        providerMessage: "URL de descarga inválida",
        checkedAt: new Date().toISOString(),
        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: Boolean(authHeaders),
      });


      continue;
    }

    const startedAt = Date.now();

    try {
      log(`start { appId: "${appId}", provider: "${provider.id}" }`);
      console.log(`[STORE][PROVIDER_DISCOVERY_REQUEST] appid=${appId} provider=${provider.id} url=${availabilityUrl} timeoutMs=${timeoutMs}`);
      const availability = await withTimeout(
        checkProviderAvailability({
          url: availabilityUrl,
          successCode: provider.successCode,
          unavailableCode: provider.unavailableCode,
          headers: authHeaders,
        }),
        timeoutMs,
        `checkProviderAvailability(${provider.id}, ${appId})`
      );
      const elapsedMs = Date.now() - startedAt;
      recordProviderSuccess(provider.id, elapsedMs);

      if (availability.available) {
        log(`exact appId match { appId: "${appId}", provider: "${provider.id}" }`);
      } else {
        log(`no sources { appId: "${appId}", provider: "${provider.id}" }`);
      }
      console.log(`[STORE][PROVIDER_DISCOVERY_RESPONSE] appid=${appId} provider=${provider.id} available=${availability.available} statusCode=${availability.status_code} latencyMs=${elapsedMs}`);

      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: availability.available ? "found" : "not-found",
        resultCount: availability.available ? 1 : 0,
        message: availability.message,
      });

      const newSource: PackageSource = {
        providerId: provider.id,
        providerName: provider.name,
        fileType,
        available: availability.available,
        downloadUrl: availability.available ? downloadUrl : undefined,
        authHeaders,
        error: availability.available ? undefined : availability.message,

        statusCode: availability.status_code,
        providerMessage: availability.message,
        checkedAt: new Date().toISOString(),

        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: Boolean(authHeaders),
      };
      sources.push(newSource);
      params.onProgress?.({
        appId,
        providerId: provider.id,
        providerName: provider.name,
        source: newSource,
        allSources: [...sources],
        totalEnabled: targetProviders.length,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Error consultando provider";
      const elapsedMs = Date.now() - startedAt;
      const isTimeout = message.toLowerCase().includes("timeout");
      recordProviderFailure(provider.id, isTimeout ? "timeout" : "error", elapsedMs);

      console.warn(`[STORE][PROVIDER_DISCOVERY_RESPONSE] appid=${appId} provider=${provider.id} error="${message}" latencyMs=${elapsedMs}`);

      providerReports.push({
        providerId: provider.id,
        providerName: provider.name,
        status: "error",
        resultCount: 0,
        message,
      });

      const errorSource: PackageSource = {
        providerId: provider.id,
        providerName: provider.name,
        fileType,
        available: false,
        error: message,

        providerMessage: message,
        checkedAt: new Date().toISOString(),

        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: Boolean(authHeaders),
      };
      sources.push(errorSource);
      params.onProgress?.({
        appId,
        providerId: provider.id,
        providerName: provider.name,
        source: errorSource,
        allSources: [...sources],
        totalEnabled: targetProviders.length,
      });
    }
  }

  const disabledReports = getDisabledProviderReports(
    params.provider,
    params.enabledProviderIds
  );

  const results: PackageGame[] = [
    {
      appId,
      title: getKnownGameTitle(appId) ?? `Steam App ${appId}`,
      developer: "Steam",
      imageUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      platforms: ["Windows"],
      sources,
    },
  ];

  return {
    query: params.query,
    provider: params.provider,
    searchedProviders: targetProviders.map((provider) => provider.id),
    providerReports: [...providerReports, ...disabledReports],
    results,
    totalResults: results.length,
  };
}

function searchMockCatalog(
  query: string,
  params: ProviderSearchParams,
  settings: AppSettings,
  targetProviders: ApiProviderDefinition[]
): ProviderSearchResult {
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

    const providerResults = mockPackages
      .map((game) => filterGameByProvider(game, provider.id, settings))
      .filter((game): game is PackageGame => Boolean(game))
      .filter((game) => matchesQuery(game, query));

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
    .map((source) => {
      const authHeaders = buildProviderAuthHeaders(provider, settings);

      return {
        ...source,
        downloadUrl:
          source.downloadUrl ??
          buildProviderDownloadUrl(
            provider,
            game.appId,
            settings,
            source.fileType
          ),
        authHeaders,

        providerMessage:
          source.providerMessage ??
          (source.available ? "Mock disponible" : source.error ?? "No disponible"),
        checkedAt: source.checkedAt ?? new Date().toISOString(),

        requiresApiKey: provider.requiresApiKey,
        authType: provider.authType,
        hasAuth: Boolean(authHeaders),
      };
    });

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

function buildProviderAvailabilityUrl(
  provider: ApiProviderDefinition,
  appId: string,
  settings: AppSettings
): string | undefined {
  const userSettings = settings.providers?.[provider.id];
  const apiKey = userSettings?.apiKey ?? "";

  const template =
    provider.availabilityUrlTemplate || provider.downloadUrlTemplate;

  if (!template) {
    return undefined;
  }

  let url = template
    .replace(/<appid>/g, appId)
    .replace(/<apikey>/g, apiKey)
    .replace(/<moapikey>/g, apiKey);

  if (provider.authType === "query" && provider.authQueryParam && apiKey) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}${provider.authQueryParam}=${encodeURIComponent(
      apiKey
    )}`;
  }

  return url;
}

export function buildProviderDownloadUrl(
  provider: ApiProviderDefinition,
  appId: string,
  settings: AppSettings,
  fileType: PackageSource["fileType"] = "zip"
): string | undefined {
  const userSettings = settings.providers?.[provider.id];
  const apiKey = userSettings?.apiKey ?? "";
  const baseUrl = userSettings?.baseUrl || provider.baseUrl;

  if (!baseUrl) {
    return undefined;
  }

  if (provider.id === "ryuu") {
    const normalizedBase = baseUrl.replace(/\/$/, "");

    if (fileType === "zip") {
      return `${normalizedBase}/api/download/${appId}`;
    }

    return `${normalizedBase}/api/download/${appId}?file_type=${fileType}`;
  }

  let url = provider.downloadUrlTemplate
    .replace(/<appid>/g, appId)
    .replace(/<apikey>/g, apiKey)
    .replace(/<moapikey>/g, apiKey);

  if (provider.authType === "query" && provider.authQueryParam && apiKey) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}${provider.authQueryParam}=${encodeURIComponent(
      apiKey
    )}`;
  }

  return url;
}

function buildProviderAuthHeaders(
  provider: ApiProviderDefinition,
  settings: AppSettings
): Record<string, string> | undefined {
  const userSettings = settings.providers?.[provider.id];
  const apiKey = userSettings?.apiKey ?? "";

  if (!apiKey || provider.authType !== "header" || !provider.authHeaderName) {
    return undefined;
  }

  if (provider.id === "hubcapdb") {
    return {
      [provider.authHeaderName]: `Bearer ${apiKey}`,
    };
  }

  return {
    [provider.authHeaderName]: apiKey,
  };
}

function normalizeProviderIdForAuth(id: string): string {
  const lower = id.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (lower === "hubcapdb" || lower === "hubcap") return "hubcapdb";
  if (lower === "ryuu") return "ryuu";
  return id;
}

export function getEffectiveProviderAuthHeaders(
  providerId: string,
  settings: AppSettings
): Record<string, string> | undefined {
  const normalized = normalizeProviderIdForAuth(providerId);

  if (normalized === "hubcapdb") {
    const apiKey = settings.providers?.hubcapdb?.apiKey;
    if (!apiKey) return undefined;
    return { "Authorization": `Bearer ${apiKey}` };
  }

  if (normalized === "ryuu") {
    const apiKey = settings.providers?.ryuu?.apiKey;
    if (!apiKey) return undefined;
    return { "X-Auth-Key": apiKey };
  }

  return undefined;
}

function getAppIdFromQuery(query: string): string | null {
  if (/^\d{2,10}$/.test(query)) {
    return query;
  }

  return null;
}

function getKnownGameTitle(appId: string): string | undefined {
  return mockPackages.find((game) => game.appId === appId)?.title;
}