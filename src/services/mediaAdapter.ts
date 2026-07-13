/**
 * Media adapter foundation — provider-aware media role operations.
 *
 * SteamMediaAdapter wraps existing Steam-safe helpers (saveGameMediaFile,
 * deleteGameMediaFile, resolveGameMediaPaths, localPathToUrl, safe_download_image).
 * No active callers yet. No UI integration. Will later power one shared
 * GameEditDialog Media tab.
 */

import type { MediaRole } from "../types/gameProviderCapabilities";
import type { GameMediaPaths } from "./tauri";
import {
  resolveGameMediaPaths,
  deleteGameMediaFile,
  saveProviderMediaFromPath,
  downloadProviderMediaFromUrl,
  deleteProviderMediaFile,
} from "./tauri";
import { invoke } from "@tauri-apps/api/core";
import { localPathToUrl } from "./gameCacheService";
import type {
  MediaProviderId,
  ProviderMediaPathResult,
} from "./providerMediaPaths";
import { buildProviderMediaPath, ROLE_DEFAULT_EXTENSIONS } from "./providerMediaPaths";

// ---------------------------------------------------------------------------
// Media source descriptors — where artwork can come from
// ---------------------------------------------------------------------------

export type MediaSourceKind =
  | "local-file"
  | "url"
  | "steam-original"
  | "steamgriddb"
  | "igdb"
  | "rawg"
  | "web-search";

export type MediaSourceDescriptor = {
  id: MediaSourceKind;
  label: string;
  /** Whether this source is currently available for the game. */
  enabled: boolean;
  /** Reason shown when disabled (e.g. "No API key configured"). */
  disabledReason?: string;
};

/** Canonical list of all possible media sources with default labels. */
export const ALL_MEDIA_SOURCES: { id: MediaSourceKind; label: string }[] = [
  { id: "local-file",    label: "Local File" },
  { id: "url",           label: "URL" },
  { id: "steam-original", label: "Steam Original Assets" },
  { id: "steamgriddb",   label: "SteamGridDB" },
  { id: "igdb",          label: "IGDB" },
  { id: "rawg",          label: "RAWG" },
  { id: "web-search",    label: "Web Search" },
];

// ---------------------------------------------------------------------------
// Role state — current media status per role
// ---------------------------------------------------------------------------

export type RoleMediaState = {
  /** Whether a file exists on disk for this role. */
  hasFile: boolean;
  /** Relative path within the provider folder (e.g. "media/cover.jpg"). */
  relativePath?: string;
  /** Absolute or asset:// URL for previewing in the editor. */
  previewUrl?: string | null;
  /** File extension (e.g. "jpg", "png"). */
  extension?: string;
};

// ---------------------------------------------------------------------------
// GameMediaAdapter interface
// ---------------------------------------------------------------------------

export type GameMediaAdapter = {
  /** Provider this adapter serves. */
  readonly providerId: MediaProviderId;

  /** Provider-specific game identifier (appId for steam, libraryId for manual). */
  readonly providerGameId: string;

  /** Pre-computed path segments for this provider+game. */
  readonly paths: ProviderMediaPathResult;

  // -- Path queries --

  /** Get the relative media path for a role (e.g. "media/cover.jpg"). */
  getRolePath(role: MediaRole): string;

  /** Get a previewable URL for a role (file://, asset://, or http(s)://). */
  getRolePreviewUrl(role: MediaRole): Promise<string | null>;

  // -- State queries --

  /** Get the current media state for a single role. */
  getRoleState(role: MediaRole): Promise<RoleMediaState>;

  /** Get media states for all 5 roles. */
  getAllRoleStates(): Promise<Record<MediaRole, RoleMediaState>>;

  // -- Mutations --

  /**
   * Save a role from a local file path.
   * Returns the new relative path on success, null on failure.
   */
  saveRoleFromFile(role: MediaRole, filePath: string): Promise<string | null>;

  /**
   * Save a role by downloading from a URL.
   * Returns the new relative path on success, null on failure.
   */
  saveRoleFromUrl(role: MediaRole, url: string): Promise<string | null>;

  /**
   * Remove a role's media file.
   * Returns true on success.
   */
  removeRole(role: MediaRole): Promise<boolean>;

  // -- Source discovery --

  /**
   * Get available media sources for a role, with enabled/disabled status.
   * Sources are ordered by priority (most likely to succeed first).
   */
  getAvailableSources(role: MediaRole): MediaSourceDescriptor[];
};

