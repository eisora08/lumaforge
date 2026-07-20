/**
 * SourceManager DeclarativeExtension Wiring — Tests proving that
 * RepositorySource extensions (which set `extension: false`) automatically
 * get a DeclarativeExtension instance via the SourceManager fallback.
 *
 * This is the fix for the Marketplace blocker: RepositorySource discovers
 * manifests but doesn't create Extension instances. SourceManager now
 * calls tryCreateDeclarativeExtension() as a fallback, so repository-only
 * extensions have working detect/install/etc. in the Registry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerSource, discoverAllSources, resetSourceManager } from "../extensions/sources/manager";
import { RepositorySource } from "../extensions/sources/repository";
import { getExtension, hasExtension, registerExtension, clearRegistry } from "../extensions/registry";
import { getRegisteredExtension, clearExtensionManager } from "../extensions/manager";

// =============================================================================
// Mock: @tauri-apps/api/core (in-memory filesystem)
// =============================================================================

const invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
const fileSystem = new Map<string, "file" | "dir">();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    invokeCalls.push({ cmd, args });

    if (cmd === "extension_file_exists") {
      return fileSystem.has(args.path as string);
    }
    if (cmd === "extension_rename_file") {
      const from = args.from as string;
      const to = args.to as string;
      if (!fileSystem.has(from)) {
        throw new Error(`Source file does not exist: ${from}`);
      }
      const type = fileSystem.get(from)!;
      fileSystem.delete(from);
      fileSystem.set(to, type);
      if (type === "dir") {
        const prefix = from + "\\";
        const newPrefix = to + "\\";
        const childKeys = [...fileSystem.keys()].filter((k) => k.startsWith(prefix));
        for (const childKey of childKeys) {
          const childType = fileSystem.get(childKey)!;
          fileSystem.delete(childKey);
          fileSystem.set(newPrefix + childKey.slice(prefix.length), childType);
        }
      }
      return;
    }
    if (cmd === "extension_remove_file") {
      const p = args.path as string;
      if (!fileSystem.has(p)) return false;
      fileSystem.delete(p);
      return true;
    }
    if (cmd === "extension_create_dir") {
      const p = args.path as string;
      if (fileSystem.has(p)) return false;
      fileSystem.set(p, "dir");
      return true;
    }
    if (cmd === "extension_download_file") {
      return;
    }
    if (cmd === "extension_extract_zip") {
      const extractDir = args.targetDir as string;
      const files = args.expectedFiles as string[];
      for (const f of files) {
        fileSystem.set(`${extractDir}\\${f}`, "file");
      }
      return { extractedFiles: files };
    }
    if (cmd === "extension_batch_rename") {
      const renames = args.renames as Array<[string, string]>;
      const completed: string[] = [];
      for (const [from, to] of renames) {
        if (!fileSystem.has(from)) {
          throw new Error(`Source file does not exist: ${from}`);
        }
        const type = fileSystem.get(from)!;
        fileSystem.delete(from);
        fileSystem.set(to, type);
        completed.push(from);
      }
      return completed;
    }
    return undefined;
  },
}));

// =============================================================================
// Mock: githubReleaseService (return empty to avoid network)
// =============================================================================

vi.mock("../extensions/services/githubReleaseService", () => ({
  fetchReleasesFromConfig: vi.fn(async () => []),
  selectLatestMatchingRelease: vi.fn(() => null),
  findAssetForConfig: vi.fn(() => null),
  buildRepoSlug: vi.fn((config: any) => `${config.owner}/${config.repo}`),
  compareVersions: vi.fn((a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }),
}));

// =============================================================================
// Fixtures
// =============================================================================

const FAKE_REPO_INDEX = {
  schemaVersion: 1,
  id: "community",
  name: "Community Extensions",
  description: "Community-contributed extensions",
  homepage: "https://example.com/community-extensions",
  maintainer: "community",
  version: "1.0.0",
  updatedAt: "2026-07-18T00:00:00Z",
  extensions: [
    {
      id: "fake-declarative-ext" as const,
      displayName: "Fake Declarative Extension",
      description: "A test-only extension with managedFiles but no hand-written runtime",
      version: "1.0.0",
      author: "tester",
      categories: ["test"],
      tags: ["test"],
      manifestUrl: "fake-declarative-ext/manifest.json",
      verified: false,
    },
  ],
};

const FAKE_MANIFEST = {
  schemaVersion: 1,
  id: "fake-declarative-ext",
  name: "fake-declarative-ext",
  displayName: "Fake Declarative Extension",
  description: "A test-only extension with managedFiles but no hand-written runtime",
  version: "1.0.0",
  author: "tester",
  license: "MIT",
  categories: ["test"],
  tags: ["test"],
  permissions: [{ id: "filesystem.steam-root", reason: "Install test files" }],
  managedFiles: [
    {
      path: "test-managed.dll",
      isExecutable: true,
      replaceStrategy: "always" as const,
      backupStrategy: "rename" as const,
      validationStrategy: "file-size" as const,
    },
  ],
  installStrategy: { type: "copy" as const },
  updateStrategy: { type: "github-release" as const },
  toggleStrategy: { type: "rename-extension" as const },
  releaseProvider: {
    provider: "github" as const,
    config: {
      owner: "test-owner",
      repo: "test-repo",
      tagPattern: "v*",
      assetPattern: "*.zip",
    },
  },
};

// Empty-manifest extension (no managedFiles → should NOT get DeclarativeExtension)
const FAKE_EMPTY_INDEX = {
  ...FAKE_REPO_INDEX,
  extensions: [
    {
      id: "fake-no-managed" as const,
      displayName: "Fake No Managed Files",
      description: "Extension without managedFiles",
      version: "0.0.1",
      author: "tester",
      categories: ["test"],
      tags: ["test"],
      manifestUrl: "fake-no-managed/manifest.json",
      verified: false,
    },
  ],
};

const FAKE_EMPTY_MANIFEST = {
  schemaVersion: 1,
  id: "fake-no-managed",
  name: "fake-no-managed",
  displayName: "Fake No Managed Files",
  description: "Extension without managedFiles",
  version: "0.0.1",
  author: "tester",
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

describe("SourceManager — DeclarativeExtension wiring for RepositorySource", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    fileSystem.clear();
    invokeCalls.length = 0;
    clearRegistry();
    clearExtensionManager();
    resetSourceManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates DeclarativeExtension for repository-only extension with managedFiles", async () => {
    // This is the critical test: RepositorySource returns a SourceExtension
    // with NO extension runtime (just a manifest). SourceManager should
    // create a DeclarativeExtension automatically.
    mockFetch((url) => {
      if (url.endsWith("index.json")) return jsonResponse(FAKE_REPO_INDEX);
      if (url.endsWith("manifest.json")) return jsonResponse(FAKE_MANIFEST);
      return errorResponse(404);
    });

    const source = new RepositorySource({
      id: "community",
      displayName: "Community Extensions",
      priority: 20,
      config: { url: "https://example.com/community/index.json" },
    });

    registerSource(source);
    await discoverAllSources();

    // The extension should be registered in ExtensionManager
    const registered = getRegisteredExtension("fake-declarative-ext");
    expect(registered).toBeDefined();
    expect(registered!.manifest.id).toBe("fake-declarative-ext");

    // Critical: the Extension runtime should be in the Registry
    expect(hasExtension("fake-declarative-ext")).toBe(true);
    const extension = getExtension("fake-declarative-ext");
    expect(extension).toBeDefined();
    expect(extension!.manifest.id).toBe("fake-declarative-ext");
  });

  it("Extension instance has working detect/install methods", async () => {
    mockFetch((url) => {
      if (url.endsWith("index.json")) return jsonResponse(FAKE_REPO_INDEX);
      if (url.endsWith("manifest.json")) return jsonResponse(FAKE_MANIFEST);
      return errorResponse(404);
    });

    const source = new RepositorySource({
      id: "community",
      displayName: "Community Extensions",
      priority: 20,
      config: { url: "https://example.com/community/index.json" },
    });

    registerSource(source);
    await discoverAllSources();

    const extension = getExtension("fake-declarative-ext");
    expect(extension).toBeDefined();

    // detect() should work — no files on disk → status "available"
    const detection = await extension!.detect("C:\\fake\\steam");
    expect(detection.status).toBe("available");
    expect(detection.missingFiles.length).toBeGreaterThan(0);

    // getInstalledVersion() should work — no files → null
    const version = await extension!.getInstalledVersion("C:\\fake\\steam");
    expect(version).toBeNull();
  });

  it("extension is NOT created for manifests without managedFiles", async () => {
    mockFetch((url) => {
      if (url.endsWith("index.json")) return jsonResponse(FAKE_EMPTY_INDEX);
      if (url.endsWith("manifest.json")) return jsonResponse(FAKE_EMPTY_MANIFEST);
      return errorResponse(404);
    });

    const source = new RepositorySource({
      id: "community",
      displayName: "Community Extensions",
      priority: 20,
      config: { url: "https://example.com/community/index.json" },
    });

    registerSource(source);
    await discoverAllSources();

    // Manifest should be registered (in ExtensionManager)
    expect(getRegisteredExtension("fake-no-managed")).toBeDefined();

    // But NO Extension runtime should be in the Registry (no managedFiles)
    expect(hasExtension("fake-no-managed")).toBe(false);
  });

  it("does not overwrite an existing Extension runtime from a higher-priority source", async () => {
    // Scenario: BuiltInSource already provided an Extension for "opensteamtool".
    // RepositorySource also has "opensteamtool" with a manifest.
    // SourceManager should NOT overwrite the existing runtime.
    mockFetch((url) => {
      if (url.endsWith("index.json")) {
        return jsonResponse({
          ...FAKE_REPO_INDEX,
          extensions: [{ ...FAKE_REPO_INDEX.extensions[0], id: "opensteamtool", manifestUrl: "manifest.json" }],
        });
      }
      if (url.endsWith("manifest.json")) return jsonResponse(FAKE_MANIFEST);
      return errorResponse(404);
    });

    // Pre-register a fake runtime (simulating BuiltInSource having one)
    const fakeRuntime = {
      manifest: { ...FAKE_MANIFEST, id: "opensteamtool" },
      detect: async () => ({ status: "enabled" as const, exists: true, details: [] }),
      install: async () => ({ success: true }),
      enable: async () => ({ success: true }),
      disable: async () => ({ success: true }),
      update: async () => ({ success: true }),
      uninstall: async () => ({ success: true }),
      getInstalledVersion: async () => "1.0.0",
      getLatestVersion: async () => "2.0.0",
      getBehavior: () => ({ requiresRestart: false, managedFiles: [] }),
    };
    registerExtension(fakeRuntime as any);

    const source = new RepositorySource({
      id: "community",
      displayName: "Community Extensions",
      priority: 20,
      config: { url: "https://example.com/community/index.json" },
    });

    registerSource(source);
    await discoverAllSources();

    // The existing runtime should still be the fake one, not overwritten
    const ext = getExtension("opensteamtool");
    expect(ext).toBeDefined();
    const installedVersion = await ext!.getInstalledVersion("");
    expect(installedVersion).toBe("1.0.0"); // from fakeRuntime, not DeclarativeExtension
  });

  it("install() succeeds end-to-end for a repository-sourced DeclarativeExtension", async () => {
    mockFetch((url) => {
      if (url.endsWith("index.json")) return jsonResponse(FAKE_REPO_INDEX);
      if (url.endsWith("manifest.json")) return jsonResponse(FAKE_MANIFEST);
      return errorResponse(404);
    });

    const source = new RepositorySource({
      id: "community",
      displayName: "Community Extensions",
      priority: 20,
      config: { url: "https://example.com/community/index.json" },
    });

    registerSource(source);
    await discoverAllSources();

    const extension = getExtension("fake-declarative-ext");
    expect(extension).toBeDefined();

    // Override the githubReleaseService mocks to return a fake release
    const githubMock = await import("../extensions/services/githubReleaseService");
    vi.mocked(githubMock.fetchReleasesFromConfig).mockResolvedValueOnce([
      {
        tagName: "v1.0.0",
        name: "v1.0.0",
        publishedAt: "2026-07-18T00:00:00Z",
        assets: [
          {
            name: "test-repo-1.0.0.zip",
            browserDownloadUrl: "https://example.com/test-repo-1.0.0.zip",
            size: 1024,
          },
        ],
      },
    ] as any);
    vi.mocked(githubMock.selectLatestMatchingRelease).mockReturnValueOnce({
      tagName: "v1.0.0",
      name: "v1.0.0",
      publishedAt: "2026-07-18T00:00:00Z",
      assets: [],
    } as any);
    vi.mocked(githubMock.findAssetForConfig).mockReturnValueOnce({
      name: "test-repo-1.0.0.zip",
      browserDownloadUrl: "https://example.com/test-repo-1.0.0.zip",
      size: 1024,
    } as any);

    // Set up fake host directory
    fileSystem.set("C:\\fake\\steam", "dir");

    // Call install
    const result = await extension!.install({ hostPath: "C:\\fake\\steam" });

    expect(result.success).toBe(true);

    // Verify the file system was populated — extract → rename should have placed the file
    const hasManagedFile = [...fileSystem.keys()].some((k) => k.endsWith("test-managed.dll"));
    expect(hasManagedFile).toBe(true);
  });

  it("SourceManager result reports the extension as registered", async () => {
    mockFetch((url) => {
      if (url.endsWith("index.json")) return jsonResponse(FAKE_REPO_INDEX);
      if (url.endsWith("manifest.json")) return jsonResponse(FAKE_MANIFEST);
      return errorResponse(404);
    });

    const source = new RepositorySource({
      id: "community",
      displayName: "Community Extensions",
      priority: 20,
      config: { url: "https://example.com/community/index.json" },
    });

    registerSource(source);
    const result = await discoverAllSources();

    expect(result.registered).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });
});
