/**
 * Extension Runtime Store — Pure in-memory store of extension runtime records.
 *
 * The RuntimeStore is the single source of truth for runtime state.
 * It owns ExtensionRuntimeRecords and publishes state changes via listeners.
 *
 * No file I/O, no network calls, no side effects beyond in-memory state.
 * One invalid extension does not block valid extensions.
 * Runtime failure does not block Core.
 */

import type { ExtensionManifestV1 } from "../types";
import type { ExtensionRuntimeRecord, ExtensionRuntimeStatus, ExtensionRuntimeSnapshot, EnabledStatePersistence } from "./types";
import type { ExtensionSurfaceContribution } from "../contributions/types";
import { InMemoryEnabledState } from "./types";

// =============================================================================
// State
// =============================================================================

let _records = new Map<string, ExtensionRuntimeRecord>();
let _listeners = new Set<() => void>();
let _version = 0;
let _enabledPersistence: EnabledStatePersistence = new InMemoryEnabledState();

// =============================================================================
// Store Operations
// =============================================================================

/**
 * Register a validated manifest into the RuntimeStore.
 * Produces a full ExtensionRuntimeRecord with compatibility, validation, and contribution state.
 *
 * One invalid extension does not block valid extensions.
 * Duplicate IDs are rejected deterministically (first registration wins).
 */
export function registerExtensionRuntime(
  manifest: ExtensionManifestV1,
  options: {
    sourceId: string;
    builtIn: boolean;
    compatibility: { compatible: boolean; reasons: string[] };
    validation: { valid: boolean; errors: string[]; warnings: string[] };
    grantedPermissions: string[];
    activeCapabilities: string[];
    activeContributions: ExtensionSurfaceContribution[];
  },
): ExtensionRuntimeRecord {
  // Reject duplicates deterministically
  if (_records.has(manifest.id)) {
    const existing = _records.get(manifest.id)!;
    return existing;
  }

  const now = Date.now();

  // Determine initial status
  let status: ExtensionRuntimeStatus = "registered";
  if (!options.validation.valid) {
    status = "invalid";
  } else if (!options.compatibility.compatible) {
    status = "incompatible";
  } else {
    // Check persisted enabled state
    const persisted = _enabledPersistence.getEnabled(manifest.id);
    status = persisted === false ? "disabled" : "available";
  }

  const record: ExtensionRuntimeRecord = {
    manifest,
    status,
    sourceId: options.sourceId,
    builtIn: options.builtIn,
    enabled: status === "available",
    compatibility: options.compatibility,
    validation: options.validation,
    grantedPermissions: options.grantedPermissions,
    activeCapabilities: [],
    activeContributions: [],
    registeredAt: now,
    updatedAt: now,
  };

  _records.set(manifest.id, record);
  _version++;
  _notify();
  return record;
}

/**
 * Unregister an extension by ID.
 * Returns true if found and removed.
 */
export function unregisterExtensionRuntime(extensionId: string): boolean {
  const existed = _records.delete(extensionId);
  if (existed) {
    _version++;
    _notify();
  }
  return existed;
}

/**
 * Enable an extension.
 * Requires the extension to be valid and compatible.
 * Activates eligible metadata contributions.
 * Does not activate external software.
 */
export function enableExtension(extensionId: string): ExtensionRuntimeRecord | null {
  const record = _records.get(extensionId);
  if (!record) return null;
  if (!record.validation.valid || !record.compatibility.compatible) return null;

  const updated: ExtensionRuntimeRecord = {
    ...record,
    status: "enabled",
    enabled: true,
    activeCapabilities: record.grantedPermissions.length > 0
      ? record.manifest.capabilities?.map((c) => c.id) ?? []
      : [],
    activeContributions: (record as MutableRecord)._resolvedContributions ?? [],
    updatedAt: Date.now(),
  };

  _records.set(extensionId, updated);
  _enabledPersistence.setEnabled(extensionId, true);
  _version++;
  _notify();
  return updated;
}

/**
 * Disable an extension.
 * Removes active contributions but preserves registration, manifest, source, and preferences.
 * Does not uninstall anything. Does not modify files.
 */
export function disableExtension(extensionId: string): ExtensionRuntimeRecord | null {
  const record = _records.get(extensionId);
  if (!record) return null;

  const updated: ExtensionRuntimeRecord = {
    ...record,
    status: "disabled",
    enabled: false,
    activeCapabilities: [],
    activeContributions: [],
    updatedAt: Date.now(),
  };

  _records.set(extensionId, updated);
  _enabledPersistence.setEnabled(extensionId, false);
  _version++;
  _notify();
  return updated;
}

/**
 * Update resolved contributions for a record (called after registration pipeline).
 * Stores the full contribution list so enable() can restore them.
 */
export function setResolvedContributions(
  extensionId: string,
  contributions: ExtensionSurfaceContribution[],
): void {
  const record = _records.get(extensionId);
  if (!record) return;

  (record as MutableRecord)._resolvedContributions = contributions;
  record.updatedAt = Date.now();
  _version++;
  // Don't notify — this is an internal update during registration
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Get a record by extension ID.
 */
export function getExtensionRuntime(extensionId: string): ExtensionRuntimeRecord | undefined {
  return _records.get(extensionId);
}

/**
 * Get all registered records.
 */
export function getAllExtensionRuntimes(): ExtensionRuntimeRecord[] {
  return Array.from(_records.values());
}

/**
 * Get an immutable snapshot of the entire Runtime state.
 */
export function snapshot(): ExtensionRuntimeSnapshot {
  const records = new Map(_records);
  let enabledCount = 0;
  let disabledCount = 0;
  let incompatibleCount = 0;
  let invalidCount = 0;
  let errorCount = 0;

  for (const record of records.values()) {
    switch (record.status) {
      case "enabled":
      case "available":
        enabledCount++;
        break;
      case "disabled":
        disabledCount++;
        break;
      case "incompatible":
        incompatibleCount++;
        break;
      case "invalid":
        invalidCount++;
        break;
      case "error":
        errorCount++;
        break;
    }
  }

  return {
    records,
    total: records.size,
    enabledCount,
    disabledCount,
    incompatibleCount,
    invalidCount,
    errorCount,
    version: _version,
    timestamp: Date.now(),
  };
}

// =============================================================================
// Listeners
// =============================================================================

export function addListener(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function _notify(): void {
  for (const listener of _listeners) {
    listener();
  }
}

// =============================================================================
// Persistence Abstraction
// =============================================================================

/**
 * Set the enabled-state persistence backend.
 * Default is InMemoryEnabledState.
 */
export function setEnabledPersistence(persistence: EnabledStatePersistence): void {
  _enabledPersistence = persistence;
}

/**
 * Get the current enabled-state persistence backend.
 */
export function getEnabledPersistence(): EnabledStatePersistence {
  return _enabledPersistence;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check whether any string contains "add-on" or "addon" terminology.
 * Used in tests to verify the Runtime avoids this terminology.
 */
export function containsAddOnTerminology(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("add-on") || lower.includes("addon") || lower.includes("add on");
}

/**
 * Get the current runtime version counter.
 */
export function getRuntimeVersion(): number {
  return _version;
}

/**
 * Reset the RuntimeStore to empty state (for testing).
 */
export function resetRuntimeStore(): void {
  _records = new Map();
  _version = 0;
  _enabledPersistence.clear();
  _notify();
}

// =============================================================================
// Internal
// =============================================================================

type MutableRecord = ExtensionRuntimeRecord & {
  _resolvedContributions?: ExtensionSurfaceContribution[];
};
