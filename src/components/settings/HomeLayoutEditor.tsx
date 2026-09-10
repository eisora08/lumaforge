import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  RotateCcw,
  Sparkles,
  Gamepad2,
  Heart,
  Star,
  TrendingUp,
  Store,
  Zap,
  Clock,
  Trophy,
  FolderOpen,
  BookOpen,
  ListPlus,
  ChevronDown,
  ChevronUp,
  Lock,
  Check,
} from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import ToggleOption from "./ToggleOption";
import SettingsSection from "./SettingsSection";

type LayoutTab = "hero" | "sections";

/* ================================================================== */
/*  HERO SOURCE METADATA                                               */
/* ================================================================== */

interface HeroSourceMeta {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  labelKey: string;
  descriptionKey: string;
  disabled?: boolean;
}

const HERO_SOURCES: HeroSourceMeta[] = [
  { id: "continuePlaying", label: "Continue Playing", icon: <Gamepad2 className="h-4 w-4" />, color: "text-emerald-400", description: "Recently played games with resume action", labelKey: "homeLayout.continue_playing", descriptionKey: "homeLayout.continue_playing_desc" },
  { id: "favorites", label: "Favorites", icon: <Heart className="h-4 w-4" />, color: "text-rose-400", description: "Your favorite games", labelKey: "homeLayout.favorites_label", descriptionKey: "homeLayout.favorites_desc" },
  { id: "recentlyPlayed", label: "Recently Played", icon: <Clock className="h-4 w-4" />, color: "text-sky-400", description: "Games you played recently", labelKey: "homeLayout.recently_played_label", descriptionKey: "homeLayout.recently_played_desc" },
  { id: "topPlayed", label: "Top Played", icon: <TrendingUp className="h-4 w-4" />, color: "text-blue-400", description: "Most played games by time", labelKey: "homeLayout.top_played", descriptionKey: "homeLayout.top_played_desc" },
  { id: "recommended", label: "Recommended", icon: <Star className="h-4 w-4" />, color: "text-amber-400", description: "Personalized suggestions from your library and catalog", labelKey: "homeLayout.recommended", descriptionKey: "homeLayout.recommended_desc" },
  { id: "featured", label: "Featured Picks", icon: <Store className="h-4 w-4" />, color: "text-purple-400", description: "Curated games from global catalog", labelKey: "homeLayout.featured_picks", descriptionKey: "homeLayout.featured_picks_desc" },
  { id: "newNoteworthy", label: "New & Noteworthy", icon: <Zap className="h-4 w-4" />, color: "text-orange-400", description: "Recently released or highlighted games", labelKey: "homeLayout.new_noteworthy", descriptionKey: "homeLayout.new_noteworthy_desc" },
  { id: "manualGames", label: "Manual Games", icon: <BookOpen className="h-4 w-4" />, color: "text-teal-400", description: "Your manually added games", labelKey: "homeLayout.manual_games", descriptionKey: "homeLayout.manual_games_desc" },
  { id: "steamGames", label: "Steam Games", icon: <Trophy className="h-4 w-4" />, color: "text-indigo-400", description: "Games from your Steam library", labelKey: "homeLayout.steam_games", descriptionKey: "homeLayout.steam_games_desc" },
  { id: "collections", label: "Collections", icon: <FolderOpen className="h-4 w-4" />, color: "text-gray-400", description: "Custom game collections", labelKey: "homeLayout.collections", descriptionKey: "homeLayout.collections_desc", disabled: true },
];

const DEFAULT_HERO_SOURCES = ["continuePlaying", "favorites"];

/* ================================================================== */
/*  SECTION METADATA                                                   */
/* ================================================================== */

interface SectionMeta {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  labelKey: string;
  descriptionKey: string;
  heroSourceId?: string;
}

