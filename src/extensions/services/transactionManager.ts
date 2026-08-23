/**
 * Transaction Manager — Atomic file operations with rollback support.
 *
 * Provides a generic transactional execution framework for file operations.
 * Steps are executed in order; if any step fails, all completed rollbacks
 * are executed in reverse order.
 */

// =============================================================================
// File-locked error (generic, usable by any extension)
// =============================================================================

/**
 * Error thrown when a file operation fails because the target file is locked
 * by a running process (Windows error 5: "Access is denied").
 *
 * This is a generic classification — any extension whose managed files
 * might be locked by a running process can trigger this. The UI layer
 * supplies the user-facing message/context (e.g. "Steam is running").
 */
export class FileLockedError extends Error {
  readonly lockedPath: string;

  constructor(message: string, lockedPath: string) {
    super(message);
    this.name = "FileLockedError";
    this.lockedPath = lockedPath;
  }
}

/**
 * Returns true if the error is a file-locked error from this module.
 */
export function isFileLockedError(err: unknown): err is FileLockedError {
  return err instanceof FileLockedError;
}

/**
 * Returns true if the error message indicates a file-lock / access-denied
 * condition from the OS.  This is the generic detection used by
 * {@link renameFile} and {@link removeFile}.
 */
function isOsFileLockedMessage(msg: string): boolean {
  return /Access is denied/i.test(msg) || /os error 5/i.test(msg);
}

// =============================================================================
// Transaction types
// =============================================================================

export interface TransactionStep {
  name: string;
  execute: () => Promise<void>;
  rollback?: () => Promise<void>;
}

export interface TransactionPlan {
  steps: TransactionStep[];
  name: string;
}

export interface TransactionResult {
  success: boolean;
  error?: string;
  rolledBack?: boolean;
  fileLocked?: boolean;
}

export async function executeTransaction(
  plan: TransactionPlan
): Promise<TransactionResult> {
  const completedRollbacks: Array<() => Promise<void>> = [];
  let lastError: string | null = null;

  for (const step of plan.steps) {
    try {
      await step.execute();
      if (step.rollback) {
        completedRollbacks.push(step.rollback);
      }
    } catch (err) {
      lastError =
        err instanceof Error ? err.message : String(err);

      for (let i = completedRollbacks.length - 1; i >= 0; i--) {
        try {
          await completedRollbacks[i]();
        } catch (_rollbackErr) {
          console.error(
            `[TRANSACTION][${plan.name}] rollback failed for step`,
            _rollbackErr
          );
        }
      }

      return {
        success: false,
        error: `${step.name} failed: ${lastError}`,
        rolledBack: true,
        fileLocked: isFileLockedError(err),
      };
    }
  }

  return { success: true };
}

export function createRenameStep(
  from: string,
  to: string,
  description: string
): TransactionStep {
  return {
    name: description,
    execute: async () => {
      await renameFile(from, to);
    },
    rollback: async () => {
      try {
        await renameFile(to, from);
      } catch {
        console.error(
          `[TRANSACTION] rollback rename failed: ${to} -> ${from}`
        );
      }
    },
  };
}

export function createBatchRenameStep(
  renames: Array<{ from: string; to: string }>,
  description: string
): TransactionStep {
  return {
    name: description,
    execute: async () => {
      for (const r of renames) {
        await renameFile(r.from, r.to);
      }
    },
    rollback: async () => {
      for (let i = renames.length - 1; i >= 0; i--) {
        try {
          await renameFile(renames[i].to, renames[i].from);
        } catch {
          console.error(
            `[TRANSACTION] rollback batch rename failed: ${renames[i].to} -> ${renames[i].from}`
          );
        }
      }
    },
  };
}

export function createRemoveStep(
  path: string,
  description: string
): TransactionStep {
  return {
    name: description,
    execute: async () => {
      await removeFile(path);
    },
    // No rollback for file deletion — file is gone permanently.
    // The caller must ensure the transaction is structured so that
    // deletion happens last (after verification steps).
  };
}

export async function renameFile(from: string, to: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("extension_rename_file", { from, to });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isOsFileLockedMessage(msg)) {
      throw new FileLockedError(msg, from);
    }
    throw err;
  }
}

export async function removeFile(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<boolean>("extension_remove_file", { path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isOsFileLockedMessage(msg)) {
      throw new FileLockedError(msg, path);
    }
    throw err;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("extension_file_exists", { path });
}

export async function createDir(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("extension_create_dir", { path });
}
