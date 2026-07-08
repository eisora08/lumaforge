import { useState } from "react";
import type { LibraryGame } from "../../types/libraryGame";
import type { AppPage } from "../../types/navigation";
import { useFavorites } from "../../context/FavoritesContext";
import { getConsoleHeroBackground } from "./consoleMedia";
import type { ConsoleSettings } from "./consoleSettings";
import ConsoleHomeRail from "./ConsoleHomeRail";
import ConsoleTopHud from "./ConsoleTopHud";
import ConsoleCategoryBar from "./ConsoleCategoryBar";
import ConsoleSettingsOverlay from "./ConsoleSettingsOverlay";

const RAIL_CONFIGS = [
  { title: "Continue Playing", subtitle: "Jump back into your games" },
  { title: "Installed Games", subtitle: "Ready to play" },
  { title: "Lua / In Library", subtitle: "Games with Lua scripts" },
  { title: "Favorites", subtitle: "Your favorite games" },
  { title: "All Games", subtitle: "Every game in your library" },
] as const;

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
};

export default function ConsoleSpotlightLayout({
  focusedGame, rails, focusedRail, focusedIndex,
  onSelectGame, layoutMode, onToggleLayout,
  cardVariant = "landscape", onNavigate,
  categoryCounts, activeCategory, onSelectCategory,
  settings, onSettingsPatch,
}: Props) {
  const { favoriteIds } = useFavorites();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const heroSrc = getConsoleHeroBackground(focusedGame);
  const isFav = focusedGame?.appId ? favoriteIds.has(focusedGame.appId) : false;

  const currentRail = focusedRail >= 0 && focusedRail < rails.length ? rails[focusedRail] : [];

  return (
    <div className="flex h-full min-h-screen flex-col bg-(--color-bg)">
      {/* Hero section — fixed height decorative at top */}
      <div className="relative h-[55vh] min-h-[300px] shrink-0 overflow-hidden">
        {heroSrc ? (
          <img
            key={focusedGame?.appId ?? "none"}
            src={heroSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-full w-full bg-(--color-surface)" />
        )}
        {/* Gradient fade to bg at bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-(--color-bg) via-(--color-bg)/80 to-transparent" />

        {/* HUD on top of hero */}
        <div className="absolute inset-x-0 top-0">
          <ConsoleTopHud
            layoutMode={layoutMode}
            onToggleLayout={onToggleLayout}
            onNavigate={onNavigate}
            onOpenSettings={() => setSettingsOpen(true)}
            settings={settings}
          />
        </div>

        {/* Hero title + badges at bottom of hero section */}
        {focusedGame && (
          <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-6">
            <h1 className="mb-3 text-4xl font-bold text-(--color-text) drop-shadow-2xl md:text-5xl lg:text-6xl">
              {focusedGame.title}
            </h1>
            <div className="flex flex-wrap gap-2">
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
            </div>
          </div>
        )}
      </div>

      {/* Carousel section — clearly separated below hero */}
      <div className="flex flex-1 flex-col bg-(--color-bg)">
        {currentRail.length > 0 ? (
          <div className="flex-1 px-4 pt-6 pb-2">
            <ConsoleHomeRail
              title={RAIL_CONFIGS[focusedRail >= 0 ? focusedRail : 0].title}
              subtitle={RAIL_CONFIGS[focusedRail >= 0 ? focusedRail : 0].subtitle}
              games={currentRail}
              railIndex={focusedRail >= 0 ? focusedRail : 0}
              focusedRail={focusedRail}
              focusedIndex={focusedIndex}
              onSelectGame={onSelectGame}
              cardCompact={cardVariant === "poster"}
              cardVariant={cardVariant}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-4">
            <p className="text-sm text-(--color-muted)">No games in this category</p>
          </div>
        )}
      </div>

      {/* Category bar at very bottom */}
      <div className="shrink-0 border-t border-(--color-border) bg-(--color-bg)/80 backdrop-blur-sm">
        <ConsoleCategoryBar
          activeIndex={activeCategory}
          counts={categoryCounts}
          onSelect={onSelectCategory}
          showHints
          inputHints={settings.inputHints}
        />
      </div>

      {/* Settings overlay */}
      <ConsoleSettingsOverlay
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onPatch={onSettingsPatch}
      />
    </div>
  );
}
