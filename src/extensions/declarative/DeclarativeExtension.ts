/**
 * Declarative Extension — Generic Extension driven purely by manifest data.
 *
 * Given an ExtensionManifestV1 with managedFiles, installStrategy,
 * toggleStrategy, releaseProvider, etc., this class performs all
 * lifecycle operations (detect/install/enable/disable/update/uninstall)
 * using the existing generic services — no per-extension hand-written code.
 *
 * Reused as-is:
 * - TransactionManager (executeTransaction, createBatchRenameStep, createRemoveStep, etc.)
 * - extensionTauri (extensionFileExists, extensionDownloadFile, extensionExtractZip, extensionRenameFile, extensionGetDllVersion)
 * - githubReleaseService (fetchReleasesFromConfig, selectLatestMatchingRelease, findAssetForConfig, compareVersions)
 */

import type {
  Extension,
  ExtensionManifestV1,
  ExtensionDetectionResult,
  ExtensionOperationOptions,
  ExtensionOperationResult,
  ExtensionStatus,
  ExtensionBehavior,
  ManagedFileDescriptor,
  GitHubReleaseProviderConfig,
} from "../types";

import {
  executeTransaction,
  createBatchRenameStep,
  createRemoveStep,
  fileExists,
} from "../services/transactionManager";

import {
  extensionFileExists,
  extensionDownloadFile,
  extensionExtractZip,
  extensionRenameFile,
  extensionGetDllVersion,
} from "../services/extensionTauri";

import {
  fetchReleasesFromConfig,
  selectLatestMatchingRelease,
  findAssetForConfig,
  buildRepoSlug,
} from "../services/githubReleaseService";

// =============================================================================
// Helpers
// =============================================================================

/** Resolve the full path of a managed file relative to hostPath. */
function resolvePath(hostPath: string, descriptor: ManagedFileDescriptor): string {
  return `${hostPath}\\${descriptor.path}`;
}

/** Build the .bak variant path for a managed file. */
function bakPath(fullPath: string): string {
  return `${fullPath}.bak`;
}

/** Extract GitHubReleaseProviderConfig from manifest, or null. */
function extractGitHubConfig(manifest: ExtensionManifestV1): GitHubReleaseProviderConfig | null {
  const rp = manifest.releaseProvider;
  if (rp?.provider === "github" && rp.config) {
    const c = rp.config as Record<string, unknown>;
    if (typeof c.owner === "string" && typeof c.repo === "string") {
      return {
        owner: c.owner,
        repo: c.repo,
        tagPattern: typeof c.tagPattern === "string" ? c.tagPattern : undefined,
        assetPattern: typeof c.assetPattern === "string" ? c.assetPattern : undefined,
        includePrereleases: typeof c.includePrereleases === "boolean" ? c.includePrereleases : undefined,
      };
    }
  }
  return null;
}

/** Files that use the "rename" backup strategy. */
function renameBackupFiles(manifest: ExtensionManifestV1): ManagedFileDescriptor[] {
  return manifest.managedFiles.filter(
    (f) => f.backupStrategy === "rename" || (!f.backupStrategy && f.backupStrategy !== "none" && f.backupStrategy !== "copy" && f.backupStrategy !== "custom")
  );
}

// =============================================================================
// DeclarativeExtension
// =============================================================================

export class DeclarativeExtension implements Extension {
  readonly manifest: ExtensionManifestV1;

  constructor(manifest: ExtensionManifestV1) {
    this.manifest = manifest;
  }

  // -------------------------------------------------------------------------
  // detect
  // -------------------------------------------------------------------------

