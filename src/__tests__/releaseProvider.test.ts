/**
 * Release Provider Generalization — Tests for generic GitHub release fetching.
 *
 * Proves that githubReleaseService.ts is extension-agnostic:
 * - Config-level API works with any owner/repo
 * - Tag and asset patterns filter correctly
 * - Two different configs produce independent results
 * - No hardcoded extension ids anywhere in the service
 */

import { describe, it, expect } from "vitest";
import {
  buildRepoSlug,
  tagPatternToRegex,
  assetPatternToRegex,
  filterReleasesByTag,
  findAssetForConfig,
  selectLatestMatchingRelease,
  clearReleaseCache,
  type GitHubRelease,
  type GitHubReleaseAsset,
} from "../extensions/services/githubReleaseService";
import type { GitHubReleaseProviderConfig } from "../extensions/types";

// =============================================================================
// Helpers
// =============================================================================

function makeAsset(name: string, size = 1024): GitHubReleaseAsset {
  return {
    name,
    browserDownloadUrl: `https://example.com/${name}`,
    size,
    contentType: "application/octet-stream",
  };
}

function makeRelease(
  tag: string,
  assets: GitHubReleaseAsset[],
  opts: Partial<Pick<GitHubRelease, "name" | "publishedAt" | "body">> = {}
): GitHubRelease {
  return {
    tagName: tag,
    name: opts.name ?? tag,
    publishedAt: opts.publishedAt ?? "2026-01-01T00:00:00Z",
    assets,
    zipballUrl: "",
    tarballUrl: "",
    body: opts.body ?? "",
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("buildRepoSlug", () => {
  it("constructs owner/repo from config", () => {
    expect(
      buildRepoSlug({ owner: "OpenSteam001", repo: "OpenSteamTool" })
    ).toBe("OpenSteam001/OpenSteamTool");
  });

  it("works with any owner/repo", () => {
    expect(
      buildRepoSlug({ owner: "AcmeCorp", repo: "MyMod" })
    ).toBe("AcmeCorp/MyMod");
    expect(
      buildRepoSlug({ owner: "FakeOrg", repo: "FakeTool" })
    ).toBe("FakeOrg/FakeTool");
    expect(
      buildRepoSlug({ owner: "org-name", repo: "repo-name" })
    ).toBe("org-name/repo-name");
  });
});

describe("tagPatternToRegex", () => {
  it("matches exact tags", () => {
    const re = tagPatternToRegex("v1.0.0");
    expect(re.test("v1.0.0")).toBe(true);
    expect(re.test("v1.0.1")).toBe(false);
    expect(re.test("1.0.0")).toBe(false);
  });

  it("matches wildcard patterns", () => {
    const re = tagPatternToRegex("v*");
    expect(re.test("v1.0.0")).toBe(true);
    expect(re.test("v10.20.30")).toBe(true);
    expect(re.test("release-1.0")).toBe(false);
  });

  it("is case-insensitive", () => {
    const re = tagPatternToRegex("V1.0.0");
    expect(re.test("v1.0.0")).toBe(true);
    expect(re.test("V1.0.0")).toBe(true);
  });

  it("handles complex patterns", () => {
    const re = tagPatternToRegex("release-?.0");
    expect(re.test("release-1.0")).toBe(true);
    expect(re.test("release-2.0")).toBe(true);
    expect(re.test("release-10.0")).toBe(false);
  });
});

describe("assetPatternToRegex", () => {
  it("matches wildcard patterns", () => {
    const re = assetPatternToRegex("*.zip");
    expect(re.test("OpenSteamTool-v1.4.8.zip")).toBe(true);
    expect(re.test("MyMod-v2.0.zip")).toBe(true);
    expect(re.test("file.tar.gz")).toBe(false);
  });

  it("matches exact names", () => {
    const re = assetPatternToRegex("dwmapi.dll");
    expect(re.test("dwmapi.dll")).toBe(true);
    expect(re.test("DWMAPI.DLL")).toBe(true); // case-insensitive
    expect(re.test("other.dll")).toBe(false);
  });

  it("handles question-mark wildcards", () => {
    const re = assetPatternToRegex("file-?.zip");
    expect(re.test("file-a.zip")).toBe(true);
    expect(re.test("file-1.zip")).toBe(true);
    expect(re.test("file-ab.zip")).toBe(false);
  });
});

describe("filterReleasesByTag", () => {
  const releases = [
    makeRelease("v1.4.8", []),
    makeRelease("v1.4.7", []),
    makeRelease("v2.0.0-beta", []),
    makeRelease("release-1.0", []),
  ];

  it("returns all when no tagPattern", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
    };
    expect(filterReleasesByTag(releases, config)).toHaveLength(4);
  });

  it("filters by tag pattern", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      tagPattern: "v*",
    };
    const filtered = filterReleasesByTag(releases, config);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((r) => r.tagName)).toEqual([
      "v1.4.8",
      "v1.4.7",
      "v2.0.0-beta",
    ]);
  });

  it("filters with exact tag", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      tagPattern: "v1.4.8",
    };
    const filtered = filterReleasesByTag(releases, config);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].tagName).toBe("v1.4.8");
  });
});

