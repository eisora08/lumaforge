/**
 * Extensions Settings — Full UI for managing extensions.
 *
 * Displays extensions grouped by surface (settings, tools, library).
 * Provides real install/enable/disable/update/uninstall actions.
 * Detects status from disk on mount and after each operation.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Puzzle, Check, Shield, Layers, Box, Download, Trash2, RefreshCw, AlertTriangle, Store, ExternalLink, X } from "lucide-react";
import {
  listExtensions,
  subscribeExtensionManager,
  type RegisteredExtension,
  type ExtensionSurface,
} from "../manager";
import { bootstrapExtensions, type BootstrapResult } from "../bootstrap";
import { getExtension, registerExtension } from "../registry";
import { getRepositoryManifestUrl, clearRepositoryManifestUrl } from "../sources/manager";
import { createLuaExtension } from "../loader/createLuaExtension";
import { loadManifestFromObject } from "../manifests";
import {
  extensionCreateDir,
  extensionWriteTextFile,
  extensionFetchUrlAsText,
} from "../services/extensionTauri";
import { resolveAppDataDir } from "../../services/tauri";
import type {
  Extension,
  ExtensionDetectionResult,
  ExtensionManifestV1,
  ExtensionOperationResult,
  ExtensionStatus,
} from "../types";
import { useSettings } from "../../context/SettingsContext";
import { useConfirm } from "../../services/confirmService";
import { compareVersions } from "../services/githubReleaseService";
import { terminateProcessByName } from "../../services/tauri";

const DEBUG_EXTENSIONS = false;

// =============================================================================
// Surface config
// =============================================================================

const SURFACE_CONFIG: Record<ExtensionSurface, { label: string; icon: typeof Puzzle }> = {
  settings: { label: "Settings", icon: Puzzle },
  tools: { label: "Tools", icon: Box },
  library: { label: "Library", icon: Layers },
};

const SURFACE_ORDER: ExtensionSurface[] = ["settings", "tools", "library"];

// =============================================================================
// Extension State
// =============================================================================

interface ExtensionState {
  extension: RegisteredExtension;
  detection: ExtensionDetectionResult | null;
  installedVersion: string | null;
  latestVersion: string | null;
  operation: "idle" | "installing" | "updating" | "enabling" | "disabling" | "uninstalling";
  error: string | null;
  /** When set, the operation failed because a file was locked. Holds the operation to retry. */
  fileLockedOperation?: "install" | "update" | "enable" | "disable" | "uninstall";
}

// =============================================================================
// Component
// =============================================================================

