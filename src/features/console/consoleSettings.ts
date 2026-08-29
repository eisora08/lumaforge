import { useState, useCallback, useEffect } from "react";

export type ConsoleLayoutMode = "spotlight" | "grid";

export type ConsoleThemeMode = "follow-app" | "solaris-dark" | "steam-deck" | "midnight" | "amoled" | "luma-dark" | "aurora" | "crimson" | "arctic" | "neon-noir";

export const CONSOLE_THEME_INFOS: Record<string, { label: string; description: string; swatches: string[] }> = {
  "follow-app":    { label: "Follow App Theme", description: "Use the global app theme", swatches: ["var(--color-accent)", "var(--color-bg)", "var(--color-surface)", "var(--color-muted)"] },
  "solaris-dark":  { label: "Solaris Dark",     description: "Dark bluish-purple palette", swatches: ["#7c6ff0", "#0f0d1a", "#1a1833", "#8b87a0"] },
  "steam-deck":    { label: "Steam Deck",        description: "Dark blue-gray with green accent", swatches: ["#4c9a76", "#111215", "#1b1d22", "#8b8f9a"] },
  "midnight":      { label: "Midnight",          description: "Deep blue-black", swatches: ["#4f7cf7", "#0a0e1a", "#121726", "#7a7f99"] },
  "amoled":        { label: "AMOLED",            description: "True black, maximum contrast", swatches: ["#888888", "#000000", "#0a0a0a", "#666666"] },
  "luma-dark":     { label: "Luma Dark",         description: "Warm dark with golden amber accent", swatches: ["#f0a030", "#0d0b08", "#1a1510", "#8a7a60"] },
  "aurora":        { label: "Aurora",            description: "Vibrant purple-teal atmospheric tones", swatches: ["#a855f7", "#0a0e12", "#141c24", "#7090a8"] },
  "crimson":       { label: "Crimson",           description: "Deep red with ruby accents", swatches: ["#dc2626", "#0f0707", "#1a0e0e", "#8a5050"] },
  "arctic":        { label: "Arctic",            description: "Cool icy blue-white palette", swatches: ["#60a5fa", "#0f141a", "#1a2230", "#8098b0"] },
  "neon-noir":     { label: "Neon Noir",         description: "Dark cyberpunk with hot pink & cyan", swatches: ["#f472b6", "#08080f", "#12101e", "#706a90"] },
};

export type ConsoleBackgroundTexture = "none" | "grain-soft" | "vignette" | "blur";

export type ConsoleInputHintStyle = "xbox" | "playstation" | "keyboard" | "auto";

export type ConsoleBottomBarPosition = "center" | "left" | "right";

export type ConsoleStartCategory = "continue" | "installed" | "lua" | "favorites" | "all";

export type ConsoleTimeFormat = "12h" | "24h" | "system" | "hidden";

export type ConsoleLaunchMode = "console" | "desktop" | "last-used";

export type ConsoleWindowMode = "fullscreen" | "maximized" | "minimized" | "tray" | "windowed";

export type PanelWidthPreset = "compact" | "standard" | "wide" | "auto";

export const PANEL_WIDTH_PRESETS: { label: string; value: PanelWidthPreset; width: number; description: string }[] = [
  { label: "Compact",  value: "compact",  width: 540, description: "More space for the grid" },
  { label: "Standard", value: "standard", width: 720, description: "Balanced grid and panel" },
  { label: "Wide",     value: "wide",     width: 900, description: "Larger panel, fewer cards" },
  { label: "Auto",     value: "auto",     width: 0,   description: "Adapts to screen resolution" },
];

export function resolvePanelWidth(preset: PanelWidthPreset, screenWidth?: number): number {
  if (preset === "auto") {
    const w = screenWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1920);
    if (w >= 3840) return 900;
    if (w >= 2560) return 720;
    return 540;
  }
  return PANEL_WIDTH_PRESETS.find((p) => p.value === preset)?.width ?? 720;
}

