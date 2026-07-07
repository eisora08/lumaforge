import type { ApiProviderId, PackageFileType } from "./provider";
import type { PackageInstallStatus } from "./packageInstall";

export type StoreGameId = string;

export type StoreProviderStatus =
  | "ready"
  | "unavailable"
  | "needs-auth"
  | "checking"
  | "unknown";

export type StoreGameSyncStatus =
  | "not-installed"
  | "installed"
  | "disabled"
  | "synced"
  | "auto-updated"
  | "syncing"
  | "missing"
  | "failed"
  | "unknown";

export type StoreGameMetadata = {
  appId: StoreGameId;
  title: string;
  developer?: string;
  imageUrl?: string;

  platforms: string[];
  languages: string[];

  dlcCount?: number;
  dlcLabel: string;

  reviewScoreLabel: string;
  reviewScorePercent?: number;
  reviewCount?: number;

  lastCheckedLabel: string;
  lastCheckedAt?: string;
};

export type StoreProviderSource = {
  id: string;

  providerId: ApiProviderId;
  providerName: string;

  fileType: PackageFileType;
  status: StoreProviderStatus;

  available: boolean;
  downloadUrl?: string;
  authHeaders?: Record<string, string>;

  requiresApiKey?: boolean;
  hasAuth?: boolean;

  statusCode?: number;
  message?: string;

  checkedAt?: string;
  lastUpdatedAt?: string;
};

export type StoreSelectedProvider = {
  sourceId?: string;

  providerId?: ApiProviderId;
  providerName?: string;

  fileType?: PackageFileType;
  status: StoreProviderStatus;

  label: string;
  description: string;
};

export type StoreGame = {
  id: StoreGameId;
  appId: StoreGameId;

  metadata: StoreGameMetadata;

  installStatus: PackageInstallStatus;
  syncStatus: StoreGameSyncStatus;

  sources: StoreProviderSource[];
  selectedSource?: StoreProviderSource;
  selectedProvider: StoreSelectedProvider;

  sourceCount: number;
  availableSourceCount: number;

  isInstalled: boolean;
  isDownloadable: boolean;
};

export type StoreSectionId =
  | "featured"
  | "installed-supported"
  | "recently-supported"
  | "popular"
  | "search-results"
  | "steam-featured"
  | "steam-specials"
  | "steam-new-releases"
  | "steam-top-sellers";

export type StoreSection = {
  id: StoreSectionId;
  title: string;
  description?: string;
  games: StoreGame[];
};

export type StoreSearchState = {
  query: string;
  isSearching: boolean;
};

export type StoreMediaType = "trailer" | "screenshot";

export type StoreMediaSource = "steam-screenshots" | "steam-movies" | "html-about" | "html-detailed-description" | "igdb";

export interface StoreScreenshotMedia {
  type: "screenshot";
  id: string;
  thumbnail?: string;
  image: string;
  source: StoreMediaSource;
}

export interface StoreTrailerMedia {
  type: "trailer";
  id: string;
  name?: string;
  thumbnail?: string;
  poster?: string;
  mp4?: string;
  webm?: string;
  hls?: string;
  hls_h264?: string;
  dash?: string;
  dash_h264?: string;
  dash_av1?: string;
  source: StoreMediaSource;
  mediaLanguage?: string;
  mediaRegion?: string;
}

export type StoreMediaItem = StoreScreenshotMedia | StoreTrailerMedia;

export type StoreHomeModel = {
  hero: {
    totalGames: number;
    totalSources: number;
    availableSources: number;
    installedGames: number;
  };

  sections: StoreSection[];
};