/**
 * OpenSteamTool Toggle — Enable/Disable/Uninstall via .bak ↔ .dll rename.
 *
 * Also manages the Lua script folder: when disabled, config/lua is renamed
 * to config/lua.bak so the Lua scanner finds no scripts. When re-enabled,
 * it is restored.
 *
 * All operations are fully idempotent: they check the actual current state
 * of each managed path (DLLs and Lua folder) before acting, so calling any
 * operation from any state is always a safe no-op or correct transition.
 */

import type { ExtensionOperationResult } from "../../types";
import {
  executeTransaction,
  createRenameStep,
  createBatchRenameStep,
  createRemoveStep,
  fileExists,
} from "../../services/transactionManager";

const MANAGED_DLLS = ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"];

function getLuaFolder(steamRoot: string): string {
  return `${steamRoot}\\config\\lua`;
}

function getLuaBackupFolder(steamRoot: string): string {
  return `${steamRoot}\\config\\lua.bak`;
}

/**
 * Disable the extension by renaming active DLLs to .bak and hiding the
 * Lua folder.  Each path is checked individually — if already in the
 * disabled state (or missing), it is simply skipped.  Calling disable()
 * when already fully disabled is a safe no-op that returns success.
 */
export async function disable(
  options: { steamRoot: string }
): Promise<ExtensionOperationResult> {
  const { steamRoot } = options;
  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const renames: Array<{ from: string; to: string }> = [];

  for (const dll of MANAGED_DLLS) {
    const dllPath = `${steamRoot}\\${dll}`;
    if (await fileExists(dllPath)) {
      renames.push({ from: dllPath, to: `${dllPath}.bak` });
    }
  }

  const luaFolder = getLuaFolder(steamRoot);
  if (await fileExists(luaFolder)) {
    renames.push({ from: luaFolder, to: getLuaBackupFolder(steamRoot) });
  }

  if (renames.length === 0) {
    return { success: true };
  }

  const steps = [
    createBatchRenameStep(renames, "disable-rename-dll-to-bak"),
    {
      name: "verify-disable",
      execute: async () => {
        for (const dll of MANAGED_DLLS) {
          const bakPath = `${steamRoot}\\${dll}.bak`;
          const exists = await fileExists(bakPath);
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

/**
 * Enable the extension by renaming .bak files back to active DLLs and
 * restoring the Lua folder.  Each path is checked individually — if
 * already in the enabled state (or missing), it is simply skipped.
 * Calling enable() when already fully enabled is a safe no-op that
 * returns success.
 */
export async function enable(
  options: { steamRoot: string }
): Promise<ExtensionOperationResult> {
  const { steamRoot } = options;
  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const renames: Array<{ from: string; to: string }> = [];

  for (const dll of MANAGED_DLLS) {
    const bakPath = `${steamRoot}\\${dll}.bak`;
    const dllPath = `${steamRoot}\\${dll}`;
    if (await fileExists(bakPath)) {
      renames.push({ from: bakPath, to: dllPath });
    }
  }

  const luaBackup = getLuaBackupFolder(steamRoot);
  if (await fileExists(luaBackup)) {
    renames.push({ from: luaBackup, to: getLuaFolder(steamRoot) });
  }

  if (renames.length === 0) {
    return { success: true };
  }

  const steps = [
    createBatchRenameStep(renames, "enable-rename-bak-to-dll"),
    {
      name: "verify-enable",
      execute: async () => {
        for (const dll of MANAGED_DLLS) {
          const dllPath = `${steamRoot}\\${dll}`;
          const exists = await fileExists(dllPath);
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

/**
 * Uninstall the extension by removing all managed DLLs (both active
 * and .bak) and hiding the Lua folder (rename to .bak if active,
 * leave as .bak if already hidden).  Works correctly from any state:
 * enabled, disabled, or partially installed.
 */
export async function uninstall(
  options: { steamRoot: string }
): Promise<ExtensionOperationResult> {
  const { steamRoot } = options;
  if (!steamRoot) {
    return { success: false, error: "Steam root path is not configured." };
  }

  const filesToRemove: Array<{ path: string; description: string }> = [];
  for (const dll of MANAGED_DLLS) {
    const dllPath = `${steamRoot}\\${dll}`;
    const bakPath = `${dllPath}.bak`;
    if (await fileExists(dllPath)) {
      filesToRemove.push({ path: dllPath, description: `remove-${dll}` });
    }
    if (await fileExists(bakPath)) {
      filesToRemove.push({ path: bakPath, description: `remove-${dll}.bak` });
    }
  }

  const luaFolder = getLuaFolder(steamRoot);
  const luaBackup = getLuaBackupFolder(steamRoot);
  const hasLuaFolder = await fileExists(luaFolder);
  const hasLuaBackup = await fileExists(luaBackup);

  if (filesToRemove.length === 0 && !hasLuaFolder && !hasLuaBackup) {
    return { success: true };
  }

  const steps: Array<{
    name: string;
    execute: () => Promise<void>;
    rollback?: () => Promise<void>;
  }> = [
    ...filesToRemove.map((f) => createRemoveStep(f.path, f.description)),
    {
      name: "verify-uninstall",
      execute: async () => {
        for (const dll of MANAGED_DLLS) {
          const dllPath = `${steamRoot}\\${dll}`;
          const bakPath = `${dllPath}.bak`;
          if (await fileExists(dllPath) || await fileExists(bakPath)) {
            throw new Error(
              `Verification failed: ${dll} or ${dll}.bak still exists after uninstall.`
            );
          }
        }
      },
      rollback: async () => {},
    },
  ];

  if (hasLuaFolder) {
    steps.push(
      createRenameStep(luaFolder, luaBackup, "uninstall-rename-lua-folder")
    );
  }

  return executeTransaction({ steps, name: "opensteamtool-uninstall" });
}
