/**
 * OpenSteamTool GitHub — Release fetching from GitHub API.
 *
 * All functions accept a `GitHubReleaseProviderConfig` parameter.
 * The config is read from the extension manifest at runtime.
 * No owner/repo is hardcoded here.
 */

import {
  fetchReleasesFromConfig,
  selectLatestMatchingRelease,
  findAssetForConfig,
  compareVersions,
  type GitHubRelease,
} from "../../services/githubReleaseService";
import type { GitHubReleaseProviderConfig } from "../../types";

const MANAGED_DLL_NAMES = ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"];

export async function fetchLatestRelease(
  config: GitHubReleaseProviderConfig
): Promise<GitHubRelease | null> {
  const releases = await fetchReleasesFromConfig(config);
  return selectLatestMatchingRelease(releases, config);
}

export async function getLatestVersionTag(
  config: GitHubReleaseProviderConfig
): Promise<string | null> {
  const release = await fetchLatestRelease(config);
  return release?.tagName ?? null;
}

export async function isUpdateAvailable(
  installedVersion: string | null,
  latestVersion: string | null
): Promise<boolean> {
  if (!installedVersion || !latestVersion) return false;
  return compareVersions(latestVersion, installedVersion) > 0;
}

export function findManagedAssets(
  release: GitHubRelease,
  config?: GitHubReleaseProviderConfig
): Array<{ fileName: string; downloadUrl: string; size: number }> {
  const results: Array<{ fileName: string; downloadUrl: string; size: number }> = [];

  for (const dll of MANAGED_DLL_NAMES) {
    let asset = null;
    if (config) {
      // Use config-based asset search (config.assetPattern matches first, fallback to by-name)
      asset = findAssetForConfig(release, config);
      // If asset doesn't match this specific DLL name, search by name directly
      if (asset && asset.name !== dll) {
        asset = release.assets.find((a) => a.name === dll) ?? null;
      }
    } else {
      // Fallback: find by exact name
      asset = release.assets.find((a) => a.name === dll) ?? null;
    }
    if (asset) {
      results.push({
        fileName: dll,
        downloadUrl: asset.browserDownloadUrl,
        size: asset.size,
      });
    }
  }

  return results;
}
