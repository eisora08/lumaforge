import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Menu,
  Search,
  Sparkles,
  Gamepad2,
} from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useSearch } from "../../context/SearchContext";
import { useGameDetails } from "../../context/GameDetailsContext";
import { searchSteamStore } from "../../services/steamStoreSearchResolver";
import type { SteamStoreSearchItem } from "../../types/steamStoreSearch";

type TopBarProps = {
  onOpenSidebar: () => void;
  activePage: AppPage;
  onNavigate?: (page: AppPage) => void;
};

const MAX_VISIBLE_ITEMS = 6;

export default function TopBar({ onOpenSidebar, activePage, onNavigate }: TopBarProps) {
  const { query, setQuery } = useSearch();
  const { selectGame } = useGameDetails();
  const showSearch = activePage !== "store";
  const placeholder = "Search Steam games...";

  const [searchItems, setSearchItems] = useState<SteamStoreSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery.length < 2) {
      setSearchItems([]);
      setSearchLoading(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      searchSteamStore(normalizedQuery)
        .then((items) => {
          setSearchItems(items);
          setSearchLoading(false);
        })
        .catch(() => {
          setSearchItems([]);
          setSearchLoading(false);
        });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [normalizedQuery]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
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

  const visibleItems = searchItems.slice(0, MAX_VISIBLE_ITEMS);
  const hasMoreResults = searchItems.length > MAX_VISIBLE_ITEMS;

  const shouldShowDropdown =
    dropdownOpen &&
    normalizedQuery.length > 0 &&
    (searchLoading || visibleItems.length > 0);

  function handleSelectItem(item: SteamStoreSearchItem) {
    setDropdownOpen(false);
    setQuery(item.name);
    selectGame({
      appId: String(item.app_id),
      title: item.name,
      imageUrl: item.image_url || undefined,
    });
    onNavigate?.("game-details");
  }

  function handleViewAll() {
    setDropdownOpen(false);
    onNavigate?.("global-search");
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b lf-shell px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-(--color-text) hover:bg-white/8 lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        {showSearch && (
          <div ref={dropdownRef} className="relative">
            <div className="flex h-9 w-64 items-center gap-2.5 rounded-2xl border lf-surface px-3 md:w-80">
              <Search className="h-4 w-4 shrink-0 text-(--color-muted)" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDropdownOpen(true);
                }}
                onFocus={() => {
                  if (normalizedQuery.length > 0) {
                    setDropdownOpen(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setDropdownOpen(false);
                    onNavigate?.("global-search");
                  }
                  if (event.key === "Escape") {
                    setDropdownOpen(false);
                  }
                }}
                placeholder={placeholder}
                className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
              />
            </div>

            {shouldShowDropdown && (
              <div className="absolute left-0 top-10 z-50 w-[400px] overflow-hidden rounded-2xl border border-(--surface-active-border) bg-black/95 shadow-2xl backdrop-blur-xl">
                {searchLoading ? (
                  <div className="p-5 text-center text-sm text-(--color-muted)">
                    <div className="mx-auto mb-2 h-5 w-5 animate-pulse rounded-full bg-(--color-accent)/40" />
                    Searching Steam Store...
                  </div>
                ) : (
                  <>
                    <div className="max-h-[360px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent">
                      <div className="p-2">
                        {visibleItems.map((item, index) => (
                          <div key={item.app_id}>
                            <button
                              type="button"
                              onClick={() => handleSelectItem(item)}
                              className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-white/10"
                            >
                              <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-white/5">
                                {item.image_url ? (
                                  <img
                                    src={item.image_url}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Gamepad2 className="h-5 w-5 text-(--color-muted)" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-1 text-sm font-semibold text-(--color-text)">
                                  {item.name}
                                </p>
                                <p className="mt-0.5 text-xs text-(--color-muted)">
                                  AppID {item.app_id}
                                </p>
                              </div>
                              {item.discount_label && (
                                <span className="shrink-0 rounded-md bg-lime-500/20 px-2 py-0.5 text-[11px] font-bold text-lime-300">
                                  {item.discount_label}
                                </span>
                              )}
                            </button>
                            {index < visibleItems.length - 1 && (
                              <div className="mx-2 border-t border-white/5" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {hasMoreResults && (
                      <button
                        type="button"
                        onClick={handleViewAll}
                        className="flex w-full items-center justify-between border-t border-white/10 px-5 py-3 text-sm text-(--color-text) transition hover:bg-white/5"
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
        )}
      </div>

      <div className="flex items-center gap-2">
        <button className="hidden h-9 items-center gap-2 rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 text-sm text-(--color-accent) transition hover:bg-(--color-accent)/15 sm:inline-flex">
          <Sparkles className="h-3.5 w-3.5" />
          Premium Mode
        </button>

        <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 transition hover:bg-white/8">
          <Bell className="h-4 w-4 text-(--color-muted)" />
        </button>
      </div>
    </header>
  );
}