  async detect(hostPath: string): Promise<ExtensionDetectionResult> {
    const installedFiles: string[] = [];
    const missingFiles: string[] = [];
    const backupFiles: string[] = [];

    for (const descriptor of this.manifest.managedFiles) {
      const fullPath = resolvePath(hostPath, descriptor);
      const bak = bakPath(fullPath);

      const exists = await extensionFileExists(fullPath);
      const bakExists = await extensionFileExists(bak);

      if (exists) {
        installedFiles.push(descriptor.path);
      } else {
        missingFiles.push(descriptor.path);
      }
      if (bakExists) {
        backupFiles.push(descriptor.path);
      }
    }

    const totalManaged = this.manifest.managedFiles.length;
    const allBak = backupFiles.length === totalManaged;
    const noneExist = installedFiles.length === 0 && !allBak;
    const partial = installedFiles.length > 0 && installedFiles.length < totalManaged;

    let status: ExtensionStatus;
    if (totalManaged === 0) {
      status = "available";
    } else if (noneExist && backupFiles.length === 0) {
      status = "available";
    } else if (allBak && installedFiles.length === 0) {
      status = "disabled";
    } else if (installedFiles.length === totalManaged) {
      status = "enabled";
    } else if (partial) {
      status = "installed";
    } else {
      status = "installed";
    }

    return { status, installedFiles, missingFiles, backupFiles, installedVersion: null };
  }

  // -------------------------------------------------------------------------
  // install
  // -------------------------------------------------------------------------

  async install(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    const { hostPath, tempPath, force } = options;

    if (!hostPath) {
      return { success: false, error: "Host path is not configured." };
    }

    // Skip if already fully installed (unless force)
    if (!force) {
      const status = await this.detect(hostPath);
      if (status.installedFiles.length === this.manifest.managedFiles.length) {
        return { success: true };
      }
    }

    const config = extractGitHubConfig(this.manifest);
    if (!config) {
      return { success: false, error: "No release provider configured." };
    }

    // Fetch latest release
    let releases;
    try {
      releases = await fetchReleasesFromConfig(config);
    } catch (err) {
      return { success: false, error: `Failed to fetch releases: ${err instanceof Error ? err.message : String(err)}` };
    }

    const release = selectLatestMatchingRelease(releases, config);
    if (!release) {
      return { success: false, error: "No matching release found." };
    }

    const zipAsset = findAssetForConfig(release, config);
    if (!zipAsset) {
      return { success: false, error: "No downloadable asset found in release." };
    }

    const slug = buildRepoSlug(config);
    const tempDir = tempPath || `${hostPath}\\..\\..\\temp`;
    const zipPath = `${tempDir}\\${slug.split("/")[1]}-${release.tagName}.zip`;
    const extractDir = `${tempDir}\\${slug.split("/")[1]}-${release.tagName}-extracted`;

    const managedPaths = this.manifest.managedFiles.map((f) => f.path);

    const steps = [
      {
        name: "download-release",
        execute: async () => {
          await extensionDownloadFile(zipAsset.browserDownloadUrl, zipPath);
        },
        rollback: async () => {},
      },
      {
        name: "extract-archive",
        execute: async () => {
          const extracted = await extensionExtractZip(zipPath, extractDir, managedPaths);
          if (extracted.length === 0) {
            throw new Error("Extraction completed but no managed files found in the archive.");
          }
        },
        rollback: async () => {},
      },
      {
        name: "copy-to-target",
        execute: async () => {
          for (const descriptor of this.manifest.managedFiles) {
            const sourceFile = `${extractDir}\\${descriptor.path}`;
            const exists = await extensionFileExists(sourceFile);
            if (!exists) {
              if (descriptor.required) {
                throw new Error(`Required file not found in archive: ${descriptor.path}`);
              }
              continue; // skip optional files not in archive
            }
            const destFile = resolvePath(hostPath, descriptor);
            await extensionRenameFile(sourceFile, destFile);
          }
        },
        rollback: async () => {},
      },
      {
        name: "verify-installation",
        execute: async () => {
          for (const descriptor of this.manifest.managedFiles) {
            if (!descriptor.required) continue;
            const fullPath = resolvePath(hostPath, descriptor);
            const exists = await extensionFileExists(fullPath);
            if (!exists) {
              throw new Error(`Verification failed: ${descriptor.path} not found after install.`);
            }
          }
        },
        rollback: async () => {},
      },
    ];

    return executeTransaction({ steps, name: `${this.manifest.id}-install` });
  }

  // -------------------------------------------------------------------------
  // enable
  // -------------------------------------------------------------------------

