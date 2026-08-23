/**
 * LumaForge Extension Specification v1
 *
 * This is the official public contract for the LumaForge Extension Platform.
 * Every extension must conform to this specification.
 * Future schema versions must remain backwards-compatible.
 *
 * Design principles:
 * - Declarative: extensions describe themselves, the launcher performs operations
 * - Strongly typed: every field has a clear type and validation rule
 * - Extensible: new fields may be added without breaking existing extensions
 * - Versioned: schemaVersion enables coexistence of multiple formats
 * - No arbitrary executable code: extensions never run code directly
 *
 * Dependencies: NONE (pure types, no imports).
 *
 * @schemaVersion 1
 */

// =============================================================================
// SECTION 1: Schema Versioning
// =============================================================================

/**
 * The schema version of the extension manifest.
 * The launcher uses this to determine how to parse and validate the manifest.
 *
 * Rules:
 * - Must be a positive integer.
 * - Current valid value: 1.
 * - Future versions must be backwards-compatible with v1.
 * - Extensions using unknown schema versions are rejected.
 */
export type SchemaVersion = 1;

// =============================================================================
// SECTION 2: Extension Identity
// =============================================================================

/**
 * Unique extension identifier.
 *
 * Rules:
 * - Must be lowercase ASCII alphanumeric with hyphens only.
 * - Must match: /^[a-z0-9][a-z0-9-]{0,63}$/
 * - Must be globally unique across all repositories.
 * - Once published, the id is immutable.
 * - Examples: "opendeck", "goldberg-emulator", "steamgriddb"
 */
export type ExtensionId = string; // validated by regex

/**
 * Extension name (internal, machine-readable).
 *
 * Rules:
 * - Must match: /^[a-z0-9][a-z0-9-]{0,63}$/
 * - Should match the extension id.
 * - Used for directory names and file paths.
 */
export type ExtensionName = string; // validated by regex

// =============================================================================
// SECTION 3: Semantic Versioning
// =============================================================================

/**
 * Semantic version string conforming to SemVer 2.0.0.
 *
 * Format: MAJOR.MINOR.PATCH[-prerelease][+build]
 *
 * Rules:
 * - Must match: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
 * - MAJOR: breaking changes
 * - MINOR: new features (backwards-compatible)
 * - PATCH: bug fixes (backwards-compatible)
 * - Prerelease: "alpha", "beta", "rc.1", etc.
 *
 * Comparison rules (from lowest to highest):
 * 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2
 * < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0
 */
export type SemVer = string; // validated by regex

// =============================================================================
// SECTION 4: Permissions
// =============================================================================

/**
 * Permission granted to an extension.
 *
 * Permissions follow a namespace.action pattern.
 * Extensions must declare all permissions they require.
 * The launcher prompts the user for consent before installation.
 *
 * Namespace hierarchy:
 *   filesystem.*   — file and directory operations
 *   network.*      — network access
 *   steam.*        — Steam platform integration
 *   system.*       — system-level operations
 *   ui.*           — user interface extensions
 *   future.*       — reserved for upcoming permission types
 *
 * Wildcards:
 *   "filesystem.*"  grants all filesystem permissions.
 *   "network.*"     grants all network permissions.
 *   "*"             grants all permissions (requires explicit user consent).
 */
export type Permission =
  // Filesystem
  | "filesystem.read"       // Read files from the host path
  | "filesystem.write"      // Write files to the host path
  | "filesystem.delete"     // Delete files from the host path
  | "filesystem.*"          // All filesystem permissions

  // Network
  | "network.http"          // Make HTTP/HTTPS requests
  | "network.websocket"     // Open WebSocket connections
  | "network.*"             // All network permissions

  // Steam
  | "steam.appdata"         // Access Steam appdata directories
  | "steam.config"          // Read Steam configuration
  | "steam.appmanifest"     // Read appmanifest files
  | "steam.*"               // All Steam permissions

  // System
  | "system.processes"      // Detect running processes
  | "system.registry"       // Access system registry (Windows)
  | "system.*"              // All system permissions

  // UI
  | "ui.settings"           // Add settings sections
  | "ui.dashboard"          // Add dashboard widgets
  | "ui.sidebar"            // Add sidebar items
  | "ui.notifications"      // Show notifications
  | "ui.*"                  // All UI permissions

  // Meta
  | "*";                    // All permissions (requires explicit consent)