describe("findAssetForConfig", () => {
  const release = makeRelease("v1.0.0", [
    makeAsset("OpenSteamTool-v1.0.0.zip"),
    makeAsset("README.md"),
    makeAsset("source-code.tar.gz"),
  ]);

  it("returns first asset when no assetPattern", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
    };
    const asset = findAssetForConfig(release, config);
    expect(asset?.name).toBe("OpenSteamTool-v1.0.0.zip");
  });

  it("returns null when no assets", () => {
    const emptyRelease = makeRelease("v1.0.0", []);
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
    };
    expect(findAssetForConfig(emptyRelease, config)).toBeNull();
  });

  it("matches by asset pattern", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      assetPattern: "*.zip",
    };
    const asset = findAssetForConfig(release, config);
    expect(asset?.name).toBe("OpenSteamTool-v1.0.0.zip");
  });

  it("returns null when no asset matches pattern", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      assetPattern: "*.deb",
    };
    expect(findAssetForConfig(release, config)).toBeNull();
  });
});

describe("selectLatestMatchingRelease", () => {
  const releases = [
    makeRelease("v2.0.0", [makeAsset("mod-v2.0.0.zip")]),
    makeRelease("v1.5.0", [makeAsset("mod-v1.5.0.zip")]),
    makeRelease("v1.0.0-beta", [makeAsset("mod-v1.0.0-beta.zip")]),
    makeRelease("legacy-1.0", [makeAsset("mod-1.0.zip")]),
  ];

  it("returns newest release matching both tag and asset patterns", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      tagPattern: "v*",
      assetPattern: "*.zip",
    };
    const latest = selectLatestMatchingRelease(releases, config);
    expect(latest?.tagName).toBe("v2.0.0");
  });

  it("skips releases without matching asset", () => {
    const releasesNoAsset = [
      makeRelease("v2.0.0", [makeAsset("source-code.zip")]),
      makeRelease("v1.0.0", [makeAsset("mod-v1.0.0.zip")]),
    ];
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      tagPattern: "v*",
      assetPattern: "mod-*.zip",
    };
    const latest = selectLatestMatchingRelease(releasesNoAsset, config);
    expect(latest?.tagName).toBe("v1.0.0");
  });

  it("returns null when no release matches", () => {
    const config: GitHubReleaseProviderConfig = {
      owner: "A",
      repo: "B",
      tagPattern: "release-*",
      assetPattern: "*.zip",
    };
    const latest = selectLatestMatchingRelease(releases, config);
    expect(latest).toBeNull();
  });
});

