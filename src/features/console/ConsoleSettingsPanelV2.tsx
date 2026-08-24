import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Shuffle, RefreshCw, Settings, LayoutGrid,
  Monitor, Power, Moon, Sun, Zap, HelpCircle,
  Wrench, Gamepad2, Film, PlayCircle,
  Maximize, Grid3X3, ChevronRight, ArrowLeft,
  Image, Tag, Rows3, FolderOpen, Trash2,
  HardDrive, Activity, Info, Clock,
  Rocket, Globe,
} from "lucide-react";
import type { AppPage } from "../../types/navigation";
import type { LibraryGame } from "../../types/libraryGame";
import { useUserProfile, resolveProfileMediaUrl } from "../profile/userProfile";
import { useSettings } from "../../context/SettingsContext";
import { getAvatarPreset, getBannerPreset } from "../profile/profilePresets";
import type {
  ConsoleSettings,
  ConsoleThemeMode,
  ConsoleInputHintStyle,
  ConsoleBackgroundTexture,
  GridCardStyle,
  SpotlightCardStyle,
  SpotlightCardVisual,
} from "./consoleSettings";
import {
  resetConsoleVisualSettings,
  resetConsoleMediaSettings,
  resetConsoleInputSettings,
  resetConsoleTimeFormatSettings,
  resetConsoleStartupSettings,
  resetConsoleSystemBarSettings,
  CONSOLE_THEME_INFOS,
  WIDTH_PRESETS,
  RADIUS_PRESETS,
  PANEL_WIDTH_PRESETS,
  GRID_CARD_DEFAULTS,
  SPOTLIGHT_CARD_DEFAULTS,
  SPOTLIGHT_CONTENT_DEFAULTS,
} from "./consoleSettings";
import { useConsoleGamepadInput, DEBUG_CONSOLE_GAMEPAD, setScrollTarget, getScrollTarget } from "./useConsoleGamepadInput";
import { openAppDataFolder, openLogsFolder, clearTempCache, getSystemInfo, powerShutdown, powerSuspend, powerHibernate, powerRestart } from "../../services/tauri";
import toast from "react-hot-toast";
import type { SystemInfo } from "../../services/tauri";
import ConfirmModal from "../../components/common/ConfirmModal";

const DEBUG_CONSOLE_SETTINGS = false;

type PanelPage =
  | "main"
  | "settings"
  | "grid-card-style"
  | "spotlight-card-style"
  | "spotlight-content"
  | "visuals"
  | "media"
  | "input"
  | "time"
  | "startup"
  | "system-bar"
  | "tools"
  | "help"
  | "theme-picker"
  | "language";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ConsoleSettings;
  onPatch: (patch: Partial<ConsoleSettings>) => void;
  onNavigate?: (page: AppPage) => void;
  allGames?: LibraryGame[];
  onSelectGame?: (game: LibraryGame) => void;
  onRefreshLibrary?: () => void;
};

const THEME_KEYS = Object.keys(CONSOLE_THEME_INFOS);
const THEME_OPTIONS: { value: ConsoleThemeMode; label: string }[] = THEME_KEYS.map((k) => ({
  value: k as ConsoleThemeMode,
  label: CONSOLE_THEME_INFOS[k].label,
}));

const GLYPH_OPTIONS: { value: ConsoleInputHintStyle; labelKey: string }[] = [
  { value: "xbox", labelKey: "console_settings.glyph_xbox" },
  { value: "playstation", labelKey: "console_settings.glyph_playstation" },
  { value: "keyboard", labelKey: "console_settings.glyph_keyboard" },
  { value: "auto", labelKey: "console_settings.glyph_auto" },
];

const TEXTURE_OPTIONS: { value: ConsoleBackgroundTexture; labelKey: string }[] = [
  { value: "none", labelKey: "console_settings.texture_none" },
  { value: "grain-soft", labelKey: "console_settings.texture_grain_soft" },
  { value: "vignette", labelKey: "console_settings.texture_vignette" },
  { value: "blur", labelKey: "console_settings.texture_blur" },
];

const ANIM_DURATION_MS = 250;

const TIME_FORMAT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "12h", labelKey: "console_settings.time_12h" },
  { value: "24h", labelKey: "console_settings.time_24h" },
  { value: "system", labelKey: "console_settings.time_system" },
  { value: "hidden", labelKey: "console_settings.time_hidden" },
];

const LAUNCH_MODE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "console", labelKey: "console_settings.launch_console" },
  { value: "desktop", labelKey: "console_settings.launch_desktop" },
  { value: "last-used", labelKey: "console_settings.launch_last_used" },
];

const WINDOW_MODE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "fullscreen", labelKey: "console_settings.window_fullscreen" },
  { value: "maximized", labelKey: "console_settings.window_maximized" },
  { value: "minimized", labelKey: "console_settings.window_minimized" },
  { value: "tray", labelKey: "console_settings.window_tray" },
  { value: "windowed", labelKey: "console_settings.window_windowed" },
];

/* ── Power action confirm configs ── */
const POWER_CONFIRM_CONFIGS: Record<string, { titleKey: string; messageKey: string }> = {
  "power-off": { titleKey: "console_settings.power_off_title", messageKey: "console_settings.power_off_msg" },
  "suspend": { titleKey: "console_settings.power_suspend_title", messageKey: "console_settings.power_suspend_msg" },
  "hibernate": { titleKey: "console_settings.power_hibernate_title", messageKey: "console_settings.power_hibernate_msg" },
  "restart": { titleKey: "console_settings.power_restart_title", messageKey: "console_settings.power_restart_msg" },
};

async function executePowerCommand(key: string): Promise<void> {
  try {
    switch (key) {
      case "power-off": await powerShutdown(); break;
      case "suspend": await powerSuspend(); break;
      case "hibernate": await powerHibernate(); break;
      case "restart": await powerRestart(); break;
    }
  } catch (err) {
    toast.error(`Power action failed: ${err}`);
  }
}

/* ── ALL gamepad-mapped keys that must be consumed when Quick Menu is open ── */
const GAMEPAD_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Enter", "Escape", "b", "B", "v", "V",
  "x", "X", "y", "Y", "o", "O", "d", "D",
  "q", "Q", "e", "E", "PageUp", "PageDown",
  " ", "p", "P", "Alt", "ContextMenu", "Apps",
]);

// ============================================================
// Row definition types for subpage keyboard/gamepad navigation
// ============================================================
type SettingRowType = "slider" | "toggle" | "segmented" | "button" | "preview";

type SettingRowDef = {
  id: string;
  type: SettingRowType;
  label: string;
  labelKey?: string;
  description?: string;
  descriptionKey?: string;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  sliderUnit?: string;
  segOptions?: { value: string; labelKey: string }[];
  getValue: (s: ConsoleSettings) => string | number | boolean;
  onAction: (s: ConsoleSettings, key: "left" | "right" | "enter") => Partial<ConsoleSettings>;
};

const WIDTH_SEG_OPTIONS = WIDTH_PRESETS.map(p => ({ value: p.value.toString(), label: p.label }));
const RADIUS_SEG_OPTIONS = RADIUS_PRESETS.map(p => ({ value: p.value.toString(), label: p.label }));

function findNearestPreset(value: number, presets: { value: number }[]): number {
  return presets.reduce((prev, curr) =>
    Math.abs(curr.value - value) < Math.abs(prev.value - value) ? curr : prev
  ).value;
}

function patchGridCardStyle(s: ConsoleSettings, patch: Partial<GridCardStyle>): Partial<ConsoleSettings> {
  return { gridCardStyle: { ...s.gridCardStyle, ...patch } };
}

function patchSpotlightCardStyle(s: ConsoleSettings, patch: Partial<SpotlightCardStyle>): Partial<ConsoleSettings> {
  return { spotlightCardStyle: { ...s.spotlightCardStyle, ...patch } };
}

const CARD_STYLE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "poster", labelKey: "console_settings.card_poster" },
  { value: "landscape", labelKey: "console_settings.card_landscape" },
  { value: "hero", labelKey: "console_settings.card_hero" },
];

const SETTING_ROWS_GRID: SettingRowDef[] = [
  {
    id: "gridWidthPreset", type: "segmented", label: "Width Presets", labelKey: "console_settings.width_presets",
    segOptions: WIDTH_SEG_OPTIONS.map(o => ({ value: o.value, labelKey: `console_settings.width_${o.value}` })),
    getValue: (s) => findNearestPreset(s.gridCardStyle.widthPreset, WIDTH_PRESETS).toString(),
    onAction: (s, k) => {
      const cur = findNearestPreset(s.gridCardStyle.widthPreset, WIDTH_PRESETS);
      const idx = WIDTH_SEG_OPTIONS.findIndex(o => Number(o.value) === cur);
      const next = WIDTH_SEG_OPTIONS[Math.min(WIDTH_SEG_OPTIONS.length - 1, idx + 1)];
      const prev = WIDTH_SEG_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? patchGridCardStyle(s, { widthPreset: Number(prev.value) }) : {};
      return next ? patchGridCardStyle(s, { widthPreset: Number(next.value) }) : {};
    },
  },
  {
    id: "gridCornerRadius", type: "segmented", label: "Corner Radius", labelKey: "console_settings.corner_radius",
    segOptions: RADIUS_SEG_OPTIONS.map(o => ({ value: o.value, labelKey: `console_settings.radius_${o.value}` })),
    getValue: (s) => findNearestPreset(s.gridCardStyle.cornerRadius, RADIUS_PRESETS).toString(),
    onAction: (s, k) => {
      const cur = findNearestPreset(s.gridCardStyle.cornerRadius, RADIUS_PRESETS);
      const idx = RADIUS_SEG_OPTIONS.findIndex(o => Number(o.value) === cur);
      const next = RADIUS_SEG_OPTIONS[Math.min(RADIUS_SEG_OPTIONS.length - 1, idx + 1)];
      const prev = RADIUS_SEG_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? patchGridCardStyle(s, { cornerRadius: Number(prev.value) }) : {};
      return next ? patchGridCardStyle(s, { cornerRadius: Number(next.value) }) : {};
    },
  },
  {
    id: "gridLandscapePosters", type: "toggle", label: "Landscape Posters", labelKey: "console_settings.landscape_posters",
    descriptionKey: "console_settings.landscape_posters_desc",
    getValue: (s) => s.gridCardStyle.useLandscapeCards,
    onAction: (s) => patchGridCardStyle(s, { useLandscapeCards: !s.gridCardStyle.useLandscapeCards }),
  },
  {
    id: "gridHideLabels", type: "toggle", label: "Hide Labels", labelKey: "console_settings.hide_labels",
    descriptionKey: "console_settings.hide_labels_desc",
    getValue: (s) => s.gridCardStyle.hideLabels,
    onAction: (s) => patchGridCardStyle(s, { hideLabels: !s.gridCardStyle.hideLabels }),
  },
  { id: "gridPreview", type: "preview", label: "Live Preview", labelKey: "console_settings.live_preview", getValue: () => "", onAction: () => ({}) },
  { id: "resetGrid", type: "button", label: "Reset Grid Card Style", labelKey: "console_settings.reset_grid", getValue: () => "", onAction: (s) => patchGridCardStyle(s, { ...GRID_CARD_DEFAULTS }) },
];

