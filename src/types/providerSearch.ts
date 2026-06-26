import { ApiProviderId } from "./provider";
import { PackageGame } from "./package";

export type ProviderFilter = ApiProviderId | "all";

export type ProviderSearchParams = {
  query: string;
  provider: ProviderFilter;
  enabledProviderIds: ApiProviderId[];
};

export type ProviderSearchResult = {
  query: string;
  provider: ProviderFilter;
  searchedProviders: ApiProviderId[];
  results: PackageGame[];
  totalResults: number;
};