/**
 * Permission declaration in a manifest.
 */
export interface PermissionEntry {
  /** The permission identifier. */
  id: Permission;
  /** Human-readable description of why this permission is needed. */
  reason?: string;
  /** Whether this permission is optional (defaults to false). */
  optional?: boolean;
}

// =============================================================================
// SECTION 5: Capabilities
// =============================================================================

/**
 * Capability that an extension provides to the launcher.
 *
 * Capabilities are extensible — new values may be added in future schema
 * versions without breaking existing extensions. The launcher treats
 * unknown capabilities as informational only.
 *
 * Convention: use lowercase-kebab-case.
 */
export type Capability = string; // extensible, validated by pattern /^[a-z][a-z0-9-]*$/

/**
 * Well-known capabilities (non-exhaustive, for documentation):
 *
 * "steam-tool"           — Modifies Steam runtime behavior
 * "metadata-provider"    — Provides game metadata (IGDB, SteamGridDB)
 * "save-manager"         — Manages game save files
 * "achievement-provider" — Provides achievement data/tracking
 * "launcher-integration" — Integrates with the launcher UI
 * "network-service"      — Provides network functionality
 * "overlay"              — Renders an in-game overlay
 * "game-detection"       — Detects installed games
 * "backup-provider"      — Provides backup functionality
 * "media-provider"       — Provides game artwork/media
 * "lua-runtime"          — Provides Lua script execution
 */

/**
 * Capability declaration in a manifest.
 */
export interface CapabilityEntry {
  /** The capability identifier. */
  id: Capability;
  /** Version of this capability the extension implements. */
  version?: string;
  /** Human-readable description of what this capability provides. */
  description?: string;
}

// =============================================================================
// SECTION 6: Managed Files
// =============================================================================

/**
 * Strategy for handling file replacement during install/update.
 */
export type FileReplaceStrategy =
  | "always"     // Always overwrite the existing file
  | "if-newer"   // Only overwrite if the new file is newer
  | "if-different" // Only overwrite if content differs
  | "never";     // Never overwrite (skip if exists)

/**
 * Strategy for handling file backup during enable/disable.
 */
export type FileBackupStrategy =
  | "rename"     // Rename file (e.g. .dll → .dll.bak)
  | "copy"       // Copy to .bak, leave original
  | "none"       // No backup (file is deleted on disable)
  | "custom";    // Extension handles its own backup

/**
 * Strategy for validating a managed file after installation.
 */
export type FileValidationStrategy =
  | "exists"     // Check file exists on disk
  | "checksum"   // Verify SHA-256 checksum
  | "size"       // Verify file size matches
  | "none";      // No validation

/**
 * Descriptor for a single file managed by an extension.
 *
 * Extensions declare files declaratively. The launcher interprets these
 * descriptors to perform file operations. Extensions never execute
 * arbitrary file operations.
 */
export interface ManagedFileDescriptor {
  /** Relative path from the extension's install directory. */
  path: string;
  /** Whether this file is required (defaults to true). */
  required?: boolean;
  /** Whether this file is optional (defaults to false). */
  optional?: boolean;
  /** How to handle replacement during updates. */
  replaceStrategy?: FileReplaceStrategy;
  /** How to handle backup during enable/disable. */
  backupStrategy?: FileBackupStrategy;
  /** How to validate the file after installation. */
  validationStrategy?: FileValidationStrategy;
  /** Expected SHA-256 checksum (when validationStrategy is "checksum"). */
  checksum?: string;
  /** Expected file size in bytes (when validationStrategy is "size"). */
  expectedSize?: number;
  /** Whether this file is an executable (DLL, EXE). */
  isExecutable?: boolean;
  /** Whether this file should be excluded from version control. */
  excludeFromVcs?: boolean;
}

// =============================================================================
// SECTION 7: Installation Strategies
// =============================================================================

