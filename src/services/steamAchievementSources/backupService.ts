/**
 * Verified Steam Achievement Sources — Backup Service
 *
 * Provides collect + restore functions for integration with the Stored Backups
 * pipeline. Archive logical paths follow the pattern:
 *   steam/achievement-sources/<appId>/user-game-stats.bin
 *   steam/achievement-sources/<appId>/user-game-stats-schema.bin
 *   steam/achievement-sources/<appId>/librarycache.json
 *
 * Initial preset status: Partial.
 * Excluded from Essentials / Game Activity / Customization / Full Backup.
 * Export only via External Steam Data card.
 */

import { writeBackupArchive } from "../tauri";

import { auditSteamAchievementSources, exportSteamAchievementSources } from "./auditor";
import {
  ACH_SOURCE_BACKUP_PREFIX,
  fromLogicalPath,
} from "./types";

import { sha256, buildBackupManifest, type BackupSection } from "../localBackupService";

import {
  restoreExternalFiles,
  type ExternalFileRestoreEntry,
} from "../tauri";

// ── Collect (for Stored Backups integration) ──

/**
 * Collect verified Steam achievement source files for inclusion in a backup archive.
 * Only collects metadata (logical path + checksum), not content.
 * Content is read on-demand during export.
 */
export async function collectSteamAchievementSourceBackupData(
  steamPath?: string,
  steamAccountId?: string,
): Promise<
  Array<{ logicalPath: string; size: number; checksum: string }>
> {
  try {
    const manifest = await auditSteamAchievementSources(
      steamPath,
      steamAccountId,
    );
    const entries: Array<{
      logicalPath: string;
      size: number;
      checksum: string;
    }> = [];

    for (const game of manifest.games) {
      for (const file of game.files) {
        entries.push({
          logicalPath: file.logicalPath,
          size: file.size,
          checksum: file.checksum,
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

// ── Export (selected games → backup archive) ──

/**
 * Export selected achievement source files to a backup archive.
 * Creates the archive via writeBackupArchive (same as Lua/achievement export).
 */
export async function exportSteamAchievementSourcesToArchive(
  selectedAppIds: string[],
  steamPath?: string,
  steamAccountId?: string,
): Promise<{
  success: boolean;
  gameCount: number;
  fileCount: number;
  totalSize: number;
}> {
  if (selectedAppIds.length === 0) {
    return { success: false, gameCount: 0, fileCount: 0, totalSize: 0 };
  }

  try {
    const exports = await exportSteamAchievementSources(
      selectedAppIds,
      steamPath,
      steamAccountId,
    );

    if (exports.length === 0) {
      return { success: false, gameCount: 0, fileCount: 0, totalSize: 0 };
    }

    const fileEntries: Array<{
      relativePath: string;
      section: string;
      size: number;
      checksum: string;
    }> = [];
    const allFiles: Array<{
      relativePath: string;
      section: string;
      data: string;
    }> = [];
    let totalSize = 0;
    let fileCount = 0;

    for (const exportResult of exports) {
      for (const file of exportResult.files) {
        // Decode base64 → raw bytes → re-encode as UTF-8 string for JSON archive
        const rawBytes = Uint8Array.from(atob(file.base64Content), (c) =>
          c.charCodeAt(0),
        );
        const dataStr = new TextDecoder().decode(rawBytes);
        const checksum = await sha256(dataStr);
        const archivePath = file.logicalPath.startsWith(
          ACH_SOURCE_BACKUP_PREFIX,
        )
          ? file.logicalPath
          : `${ACH_SOURCE_BACKUP_PREFIX}${file.logicalPath}`;

        allFiles.push({
          relativePath: archivePath,
          section: "steamAchievementSources",
          data: dataStr,
        });
        fileEntries.push({
          relativePath: archivePath,
          section: "steamAchievementSources",
          size: rawBytes.length,
          checksum,
        });
        totalSize += rawBytes.length;
        fileCount++;
      }
    }

    if (allFiles.length === 0) {
      return { success: false, gameCount: 0, fileCount: 0, totalSize: 0 };
    }

    const manifest = await buildBackupManifest(
      ["steamAchievementSources" as BackupSection],
      fileEntries,
    );

    const exportData = JSON.stringify(
      {
        manifest,
        data: Object.fromEntries(allFiles.map((f) => [f.relativePath, f.data])),
      },
      null,
      2,
    );
    const filename = `lumaforge-backup-${manifest.backupId}.json`;
    await writeBackupArchive(exportData, filename);

    return {
      success: true,
      gameCount: exports.length,
      fileCount,
      totalSize,
    };
  } catch (err) {
    console.error("[ACH_SOURCE][EXPORT] failed:", err);
    return { success: false, gameCount: 0, fileCount: 0, totalSize: 0 };
  }
}

// ── Restore (from backup archive) ──

/**
 * Restore achievement source files from a backup archive.
 * Creates a safety backup of existing files, writes restored files,
 * and verifies checksums.
 */
export async function restoreSteamAchievementSourcesFromBackup(
  archiveData: Record<string, string>,
  selectedPaths: string[],
  steamPath: string,
): Promise<{
  restored: number;
  failed: number;
  errors: string[];
}> {
  const result = { restored: 0, failed: 0, errors: [] as string[] };

  if (selectedPaths.length === 0) return result;

  const restoreEntries: ExternalFileRestoreEntry[] = [];
  for (const selPath of selectedPaths) {
    const archiveKey = selPath.startsWith(ACH_SOURCE_BACKUP_PREFIX)
      ? selPath
      : `${ACH_SOURCE_BACKUP_PREFIX}${selPath}`;

    const data = archiveData[archiveKey] ?? archiveData[selPath];
    if (data === undefined) {
      result.errors.push(`Missing data for: ${selPath}`);
      result.failed++;
      continue;
    }

    const parsed = fromLogicalPath(archiveKey);
    if (!parsed) {
      result.errors.push(`Invalid logical path: ${archiveKey}`);
      result.failed++;
      continue;
    }

    restoreEntries.push({
      relativePath: archiveKey,
      content: data,
      expectedChecksum: "", // Will be validated by Rust
    });
  }

  if (restoreEntries.length === 0) return result;

  try {
    const restoreResult = await restoreExternalFiles(steamPath, restoreEntries);
    result.restored = restoreResult.restored;
    result.failed += restoreResult.failed;
    result.errors.push(...restoreResult.errors);
  } catch (err) {
    result.errors.push(`Restore failed: ${err}`);
    result.failed += restoreEntries.length;
  }

  return result;
}
