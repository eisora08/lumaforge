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
  },
  {
    id: "twentytwo-cloud",
    name: "TwentyTwo Cloud",
    description: "Proveedor alternativo compatible con descargas por AppID.",
    baseUrl: "https://api.twentytwocloud.com",

    availabilityUrlTemplate:
      "https://api.twentytwocloud.com/download?appid=<appid>",

    downloadUrlTemplate:
      "https://api.twentytwocloud.com/download?appid=<appid>",

    enabledByDefault: true,
    requiresApiKey: false,

    authType: "none",

    successCode: 200,
    unavailableCode: 404,

    capabilities: ["availability-check", "download-zip", "metadata"],

    supportedFileTypes: ["zip"],
  },
  {
    id: "sushi",
    name: "Sushi",
    description: "Repositorio estático basado en archivos ZIP por AppID.",
    baseUrl:
      "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt",

    availabilityUrlTemplate:
      "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt/refs/heads/main/<appid>.zip",

    downloadUrlTemplate:
      "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt/refs/heads/main/<appid>.zip",

    enabledByDefault: true,
    requiresApiKey: false,

    authType: "none",

    successCode: 200,
    unavailableCode: 404,

    capabilities: ["availability-check", "download-zip"],

    supportedFileTypes: ["zip"],
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
  "twentytwo-cloud": {
    enabled: true,
    baseUrl: "https://api.twentytwocloud.com",
    apiKey: "",
  },
  sushi: {
    enabled: true,
    baseUrl:
      "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt",
    apiKey: "",
  },
  custom: {
    enabled: false,
    baseUrl: "",
    apiKey: "",
  },
};