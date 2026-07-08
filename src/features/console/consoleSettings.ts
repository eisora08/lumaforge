import { useState, useCallback, useEffect } from "react";

export type ConsoleLayoutMode = "spotlight" | "grid";

export type ConsoleThemeMode = "follow-app" | "solaris-dark" | "steam-deck" | "midnight" | "amoled";

export type ConsoleBackgroundTexture = "none" | "grain-soft" | "vignette" | "blur";

export type ConsoleInputHintStyle = "xbox" | "playstation" | "keyboard" | "auto";

export type ConsoleBottomBarPosition = "center" | "left" | "right";

export type ConsoleStartCategory = "continue" | "installed" | "lua" | "favorites" | "all";

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
  cardSize: number;
  gridColumns: number;
  gridGap: number;
  leftPadding: number;
  sidePanelWidth: number;
  bottomBarPosition: ConsoleBottomBarPosition;
  horizontalScrolling: boolean;
  smoothScrolling: boolean;
  focusShine: boolean;
};

const STORAGE_KEY = "lumaforge-console-settings-v1";
const LEGACY_STORAGE_KEY = "lumaforge-console-settings-v1";

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
  cardSize: 220,
  gridColumns: 8,
  gridGap: 36,
  leftPadding: 64,
  sidePanelWidth: 720,
  bottomBarPosition: "center",
  horizontalScrolling: false,
  smoothScrolling: true,
  focusShine: true,
};

export const LAYOUT_DEFAULTS: Pick<ConsoleSettings,
  "cardSize" | "gridColumns" | "gridGap" | "leftPadding" | "sidePanelWidth"
  | "bottomBarPosition" | "horizontalScrolling" | "smoothScrolling"
> = {
  cardSize: 220,
  gridColumns: 8,
  gridGap: 36,
  leftPadding: 64,
  sidePanelWidth: 720,
  bottomBarPosition: "center",
  horizontalScrolling: false,
  smoothScrolling: true,
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
  if (typeof legacy.cardSize === "number") migrated.cardSize = legacy.cardSize;
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
