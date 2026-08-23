/**
 * Debrid Provider Service — resolve download URLs and check provider status
 * for TorBox, Real-Debrid, AllDebrid, and Premiumize.
 *
 * Provides a fallback chain: tries configured providers in priority order
 * until one succeeds in resolving a download URL.
 */

import { invoke } from "@tauri-apps/api/core";
import type { DebridProviderConfig } from "../types/settings";

// ── Types ──

export type DebridResolveResult = {
  success: boolean;
  provider: string;
  resolvedUrl?: string;
  fileName?: string;
  fileSize?: number;
  /** When the repack is split across many volumes (setup.exe + `.bin` parts),
   *  the resolver reports the full per-file list (and the count) so the caller
   *  can download each part sequentially through the debrid provider. */
  resolvedUrls?: string[];
  /** Per-file filenames aligned 1:1 with `resolvedUrls`. The frontend uses them
   *  to pick which part to download + extract LAST (the installer exe or the
   *  first-volume archive) so volumes reassemble in order. */
  fileNames?: string[];
  fileCount?: number;
  error?: string;
};

export type DebridProviderStatus = {
  provider: string;
  valid: boolean;
  accountName?: string;
  accountEmail?: string;
  premiumUntil?: string;
  bandwidthUsed?: number;
  bandwidthMax?: number;
  points?: number;
  error?: string;
};

export type ProviderId = "torbox" | "realdebrid" | "alldebrid" | "premiumize";

// ── Tauri bindings ──

async function tauriResolveUrl(
  provider: string,
  apiKey: string,
  uri: string,
): Promise<DebridResolveResult> {
  return await invoke<DebridResolveResult>("resolve_debrid_download_url", {
    provider,
    apiKey,
    uri,
  });
}

async function tauriCheckStatus(
  provider: string,
  apiKey: string,
): Promise<DebridProviderStatus> {
  return await invoke<DebridProviderStatus>("check_debrid_provider_status", {
    provider,
    apiKey,
  });
}

// ── Provider resolution with fallback chain ──

const PROVIDER_PRIORITY: ProviderId[] = [
  "torbox",
  "realdebrid",
  "alldebrid",
  "premiumize",
];

/**
 * Get the configured API key for a specific provider from settings.
 */
function getApiKeyForProvider(
  config: DebridProviderConfig,
  provider: ProviderId,
): string | undefined {
  switch (provider) {
    case "torbox":
      return config.torboxApiKey;
    case "realdebrid":
      return config.realDebridApiKey;
    case "alldebrid":
      return config.allDebridApiKey;
    case "premiumize":
      return config.premiumizeApiKey;
  }
}

/**
 * Resolve a download URI through the best available debrid provider.
 *
 * Tries providers in priority order (TorBox → Real-Debrid → AllDebrid → Premiumize).
 * Returns the first successful resolution, or the last failure.
 */
export async function resolveDebridUri(
  uri: string,
  providerConfig: DebridProviderConfig,
  preferredProvider?: ProviderId,
): Promise<DebridResolveResult> {
  const providers = preferredProvider
    ? [preferredProvider, ...PROVIDER_PRIORITY.filter((p) => p !== preferredProvider)]
    : PROVIDER_PRIORITY;

  let lastError: DebridResolveResult | null = null;

  for (const provider of providers) {
    const apiKey = getApiKeyForProvider(providerConfig, provider);
    if (!apiKey || apiKey.trim().length === 0) {
      continue; // Skip providers without API keys
    }

    try {
      const result = await tauriResolveUrl(provider, apiKey, uri);
      if (result.success) {
        console.log(
          `[DEBRID_RESOLVE] resolved via ${provider} uri=${uri.substring(0, 60)}...`,
        );
        return result;
      }
      lastError = result;
      console.warn(
        `[DEBRID_RESOLVE] ${provider} failed: ${result.error}`,
      );
    } catch (err) {
      lastError = {
        success: false,
        provider,
        error: err instanceof Error ? err.message : String(err),
      };
      console.error(`[DEBRID_RESOLVE] ${provider} error:`, err);
    }
  }

  return (
    lastError || {
      success: false,
      provider: "none",
      error: "No debrid providers configured",
    }
  );
}

/**
 * Check the status of a specific debrid provider.
 */
export async function checkProviderStatus(
  provider: ProviderId,
  apiKey: string,
): Promise<DebridProviderStatus> {
  try {
    return await tauriCheckStatus(provider, apiKey);
  } catch (err) {
    return {
      provider,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check all configured providers and return their statuses.
 */
export async function checkAllProviders(
  config: DebridProviderConfig,
): Promise<DebridProviderStatus[]> {
  const results: DebridProviderStatus[] = [];

  for (const provider of PROVIDER_PRIORITY) {
    const apiKey = getApiKeyForProvider(config, provider);
    if (!apiKey || apiKey.trim().length === 0) {
      results.push({
        provider,
        valid: false,
        error: "No API key configured",
      });
      continue;
    }

    const status = await checkProviderStatus(provider, apiKey);
    results.push(status);
  }

  return results;
}

/**
 * Get the list of configured (non-empty key) providers.
 */
export function getConfiguredProviders(
  config: DebridProviderConfig,
): ProviderId[] {
  return PROVIDER_PRIORITY.filter((p) => {
    const key = getApiKeyForProvider(config, p);
    return key && key.trim().length > 0;
  });
}

/**
 * Check if any debrid provider is configured.
 */
export function hasAnyProviderConfigured(config: DebridProviderConfig): boolean {
  return getConfiguredProviders(config).length > 0;
}
