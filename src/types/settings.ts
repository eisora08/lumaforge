import {
  ApiProviderId,
  ApiProviderUserSettings,
} from "./provider";

export type AppSettings = {
  apiBaseUrl: string;
  apiKey: string;

  providers: Record<ApiProviderId, ApiProviderUserSettings>;

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
  gameSessionOverlayEnabled: boolean;
  overlayNotificationPosition: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
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

  cardCornerRadius: number;
  hideCardLabels: boolean;

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
};

export type AppSettingsKey = keyof AppSettings;