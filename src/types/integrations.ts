/**
 * Provider Integration Settings — versioned, provider-neutral model.
 *
 * Each integration (Steam, Epic, Manual, Lua) has identical shape.
 * Surfaces control where the provider's games appear in the UI.
 * Settings control scan behavior and subscriptions.
 */

export type IntegrationId = "steam" | "epic" | "manual" | "lua" | "debrid";

export type IntegrationSurface =
  | "library"
  | "sidebar"
  | "home"
  | "console"
  | "store"
  | "search";

export type IntegrationSettings = {
  id: IntegrationId;
  enabled: boolean;
  scanOnStartup: boolean;
  backgroundScan: boolean;
  surfaces: Record<IntegrationSurface, boolean>;
  updatedAt: number;
};

export type IntegrationSettingsState = {
  version: number;
  integrations: Record<IntegrationId, IntegrationSettings>;
};

export const INTEGRATION_SCHEMA_VERSION = 1;

export const ALL_INTEGRATION_IDS: IntegrationId[] = ["steam", "epic", "manual", "lua", "debrid"];
export const ALL_SURFACES: IntegrationSurface[] = ["library", "sidebar", "home", "console", "store", "search"];

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettingsState = {
  version: INTEGRATION_SCHEMA_VERSION,
  integrations: {
    steam: {
      id: "steam",
      enabled: true,
      scanOnStartup: true,
      backgroundScan: true,
      surfaces: {
        library: true,
        sidebar: true,
        home: true,
        console: true,
        store: true,
        search: true,
      },
      updatedAt: Date.now(),
    },
    epic: {
      id: "epic",
      enabled: true,
      scanOnStartup: true,
      backgroundScan: true,
      surfaces: {
        library: true,
        sidebar: true,
        home: true,
        console: true,
        store: false,
        search: true,
      },
      updatedAt: Date.now(),
    },
    manual: {
      id: "manual",
      enabled: true,
      scanOnStartup: true,
      backgroundScan: false,
      surfaces: {
        library: true,
        sidebar: true,
        home: true,
        console: true,
        store: false,
        search: true,
      },
      updatedAt: Date.now(),
    },
    lua: {
      id: "lua",
      enabled: true,
      scanOnStartup: true,
      backgroundScan: true,
      surfaces: {
        library: true,
        sidebar: true,
        home: true,
        console: true,
        store: true,
        search: true,
      },
      updatedAt: Date.now(),
    },
    debrid: {
      id: "debrid",
      enabled: true,
      scanOnStartup: true,
      backgroundScan: false,
      surfaces: {
        library: true,
        sidebar: true,
        home: true,
        console: true,
        store: false,
        search: true,
      },
      updatedAt: Date.now(),
    },
  },
};

export const INTEGRATION_DISPLAY_NAMES: Record<IntegrationId, string> = {
  steam: "Steam",
  epic: "Epic Games",
  manual: "Manual Games",
  lua: "Lua Packages",
  debrid: "Debrid Repacks",
};

export const INTEGRATION_DISPLAY_DESCRIPTIONS: Record<IntegrationId, string> = {
  steam: "Steam library detection, achievements, and launch",
  epic: "Epic Games local library import and launch",
  manual: "Manually added non-Steam games",
  lua: "Lua packages and scripts from the Steam Workshop ecosystem",
  debrid: "Debrid/Hydra streaming games from the repack catalog",
};
