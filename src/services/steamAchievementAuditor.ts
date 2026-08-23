/**
 * steamAchievementAuditor.ts
 *
 * Audits LumaForge-owned achievement data files for safe inclusion in a backup.
 * Achievement data falls into two categories:
 *
 *   1. LumaForge-owned (safe to back up):
 *      - <appData>/achievements/steam/<appId>/achievements.json — per-game summaries
 *      - <appData>/achievements/steam/<appId>/achievementpercentages.json — global percentages
 *      - <appData>/achievements/steam/<appId>/image_sources.json — CDN URL tracking
 *      - <appData>/achievements/steam/<appId>/summary.json — summary data
 *
 *   2. Steam-owned (read-only, not backed up):
 *      - <steamRoot>/userdata/<accountId>/config/librarycache/<appId>.json — progress
 *      - <steamRoot>/appcache/stats/UserGameStats_*.bin — binary stats
 *
 * This auditor inventories LumaForge-owned files. Steam-owned files are excluded
 * because they are managed by Steam and will be regenerated automatically.
 */

import {
  scanExternalFileCollection,
  readFileCollectionContent,
  verifyFileChecksums,
  type ExternalFileEntry,
} from "./tauri";

// ── Debug flag (false by default) ──

const DEBUG_EXTERNAL_BACKUP_RUNTIME = false;

// ── Allowlist constants ──

/** Extensions permitted for achievement data backup */
export const ACHIEVEMENT_ALLOWED_EXTENSIONS = ["json"];

/** Max individual achievement file size: 2 MB */
export const ACHIEVEMENT_MAX_FILE_SIZE = 2 * 1024 * 1024;

/** Max total achievement files to back up */
export const ACHIEVEMENT_MAX_FILES = 2000;

/** Known LumaForge achievement file names (for classification) */
export const KNOWN_ACHIEVEMENT_FILE_NAMES = new Set([
  "achievements.json",
  "achievementpercentages.json",
  "image_sources.json",
  "summary.json",
]);

/** Files that are safe to back up (LumaForge-owned) */
export const SAFE_ACHIEVEMENT_FILE_NAMES = new Set([
  "achievements.json",
  "achievementpercentages.json",
  "image_sources.json",
  "summary.json",
]);

// ── Types ──

export type AchievementFileCategory =
  | "achievements"
  | "percentages"
  | "image-sources"
  | "summary"
  | "unknown";

export type AchievementAuditEntry = {
  relativePath: string;
  fileName: string;
  appId: string;
  category: AchievementFileCategory;
  size: number;
  checksum: string;
  modifiedAt: number;
  safe: boolean;
  reason?: string;
};

export type AchievementAuditResult = {
  files: ExternalFileEntry[];
  totalFiles: number;
  totalSize: number;
  entries: AchievementAuditEntry[];
  appIds: string[];
  errors: string[];
  warnings: string[];
};

type NormalizedAchievementEntry = {
  relativePath: string;
  fileName: string;
  extension: string;
  size: number;
  modifiedAt: number;
  checksum: string;
  isSymlink: boolean;
};

// ── Normalization ──

/**
 * Normalize a raw ExternalFileEntry into a shape with guaranteed fields.
 * Derives fileName from relativePath when missing.
 * Rejects entries with missing/invalid relativePath or non-numeric size.
 * Never throws — malformed entries get safe fallbacks.
 */
function normalizeAchievementEntry(
  raw: ExternalFileEntry,
): NormalizedAchievementEntry | null {
  const relPath =
    typeof raw.relativePath === "string" ? raw.relativePath.trim() : "";
  if (!relPath) return null;

  // Reject traversal and absolute paths
  if (
    relPath.startsWith("/") ||
    relPath.startsWith("\\") ||
    relPath.includes("..")
  ) {
    return null;
  }

  let fileName =
    typeof raw.fileName === "string" ? raw.fileName.trim() : "";
  if (!fileName) {
    const parts = relPath.replace(/\\/g, "/").split("/");
    fileName = parts[parts.length - 1] || "";
  }
  if (!fileName) return null;

  const lowerName = fileName.toLowerCase();
  const dotIdx = lowerName.lastIndexOf(".");
  const extension = dotIdx > 0 ? lowerName.slice(dotIdx + 1) : "";

  const size =
    typeof raw.size === "number" && !Number.isNaN(raw.size) ? raw.size : 0;

  return {
    relativePath: relPath.replace(/\\/g, "/"),
    fileName,
    extension,
    size,
    modifiedAt:
      typeof raw.modifiedAt === "number" ? raw.modifiedAt : 0,
    checksum: typeof raw.checksum === "string" ? raw.checksum : "",
    isSymlink: false,
  };
}

// ── Category classification ──

function classifyAchievementFile(
  entry: NormalizedAchievementEntry,
): AchievementFileCategory {
  const name = entry.fileName.toLowerCase();

  if (name === "achievements.json") return "achievements";
  if (name === "achievementpercentages.json") return "percentages";
  if (name === "image_sources.json") return "image-sources";
  if (name === "summary.json") return "summary";

  return "unknown";
}

function extractAppIdFromPath(relativePath: string): string {
  // Path format: <appId>/achievements.json
  const parts = relativePath.split("/");
  if (parts.length >= 2) {
    return parts[0];
  }
  return "unknown";
}

