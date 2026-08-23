import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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

const GLYPH_OPTIONS: { value: ConsoleInputHintStyle; label: string }[] = [
  { value: "xbox", label: "Xbox" },
  { value: "playstation", label: "PlayStation" },
  { value: "keyboard", label: "Keyboard" },
  { value: "auto", label: "Auto" },
];

const TEXTURE_OPTIONS: { value: ConsoleBackgroundTexture; label: string }[] = [
  { value: "none", label: "None" },
  { value: "grain-soft", label: "Grain Soft" },
  { value: "vignette", label: "Vignette" },
  { value: "blur", label: "Blur" },
];

const ANIM_DURATION_MS = 250;

const TIME_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
  { value: "system", label: "System" },
  { value: "hidden", label: "Hidden" },
];

const LAUNCH_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "console", label: "Console Mode" },
  { value: "desktop", label: "Desktop" },
  { value: "last-used", label: "Last Used" },
];

const WINDOW_MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "fullscreen", label: "Fullscreen" },
  { value: "maximized", label: "Maximized" },
  { value: "minimized", label: "Minimized" },
  { value: "tray", label: "Tray" },
  { value: "windowed", label: "Windowed" },
];

/* ── Power action confirm configs ── */
const POWER_CONFIRM_CONFIGS: Record<string, { title: string; message: string }> = {
  "power-off": { title: "Turn Off System?", message: "This will shut down your computer." },
  "suspend": { title: "Suspend System?", message: "This will put your computer to sleep." },
  "hibernate": { title: "Hibernate System?", message: "This will save state and power off your computer." },
  "restart": { title: "Restart System?", message: "This will restart your computer." },
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
  description?: string;
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  sliderUnit?: string;
  segOptions?: { value: string; label: string }[];
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

const CARD_STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: "poster", label: "Poster" },
  { value: "landscape", label: "Landscape" },
  { value: "hero", label: "Hero" },
];

const SETTING_ROWS_GRID: SettingRowDef[] = [
  {
    id: "gridWidthPreset", type: "segmented", label: "Width Presets",
    segOptions: WIDTH_SEG_OPTIONS,
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
    id: "gridCornerRadius", type: "segmented", label: "Corner Radius",
    segOptions: RADIUS_SEG_OPTIONS,
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
    id: "gridLandscapePosters", type: "toggle", label: "Landscape Posters",
    description: "Wide landscape cards instead of tall poster cards",
    getValue: (s) => s.gridCardStyle.useLandscapeCards,
    onAction: (s) => patchGridCardStyle(s, { useLandscapeCards: !s.gridCardStyle.useLandscapeCards }),
  },
  {
    id: "gridHideLabels", type: "toggle", label: "Hide Labels",
    description: "Remove title labels from cards",
    getValue: (s) => s.gridCardStyle.hideLabels,
    onAction: (s) => patchGridCardStyle(s, { hideLabels: !s.gridCardStyle.hideLabels }),
  },
  { id: "gridPreview", type: "preview", label: "Live Preview", getValue: () => "", onAction: () => ({}) },
  { id: "resetGrid", type: "button", label: "Reset Grid Card Style", getValue: () => "", onAction: (s) => patchGridCardStyle(s, { ...GRID_CARD_DEFAULTS }) },
];

const SETTING_ROWS_SPOTLIGHT: SettingRowDef[] = [
  {
    id: "spCardStyle", type: "segmented", label: "Card Style",
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
    id: "spWidthPreset", type: "segmented", label: "Width Presets",
    segOptions: WIDTH_SEG_OPTIONS,
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
    id: "spCornerRadius", type: "segmented", label: "Corner Radius",
    segOptions: RADIUS_SEG_OPTIONS,
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
    id: "spHideLabels", type: "toggle", label: "Hide Labels",
    description: "Remove title labels from cards",
    getValue: (s) => s.spotlightCardStyle.hideLabels,
    onAction: (s) => patchSpotlightCardStyle(s, { hideLabels: !s.spotlightCardStyle.hideLabels }),
  },
  {
    id: "spTrailerPreview", type: "toggle", label: "Trailer Preview",
    description: "Show trailer/artwork preview in Spotlight",
    getValue: (s) => s.spotlightCardStyle.showTrailerPreview,
    onAction: (s) => patchSpotlightCardStyle(s, { showTrailerPreview: !s.spotlightCardStyle.showTrailerPreview }),
  },
  { id: "spPreview", type: "preview", label: "Live Preview", getValue: () => "", onAction: () => ({}) },
  { id: "resetSpotlight", type: "button", label: "Reset Spotlight Card Style", getValue: () => "", onAction: (s) => patchSpotlightCardStyle(s, { ...SPOTLIGHT_CARD_DEFAULTS }) },
];

