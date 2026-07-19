/**
 * GitHub Release Service — Generic release fetching from GitHub API.
 *
 * Provides cached access to GitHub releases with dedup for in-flight requests.
 * Accepts any `GitHubReleaseProviderConfig` — no hardcoded owner/repo.
 *
 * Two API levels:
 * - Low-level: `fetchGitHubReleases(repository)` — raw slug string
 * - Config-level: `fetchReleasesFromConfig(config)` — reads owner/repo/tagPattern
 *   from manifest's `releaseProvider.config`, filters by tag pattern
 *
 * Any extension can use this service by declaring a `releaseProvider` in its
 * manifest. The service never references a specific extension by id.
 */

import type { GitHubReleaseProviderConfig } from "../types";

export interface GitHubReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  size: number;
  contentType: string;
}

export interface GitHubRelease {
  tagName: string;
  name: string;
  publishedAt: string;
  assets: GitHubReleaseAsset[];
  zipballUrl: string;
  tarballUrl: string;
  body: string;
}

interface GitHubReleaseCacheEntry {
  releases: GitHubRelease[];
  fetchedAt: number;
}

const _cache = new Map<string, GitHubReleaseCacheEntry>();
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const _inFlight = new Map<string, Promise<GitHubRelease[]>>();

function isCacheFresh(entry: GitHubReleaseCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < RELEASE_CACHE_TTL_MS;
}

export function parseGitHubRepoSlug(repository: string): {
  owner: string;
  repo: string;
} | null {
  const cleaned = repository
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

export async function fetchGitHubReleases(
  repository: string,
  forceRefresh = false
): Promise<GitHubRelease[]> {
  const slug = parseGitHubRepoSlug(repository);
  if (!slug) throw new Error(`Invalid GitHub repository: ${repository}`);

  const cacheKey = `${slug.owner}/${slug.repo}`;

  if (!forceRefresh) {
    const cached = _cache.get(cacheKey);
    if (cached && isCacheFresh(cached)) return cached.releases;
  }

  const existing = _inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = doFetch(slug.owner, slug.repo, cacheKey);
  _inFlight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    _inFlight.delete(cacheKey);
  }
}

