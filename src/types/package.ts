
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