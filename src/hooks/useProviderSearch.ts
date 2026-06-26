import { useEffect, useState } from "react";

import { useSettings } from "../context/SettingsContext";
import { ApiProviderId } from "../types/provider";
import { PackageGame } from "../types/package";
import { ProviderFilter } from "../types/providerSearch";
import {
  getEnabledProviderIds,
  searchPackagesByProviders,
} from "../services/providerSearch";

export function useProviderSearch() {
  const { settings } = useSettings();

  const [query, setQuery] = useState("");
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderFilter>("all");

  const [results, setResults] = useState<PackageGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchedProviders, setSearchedProviders] = useState<ApiProviderId[]>(
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      setLoading(true);

      const enabledProviderIds = getEnabledProviderIds(settings);

      const response = await searchPackagesByProviders({
        query,
        provider: selectedProvider,
        enabledProviderIds,
      });

      if (cancelled) {
        return;
      }

      setResults(response.results);
      setSearchedProviders(response.searchedProviders);
      setLoading(false);
    }

    runSearch();

    return () => {
      cancelled = true;
    };
  }, [query, selectedProvider, settings]);

  return {
    query,
    selectedProvider,
    results,
    loading,
    searchedProviders,
    setQuery,
    setSelectedProvider,
  };
}