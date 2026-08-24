import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Columns3, RotateCcw } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import ToggleOption from "./ToggleOption";

type LayoutTab = "dashboard" | "library";

/* ================================================================== */
/*  DATA                                                               */
/* ================================================================== */

interface WidthPreset {
  label: string;
  labelKey?: string;
  description: string;
  dashboard: {
    dashboardContentWidth: number;
    dashboardFeaturedCardSize: number;
    dashboardCardSize: number;
    dashboardGridGap: number;
  };
  library: {
    libraryCardSize: number;
    libraryGridGap: number;
    libraryLandscapeCardSize: number;
    libraryLandscapeGap: number;
    libraryFilterPanelWidth: number;
  };
}

const WIDTH_PRESETS: WidthPreset[] = [
  {
    label: "Compact",
    labelKey: "settings.layout.preset_compact",
    description: "Dense, more cards visible",
    dashboard: {
      dashboardContentWidth: 1600,
      dashboardFeaturedCardSize: 300,
      dashboardCardSize: 220,
      dashboardGridGap: 12,
    },
    library: {
      libraryCardSize: 160,
      libraryGridGap: 12,
      libraryLandscapeCardSize: 160,
      libraryLandscapeGap: 12,
      libraryFilterPanelWidth: 260,
    },
  },
  {
    label: "Dense",
    labelKey: "settings.layout.preset_dense",
    description: "Tight with slight breathing room",
    dashboard: {
      dashboardContentWidth: 1680,
      dashboardFeaturedCardSize: 320,
      dashboardCardSize: 240,
      dashboardGridGap: 14,
    },
    library: {
      libraryCardSize: 180,
      libraryGridGap: 14,
      libraryLandscapeCardSize: 180,
      libraryLandscapeGap: 14,
      libraryFilterPanelWidth: 270,
    },
  },
  {
    label: "Standard",
    labelKey: "settings.layout.preset_standard",
    description: "Balanced size and spacing",
    dashboard: {
      dashboardContentWidth: 1760,
      dashboardFeaturedCardSize: 340,
      dashboardCardSize: 260,
      dashboardGridGap: 16,
    },
    library: {
      libraryCardSize: 200,
      libraryGridGap: 16,
      libraryLandscapeCardSize: 200,
      libraryLandscapeGap: 16,
      libraryFilterPanelWidth: 280,
    },
  },
  {
    label: "Balanced",
    labelKey: "settings.layout.preset_balanced",
    description: "Comfortable cards, even spacing",
    dashboard: {
      dashboardContentWidth: 1840,
      dashboardFeaturedCardSize: 360,
      dashboardCardSize: 280,
      dashboardGridGap: 18,
    },
    library: {
      libraryCardSize: 220,
      libraryGridGap: 20,
      libraryLandscapeCardSize: 220,
      libraryLandscapeGap: 20,
      libraryFilterPanelWidth: 290,
    },
  },
  {
    label: "Comfort",
    labelKey: "settings.layout.preset_comfort",
    description: "Larger cards, more space",
    dashboard: {
      dashboardContentWidth: 1920,
      dashboardFeaturedCardSize: 400,
      dashboardCardSize: 320,
      dashboardGridGap: 22,
    },
    library: {
      libraryCardSize: 240,
      libraryGridGap: 24,
      libraryLandscapeCardSize: 240,
      libraryLandscapeGap: 24,
      libraryFilterPanelWidth: 300,
    },
  },
  {
    label: "Large",
    labelKey: "settings.layout.preset_large",
    description: "Maximum sizes, spacious",
    dashboard: {
      dashboardContentWidth: 2200,
      dashboardFeaturedCardSize: 440,
      dashboardCardSize: 360,
      dashboardGridGap: 28,
    },
    library: {
      libraryCardSize: 260,
      libraryGridGap: 28,
      libraryLandscapeCardSize: 260,
      libraryLandscapeGap: 28,
      libraryFilterPanelWidth: 320,
    },
  },
];

