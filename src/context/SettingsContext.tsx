import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AppSettings, AppSettingsKey, DEFAULT_DEBRID_PROVIDER_CONFIG } from "../types/settings";
import { defaultProviderSettings } from "../data/providers";
import { saveStartupConfig, setAutostart } from "../services/tauri";

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
  rawgApiKey: "",
  igdbClientId: "",
  igdbClientSecret: "",
  debridProviders: { ...DEFAULT_DEBRID_PROVIDER_CONFIG },
  debridEndpoint: "https://hydra.luffy.pp.ua",
  googleSearchApiKey: "",
  googleSearchCx: "",
  bingSearchApiKey: "",
  defaultImageSearchProvider: "google",
  steamWebApiKey: "",
  steamId64: "",
  steamAccountId: "",
  steamAchievementsEnabled: false,
  achievementSchemaPath: "",
  achievementToastEnabled: true,
  achievementNativeNotificationsEnabled: false,
  achievementOverlayNotificationsEnabled: true,
  launcherAchievementOverlayEnabled: true,
  gameSessionOverlayEnabled: true,
  gameSessionHudEnabled: true,
  overlayNotificationPosition: "top-center",
  achievementAutoSyncEnabled: true,
  achievementAutoSyncIntervalSeconds: 10,
  libraryCardArtworkMode: "poster",
  libraryCardSize: 200,
  libraryGridGap: 28,
  libraryUseFullWidth: true,
  libraryFilterPanelWidth: 280,

  dashboardCardSize: 260,
  dashboardFeaturedCardSize: 340,
  dashboardGridGap: 16,
  dashboardContentWidth: 1760,
  useExpandedDashboard: true,

  libraryLandscapeCardSize: 200,
  libraryLandscapeGap: 28,
  maxLandscapeColumns: 0,

  dashboardCardCornerRadius: 12,
  libraryCardCornerRadius: 12,
  hideDashboardCardLabels: false,
  hideLibraryCardLabels: true,

  // ── Dashboard Home Layout ──────────────────────────────────────────
  dashboardHeroEnabled: true,
  dashboardHeroAutoRotate: false,
  dashboardHeroRotateSeconds: 15,
  dashboardHeroSources: ["continuePlaying", "favorites"],
  dashboardHeroMaxSources: 2,
  dashboardSectionVisibility: {},
  dashboardSectionLimits: {},
  dashboardDeferredRendering: true,
  dashboardInitialVisibleSections: 3,

  mediaCacheProfile: "playnite-balanced",
  gameScanFolders: [],
  scanLocalGames: false,

  launchMode: "desktop",
  startupWindowMode: "windowed",
  startWithWindows: false,
  startMaximized: false,
  startInTray: false,
  closeToTray: false,
  showDashboardOnStartup: true,
  disableAutoUpdates: false,

  language: "es",
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function loadSettings(): AppSettings {
  try {
    const savedSettings = localStorage.getItem(STORAGE_KEY);

    if (!savedSettings) {
      return defaultSettings;
    }

    const saved = JSON.parse(savedSettings) as Record<string, unknown>;

    // Migrate single toggle to split toggles
    if ("hideCardLabels" in saved && !("hideDashboardCardLabels" in saved)) {
      (saved as any).hideDashboardCardLabels = saved.hideCardLabels;
      (saved as any).hideLibraryCardLabels = saved.hideCardLabels;
      delete (saved as any).hideCardLabels;
    }

    // Migrate single cardCornerRadius to split corner radius
    if ("cardCornerRadius" in saved && !("dashboardCardCornerRadius" in saved)) {
      (saved as any).dashboardCardCornerRadius = saved.cardCornerRadius;
      (saved as any).libraryCardCornerRadius = saved.cardCornerRadius;
      delete (saved as any).cardCornerRadius;
    }

    return {
      ...defaultSettings,
      ...saved,
    } as AppSettings;
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

  // Sync compactMode to <html> data attribute for CSS control
  useEffect(() => {
    document.documentElement.dataset.compact = settings.compactMode ? "true" : "false";
  }, [settings.compactMode]);

  // Sync card layout settings to CSS custom properties
  useEffect(() => {
    document.documentElement.style.setProperty("--dashboard-card-radius", `${settings.dashboardCardCornerRadius}px`);
    document.documentElement.style.setProperty("--library-card-radius", `${settings.libraryCardCornerRadius}px`);
  }, [settings.dashboardCardCornerRadius, settings.libraryCardCornerRadius]);

  useEffect(() => {
    document.documentElement.dataset.dashboardCardLabel =
      settings.hideDashboardCardLabels ? "hidden" : "visible";
    document.documentElement.dataset.libraryCardLabel =
      settings.hideLibraryCardLabels ? "hidden" : "visible";
  }, [settings.hideDashboardCardLabels, settings.hideLibraryCardLabels]);

  // ── Listen for restore-triggered refresh events ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key === STORAGE_KEY) {
        setSettings(loadSettings());
      }
    };
    window.addEventListener("lumaforge-data-changed", handler);
    return () => window.removeEventListener("lumaforge-data-changed", handler);
  }, []);

  // ── Sync startup settings to Rust (startup-config.json + autostart registry) ──
  useEffect(() => {
    saveStartupConfig({
      startWithWindows: settings.startWithWindows,
      startMaximized: settings.startMaximized,
      startInTray: settings.startInTray,
      closeToTray: settings.closeToTray,
      launchMode: settings.launchMode,
      startupWindowMode: settings.startupWindowMode,
    }).catch((err) => console.warn("[Settings] Failed to save startup config:", err));

    setAutostart(settings.startWithWindows).catch((err) =>
      console.warn("[Settings] Failed to toggle autostart:", err)
    );
  }, [settings.startWithWindows, settings.startMaximized, settings.startInTray, settings.closeToTray, settings.launchMode, settings.startupWindowMode]);

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