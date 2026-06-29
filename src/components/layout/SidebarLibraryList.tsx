import { useMemo, useState } from "react";
import { Gamepad2, Loader2, Search } from "lucide-react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import { localPathToUrl, isHttpUrl, isLocalPath } from "../../services/libraryLocalCacheService";

type Props = {
  onOpenGame?: () => void;
};

function getSidebarImage(
  game: LibraryGame,
  mode: "landscape" | "poster",
  appInfoEntry?: LibraryAppInfoEntry | null,
): string | undefined {
  const meta = game.metadata;

  // Local cache priority: iconPath > covers/{appid}.jpg > gridPath > coverPath > headerImage
  const localImages: string[] = [];
  if (appInfoEntry?.icon_path) localImages.push(appInfoEntry.icon_path);
  if (appInfoEntry?.cover_path) localImages.push(appInfoEntry.cover_path);
  if (appInfoEntry?.grid_path) localImages.push(appInfoEntry.grid_path);
  if (appInfoEntry?.header_image) localImages.push(appInfoEntry.header_image);

  if (mode === "poster") {
    return (
      localImages.find(Boolean) ||
      game.imageUrl ||
      meta?.capsule_image_v5 ||
      meta?.capsule_image ||
      meta?.header_image ||
      undefined
    );
  }
  return (
    localImages.find(Boolean) ||
    game.imageUrl ||
    meta?.header_image ||
    meta?.capsule_image_v5 ||
    meta?.capsule_image ||
    undefined
  );
}

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (isHttpUrl(src)) return src;
  if (isLocalPath(src)) return localPathToUrl(src);
  return src;
}

function getSidebarTitle(game: LibraryGame, appInfoEntry?: LibraryAppInfoEntry | null): string {
  if (appInfoEntry?.name) return appInfoEntry.name;
  return game.title || (game.appId ? `Steam App ${game.appId}` : "Unknown Game");
}

export default function SidebarLibraryList({ onOpenGame }: Props) {
  const { games, selectedGame, setSelectedGame, loading, initialLoading, appInfoMap } = useLibraryGames();
  const { settings } = useSettings();
  const { getState } = useGameSession();
  const [query, setQuery] = useState("");

  const installed = useMemo(() => {
    return games.filter((g) => g.isPlayable || g.steamInstalled || (g.source === "local" && !!g.executablePath));
  }, [games]);

  const filtered = useMemo(() => {
    if (!query) return installed;
    const q = query.toLowerCase();
    return installed.filter((g) => {
      const entry = g.appId ? appInfoMap[g.appId] : undefined;
      const displayName = entry?.name || g.title;
      return displayName.toLowerCase().includes(q) || g.appId?.toLowerCase().includes(q);
    });
  }, [installed, query, appInfoMap]);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
         <Gamepad2 className="h-4.5 w-4.5" />
        <span className="text-xs font-bold text-(--color-text)">Juegos</span>
        <span className="text-[10px] text-(--color-muted)">{installed.length} games</span>
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search library..."
          className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 py-1.5 pl-7 pr-2.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
        />
      </div>

      <div className="max-h-[40vh] space-y-0.5 overflow-y-auto lf-scroll-area">
        {(initialLoading || (loading && games.length === 0)) ? (
          <div className="space-y-1 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <SkeletonBox className="h-6 w-10 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-1">
                  <SkeletonBox className="h-3 w-3/4" />
                  <SkeletonBox className="h-2 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-2 text-center text-[10px] text-(--color-muted)">No games match.</p>
        ) : (
          filtered.map((game) => {
            const isSelected = selectedGame?.id === game.id;
            const appInfoEntry = game.appId ? (appInfoMap[game.appId] ?? null) : null;
            const thumb = getSidebarImage(game, settings.libraryCardArtworkMode, appInfoEntry);
            const resolvedThumb = resolveImageSrc(thumb);
            const displayTitle = getSidebarTitle(game, appInfoEntry);
            const gk = computeGameKey(game);
            const gs = getState(gk);
            const isRunning = gs === "running";
            const isLaunching = gs === "launching";
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => {
                  setSelectedGame(game);
                  onOpenGame?.();
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  isSelected
                    ? "bg-(--color-accent)/10 text-(--color-accent)"
                    : "text-(--color-text) hover:bg-white/5"
                }`}
              >
                <div className="relative h-6 w-10 shrink-0 overflow-hidden rounded">
                  {resolvedThumb ? (
                    <AsyncImage
                      src={resolvedThumb}
                      alt=""
                      className="h-full w-full"
                      fallback={
                        <Gamepad2 className="h-3 w-3 text-(--color-muted)" />
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Gamepad2 className="h-3 w-3 text-(--color-muted)" />
                    </div>
                  )}
                  {isRunning && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black/50" />
                  )}
                  {isLaunching && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-3 w-3 animate-spin text-white" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isRunning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
                    <span className="truncate font-medium leading-tight">{displayTitle}</span>
                  </div>
                  <div className="text-[10px] text-(--color-muted)">
                    {isRunning ? "Running" : isLaunching ? "Launching" : game.source === "steam" ? "Steam" : game.source === "local" ? "Local" : "Lua"}
                    {!isRunning && !isLaunching && game.hasUpdate && " · Update"}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
