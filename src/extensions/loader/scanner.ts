/**
 * Extension Directory Scanner — Discovers Lua extensions on disk.
 *
 * Scans `<appData>/extensions/` for subdirectories containing both
 * `manifest.json` and `extension.lua`, returning their directory names
 * and raw manifest JSON content for downstream processing.
 */

import { scanExtensionsDirectory } from "../../services/tauri";
import type { ExtensionDirEntry } from "../../services/tauri";

const SCANNER_DEBUG = false;

/**
 * Result of scanning the extensions directory.
 */
export interface ScanResult {
  entries: ExtensionDirEntry[];
  /** Only entries where both manifest.json and extension.lua exist. */
  valid: ExtensionDirEntry[];
  /** Entries missing extension.lua. */
  missingLua: ExtensionDirEntry[];
  /** Entries missing manifest.json. */
  missingManifest: ExtensionDirEntry[];
  /** Full path to the scanned extensions directory. */
  basePath: string;
}

/**
 * Scan the extensions directory at the given base path.
 * Returns categorized results for downstream processing.
 */
export async function scanExtensionsDir(basePath: string): Promise<ScanResult> {
  if (SCANNER_DEBUG) {
    console.log(`[EXT][SCAN] Scanning extensions directory: ${basePath}`);
  }

  const result = await scanExtensionsDirectory(basePath);

  const valid: ExtensionDirEntry[] = [];
  const missingLua: ExtensionDirEntry[] = [];
  const missingManifest: ExtensionDirEntry[] = [];

  for (const entry of result.entries) {
    if (entry.manifest_json && entry.has_extension_lua) {
      valid.push(entry);
    } else if (!entry.has_extension_lua) {
      missingLua.push(entry);
    } else if (!entry.manifest_json) {
      missingManifest.push(entry);
    }
  }

  if (SCANNER_DEBUG) {
    console.log(
      `[EXT][SCAN] Result: ${result.entries.length} total, ${valid.length} valid, ` +
        `${missingLua.length} missing extension.lua, ${missingManifest.length} missing manifest.json`,
    );
  }

  return {
    entries: result.entries,
    valid,
    missingLua,
    missingManifest,
    basePath,
  };
}