const SETTING_ROWS_SPOTLIGHT_CONTENT: SettingRowDef[] = [
  { id: "scShowAboutGame", type: "toggle", label: "Show About Game", description: "Display About Game section in details panel", getValue: (s) => s.spotlightContent.showAboutGame, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showAboutGame: !s.spotlightContent.showAboutGame } }) },
  { id: "scShowScreenshots", type: "toggle", label: "Show Screenshots", description: "Display screenshot carousel in details panel", getValue: (s) => s.spotlightContent.showScreenshots, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showScreenshots: !s.spotlightContent.showScreenshots } }) },
  { id: "scShowTrailerPreview", type: "toggle", label: "Show Trailer Preview", description: "Display trailer/artwork video preview in details panel", getValue: (s) => s.spotlightContent.showTrailerPreview, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showTrailerPreview: !s.spotlightContent.showTrailerPreview } }) },
  { id: "scShowReviews", type: "toggle", label: "Show Reviews", description: "Display review summary card in details panel", getValue: (s) => s.spotlightContent.showReviews, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showReviews: !s.spotlightContent.showReviews } }) },
  { id: "scShowAchievements", type: "toggle", label: "Show Achievements", description: "Display achievement card in details panel", getValue: (s) => s.spotlightContent.showAchievements, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showAchievements: !s.spotlightContent.showAchievements } }) },
  { id: "scShowMetadata", type: "toggle", label: "Show Metadata", description: "Display genres, developer, publisher, platforms, languages, requirements", getValue: (s) => s.spotlightContent.showMetadata, onAction: (s) => ({ spotlightContent: { ...s.spotlightContent, showMetadata: !s.spotlightContent.showMetadata } }) },
  { id: "resetSpotlightContent", type: "button", label: "Reset Content to Defaults", getValue: () => "", onAction: () => ({ spotlightContent: { ...SPOTLIGHT_CONTENT_DEFAULTS } }) },
];

const SETTING_ROWS_VISUALS: SettingRowDef[] = [
  {
    id: "themeMode", type: "segmented", label: "Console Theme",
    segOptions: THEME_OPTIONS, getValue: (s) => s.themeMode,
    onAction: (s, k) => {
      const idx = THEME_OPTIONS.findIndex(o => o.value === s.themeMode);
      const next = THEME_OPTIONS[Math.min(THEME_OPTIONS.length - 1, idx + 1)];
      const prev = THEME_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { themeMode: prev.value } : {};
      return next ? { themeMode: next.value } : {};
    },
  },
  {
    id: "backgroundTexture", type: "segmented", label: "Background Texture",
    segOptions: TEXTURE_OPTIONS, getValue: (s) => s.backgroundTexture,
    onAction: (s, k) => {
      const idx = TEXTURE_OPTIONS.findIndex(o => o.value === s.backgroundTexture);
      const next = TEXTURE_OPTIONS[Math.min(TEXTURE_OPTIONS.length - 1, idx + 1)];
      const prev = TEXTURE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { backgroundTexture: prev.value } : {};
      return next ? { backgroundTexture: next.value } : {};
    },
  },
  { id: "focusShine", type: "toggle", label: "Focus Shine Animation", description: "Glow sweep on focused cards", getValue: (s) => s.focusShine, onAction: (s) => ({ focusShine: !s.focusShine }) },
  { id: "heroMotion", type: "toggle", label: "Hero Motion", description: "Slow Ken Burns effect on hero background", getValue: (s) => s.heroMotion, onAction: (s) => ({ heroMotion: !s.heroMotion }) },
  {
    id: "sidePanelPreset", type: "segmented", label: "Panel Size",
    segOptions: PANEL_WIDTH_PRESETS.map(p => ({ label: p.label, value: p.value })),
    description: "Auto adapts to 1080p/1440p/4K",
    getValue: (s) => s.sidePanelPreset,
    onAction: (s, k) => {
      const idx = PANEL_WIDTH_PRESETS.findIndex(o => o.value === s.sidePanelPreset);
      const next = PANEL_WIDTH_PRESETS[Math.min(PANEL_WIDTH_PRESETS.length - 1, idx + 1)];
      const prev = PANEL_WIDTH_PRESETS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { sidePanelPreset: prev.value } : {};
      return next ? { sidePanelPreset: next.value } : {};
    },
  },
  { id: "showTrailerPreview", type: "toggle", label: "Show Trailer Preview", description: "Show mini trailer/artwork preview in Spotlight", getValue: (s) => s.spotlightCardStyle.showTrailerPreview, onAction: (s) => patchSpotlightCardStyle(s, { showTrailerPreview: !s.spotlightCardStyle.showTrailerPreview }) },
  { id: "spotlightCardWidth", type: "slider", label: "Spotlight Card Width", sliderMin: 200, sliderMax: 420, sliderStep: 10, sliderUnit: "px", getValue: (s) => s.spotlightCardStyle.widthPreset, onAction: (s, k) => patchSpotlightCardStyle(s, { widthPreset: k === "left" ? Math.max(200, s.spotlightCardStyle.widthPreset - 10) : Math.min(420, s.spotlightCardStyle.widthPreset + 10) }) },
  { id: "spotlightCardGap", type: "slider", label: "Spotlight Card Gap", sliderMin: 8, sliderMax: 48, sliderStep: 2, sliderUnit: "px", getValue: (s) => s.spotlightCardGap, onAction: (s, k) => k === "left" ? { spotlightCardGap: Math.max(8, s.spotlightCardGap - 2) } : { spotlightCardGap: Math.min(48, s.spotlightCardGap + 2) } },
  { id: "resetVisuals", type: "button", label: "Reset Visuals to Defaults", getValue: () => "", onAction: () => resetConsoleVisualSettings() },
];

