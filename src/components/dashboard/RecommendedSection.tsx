import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart, Sparkles } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { GameEntry } from "../../services/tauri";
import type { CatalogStatus } from "../../services/globalCatalogService";
import {
  subscribeCatalogState,
  getCatalogState,
  loadNormalizedCatalog,
  getCachedCatalog,
} from "../../services/globalCatalogService";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useFavorites } from "../../context/FavoritesContext";
import { getCachedPlaytimeStore } from "../../services/playtimeService";
import { getRecommendedWithGlobalFill } from "../../services/recommendationService";

const DEBUG_DASH_RECOMMEND = false;
const DEBUG_DASH_RECOMMEND_PER_GAME = false;
const DEBUG_DASH_SECTION_LOGS = false;
import { useSettings } from "../../context/SettingsContext";
import { localPathToUrl, deduplicateByAppId, getFavoriteKey } from "../../services/gameCacheService";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import { isHttpUrl, isLocalPath } from "../../services/libraryLocalCacheService";
import AsyncImage from "../common/AsyncImage";
import type { AppPage } from "../../types/navigation";
import DashboardHorizontalRail from "./DashboardHorizontalRail";

type Props = {
  onNavigate?: (page: AppPage) => void;
  continuePlayingAppIds: Set<string>;
  maxItems?: number;
};

function resolveImageSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  if (isHttpUrl(src)) return src;
  if (isLocalPath(src)) return localPathToUrl(src) ?? undefined;
  return src;
}

