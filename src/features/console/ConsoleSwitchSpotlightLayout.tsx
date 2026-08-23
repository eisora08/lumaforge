import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { AppPage } from "../../types/navigation";
import { useFavorites } from "../../context/FavoritesContext";
import { getConsoleHeroBackground, getConsoleCardSrc, getConsoleLogoSrc } from "./consoleMedia";
import { getPlaytimeSecondsForAppId, getPlaytimeSecondsByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";
import { getGameAchievementSummary, getGameLastPlayedTimestamp, formatPlaytime, formatRelativeTime } from "./consoleGameStats";
import type { ConsoleSettings } from "./consoleSettings";
import ConsoleTopHud from "./ConsoleTopHud";
import ConsoleSpotlightDock from "./ConsoleSpotlightDock";
import ConsoleSettingsPanelV2 from "./ConsoleSettingsPanelV2";
import ConsoleActionHints from "./ConsoleActionHints";
import { deduplicateByStableId, getFavoriteKey } from "../../services/gameCacheService";
import { RichEmptyState } from "./ConsoleEmptyState";

const DEBUG_SWITCH_SPOTLIGHT = false;

/* ── Shared layout constants ──
 * These ensure carousel stage and dock are positioned in coordination.
 * Changing any one value automatically adjusts the others.
 *
 *     ┌──────────────────────────────┐
 *     │       hero / game info       │
 *     ├──────────────────────────────┤
 *     │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐   │
 *     │  │  │ │  │ │  │ │  │ │  │   │
 *     │  └──┘ └──┘ └──┘ └──┘ └──┘   │  carousel (CAROUSEL_HEIGHT)
 *     │  ═══ shelf shadow ═══       │
 *     ├──────────────────────────────┤  ◄─ carouselStageBottom
 *     │      card-dock gap           │      (CARD_DOCK_GAP)
 *     ├──────────────────────────────┤
 *     │  [dock pill centered]        │  dock (DOCK_HEIGHT)
 *     ├──────────────────────────────┤  ◄─ DOCK_BOTTOM from viewport
 *     │                              │
 *     └──────────────────────────────┘
 */
const LAYOUT = {
  /** Dock distance from viewport bottom */
  DOCK_BOTTOM: "clamp(64px, 7vh, 96px)",
  /** Dock visual height */
  DOCK_HEIGHT: "70px",
  /** Gap between card visual bottom and dock visual top */
  CARD_DOCK_GAP: "clamp(26px, 3vh, 40px)",
  /** Carousel stage height */
  CAROUSEL_HEIGHT: "clamp(330px, 36vh, 430px)",
  /** Padding inside scroll container so focused card transforms are not clipped */
  SCROLL_PADDING_TOP: "70px",
  SCROLL_PADDING_BOTTOM: "80px",
} as const;

const RAIL_CONFIGS = [
  { title: "Continue Playing", subtitle: "Jump back into your games" },
  { title: "Installed Games", subtitle: "Ready to play" },
  { title: "Lua / In Library", subtitle: "Games with Lua scripts" },
  { title: "Favorites", subtitle: "Your favorite games" },
  { title: "All Games", subtitle: "Every game in your library" },
] as const;

const SECTION_LABELS: Record<string, string> = {
  "Continue Playing": "Continue",
  "Installed Games": "Installed",
  "Lua / In Library": "Lua & In Library",
  "Favorites": "Favorites",
  "All Games": "All Games",
};


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
  dockFocusedIndex?: number;
};

