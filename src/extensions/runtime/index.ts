/**
 * Transaction System — Interfaces for atomic, rollbackable operations.
 *
 * The transaction system ensures that extension install/update/enable/disable
 * operations are atomic: either all steps succeed, or all side effects are
 * rolled back.
 *
 * No file operations, no rename logic, no filesystem interaction.
 * Only the interfaces are defined here.
 */

/** A single step in a transaction. */
export interface TransactionStep {
  /** Human-readable name for this step (for logging). */
  name: string;
  /** Execute this step. */
  execute(): Promise<void>;
  /** Rollback this step (called in reverse order on failure). */
  rollback?(): Promise<void>;
}

/** A complete transaction consisting of ordered steps. */
export interface Transaction {
  /** Human-readable name for the transaction (for logging). */
  name: string;
  /** Ordered steps to execute. */
  steps: TransactionStep[];
}

/** Result of executing a transaction. */
export interface TransactionResult {
  /** Whether all steps succeeded. */
  success: boolean;
  /** Error message if any step failed. */
  error?: string;
  /** Whether rollback was performed. */
  rolledBack: boolean;
  /** Names of steps that were rolled back (in reverse order). */
  rolledBackSteps?: string[];
}

/**
 * Transaction executor interface.
 *
 * Responsible for executing a Transaction and handling rollback.
 * The executor itself does not contain business logic — it only
 * orchestrates the steps.
 */
export interface TransactionExecutor {
  /**
   * Execute a transaction.
   * If any step fails, execute all completed steps' rollback methods
   * in reverse order.
   */
  execute(transaction: Transaction): Promise<TransactionResult>;
}

// =============================================================================
// Runtime Types
// =============================================================================

export type {
  ExtensionRuntimeStatus,
  ExtensionRuntimeRecord,
  ExtensionRuntimeSnapshot,
  EnabledStatePersistence,
} from "./types";
export {
  InMemoryEnabledState,
} from "./types";

// =============================================================================
// Compatibility
// =============================================================================

export {
  evaluateCompatibility,
  getLauncherVersion,
} from "./compatibility";

// =============================================================================
// Validation
// =============================================================================

export {
  validateManifest,
} from "./validation";

// =============================================================================
// Store
// =============================================================================

export {
  registerExtensionRuntime,
  unregisterExtensionRuntime,
  enableExtension,
  disableExtension,
  setResolvedContributions,
  getExtensionRuntime,
  getAllExtensionRuntimes,
  snapshot,
  addListener,
  setEnabledPersistence,
  getEnabledPersistence,
  getRuntimeVersion,
  resetRuntimeStore,
} from "./store";
