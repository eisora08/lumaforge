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

  libraryCardArtworkMode: "landscape" | "poster";

  gameScanFolders: string[];
  scanLocalGames: boolean;
};

export type AppSettingsKey = keyof AppSettings;