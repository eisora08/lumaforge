import type { SteamAppMetadata } from "./gameMetadata";
import type { InstalledLuaScript } from "./installedLua";
import type { PackageSource } from "./package";

/**
 * Canonical game source provider.
 *
 * Identity rules per source:
 * - "steam":  source="steam",  providerId="steam",  providerGameId=Steam appId,  appId=Steam appId,  libraryId=existing convention
 * - "local":  source="local",  providerId="local",  providerGameId=hash,          appId=undefined,    libraryId=undefined
 * - "lua":    source="lua",    providerId="lua",    providerGameId=Steam appId,  appId=Steam appId,  libraryId=undefined
 * - "manual": source="manual", providerId="manual", providerGameId=UUID,          appId=undefined,    libraryId="manual:<uuid>"
 * - "epic":   source="epic",   providerId="epic",   providerGameId=stable native, appId=undefined,    libraryId="epic:<providerGameId>"
 * - "gog":    source="gog",    providerId="gog",    providerGameId=GOG productId, appId=undefined,    libraryId="gog:<productId>"
 * - "debrid": source="debrid", providerId="debrid", providerGameId=repackId,     appId=Steam appId, libraryId="debrid:<repackId>"
 *
 * appId is Steam-only. External providers use providerId + providerGameId.
 * Cross-provider duplicates (same title on Steam + Epic + GOG) are NEVER deduped.
 */
export type LibraryGameSource = "steam" | "local" | "lua" | "manual" | "epic" | "gog" | "debrid";

/**
 * Unified game model for all providers.
 *
 * Provider-neutral identity priority:
 *   1. non-empty libraryId
 *   2. providerId + providerGameId
 *   3. non-empty id
 *   4. Steam appId fallback (legacy Steam records only)
 *
 * Cross-provider copies of the same game MUST remain separate LibraryGame entries.
 * linkedSteamAppId and linkedIgdbId are metadata links, NOT identity.
 */
export type LibraryGame = {
  /** Unique identifier. Format varies by source: "steam-<appId>", "manual:<uuid>", "epic-<catalogId>", etc. */
  id: string;
  /** Steam-specific numeric app ID. Undefined for all non-Steam sources. */
  appId?: string;
  customTitle?: string;
  title: string;
  source: LibraryGameSource;
  /** Stable library-scoped ID. Format: "steam-480", "manual:<uuid>", "epic:<providerGameId>", "gog:<productId>" */
  libraryId?: string;
  /** Provider identifier. Must match source: "steam" | "manual" | "epic" | "gog" | "local" | "lua" */
  providerId?: string;
  /** Provider's own stable game ID. Separate from appId (Steam-specific). Must be collision-safe within the provider. */
  providerGameId?: string;
  /** Optional link to a Steam appId for metadata resolution only. NOT an identity field. */
  linkedSteamAppId?: string;
  /** Optional link to an IGDB ID for metadata resolution only. NOT an identity field. */
  linkedIgdbId?: string;
  executablePath?: string;
  workingDirectory?: string;
  launchArguments?: string;
  installDir?: string;
  libraryPath?: string;
  /** Repack group name for Debrid-sourced games (e.g. "fitgirl", "dodi"). */
  repacker?: string;
  imageUrl?: string;
  /** Cover art path (relative provider path, e.g. games/epic/<id>/media/cover.jpg). Set by Epic/manual overrides. */
  coverPath?: string;
  /** Landscape art path. Set by Epic/manual overrides. */
  landscapePath?: string;
  /** Background art path. Set by Epic/manual overrides. */
  backgroundPath?: string;
  /** Logo art path. Set by Epic/manual overrides. */
  logoPath?: string;
  iconPath?: string;
  metadata?: SteamAppMetadata;
  /** Provider-neutral installed flag. True when the game exists on disk from any provider. */
  isInstalled?: boolean;
  isPlayable: boolean;
  isInstallable: boolean;
  steamInstalled: boolean;
  sizeOnDisk?: number;
  lastUpdated?: number;
  /** Timestamp when this game was first added to the library (ms since epoch) */
  createdAt?: number;
  luaScripts: InstalledLuaScript[];
  hasLua: boolean;
  isLuaActive: boolean;
  isLuaDisabled: boolean;
  hasLuaSource: boolean;
  sources: PackageSource[];
  hasUpdate?: boolean;
  /** Steam localconfig last_played (from localconfig.vdf) */
  steamLastPlayedAt?: number;
  /** Steam localconfig Playtime (from localconfig.vdf) */
  steamPlaytimeMinutes?: number;
  /** Steam localconfig Playtime2wks */
  steamPlaytime2Weeks?: number;
  /** Steam localconfig cloud.last_sync_state */
  steamCloudStatus?: string;
  /** LumaForge local launch tracking timestamp */
  localLastPlayedAt?: number;
  /** LumaForge local playtimeMinutes */
  localPlaytimeMinutes?: number;
  /** Real achievement count unlocked (only if parsed) */
  achievementUnlocked?: number;
  /** Real achievement total (only if parsed) */
  achievementTotal?: number;
  /** User-set completion status: "completed" | "in-progress" | "not-played" */
  completionStatus?: string;
  /** Whether metadata says Steam Achievements is supported */
  achievementsSupported?: boolean;
  /** User-defined favorite flag */
  isFavorite?: boolean;
  /** Standalone mode: launched via Goldberg/GSE without Steam, crack achievements */
  isStandalone?: boolean;
  /** Debrid-specific install status: "waiting-installer" | "installing" | "needs-path" | "ready" */
  debridStatus?: string;
};

export type LibraryFilter = "all" | "steam" | "local" | "lua" | "epic" | "gog" | "debrid" | "installed" | "uninstalled" | "lua-ready" | "disabled";
export type LibrarySort = "name" | "appid" | "modified" | "size" | "recent";
