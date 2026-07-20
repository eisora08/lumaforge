/**
 * Lua Extension Adapter — Wraps a Lua-backed extension manifest into the
 * standard Extension interface by forwarding all lifecycle calls to Rust
 * via Tauri IPC.
 *
 * This is the ONLY implementation of the Extension interface for Lua
 * extensions. It is fully generic — no hardcoded IDs, no special cases.
 * Every extension that ships an extension.lua + manifest.json pair
 * uses this adapter automatically.
 */

import type {
  Extension,
  ExtensionManifestV1,
  ExtensionDetectionResult,
  ExtensionOperationOptions,
  ExtensionOperationResult,
  ExtensionStatus,
  ExtensionBehavior,
} from "../types";
import {
  loadExtension as tauriLoadExtension,
  callExtensionDetect,
  callExtensionInstall,
  callExtensionEnable,
  callExtensionDisable,
  callExtensionUninstall,
  writeExtensionConfig,
  readExtensionConfig,
  deleteExtensionDirectory,
} from "../../services/tauri";

const DEBUG_LUA_ADAPTER = false;

function log(...args: unknown[]): void {
  if (DEBUG_LUA_ADAPTER) {
    console.log("[LUA_EXT]", ...args);
  }
}

/**
 * Parse a LuaFunctionResult value string as JSON.
 * Returns the parsed object, or null if parsing fails.
 */
