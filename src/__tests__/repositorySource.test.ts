/**
 * Repository Source — Tests for remote index.json discovery.
 *
 * Proves that RepositorySource correctly:
 * - Fetches and parses a remote index.json
 * - Resolves manifest URLs relative to the repository base
 * - Validates manifests via loadManifestFromObject
 * - Caches index.json and manifest.json responses
 * - Handles network failures gracefully (stale cache fallback)
 * - Handles invalid manifests by skipping with error log
 * - Respects priority merge with BuiltInSource
 *
 * All fetch calls are mocked — no live network in tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RepositorySource } from "../extensions/sources/repository";
import { BuiltInSource } from "../extensions/sources/builtin";
import { registerSource, discoverAllSources, resetSourceManager } from "../extensions/sources/manager";
import { clearExtensionManager } from "../extensions/manager";

// =============================================================================
// Fixtures
// =============================================================================

const OFFICIAL_INDEX = {
  schemaVersion: 1,
  id: "official",
  name: "Official Extensions",
  description: "Curated extensions for LumaForge",
  homepage: "https://github.com/eisora08/lumaforge-extensions",
  maintainer: "eisora08",
  version: "1.0.0",
  updatedAt: "2026-07-18T00:00:00Z",
  extensions: [
    {
      id: "opensteamtool" as const,
      displayName: "OpenSteamTool",
      description: "DLL injection for Steam client",
      version: "1.4.8",
      author: "OpenSteam001",
      categories: ["steam"],
      tags: ["steam", "dll", "opensteam"],
      icon: "icon.png",
      manifestUrl: "manifest.json",
      verified: true,
    },
  ],
};

const OPENSTEAMTOOL_MANIFEST = {
  schemaVersion: 1,
  id: "opensteamtool",
  name: "opensteamtool",
  displayName: "OpenSteamTool",
  description: "DLL injection for Steam client",
  version: "1.4.8",
  author: "OpenSteam001",
  license: "MIT",
  categories: ["steam"],
  tags: ["steam", "dll", "opensteam"],
  permissions: [
    { id: "filesystem.steam-root", reason: "Install DLLs to Steam root" },
  ],
  managedFiles: [
    {
      path: "dwmapi.dll",
      isExecutable: true,
      replaceStrategy: "if-different",
      backupStrategy: "rename",
      validationStrategy: "file-size",
    },
    {
      path: "xinput1_4.dll",
      isExecutable: true,
      replaceStrategy: "if-different",
      backupStrategy: "rename",
      validationStrategy: "file-size",
    },
    {
      path: "OpenSteamTool.dll",
      isExecutable: true,
      replaceStrategy: "if-different",
      backupStrategy: "rename",
      validationStrategy: "file-size",
    },
  ],
  installStrategy: { type: "copy" },
  updateStrategy: { type: "github-release" },
  toggleStrategy: { type: "rename-extension" },
  releaseProvider: {
    provider: "github",
    config: {
      owner: "OpenSteam001",
      repo: "OpenSteamTool",
      tagPattern: "v*",
      assetPattern: "*.zip",
    },
  },
};

const INVALID_MANIFEST = {
  // Missing required fields (no schemaVersion, no id, no version)
  name: "broken-extension",
};

const MULTIPLE_EXTENSIONS_INDEX = {
  ...OFFICIAL_INDEX,
  extensions: [
    ...OFFICIAL_INDEX.extensions,
    {
      id: "placeholder" as const,
      displayName: "Placeholder Extension",
      description: "A placeholder for testing",
      version: "0.0.1",
      author: "test",
      manifestUrl: "placeholder/manifest.json",
      verified: false,
    },
  ],
};

const PLACEHOLDER_MANIFEST = {
  schemaVersion: 1,
  id: "placeholder",
  name: "placeholder",
  displayName: "Placeholder Extension",
  description: "A placeholder for testing",
  version: "0.0.1",
  managedFiles: [],
};

// =============================================================================
// Mock helpers
// =============================================================================

function mockFetch(handler: (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fn = vi.fn(handler);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  };
}

function errorResponse(status: number, statusText = "Error") {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("RepositorySource", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearExtensionManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("discover() — happy path", () => {
    it("fetches index.json and resolves a single extension manifest", async () => {
      const fetchFn = mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      expect(result.success).toBe(true);
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0].manifest.id).toBe("opensteamtool");
      expect(result.extensions[0].sourceId).toBe("official");
      expect(result.extensions[0].metadata).toMatchObject({
        repositoryId: "official",
        repositoryName: "Official Extensions",
        verified: true,
      });

      // index.json + 1 manifest = 2 fetch calls
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("resolves manifest URL relative to repository base", async () => {
      const fetchFn = mockFetch((url) => {
        if (url === "https://cdn.example.com/myrepo/index.json") return jsonResponse(OFFICIAL_INDEX);
        if (url === "https://cdn.example.com/myrepo/manifest.json") return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "test",
        displayName: "Test",
        priority: 10,
        config: { url: "https://cdn.example.com/myrepo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      expect(result.success).toBe(true);
      expect(result.extensions[0].manifest.id).toBe("opensteamtool");

      // Verify base URL derived correctly (no trailing slash issues)
      const manifestCall = fetchFn.mock.calls.find((c) => c[0].includes("manifest.json"));
      expect(manifestCall?.[0]).toBe("https://cdn.example.com/myrepo/manifest.json");
    });

    it("resolves multiple extensions from index", async () => {
      mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(MULTIPLE_EXTENSIONS_INDEX);
        if (url.includes("placeholder/manifest.json")) return jsonResponse(PLACEHOLDER_MANIFEST);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      expect(result.success).toBe(true);
      expect(result.extensions).toHaveLength(2);
      expect(result.extensions.map((e) => e.manifest.id).sort()).toEqual(["opensteamtool", "placeholder"]);
    });
  });

  describe("discover() — error handling", () => {
    it("returns error when index.json fetch fails", async () => {
      mockFetch(() => errorResponse(500, "Internal Server Error"));

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      expect(result.success).toBe(false);
      expect(result.extensions).toHaveLength(0);
      expect(result.error).toContain("Failed to fetch index");
    });

    it("skips invalid manifests with error, continues others", async () => {
      mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(MULTIPLE_EXTENSIONS_INDEX);
        if (url.includes("placeholder/manifest.json")) return jsonResponse(PLACEHOLDER_MANIFEST);
        // opensteamtool manifest is intentionally broken
        if (url.endsWith("manifest.json")) return jsonResponse(INVALID_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      // Only placeholder succeeded
      expect(result.extensions).toHaveLength(1);
      expect(result.extensions[0].manifest.id).toBe("placeholder");
      expect(result.errors!.length).toBeGreaterThanOrEqual(1);
      expect(result.errors!.some((e) => e.error.includes("Validation failed"))).toBe(true);
    });

    it("handles invalid index.json gracefully", async () => {
      mockFetch(() => jsonResponse({ notAnIndex: true }));

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      expect(result.success).toBe(false);
      expect(result.extensions).toHaveLength(0);
      expect(result.error).toContain("Invalid index");
    });

    it("returns error when manifest fetch returns 404", async () => {
      mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return errorResponse(404);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const result = await source.discover();

      expect(result.extensions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].error).toContain("404");
    });
  });

  describe("discover() — caching", () => {
    it("caches index.json for subsequent calls", async () => {
      const fetchFn = mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json", cacheTtlMs: 60_000 },
      });

      await source.initialize();

      // First call — fetches index + manifest
      await source.discover();
      const callCountAfterFirst = fetchFn.mock.calls.length;

      // Second call — should use cache for index.json
      await source.discover();

      // Only the manifest should be fetched again (index is cached)
      expect(fetchFn.mock.calls.length).toBeLessThan(callCountAfterFirst * 2);
    });

    it("respects cache TTL", async () => {
      const fetchFn = mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json", cacheTtlMs: 1 }, // 1ms TTL
      });

      await source.initialize();

      await source.discover();
      const countAfterFirst = fetchFn.mock.calls.length;

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 10));

      await source.discover();

      // All calls should have been made again (cache expired)
      expect(fetchFn.mock.calls.length).toBeGreaterThan(countAfterFirst);
    });

    it("returns stale cache on network failure", async () => {
      let callCount = 0;
      mockFetch((url) => {
        if (url.endsWith("index.json")) {
          callCount++;
          if (callCount > 1) return errorResponse(503, "Service Unavailable");
          return jsonResponse(OFFICIAL_INDEX);
        }
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json", cacheTtlMs: 1 },
      });

      await source.initialize();

      // First call — succeeds
      const result1 = await source.discover();
      expect(result1.success).toBe(true);

      // Wait for cache to expire
      await new Promise((r) => setTimeout(r, 10));

      // Second call — network fails, should use stale cache
      const result2 = await source.discover();
      expect(result2.extensions).toHaveLength(1);
      expect(result2.extensions[0].manifest.id).toBe("opensteamtool");
    });
  });

  describe("findById() and isAvailable()", () => {
    it("finds an extension by ID", async () => {
      mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      const found = await source.findById("opensteamtool");
      expect(found).not.toBeNull();
      expect(found!.manifest.id).toBe("opensteamtool");

      const notFound = await source.findById("nonexistent");
      expect(notFound).toBeNull();
    });

    it("isAvailable returns true/false correctly", async () => {
      mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      expect(await source.isAvailable("opensteamtool")).toBe(true);
      expect(await source.isAvailable("nonexistent")).toBe(false);
    });
  });

  describe("destroy()", () => {
    it("clears caches on destroy", async () => {
      const fetchFn = mockFetch((url) => {
        if (url.endsWith("index.json")) return jsonResponse(OFFICIAL_INDEX);
        if (url.endsWith("manifest.json")) return jsonResponse(OPENSTEAMTOOL_MANIFEST);
        return errorResponse(404);
      });

      const source = new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      });

      await source.initialize();
      await source.discover();
      const countAfterFirst = fetchFn.mock.calls.length;

      // Destroy clears cache
      await source.destroy();

      // Next call should re-fetch everything
      await source.discover();
      expect(fetchFn.mock.calls.length).toBeGreaterThan(countAfterFirst);
    });
  });

  describe("Properties", () => {
    it("exposes configured properties", () => {
      const source = new RepositorySource({
        id: "community",
        displayName: "Community Extensions",
        priority: 20,
        enabled: false,
        config: { url: "https://example.com/index.json" },
      });

      expect(source.id).toBe("community");
      expect(source.displayName).toBe("Community Extensions");
      expect(source.priority).toBe(20);
      expect(source.enabled).toBe(false);
    });

    it("defaults priority to 100 and enabled to true", () => {
      const source = new RepositorySource({
        id: "test",
        displayName: "Test",
        config: { url: "https://example.com/index.json" },
      });

      expect(source.priority).toBe(100);
      expect(source.enabled).toBe(true);
    });
  });
});

describe("SourceManager with RepositorySource + BuiltInSource priority merge", () => {
  beforeEach(() => {
    resetSourceManager();
    clearExtensionManager();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSourceManager();
  });

  it("built-in source (priority 0) wins over repository source (priority 10) for same extension id", async () => {
    // Use "placeholder" as the overlapping ID — builtin still discovers it
    const PLACEHOLDER_INDEX = {
      ...OFFICIAL_INDEX,
      extensions: [{
        id: "placeholder" as const,
        displayName: "Placeholder Extension",
        description: "A placeholder for testing overlap",
        version: "0.0.1",
        author: "test",
        categories: ["test"],
        tags: ["test"],
        manifestUrl: "placeholder/manifest.json",
        verified: false,
      }],
    };

    mockFetch((url) => {
      if (url.endsWith("index.json")) return jsonResponse(PLACEHOLDER_INDEX);
      if (url.endsWith("placeholder/manifest.json")) return jsonResponse({ ...OPENSTEAMTOOL_MANIFEST, id: "placeholder", name: "placeholder" });
      return errorResponse(404);
    });

    // Register built-in source first (higher priority)
    registerSource(new BuiltInSource());

    // Register repository source (lower priority)
    registerSource(
      new RepositorySource({
        id: "official",
        displayName: "Official Extensions",
        priority: 10,
        config: { url: "https://example.com/repo/index.json" },
      })
    );

    const result = await discoverAllSources();

    // Built-in source discovers placeholder (from public/extensions/builtin/)
    // Repository source also discovers placeholder
    // Built-in wins because priority 0 < priority 10
    expect(result.registered).toBeGreaterThanOrEqual(1);

    // The registered placeholder should come from builtin source
    const { getRegisteredExtension } = await import("../extensions/manager");
    const pl = getRegisteredExtension("placeholder");
    expect(pl).toBeDefined();
    expect(pl!.sourceId).toBe("builtin");
  });
});
