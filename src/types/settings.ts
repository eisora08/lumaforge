export type AppSettings = {
  apiBaseUrl: string;
  apiKey: string;

  steamRoot: string;
  luaPath: string;
  depotcachePath: string;
  tempFolder: string;

  createBackups: boolean;
  detailedLogs: boolean;
  cleanTempOnExit: boolean;
  compactMode: boolean;
};

export type AppSettingsKey = keyof AppSettings;