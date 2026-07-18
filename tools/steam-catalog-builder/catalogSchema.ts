/**
 * Lightweight Steam catalog record schema.
 *
 * This is the wire format for the versioned catalog artifact.
 * It contains ONLY discovery-level fields — no heavy metadata.
 *
 * Used by:
 * - Offline builder (generation)
 * - Rust import (SQLite ingestion)
 * - TS query service (runtime reads)
 */

import type { CanonicalGenre } from "./taxonomy";

// ── Catalog Record ──

export type SteamCatalogRecord = {
  /** Steam application ID */
  appId: number;

  /** Game display name */
  name: string;

  /** Steam app type */
  type: "game" | "demo" | "dlc" | "application" | "unknown";

  /** Canonical Steam genres (normalized) */
  genres: CanonicalGenre[];

  /** Original raw Steam genre strings (for diagnostics) */
  originalGenres: string[];

  /** Steam Store category names */
  categories: string[];

  /** Raw Steam Store category IDs */
  categoryIds: number[];

  /** Unix timestamp of release (seconds). 0 = unknown. */
  releaseTimestamp: number;

  /** Whether the game is listed as coming soon */
  comingSoon: boolean;

  /** Whether the game is free */
  isFree: boolean;

  /** Positive review percentage (0–100) */
  reviewPercent: number;

  /** Total review count */
  reviewCount: number;

  /** Steam Store header image URL */
  headerImage: string;

  /** Steam Store capsule image URL */
  capsuleImage: string;

  /** Developer names */
  developers: string[];

  /** Publisher names */
  publishers: string[];

  /** Unix timestamp when this record was last enriched (seconds) */
  lastEnrichedAt: number;
};

// ── Catalog Artifact ──

export type SteamCatalogArtifact = {
  /** Schema version — bump when the record shape changes */
  schemaVersion: number;

  /** Catalog version — bump when the content changes */
  catalogVersion: number;

  /** ISO timestamp of generation */
  generatedAt: string;

  /** All records */
  records: SteamCatalogRecord[];
};

// ── Catalog Manifest ──

export type SteamCatalogManifest = {
  schemaVersion: number;
  catalogVersion: number;
  generatedAt: string;
  recordCount: number;
  sourceRecordCount: number;
  gameCount: number;
  genreCoverageCount: number;
  imageCoverageCount: number;
  releaseDateCoverageCount: number;
  reviewCoverageCount: number;
  genres: string[];
  checksum: string;
  artifactFile: string;
  compressedFile?: string;
};

// ── Builder Checkpoint ──

export type BuilderCheckpoint = {
  schemaVersion: number;
  catalogVersion: number;
  sourceAppCount: number;
  processedAppIds: number[];
  pendingAppIds: number[];
  successfulRecords: SteamCatalogRecord[];
  validEmptyCount: number;
  retryableFailures: number[];
  unsupportedRecords: number[];
  requestCount: number;
  retryCount: number;
  lastCheckpointTime: string;
};

// ── Version Constants ──

export const CATALOG_SCHEMA_VERSION = 1;
export const CATALOG_VERSION = 1;

// ── Status Types ──

export type CatalogImportStatus =
  | "empty"
  | "importing"
  | "ready"
  | "stale"
  | "failed"
  | "not-imported";

export type CatalogSource =
  | "local-catalog"
  | "complete-cache"
  | "curated-fallback"
  | "skeleton";
