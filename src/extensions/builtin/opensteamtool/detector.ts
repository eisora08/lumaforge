/**
 * OpenSteamTool Detector — File-presence detection for managed DLLs.
 *
 * Checks if dwmapi.dll, xinput1_4.dll, and OpenSteamTool.dll exist
 * in the Steam root directory. Also checks for .bak files (disabled state).
 */

import type { ExtensionDetectionResult, ExtensionStatus } from "../../types";
import { extensionFileExists } from "../../services/extensionTauri";

const MANAGED_DLLS = ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"];

export async function detect(steamRoot: string): Promise<ExtensionDetectionResult> {
  const installedFiles: string[] = [];
  const missingFiles: string[] = [];
  const backupFiles: string[] = [];

  for (const dll of MANAGED_DLLS) {
    const fullPath = `${steamRoot}\\${dll}`;
    const bakPath = `${fullPath}.bak`;

    const exists = await extensionFileExists(fullPath);
    const bakExists = await extensionFileExists(bakPath);

    if (exists) {
      installedFiles.push(dll);
    } else {
      missingFiles.push(dll);
    }
    if (bakExists) {
      backupFiles.push(dll);
    }
  }

  const allBak = backupFiles.length === MANAGED_DLLS.length;
  const noneExist = installedFiles.length === 0 && !allBak;
  const partial =
    installedFiles.length > 0 &&
    installedFiles.length < MANAGED_DLLS.length;

  let status: ExtensionStatus;
  if (noneExist && backupFiles.length === 0) {
    status = "available";
  } else if (allBak && installedFiles.length === 0) {
    status = "disabled";
  } else if (partial) {
    status = "installed";
  } else if (installedFiles.length === MANAGED_DLLS.length) {
    status = "enabled";
  } else {
    status = "installed";
  }

  return {
    status,
    installedFiles,
    missingFiles,
    backupFiles,
    installedVersion: null,
  };
}
