/**
 * Emulator definitions - Types
 *
 * Based on Playnite's emulation system but adapted for LumaForge.
 * Defines platforms, emulators, profiles, and scan configurations.
 */

/**
 * A gaming platform/console that can be emulated.
 */
export type EmulatorPlatform = {
  /** Unique platform identifier (e.g., "nintendo_super_nes") */
  id: string;
  /** Display name (e.g., "Super Nintendo Entertainment System") */
  name: string;
  /** Short name for UI (e.g., "SNES") */
  shortName: string;
  /** IGDB platform ID for metadata lookup */
  igdbId?: number;
  /** Database names for ROM matching (e.g., "Nintendo - Super Nintendo Entertainment System") */
  databases?: string[];
  /** IDs of emulators that support this platform */
  emulatorIds: string[];
};

/**
 * A specific configuration profile for a built-in emulator definition.
 * For example, RetroArch has different profiles for each core.
 */
export type EmulatorProfile = {
  /** Profile name (e.g., "Snes9x", "BSNES") */
  name: string;
  /** Command-line arguments template. Placeholders: {ImagePath}, {ImageName}, {ImageNameNoExt} */
  startupArguments: string;
  /** Platform IDs this profile supports */
  platforms: string[];
  /** Supported ROM file extensions (without dot) */
  imageExtensions: string[];
  /** Regex pattern to match the emulator executable (e.g., "^retroarch\\.exe$") */
  startupExecutable: string;
  /** Required files for this profile (e.g., core DLLs) */
  profileFiles?: string[];
  /** Whether this profile uses a script to start games instead of normal launch */
  scriptStartup?: boolean;
  /** Whether this profile uses a script to import games */
  scriptGameImport?: boolean;
};

/**
 * An emulator definition with all its profiles.
 * These are built-in definitions loaded from YAML/JSON data.
 */
export type EmulatorDefinition = {
  /** Unique emulator identifier (e.g., "retroarch") */
  id: string;
  /** Display name (e.g., "RetroArch") */
  name: string;
  /** Official website URL */
  website?: string;
  /** Available profiles for this emulator */
  profiles: EmulatorProfile[];
};

/**
 * Tracking mode for detecting if a game is running.
 */
export type TrackingMode = "default" | "process" | "folder";

/**
 * User-configured emulator profile.
 * Can be built-in (linked to an EmulatorDefinition profile) or fully custom.
 */
export type EmulatorProfileConfig = {
  /** Unique profile identifier (format: "#builtin_<uuid>" or "#custom_<uuid>") */
  id: string;
  /** Display name (e.g., "Snes9x (SNES)", "Custom Profile") */
  name: string;
  /** Whether this is a built-in or custom profile */
  type: "builtin" | "custom";

  // ── Built-in profile fields ──────────────────────────────────
  /** Name of the built-in profile this maps to (e.g., "Snes9x (SNES)") */
  builtinProfileName?: string;
  /** Whether to override the built-in default arguments */
  overrideDefaultArgs?: boolean;
  /** Custom arguments when overriding (e.g., '-f "{ImagePath}"') */
  customArguments?: string;

  // ── Custom profile fields ────────────────────────────────────
  /** Path to the emulator executable */
  executable?: string;
  /** Command-line arguments (e.g., '"{ImagePath}" -f') */
  arguments?: string;
  /** Working directory when launching (e.g., "{EmulatorDir}") */
  workingDirectory?: string;
  /** Supported platform IDs */
  supportedPlatforms: string[];
  /** Supported file extensions without dot (e.g., ["sfc", "smc", "zip"]) */
  supportedFileTypes: string[];
  /** How to detect if the game is running */
  trackingMode: TrackingMode;
  /** Process name or folder path for tracking (depends on trackingMode) */
  trackingPath?: string;

  // ── Scripts (both types) ─────────────────────────────────────
  /** Script executed before emulator starts */
  preScript?: string;
  /** Script executed after emulator starts */
  postScript?: string;
  /** Script executed after emulator exits */
  exitScript?: string;
  /** Startup script (replaces normal launch when present) */
  startupScript?: string;
};

/**
 * User-configured emulator instance.
 * Points to a specific installation of an emulator.
 */
export type EmulatorConfig = {
  /** Unique config identifier (UUID) */
  id: string;
  /** Reference to EmulatorDefinition.id (undefined = manual/no spec) */
  definitionId?: string;
  /** User-friendly name (e.g., "RetroArch - Main") */
  name: string;
  /** Installation directory */
  installDir: string;
  /** User-configured profiles */
  profiles: EmulatorProfileConfig[];
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
};

/**
 * Play action settings for scanner configs.
 */
export type PlayActionSettings = "scanner" | "select_profile" | "select_emulator";

/**
 * Persistent auto-scan configuration for importing ROMs.
 */
export type ScanConfiguration = {
  /** Unique config identifier (UUID) */
  id: string;
  /** Display name (e.g., "SNES ROMs", "PS2 Games") */
  name: string;
  /** Reference to EmulatorConfig.id */
  emulatorId: string;
  /** Reference to EmulatorProfileConfig.id */
  profileId: string;
  /** Directory to scan for ROMs */
  directory: string;
  /** Force-assign this platform to all games (overrides auto-detection) */
  overridePlatformId?: string;
  /** How to handle play actions for imported games */
  playActionSettings: PlayActionSettings;
  /** File patterns to exclude from CRC checksum scan (e.g., ["*.chd"]) */
  crcExcludeFileTypes: string[];
  /** Skip cloud-stored files not downloaded locally */
  excludeOnlineFiles: boolean;
  /** Scan without reading file content */
  useSimplifiedScan: boolean;
  /** Use relative paths for ROM imports */
  importWithRelativePaths: boolean;
  /** Recurse into subdirectories */
  scanSubfolders: boolean;
  /** Scan inside .zip/.7z/.rar archives */
  scanInsideArchives: boolean;
  /** Merge multi-disc/multi-file games into one entry */
  mergeRelatedFiles: boolean;
  /** Include in bulk library update scan */
  includeInGlobalUpdate: boolean;
  /** Files to exclude from scan (relative paths) */
  excludedFiles: string[];
  /** Directories to exclude from scan (relative paths) */
  excludedDirectories: string[];
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
};

/**
 * A ROM game entry in the emulator library.
 */
export type EmulatorGameEntry = {
  /** Unique identifier (format: "emulator:<uuid>") */
  id: string;
  /** Game title */
  title: string;
  /** Platform ID (e.g., "nintendo_super_nes") */
  platform: string;
  /** Full path to the ROM file */
  romPath: string;
  /** Preferred emulator config ID */
  emulatorConfigId?: string;
  /** Emulator profile ID used for import */
  emulatorProfileId?: string;
  /** File size in bytes */
  fileSize?: number;
  /** Region code (e.g., "USA", "EUR", "JPN") */
  region?: string;
  /** Last played timestamp */
  lastPlayedAt?: number;
  /** Total playtime in milliseconds */
  totalPlaytimeMs?: number;
  /** Whether the ROM file exists on disk */
  isInstalled?: boolean;
  /** Source scan folder path */
  scanPath?: string;
  /** Artwork paths */
  coverPath?: string;
  landscapePath?: string;
  backgroundPath?: string;
  logoPath?: string;
  iconPath?: string;
  /** Metadata */
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  description?: string;
  /** User flags */
  isFavorite?: boolean;
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
};
