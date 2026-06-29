import type { SteamAppMetadata } from "./gameMetadata";
import type { InstalledLuaScript } from "./installedLua";
import type { PackageSource } from "./package";

export type LibraryGameSource = "steam" | "local" | "lua";

export type LibraryGame = {
  id: string;
  appId?: string;
  customTitle?: string;
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
  /** Steam localconfig last_played (from localconfig.vdf) */
  steamLastPlayedAt?: number;
  /** Steam localconfig Playtime (from localconfig.vdf) */
  steamPlaytimeMinutes?: number;
  /** Steam localconfig Playtime2wks */
  steamPlaytime2Weeks?: number;
  /** Steam localconfig cloud.last_sync_state */
  steamCloudStatus?: string;
  /** LumaForge local launch tracking timestamp */
  localLastPlayedAt?: number;
  /** LumaForge local playtimeMinutes */
  localPlaytimeMinutes?: number;
  /** Real achievement count unlocked (only if parsed) */
  achievementUnlocked?: number;
  /** Real achievement total (only if parsed) */
  achievementTotal?: number;
  /** Whether metadata says Steam Achievements is supported */
  achievementsSupported?: boolean;
};

export type LibraryFilter = "all" | "steam" | "local" | "lua" | "installed" | "uninstalled" | "lua-ready" | "disabled" | "updates";
export type LibrarySort = "name" | "appid" | "modified" | "size" | "recent";
