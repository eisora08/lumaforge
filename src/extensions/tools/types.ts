/**
 * Tool Types — Types for the game-tools system.
 *
 * A "tool" is an extension that provides files to be applied to a game's
 * install directory (e.g. Goldberg, SmokeAPI, Steamless, Online-Fix).
 *
 * Tools are discovered from registered extensions with `surfaces: ["tools"]`
 * in their manifest metadata. The actual tool logic is provided by a
 * DeclarativeTool (manifest-driven) or a hand-written Tool subclass.
 *
 * Dependencies: NONE (pure types).
 */

// =============================================================================
// Tool Identity
// =============================================================================

/** Unique tool identifier (matches extension ID). */
export type ToolId = string;

// =============================================================================
// Tool Status
// =============================================================================

/**
 * Detection status of a tool on a specific game.
 *
 * - "not-applied": tool files are NOT present in the game dir
 * - "applied":     tool files ARE present in the game dir
 * - "partial":     some but not all tool files present (inconsistent state)
 * - "error":       detection failed (I/O error, etc.)
 * - "detecting":   detection in progress
 * - "applying":    apply operation in progress
 * - "reverting":   revert operation in progress
 */
export type ToolGameStatus =
  | "not-applied"
  | "applied"
  | "partial"
  | "error"
  | "detecting"
  | "applying"
  | "reverting";

// =============================================================================
// Tool Detection Result
// =============================================================================

/**
 * Result of detecting whether a tool is applied to a specific game.
 */
export interface ToolDetectionResult {
  /** Whether the tool is fully applied. */
  applied: boolean;
  /** Individual file status: true = present in game dir, false = missing. */
  fileStatus: Record<string, boolean>;
  /** Human-readable status message. */
  message?: string;
}

// =============================================================================
// Tool Apply Result
// =============================================================================

/**
 * Result of applying or reverting a tool on a specific game.
 */
export interface ToolApplyResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** Error message if failed. */
  error?: string;
  /** Files that were written/restored by this operation. */
  affectedFiles: string[];
  /** Whether the operation was rolled back. */
  rolledBack?: boolean;
}

// =============================================================================
// Tool Config (from manifest metadata.toolConfig)
// =============================================================================

/**
 * Tool configuration embedded in an extension manifest's `metadata.toolConfig`.
 *
 * Declares which files the tool provides and how they map to the game dir.
 */
export interface ToolConfig {
  /**
   * Tool operation type (auto-detected from other fields if absent):
   * - "copy-files":   copy files from extension install dir to game dir
   * - "rename-proxy":  rename original DLL → .bak, copy proxy DLL from extension dir
   * - "custom":       tool has hand-written apply/revert logic
   */
  type?: "copy-files" | "rename-proxy" | "custom";

  /**
   * Target directory for files:
   * - "game-folder":  files go into the game's install directory (default)
   * - "steam-root":   files go into the Steam root directory
   */
  target?: "game-folder" | "steam-root";

  /** Human-readable description shown in the Tools UI. */
  description?: string;

  /** Icon name (lucide icon key). */
  icon?: string;

  /**
   * Files managed by this tool.
   * Each entry has `source` (in extension dir) and `target` (in game dir).
   * For rename-proxy: `backupSuffix` on the file overrides the global one.
   */
  files?: ToolManagedFile[];

  /**
   * Additional config files that are ALWAYS copied (no rename/backup).
   */
  configFiles?: ToolManagedFile[];

  /** Category tag for grouping in the UI (e.g. "emulator", "fix", "utility"). */
  category?: string;

  /**
   * For "custom" type: identifies the custom handler.
   * Known values: "goldberg", "steamless", "onlinefix".
   */
  customHandler?: string;

  /**
   * Priority for ordering in the Tools UI (lower = higher priority).
   */
  priority?: number;

  /**
   * Whether to create backups of originals before overwriting.
   */
  backup?: boolean;

  /**
   * Suffix appended to original files when backing up (e.g. ".bak", "_o").
   * Can be overridden per-file via ToolManagedFile.backupSuffix.
   */
  backupSuffix?: string;

  /**
   * Operation mode:
   * - "proxy": proxy DLL mode — rename original steam_api.dll → steam_api.dll_o,
   *            then copy proxy DLL as steam_api.dll
   */
  mode?: "proxy";

  /**
   * Path (relative to extension dir) to an executable to run.
   * When set, the tool runs this executable instead of just copying files.
   */
  executable?: string;

  /**
   * Arguments for the executable. Use `{gameExe}` as placeholder for the
   * main game executable path (basename only, e.g. "game.exe").
   */
  args?: string[];

  /**
   * Whether this tool uses a remote index to find game-specific files.
   * The index is fetched via HTTP GET from `indexUrl` or the releaseProvider.
   */
  usesIndex?: boolean;

  /**
   * Remote index URL (used when `usesIndex` is true).
   * If absent, falls back to releaseProvider info.
   */
  indexUrl?: string;
}

/**
 * A single file managed by a tool.
 */
export interface ToolManagedFile {
  /** Relative path within the extension's install directory. */
  source: string;
  /** Relative path within the game's install directory. */
  target: string;
  /**
   * For rename-proxy: the original filename to back up before replacing.
   * Only used when toolConfig.mode = "proxy".
   */
  originalName?: string;
  /** Whether this file is required (defaults to true). */
  required?: boolean;
  /**
   * Per-file backup suffix override. When set, this suffix is used for
   * the backup of this specific file instead of the global backupSuffix.
   */
  backupSuffix?: string;
}

// =============================================================================
// Tool Interface
// =============================================================================

/**
 * Runtime interface for a tool that can be applied/reverted on games.
 *
 * Implementations:
 * - DeclarativeTool: generic wrapper driven by manifest toolConfig
 * - Hand-written subclasses for custom tools (Goldberg, Steamless, etc.)
 */
export interface Tool {
  /** Tool ID (matches extension ID). */
  readonly id: string;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Short description. */
  readonly description: string;
  /** Owning extension ID. */
  readonly extensionId: string;
  /** Tool category (emulator, fix, utility). */
  readonly category?: string;
  /** Icon name (lucide key). */
  readonly icon?: string;
  /** Display priority (lower = higher). */
  readonly priority?: number;

  /** Detect whether this tool is applied to a game. */
  detect(gameInstallDir: string): Promise<ToolDetectionResult>;
  /** Apply this tool to a game's install directory. */
  apply(gameInstallDir: string, extensionInstallDir: string): Promise<ToolApplyResult>;
  /** Revert this tool from a game's install directory (restore originals). */
  revert(gameInstallDir: string): Promise<ToolApplyResult>;
}

// =============================================================================
// Tool Registry Snapshot
// =============================================================================

/**
 * Snapshot of all registered tools.
 */
export interface ToolRegistrySnapshot {
  tools: Tool[];
  count: number;
}

// =============================================================================
// Constants
// =============================================================================