export type SpotlightCardVisual = "poster" | "landscape" | "hero";

export type GridCardStyle = {
  widthPreset: number;
  cornerRadius: number;
  useLandscapeCards: boolean;
  hideLabels: boolean;
};

export type SpotlightCardStyle = {
  cardStyle: SpotlightCardVisual;
  widthPreset: number;
  cornerRadius: number;
  hideLabels: boolean;
  showTrailerPreview: boolean;
};

export type SpotlightContentSettings = {
  showAboutGame: boolean;
  showScreenshots: boolean;
  showTrailerPreview: boolean;
  showReviews: boolean;
  showAchievements: boolean;
  showMetadata: boolean;
};

export type ConsoleSettings = {
  layoutMode: ConsoleLayoutMode;
  startCategory: ConsoleStartCategory;
  themeMode: ConsoleThemeMode;
  backgroundTexture: ConsoleBackgroundTexture;
  inputHints: ConsoleInputHintStyle;
  showClock: boolean;
  showProfileHud: boolean;
  showPlatformLabel: boolean;
  showButtonHints: boolean;
  showBottomHints: boolean;
  gridColumns: number;
  gridGap: number;
  leftPadding: number;
  sidePanelPreset: PanelWidthPreset;
  sidePanelWidth: number;
  bottomBarPosition: ConsoleBottomBarPosition;
  horizontalScrolling: boolean;
  smoothScrolling: boolean;
  focusShine: boolean;
  heroMotion: boolean;
  spotlightCardGap: number;

  /* ── Card style (independent per mode) ── */
  gridCardStyle: GridCardStyle;
  spotlightCardStyle: SpotlightCardStyle;

  /* ── Spotlight content visibility (independent from card style) ── */
  spotlightContent: SpotlightContentSettings;

  /* ── Media provider toggles ── */
  useSteamGridDb: boolean;
  useSteamAppDetails: boolean;
  useIgdb: boolean;
  useRawg: boolean;

  /* ── Trailer settings ── */
  showTrailerPreview: boolean;
  autoplayTrailerPreviews: boolean;
  preferDirectVideo: boolean;

  /* ── Time format ── */
  timeFormat: ConsoleTimeFormat;
  showSeconds: boolean;

  /* ── Startup ── */
  autostart: boolean;
  launchMode: ConsoleLaunchMode;
  windowMode: ConsoleWindowMode;
  startMaximized: boolean;
  startInTray: boolean;
  closeToTray: boolean;
  showDashboard: boolean;
  disableUpdate: boolean;

  /* ── System bar indicators ── */
  showNetworkIndicator: boolean;
  showControllerIndicator: boolean;
};

const STORAGE_KEY = "lumaforge-console-settings-v1";
const LEGACY_STORAGE_KEY = "lumaforge-console-settings-v1";

export const GRID_CARD_DEFAULTS: GridCardStyle = {
  widthPreset: 220,
  cornerRadius: 8,
  useLandscapeCards: false,
  hideLabels: true,
};

export const SPOTLIGHT_CARD_DEFAULTS: SpotlightCardStyle = {
  cardStyle: "landscape",
  widthPreset: 320,
  cornerRadius: 8,
  hideLabels: true,
  showTrailerPreview: true,
};

