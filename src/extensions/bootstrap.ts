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
import { listExtensions } from "./manager";
import { hasExtension, registerExtension } from "./registry";
import type { Extension } from "./types";

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

  // Step 2b: Belt-and-suspenders — if SourceManager didn't register an
  // Extension runtime into the Registry (e.g. factory failed silently
  // or registration path was skipped), load it directly here.
  // Also provides the DeclarativeExtension fallback for manifests with
  // managedFiles but no hand-written factory.
  const BUILTIN_FACTORIES: Record<string, () => Promise<Extension>> = {
    opensteamtool: async () => {
      const { getOpenSteamToolExtension } = await import("./builtin/opensteamtool");
      return getOpenSteamToolExtension();
    },
  };

  for (const [dirName, factory] of Object.entries(BUILTIN_FACTORIES)) {
    if (!hasExtension(dirName)) {
      if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Registry missing runtime for "${dirName}", loading directly...`);
      try {
        const ext = await factory();
        registerExtension(ext);
        if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Direct registration succeeded for "${dirName}"`);
      } catch (err) {
        console.error(`[BOOTSTRAP] Direct registration FAILED for "${dirName}":`, err);
      }
    } else {
      if (DEBUG_BOOTSTRAP) console.log(`[BOOTSTRAP][DEBUG] Registry already has runtime for "${dirName}", skipping direct load`);
    }
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