/**
 * Installation strategy for the extension.
 *
 * The launcher interprets these strategies to perform installation.
 * Extensions never execute arbitrary code.
 */
export type InstallStrategyType =
  | "transaction-copy"    // Copy files from source to target (atomic with rollback)
  | "transaction-move"    // Move files from source to target (atomic with rollback)
  | "transaction-rename"  // Rename files (e.g. .bak → .dll)
  | "transaction-extract" // Extract archive (ZIP, etc.) to target
  | "transaction-replace" // Replace entire directory contents
  | "custom";             // Custom strategy (extension provides manifest only, launcher decides)

/**
 * Installation strategy declaration.
 */
export interface InstallStrategy {
  /** The strategy type. */
  type: InstallStrategyType;
  /** Strategy-specific configuration. */
  config?: Record<string, unknown>;
}

// =============================================================================
// SECTION 8: Enable/Disable Strategies
// =============================================================================

/**
 * Strategy for enabling/disabling the extension.
 */
export type ToggleStrategyType =
  | "rename"      // Rename files (e.g. .dll ↔ .dll.bak)
  | "configuration" // Toggle via configuration file
  | "service"     // Start/stop as a service
  | "none"        // No enable/disable (always active when installed)
  | "custom";     // Custom strategy

/**
 * Enable/disable strategy declaration.
 */
export interface ToggleStrategy {
  /** The strategy type. */
  type: ToggleStrategyType;
  /** Strategy-specific configuration. */
  config?: Record<string, unknown>;
}

// =============================================================================
// SECTION 9: Update Strategies
// =============================================================================

/**
 * Strategy for updating the extension.
 */
export type UpdateStrategyType =
  | "replace"     // Replace all files with new version
  | "patch"       // Apply incremental patch
  | "download"    // Download full package from release provider
  | "custom";     // Custom strategy

/**
 * Update strategy declaration.
 */
export interface UpdateStrategy {
  /** The strategy type. */
  type: UpdateStrategyType;
  /** Strategy-specific configuration. */
  config?: Record<string, unknown>;
  /** Whether to automatically check for updates. */
  autoCheck?: boolean;
  /** Whether to automatically install updates. */
  autoInstall?: boolean;
}

// =============================================================================
// SECTION 10: Release Providers
// =============================================================================

/**
 * Supported release provider types.
 */
export type ReleaseProviderType =
  | "github"    // GitHub Releases
  | "http"      // Generic HTTP endpoint
  | "git"       // Git repository
  | "local"     // Local directory
  | "mirror"    // Mirror/duplicate of another provider
  | "custom";   // Custom provider

/**
 * Reference to a release provider configuration.
 *
 * Each provider type has its own required config fields.
 * The launcher validates the config against the provider type.
 */
export interface ReleaseProviderRef {
  /** Provider type identifier. */
  provider: ReleaseProviderType;
  /** Provider-specific configuration. */
  config: Record<string, unknown>;
}

// GitHub provider config
export interface GitHubReleaseProviderConfig {
  owner: string;
  repo: string;
  /** Release tag pattern (e.g. "v*" for all tags starting with v). */
  tagPattern?: string;
  /** Asset name pattern (e.g. "*.zip" for ZIP files). */
  assetPattern?: string;
  /** Pre-release inclusion. */
  includePrereleases?: boolean;
}

// HTTP provider config
export interface HttpReleaseProviderConfig {
  /** Base URL for fetching releases. */
  baseUrl: string;
  /** URL template for manifest (e.g. "{baseUrl}/{version}/manifest.json"). */
  manifestUrl?: string;
  /** URL template for assets. */
  assetUrl?: string;
}

// =============================================================================
// SECTION 11: Extension Manifest (v1)
// =============================================================================

/**
 * Complete extension manifest specification (schema version 1).
 *
 * This is the single source of truth for extension metadata.
 * Every field is documented with its validation rules.
 *
 * Required fields: schemaVersion, id, name, displayName, description, version.
 * All other fields are optional with defined defaults.
 */
export interface ExtensionManifestV1 {
  // -- Schema ----------------------------------------------------------------
  /** Schema version. Must be 1. */
  schemaVersion: 1;