export default function ConsoleSwitchSpotlightLayout({
  focusedGame, rails, focusedRail, focusedIndex,
  onSelectGame, onOptionsGame: _onOptionsGame, onPlayGame: _onPlayGame, layoutMode, onToggleLayout,
  cardVariant: _cv = "landscape", onNavigate,
  categoryCounts, activeCategory, onSelectCategory,
  settings, onSettingsPatch,
  allGames, onRefreshLibrary,
  dockFocusedIndex = -1,
}: Props) {
  const { favoriteIds } = useFavorites();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const heroSrc = getConsoleHeroBackground(focusedGame);
  const logoSrc = useMemo(() => getConsoleLogoSrc(focusedGame), [focusedGame]);
  const [logoNaturalHeight, setLogoNaturalHeight] = useState<number | null>(null);
  const handleLogoLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setLogoNaturalHeight(e.currentTarget.naturalHeight);
  }, []);
  useEffect(() => { setLogoNaturalHeight(null); }, [logoSrc]);
  const logoDisplayHeight = (() => {
    if (logoNaturalHeight == null) return undefined;
    const MIN_H = 80;
    const MAX_H = 150;
    return Math.max(MIN_H, Math.min(MAX_H, logoNaturalHeight));
  })();
  const isFav = focusedGame ? favoriteIds.has(getFavoriteKey(focusedGame) ?? focusedGame.id) : false;

  const scs = settings.spotlightCardStyle;

  const currentRail = focusedRail >= 0 && focusedRail < rails.length ? rails[focusedRail] : [];
  const dedupedRail = useMemo(() => deduplicateByStableId(currentRail), [currentRail]);

  const useHeroMotion = settings.heroMotion;
  const railTitle = RAIL_CONFIGS[focusedRail >= 0 ? focusedRail : 0].title;
  const sectionLabel = SECTION_LABELS[railTitle] ?? railTitle;

  const playtimeSeconds = useMemo(() => {
    if (!focusedGame) return 0;
    const byAppId = focusedGame.appId ? getPlaytimeSecondsForAppId(focusedGame.appId) : 0;
    if (byAppId > 0) return byAppId;
    return getPlaytimeSecondsByGameKey(resolvePlaytimeKey(focusedGame));
  }, [focusedGame]);

  const playtimeDisplay = useMemo(() => formatPlaytime(playtimeSeconds), [playtimeSeconds]);

  const achievementSummary = useMemo(() => {
    return focusedGame ? getGameAchievementSummary(focusedGame) : null;
  }, [focusedGame]);

  const lastPlayedStr = useMemo(() => {
    if (!focusedGame) return null;
    const ts = getGameLastPlayedTimestamp(focusedGame);
    return ts ? formatRelativeTime(ts) : null;
  }, [focusedGame]);

  const genres = useMemo(() => {
    if (!focusedGame?.metadata?.genres) return null;
    return focusedGame.metadata.genres.slice(0, 3);
  }, [focusedGame]);

  const releaseYear = useMemo(() => {
    if (!focusedGame?.metadata?.release_date) return null;
    const m = focusedGame.metadata.release_date.match(/^(\d{4})/);
    return m ? m[1] : null;
  }, [focusedGame]);

  const developer = useMemo(() => {
    return focusedGame?.metadata?.developer ?? null;
  }, [focusedGame]);

  const spotlightVariant = scs.cardStyle === "poster" ? "poster" : ("landscape" as const);

  /* Carousel stage bottom edge = dock bottom + dock height + card-dock gap
   * This ensures the dock stays close to but never overlaps the cards. */
  const carouselStageBottom = `calc(${LAYOUT.DOCK_BOTTOM} + ${LAYOUT.DOCK_HEIGHT} + ${LAYOUT.CARD_DOCK_GAP})`;

  const scrollRow = useCallback((dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (focusedIndex < 0 || !scrollRef.current) return;
    const cards = scrollRef.current.children;
    const card = cards[focusedIndex] as HTMLElement | undefined;
    if (card) {
      card.scrollIntoView({ behavior: settings.smoothScrolling ? "smooth" : "auto", block: "nearest", inline: "center" });
    }
  }, [focusedIndex]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--console-bg)">

      {/* ── Layer 1: Hero background — z-[0] ── */}
      <div className="absolute inset-0 z-[0] overflow-hidden">
        {heroSrc ? (
          <div className={`h-full w-full ${useHeroMotion ? "spotlight-hero-motion" : ""}`}>
            <img
              key={focusedGame?.appId ?? "none"}
              src={heroSrc}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          </div>
        ) : (
          <div className="h-full w-full bg-(--color-surface)" />
        )}

        <div className="spotlight-grain-overlay absolute inset-0 pointer-events-none" />
        <div className="spotlight-vignette absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-(--color-bg) via-(--color-bg)/70 to-transparent" />
      </div>

      {/* ── Layer 2: Top HUD — z-[50] ── */}
      <div
        className="absolute z-[50] pointer-events-auto"
        style={{
          top: "clamp(12px, 1.2vh, 22px)",
          left: "clamp(16px, 1.5vw, 28px)",
          right: "clamp(16px, 1.5vw, 28px)",
        }}
      >
        {DEBUG_SWITCH_SPOTLIGHT && (
          <div className="pointer-events-none absolute inset-0 z-[9999] border-2 border-dashed border-cyan-400/60" />
        )}
        <ConsoleTopHud
          layoutMode={layoutMode}
          onToggleLayout={onToggleLayout}
          onNavigate={onNavigate}
          onOpenSettings={() => setSettingsOpen(true)}
          settings={settings}
        />
      </div>

      {/* ── Layer 3: Game info — z-[20], left: logo or plain title (no badges) ── */}
      {focusedGame && logoSrc ? (
        <div
          className="absolute z-[20]"
          style={{
            left: "clamp(52px, 5vw, 96px)",
            top: "clamp(170px, 24vh, 280px)",
            maxWidth: "min(560px, 42vw)",
          }}
        >
          <img
            key={focusedGame.appId}
            src={logoSrc}
            alt={focusedGame.title}
            className="object-contain drop-shadow-2xl w-auto"
            style={logoDisplayHeight != null
              ? { height: `${logoDisplayHeight}px`, maxWidth: "min(560px, 42vw)" }
              : { maxHeight: "clamp(80px, 12vh, 150px)", maxWidth: "clamp(280px, 28vw, 560px)" }
            }
            onLoad={handleLogoLoad}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      ) : focusedGame ? (
        <div
          className="absolute z-[20]"
          style={{
            left: "clamp(52px, 5vw, 96px)",
            top: "clamp(170px, 24vh, 280px)",
            maxWidth: "min(680px, 44vw)",
          }}
        >
          <h1
            className="font-bold text-(--color-text) drop-shadow-2xl leading-tight line-clamp-2"
            style={{ fontSize: "clamp(28px, 2.4vw, 44px)" }}
          >
            {focusedGame.title}
          </h1>
        </div>
      ) : null}

      {/* ── Layer 4: Right metadata + badges — z-[20], anchored to card row ── */}
      {dedupedRail.length > 0 && focusedGame && (
        <div
          className="absolute z-[20] flex flex-col items-end gap-1"
          style={{
            right: "clamp(56px, 5vw, 100px)",
            bottom: `calc(${carouselStageBottom} + ${LAYOUT.CAROUSEL_HEIGHT} + 50px)`,
            maxWidth: "min(420px, 36vw)",
          }}
        >
          {/* Row 1: Status badges */}
          {(focusedGame.steamInstalled || focusedGame.isLuaActive || focusedGame.hasUpdate || isFav) && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {focusedGame.steamInstalled && (
                <span className="rounded-md bg-emerald-500/80 px-2 py-0.5 text-[11px] font-medium text-black backdrop-blur-sm">Installed</span>
              )}
              {focusedGame.isLuaActive && (
                <span className="rounded-md bg-violet-500/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">Lua</span>
              )}
              {focusedGame.hasUpdate && (
                <span className="rounded-md bg-amber-500/80 px-2 py-0.5 text-[11px] font-medium text-black backdrop-blur-sm">Update</span>
              )}
              {isFav && (
                <span className="rounded-md bg-rose-500/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">Favorite</span>
              )}
            </div>
          )}

          {/* Row 2: Genres · developer · year (plain text) */}
          {(genres || developer || releaseYear) && (
            <p className="text-[11px] font-medium leading-relaxed text-white/50 tracking-wide">
              {genres?.join(" · ")}
              {genres && (developer || releaseYear) && <span className="mx-1.5 text-white/25">·</span>}
              {developer}{developer && releaseYear ? <span className="mx-1.5 text-white/25">·</span> : null}
              {releaseYear}
            </p>
          )}

          {/* Row 3: Playtime · achievements · last played (small muted text) */}
          {(playtimeDisplay || achievementSummary || lastPlayedStr) && (
            <p className="text-[11px] font-medium text-white/40 tracking-wide">
              {playtimeDisplay}
              {playtimeDisplay && (achievementSummary || lastPlayedStr) && <span className="mx-1.5 text-white/20">·</span>}
              {achievementSummary && `${achievementSummary.unlocked}/${achievementSummary.total}`}
              {achievementSummary && lastPlayedStr && <span className="mx-1.5 text-white/20">·</span>}
              {lastPlayedStr}
            </p>
          )}
        </div>
      )}

      {/* ── Layer 7: Carousel stage — z-[30] ──
       *
       *  Action hints are placed INSIDE the stage (z-[15]) to anchor them
       *  directly above the card row, not floating in the hero area.
       *  Metadata remains outside (Layer 4) positioned at the same
       *  vertical zone.
       *
       *
       *  bottom = dock bottom + dock height + card-dock gap.
       *  This guarantees coordinated positioning: change any LAYOUT constant
       *  and carousel/dock move together.
       *
       *  overflow: visible on the stage prevents clipping of card transforms
       *  that extend beyond the container (focused card shadow/glow).
       *
       *  The inner scroll container uses overflow-x: auto (which coerces
       *  overflow-y). To prevent clipping of focused card translateY, the
       *  scroll container has generous top/bottom padding that gives the
       *  card room to move vertically.
       */}
      <div
        className="absolute left-0 right-0 z-[30] overflow-visible"
        style={{
          height: LAYOUT.CAROUSEL_HEIGHT,
          bottom: carouselStageBottom,
        }}
      >
        {DEBUG_SWITCH_SPOTLIGHT && (
          <div className="pointer-events-none absolute inset-0 z-[9999] border-2 border-dashed border-yellow-400/60" />
        )}

        {/* Action hints — INSIDE stage, anchored above focused card
         *
         *  bottom: CAROUSEL_HEIGHT - 26px places the element's bottom edge
         *  26px below the stage's top edge.  The focused card visual top is
         *  at 38px (70px scroll padding - 32px translateY lift), so the
         *  gap from hints bottom to card top = 38 - 26 = 12px.
         *
         *  overflow: visible on the stage lets hints extend above stage
         *  bounds without clipping. */}
        {settings.showButtonHints && focusedGame && dedupedRail.length > 0 && dockFocusedIndex < 0 && (
          <div className="absolute left-1/2 z-[25] -translate-x-1/2 pointer-events-none"
            style={{ bottom: `calc(${LAYOUT.CAROUSEL_HEIGHT} - 26px)` }}>
            <div className="pointer-events-auto">
              <ConsoleActionHints hintStyle={settings.inputHints} visible={settings.showButtonHints} />
            </div>
          </div>
        )}

        {/* Shelf shadow — soft floating glow under cards */}
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-[0] rounded-full blur-[70px]"
          style={{
            bottom: "6px",
            width: "clamp(400px, 65vw, 900px)",
            height: "clamp(64px, 7.5vh, 100px)",
            background: "radial-gradient(ellipse at center, rgba(0,0,0,0.35), transparent 65%)",
            opacity: 0.55,
          }}
        />

        {/* Section label */}
        <div className="px-[clamp(48px,5vw,96px)] mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-(--color-muted)/50">
            {sectionLabel}
          </span>
          <span className="ml-2 text-xs tabular-nums text-(--color-muted)/40">
            {dedupedRail.length}
          </span>
        </div>

        {/* Scroll wrapper */}
        <div className="relative group/row">
          {/* Left scroll arrow */}
          <button
            type="button"
            onClick={() => scrollRow("left")}
            className="absolute left-2 top-1/2 z-40 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* Card row — padding on scroll container prevents clipping of
           * focused card translateY(-30px). The scroll container clips
           * overflow, but with 70px top + 80px bottom padding, the card
           * has room to move before clipping begins. */}
          <div
            ref={scrollRef}
            className={`flex items-center overflow-x-auto overflow-y-visible scrollbar-none ${
              settings.horizontalScrolling ? "snap-x" : ""
            } ${
              settings.smoothScrolling ? "scroll-smooth" : ""
            }`}
            style={{
              gap: `${settings.spotlightCardGap}px`,
              paddingTop: LAYOUT.SCROLL_PADDING_TOP,
              paddingBottom: LAYOUT.SCROLL_PADDING_BOTTOM,
              paddingLeft: "clamp(48px, 10vw, 160px)",
              paddingRight: "clamp(48px, 10vw, 160px)",
            }}
          >
            {dedupedRail.length > 0 ? (
              dedupedRail.map((game, i) => {
                const isFocused = focusedIndex === i;
                const src = getConsoleCardSrc(game, spotlightVariant);
                const isFav = favoriteIds.has(getFavoriteKey(game) ?? game.id);

                return (
                  <div
                    key={"switch:" + (game.appId || game.id)}
                    role="button"
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={game.title}
                    onClick={() => onSelectGame(game)}
                    className={`relative shrink-0 cursor-pointer transition-all duration-[260ms] ease-out ${
                      isFocused
                        ? `z-[80] scale-[1.14] -translate-y-[32px] opacity-100 saturate-[1.06] brightness-[1.04] border-(--color-accent) ring-3 ring-(--color-accent)/70`
                        : `z-[5] scale-[0.97] opacity-[0.85] brightness-[0.93] hover:!z-[30] hover:!scale-[1.04] hover:!-translate-y-2 hover:!opacity-100 hover:!brightness-100`
                    }`}
                    style={{
                      borderRadius: scs.cornerRadius,
                      width: spotlightVariant === "poster"
                        ? `${Math.round(scs.widthPreset * 0.625)}px`
                        : `${scs.widthPreset}px`,
                      boxShadow: isFocused
                        ? "0 40px 90px -24px rgba(0,0,0,0.75), 0 0 60px color-mix(in srgb, var(--color-accent) 25%, transparent)"
                        : undefined,
                      willChange: "transform",
                      transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
                      transitionDuration: "260ms",
                      transitionProperty: "transform, opacity, box-shadow",
                    }}
                  >
                    
                    <div
                      className={`relative overflow-hidden ${
                        spotlightVariant === "poster" ? "aspect-[2/3]" : "aspect-[16/10]"
                      }`}
                      style={{ borderRadius: scs.cornerRadius }}
                    >
                      {src ? (
                        <img
                          key={game.appId || game.id}
                          src={src}
                          alt={game.title}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
                          <span className="text-3xl text-(--color-muted)/20">
                            {game.title?.charAt(0)?.toUpperCase() ?? "?"}
                          </span>
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100" />

                      {/* Focus shine */}
                      {isFocused && settings.focusShine !== false && (
                        <div
                          className="pointer-events-none absolute inset-0 overflow-hidden console-card-shine"
                          style={{ borderRadius: scs.cornerRadius, mixBlendMode: "screen" }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              background: "linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.12) 50%, transparent 65%)",
                              animation: "console-shine-sweep 1.8s ease-in-out infinite",
                            }}
                          />
                        </div>
                      )}

                      {/* Favorite heart */}
                      {isFav && (
                        <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                          <HeartIcon />
                        </div>
                      )}

                      {/* Badges */}
                      <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                        {game.steamInstalled && (
                          <span className="rounded-md bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
                            Installed
                          </span>
                        )}
                        {game.isLuaActive && (
                          <span className="rounded-md bg-violet-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                            Lua
                          </span>
                        )}
                        {game.hasUpdate && (
                          <span className="rounded-md bg-amber-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
                            Update
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <RichEmptyState railIndex={focusedRail >= 0 ? focusedRail : 0} />
            )}
          </div>

          {/* Right scroll arrow */}
          <button
            type="button"
            onClick={() => scrollRow("right")}
            className="absolute right-2 top-1/2 z-40 hidden h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 shadow-xl backdrop-blur transition hover:bg-black/80 group-hover/row:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Layer 8: Switch-style dock — z-[60] ──
       *
       *  Centered pill, positioned via shared LAYOUT.DOCK_BOTTOM.
       *  Completely separate DOM element from carousel stage.
       *  Gap between dock and cards is controlled by LAYOUT.CARD_DOCK_GAP.
       */}
      <div
        className="absolute left-1/2 z-[60]"
        style={{
          bottom: LAYOUT.DOCK_BOTTOM,
          transform: "translateX(-50%)",
        }}
      >
        {DEBUG_SWITCH_SPOTLIGHT && (
          <div className="pointer-events-none absolute inset-0 z-[9999] border-2 border-dashed border-rose-400/60" />
        )}
        <ConsoleSpotlightDock
          activeIndex={activeCategory}
          focusedIndex={dockFocusedIndex}
          counts={categoryCounts}
          onSelect={onSelectCategory}
        />
      </div>

      {/* ── Layer 9: Bottom hints — z-[60] ── */}
      <div
        className="absolute z-[60]"
        style={{
          bottom: "clamp(24px, 2.5vh, 32px)",
          right: "clamp(28px, 3vw, 38px)",
        }}
      >
        <span className="text-[11px] font-medium text-(--color-muted)/40 tracking-wider">
          {dockFocusedIndex >= 0
            ? "Arrows · Enter select · Esc unfocus"
            : "Keyboard · Arrows · Enter"}
        </span>
      </div>

      {/* Settings panel */}
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

function HeartIcon() {
  return (
    <svg className="h-3 w-3 fill-rose-400 text-rose-400" viewBox="0 0 24 24" stroke="none">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}
