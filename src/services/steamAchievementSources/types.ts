/**
 * Verified Steam Achievement Sources — Types
 *
 * Mirror of the Rust types in steam_achievement_sources.rs.
 * Covers the three verified Steam-owned file types that LumaForge reads
 * for achievement data. Used by audit, export, and restore flows.
 */

// ── Source Kind ──

export type SteamSourceKind =
  | "userGameStats"
  | "userGameStatsSchema"
  | "libraryCacheJson";

// ── Manifest (audit result) ──

export interface VerifiedSourceFile {
  sourceKind: SteamSourceKind;
  logicalPath: string;
  absolutePath: string;
  size: number;
  modifiedAt: number;
  checksum: string;
  requiresSteamClosed: boolean;
}

export interface RejectedSourceFile {
  fileName: string;
  sourceKind: string;
  reason: string;
}

export interface VerifiedSourceGameEntry {
  appId: string;
  files: VerifiedSourceFile[];
  totalSize: number;
}

export interface VerifiedSourcesManifest {
  schemaVersion: number;
  accountScope: string;
  steamRoot: string;
  totalGames: number;
  totalFiles: number;
  totalSize: number;
  games: VerifiedSourceGameEntry[];
  rejected: RejectedSourceFile[];
  statsCount: number;
  schemaCount: number;
  librarycacheCount: number;
}

// ── Export ──

export interface ExportedSourceFile {
  logicalPath: string;
  sourceKind: SteamSourceKind;
  base64Content: string;
  checksum: string;
  size: number;
}

export interface ExportedSourceResult {
  appId: string;
  files: ExportedSourceFile[];
  totalSize: number;
}

// ── Steam Process ──

export interface SteamProcessCheckResult {
  running: boolean;
  message: string;
}

// ── Restore ──

export interface RestoreSourceResult {
  restored: number;
  failed: number;
  errors: string[];
  checksumsValid: boolean;
}

// ── UI Helpers ──

export interface AchSourceGameSummary {
  appId: string;
  files: VerifiedSourceFile[];
  totalSize: number;
  hasStats: boolean;
  hasSchema: boolean;
  hasLibraryCache: boolean;
}

export type AchSourceAuditStatus =
  | "idle"
  | "auditing"
  | "done"
  | "error";

export type AchSourceExportStatus =
  | "idle"
  | "exporting"
  | "done"
  | "error";

// ── Backup Archive Logical Paths ──

export const ACH_SOURCE_BACKUP_PREFIX = "steam/achievement-sources/";

export function toLogicalPath(appId: string, fileName: string): string {
  return `${ACH_SOURCE_BACKUP_PREFIX}${appId}/${fileName}`;
}

export function fromLogicalPath(
  logicalPath: string,
): { appId: string; fileName: string } | null {
  const rel = logicalPath.startsWith(ACH_SOURCE_BACKUP_PREFIX)
    ? logicalPath.slice(ACH_SOURCE_BACKUP_PREFIX.length)
    : logicalPath;
  const parts = rel.split("/");
  if (parts.length !== 2) return null;
  return { appId: parts[0], fileName: parts[1] };
}

export const SOURCE_KIND_LABELS: Record<SteamSourceKind, string> = {
  userGameStats: "User Game Stats",
  userGameStatsSchema: "Stats Schema",
  libraryCacheJson: "Library Cache",
};

export const SOURCE_KIND_FILE_NAMES: Record<SteamSourceKind, string> = {
  userGameStats: "user-game-stats.bin",
  userGameStatsSchema: "user-game-stats-schema.bin",
  libraryCacheJson: "librarycache.json",
};
