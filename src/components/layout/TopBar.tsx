import { Bell, Menu, Sparkles } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useSearch } from "../../context/SearchContext";
import { useGameDetails } from "../../context/GameDetailsContext";
import PackagesToolbarSearch from "../packages/PackagesToolbarSearch";
import type { StoreSearchDropdownItem } from "../packages/PackagesToolbar";

type TopBarProps = {
  onOpenSidebar: () => void;
  activePage: AppPage;
  onNavigate?: (page: AppPage) => void;
  sidebarDrawerMode?: boolean;
};

export default function TopBar({ onOpenSidebar, activePage, onNavigate, sidebarDrawerMode }: TopBarProps) {
  const { setQuery } = useSearch();
  const { selectGame } = useGameDetails();
  const showSearch = activePage !== "store";

  function handleSelectItem(item: StoreSearchDropdownItem) {
    setQuery(item.title);
    selectGame({
      appId: item.appId,
      title: item.title,
      imageUrl: item.imageUrl,
    });
    onNavigate?.("game-details");
  }

  function handleSubmit(query: string) {
    setQuery(query);
    onNavigate?.("global-search");
  }

  function handleViewAll(query: string) {
    setQuery(query);
    onNavigate?.("global-search");
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {sidebarDrawerMode && (
          <button
            onClick={onOpenSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-(--color-text) hover:bg-white/8"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        {showSearch && (
          <PackagesToolbarSearch
            variant="topbar"
            placeholder="Search Steam games..."
            onSelectItem={handleSelectItem}
            onSubmit={handleSubmit}
            onViewAll={handleViewAll}
          />
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