export default function ExtensionsSettings() {
  const { settings } = useSettings();
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [extensionStates, setExtensionStates] = useState<Map<string, ExtensionState>>(new Map());
  const [browseModalOpen, setBrowseModalOpen] = useState(false);
  const mountedRef = useRef(true);
  const latestDetectionKeyRef = useRef<string>("");

  // Bootstrap + subscribe
  useEffect(() => {
    mountedRef.current = true;
    let mounted = true;
    if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] Bootstrap useEffect starting...`);

    bootstrapExtensions().then((result) => {
      if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] Bootstrap resolved: registered=${result.registered}, extensions=${result.extensions.length}, errors=${result.errors.length}`);
      if (!mounted) return;
      setBootstrap(result);
      setExtensions(listExtensions());
      setLoading(false);
    });

    const unsub = subscribeExtensionManager(() => {
      if (!mounted) return;
      setExtensions(listExtensions());
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Detect status for each extension via the Registry
  const detectExtensionStatus = useCallback(async (ext: RegisteredExtension) => {
    const extension = getExtension(ext.manifest.id);
    if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] detectExtensionStatus "${ext.manifest.id}": getExtension returned ${extension ? `Extension(id=${extension.manifest.id})` : "undefined"}`);
    if (!extension) return;

    try {
      const steamRoot = settings.steamRoot || "";
      const detectionKey = `${ext.manifest.id}:${steamRoot}`;
      latestDetectionKeyRef.current = detectionKey;
      if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] Detecting "${ext.manifest.id}" with steamRoot="${steamRoot}"`);
      
      const [detection, installedVersion, latestVersion] = await Promise.all([
        extension.detect(steamRoot),
        extension.getInstalledVersion(steamRoot),
        extension.getLatestVersion(),
      ]);

      if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] Detection for "${ext.manifest.id}": status=${detection.status}, installed=${installedVersion}, latest=${latestVersion}`);

      // Bug E fix: when PE header version is null but files are detected as installed,
      // fall back to the manifest version (DLLs may not embed version resources)
      const resolvedInstalledVersion = (!installedVersion && (detection.status === "enabled" || detection.status === "disabled" || detection.status === "installed"))
        ? ext.manifest.version
        : installedVersion;
      if (!installedVersion && resolvedInstalledVersion) {
        if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] Installed version fallback for "${ext.manifest.id}": PE=null → manifest v${resolvedInstalledVersion}`);
      }

      // Stale-call guard: skip if a newer detection started (different steamRoot or re-detection)
      if (latestDetectionKeyRef.current !== detectionKey) {
        if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] Stale detection skipped for "${ext.manifest.id}" (key mismatch: expected=${detectionKey}, current=${latestDetectionKeyRef.current})`);
        return;
      }

      if (mountedRef.current) {
        setExtensionStates((prev) => {
          const next = new Map(prev);
          next.set(ext.manifest.id, {
            extension: ext,
            detection,
            installedVersion: resolvedInstalledVersion,
            latestVersion,
            operation: "idle",
            error: null,
          });
          return next;
        });
      } else {
        if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] mountedRef is false, skipping state update for "${ext.manifest.id}"`);
      }
    } catch (err) {
      if (DEBUG_EXTENSIONS) console.error(`[EXTENSIONS][DEBUG] FAILED to detect status for "${ext.manifest.id}":`, err);
    }
  }, [settings.steamRoot]);

  // Detect status on mount and when extensions change
  useEffect(() => {
    if (DEBUG_EXTENSIONS) console.log(`[EXTENSIONS][DEBUG] detect useEffect triggered: ${extensions.length} extensions`);
    for (const ext of extensions) {
      detectExtensionStatus(ext);
    }
  }, [extensions, detectExtensionStatus]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Remote Repository Install — Fetches extension.lua from remote repo,
  // saves to AppData/extensions/{id}/, creates a Lua extension, registers
  // it in the Registry, then delegates to the Lua adapter's install.
  // ---------------------------------------------------------------------------

  const installRemoteRepositoryExtension = useCallback(async (
    extensionId: string,
    steamRoot: string,
  ): Promise<ExtensionOperationResult> => {
    const manifestUrl = getRepositoryManifestUrl(extensionId);
    if (!manifestUrl) {
      console.log(`[EXTENSIONS] No repository manifest URL for "${extensionId}" — cannot install from remote`);
      return { success: false, error: `No repository source found for "${extensionId}". It may have been removed from the repository.` };
    }

    console.log(`[EXTENSIONS] Installing "${extensionId}" from remote repository: ${manifestUrl}`);

    // 1. Find the existing manifest from the extensions list (already parsed)
    const extEntry = extensions.find((e) => e.manifest.id === extensionId);
    if (!extEntry) {
      return { success: false, error: `Extension "${extensionId}" not found in discovered extensions.` };
    }

    // 2. Derive extension.lua URL from manifest URL
    const luaUrl = manifestUrl.replace(/\/manifest\.json(\?.*)?$/, "/extension.lua");
    console.log(`[EXTENSIONS] Fetching extension.lua from: ${luaUrl}`);

    // 3. Fetch extension.lua and re-fetch manifest from remote
    let luaContent: string;
    let manifestRaw: string;
    try {
      [luaContent, manifestRaw] = await Promise.all([
        extensionFetchUrlAsText(luaUrl),
        extensionFetchUrlAsText(manifestUrl),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to fetch extension files from repository: ${msg}` };
    }

    if (!luaContent || !manifestRaw) {
      return { success: false, error: "Repository returned empty extension files." };
    }

    // 4. Re-parse remote manifest to verify it's valid
    let manifest: ExtensionManifestV1;
    try {
      const parsed = JSON.parse(manifestRaw);
      manifest = loadManifestFromObject(parsed, { path: manifestUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Invalid manifest.json from repository: ${msg}` };
    }

    // 5. Get AppData dir and create extension directory
    const appDataDir = await resolveAppDataDir();
    const extDir = `${appDataDir}/extensions/${extensionId}`;
    const scriptPath = `${extDir}/extension.lua`;
    const manifestPath = `${extDir}/manifest.json`;

    try {
      await extensionCreateDir(extDir);
      console.log(`[EXTENSIONS] Created extension directory: ${extDir}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to create extension directory: ${msg}` };
    }

    // 6. Write extension.lua and manifest.json
    try {
      await extensionWriteTextFile(scriptPath, luaContent);
      await extensionWriteTextFile(manifestPath, manifestRaw);
      console.log(`[EXTENSIONS] Saved extension.lua and manifest.json to: ${extDir}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to save extension files to disk: ${msg}` };
    }

    // 7. Create Lua extension
    let luaExtension: Extension;
    try {
      luaExtension = await createLuaExtension(manifest, scriptPath);
      console.log(`[EXTENSIONS] Created Lua extension for "${extensionId}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Clean up the directory on failure
      try {
        await extensionWriteTextFile(`${extDir}/.install-failed`, msg);
      } catch { /* best-effort cleanup */

      }
      clearRepositoryManifestUrl(extensionId);
      return { success: false, error: `Failed to load Lua extension: ${msg}` };
    }

    // 8. Register in Registry
    try {
      registerExtension(luaExtension);
      console.log(`[EXTENSIONS] Registered Lua extension "${extensionId}" in runtime registry`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to register extension runtime: ${msg}` };
    }

    // 9. Call Lua install lifecycle
    try {
      const installResult = await luaExtension.install({ hostPath: steamRoot });
      console.log(`[EXTENSIONS] Lua install for "${extensionId}": success=${installResult.success}`);
      if (!installResult.success && installResult.error) {
        return installResult;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Extension install failed: ${msg}` };
    }

    return { success: true };
  }, [extensions]);

  // Handle extension operations via the Registry
  const handleOperation = useCallback(async (
    extensionId: string,
    operation: "install" | "update" | "enable" | "disable" | "uninstall"
  ) => {
    let extension = getExtension(extensionId);

    // Remote repository install: if extension has no runtime but has a
    // repository manifest URL, fetch extension.lua from remote, save to
    // AppData, create Lua extension, register, then run install lifecycle.
    if (!extension && operation === "install") {
      const repoManifestUrl = getRepositoryManifestUrl(extensionId);
      if (repoManifestUrl) {
        const steamRoot = settings.steamRoot || "";
        if (!steamRoot) {
          setExtensionStates((prev) => {
            const next = new Map(prev);
            const state = next.get(extensionId);
            if (!state) {
              const regExt = extensions.find((e) => e.manifest.id === extensionId);
              next.set(extensionId, {
                extension: regExt!,
                detection: null,
                installedVersion: null,
                latestVersion: null,
                operation: "idle",
                error: "Steam root path is not configured. Set it in General settings.",
              });
            } else {
              next.set(extensionId, { ...state, error: "Steam root path is not configured. Set it in General settings." });
            }
            return next;
          });
          return;
        }

        // Create/update state entry with "installing" operation
        setExtensionStates((prev) => {
          const next = new Map(prev);
          const existing = next.get(extensionId);
          if (existing) {
            next.set(extensionId, { ...existing, operation: "installing", error: null, fileLockedOperation: undefined });
          } else {
            const regExt = extensions.find((e) => e.manifest.id === extensionId);
            if (regExt) {
              next.set(extensionId, {
                extension: regExt,
                detection: null,
                installedVersion: null,
                latestVersion: null,
                operation: "installing",
                error: null,
              });
            }
          }
          return next;
        });

        // Run the remote install
        const remoteResult = await installRemoteRepositoryExtension(extensionId, steamRoot);

        if (mountedRef.current) {
          if (!remoteResult.success && remoteResult.error) {
            setExtensionStates((prev) => {
              const next = new Map(prev);
              const state = next.get(extensionId);
              if (state) {
                next.set(extensionId, { ...state, operation: "idle", error: remoteResult.error! });
              }
              return next;
            });
          } else {
            // Set "idle" via re-detect after successful remote install
            const ext = extensions.find((e) => e.manifest.id === extensionId);
            if (ext) {
              await detectExtensionStatus(ext);
            } else {
              // Fallback: mark idle directly if extension not in list
              setExtensionStates((prev) => {
                const next = new Map(prev);
                const state = next.get(extensionId);
                if (state) {
                  next.set(extensionId, { ...state, operation: "idle", error: null });
                }
                return next;
              });
            }
            window.dispatchEvent(new CustomEvent("lumaforge-lua-changed"));
          }
        }

        return; // Remote install complete — don't fall through to normal path
      }
    }

    if (!extension) return;

    const steamRoot = settings.steamRoot || "";
    if (!steamRoot) {
      setExtensionStates((prev) => {
        const next = new Map(prev);
        const state = next.get(extensionId);
        if (state) {
          next.set(extensionId, {
            ...state,
            error: "Steam root path is not configured. Set it in General settings.",
          });
        }
        return next;
      });
      return;
    }

    // Set operation state
    setExtensionStates((prev) => {
      const next = new Map(prev);
      const state = next.get(extensionId);
      if (state) {
        next.set(extensionId, {
          ...state,
          operation: operation === "install" ? "installing" :
                    operation === "update" ? "updating" :
                    operation === "enable" ? "enabling" :
                    operation === "disable" ? "disabling" :
                    "uninstalling",
          error: null,
          fileLockedOperation: undefined,
        });
      }
      return next;
    });

    try {
      let result: ExtensionOperationResult;

      switch (operation) {
        case "install":
          result = await extension.install({ hostPath: steamRoot });
          break;
        case "update":
          result = await extension.update({ hostPath: steamRoot });
          break;
        case "enable":
          result = await extension.enable({ hostPath: steamRoot });
          break;
        case "disable":
          result = await extension.disable({ hostPath: steamRoot });
          break;
        case "uninstall":
          result = await extension.uninstall({ hostPath: steamRoot });
          break;
        default:
          result = { success: false, error: "Unknown operation" };
      }

      if (mountedRef.current) {
        if (!result.success && result.fileLocked) {
          // File locked by a running process — show friendly retry UI
          setExtensionStates((prev) => {
            const next = new Map(prev);
            const state = next.get(extensionId);
            if (state) {
              next.set(extensionId, {
                ...state,
                operation: "idle",
                error: null,
                fileLockedOperation: operation,
              });
            }
            return next;
          });
        } else if (!result.success && result.error) {
          setExtensionStates((prev) => {
            const next = new Map(prev);
            const state = next.get(extensionId);
            if (state) {
              next.set(extensionId, {
                ...state,
                operation: "idle",
                error: result.error!,
              });
            }
            return next;
          });
        } else {
          if (operation === "uninstall") {
            // Immediate state cleanup: delete the extension's state entry so
            // the re-render instantly shows "Available / Install" without
            // waiting for a full re-detect cycle (which would hit a stale
            // Rust Lua engine cache that still reports "enabled").
            setExtensionStates((prev) => {
              const next = new Map(prev);
              next.delete(extensionId);
              return next;
            });
          } else {
            // Re-detect status after other successful operations
            const ext = extensions.find((e) => e.manifest.id === extensionId);
            if (ext) {
              await detectExtensionStatus(ext);
            }
          }

          // Notify library to rescan Lua state after any operation that
          // could change what the Lua scanner sees (install creates lua dir,
          // enable/disable/uninstall rename lua ↔ lua.bak, update may refresh files)
          window.dispatchEvent(new CustomEvent("lumaforge-lua-changed"));
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : String(err);
        setExtensionStates((prev) => {
          const next = new Map(prev);
          const state = next.get(extensionId);
          if (state) {
            next.set(extensionId, {
              ...state,
              operation: "idle",
              error: msg,
            });
          }
          return next;
        });
      }
    }
  }, [settings.steamRoot, extensions, detectExtensionStatus]);

  const hasExtensions = extensions.length > 0;
  const hasErrors = bootstrap && bootstrap.errors.length > 0;

  // Split into Browse (available, from repos) vs My Extensions (installed)
  const browseExtensions = extensions.filter((ext) => {
    const state = extensionStates.get(ext.manifest.id);
    const status = state?.detection?.status || "available";
    return status === "available" && ext.sourceId !== "builtin";
  });
  const installedExtensions = extensions.filter((ext) => {
    const state = extensionStates.get(ext.manifest.id);
    const status = state?.detection?.status || "available";
    return status !== "available" || ext.sourceId === "builtin";
  });
  const hasInstalled = installedExtensions.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-accent)/10">
          <Puzzle className="h-5 w-5 text-(--color-accent)" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-(--color-foreground)">Extensions</h2>
          <p className="text-sm text-(--color-muted)">
            {loading
              ? "Loading extensions..."
              : hasExtensions
                ? `${extensions.length} extension${extensions.length === 1 ? "" : "s"} loaded`
                : "No extensions available."}
          </p>
        </div>
      </div>

      {/* Error banner */}
      {hasErrors && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-400">
            Some extensions failed to load:
          </p>
          <ul className="mt-2 space-y-1">
            {bootstrap!.errors.map((err, i) => (
              <li key={i} className="text-xs text-amber-400/70">
                {err.path || err.sourceId}: {err.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Browse Extensions — always visible */}
      <button
        onClick={() => setBrowseModalOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/[0.04] p-4 text-left transition-colors hover:bg-(--color-accent)/[0.08]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--color-accent)/10">
          <Store className="h-5 w-5 text-(--color-accent)" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-(--color-foreground)">
            Browse Extensions
          </h3>
          <p className="text-xs text-(--color-muted)">
            Discover extensions from the repository
          </p>
        </div>
        <ExternalLink className="h-4 w-4 text-(--color-muted)" />
      </button>

      {/* Extension list */}
      {hasExtensions && (
        <div className="space-y-6">
          {/* My Extensions — installed/enabled/disabled + built-in */}
          {hasInstalled && (
            <div className="space-y-6">
              {SURFACE_ORDER.map((surface) => {
                const exts = groupBySurface(installedExtensions)[surface];
                if (!exts || exts.length === 0) return null;
                const config = SURFACE_CONFIG[surface];
                const Icon = config.icon;
                return (
                  <div key={surface}>
                    <div className="mb-3 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-(--color-muted)" />
                      <h3 className="text-sm font-medium text-(--color-foreground)">
                        {config.label}
                      </h3>
                      <span className="text-xs text-(--color-muted)">
                        ({exts.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {exts.map((ext) => (
                        <ExtensionCard
                          key={ext.manifest.id}
                          extension={ext}
                          state={extensionStates.get(ext.manifest.id)}
                          onOperation={handleOperation}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasExtensions && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Puzzle className="mx-auto mb-3 h-8 w-8 text-white/20" />
          <p className="text-sm text-(--color-muted)">
            No extensions available.
          </p>
          <p className="mt-1 text-xs text-white/30">
            Extension support is coming soon.
          </p>
        </div>
      )}

      {/* Browse Extensions Modal */}
      {createPortal(
        <BrowseExtensionsModal
          open={browseModalOpen}
          onClose={() => setBrowseModalOpen(false)}
          extensions={browseExtensions}
          extensionStates={extensionStates}
          onOperation={handleOperation}
        />,
        document.body
      )}
    </div>
  );
}

// =============================================================================
// Extension Card (with actions)
// =============================================================================

function ExtensionCard({
  extension,
  state,
  onOperation,
}: {
  extension: RegisteredExtension;
  state?: ExtensionState;
  onOperation: (extensionId: string, operation: "install" | "update" | "enable" | "disable" | "uninstall") => void;
}) {
  const { manifest } = extension;
  const { confirm } = useConfirm();
  const detection = state?.detection;
  const installedVersion = state?.installedVersion;
  const latestVersion = state?.latestVersion;
  const operation = state?.operation || "idle";
  const error = state?.error;
  const fileLockedOperation = state?.fileLockedOperation;

  const status = detection?.status || "available";
  const isInstalled = status === "enabled" || status === "disabled" || status === "installed";
  const isActive = status === "enabled" || status === "installed";
  const isInstalling = operation === "installing";
  const isUpdating = operation === "updating";
  const isEnabling = operation === "enabling";
  const isDisabling = operation === "disabling";
  const isUninstalling = operation === "uninstalling";
  const isBusy = isInstalling || isUpdating || isEnabling || isDisabling || isUninstalling;
  // Optimistic toggle: show ON immediately while enabling, OFF immediately while disabling
  const toggleEnabled = isBusy
    ? (isEnabling ? true : isDisabling ? false : isActive)
    : isActive;

  const hasUpdate = installedVersion && latestVersion && compareVersions(latestVersion, installedVersion) > 0;

  const handleFileLockedRetry = useCallback(async () => {
    const result = await confirm({
      title: "Close Steam?",
      description: "This will close Steam and any running games. LumaForge will retry the operation after Steam closes.",
      confirmLabel: "Close Steam",
      variant: "danger",
    });
    if (!result.confirmed || !fileLockedOperation) return;

    try {
      await terminateProcessByName("steam.exe");
      // Wait briefly for Steam to fully exit
      await new Promise((r) => setTimeout(r, 1500));
    } catch {
      // terminateProcessByName may throw if Steam isn't running — ignore,
      // the retry will succeed anyway or surface a new error.
    }

    onOperation(manifest.id, fileLockedOperation);
  }, [confirm, fileLockedOperation, manifest.id, onOperation]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
      <div className="flex items-start gap-3">
        {/* Icon placeholder */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-(--color-accent)/10">
          <Puzzle className="h-5 w-5 text-(--color-accent)" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-(--color-foreground)">
              {manifest.displayName}
            </h4>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
              v{manifest.version}
            </span>
          </div>
          <p className="mt-1 text-xs text-(--color-muted) line-clamp-2">
            {manifest.description}
          </p>

          {/* Version info */}
          {isInstalled && (
            <div className="mt-2 flex items-center gap-3 text-[10px] text-white/30">
              <span>Installed: {installedVersion || "Unknown"}</span>
              {latestVersion && (
                <span>Latest: {latestVersion}</span>
              )}
              {hasUpdate && (
                <span className="text-emerald-400">Update available</span>
              )}
            </div>
          )}

          {/* Meta row */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-white/30">
            {manifest.author && <span>by {manifest.author}</span>}
            {manifest.license && <span>{manifest.license}</span>}
            <span>Source: {extension.sourceId}</span>
          </div>

          {/* Capabilities */}
          {manifest.capabilities && manifest.capabilities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {manifest.capabilities.map((cap) => (
                <span
                  key={cap.id}
                  className="inline-flex items-center gap-1 rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-[10px] text-(--color-accent)"
                >
                  <Layers className="h-2.5 w-2.5" />
                  {cap.id}
                </span>
              ))}
            </div>
          )}

          {/* Permissions */}
          {manifest.permissions && manifest.permissions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {manifest.permissions.map((perm) => (
                <span
                  key={perm.id}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400"
                >
                  <Shield className="h-2.5 w-2.5" />
                  {perm.id}
                </span>
              ))}
            </div>
          )}

          {/* Error display */}
          {fileLockedOperation && (
            <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <div className="flex-1">
                  <p className="text-xs text-amber-300">
                    Steam is currently running and has these files in use. Close Steam to continue.
                  </p>
                  <button
                    onClick={handleFileLockedRetry}
                    disabled={isBusy}
                    className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    Close Steam and Retry
                  </button>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="mt-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
              {error}
            </div>
          )}
        </div>

        {/* Status + Actions */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={status} />
          
          <div className="flex gap-1">
            {!isInstalled && (
              <button
                onClick={() => onOperation(manifest.id, "install")}
                disabled={isBusy}
                className="flex items-center gap-1 rounded-lg bg-(--color-accent)/20 px-3 py-1.5 text-[10px] text-(--color-accent) hover:bg-(--color-accent)/30 disabled:opacity-50"
              >
                {isInstalling ? (
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Download className="h-2.5 w-2.5" />
                )}
                {isInstalling ? "Installing..." : "Install"}
              </button>
            )}

            {isInstalled && (
              <>
                {/* Toggle switch — same design as ToggleOption in Settings */}
                <button
                  type="button"
                  onClick={() => onOperation(manifest.id, toggleEnabled ? "disable" : "enable")}
                  disabled={isBusy}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                    toggleEnabled ? "bg-(--color-accent)" : "bg-white/10"
                  } ${isBusy ? "cursor-not-allowed opacity-50" : ""}`}
                  role="switch"
                  aria-checked={toggleEnabled}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                      toggleEnabled ? "left-6" : "left-1"
                    }`}
                  />
                </button>

                {hasUpdate && (
                  <button
                    onClick={() => onOperation(manifest.id, "update")}
                    disabled={isBusy}
                    className="flex items-center gap-1 rounded-lg bg-blue-500/20 px-3 py-1.5 text-[10px] text-blue-400 hover:bg-blue-500/30 disabled:opacity-50"
                  >
                    {isUpdating ? (
                      <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Download className="h-2.5 w-2.5" />
                    )}
                    {isUpdating ? "Updating..." : "Update"}
                  </button>
                )}

                <button
                  onClick={async () => {
                    const managedFileNames = manifest.managedFiles?.map((f) => f.path).join(", ");
                    const result = await confirm({
                      title: `Uninstall ${manifest.displayName}?`,
                      description: managedFileNames
                        ? `This will permanently remove all managed files (${managedFileNames}) from the Steam directory. You can reinstall later from this panel.`
                        : `This will permanently remove ${manifest.displayName} from the Steam directory. You can reinstall later from this panel.`,
                      confirmLabel: "Uninstall",
                      variant: "danger",
                    });
                    if (result.confirmed) {
                      onOperation(manifest.id, "uninstall");
                    }
                  }}
                  disabled={isBusy}
                  className="flex items-center gap-1 rounded-lg bg-rose-500/20 px-3 py-1.5 text-[10px] text-rose-400 hover:bg-rose-500/30 disabled:opacity-50"
                >
                  {isUninstalling ? (
                    <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-2.5 w-2.5" />
                  )}
                  {isUninstalling ? "Uninstalling..." : "Uninstall"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Browse Extension Card — Marketplace card for not-yet-installed extensions
// =============================================================================

function BrowseExtensionCard({
  extension,
  state,
  onOperation,
}: {
  extension: RegisteredExtension;
  state?: ExtensionState;
  onOperation: (extensionId: string, operation: "install" | "update" | "enable" | "disable" | "uninstall") => void;
}) {
  const { manifest } = extension;
  const operation = state?.operation || "idle";
  const error = state?.error;
  const isInstalling = operation === "installing";
  const isBusy = isInstalling;

  return (
    <div className="rounded-xl border border-(--color-accent)/20 bg-(--color-accent)/[0.03] p-4 transition-colors hover:bg-(--color-accent)/[0.06]">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-(--color-accent)/10">
          <Puzzle className="h-6 w-6 text-(--color-accent)" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-(--color-foreground)">
              {manifest.displayName}
            </h4>
            <span className="inline-flex items-center gap-1 rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-[10px] font-medium text-(--color-accent)">
              v{manifest.version}
            </span>
            {extension.sourceId !== "builtin" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
                <ExternalLink className="h-2.5 w-2.5" />
                Repository
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-(--color-muted) line-clamp-2">
            {manifest.description}
          </p>

          {/* Meta row */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-white/30">
            {manifest.author && <span>by {manifest.author}</span>}
            {manifest.license && <span>{manifest.license}</span>}
            {manifest.categories && manifest.categories.length > 0 && (
              <span>{manifest.categories.join(", ")}</span>
            )}
          </div>

          {/* Capabilities */}
          {manifest.capabilities && manifest.capabilities.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {manifest.capabilities.map((cap) => (
                <span
                  key={cap.id}
                  className="inline-flex items-center gap-1 rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-[10px] text-(--color-accent)"
                >
                  <Layers className="h-2.5 w-2.5" />
                  {cap.id}
                </span>
              ))}
            </div>
          )}

          {/* Permissions */}
          {manifest.permissions && manifest.permissions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {manifest.permissions.map((perm) => (
                <span
                  key={perm.id}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400"
                >
                  <Shield className="h-2.5 w-2.5" />
                  {perm.id}
                </span>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
              {error}
            </div>
          )}
        </div>

        {/* Install button */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            onClick={() => onOperation(manifest.id, "install")}
            disabled={isBusy}
            className="flex items-center gap-1.5 rounded-lg bg-(--color-accent)/20 px-4 py-2 text-xs font-medium text-(--color-accent) hover:bg-(--color-accent)/30 disabled:opacity-50"
          >
            {isInstalling ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {isInstalling ? "Installing..." : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Status Badge
// =============================================================================

function StatusBadge({ status }: { status: ExtensionStatus }) {
  const config: Record<string, { label: string; color: string }> = {
    available: { label: "Available", color: "bg-blue-500/10 text-blue-400" },
    installing: { label: "Installing", color: "bg-blue-500/10 text-blue-400" },
    installed: { label: "Installed", color: "bg-emerald-500/10 text-emerald-400" },
    enabled: { label: "Enabled", color: "bg-emerald-500/10 text-emerald-400" },
    disabled: { label: "Disabled", color: "bg-zinc-500/10 text-zinc-400" },
    updating: { label: "Updating", color: "bg-blue-500/10 text-blue-400" },
    error: { label: "Error", color: "bg-rose-500/10 text-rose-400" },
    uninstalling: { label: "Uninstalling", color: "bg-rose-500/10 text-rose-400" },
  };

  const { label, color } = config[status] ?? config.available;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${color}`}>
      {(status === "enabled" || status === "installed") && <Check className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

// =============================================================================
// Browse Extensions Modal
// =============================================================================

function BrowseExtensionsModal({
  open,
  onClose,
  extensions,
  extensionStates,
  onOperation,
}: {
  open: boolean;
  onClose: () => void;
  extensions: RegisteredExtension[];
  extensionStates: Map<string, ExtensionState>;
  onOperation: (extensionId: string, operation: "install" | "update" | "enable" | "disable" | "uninstall") => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40"
    >
      <div className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[--color-bg] p-6 lf-surface">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-accent)/10">
              <Store className="h-5 w-5 text-(--color-accent)" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-(--color-foreground)">Browse Extensions</h2>
              <p className="text-xs text-(--color-muted)">
                Discover extensions from the repository
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) hover:bg-white/10 hover:text-(--color-foreground) transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 flex-1 overflow-y-auto -mr-2 pr-2">
          {extensions.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <Store className="mx-auto mb-3 h-8 w-8 text-white/20" />
              <p className="text-sm text-(--color-muted)">
                No extensions available in the repository.
              </p>
              <p className="mt-1 text-xs text-white/30">
                Extensions will appear here once they are published.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {extensions.map((ext) => (
                <BrowseExtensionCard
                  key={ext.manifest.id}
                  extension={ext}
                  state={extensionStates.get(ext.manifest.id)}
                  onOperation={onOperation}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function groupBySurface(extensions: RegisteredExtension[]): Partial<Record<ExtensionSurface, RegisteredExtension[]>> {
  const grouped: Partial<Record<ExtensionSurface, RegisteredExtension[]>> = {};
  for (const ext of extensions) {
    for (const surface of ext.surfaces) {
      if (!grouped[surface]) grouped[surface] = [];
      grouped[surface]!.push(ext);
    }
  }
  return grouped;
}
