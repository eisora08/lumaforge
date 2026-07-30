// ── Repack Catalog Schema ──
// Mirrors the steam-catalog-builder notion of record + artifact + manifest.

export interface RepackCatalogRecord {
  /** Unique stable identifier: "fitgirl-1234" or "dodi-5678" */
  id: string;
  /** Game title as the repacker names it (may differ from Steam title) */
  title: string;
  /** Steam AppId if known (0 or omitted if unknown) */
  appId: number;
  /** Repacker identifier (fitgirl, dodi, elamigos, chovka, etc.) */
  repacker: string;
  /** Name of the specific repack group/series if applicable */
  repackGroup?: string;
  /** Type of installer */
  installerType: "sfx" | "inno" | "nsis" | "portable" | "preinstalled" | "unknown";
  /** Compressed size in bytes (from repack page) */
  fileSize: number;
  /** Original/uncompressed install size in bytes (from repack page) */
  installSize?: number;
  /** Language list */
  languages: string[];
  /** Selective download features (e.g. ["english_only", "no_videos", "no_multilanguage"]) */
  selectiveFeatures: string[];
  /** Download URIs — Hydra magnet links, HTTP mirrors, or Torrent files */
  downloadUris: string[];
  /** Repack page URL */
  sourceUrl: string;
  /** Source identifier (hydra-api, manual-curation) */
  source: string;
  /** SHA-256 of the repack archive (if known) */
  checksum?: string;
  /** Timestamp of when this record was added/updated */
  updatedAt: string;
  /** Optional tags (e.g. ["repack", "fitgirl", "steam-rip", "multi"]) */
  tags: string[];
}

export interface RepackCatalogArtifact {
  schemaVersion: number;
  generatedAt: string;
  records: RepackCatalogRecord[];
}

export interface RepackCatalogManifest {
  schemaVersion: number;
  generatedAt: string;
  recordCount: number;
  checksum: string;
}

export const REPACK_SCHEMA_VERSION = 1;
