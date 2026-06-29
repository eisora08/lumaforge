import { useEffect, useState } from "react";
import { ArrowLeft, Gamepad2, Search } from "lucide-react";
import PageContainer from "../components/layout/PageContainer";
import { useSearch } from "../context/SearchContext";
import { useGameDetails } from "../context/GameDetailsContext";
import { searchSteamStore } from "../services/steamStoreSearchResolver";
import type { SteamStoreSearchItem } from "../types/steamStoreSearch";

type Props = {
  onBack?: () => void;
  onNavigate?: (page: string) => void;
};

export default function GlobalSearchResults({ onBack, onNavigate }: Props) {
  const { query } = useSearch();
  const { selectGame } = useGameDetails();

  const [items, setItems] = useState<SteamStoreSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    searchSteamStore(query.trim())
      .then((steamResults) => {
        setItems(steamResults);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Search failed");
        setItems([]);
        setLoading(false);
      });
  }, [query]);

  function handleSelectItem(item: SteamStoreSearchItem) {
    selectGame({
      appId: String(item.app_id),
      title: item.name,
      imageUrl: item.image_url || undefined,
    });
    onNavigate?.("game-details");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02] px-5 py-3 lg:px-7">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-(--color-muted) transition hover:text-(--color-text)"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageContainer className="py-6 lg:py-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-(--color-accent)/20 bg-(--color-accent)/10">
              <Search className="h-5 w-5 text-(--color-accent)" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-(--color-text) lg:text-2xl">
                Search Results for "{query}"
              </h1>
              {!loading && (
                <p className="mt-0.5 text-sm text-(--color-muted)">
                  {items.length} result{items.length === 1 ? "" : "s"} found
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

          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
              <p className="font-semibold text-(--color-text)">Search failed</p>
              <p className="mt-1.5 text-sm text-(--color-muted)">{error}</p>
            </div>
          )}

          {!loading && !error && items.length === 0 && query.trim() && (
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

          {!loading && items.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <button
                  key={item.app_id}
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  className="flex items-center gap-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
                >
                  <div className="h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-white/5">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
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
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs text-(--color-muted)">
                      AppID {item.app_id}
                    </p>
                    {item.discount_label && (
                      <span className="mt-1.5 inline-block rounded-md bg-lime-500/20 px-2 py-0.5 text-[11px] font-bold text-lime-300">
                        {item.discount_label}
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