export default function RecommendedSection({ onNavigate, continuePlayingAppIds, maxItems }: Props) {
  const { t } = useTranslation();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { settings } = useSettings();
  const [catalogEntries, setCatalogEntries] = useState<GameEntry[]>([]);

  const playtimeStore = useMemo(() => getCachedPlaytimeStore(), []);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>(() => getCatalogState().status);

  // Subscribe to catalog readiness
  useEffect(() => {
    const unsub = subscribeCatalogState((s) => {
      setCatalogStatus(s.status);
    });
    return unsub;
  }, []);

  // Load normalized catalog entries as fill pool — only when catalog is ready
  useEffect(() => {
    if (catalogStatus !== "ready") return;
    let cancelled = false;
    (async () => {
      const cached = getCachedCatalog();
      if (cancelled) return;
      if (cached.length > 0) {
        const gameEntries: GameEntry[] = cached.map((e) => ({
          appId: e.appId,
          title: e.title,
          installed: false,
          playtime: 0,
          lastPlayed: 0,
          metadataJson: e.metadata ? JSON.stringify(e.metadata) : "{}",
          updatedAt: e.appId ? parseInt(e.appId, 10) || 0 : 0,
        }));
        setCatalogEntries(gameEntries);
        return;
      }
      const { entries } = await loadNormalizedCatalog(1000);
      if (cancelled) return;
      if (entries.length > 0) {
        const gameEntries: GameEntry[] = entries.map((e) => ({
          appId: e.appId,
          title: e.title,
          installed: false,
          playtime: 0,
          lastPlayed: 0,
          metadataJson: e.metadata ? JSON.stringify(e.metadata) : "{}",
          updatedAt: e.appId ? parseInt(e.appId, 10) || 0 : 0,
        }));
        setCatalogEntries(gameEntries);
      }
    })();
    return () => { cancelled = true; };
  }, [catalogStatus]);

  // Diagnostic log — global catalog state
  const catalogLogRef = useRef<string>("");
  const catalogLogKey = useMemo(
    () => `${catalogEntries.length}|${catalogEntries.some((e) => e.metadataJson && e.metadataJson !== "{}")}`,
    [catalogEntries],
  );
  useEffect(() => {
    if (catalogEntries.length === 0) return;
    if (catalogLogRef.current === catalogLogKey) return;
    catalogLogRef.current = catalogLogKey;
    if (DEBUG_DASH_SECTION_LOGS) {
      const withMeta = catalogEntries.filter((e) => e.metadataJson && e.metadataJson !== "{}").length;
      const withInstalled = catalogEntries.filter((e) => e.installed).length;
      console.log(
        `[DASH][GLOBAL_CATALOG] total=${catalogEntries.length} withMetadata=${withMeta} installed=${withInstalled}`,
      );
    }
  }, [catalogEntries, catalogLogKey]);

  const displayGames = useMemo(() => {
    const result = getRecommendedWithGlobalFill(libraryGames, catalogEntries, favoriteIds, playtimeStore, continuePlayingAppIds, maxItems ?? 10);
    return result;
  }, [libraryGames, catalogEntries, favoriteIds, playtimeStore, continuePlayingAppIds, maxItems]);

  useEffect(() => {
    for (const game of displayGames) {
      if (game.appId) {
        requestGameData(game.appId, LoadPriority.VIEWPORT);
      }
    }
  }, [displayGames]);

  // Diagnostic log — once per recommendation set change
  const recLogRef = useRef<string>("");
  const perGameLogRef = useRef(false);
  useEffect(() => {
    if (displayGames.length === 0) return;
    const hasUserData = favoriteIds.size > 0 || (playtimeStore && Object.values(playtimeStore.games).some(e => e.totalPlaytimeSeconds > 0));
    const personalCount = displayGames.filter((g) => libraryGames.some((lg) => lg.appId === g.appId)).length;
    const source = hasUserData ? `personalized+global` : "fallback+global";
    const ids = displayGames.map(g => g.appId).filter(Boolean).join(",");
    if (recLogRef.current !== `${source}|${ids}`) {
      recLogRef.current = `${source}|${ids}`;
      if (DEBUG_DASH_RECOMMEND) {
        const tags = displayGames.slice(0, 3).map(g => g.metadata?.genres?.slice(0, 2).join(",") || "none").join(";");
        console.log(`[DASH][RECOMMEND] source=${source} count=${displayGames.length} personal=${personalCount} global=${displayGames.length - personalCount} appids=${ids} tags=${tags}`);
      }
    }
    // Per-game source log (once per mount)
    if (!perGameLogRef.current && DEBUG_DASH_RECOMMEND_PER_GAME) {
      perGameLogRef.current = true;
      for (const game of displayGames) {
        if (!game.appId) continue;
        const isLocal = libraryGames.some((lg) => lg.appId === game.appId);
        const gameSource = isLocal ? "local" : "global-catalog";
        const score = game.metadata?.genres?.length ?? 0;
        const reasons = game.metadata?.genres?.slice(0, 3).join(",") || "no-metadata";
        console.log(`[DASH][RECOMMEND] appid=${game.appId} title="${game.title}" source=${gameSource} score=${score} reasons=${reasons}`);
      }
    }
  }, [displayGames, favoriteIds, playtimeStore, libraryGames]);

  const hasUserData = useMemo(() => {
    if (favoriteIds.size > 0) return true;
    if (playtimeStore) {
      for (const entry of Object.values(playtimeStore.games)) {
        if (entry.totalPlaytimeSeconds > 0) return true;
      }
    }
    return false;
  }, [favoriteIds, playtimeStore]);

  if (displayGames.length === 0 && !hasUserData) {
    return (
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-(--color-text)">
              {t("store.sections.recommended_title", "Recommended for You")}
            </h2>
            <p className="mt-0.5 text-sm text-(--color-muted)">
              {t("store.sections.recommended_empty_subtitle", "Personalized game suggestions")}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-12 text-center">
          <Sparkles className="mb-3 h-8 w-8 text-(--color-muted)/30" />
          <p className="text-sm text-(--color-muted)">
            {t("store.sections.recommended_empty_message", "Play some games or add favorites to get recommendations.")}
          </p>
        </div>
      </section>
    );
  }

  if (displayGames.length === 0) return null;

  function handleOpen(game: LibraryGame) {
    // Support both Steam and manual games
    const libGame = game.appId
      ? libraryGames.find((g) => g.appId === game.appId)
      : libraryGames.find((g) => g.id === game.id || g.libraryId === game.libraryId);
    if (libGame) {
      setSelectedGame(libGame);
      onNavigate?.("library-game-detail");
    } else {
      onNavigate?.("store");
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-(--color-text)">
            {t("store.sections.recommended_title", "Recommended for You")}
          </h2>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {hasUserData
              ? t("store.sections.recommended_subtitle_favorites", "Based on your favorites and playtime")
              : t("store.sections.recommended_subtitle_genre", "Genre-matched games from the catalog")}
          </p>
        </div>
      </div>

      <DashboardHorizontalRail gap={settings.dashboardGridGap}>
        {deduplicateByAppId(displayGames).map((game) => {
          const imgSrc = resolveImageSrc(
            game.imageUrl || game.metadata?.header_image || game.metadata?.capsule_image || undefined,
          );

          return (
            <div
              key={"dashboard:recommended:steam:" + game.appId}
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
                  {imgSrc ? (
                    <AsyncImage
                      src={imgSrc}
                      alt={game.title}
                      className="h-full w-full object-cover"
                      fallback={
                        <div className="flex h-full w-full items-center justify-center bg-white/5">
                          <Sparkles className="h-6 w-6 text-(--color-muted)/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Sparkles className="h-6 w-6 text-(--color-muted)/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover/card:opacity-100" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const fk = getFavoriteKey(game);
                      if (fk) toggleFavorite(fk);
                    }}
                    className="absolute right-2 top-2 inline-flex cursor-pointer items-center justify-center rounded-full bg-black/60 px-1.5 py-1 text-rose-400/80 backdrop-blur-sm transition hover:bg-black/80 hover:text-rose-400"
                    title={getFavoriteKey(game) && favoriteIds.has(getFavoriteKey(game)!) ? t("sidebar.remove_from_favorites", "Remove from favorites") : t("sidebar.add_to_favorites", "Add to favorites")}
                  >
                    <Heart
                      className="h-4 w-4"
                      fill={getFavoriteKey(game) && favoriteIds.has(getFavoriteKey(game)!) ? "currentColor" : "none"}
                    />
                  </button>
                </div>

                <div className="p-3">
                  <h3 className="lf-card-title line-clamp-1 text-sm font-medium text-(--color-text)">
                    {game.title}
                  </h3>
                  {game.metadata?.genres && game.metadata.genres.length > 0 && (
                    <span className="mt-1 inline-block text-[11px] text-(--color-muted)">
                      {game.metadata.genres.slice(0, 2).join(", ")}
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
