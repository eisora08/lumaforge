/**
 * Extension Manager — Live registry of loaded extensions.
 *
 * Owns the in-memory registry and provides the public API for
 * registering, looking up, and enumerating extensions.
 *
 * No file I/O, no network calls, no side effects beyond in-memory state.
 * Subscribers are notified synchronously on state changes.
 */

import type { ExtensionId, ExtensionManifestV1, ExtensionStatus } from "../types";

// =============================================================================
// Types
// =============================================================================

/** Surface where an extension appears (settings, tools, library). */
export type ExtensionSurface = "settings" | "tools" | "library";

/** A registered extension with runtime metadata. */
export interface RegisteredExtension {
  manifest: ExtensionManifestV1;
  status: ExtensionStatus;
  sourceId: string;
  surfaces: ExtensionSurface[];
  loadedAt: number;
}

/** Snapshot of the manager state. */
export interface ExtensionManagerSnapshot {
  extensions: RegisteredExtension[];
  count: number;
}

type Listener = () => void;

// =============================================================================
// ExtensionManager (singleton)
// =============================================================================

const _extensions = new Map<ExtensionId, RegisteredExtension>();
const _listeners = new Set<Listener>();

function _notify(): void {
  for (const listener of _listeners) {
    listener();
  }
}

/**
 * Subscribe to manager state changes.
 * Returns an unsubscribe function.
 */
