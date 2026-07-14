import { useEffect, useMemo, useState } from "react";
import { Play, Clock } from "lucide-react";
import type { StartupSnapshot } from "../../services/startupSnapshotService";
import { useGameSession } from "../../context/GameSessionContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  snapshotToDisplayGame,
  manualToDisplayGame,
  getManualGamesForDashboard,
} from "../../services/dashboardManualGames";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { resolveGameMediaUrl } from "../../services/gameCacheService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppId?: string;
};

function getContinueDisplayGames(
  snapshotGames: Array<{ appId: string; lastPlayed: number | null; playtime: number | null; installed: boolean; title: string; source: string; updatedAt?: number }>,
  manualGames: Array<{ id: string; title: string; libraryId?: string }>,
  sessions: Record<string, { appId?: string; gameKey?: string; state: string }>,
  excludeAppId?: string,
): DashboardDisplayGame[] {
  const runningAppIds = new Set(
    Object.values(sessions)
      .filter((s) => s.state === "running" && s.appId)
      .map((s) => s.appId as string),
  );

  // For manual games (no appId), index by gameKey ("manual:<uuid>") so manualToDisplayGame can match g.id
  const runningGameIds = new Set(
    Object.values(sessions)
      .filter((s) => s.state === "running")
      .map((s) => s.appId || s.gameKey)
      .filter((id): id is string => Boolean(id)),
  );

  const result: DashboardDisplayGame[] = [];
  const seen = new Set<string>();
  if (excludeAppId) seen.add(excludeAppId);

  // Snapshot games → display games
  for (const sg of snapshotGames) {
    if (!sg.appId || seen.has(sg.appId)) continue;
    seen.add(sg.appId);
    const dg = snapshotToDisplayGame(sg as any, runningAppIds);
    result.push(dg);
  }

  // Manual games → display games
  for (const mg of manualGames) {
    const sid = mg.libraryId || mg.id;
    if (seen.has(sid)) continue;
    seen.add(sid);
    const fakeLibGame = { ...mg, source: "manual" as const, libraryId: mg.libraryId } as any;
    const dg = manualToDisplayGame(fakeLibGame, runningGameIds);
    result.push(dg);
  }

  // Sort by lastPlayed (most recent first), then by playtime
  result.sort((a, b) => {
    const aLast = a.lastPlayedAt ?? 0;
    const bLast = b.lastPlayedAt ?? 0;
    if (bLast !== aLast) return bLast - aLast;
    return b.totalPlaytimeSeconds - a.totalPlaytimeSeconds;
  });

  return result.slice(0, 10);
}

function formatLastPlayed(ts: number | null): string | null {
  if (ts == null) return null;
  const diff = Date.now() - ts * 1000;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function ContinuePlayingSection({ snapshot, onNavigate, excludeAppId }: Props) {
  const { sessions } = useGameSession();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  const manualGames = useMemo(() => getManualGamesForDashboard(libraryGames), [libraryGames]);

  const displayGames = useMemo(
    () => getContinueDisplayGames(
      snapshot?.library?.games ?? [],
      manualGames,
      sessions,
      excludeAppId,
    ),
    [snapshot, manualGames, sessions, excludeAppId],
  );

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Stable key for effect dependency
  const displayIdsKey = useMemo(
    () => displayGames.map(g => g.stableId).sort().join(','),
    [displayGames],
  );

  // Resolve image URLs for all display games
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const game of displayGames) {
        if (cancelled) break;
        if (game._snapshotGame) {
          const m = game._snapshotGame.media;
          const imgPath = m?.landscapePath || m?.coverPath || m?.backgroundPath;
          urls[game.stableId] = (game.appId && imgPath)
            ? await resolveGameMediaUrl(game.appId, imgPath)
            : null;
        } else if (game._libraryGame) {
          const rawPath = game._libraryGame.imageUrl;
          urls[game.stableId] = rawPath ? await resolveProviderMediaPreviewUrl(rawPath) : null;
        } else {
          urls[game.stableId] = null;
        }
      }
      if (cancelled) return;
      setMediaUrlMap(prev => {
        if (Object.keys(prev).length === Object.keys(urls).length &&
            Object.entries(urls).every(([k, v]) => prev[k] === v)) return prev;
        return urls;
      });
    };
    resolve();
    return () => { cancelled = true; };
  }, [displayIdsKey]);

  if (displayGames.length === 0) return null;

  function handleOpen(game: DashboardDisplayGame) {
    if (game._libraryGame) {
      setSelectedGame(game._libraryGame);
      onNavigate?.("library-game-detail");
    } else if (game.appId) {
      const libGame = libraryGames.find((g) => g.appId === game.appId);
      if (libGame) {
        setSelectedGame(libGame);
        onNavigate?.("library-game-detail");
      }
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            Continue Playing
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Jump back into your games
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {displayGames.map((game) => {
          const imgUrl = mediaUrlMap[game.stableId] ?? null;
          const lastPlayedStr = formatLastPlayed(game.lastPlayedAt);
          const totalMinutes = game.totalPlaytimeSeconds > 0
            ? Math.floor(game.totalPlaytimeSeconds / 60)
            : null;

          return (
            <div
              key={"dashboard:continue:" + game.stableId}
              className="shrink-0 snap-start"
              style={{ width: `min(80vw, ${settings.dashboardFeaturedCardSize}px)` }}
            >
              <div className="lf-dash-card group/card relative cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]">
                <div className="relative aspect-video overflow-hidden">
                  {imgUrl ? (
                    <AsyncImage
                      src={imgUrl}
                      alt={game.title}
                      className="h-full w-full object-cover"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <Clock className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Clock className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                  {game.isRunning && (
                    <div className="absolute left-2 top-2 rounded-full bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
                      Playing
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                  <div className="mt-1.5 flex items-center gap-2">
                    {lastPlayedStr && (
                      <span className="text-[11px] text-(--color-muted)">
                        {lastPlayedStr}
                      </span>
                    )}
                    {totalMinutes != null && totalMinutes > 0 && (
                      <span className="text-[11px] text-(--color-muted)">
                        {totalMinutes}m
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleOpen(game)}
                    className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
                  >
                    <Play className="h-3 w-3" />
                    Play
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </DashboardHorizontalRail>
    </section>
  );
}
