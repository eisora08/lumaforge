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

// ── Embedded credentials (zero-config fallback via .env) ──
// IGDB is free for non-commercial use. These credentials are for LumaForge's
// built-in IGDB integration. Users can override with their own in Settings.
const EMBEDDED_IGDB_CLIENT_ID = import.meta.env.VITE_IGDB_CLIENT_ID ?? "";
const EMBEDDED_IGDB_CLIENT_SECRET = import.meta.env.VITE_IGDB_CLIENT_SECRET ?? "";

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
 * Resolve effective IGDB credentials, falling back to embedded .env values
 * when the user hasn't configured their own in Settings.
 */
export function resolveIgdbCredentials(
  clientId: string,
  clientSecret: string,
): { clientId: string; clientSecret: string } {
  return {
    clientId: clientId || EMBEDDED_IGDB_CLIENT_ID,
    clientSecret: clientSecret || EMBEDDED_IGDB_CLIENT_SECRET,
  };
}

/**
 * Return a valid IGDB access token, refreshing via Twitch OAuth if needed.
 *
 * @throws {string} User-friendly error when credentials are missing or auth fails.
 */
export async function getIgdbAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  // Fallback: if user hasn't configured credentials, use embedded ones
  const effectiveClientId = clientId || EMBEDDED_IGDB_CLIENT_ID;
  const effectiveClientSecret = clientSecret || EMBEDDED_IGDB_CLIENT_SECRET;

  const usingEmbedded = !clientId && !!EMBEDDED_IGDB_CLIENT_ID;
  console.log(`[IGDB_TOKEN] clientId="${clientId}" embedded="${EMBEDDED_IGDB_CLIENT_ID}" usingEmbedded=${usingEmbedded} hasSecret=${!!effectiveClientSecret}`);

  if (!effectiveClientId || !effectiveClientSecret) {
    console.error("[IGDB_TOKEN] MISSING CREDENTIALS — cannot authenticate");
    throw "IGDB credentials are not configured. Add VITE_IGDB_CLIENT_ID and VITE_IGDB_CLIENT_SECRET to your .env file, or set them in Settings.";
  }

  // Return cached token if still valid (with 60 s buffer)
  if (_cache && Date.now() < _cache.expiresAt - REFRESH_BUFFER_MS) {
    console.log("[IGDB_TOKEN] returning cached token");
    return _cache.accessToken;
  }

  // Exchange client credentials for an OAuth access token via Rust backend
  try {
    console.log("[IGDB_TOKEN] exchanging credentials for access token via Rust...");
    const resp = await igdbGetAccessToken(effectiveClientId, effectiveClientSecret);
    const accessToken = resp.access_token;
    const expiresInMs = (resp.expires_in ?? 3600) * 1000;

    if (!accessToken) {
      console.error("[IGDB_TOKEN] empty access_token in response:", resp);
      throw "Empty access_token in Twitch OAuth response.";
    }

    _cache = {
      accessToken,
      expiresAt: Date.now() + expiresInMs,
    };

    console.log(`[IGDB_TOKEN] SUCCESS token="${accessToken.slice(0, 10)}..." expiresIn=${resp.expires_in}s`);
    return accessToken;
  } catch (err) {
    // Invalidate cache on auth failure
    _cache = null;

    console.error("[IGDB_TOKEN] FAILED:", err);

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