const DASHBOARD_SECTIONS: SectionMeta[] = [
  { id: "continue-playing", label: "Continue Playing", icon: <Gamepad2 className="h-4 w-4" />, color: "text-emerald-400", description: "Recently played games with resume action", labelKey: "homeLayout.continue_playing", descriptionKey: "homeLayout.continue_playing_desc", heroSourceId: "continuePlaying" },
  { id: "play-next", label: "Play Next", icon: <ListPlus className="h-4 w-4" />, color: "text-cyan-400", description: "Your queued games to play next", labelKey: "homeLayout.play_next", descriptionKey: "homeLayout.play_next_desc" },
  { id: "in-progress", label: "In Progress", icon: <TrendingUp className="h-4 w-4" />, color: "text-amber-400", description: "Games you're currently playing", labelKey: "homeLayout.in_progress", descriptionKey: "homeLayout.in_progress_desc" },
  { id: "completed", label: "Completed", icon: <Check className="h-4 w-4" />, color: "text-emerald-400", description: "Games you've finished", labelKey: "homeLayout.completed", descriptionKey: "homeLayout.completed_desc" },
  { id: "favorites", label: "Favorites", icon: <Heart className="h-4 w-4" />, color: "text-rose-400", description: "Your favorited games", labelKey: "homeLayout.favorites_label", descriptionKey: "homeLayout.favorites_desc", heroSourceId: "favorites" },
  { id: "recommended", label: "Recommended", icon: <Star className="h-4 w-4" />, color: "text-amber-400", description: "Personalized suggestions from catalog", labelKey: "homeLayout.recommended", descriptionKey: "homeLayout.recommended_desc", heroSourceId: "recommended" },
  { id: "top-played", label: "Top Played", icon: <TrendingUp className="h-4 w-4" />, color: "text-blue-400", description: "Most played games by time", labelKey: "homeLayout.top_played", descriptionKey: "homeLayout.top_played_desc", heroSourceId: "topPlayed" },
  { id: "featured-picks", label: "Featured Picks", icon: <Store className="h-4 w-4" />, color: "text-purple-400", description: "Curated games from global catalog", labelKey: "homeLayout.featured_picks", descriptionKey: "homeLayout.featured_picks_desc", heroSourceId: "featured" },
  { id: "top-picks", label: "Top Picks", icon: <Trophy className="h-4 w-4" />, color: "text-yellow-400", description: "Highly rated games from the catalog", labelKey: "homeLayout.top_picks", descriptionKey: "homeLayout.top_picks_desc", heroSourceId: "topPicks" },
  { id: "trending-right-now", label: "Trending Right Now", icon: <Zap className="h-4 w-4" />, color: "text-orange-400", description: "Recent releases and new arrivals", labelKey: "homeLayout.trending_right_now", descriptionKey: "homeLayout.trending_right_now_desc" },
  { id: "store-highlights", label: "Store Highlights", icon: <Store className="h-4 w-4" />, color: "text-cyan-400", description: "Quick link to the store", labelKey: "homeLayout.store_highlights", descriptionKey: "homeLayout.store_highlights_desc" },
  { id: "collections", label: "Collections", icon: <FolderOpen className="h-4 w-4" />, color: "text-indigo-400", description: "Browse your game collections", labelKey: "homeLayout.collections", descriptionKey: "homeLayout.collections_desc" },
];

const DEFAULT_LIMITS: Record<string, number> = {
  "continue-playing": 12,
  "play-next": 12,
  "in-progress": 12,
  "completed": 12,
  "favorites": 12,
  "recommended": 12,
  "top-played": 12,
  "featured-picks": 8,
  "top-picks": 8,
  "trending-right-now": 8,
  "store-highlights": 4,
  "collections": 8,
};

const ROTATE_PRESETS = [
  { label: "8s", value: 8 },
  { label: "12s", value: 12 },
  { label: "15s", value: 15 },
  { label: "20s", value: 20 },
  { label: "30s", value: 30 },
];

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */

