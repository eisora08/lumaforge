/**
 * Hydra JSON source types for the Debrid/Hydra repack ecosystem.
 *
 * Hydra sources are JSON files that list repack game entries with real
 * download URIs (magnet, HTTP, Torrent). Each source has a name and URL.
 *
 * Users add Hydra sources in Settings → Debrid Providers.
 * The service fetches, parses, and merges entries from all configured sources.
 */

/**
 * The Hydra source file format as fetched from the remote URL.
 * Each source file contains a list of game entries with download links.
 */
export interface HydraSourceFile {
  /** Name of this source (e.g. "Hydra Community Repacks"). */
  name: string;
  /** Array of game entries. */
  games: HydraSourceGameEntry[];
  /** Optional metadata about the source. */
  metadata?: {
    /** When this source file was generated. */
    generatedAt?: string;
    /** Version identifier. */
    version?: string;
    /** Total game count. */
    totalGames?: number;
    /** Source description. */
    description?: string;
  };
}

/**
 * A single game entry from a Hydra JSON source.
 * Contains download URIs (magnet, HTTP) and repack metadata.
 */
export interface HydraSourceGameEntry {
  /** Game title (e.g. "Cuphead v1.0 + Bonus"). */
  title: string;
  /** Steam App ID, if known. */
  appId?: number;
  /** Download URIs — magnet links, HTTP URLs, or torrent URLs. */
  uris: string[];
  /** Repacker/group name (e.g. "FitGirl", "DODI", "ElAmigos"). */
  repacker: string;
  /** Download file size in bytes. */
  fileSize?: number;
  /** Installed size on disk in bytes. */
  installSize?: number;
  /** Installer type: "zip", "sfx", "inno", "torrent". */
  installerType?: string;
  /** Source/crawler provenance. */
  source?: string;
  /** Last update timestamp. */
  updatedAt?: string;
  /** Language tags. */
  languages?: string[];
  /** Selective download features. */
  selectiveFeatures?: string[];
  /** Content tags. */
  tags?: string[];
  /** File checksum (MD5, SHA-1, etc.). */
  checksum?: string;
  /** Third-party DRM info. */
  drm?: string;
  /** Repack group variant info. */
  repackGroup?: string;
}

/**
 * A Hydra source configured by the user.
 * Persisted in localStorage by hydraSourceService.
 */
export interface HydraSourceConfig {
  /** Unique ID for this source. */
  id: string;
  /** Display name. */
  name: string;
  /** Remote URL to fetch the Hydra JSON. */
  url: string;
  /** When this source was last successfully fetched. */
  lastFetchedAt?: string;
  /** Number of games fetched from this source. */
  gameCount?: number;
  /** Whether this source is enabled. */
  enabled: boolean;
  /** Error message if last fetch failed. */
  lastError?: string;
}

/**
 * Normalized game entry after merging multiple Hydra sources.
 * This is the canonical form stored in the repack catalog.
 */
export interface HydraNormalizedEntry {
  /** Unique ID (title + repacker hash). */
  id: string;
  /** Game title. */
  title: string;
  /** Steam App ID. */
  appId: number;
  /** Download URIs. */
  uris: string[];
  /** Repacker name. */
  repacker: string;
  /** File size in bytes. */
  fileSize?: number;
  /** Installed size in bytes. */
  installSize?: number;
  /** Installer type. */
  installerType: string;
  /** Source provenance. */
  source: string;
  /** Last update timestamp. */
  updatedAt: string;
  /** Language tags. */
  languages: string[];
  /** Selective features. */
  selectiveFeatures: string[];
  /** Content tags. */
  tags: string[];
  /** Checksum. */
  checksum?: string;
  /** DRM info. */
  drm?: string;
  /** Repack group variant. */
  repackGroup?: string;
}

/**
 * Result of importing a Hydra source into the repack catalog.
 */
export interface HydraImportResult {
  /** Source name. */
  sourceName: string;
  /** Source URL. */
  sourceUrl: string;
  /** Number of new entries imported. */
  importedCount: number;
  /** Number of entries updated (existing match). */
  updatedCount: number;
  /** Total entries in source. */
  totalCount: number;
  /** Error message if import failed. */
  error?: string;
}

/** Summary of a pasted repack feed (catalog rows with an empty sourceUrl). */
export interface ImportedFeedSummary {
  /** Feed name (the repacker/root name, e.g. "SteamRip"). */
  name: string;
  /** Number of games in the catalog for this feed. */
  gameCount: number;
  /** Most recent `updated_at` among the feed's rows, if any. */
  lastUpdated?: string;
}

/**
 * Normalize a Hydra source game entry to the canonical format.
 * Deduplicates URIs, fills defaults, generates a stable ID.
 */
export function normalizeHydraEntry(
  entry: HydraSourceGameEntry,
  sourceName: string,
  _sourceUrl: string,
): HydraNormalizedEntry {
  const id = buildHydraEntryId(entry.title, entry.repacker);
  const uris = [...new Set(entry.uris.filter(Boolean))];
  const installerType = entry.installerType || (uris.some((u) => u.startsWith("magnet:")) ? "torrent" : "zip");
  const now = new Date().toISOString();

  return {
    id,
    title: entry.title,
    appId: entry.appId || 0,
    uris,
    repacker: entry.repacker || "Unknown",
    fileSize: entry.fileSize,
    installSize: entry.installSize,
    installerType,
    source: sourceName,
    updatedAt: entry.updatedAt || now,
    languages: entry.languages || [],
    selectiveFeatures: entry.selectiveFeatures || [],
    tags: entry.tags || [],
    checksum: entry.checksum,
    drm: entry.drm,
    repackGroup: entry.repackGroup,
  };
}

/**
 * Build a stable entry ID from title and repacker.
 */
export function buildHydraEntryId(title: string, repacker: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const repackerSlug = repacker
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${normalized}-${repackerSlug}`;
}

/**
 * Validate that a Hydra source file has the expected structure.
 */
export function isValidHydraSourceFile(data: unknown): data is HydraSourceFile {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string") return false;
  if (!Array.isArray(obj.games)) return false;
  return obj.games.every(
    (g: unknown) =>
      typeof g === "object" &&
      g !== null &&
      typeof (g as Record<string, unknown>).title === "string" &&
      Array.isArray((g as Record<string, unknown>).uris),
  );
}
