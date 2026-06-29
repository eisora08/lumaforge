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

  steamWebApiKey: string;
  steamId64: string;
  steamAccountId: string;
  steamAchievementsEnabled: boolean;
  achievementSchemaPath: string;

  libraryCardArtworkMode: "landscape" | "poster";
  mediaCacheProfile: "minimal" | "playnite-balanced" | "full";

  gameScanFolders: string[];
  scanLocalGames: boolean;
};

export type AppSettingsKey = keyof AppSettings;