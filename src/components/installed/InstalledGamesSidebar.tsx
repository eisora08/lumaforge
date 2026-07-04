import { Search } from "lucide-react";
import type { InstalledLibraryGame } from "../../types/installedLibrary";

type InstalledGamesSidebarProps = {
  games: InstalledLibraryGame[];
  selectedAppId: string | null;
  query: string;
  filter: "all" | "active" | "disabled";
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: "all" | "active" | "disabled") => void;
  onSelectGame: (game: InstalledLibraryGame) => void;
};

function getImageUrl(game: InstalledLibraryGame): string | undefined {
  return (
    game.imageUrl ||
    game.metadata?.header_image ||
    game.metadata?.capsule_image ||
    game.metadata?.capsule_image_v5 ||
    undefined
  );
}

export default function InstalledGamesSidebar({
  games,
  selectedAppId,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onSelectGame,
}: InstalledGamesSidebarProps) {
  const allCount = games.length;
  const activeCount = games.filter((g) => g.installStatus === "active").length;
  const disabledCount = games.filter((g) => g.installStatus === "disabled").length;
  const luaReadyCount = games.filter((g) => g.hasAvailableSource).length;

  return (
    <aside className="flex h-full flex-col border-r border-(--surface-active-border) bg-white/[0.02]">
      <div className="shrink-0 space-y-1 border-b border-(--surface-active-border) p-3">
        <button
          type="button"
          onClick={() => onFilterChange("all")}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
            filter === "all"
              ? "bg-(--color-accent)/10 text-(--color-accent)"
              : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
          }`}
        >
          <span className="font-medium">All Games</span>
          <span className="ml-auto text-xs opacity-60">{allCount}</span>
        </button>

        <button
          type="button"
          onClick={() => onFilterChange("active")}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
            filter === "active"
              ? "bg-(--color-accent)/10 text-(--color-accent)"
              : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
          }`}
        >
          <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-medium">Installed</span>
          <span className="ml-auto text-xs opacity-60">{activeCount}</span>
        </button>

        <button
          type="button"
          onClick={() => onFilterChange("active")}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
            filter === "active"
              ? "bg-(--color-accent)/10 text-(--color-accent)"
              : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
          }`}
        >
          <span className="flex h-2 w-2 rounded-full bg-(--color-accent)" />
          <span className="font-medium">Lua Ready</span>
          <span className="ml-auto text-xs opacity-60">{luaReadyCount}</span>
        </button>

        <button
          type="button"
          onClick={() => onFilterChange("disabled")}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
            filter === "disabled"
              ? "bg-(--color-accent)/10 text-(--color-accent)"
              : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
          }`}
        >
          <span className="flex h-2 w-2 rounded-full bg-zinc-400" />
          <span className="font-medium">Disabled</span>
          <span className="ml-auto text-xs opacity-60">{disabledCount}</span>
        </button>
      </div>

      <div className="shrink-0 border-b border-(--surface-active-border) p-3">
        <div className="flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-(--color-muted)" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search games..."
            className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
          />
        </div>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {games.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-(--color-muted)">
            No games found
          </p>
        ) : (
          games.map((game) => {
            const isSelected = game.appId === selectedAppId;
            const imageUrl = getImageUrl(game);

            return (
              <button
                key={"sidebar:installed:steam:" + game.appId}
                type="button"
                onClick={() => onSelectGame(game)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  isSelected
                    ? "bg-(--color-accent)/10 ring-1 ring-(--color-accent)/20"
                    : "hover:bg-white/5"
                }`}
              >
                <div className="h-10 w-[72px] shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-[10px] text-(--color-muted)">
                        {game.appId}
                      </span>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </p>

                  <div className="mt-0.5 flex items-center gap-2">
                    {game.installStatus === "active" && (
                      <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    )}
                    {game.installStatus === "disabled" && (
                      <span className="flex h-1.5 w-1.5 rounded-full bg-zinc-400" />
                    )}
                    <span className="text-[11px] text-(--color-muted)">
                      App {game.appId}
                    </span>
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