const RADIUS_PRESETS = [
  { label: "Sharp", labelKey: "settings.layout.radius_sharp", value: 4 },
  { label: "Subtle", labelKey: "settings.layout.radius_subtle", value: 8 },
  { label: "Classic", labelKey: "settings.layout.radius_classic", value: 12 },
  { label: "Rounded", labelKey: "settings.layout.radius_rounded", value: 18 },
  { label: "Pill", labelKey: "settings.layout.radius_pill", value: 999 },
];

const DASHBOARD_DEFAULTS = {
  dashboardContentWidth: 1760,
  useExpandedDashboard: false,
  dashboardCardSize: 260,
  dashboardFeaturedCardSize: 340,
  dashboardGridGap: 16,
  cardCornerRadius: 12,
  hideCardLabels: false,
};

const LIBRARY_DEFAULTS = {
  libraryCardSize: 200,
  libraryGridGap: 28,
  libraryUseFullWidth: true,
  libraryFilterPanelWidth: 280,
  libraryLandscapeCardSize: 200,
  libraryLandscapeGap: 28,
  libraryCardArtworkMode: "landscape" as const,
  cardCornerRadius: 12,
  hideCardLabels: false,
};

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function detectWidthPreset(
  tab: LayoutTab,
  s: ReturnType<typeof useSettings>["settings"]
): number {
  return WIDTH_PRESETS.findIndex((p) => {
    if (tab === "dashboard") {
      return (
        p.dashboard.dashboardContentWidth === s.dashboardContentWidth &&
        p.dashboard.dashboardFeaturedCardSize === s.dashboardFeaturedCardSize &&
        p.dashboard.dashboardCardSize === s.dashboardCardSize &&
        p.dashboard.dashboardGridGap === s.dashboardGridGap
      );
    }
    return (
      p.library.libraryCardSize === s.libraryCardSize &&
      p.library.libraryGridGap === s.libraryGridGap &&
      p.library.libraryLandscapeCardSize === s.libraryLandscapeCardSize &&
      p.library.libraryLandscapeGap === s.libraryLandscapeGap &&
      p.library.libraryFilterPanelWidth === s.libraryFilterPanelWidth
    );
  });
}

/* ================================================================== */
/*  SMALL COMPONENTS                                                   */
/* ================================================================== */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-(--color-muted)">
      {children}
    </p>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const u = unit ?? "px";
  return (
    <div className="lf-surface flex items-center justify-between gap-4 rounded-2xl border px-4 py-3">
      <span className="text-sm text-(--color-text)">{label}</span>
      <div className="flex items-center gap-3">
        <span className="w-14 text-right font-mono text-xs text-(--color-muted)">
          {value}{u}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 accent-(--color-accent)"
        />
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-(--color-muted)">{label}</span>
      <span className="font-mono text-(--color-text)">{value}</span>
    </div>
  );
}

/* ================================================================== */
/*  LIVE PREVIEW                                                       */
/* ================================================================== */