export const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  layoutMode: "grid",
  startCategory: "all",
  themeMode: "follow-app",
  backgroundTexture: "none",
  inputHints: "xbox",
  showClock: true,
  showProfileHud: true,
  showPlatformLabel: false,
  showButtonHints: true,
  showBottomHints: true,
  gridColumns: 8,
  gridGap: 36,
  leftPadding: 64,
  sidePanelPreset: "auto",
  sidePanelWidth: resolvePanelWidth("auto"),
  bottomBarPosition: "center",
  horizontalScrolling: false,
  smoothScrolling: true,
  focusShine: true,
  heroMotion: true,
  spotlightCardGap: 20,
  gridCardStyle: { ...GRID_CARD_DEFAULTS },
  spotlightCardStyle: { ...SPOTLIGHT_CARD_DEFAULTS },
  spotlightContent: {
    showAboutGame: true,
    showScreenshots: true,
    showTrailerPreview: true,
    showReviews: true,
    showAchievements: true,
    showMetadata: true,
  },
  useSteamGridDb: true,
  useSteamAppDetails: true,
  useIgdb: true,
  useRawg: true,
  showTrailerPreview: true,
  autoplayTrailerPreviews: false,
  preferDirectVideo: true,
  timeFormat: "system",
  showSeconds: false,
  autostart: false,
  launchMode: "console",
  windowMode: "fullscreen",
  startMaximized: false,
  startInTray: false,
  closeToTray: false,
  showDashboard: true,
  disableUpdate: false,
  showNetworkIndicator: true,
  showControllerIndicator: true,
};

export const WIDTH_PRESETS: { label: string; value: number; description: string }[] = [
  { label: "Small",   value: 160, description: "Compact grid, more cards visible" },
  { label: "Medium",  value: 200, description: "Balanced size for browsing" },
  { label: "Large",   value: 240, description: "Bigger artwork, fewer columns" },
  { label: "XL",      value: 280, description: "Maximum card size" },
];

export const RADIUS_PRESETS: { label: string; value: number; description: string }[] = [
  { label: "None",   value: 0,   description: "Sharp square corners" },
  { label: "Small",  value: 4,   description: "Subtle rounding" },
  { label: "Medium", value: 8,   description: "Balanced roundness" },
  { label: "Large",  value: 12,  description: "Pronounced curves" },
  { label: "XL",     value: 16,  description: "Maximum rounded" },
];

export type SpotlightPresetId = "minimal" | "cinematic" | "steam-deck" | "netflix" | "playstation" | "xbox";

export const SPOTLIGHT_PRESETS: { id: SpotlightPresetId; label: string; description: string; style: SpotlightCardStyle }[] = [
  { id: "minimal",    label: "Minimal",    description: "Clean, minimal cards, no labels",       style: { cardStyle: "poster",    widthPreset: 240, cornerRadius: 4,  hideLabels: true,  showTrailerPreview: false } },
  { id: "cinematic",  label: "Cinematic",  description: "Large landscape cards with trailers",   style: { cardStyle: "landscape", widthPreset: 400, cornerRadius: 0,  hideLabels: true,  showTrailerPreview: true } },
  { id: "steam-deck", label: "Steam Deck", description: "Balanced landscape, labels on",        style: { cardStyle: "landscape", widthPreset: 320, cornerRadius: 8,  hideLabels: false, showTrailerPreview: true } },
  { id: "netflix",    label: "Netflix",    description: "Big poster cards with previews",        style: { cardStyle: "poster",    widthPreset: 280, cornerRadius: 4,  hideLabels: false, showTrailerPreview: true } },
  { id: "playstation",label: "PlayStation",description: "Poster cards, rounded, clean",          style: { cardStyle: "poster",    widthPreset: 240, cornerRadius: 12, hideLabels: false, showTrailerPreview: false } },
  { id: "xbox",       label: "Xbox",       description: "Medium landscape, sharp corners",       style: { cardStyle: "landscape", widthPreset: 300, cornerRadius: 0,  hideLabels: false, showTrailerPreview: true } },
];

export const SPOTLIGHT_CONTENT_DEFAULTS: SpotlightContentSettings = {
  showAboutGame: true,
  showScreenshots: true,
  showTrailerPreview: true,
  showReviews: true,
  showAchievements: true,
  showMetadata: true,
};

export const LAYOUT_DEFAULTS: Pick<ConsoleSettings,
  "gridColumns" | "gridGap" | "leftPadding" | "sidePanelPreset" | "sidePanelWidth"
  | "bottomBarPosition" | "horizontalScrolling" | "smoothScrolling"
