import { useState, useCallback, useRef, useEffect } from "react";
import { Search, Loader2, ChevronDown, ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WebImageResult } from "../../services/tauri";
import { searchWebImages } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";

type Props = {
  query: string;
  onSelect: (url: string) => void;
};

export default function WebImageGrid({ query, onSelect }: Props) {
  const { t } = useTranslation();
  const [results, setResults] = useState<WebImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [source, setSource] = useState<"google" | "duckduckgo">("duckduckgo");
  const [searchQuery, setSearchQuery] = useState(query);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(
    async (q: string, src: "google" | "duckduckgo", pageNum: number, append: boolean) => {
      if (!q.trim()) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);
      try {
        const imgs = await searchWebImages(q, src, pageNum);
        if (ctrl.signal.aborted) return;
        setResults((prev) => (append ? [...prev, ...imgs] : imgs));
        setHasMore(imgs.length >= 20);
        if (imgs.length === 0 && !append) {
          setError(t("web_image_search.no_results", "No results found"));
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [t]
  );

  // Initial search on mount / query change
  useEffect(() => {
    if (query) {
      setSearchQuery(query);
      setPage(0);
      doSearch(query, source, 0, false);
    }
    return () => abortRef.current?.abort();
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    setPage(0);
    doSearch(searchQuery, source, 0, false);
  };

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    doSearch(searchQuery, source, next, true);
  };

  const handleSelect = (img: WebImageResult, idx: number) => {
    setSelectedIdx(idx);
    onSelect(img.url);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as "google" | "duckduckgo")}
          className="rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--color-text)]"
        >
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
        </select>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("web_image_search.placeholder", "Search images...")}
          className="flex-1 rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {t("web_image_search.search", "Search")}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {results.map((img, idx) => (
            <button
              key={`${img.url}-${idx}`}
              onClick={() => handleSelect(img, idx)}
              className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 ${
                selectedIdx === idx
                  ? "border-(--color-accent) ring-2 ring-(--color-accent)/30"
                  : "border-transparent hover:ring-1 hover:ring-[var(--surface-active-border)]"
              }`}
            >
              <div className="aspect-square bg-[var(--surface-1)]">
                <AsyncImage
                  src={img.thumb || img.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-[var(--color-muted)]" />
                    </div>
                  }
                />
              </div>
              {img.width > 0 && img.height > 0 && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center text-[10px] text-white/80 opacity-0 group-hover:opacity-100">
                  {img.width}x{img.height}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && results.length > 0 && (
        <button
          onClick={handleLoadMore}
          disabled={loading}
          className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-[var(--surface-active-border)] bg-white/5 px-3 py-1.5 text-xs text-[var(--color-text)] transition hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {t("web_image_search.load_more", "Load more")}
        </button>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <ImageIcon className="mb-2 h-8 w-8 text-[var(--color-muted)]" />
          <p className="text-xs text-[var(--color-muted)]">
            {t("web_image_search.hint", "Search for game images using Google or DuckDuckGo")}
          </p>
        </div>
      )}
    </div>
  );
}