const SETTING_ROWS_SPOTLIGHT: SettingRowDef[] = [
  {
    id: "spCardStyle", type: "segmented", label: "Card Style", labelKey: "console_settings.card_style",
    segOptions: CARD_STYLE_OPTIONS,
    getValue: (s) => s.spotlightCardStyle.cardStyle,
    onAction: (s, k) => {
      const idx = CARD_STYLE_OPTIONS.findIndex(o => o.value === s.spotlightCardStyle.cardStyle);
      const next = CARD_STYLE_OPTIONS[Math.min(CARD_STYLE_OPTIONS.length - 1, idx + 1)];
      const prev = CARD_STYLE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? patchSpotlightCardStyle(s, { cardStyle: prev.value as SpotlightCardVisual }) : {};
      return next ? patchSpotlightCardStyle(s, { cardStyle: next.value as SpotlightCardVisual }) : {};
    },
  },
  {
    id: "spWidthPreset", type: "segmented", label: "Width Presets", labelKey: "console_settings.width_presets",
    segOptions: WIDTH_SEG_OPTIONS.map(o => ({ value: o.value, labelKey: `console_settings.width_${o.value}` })),
    getValue: (s) => findNearestPreset(s.spotlightCardStyle.widthPreset, WIDTH_PRESETS).toString(),
    onAction: (s, k) => {
      const cur = findNearestPreset(s.spotlightCardStyle.widthPreset, WIDTH_PRESETS);
      const idx = WIDTH_SEG_OPTIONS.findIndex(o => Number(o.value) === cur);
      const next = WIDTH_SEG_OPTIONS[Math.min(WIDTH_SEG_OPTIONS.length - 1, idx + 1)];
      const prev = WIDTH_SEG_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? patchSpotlightCardStyle(s, { widthPreset: Number(prev.value) }) : {};
      return next ? patchSpotlightCardStyle(s, { widthPreset: Number(next.value) }) : {};
    },
  },
  {
    id: "spCornerRadius", type: "segmented", label: "Corner Radius", labelKey: "console_settings.corner_radius",
    segOptions: RADIUS_SEG_OPTIONS.map(o => ({ value: o.value, labelKey: `console_settings.radius_${o.value}` })),
    getValue: (s) => findNearestPreset(s.spotlightCardStyle.cornerRadius, RADIUS_PRESETS).toString(),
    onAction: (s, k) => {
      const cur = findNearestPreset(s.spotlightCardStyle.cornerRadius, RADIUS_PRESETS);
      const idx = RADIUS_SEG_OPTIONS.findIndex(o => Number(o.value) === cur);
      const next = RADIUS_SEG_OPTIONS[Math.min(RADIUS_SEG_OPTIONS.length - 1, idx + 1)];
      const prev = RADIUS_SEG_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? patchSpotlightCardStyle(s, { cornerRadius: Number(prev.value) }) : {};
      return next ? patchSpotlightCardStyle(s, { cornerRadius: Number(next.value) }) : {};
    },
  },
  {
    id: "spHideLabels", type: "toggle", label: "Hide Labels", labelKey: "console_settings.hide_labels",
    descriptionKey: "console_settings.hide_labels_desc",
    getValue: (s) => s.spotlightCardStyle.hideLabels,
    onAction: (s) => patchSpotlightCardStyle(s, { hideLabels: !s.spotlightCardStyle.hideLabels }),
  },
  {
    id: "spTrailerPreview", type: "toggle", label: "Trailer Preview", labelKey: "console_settings.trailer_preview",
    descriptionKey: "console_settings.trailer_preview_desc",
    getValue: (s) => s.spotlightCardStyle.showTrailerPreview,
    onAction: (s) => patchSpotlightCardStyle(s, { showTrailerPreview: !s.spotlightCardStyle.showTrailerPreview }),
  },
  { id: "spPreview", type: "preview", label: "Live Preview", labelKey: "console_settings.live_preview", getValue: () => "", onAction: () => ({}) },
  { id: "resetSpotlight", type: "button", label: "Reset Spotlight Card Style", labelKey: "console_settings.reset_spotlight", getValue: () => "", onAction: (s) => patchSpotlightCardStyle(s, { ...SPOTLIGHT_CARD_DEFAULTS }) },
];

const SETTING_ROWS_SPOTLIGHT_CONTENT: SettingRowDef[] = [
  { id: "scShowAboutGame", type: "toggle", label: "Show About Game", labelKey: "console_settings.show_about_game", descriptionKey: "console_settings.show_about_game_desc", getValue: (s) => s.spotlightContent.showAboutGame, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showAboutGame: !s.spotlightContent.showAboutGame } }) },
  { id: "scShowScreenshots", type: "toggle", label: "Show Screenshots", labelKey: "console_settings.show_screenshots", descriptionKey: "console_settings.show_screenshots_desc", getValue: (s) => s.spotlightContent.showScreenshots, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showScreenshots: !s.spotlightContent.showScreenshots } }) },
  { id: "scShowTrailerPreview", type: "toggle", label: "Show Trailer Preview", labelKey: "console_settings.show_trailer_preview", descriptionKey: "console_settings.show_trailer_preview_desc", getValue: (s) => s.spotlightContent.showTrailerPreview, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showTrailerPreview: !s.spotlightContent.showTrailerPreview } }) },
  { id: "scShowReviews", type: "toggle", label: "Show Reviews", labelKey: "console_settings.show_reviews", descriptionKey: "console_settings.show_reviews_desc", getValue: (s) => s.spotlightContent.showReviews, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showReviews: !s.spotlightContent.showReviews } }) },
  { id: "scShowAchievements", type: "toggle", label: "Show Achievements", labelKey: "console_settings.show_achievements", descriptionKey: "console_settings.show_achievements_desc", getValue: (s) => s.spotlightContent.showAchievements, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showAchievements: !s.spotlightContent.showAchievements } }) },
  { id: "scShowMetadata", type: "toggle", label: "Show Metadata", labelKey: "console_settings.show_metadata", descriptionKey: "console_settings.show_metadata_desc", getValue: (s) => s.spotlightContent.showMetadata, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showMetadata: !s.spotlightContent.showMetadata } }) },
  { id: "resetSpotlightContent", type: "button", label: "Reset Content to Defaults", labelKey: "console_settings.reset_content", getValue: () => "", onAction: () => ({ spotlightContent: { ...SPOTLIGHT_CONTENT_DEFAULTS } }) },
];

const SETTING_ROWS_VISUALS: SettingRowDef[] = [
  {
    id: "themeMode", type: "segmented", label: "Console Theme", labelKey: "console_settings.console_theme",
    segOptions: THEME_OPTIONS.map(o => ({ value: o.value, labelKey: `console_settings.theme_${o.value}` })),
    getValue: (s) => s.themeMode,
    onAction: (s, k) => {
      const idx = THEME_OPTIONS.findIndex(o => o.value === s.themeMode);
      const next = THEME_OPTIONS[Math.min(THEME_OPTIONS.length - 1, idx + 1)];
      const prev = THEME_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { themeMode: prev.value } : {};
      return next ? { themeMode: next.value } : {};
    },
  },
  {
    id: "backgroundTexture", type: "segmented", label: "Background Texture", labelKey: "console_settings.bg_texture",
    segOptions: TEXTURE_OPTIONS,
    getValue: (s) => s.backgroundTexture,
    onAction: (s, k) => {
      const idx = TEXTURE_OPTIONS.findIndex(o => o.value === s.backgroundTexture);
      const next = TEXTURE_OPTIONS[Math.min(TEXTURE_OPTIONS.length - 1, idx + 1)];
      const prev = TEXTURE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { backgroundTexture: prev.value } : {};
      return next ? { backgroundTexture: next.value } : {};
    },
  },
  { id: "focusShine", type: "toggle", label: "Focus Shine Animation", labelKey: "console_settings.focus_shine", descriptionKey: "console_settings.focus_shine_desc", getValue: (s) => s.focusShine, onAction: (s) => ({ focusShine: !s.focusShine }) },
  { id: "heroMotion", type: "toggle", label: "Hero Motion", labelKey: "console_settings.hero_motion", descriptionKey: "console_settings.hero_motion_desc", getValue: (s) => s.heroMotion, onAction: (s) => ({ heroMotion: !s.heroMotion }) },
  {
    id: "sidePanelPreset", type: "segmented", label: "Panel Size", labelKey: "console_settings.panel_size",
    segOptions: PANEL_WIDTH_PRESETS.map(p => ({ labelKey: p.label, value: p.value })),
    descriptionKey: "console_settings.panel_size_desc",
    getValue: (s) => s.sidePanelPreset,
    onAction: (s, k) => {
      const idx = PANEL_WIDTH_PRESETS.findIndex(o => o.value === s.sidePanelPreset);
      const next = PANEL_WIDTH_PRESETS[Math.min(PANEL_WIDTH_PRESETS.length - 1, idx + 1)];
      const prev = PANEL_WIDTH_PRESETS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { sidePanelPreset: prev.value } : {};
      return next ? { sidePanelPreset: next.value } : {};
    },
  },
  { id: "showTrailerPreview", type: "toggle", label: "Show Trailer Preview", labelKey: "console_settings.show_trailer_preview", descriptionKey: "console_settings.show_trailer_preview_visuals_desc", getValue: (s) => s.spotlightCardStyle.showTrailerPreview, onAction: (s) => patchSpotlightCardStyle(s, { showTrailerPreview: !s.spotlightCardStyle.showTrailerPreview }) },
  { id: "spotlightCardWidth", type: "slider", label: "Spotlight Card Width", labelKey: "console_settings.spotlight_width", sliderMin: 200, sliderMax: 420, sliderStep: 10, sliderUnit: "px", getValue: (s) => s.spotlightCardStyle.widthPreset, onAction: (s, k) => patchSpotlightCardStyle(s, { widthPreset: k === "left" ? Math.max(200, s.spotlightCardStyle.widthPreset - 10) : Math.min(420, s.spotlightCardStyle.widthPreset + 10) }) },
  { id: "spotlightCardGap", type: "slider", label: "Spotlight Card Gap", labelKey: "console_settings.spotlight_gap", sliderMin: 8, sliderMax: 48, sliderStep: 2, sliderUnit: "px", getValue: (s) => s.spotlightCardGap, onAction: (s, k) => k === "left" ? { spotlightCardGap: Math.max(8, s.spotlightCardGap - 2) } : { spotlightCardGap: Math.min(48, s.spotlightCardGap + 2) } },
  { id: "resetVisuals", type: "button", label: "Reset Visuals to Defaults", labelKey: "console_settings.reset_visuals", getValue: () => "", onAction: () => resetConsoleVisualSettings() },
];

