/**
 * Extension Runtime Types — Runtime record, status, snapshot, and enabled-state abstraction.
 *
 * Pure types and interfaces. No side effects, no I/O, no network.
 * Consumes ExtensionManifestV1 from ../types without modifying it.
 */

import type { ExtensionManifestV1 } from "../types";
import type { ExtensionSurfaceContribution } from "../contributions/types";

// =============================================================================
// Runtime Status
// =============================================================================

/**
 * Lifecycle status of an extension in the Runtime.
 *
 * Distinct from the specification's ExtensionStatus which covers install/disk state.
 * This status reflects the Runtime's opinion: is the extension valid, compatible,
 * and eligible to produce active contributions?
 */
export type ExtensionRuntimeStatus =
  | "registered"   // Manifest validated and inserted into store
  | "available"    // Registered and eligible, not yet toggled
  | "enabled"      // User has enabled; contributions are active
  | "disabled"     // User has disabled; contributions are inactive
  | "incompatible" // Registered but incompatible with the launcher
  | "invalid"      // Registered but failed validation
  | "error";       // Runtime error during processing

// =============================================================================
// Runtime Record
// =============================================================================

/**
 * A single extension's runtime state.
 *
 * The RuntimeStore is the sole owner of RuntimeRecords.
 * Records are immutable snapshots — the store replaces them on mutation.
 */
export interface ExtensionRuntimeRecord {
  /** The validated manifest. */
  manifest: ExtensionManifestV1;

  /** Current runtime status. */
  status: ExtensionRuntimeStatus;

  /** Source that provided this extension (e.g. "builtin", "dev-fixture"). */
  sourceId: string;

  /** Whether this extension is bundled with the launcher. */
  builtIn: boolean;

  /** Whether the user has enabled this extension. */
  enabled: boolean;

  /** Launcher compatibility result. */
  compatibility: {
    compatible: boolean;
    reasons: string[];
  };

  /** Schema + identity + semantic-version validation result. */
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };

  /** Permissions granted (all declared permissions for valid+compatible). */
  grantedPermissions: string[];

  /** Active capabilities (only when enabled + valid + compatible). */
  activeCapabilities: string[];

  /** Active surface contributions (only when enabled + valid + compatible). */
  activeContributions: ExtensionSurfaceContribution[];

  /** Timestamp of registration (ms since epoch). */
  registeredAt: number;

  /** Timestamp of last state update (ms since epoch). */
  updatedAt: number;
}

// =============================================================================
// Runtime Snapshot
// =============================================================================

/**
 * Immutable snapshot of the entire Runtime state.
 * Returned by ExtensionRuntimeStore.snapshot().
 */
export interface ExtensionRuntimeSnapshot {
  /** All registered records, keyed by extension ID. */
  records: Map<string, ExtensionRuntimeRecord>;

  /** Total registered extensions. */
  total: number;

  /** Count by status. */
  enabledCount: number;
  disabledCount: number;
  incompatibleCount: number;
  invalidCount: number;
  errorCount: number;

  /** Monotonically increasing version counter. Increments on every state change. */
  version: number;

  /** Timestamp of this snapshot. */
  timestamp: number;
}

// =============================================================================
// Enabled-State Persistence Abstraction
// =============================================================================

/**
 * Abstraction for persisting enabled/disabled state.
 *
 * Production wiring will connect this to Settings or localStorage.
 * For this isolated phase, the Runtime uses an in-memory default
 * and the abstraction is tested independently.
 */
export interface EnabledStatePersistence {
  /** Read the enabled state for a given extension ID. */
  getEnabled(extensionId: string): boolean | undefined;

  /** Write the enabled state for a given extension ID. */
  setEnabled(extensionId: string, enabled: boolean): void;

  /** Read all persisted enabled states. */
  getAll(): Record<string, boolean>;

  /** Clear all persisted enabled states. */
  clear(): void;
}

/**
 * In-memory implementation of EnabledStatePersistence.
 * Used as default when no production persistence is wired.
 */
export class InMemoryEnabledState implements EnabledStatePersistence {
  private _state = new Map<string, boolean>();

  getEnabled(extensionId: string): boolean | undefined {
    return this._state.get(extensionId);
  }

  setEnabled(extensionId: string, enabled: boolean): void {
    this._state.set(extensionId, enabled);
  }

  getAll(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [k, v] of this._state) {
      result[k] = v;
    }
    return result;
  }

  clear(): void {
    this._state.clear();
  }
}
