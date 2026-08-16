import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Clock, Search, X } from "lucide-react";

import type { StoreSearchDropdownItem } from "./PackagesToolbar";
import {
  enrichGameSearchResult,
  mapEnrichedGameSearchResultToStoreSearchDropdownItem,
} from "../../features/search/gameSearchMapper";
import { useGameOwnershipLookup } from "../../features/search/useGameOwnershipLookup";
import { useGameSearch } from "../../features/search/useGameSearch";
import { SkeletonBox } from "../common/Skeleton";

type PackagesToolbarSearchProps = {
  variant?: "topbar" | "store" | "toolbar";
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onSelectItem?: (item: StoreSearchDropdownItem) => void;
  onSubmit?: (query: string) => void;
  onViewAll?: (query: string) => void;
};

const MAX_VISIBLE_SEARCH_ITEMS = 6;
const MAX_RECENT_SEARCHES = 8;
const RECENT_SEARCHES_KEY = "lumaforge-recent-searches";
const SEARCH_DEBOUNCE_MS = 300;

function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const existing = getRecentSearches();
  const filtered = existing.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
  const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
}

function removeRecentSearch(query: string): void {
  const existing = getRecentSearches();
  const updated = existing.filter((s) => s !== query);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
}

export default function PackagesToolbarSearch({
  variant = "toolbar",
  className,
  placeholder = "Search the Store...",
  autoFocus,
  inputRef: externalInputRef,
  onSelectItem,
  onSubmit,
  onViewAll,
}: PackagesToolbarSearchProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => getRecentSearches());
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Sync internal ref to external ref when provided
  useEffect(() => {
    if (externalInputRef) {
      (externalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = internalInputRef.current;
    }
  });

  const {
    query,
    setQuery,
    normalizedQuery,
    results,
    loading: searchLoading,
  } = useGameSearch({ debounceMs: SEARCH_DEBOUNCE_MS });

  const ownershipLookup = useGameOwnershipLookup();

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const wrapper = wrapperRef.current;

      if (!wrapper) {
        return;
      }

      if (dropdownRef.current?.contains(event.target as Node)) return;
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

  const dropdownItems: StoreSearchDropdownItem[] = useMemo(() => {
    return results.map((result) => {
      const luaActive = ownershipLookup.isLuaActive(result.appId);
      const enriched = enrichGameSearchResult(result, {
        owned: ownershipLookup.isOwned(result.appId),
        installed: ownershipLookup.isSteamInstalled(result.appId),
        luaActive,
      });
      console.log(`[GLOBAL_SEARCH][RESULT_STATE] appid=${enriched.appId} owned=${enriched.owned} installed=${enriched.installed} luaInstalled=${luaActive} inLibrary=${enriched.inLibrary} badges=${enriched.badges.join(",") || "none"}`);
      return mapEnrichedGameSearchResultToStoreSearchDropdownItem(enriched);
    });
  }, [results, ownershipLookup]);

  const visibleSearchItems = useMemo(() => {
    return dropdownItems.slice(0, MAX_VISIBLE_SEARCH_ITEMS);
  }, [dropdownItems]);

  const hasMoreResults = results.length > MAX_VISIBLE_SEARCH_ITEMS;

  const hasRecentSearches = recentSearches.length > 0;

  const shouldShowDropdown =
    dropdownOpen &&
    (normalizedQuery.length > 0
      ? searchLoading || visibleSearchItems.length > 0
      : hasRecentSearches);

  function handleSelectItem(item: StoreSearchDropdownItem) {
    saveRecentSearch(item.title);
    setRecentSearches(getRecentSearches());
    setDropdownOpen(false);
    setQuery("");
    onSelectItem?.(item);
  }

  function handleSubmit() {
    if (normalizedQuery.trim()) {
      saveRecentSearch(normalizedQuery);
      setRecentSearches(getRecentSearches());
    }
    setDropdownOpen(false);
    onSubmit?.(normalizedQuery);
  }

  function handleViewAll() {
    if (normalizedQuery.trim()) {
      saveRecentSearch(normalizedQuery);
      setRecentSearches(getRecentSearches());
    }
    setDropdownOpen(false);
    onViewAll?.(normalizedQuery);
  }

  function handleSelectRecent(query: string) {
    setQuery(query);
    setDropdownOpen(false);
    onSubmit?.(query);
  }

  function handleRemoveRecent(e: React.MouseEvent, query: string) {
    e.stopPropagation();
    removeRecentSearch(query);
    setRecentSearches(getRecentSearches());
  }

  const isTopbar = variant === "topbar";
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Calculate dropdown position relative to viewport when it opens
  useEffect(() => {
    if (dropdownOpen && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: isTopbar ? rect.left : rect.left + rect.width / 2 - 240,
        width: isTopbar ? rect.width : 480,
      });
    }
  }, [dropdownOpen, isTopbar]);

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      <div
        className={`flex ${isTopbar ? "h-9 w-full" : "h-10 w-full"} items-center gap-2.5 ${isTopbar ? "rounded-2xl lf-surface" : "rounded-xl bg-white/5"} border border-(--surface-active-border) px-3.5 ${isTopbar ? "px-3" : "px-3.5"}`}
      >
        <Search className="h-4 w-4 shrink-0 text-(--color-muted)" />

        <input
          ref={internalInputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => {
            setQuery(event.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => {
            setDropdownOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              handleSubmit();
            }

            if (event.key === "Escape") {
              setDropdownOpen(false);
            }
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
        />
      </div>

      {shouldShowDropdown && dropdownPos && createPortal(
        <>
          <div className="fixed inset-0 z-[99997] bg-black/40" onClick={() => setDropdownOpen(false)} />
          <div
            ref={dropdownRef}
            className="lf-popover-enter fixed z-[99998] overflow-hidden rounded-2xl border border-(--surface-active-border) lf-surface shadow-2xl"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          {searchLoading ? (
            <div className="p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl p-2.5">
                  <SkeletonBox className="h-16 w-28 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonBox className="h-3 w-3/4" />
                    <SkeletonBox className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : normalizedQuery.length === 0 && hasRecentSearches ? (
            <>
              <div className="max-h-[420px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                <div className="p-2">
                  <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-(--color-muted)">
                      Recent Searches
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.removeItem(RECENT_SEARCHES_KEY);
                        setRecentSearches([]);
                      }}
                      className="text-[11px] text-(--color-muted) transition hover:text-(--color-text)"
                    >
                      Clear all
                    </button>
                  </div>
                  {recentSearches.map((query) => (
                    <div
                      key={query}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectRecent(query)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectRecent(query); } }}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-(--color-accent)/8 active:bg-(--color-accent)/15"
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                      <span className="min-w-0 flex-1 truncate text-sm text-(--color-text)">
                        {query}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveRecent(e, query)}
                        className="shrink-0 rounded-md p-0.5 text-(--color-muted) opacity-0 transition hover:bg-white/10 hover:text-(--color-text) group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="max-h-[420px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                <div className="p-2">
                  {visibleSearchItems.map((item, index) => (
                    <div key={"search:results:steam:" + item.appId}>
                      <button
                        type="button"
                        onClick={() => handleSelectItem(item)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-(--color-accent)/8 active:bg-(--color-accent)/15 focus-visible:outline-2 focus-visible:outline-(--color-accent) focus-visible:-outline-offset-2"
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
                            {item.owned && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                                Owned
                              </span>
                            )}

                            {!item.installed && item.inLibrary && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                                In Library
                              </span>
                            )}

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
                        <div className="mx-2 border-t border-(--surface-active-border)" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {(hasMoreResults || normalizedQuery.length > 0) && (
                <button
                  type="button"
                  onClick={handleViewAll}
                  className="flex w-full cursor-pointer items-center justify-between border-t border-(--surface-active-border) px-5 py-3.5 text-sm text-(--color-text) transition-colors hover:bg-(--color-accent)/8 focus-visible:outline-2 focus-visible:outline-(--color-accent)"
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
        </>,
        document.body
      )}
    </div>
  );
}
