import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import { AppSettings, AppSettingsKey } from "../types/settings";

type SettingsContextValue = {
  settings: AppSettings;
  updateSetting: <K extends AppSettingsKey>(
    key: K,
    value: AppSettings[K]
  ) => void;
  resetSettings: () => void;
};

const STORAGE_KEY = "lumaforge-settings";

const defaultSettings: AppSettings = {
  apiBaseUrl: "",
  apiKey: "",

  steamRoot: "",
  luaPath: "",
  depotcachePath: "",
  tempFolder: "",

  createBackups: true,
  detailedLogs: true,
  cleanTempOnExit: false,
  compactMode: false,
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

export function SettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  function persistSettings(nextSettings: AppSettings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
  }

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

  function resetSettings() {
    setSettings(defaultSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultSettings));
  }

  const value = useMemo(
    () => ({
      settings,
      updateSetting,
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