/**
 * Criteria Evaluator — Purely declarative game-to-extension matching.
 *
 * Reads `criteria.detection` from extension manifests and evaluates
 * against game context data. No hardcoded IDs, no branching on
 * extension identity — only manifest declarations drive matching.
 *
 * Each criteria type is isolated in its own handler function.
 * New types can be added without touching existing code.
 *
 * Dependencies: extensionTauri (filesystem check), types (CriteriaDeclaration).
 */

import type { ExtensionManifestV1, DetectionCriteria, FilesPresenceCriteria } from "../types";
import { extensionFileExists } from "../services/extensionTauri";

// =============================================================================
// Types
// =============================================================================

/**
 * Game context data available for criteria evaluation.
 * All fields are optional — the evaluator gracefully returns false
 * when required fields are missing.
 */
export interface GameContext {
  /** Game's install directory (absolute path on disk). */
  installDir?: string;
  /** Steam appId (numeric string, e.g. "268910" for Cuphead). */
  appId?: string;
  /** Provider identifier ("steam", "epic", "manual", etc.). */
  provider?: string;
}

/**
 * Result of evaluating criteria for a single extension.
 */
export interface CriteriaEvaluationResult {
  /** Whether the criteria matched (true = extension applies to this game). */
  matched: boolean;
  /** If false, why the match failed (for diagnostics). */
  reason?: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Evaluate a manifest's criteria against game context.
 *
 * Returns `{ matched: true }` when all criteria pass, or
 * `{ matched: false, reason }` with the first failing reason.
 *
 * Extensions without criteria always match (criteria is optional).
 */
export async function evaluateManifestCriteria(
  manifest: ExtensionManifestV1,
  game: GameContext,
): Promise<CriteriaEvaluationResult> {
  const criteria = manifest.criteria;
  if (!criteria) {
    return { matched: true };
  }

  const detection = criteria.detection;
  if (!detection) {
    return { matched: true };
  }

  return evaluateDetectionCriteria(detection, game);
}

/**
 * Evaluate a single DetectionCriteria block against game context.
 * Dispatches to the appropriate handler by `detection.type`.
 */
async function evaluateDetectionCriteria(
  detection: DetectionCriteria,
  game: GameContext,
): Promise<CriteriaEvaluationResult> {
  switch (detection.type) {
    case "files_presence":
      return evaluateFilesPresence(detection, game);
    default:
      // Unknown criteria type — treat as non-match with diagnostic
      return {
        matched: false,
        reason: `Unknown detection type "${(detection as { type: string }).type}"`,
      };
  }
}

// =============================================================================
// Handler: files_presence
// =============================================================================

/**
 * Evaluate "files_presence" criteria: all listed files must exist
 * in the game's install directory on disk.
 */
async function evaluateFilesPresence(
  criteria: FilesPresenceCriteria,
  game: GameContext,
): Promise<CriteriaEvaluationResult> {
  const installDir = game.installDir;
  if (!installDir) {
    return {
      matched: false,
      reason: "Game has no install directory",
    };
  }

  for (const relativePath of criteria.paths) {
    const fullPath = `${installDir}\\${relativePath}`;
    try {
      const exists = await extensionFileExists(fullPath);
      if (!exists) {
        return {
          matched: false,
          reason: `Missing required file: ${relativePath}`,
        };
      }
    } catch {
      return {
        matched: false,
        reason: `Failed to check file: ${relativePath}`,
      };
    }
  }

  return { matched: true };
}

// =============================================================================
// Batch API
// =============================================================================

/**
 * Filter a list of manifests by criteria, returning only those that match.
 * Async — performs filesystem checks for files_presence criteria.
 */
export async function filterMatchingManifests(
  manifests: ExtensionManifestV1[],
  game: GameContext,
): Promise<ExtensionManifestV1[]> {
  const results: ExtensionManifestV1[] = [];
  for (const manifest of manifests) {
    const result = await evaluateManifestCriteria(manifest, game);
    if (result.matched) {
      results.push(manifest);
    }
  }
  return results;
}