const SETTING_ROWS_MEDIA: SettingRowDef[] = [
  { id: "useSteamGridDb", type: "toggle", label: "Use SteamGridDB", labelKey: "console_settings.use_sgdb", descriptionKey: "console_settings.use_sgdb_desc", getValue: (s) => s.useSteamGridDb, onAction: (s) => ({ useSteamGridDb: !s.useSteamGridDb }) },
  { id: "useSteamAppDetails", type: "toggle", label: "Use Steam AppDetails", labelKey: "console_settings.use_steam_details", descriptionKey: "console_settings.use_steam_details_desc", getValue: (s) => s.useSteamAppDetails, onAction: (s) => ({ useSteamAppDetails: !s.useSteamAppDetails }) },
  { id: "useIgdb", type: "toggle", label: "Use IGDB", labelKey: "console_settings.use_igdb", descriptionKey: "console_settings.use_igdb_desc", getValue: (s) => s.useIgdb, onAction: (s) => ({ useIgdb: !s.useIgdb }) },
  { id: "useRawg", type: "toggle", label: "Use RAWG", labelKey: "console_settings.use_rawg", descriptionKey: "console_settings.use_rawg_desc", getValue: (s) => s.useRawg, onAction: (s) => ({ useRawg: !s.useRawg }) },
  { id: "trailerShow", type: "toggle", label: "Show Trailer Preview", labelKey: "console_settings.trailer_show", descriptionKey: "console_settings.trailer_show_desc", getValue: (s) => s.showTrailerPreview, onAction: (s) => ({ showTrailerPreview: !s.showTrailerPreview }) },
  { id: "autoplayTrailers", type: "toggle", label: "Autoplay Trailers", labelKey: "console_settings.autoplay_trailers", descriptionKey: "console_settings.autoplay_trailers_desc", getValue: (s) => s.autoplayTrailerPreviews, onAction: (s) => ({ autoplayTrailerPreviews: !s.autoplayTrailerPreviews }) },
  { id: "preferDirectVideo", type: "toggle", label: "Prefer Direct Video", labelKey: "console_settings.prefer_direct_video", descriptionKey: "console_settings.prefer_direct_video_desc", getValue: (s) => s.preferDirectVideo, onAction: (s) => ({ preferDirectVideo: !s.preferDirectVideo }) },
  { id: "resetMedia", type: "button", label: "Reset Media to Defaults", labelKey: "console_settings.reset_media", getValue: () => "", onAction: () => resetConsoleMediaSettings() },
];

const SETTING_ROWS_INPUT: SettingRowDef[] = [
  {
    id: "inputHints", type: "segmented", label: "Input Hints Style", labelKey: "console_settings.input_hints",
    segOptions: GLYPH_OPTIONS,
    getValue: (s) => s.inputHints,
    onAction: (s, k) => {
      const idx = GLYPH_OPTIONS.findIndex(o => o.value === s.inputHints);
      const next = GLYPH_OPTIONS[Math.min(GLYPH_OPTIONS.length - 1, idx + 1)];
      const prev = GLYPH_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { inputHints: prev.value } : {};
      return next ? { inputHints: next.value } : {};
    },
  },
  { id: "showButtonHints", type: "toggle", label: "Show Button Hints", labelKey: "console_settings.show_button_hints", getValue: (s) => s.showButtonHints, onAction: (s) => ({ showButtonHints: !s.showButtonHints }) },
  { id: "showBottomHints", type: "toggle", label: "Show Bottom Hints", labelKey: "console_settings.show_bottom_hints", getValue: (s) => s.showBottomHints, onAction: (s) => ({ showBottomHints: !s.showBottomHints }) },
  { id: "resetInput", type: "button", label: "Reset Input to Defaults", labelKey: "console_settings.reset_input", getValue: () => "", onAction: () => resetConsoleInputSettings() },
];

const SETTING_ROWS_TIME: SettingRowDef[] = [
  {
    id: "timeFormat", type: "segmented", label: "Time Format", labelKey: "console_settings.time_format",
    segOptions: TIME_FORMAT_OPTIONS,
    getValue: (s) => s.timeFormat,
    onAction: (s, k) => {
      const idx = TIME_FORMAT_OPTIONS.findIndex(o => o.value === s.timeFormat);
      const next = TIME_FORMAT_OPTIONS[Math.min(TIME_FORMAT_OPTIONS.length - 1, idx + 1)];
      const prev = TIME_FORMAT_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { timeFormat: prev.value as ConsoleSettings["timeFormat"] } : {};
      return next ? { timeFormat: next.value as ConsoleSettings["timeFormat"] } : {};
    },
  },
  { id: "showSeconds", type: "toggle", label: "Show Seconds", labelKey: "console_settings.show_seconds", descriptionKey: "console_settings.show_seconds_desc", getValue: (s) => s.showSeconds, onAction: (s) => ({ showSeconds: !s.showSeconds }) },
  { id: "showClock", type: "toggle", label: "Show Clock in HUD", labelKey: "console_settings.show_clock_hud", descriptionKey: "console_settings.show_clock_hud_desc", getValue: (s) => s.showClock, onAction: (s) => ({ showClock: !s.showClock }) },
  { id: "resetTime", type: "button", label: "Reset Time to Defaults", labelKey: "console_settings.reset_time", getValue: () => "", onAction: () => resetConsoleTimeFormatSettings() },
];

const SETTING_ROWS_STARTUP: SettingRowDef[] = [
  {
    id: "launchMode", type: "segmented", label: "Launch Mode", labelKey: "console_settings.launch_mode",
    segOptions: LAUNCH_MODE_OPTIONS,
    getValue: (s) => s.launchMode,
    onAction: (s, k) => {
      const idx = LAUNCH_MODE_OPTIONS.findIndex(o => o.value === s.launchMode);
      const next = LAUNCH_MODE_OPTIONS[Math.min(LAUNCH_MODE_OPTIONS.length - 1, idx + 1)];
      const prev = LAUNCH_MODE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { launchMode: prev.value as ConsoleSettings["launchMode"] } : {};
      return next ? { launchMode: next.value as ConsoleSettings["launchMode"] } : {};
    },
  },
  {
    id: "windowMode", type: "segmented", label: "Startup Window", labelKey: "console_settings.startup_window",
    segOptions: WINDOW_MODE_OPTIONS,
    getValue: (s) => s.windowMode,
    onAction: (s, k) => {
      const idx = WINDOW_MODE_OPTIONS.findIndex(o => o.value === s.windowMode);
      const next = WINDOW_MODE_OPTIONS[Math.min(WINDOW_MODE_OPTIONS.length - 1, idx + 1)];
      const prev = WINDOW_MODE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { windowMode: prev.value as ConsoleSettings["windowMode"] } : {};
      return next ? { windowMode: next.value as ConsoleSettings["windowMode"] } : {};
    },
  },
  { id: "autostart", type: "toggle", label: "Start with Windows", labelKey: "console_settings.start_windows", descriptionKey: "console_settings.start_windows_desc", getValue: (s) => s.autostart, onAction: (s) => ({ autostart: !s.autostart }) },
  { id: "startMaximized", type: "toggle", label: "Start Maximized", labelKey: "console_settings.start_maximized", descriptionKey: "console_settings.start_maximized_desc", getValue: (s) => s.startMaximized, onAction: (s) => ({ startMaximized: !s.startMaximized }) },
  { id: "startInTray", type: "toggle", label: "Start in Tray", labelKey: "console_settings.start_in_tray", descriptionKey: "console_settings.start_in_tray_desc", getValue: (s) => s.startInTray, onAction: (s) => ({ startInTray: !s.startInTray }) },
  { id: "closeToTray", type: "toggle", label: "Close to Tray", labelKey: "console_settings.close_to_tray", descriptionKey: "console_settings.close_to_tray_desc", getValue: (s) => s.closeToTray, onAction: (s) => ({ closeToTray: !s.closeToTray }) },
  { id: "showDashboard", type: "toggle", label: "Show Dashboard", labelKey: "console_settings.show_dashboard", descriptionKey: "console_settings.show_dashboard_desc", getValue: (s) => s.showDashboard, onAction: (s) => ({ showDashboard: !s.showDashboard }) },
  { id: "disableUpdate", type: "toggle", label: "Disable Update", labelKey: "console_settings.disable_update", descriptionKey: "console_settings.disable_update_desc", getValue: (s) => s.disableUpdate, onAction: (s) => ({ disableUpdate: !s.disableUpdate }) },
  { id: "resetStartup", type: "button", label: "Reset Startup to Defaults", labelKey: "console_settings.reset_startup", getValue: () => "", onAction: () => resetConsoleStartupSettings() },
];

const SETTING_ROWS_SYSTEM_BAR: SettingRowDef[] = [
  { id: "showProfileHud", type: "toggle", label: "Show Profile", labelKey: "console_settings.show_profile", descriptionKey: "console_settings.show_profile_desc", getValue: (s) => s.showProfileHud, onAction: (s) => ({ showProfileHud: !s.showProfileHud }) },
  { id: "showClock", type: "toggle", label: "Show Clock", labelKey: "console_settings.show_clock", descriptionKey: "console_settings.show_clock_desc", getValue: (s) => s.showClock, onAction: (s) => ({ showClock: !s.showClock }) },
  { id: "showNetworkIndicator", type: "toggle", label: "Network Indicator", labelKey: "console_settings.network_indicator", descriptionKey: "console_settings.network_indicator_desc", getValue: (s) => s.showNetworkIndicator, onAction: (s) => ({ showNetworkIndicator: !s.showNetworkIndicator }) },
  { id: "showControllerIndicator", type: "toggle", label: "Controller Indicator", labelKey: "console_settings.controller_indicator", descriptionKey: "console_settings.controller_indicator_desc", getValue: (s) => s.showControllerIndicator, onAction: (s) => ({ showControllerIndicator: !s.showControllerIndicator }) },
  { id: "resetSystemBar", type: "button", label: "Reset System Bar to Defaults", labelKey: "console_settings.reset_system_bar", getValue: () => "", onAction: () => resetConsoleSystemBarSettings() },
];

const SETTING_ROWS_LANGUAGE: SettingRowDef[] = [
  {
    id: "appLanguage", type: "segmented", label: "App Language", labelKey: "console_settings.app_language",
    segOptions: [{ value: "system", labelKey: "console_settings.follow_system" }],
    getValue: () => "system",
    onAction: () => ({}),
  },
  { id: "languageComingSoon", type: "button", label: "Coming Soon — Translations will be added after feature completion", labelKey: "console_settings.language_coming_soon", getValue: () => "", onAction: () => { toast("Language support is coming soon — stay tuned!", { icon: "🌐" }); return {}; } },
];

const SUBPAGE_ROWS: Record<string, SettingRowDef[]> = {
  "grid-card-style": SETTING_ROWS_GRID,
  "spotlight-card-style": SETTING_ROWS_SPOTLIGHT,
  "spotlight-content": SETTING_ROWS_SPOTLIGHT_CONTENT,
  visuals: SETTING_ROWS_VISUALS,
  media: SETTING_ROWS_MEDIA,
  input: SETTING_ROWS_INPUT,
  time: SETTING_ROWS_TIME,
  startup: SETTING_ROWS_STARTUP,
  "system-bar": SETTING_ROWS_SYSTEM_BAR,
  language: SETTING_ROWS_LANGUAGE,
};

