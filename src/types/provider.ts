export type ApiProviderId =
  | "hubcapdb"
  | "ryuu"
  | "custom"
  | "repack";

export type ProviderCapability =
  | "search"
  | "availability-check"
  | "download-zip"
  | "download-lua"
  | "download-manifest"
  | "metadata";

export type PackageFileType = "zip" | "lua" | "manifest";

export type ProviderAuthType = "none" | "query" | "header";

export type ApiProviderDefinition = {
  id: ApiProviderId;
  name: string;
  description: string;
  baseUrl: string;

  availabilityUrlTemplate?: string;
  downloadUrlTemplate: string;

  enabledByDefault: boolean;
  requiresApiKey: boolean;

  authType: ProviderAuthType;
  authHeaderName?: string;
  authQueryParam?: string;
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