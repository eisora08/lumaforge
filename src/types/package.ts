
import { ApiProviderId, PackageFileType, ProviderAuthType } from "./provider";

export type PackageSource = {
  providerId: ApiProviderId;
  providerName: string;
  fileType: PackageFileType;

  available: boolean;
  downloadUrl?: string;
  authHeaders?: Record<string, string>;

  lastUpdated?: string;
  error?: string;

  statusCode?: number;
  providerMessage?: string;
  checkedAt?: string;

  requiresApiKey?: boolean;
  authType?: ProviderAuthType;
  hasAuth?: boolean;
};

export type PackageGame = {
  appId: string;
  title: string;
  developer?: string;
  imageUrl?: string;
  platforms: string[];
  sources: PackageSource[];
};

export type PackageSearchResult = {
  query: string;
  results: PackageGame[];
};

/** A single repack entry from the Debrid repack catalog, surfaced as a source on Store details. */
export type RepackEntry = {
  id: string;
  title: string;
  appId: number;
  repacker: string;
  installerType: string;
  fileSize: number;
  installSize: number | null;
  languages: string[];
  downloadUris: string[];
  sourceUrl: string;
  checksum: string | null;
  updatedAt: string;
  tags: string[];
};