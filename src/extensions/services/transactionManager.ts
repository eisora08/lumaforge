/**
 * Transaction Manager — Atomic file operations with rollback support.
 *
 * Provides a generic transactional execution framework for file operations.
 * Steps are executed in order; if any step fails, all completed rollbacks
 * are executed in reverse order.
 */

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
  await invoke("extension_rename_file", { from, to });
}

export async function removeFile(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("extension_remove_file", { path });
}

export async function fileExists(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("extension_file_exists", { path });
}

export async function createDir(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("extension_create_dir", { path });
}
