import type { SteamAppMetadata } from "./gameMetadata";
import type { InstalledLuaScript } from "./installedLua";
import type { PackageSource } from "./package";

export type LibraryGameSource = "steam" | "local" | "lua";

export type LibraryGame = {
  id: string;
  appId?: string;
  title: string;
  source: LibraryGameSource;
  executablePath?: string;
  installDir?: string;
  libraryPath?: string;
  imageUrl?: string;
  metadata?: SteamAppMetadata;
  isPlayable: boolean;
  isInstallable: boolean;
  steamInstalled: boolean;
  sizeOnDisk?: number;
  lastUpdated?: number;
  luaScripts: InstalledLuaScript[];
  hasLua: boolean;
  isLuaActive: boolean;
  isLuaDisabled: boolean;
  hasLuaSource: boolean;
  sources: PackageSource[];
  hasUpdate?: boolean;
};

export type LibraryFilter = "all" | "steam" | "local" | "lua" | "installed" | "uninstalled" | "lua-ready" | "disabled" | "updates";
export type LibrarySort = "name" | "appid" | "modified" | "size" | "recent";
