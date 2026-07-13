import type { LibraryGameSource } from "./libraryGame";

export type MediaRole = "cover" | "landscape" | "background" | "logo" | "icon";

export type MetadataSourceId = "steam" | "igdb" | "rawg";

export type GameProviderCapabilities = {
  canUseSteamAppInfo: boolean;
  canUseSteamCloud: boolean;
  canUseSteamAchievements: boolean;
  canUseSteamUpdates: boolean;
  canUseSteamInstall: boolean;
  canUseSteamOwned: boolean;
  canLaunchExecutable: boolean;
  canEditLaunchPaths: boolean;
  canEditMetadata: boolean;
  canEditMedia: boolean;
  canUseMetadataProviders: boolean;
  canUseSourceProviders: boolean;
  canRemoveFromLibrary: boolean;
  canShowInStore: boolean;
  canCheckForUpdates: boolean;
};

export const PROVIDER_CAPABILITIES: Record<LibraryGameSource, GameProviderCapabilities> = {
  steam: {
    canUseSteamAppInfo: true,
    canUseSteamCloud: true,
    canUseSteamAchievements: true,
    canUseSteamUpdates: true,
    canUseSteamInstall: true,
    canUseSteamOwned: true,
    canLaunchExecutable: true,
    canEditLaunchPaths: false,
    canEditMetadata: true,
    canEditMedia: true,
    canUseMetadataProviders: true,
    canUseSourceProviders: true,
    canRemoveFromLibrary: true,
    canShowInStore: true,
    canCheckForUpdates: true,
  },
  manual: {
    canUseSteamAppInfo: false,
    canUseSteamCloud: false,
    canUseSteamAchievements: false,
    canUseSteamUpdates: false,
    canUseSteamInstall: false,
    canUseSteamOwned: false,
    canLaunchExecutable: true,
    canEditLaunchPaths: true,
    canEditMetadata: true,
    canEditMedia: true,
    canUseMetadataProviders: true,
    canUseSourceProviders: false,
    canRemoveFromLibrary: true,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
  local: {
    canUseSteamAppInfo: false,
    canUseSteamCloud: false,
    canUseSteamAchievements: false,
    canUseSteamUpdates: false,
    canUseSteamInstall: false,
    canUseSteamOwned: false,
    canLaunchExecutable: true,
    canEditLaunchPaths: true,
    canEditMetadata: false,
    canEditMedia: true,
    canUseMetadataProviders: false,
    canUseSourceProviders: false,
    canRemoveFromLibrary: true,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
  lua: {
    canUseSteamAppInfo: false,
    canUseSteamCloud: false,
    canUseSteamAchievements: false,
    canUseSteamUpdates: false,
    canUseSteamInstall: false,
    canUseSteamOwned: false,
    canLaunchExecutable: false,
    canEditLaunchPaths: false,
    canEditMetadata: false,
    canEditMedia: true,
    canUseMetadataProviders: false,
    canUseSourceProviders: false,
    canRemoveFromLibrary: false,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
};

export function getCapabilities(source: LibraryGameSource): GameProviderCapabilities {
  return PROVIDER_CAPABILITIES[source] ?? PROVIDER_CAPABILITIES.steam;
}