const SUBPAGE_TITLES: Record<string, string> = {
  "grid-card-style": "console_settings.grid_card_style",
  "spotlight-card-style": "console_settings.spotlight_card_style",
  "spotlight-content": "console_settings.spotlight_content",
  visuals: "console_settings.visuals",
  media: "console_settings.media",
  input: "console_settings.input",
  time: "console_settings.time",
  startup: "console_settings.startup",
  "system-bar": "console_settings.system_bar",
  language: "console_settings.language",
};

// ============================================================
// Option row
// ============================================================
function OptionRow({
  icon: Icon, label, description, onClick, disabled, hasArrow, isFocused,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  onClick?: () => void;
  disabled?: boolean;
  hasArrow?: boolean;
  isFocused?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all duration-100 ${
        isFocused
          ? "bg-(--color-accent)/20 ring-2 ring-(--color-accent)/60 scale-[1.02]"
          : disabled
            ? "opacity-40 cursor-not-allowed"
            : "hover:bg-white/10 active:bg-white/5"
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-surface)/60">
        <Icon className="h-5 w-5 text-(--color-muted)" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold text-(--color-text)">{label}</div>
        {description && (
          <div className="mt-0.5 text-sm text-(--color-muted) truncate">{description}</div>
        )}
      </div>
      {hasArrow && <ChevronRight className="h-5 w-5 shrink-0 text-(--color-muted)/50" />}
    </button>
  );
}

// ============================================================
// Sub-panel header
// ============================================================
function SubPanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button
        onClick={onBack}
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-surface)/60 text-(--color-muted) transition hover:bg-(--color-surface) hover:text-(--color-text)"
        aria-label="Go back"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h2 className="text-xl font-bold text-(--color-text)">{title}</h2>
    </div>
  );
}

// ============================================================
// Toggle row
// ============================================================
function ToggleRow({
  label, description, enabled, onChange, isFocused,
}: {
  label: string; description?: string; enabled: boolean; onChange: () => void; isFocused?: boolean;
}) {
  return (
    <button
      onClick={onChange}
      className={`flex w-full items-center justify-between rounded-xl px-4 py-3 transition ${
        isFocused ? "bg-(--color-accent)/15 ring-2 ring-(--color-accent)/50" : "hover:bg-white/5"
      }`}
    >
      <div className="text-left">
        <span className="text-sm font-medium text-(--color-text)">{label}</span>
        {description && <p className="text-xs text-(--color-muted)">{description}</p>}
      </div>
      <div className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
        enabled ? "bg-(--color-accent)" : "bg-(--color-border)"
      }`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0"
        }`} />
      </div>
    </button>
  );
}