export function subscribeExtensionManager(listener: Listener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/**
 * Get a snapshot of all registered extensions.
 */
export function getExtensionManagerSnapshot(): ExtensionManagerSnapshot {
  const extensions = Array.from(_extensions.values());
  return { extensions, count: extensions.length };
}

/**
 * Register a validated extension.
 * Replaces any existing extension with the same ID.
 */
export function registerLoadedExtension(
  manifest: ExtensionManifestV1,
  sourceId: string,
): RegisteredExtension {
  const surfaces = extractSurfaces(manifest);
  const entry: RegisteredExtension = {
    manifest,
    status: "available",
    sourceId,
    surfaces,
    loadedAt: Date.now(),
  };
  _extensions.set(manifest.id, entry);
  _notify();
  return entry;
}

/**
 * Unregister an extension by ID.
 */
export function unregisterLoadedExtension(extensionId: ExtensionId): boolean {
  const existed = _extensions.delete(extensionId);
  if (existed) {
    _notify();
  }
  return existed;
}

/**
 * Get a registered extension by ID.
 */
export function getRegisteredExtension(extensionId: ExtensionId): RegisteredExtension | undefined {
  return _extensions.get(extensionId);
}

/**
 * List all registered extensions.
 */
export function listExtensions(): RegisteredExtension[] {
  return Array.from(_extensions.values());
}

/**
 * Get extensions filtered by surface.
 */
export function getExtensionsBySurface(surface: ExtensionSurface): RegisteredExtension[] {
  return Array.from(_extensions.values()).filter((ext) => ext.surfaces.includes(surface));
}

/**
 * Get the count of registered extensions.
 */
export function getRegisteredExtensionCount(): number {
  return _extensions.size;
}

/**
 * Clear all registered extensions (for testing/reset).
 */
export function clearExtensionManager(): void {
  _extensions.clear();
  _notify();
}

// =============================================================================
// Runtime Manager Integration
// =============================================================================

import type { ExtensionRuntimeRecord as RuntimeRecord } from "../runtime/types";
import {
  registerExtensionRuntime,
  setResolvedContributions,
  enableExtension,
  disableExtension,
  snapshot as runtimeSnapshot,
} from "../runtime/store";
import { evaluateCompatibility } from "../runtime/compatibility";
import { validateManifest } from "../runtime/validation";
import { resolveContributions, filterActiveContributions } from "../contributions/resolver";

/**
 * Runtime Manager registration result.
 */
export interface RuntimeRegistrationResult {
  record: RuntimeRecord;
  stage: string;
  success: boolean;
  error?: string;
}

/**
 * Register a manifest through the full RuntimeManager pipeline:
 * schema → identity → semver → compatibility → permission → capability
 * → contribution → registry → publication.
 */
export function registerManifestAsRuntime(
  manifest: ExtensionManifestV1,
  options: {
    sourceId: string;
    builtIn: boolean;
  },
): RuntimeRegistrationResult {
  // Validate
  const validation = validateManifest(manifest);

  // Compatibility
  const compatibility = evaluateCompatibility(manifest);

  // Permissions — granted = all declared
  const grantedPermissions = (manifest.permissions ?? []).map((p) => p.id);

  // Active capabilities — only when valid + compatible
  const activeCapabilities =
    validation.valid && compatibility.compatible
      ? (manifest.capabilities ?? []).map((c) => c.id)
      : [];

  // Contributions
  const contributionResult = resolveContributions(manifest, grantedPermissions);
  const allContributions = contributionResult.contributions;
  const activeContributions =
    validation.valid && compatibility.compatible
      ? filterActiveContributions(allContributions, activeCapabilities, grantedPermissions)
      : [];

  // Register into RuntimeStore
  const record = registerExtensionRuntime(manifest, {
    sourceId: options.sourceId,
    builtIn: options.builtIn,
    compatibility,
    validation,
    grantedPermissions,
    activeCapabilities,
    activeContributions,
  });

  // Store resolved contributions for enable/disable toggle
  setResolvedContributions(manifest.id, allContributions);

  let stage = "complete";
  if (!validation.valid) stage = "validation-failed";
  else if (!compatibility.compatible) stage = "incompatible";

  return {
    record,
    stage,
    success: validation.valid && compatibility.compatible,
    error: validation.errors.length > 0 ? validation.errors.join("; ") : undefined,
  };
}

/**
 * Get the full RuntimeStore snapshot.
 */
export function getRuntimeStoreSnapshot() {
  return runtimeSnapshot();
}

/**
 * Enable an extension via the RuntimeStore.
 */
export function enableRuntimeExtension(extensionId: string): RuntimeRecord | null {
  return enableExtension(extensionId);
}

/**
 * Disable an extension via the RuntimeStore.
 */
export function disableRuntimeExtension(extensionId: string): RuntimeRecord | null {
  return disableExtension(extensionId);
}

/**
 * Tools projection — derive Tools view models from the RuntimeStore.
 */
export interface ToolsProjectionItem {
  id: string;
  extensionId: string;
  extensionName: string;
  displayName: string;
  description?: string;
  icon?: string;
  priority?: number;
  source: string;
  builtIn: boolean;
}

export function projectToolsContributions(isProduction: boolean = false): ToolsProjectionItem[] {
  const snap = runtimeSnapshot();
  const items: ToolsProjectionItem[] = [];

  for (const record of snap.records.values()) {
    if (record.status !== "enabled") continue;
    if (!record.validation.valid || !record.compatibility.compatible) continue;
    if (isProduction && record.sourceId === "dev-fixture") continue;

    const toolContributions = record.activeContributions.filter(
      (c) => c.surface === "tools",
    );

    for (const contrib of toolContributions) {
      items.push({
        id: contrib.id,
        extensionId: record.manifest.id,
        extensionName: record.manifest.displayName,
        displayName: contrib.displayName,
        description: contrib.description,
        icon: contrib.icon,
        priority: contrib.priority,
        source: record.sourceId,
        builtIn: record.builtIn,
      });
    }
  }

  items.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  return items;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract surfaces from a manifest's metadata or categories.
 * Looks for a "surfaces" key in metadata, defaults to ["settings"].
 */
function extractSurfaces(manifest: ExtensionManifestV1): ExtensionSurface[] {
  const meta = manifest.metadata as Record<string, unknown> | undefined;
  const surfaces = meta?.surfaces;

  if (Array.isArray(surfaces)) {
    const valid: ExtensionSurface[] = [];
    for (const s of surfaces) {
      if (s === "settings" || s === "tools" || s === "library") {
        valid.push(s);
      }
    }
    if (valid.length > 0) return valid;
  }

  // Default: settings
  return ["settings"];
}