function parseResultValue(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a Lua detect result to an ExtensionDetectionResult.
 */
function toDetectionResult(
  value: string | null,
  error: string | null,
): ExtensionDetectionResult {
  if (error) {
    return {
      status: "error",
      installedFiles: [],
      missingFiles: [],
      backupFiles: [],
      installedVersion: null,
    };
  }

  const parsed = parseResultValue(value);
  if (!parsed) {
    // Minimal detect — assume installed if detect returned success
    return {
      status: "installed",
      installedFiles: [],
      missingFiles: [],
      backupFiles: [],
      installedVersion: null,
    };
  }

  return {
    status: (parsed.status as ExtensionStatus) ?? "installed",
    installedFiles: (parsed.installedFiles as string[]) ?? [],
    missingFiles: (parsed.missingFiles as string[]) ?? [],
    backupFiles: (parsed.backupFiles as string[]) ?? [],
    installedVersion: (parsed.installedVersion as string | null) ?? null,
  };
}

/**
 * Map a Lua lifecycle result (install/enable/disable/uninstall) to
 * an ExtensionOperationResult.
 */
function toOperationResult(
  value: string | null,
  error: string | null,
): ExtensionOperationResult {
  if (error) {
    return { success: false, error };
  }

  const parsed = parseResultValue(value);
  if (!parsed) {
    return { success: true };
  }

  return {
    success: parsed.success !== false,
    error: (parsed.error as string) ?? undefined,
    affectedFiles: parsed.affectedFiles as string[] | undefined,
    rolledBack: parsed.rolledBack as boolean | undefined,
    fileLocked: parsed.fileLocked as boolean | undefined,
    installedVersion: parsed.installedVersion as string | null | undefined,
  };
}

/**
 * Create an Extension instance backed by a Lua script.
 *
 * @param manifest - The parsed extension manifest.
 * @param scriptPath - Absolute path to the extension.lua file.
 * @returns An Extension instance whose lifecycle methods forward to Rust.
 */
export async function createLuaExtension(
  manifest: ExtensionManifestV1,
  scriptPath: string,
): Promise<Extension> {
  log(`Loading Lua extension: ${manifest.id} from ${scriptPath}`);

  // Load the extension into the Rust Lua engine
  const table = await tauriLoadExtension(manifest.id, scriptPath);

  if (table.error) {
    throw new Error(
      `Failed to load Lua extension '${manifest.id}': ${table.error}`,
    );
  }

  log(`Loaded: ${table.name} v${table.version}`);

  // Derive the AppData directory path from the script path.
  // scriptPath = <appData>/extensions/<id>/extension.lua → <appData>/extensions/<id>
  const _dirPath = scriptPath.replace(/\/extension\.lua$/, "");

  log(`dirPath=${_dirPath}`);

  // Build the adapter
  const ext: Extension = {
    manifest,

    async detect(hostPath: string): Promise<ExtensionDetectionResult> {
      log(`detect: ${manifest.id} hostPath=${hostPath}`);

      // Cascade step 1: check the local registry config for enabled/disabled state.
      // When the config says "disabled", return disabled regardless of disk state.
      try {
        const config = await readExtensionConfig(_dirPath);
        if (config && !config.enabled) {
          console.log(`[LUA_EXT][DETECT] ${manifest.id} — config says disabled, returning disabled status`);
          return {
            status: "disabled",
            installedFiles: [],
            missingFiles: [],
            backupFiles: [],
            installedVersion: null,
          };
        }
      } catch (err) {
        // Config read failure is non-fatal — fall through to Lua detect.
        console.log(`[LUA_EXT][DETECT] ${manifest.id} — config read failed (ok): ${err}`);
      }

      if (!table.has_detect) {
        return {
          status: "installed",
          installedFiles: [],
          missingFiles: [],
          backupFiles: [],
          installedVersion: null,
        };
      }
      const result = await callExtensionDetect(manifest.id, hostPath);
      return toDetectionResult(result.value, result.error);
    },

    async install(
      options: ExtensionOperationOptions,
    ): Promise<ExtensionOperationResult> {
      console.log(`[Frontend] Calling Lua Lifecycle command for extension: ${manifest.id} hook=install hostPath=${options.hostPath}`);
      log(`install: ${manifest.id} hostPath=${options.hostPath}`);
      if (!table.has_install) {
        return { success: false, error: "Extension does not implement install" };
      }
      const result = await callExtensionInstall(manifest.id, options.hostPath);
      console.log(`[Frontend] Lua Lifecycle result for extension: ${manifest.id} hook=install success=${result.error ? "false" : "true"}${result.error ? ` error=${result.error}` : ""}`);
      return toOperationResult(result.value, result.error);
    },

    async update(
      options: ExtensionOperationOptions,
    ): Promise<ExtensionOperationResult> {
      console.log(`[Frontend] Calling Lua Lifecycle command for extension: ${manifest.id} hook=update hostPath=${options.hostPath}`);
      log(`update: ${manifest.id} hostPath=${options.hostPath}`);
      // No dedicated Lua `update` — run uninstall then install
      const uninstallResult = await this.uninstall(options);
      if (!uninstallResult.success) {
        return uninstallResult;
      }
      return await this.install(options);
    },

    async enable(
      options: ExtensionOperationOptions,
    ): Promise<ExtensionOperationResult> {
      console.log(`[Frontend] Calling Lua Lifecycle command for extension: ${manifest.id} hook=enable hostPath=${options.hostPath}`);
      log(`enable: ${manifest.id} hostPath=${options.hostPath}`);

      // Step 1 — Custom Lua enable logic (if the extension provides one)
      if (table.has_enable) {
        const result = await callExtensionEnable(manifest.id, options.hostPath);
        console.log(`[Frontend] Lua Lifecycle result for extension: ${manifest.id} hook=enable success=${result.error ? "false" : "true"}${result.error ? ` error=${result.error}` : ""}`);
        if (result.error) {
          return toOperationResult(result.value, result.error);
        }
      }

      // Step 2 — Core application action: mark enabled in the local registry
      try {
        await writeExtensionConfig(_dirPath, true);
        console.log(`[LUA_EXT][ENABLE] ${manifest.id} — written enabled=true to extension config`);
      } catch (err) {
        console.error(`[LUA_EXT][ENABLE] ${manifest.id} — failed to write enabled config: ${err}`);
        return { success: false, error: `Failed to persist enabled state: ${err}` };
      }

      return { success: true };
    },

    async disable(
      options: ExtensionOperationOptions,
    ): Promise<ExtensionOperationResult> {
      console.log(`[Frontend] Calling Lua Lifecycle command for extension: ${manifest.id} hook=disable hostPath=${options.hostPath}`);
      log(`disable: ${manifest.id} hostPath=${options.hostPath}`);

      // Step 1 — Custom Lua disable logic (if the extension provides one)
      if (table.has_disable) {
        const result = await callExtensionDisable(manifest.id, options.hostPath);
        console.log(`[Frontend] Lua Lifecycle result for extension: ${manifest.id} hook=disable success=${result.error ? "false" : "true"}${result.error ? ` error=${result.error}` : ""}`);
        if (result.error) {
          return toOperationResult(result.value, result.error);
        }
      }

      // Step 2 — Core application action: mark disabled in the local registry.
      // This runs regardless of whether a Lua disable() existed or succeeded.
      // The launcher reads this config during detect() to report "disabled" status.
      try {
        await writeExtensionConfig(_dirPath, false);
        console.log(`[LUA_EXT][DISABLE] ${manifest.id} — written enabled=false to extension config`);
      } catch (err) {
        console.error(`[LUA_EXT][DISABLE] ${manifest.id} — failed to write disabled config: ${err}`);
        return { success: false, error: `Failed to persist disabled state: ${err}` };
      }

      return { success: true };
    },

    async uninstall(
      options: ExtensionOperationOptions,
    ): Promise<ExtensionOperationResult> {
      console.log(`[Frontend] Calling Lua Lifecycle command for extension: ${manifest.id} hook=uninstall hostPath=${options.hostPath}`);
      log(`uninstall: ${manifest.id} hostPath=${options.hostPath}`);

      // Step 1 — Custom Lua uninstall logic (removes managed files from host path)
      if (table.has_uninstall) {
        const result = await callExtensionUninstall(manifest.id, options.hostPath);
        console.log(`[Frontend] Lua Lifecycle result for extension: ${manifest.id} hook=uninstall success=${result.error ? "false" : "true"}${result.error ? ` error=${result.error}` : ""}`);
        if (result.error) {
          return toOperationResult(result.value, result.error);
        }
      }

      // Step 2 — Core application action: delete the extension's entire AppData
      // directory (extension.lua, manifest.json, config, state files).
      // This is always the final step — the launcher's own extension storage
      // is cleaned up after the Lua hook has removed files from the host path.
      try {
        await deleteExtensionDirectory(_dirPath);
        console.log(`[LUA_EXT][UNINSTALL] ${manifest.id} — AppData directory deleted: ${_dirPath}`);
      } catch (err) {
        console.error(`[LUA_EXT][UNINSTALL] ${manifest.id} — failed to delete AppData directory: ${err}`);
        return { success: false, error: `Failed to clean up extension directory: ${err}` };
      }

      return { success: true };
    },

    async getInstalledVersion(hostPath: string): Promise<string | null> {
      const detection = await this.detect(hostPath);
      return detection.installedVersion;
    },

    async getLatestVersion(): Promise<string | null> {
      // Lua extensions have no built-in remote version check
      return null;
    },

    async getStatus(hostPath: string): Promise<ExtensionStatus> {
      const detection = await this.detect(hostPath);
      return detection.status;
    },

    getBehavior(): ExtensionBehavior {
      return manifest.behavior ?? {};
    },
  };

  return ext;
}
