/**
 * Service Interfaces — Contracts for extension lifecycle services.
 *
 * These interfaces define the boundaries between different concerns
 * in the extension system. Implementations will be provided later.
 *
 * Services do NOT depend on each other — they are independent.
 */

import type {
  ExtensionId,
  ExtensionStatus,
  ExtensionDetectionResult,
  ExtensionOperationOptions,
  ExtensionOperationResult,
} from "../types";

// ---------------------------------------------------------------------------
// Version Service
// ---------------------------------------------------------------------------

/**
 * Responsible for detecting and comparing extension versions.
 */
export interface VersionService {
  /** Get the version currently installed on disk. */
  getInstalledVersion(extensionId: ExtensionId, hostPath: string): Promise<string | null>;
  /** Get the latest version available from the release provider. */
  getLatestVersion(extensionId: ExtensionId): Promise<string | null>;
  /** Check if an update is available. */
  isUpdateAvailable(extensionId: ExtensionId, hostPath: string): Promise<boolean>;
  /** Parse a version tag into a comparable version string. */
  parseVersionTag(tag: string): string | null;
}

// ---------------------------------------------------------------------------
// Status Service
// ---------------------------------------------------------------------------

/**
 * Responsible for detecting extension status from disk.
 */
export interface StatusService {
  /** Detect the current status of an extension. */
  detectStatus(extensionId: ExtensionId, hostPath: string): Promise<ExtensionDetectionResult>;
  /** Get the current status of an extension. */
  getStatus(extensionId: ExtensionId, hostPath: string): Promise<ExtensionStatus>;
  /** Check if an extension is fully installed (all managed files present). */
  isFullyInstalled(extensionId: ExtensionId, hostPath: string): Promise<boolean>;
  /** Check if an extension is enabled (files are active, not renamed to .bak). */
  isEnabled(extensionId: ExtensionId, hostPath: string): Promise<boolean>;
  /** Invalidate cached status for an extension. */
  invalidateCache(extensionId: ExtensionId): void;
}

// ---------------------------------------------------------------------------
// Validation Service
// ---------------------------------------------------------------------------

/**
 * Responsible for validating extensions and their files.
 */
export interface ValidationService {
  /** Validate that a manifest is well-formed. */
  validateManifest(manifest: unknown): { valid: boolean; errors: string[] };
  /** Validate that installed files match expected checksums. */
  validateFiles(extensionId: ExtensionId, hostPath: string): Promise<{ valid: boolean; corrupted: string[] }>;
  /** Validate that the host meets minimum version requirements. */
  validateHostCompatibility(manifest: { minimumHostVersion?: string }): { compatible: boolean; reason?: string };
}

// ---------------------------------------------------------------------------
// Installer Service
// ---------------------------------------------------------------------------

/**
 * Responsible for downloading and extracting extension files.
 */
export interface InstallerService {
  /** Download and extract an extension. */
  install(extensionId: ExtensionId, options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  /** Update an extension to the latest version. */
  update(extensionId: ExtensionId, options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
  /** Uninstall an extension (remove files). */
  uninstall(extensionId: ExtensionId, options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
}

// ---------------------------------------------------------------------------
// Update Service
// ---------------------------------------------------------------------------

/**
 * Responsible for checking for and applying updates.
 */
export interface UpdateService {
  /** Check if an update is available for an extension. */
  checkForUpdate(extensionId: ExtensionId): Promise<{ available: boolean; currentVersion: string | null; latestVersion: string | null }>;
  /** Check for updates across all installed extensions. */
  checkAllUpdates(hostPath: string): Promise<Array<{ extensionId: ExtensionId; available: boolean; currentVersion: string | null; latestVersion: string | null }>>;
  /** Apply an update to a specific extension. */
  applyUpdate(extensionId: ExtensionId, options: ExtensionOperationOptions): Promise<ExtensionOperationResult>;
}
