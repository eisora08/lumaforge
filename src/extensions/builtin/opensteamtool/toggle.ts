/**
 * OpenSteamTool Toggle — Enable/Disable/Uninstall via .bak ↔ .dll rename.
 *
 * Ported from the legacy system. Uses transactional file operations
 * with rollback support.
 */

import type { ExtensionOperationResult } from "../../types";
import { detect } from "./detector";
import {
  executeTransaction,
  createBatchRenameStep,
} from "../../services/transactionManager";
import { extensionFileExists } from "../../services/extensionTauri";

const MANAGED_DLLS = ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"];

export async function enable(
  options: { steamRoot: string }
): Promise<ExtensionOperationResult> {
  const { steamRoot } = options;
  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const status = await detect(steamRoot);
  if (status.status === "enabled") {
    return { success: true };
  }

  if (status.backupFiles.length === 0) {
    return {
      success: false,
      error:
        "No backup files found. The extension may not be properly disabled.",
    };
  }

  const renames: Array<{ from: string; to: string }> = [];
  for (const dll of MANAGED_DLLS) {
    const bakPath = `${steamRoot}\\${dll}.bak`;
    const dllPath = `${steamRoot}\\${dll}`;
    const bakExists = await extensionFileExists(bakPath);
    if (bakExists) {
      renames.push({ from: bakPath, to: dllPath });
    }
  }

  if (renames.length === 0) {
    return {
      success: false,
      error: "No .bak files found to enable.",
    };
  }

  const steps = [
    createBatchRenameStep(renames, "enable-rename-bak-to-dll"),
    {
      name: "verify-enable",
      execute: async () => {
        for (const dll of MANAGED_DLLS) {
          const dllPath = `${steamRoot}\\${dll}`;
          const exists = await extensionFileExists(dllPath);
          if (!exists) {
            throw new Error(`Verification failed: ${dll} not found after enable.`);
          }
        }
      },
      rollback: async () => {},
    },
  ];

  return executeTransaction({ steps, name: "opensteamtool-enable" });
}

export async function disable(
  options: { steamRoot: string }
): Promise<ExtensionOperationResult> {
  const { steamRoot } = options;
  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const status = await detect(steamRoot);
  if (status.status === "disabled") {
    return { success: true };
  }

  if (status.installedFiles.length === 0) {
    return {
      success: false,
      error: "No DLL files found. The extension may not be installed.",
    };
  }

  const renames: Array<{ from: string; to: string }> = [];
  for (const dll of MANAGED_DLLS) {
    const dllPath = `${steamRoot}\\${dll}`;
    const bakPath = `${dllPath}.bak`;
    const dllExists = await extensionFileExists(dllPath);
    if (dllExists) {
      renames.push({ from: dllPath, to: bakPath });
    }
  }

  if (renames.length === 0) {
    return {
      success: false,
      error: "No DLL files found to disable.",
    };
  }

  const steps = [
    createBatchRenameStep(renames, "disable-rename-dll-to-bak"),
    {
      name: "verify-disable",
      execute: async () => {
        for (const dll of MANAGED_DLLS) {
          const bakPath = `${steamRoot}\\${dll}.bak`;
          const exists = await extensionFileExists(bakPath);
          if (!exists) {
            throw new Error(
              `Verification failed: ${dll}.bak not found after disable.`
            );
          }
        }
      },
      rollback: async () => {},
    },
  ];

  return executeTransaction({ steps, name: "opensteamtool-disable" });
}

export async function uninstall(
  options: { steamRoot: string }
): Promise<ExtensionOperationResult> {
  return disable(options);
}
