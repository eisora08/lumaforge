import { useMemo, useState, useRef, useEffect, useSyncExternalStore } from "react";
import {
  Trophy, Star,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { AppPage } from "../../types/navigation";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeSecondsForAppId, getPlaytimeSecondsByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";
import { getConsoleHeroBackground } from "./consoleMedia";
import { formatBytes, formatRelativeTime, formatPlaytime, getGameCompletionStatus, getGameLastPlayedTimestamp } from "./consoleGameStats";
import type { ConsoleSettings } from "./consoleSettings";
import { resolvePanelWidth } from "./consoleSettings";
import { useConsoleAchievements, useConsoleReviews } from "./useConsoleGameDetailsData";
import ConsoleGameCard from "./ConsoleGameCard";
import ConsoleTopHud from "./ConsoleTopHud";
import { RichEmptyState } from "./ConsoleEmptyState";
import ConsoleCategoryBar from "./ConsoleCategoryBar";
import ConsoleSettingsPanelV2 from "./ConsoleSettingsPanelV2";
import ConsoleSelectedPreview from "./ConsoleSelectedPreview";
import { extractTrailerData } from "./consoleTrailerData";
import { setScrollTarget } from "./useConsoleGamepadInput";
import { deduplicateByStableId, getFavoriteKey, localPathToUrl, isLocalPath } from "../../services/gameCacheService";
import { setAmbientSource, clearAmbientSource, subscribeAmbient, getAmbientSnapshot } from "../../services/ambientBackgroundStore";
import { useDynamicPalette } from "../../hooks/useDynamicPalette";

const DEBUG_CONSOLE_GRID_NAV = false;
const DEBUG_FORCE_TEST_MP4 = false;

type Props = {
  focusedGame: LibraryGame | null;
  settledFocusedGame?: LibraryGame | null;
  rails: LibraryGame[][];
  focusedRail: number;
  focusedIndex: number;
  onSelectGame: (game: LibraryGame) => void;
  onOptionsGame?: (game: LibraryGame) => void;
  onPlayGame?: (game: LibraryGame) => void;
  layoutMode: "spotlight" | "grid";
  onToggleLayout: () => void;
  cardVariant?: "landscape" | "poster";
  onNavigate?: (page: AppPage) => void;
  categoryCounts: number[];
  activeCategory: number;
  onSelectCategory: (index: number) => void;
  settings: ConsoleSettings;
  onSettingsPatch: (patch: Partial<ConsoleSettings>) => void;
  allGames?: LibraryGame[];
  onRefreshLibrary?: () => void;
  gridColumnsRef?: React.MutableRefObject<number>;
  dockFocusedIndex?: number;
};



export default function ConsoleGridLayout({
  focusedGame, settledFocusedGame, rails, focusedRail, focusedIndex,
  onSelectGame, onOptionsGame: _onOptionsGame, onPlayGame: _onPlayGame, layoutMode, onToggleLayout,
  cardVariant: _cv = "poster", onNavigate,
  categoryCounts, activeCategory, onSelectCategory,
  settings, onSettingsPatch,
  allGames, onRefreshLibrary,
  gridColumnsRef,
  dockFocusedIndex: _dockFocusedIndex,
}: Props) {
  const { favoriteIds } = useFavorites();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const gridCardVariant: "landscape" | "poster" = settings.gridCardStyle.useLandscapeCards ? "landscape" : "poster";
  const isFav = focusedGame ? favoriteIds.has(getFavoriteKey(focusedGame) ?? focusedGame.id) : false;
  const currentRail = focusedRail >= 0 && focusedRail < rails.length ? rails[focusedRail] : [];
  const dedupedRail = useMemo(() => deduplicateByStableId(currentRail), [currentRail]);

  /* ── Preview uses settledFocusedGame (debounced) to avoid heavy work during held navigation ── */
  const previewGame = settledFocusedGame ?? focusedGame;
  const heroSrc = getConsoleHeroBackground(previewGame);
  const trailerData = useMemo(() => previewGame ? extractTrailerData(previewGame) : null, [previewGame]);

  /* ── Hover/focus backdrop: instant in-panel layer + global ambient feed ── */
  const [hoverGame, setHoverGame] = useState<LibraryGame | null>(null);
  const backdropGame = hoverGame ?? previewGame;
  const backdropSrc = getConsoleHeroBackground(backdropGame);
  const ambientSnapshot = useSyncExternalStore(subscribeAmbient, getAmbientSnapshot, getAmbientSnapshot);
  const ambientOn = ambientSnapshot.enabled;
  const ambientMode = ambientSnapshot.mode;
  const panelPalette = useDynamicPalette(ambientMode === "color" ? backdropSrc : null);

  useEffect(() => {
    if (!backdropSrc) {
      clearAmbientSource("console-grid-focus");
      return;
    }
    if (backdropSrc.startsWith("games/") || backdropSrc.startsWith("media/") || backdropSrc.startsWith("img/")) return;
    const url = isLocalPath(backdropSrc) ? (localPathToUrl(backdropSrc) ?? null) : backdropSrc;
    if (url) setAmbientSource("console-grid-focus", url);
    else clearAmbientSource("console-grid-focus");
  }, [backdropSrc]);

  useEffect(() => () => clearAmbientSource("console-grid-focus"), []);

  /* ── Resolved panel width (auto-detect by screen resolution) ── */
  const [resolvedPanelWidth, setResolvedPanelWidth] = useState(() => resolvePanelWidth(settings.sidePanelPreset ?? "auto"));
  useEffect(() => {
    const preset = settings.sidePanelPreset ?? "auto";
    setResolvedPanelWidth(resolvePanelWidth(preset));
    if (preset !== "auto") return;
    const onResize = () => setResolvedPanelWidth(resolvePanelWidth("auto"));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [settings.sidePanelPreset]);

  const [showArtworkFirst, setShowArtworkFirst] = useState(true);
  const [thumbnailAutoplaySrc, setThumbnailAutoplaySrc] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"artwork" | "trailer" | "unsupported">("artwork");
  const artworkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedAppIdRef = useRef<string | null>(null);
  const trailerDataRef = useRef(trailerData);
  trailerDataRef.current = trailerData;

  const appIdStr = previewGame?.appId ?? null;
  const isManualGame = focusedGame?.source === "manual";

  const {
    effectiveUnlocked,
    effectiveTotal,
    effectivePercent,
    hasData: gridHasAchievements,
  } = useConsoleAchievements(appIdStr);

  const {
    reviewSummary,
    hasData: gridHasReviews,
  } = useConsoleReviews(appIdStr);

  const lastPlayedStr = useMemo(() => {
    if (!previewGame) return null;
    const ts = getGameLastPlayedTimestamp(previewGame);
    return ts ? formatRelativeTime(ts) : null;
  }, [previewGame]);

  const playtimeSeconds = useMemo(() => {
    if (!previewGame) return 0;
    const byAppId = previewGame.appId ? getPlaytimeSecondsForAppId(previewGame.appId) : 0;
    if (byAppId > 0) return byAppId;
    return getPlaytimeSecondsByGameKey(resolvePlaytimeKey(previewGame));
  }, [previewGame]);

  const playtimeDisplay = useMemo(() => formatPlaytime(playtimeSeconds), [playtimeSeconds]);

  const completionStatus = useMemo(() => {
    if (!previewGame) return null;
    return getGameCompletionStatus(previewGame, playtimeSeconds);
  }, [previewGame, playtimeSeconds]);

  const tags = useMemo(() => {
    if (!previewGame?.metadata?.genres) return null;
    return previewGame.metadata.genres.slice(0, 4);
  }, [previewGame]);

  /* ── Measure actual grid column count from CSS (auto-fill may differ from settings.gridColumns) ── */
  useEffect(() => {
    if (gridRef.current) {
      const computed = getComputedStyle(gridRef.current).gridTemplateColumns;
      const split = computed.split(/\s+/).filter(Boolean);
      const actual = split.length;
      if (actual > 0 && actual !== (gridColumnsRef?.current ?? 0)) {
        if (gridColumnsRef) gridColumnsRef.current = actual;
        if (DEBUG_CONSOLE_GRID_NAV) console.log(`[CONSOLE_GRID_NAV][COLUMNS] computed="${computed}" actual=${actual}`);
      }
    }
  }, []);

  /* ── Register scroll target for right-stick gamepad scrolling ── */
  useEffect(() => {
    setScrollTarget(gridScrollRef.current);
    return () => { setScrollTarget(null); };
  }, []);

  /* ── Scroll focused card into view (rAF-coalesced: captures latest focusedIndex per frame) ── */
  const _scrollRAFIndex = useRef(focusedIndex);
  const _scrollRAFQueued = useRef(false);
  useEffect(() => {
    if (focusedIndex < 0 || !gridRef.current) return;
    _scrollRAFIndex.current = focusedIndex;
    if (_scrollRAFQueued.current) return;
    _scrollRAFQueued.current = true;
    requestAnimationFrame(() => {
      _scrollRAFQueued.current = false;
      const idx = _scrollRAFIndex.current;
      const card = gridRef.current?.children[idx] as HTMLElement | undefined;
      const container = gridScrollRef.current;
      if (card && container) {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const containerRect = container.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const relativeTop = cardRect.top - containerRect.top;
        const targetPosition = containerRect.height * 0.28;
        const lowerBound = containerRect.height * 0.12;
        const upperBound = containerRect.height * 0.45;
        if (relativeTop < lowerBound || relativeTop + cardRect.height > upperBound) {
          const offset = relativeTop - targetPosition;
          const scrollBehav = prefersReduced ? "auto" : (settings.smoothScrolling ? "smooth" : "auto");
          container.scrollBy({ top: offset, behavior: scrollBehav });
          if (DEBUG_CONSOLE_GRID_NAV) {
            console.log(`[CONSOLE_GRID_NAV][SCROLL_POSITION] index=${idx} appid=${currentRail[idx]?.appId} offset=${Math.round(offset)} relativeTop=${Math.round(relativeTop)} target=${Math.round(targetPosition)}`);
          }
        }
      }
    });
  }, [focusedIndex, currentRail]);

  /* ── Delayed trailer preview: show artwork on focus, switch to trailer after 3s ──
   *  After 3s, resolve trailer source:
   *  - Direct mp4/webm → set thumbnailAutoplaySrc (muted autoplay via programmatic play())
   *  - HLS → set thumbnailAutoplaySrc; ConsoleSelectedPreview handles HLS init via hls.js
   *  - DASH / no trailer → stay on artwork or show unsupported badge */
  useEffect(() => {
    const appId = previewGame?.appId ?? null;
    focusedAppIdRef.current = appId;

    setShowArtworkFirst(true);
    setThumbnailAutoplaySrc(null);
    setPreviewMode("artwork");

    if (artworkTimerRef.current) {
      clearTimeout(artworkTimerRef.current);
      artworkTimerRef.current = null;
    }

    if (!appId) return;

    if (DEBUG_CONSOLE_GRID_NAV) {
      console.log(`[CONSOLE_PREVIEW_AUTO][FOCUS] appid=${appId}`);
      console.log(`[CONSOLE_PREVIEW_AUTO][TIMER_START] appid=${appId} delay=3000`);
    }

    artworkTimerRef.current = setTimeout(() => {
      if (focusedAppIdRef.current !== appId || previewGame?.appId !== appId) {
        if (DEBUG_CONSOLE_GRID_NAV) {
          console.log(`[CONSOLE_PREVIEW_AUTO][TIMER_CANCEL] appid=${appId} reason=focus-changed`);
        }
        return;
      }

      setShowArtworkFirst(false);

      // Resolve trailer source for current appId (use ref to avoid stale closure)
      const td = trailerDataRef.current;
      if (DEBUG_CONSOLE_GRID_NAV) {
        console.log(`[CONSOLE_PREVIEW_AUTO][TRAILER_SOURCE] appid=${appId} type=${td?.playableType ?? "none"} url=${td?.playableUrl?.substring(0, 80) ?? "null"}`);
        if (td) {
          console.log(`[CONSOLE_PREVIEW_AUTO][TRAILER_DATA] appid=${appId} id=${td.movieCount > 0 ? "primary" : "none"} name=${td.movieCount > 0 ? td.movieCount + " movies" : "none"} mp4_max=${td.mp4Url ?? "null"} webm_max=${td.webmUrl ?? "null"} hls_h264=${td.hls_h264 ?? "null"} dash_h264=${td.dash_h264 ?? "null"} dash_av1=${td.dash_av1 ?? "null"}`);
        }
      }

      if (td?.playableUrl && settings.showTrailerPreview) {
        // Playable source exists — autoplay (direct mp4/webm or HLS via hls.js)
        const src = DEBUG_FORCE_TEST_MP4 ? "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" : td.playableUrl;
        if (DEBUG_CONSOLE_GRID_NAV) console.log(`[PREVIEW_PIPE][SET_SRC] appid=${appId} src=${src.substring(0, 80)}`);
        setThumbnailAutoplaySrc(src);
        setPreviewMode("trailer");
        if (DEBUG_CONSOLE_GRID_NAV) {
          console.log(`[CONSOLE_PREVIEW_AUTO][AUTOPLAY_START] appid=${appId} type=${td.playableType} url=${src.substring(0, 80)}`);
        }
      } else if (td?.hasTrailer) {
        // Has trailer metadata but no playable URL (DASH only or corrupt)
        setPreviewMode("unsupported");
        if (DEBUG_CONSOLE_GRID_NAV) {
          console.log(`[CONSOLE_PREVIEW_AUTO][SHOW_UNSUPPORTED] appid=${appId} type=${td.playableType}`);
        }
      } else {
        // No trailer — stay on artwork
        setPreviewMode("trailer");
        if (DEBUG_CONSOLE_GRID_NAV) {
          console.log(`[CONSOLE_PREVIEW_AUTO][SHOW_ARTWORK] appid=${appId} reason=no-trailer`);
        }
      }
    }, 3000);

    return () => {
      if (artworkTimerRef.current) {
        clearTimeout(artworkTimerRef.current);
        artworkTimerRef.current = null;
      }
    };
  }, [previewGame?.appId, settings.showTrailerPreview]);

  /* ── Clean up timer on unmount ── */
  useEffect(() => {
    return () => {
      if (artworkTimerRef.current) clearTimeout(artworkTimerRef.current);
    };
  }, []);

  /* ── Debug log for preview mode changes ── */
  useEffect(() => {
    if (DEBUG_CONSOLE_GRID_NAV && previewGame?.appId) {
      console.log(`[CONSOLE_PREVIEW_AUTO] appid=${previewGame.appId} showArtworkFirst=${showArtworkFirst} mode=${previewMode} autoplay=${!!thumbnailAutoplaySrc}`);
    }
    if (DEBUG_CONSOLE_GRID_NAV && thumbnailAutoplaySrc && previewGame?.appId) {
      console.log(`[PREVIEW_PIPE][PASS_PROP] appid=${previewGame.appId} src=${thumbnailAutoplaySrc.substring(0, 80)}`);
    }
  }, [showArtworkFirst, previewMode, thumbnailAutoplaySrc, previewGame?.appId]);

  if (DEBUG_CONSOLE_GRID_NAV) {
    if (focusedGame) {
      console.log(`[CONSOLE][GRID_PREVIEW] appid=${focusedGame.appId} title=${focusedGame.title}`);
    } else {
      console.log(`[CONSOLE][GRID_PREVIEW] cleared reason=no-focused-game`);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-(--console-bg)">
      {/* HUD */}
      <ConsoleTopHud
        layoutMode={layoutMode}
        onToggleLayout={onToggleLayout}
        onNavigate={onNavigate}
        onOpenSettings={() => setSettingsOpen(true)}
        settings={settings}
      />

      {/* Main content: scrollable grid + preview panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Scrollable game grid — settings-driven card size/gap/columns */}
        <div ref={gridScrollRef} className="flex-1 overflow-y-auto pb-5"
             style={{
               paddingLeft: `${settings.leftPadding}px`,
               paddingRight: "32px",
               paddingTop: "clamp(24px, 3vh, 40px)",
             }}>
          {dedupedRail.length > 0 ? (
            <div
              ref={gridRef}
              className="grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${settings.gridCardStyle.widthPreset}px, 1fr))`,
                gap: `${settings.gridGap}px`,
              }}
            >
              {dedupedRail.map((game, i) => (
                <ConsoleGameCard
                  key={"grid:" + (game.appId || game.id)}
                  game={game}
                  isFocused={focusedIndex === i}
                  onClick={() => onSelectGame(game)}
                  onHover={setHoverGame}
                  onHoverEnd={() => setHoverGame(null)}
                  compact
                  variant={gridCardVariant}
                  noLabel={settings.gridCardStyle.hideLabels}
                  cornerRadius={settings.gridCardStyle.cornerRadius}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <RichEmptyState railIndex={focusedRail >= 0 ? focusedRail : 4} />
            </div>
          )}
        </div>

        {/* Right preview panel — settings-driven width */}
        <div className="lf-surface hidden relative shrink-0 overflow-hidden border-l border-(--color-border) lg:block"
             style={{ width: `${resolvedPanelWidth}px`, minWidth: `${resolvedPanelWidth}px`, maxWidth: `${resolvedPanelWidth}px` }}>
          {/* Instant hover/focus backdrop layer */}
          {ambientOn && backdropSrc && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {ambientMode === "color" ? (
                <div className="absolute inset-0 opacity-40">
                  <div
                    className="lf-ambient-color absolute inset-0"
                    style={
                      {
                        "--ambient-primary": panelPalette.primary,
                        "--ambient-secondary": panelPalette.secondary,
                        "--ambient-glow": panelPalette.glow,
                      } as React.CSSProperties
                    }
                  >
                    <div className="lf-ambient-glow absolute inset-0" />
                  </div>
                </div>
              ) : (
                <img src={backdropSrc} alt="" className="h-full w-full scale-110 object-cover blur-2xl opacity-40" />
              )}
              <div className="absolute inset-0 bg-(--color-bg)/70" />
            </div>
          )}
          <div className="relative h-full overflow-y-auto">
          {focusedGame ? (
            <div className="flex min-h-full flex-col">
              {/* Hero/preview image — supports trailer thumbnails */}
              <div className="relative aspect-[16/9] overflow-hidden">
                <ConsoleSelectedPreview
                  game={focusedGame}
                  showTrailerPreview={settings.showTrailerPreview}
                  trailerData={trailerData}
                  mode="thumbnail"
                  showArtworkFirst={showArtworkFirst}
                  thumbnailAutoplaySrc={thumbnailAutoplaySrc}
                />
                {previewMode === "unsupported" && (
                  <div className="pointer-events-none absolute top-2 right-2 rounded-md bg-amber-900/60 px-2 py-0.5 text-[10px] text-amber-200">
                    Stream only
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-(--color-bg)/80 to-transparent pointer-events-none" />
              </div>

              {/* Panel content */}
              <div className="flex flex-col gap-5 px-8 pt-6 pb-6">
                {/* Title */}
                <div>
                  <h2 className="text-2xl font-bold text-(--color-text) leading-tight">
                    {focusedGame.title}
                  </h2>
                </div>

                {/* Badges row */}
                <div className="flex flex-wrap gap-1.5">
                  {focusedGame.steamInstalled && (
                    <span className="rounded-md bg-emerald-500/80 px-2.5 py-0.5 text-xs font-medium text-black">Installed</span>
                  )}
                  {focusedGame.isLuaActive && (
                    <span className="rounded-md bg-violet-500/80 px-2.5 py-0.5 text-xs font-medium text-white">Lua</span>
                  )}
                  {focusedGame.hasUpdate && (
                    <span className="rounded-md bg-amber-500/80 px-2.5 py-0.5 text-xs font-medium text-black">Update</span>
                  )}
                  {focusedGame.source === "manual" && (
                    <span className="rounded-md bg-sky-500/80 px-2.5 py-0.5 text-xs font-medium text-white">Manual</span>
                  )}
                  {isFav && (
                    <span className="rounded-md bg-rose-500/80 px-2.5 py-0.5 text-xs font-medium text-white">Favorite</span>
                  )}
                  {focusedGame.metadata?.legal_notice?.toLowerCase().includes("denuvo") && (
                    <span className="rounded-md bg-red-500/70 px-2.5 py-0.5 text-xs font-medium text-white">Denuvo</span>
                  )}
                  {focusedGame.source === "debrid" && focusedGame.repacker && (
                    <span className="rounded-md bg-cyan-500/80 px-2.5 py-0.5 text-xs font-medium text-black">{focusedGame.repacker.toUpperCase()}</span>
                  )}
                </div>

                {/* Info grid: 2-col stats */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Time played</span>
                    <p className="mt-0.5 font-semibold text-(--color-text)">
                      {playtimeDisplay ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Last played</span>
                    <p className="mt-0.5 font-semibold text-(--color-text)">
                      {lastPlayedStr ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Status</span>
                    <p className="mt-0.5 font-semibold text-(--color-accent)">
                      {completionStatus ?? "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Released</span>
                    <p className="mt-0.5 font-semibold text-(--color-text)">
                      {focusedGame.metadata?.release_date
                        ? (() => {
                            const d = focusedGame.metadata!.release_date!;
                            const m = d.match(/^(\d{4})/);
                            return m ? m[1] : d;
                          })()
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Size</span>
                    <p className="mt-0.5 font-semibold text-(--color-text)">
                      {formatBytes(focusedGame.sizeOnDisk)}
                    </p>
                  </div>
                </div>

                {/* Developer / Publisher */}
                {(focusedGame.metadata?.developer || focusedGame.metadata?.publishers?.length) && (
                  <div className="flex flex-col gap-1.5 text-sm">
                    {focusedGame.metadata.developer && (
                      <div>
                        <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Developer</span>
                        <p className="mt-0.5 font-medium text-(--color-text)">{focusedGame.metadata.developer}</p>
                      </div>
                    )}
                    {focusedGame.metadata.publishers && focusedGame.metadata.publishers.length > 0 && (
                      <div>
                        <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Publisher</span>
                        <p className="mt-0.5 font-medium text-(--color-text)">{focusedGame.metadata.publishers.join(", ")}</p>
                      </div>
                    )}
                    {focusedGame.source === "debrid" && focusedGame.repacker && (
                      <div>
                        <span className="text-[10px] uppercase tracking-widest text-(--color-muted)">Repacker</span>
                        <p className="mt-0.5 font-medium text-(--color-text)">{focusedGame.repacker}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Media source indicators */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                  {heroSrc && (
                    <span className="text-(--color-muted)/50">
                      Artwork: <span className="font-medium text-(--color-muted)/70">{isManualGame ? "manual" : "steam-metadata"}</span>
                    </span>
                  )}
                  {focusedGame.steamInstalled && (
                    <span className="text-(--color-muted)/50">
                      Source: <span className="font-medium text-(--color-muted)/70">local</span>
                    </span>
                  )}
                  {isManualGame && (
                    <span className="text-(--color-muted)/50">
                      Source: <span className="font-medium text-(--color-muted)/70">manual</span>
                    </span>
                  )}
                  {focusedGame.source === "debrid" && (
                    <span className="text-(--color-muted)/50">
                      Source: <span className="font-medium text-(--color-muted)/70">debrid</span>
                    </span>
                  )}
                </div>

                {/* Separator */}
                <div className="border-t border-(--color-border)" />

                {/* Achievement progress bar — hidden for manual games */}
                {!isManualGame && (
                <div>
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-(--color-muted)" />
                    <span className="text-sm font-semibold text-(--color-text)">Achievements</span>
                  </div>
                  {gridHasAchievements ? (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-(--color-muted)">
                          {effectiveUnlocked} / {effectiveTotal}
                        </span>
                        <span className="font-semibold tabular-nums text-(--color-text)">
                          {effectivePercent}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-(--color-border)">
                        <div
                          className="h-full rounded-full bg-(--color-accent) transition-all duration-300"
                          style={{ width: `${effectivePercent}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-(--color-muted)">No achievement data</p>
                  )}
                </div>
                )}

                {/* Reviews card — hidden for manual games */}
                {!isManualGame && (
                <div>
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-(--color-muted)" />
                    <span className="text-sm font-semibold text-(--color-text)">Reviews</span>
                  </div>
                  {gridHasReviews ? (
                    <div className="mt-2">
                      <p className="text-sm font-bold text-green-400">{reviewSummary!.review_score_desc}</p>
                      <p className="mt-0.5 text-xs text-(--color-muted)">
                        {reviewSummary!.positive_percent != null
                          ? `${Math.round(reviewSummary!.positive_percent)}% positive`
                          : `${reviewSummary!.total_positive.toLocaleString()} positive`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-(--color-muted)/60">
                        {reviewSummary!.total_reviews.toLocaleString()} reviews
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-(--color-muted)">No review data</p>
                  )}
                </div>
                )}

                {/* Genre chips */}
                {tags && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-md bg-(--color-surface) px-3 py-1 text-xs text-(--color-muted)"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Short description */}
                {focusedGame.metadata?.short_description && (
                  <p className="line-clamp-5 text-sm leading-relaxed text-(--color-muted)">
                    {focusedGame.metadata.short_description}
                  </p>
                )}

              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8">
              <p className="text-center text-sm text-(--color-muted)">No game selected</p>
              {currentRail.length === 0 && (
                <p className="text-center text-xs text-(--color-muted)/50">
                  This category has no games. Switch categories or browse All Games.
                </p>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Bottom category bar */}
      <div className="lf-surface shrink-0 border-t border-(--color-border)">
        <ConsoleCategoryBar
          activeIndex={activeCategory}
          counts={categoryCounts}
          onSelect={onSelectCategory}
          showHints
          inputHints={settings.inputHints}
          bottomBarPosition={settings.bottomBarPosition}
        />
      </div>

      {/* Settings panel v2 */}
      <ConsoleSettingsPanelV2
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onPatch={onSettingsPatch}
        onNavigate={onNavigate}
        allGames={allGames}
        onSelectGame={onSelectGame}
        onRefreshLibrary={onRefreshLibrary}
      />
    </div>
  );
}
