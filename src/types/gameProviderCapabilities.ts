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

/**
 * Conservative capability profile for unknown/unsupported providers.
 * Never defaults to Steam capabilities — unknown sources get no Steam features.
 */
const UNKNOWN_CAPABILITIES: GameProviderCapabilities = {
  canUseSteamAppInfo: false,
  canUseSteamCloud: false,
  canUseSteamAchievements: false,
  canUseSteamUpdates: false,
  canUseSteamInstall: false,
  canUseSteamOwned: false,
  canLaunchExecutable: false,
  canEditLaunchPaths: false,
  canEditMetadata: false,
  canEditMedia: false,
  canUseMetadataProviders: false,
  canUseSourceProviders: false,
  canRemoveFromLibrary: false,
  canShowInStore: false,
  canCheckForUpdates: false,
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
  epic: {
    canUseSteamAppInfo: false,
    canUseSteamCloud: false,
    canUseSteamAchievements: false,
    canUseSteamUpdates: false,
    canUseSteamInstall: false,
    canUseSteamOwned: false,
    canLaunchExecutable: false,
    canEditLaunchPaths: false,
    canEditMetadata: true,
    canEditMedia: true,
    canUseMetadataProviders: true,
    canUseSourceProviders: false,
    canRemoveFromLibrary: true,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
  gog: {
    canUseSteamAppInfo: false,
    canUseSteamCloud: false,
    canUseSteamAchievements: false,
    canUseSteamUpdates: false,
    canUseSteamInstall: false,
    canUseSteamOwned: false,
    canLaunchExecutable: false,
    canEditLaunchPaths: false,
    canEditMetadata: true,
    canEditMedia: true,
    canUseMetadataProviders: true,
    canUseSourceProviders: false,
    canRemoveFromLibrary: true,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
  debrid: {
    canUseSteamAppInfo: false,
    canUseSteamCloud: false,
    canUseSteamAchievements: false,
    canUseSteamUpdates: false,
    canUseSteamInstall: false,
    canUseSteamOwned: false,
    canLaunchExecutable: true,
    canEditLaunchPaths: false,
    canEditMetadata: true,
    canEditMedia: true,
    canUseMetadataProviders: true,
    canUseSourceProviders: false,
    canRemoveFromLibrary: true,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
  emulator: {
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
    canUseMetadataProviders: false,
    canUseSourceProviders: false,
    canRemoveFromLibrary: true,
    canShowInStore: false,
    canCheckForUpdates: false,
  },
};

/**
 * Return capabilities for a given game source.
 * Unknown sources receive a conservative all-false profile, NOT Steam capabilities.
 */
export function getCapabilities(source: LibraryGameSource): GameProviderCapabilities {
  return PROVIDER_CAPABILITIES[source] ?? UNKNOWN_CAPABILITIES;
}
