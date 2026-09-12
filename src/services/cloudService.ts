import { invoke } from "@tauri-apps/api/core";
import type {
  CloudStatusResult,
  CloudProviderInfo,
  CloudConnectRequest,
  CloudConnectLocalRequest,
  CloudAddAppRequest,
  CloudRemoveAppRequest,
  CloudR2Config,
  CloudS3Config,
} from "../types/cloud";

export interface OAuthResult {
  success: boolean;
  provider: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Cloud Redirect service
// ---------------------------------------------------------------------------

/**
 * Get the current cloud redirect status.
 */
export async function cloudGetStatus(): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_get_status");
}

/**
 * Get the list of available cloud providers.
 */
export async function cloudGetProviders(): Promise<CloudProviderInfo[]> {
  return await invoke<CloudProviderInfo[]>("cloud_get_providers");
}

/**
 * Connect to a cloud provider.
 */
export async function cloudConnect(provider: string): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_connect", {
    request: { provider } as CloudConnectRequest,
  });
}

/**
 * Connect to local folder provider.
 */
export async function cloudConnectLocal(path: string): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_connect_local", {
    request: { path } as CloudConnectLocalRequest,
  });
}

/**
 * Disconnect from the cloud provider.
 */
export async function cloudDisconnect(): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_disconnect");
}

/**
 * Add an app to the CloudRedirect set.
 */
export async function cloudAddApp(appId: number): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_add_app", {
    request: { app_id: appId } as CloudAddAppRequest,
  });
}

/**
 * Remove an app from the CloudRedirect set.
 */
export async function cloudRemoveApp(appId: number): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_remove_app", {
    request: { app_id: appId } as CloudRemoveAppRequest,
  });
}

/**
 * Check if an app is registered with CloudRedirect.
 */
export async function cloudIsAppRegistered(appId: number): Promise<boolean> {
  return await invoke<boolean>("cloud_is_app_registered", { appId });
}

/**
 * Start the OAuth2 flow for a cloud provider (Google Drive / OneDrive).
 * Opens the browser, waits for the callback, exchanges the code for tokens.
 */
export async function cloudStartOAuth(provider: string): Promise<OAuthResult> {
  return await invoke<OAuthResult>("cloud_start_oauth", { provider });
}

/**
 * Set R2 credentials and connect to Cloudflare R2 provider.
 */
export async function cloudSetR2Credentials(config: CloudR2Config): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_set_r2_credentials", {
    request: config,
  });
}

/**
 * Set S3-compatible credentials and connect to S3 provider.
 */
export async function cloudSetS3Credentials(config: CloudS3Config): Promise<CloudStatusResult> {
  return await invoke<CloudStatusResult>("cloud_set_s3_credentials", {
    request: config,
  });
}

/**
 * Get R2 credentials (returns null if not configured).
 */
export async function cloudGetR2Credentials(): Promise<CloudR2Config | null> {
  return await invoke<CloudR2Config | null>("cloud_get_r2_credentials");
}

/**
 * Get S3 credentials (returns null if not configured).
 */
export async function cloudGetS3Credentials(): Promise<CloudS3Config | null> {
  return await invoke<CloudS3Config | null>("cloud_get_s3_credentials");
}
