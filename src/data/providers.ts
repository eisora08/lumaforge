import {
  ApiProviderDefinition,
  ApiProviderId,
  ApiProviderUserSettings,
} from "../types/provider";

export const defaultApiProviders: ApiProviderDefinition[] = [
  {
    id: "hubcapdb",
    name: "HubcapDB",
    description:
      "Proveedor basado en HubcapDB para manifests, Lua files y generación de paquetes.",
    baseUrl: "https://hubcapmanifest.com",

    availabilityUrlTemplate:
      "https://hubcapmanifest.com/api/v1/status/<appid>",

    downloadUrlTemplate:
      "https://hubcapmanifest.com/api/v1/manifest/<appid>",

    enabledByDefault: true,
    requiresApiKey: true,

    authType: "header",
    authHeaderName: "Authorization",

    successCode: 200,
    unavailableCode: 404,

    capabilities: [
      "search",
      "availability-check",
      "download-zip",
      "download-manifest",
      "metadata",
    ],

    supportedFileTypes: ["zip", "manifest"],
    apiKeyUrl: "https://hubcapmanifest.com/api-keys/stats",
  },
  {
    id: "ryuu",
    name: "Ryuu",
    description: "Proveedor alternativo para paquetes LUA, manifests y ZIP.",
    baseUrl: "https://generator.ryuu.lol",

    availabilityUrlTemplate:
      "https://generator.ryuu.lol/api/download/<appid>",

    downloadUrlTemplate:
      "https://generator.ryuu.lol/api/download/<appid>",

    enabledByDefault: true,
    requiresApiKey: true,

    authType: "header",
    authHeaderName: "X-Auth-Key",

    successCode: 200,
    unavailableCode: 404,

    capabilities: [
      "availability-check",
      "download-zip",
      "download-lua",
      "download-manifest",
      "metadata",
    ],

    supportedFileTypes: ["zip", "lua", "manifest"],
    apiKeyUrl: "https://generator.ryuu.lol/api",
  },
  {
    id: "custom",
    name: "Custom API",
    description: "Proveedor personalizado configurado por el usuario.",
    baseUrl: "",

    availabilityUrlTemplate: "",
    downloadUrlTemplate: "",

    enabledByDefault: false,
    requiresApiKey: false,

    authType: "none",

    successCode: 200,
    unavailableCode: 404,

    capabilities: [
      "search",
      "availability-check",
      "download-zip",
      "download-lua",
      "download-manifest",
      "metadata",
    ],

    supportedFileTypes: ["zip", "lua", "manifest"],
  },
  {
    id: "steamkeys",
    name: "Steam Keys",
    description:
      "Proveedor nativo para DLC Query, Pin Version y Fetch Manifest desde GitHub.",
    baseUrl: "https://github.com/P-ToyStore/SteamManifestCache_Pro",

    downloadUrlTemplate: "",

    enabledByDefault: true,
    requiresApiKey: false,

    authType: "none",

    successCode: 200,
    unavailableCode: 404,

    capabilities: [
      "availability-check",
      "download-lua",
      "download-manifest",
    ],

    supportedFileTypes: ["lua", "manifest"],
  },
];

export const defaultProviderSettings: Record<
  ApiProviderId,
  ApiProviderUserSettings
> = {
  hubcapdb: {
    enabled: true,
    baseUrl: "https://hubcapmanifest.com",
    apiKey: "",
  },
  ryuu: {
    enabled: true,
    baseUrl: "https://generator.ryuu.lol",
    apiKey: "",
  },
  custom: {
    enabled: false,
    baseUrl: "",
    apiKey: "",
  },
  repack: {
    enabled: false,
    baseUrl: "",
    apiKey: "",
  },
  steamkeys: {
    enabled: true,
    baseUrl: "https://github.com/P-ToyStore/SteamManifestCache_Pro",
    apiKey: "",
  },
};