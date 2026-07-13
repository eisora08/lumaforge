/**
 * Provider-aware media path helpers — foundation layer.
 *
 * Pure functions, no side effects, no disk I/O, no active callers yet.
 * Existing Steam media behavior is NOT modified by this module.
 *
 * Path convention matches the Rust side:
 *   games/<provider>/<providerGameId>/media/<role>.<extension>
 *
 * Examples:
 *   steam / 268910 / cover / jpg  → games/steam/268910/media/cover.jpg
 *   manual / abc123 / cover / jpg → games/manual/abc123/media/cover.jpg
 *   gog / 123456 / background / jpg → games/gog/123456/media/background.jpg
 */

import type { MediaRole } from "../types/gameProviderCapabilities";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * All supported media storage providers.
 * appId remains Steam-only; external providers use providerGameId.
 */
export type MediaProviderId =
  | "steam"
  | "manual"
  | "epic"
  | "gog"
  | "battle_net"
  | "ubisoft"
  | "ea"
  | "amazon"
  | "local"
  | "lua"
  | "unknown";

export type ProviderMediaPathInput = {
  providerId: MediaProviderId;
  providerGameId: string;
  role: MediaRole;
  extension: string;
};

export type ProviderMediaPathResult = {
  /** Full relative path from app data root: games/<provider>/<id>/media/<role>.<ext> */
  relativePath: string;
  /** Just the filename: <role>.<ext> */
  filename: string;
  /** Just the provider subfolder: games/<provider>/<id> */
  gameFolder: string;
  /** Just the media subfolder: games/<provider>/<id>/media */
  mediaFolder: string;
};

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const PATH_TRAVERSAL_RE = /(\.\.[/\\]|[\/\\]\.\.|^\.)/;

/**
 * Sanitize a provider game ID for safe use as a filesystem directory name.
 * Matches Rust `safe_filename` behavior: keeps alphanumeric, `-`, `_`,
 * replaces everything else with `_`, empty result → `"unknown"`.
 */
export function sanitizeProviderGameId(raw: string): string {
  if (!raw || typeof raw !== "string") return "unknown";
  const sanitized = raw
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_|_$/g, "");
  return sanitized.length > 0 ? sanitized : "unknown";
}

/**
 * Sanitize a file extension: strips dots, slashes, non-alphanumeric chars.
 * Returns lowercase without leading dot.
 */
export function sanitizeExtension(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/^\./, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Validate a media role name.
 */
export function isValidMediaRole(role: string): role is MediaRole {
  return role === "cover" || role === "landscape" || role === "background" || role === "logo" || role === "icon";
}

/**
 * Validate a provider ID.
 */
export function isValidProviderId(id: string): id is MediaProviderId {
  return (
    id === "steam" || id === "manual" || id === "epic" || id === "gog" ||
    id === "battle_net" || id === "ubisoft" || id === "ea" || id === "amazon" ||
    id === "local" || id === "lua" || id === "unknown"
  );
}

/**
 * Check if a raw string is a safe provider game ID (no traversal, non-empty after sanitization).
 */
export function isSafeProviderGameId(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  if (PATH_TRAVERSAL_RE.test(raw)) return false;
  const sanitized = sanitizeProviderGameId(raw);
  return sanitized !== "unknown" || raw.length > 0;
}

// ---------------------------------------------------------------------------
// Path builder
// ---------------------------------------------------------------------------

/**
 * Build a provider-aware media path.
 *
 * Returns a `ProviderMediaPathResult` with pre-computed path segments.
 * All segments are sanitized — no path traversal, no undefined, no empty components.
 *
 * @example
 * buildProviderMediaPath({ providerId: "steam", providerGameId: "268910", role: "cover", extension: "jpg" })
 * // → { relativePath: "games/steam/268910/media/cover.jpg", ... }
 *
 * @example
 * buildProviderMediaPath({ providerId: "manual", providerGameId: "abc-123", role: "background", extension: "png" })
 * // → { relativePath: "games/manual/abc_123/media/background.png", ... }
 *
 * @example
 * buildProviderMediaPath({ providerId: "gog", providerGameId: "123456", role: "cover", extension: "jpg" })
 * // → { relativePath: "games/gog/123456/media/cover.jpg", ... }
 */
export function buildProviderMediaPath(input: ProviderMediaPathInput): ProviderMediaPathResult {
  const safeId = sanitizeProviderGameId(input.providerGameId);
  const ext = sanitizeExtension(input.extension);
  const role = input.role; // already typed as MediaRole

  const filename = ext ? `${role}.${ext}` : role;
  const gameFolder = `games/${input.providerId}/${safeId}`;
  const mediaFolder = `${gameFolder}/media`;
  const relativePath = `${mediaFolder}/${filename}`;

  return { relativePath, filename, gameFolder, mediaFolder };
}

// ---------------------------------------------------------------------------
// Convenience builders
// ---------------------------------------------------------------------------

/**
 * Build a provider-aware media path and return just the relative path string.
 */
export function providerMediaPath(
  providerId: MediaProviderId,
  providerGameId: string,
  role: MediaRole,
  extension: string,
): string {
  return buildProviderMediaPath({ providerId, providerGameId, role, extension }).relativePath;
}

/**
 * Build a media relative path from a full relative path + provider info.
 * Useful when you need to re-base an existing path under a different provider.
 */
export function rebaseMediaPath(
  providerId: MediaProviderId,
  providerGameId: string,
  mediaRelativePath: string,
): string {
  const safeId = sanitizeProviderGameId(providerGameId);
  // Extract filename from existing path (e.g. "media/cover.jpg" → "cover.jpg")
  const parts = mediaRelativePath.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1] || mediaRelativePath;
  return `games/${providerId}/${safeId}/media/${filename}`;
}

