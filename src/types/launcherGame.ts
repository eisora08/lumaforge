export type LauncherGame = {
  id: string;
  appId?: string;
  title: string;
  source: "steam" | "local";
  executablePath?: string;
  installDir?: string;
  libraryPath?: string;
  imageUrl?: string;
  isInstalled: boolean;
  isPlayable: boolean;
  sizeOnDisk?: number;
  lastUpdated?: number;
};