  // -- Identity --------------------------------------------------------------
  /** Globally unique extension identifier. Regex: /^[a-z0-9][a-z0-9-]{0,63}$/ */
  id: ExtensionId;
  /** Machine-readable name. Should match id. */
  name: ExtensionName;
  /** Human-readable display name. Max 128 characters. */
  displayName: string;
  /** Short description. Max 256 characters. */
  description: string;
  /** Longer description in Markdown. Max 16384 characters. */
  longDescription?: string;
  /** Summary — one-line tagline. Max 128 characters. */
  summary?: string;

  // -- Versioning ------------------------------------------------------------
  /** SemVer 2.0.0 version string. */
  version: SemVer;
  /** Minimum launcher version required (SemVer). */
  minimumLauncherVersion?: SemVer;
  /** Maximum launcher version supported (SemVer). */
  maximumLauncherVersion?: SemVer;

  // -- Authorship ------------------------------------------------------------
  /** Author name or organization. */
  author?: string;
  /** Author email. */
  authorEmail?: string;
  /** Homepage URL. */
  homepage?: string;
  /** Repository URL (source code). */
  repository?: string;
  /** License identifier (SPDX recommended). */
  license?: string;

  // -- Assets ----------------------------------------------------------------
  /** Icon filename (relative to extension directory). */
  icon?: string;
  /** Banner filename (relative to extension directory). */
  banner?: string;
  /** Screenshots (relative to extension directory). */
  screenshots?: string[];

  // -- Categorization --------------------------------------------------------
  /** Categories (max 3). */
  categories?: string[];
  /** Tags for search/discovery. */
  tags?: string[];

  // -- File Management -------------------------------------------------------
  /** Files managed by this extension. */
  managedFiles: ManagedFileDescriptor[];

  // -- Permissions & Capabilities --------------------------------------------
  /** Permissions required by this extension. */
  permissions?: PermissionEntry[];
  /** Capabilities provided by this extension. */
  capabilities?: CapabilityEntry[];

  // -- Strategies ------------------------------------------------------------
  /** Installation strategy. */
  installStrategy?: InstallStrategy;
  /** Enable/disable strategy. */
  toggleStrategy?: ToggleStrategy;
  /** Update strategy. */
  updateStrategy?: UpdateStrategy;

  // -- Release Provider ------------------------------------------------------
  /** How to fetch releases/updates. */
  releaseProvider?: ReleaseProviderRef;

  // -- Behavior --------------------------------------------------------------
  /** Behavioral effects when enabled (host-specific). */
  behavior?: ExtensionBehavior;

  // -- Criteria --------------------------------------------------------------
  /** Declarative criteria for matching extensions to games. */
  criteria?: CriteriaDeclaration;

  // -- Validation ------------------------------------------------------------
  /** Validation rules for this extension. */
  validation?: ExtensionValidation;

