export type ApiProviderId =
  | "hubcapdb"
  | "ryuu"
  | "twentytwo-cloud"
  | "sushi"
  | "custom";

export type ProviderCapability =
  | "search"
  | "availability-check"
  | "download-zip"
  | "download-lua"
  | "download-manifest"
  | "metadata";

export type PackageFileType =
  | "zip"
  | "lua"
  | "manifest";

export type ApiProviderDefinition = {
  id: ApiProviderId;
  name: string;
  description: string;
  baseUrl: string;
  urlTemplate: string;
  enabledByDefault: boolean;
  requiresApiKey: boolean;
  apiKeyPlaceholder?: string;
  successCode: number;
  unavailableCode: number;
  capabilities: ProviderCapability[];
  supportedFileTypes: PackageFileType[];
};

export type ApiProviderUserSettings = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
};

export type ApiProviderRuntimeStatus =
  | "unknown"
  | "online"
  | "offline"
  | "limited"
  | "error";