const SETTING_ROWS_MEDIA: SettingRowDef[] = [
  { id: "useSteamGridDb", type: "toggle", label: "Use SteamGridDB", description: "Artwork from SteamGridDB (requires API key)", getValue: (s) => s.useSteamGridDb, onAction: (s) => ({ useSteamGridDb: !s.useSteamGridDb }) },
  { id: "useSteamAppDetails", type: "toggle", label: "Use Steam AppDetails", description: "Images from Steam Store metadata", getValue: (s) => s.useSteamAppDetails, onAction: (s) => ({ useSteamAppDetails: !s.useSteamAppDetails }) },
  { id: "useIgdb", type: "toggle", label: "Use IGDB", description: "Cover art from IGDB (requires Client ID + Secret)", getValue: (s) => s.useIgdb, onAction: (s) => ({ useIgdb: !s.useIgdb }) },
  { id: "useRawg", type: "toggle", label: "Use RAWG", description: "Backgrounds from RAWG (requires API key)", getValue: (s) => s.useRawg, onAction: (s) => ({ useRawg: !s.useRawg }) },
  { id: "trailerShow", type: "toggle", label: "Show Trailer Preview", description: "Show trailer/artwork preview in details panel", getValue: (s) => s.showTrailerPreview, onAction: (s) => ({ showTrailerPreview: !s.showTrailerPreview }) },
  { id: "autoplayTrailers", type: "toggle", label: "Autoplay Trailers", description: "Start trailer automatically when entering details", getValue: (s) => s.autoplayTrailerPreviews, onAction: (s) => ({ autoplayTrailerPreviews: !s.autoplayTrailerPreviews }) },
  { id: "preferDirectVideo", type: "toggle", label: "Prefer Direct Video", description: "Use MP4/WebM when available (fallback to HLS/DASH)", getValue: (s) => s.preferDirectVideo, onAction: (s) => ({ preferDirectVideo: !s.preferDirectVideo }) },
  { id: "resetMedia", type: "button", label: "Reset Media to Defaults", getValue: () => "", onAction: () => resetConsoleMediaSettings() },
];