// ---------------------------------------------------------------------------
// Default extension per role
// ---------------------------------------------------------------------------

/** Default file extension per media role (matches common download conventions). */
export const ROLE_DEFAULT_EXTENSIONS: Record<MediaRole, string> = {
  cover: "jpg",
  landscape: "jpg",
  background: "jpg",
  logo: "png",
  icon: "png",
};

/**
 * Build a provider media path using the default extension for the role.
 */
export function providerMediaPathDefault(
  providerId: MediaProviderId,
  providerGameId: string,
  role: MediaRole,
): string {
  return providerMediaPath(providerId, providerGameId, role, ROLE_DEFAULT_EXTENSIONS[role]);
}

// ---------------------------------------------------------------------------
// Path analysis
// ---------------------------------------------------------------------------

/**
 * Extract the provider ID from a relative media path.
 * Returns null if the path doesn't match the expected pattern.
 *
 * @example
 * extractProviderFromPath("games/steam/268910/media/cover.jpg") → "steam"
 * extractProviderFromPath("games/manual/abc123/media/cover.jpg") → "manual"
 */
export function extractProviderFromPath(relativePath: string): MediaProviderId | null {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  // Expected: games/<provider>/<id>/media/<filename>
  if (parts.length < 5 || parts[0] !== "games") return null;
  const provider = parts[1];
  return isValidProviderId(provider) ? provider : null;
}

/**
 * Extract the provider game ID from a relative media path.
 * Returns null if the path doesn't match the expected pattern.
 *
 * @example
 * extractProviderGameIdFromPath("games/steam/268910/media/cover.jpg") → "268910"
 * extractProviderGameIdFromPath("games/manual/abc-123/media/cover.jpg") → "abc-123"
 */
export function extractProviderGameIdFromPath(relativePath: string): string | null {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  if (parts.length < 5 || parts[0] !== "games") return null;
  return parts[2] || null;
}

/**
 * Extract the media role from a relative media path.
 * Returns null if the path doesn't match the expected pattern.
 *
 * @example
 * extractRoleFromPath("games/steam/268910/media/cover.jpg") → "cover"
 */
export function extractRoleFromPath(relativePath: string): MediaRole | null {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  if (parts.length < 5 || parts[0] !== "games" || parts[3] !== "media") return null;
  const filename = parts[parts.length - 1] || "";
  const dotIdx = filename.lastIndexOf(".");
  const roleName = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
  return isValidMediaRole(roleName) ? roleName : null;
}

// ---------------------------------------------------------------------------
// Path matching — check if a path belongs to a given provider+game
// ---------------------------------------------------------------------------

/**
 * Check if a relative media path belongs to a specific provider and game.
 *
 * @example
 * belongsToProvider("games/steam/268910/media/cover.jpg", "steam", "268910") → true
 * belongsToProvider("games/gog/123456/media/cover.jpg", "steam", "268910") → false
 */
export function belongsToProvider(
  relativePath: string,
  providerId: MediaProviderId,
  providerGameId: string,
): boolean {
  const safeId = sanitizeProviderGameId(providerGameId);
  const prefix = `games/${providerId}/${safeId}/`;
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.startsWith(prefix);
}

// ---------------------------------------------------------------------------
// Legacy Steam path compatibility
// ---------------------------------------------------------------------------

/**
 * Build a legacy Steam-only media relative path (backward-compatible).
 * Matches the exact format used by existing Rust TS callers:
 *   "media/<role>.<ext>"
 *
 * This is a thin wrapper for callers that already know they're Steam.
 * New code should use `buildProviderMediaPath` instead.
 */
export function steamMediaRelativePath(role: MediaRole, extension: string): string {
  const ext = sanitizeExtension(extension);
  return `media/${role}.${ext}`;
}

// ---------------------------------------------------------------------------
// All roles helper
// ---------------------------------------------------------------------------

/** All five media roles in canonical order. */
export const ALL_MEDIA_ROLES: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];

/**
 * Build media paths for all roles at once for a given provider+game.
 * Returns a Record mapping each role to its relative path.
 */
export function buildAllProviderMediaPaths(
  providerId: MediaProviderId,
  providerGameId: string,
  extensionOverrides?: Partial<Record<MediaRole, string>>,
): Record<MediaRole, string> {
  const result = {} as Record<MediaRole, string>;
  for (const role of ALL_MEDIA_ROLES) {
    const ext = extensionOverrides?.[role] ?? ROLE_DEFAULT_EXTENSIONS[role];
    result[role] = providerMediaPath(providerId, providerGameId, role, ext);
  }
  return result;
}
