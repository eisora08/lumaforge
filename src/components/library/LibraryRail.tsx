import { Search } from "lucide-react";
import type { LibraryGame, LibraryFilter } from "../../types/libraryGame";
import type { LibraryAppInfoMap } from "../../services/tauri";
import { isSidebarInstalledGame } from "../../services/gameCacheService";

type LibraryRailProps = {
  games: LibraryGame[];
  selectedId: string | null;
  query: string;
  filter: LibraryFilter;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: LibraryFilter) => void;
  onSelectGame: (game: LibraryGame) => void;
  appInfoMap?: LibraryAppInfoMap;
};

function getImageUrl(game: LibraryGame, appInfoMap?: LibraryAppInfoMap): string | undefined {
  const entry = game.appId ? appInfoMap?.[game.appId] : undefined;
  return entry?.grid_path
    || entry?.cover_path
    || entry?.header_image
    || game.imageUrl
    || game.metadata?.header_image
    || game.metadata?.capsule_image
    || undefined;
}

function getTitle(game: LibraryGame, appInfoMap?: LibraryAppInfoMap): string {
  const entry = game.appId ? appInfoMap?.[game.appId] : undefined;
  return entry?.name || game.title || (game.appId ? `Steam App ${game.appId}` : "Unknown Game");
}

type Counts = Record<LibraryFilter, number>;

function computeCounts(games: LibraryGame[]): Counts {
  const counts: Counts = {
    all: games.length,
    steam: 0,
    local: 0,
    lua: 0,
    installed: 0,
    uninstalled: 0,
    "lua-ready": 0,
    disabled: 0,
    updates: 0,
  };
  for (const g of games) {
    if (g.source === "steam") counts.steam++;
    if (g.source === "local") counts.local++;
    if (g.source === "lua" || g.hasLua) counts.lua++;
    if (g.isPlayable || g.steamInstalled) counts.installed++;
    if (g.isInstallable || (!g.isPlayable && g.source === "steam")) counts.uninstalled++;
    if (g.hasLuaSource) counts["lua-ready"]++;
    if (g.isLuaDisabled) counts.disabled++;
    if (g.hasUpdate) counts.updates++;
  }
  return counts;
}

export default function LibraryRail({
  games,
  selectedId,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onSelectGame,
  appInfoMap,
}: LibraryRailProps) {
  const counts = computeCounts(games);

  const filtered = games.filter((g) => {
    if (filter !== "all") {
      if (filter === "steam" && g.source !== "steam") return false;
      if (filter === "local" && g.source !== "local") return false;
      if (filter === "lua" && !g.hasLua) return false;
      if (filter === "installed" && !isSidebarInstalledGame(g)) return false;
      if (filter === "uninstalled" && g.isPlayable) return false;
      if (filter === "lua-ready" && !g.hasLuaSource) return false;
      if (filter === "disabled" && !g.isLuaDisabled) return false;
      if (filter === "updates" && !g.hasUpdate) return false;
    }
    if (query) {
      const q = query.toLowerCase();
      const entry = g.appId ? appInfoMap?.[g.appId] : undefined;
      const displayName = entry?.name || g.title;
      const titleMatch = displayName.toLowerCase().includes(q);
      const appIdMatch = g.appId?.toLowerCase().includes(q);
      return titleMatch || appIdMatch;
    }
    return true;
  });

  const filterPills: { key: LibraryFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "steam", label: "Steam" },
    { key: "local", label: "Local" },
    { key: "lua", label: "Lua" },
    { key: "installed", label: "Installed" },
    { key: "uninstalled", label: "Not Installed" },
    { key: "lua-ready", label: "Lua Ready" },
    { key: "disabled", label: "Disabled" },
    { key: "updates", label: "Updates" },
  ];

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-(--surface-active-border) bg-white/[0.02]">
      {/* Header */}
      <div className="shrink-0 border-b border-(--surface-active-border) px-4 py-3">
        <h2 className="text-sm font-bold text-(--color-text)">Mi Biblioteca</h2>
        <p className="text-xs text-(--color-muted)">{games.length} games</p>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b border-(--surface-active-border) px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search library..."
            className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 py-1.5 pl-8 pr-3 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="shrink-0 border-b border-(--surface-active-border) px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {filterPills.map((pill) => {
            const count = counts[pill.key];
            if (count === 0) return null;
            const isActive = filter === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                onClick={() => onFilterChange(pill.key)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                  isActive
                    ? "bg-(--color-accent)/20 text-(--color-accent)"
                    : "text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                }`}
              >
                {pill.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Game list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-(--color-muted)">
            No games match.
          </div>
        ) : (
          filtered.map((game) => {
            const isSelected = game.id === selectedId;
            const imgUrl = getImageUrl(game, appInfoMap);
            const displayName = getTitle(game, appInfoMap);
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => onSelectGame(game)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                  isSelected
                    ? "bg-(--color-accent)/10 text-(--color-accent)"
                    : "text-(--color-text) hover:bg-white/5"
                }`}
              >
                <div className="h-8 w-14 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {imgUrl ? (
                    <img
                      src={imgUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-(--color-muted)">
                      <span className="text-[10px]">--</span>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{displayName}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-(--color-muted)">
                      {game.source === "steam" ? "Steam" : game.source === "local" ? "EXE" : "Lua"}
                    </span>
                    {game.isLuaDisabled && (
                      <span className="text-[10px] text-zinc-500">Disabled</span>
                    )}
                    {game.hasUpdate && (
                      <span className="text-[10px] text-yellow-500">Update</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
