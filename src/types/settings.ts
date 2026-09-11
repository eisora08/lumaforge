import {
  ApiProviderId,
  ApiProviderUserSettings,
} from "./provider";

export type AppSettings = {
  apiBaseUrl: string;
  apiKey: string;

  providers: Record<ApiProviderId, ApiProviderUserSettings>;

  steamKeysAutoFetchManifests: boolean;

  steamRoot: string;
  luaPath: string;
  depotcachePath: string;
  tempFolder: string;

  createBackups: boolean;
  detailedLogs: boolean;
  cleanTempOnExit: boolean;
  compactMode: boolean;

  steamGridDbApiKey: string;
  steamGridDbArtworkEnabled: boolean;

  rawgApiKey: string;
  igdbClientId: string;
  igdbClientSecret: string;

  debridProviders: DebridProviderConfig;
  debridEndpoint: string;

  googleSearchApiKey: string;
  googleSearchCx: string;
  bingSearchApiKey: string;
  defaultImageSearchProvider: "google" | "bing";

  steamWebApiKey: string;
  steamId64: string;
  steamAccountId: string;
  steamAchievementsEnabled: boolean;
  achievementSchemaPath: string;
  achievementToastEnabled: boolean;
  achievementNativeNotificationsEnabled: boolean;
  achievementOverlayNotificationsEnabled: boolean;
  launcherAchievementOverlayEnabled: boolean;
  gameSessionOverlayEnabled: boolean;
  gameSessionHudEnabled: boolean;
  overlayNotificationPosition: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  overlayNotificationScale: number;
  sessionOverlayNotificationPosition: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  sessionOverlayNotificationScale: number;
  achievementAutoSyncEnabled: boolean;
  achievementAutoSyncIntervalSeconds: number;
  libraryCardArtworkMode: "landscape" | "poster";
  libraryCardSize: number;
  libraryGridGap: number;
  libraryUseFullWidth: boolean;
  libraryFilterPanelWidth: number;

  dashboardCardSize: number;
  dashboardFeaturedCardSize: number;
  dashboardGridGap: number;
  dashboardContentWidth: number;
  useExpandedDashboard: boolean;

  libraryLandscapeCardSize: number;
  libraryLandscapeGap: number;
  maxLandscapeColumns: number;

  dashboardCardCornerRadius: number;
  libraryCardCornerRadius: number;
  hideDashboardCardLabels: boolean;
  hideLibraryCardLabels: boolean;
  libraryHoverMode: "preview" | "inline";

  // ── Dashboard Home Layout ──────────────────────────────────────────
  dashboardHeroEnabled: boolean;
  dashboardHeroAutoRotate: boolean;
  dashboardHeroRotateSeconds: number;
  dashboardHeroSources: string[];
  dashboardHeroMaxSources: number;
  dashboardSectionVisibility: Record<string, boolean>;
  dashboardSectionLimits: Record<string, number>;
  dashboardDeferredRendering: boolean;
  dashboardInitialVisibleSections: number;

  mediaCacheProfile: "minimal" | "playnite-balanced" | "full";

  gameScanFolders: string[];
  scanLocalGames: boolean;

  launchMode: "desktop" | "console";
  startupWindowMode: "windowed" | "maximized" | "fullscreen";
  startWithWindows: boolean;
  startMaximized: boolean;
  startInTray: boolean;
  closeToTray: boolean;
  showDashboardOnStartup: boolean;
  disableAutoUpdates: boolean;

  // ── Sound ──────────────────────────────────────────────────────────
  soundEffectsEnabled: boolean;
  soundEffectsVolume: number;
  achievementSoundsEnabled: boolean;
  achievementSoundStyle: "classic" | "playstation" | "xbox" | "retro" | "minimal" | "epic" | "steam";
  consoleAmbientEnabled: boolean;

  language: "es" | "en";
};

export type DebridProviderConfig = {
  torboxApiKey: string;
  realDebridApiKey: string;
  allDebridApiKey: string;
  premiumizeApiKey: string;
};

export const DEFAULT_DEBRID_PROVIDER_CONFIG: DebridProviderConfig = {
  torboxApiKey: "",
  realDebridApiKey: "",
  allDebridApiKey: "",
  premiumizeApiKey: "",
};

export type AppSettingsKey = keyof AppSettings;