// ---------------------------------------------------------------------------
// Shared: role → GameMediaPaths key mapping
// ---------------------------------------------------------------------------

const ROLE_TO_PATH_KEY: Record<MediaRole, keyof GameMediaPaths> = {
  cover: "coverPath",
  landscape: "landscapePath",
  background: "backgroundPath",
  logo: "logoPath",
  icon: "iconPath",
};

// ---------------------------------------------------------------------------
// Steam adapter — wraps existing Steam-safe helpers
// ---------------------------------------------------------------------------

/**
 * Steam media adapter — wraps existing Steam media infrastructure.
 *
 * Mutations use the existing Rust commands (save_game_media_file,
 * delete_game_media_file, safe_download_image) via Tauri invoke.
 * State queries use resolveGameMediaPaths (Rust disk check) + localPathToUrl.
 * getAvailableSources is a stub — settings-based filtering will be added
 * when the adapter is integrated into the editor UI.
 */
export class SteamMediaAdapter implements GameMediaAdapter {
  readonly providerId: MediaProviderId = "steam";
  readonly providerGameId: string;
  readonly paths: ProviderMediaPathResult;

  constructor(appId: string) {
    this.providerGameId = appId;
    this.paths = buildProviderMediaPath({
      providerId: "steam",
      providerGameId: appId,
      role: "cover",
      extension: ROLE_DEFAULT_EXTENSIONS.cover,
    });
  }

  // ── Path queries ──

  getRolePath(role: MediaRole): string {
    return buildProviderMediaPath({
      providerId: "steam",
      providerGameId: this.providerGameId,
      role,
      extension: ROLE_DEFAULT_EXTENSIONS[role],
    }).relativePath;
  }

  async getRolePreviewUrl(role: MediaRole): Promise<string | null> {
    const resolved = await resolveGameMediaPaths(this.providerGameId);
    if (!resolved) return null;
    const key = ROLE_TO_PATH_KEY[role];
    const absPath = resolved[key];
    if (absPath && typeof absPath === "string") {
      return localPathToUrl(absPath);
    }
    return null;
  }

  // ── State queries ──

  async getRoleState(role: MediaRole): Promise<RoleMediaState> {
    const resolved = await resolveGameMediaPaths(this.providerGameId);
    const key = ROLE_TO_PATH_KEY[role];
    const absPath = resolved?.[key];
    const hasFile = !!(absPath && typeof absPath === "string");
    return {
      hasFile,
      relativePath: this.getRolePath(role),
      previewUrl: hasFile && absPath ? localPathToUrl(absPath) : null,
      extension: ROLE_DEFAULT_EXTENSIONS[role],
    };
  }