  // -- Extension Metadata ----------------------------------------------------
  /** Arbitrary key-value metadata. */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// SECTION 12: Extension Behavior
// =============================================================================

/**
 * Behavioral effects an extension declares when enabled.
 * The host application reads these to adjust its own behavior.
 *
 * Well-known behavior keys:
 * - "injectsDll": extension injects DLLs into the Steam process
 * - "modifiesStorePage": extension modifies the Steam Store page
 * - "addsGameEntries": extension adds games to the library
 * - "capabilities": capabilities this behavior enables
 */
export interface ExtensionBehavior {
  /** Extension injects DLLs into the Steam process. */
  injectsDll?: boolean;
  /** Extension modifies the Steam Store page. */
  modifiesStorePage?: boolean;
  /** Extension adds games to the library. */
  addsGameEntries?: boolean;
  /** Capabilities that this behavior enables (e.g. "steam-tool"). */
  capabilities?: string[];
  /** Future: arbitrary key-value pairs for host-specific behaviors. */
  [key: string]: unknown;
}

// =============================================================================
// SECTION 13: Criteria Declaration
// =============================================================================

/**
 * Declarative criteria for matching extensions to games.
 *
 * The framework reads `criteria.detection` from the manifest to determine
 * which games an extension applies to — purely from manifest data, with
 * zero hardcoded ID branching.
 *
 * Each criteria type describes a different matching strategy:
 * - "files_presence": game install dir must contain all listed files
 * - Future: "steam_appid", "provider", "capability", etc.
 */
export interface CriteriaDeclaration {
  /** Detection criteria — what must be true for this extension to apply. */
  detection?: DetectionCriteria;
}

/**
 * Detection criteria types.
 * Extensible union — add new types without breaking existing manifests.
 */
export type DetectionCriteria = FilesPresenceCriteria;

/**
 * Files-presence criteria: game's install directory must contain
 * all files in the `paths` array. Relative paths are resolved
 * against the game's install directory root.
 */
export interface FilesPresenceCriteria {
  type: "files_presence";
  /** File paths (relative to game install dir) that must all exist. */
  paths: string[];
}

// =============================================================================
// SECTION 14: Extension Validation
// =============================================================================

/**
 * Validation rules for an extension.
 */
export interface ExtensionValidation {
  /** Expected checksum of the manifest file itself. */
  manifestChecksum?: string;
  /** Expected checksum of the extension package. */
  packageChecksum?: string;
  /** Required files that must exist after installation. */
  requiredFiles?: string[];
  /** Maximum total size in bytes. */
  maxTotalSize?: number;
}

// =============================================================================
// SECTION 15: Runtime Types
// =============================================================================

/**
 * Lifecycle status of an extension.
 */
export type ExtensionStatus =
  | "available"       // Discoverable but not installed
  | "installing"      // Download/extraction in progress
  | "installed"       // All managed files present on disk
  | "enabled"         // Active (files are .dll, not .dll.bak)
  | "disabled"        // Installed but toggled off
  | "updating"        // Update in progress
  | "error"           // Last operation failed
  | "uninstalling";   // Removal in progress

/**
 * Operation currently being performed on an extension.
 */
export type ExtensionOperation =
  | "idle"
  | "installing"
  | "updating"
  | "enabling"
  | "disabling"
  | "uninstalling"
  | "detecting"
  | "error";

/**
 * Result of detecting an extension's current state on disk.
 */
export interface ExtensionDetectionResult {
  status: ExtensionStatus;
  installedFiles: string[];
  missingFiles: string[];
  backupFiles: string[];
  installedVersion: string | null;
}

/**
 * Version information for an extension.
 */
export interface ExtensionVersionInfo {
  installedVersion: string | null;
  latestVersion: string | null;
}

/**
 * Options passed to every extension operation.
 */
export interface ExtensionOperationOptions {
  /** Host application root path (e.g. Steam root). */
  hostPath: string;
  /** Optional temp directory for downloads. */
  tempPath?: string;
  /** Force re-download even if file exists. */
  force?: boolean;
}

/**
 * Result of any extension operation.
 */
export interface ExtensionOperationResult {
  success: boolean;
  error?: string;
  affectedFiles?: string[];
  rolledBack?: boolean;
  /** True when the operation failed because a managed file is locked by a running process. */
  fileLocked?: boolean;
  installedVersion?: string | null;
}

// =============================================================================
// SECTION 16: Extension Runtime Interface
// =============================================================================

/**
 * The runtime interface every extension must implement.
 * This is the contract between the manager and the extension.
 */
export interface Extension {
  readonly manifest: ExtensionManifestV1;
  detect(hostPath: string): Promise<ExtensionDetectionResult>;
  install(options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  update(options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  enable(options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  disable(options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  uninstall(options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  getInstalledVersion(hostPath: string): Promise<string | null>;
  getLatestVersion(): Promise<string | null>;
  getStatus(hostPath: string): Promise<ExtensionStatus>;
  getBehavior?(): ExtensionBehavior;
}

// =============================================================================
// SECTION 17: Repository Specification
// =============================================================================

/**
 * Repository index entry for a single extension.
 */
export interface RepositoryExtensionEntry {
  /** Extension id. */
  id: ExtensionId;
  /** Display name. */
  displayName: string;
  /** Short description. */
  description: string;
  /** Latest version. */
  version: SemVer;
  /** Author. */
  author?: string;
  /** Categories. */
  categories?: string[];
  /** Tags. */
  tags?: string[];
  /** Icon URL (relative to repository root). */
  icon?: string;
  /** Manifest URL (relative to repository root). */
  manifestUrl: string;
  /** Minimum launcher version. */
  minimumLauncherVersion?: SemVer;
  /** Capabilities provided. */
  capabilities?: string[];
  /** Whether this extension is verified/trusted. */
  verified?: boolean;
}

/**
 * Repository index (index.json).
 *
 * The launcher fetches this file to discover available extensions.
 * Multiple repositories can be configured, each with its own index.
 */
export interface RepositoryIndex {
  /** Schema version of the repository format. */
  schemaVersion: 1;
  /** Repository identifier. */
  id: string;
  /** Human-readable repository name. */
  name: string;
  /** Repository description. */
  description?: string;
  /** Repository homepage. */
  homepage?: string;
  /** Repository maintainer. */
  maintainer?: string;
  /** Repository version. */
  version: SemVer;
  /** When the index was last updated. */
  updatedAt: string;
  /** Available extensions. */
  extensions: RepositoryExtensionEntry[];
}

// =============================================================================
// SECTION 18: Source Specification
// =============================================================================

/**
 * Source type identifier.
 */
export type SourceType =
  | "builtin"      // Extensions bundled with the launcher
  | "repository"   // Official or community repository
  | "directory"    // Local directory scan
  | "manifest"     // Single manifest file
  | "url"          // Direct URL to a manifest
  | "git"          // Git repository
  | "custom";      // Custom source type

/**
 * Source configuration.
 */
export interface ExtensionSourceConfig {
  /** Unique source identifier. */
  id: string;
  /** Human-readable source name. */
  displayName: string;
  /** Source type. */
  type: SourceType;
  /** Priority (lower = higher priority, default 100). */
  priority?: number;
  /** Whether this source is enabled. */
  enabled?: boolean;
  /** Source-specific configuration. */
  config?: Record<string, unknown>;
}

// =============================================================================
// SECTION 19: Validation Rules
// =============================================================================

/**
 * Validation rule for manifest fields.
 */
export interface ValidationRule {
  /** Field path to validate (e.g. "id", "version", "permissions[0].id"). */
  field: string;
  /** Validation type. */
  type: "required" | "regex" | "minLength" | "maxLength" | "min" | "max" | "enum" | "custom";
  /** Expected value or pattern. */
  value?: string | number | string[];
  /** Error message if validation fails. */
  message: string;
}

/**
 * Well-known validation patterns.
 */
export const VALIDATION_PATTERNS = {
  /** Extension ID: lowercase alphanumeric with hyphens. */
  EXTENSION_ID: /^[a-z0-9][a-z0-9-]{0,63}$/,
  /** Extension name: same as ID. */
  EXTENSION_NAME: /^[a-z0-9][a-z0-9-]{0,63}$/,
  /** SemVer 2.0.0. */
  SEMVER: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  /** Capability: lowercase kebab-case. */
  CAPABILITY: /^[a-z][a-z0-9-]*$/,
  /** Permission namespace: dot-separated lowercase. */
  PERMISSION: /^(filesystem|network|steam|system|ui|future|\*)\.\*|^[a-z]+\.[a-z.]+$/,
  /** SPDX license identifier. */
  LICENSE: /^[A-Za-z0-9\-+.]+$/,
  /** URL. */
  URL: /^https?:\/\/.+/,
  /** Relative file path. */
  RELATIVE_PATH: /^(?!\/)(?!.*\.\.\/)[a-zA-Z0-9._\-/]+$/,
} as const;

/**
 * Maximum lengths for string fields.
 */
export const MAX_LENGTHS = {
  EXTENSION_ID: 64,
  EXTENSION_NAME: 64,
  DISPLAY_NAME: 128,
  DESCRIPTION: 256,
  SUMMARY: 128,
  LONG_DESCRIPTION: 16384,
  AUTHOR: 128,
  VERSION: 32,
  TAG: 32,
  CATEGORY: 32,
} as const;