function LivePreview({
  tab,
  cardW,
  cardH,
  featuredW,
  featuredH,
  gap,
  radius,
  labelsHidden,
  widthMode,
  artworkMode,
}: {
  tab: LayoutTab;
  cardW: number;
  cardH: number;
  featuredW: number;
  featuredH: number;
  gap: number;
  radius: number;
  labelsHidden: boolean;
  widthMode: string;
  artworkMode: string;
}) {
  const { t } = useTranslation();
  const SCALE = 0.28;
  const CONTAINER_W = 190;
  const sCardW = Math.min(Math.round(cardW * SCALE), CONTAINER_W);
  const sCardH = Math.round(cardH * SCALE);
  const sGap = Math.round(gap * SCALE);
  const sFeatW = Math.min(Math.round(featuredW * SCALE), CONTAINER_W);
  const sFeatH = Math.round(featuredH * SCALE);
  const sRadius = Math.min(radius * SCALE, 12);

  const modeLabel =
    tab === "dashboard"
      ? null
      : artworkMode === "landscape"
        ? t("settings.layout.landscape", "Landscape")
        : t("settings.layout.poster", "Poster");

  return (
    <div className="lf-surface rounded-xl border p-4">
      <SectionLabel>{t("settings.layout.live_preview", "Live Preview")}</SectionLabel>

      {/* Preview area — constrained, no overflow */}
      <div
        className="mt-3 flex flex-col items-center overflow-hidden rounded-lg border border-dashed border-(--surface-active-border)/50 bg-black/20 p-3"
        style={{ minHeight: 110 }}
      >
        {tab === "dashboard" ? (
          <div className="flex flex-col items-center gap-1.5">
            {/* Featured card */}
            <div className="flex gap-2">
              <div
                className="border border-white/[0.08] bg-white/[0.05]"
                style={{
                  width: sFeatW,
                  height: sFeatH,
                  borderRadius: sRadius,
                }}
              />
            </div>
            {/* Standard cards row */}
            <div className="flex items-end" style={{ gap: sGap }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="border border-white/[0.08] bg-white/[0.05]"
                  style={{
                    width: sCardW,
                    height: sCardH,
                    borderRadius: sRadius,
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-end" style={{ gap: sGap }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="border border-white/[0.08] bg-white/[0.05]"
                  style={{
                    width: sCardW,
                    height: sCardH,
                    borderRadius: sRadius,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Label indicator */}
      <div className="mt-2 flex items-center justify-center">
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
            labelsHidden
              ? "bg-white/5 text-(--color-muted)"
              : "bg-(--color-accent)/10 text-(--color-accent)"
          }`}
        >
          Labels: {labelsHidden ? t("settings.layout.hidden", "Hidden") : t("settings.layout.visible", "Visible")}
        </span>
      </div>

      {/* Stats */}
      <div className="mt-3 space-y-1 border-t border-(--surface-active-border) pt-3">
        <StatRow label={t("settings.layout.card", "Card")} value={`${cardW} × ${cardH}px`} />
        {tab === "dashboard" && (
          <StatRow label={t("settings.layout.featured", "Featured")} value={`${featuredW} × ${featuredH}px`} />
        )}
        <StatRow label={t("settings.layout.gap", "Gap")} value={`${gap}px`} />
        <StatRow label={t("settings.layout.radius", "Radius")} value={`${radius}px`} />
        {modeLabel && <StatRow label={t("settings.layout.mode", "Mode")} value={modeLabel} />}
        <StatRow
          label={t("settings.layout.width", "Width")}
          value={widthMode === "expanded" ? t("settings.layout.full", "Full") : t("settings.layout.contained", "Contained")}
        />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */

export default function CardLayoutEditor() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [tab, setTab] = useState<LayoutTab>("dashboard");

  /* -- derived state ---------------------------------------------- */
  const isCustom = useMemo(
    () => detectWidthPreset(tab, settings) === -1,
    [tab, settings]
  );

  const isExpanded =
    tab === "dashboard"
      ? settings.useExpandedDashboard
      : settings.libraryUseFullWidth;

  const cardW =
    tab === "dashboard"
      ? settings.dashboardCardSize
      : settings.libraryCardArtworkMode === "landscape"
        ? settings.libraryLandscapeCardSize
        : settings.libraryCardSize;

  const cardH =
    tab === "dashboard"
      ? Math.round(settings.dashboardCardSize * 0.6)
      : settings.libraryCardArtworkMode === "landscape"
        ? Math.round(settings.libraryLandscapeCardSize * 0.56)
        : Math.round(settings.libraryCardSize * 1.45);

  const gap =
    tab === "dashboard"
      ? settings.dashboardGridGap
      : settings.libraryCardArtworkMode === "landscape"
        ? settings.libraryLandscapeGap
        : settings.libraryGridGap;

  /* -- actions --------------------------------------------------- */
  function applyPreset(idx: number) {
    const p = WIDTH_PRESETS[idx];
    const data = tab === "dashboard" ? p.dashboard : p.library;
    for (const [k, v] of Object.entries(data)) {
      updateSetting(k as never, v as never);
    }
  }

  function toggleExpanded() {
    if (tab === "dashboard") {
      updateSetting("useExpandedDashboard", !settings.useExpandedDashboard);
    } else {
      updateSetting("libraryUseFullWidth", !settings.libraryUseFullWidth);
    }
  }

  function resetDefaults() {
    const defs = tab === "dashboard" ? DASHBOARD_DEFAULTS : LIBRARY_DEFAULTS;
    for (const [k, v] of Object.entries(defs)) {
      updateSetting(k as never, v as never);
    }
  }

  /* -- preset summary text --------------------------------------- */
  const presetSummary = useMemo(() => {
    if (isCustom) return null;
    if (tab === "dashboard") {
      return `${settings.dashboardCardSize}px cards · ${settings.dashboardFeaturedCardSize}px featured · ${settings.dashboardGridGap}px gap`;
    }
    const mode = settings.libraryCardArtworkMode;
    const size =
      mode === "landscape"
        ? settings.libraryLandscapeCardSize
        : settings.libraryCardSize;
    const g =
      mode === "landscape"
        ? settings.libraryLandscapeGap
        : settings.libraryGridGap;
    return `${size}px ${mode} cards · ${g}px gap · ${settings.libraryFilterPanelWidth}px filter`;
  }, [tab, settings, isCustom]);

  /* ============================================================= */
  /*  RENDER                                                        */
  /* ============================================================= */

  return (
    <div className="lf-surface rounded-2xl border p-5">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
            <LayoutDashboard className="h-4 w-4 text-(--color-accent)" />
            {t("settings.layout.card_layout", "Card Layout")}
          </div>
          <p className="mt-0.5 text-[11px] text-(--color-muted)">
            {t("settings.layout.card_layout_desc", "Tune card size, spacing, artwork style, width mode, radius, and labels.")}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-(--surface-active-border)">
          {(
            [
              { key: "dashboard", label: t("settings.layout.dashboard_tab", "Dashboard"), Icon: LayoutDashboard },
              { key: "library", label: t("settings.layout.library_tab", "Library"), Icon: Columns3 },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex cursor-pointer items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium transition ${
                tab === key
                  ? "bg-(--color-accent) text-(--color-accent-text)"
                  : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-5">
        {/* ── Left: Controls ────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-6">

          {/* ─── Card Size Presets ─────────────────────────── */}
          <div>
            <SectionLabel>{t("settings.layout.card_size", "Card Size")}</SectionLabel>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {WIDTH_PRESETS.map((preset, idx) => {
                const active = detectWidthPreset(tab, settings) === idx;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(idx)}
                    className={`cursor-pointer rounded-lg border px-2 py-2 text-center transition-all ${
                      active
                        ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent) shadow-sm shadow-(--color-accent)/10"
                        : "border-(--surface-active-border) bg-white/[0.02] text-(--color-muted) hover:border-white/20 hover:text-(--color-text)"
                    }`}
                  >
                    <span className="text-[11px] font-semibold">
                      {preset.labelKey ? t(preset.labelKey, preset.label) : preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Summary */}
            <div className="mt-2 rounded-lg bg-white/[0.02] px-3 py-1.5">
              {isCustom ? (
                <p className="text-[11px] text-(--color-muted)">
                  <span className="font-medium text-(--color-accent)">
                    {t("settings.layout.custom", "Custom")}
                  </span>{" "}
                  — {t("settings.layout.adjust_sliders", "adjust the sliders below")}
                </p>
              ) : (
                <p className="text-[11px] text-(--color-muted)">
                  {presetSummary}
                </p>
              )}
            </div>
          </div>

          {/* ─── Width Mode (both targets) ─────────────────── */}
          <div>
            <SectionLabel>{t("settings.layout.width_mode", "Width Mode")}</SectionLabel>
            <div className="mt-2 flex overflow-hidden rounded-lg border border-(--surface-active-border)">
              <button
                type="button"
                onClick={() => {
                  if (tab === "dashboard")
                    updateSetting("useExpandedDashboard", false);
                  else updateSetting("libraryUseFullWidth", false);
                }}
                className={`flex-1 cursor-pointer px-3 py-2 text-xs font-medium transition ${
                  !isExpanded
                    ? "bg-(--color-accent) text-(--color-accent-text)"
                    : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                {t("settings.layout.contained", "Contained")}
              </button>
              <button
                type="button"
                onClick={toggleExpanded}
                className={`flex-1 cursor-pointer px-3 py-2 text-xs font-medium transition ${
                  isExpanded
                    ? "bg-(--color-accent) text-(--color-accent-text)"
                    : "bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                {t("settings.layout.expanded", "Expanded")}
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-(--color-muted)">
              {tab === "dashboard"
                ? isExpanded
                  ? t("settings.layout.dashboard_full_width", "Dashboard fills the full window width.")
                  : `Max width: ${settings.dashboardContentWidth}px`
                : isExpanded
                  ? t("settings.layout.library_full_width", "Library grid uses all available width.")
                  : t("settings.layout.library_centered", "Library grid is centered with a max width.")}
            </p>
          </div>

          {/* ─── Corner Radius ─────────────────────────────── */}
          <div>
            <SectionLabel>{t("settings.layout.corner_radius", "Corner Radius")}</SectionLabel>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {RADIUS_PRESETS.map((preset) => {
                const active = settings.cardCornerRadius === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      updateSetting("cardCornerRadius", preset.value)
                    }
                    className={`group cursor-pointer border px-2 py-2.5 text-center transition-all ${
                      active
                        ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent) shadow-sm shadow-(--color-accent)/10"
                        : "border-(--surface-active-border) bg-white/[0.02] text-(--color-muted) hover:border-white/20 hover:text-(--color-text)"
                    }`}
                  >
                    <div className="mx-auto mb-1.5 flex h-5 items-center justify-center">
                      <div
                        className={`h-4 w-6 border-2 transition-colors ${
                          active
                            ? "border-(--color-accent) bg-(--color-accent)/20"
                            : "border-(--color-muted)/40 bg-white/[0.04] group-hover:border-white/30"
                        }`}
                        style={{
                          borderRadius: Math.min(preset.value, 14),
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold">
                      {t(preset.labelKey, preset.label)}
                    </span>
                    <span className="block text-[8px] opacity-50">
                      {preset.value}px
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Toggles ───────────────────────────────────── */}
          <div className="space-y-3">
            <ToggleOption
              label={t("settings.layout.hide_card_labels", "Hide card labels")}
              description={t("settings.layout.hide_card_labels_desc", "Hide the title text displayed below each card.")}
              enabled={settings.hideCardLabels}
              onChange={(v) => updateSetting("hideCardLabels", v)}
            />
            {tab === "library" && (
              <ToggleOption
                label={t("settings.layout.landscape_artwork", "Landscape artwork")}
                description={t("settings.layout.landscape_artwork_desc", "Use landscape artwork for library cards instead of portrait posters.")}
                enabled={settings.libraryCardArtworkMode === "landscape"}
                onChange={(v) =>
                  updateSetting(
                    "libraryCardArtworkMode",
                    v ? "landscape" : "poster"
                  )
                }
              />
            )}
          </div>

          {/* ─── Custom sliders (hidden unless Custom) ─────── */}
          {isCustom && (
            <div className="space-y-2 rounded-xl border border-dashed border-(--surface-active-border) bg-white/[0.01] p-3">
              <SectionLabel>{t("settings.layout.custom_values", "Custom Values")}</SectionLabel>
              {tab === "dashboard" ? (
                <>
                  <Slider
                    label={t("settings.layout.content_max_width", "Content max width")}
                    value={settings.dashboardContentWidth}
                    min={1200}
                    max={2400}
                    step={40}
                    onChange={(v) => updateSetting("dashboardContentWidth", v)}
                  />
                  <Slider
                    label={t("settings.layout.featured_card_size", "Featured card size")}
                    value={settings.dashboardFeaturedCardSize}
                    min={280}
                    max={480}
                    step={10}
                    onChange={(v) =>
                      updateSetting("dashboardFeaturedCardSize", v)
                    }
                  />
                  <Slider
                    label={t("settings.layout.standard_card_size", "Standard card size")}
                    value={settings.dashboardCardSize}
                    min={200}
                    max={400}
                    step={10}
                    onChange={(v) => updateSetting("dashboardCardSize", v)}
                  />
                  <Slider
                    label={t("settings.layout.card_gap", "Card gap")}
                    value={settings.dashboardGridGap}
                    min={8}
                    max={48}
                    step={4}
                    onChange={(v) => updateSetting("dashboardGridGap", v)}
                  />
                </>
              ) : (
                <>
                  <Slider
                    label={t("settings.layout.standard_card_size", "Standard card size")}
                    value={settings.libraryCardSize}
                    min={160}
                    max={280}
                    step={5}
                    onChange={(v) => updateSetting("libraryCardSize", v)}
                  />
                  <Slider
                    label={t("settings.layout.card_gap", "Card gap")}
                    value={settings.libraryGridGap}
                    min={16}
                    max={48}
                    step={4}
                    onChange={(v) => updateSetting("libraryGridGap", v)}
                  />
                  <Slider
                    label={t("settings.layout.landscape_card_size", "Landscape card size")}
                    value={settings.libraryLandscapeCardSize}
                    min={160}
                    max={300}
                    step={5}
                    onChange={(v) =>
                      updateSetting("libraryLandscapeCardSize", v)
                    }
                  />
                  <Slider
                    label={t("settings.layout.landscape_grid_gap", "Landscape grid gap")}
                    value={settings.libraryLandscapeGap}
                    min={16}
                    max={56}
                    step={4}
                    onChange={(v) => updateSetting("libraryLandscapeGap", v)}
                  />
                  <Slider
                    label={t("settings.layout.filter_panel_width", "Filter panel width")}
                    value={settings.libraryFilterPanelWidth}
                    min={240}
                    max={360}
                    step={10}
                    onChange={(v) =>
                      updateSetting("libraryFilterPanelWidth", v)
                    }
                  />
                </>
              )}
            </div>
          )}

          {/* ─── Reset ─────────────────────────────────────── */}
          <div className="pt-1">
            <button
              type="button"
              onClick={resetDefaults}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text)"
            >
              <RotateCcw className="h-3 w-3" />
              {tab === "dashboard"
                ? t("settings.layout.restore_dashboard_defaults", "Restore dashboard defaults")
                : t("settings.layout.restore_library_defaults", "Restore library defaults")}
            </button>
          </div>
        </div>

        {/* ── Right: Live Preview ──────────────────────────── */}
        <div className="hidden w-[230px] shrink-0 lg:block">
          <LivePreview
            tab={tab}
            cardW={cardW}
            cardH={cardH}
            featuredW={
              tab === "dashboard" ? settings.dashboardFeaturedCardSize : 0
            }
            featuredH={
              tab === "dashboard"
                ? Math.round(settings.dashboardFeaturedCardSize * 0.6)
                : 0
            }
            gap={gap}
            radius={settings.cardCornerRadius}
            labelsHidden={settings.hideCardLabels}
            widthMode={isExpanded ? "expanded" : "contained"}
            artworkMode={settings.libraryCardArtworkMode}
          />
        </div>
      </div>
    </div>
  );
}
