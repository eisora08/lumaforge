/**
 * Release Provider — Abstraction for fetching extension releases.
 *
 * A ReleaseProvider is responsible for:
 * - Fetching the latest release for an extension
 * - Providing download URLs for release assets
 * - Resolving version information
 *
 * No concrete providers are implemented here — only the interface.
 */

/** A single release asset (e.g. a DLL, a ZIP). */
export interface ReleaseAsset {
  /** Filename. */
  name: string;
  /** Download URL. */
  downloadUrl: string;
  /** File size in bytes. */
  size: number;
  /** MIME type. */
  contentType?: string;
}

/** A release version. */
export interface Release {
  /** Version tag (e.g. "v1.0.0"). */
  tagName: string;
  /** Human-readable name. */
  name?: string;
  /** Publication date (ISO 8601). */
  publishedAt: string;
  /** Assets included in this release. */
  assets: ReleaseAsset[];
  /** Release notes (markdown). */
  body?: string;
  /** URL to the full release page. */
  htmlUrl?: string;
}

/** Result of fetching releases. */
export interface ReleaseFetchResult {
  /** Releases found, sorted by version descending. */
  releases: Release[];
  /** Whether the fetch was successful. */
  success: boolean;
  /** Error message if fetch failed. */
  error?: string;
  /** Timestamp of the fetch. */
  fetchedAt: number;
}

/**
 * The ReleaseProvider interface.
 *
 * Each provider is responsible for:
 * - Connecting to a specific release hosting service
 * - Fetching release information
 * - Providing download URLs for assets
 *
 * Providers do NOT download files, extract archives, or manage the filesystem.
 * That responsibility belongs to the Installer service.
 */
export interface ReleaseProvider {
  /** Unique identifier for this provider (e.g. "github", "http"). */
  readonly id: string;
  /** Human-readable name. */
  readonly displayName: string;

  /**
   * Fetch the latest release for a given repository/configuration.
   * @param config Provider-specific configuration (e.g. { owner, repo } for GitHub).
   */
  fetchLatest(config: Record<string, unknown>): Promise<Release | null>;

  /**
   * Fetch all releases for a given repository/configuration.
   * @param config Provider-specific configuration.
   * @param limit Maximum number of releases to return.
   */
  fetchAll(config: Record<string, unknown>, limit?: number): Promise<ReleaseFetchResult>;

  /**
   * Find a specific release by version tag.
   * @param config Provider-specific configuration.
   * @param tag Version tag to find.
   */
  findByTag(config: Record<string, unknown>, tag: string): Promise<Release | null>;

  /**
   * Find a specific asset within a release.
   * @param release The release to search.
   * @param assetName The asset filename to find.
   */
  findAsset(release: Release, assetName: string): ReleaseAsset | null;
}
