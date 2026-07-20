/**
 * Extension Loader — Orchestrates scanning, parsing, loading, and registering
 * of Lua extensions discovered on disk.
 *
 * Pipeline per valid extension directory:
 * 1. Parse manifest.json → ExtensionManifestV1
 * 2. Call createLuaExtension(manifest, extension.lua path) → Extension
 * 3. Register into ExtensionManager + Registry
 */

import { scanExtensionsDir } from "./scanner";
import { createLuaExtension } from "./createLuaExtension";
import { loadManifestFromObject } from "../manifests";
import { registerLoadedExtension } from "../manager";
import { registerExtension, hasExtension } from "../registry";

const DEBUG_LOADER = false;

/**
 * Result of loading extensions from the filesystem.
 */
export interface LoaderResult {
  /** Number of extensions successfully loaded and registered. */
  loaded: number;
  /** Number of extensions skipped (already registered, parse failure, etc.). */
  skipped: number;
  /** Detailed errors encountered during loading. */
  errors: Array<{ dirName: string; error: string }>;
  /** Directory names of successfully loaded extensions. */
  loadedIds: string[];
}

/**
 * Load all Lua extensions from the given app data directory.
 * Scans `<basePath>/extensions/`, processes valid entries, and registers them.
 *
 * @param basePath - The app data directory (e.g., result of resolveAppDataDir()).
 * @returns A LoaderResult describing what happened.
 */
export async function loadExtensionsFromAppData(
  basePath: string,
): Promise<LoaderResult> {
  const extensionsDir = `${basePath.replace(/\\/g, "/")}/extensions`;
  const result: LoaderResult = {
    loaded: 0,
    skipped: 0,
    errors: [],
    loadedIds: [],
  };

  if (DEBUG_LOADER) {
    console.log(`[EXT][LOADER] Scanning: ${extensionsDir}`);
  }

  // Step 1: Scan the directory
  const scanResult = await scanExtensionsDir(extensionsDir);
  if (scanResult.valid.length === 0) {
    if (DEBUG_LOADER) {
      console.log(`[EXT][LOADER] No valid extensions found in ${extensionsDir}`);
    }
    return result;
  }

  // Step 2: Process each valid entry
  for (const entry of scanResult.valid) {
    try {
      const dirName = entry.dir_name;

      // Lua extensions ALWAYS take priority over declarative/manifest-only
      // extensions. If a DeclarativeExtension was registered from a remote
      // source (e.g. RepositorySource's tryCreateDeclarativeExtension), we
      // replace it here with the Lua-backed adapter.
      const wasRegistered = hasExtension(dirName);
      if (wasRegistered) {
        console.log(
          `[EXT][LOADER][LUA_PRIORITY] Replacing existing extension "${dirName}" with Lua-backed adapter (extension.lua found on disk)`
        );
      }

      // Step 2a: Parse manifest.json
      let manifestRaw: unknown;
      try {
        manifestRaw = JSON.parse(entry.manifest_json!);
      } catch {
        result.errors.push({
          dirName,
          error: "Failed to parse manifest.json — invalid JSON",
        });
        result.skipped++;
        continue;
      }

      let manifest;
      try {
        manifest = loadManifestFromObject(manifestRaw, {
          path: `${extensionsDir}/${dirName}/manifest.json`,
        });
      } catch (parseErr) {
        result.errors.push({
          dirName,
          error: `Manifest validation failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        });
        result.skipped++;
        continue;
      }

      // Step 2b: Create Lua Extension adapter
      const scriptPath = `${extensionsDir}/${dirName}/extension.lua`;
      let extension;
      try {
        extension = await createLuaExtension(manifest, scriptPath);
      } catch (engineErr) {
        result.errors.push({
          dirName,
          error: `Lua engine load failed: ${engineErr instanceof Error ? engineErr.message : String(engineErr)}`,
        });
        result.skipped++;
        continue;
      }

      // Step 2c: Register into ExtensionManager + Registry
      // NOTE: This REPLACES any previously registered extension (e.g. DeclarativeExtension
      // from RepositorySource), because Lua-backed adapters have full lifecycle control
      // via the extension.lua script and must take priority.
      registerLoadedExtension(manifest, "appdata");
      registerExtension(extension);

      result.loaded++;
      result.loadedIds.push(manifest.id);

      console.log(
        `[EXT][LOADER][LUA] ${wasRegistered ? "Replaced" : "Registered"}: "${manifest.id}" (${manifest.displayName} v${manifest.version}) — Lua adapter active`,
      );
    } catch (err) {
      result.errors.push({
        dirName: entry.dir_name,
        error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (DEBUG_LOADER) {
    console.log(
      `[EXT][LOADER] Done: ${result.loaded} loaded, ${result.skipped} skipped, ${result.errors.length} errors`,
    );
  }

  return result;
}