  async getAllRoleStates(): Promise<Record<MediaRole, RoleMediaState>> {
    const roles: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];
    const resolved = await resolveGameMediaPaths(this.providerGameId);
    const result = {} as Record<MediaRole, RoleMediaState>;
    for (const role of roles) {
      const key = ROLE_TO_PATH_KEY[role];
      const absPath = resolved?.[key];
      const hasFile = !!(absPath && typeof absPath === "string");
      result[role] = {
        hasFile,
        relativePath: this.getRolePath(role),
        previewUrl: hasFile && absPath ? localPathToUrl(absPath) : null,
        extension: ROLE_DEFAULT_EXTENSIONS[role],
      };
    }
    return result;
  }

  // ── Mutations ──

  /**
   * Save a role from a local file path.
   * Uses saveProviderMediaFromPath("steam", ...) which writes to
   * games/steam/<appId>/media/<role>.<ext> — same path tree as
   * the existing save_game_media_file Rust command.
   * Does NOT update appinfo.json — caller is responsible for that.
   */
  async saveRoleFromFile(role: MediaRole, filePath: string): Promise<string | null> {
    try {
      const relativePath = await saveProviderMediaFromPath(
        "steam",
        this.providerGameId,
        role,
        filePath,
      );
      return relativePath;
    } catch (err) {
      console.error(`[MEDIA_ADAPTER][SAVE_FILE] provider=steam game=${this.providerGameId} role=${role} error=`, err);
      return null;
    }
  }

  /**
   * Save a role by downloading from a URL.
   * Uses safe_download_image Rust command (existing Steam-safe download)
   * which writes to games/steam/<appId>/media/<role>.<ext>.
   * Does NOT update appinfo.json — caller is responsible for that.
   */
  async saveRoleFromUrl(role: MediaRole, url: string): Promise<string | null> {
    try {
      const result = await invoke<string | null>("safe_download_image", {
        url,
        appId: this.providerGameId,
        mediaType: role,
        target: "",
        forceRefresh: true,
      });
      return result ?? null;
    } catch (err) {
      console.error(`[MEDIA_ADAPTER][SAVE_URL] provider=steam game=${this.providerGameId} role=${role} error=`, err);
      return null;
    }
  }

  /**
   * Remove a role's media file.
   * Uses deleteGameMediaFile (existing Steam-safe delete).
   * Does NOT update appinfo.json — caller is responsible for that.
   */
  async removeRole(role: MediaRole): Promise<boolean> {
    try {
      await deleteGameMediaFile(this.providerGameId, role);
      return true;
    } catch (err) {
      console.error(`[MEDIA_ADAPTER][REMOVE] provider=steam game=${this.providerGameId} role=${role} error=`, err);
      return false;
    }
  }

  // ── Source discovery ──

  /**
   * Get available media sources for a role.
   * STUB: returns all sources as enabled. Settings-based filtering
   * (SGDB/IGDB/RAWG API key checks, metadata availability) will be
   * added when the adapter is integrated into the editor UI, since
   * the adapter constructor does not have access to app settings.
   */
  getAvailableSources(_role: MediaRole): MediaSourceDescriptor[] {
    return [
      { id: "steam-original", label: "Steam Original Assets", enabled: true },
      { id: "steamgriddb", label: "SteamGridDB", enabled: true },
      { id: "igdb", label: "IGDB", enabled: true },
      { id: "rawg", label: "RAWG", enabled: true },
      { id: "local-file", label: "Local File", enabled: true },
      { id: "url", label: "URL", enabled: true },
      { id: "web-search", label: "Web Search", enabled: true },
    ];
  }
}

// ---------------------------------------------------------------------------
// Manual adapter skeleton
// ---------------------------------------------------------------------------

/**
 * Manual media adapter — handles manually-imported games.
 *
 * Uses providerMediaPaths for path building.
 * Mutations are fully implemented: save from local file, save from URL, delete.
 * State queries (getRoleState, getRolePreviewUrl) remain stubs — no disk check yet.
 */
export class ManualMediaAdapter implements GameMediaAdapter {
  readonly providerId: MediaProviderId = "manual";
  readonly providerGameId: string;
  readonly paths: ProviderMediaPathResult;

  constructor(libraryId: string) {
    this.providerGameId = libraryId;
    this.paths = buildProviderMediaPath({
      providerId: "manual",
      providerGameId: libraryId,
      role: "cover",
      extension: ROLE_DEFAULT_EXTENSIONS.cover,
    });
  }

  getRolePath(role: MediaRole): string {
    return buildProviderMediaPath({
      providerId: "manual",
      providerGameId: this.providerGameId,
      role,
      extension: ROLE_DEFAULT_EXTENSIONS[role],
    }).relativePath;
  }

  async getRolePreviewUrl(_role: MediaRole): Promise<string | null> {
    // STUB: needs absolute path resolution for asset:// URL
    return null;
  }

  async getRoleState(role: MediaRole): Promise<RoleMediaState> {
    // STUB: hasFile always false — needs disk check via Rust command
    return {
      hasFile: false,
      relativePath: this.getRolePath(role),
      previewUrl: null,
      extension: ROLE_DEFAULT_EXTENSIONS[role],
    };
  }

