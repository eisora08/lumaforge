import { useEffect, useMemo } from "react";
import { Gamepad2, Search } from "lucide-react";
import PageContainer from "../components/layout/PageContainer";
import { useSearch } from "../context/SearchContext";
import { useGameDetails } from "../context/GameDetailsContext";
import { useGameSearch } from "../features/search/useGameSearch";
import { useGameOwnershipLookup } from "../features/search/useGameOwnershipLookup";
import { enrichGameSearchResult } from "../features/search/gameSearchMapper";
import type { GameSearchResult } from "../features/search/gameSearchTypes";

type Props = {
  onBack?: () => void;
  onNavigate?: (page: string) => void;
};

export default function GlobalSearchResults({ onBack: _onBack, onNavigate }: Props) {
  const { query: searchContextQuery } = useSearch();
  const { selectGame } = useGameDetails();

  const {
    setQuery,
    results,
    loading,
    error,
  } = useGameSearch({ debounceMs: 0, minQueryLength: 1 });

  const ownershipLookup = useGameOwnershipLookup();

  const enrichedResults = useMemo(() => {
    return results.map((result) => {
      return enrichGameSearchResult(result, {
        owned: ownershipLookup.isOwned(result.appId),
        installed: ownershipLookup.isSteamInstalled(result.appId),
        luaActive: ownershipLookup.isLuaActive(result.appId),
      });
    });
  }, [results, ownershipLookup]);

  const displayError = error
    ? error instanceof Error
      ? error.message
      : String(error)
    : null;

  useEffect(() => {
    setQuery(searchContextQuery);
  }, [searchContextQuery, setQuery]);

  function handleSelectItem(result: GameSearchResult) {
    selectGame({
      appId: result.appId,
      title: result.title,
      imageUrl: result.imageUrl,
    });
    onNavigate?.("store");
  }

  return (
    <div className="flex h-full flex-col lf-page-in">
      {/* Back button handled by TopBar via BackButtonContext */}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageContainer className="py-6 lg:py-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-(--color-accent)/20 bg-(--color-accent)/10">
              <Search className="h-5 w-5 text-(--color-accent)" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-(--color-text) lg:text-2xl">
                Search Results for "{searchContextQuery}"
              </h1>
              {!loading && (
                <p className="mt-0.5 text-sm text-(--color-muted)">
                  {results.length} result{results.length === 1 ? "" : "s"} found
                </p>
              )}
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-(--color-muted)">
                <div className="h-5 w-5 animate-pulse rounded-full bg-(--color-accent)/40" />
                <span className="text-sm">Searching Steam Store...</span>
              </div>
            </div>
          )}

          {displayError && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
              <p className="font-semibold text-(--color-text)">Search failed</p>
              <p className="mt-1.5 text-sm text-(--color-muted)">{displayError}</p>
            </div>
          )}

          {!loading && !displayError && results.length === 0 && searchContextQuery.trim() && (
            <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
              <Gamepad2 className="mx-auto h-10 w-10 text-(--color-muted)" />
              <h2 className="mt-4 font-semibold text-(--color-text)">
                No results found
              </h2>
              <p className="mt-1.5 text-sm text-(--color-muted)">
                Try a different search term.
              </p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {enrichedResults.map((result) => (
                <button
                  key={result.appId}
                  type="button"
                  onClick={() => handleSelectItem(result)}
                  className="flex items-center gap-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
                >
                  <div className="h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-white/5">
                    {result.imageUrl ? (
                      <img
                        src={result.imageUrl}
                        alt={result.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Gamepad2 className="h-6 w-6 text-(--color-muted)" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold text-(--color-text)">
                      {result.title}
                    </p>
                    <p className="mt-1 text-xs text-(--color-muted)">
                      AppID {result.appId}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {result.owned && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                          Owned
                        </span>
                      )}
                      {!result.installed && result.inLibrary && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                          In Library
                        </span>
                      )}
                      {result.installed && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Installed
                        </span>
                      )}
                    </div>
                    {result.discountLabel && (
                      <span className="mt-1.5 inline-block rounded-md bg-lime-500/20 px-2 py-0.5 text-[11px] font-bold text-lime-300">
                        {result.discountLabel}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </PageContainer>
      </div>
    </div>
  );
}
