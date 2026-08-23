/**
 * Extension Bootstrap — Wires the full lifecycle: Discovery → Validation → Registration.
 *
 * Called once during app startup. No external I/O beyond local file reads.
 * The lifecycle is:
 * 1. Register BuiltInSource + RepositorySource with SourceManager
 * 2. SourceManager.discoverAllSources() → fetches manifest.json files
 * 3. ManifestLoader validates each manifest
 * 4. ExtensionManager.register() stores validated extensions
 * 5. UI subscribes to ExtensionManager changes
 */

import { BuiltInSource } from "./sources/builtin";
import { RepositorySource } from "./sources/repository";
import { registerSource, discoverAllSources } from "./sources/manager";
import { listExtensions, subscribeExtensionManager } from "./manager";
import { loadExtensionsFromAppData } from "./loader";
import { resolveAppDataDir } from "../services/tauri";

const DEBUG_BOOTSTRAP = false;

// =============================================================================
// Bootstrap State
// =============================================================================

let _bootstrapped = false;
let _bootstrapResult: BootstrapResult | null = null;

export interface BootstrapResult {
  registered: number;
  skipped: number;
  errors: Array<{ sourceId: string; path: string; error: string }>;
  extensions: ReturnType<typeof listExtensions>;
}

/**
 * Run the extension bootstrap lifecycle.
 * Safe to call multiple times — subsequent calls return cached result.
 */
export async function bootstrapExtensions(): Promise<BootstrapResult> {
  if (_bootstrapResult) {
    if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Already bootstrapped, returning cached result (registered=${_bootstrapResult.registered})`);
    return _bootstrapResult;
  }

  if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Starting bootstrap...`);

  // Step 1: Register built-in source (highest priority)
  registerSource(new BuiltInSource());

  // Step 1b: Register repository source (lower priority, network-backed)
  registerSource(
    new RepositorySource({
      id: "official",
      displayName: "Official Extensions",
      priority: 10,
      enabled: true,
      config: {
        url: "https://raw.githubusercontent.com/eisora08/lumaforge-extensions/main/index.json",
        cacheTtlMs: 60 * 60 * 1000, // 1 hour
      },
    })
  );

  // Step 2: Discover from all sources (fetches local manifest.json + remote index)
  const result = await discoverAllSources();
  if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] discoverAllSources completed: registered=${result.registered}, skipped=${result.skipped}, errors=${result.errors.length}`);

  // Step 3: Load Lua extensions from app data extensions directory
  try {
    const appDataDir = await resolveAppDataDir();
    const luaResult = await loadExtensionsFromAppData(appDataDir);
    if (luaResult.loaded > 0 || luaResult.errors.length > 0) {
      console.log(
        `[BOOTSTRAP] Lua extensions: ${luaResult.loaded} loaded, ${luaResult.skipped} skipped, ${luaResult.errors.length} errors`,
      );
      for (const err of luaResult.errors) {
        console.warn(`[BOOTSTRAP] Lua extension error [${err.dirName}]: ${err.error}`);
      }
    }
  } catch (err) {
    console.warn(`[BOOTSTRAP] Failed to load Lua extensions from app data:`, err);
  }

  const snapshot = listExtensions();
  if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Bootstrap complete: ${snapshot.length} extensions listed`);

  _bootstrapResult = {
    registered: result.registered,
    skipped: result.skipped,
    errors: result.errors,
    extensions: snapshot,
  };
  _bootstrapped = true;

  // Expose extensions to window for debugging and Tools page
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__LUMAFORGE_EXTENSIONS__ = listExtensions();
    subscribeExtensionManager(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__LUMAFORGE_EXTENSIONS__ = listExtensions();
    });
    if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Exposed ${snapshot.length} extensions to window.__LUMAFORGE_EXTENSIONS__`);
  } catch {
    // Non-fatal — window may not be available in test environments
  }

  return _bootstrapResult;
}

/**
 * Check if bootstrap has completed.
 */
export function isBootstrapped(): boolean {
  return _bootstrapped;
}

/**
 * Reset bootstrap state (for testing).
 */
export function resetBootstrap(): void {
  _bootstrapped = false;
  _bootstrapResult = null;
}
