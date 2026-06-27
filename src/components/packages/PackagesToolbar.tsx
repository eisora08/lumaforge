import { useEffect, useMemo, useRef, useState } from "react";

import {
  ArrowRight,
  Filter,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import type { ApiProviderId } from "../../types/provider";
import type { ProviderFilter } from "../../types/providerSearch";

export type StoreSearchDropdownItem = {
  appId: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  priceLabel?: string;
  discountLabel?: string;
  providerLabel?: string;
  installed?: boolean;
};

type PackagesToolbarProps = {
  query: string;
  selectedProvider: ProviderFilter;
  onQueryChange: (query: string) => void;
  onProviderChange: (provider: ProviderFilter) => void;

  searchItems?: StoreSearchDropdownItem[];
  searchLoading?: boolean;
  onSelectSearchItem?: (item: StoreSearchDropdownItem) => void;
  onSubmitSearch?: () => void;
  onViewAllSearchResults?: () => void;

  compact?: boolean;
  showProviderControls?: boolean;
  showFiltersButton?: boolean;
};

const MAX_VISIBLE_SEARCH_ITEMS = 6;

const providerOptions: {
  label: string;
  value: ApiProviderId | "all";
}[] = [
  { label: "All Providers", value: "all" },
  { label: "HubcapDB", value: "hubcapdb" },
  { label: "Ryuu", value: "ryuu" },
  { label: "TwentyTwo Cloud", value: "twentytwo-cloud" },
  { label: "Sushi", value: "sushi" },
  { label: "Custom API", value: "custom" },
];

export default function PackagesToolbar({
  query,
  selectedProvider,
  onQueryChange,
  onProviderChange,
  searchItems = [],
  searchLoading = false,
  onSelectSearchItem,
  onSubmitSearch,
  onViewAllSearchResults,
  compact = false,
  showProviderControls,
  showFiltersButton,
}: PackagesToolbarProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const normalizedQuery = query.trim();

  const visibleSearchItems = useMemo(() => {
    return searchItems.slice(0, MAX_VISIBLE_SEARCH_ITEMS);
  }, [searchItems]);

  const hasMoreResults = searchItems.length > MAX_VISIBLE_SEARCH_ITEMS;

  const shouldShowDropdown =
    dropdownOpen &&
    normalizedQuery.length > 0 &&
    (searchLoading || visibleSearchItems.length > 0);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const wrapper = wrapperRef.current;

      if (!wrapper) {
        return;
      }

      if (!wrapper.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleSelectItem(item: StoreSearchDropdownItem) {
    setDropdownOpen(false);
    onSelectSearchItem?.(item);
  }

  function handleViewAll() {
    setDropdownOpen(false);
    onViewAllSearchResults?.();
  }

  const showProvider = showProviderControls ?? !compact;
  const showFilterBtn = showFiltersButton ?? !compact;

  const searchSection = (
    <div ref={wrapperRef} className="relative">
      <div className="flex h-10 items-center gap-2.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3.5">
        <Search className="h-4 w-4 shrink-0 text-(--color-muted)" />

        <input
          value={query}
          onFocus={() => {
            if (normalizedQuery.length > 0) {
              setDropdownOpen(true);
            }
          }}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setDropdownOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setDropdownOpen(false);
              onSubmitSearch?.();
            }

            if (event.key === "Escape") {
              setDropdownOpen(false);
            }
          }}
          placeholder="Search the Store..."
          className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
        />
      </div>

      {shouldShowDropdown && (
        <div className="absolute left-1/2 top-12 z-50 w-[480px] -translate-x-1/2 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/95 shadow-2xl backdrop-blur-xl">
          {searchLoading ? (
            <div className="p-5 text-center text-sm text-(--color-muted)">
              <div className="mx-auto mb-2 h-5 w-5 animate-pulse rounded-full bg-(--color-accent)/40" />
              Searching Steam Store...
            </div>
          ) : (
            <>
              <div className="max-h-[420px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                <div className="p-2">
                  {visibleSearchItems.map((item, index) => (
                    <div key={item.appId}>
                      <button
                        type="button"
                        onClick={() => handleSelectItem(item)}
                        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/10"
                      >
                        <div className="h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-white/5">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <Search className="h-5 w-5 text-(--color-muted)" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-1 text-sm font-semibold text-(--color-text)">
                                {item.title}
                              </p>

                              {item.subtitle && (
                                <p className="mt-0.5 line-clamp-1 text-xs text-(--color-muted)">
                                  {item.subtitle}
                                </p>
                              )}
                            </div>

                            <div className="shrink-0 text-right">
                              {item.discountLabel && (
                                <span className="rounded-md bg-lime-500/20 px-2 py-0.5 text-[11px] font-bold text-lime-300">
                                  {item.discountLabel}
                                </span>
                              )}

                              {item.priceLabel && (
                                <p className="mt-0.5 text-xs font-semibold text-(--color-text)">
                                  {item.priceLabel}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {item.installed && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                Installed
                              </span>
                            )}

                            {item.providerLabel && (
                              <span className="rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-2 py-0.5 text-[10px] text-(--color-accent)">
                                {item.providerLabel}
                              </span>
                            )}

                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
                              AppID {item.appId}
                            </span>
                          </div>
                        </div>
                      </button>

                      {index < visibleSearchItems.length - 1 && (
                        <div className="mx-2 border-t border-white/5" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {(hasMoreResults || normalizedQuery.length > 0) && (
                <button
                  type="button"
                  onClick={handleViewAll}
                  className="flex w-full items-center justify-between border-t border-white/10 px-5 py-3.5 text-sm text-(--color-text) transition hover:bg-white/5"
                >
                  <span className="font-medium">
                    View all results for "{normalizedQuery}"
                  </span>

                  <ArrowRight className="h-4 w-4 text-(--color-muted)" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="w-full max-w-[420px]">
        {searchSection}
      </div>
    );
  }

  return (
    <section className="lf-surface rounded-2xl border p-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px_auto]">
        <div className="min-w-0 xl:max-w-[480px]">
          {searchSection}
        </div>

        {showProvider && (
          <div className="flex h-11 items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4">
            <Filter className="h-4 w-4 text-(--color-muted)" />

            <select
              value={selectedProvider}
              onChange={(event) =>
                onProviderChange(event.target.value as ProviderFilter)
              }
              className="w-full bg-transparent text-sm text-(--color-text) outline-none"
            >
              {providerOptions.map((provider) => (
                <option
                  key={provider.value}
                  value={provider.value}
                  className="bg-black text-white"
                >
                  {provider.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {showFilterBtn && (
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </button>
        )}
      </div>
    </section>
  );
}
