import type { PackageGame, PackageSource } from "../types/package";
import type { PackageInstallStatus } from "../types/packageInstall";
import type {
  StoreGame,
  StoreGameMetadata,
  StoreProviderSource,
} from "../types/store";

import {
  formatStoreCheckedAt,
  formatStoreDlcCount,
  formatStoreLanguages,
  getSelectedProviderLabel,
  getStoreProviderStatus,
} from "../utils/storeLabels";

function getSourceKey(source: PackageSource) {
  return `${source.providerId}-${source.fileType}`;
}

function mapPackageSourceToStoreSource(
  source: PackageSource
): StoreProviderSource {
  const statusInfo = getStoreProviderStatus({
    id: getSourceKey(source),
    providerId: source.providerId,
    providerName: source.providerName,
    fileType: source.fileType,
    available: source.available,
    downloadUrl: source.downloadUrl,
    authHeaders: source.authHeaders,
    requiresApiKey: source.requiresApiKey,
    hasAuth: source.hasAuth,
    statusCode: source.statusCode,
    message: source.providerMessage || source.error,
    checkedAt: source.checkedAt,
    lastUpdatedAt: source.lastUpdated,
    status: "unknown",
  });

  return {
    id: getSourceKey(source),

    providerId: source.providerId,
    providerName: source.providerName,

    fileType: source.fileType,
    status: statusInfo.status,

    available: source.available,
    downloadUrl: source.downloadUrl,
    authHeaders: source.authHeaders,

    requiresApiKey: source.requiresApiKey,
    hasAuth: source.hasAuth,

    statusCode: source.statusCode,
    message: source.providerMessage || source.error,

    checkedAt: source.checkedAt,
    lastUpdatedAt: source.lastUpdated,
  };
}

function buildStoreMetadata(game: PackageGame): StoreGameMetadata {
  const firstCheckedAt =
    game.sources.find((source) => source.checkedAt)?.checkedAt ||
    game.sources.find((source) => source.lastUpdated)?.lastUpdated;

  return {
    appId: game.appId,
    title: game.title,
    developer: game.developer,
    imageUrl: game.imageUrl,

    platforms: game.platforms,
    languages: [],

    dlcCount: undefined,
    dlcLabel: formatStoreDlcCount(undefined),

    reviewScoreLabel: "N/A",

    lastCheckedAt: firstCheckedAt,
    lastCheckedLabel: formatStoreCheckedAt(firstCheckedAt),
  };
}

function getSyncStatusFromInstallStatus(
  installStatus: PackageInstallStatus
): StoreGame["syncStatus"] {
  if (installStatus === "active") {
    return "installed";
  }

  if (installStatus === "disabled") {
    return "disabled";
  }

  return "not-installed";
}

export function mapPackageGameToStoreGame(params: {
  game: PackageGame;
  installStatus: PackageInstallStatus;
  selectedSourceKey?: string;
}): StoreGame {
  const { game, installStatus, selectedSourceKey } = params;

  const sources = game.sources.map(mapPackageSourceToStoreSource);

  const selectedSource =
    sources.find((source) => source.id === selectedSourceKey) ||
    sources.find((source) => source.available) ||
    sources[0];

  const availableSourceCount = sources.filter((source) => source.available)
    .length;

  const isInstalled =
    installStatus === "active" || installStatus === "disabled";

  return {
    id: game.appId,
    appId: game.appId,

    metadata: buildStoreMetadata(game),

    installStatus,
    syncStatus: getSyncStatusFromInstallStatus(installStatus),

    sources,
    selectedSource,
    selectedProvider: getSelectedProviderLabel(selectedSource),

    sourceCount: sources.length,
    availableSourceCount,

    isInstalled,
    isDownloadable: Boolean(selectedSource?.available),
  };
}

export function mapPackageGamesToStoreGames(params: {
  games: PackageGame[];
  installStatusByAppId: Map<string, PackageInstallStatus>;
}): StoreGame[] {
  const { games, installStatusByAppId } = params;

  return games.map((game) =>
    mapPackageGameToStoreGame({
      game,
      installStatus:
        installStatusByAppId.get(game.appId) ?? "not-installed",
    })
  );
}

export function formatStoreLanguagesFromMetadata(languages: string[]) {
  return formatStoreLanguages(languages);
}