import { useState, useCallback, useEffect } from "react";

export type ConsoleLayoutMode = "spotlight" | "grid";

export type ConsoleThemeMode = "follow-app" | "solaris-dark" | "steam-deck" | "midnight" | "amoled";

export type ConsoleInputGlyphStyle = "xbox" | "playstation" | "keyboard";

export type ConsoleSettings = {
  layoutMode: ConsoleLayoutMode;
  theme: ConsoleThemeMode;
  inputGlyphs: ConsoleInputGlyphStyle;
  cardSize: number;
  gridColumns: number;
  gridGap: number;
  sidePanelWidth: number;
  enableShineAnimation: boolean;
};

const STORAGE_KEY = "lumaforge-console-settings-v1";

export const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  layoutMode: "spotlight",
  theme: "follow-app",
  inputGlyphs: "xbox",
  cardSize: 210,
  gridColumns: 8,
  gridGap: 36,
  sidePanelWidth: 680,
  enableShineAnimation: true,
};

function loadConsoleSettings(): ConsoleSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONSOLE_SETTINGS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_CONSOLE_SETTINGS };
}

function saveConsoleSettings(settings: ConsoleSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function getConsoleSettings(): ConsoleSettings {
  return loadConsoleSettings();
}

export function resetConsoleSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function useConsoleSettings(): [ConsoleSettings, (patch: Partial<ConsoleSettings>) => void] {
  const [settings, setSettings] = useState<ConsoleSettings>(loadConsoleSettings);

  useEffect(() => {
    saveConsoleSettings(settings);
  }, [settings]);

  const patchSettings = useCallback((patch: Partial<ConsoleSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return [settings, patchSettings];
}
