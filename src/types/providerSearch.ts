import { ApiProviderId } from "./provider";
import { PackageGame } from "./package";

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
};

export type ProviderSearchProviderReport = {
  providerId: ApiProviderId;
  providerName: string;
  status: ProviderSearchStatus;
  resultCount: number;
  message?: string;
};

export type ProviderSearchResult = {
  query: string;
  provider: ProviderFilter;
  searchedProviders: ApiProviderId[];
  providerReports: ProviderSearchProviderReport[];
  results: PackageGame[];
  totalResults: number;
};