export default function HomeLayoutEditor() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [activeTab, setActiveTab] = useState<LayoutTab>("hero");
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const sectionVisibility = settings.dashboardSectionVisibility;
  const sectionLimits = settings.dashboardSectionLimits;
  const heroSources = settings.dashboardHeroSources ?? DEFAULT_HERO_SOURCES;
  const heroMaxSources = settings.dashboardHeroMaxSources ?? 2;

  function isSectionVisible(id: string): boolean {
    if (id in sectionVisibility) return sectionVisibility[id];
    return true; // default visible
  }

  function getSectionLimit(id: string): number {
    if (id in sectionLimits) return sectionLimits[id];
    return DEFAULT_LIMITS[id] || 12;
  }

  function toggleSection(id: string) {
    const next = { ...sectionVisibility, [id]: !isSectionVisible(id) };
    updateSetting("dashboardSectionVisibility", next);
  }

  function setSectionLimit(id: string, value: number) {
    const clamped = Math.max(2, Math.min(24, value));
    const next = { ...sectionLimits, [id]: clamped };
    updateSetting("dashboardSectionLimits", next);
  }

  function toggleHeroSource(sourceId: string) {
    const current = heroSources;
    const isSelected = current.includes(sourceId);

    if (isSelected) {
      // Deselect — but ensure at least 1 source when hero is enabled
      const next = current.filter((id) => id !== sourceId);
      if (next.length === 0 && settings.dashboardHeroEnabled) {
        return; // block: at least 1 source required
      }
      updateSetting("dashboardHeroSources", next);
    } else {
      // Select — enforce max limit
      if (current.length >= heroMaxSources) {
        return; // block: max reached
      }
      updateSetting("dashboardHeroSources", [...current, sourceId]);
    }
  }

  function resetHero() {
    updateSetting("dashboardHeroEnabled", true);
    updateSetting("dashboardHeroAutoRotate", false);
    updateSetting("dashboardHeroRotateSeconds", 15);
    updateSetting("dashboardHeroSources", [...DEFAULT_HERO_SOURCES]);
  }

  function resetSections() {
    updateSetting("dashboardSectionVisibility", {});
    updateSetting("dashboardSectionLimits", {});
  }

  const visibleCount = DASHBOARD_SECTIONS.filter((s) => isSectionVisible(s.id)).length;

  const selectedHeroSourceNames = heroSources
    .map((id) => {
      const source = HERO_SOURCES.find((s) => s.id === id);
      return source ? t(source.labelKey, source.label) : undefined;
    })
    .filter(Boolean)
    .join(", ");

  return (
    <SettingsSection
      title={t("homeLayout.title", "Home Layout")}
      description={t("homeLayout.desc", "Customize which sections appear on your dashboard, hero behavior, and rendering strategy.")}
    >
      {/* Tab bar */}
      <div className="mb-5 flex gap-1 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-1">
        {([
          { id: "hero" as LayoutTab, label: t("homeLayout.tab_hero", "Hero"), icon: <Sparkles className="h-3.5 w-3.5" /> },
          { id: "sections" as LayoutTab, label: t("homeLayout.tab_sections", "Sections"), icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
        ]).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-medium transition ${
              activeTab === tab.id
                ? "bg-(--color-accent)/15 text-(--color-accent)"
                : "text-(--color-muted) hover:text-(--color-text)"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Hero Tab ──────────────────────────────────────────── */}
      {activeTab === "hero" && (
        <div className="space-y-4">
              <ToggleOption
                label={t("homeLayout.show_hero", "Show Hero Section")}
                description={t("homeLayout.show_hero_desc", "Display the featured game hero at the top of the dashboard.")}
            enabled={settings.dashboardHeroEnabled}
            onChange={(v) => updateSetting("dashboardHeroEnabled", v)}
          />

          {settings.dashboardHeroEnabled && (
            <>
              {/* ── Hero Sources Card ───────────────────────────── */}
              <div className="lf-surface rounded-2xl border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-(--color-text)">
                      {t("homeLayout.hero_sources", "Hero Sources")}
                    </p>
                    <p className="mt-0.5 text-xs text-(--color-muted)">
                      {t("homeLayout.hero_sources_selected", "{{selected}} of {{max}} selected").replace("{{selected}}", String(heroSources.length)).replace("{{max}}", String(heroMaxSources))}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSourcesExpanded(!sourcesExpanded)}
                    className="inline-flex items-center gap-1.5 text-xs text-(--color-muted) transition hover:text-(--color-text)"
                  >
                    {sourcesExpanded ? t("homeLayout.hide", "Hide") : t("homeLayout.change", "Change")}
                    {sourcesExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {/* Selected source names */}
                {!sourcesExpanded && (
                  <p className="mt-2 text-xs text-(--color-text)">
                    {selectedHeroSourceNames || t("homeLayout.no_sources_selected", "No sources selected")}
                  </p>
                )}

                {/* Expanded source picker */}
                {sourcesExpanded && (
                  <div className="mt-3 space-y-1.5">
                    {heroSources.length >= heroMaxSources && (
                      <p className="mb-2 text-[11px] text-amber-400/80">
                        {t("homeLayout.max_hero_sources", "Only 1 hero source can be selected. Deselect one first.")}
                      </p>
                    )}
                    {HERO_SOURCES.map((source) => {
                      const isSelected = heroSources.includes(source.id);
                      const isAtMax = heroSources.length >= heroMaxSources;
                      const isDisabled = source.disabled || (!isSelected && isAtMax);

                      return (
                        <button
                          key={source.id}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => toggleHeroSource(source.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                            isSelected
                              ? "border-(--color-accent)/30 bg-(--color-accent)/5"
                              : isDisabled
                                ? "border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed"
                                : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03]"
                          }`}
                        >
                          {/* Toggle indicator */}
                          <div
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${
                              isSelected
                                ? "bg-(--color-accent) text-(--color-accent-text)"
                                : "bg-white/10 text-transparent"
                            }`}
                          >
                            {isSelected && <Check className="h-3.5 w-3.5" />}
                          </div>

                          {/* Icon */}
                          <div className={`${isSelected ? source.color : "text-(--color-muted)"}`}>
                            {source.icon}
                          </div>

                          {/* Label + description */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-(--color-text)">
                                {t(source.labelKey, source.label)}
                              </span>
                              {source.disabled && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                                  <Lock className="h-2.5 w-2.5" />
                                  {t("collections.coming_soon", "Coming soon")}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px] text-(--color-muted)">
                              {t(source.descriptionKey, source.description)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <ToggleOption
                label={t("homeLayout.auto_rotate", "Auto-Rotate Hero")}
                description={t("homeLayout.auto_rotate_desc", "Cycle through candidates from your selected hero sources.")}
                enabled={settings.dashboardHeroAutoRotate}
                onChange={(v) => updateSetting("dashboardHeroAutoRotate", v)}
              />

              {settings.dashboardHeroAutoRotate && (
                <div className="lf-surface rounded-2xl border p-4">
                  <p className="mb-3 text-sm font-medium text-(--color-text)">
                    {t("homeLayout.rotation_interval", "Rotation Interval")}
                  </p>
                  <div className="flex gap-2">
                    {ROTATE_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => updateSetting("dashboardHeroRotateSeconds", preset.value)}
                        className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${
                          settings.dashboardHeroRotateSeconds === preset.value
                            ? "bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/30"
                            : "bg-white/5 text-(--color-muted) hover:bg-white/10"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={resetHero}
                className="inline-flex items-center gap-1.5 text-xs text-(--color-muted) transition hover:text-(--color-text)"
              >
                <RotateCcw className="h-3 w-3" />
                {t("homeLayout.reset_hero", "Reset hero defaults")}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Sections Tab ──────────────────────────────────────── */}
      {activeTab === "sections" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-(--color-muted)">
              {t("homeLayout.sections_visible", "{{visible}} of {{total}} sections visible").replace("{{visible}}", String(visibleCount)).replace("{{total}}", String(DASHBOARD_SECTIONS.length))}
            </p>
            <button
              type="button"
              onClick={resetSections}
              className="inline-flex items-center gap-1.5 text-xs text-(--color-muted) transition hover:text-(--color-text)"
            >
              <RotateCcw className="h-3 w-3" />
              {t("homeLayout.reset", "Reset")}
            </button>
          </div>

          <div className="space-y-2">
            {DASHBOARD_SECTIONS.map((section) => {
              const visible = isSectionVisible(section.id);
              const limit = getSectionLimit(section.id);
              const isHeroSource = section.heroSourceId && heroSources.includes(section.heroSourceId);

              return (
                <div
                  key={section.id}
                  className={`rounded-xl border p-4 transition ${
                    visible
                      ? "border-(--surface-active-border) bg-white/[0.02]"
                      : "border-white/5 bg-white/[0.01] opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                        visible ? "bg-(--color-accent)" : "bg-white/10"
                      }`}
                    >
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                          visible ? "left-6" : "left-1"
                        }`}
                      />
                    </button>

                    {/* Icon + label */}
                    <div className={`flex items-center gap-2 ${visible ? section.color : "text-(--color-muted)"}`}>
                      {section.icon}
                      <span className="text-sm font-medium text-(--color-text)">
                        {t(section.labelKey, section.label)}
                      </span>
                    </div>

                    {/* Hero source badge */}
                    {isHeroSource && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-[10px] font-medium text-(--color-accent)">
                        <Sparkles className="h-2.5 w-2.5" />
                        {t("homeLayout.hero_source_badge", "Hero source")}
                      </span>
                    )}

                    {!visible && isHeroSource && (
                      <span className="text-[10px] text-(--color-muted)">
                        {t("homeLayout.hidden_row", "Hidden row")}
                      </span>
                    )}

                    <p className="ml-auto hidden text-[11px] text-(--color-muted) sm:block">
                      {t(section.descriptionKey, section.description)}
                    </p>
                  </div>

                  {/* Limit control — only for non-boolean/static sections */}
                  {visible && section.id !== "store-highlights" && (
                    <div className="mt-3 flex items-center gap-3 border-t border-(--surface-active-border) pt-3">
                      <span className="text-xs text-(--color-muted)">{t("homeLayout.max_items", "Max items:")}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSectionLimit(section.id, limit - 2)}
                          disabled={limit <= 4}
                          className="flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-xs text-(--color-muted) transition hover:bg-white/10 disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-8 text-center text-xs font-mono font-semibold text-(--color-text)">
                          {limit}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSectionLimit(section.id, limit + 2)}
                          disabled={limit >= 24}
                          className="flex h-6 w-6 items-center justify-center rounded-md bg-white/5 text-xs text-(--color-muted) transition hover:bg-white/10 disabled:opacity-30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
