/**
 * Verified Steam Achievement Sources — Auditor
 *
 * Audits Steam-owned achievement source files on disk via Rust commands.
 * Provides audit (scan), export (read selected games), and preview (single game).
 *
 * Flow: audit → review → export selected → backup archive
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  VerifiedSourcesManifest,
  VerifiedSourceGameEntry,
  ExportedSourceResult,
  SteamProcessCheckResult,
  AchSourceGameSummary,
} from "./types";

// ── Debug ──

const DEBUG_ACH_SOURCE_AUDIT = false;

// ── Cache (session-level, same pattern as other auditors) ──

let _cachedManifest: VerifiedSourcesManifest | null = null;
let _cachedManifestTs = 0;
const MANIFEST_TTL_MS = 5 * 60 * 1000; // 5 min

// ── Public API ──

/**
 * Audit verified Steam achievement source files.
 * Returns a manifest with per-game file metadata.
 */
export async function auditSteamAchievementSources(
  steamPath?: string,
  steamAccountId?: string,
): Promise<VerifiedSourcesManifest> {
  const now = Date.now();
  if (_cachedManifest && now - _cachedManifestTs < MANIFEST_TTL_MS) {
    if (DEBUG_ACH_SOURCE_AUDIT) {
      console.log("[ACH_SOURCE][AUDIT] cache-hit games=", _cachedManifest.totalGames);
    }
    return _cachedManifest;
  }

  const manifest = await invoke<VerifiedSourcesManifest>(
    "audit_steam_achievement_sources",
    {
      steamPath: steamPath || null,
      steamAccountId: steamAccountId || "",
    },
  );

  _cachedManifest = manifest;
  _cachedManifestTs = now;

  if (DEBUG_ACH_SOURCE_AUDIT) {
    console.log(
      "[ACH_SOURCE][AUDIT] games=",
      manifest.totalGames,
      "files=",
      manifest.totalFiles,
      "size=",
      manifest.totalSize,
    );
  }

  return manifest;
}

/**
 * Export selected source files as base64 for backup archive.
 */
export async function exportSteamAchievementSources(
  appIds: string[],
  steamPath?: string,
  steamAccountId?: string,
): Promise<ExportedSourceResult[]> {
  if (appIds.length === 0) return [];

  const results = await invoke<ExportedSourceResult[]>(
    "export_steam_achievement_sources",
    {
      steamPath: steamPath || null,
      steamAccountId: steamAccountId || "",
      appIds,
    },
  );

  if (DEBUG_ACH_SOURCE_AUDIT) {
    console.log("[ACH_SOURCE][EXPORT] games=", results.length);
  }

  return results;
}

/**
 * Read achievement source data for a single game (for preview).
 */
export async function readSteamAchievementSourceForGame(
  appId: string,
  steamPath?: string,
  steamAccountId?: string,
): Promise<ExportedSourceResult | null> {
  const result = await invoke<ExportedSourceResult | null>(
    "read_steam_achievement_source_for_game",
    {
      steamPath: steamPath || null,
      steamAccountId: steamAccountId || "",
      appId,
    },
  );
  return result ?? null;
}

/**
 * Check if Steam process is currently running.
 */
export async function checkSteamRunning(): Promise<SteamProcessCheckResult> {
  return invoke<SteamProcessCheckResult>("check_steam_running");
}

/**
 * Transform manifest into per-game summaries for UI rendering.
 */
export function buildGameSummaries(
  manifest: VerifiedSourcesManifest,
): AchSourceGameSummary[] {
  return manifest.games.map((game: VerifiedSourceGameEntry) => ({
    appId: game.appId,
    files: game.files,
    totalSize: game.totalSize,
    hasStats: game.files.some((f) => f.sourceKind === "userGameStats"),
    hasSchema: game.files.some((f) => f.sourceKind === "userGameStatsSchema"),
    hasLibraryCache: game.files.some(
      (f) => f.sourceKind === "libraryCacheJson",
    ),
  }));
}

/**
 * Clear session cache (for manual refresh).
 */
export function clearAchSourceCache(): void {
  _cachedManifest = null;
  _cachedManifestTs = 0;
}
