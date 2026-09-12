// ---------------------------------------------------------------------------
// Cloud Redirect types
// ---------------------------------------------------------------------------

export interface CloudStatusResult {
  success: boolean;
  configured: boolean;
  provider: string | null;
  dll_installed: boolean;
  message: string;
}

export interface CloudProviderInfo {
  id: string;
  name: string;
  configured: boolean;
}

export interface CloudConnectRequest {
  provider: string;
}

export interface CloudConnectLocalRequest {
  path: string;
}

export interface CloudAddAppRequest {
  app_id: number;
}

export interface CloudRemoveAppRequest {
  app_id: number;
}

export interface CloudR2Config {
  account_id: string;
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  key_prefix?: string;
  endpoint?: string;
}

export interface CloudS3Config {
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  endpoint: string;
  region: string;
  key_prefix?: string;
  sign_payload?: boolean;
  allow_insecure_http?: boolean;
  allow_insecure_tls?: boolean;
  ca_cert_path?: string;
}

export type CloudProviderId = "gdrive" | "onedrive" | "s3" | "r2" | "folder";

export const CLOUD_PROVIDERS: { id: CloudProviderId; name: string; icon: string }[] = [
  { id: "gdrive", name: "Google Drive", icon: "hard-drive" },
  { id: "onedrive", name: "OneDrive", icon: "cloud" },
  { id: "s3", name: "S3 Compatible", icon: "server" },
  { id: "r2", name: "Cloudflare R2", icon: "cloud" },
  { id: "folder", name: "Local Folder", icon: "folder" },
];