const SETTING_ROWS_INPUT: SettingRowDef[] = [
  {
    id: "inputHints", type: "segmented", label: "Input Hints Style",
    segOptions: GLYPH_OPTIONS, getValue: (s) => s.inputHints,
    onAction: (s, k) => {
      const idx = GLYPH_OPTIONS.findIndex(o => o.value === s.inputHints);
      const next = GLYPH_OPTIONS[Math.min(GLYPH_OPTIONS.length - 1, idx + 1)];
      const prev = GLYPH_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { inputHints: prev.value } : {};
      return next ? { inputHints: next.value } : {};
    },
  },
  { id: "showButtonHints", type: "toggle", label: "Show Button Hints", getValue: (s) => s.showButtonHints, onAction: (s) => ({ showButtonHints: !s.showButtonHints }) },
  { id: "showBottomHints", type: "toggle", label: "Show Bottom Hints", getValue: (s) => s.showBottomHints, onAction: (s) => ({ showBottomHints: !s.showBottomHints }) },
  { id: "resetInput", type: "button", label: "Reset Input to Defaults", getValue: () => "", onAction: () => resetConsoleInputSettings() },
];

const SETTING_ROWS_TIME: SettingRowDef[] = [
  {
    id: "timeFormat", type: "segmented", label: "Time Format",
    segOptions: TIME_FORMAT_OPTIONS, getValue: (s) => s.timeFormat,
    onAction: (s, k) => {
      const idx = TIME_FORMAT_OPTIONS.findIndex(o => o.value === s.timeFormat);
      const next = TIME_FORMAT_OPTIONS[Math.min(TIME_FORMAT_OPTIONS.length - 1, idx + 1)];
      const prev = TIME_FORMAT_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { timeFormat: prev.value as ConsoleSettings["timeFormat"] } : {};
      return next ? { timeFormat: next.value as ConsoleSettings["timeFormat"] } : {};
    },
  },
  { id: "showSeconds", type: "toggle", label: "Show Seconds", description: "Display seconds in the clock", getValue: (s) => s.showSeconds, onAction: (s) => ({ showSeconds: !s.showSeconds }) },
  { id: "showClock", type: "toggle", label: "Show Clock in HUD", description: "Display the clock in the top bar", getValue: (s) => s.showClock, onAction: (s) => ({ showClock: !s.showClock }) },
  { id: "resetTime", type: "button", label: "Reset Time to Defaults", getValue: () => "", onAction: () => resetConsoleTimeFormatSettings() },
];

const SETTING_ROWS_STARTUP: SettingRowDef[] = [
  {
    id: "launchMode", type: "segmented", label: "Launch Mode",
    segOptions: LAUNCH_MODE_OPTIONS, getValue: (s) => s.launchMode,
    onAction: (s, k) => {
      const idx = LAUNCH_MODE_OPTIONS.findIndex(o => o.value === s.launchMode);
      const next = LAUNCH_MODE_OPTIONS[Math.min(LAUNCH_MODE_OPTIONS.length - 1, idx + 1)];
      const prev = LAUNCH_MODE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { launchMode: prev.value as ConsoleSettings["launchMode"] } : {};
      return next ? { launchMode: next.value as ConsoleSettings["launchMode"] } : {};
    },
  },
  {
    id: "windowMode", type: "segmented", label: "Startup Window",
    segOptions: WINDOW_MODE_OPTIONS, getValue: (s) => s.windowMode,
    onAction: (s, k) => {
      const idx = WINDOW_MODE_OPTIONS.findIndex(o => o.value === s.windowMode);
      const next = WINDOW_MODE_OPTIONS[Math.min(WINDOW_MODE_OPTIONS.length - 1, idx + 1)];
      const prev = WINDOW_MODE_OPTIONS[Math.max(0, idx - 1)];
      if (k === "left") return prev ? { windowMode: prev.value as ConsoleSettings["windowMode"] } : {};
      return next ? { windowMode: next.value as ConsoleSettings["windowMode"] } : {};
    },
  },
  { id: "autostart", type: "toggle", label: "Start with Windows", description: "Automatically open LumaForge on system boot", getValue: (s) => s.autostart, onAction: (s) => ({ autostart: !s.autostart }) },
  { id: "startMaximized", type: "toggle", label: "Start Maximized", description: "Launch window maximized on startup (applies on next launch)", getValue: (s) => s.startMaximized, onAction: (s) => ({ startMaximized: !s.startMaximized }) },
  { id: "startInTray", type: "toggle", label: "Start in Tray", description: "Minimize to tray on startup (applies on next launch)", getValue: (s) => s.startInTray, onAction: (s) => ({ startInTray: !s.startInTray }) },
  { id: "closeToTray", type: "toggle", label: "Close to Tray", description: "Closing the window minimizes to tray instead of quitting", getValue: (s) => s.closeToTray, onAction: (s) => ({ closeToTray: !s.closeToTray }) },
  { id: "showDashboard", type: "toggle", label: "Show Dashboard", description: "Show dashboard on startup", getValue: (s) => s.showDashboard, onAction: (s) => ({ showDashboard: !s.showDashboard }) },
  { id: "disableUpdate", type: "toggle", label: "Disable Update", description: "Prevent automatic app updates", getValue: (s) => s.disableUpdate, onAction: (s) => ({ disableUpdate: !s.disableUpdate }) },
  { id: "resetStartup", type: "button", label: "Reset Startup to Defaults", getValue: () => "", onAction: () => resetConsoleStartupSettings() },
];

