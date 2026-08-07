/**
 * steamAchievementBackupService.ts
 *
 * Backup and restore for LumaForge-owned achievement data files.
 *
 * Achievement icons (PNG/JPG from CDN downloads) are NOT backed up.
 * They are re-downloaded automatically on next achievement scan.
 * Only JSON metadata (summaries, percentages, image_sources) is included.
 *
 * Uses the auditor (steamAchievementAuditor.ts) for real disk-based collection
 * and the external_files Rust module for safe restore with checksums.
 */

import {
  resolveAchievementsRootDir,
  createExternalSafetyBackup,
  restoreExternalFiles,
  type ExternalFileRestoreEntry,
} from "./tauri";
import {
  auditAchievementData,
  readAchievementFilesContent,
  type AchievementAuditEntry,
} from "./steamAchievementAuditor";

// ── Path prefix in backup archive ──

export const ACHIEVEMENT_BACKUP_PREFIX = "steam/achievements/";

// ── Export ──

/**
 * Combined collector for the "steamAchievementInputs" backup section.
 * Reads LumaForge-owned achievement JSON files from disk via the Rust
 * external_files module, embedded in the backup archive.
 *
 * Falls back to empty if the achievements directory is not available.
 */
export async function collectSteamAchievementBackupData(): Promise<
  Array<{ path: string; data: string }>
> {
  try {
    const achievementsDir = await resolveAchievementsRootDir("steam");
    const audit = await auditAchievementData(achievementsDir);

    if (audit.totalFiles === 0) return [];

    const safePaths = audit.entries
      .filter((e: AchievementAuditEntry) => e.safe)
      .map((e: AchievementAuditEntry) => e.relativePath);

    if (safePaths.length === 0) return [];

    const contentMap = await readAchievementFilesContent(achievementsDir, safePaths);

    return Object.entries(contentMap).map(([relPath, data]) => ({
      path: `${ACHIEVEMENT_BACKUP_PREFIX}${relPath}`,
      data,
    }));
  } catch {
    return [];
  }
}

// ── Restore ──

/**
 * Restore achievement data files from backup archive data.
 *
 * Creates a safety backup of existing files, writes the restored files
 * to disk via the Rust external_files module, and verifies checksums.
 */
export async function restoreAchievementFilesFromBackup(
  archiveData: Record<string, string>,
  selectedPaths: string[],
): Promise<{
  restored: number;
  failed: number;
  errors: string[];
}> {
  const result = { restored: 0, failed: 0, errors: [] as string[] };

  if (selectedPaths.length === 0) return result;

  const achievementsDir = await resolveAchievementsRootDir("steam");

  const restoreEntries: ExternalFileRestoreEntry[] = [];
  for (const selPath of selectedPaths) {
    const archiveKey = selPath.startsWith(ACHIEVEMENT_BACKUP_PREFIX)
      ? selPath
      : `${ACHIEVEMENT_BACKUP_PREFIX}${selPath}`;

    const data = archiveData[archiveKey] ?? archiveData[selPath];
    if (data === undefined) {
      result.errors.push(`Missing data for: ${selPath}`);
      result.failed++;
      continue;
    }

    const relativePath = archiveKey.slice(ACHIEVEMENT_BACKUP_PREFIX.length);

    // Compute SHA-256 checksum for post-restore verification
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encodedData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const checksum = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    restoreEntries.push({ relativePath, content: data, expectedChecksum: checksum });
  }

  if (restoreEntries.length === 0) return result;

  const operationId = `achievement-restore-${Date.now()}`;
  const relativePaths = restoreEntries.map((e) => e.relativePath);

  // Safety backup before writing
  try {
    await createExternalSafetyBackup(
      operationId,
      achievementsDir,
      relativePaths,
    );
  } catch (e) {
    result.errors.push(`Safety backup failed: ${e}`);
  }

  // Restore files
  try {
    const restoreResult = await restoreExternalFiles(
      achievementsDir,
      restoreEntries,
    );
    result.restored = restoreResult.restored;
    result.failed += restoreResult.failed;
    result.errors.push(...restoreResult.errors);
  } catch (e) {
    result.errors.push(`Restore failed: ${e}`);
    result.failed += restoreEntries.length;
  }

  return result;
}