import { mockPackages } from "../data/mockPackages";
import { defaultApiProviders } from "../data/providers";
import { checkProviderAvailability, hubcapAppStatus } from "./tauri";
import {
  shouldSkipProvider,
  getHealthyProviders,
  recordProviderSuccess,
  recordProviderFailure,
  resetProviderHealth,
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
const DEBUG_SOURCE_RESOLUTION = false;

function log(...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log("[ProviderSearch]", ...args);
  }
}

function logResolution(...args: unknown[]) {
  if (DEBUG_SOURCE_RESOLUTION) {
    console.log("[PROVIDER_SEARCH]", ...args);
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

type ExecutableProvider = {
  provider: ApiProviderDefinition;
  authHeaders: Record<string, string> | undefined;
  downloadUrl: string;
  fileType: PackageSource["fileType"];
  availabilityUrl: string;
};

async function searchRealProviderAvailability(
  appId: string,
  params: ProviderSearchParams,
  settings: AppSettings,
  targetProviders: ApiProviderDefinition[]
): Promise<ProviderSearchResult> {
  const timeoutMs = params.timeoutMs ?? 10000;
  const sortedProviders = getHealthyProviders(targetProviders);
  const totalEnabled = targetProviders.length;

  console.log(`[PROVIDER][DISCOVERY_START] appid=${appId} providers=[${sortedProviders.map(p => `${p.id}`).join(",")}]`);
  logResolution(`concurrent start appid=${appId} providers=${sortedProviders.length} totalEnabled=${totalEnabled}`);

  // ── Phase 1: Quick synchronous filter — identify executable providers ──
  const executable: ExecutableProvider[] = [];
  const skipReports: ProviderSearchProviderReport[] = [];
  const skipSources: PackageSource[] = [];

  for (const provider of sortedProviders) {
    const userSettings = settings.providers?.[provider.id];

    if (provider.id === "hubcapdb") {
      resetProviderHealth("hubcapdb");
    }

    const inCooldown = shouldSkipProvider(provider.id);
    const hasApiKey = !!userSettings?.apiKey;
    const enabled = userSettings ? userSettings.enabled : provider.enabledByDefault;
    const willExecute = enabled && !inCooldown && (!provider.requiresApiKey || hasApiKey);
    console.log(`[PROVIDER][DISCOVERY_PROVIDER] appid=${appId} provider=${provider.id} enabled=${enabled} hasApiKey=${hasApiKey} requiresKey=${provider.requiresApiKey} cooldown=${inCooldown} canSearch=${provider.capabilities.includes("availability-check")} willExecute=${willExecute}`);

    if (inCooldown) {
      console.log(`[PROVIDER][DISCOVERY_SKIP] appid=${appId} provider=${provider.id} reason=cooldown`);
      logResolution(`skip appid=${appId} provider=${provider.id} reason=cooldown`);
      skipReports.push({ providerId: provider.id, providerName: provider.name, status: "error", resultCount: 0, message: "Provider en cooldown" });
      skipSources.push({ providerId: provider.id, providerName: provider.name, fileType: provider.supportedFileTypes[0] ?? "zip", available: false, error: "Temporarily unavailable (cooldown)", providerMessage: "Temporarily unavailable (cooldown)", checkedAt: new Date().toISOString(), requiresApiKey: provider.requiresApiKey, authType: provider.authType, hasAuth: false });
      continue;
    }

    if (provider.requiresApiKey && !userSettings?.apiKey) {
      console.log(`[PROVIDER][DISCOVERY_SKIP] appid=${appId} provider=${provider.id} reason=missing-api-key`);
      logResolution(`skip appid=${appId} provider=${provider.id} reason=missing-api-key`);
      skipReports.push({ providerId: provider.id, providerName: provider.name, status: "error", resultCount: 0, message: "API key requerida" });
      skipSources.push({ providerId: provider.id, providerName: provider.name, fileType: provider.supportedFileTypes[0] ?? "zip", available: false, error: "API key requerida", providerMessage: "API key requerida", checkedAt: new Date().toISOString(), requiresApiKey: provider.requiresApiKey, authType: provider.authType, hasAuth: false });
      continue;
    }

    const fileType = provider.supportedFileTypes[0] ?? "zip";
    const availabilityUrl = buildProviderAvailabilityUrl(provider, appId, settings);
    const downloadUrl = buildProviderDownloadUrl(provider, appId, settings, fileType);
    const authHeaders = buildProviderAuthHeaders(provider, settings);

    if (!availabilityUrl) {
      console.log(`[PROVIDER][DISCOVERY_SKIP] appid=${appId} provider=${provider.id} reason=no-availability-url`);
      logResolution(`skip appid=${appId} provider=${provider.id} reason=no-availability-url`);
      skipReports.push({ providerId: provider.id, providerName: provider.name, status: "error", resultCount: 0, message: "URL de verificación inválida" });
      skipSources.push({ providerId: provider.id, providerName: provider.name, fileType, available: false, error: "URL de verificación inválida", providerMessage: "URL de verificación inválida", checkedAt: new Date().toISOString(), requiresApiKey: provider.requiresApiKey, authType: provider.authType, hasAuth: false });
      continue;
    }

    if (!downloadUrl) {
      console.log(`[PROVIDER][DISCOVERY_SKIP] appid=${appId} provider=${provider.id} reason=no-download-url`);
      logResolution(`skip appid=${appId} provider=${provider.id} reason=no-download-url`);
      skipReports.push({ providerId: provider.id, providerName: provider.name, status: "error", resultCount: 0, message: "URL de descarga inválida" });
      skipSources.push({ providerId: provider.id, providerName: provider.name, fileType, available: false, error: "URL de descarga inválida", providerMessage: "URL de descarga inválida", checkedAt: new Date().toISOString(), requiresApiKey: provider.requiresApiKey, authType: provider.authType, hasAuth: Boolean(authHeaders) });
      continue;
    }

    executable.push({ provider, authHeaders, downloadUrl, fileType, availabilityUrl });
  }

  // ── Phase 2: Concurrent provider checks ──
  const outcomes = new Map<string, { source: PackageSource; report: ProviderSearchProviderReport }>();
  const sharedSources: PackageSource[] = [...skipSources];
  const sharedReports: ProviderSearchProviderReport[] = [...skipReports];
  const concurrentStartedAt = Date.now();

  logResolution(`concurrent launch appid=${appId} executable=${executable.length} skipped=${skipSources.length}`);

  await Promise.allSettled(
    executable.map(async ({ provider, authHeaders, downloadUrl, fileType, availabilityUrl }) => {
      const startedAt = Date.now();

      try {
        log(`start { appId: "${appId}", provider: "${provider.id}" }`);
        logResolution(`provider start appid=${appId} provider=${provider.id}`);

        let availability: { available: boolean; status_code: number; message: string };

        if (provider.id === "hubcapdb") {
          const hubcapSettings = settings.providers?.hubcapdb;
          const baseUrl = hubcapSettings?.baseUrl || "https://hubcapmanifest.com";
          const apiKey = hubcapSettings?.apiKey || "";

          console.log(`[HUBCAP][SOURCE_CHECK_START] appid=${appId} url=${baseUrl}/api/v1/status/${appId} hasApiKey=${!!apiKey} authMode=bearer`);

          const statusResponse = await withTimeout(
            hubcapAppStatus(baseUrl, apiKey, appId),
            timeoutMs,
            `hubcapAppStatus(${appId})`
          );

          console.log(`[HUBCAP][SOURCE_CHECK_APPID] appid=${appId} normalizedAppId=${appId}`);
          console.log(`[HUBCAP][SOURCE_CHECK_RESPONSE] appid=${appId} ok=${statusResponse.ok} status=${statusResponse.status} bodyKeys=${Object.keys(statusResponse).join(",")}`);
          console.log(`[HUBCAP][SOURCE_CHECK_BODY] appid=${appId} status=${statusResponse.status} manifestFileExists=${statusResponse.manifest_file_exists} fileModified=${statusResponse.file_modified} fileSize=${statusResponse.file_size} needsUpdate=${statusResponse.needs_update} updateInProgress=${statusResponse.update_in_progress}`);

          const hubcapAvailable = !!(statusResponse.ok && statusResponse.status === "available" && statusResponse.manifest_file_exists);
          console.log(`[HUBCAP][SOURCE_MAP] appid=${appId} available=${hubcapAvailable} reason=${statusResponse.status} manifestFileExists=${statusResponse.manifest_file_exists}`);
          console.log(`[STORE][PROVIDER_RESULT_MAP] appid=${appId} provider=HubcapDB available=${hubcapAvailable} reason=${statusResponse.status}`);

          availability = {
            available: hubcapAvailable,
            status_code: 200,
            message: hubcapAvailable ? "Available" : (statusResponse.status || "Not available"),
          };
        } else {
          console.log(`[STORE][PROVIDER_DISCOVERY_REQUEST] appid=${appId} provider=${provider.id} url=${availabilityUrl} timeoutMs=${timeoutMs}`);
          availability = await withTimeout(
            checkProviderAvailability({
              url: availabilityUrl,
              successCode: provider.successCode,
              unavailableCode: provider.unavailableCode,
              headers: authHeaders,
            }),
            timeoutMs,
            `checkProviderAvailability(${provider.id}, ${appId})`
          );
        }

        const elapsedMs = Date.now() - startedAt;
        recordProviderSuccess(provider.id, elapsedMs);
        console.log(`[STORE][PROVIDER_DISCOVERY_RESPONSE] appid=${appId} provider=${provider.id} available=${availability.available} statusCode=${availability.status_code} latencyMs=${elapsedMs}`);
        logResolution(`provider done appid=${appId} provider=${provider.id} available=${availability.available} latencyMs=${elapsedMs}`);

        const report: ProviderSearchProviderReport = {
          providerId: provider.id,
          providerName: provider.name,
          status: availability.available ? "found" : "not-found",
          resultCount: availability.available ? 1 : 0,
          message: availability.message,
        };

        const source: PackageSource = {
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

        outcomes.set(provider.id, { source, report });
        sharedSources.push(source);
        sharedReports.push(report);
        params.onProgress?.({
          appId,
          providerId: provider.id,
          providerName: provider.name,
          source,
          allSources: [...sharedSources],
          totalEnabled,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message
            : typeof error === "string" ? error
              : "Error consultando provider";
        const elapsedMs = Date.now() - startedAt;
        const isTimeout = message.toLowerCase().includes("timeout");
        recordProviderFailure(provider.id, isTimeout ? "timeout" : "error", elapsedMs);

        if (provider.id === "hubcapdb") {
          if (isTimeout) {
            console.log(`[HUBCAP][SOURCE_CHECK_TIMEOUT] appid=${appId} timeoutMs=${timeoutMs}`);
          } else {
            console.log(`[HUBCAP][SOURCE_CHECK_ERROR] appid=${appId} status=error error="${message}"`);
          }
        }

        console.warn(`[STORE][PROVIDER_DISCOVERY_RESPONSE] appid=${appId} provider=${provider.id} error="${message}" latencyMs=${elapsedMs}`);
        logResolution(`provider error appid=${appId} provider=${provider.id} error="${message}" latencyMs=${elapsedMs}`);

        const report: ProviderSearchProviderReport = {
          providerId: provider.id,
          providerName: provider.name,
          status: "error",
          resultCount: 0,
          message,
        };

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

        outcomes.set(provider.id, { source: errorSource, report });
        sharedSources.push(errorSource);
        sharedReports.push(report);
        params.onProgress?.({
          appId,
          providerId: provider.id,
          providerName: provider.name,
          source: errorSource,
          allSources: [...sharedSources],
          totalEnabled,
        });
      }
    })
  );

  const concurrentElapsedMs = Date.now() - concurrentStartedAt;
  logResolution(`concurrent done appid=${appId} executable=${executable.length} elapsedMs=${concurrentElapsedMs}`);

  // ── Phase 3: Assemble final arrays in provider priority order ──
  const finalSources: PackageSource[] = [];
  const finalReports: ProviderSearchProviderReport[] = [];

  for (const provider of sortedProviders) {
    const outcome = outcomes.get(provider.id);
    if (outcome) {
      finalSources.push(outcome.source);
      finalReports.push(outcome.report);
    }
  }

  // Prepend skipped sources (order: skipSources, then priority-ordered executable sources)
  const allSources = [...skipSources, ...finalSources];
  const allReports = [...skipReports, ...finalReports];

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
      sources: allSources,
    },
  ];

  return {
    query: params.query,
    provider: params.provider,
    searchedProviders: targetProviders.map((provider) => provider.id),
    providerReports: [...allReports, ...disabledReports],
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