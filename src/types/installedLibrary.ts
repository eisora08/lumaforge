import type { SteamAppMetadata } from "./gameMetadata";
import type { SteamReviewSummary } from "./gameReview";
import type { InstalledLuaScript } from "./installedLua";
import type { PackageSource } from "./package";
import type { LuaUpdateInfo } from "./luaUpdate";

export type InstalledLibraryGame = {
  appId: string;
  title: string;
  developer?: string;
  imageUrl?: string;
  metadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  steamInstalled?: boolean;
  installStatus: "active" | "disabled" | "missing" | "not-installed";
  luaScripts: InstalledLuaScript[];
  sources: PackageSource[];
  selectedSource?: PackageSource;
  hasLuaInstalled: boolean;
  hasAvailableSource: boolean;
  hasUpdate?: boolean;
  syncStatus?: "idle" | "checking" | "up-to-date" | "update-available" | "syncing" | "failed";
  updateInfo?: LuaUpdateInfo;
};

export type LibraryFilter = "all" | "active" | "disabled" | "lua-ready" | "updates";
export type LibrarySort = "name" | "appid" | "modified" | "size";
