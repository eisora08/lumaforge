/**
 * Extensions Settings — Full UI for managing extensions.
 *
 * Displays extensions grouped by surface (settings, tools, library).
 * Provides real install/enable/disable/update/uninstall actions.
 * Detects status from disk on mount and after each operation.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Puzzle, Check, Shield, Layers, Box, Download, Settings, Trash2, RefreshCw } from "lucide-react";
import {
  listExtensions,
  subscribeExtensionManager,
  type RegisteredExtension,
  type ExtensionSurface,
} from "../manager";
import { bootstrapExtensions, type BootstrapResult } from "../bootstrap";
import { getExtension } from "../registry";
import type {
  ExtensionDetectionResult,
  ExtensionOperationResult,
  ExtensionStatus,
} from "../types";
import { useSettings } from "../../context/SettingsContext";
import { useConfirm } from "../../services/confirmService";
import { compareVersions } from "../services/githubReleaseService";

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
  const mountedRef = useRef(true);
  const latestDetectionKeyRef = useRef<string>("");

  // Bootstrap + subscribe
  useEffect(() => {
    mountedRef.current = true;
    let mounted = true;
    console.log(`[EXTENSIONS][DEBUG] Bootstrap useEffect starting...`);

    bootstrapExtensions().then((result) => {
      console.log(`[EXTENSIONS][DEBUG] Bootstrap resolved: registered=${result.registered}, extensions=${result.extensions.length}, errors=${result.errors.length}`);
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
    console.log(`[EXTENSIONS][DEBUG] detectExtensionStatus "${ext.manifest.id}": getExtension returned ${extension ? `Extension(id=${extension.manifest.id})` : "undefined"}`);
    if (!extension) return;

    try {
      const steamRoot = settings.steamRoot || "";
      const detectionKey = `${ext.manifest.id}:${steamRoot}`;
      latestDetectionKeyRef.current = detectionKey;
      console.log(`[EXTENSIONS][DEBUG] Detecting "${ext.manifest.id}" with steamRoot="${steamRoot}"`);
      
      const [detection, installedVersion, latestVersion] = await Promise.all([
        extension.detect(steamRoot),
        extension.getInstalledVersion(steamRoot),
        extension.getLatestVersion(),
      ]);

      console.log(`[EXTENSIONS][DEBUG] Detection for "${ext.manifest.id}": status=${detection.status}, installed=${installedVersion}, latest=${latestVersion}`);

      // Bug E fix: when PE header version is null but files are detected as installed,
      // fall back to the manifest version (DLLs may not embed version resources)
      const resolvedInstalledVersion = (!installedVersion && (detection.status === "enabled" || detection.status === "disabled" || detection.status === "installed"))
        ? ext.manifest.version
        : installedVersion;
      if (!installedVersion && resolvedInstalledVersion) {
        console.log(`[EXTENSIONS][DEBUG] Installed version fallback for "${ext.manifest.id}": PE=null → manifest v${resolvedInstalledVersion}`);
      }

      // Stale-call guard: skip if a newer detection started (different steamRoot or re-detection)
      if (latestDetectionKeyRef.current !== detectionKey) {
        console.log(`[EXTENSIONS][DEBUG] Stale detection skipped for "${ext.manifest.id}" (key mismatch: expected=${detectionKey}, current=${latestDetectionKeyRef.current})`);
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
        console.log(`[EXTENSIONS][DEBUG] mountedRef is false, skipping state update for "${ext.manifest.id}"`);
      }
    } catch (err) {
      console.error(`[EXTENSIONS][DEBUG] FAILED to detect status for "${ext.manifest.id}":`, err);
    }
  }, [settings.steamRoot]);

  // Detect status on mount and when extensions change
  useEffect(() => {
    console.log(`[EXTENSIONS][DEBUG] detect useEffect triggered: ${extensions.length} extensions`);
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

  // Handle extension operations via the Registry
  const handleOperation = useCallback(async (
    extensionId: string,
    operation: "install" | "update" | "enable" | "disable" | "uninstall"
  ) => {
    const extension = getExtension(extensionId);
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
        if (!result.success && result.error) {
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
          // Re-detect status after successful operation
          const ext = extensions.find((e) => e.manifest.id === extensionId);
          if (ext) {
            await detectExtensionStatus(ext);
          }

          // Notify library to rescan Lua state after enable/disable/uninstall
          if (operation === "enable" || operation === "disable" || operation === "uninstall") {
            window.dispatchEvent(new CustomEvent("lumaforge-lua-changed"));
          }
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

  // Group by surface
  const grouped = groupBySurface(extensions);
  const hasExtensions = extensions.length > 0;
  const hasErrors = bootstrap && bootstrap.errors.length > 0;

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

      {/* Extension list */}
      {hasExtensions && (
        <div className="space-y-6">
          {SURFACE_ORDER.map((surface) => {
            const exts = grouped[surface];
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

  const status = detection?.status || "available";
  const isInstalled = status === "enabled" || status === "disabled" || status === "installed";
  const isEnabled = status === "enabled";
  const isDisabled = status === "disabled";
  const isInstalling = operation === "installing";
  const isUpdating = operation === "updating";
  const isEnabling = operation === "enabling";
  const isDisabling = operation === "disabling";
  const isUninstalling = operation === "uninstalling";
  const isBusy = isInstalling || isUpdating || isEnabling || isDisabling || isUninstalling;

  const hasUpdate = installedVersion && latestVersion && compareVersions(latestVersion, installedVersion) > 0;

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
                {isEnabled && (
                  <button
                    onClick={() => onOperation(manifest.id, "disable")}
                    disabled={isBusy}
                    className="flex items-center gap-1 rounded-lg bg-amber-500/20 px-3 py-1.5 text-[10px] text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
                  >
                    {isDisabling ? (
                      <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Settings className="h-2.5 w-2.5" />
                    )}
                    {isDisabling ? "Disabling..." : "Disable"}
                  </button>
                )}

                {isDisabled && (
                  <button
                    onClick={() => onOperation(manifest.id, "enable")}
                    disabled={isBusy}
                    className="flex items-center gap-1 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[10px] text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    {isEnabling ? (
                      <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Check className="h-2.5 w-2.5" />
                    )}
                    {isEnabling ? "Enabling..." : "Enable"}
                  </button>
                )}

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
