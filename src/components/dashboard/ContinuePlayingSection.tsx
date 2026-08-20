import { useEffect, useMemo, useState } from "react";
import { Play, Clock } from "lucide-react";
import type { StartupSnapshot } from "../../services/startupSnapshotService";
import { useGameSession } from "../../context/GameSessionContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveProviderMediaPreviewUrl, getCachedGameAppInfo } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  snapshotToDisplayGame,
  manualToDisplayGame,
  getNonSnapshotGamesForDashboard,
  getCardImageCandidate,
} from "../../services/dashboardManualGames";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { resolveGameMediaUrl } from "../../services/gameCacheService";
import { subscribePlaytimeStore } from "../../services/playtimeService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

import type { LibraryGame } from "../../types/libraryGame";

const DEBUG_CONTINUE_PLAY = true;

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppId?: string;
  maxItems?: number;
};

function getContinueDisplayGames(
  snapshotGames: Array<{ appId: string; lastPlayed: number | null; playtime: number | null; installed: boolean; title: string; source: string; updatedAt?: number }>,
  nonSnapshotGames: Array<{ id: string; title: string; libraryId?: string; source?: string }>,
  sessions: Record<string, { appId?: string; gameKey?: string; state: string }>,
  libraryGames: LibraryGame[],
  excludeAppId?: string,
  maxItems?: number,
): DashboardDisplayGame[] {
  const runningAppIds = new Set(
    Object.values(sessions)
      .filter((s) => s.state === "running" && s.appId)
      .map((s) => s.appId as string),
  );

  // For non-snapshot games (no appId), index by gameKey so displayGame can match g.id
  const runningGameIds = new Set(
    Object.values(sessions)
      .filter((s) => s.state === "running")
      .map((s) => s.appId || s.gameKey)
      .filter((id): id is string => Boolean(id)),
  );

  const result: DashboardDisplayGame[] = [];
  const seen = new Set<string>();
  if (excludeAppId) seen.add(excludeAppId);

  // Build an appId→LibraryGame index for provider-aware playtime key resolution
  const libGameByAppId = new Map<string, LibraryGame>();
  for (const lg of libraryGames) {
    if (lg.appId) libGameByAppId.set(lg.appId, lg);
  }

  // Snapshot games → display games
  // Non-Steam games (Epic/manual) go through the non-snapshot path below,
  // which uses correct playtime keys and live media paths from LibraryGame.
  for (const sg of snapshotGames) {
    if (!sg.appId || seen.has(sg.appId)) continue;
    if (sg.source && sg.source !== "steam" && sg.source !== "debrid") continue;
    seen.add(sg.appId);
    const libGame = libGameByAppId.get(sg.appId);
    const dg = snapshotToDisplayGame(sg as any, runningAppIds, libGame);
    if (sg.source !== "steam" && sg.source !== "lua" && DEBUG_CONTINUE_PLAY) {
      const m = (sg as any).media;
      console.log(`[CP][BUILD_SNAP] appId=${sg.appId} src=${sg.source} title="${sg.title}" media=${JSON.stringify(m)} hasLibGame=${!!libGame} libLandscape=${libGame?.landscapePath} libCover=${libGame?.coverPath} libBg=${libGame?.backgroundPath}`);
    }
    result.push(dg);
  }

  // Non-snapshot games (manual + Epic + future) → display games
  for (const mg of nonSnapshotGames) {
    const sid = mg.libraryId || mg.id;
    if (seen.has(sid)) continue;
    // Skip Debrid games whose appId was already processed by the snapshot loop
    // (avoids duplicate cards: snapshot uses appId as key, non-snapshot uses libraryId)
    const mgAppId = (mg as any).appId as string | undefined;
    if (mgAppId && seen.has(mgAppId)) continue;
    seen.add(sid);
    const dg = manualToDisplayGame(mg as any, runningGameIds, mg.source ?? undefined);
    if (DEBUG_CONTINUE_PLAY) {
      console.log(`[CP][BUILD_NOSNAP] id=${sid} src=${mg.source} title="${mg.title}" appId=${(mg as any).appId} libPaths=${JSON.stringify({ l: (mg as any).landscapePath, c: (mg as any).coverPath, b: (mg as any).backgroundPath })}`);
    }
    result.push(dg);
  }

  // Sort by lastPlayed (most recent first), then by playtime
  result.sort((a, b) => {
    const aLast = a.lastPlayedAt ?? 0;
    const bLast = b.lastPlayedAt ?? 0;
    if (bLast !== aLast) return bLast - aLast;
    return b.totalPlaytimeSeconds - a.totalPlaytimeSeconds;
  });

  // Filter out games without a real lastPlayed timestamp. Games with playtime from
  // Steam stats but no lastPlayed are placeholder data — not "continue playing".
  const played = result.filter((g) => g.isRunning || (g.lastPlayedAt != null && g.lastPlayedAt > 0));

  return played.slice(0, maxItems ?? 10);
}

