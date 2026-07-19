/**
 * OpenSteamTool Extension — First real extension in the Extension Framework.
 *
 * Implements the Extension interface by porting legacy logic:
 * - Detection: file-presence checks for 3 managed DLLs
 * - Install: GitHub release download → ZIP extract → file copy (transactional)
 * - Enable/Disable: .bak ↔ .dll rename (transactional)
 * - Version: PE header parsing via Rust backend
 *
 * Reuses existing extensionTauri services and TransactionManager.
 */

import type {
  Extension,
  ExtensionManifestV1,
  ExtensionDetectionResult,
  ExtensionOperationOptions,
  ExtensionOperationResult,
  ExtensionStatus,
  ExtensionBehavior,
} from "../../types";
import { loadManifestFromObject } from "../../manifests";
import { detect as detectFiles } from "./detector";
import { install, update } from "./installer";
import { enable, disable, uninstall } from "./toggle";
import { getInstalledVersion as getVersion } from "./version";
import { getLatestVersionTag } from "./github";

// =============================================================================
// Manifest (loaded from JSON)
// =============================================================================

let _manifest: ExtensionManifestV1 | null = null;

async function getManifest(): Promise<ExtensionManifestV1> {
  if (_manifest) return _manifest;

  const response = await fetch("/extensions/builtin/opensteamtool/manifest.json");
  if (!response.ok) {
    throw new Error(`Failed to load OpenSteamTool manifest: ${response.status}`);
  }

  const raw = await response.json();
  _manifest = loadManifestFromObject(raw, {
    path: "/extensions/builtin/opensteamtool/manifest.json",
  });

  return _manifest;
}

// =============================================================================
// Extension Implementation
// =============================================================================

class OpenSteamToolExtension implements Extension {
  private _manifest: ExtensionManifestV1 | null = null;

  async getManifest(): Promise<ExtensionManifestV1> {
    if (!this._manifest) {
      this._manifest = await getManifest();
    }
    return this._manifest;
  }

  get manifest(): ExtensionManifestV1 {
    if (!this._manifest) {
      throw new Error("Extension not initialized. Call getManifest() first.");
    }
    return this._manifest;
  }

  async detect(hostPath: string): Promise<ExtensionDetectionResult> {
    return detectFiles(hostPath);
  }

  async install(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    return install({
      steamRoot: options.hostPath,
      tempFolder: options.tempPath,
      releaseProviderConfig: this._extractGitHubConfig() ?? undefined,
    });
  }

  async update(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    return update({
      steamRoot: options.hostPath,
      tempFolder: options.tempPath,
      releaseProviderConfig: this._extractGitHubConfig() ?? undefined,
    });
  }

  async enable(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    return enable({
      steamRoot: options.hostPath,
    });
  }

  async disable(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    return disable({
      steamRoot: options.hostPath,
    });
  }

  async uninstall(options: ExtensionOperationOptions): Promise<ExtensionOperationResult> {
    return uninstall({
      steamRoot: options.hostPath,
    });
  }

  async getInstalledVersion(hostPath: string): Promise<string | null> {
    return getVersion(hostPath);
  }

  async getLatestVersion(): Promise<string | null> {
    const config = this._extractGitHubConfig();
    if (!config) return null;
    return getLatestVersionTag(config);
  }

  private _extractGitHubConfig(): import("../../types").GitHubReleaseProviderConfig | null {
    const rp = this._manifest?.releaseProvider;
    if (rp?.provider === "github" && rp.config) {
      const c = rp.config as Record<string, unknown>;
      if (typeof c.owner === "string" && typeof c.repo === "string") {
        return {
          owner: c.owner,
          repo: c.repo,
          tagPattern: typeof c.tagPattern === "string" ? c.tagPattern : undefined,
          assetPattern: typeof c.assetPattern === "string" ? c.assetPattern : undefined,
          includePrereleases:
            typeof c.includePrereleases === "boolean" ? c.includePrereleases : undefined,
        };
      }
    }
    return null;
  }

  async getStatus(hostPath: string): Promise<ExtensionStatus> {
    const result = await detectFiles(hostPath);
    return result.status;
  }

  getBehavior(): ExtensionBehavior {
    return {
      luaOwnershipOverride: true,
      injectsDll: true,
    };
  }
}

// =============================================================================
// Singleton (promise-memoized to prevent React Strict Mode race)
// =============================================================================

let _initPromise: Promise<OpenSteamToolExtension> | null = null;

export async function getOpenSteamToolExtension(): Promise<OpenSteamToolExtension> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const instance = new OpenSteamToolExtension();
      await instance.getManifest();
      return instance;
    })();
  }
  return _initPromise;
}

export { OpenSteamToolExtension };
