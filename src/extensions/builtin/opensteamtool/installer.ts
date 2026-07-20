/**
 * OpenSteamTool Installer — Download, extract, and copy DLLs to Steam root.
 *
 * Ported from the legacy system. Uses GitHub releases to download
 * the latest version, extracts the ZIP, and copies the managed DLLs
 * to the Steam root directory.
 */

import type { ExtensionOperationResult, GitHubReleaseProviderConfig } from "../../types";
import { detect } from "./detector";
import { fetchLatestRelease, findManagedAssets } from "./github";
import { executeTransaction, createBatchRenameStep, createDir } from "../../services/transactionManager";
import {
  extensionFileExists,
  extensionDownloadFile,
  extensionExtractZip,
  extensionRenameFile,
} from "../../services/extensionTauri";

const MANAGED_DLLS = ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"];

export async function install(
  options: { steamRoot: string; tempFolder?: string; releaseProviderConfig?: GitHubReleaseProviderConfig }
): Promise<ExtensionOperationResult> {
  const { steamRoot, tempFolder, releaseProviderConfig } = options;

  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const currentStatus = await detect(steamRoot);
  if (currentStatus.installedFiles.length === MANAGED_DLLS.length) {
    return { success: true };
  }

  if (!releaseProviderConfig) {
    return { success: false, error: "No release provider config available." };
  }

  const release = await fetchLatestRelease(releaseProviderConfig);
  if (!release) {
    return { success: false, error: "No releases found on GitHub." };
  }

  const assets = findManagedAssets(release, releaseProviderConfig);
  if (assets.length === 0) {
    return {
      success: false,
      error: "No managed DLL assets found in the latest release.",
    };
  }

  const tempDir = tempFolder || `${steamRoot}\\..\\..\\temp`;
  const zipPath = `${tempDir}\\opensteamtool-${release.tagName}.zip`;
  const extractDir = `${tempDir}\\opensteamtool-${release.tagName}-extracted`;

  const dllNames = assets.map((a) => a.fileName);
  const downloadedFiles: string[] = [];
  const extractedFiles: string[] = [];
  const copiedFiles: string[] = [];

  const steps = [
    {
      name: "download-release",
      execute: async () => {
        const releaseUrl = assets[0].downloadUrl;
        await extensionDownloadFile(releaseUrl, zipPath);
        downloadedFiles.push(zipPath);
      },
      rollback: async () => {},
    },
    {
      name: "extract-archive",
      execute: async () => {
        const extracted = await extensionExtractZip(zipPath, extractDir, dllNames);
        if (extracted.length === 0) {
          throw new Error(
            "Extraction completed but no managed DLLs found in the archive."
          );
        }
        extractedFiles.push(...extracted);
      },
      rollback: async () => {},
    },
    {
      name: "copy-to-steam-root",
      execute: async () => {
        for (const asset of assets) {
          const sourceFile = `${extractDir}\\${asset.fileName}`;
          const exists = await extensionFileExists(sourceFile);
          if (!exists) {
            throw new Error(`Extracted file not found: ${asset.fileName}`);
          }
          const destFile = `${steamRoot}\\${asset.fileName}`;
          await extensionRenameFile(sourceFile, destFile);
          copiedFiles.push(destFile);
        }
      },
      rollback: async () => {
        for (const dest of copiedFiles.reverse()) {
          const source = `${extractDir}\\${dest.split("\\").pop()}`;
          try {
            await extensionRenameFile(dest, source);
          } catch {
            console.error(`[OPENSTEAMTOOL] rollback copy failed: ${dest}`);
          }
        }
      },
    },
    {
      name: "verify-installation",
      execute: async () => {
        for (const dll of MANAGED_DLLS) {
          const fullPath = `${steamRoot}\\${dll}`;
          const exists = await extensionFileExists(fullPath);
          if (!exists) {
            throw new Error(`Verification failed: ${dll} not found after install.`);
          }
        }
      },
      rollback: async () => {},
    },
    {
      name: "ensure-lua-directory",
      execute: async () => {
        const luaDir = `${steamRoot}\\config\\lua`;
        const luaBackup = `${steamRoot}\\config\\lua.bak`;

        if (await extensionFileExists(luaDir)) {
          // Lua already active — nothing to do
          return;
        }

        if (await extensionFileExists(luaBackup)) {
          // Lua backup exists from a previous uninstall — restore it
          // instead of creating a fresh empty directory (which would
          // cause data loss on the next uninstall when the empty dir
          // overwrites this backup).
          await extensionRenameFile(luaBackup, luaDir);
          return;
        }

        // First install — create empty lua directory for new scripts
        await createDir(luaDir);
      },
      rollback: async () => {},
    },
  ];

  return executeTransaction({ steps, name: "opensteamtool-install" });
}

export async function update(
  options: { steamRoot: string; tempFolder?: string; releaseProviderConfig?: GitHubReleaseProviderConfig }
): Promise<ExtensionOperationResult> {
  const { steamRoot, releaseProviderConfig } = options;

  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const currentStatus = await detect(steamRoot);
  if (currentStatus.installedFiles.length === 0) {
    return { success: false, error: "Extension is not installed. Use install first." };
  }

  const isDisabled = currentStatus.status === "disabled";

  if (!releaseProviderConfig) {
    return { success: false, error: "No release provider config available." };
  }

  const release = await fetchLatestRelease(releaseProviderConfig);
  if (!release) {
    return { success: false, error: "No releases found on GitHub." };
  }

  const assets = findManagedAssets(release, releaseProviderConfig);
  if (assets.length === 0) {
    return {
      success: false,
      error: "No managed DLL assets found in the latest release.",
    };
  }

  const tempDir = options.tempFolder || `${steamRoot}\\..\\..\\temp`;
  const zipPath = `${tempDir}\\opensteamtool-${release.tagName}.zip`;
  const extractDir = `${tempDir}\\opensteamtool-${release.tagName}-extracted`;

  const dllNames = assets.map((a) => a.fileName);
  const renames: Array<{ from: string; to: string }> = [];

  for (const asset of assets) {
    if (isDisabled) {
      renames.push({
        from: `${tempDir}\\${asset.fileName}`,
        to: `${steamRoot}\\${asset.fileName}.bak`,
      });
    } else {
      renames.push({
        from: `${tempDir}\\${asset.fileName}`,
        to: `${steamRoot}\\${asset.fileName}`,
      });
    }
  }

  const steps = [
    {
      name: "download-release",
      execute: async () => {
        await extensionDownloadFile(assets[0].downloadUrl, zipPath);
      },
      rollback: async () => {},
    },
    {
      name: "extract-archive",
      execute: async () => {
        const extracted = await extensionExtractZip(zipPath, extractDir, dllNames);
        if (extracted.length === 0) {
          throw new Error("No managed DLLs found in the extracted archive.");
        }
      },
      rollback: async () => {},
    },
    createBatchRenameStep(
      renames,
      "replace-managed-files"
    ),
    {
      name: "verify-update",
      execute: async () => {
        const suffix = isDisabled ? ".bak" : "";
        for (const dll of MANAGED_DLLS) {
          const fullPath = `${steamRoot}\\${dll}${suffix}`;
          const exists = await extensionFileExists(fullPath);
          if (!exists) {
            throw new Error(`Verification failed: ${dll}${suffix} not found after update.`);
          }
        }
      },
      rollback: async () => {},
    },
  ];

  return executeTransaction({ steps, name: "opensteamtool-update" });
}