  async getAllRoleStates(): Promise<Record<MediaRole, RoleMediaState>> {
    const roles: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];
    const result = {} as Record<MediaRole, RoleMediaState>;
    for (const role of roles) {
      result[role] = await this.getRoleState(role);
    }
    return result;
  }

  async saveRoleFromFile(role: MediaRole, filePath: string): Promise<string | null> {
    try {
      const relativePath = await saveProviderMediaFromPath(
        "manual",
        this.providerGameId,
        role,
        filePath,
      );
      return relativePath;
    } catch (err) {
      console.error(`[MEDIA_ADAPTER][SAVE_FILE] provider=manual game=${this.providerGameId} role=${role} error=`, err);
      return null;
    }
  }

  async saveRoleFromUrl(role: MediaRole, url: string): Promise<string | null> {
    try {
      const relativePath = await downloadProviderMediaFromUrl(
        "manual",
        this.providerGameId,
        role,
        url,
      );
      return relativePath;
    } catch (err) {
      console.error(`[MEDIA_ADAPTER][SAVE_URL] provider=manual game=${this.providerGameId} role=${role} error=`, err);
      return null;
    }
  }

  async removeRole(role: MediaRole): Promise<boolean> {
    try {
      await deleteProviderMediaFile("manual", this.providerGameId, role);
      return true;
    } catch (err) {
      console.error(`[MEDIA_ADAPTER][REMOVE] provider=manual game=${this.providerGameId} role=${role} error=`, err);
      return false;
    }
  }

  getAvailableSources(_role: MediaRole): MediaSourceDescriptor[] {
    // Manual games: local file, URL, web search only
    return [
      { id: "local-file", label: "Local File", enabled: true },
      { id: "url", label: "URL", enabled: true },
      { id: "web-search", label: "Web Search", enabled: true },
      { id: "steam-original", label: "Steam Original Assets", enabled: false, disabledReason: "Not a Steam game" },
      { id: "steamgriddb", label: "SteamGridDB", enabled: false, disabledReason: "Not yet wired" },
      { id: "igdb", label: "IGDB", enabled: false, disabledReason: "Not yet wired" },
      { id: "rawg", label: "RAWG", enabled: false, disabledReason: "Not yet wired" },
    ];
  }
}

// ---------------------------------------------------------------------------
// Future adapter skeletons (type placeholders)
// ---------------------------------------------------------------------------

/**
 * Generic adapter for future providers (epic, gog, etc.).
 * Same pattern as ManualMediaAdapter — uses providerMediaPaths.
 */
export class GenericMediaAdapter implements GameMediaAdapter {
  readonly providerId: MediaProviderId;
  readonly providerGameId: string;
  readonly paths: ProviderMediaPathResult;

  constructor(providerId: MediaProviderId, providerGameId: string) {
    this.providerId = providerId;
    this.providerGameId = providerGameId;
    this.paths = buildProviderMediaPath({
      providerId,
      providerGameId,
      role: "cover",
      extension: ROLE_DEFAULT_EXTENSIONS.cover,
    });
  }

  getRolePath(role: MediaRole): string {
    return buildProviderMediaPath({
      providerId: this.providerId,
      providerGameId: this.providerGameId,
      role,
      extension: ROLE_DEFAULT_EXTENSIONS[role],
    }).relativePath;
  }

  async getRolePreviewUrl(): Promise<string | null> { return null; }

  async getRoleState(role: MediaRole): Promise<RoleMediaState> {
    return {
      hasFile: false,
      relativePath: this.getRolePath(role),
      extension: ROLE_DEFAULT_EXTENSIONS[role],
    };
  }

  async getAllRoleStates(): Promise<Record<MediaRole, RoleMediaState>> {
    const roles: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];
    const result = {} as Record<MediaRole, RoleMediaState>;
    for (const role of roles) { result[role] = await this.getRoleState(role); }
    return result;
  }

  async saveRoleFromFile(): Promise<string | null> { return null; }
  async saveRoleFromUrl(): Promise<string | null> { return null; }
  async removeRole(): Promise<boolean> { return false; }

  getAvailableSources(): MediaSourceDescriptor[] {
    return [
      { id: "local-file", label: "Local File", enabled: true },
      { id: "url", label: "URL", enabled: true },
      { id: "web-search", label: "Web Search", enabled: true },
    ];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the correct media adapter for a provider+game.
 */
export function createMediaAdapter(
  providerId: MediaProviderId,
  providerGameId: string,
): GameMediaAdapter {
  switch (providerId) {
    case "steam":
      return new SteamMediaAdapter(providerGameId);
    case "manual":
      return new ManualMediaAdapter(providerGameId);
    default:
      return new GenericMediaAdapter(providerId, providerGameId);
  }
}

// ---------------------------------------------------------------------------
// All-media-roles helper (re-export for consumers)
// ---------------------------------------------------------------------------

export const ALL_ADAPTER_ROLES: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];