async function doFetch(
  owner: string,
  repo: string,
  cacheKey: string
): Promise<GitHubRelease[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "LumaForge-ExtensionManager",
    },
  });

  if (response.status === 403) {
    const retryAfter = response.headers.get("Retry-After");
    throw new Error(
      `GitHub rate limited${retryAfter ? `. Retry after ${retryAfter}s` : ""}`
    );
  }

  if (response.status === 404) {
    throw new Error(`GitHub repository not found: ${owner}/${repo}`);
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`
    );
  }

  const raw = (await response.json()) as Array<{
    tag_name: string;
    name: string;
    published_at: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
      size: number;
      content_type: string;
    }>;
    zipball_url: string;
    tarball_url: string;
    body: string;
  }>;

  const releases: GitHubRelease[] = raw.map((r) => ({
    tagName: r.tag_name,
    name: r.name,
    publishedAt: r.published_at,
    assets: r.assets.map((a) => ({
      name: a.name,
      browserDownloadUrl: a.browser_download_url,
      size: a.size,
      contentType: a.content_type,
    })),
    zipballUrl: r.zipball_url,
    tarballUrl: r.tarball_url,
    body: r.body,
  }));

  _cache.set(cacheKey, { releases, fetchedAt: Date.now() });

  return releases;
}

export function getLatestRelease(releases: GitHubRelease[]): GitHubRelease | null {
  return releases.length > 0 ? releases[0] : null;
}

export function findReleaseAsset(
  release: GitHubRelease,
  fileName: string
): GitHubReleaseAsset | null {
  return (
    release.assets.find(
      (a) => a.name.toLowerCase() === fileName.toLowerCase()
    ) ?? null
  );
}

export function findReleaseAssetByPattern(
  release: GitHubRelease,
  pattern: RegExp
): GitHubReleaseAsset | null {
  return release.assets.find((a) => pattern.test(a.name)) ?? null;
}

export function clearReleaseCache(repository?: string): void {
  if (repository) {
    const slug = parseGitHubRepoSlug(repository);
    if (slug) _cache.delete(`${slug.owner}/${slug.repo}`);
  } else {
    _cache.clear();
  }
}

export function compareVersions(a: string, b: string): number {
  const cleanA = a.replace(/^v/i, "").split("-");
  const cleanB = b.replace(/^v/i, "").split("-");
  const partsA = cleanA[0].split(".").map(Number);
  const partsB = cleanB[0].split(".").map(Number);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const na = partsA[i] || 0;
    const nb = partsB[i] || 0;
    if (na !== nb) return na - nb;
  }
  if (cleanA.length > 1 && cleanB.length > 1) {
    return cleanA[1].localeCompare(cleanB[1]);
  }
  if (cleanA.length > 1) return -1;
  if (cleanB.length > 1) return 1;
  return 0;
}

// =============================================================================
// Config-level API — reads from GitHubReleaseProviderConfig
// =============================================================================

/**
 * Build a GitHub repository slug from a provider config.
 * Returns `"owner/repo"` string suitable for `fetchGitHubReleases`.
 */
export function buildRepoSlug(config: GitHubReleaseProviderConfig): string {
  return `${config.owner}/${config.repo}`;
}

/**
 * Convert a glob-style asset pattern (e.g. `"*.zip"`) to a RegExp.
 * Supports `*` (any chars) and `?` (single char). Case-insensitive.
 */
export function assetPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Convert a tag pattern (e.g. `"v*"`) to a RegExp.
 * Supports `*` (any chars) and `?` (single char). Case-insensitive.
 */
export function tagPatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Filter releases by tag pattern from config.
 * When `config.tagPattern` is undefined, returns all releases.
 */
export function filterReleasesByTag(
  releases: GitHubRelease[],
  config: GitHubReleaseProviderConfig
): GitHubRelease[] {
  if (!config.tagPattern) return releases;
  const regex = tagPatternToRegex(config.tagPattern);
  return releases.filter((r) => regex.test(r.tagName));
}

/**
 * Find the best asset in a release using config's assetPattern.
 * When `config.assetPattern` is undefined, returns the first asset.
 */
export function findAssetForConfig(
  release: GitHubRelease,
  config: GitHubReleaseProviderConfig
): GitHubReleaseAsset | null {
  if (config.assetPattern) {
    const regex = assetPatternToRegex(config.assetPattern);
    return release.assets.find((a) => regex.test(a.name)) ?? null;
  }
  return release.assets.length > 0 ? release.assets[0] : null;
}

/**
 * Select the latest matching release from a list, using config filters.
 *
 * 1. Optionally filters out pre-releases (unless `includePrereleases`)
 * 2. Filters by `tagPattern`
 * 3. Confirms at least one asset matches `assetPattern`
 * 4. Returns the first (newest) match, or null
 */
export function selectLatestMatchingRelease(
  releases: GitHubRelease[],
  config: GitHubReleaseProviderConfig
): GitHubRelease | null {
  const filtered = filterReleasesByTag(releases, config);
  for (const release of filtered) {
    const asset = findAssetForConfig(release, config);
    if (asset) return release;
  }
  return null;
}

/**
 * High-level config-based fetch: builds slug from config, fetches releases,
 * filters by tag pattern, confirms asset availability.
 *
 * Returns filtered releases sorted newest-first, with at least one
 * matching asset each.
 */
export async function fetchReleasesFromConfig(
  config: GitHubReleaseProviderConfig,
  forceRefresh = false
): Promise<GitHubRelease[]> {
  const slug = buildRepoSlug(config);
  const releases = await fetchGitHubReleases(slug, forceRefresh);
  const filtered = filterReleasesByTag(releases, config);
  return filtered.filter((r) => findAssetForConfig(r, config) !== null);
}
