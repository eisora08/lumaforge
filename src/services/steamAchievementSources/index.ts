/**
 * Verified Steam Achievement Sources — Barrel
 */

export type {
  SteamSourceKind,
  VerifiedSourceFile,
  VerifiedSourceGameEntry,
  VerifiedSourcesManifest,
  ExportedSourceFile,
  ExportedSourceResult,
  SteamProcessCheckResult,
  RestoreSourceResult,
  AchSourceGameSummary,
  AchSourceAuditStatus,
  AchSourceExportStatus,
} from "./types";

export {
  ACH_SOURCE_BACKUP_PREFIX,
  toLogicalPath,
  fromLogicalPath,
  SOURCE_KIND_LABELS,
  SOURCE_KIND_FILE_NAMES,
} from "./types";

export {
  auditSteamAchievementSources,
  exportSteamAchievementSources,
  readSteamAchievementSourceForGame,
  checkSteamRunning,
  buildGameSummaries,
  clearAchSourceCache,
} from "./auditor";

export {
  collectSteamAchievementSourceBackupData,
  exportSteamAchievementSourcesToArchive,
  restoreSteamAchievementSourcesFromBackup,
} from "./backupService";
