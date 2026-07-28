import { ApiProviderId } from "./provider";
import { PackageGame, PackageSource } from "./package";

export type ProviderFilter = ApiProviderId | "all";

export type ProviderSearchStatus =
  | "searched"
  | "found"
  | "not-found"
  | "disabled"
  | "error";

export type ProviderSearchParams = {
  query: string;
  provider: ProviderFilter;
  enabledProviderIds: ApiProviderId[];
  onProgress?: ProviderProgressCallback;
  timeoutMs?: number;
};

export type ProviderProgressCallback = (result: {
  appId: string;
  providerId: string;
  providerName: string;
  source: PackageSource;
  allSources: PackageSource[];
  totalEnabled: number;
}) => void;

export type ProviderSearchProviderReport = {
  providerId: string;
  providerName: string;
  status: ProviderSearchStatus;
  resultCount: number;
  message?: string;
};

export type ProviderSearchResult = {
  query: string;
  provider: ProviderFilter;
  searchedProviders: string[];
  providerReports: ProviderSearchProviderReport[];
  results: PackageGame[];
  totalResults: number;
};