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

import { writeBackupArchive, restoreSteamAchievementSources, type ExportedSourceResultTs } from "../tauri";

import { auditSteamAchievementSources, exportSteamAchievementSources } from "./auditor";
import {
  ACH_SOURCE_BACKUP_PREFIX,
  fromLogicalPath,
} from "./types";

import { buildBackupManifest, type BackupSection } from "../localBackupService";

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
        const archivePath = file.logicalPath.startsWith(
          ACH_SOURCE_BACKUP_PREFIX,
        )
          ? file.logicalPath
          : `${ACH_SOURCE_BACKUP_PREFIX}${file.logicalPath}`;

        // Store base64 directly — preserves binary fidelity for .bin files.
        // The Rust export already computed the checksum over raw bytes.
        allFiles.push({
          relativePath: archivePath,
          section: "steamAchievementSources",
          data: file.base64Content,
        });
        fileEntries.push({
          relativePath: archivePath,
          section: "steamAchievementSources",
          size: file.size,
          checksum: file.checksum,
        });
        totalSize += file.size;
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
 * Reverse mapping: archive fileName → sourceKind string (matches Rust enum).
 * Used to reconstruct ExportedSourceResult from archive data.
 */
const FILE_NAME_TO_SOURCE_KIND: Record<string, string> = {
  "user-game-stats.bin": "userGameStats",
  "user-game-stats-schema.bin": "userGameStatsSchema",
  "librarycache.json": "libraryCacheJson",
};

/**
 * Restore achievement source files from a backup archive.
 * Uses the custom restore_steam_achievement_sources Tauri command which:
 *   1. Checks Steam is not running
 *   2. Creates safety backups of existing files
 *   3. Decodes base64 content → raw bytes (binary-safe)
 *   4. Writes to correct Steam paths (appcache/stats/, userdata/)
 *   5. Verifies checksums match original export
 */
export async function restoreSteamAchievementSourcesFromBackup(
  archiveData: Record<string, string>,
  selectedPaths: string[],
  steamPath: string,
  steamAccountId: string,
): Promise<{
  restored: number;
  failed: number;
  errors: string[];
}> {
  const result = { restored: 0, failed: 0, errors: [] as string[] };

  if (selectedPaths.length === 0) return result;

  // Group files by appId to build ExportedSourceResultTs[]
  const byAppId = new Map<string, ExportedSourceResultTs>();

  for (const selPath of selectedPaths) {
    const archiveKey = selPath.startsWith(ACH_SOURCE_BACKUP_PREFIX)
      ? selPath
      : `${ACH_SOURCE_BACKUP_PREFIX}${selPath}`;

    const base64Data = archiveData[archiveKey] ?? archiveData[selPath];
    if (base64Data === undefined) {
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

    const sourceKind = FILE_NAME_TO_SOURCE_KIND[parsed.fileName];
    if (!sourceKind) {
      result.errors.push(`Unknown file type: ${parsed.fileName}`);
      result.failed++;
      continue;
    }

    const logicalPath = archiveKey.startsWith(ACH_SOURCE_BACKUP_PREFIX)
      ? archiveKey
      : `${ACH_SOURCE_BACKUP_PREFIX}${archiveKey}`;

    let entry = byAppId.get(parsed.appId);
    if (!entry) {
      entry = { appId: parsed.appId, files: [], totalSize: 0 };
      byAppId.set(parsed.appId, entry);
    }

    entry.files.push({
      logicalPath,
      sourceKind,
      base64Content: base64Data,
      checksum: "", // Will be verified by Rust after decode
      size: 0,     // Informational; Rust verifies integrity via checksum
    });
  }

  if (byAppId.size === 0) return result;

  const exports = Array.from(byAppId.values());

  try {
    const restoreResult = await restoreSteamAchievementSources(
      steamPath,
      steamAccountId,
      exports,
    );
    result.restored = restoreResult.restored;
    result.failed += restoreResult.failed;
    result.errors.push(...restoreResult.errors);
  } catch (err) {
    result.errors.push(`Restore failed: ${err}`);
    result.failed += exports.reduce((sum, e) => sum + e.files.length, 0);
  }

  return result;
}
