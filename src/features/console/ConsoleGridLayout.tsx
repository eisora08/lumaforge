import { useMemo, useState, useRef, useEffect } from "react";
import {
  Trophy,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { AppPage } from "../../types/navigation";
import { useFavorites } from "../../context/FavoritesContext";
import { getPlaytimeSecondsForAppId } from "../../services/playtimeService";
import { getConsoleHeroBackground } from "./consoleMedia";
import { getConsoleInputHints } from "./consoleInputHints";
import { formatBytes, formatRelativeTime, formatPlaytime, getGameAchievementSummary, getGameCompletionStatus } from "./consoleGameStats";
import type { ConsoleSettings } from "./consoleSettings";
import ConsoleGameCard from "./ConsoleGameCard";
import ConsoleTopHud from "./ConsoleTopHud";
import ConsoleCategoryBar from "./ConsoleCategoryBar";
import ConsoleSettingsPanelV2 from "./ConsoleSettingsPanelV2";
import ConsoleSelectedPreview from "./ConsoleSelectedPreview";
import { extractTrailerData } from "./consoleTrailerData";
import { setScrollTarget } from "./useConsoleGamepadInput";

const DEBUG_CONSOLE_MODE = false;
const DEBUG_CONSOLE_GRID_NAV = false;

type Props = {
  focusedGame: LibraryGame | null;
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



function HintTag({ children }: { children: string }) {
  const m = children.match(/^\[(.+?)\]\s*(.+)$/);
  if (!m) return <span className="text-[11px] text-(--color-muted)">{children}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-(--color-muted)">
      <span className="rounded border border-(--color-border) bg-(--color-surface) px-1 py-px text-[9px] font-bold tracking-tight text-(--color-muted)">
        {m[1]}
      </span>
      {m[2]}
    </span>
  );
}

export default function ConsoleGridLayout({
  focusedGame, rails, focusedRail, focusedIndex,
  onSelectGame, onOptionsGame: _onOptionsGame, onPlayGame: _onPlayGame, layoutMode, onToggleLayout,
  cardVariant = "poster", onNavigate,
  categoryCounts, activeCategory, onSelectCategory,
  settings, onSettingsPatch,
  allGames, onRefreshLibrary,
  gridColumnsRef,
}: Props) {
  const { favoriteIds } = useFavorites();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const isFav = focusedGame?.appId ? favoriteIds.has(focusedGame.appId) : false;
  const currentRail = focusedRail >= 0 && focusedRail < rails.length ? rails[focusedRail] : [];
  const heroSrc = getConsoleHeroBackground(focusedGame);
  const trailerData = useMemo(() => focusedGame ? extractTrailerData(focusedGame) : null, [focusedGame]);

  const hints = useMemo(() => getConsoleInputHints(settings.inputHints), [settings.inputHints]);

  const achievementSummary = useMemo(() => {
    return focusedGame ? getGameAchievementSummary(focusedGame) : null;
  }, [focusedGame]);

  const lastPlayedStr = useMemo(() => {
    if (!focusedGame) return null;
    const ts = focusedGame.localLastPlayedAt ?? focusedGame.steamLastPlayedAt;
    return ts ? formatRelativeTime(ts) : null;
  }, [focusedGame]);

  const playtimeSeconds = useMemo(() => {
    return focusedGame?.appId ? getPlaytimeSecondsForAppId(focusedGame.appId) : 0;
  }, [focusedGame]);

  const playtimeDisplay = useMemo(() => formatPlaytime(playtimeSeconds), [playtimeSeconds]);

  const completionStatus = useMemo(() => {
    if (!focusedGame) return null;
    return getGameCompletionStatus(focusedGame, playtimeSeconds);
  }, [focusedGame, playtimeSeconds]);

  const tags = useMemo(() => {
    if (!focusedGame?.metadata?.genres) return null;
    return focusedGame.metadata.genres.slice(0, 4);
  }, [focusedGame]);

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
  });

  /* ── Register scroll target for right-stick gamepad scrolling ── */
  useEffect(() => {
    setScrollTarget(gridScrollRef.current);
    return () => { setScrollTarget(null); };
  }, []);

  /* ── Scroll focused card into view when index changes ── */
  useEffect(() => {
    if (focusedIndex < 0 || !gridRef.current) return;
    const card = gridRef.current.children[focusedIndex] as HTMLElement | undefined;
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
        container.scrollBy({ top: offset, behavior: prefersReduced ? "auto" : "smooth" });
        if (DEBUG_CONSOLE_GRID_NAV) {
          console.log(`[CONSOLE_GRID_NAV][SCROLL_POSITION] index=${focusedIndex} appid=${currentRail[focusedIndex]?.appId} offset=${Math.round(offset)} relativeTop=${Math.round(relativeTop)} target=${Math.round(targetPosition)}`);
        }
      }
    }
  }, [focusedIndex, currentRail]);

  if (DEBUG_CONSOLE_MODE && focusedGame) {
    console.log(`[CONSOLE][GRID_PREVIEW] appid=${focusedGame.appId} title=${focusedGame.title}`);
  }

  return (
    <div className="flex h-screen flex-col bg-(--color-bg)">
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
               paddingLeft: "clamp(64px, 5vw, 120px)",
               paddingRight: "32px",
               paddingTop: "clamp(24px, 3vh, 40px)",
             }}>
          {currentRail.length > 0 ? (
            <div
              ref={gridRef}
              className="grid"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${settings.cardSize}px, 1fr))`,
                gap: `${settings.gridGap}px`,
              }}
            >
              {currentRail.map((game, i) => (
                <ConsoleGameCard
                  key={"grid:" + game.appId}
                  game={game}
                  isFocused={focusedIndex === i}
                  onClick={() => onSelectGame(game)}
                  compact
                  variant={cardVariant}
                  noLabel
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-(--color-muted)">No games in this category</p>
            </div>
          )}
        </div>

        {/* Right preview panel — settings-driven width */}
        <div className="hidden shrink-0 border-l border-(--color-border) overflow-y-auto bg-(--color-surface)/20 backdrop-blur-sm lg:block"
             style={{ width: `${settings.sidePanelWidth}px`, minWidth: `${settings.sidePanelWidth}px`, maxWidth: `${settings.sidePanelWidth}px` }}>
          {focusedGame ? (
            <div className="flex min-h-full flex-col">
              {/* Hero/preview image — supports trailer thumbnails */}
              <div className="relative aspect-[16/9] overflow-hidden">
                <ConsoleSelectedPreview
                  game={focusedGame}
                  showTrailerPreview={settings.showTrailerPreview}
                  trailerData={trailerData}
                  mode="thumbnail"
                />
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
                  {isFav && (
                    <span className="rounded-md bg-rose-500/80 px-2.5 py-0.5 text-xs font-medium text-white">Favorite</span>
                  )}
                  {focusedGame.metadata?.legal_notice?.toLowerCase().includes("denuvo") && (
                    <span className="rounded-md bg-red-500/70 px-2.5 py-0.5 text-xs font-medium text-white">Denuvo</span>
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
                  </div>
                )}

                {/* Media source indicators */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                  {heroSrc && (
                    <span className="text-(--color-muted)/50">
                      Artwork: <span className="font-medium text-(--color-muted)/70">steam-metadata</span>
                    </span>
                  )}
                  {focusedGame.steamInstalled && (
                    <span className="text-(--color-muted)/50">
                      Source: <span className="font-medium text-(--color-muted)/70">local</span>
                    </span>
                  )}
                </div>

                {/* Separator */}
                <div className="border-t border-(--color-border)" />

                {/* Achievement progress bar */}
                <div>
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-(--color-muted)" />
                    <span className="text-sm font-semibold text-(--color-text)">Achievements</span>
                  </div>
                  {achievementSummary ? (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-(--color-muted)">
                          {achievementSummary.unlocked} / {achievementSummary.total}
                        </span>
                        <span className="font-semibold tabular-nums text-(--color-text)">
                          {achievementSummary.percent}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-(--color-border)">
                        <div
                          className="h-full rounded-full bg-(--color-accent) transition-all duration-300"
                          style={{ width: `${achievementSummary.percent}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-(--color-muted)">No achievement data</p>
                  )}
                </div>

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

                {/* Separator before hints */}
                <div className="border-t border-(--color-border)" />

                {/* Input hints — driven by settings */}
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {hints.select && <HintTag>{hints.select}</HintTag>}
                  {hints.play && <HintTag>{hints.play}</HintTag>}
                  <HintTag>{hints.options}</HintTag>
                  <HintTag>{hints.search}</HintTag>
                  <HintTag>{hints.profile}</HintTag>
                  <HintTag>{hints.back}</HintTag>
                  {hints.page && <HintTag>{hints.page}</HintTag>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-8">
              <p className="text-center text-sm text-(--color-muted)">Select a game to see details</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom category bar */}
      <div className="shrink-0 border-t border-(--color-border) bg-(--color-bg)/80 backdrop-blur-sm">
        <ConsoleCategoryBar
          activeIndex={activeCategory}
          counts={categoryCounts}
          onSelect={onSelectCategory}
          showHints
          inputHints={settings.inputHints}
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