const SETTING_ROWS_SYSTEM_BAR: SettingRowDef[] = [
  { id: "showProfileHud", type: "toggle", label: "Show Profile", description: "Display avatar and name in the top bar", getValue: (s) => s.showProfileHud, onAction: (s) => ({ showProfileHud: !s.showProfileHud }) },
  { id: "showClock", type: "toggle", label: "Show Clock", description: "Display the clock in the top bar", getValue: (s) => s.showClock, onAction: (s) => ({ showClock: !s.showClock }) },
  { id: "showNetworkIndicator", type: "toggle", label: "Network Indicator", description: "Show online/offline status in the top bar", getValue: (s) => s.showNetworkIndicator, onAction: (s) => ({ showNetworkIndicator: !s.showNetworkIndicator }) },
  { id: "showControllerIndicator", type: "toggle", label: "Controller Indicator", description: "Show connected controller status in the top bar", getValue: (s) => s.showControllerIndicator, onAction: (s) => ({ showControllerIndicator: !s.showControllerIndicator }) },
  { id: "resetSystemBar", type: "button", label: "Reset System Bar to Defaults", getValue: () => "", onAction: () => resetConsoleSystemBarSettings() },
];

const SETTING_ROWS_LANGUAGE: SettingRowDef[] = [
  {
    id: "appLanguage", type: "segmented", label: "App Language",
    segOptions: [{ value: "system", label: "Follow System" }],
    getValue: () => "system",
    onAction: () => ({}),
  },
  { id: "languageComingSoon", type: "button", label: "Coming Soon — Translations will be added after feature completion", getValue: () => "", onAction: () => { toast("Language support is coming soon — stay tuned!", { icon: "🌐" }); return {}; } },
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
  "grid-card-style": "Grid Card Style",
  "spotlight-card-style": "Spotlight Card Style",
  "spotlight-content": "Spotlight Content",
  visuals: "Visuals",
  media: "Media & Trailers",
  input: "Input Settings",
  time: "Time & Clock",
  startup: "Startup",
  "system-bar": "System Bar",
  language: "Language",
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
  options: { value: string; label: string }[];
  value: string;
  isFocused?: boolean;
}) {
  const currentLabel = options.find((o) => o.value === value)?.label ?? value;
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
  const renderRow = (row: SettingRowDef, i: number) => {
    const isFocused = focusedIndex === i;
    const isEditing = settingEditingId === row.id && row.type !== "toggle" && row.type !== "button";
    const viz = isFocused || isEditing;
    switch (row.type) {
      case "slider":
        return (
          <SliderRow
            key={row.id}
            label={row.label}
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
            label={row.label}
            description={row.description}
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
            label={row.label}
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
            {row.label}
          </button>
        );
      case "preview": {
        // Determine card style based on subPageName
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
            label={isGrid ? "Grid Preview" : "Spotlight Preview"}
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
  label: string;
  description: string;
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

  const toolActions: ToolActionEntry[] = [
    {
      id: "open-app-data",
      icon: FolderOpen,
      label: "Open App Data Folder",
      description: "Browse cache, config, and data files",
      handler: async () => {
        setActionStatus("Opening…");
        try { await openAppDataFolder(); setActionStatus(null); } catch { setActionStatus(null); toast.error("Could not open app data folder"); }
      },
    },
    {
      id: "open-logs",
      icon: HardDrive,
      label: "Open Logs Folder",
      description: "View application logs for troubleshooting",
      handler: async () => {
        setActionStatus("Opening…");
        try { await openLogsFolder(); setActionStatus(null); } catch { setActionStatus(null); toast.error("Could not open logs folder"); }
      },
    },
    {
      id: "clear-cache",
      icon: Trash2,
      label: "Clear Temp Cache",
      description: "Remove temporary thumbnails and screenshots",
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
      label: "System Information",
      description: "OS, architecture, and runtime details",
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
      label: "Run Diagnostics",
      description: "Check cache health and storage status",
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
      <SubPanelHeader title="Tools" onBack={onBack} />
      <p className="mb-2 text-sm text-(--color-muted)/60">Utilities, diagnostics, and folder access</p>
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
              <div className="text-base font-semibold text-(--color-text)">{action.label}</div>
              <div className="mt-0.5 text-sm text-(--color-muted)">{action.description}</div>
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
  title: string;
  description: string;
  sections: { label: string; hint: string }[];
}[] = [
  {
    key: "navigation",
    icon: Gamepad2,
    title: "Navigation",
    description: "Move between sections, cards, and panels",
    sections: [
      { label: "Move focus", hint: "[D-Pad / Arrows] Navigate" },
      { label: "Select", hint: "[A / Enter] Confirm / Open" },
      { label: "Back", hint: "[B / Esc] Cancel / Go back" },
      { label: "Quick search", hint: "[Y] Search games" },
      { label: "Profile", hint: "[View] Account & settings" },
    ],
  },
  {
    key: "media",
    icon: Image,
    title: "Media & Details",
    description: "Browse screenshots, trailers, and game info",
    sections: [
      { label: "Browse media", hint: "[LB/RB] Prev / Next media" },
      { label: "Play / pause", hint: "[A] Toggle video" },
      { label: "Screenshots", hint: "[X] Open screenshot strip" },
      { label: "Game details", hint: "[Menu] Open options menu" },
    ],
  },
  {
    key: "actions",
    icon: PlayCircle,
    title: "Game Actions",
    description: "Play, install, and manage your games",
    sections: [
      { label: "Play / Stop", hint: "[A] Primary action" },
      { label: "Return to game", hint: "D-Pad Right while running" },
      { label: "Favorite toggle", hint: "D-Pad Right from primary" },
      { label: "Options", hint: "[Menu] Open context menu" },
    ],
  },
  {
    key: "settings",
    icon: Settings,
    title: "Settings",
    description: "Customize your console experience",
    sections: [
      { label: "Console Settings", hint: "Press [X] on settings page" },
      { label: "Layout", hint: "Grid columns, card size, gaps" },
      { label: "Input", hint: "Xbox / PlayStation / Keyboard glyphs" },
      { label: "Profile", hint: "Avatar, banner, display name" },
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
  const totalItems = HELP_ITEMS.length + 1;
  itemCount.current = totalItems;

  return (
    <div className="flex flex-col gap-2">
      <SubPanelHeader title="Help & Shortcuts" onBack={onBack} />
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
                <span className="text-sm font-semibold text-(--color-text)">{item.title}</span>
              </div>
              <p className="mb-2 text-xs text-(--color-muted)/70">{item.description}</p>
              <div className="flex flex-col gap-1">
                {item.sections.map((sec, si) => (
                  <div key={si} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-(--color-muted)">{sec.label}</span>
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
            LumaForge Console Mode &middot; Press [B] or Esc to go back
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
  label: string;
  description?: string;
  action: "sub" | "navigate" | "random" | "refresh" | "switch-view" | "power" | "coming-soon";
  subPage?: PanelPage;
}[] = [
  { key: "random", icon: Shuffle, label: "Pick Random Game", description: "Surprise me", action: "random" },
  { key: "switch-view", icon: LayoutGrid, label: "Switch View", description: "Toggle Grid / Spotlight", action: "switch-view" },
  { key: "refresh", icon: RefreshCw, label: "Update Library", description: "Rescan installed games", action: "refresh" },
  { key: "settings", icon: Settings, label: "Console Settings", description: "Layout, visuals, input", action: "sub", subPage: "settings" },
  { key: "tools", icon: Wrench, label: "Tools", description: "Utilities and diagnostics", action: "sub", subPage: "tools" },
  { key: "desktop", icon: Monitor, label: "Switch to Desktop Mode", description: "Exit console mode", action: "navigate" },
  { key: "power-off", icon: Power, label: "Turn Off System", description: "Shut down the system", action: "power" },
  { key: "suspend", icon: Moon, label: "Suspend", description: "Sleep mode", action: "power" },
  { key: "hibernate", icon: Zap, label: "Hibernate", description: "Save state and power off", action: "power" },
  { key: "restart", icon: Sun, label: "Restart", description: "Reboot the system", action: "power" },
  { key: "help", icon: HelpCircle, label: "Help", description: "Keyboard shortcuts & info", action: "sub", subPage: "help" },
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
  const cats: { key: PanelPage; icon: React.ComponentType<{ className?: string }>; label: string; description: string }[] = [
    { key: "grid-card-style", icon: Grid3X3, label: "Grid Card Style", description: "Card width, radius, labels for Grid mode" },
    { key: "spotlight-card-style", icon: LayoutGrid, label: "Spotlight Card Style", description: "Card style, presets, trailer for Spotlight" },
    { key: "spotlight-content", icon: Image, label: "Spotlight Content", description: "Visibility toggles for content sections" },
    { key: "visuals", icon: Maximize, label: "Visuals", description: "Theme, texture, effects" },
    { key: "media", icon: Film, label: "Media", description: "Providers, trailers, playback" },
    { key: "input", icon: Gamepad2, label: "Input", description: "Hints style, visibility" },
    { key: "time", icon: Clock, label: "Time & Clock", description: "Time format, seconds, visibility" },
    { key: "startup", icon: Rocket, label: "Startup", description: "Launch mode, window mode, autostart" },
    { key: "system-bar", icon: Monitor, label: "System Bar", description: "Indicator visibility in top bar" },
    { key: "language", icon: Globe, label: "Language", description: "App language (coming soon)" },
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
      <SubPanelHeader title="Console Settings" onBack={onBack} />
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
              <div className="text-base font-semibold text-(--color-text)">{cat.label}</div>
              <div className="mt-0.5 text-sm text-(--color-muted)">{cat.description}</div>
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
  const [page, setPage] = useState<PanelPage>("main");
  const [subPage, setSubPage] = useState<PanelPage | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [settingEditingId, setSettingEditingId] = useState<string | null>(null);
  const [themePickerIndex, setThemePickerIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [powerConfirm, setPowerConfirm] = useState<{ key: string; title: string; message: string } | null>(null);
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
          { id: "open-app-data", icon: FolderOpen, label: "Open App Data Folder", description: "Browse cache, config, and data files", handler: async () => { try { await openAppDataFolder(); } catch { toast.error("Could not open app data folder"); } } },
          { id: "open-logs", icon: HardDrive, label: "Open Logs Folder", description: "View application logs for troubleshooting", handler: async () => { try { await openLogsFolder(); } catch { toast.error("Could not open logs folder"); } } },
          { id: "clear-cache", icon: Trash2, label: "Clear Temp Cache", description: "Remove temporary thumbnails and screenshots", handler: async () => { try { const c = await clearTempCache(); toast.success(`Cleared ${c} cache folder(s)`); } catch { toast.error("Failed to clear cache"); } } },
          { id: "system-info", icon: Info, label: "System Information", description: "OS, architecture, and runtime details", handler: async () => { try { const info: SystemInfo = await getSystemInfo(); const exeName = info.exe_path?.split(/[/\\]/).pop(); toast.success(`System Info: ${info.os} ${info.arch} · ${exeName}`, { duration: 5000 }); } catch { toast.error("Could not fetch system info"); } } },
          { id: "diagnostics", icon: Activity, label: "Run Diagnostics", description: "Check cache health and storage status", handler: async () => { try { await getSystemInfo(); toast.success("Diagnostics ran successfully", { duration: 5000 }); } catch { toast.error("Diagnostics failed"); } } },
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
    const title = subPage ? SUBPAGE_TITLES[subPage] ?? "" : "";
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
          label={opt.label}
          description={opt.description}
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
          title={powerConfirm.title}
          description={powerConfirm.message}
          variant="danger"
          confirmLabel={
            powerConfirm.key === "power-off" ? "Shut Down" :
            powerConfirm.key === "suspend" ? "Suspend" :
            powerConfirm.key === "hibernate" ? "Hibernate" : "Restart"
          }
          cancelLabel="Cancel"
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
