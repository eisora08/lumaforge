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
      "Proveedor basado en Hubcap/Morrenus para manifests y paquetes ZIP.",
    baseUrl: "https://hubcapmanifest.com",
    urlTemplate:
      "https://hubcapmanifest.com/api/v1/manifest/<appid>?api_key=<apikey>",
    enabledByDefault: true,
    requiresApiKey: true,
    apiKeyPlaceholder: "<apikey>",
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
    description:
      "Proveedor alternativo para paquetes LUA/ZIP usando AppID.",
    baseUrl: "https://generator.ryuu.lol",
    urlTemplate: "https://generator.ryuu.lol/<appid>",
    enabledByDefault: true,
    requiresApiKey: false,
    successCode: 200,
    unavailableCode: 404,
    capabilities: [
      "search",
      "availability-check",
      "download-zip",
      "download-lua",
      "metadata",
    ],
    supportedFileTypes: ["zip", "lua"],
  },
  {
    id: "twentytwo-cloud",
    name: "TwentyTwo Cloud",
    description:
      "Proveedor alternativo compatible con descargas por AppID.",
    baseUrl: "https://api.twentytwocloud.com",
    urlTemplate: "https://api.twentytwocloud.com/download?appid=<appid>",
    enabledByDefault: true,
    requiresApiKey: false,
    successCode: 200,
    unavailableCode: 404,
    capabilities: [
      "availability-check",
      "download-zip",
      "metadata",
    ],
    supportedFileTypes: ["zip"],
  },
  {
    id: "sushi",
    name: "Sushi",
    description:
      "Repositorio estático basado en archivos ZIP por AppID.",
    baseUrl:
      "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt",
    urlTemplate:
      "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt/refs/heads/main/<appid>.zip",
    enabledByDefault: true,
    requiresApiKey: false,
    successCode: 200,
    unavailableCode: 404,
    capabilities: [
      "availability-check",
      "download-zip",
    ],
    supportedFileTypes: ["zip"],
  },
  {
    id: "custom",
    name: "Custom API",
    description:
      "Proveedor personalizado configurado por el usuario.",
    baseUrl: "",
    urlTemplate: "",
    enabledByDefault: false,
    requiresApiKey: false,
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