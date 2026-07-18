import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import type { StartupSnapshot, SnapshotGame } from "../../services/startupSnapshotService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useSettings } from "../../context/SettingsContext";
import { resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import {
  type DashboardDisplayGame,
  snapshotToDisplayGame,
  manualToDisplayGame,
  getNonSnapshotGamesForDashboard,
  getCardImageCandidate,
} from "../../services/dashboardManualGames";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import { resolveGameMediaUrl } from "../../services/gameCacheService";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

type Props = {
  snapshot: StartupSnapshot | null;
  onNavigate?: (page: AppPage) => void;
  excludeAppIds?: string[];
  maxItems?: number;
};

function getTopPlayedGames(
  snapshotGames: SnapshotGame[],
  nonSnapshotGames: Array<{ id: string; title: string; libraryId?: string; source?: string }>,
  excludeAppIds?: string[],
  maxItems?: number,
): DashboardDisplayGame[] {
  const exclude = new Set(excludeAppIds ?? []);
  const result: DashboardDisplayGame[] = [];
  const seen = new Set<string>();

  // Snapshot games
  for (const sg of snapshotGames) {
    if (!sg.appId || exclude.has(sg.appId) || seen.has(sg.appId)) continue;
    seen.add(sg.appId);
    result.push(snapshotToDisplayGame(sg as any, new Set()));
  }

  // Non-snapshot games (manual + Epic + future)
  for (const mg of nonSnapshotGames) {
    const sid = mg.libraryId || mg.id;
    if (seen.has(sid)) continue;
    seen.add(sid);
    result.push(manualToDisplayGame(mg as any, new Set(), mg.source ?? undefined));
  }

  // Sort by total playtime descending
  result.sort((a, b) => b.totalPlaytimeSeconds - a.totalPlaytimeSeconds);

  return result.slice(0, maxItems ?? 10);
}

function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

export default function TopPlayedSection({ snapshot, onNavigate, excludeAppIds, maxItems }: Props) {
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { settings } = useSettings();
  const [mediaUrlMap, setMediaUrlMap] = useState<Record<string, string | null>>({});

  const nonSnapshotGames = useMemo(() => getNonSnapshotGamesForDashboard(libraryGames), [libraryGames]);

  const snapshotGames = useMemo(
    () => snapshot?.library?.games ?? [],
    [snapshot],
  );

  const displayGames = useMemo(
    () => getTopPlayedGames(snapshotGames, nonSnapshotGames, excludeAppIds, maxItems),
    [snapshotGames, nonSnapshotGames, excludeAppIds, maxItems],
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
        if (game._snapshotGame) {
          const m = game._snapshotGame.media;
          const imgPath = m?.landscapePath || m?.coverPath || m?.backgroundPath;
          urls[game.stableId] = (game.appId && imgPath)
            ? await resolveGameMediaUrl(game.appId, imgPath)
            : null;
        } else if (game._libraryGame) {
          const rawPath = getCardImageCandidate(game._libraryGame);
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
            Top 10 Most Played
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            Your most played games
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {displayGames.map((game) => {
          const imgUrl = mediaUrlMap[game.stableId] ?? null;
          const totalStr = formatPlaytime(game.totalPlaytimeSeconds);

          return (
            <div
              key={"dashboard:topplayed:" + game.stableId}
              className="shrink-0 snap-start"
              style={{ width: `min(75vw, ${settings.dashboardCardSize}px)` }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleOpen(game)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpen(game);
                  }
                }}
                className="lf-dash-card group/card cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04]"
              >
                <div className="relative aspect-video overflow-hidden">
                  {imgUrl ? (
                    <AsyncImage
                      src={imgUrl}
                      alt={game.title}
                      className="h-full w-full object-cover"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <Trophy className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Trophy className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                  {totalStr && (
                    <span className="mt-1 inline-block text-[11px] text-(--color-muted)">
                      {totalStr} played
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </DashboardHorizontalRail>
    </section>
  );
}
