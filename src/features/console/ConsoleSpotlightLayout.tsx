import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { AppPage } from "../../types/navigation";
import { useFavorites } from "../../context/FavoritesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { getConsoleHeroBackground } from "./consoleMedia";
import { getFavoriteKey } from "../../services/gameCacheService";
import { getPlaytimeSecondsForAppId, getPlaytimeSecondsByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";
import { getGameAchievementSummary, getGameLastPlayedTimestamp } from "./consoleGameStats";
import type { ConsoleSettings } from "./consoleSettings";
import ConsoleHomeRail from "./ConsoleHomeRail";
import ConsoleTopHud from "./ConsoleTopHud";
import ConsoleSpotlightDock from "./ConsoleSpotlightDock";
import ConsoleSettingsPanelV2 from "./ConsoleSettingsPanelV2";

const DEBUG_SPOTLIGHT_LAYOUT = false;

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

function formatPlaytime(seconds: number): string | null {
  if (seconds < 60) return null;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  return days <= 7 ? `${days}d ago` : new Date(ts * 1000).toLocaleDateString();
}

type Props = {
  focusedGame: LibraryGame | null;
  rails: LibraryGame[][];
  focusedRail: number;
  focusedIndex: number;
  onSelectGame: (game: LibraryGame) => void;
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
};

export default function ConsoleSpotlightLayout({
  focusedGame, rails, focusedRail, focusedIndex,
  onSelectGame, layoutMode, onToggleLayout,
  cardVariant = "landscape", onNavigate,
  categoryCounts, activeCategory, onSelectCategory,
  settings, onSettingsPatch,
  allGames, onRefreshLibrary,
}: Props) {
  const { t } = useTranslation();
  const { favoriteIds } = useFavorites();
  const session = useGameSession();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const runningGameKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, s] of Object.entries(session.sessions)) {
      if (s.state === "running" || s.state === "launching") {
        if (s.appId) keys.add(s.appId);
        keys.add(key);
      }
    }
    return keys;
  }, [session.sessions]);

  const heroSrc = getConsoleHeroBackground(focusedGame);
  const isFav = focusedGame ? favoriteIds.has(getFavoriteKey(focusedGame) ?? focusedGame.id) : false;

  const currentRail = focusedRail >= 0 && focusedRail < rails.length ? rails[focusedRail] : [];

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

      {/* ── Layer 2: Top HUD — z-[50] above everything ── */}
      <div
        className="absolute z-[50] pointer-events-auto"
        style={{
          top: "clamp(16px, 1.5vh, 28px)",
          left: "clamp(20px, 2vw, 36px)",
          right: "clamp(20px, 2vw, 36px)",
        }}
      >
        <ConsoleTopHud
          layoutMode={layoutMode}
          onToggleLayout={onToggleLayout}
          onNavigate={onNavigate}
          onOpenSettings={() => setSettingsOpen(true)}
          settings={settings}
          allGames={allGames}
        />
      </div>

      {/* ── Layer 3: Hero title + metadata — z-[10] ── */}
      {focusedGame && (
        <div
          className="absolute z-[10] max-w-[clamp(320px,42vw,640px)]"
          style={{
            left: "clamp(40px, 4vw, 84px)",
            top: "38vh",
            transform: "translateY(-50%)",
          }}
        >
          <h1 className="mb-3 text-4xl font-bold text-(--color-text) drop-shadow-2xl md:text-5xl lg:text-6xl leading-tight">
            {focusedGame.title}
          </h1>

          <div className="mb-3 flex flex-wrap gap-2">
            {focusedGame.steamInstalled && (
              <span className="rounded-md bg-emerald-500/80 px-2.5 py-0.5 text-xs font-medium text-black backdrop-blur-sm">{t("settings.installed", "Installed")}</span>
            )}
            {focusedGame.isLuaActive && (
              <span className="rounded-md bg-violet-500/80 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{t("console_settings.lua", "Lua")}</span>
            )}
            {focusedGame.hasUpdate && (
              <span className="rounded-md bg-amber-500/80 px-2.5 py-0.5 text-xs font-medium text-black backdrop-blur-sm">{t("console_settings.update", "Update")}</span>
            )}
            {focusedGame.source === "steam" && !focusedGame.hasLua && (
              <span className="rounded-md bg-blue-500/80 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{t("console_settings.steam", "Steam")}</span>
            )}
            {focusedGame.source === "epic" && (
              <span className="rounded-md bg-purple-500/80 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{t("console_settings.epic", "Epic")}</span>
            )}
            {isFav && (
              <span className="rounded-md bg-rose-500/80 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{t("console_settings.favorite", "Favorite")}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {genres?.map((g) => (
              <span key={g} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">
                {g}
              </span>
            ))}
            {releaseYear && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">
                {releaseYear}
              </span>
            )}
            {developer && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-md ring-1 ring-white/10">
                {developer}
              </span>
            )}
            {playtimeDisplay && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">
                {playtimeDisplay}
              </span>
            )}
            {achievementSummary && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-md ring-1 ring-white/10">
                <Trophy className="h-3 w-3" />
                {achievementSummary.unlocked}/{achievementSummary.total}
              </span>
            )}
            {lastPlayedStr && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-md ring-1 ring-white/10">
                {lastPlayedStr}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Layer 4: Carousel stage — z-[40], above dock at z-[30] ── */}
      {/*
        The carousel stage owns its own stacking context via z-[40].
        ALL cards inside it are effectively at z-40 in the root context,
        which is ABOVE the dock at z-[30].

        The focused card (z-[80] inside the carousel) and non-focused
        cards (z-[5]) only compete WITHIN the carousel — the entire
        carousel stage is always above the dock.

        overflow-visible ensures card transforms (translateY, scale)
        are never clipped by this container.
      */}
      <div
        className="absolute left-0 right-0 overflow-visible"
        style={{
          zIndex: 40,
          bottom: "clamp(150px, 14vh, 180px)",
          height: "clamp(330px, 34vh, 400px)",
        }}
      >
        {/* Debug outline */}
        {DEBUG_SPOTLIGHT_LAYOUT && (
          <div className="pointer-events-none absolute inset-0 z-[9999] border-2 border-dashed border-cyan-400/60" />
        )}

        {/* Shelf shadow — soft radial glow behind cards */}
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-[0] rounded-full opacity-[0.15] blur-[60px]"
          style={{
            bottom: "40px",
            width: "clamp(400px, 70vw, 900px)",
            height: "clamp(60px, 8vh, 90px)",
            background: "radial-gradient(ellipse at center, var(--color-accent), transparent 70%)",
          }}
        />

        {/* Rail label + card count */}
        <div className="px-[clamp(40px,4vw,84px)] mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-(--color-muted)/50">
            {sectionLabel}
          </span>
          <span className="ml-2 text-xs tabular-nums text-(--color-muted)/40">
            {currentRail.length}
          </span>
        </div>

        {currentRail.length > 0 ? (
          <div className="h-full">
            <ConsoleHomeRail
              title={railTitle}
              subtitle={RAIL_CONFIGS[focusedRail >= 0 ? focusedRail : 0].subtitle}
              games={currentRail}
              railIndex={focusedRail >= 0 ? focusedRail : 0}
              focusedRail={focusedRail}
              focusedIndex={focusedIndex}
              onSelectGame={onSelectGame}
              runningGameKeys={runningGameKeys}
              cardCompact={cardVariant === "poster"}
              cardVariant={cardVariant}
              cardWidth={settings.spotlightCardStyle?.widthPreset ?? 320}
              cardGap={settings.spotlightCardGap}
              noCardLabels
              hideHeader
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-(--color-muted)/60">
              {t("console_settings.no_games_in_category", "No games in")} {sectionLabel}
            </p>
          </div>
        )}
      </div>

      {/* ── Layer 5: Dock zone — z-[30], BELOW carousel stage ── */}
      {/*
        Dedicated dock zone. Always visible at bottom center.
        COMPLETELY separate from the carousel — it is an absolute-positioned
        sibling at the root level, NOT inside any scroll or carousel container.

        z-[30] is below the carousel stage's z-[40], so the dock sits
        visually behind the carousel area. The gap between carousel bottom
        and dock top ensures clear separation.
      */}
      <div
        className="absolute left-0 right-0 z-[30] flex justify-center"
        style={{
          bottom: "clamp(20px, 2.5vh, 34px)",
          height: "88px",
        }}
      >
        {/* Debug outline */}
        {DEBUG_SPOTLIGHT_LAYOUT && (
          <div className="pointer-events-none absolute inset-0 z-[9999] border-2 border-dashed border-rose-400/60" />
        )}

        <div className="flex items-center justify-center">
          <ConsoleSpotlightDock
            activeIndex={activeCategory}
            counts={categoryCounts}
            onSelect={onSelectCategory}
          />
        </div>
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
