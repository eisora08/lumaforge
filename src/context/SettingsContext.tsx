import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import { AppSettings, AppSettingsKey } from "../types/settings";
import { defaultProviderSettings } from "../data/providers";

type SettingsContextValue = {
  settings: AppSettings;
  updateSetting: <K extends AppSettingsKey>(
    key: K,
    value: AppSettings[K]
  ) => void;
  replaceSettings: (settings: AppSettings) => void;
  resetSettings: () => void;
};

const STORAGE_KEY = "lumaforge-settings";

export const defaultSettings: AppSettings = {
  apiBaseUrl: "",
  apiKey: "",

  providers: defaultProviderSettings,

  steamRoot: "",
  luaPath: "",
  depotcachePath: "",
  tempFolder: "",

  createBackups: true,
  detailedLogs: true,
  cleanTempOnExit: false,
  compactMode: false,
  steamGridDbApiKey: "",
  steamGridDbArtworkEnabled: false,
  steamWebApiKey: "",
  steamId64: "",
  steamAccountId: "",
  steamAchievementsEnabled: false,
  achievementSchemaPath: "",
  libraryCardArtworkMode: "landscape",
  mediaCacheProfile: "playnite-balanced",
  gameScanFolders: [],
  scanLocalGames: false,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function loadSettings(): AppSettings {
  try {
    const savedSettings = localStorage.getItem(STORAGE_KEY);

    if (!savedSettings) {
      return defaultSettings;
    }

    return {
      ...defaultSettings,
      ...JSON.parse(savedSettings),
    };
  } catch {
    return defaultSettings;
  }
}

function persistSettings(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function SettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  function updateSetting<K extends AppSettingsKey>(
    key: K,
    value: AppSettings[K]
  ) {
    setSettings((currentSettings) => {
      const nextSettings = {
        ...currentSettings,
        [key]: value,
      };

      persistSettings(nextSettings);

      return nextSettings;
    });
  }

  function replaceSettings(nextSettings: AppSettings) {
    const mergedSettings = {
      ...defaultSettings,
      ...nextSettings,
    };

    setSettings(mergedSettings);
    persistSettings(mergedSettings);
  }

  function resetSettings() {
    setSettings(defaultSettings);
    persistSettings(defaultSettings);
  }

  const value = useMemo(
    () => ({
      settings,
      updateSetting,
      replaceSettings,
      resetSettings,
    }),
    [settings]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);

  if (!context) {
    throw new Error("useSettings debe usarse dentro de SettingsProvider");
  }

  return context;
}