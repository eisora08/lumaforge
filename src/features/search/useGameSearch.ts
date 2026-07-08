import { useCallback, useEffect, useState } from "react";
import { searchSteamStore } from "../../services/steamStoreSearchResolver";
import { mapSteamStoreSearchItemToGameSearchResult } from "./gameSearchMapper";
import type { GameSearchResult } from "./gameSearchTypes";

export interface UseGameSearchOptions {
  debounceMs: number;
  minQueryLength?: number;
  initialQuery?: string;
}

export interface UseGameSearchResult {
  query: string;
  setQuery: (query: string) => void;
  normalizedQuery: string;
  results: GameSearchResult[];
  loading: boolean;
  error: unknown;
  clear: () => void;
}

const DEFAULT_MIN_QUERY_LENGTH = 2;

export function useGameSearch(
  options: UseGameSearchOptions
): UseGameSearchResult {
  const {
    debounceMs,
    minQueryLength = DEFAULT_MIN_QUERY_LENGTH,
    initialQuery = "",
  } = options;

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GameSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery.length < minQueryLength) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const timeoutId = window.setTimeout(async () => {
      setLoading(true);

      try {
        const items = await searchSteamStore(normalizedQuery);

        if (cancelled) {
          return;
        }

        const mapped = items.map(mapSteamStoreSearchItemToGameSearchResult);
        setResults(mapped);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }

        setResults([]);
        setError(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [normalizedQuery, debounceMs, minQueryLength]);

  const clear = useCallback(() => {
    setQuery("");
  }, []);

  return {
    query,
    setQuery,
    normalizedQuery,
    results,
    loading,
    error,
    clear,
  };
}
