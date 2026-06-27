import type { PackageGame, PackageSource } from "../types/package";
import type { PackageInstallStatus } from "../types/packageInstall";
import type { SteamAppMetadata } from "../types/gameMetadata";
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

function normalizePlatforms(params: {
  packagePlatforms: string[];
  metadata?: SteamAppMetadata;
}) {
  const metadataPlatforms = params.metadata?.platforms ?? [];

  if (metadataPlatforms.length > 0) {
    return metadataPlatforms;
  }

  return params.packagePlatforms;
}

function normalizeLanguages(metadata?: SteamAppMetadata) {
  return metadata?.languages ?? [];
}

function getBestImageUrl(params: {
  packageImageUrl?: string;
  metadata?: SteamAppMetadata;
}) {
  return (
    params.metadata?.header_image ||
    params.metadata?.capsule_image ||
    params.metadata?.capsule_image_v5 ||
    params.packageImageUrl
  );
}

function getDeveloper(params: {
  packageDeveloper?: string;
  metadata?: SteamAppMetadata;
}) {
  return params.metadata?.developer || params.packageDeveloper;
}

function getFirstCheckedAt(sources: PackageSource[]) {
  return (
    sources.find((source) => source.checkedAt)?.checkedAt ||
    sources.find((source) => source.lastUpdated)?.lastUpdated
  );
}

function mapPackageSourceToStoreSource(
  source: PackageSource
): StoreProviderSource {
  const storeSourceBase: StoreProviderSource = {
    id: getSourceKey(source),

    providerId: source.providerId,
    providerName: source.providerName,

    fileType: source.fileType,
    status: "unknown",

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

  const statusInfo = getStoreProviderStatus(storeSourceBase);

  return {
    ...storeSourceBase,
    status: statusInfo.status,
  };
}

function buildStoreMetadata(params: {
  game: PackageGame;
  metadata?: SteamAppMetadata;
}): StoreGameMetadata {
  const { game, metadata } = params;

  const platforms = normalizePlatforms({
    packagePlatforms: game.platforms,
    metadata,
  });

  const languages = normalizeLanguages(metadata);
  const dlcCount = metadata?.dlc_count;
  const firstCheckedAt = getFirstCheckedAt(game.sources);

  return {
    appId: game.appId,
    title: metadata?.name || game.title,
    developer: getDeveloper({
      packageDeveloper: game.developer,
      metadata,
    }),
    imageUrl: getBestImageUrl({
      packageImageUrl: game.imageUrl,
      metadata,
    }),

    platforms,
    languages,

    dlcCount,
    dlcLabel: formatStoreDlcCount(dlcCount),

    reviewScoreLabel: "N/A",
    reviewScorePercent: undefined,
    reviewCount: undefined,

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
  metadata?: SteamAppMetadata;
  selectedSourceKey?: string;
}): StoreGame {
  const { game, installStatus, metadata, selectedSourceKey } = params;

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

    metadata: buildStoreMetadata({
      game,
      metadata,
    }),

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
  metadataByAppId?: Record<number, SteamAppMetadata>;
}): StoreGame[] {
  const { games, installStatusByAppId, metadataByAppId = {} } = params;

  return games.map((game) =>
    mapPackageGameToStoreGame({
      game,
      installStatus:
        installStatusByAppId.get(game.appId) ?? "not-installed",
      metadata: metadataByAppId[Number(game.appId)],
    })
  );
}

export function getStoreGameLanguagesLabel(game: StoreGame) {
  return formatStoreLanguages(game.metadata.languages);
}

export function getStoreGameDlcLabel(game: StoreGame) {
  return game.metadata.dlcLabel;
}

export function getStoreGameLastCheckedLabel(game: StoreGame) {
  return game.metadata.lastCheckedLabel;
}

export function getStoreGameReviewLabel(game: StoreGame) {
  return game.metadata.reviewScoreLabel;
}