// ============================================================
// Slider row
// ============================================================
function SliderRow({
  label, value, min, max, step, unit, onChange, isFocused,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; isFocused?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 transition ${
      isFocused ? "bg-(--color-accent)/15 ring-2 ring-(--color-accent)/50" : ""
    }`}>
      <span className="w-28 shrink-0 text-sm text-(--color-muted)">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-(--color-accent) h-1.5 cursor-pointer appearance-none rounded-full bg-(--color-border) [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--color-accent) [&::-webkit-slider-thumb]:shadow-md"
      />
      <span className="w-16 text-right text-sm font-medium tabular-nums text-(--color-text)">
        {value}{unit}
      </span>
    </div>
  );
}

// ============================================================
// Segmented row — single container, no focusable children
// Left/Right cycling handled by the window keydown handler
// ============================================================
function SegmentedRow({
  label, options, value, isFocused,
}: {
  label: string;
  options: { value: string; labelKey: string }[];
  value: string;
  isFocused?: boolean;
}) {
  const { t } = useTranslation();
  const currentLabel = t(options.find((o) => o.value === value)?.labelKey ?? value, value);
  return (
    <div
      className={`flex items-center justify-between rounded-xl px-4 py-3 transition ${
        isFocused ? "bg-(--color-accent)/15 ring-2 ring-(--color-accent)/50" : ""
      }`}
    >
      <span className="text-sm font-medium text-(--color-muted)">{label}</span>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-(--color-muted)/40 opacity-40">◄</span>
        <span className="font-medium text-(--color-text)">{currentLabel}</span>
        <span className="text-(--color-muted)/40 opacity-40">►</span>
      </div>
    </div>
  );
}

// ============================================================
// Theme row — premium card with swatches + left/right indicators
// ============================================================
function ThemeRow({
  value, isFocused,
}: {
  value: string;
  isFocused?: boolean;
}) {
  const info = CONSOLE_THEME_INFOS[value];
  const swatches = info?.swatches ?? [];
  return (
    <div
      className={`rounded-xl px-5 py-4 transition ${
        isFocused ? "bg-(--color-accent)/20 ring-2 ring-(--color-accent)/60 scale-[1.01]" : "bg-(--color-surface)/30"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-medium text-(--color-muted)">Console Theme</span>
          <p className="text-base font-bold text-(--color-text)">{info?.label ?? value}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-(--color-muted)/60">
          <span>◄</span>
          <span className="text-(--color-muted)/30">|</span>
          <span>►</span>
        </div>
      </div>
      <div className="flex gap-2">
        {swatches.map((s, i) => (
          <div
            key={i}
            className="h-5 w-5 rounded-full border border-(--color-border)"
            style={{ background: s }}
            title={info ? Object.keys(CONSOLE_THEME_INFOS[value]!)[i] : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Live Card Preview — shows a real-time styled card mockup
// ============================================================
function LiveCardPreview({
  cornerRadius, hideLabels, isLandscape, isFocused, label,
}: {
  cornerRadius: number;
  hideLabels: boolean;
  isLandscape: boolean;
  isFocused?: boolean;
  label?: string;
}) {
  const cardW = isLandscape ? "w-[180px]" : "w-[120px]";
  const cardH = isLandscape ? "h-[100px]" : "h-[160px]";
  return (
    <div className={`rounded-xl px-4 py-4 transition ${isFocused ? "bg-(--color-accent)/10 ring-2 ring-(--color-accent)/40" : ""}`}>
      <div className="flex items-center gap-3 mb-3 text-sm font-medium text-(--color-muted)">
        <Image className="h-4 w-4" />
        {label ?? "Live Preview"}
      </div>
      <div className="flex items-center justify-center gap-3 pt-1">
        {/* Card mockup */}
        <div
          className={`${cardW} ${cardH} shrink-0 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-(--color-accent)/40 to-(--color-accent)/10 border border-(--color-border) shadow-lg`}
          style={{ borderRadius: cornerRadius > 0 ? cornerRadius : undefined }}
        >
          <div className="flex items-center justify-center h-full w-full bg-black/20">
            <Image className="h-8 w-8 text-(--color-muted)/30" />
          </div>
          {!hideLabels && !isLandscape && (
            <div className="w-full px-2 py-1.5 text-center">
              <p className="text-[10px] font-medium text-(--color-text) leading-tight truncate">Game Title</p>
            </div>
          )}
          {!hideLabels && isLandscape && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8">
              <p className="text-[10px] font-medium text-white leading-tight truncate">Game Title</p>
            </div>
          )}
        </div>
        {/* Info tags */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11px] text-(--color-muted)">
            <Tag className="h-3 w-3" />
            {isLandscape ? "Landscape" : "Poster"}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-(--color-muted)">
            <Rows3 className="h-3 w-3" />
            R{cornerRadius}px
          </div>
          {hideLabels && (
            <div className="flex items-center gap-1.5 text-[11px] text-(--color-muted)">
              <span className="h-3 w-3 text-center text-[9px] leading-none">⊘</span>
              No label
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Shared settings sub-page (reads row definitions, no onKeyDown — window handler does nav)
// ============================================================
function ConsoleSettingsSubPage({
  title, rows, settings, onPatch, onBack, focusedIndex, settingEditingId, subPageName,
}: {
  title: string;
  rows: SettingRowDef[];
  settings: ConsoleSettings;
  onPatch: (p: Partial<ConsoleSettings>) => void;
  onBack: () => void;
  focusedIndex: number;
  settingEditingId: string | null;
  subPageName?: string;
}) {
  const { t } = useTranslation();
  const renderRow = (row: SettingRowDef, i: number) => {
    const isFocused = focusedIndex === i;
    const isEditing = settingEditingId === row.id && row.type !== "toggle" && row.type !== "button";
    const viz = isFocused || isEditing;
    const rowLabel = t(row.labelKey ?? row.label, row.label);
    const rowDesc = row.descriptionKey ? t(row.descriptionKey, row.description ?? "") : row.description;
    switch (row.type) {
      case "slider":
        return (
          <SliderRow
            key={row.id}
            label={rowLabel}
            value={row.getValue(settings) as number}
            min={row.sliderMin!}
            max={row.sliderMax!}
            step={row.sliderStep!}
            unit={row.sliderUnit ?? ""}
            onChange={(v) => onPatch(row.onAction(settings, v > (row.getValue(settings) as number) ? "right" : "left"))}
            isFocused={viz}
          />
        );
      case "toggle":
        return (
          <ToggleRow
            key={row.id}
            label={rowLabel}
            description={rowDesc}
            enabled={row.getValue(settings) as boolean}
            onChange={() => onPatch(row.onAction(settings, "enter"))}
            isFocused={isFocused}
          />
        );
      case "segmented":
        if (row.id === "themeMode") {
          return (
            <ThemeRow
              key={row.id}
              value={row.getValue(settings) as string}
              isFocused={viz}
            />
          );
        }
        return (
          <SegmentedRow
            key={row.id}
            label={rowLabel}
            options={row.segOptions!}
            value={row.getValue(settings) as string}
            isFocused={viz}
          />
        );
      case "button":
        return (
          <button
            key={row.id}
            onClick={() => onPatch(row.onAction(settings, "enter"))}
            className={`w-full rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-3 text-sm font-medium text-amber-400 transition hover:bg-amber-500/15 ${isFocused ? "ring-2 ring-amber-500/60" : ""}`}
          >
            {rowLabel}
          </button>
        );
      case "preview": {
        const isGrid = subPageName === "grid-card-style";
        const gs = settings.gridCardStyle;
        const ss = settings.spotlightCardStyle;
        const previewRadius = isGrid ? gs.cornerRadius : ss.cornerRadius;
        const previewHideLabels = isGrid ? gs.hideLabels : ss.hideLabels;
        const previewLandscape = isGrid ? gs.useLandscapeCards : ss.cardStyle !== "poster";
        return (
          <LiveCardPreview
            key={row.id}
            cornerRadius={previewRadius}
            hideLabels={previewHideLabels}
            isLandscape={previewLandscape}
            isFocused={viz}
            label={isGrid ? t("console_settings.grid_preview", "Grid Preview") : t("console_settings.spotlight_preview", "Spotlight Preview")}
          />
        );
      }
    }
  };

  return (
    <div className="flex flex-col gap-2 outline-none">
      <SubPanelHeader title={title} onBack={onBack} />
      {rows.map((row, i) => renderRow(row, i))}
    </div>
  );
}

// ============================================================
// Theme Picker subpage — grid of theme cards with swatches
// ============================================================
function ThemePickerSubPanel({
  currentTheme, onSelect, onBack, focusedIndex, onFocusChange, itemCount,
}: {
  currentTheme: string;
  onSelect: (theme: string) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const themeKeys = THEME_KEYS;
  const totalItems = themeKeys.length;
  itemCount.current = totalItems;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const cols = 2;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        onFocusChange(Math.max(0, focusedIndex - cols));
        break;
      case "ArrowDown":
        e.preventDefault();
        onFocusChange(Math.min(totalItems - 1, focusedIndex + cols));
        break;
      case "ArrowLeft":
        e.preventDefault();
        onFocusChange(Math.max(0, focusedIndex - 1));
        break;
      case "ArrowRight":
      case "Enter":
      case "a":
        e.preventDefault();
        onFocusChange(Math.min(totalItems - 1, focusedIndex + 1));
        break;
      case "Escape":
      case "b":
      case "B":
        e.preventDefault();
        onBack();
        break;
    }
  };

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <SubPanelHeader title="Theme Picker" onBack={onBack} />
      <p className="text-sm text-(--color-muted) mb-2">Choose a console theme. Left/Right arrows to select, Enter to confirm, Escape to go back.</p>
      <div className="grid grid-cols-2 gap-3">
        {themeKeys.map((k, i) => {
          const info = CONSOLE_THEME_INFOS[k];
          const isSelected = k === currentTheme;
          const isFocused = focusedIndex === i;
          const swatches = info?.swatches ?? [];
          return (
            <button
              key={k}
              onClick={() => onSelect(k)}
              className={`flex flex-col gap-3 rounded-2xl border px-4 py-4 text-left transition ${
                isFocused
                  ? "border-(--color-accent) bg-(--color-accent)/15 ring-2 ring-(--color-accent)/60 scale-[1.02]"
                  : isSelected
                    ? "border-(--color-accent)/50 bg-(--color-accent)/8"
                    : "border-(--color-border) bg-(--color-surface)/30 hover:border-(--color-accent)/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm font-bold text-(--color-text)">{info?.label ?? k}</span>
                  {isSelected && <span className="ml-2 text-xs text-(--color-accent)">✓</span>}
                </div>
              </div>
              <div className="flex gap-1.5">
                {swatches.map((s, si) => (
                  <div
                    key={si}
                    className="h-4 w-4 rounded-full border border-(--color-border)"
                    style={{ background: s }}
                  />
                ))}
              </div>
              <p className="text-xs text-(--color-muted)/70 leading-relaxed">{info?.description ?? ""}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Tools sub-panel (placeholder)
// ============================================================
type ToolActionEntry = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  descKey: string;
  handler: () => Promise<void> | void;
};

function ConsoleToolsSubPanel({
  onBack, focusedIndex, onFocusChange: _onFocusChange, itemCount,
}: {
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const { t } = useTranslation();

  const toolActions: ToolActionEntry[] = [
    {
      id: "open-app-data",
      icon: FolderOpen,
      labelKey: "console_settings.open_app_data",
      descKey: "console_settings.open_app_data_desc",
      handler: async () => {
        setActionStatus("Opening…");
        try { await openAppDataFolder(); setActionStatus(null); } catch { setActionStatus(null); toast.error("Could not open app data folder"); }
      },
    },
    {
      id: "open-logs",
      icon: HardDrive,
      labelKey: "console_settings.open_logs",
      descKey: "console_settings.open_logs_desc",
      handler: async () => {
        setActionStatus("Opening…");
        try { await openLogsFolder(); setActionStatus(null); } catch { setActionStatus(null); toast.error("Could not open logs folder"); }
      },
    },
    {
      id: "clear-cache",
      icon: Trash2,
      labelKey: "console_settings.clear_cache",
      descKey: "console_settings.clear_cache_desc",
      handler: async () => {
        setActionStatus("Clearing…");
        try {
          const count = await clearTempCache();
          setActionStatus(null);
          toast.success(`Cleared ${count} cache folder(s)`);
        } catch {
          setActionStatus(null);
          toast.error("Failed to clear cache");
        }
      },
    },
    {
      id: "system-info",
      icon: Info,
      labelKey: "console_settings.system_info",
      descKey: "console_settings.system_info_desc",
      handler: async () => {
        setActionStatus("Loading…");
        try {
          const info: SystemInfo = await getSystemInfo();
          setActionStatus(null);
          const exeName = info.exe_path?.split(/[/\\]/).pop() ?? "unknown";
          toast.success(`System Info: ${info.os} ${info.arch} · ${exeName}`, { duration: 5000 });
        } catch {
          setActionStatus(null);
          toast.error("Could not fetch system info");
        }
      },
    },
    {
      id: "diagnostics",
      icon: Activity,
      labelKey: "console_settings.run_diagnostics",
      descKey: "console_settings.run_diagnostics_desc",
      handler: async () => {
        setActionStatus("Running…");
        try {
          const info = await getSystemInfo();
          const exeName = info.exe_path?.split(/[/\\]/).pop() ?? "N/A";
          setActionStatus(null);
          toast.success(`Diagnostics: ${info.os} ${info.arch} · ${exeName}`, { duration: 5000 });
        } catch {
          setActionStatus(null);
          toast.error("Diagnostics failed");
        }
      },
    },
  ];

  const totalItems = toolActions.length;
  itemCount.current = totalItems;

  return (
    <div className="flex flex-col gap-2">
      <SubPanelHeader title={t("console_settings.tools", "Tools")} onBack={onBack} />
      <p className="mb-2 text-sm text-(--color-muted)/60">{t("console_settings.tools_desc", "Utilities, diagnostics, and folder access")}</p>
      {toolActions.map((action, i) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            onClick={action.handler}
            className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all ${
              focusedIndex === i ? "bg-(--color-accent)/20 ring-2 ring-(--color-accent)/60 scale-[1.02]" : "hover:bg-white/10"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-surface)/60">
              <Icon className={`h-5 w-5 ${actionStatus && focusedIndex === i ? "text-(--color-accent) animate-pulse" : "text-(--color-muted)"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-(--color-text)">{t(action.labelKey)}</div>
              <div className="mt-0.5 text-sm text-(--color-muted)">{t(action.descKey)}</div>
            </div>
            {actionStatus && focusedIndex === i ? (
              <span className="shrink-0 text-xs text-(--color-accent)">{actionStatus}</span>
            ) : (
              <ChevronRight className="h-5 w-5 shrink-0 text-(--color-muted)/50" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Help sub-panel
// ============================================================
const HELP_ITEMS: {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: string;
  descKey: string;
  sections: { labelKey: string; hint: string }[];
}[] = [
  {
    key: "navigation",
    icon: Gamepad2,
    titleKey: "console_settings.help_navigation",
    descKey: "console_settings.help_navigation_desc",
    sections: [
      { labelKey: "console_settings.help_move_focus", hint: "[D-Pad / Arrows] Navigate" },
      { labelKey: "console_settings.help_select", hint: "[A / Enter] Confirm / Open" },
      { labelKey: "console_settings.help_back", hint: "[B / Esc] Cancel / Go back" },
      { labelKey: "console_settings.help_quick_search", hint: "[Y] Search games" },
      { labelKey: "console_settings.help_profile", hint: "[View] Account & settings" },
    ],
  },
  {
    key: "media",
    icon: Image,
    titleKey: "console_settings.help_media",
    descKey: "console_settings.help_media_desc",
    sections: [
      { labelKey: "console_settings.help_browse_media", hint: "[LB/RB] Prev / Next media" },
      { labelKey: "console_settings.help_play_pause", hint: "[A] Toggle video" },
      { labelKey: "console_settings.help_screenshots", hint: "[X] Open screenshot strip" },
      { labelKey: "console_settings.help_game_details", hint: "[Menu] Open options menu" },
    ],
  },
  {
    key: "actions",
    icon: PlayCircle,
    titleKey: "console_settings.help_actions",
    descKey: "console_settings.help_actions_desc",
    sections: [
      { labelKey: "console_settings.help_play_stop", hint: "[A] Primary action" },
      { labelKey: "console_settings.help_return_game", hint: "D-Pad Right while running" },
      { labelKey: "console_settings.help_favorite_toggle", hint: "D-Pad Right from primary" },
      { labelKey: "console_settings.help_options", hint: "[Menu] Open context menu" },
    ],
  },
  {
    key: "settings",
    icon: Settings,
    titleKey: "console_settings.help_settings",
    descKey: "console_settings.help_settings_desc",
    sections: [
      { labelKey: "console_settings.help_console_settings", hint: "Press [X] on settings page" },
      { labelKey: "console_settings.help_layout", hint: "Grid columns, card size, gaps" },
      { labelKey: "console_settings.help_input", hint: "Xbox / PlayStation / Keyboard glyphs" },
      { labelKey: "console_settings.help_profile_settings", hint: "Avatar, banner, display name" },
    ],
  },
];

function ConsoleHelpSubPanel({
  onBack, focusedIndex, onFocusChange: _onFocusChange, itemCount,
}: {
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const { t } = useTranslation();
  const totalItems = HELP_ITEMS.length + 1;
  itemCount.current = totalItems;

  return (
    <div className="flex flex-col gap-2">
      <SubPanelHeader title={t("console_settings.help_shortcuts", "Help & Shortcuts")} onBack={onBack} />
      <div className="flex flex-col gap-3 px-2 pb-4">
        {HELP_ITEMS.map((item, i) => {
          const Icon = item.icon;
          const isFocused = focusedIndex === i;
          return (
            <div
              key={item.key}
              tabIndex={-1}
              className={`rounded-xl border p-4 transition-all duration-150 ${
                isFocused
                  ? "border-(--color-accent)/50 bg-(--color-accent)/10 ring-2 ring-(--color-accent)/30 shadow-lg shadow-(--color-accent)/15"
                  : "border-(--color-border)/30 bg-(--color-surface)/20"
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon className={`h-5 w-5 ${isFocused ? "text-(--color-accent)" : "text-(--color-muted)"}`} />
                <span className="text-sm font-semibold text-(--color-text)">{t(item.titleKey)}</span>
              </div>
              <p className="mb-2 text-xs text-(--color-muted)/70">{t(item.descKey)}</p>
              <div className="flex flex-col gap-1">
                {item.sections.map((sec, si) => (
                  <div key={si} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-(--color-muted)">{t(sec.labelKey)}</span>
                    <span className="rounded bg-(--color-surface)/40 px-1.5 py-0.5 text-[10px] text-(--color-muted)/70">
                      {sec.hint}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div className={`rounded-xl border border-(--color-border)/20 px-4 py-3 transition-all duration-150 ${
          focusedIndex === totalItems - 1 ? "ring-1 ring-(--color-muted)/30 bg-(--color-surface)/30" : ""
        }`}>
          <p className="text-xs text-(--color-muted)/40">
            {t("console_settings.footer_hint", "LumaForge Console Mode · Press [B] or Esc to go back")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main menu options
// ============================================================
const MAIN_OPTIONS: {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  descKey?: string;
  action: "sub" | "navigate" | "random" | "refresh" | "switch-view" | "power" | "coming-soon";
  subPage?: PanelPage;
}[] = [
  { key: "random", icon: Shuffle, labelKey: "console_settings.pick_random", descKey: "console_settings.pick_random_desc", action: "random" },
  { key: "switch-view", icon: LayoutGrid, labelKey: "console_settings.switch_view", descKey: "console_settings.switch_view_desc", action: "switch-view" },
  { key: "refresh", icon: RefreshCw, labelKey: "console_settings.update_library", descKey: "console_settings.update_library_desc", action: "refresh" },
  { key: "settings", icon: Settings, labelKey: "console_settings.title", descKey: "console_settings.title_desc", action: "sub", subPage: "settings" },
  { key: "tools", icon: Wrench, labelKey: "console_settings.tools", descKey: "console_settings.tools_desc", action: "sub", subPage: "tools" },
  { key: "desktop", icon: Monitor, labelKey: "console_settings.switch_desktop", descKey: "console_settings.switch_desktop_desc", action: "navigate" },
  { key: "power-off", icon: Power, labelKey: "console_settings.power_off", descKey: "console_settings.power_off_desc", action: "power" },
  { key: "suspend", icon: Moon, labelKey: "console_settings.power_suspend", descKey: "console_settings.power_suspend_desc", action: "power" },
  { key: "hibernate", icon: Zap, labelKey: "console_settings.power_hibernate", descKey: "console_settings.power_hibernate_desc", action: "power" },
  { key: "restart", icon: Sun, labelKey: "console_settings.power_restart", descKey: "console_settings.power_restart_desc", action: "power" },
  { key: "help", icon: HelpCircle, labelKey: "console_settings.help", descKey: "console_settings.help_desc", action: "sub", subPage: "help" },
];

// ============================================================
// Settings category grid (Layout / Visuals / Input)
// ============================================================
function SettingsCategoryGrid({
  onSelect, onBack, focusedIndex, onFocusChange, itemCount,
}: {
  onSelect: (page: PanelPage) => void;
  onBack: () => void;
  focusedIndex: number;
  onFocusChange: (i: number) => void;
  itemCount: React.MutableRefObject<number>;
}) {
  const { t } = useTranslation();
  const cats: { key: PanelPage; icon: React.ComponentType<{ className?: string }>; labelKey: string; descKey: string }[] = [
    { key: "grid-card-style", icon: Grid3X3, labelKey: "console_settings.grid_card_style", descKey: "console_settings.grid_card_style_desc" },
    { key: "spotlight-card-style", icon: LayoutGrid, labelKey: "console_settings.spotlight_card_style", descKey: "console_settings.spotlight_card_style_desc" },
    { key: "spotlight-content", icon: Image, labelKey: "console_settings.spotlight_content", descKey: "console_settings.spotlight_content_desc" },
    { key: "visuals", icon: Maximize, labelKey: "console_settings.visuals", descKey: "console_settings.visuals_desc" },
    { key: "media", icon: Film, labelKey: "console_settings.media", descKey: "console_settings.media_desc" },
    { key: "input", icon: Gamepad2, labelKey: "console_settings.input", descKey: "console_settings.input_desc" },
    { key: "time", icon: Clock, labelKey: "console_settings.time", descKey: "console_settings.time_desc" },
    { key: "startup", icon: Rocket, labelKey: "console_settings.startup", descKey: "console_settings.startup_desc" },
    { key: "system-bar", icon: Monitor, labelKey: "console_settings.system_bar", descKey: "console_settings.system_bar_desc" },
    { key: "language", icon: Globe, labelKey: "console_settings.language", descKey: "console_settings.language_desc" },
  ];

  const gridRef = useRef<HTMLDivElement>(null);
  const totalItems = cats.length;
  itemCount.current = totalItems;

  useEffect(() => { gridRef.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowUp") { e.preventDefault(); onFocusChange(Math.max(0, focusedIndex - 1)); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); onFocusChange(Math.min(totalItems - 1, focusedIndex + 1)); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); onBack(); return; }
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === "a") { e.preventDefault(); const cat = cats[focusedIndex]; if (cat) onSelect(cat.key); return; }
    if (e.key === "Escape") { e.preventDefault(); onBack(); return; }
  };

  return (
    <div ref={gridRef} tabIndex={-1} className="flex flex-col gap-2 outline-none" onKeyDown={handleKeyDown}>
      <SubPanelHeader title={t("console_settings.title", "Console Settings")} onBack={onBack} />
      {cats.map((cat, i) => {
        const Icon = cat.icon;
        return (
          <button
            key={cat.key}
            onClick={() => onSelect(cat.key)}
            className={`flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-all ${
              focusedIndex === i ? "bg-(--color-accent)/20 ring-2 ring-(--color-accent)/60 scale-[1.02]" : "hover:bg-white/10"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-surface)/60">
              <Icon className="h-5 w-5 text-(--color-muted)" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-(--color-text)">{t(cat.labelKey)}</div>
              <div className="mt-0.5 text-sm text-(--color-muted)">{t(cat.descKey)}</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-(--color-muted)/50" />
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Main export
// ============================================================
export default function ConsoleSettingsPanelV2({
  open, onClose, settings, onPatch,
  onNavigate, allGames, onSelectGame, onRefreshLibrary,
}: Props) {
  const [profile] = useUserProfile();
  const { settings: desktopSettings, updateSetting: updateDesktopSetting } = useSettings();
  const { t } = useTranslation();
  const [page, setPage] = useState<PanelPage>("main");
  const [subPage, setSubPage] = useState<PanelPage | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [settingEditingId, setSettingEditingId] = useState<string | null>(null);
  const [themePickerIndex, setThemePickerIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [powerConfirm, setPowerConfirm] = useState<{ key: string; titleKey: string; messageKey: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const subItemCount = useRef(0);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  /* ── Clear edit mode when navigating to a different sub-page ── */
  useEffect(() => { setSettingEditingId(null); }, [subPage]);

  /* ── Menu stack for hierarchical navigation ── */
  type MenuStackEntry = { page: PanelPage; subPage: PanelPage | null; focusedIndex: number };
  const menuStackRef = useRef<MenuStackEntry[]>([]);

  /* ── Cooldown to ignore duplicate "v" events within 200ms of opening (gamepad debounce) ── */
  const openedAtRef = useRef(0);

  const avatarPreset = useMemo(() => getAvatarPreset(profile.avatarPreset), [profile.avatarPreset]);
  const avatarDisplayUrl = useMemo(() => resolveProfileMediaUrl(profile.avatarUrl), [profile.avatarUrl]);
  const bannerPreset = useMemo(() => getBannerPreset(profile.bannerPreset), [profile.bannerPreset]);
  const bannerDisplayUrl = useMemo(() => resolveProfileMediaUrl(profile.bannerUrl), [profile.bannerUrl]);

  // Mount/unmount animation
  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      menuStackRef.current = [];
      setPage("main");
      setSubPage(null);
      setFocusedIndex(0);
      if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][OPENED]`);
      // Small RAF delay so the DOM renders before transition kicks in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [open]);

  // Focus panel when visible
  useEffect(() => {
    if (visible && panelRef.current) {
      panelRef.current.focus();
    }
  }, [visible]);

  // Return focus on unmount
  useEffect(() => {
    return () => {
      // Only restore if we captured a previous element (close animation complete)
      if (!visible && prevFocusRef.current) {
        try { prevFocusRef.current.focus(); } catch {}
      }
    };
  }, [visible]);

  const handleClose = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      onClose();
      if (prevFocusRef.current) {
        try { prevFocusRef.current.focus(); } catch {}
      }
    }, ANIM_DURATION_MS);
  }, [onClose]);

  /* ── Override right-stick scroll target to panel content when open ── */
  useEffect(() => {
    const prev = getScrollTarget();
    if (open && panelScrollRef.current) {
      setScrollTarget(panelScrollRef.current);
    }
    return () => {
      setScrollTarget(prev);
    };
  }, [open]);

  /* ── Gamepad input: enabled while panel is open ── */
  useConsoleGamepadInput(open);

  /* ── Back navigation: pop stack, restore previous state ── */
  const doBackNav = useCallback(() => {
    const prev = menuStackRef.current.pop();
    if (prev) {
      setPage(prev.page);
      setSubPage(prev.subPage);
      setFocusedIndex(prev.focusedIndex);
    } else {
      handleClose();
    }
  }, [handleClose]);

  /* ── Window-level keydown to catch gamepad-dispatched events ── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (DEBUG_CONSOLE_GAMEPAD) {
        console.log(`[CONSOLE_GAMEPAD][HANDLER_RECEIVED] key=${e.key} location=ConsoleSettingsPanelV2`);
      }
      // Block all gamepad-mapped keys from leaking to underlying grid
      if (GAMEPAD_KEYS.has(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (DEBUG_CONSOLE_GAMEPAD) {
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Escape", "b", "B", "v", "V"].includes(e.key)) {
            console.log(`[QUICK_MENU_INPUT][KEY] key=${e.key} handled=true`);
          } else {
            console.log(`[CONSOLE_INPUT][BLOCKED_BEHIND_QUICK_MENU] key=${e.key}`);
          }
        }
      }

      const isMain = page === "main" && subPage === null;

      if (isMain) {
        // ── Main page navigation ──
        switch (e.key) {
          case "ArrowUp":
            setFocusedIndex((i) => Math.max(0, i - 1));
            break;
          case "ArrowDown":
            setFocusedIndex((i) => Math.min(MAIN_OPTIONS.length - 1, i + 1));
            break;
          case "ArrowRight":
            {
              const opt = MAIN_OPTIONS[focusedIndex];
              if (!opt || opt.action !== "sub" || !opt.subPage) break;
              menuStackRef.current.push({ page, subPage: null, focusedIndex });
              if (opt.subPage === "settings") {
                setPage(opt.subPage);
              } else {
                setSubPage(opt.subPage);
              }
              setFocusedIndex(0);
            }
            break;
          case "Enter":
            {
              const opt = MAIN_OPTIONS[focusedIndex];
              if (!opt) break;
              switch (opt.action) {
                case "sub":
                  if (opt.subPage) {
                    menuStackRef.current.push({ page, subPage: null, focusedIndex });
                    if (opt.subPage === "settings") {
                      setPage(opt.subPage);
                    } else {
                      setSubPage(opt.subPage);
                    }
                    setFocusedIndex(0);
                  }
                  break;
                case "navigate":
                  handleClose();
                  onNavigate?.("home");
                  break;
                case "random":
                  handleClose();
                  if (allGames && allGames.length > 0 && onSelectGame) {
                    const idx = Math.floor(Math.random() * allGames.length);
                    onSelectGame(allGames[idx]);
                  }
                  break;
                case "refresh":
                  handleClose();
                  onRefreshLibrary?.();
                  break;
                case "power":
                  {
                    const cfg = POWER_CONFIRM_CONFIGS[opt.key];
                    if (cfg) setPowerConfirm({ key: opt.key, ...cfg });
                    else toast.error("Power action not available");
                  }
                  break;
                case "switch-view":
                  {
                    const from = settings.layoutMode;
                    const to = from === "spotlight" ? "grid" : "spotlight";
                    if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][ACTIVATE] id=switch-view source=gamepad`);
                    if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_LAYOUT][SWITCH_REQUEST] from=${from} to=${to}`);
                    handleClose();
                    onPatch({ layoutMode: to });
                    if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_LAYOUT][APPLIED] layoutMode=${to}`);
                  }
                  break;
              }
            }
            break;
          case "Escape":
          case "b":
          case "B":
            handleClose();
            break;
          case "v":
          case "V":
            if (Date.now() - openedAtRef.current < 200) {
              if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][IGNORED_SAME_EVENT] key=v ageMs=${Date.now() - openedAtRef.current}`);
              break;
            }
            if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][CLOSE_REQUEST] source=view`);
            handleClose();
            break;
        }
      } else if (page === "settings" && !subPage) {
        // ── Settings category grid (gamepad events bypass React delegation) ──
        // Gamepad dispatches keydown on document.body which never reaches
        // React's #root-level delegation, so the grid's onKeyDown never
        // fires. Handle navigation here directly.
        const SETTINGS_KEYS: PanelPage[] = ["grid-card-style", "spotlight-card-style", "spotlight-content", "visuals", "media", "input", "time", "startup", "system-bar", "language"];
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            setFocusedIndex((i) => Math.max(0, i - 1));
            break;
          case "ArrowDown":
            e.preventDefault();
            setFocusedIndex((i) => Math.min(SETTINGS_KEYS.length - 1, i + 1));
            break;
          case "ArrowLeft":
            e.preventDefault();
            setPage("main");
            break;
          case "ArrowRight":
          case "Enter":
          case "a":
          case "A":
            e.preventDefault();
            {
              const target = SETTINGS_KEYS[focusedIndex];
              if (target) {
                menuStackRef.current.push({ page, subPage: null, focusedIndex });
                setSubPage(target);
                setFocusedIndex(0);
              }
            }
            break;
          case "Escape":
          case "b":
          case "B":
            setPage("main");
            break;
        }
      } else if (subPage && SUBPAGE_ROWS[subPage]) {
        // ── Setting sub-page (layout/visuals/media/input) — two-state model ──
        const rows = SUBPAGE_ROWS[subPage];
        if (settingEditingId !== null) {
          // ── Editing mode: Left/Right/Enter adjust value, Escape exits edit mode ──
          switch (e.key) {
            case "ArrowLeft":
              e.preventDefault();
              onPatch(rows[focusedIndex]!.onAction(settings, "left"));
              break;
            case "ArrowRight":
            case "Enter":
              e.preventDefault();
              onPatch(rows[focusedIndex]!.onAction(settings, "right"));
              break;
            case "Escape":
            case "b":
            case "B":
              e.preventDefault();
              setSettingEditingId(null);
              break;
          }
        } else {
          // ── Focus mode: arrows move focus, Enter enters edit or activates toggle/button ──
          switch (e.key) {
            case "ArrowUp":
              e.preventDefault();
              {
                const prev = focusedIndex;
                const next = Math.max(0, prev - 1);
                setFocusedIndex(next);
                if (DEBUG_CONSOLE_SETTINGS) {
                  const fromId = rows[prev]?.id ?? "?";
                  const toId = rows[next]?.id ?? "?";
                  console.log(`[CONSOLE_SETTINGS][MOVE] from=${fromId} to=${toId} direction=up`);
                }
              }
              break;
            case "ArrowDown":
              e.preventDefault();
              {
                const prev = focusedIndex;
                const next = Math.min(rows.length - 1, prev + 1);
                setFocusedIndex(next);
                if (DEBUG_CONSOLE_SETTINGS) {
                  const fromId = rows[prev]?.id ?? "?";
                  const toId = rows[next]?.id ?? "?";
                  console.log(`[CONSOLE_SETTINGS][MOVE] from=${fromId} to=${toId} direction=down`);
                }
              }
              break;
            case "ArrowLeft":
            case "ArrowRight":
              {
                const row = rows[focusedIndex];
                if (!row) break;
                e.preventDefault();
                if (row.type === "toggle") {
                  onPatch(row.onAction(settings, "enter"));
                } else if (row.type === "segmented") {
                  const dir = e.key === "ArrowLeft" ? "left" : "right";
                  const oldVal = row.getValue(settings);
                  onPatch(row.onAction(settings, dir));
                  if (DEBUG_CONSOLE_SETTINGS) {
                    const label = dir === "left" ? "SEGMENT_LEFT" : "SEGMENT_RIGHT";
                    console.log(`[CONSOLE_SETTINGS][${label}] id=${row.id} old=${oldVal}`);
                  }
                }
              }
              break;
            case "Enter":
              e.preventDefault();
              {
                const row = rows[focusedIndex];
                if (!row) break;
                if (row.type === "toggle" || row.type === "button") {
                  onPatch(row.onAction(settings, "enter"));
                } else if (row.id === "themeMode") {
                  // Console Theme: open Theme Picker subpage
                  if (DEBUG_CONSOLE_SETTINGS) console.log(`[CONSOLE_SETTINGS][FOCUS] page=visuals index=${focusedIndex} id=themeMode action=open-picker`);
                  menuStackRef.current.push({ page, subPage, focusedIndex });
                  setSubPage("theme-picker");
                  setThemePickerIndex(THEME_KEYS.indexOf(settings.themeMode));
                } else if (row.type === "slider") {
                  setSettingEditingId(row.id);
                }
                // segmented rows (non-theme): Enter does nothing, Left/Right already works
              }
              break;
            case "Escape":
            case "b":
            case "B":
              doBackNav();
              break;
          }
        }
      } else if (subPage === "theme-picker") {
        // ── Theme Picker subpage — grid navigation ──
        const cols = 2;
        const total = THEME_KEYS.length;
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            setThemePickerIndex((i) => Math.max(0, i - cols));
            break;
          case "ArrowDown":
            e.preventDefault();
            setThemePickerIndex((i) => Math.min(total - 1, i + cols));
            break;
          case "ArrowLeft":
            e.preventDefault();
            setThemePickerIndex((i) => Math.max(0, i - 1));
            break;
          case "ArrowRight":
            e.preventDefault();
            setThemePickerIndex((i) => Math.min(total - 1, i + 1));
            break;
          case "Enter":
          case "a":
          case "A":
            e.preventDefault();
            {
              const selected = THEME_KEYS[themePickerIndex];
              if (selected) {
                if (DEBUG_CONSOLE_SETTINGS) console.log(`[CONSOLE_THEME][APPLY] theme=${selected}`);
                onPatch({ themeMode: selected as ConsoleThemeMode });
                doBackNav();
              }
            }
            break;
          case "Escape":
          case "b":
          case "B":
            e.preventDefault();
            doBackNav();
            break;
        }
      } else if (subPage === "tools") {
        // ── Tools sub-page ──
        const toolRows: ToolActionEntry[] = [
          { id: "open-app-data", icon: FolderOpen, labelKey: "console_settings.open_app_data", descKey: "console_settings.open_app_data_desc", handler: async () => { try { await openAppDataFolder(); } catch { toast.error("Could not open app data folder"); } } },
          { id: "open-logs", icon: HardDrive, labelKey: "console_settings.open_logs", descKey: "console_settings.open_logs_desc", handler: async () => { try { await openLogsFolder(); } catch { toast.error("Could not open logs folder"); } } },
          { id: "clear-cache", icon: Trash2, labelKey: "console_settings.clear_cache", descKey: "console_settings.clear_cache_desc", handler: async () => { try { const c = await clearTempCache(); toast.success(`Cleared ${c} cache folder(s)`); } catch { toast.error("Failed to clear cache"); } } },
          { id: "system-info", icon: Info, labelKey: "console_settings.system_info", descKey: "console_settings.system_info_desc", handler: async () => { try { const info: SystemInfo = await getSystemInfo(); const exeName = info.exe_path?.split(/[/\\]/).pop(); toast.success(`System Info: ${info.os} ${info.arch} · ${exeName}`, { duration: 5000 }); } catch { toast.error("Could not fetch system info"); } } },
          { id: "diagnostics", icon: Activity, labelKey: "console_settings.run_diagnostics", descKey: "console_settings.run_diagnostics_desc", handler: async () => { try { await getSystemInfo(); toast.success("Diagnostics ran successfully", { duration: 5000 }); } catch { toast.error("Diagnostics failed"); } } },
        ];
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            setFocusedIndex((i) => Math.max(0, i - 1));
            break;
          case "ArrowDown":
            e.preventDefault();
            setFocusedIndex((i) => Math.min(toolRows.length - 1, i + 1));
            break;
          case "Enter":
            e.preventDefault();
            toolRows[focusedIndex]?.handler();
            break;
          case "Escape":
          case "b":
          case "B":
            e.preventDefault();
            doBackNav();
            break;
        }
      } else if (subPage === "help") {
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            setFocusedIndex((i) => Math.max(0, i - 1));
            break;
          case "ArrowDown":
            e.preventDefault();
            setFocusedIndex((i) => Math.min(HELP_ITEMS.length, i + 1));
            break;
          case "Escape":
          case "b":
          case "B":
            e.preventDefault();
            doBackNav();
            break;
        }
      } else {
        // ── Other sub-pages ──
        switch (e.key) {
          case "Escape":
          case "b":
          case "B":
            doBackNav();
            break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, page, subPage, focusedIndex, settingEditingId, handleClose, onNavigate, onSelectGame, onRefreshLibrary, allGames, settings, onPatch, doBackNav]);

  const handleMainKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Consume all gamepad-mapped keys
    if (GAMEPAD_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); }
    // Only handle navigation keys when on the main menu (no sub-page active)
    // Sub-pages have their own key handler via window.addEventListener, which fires separately
    if (subPage === null) {
      if (e.key === "ArrowUp") { setFocusedIndex((i) => Math.max(0, i - 1)); }
      if (e.key === "ArrowDown") { setFocusedIndex((i) => Math.min(MAIN_OPTIONS.length - 1, i + 1)); }
      if (e.key === "Enter") {
        const opt = MAIN_OPTIONS[focusedIndex];
        if (!opt) return;
        switch (opt.action) {
          case "sub":
            if (opt.subPage) {
              menuStackRef.current.push({ page, subPage: null, focusedIndex });
              if (opt.subPage === "settings") {
                setPage(opt.subPage);
              } else {
                setSubPage(opt.subPage);
              }
              setFocusedIndex(0);
            }
            break;
          case "navigate":
            handleClose();
            onNavigate?.("home");
            break;
          case "random":
            handleClose();
            if (allGames && allGames.length > 0 && onSelectGame) {
              const idx = Math.floor(Math.random() * allGames.length);
              onSelectGame(allGames[idx]);
            }
            break;
          case "refresh":
            handleClose();
            onRefreshLibrary?.();
            break;
              case "switch-view":
                {
                  const from = settings.layoutMode;
                  const to = from === "spotlight" ? "grid" : "spotlight";
                  if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][ACTIVATE] id=switch-view source=click`);
                  if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_LAYOUT][SWITCH_REQUEST] from=${from} to=${to}`);
                  handleClose();
                  onPatch({ layoutMode: to });
                }
                break;
              case "power":
                {
                  const cfg = POWER_CONFIRM_CONFIGS[opt.key];
                  if (cfg) setPowerConfirm({ key: opt.key, ...cfg });
                  else toast.error("Power action not available");
                }
                break;
        }
      }
    }
    if (e.key === "Escape") { e.preventDefault(); subPage !== null ? doBackNav() : handleClose(); }
    if (e.key === "b" || e.key === "B") { e.preventDefault(); subPage !== null ? doBackNav() : handleClose(); }
  }, [focusedIndex, allGames, handleClose, onNavigate, onSelectGame, onRefreshLibrary, settings, onPatch, subPage, doBackNav]);

  const handleGlobalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (GAMEPAD_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); }
    if (e.key === "Escape") { handleClose(); }
    if (e.key === "b" || e.key === "B") { handleClose(); }
  }, [handleClose]);

  const renderSubPage = () => {
    const rows = subPage ? SUBPAGE_ROWS[subPage] : undefined;
    const titleKey = subPage ? SUBPAGE_TITLES[subPage] ?? "" : "";
    const title = titleKey ? t(titleKey) : "";
    if (rows && title) {
      // ── Startup sub-page: sync 4 shared fields with Desktop settings ──
      const isStartup = subPage === "startup";
      const effectiveSettings = isStartup ? {
        ...settings,
        autostart: desktopSettings.startWithWindows,
        startMaximized: desktopSettings.startMaximized,
        startInTray: desktopSettings.startInTray,
        closeToTray: desktopSettings.closeToTray,
        windowMode: desktopSettings.startupWindowMode as ConsoleSettings["windowMode"],
      } : settings;

      const effectiveOnPatch = isStartup
        ? (p: Partial<ConsoleSettings>) => {
            onPatch(p);
            // Sync shared startup fields to Desktop settings
            if (p.autostart !== undefined) updateDesktopSetting("startWithWindows", p.autostart);
            if (p.startMaximized !== undefined) updateDesktopSetting("startMaximized", p.startMaximized);
            if (p.startInTray !== undefined) updateDesktopSetting("startInTray", p.startInTray);
            if (p.closeToTray !== undefined) updateDesktopSetting("closeToTray", p.closeToTray);
            // windowMode (Console) → startupWindowMode (Desktop)
            if (p.windowMode !== undefined) {
              updateDesktopSetting("startupWindowMode", p.windowMode as "windowed" | "maximized" | "fullscreen");
            }
            // launchMode: map Console's 3-value to Desktop's 2-value
            if (p.launchMode !== undefined) {
              const mapped = p.launchMode === "last-used" ? "desktop" : p.launchMode;
              updateDesktopSetting("launchMode", mapped as "desktop" | "console");
            }
          }
        : onPatch;

      return (
        <ConsoleSettingsSubPage
          title={title}
          rows={rows}
          settings={effectiveSettings}
          onPatch={effectiveOnPatch}
          onBack={doBackNav}
          focusedIndex={focusedIndex}
          settingEditingId={settingEditingId}
          subPageName={subPage ?? undefined}
        />
      );
    }
    switch (subPage) {
      case "tools": return <ConsoleToolsSubPanel onBack={doBackNav} focusedIndex={focusedIndex} onFocusChange={setFocusedIndex} itemCount={subItemCount} />;
      case "help": return <ConsoleHelpSubPanel onBack={doBackNav} focusedIndex={focusedIndex} onFocusChange={setFocusedIndex} itemCount={subItemCount} />;
      case "theme-picker": return (
        <ThemePickerSubPanel
          currentTheme={settings.themeMode}
          onSelect={(t) => {
            if (DEBUG_CONSOLE_SETTINGS) console.log(`[CONSOLE_THEME][APPLY] theme=${t}`);
            if (DEBUG_CONSOLE_SETTINGS) console.log(`[CONSOLE_THEME][PERSIST] theme=${t}`);
            onPatch({ themeMode: t as ConsoleThemeMode });
            doBackNav();
          }}
          onBack={doBackNav}
          focusedIndex={themePickerIndex}
          onFocusChange={setThemePickerIndex}
          itemCount={subItemCount}
        />
      );
      default: return null;
    }
  };

  const renderMain = () => (
    <div className="flex flex-col gap-2" onKeyDown={handleMainKeyDown}>
      {MAIN_OPTIONS.map((opt, i) => (
        <OptionRow
          key={opt.key}
          icon={opt.icon}
          label={t(opt.labelKey)}
          description={opt.descKey ? t(opt.descKey) : undefined}
          hasArrow={opt.action === "sub"}
          disabled={opt.action === "coming-soon"}
          isFocused={focusedIndex === i}
          onClick={() => {
            switch (opt.action) {
              case "sub":
                if (opt.subPage) {
                  menuStackRef.current.push({ page, subPage: null, focusedIndex });
                  if (opt.subPage === "settings") {
                    setPage(opt.subPage);
                  } else {
                    setSubPage(opt.subPage);
                  }
                  setFocusedIndex(0);
                }
                break;
              case "navigate":
                handleClose();
                onNavigate?.("home");
                break;
              case "random":
                handleClose();
                if (allGames && allGames.length > 0 && onSelectGame) {
                  const idx = Math.floor(Math.random() * allGames.length);
                  onSelectGame(allGames[idx]);
                }
                break;
              case "refresh":
                handleClose();
                onRefreshLibrary?.();
                break;
              case "switch-view":
                {
                  const from = settings.layoutMode;
                  const to = from === "spotlight" ? "grid" : "spotlight";
                  if (DEBUG_CONSOLE_GAMEPAD) console.log(`[QUICK_MENU][ACTIVATE] id=switch-view source=click`);
                  if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_LAYOUT][SWITCH_REQUEST] from=${from} to=${to}`);
                  handleClose();
                  onPatch({ layoutMode: to });
                  if (DEBUG_CONSOLE_GAMEPAD) console.log(`[CONSOLE_LAYOUT][APPLIED] layoutMode=${to}`);
                }
                break;
              case "power":
                {
                  const cfg = POWER_CONFIRM_CONFIGS[opt.key];
                  if (cfg) setPowerConfirm({ key: opt.key, ...cfg });
                  else toast.error("Power action not available");
                }
                break;
            }
          }}
        />
      ))}
    </div>
  );

  const subPageLabel = (sp: PanelPage): string => {
    switch (sp) {
      case "grid-card-style": return "Grid Card Style";
      case "spotlight-card-style": return "Spotlight Card Style";
      case "visuals": return "Visuals";
      case "media": return "Media";
      case "input": return "Input";
      case "time": return "Time & Clock";
      case "startup": return "Startup";
      case "system-bar": return "System Bar";
      case "language": return "Language";
      case "tools": return "Tools";
      case "help": return "Help";
      case "theme-picker": return "Theme Picker";
      default: return "";
    }
  };

  const breadcrumbTitle = page === "settings" && !subPage ? "Console Settings" : subPage ? subPageLabel(subPage) : null;

  if (!open && !visible) return null;

  const bannerGradient = bannerPreset?.gradient ?? "var(--color-accent)";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[300] transition-all duration-[250ms] ease-out"
        style={{
          backgroundColor: visible ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0)",
          backdropFilter: visible ? "blur(4px)" : "blur(0px)",
          WebkitBackdropFilter: visible ? "blur(4px)" : "blur(0px)",
        }}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Console settings panel"
        className="fixed left-0 top-0 bottom-0 z-[300] flex w-[480px] max-w-[90vw] flex-col bg-(--color-bg)/95 border-r border-(--color-border) shadow-2xl outline-none transition-all duration-[250ms] ease-out"
        style={{
          transform: visible ? "translateX(0)" : "translateX(-100%)",
          opacity: visible ? 1 : 0,
        }}
        onKeyDown={handleGlobalKeyDown}
      >
        {/* Close button — top-right of drawer */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl bg-black/30 text-(--color-muted) backdrop-blur-sm transition hover:bg-black/50 hover:text-(--color-text)"
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Profile banner header — outer container is NOT overflow-hidden so avatar is never clipped */}
        <div className="relative shrink-0">
          {/* Banner media — only this inner div clips the image/gradient */}
          <div className="relative h-[140px] overflow-hidden">
            {bannerDisplayUrl ? (
              <img
                src={bannerDisplayUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="h-full w-full" style={{ background: bannerGradient }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-(--color-bg) via-(--color-bg)/40 to-transparent pointer-events-none" />
          </div>

          {/* Avatar — sits outside overflow-hidden, cleanly overlapping banner bottom */}
          <div className="absolute -bottom-9 left-6 z-10">
            <div
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full ring-4 ring-(--color-bg) shadow-lg"
              style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
            >
              {avatarDisplayUrl ? (
                <img src={avatarDisplayUrl} alt="" className="h-full w-full rounded-full object-cover" />
              ) : (
                <span className="text-2xl">{avatarPreset?.icon ?? "🎮"}</span>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable content area */}
        <div ref={panelScrollRef} className="flex flex-1 flex-col overflow-y-auto px-6 pt-[60px] pb-6">
          {/* Display name + status */}
          <div className="mb-4">
            <h2 className="text-xl font-bold text-(--color-text)">{profile.displayName}</h2>
            <p className="text-sm text-(--color-muted)">{profile.status}</p>
          </div>

          {/* Breadcrumb */}
          {(page === "settings" || subPage) && breadcrumbTitle && (
            <div className="mb-4 flex items-center gap-2 text-sm text-(--color-muted)/60 flex-wrap">
              <button
                onClick={() => { menuStackRef.current = []; setPage("main"); setSubPage(null); }}
                className="hover:text-(--color-text)"
              >
                Settings
              </button>
              {page === "settings" && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  {subPage ? (
                    <button
                      onClick={() => { menuStackRef.current = []; setSubPage(null); }}
                      className="hover:text-(--color-text)"
                    >
                      Console Settings
                    </button>
                  ) : (
                    <span className="text-(--color-text)/80">Console Settings</span>
                  )}
                </>
              )}
              {subPage && (
                <>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <span className="text-(--color-text)/80">{breadcrumbTitle}</span>
                </>
              )}
            </div>
          )}

          {/* Page content */}
          {page === "settings" && !subPage ? (
            <SettingsCategoryGrid
              onSelect={(p) => {
                menuStackRef.current.push({ page, subPage: null, focusedIndex });
                setSubPage(p);
                setFocusedIndex(0);
              }}
              onBack={() => setPage("main")}
              focusedIndex={focusedIndex}
              onFocusChange={setFocusedIndex}
              itemCount={subItemCount}
            />
          ) : subPage ? renderSubPage() : renderMain()}
        </div>
      </div>

      {/* ── Power confirm modal ── */}
      {powerConfirm && (
        <ConfirmModal
          open={true}
          title={t(powerConfirm.titleKey)}
          description={t(powerConfirm.messageKey)}
          variant="danger"
          confirmLabel={
            powerConfirm.key === "power-off" ? t("console_settings.power_shut_down", "Shut Down") :
            powerConfirm.key === "suspend" ? t("console_settings.power_suspend", "Suspend") :
            powerConfirm.key === "hibernate" ? t("console_settings.power_hibernate", "Hibernate") : t("console_settings.power_restart", "Restart")
          }
          cancelLabel={t("common.cancel", "Cancel")}
          onConfirm={() => {
            const key = powerConfirm.key;
            setPowerConfirm(null);
            handleClose();
            setTimeout(() => executePowerCommand(key), 400);
          }}
          onCancel={() => setPowerConfirm(null)}
        />
      )}
    </>
  );
}
