import { useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Loader2, Search } from "lucide-react";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry, GameMediaCacheEntry } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import {
  localPathToUrl,
  isHttpUrl,
  isLocalPath,
  getMediaCacheForAppId,
} from "../../services/libraryLocalCacheService";
import { loadGameAppInfoWithMediaFallback } from "../../services/gameCacheService";
import type { GameAppInfo } from "../../services/gameCacheService";
import { resolveGameMediaImageSrc } from "../../services/localImageSrc";

type Props = {
  onOpenGame?: () => void;
};

function getSidebarImage(
  game: LibraryGame,
  mode: "landscape" | "poster",
  appInfoEntry?: LibraryAppInfoEntry | null,
  mediaEntry?: GameMediaCacheEntry | null,
  canonicalAppInfo?: GameAppInfo | null,
): string | undefined {
  const meta = game.metadata;

  if (mode === "poster") {
    return (
      canonicalAppInfo?.media?.coverPath ||
      canonicalAppInfo?.media?.landscapePath ||
      mediaEntry?.cover_path ||
      mediaEntry?.grid_path ||
      mediaEntry?.quick_cover_path ||
      mediaEntry?.icon_path ||
      appInfoEntry?.cover_path ||
      appInfoEntry?.grid_path ||
      appInfoEntry?.icon_path ||
      appInfoEntry?.header_image ||
      game.imageUrl ||
      meta?.capsule_image_v5 ||
      meta?.capsule_image ||
      meta?.header_image ||
      undefined
    );
  }

  // Landscape sidebar: canonical landscape first, cover fallback last
  const canonicalLandscape = canonicalAppInfo?.media?.landscapePath;
  if (canonicalLandscape) return canonicalLandscape;

  const localLandscape = mediaEntry?.grid_path;
  if (localLandscape) return localLandscape;

  const appInfoLandscape = appInfoEntry?.grid_path;
  if (appInfoLandscape) return appInfoLandscape;

  if (game.imageUrl) return game.imageUrl;

  const remoteLandscape = meta?.header_image || meta?.library_hero_image || meta?.hero_image || meta?.background_image;
  if (remoteLandscape) return remoteLandscape;

  // Fallback: local cover
  const canonicalCover = canonicalAppInfo?.media?.coverPath;
  if (canonicalCover) return canonicalCover;

  const localCover = mediaEntry?.cover_path || mediaEntry?.quick_cover_path || mediaEntry?.icon_path;
  if (localCover) return localCover;

  const appInfoFallback = appInfoEntry?.cover_path || appInfoEntry?.icon_path || appInfoEntry?.header_image;
  if (appInfoFallback) return appInfoFallback;

  return meta?.capsule_image_v5 || meta?.capsule_image || undefined;
}

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (isHttpUrl(src)) return src;
  if (isLocalPath(src)) return localPathToUrl(src) ?? undefined;
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
  const [mediaCacheMap, setMediaCacheMap] = useState<Record<string, GameMediaCacheEntry | null>>({});
  const [canonicalInfoMap, setCanonicalInfoMap] = useState<Record<string, GameAppInfo | null>>({});
  const [diskFallbackMap, setDiskFallbackMap] = useState<Record<string, string | null>>({});
  const loadedAppIds = useRef<Set<string>>(new Set());
  const canonicalLoadedAppIds = useRef<Set<string>>(new Set());

  // Load media cache + canonical appinfo for all games as they become available
  useEffect(() => {
    const ids = games.map((g) => g.appId).filter(Boolean) as string[];
    if (ids.length === 0) return;
    const allIds = [...new Set(ids)];

    // Media cache
    const newMediaIds = allIds.filter((id) => !loadedAppIds.current.has(id));
    if (newMediaIds.length > 0) {
      const batch = newMediaIds.slice(0, 20);
      let cancelled = false;
      for (const id of batch) loadedAppIds.current.add(id);
      Promise.all(
        batch.map(async (appId) => {
          try {
            const entry = await getMediaCacheForAppId(appId);
            return [appId, entry] as const;
          } catch {
            return [appId, null] as const;
          }
        })
      ).then((results) => {
        if (cancelled) return;
        const map: Record<string, GameMediaCacheEntry | null> = {};
        for (const [appId, entry] of results) {
          map[appId] = entry;
        }
        setMediaCacheMap((prev) => ({ ...prev, ...map }));
      });
    }

    // Canonical appinfo (with disk fallback)
    const newCanonicalIds = allIds.filter((id) => !canonicalLoadedAppIds.current.has(id));
    if (newCanonicalIds.length > 0) {
      const batch = newCanonicalIds.slice(0, 20);
      let cancelled2 = false;
      for (const id of batch) canonicalLoadedAppIds.current.add(id);
      Promise.all(
        batch.map(async (appId) => {
          try {
            const info = await loadGameAppInfoWithMediaFallback(appId);
            return [appId, info] as const;
          } catch {
            return [appId, null] as const;
          }
        })
      ).then((results) => {
        if (cancelled2) return;
        const map: Record<string, GameAppInfo | null> = {};
        const diskFallbackIds: string[] = [];
        for (const [appId, info] of results) {
          map[appId] = info;
          if (!info?.media?.landscapePath && !info?.media?.coverPath) {
            diskFallbackIds.push(appId);
          }
        }
        setCanonicalInfoMap((prev) => ({ ...prev, ...map }));
        // Direct disk check for entries with no media
        if (diskFallbackIds.length > 0) {
          Promise.all(
            diskFallbackIds.map(async (appId) => {
              const src = await resolveGameMediaImageSrc(appId);
              return [appId, src] as const;
            })
          ).then((fbResults) => {
            if (cancelled2) return;
            const fbMap: Record<string, string | null> = {};
            for (const [appId, src] of fbResults) {
              if (src) fbMap[appId] = src;
            }
            setDiskFallbackMap((prev) => ({ ...prev, ...fbMap }));
          }).catch(() => {});
        }
      });
    }
  }, [games]);

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
            const mediaEntry = game.appId ? (mediaCacheMap[game.appId] ?? null) : null;
            const canonicalInfo = game.appId ? (canonicalInfoMap[game.appId] ?? null) : null;
            const diskFallbackSrc = game.appId ? (diskFallbackMap[game.appId] ?? null) : null;
            const thumb = getSidebarImage(game, settings.libraryCardArtworkMode, appInfoEntry, mediaEntry, canonicalInfo) || diskFallbackSrc || undefined;
            const resolvedThumb = resolveImageSrc(thumb);
            const sidebarFallbackPath = thumb && isLocalPath(thumb) ? thumb : null;
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
                <div className="relative h-6 w-10 shrink-0 overflow-hidden rounded object-cover">
                  {resolvedThumb ? (
                    <AsyncImage
                      src={resolvedThumb}
                      alt=""
                      className="h-full w-full object-cover"
                      fallbackLocalPath={sidebarFallbackPath}
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