  async enable(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    const { hostPath } = options;
    if (!hostPath) {
      return { success: false, error: "Host path is not configured." };
    }

    const renames: Array<{ from: string; to: string }> = [];
    for (const descriptor of renameBackupFiles(this.manifest)) {
      const fullBak = bakPath(resolvePath(hostPath, descriptor));
      const fullActive = resolvePath(hostPath, descriptor);
      if (await fileExists(fullBak)) {
        renames.push({ from: fullBak, to: fullActive });
      }
    }

    if (renames.length === 0) {
      return { success: true };
    }

    const steps = [
      createBatchRenameStep(renames, `${this.manifest.id}-enable-rename`),
      {
        name: "verify-enable",
        execute: async () => {
          for (const descriptor of renameBackupFiles(this.manifest)) {
            const fullPath = resolvePath(hostPath, descriptor);
            const exists = await extensionFileExists(fullPath);
            if (!exists && descriptor.required) {
              throw new Error(`Verification failed: ${descriptor.path} not found after enable.`);
            }
          }
        },
        rollback: async () => {},
      },
    ];

    return executeTransaction({ steps, name: `${this.manifest.id}-enable` });
  }

  // -------------------------------------------------------------------------
  // disable
  // -------------------------------------------------------------------------

  async disable(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    const { hostPath } = options;
    if (!hostPath) {
      return { success: false, error: "Host path is not configured." };
    }

    const renames: Array<{ from: string; to: string }> = [];
    for (const descriptor of renameBackupFiles(this.manifest)) {
      const fullActive = resolvePath(hostPath, descriptor);
      const fullBak = bakPath(fullActive);
      if (await fileExists(fullActive)) {
        renames.push({ from: fullActive, to: fullBak });
      }
    }

    if (renames.length === 0) {
      return { success: true };
    }

    const steps = [
      createBatchRenameStep(renames, `${this.manifest.id}-disable-rename`),
      {
        name: "verify-disable",
        execute: async () => {
          for (const descriptor of renameBackupFiles(this.manifest)) {
            const fullBak = bakPath(resolvePath(hostPath, descriptor));
            const exists = await extensionFileExists(fullBak);
            if (!exists && descriptor.required) {
              throw new Error(`Verification failed: ${descriptor.path}.bak not found after disable.`);
            }
          }
        },
        rollback: async () => {},
      },
    ];

    return executeTransaction({ steps, name: `${this.manifest.id}-disable` });
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  async update(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    const { hostPath, tempPath } = options;
    if (!hostPath) {
      return { success: false, error: "Host path is not configured." };
    }

    const currentStatus = await this.detect(hostPath);
    if (currentStatus.status === "available") {
      return { success: false, error: "Extension is not installed. Use install first." };
    }

    const isDisabled = currentStatus.status === "disabled";

    const config = extractGitHubConfig(this.manifest);
    if (!config) {
      return { success: false, error: "No release provider configured." };
    }

    let releases;
    try {
      releases = await fetchReleasesFromConfig(config);
    } catch (err) {
      return { success: false, error: `Failed to fetch releases: ${err instanceof Error ? err.message : String(err)}` };
    }

    const release = selectLatestMatchingRelease(releases, config);
    if (!release) {
      return { success: false, error: "No matching release found." };
    }

    const zipAsset = findAssetForConfig(release, config);
    if (!zipAsset) {
      return { success: false, error: "No downloadable asset found in release." };
    }

    const slug = buildRepoSlug(config);
    const tempDir = tempPath || `${hostPath}\\..\\..\\temp`;
    const zipPath = `${tempDir}\\${slug.split("/")[1]}-${release.tagName}.zip`;
    const extractDir = `${tempDir}\\${slug.split("/")[1]}-${release.tagName}-extracted`;

    const managedPaths = this.manifest.managedFiles.map((f) => f.path);

    // Build rename map: extracted → target (or target.bak if disabled)
    const renames: Array<{ from: string; to: string }> = [];
    for (const descriptor of this.manifest.managedFiles) {
      const sourceFile = `${extractDir}\\${descriptor.path}`;
      const destFile = isDisabled
        ? bakPath(resolvePath(hostPath, descriptor))
        : resolvePath(hostPath, descriptor);
      renames.push({ from: sourceFile, to: destFile });
    }

    const steps = [
      {
        name: "download-release",
        execute: async () => {
          await extensionDownloadFile(zipAsset.browserDownloadUrl, zipPath);
        },
        rollback: async () => {},
      },
      {
        name: "extract-archive",
        execute: async () => {
          const extracted = await extensionExtractZip(zipPath, extractDir, managedPaths);
          if (extracted.length === 0) {
            throw new Error("No managed files found in the extracted archive.");
          }
        },
        rollback: async () => {},
      },
      createBatchRenameStep(renames, `${this.manifest.id}-update-replace`),
      {
        name: "verify-update",
        execute: async () => {
          const suffix = isDisabled ? ".bak" : "";
          for (const descriptor of this.manifest.managedFiles) {
            const fullPath = `${resolvePath(hostPath, descriptor)}${suffix}`;
            const exists = await extensionFileExists(fullPath);
            if (!exists && descriptor.required) {
              throw new Error(`Verification failed: ${descriptor.path}${suffix} not found after update.`);
            }
          }
        },
        rollback: async () => {},
      },
    ];

    return executeTransaction({ steps, name: `${this.manifest.id}-update` });
  }

  // -------------------------------------------------------------------------
  // uninstall
  // -------------------------------------------------------------------------

  async uninstall(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    const { hostPath } = options;
    if (!hostPath) {
      return { success: false, error: "Host path is not configured." };
    }

    const filesToRemove: Array<{ path: string; description: string }> = [];
    for (const descriptor of this.manifest.managedFiles) {
      const fullPath = resolvePath(hostPath, descriptor);
      const fullBak = bakPath(fullPath);
      if (await fileExists(fullPath)) {
        filesToRemove.push({ path: fullPath, description: `remove-${descriptor.path}` });
      }
      if (await fileExists(fullBak)) {
        filesToRemove.push({ path: fullBak, description: `remove-${descriptor.path}.bak` });
      }
    }

    if (filesToRemove.length === 0) {
      return { success: true };
    }

    const steps = [
      ...filesToRemove.map((f) => createRemoveStep(f.path, f.description)),
      {
        name: "verify-uninstall",
        execute: async () => {
          for (const descriptor of this.manifest.managedFiles) {
            const fullPath = resolvePath(hostPath, descriptor);
            const fullBak = bakPath(fullPath);
            if (await fileExists(fullPath) || await fileExists(fullBak)) {
              throw new Error(
                `Verification failed: ${descriptor.path} or ${descriptor.path}.bak still exists after uninstall.`
              );
            }
          }
        },
        rollback: async () => {},
      },
    ];

    return executeTransaction({ steps, name: `${this.manifest.id}-uninstall` });
  }

  // -------------------------------------------------------------------------
  // getInstalledVersion
  // -------------------------------------------------------------------------

  async getInstalledVersion(hostPath: string): Promise<string | null> {
    // Try PE header on executable managed files
    for (const descriptor of this.manifest.managedFiles) {
      if (descriptor.isExecutable) {
        const version = await extensionGetDllVersion(hostPath, descriptor.path);
        if (version) return version;
      }
    }
    // Fall back to manifest version when files are present but have no PE version
    const status = await this.detect(hostPath);
    if (status.installedFiles.length > 0 && this.manifest.version) {
      return this.manifest.version;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // getLatestVersion
  // -------------------------------------------------------------------------

  async getLatestVersion(): Promise<string | null> {
    const config = extractGitHubConfig(this.manifest);
    if (!config) return null;

    try {
      const releases = await fetchReleasesFromConfig(config);
      const release = selectLatestMatchingRelease(releases, config);
      return release?.tagName ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  async getStatus(hostPath: string): Promise<ExtensionStatus> {
    const result = await this.detect(hostPath);
    return result.status;
  }

  // -------------------------------------------------------------------------
  // getBehavior (from manifest)
  // -------------------------------------------------------------------------

  getBehavior(): ExtensionBehavior {
    return this.manifest.behavior ?? ({} as ExtensionBehavior);
  }
}
