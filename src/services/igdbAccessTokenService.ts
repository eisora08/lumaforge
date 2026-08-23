/**
 * IGDB Access Token Service
 *
 * Exchanges Twitch OAuth client credentials for an access_token via the
 * Rust backend (igdb_get_access_token command). Caches the token in memory
 * until 60 s before expiry.
 *
 * Flow:
 *   clientId + client_secret → Twitch OAuth → access_token
 *   access_token → IGDB API (Authorization: Bearer <access_token>)
 *
 * client_secret is NEVER sent as a Bearer token to IGDB.
 * Neither client_secret nor access_token are logged.
 */

import { igdbGetAccessToken } from "./tauri";

// ── Token cache ──

interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _cache: TokenCache | null = null;

/** Buffer before actual expiry to refresh early (60 s). */
const REFRESH_BUFFER_MS = 60_000;

// ── Public API ──

/**
 * Return a valid IGDB access token, refreshing via Twitch OAuth if needed.
 *
 * @throws {string} User-friendly error when credentials are missing or auth fails.
 */
export async function getIgdbAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (!clientId || !clientSecret) {
    throw "IGDB credentials are not configured. Set your Twitch Client ID and Client Secret in Settings.";
  }

  // Return cached token if still valid (with 60 s buffer)
  if (_cache && Date.now() < _cache.expiresAt - REFRESH_BUFFER_MS) {
    return _cache.accessToken;
  }

  // Exchange client credentials for an OAuth access token via Rust backend
  try {
    const resp = await igdbGetAccessToken(clientId, clientSecret);
    const accessToken = resp.access_token;
    const expiresInMs = (resp.expires_in ?? 3600) * 1000;

    if (!accessToken) {
      throw "Empty access_token in Twitch OAuth response.";
    }

    _cache = {
      accessToken,
      expiresAt: Date.now() + expiresInMs,
    };

    return accessToken;
  } catch (err) {
    // Invalidate cache on auth failure
    _cache = null;

    // If the error is already a user-friendly string from above, re-throw
    if (typeof err === "string") throw err;

    // Rust returns formatted error strings like "[IGDB][TOKEN] Authentication failed (HTTP 401): ..."
    const msg = typeof err === "string" ? err : String(err);

    if (msg.includes("401") || msg.includes("403")) {
      throw "Could not authenticate with IGDB. Check your Twitch Client ID and Client Secret in Settings.";
    }

    throw `Could not authenticate with IGDB: ${msg}`;
  }
}

/**
 * Clear the cached token. Call when the user changes IGDB credentials
 * in Settings so the next request forces a fresh token exchange.
 */
export function clearIgdbTokenCache(): void {
  _cache = null;
}
