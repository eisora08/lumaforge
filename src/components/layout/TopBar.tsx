import { useEffect, useState } from "react";
import { Bell, Menu, Sparkles } from "lucide-react";
import type { AppPage } from "../../types/navigation";
import { useSearch } from "../../context/SearchContext";
import { useGameDetails } from "../../context/GameDetailsContext";
import PackagesToolbarSearch from "../packages/PackagesToolbarSearch";
import type { StoreSearchDropdownItem } from "../packages/PackagesToolbar";
import PackageUpdatePanel from "../notifications/PackageUpdatePanel";

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
  const [luaUpdateCount, setLuaUpdateCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("../../services/installedLuaScanner").then((mod) => {
      if (cancelled) return;
      setLuaUpdateCount(mod.getUpdateCount());
      const unsub = mod.subscribeUpdateStatus(() => {
        if (!cancelled) setLuaUpdateCount(mod.getUpdateCount());
      });
      return unsub;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

  function handleBellClick() {
    if (showPanel) {
      console.log("[NOTIFICATIONS][PANEL_CLOSE]");
    } else {
      const count = luaUpdateCount;
      console.log(`[NOTIFICATIONS][PANEL_OPEN] updates=${count}`);
    }
    setShowPanel((prev) => !prev);
  }

  function handlePanelClose() {
    setShowPanel(false);
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

        <div className="relative">
          <button
            onClick={handleBellClick}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 transition hover:bg-white/8"
          >
            <Bell className="h-4 w-4 text-(--color-muted)" />
            {luaUpdateCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium leading-tight text-white">
                {luaUpdateCount > 9 ? "9+" : luaUpdateCount}
              </span>
            )}
          </button>

          {showPanel && (
            <PackageUpdatePanel onClose={handlePanelClose} onNavigate={onNavigate ?? (() => {})} />
          )}
        </div>
      </div>
    </header>
  );
}