> & { gridCardStyle: GridCardStyle; spotlightCardStyle: SpotlightCardStyle } = {
  gridColumns: 8,
  gridGap: 36,
  leftPadding: 64,
  sidePanelPreset: "auto",
  sidePanelWidth: resolvePanelWidth("auto"),
  bottomBarPosition: "center",
  horizontalScrolling: false,
  smoothScrolling: true,
  gridCardStyle: { ...GRID_CARD_DEFAULTS },
  spotlightCardStyle: { ...SPOTLIGHT_CARD_DEFAULTS },
};

type LegacyConsoleSettings = Partial<{
  layoutMode: string;
  theme: string;
  inputGlyphs: string;
  cardSize: number;
  gridColumns: number;
  gridGap: number;
  sidePanelWidth: number;
  enableShineAnimation: boolean;
}>;

function migrateLegacy(raw: unknown): Partial<ConsoleSettings> | null {
  if (!raw || typeof raw !== "object") return null;
  const legacy = raw as LegacyConsoleSettings;
  const hasLegacy = legacy.layoutMode || legacy.theme || legacy.inputGlyphs !== undefined;
  if (!hasLegacy) return null;

  const migrated: Partial<ConsoleSettings> = {};
  if (legacy.layoutMode === "spotlight" || legacy.layoutMode === "grid") {
    migrated.layoutMode = legacy.layoutMode;
  }
  if (legacy.theme && ["follow-app", "solaris-dark", "steam-deck", "midnight", "amoled"].includes(legacy.theme)) {
    migrated.themeMode = legacy.theme as ConsoleThemeMode;
  }
  if (legacy.inputGlyphs && ["xbox", "playstation", "keyboard"].includes(legacy.inputGlyphs)) {
    migrated.inputHints = legacy.inputGlyphs as ConsoleInputHintStyle;
  }
  if (typeof legacy.gridColumns === "number") migrated.gridColumns = legacy.gridColumns;
  if (typeof legacy.gridGap === "number") migrated.gridGap = legacy.gridGap;
  if (typeof legacy.sidePanelWidth === "number") migrated.sidePanelWidth = legacy.sidePanelWidth;
  if (typeof legacy.enableShineAnimation === "boolean") migrated.focusShine = legacy.enableShineAnimation;

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}

  return Object.keys(migrated).length > 0 ? migrated : null;
}

function loadConsoleSettings(): ConsoleSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const legacyPatch = migrateLegacy(parsed);

      // Migrate old flat card-style fields → nested objects
      if (parsed.cardSize !== undefined && !parsed.gridCardStyle) {
        const trailerShow = parsed.showTrailerPreview;
        parsed.gridCardStyle = {
          widthPreset: parsed.cardSize,
          cornerRadius: parsed.cornerRadius ?? 8,
          useLandscapeCards: parsed.useLandscapeCards ?? false,
          hideLabels: parsed.hideLabels ?? false,
        };
        parsed.spotlightCardStyle = {
          cardStyle: parsed.useLandscapeCards ? "landscape" : "poster",
          widthPreset: parsed.spotlightCardWidth ?? 320,
          cornerRadius: parsed.cornerRadius ?? 8,
          hideLabels: parsed.hideLabels ?? false,
          showTrailerPreview: trailerShow ?? true,
        };
        parsed.showTrailerPreview = trailerShow ?? true;
        // Remove old flat fields
        delete parsed.cardSize;
        delete parsed.cornerRadius;
        delete parsed.hideLabels;
        delete parsed.useLandscapeCards;
        delete parsed.spotlightCardWidth;
        // Persist migrated version
        persistConsoleSettings({ ...DEFAULT_CONSOLE_SETTINGS, ...parsed });
      }

      if (legacyPatch) {
        return { ...DEFAULT_CONSOLE_SETTINGS, ...parsed, ...legacyPatch };
      }
      return { ...DEFAULT_CONSOLE_SETTINGS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_CONSOLE_SETTINGS };
}