function isAchievementFileSafe(
  entry: NormalizedAchievementEntry,
): { safe: boolean; reason?: string } {
  const name = entry.fileName.toLowerCase();

  if (!KNOWN_ACHIEVEMENT_FILE_NAMES.has(name)) {
    return { safe: false, reason: `Unknown achievement file: ${entry.fileName}` };
  }

  if (!SAFE_ACHIEVEMENT_FILE_NAMES.has(name)) {
    return { safe: false, reason: `Unsafe achievement file: ${entry.fileName}` };
  }

  if (entry.size > ACHIEVEMENT_MAX_FILE_SIZE) {
    return {
      safe: false,
      reason: `File exceeds size limit (${entry.size} > ${ACHIEVEMENT_MAX_FILE_SIZE})`,
    };
  }

  return { safe: true };
}

// ── Main audit functions ──

/**
 * Audit LumaForge-owned achievement data files in the given directory.
 *
 * @param achievementsDir - The LumaForge achievements directory
 *                          (e.g., <appData>/achievements/steam)
 */
export async function auditAchievementData(
  achievementsDir: string,
): Promise<AchievementAuditResult> {
  const result: AchievementAuditResult = {
    files: [],
    totalFiles: 0,
    totalSize: 0,
    entries: [],
    appIds: [],
    errors: [],
    warnings: [],
  };

  if (!achievementsDir) {
    result.errors.push("Achievement data path is not configured");
    return result;
  }

  if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
    console.log("[ACH_AUDIT][STAGE] settings-resolved");
  }

  let collection;
  try {
    collection = await scanExternalFileCollection(
      achievementsDir,
      "achievement-data",
      ACHIEVEMENT_ALLOWED_EXTENSIONS,
      ACHIEVEMENT_MAX_FILE_SIZE,
      ACHIEVEMENT_MAX_FILES,
    );
  } catch (e) {
    const msg = String(e ?? "Unknown error");
    if (msg.includes("does not exist") || msg.includes("not a directory")) {
      result.errors.push("Achievement data directory does not exist");
    } else {
      result.errors.push(`Unable to scan achievement data directory: ${msg}`);
    }
    return result;
  }

  if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
    console.log(`[ACH_AUDIT][STAGE] scanned files=${collection.totalFiles}`);
  }

  // Detect valid-empty: directory exists but has no per-appId subdirectories
  if (collection.totalFiles === 0) {
    if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
      console.log("[ACH_AUDIT][STAGE] valid-empty no achievement data files found");
    }
    result.warnings.push("No achievement data files found (valid-empty)");
    return result;
  }

  result.files = collection.files;
  result.totalFiles = collection.totalFiles;

  const appIdsSet = new Set<string>();
  let normalized = 0;
  let malformed = 0;

  for (const file of collection.files) {
    const norm = normalizeAchievementEntry(file);
    if (!norm) {
      malformed++;
      result.entries.push({
        relativePath:
          typeof file.relativePath === "string" ? file.relativePath : "(unknown)",
        fileName:
          typeof file.fileName === "string" ? file.fileName : "(unknown)",
        appId: "(unknown)",
        category: "unknown",
        size: typeof file.size === "number" ? file.size : 0,
        checksum: typeof file.checksum === "string" ? file.checksum : "",
        modifiedAt:
          typeof file.modifiedAt === "number" ? file.modifiedAt : 0,
        safe: false,
        reason: "Malformed entry: missing or invalid relative path",
      });
      continue;
    }

    normalized++;
    const { safe, reason } = isAchievementFileSafe(norm);
    const category = classifyAchievementFile(norm);
    const appId = extractAppIdFromPath(norm.relativePath);

    result.entries.push({
      relativePath: norm.relativePath,
      fileName: norm.fileName,
      appId,
      category,
      size: norm.size,
      checksum: norm.checksum,
      modifiedAt: norm.modifiedAt,
      safe,
      reason,
    });

    if (safe) {
      result.totalSize += norm.size;
      appIdsSet.add(appId);
    }
  }

  if (DEBUG_EXTERNAL_BACKUP_RUNTIME) {
    console.log(
      `[ACH_AUDIT][STAGE] normalized=${normalized} malformed=${malformed} total-entries=${result.entries.length} appIds=${appIdsSet.size}`,
    );
  }

  if (malformed > 0) {
    result.warnings.push(`${malformed} malformed ${malformed === 1 ? "entry" : "entries"} skipped`);
  }

  result.appIds = Array.from(appIdsSet).sort();

  return result;
}

/**
 * Read the content of audited achievement files for embedding in a backup archive.
 * Only reads files marked as safe.
 */
export async function readAchievementFilesContent(
  achievementsDir: string,
  safeRelativePaths: string[],
): Promise<Record<string, string>> {
  if (!achievementsDir || safeRelativePaths.length === 0) return {};
  return readFileCollectionContent(achievementsDir, safeRelativePaths);
}

/**
 * Verify checksums of achievement files on disk against expected values from a backup.
 */
export async function verifyAchievementFileChecksums(
  achievementsDir: string,
  files: [string, string][],
): Promise<{ allValid: boolean; checked: number; errors: string[] }> {
  if (!achievementsDir || files.length === 0) {
    return { allValid: true, checked: 0, errors: [] };
  }
  return verifyFileChecksums(achievementsDir, files);
}