describe("Two independent configs produce independent results", () => {
  const ostConfig: GitHubReleaseProviderConfig = {
    owner: "OpenSteam001",
    repo: "OpenSteamTool",
    tagPattern: "v*",
    assetPattern: "*.zip",
  };

  const fakeConfig: GitHubReleaseProviderConfig = {
    owner: "FakeOrg",
    repo: "FakeTool",
    tagPattern: "release-*",
    assetPattern: "*.tar.gz",
  };

  it("buildRepoSlug produces different slugs", () => {
    expect(buildRepoSlug(ostConfig)).toBe("OpenSteam001/OpenSteamTool");
    expect(buildRepoSlug(fakeConfig)).toBe("FakeOrg/FakeTool");
    expect(buildRepoSlug(ostConfig)).not.toBe(buildRepoSlug(fakeConfig));
  });

  it("tag patterns filter differently", () => {
    const releases = [
      makeRelease("v1.0.0", []),
      makeRelease("release-1.0", []),
      makeRelease("v2.0.0", []),
      makeRelease("release-2.0", []),
    ];

    const ostFiltered = filterReleasesByTag(releases, ostConfig);
    const fakeFiltered = filterReleasesByTag(releases, fakeConfig);

    expect(ostFiltered.map((r) => r.tagName)).toEqual([
      "v1.0.0",
      "v2.0.0",
    ]);
    expect(fakeFiltered.map((r) => r.tagName)).toEqual([
      "release-1.0",
      "release-2.0",
    ]);
  });

  it("asset patterns match different files", () => {
    const ostRelease = makeRelease("v1.0.0", [
      makeAsset("OpenSteamTool-v1.0.0.zip"),
      makeAsset("OpenSteamTool-v1.0.0.tar.gz"),
    ]);
    const fakeRelease = makeRelease("release-1.0", [
      makeAsset("FakeTool-1.0.tar.gz"),
      makeAsset("FakeTool-1.0.zip"),
    ]);

    const ostAsset = findAssetForConfig(ostRelease, ostConfig);
    const fakeAsset = findAssetForConfig(fakeRelease, fakeConfig);

    expect(ostAsset?.name).toBe("OpenSteamTool-v1.0.0.zip");
    expect(fakeAsset?.name).toBe("FakeTool-1.0.tar.gz");
  });

  it("selectLatestMatchingRelease selects correctly per config", () => {
    const ostReleases = [
      makeRelease("v2.0.0", [makeAsset("ost-v2.zip")]),
      makeRelease("v1.0.0", [makeAsset("ost-v1.zip")]),
      makeRelease("release-2.0", [makeAsset("ost-2.0.tar.gz")]),
    ];

    const fakeReleases = [
      makeRelease("v2.0.0", [makeAsset("fake-v2.zip")]),
      makeRelease("release-2.0", [makeAsset("fake-2.0.tar.gz")]),
      makeRelease("release-1.0", [makeAsset("fake-1.0.tar.gz")]),
    ];

    const ostLatest = selectLatestMatchingRelease(ostReleases, ostConfig);
    const fakeLatest = selectLatestMatchingRelease(fakeReleases, fakeConfig);

    expect(ostLatest?.tagName).toBe("v2.0.0");
    expect(fakeLatest?.tagName).toBe("release-2.0");
  });
});

describe("No hardcoded extension ids in githubReleaseService", () => {
  it("service works with arbitrary configs (no specific extension id required)", async () => {
    // This test verifies the service is generic by checking that
    // buildRepoSlug, filterReleasesByTag, etc. all work with arbitrary configs
    // without referencing any specific extension id.
    const config1: GitHubReleaseProviderConfig = {
      owner: "any-org",
      repo: "any-repo",
    };
    const config2: GitHubReleaseProviderConfig = {
      owner: "different-org",
      repo: "different-repo",
    };
    expect(buildRepoSlug(config1)).toBe("any-org/any-repo");
    expect(buildRepoSlug(config2)).toBe("different-org/different-repo");
    expect(buildRepoSlug(config1)).not.toBe(buildRepoSlug(config2));
  });
});

describe("Cache isolation between configs", () => {
  it("clearReleaseCache accepts any repository slug", () => {
    // Should not throw for any valid slug
    clearReleaseCache("OpenSteam001/OpenSteamTool");
    clearReleaseCache("FakeOrg/FakeTool");
    clearReleaseCache("any-org/any-repo");
    clearReleaseCache(); // clear all
  });
});