function formatLastPlayed(ts: number | null): string | null {
  if (ts == null || ts <= 0) return null;
  const diff = Date.now() - ts * 1000;
  if (diff < 0) return null; // future timestamp — invalid
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function ContinuePlayingSection({ snapshot, onNavigate, excludeAppId, maxItems }: Props) {
  const { sessions } = useGameSession();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});
  const [playtimeVersion, setPlaytimeVersion] = useState(0);

  // Force recomputation when playtime store updates (boot load, session end, import)
  useEffect(() => {
    return subscribePlaytimeStore(() => setPlaytimeVersion((v) => v + 1));
  }, []);

  const nonSnapshotGames = useMemo(() => getNonSnapshotGamesForDashboard(libraryGames), [libraryGames]);

  const displayGames = useMemo(
    () => getContinueDisplayGames(
      snapshot?.library?.games ?? [],
      nonSnapshotGames,
      sessions,
      libraryGames,
      excludeAppId,
      maxItems,
    ),
    [snapshot, nonSnapshotGames, sessions, libraryGames, excludeAppId, maxItems, playtimeVersion],
  );

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Resolve image URLs for all display games
  // Depend on displayGames directly — when libraryGames state changes (e.g. Epic
  // scan populates coverPath/landscapePath), nonSnapshotGames recomputes →
  // displayGames gets new reference → this effect re-runs with fresh _libraryGame paths.
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const urls: Record<string, string | null> = {};
      for (const game of displayGames) {
        if (cancelled) break;
        const isNonSteam = game.source !== "steam" && game.source !== "lua";
        if (game._snapshotGame) {
          const m = game._snapshotGame.media;
          const imgPath = m?.landscapePath || m?.coverPath || m?.backgroundPath;
          urls[game.stableId] = (game.appId && imgPath)
            ? await resolveGameMediaUrl(game.appId, imgPath)
            : null;
          if (isNonSteam && DEBUG_CONTINUE_PLAY) {
            console.log(`[CP][SNAP] id=${game.stableId} src=${game.source} appId=${game.appId} media=${JSON.stringify({ l: m?.landscapePath, c: m?.coverPath, b: m?.backgroundPath })} imgPath=${imgPath} url=${!!urls[game.stableId]}`);
          }
          // Fallback 1: snapshot resolver returned null — try LibraryGame paths
          if (!urls[game.stableId] && game._libraryGame) {
            const rawPath = getCardImageCandidate(game._libraryGame);
            urls[game.stableId] = rawPath ? await resolveProviderMediaPreviewUrl(rawPath) : null;
            if (isNonSteam && DEBUG_CONTINUE_PLAY) {
              console.log(`[CP][FALLBACK] id=${game.stableId} rawPath=${rawPath} fallbackUrl=${!!urls[game.stableId]}`);
            }
          }
          // Fallback 2: appinfo media paths (snapshot says "media/landscape.jpg" but
          // resolveGameMediaUrl returned null — file may not exist yet after install)
          if (!urls[game.stableId] && game.appId) {
            const appInfo = await getCachedGameAppInfo(game.appId);
            const mediaPath = appInfo?.media?.landscapePath || appInfo?.media?.coverPath || appInfo?.media?.backgroundPath;
            if (mediaPath && mediaPath !== imgPath) {
              // Steam/lua: resolveGameMediaUrl resolves relative paths under games/steam/<appId>/
              // Manual/debrid: files live under appData/media/ (flat), use provider resolver
              urls[game.stableId] = isNonSteam
                ? await resolveProviderMediaPreviewUrl(mediaPath)
                : await resolveGameMediaUrl(game.appId, mediaPath);
            }
          }
        } else if (game._libraryGame) {
          const rawPath = getCardImageCandidate(game._libraryGame);
          urls[game.stableId] = rawPath ? await resolveProviderMediaPreviewUrl(rawPath) : null;
          // AppInfo fallback: Debrid/manual games have appId on the LibraryGame
          // but no landscapePath/coverPath/backgroundPath (snapshotGameToLibraryGame
          // sets appId=undefined for non-steam/lua, so libGameByAppId never indexes them).
          // Read the canonical appinfo which IS populated for Debrid games with appId.
          if (!urls[game.stableId] && game.appId) {
            const appInfo = await getCachedGameAppInfo(game.appId);
            const mediaPath = appInfo?.media?.landscapePath || appInfo?.media?.coverPath || appInfo?.media?.backgroundPath;
            if (mediaPath) {
              urls[game.stableId] = isNonSteam
                ? await resolveProviderMediaPreviewUrl(mediaPath)
                : await resolveGameMediaUrl(game.appId, mediaPath);
            }
          }
        } else {
          urls[game.stableId] = null;
          // AppInfo fallback: game has no snapshot and no _libraryGame but has appId
          if (game.appId) {
            const appInfo = await getCachedGameAppInfo(game.appId);
            const mediaPath = appInfo?.media?.landscapePath || appInfo?.media?.coverPath || appInfo?.media?.backgroundPath;
            if (mediaPath) {
              urls[game.stableId] = isNonSteam
                ? await resolveProviderMediaPreviewUrl(mediaPath)
                : await resolveGameMediaUrl(game.appId, mediaPath);
            }
          }
        }
      }
      if (cancelled) return;
      if (DEBUG_CONTINUE_PLAY) {
        for (const game of displayGames) {
          const url = urls[game.stableId];
          const libGame = game._libraryGame;
          const snapMedia = game._snapshotGame?.media;
          console.log(`[CP][RESULT] title="${game.title}" appId=${game.appId} src=${game.source} stableId=${game.stableId} resolvedUrl=${url ?? "NULL"} snapMedia=${JSON.stringify(snapMedia)} libPaths=${JSON.stringify({ l: libGame?.landscapePath, c: libGame?.coverPath, b: libGame?.backgroundPath })}`);
        }
      }
      setMediaUrlMap(prev => {
        if (Object.keys(prev).length === Object.keys(urls).length &&
            Object.entries(urls).every(([k, v]) => prev[k] === v)) return prev;
        return urls;
      });
    };
    resolve();
    return () => { cancelled = true; };
  }, [displayGames]);

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