function persistConsoleSettings(settings: ConsoleSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function getConsoleSettings(): ConsoleSettings {
  return loadConsoleSettings();
}

export function saveConsoleSettings(settings: ConsoleSettings): void {
  persistConsoleSettings(settings);
}

export function resetConsoleSettings(): ConsoleSettings {
  const defaults = { ...DEFAULT_CONSOLE_SETTINGS };
  persistConsoleSettings(defaults);
  return defaults;
}

export function resetConsoleLayoutSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...LAYOUT_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}

export function resetAllConsoleSettings(): ConsoleSettings {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  const defaults = { ...DEFAULT_CONSOLE_SETTINGS };
  persistConsoleSettings(defaults);
  return defaults;
}

export const VISUAL_DEFAULTS: Pick<ConsoleSettings,
  "themeMode" | "backgroundTexture" | "focusShine" | "heroMotion" | "spotlightCardGap"
> & { spotlightCardStyle: SpotlightCardStyle } = {
  themeMode: "follow-app",
  backgroundTexture: "none",
  focusShine: true,
  heroMotion: true,
  spotlightCardGap: 20,
  spotlightCardStyle: { ...SPOTLIGHT_CARD_DEFAULTS },
};

export function resetConsoleVisualSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...VISUAL_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}

export const MEDIA_DEFAULTS: Pick<ConsoleSettings,
  "useSteamGridDb" | "useSteamAppDetails" | "useIgdb" | "useRawg"
  | "autoplayTrailerPreviews" | "preferDirectVideo"
> = {
  useSteamGridDb: true,
  useSteamAppDetails: true,
  useIgdb: true,
  useRawg: true,
  autoplayTrailerPreviews: false,
  preferDirectVideo: true,
};

export function resetConsoleMediaSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...MEDIA_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}

export const INPUT_DEFAULTS: Pick<ConsoleSettings,
  "inputHints" | "showButtonHints" | "showBottomHints"
> = {
  inputHints: "xbox",
  showButtonHints: true,
  showBottomHints: true,
};

export function resetConsoleInputSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...INPUT_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}

export const TIME_FORMAT_DEFAULTS: Pick<ConsoleSettings,
  "timeFormat" | "showSeconds"
> = {
  timeFormat: "system",
  showSeconds: false,
};

export function resetConsoleTimeFormatSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...TIME_FORMAT_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}

export const STARTUP_DEFAULTS: Pick<ConsoleSettings,
  "autostart" | "launchMode" | "windowMode" | "startMaximized" | "startInTray" | "closeToTray" | "showDashboard" | "disableUpdate"
> = {
  autostart: false,
  launchMode: "console",
  windowMode: "fullscreen",
  startMaximized: false,
  startInTray: false,
  closeToTray: false,
  showDashboard: true,
  disableUpdate: false,
};

export function resetConsoleStartupSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...STARTUP_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}

export const SYSTEM_BAR_DEFAULTS: Pick<ConsoleSettings,
  "showClock" | "showNetworkIndicator" | "showControllerIndicator" | "showProfileHud"
> = {
  showClock: true,
  showNetworkIndicator: true,
  showControllerIndicator: true,
  showProfileHud: true,
};

export function resetConsoleSystemBarSettings(): ConsoleSettings {
  const current = loadConsoleSettings();
  const patched = { ...current, ...SYSTEM_BAR_DEFAULTS };
  persistConsoleSettings(patched);
  return patched;
}


export function useConsoleSettings(): [ConsoleSettings, (patch: Partial<ConsoleSettings>) => void] {
  const [settings, setSettings] = useState<ConsoleSettings>(loadConsoleSettings);

  useEffect(() => {
    persistConsoleSettings(settings);
  }, [settings]);

  const patchSettings = useCallback((patch: Partial<ConsoleSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return [settings, patchSettings];
}
