import { useEffect, useState } from "react";

import { useSettings } from "../context/SettingsContext";
import { PackageGame } from "../types/package";
import {
  ProviderFilter,
  ProviderSearchProviderReport,
} from "../types/providerSearch";
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
  const [searchedProviders, setSearchedProviders] = useState<string[]>(
    []
  );
  const [providerReports, setProviderReports] = useState<
    ProviderSearchProviderReport[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      if (!query.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const enabledProviderIds = getEnabledProviderIds(settings);


      const response = await searchPackagesByProviders(
        {
          query,
          provider: selectedProvider,
          enabledProviderIds,
        },
        settings
      );

      if (cancelled) {
        return;
      }

      setResults(response.results);
      setSearchedProviders(response.searchedProviders);
      setProviderReports(response.providerReports);
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
    providerReports,
    setQuery,
    setSelectedProvider,
  };
}