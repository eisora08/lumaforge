export type SteamInstalledGame = {
  appId: number;
  name: string;
  installDir: string | null;
  libraryPath: string;
  steamRoot: string | null;
  steamappsPath: string;
  manifestPath: string;
  installPath: string | null;
  stateFlags: number | null;
  sizeOnDisk: number | null;
  buildId: string | null;
  lastUpdated: number | null;
  isInstalled: boolean;
};
