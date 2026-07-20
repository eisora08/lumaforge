/**
 * DeclarativeExtension — Tests proving that detect/install/enable/disable/update/uninstall
 * work from manifest data alone, with no hand-written per-extension code.
 *
 * Uses a fake "test-declarative-tool" manifest with two managed DLLs,
 * mocked network (githubReleaseService), and simulated filesystem (@tauri-apps/api/core).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
      return files;
    }
    if (cmd === "extension_get_dll_version") {
      // No PE version — falls back to manifest.version
      return null;
    }
    return null;
  },
}));

// =============================================================================
// Mock: githubReleaseService
// =============================================================================

vi.mock("../extensions/services/githubReleaseService", () => ({
  fetchReleasesFromConfig: vi.fn(async () => [
    {
      tagName: "v2.0.0",
      name: "Release 2.0.0",
      publishedAt: "2025-06-01T00:00:00Z",
      assets: [
        {
          name: "test-declarative-tool-v2.0.0.zip",
          browserDownloadUrl: "https://example.com/releases/v2.0.0/test-declarative-tool-v2.0.0.zip",
          size: 1024,
          contentType: "application/zip",
        },
      ],
      zipballUrl: "",
      tarballUrl: "",
      body: "",
    },
    {
      tagName: "v1.0.0",
      name: "Release 1.0.0",
      publishedAt: "2025-01-01T00:00:00Z",
      assets: [
        {
          name: "test-declarative-tool-v1.0.0.zip",
          browserDownloadUrl: "https://example.com/releases/v1.0.0/test-declarative-tool-v1.0.0.zip",
          size: 1024,
          contentType: "application/zip",
        },
      ],
      zipballUrl: "",
      tarballUrl: "",
      body: "",
    },
  ]),
  selectLatestMatchingRelease: vi.fn((releases: Array<{ tagName: string }>) => releases[0] ?? null),
  findAssetForConfig: vi.fn((release: { assets: Array<{ browserDownloadUrl: string }> }) => ({
    name: "release.zip",
    browserDownloadUrl: release.assets[0]?.browserDownloadUrl ?? "",
    size: 1024,
    contentType: "application/zip",
  })),
  compareVersions: vi.fn((a: string, b: string) => {
    const pa = a.replace(/^v/, "").split(".").map(Number);
    const pb = b.replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }),
  buildRepoSlug: vi.fn((_config: { owner: string; repo: string }) => "test-owner/test-tool"),
  assetPatternToRegex: vi.fn(() => /./),
}));

// =============================================================================
// Import after mocks are set up
// =============================================================================

import { DeclarativeExtension } from "../extensions/declarative/DeclarativeExtension";
import type { ExtensionManifestV1 } from "../extensions/types";

// =============================================================================
// Test manifest: test-declarative-tool
// =============================================================================

const TEST_MANIFEST: ExtensionManifestV1 = {
  schemaVersion: 1,
  id: "test-declarative-tool",
  name: "test-declarative-tool",
  displayName: "Test Declarative Tool",
  description: "A test extension managed entirely by manifest declarations.",
  version: "1.0.0",
  managedFiles: [
    {
      path: "test-a.dll",
      required: true,
      isExecutable: true,
      backupStrategy: "rename",
      replaceStrategy: "always",
      validationStrategy: "exists",
    },
    {
      path: "test-b.dll",
      required: true,
      isExecutable: true,
      backupStrategy: "rename",
      replaceStrategy: "always",
      validationStrategy: "exists",
    },
  ],
  installStrategy: { type: "transaction-extract" },
  toggleStrategy: { type: "rename" },
  updateStrategy: { type: "replace", autoCheck: true },
  releaseProvider: {
    provider: "github",
    config: {
      owner: "test-owner",
      repo: "test-tool",
      assetPattern: "*.zip",
    },
  },
};

// =============================================================================
// Helpers
// =============================================================================

const HOST_PATH = "C:\\Steam";

function setFile(path: string, type: "file" | "dir" = "file") {
  fileSystem.set(path, type);
}

function hasFile(path: string) {
  return fileSystem.has(path);
}

function clearAll() {
  fileSystem.clear();
  invokeCalls.length = 0;
}

beforeEach(() => {
  clearAll();
});

// =============================================================================
// Tests
// =============================================================================

describe("DeclarativeExtension", () => {
  describe("detect", () => {
    it("returns 'available' when no managed files exist", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.detect(HOST_PATH);

      expect(result.status).toBe("available");
      expect(result.installedFiles).toEqual([]);
      expect(result.missingFiles).toEqual(["test-a.dll", "test-b.dll"]);
      expect(result.backupFiles).toEqual([]);
    });

    it("returns 'enabled' when all managed files exist as active", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.detect(HOST_PATH);

      expect(result.status).toBe("enabled");
      expect(result.installedFiles).toEqual(["test-a.dll", "test-b.dll"]);
      expect(result.missingFiles).toEqual([]);
      expect(result.backupFiles).toEqual([]);
    });

    it("returns 'disabled' when all managed files exist as .bak only", async () => {
      setFile(`${HOST_PATH}\\test-a.dll.bak`);
      setFile(`${HOST_PATH}\\test-b.dll.bak`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.detect(HOST_PATH);

      expect(result.status).toBe("disabled");
      expect(result.installedFiles).toEqual([]);
      expect(result.missingFiles).toEqual(["test-a.dll", "test-b.dll"]);
      expect(result.backupFiles).toEqual(["test-a.dll", "test-b.dll"]);
    });

    it("returns 'installed' when only some managed files exist", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.detect(HOST_PATH);

      expect(result.status).toBe("installed");
      expect(result.installedFiles).toEqual(["test-a.dll"]);
      expect(result.missingFiles).toEqual(["test-b.dll"]);
    });
  });

  describe("install", () => {
    it("downloads, extracts, and copies managed files", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.install({ hostPath: HOST_PATH, tempPath: `${HOST_PATH}\\temp` });

      expect(result.success).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(true);

      // Verify download + extract were called
      const downloadCalls = invokeCalls.filter((c) => c.cmd === "extension_download_file");
      const extractCalls = invokeCalls.filter((c) => c.cmd === "extension_extract_zip");
      expect(downloadCalls.length).toBe(1);
      expect(extractCalls.length).toBe(1);
    });

    it("skips install when all files already present (unless force)", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.install({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
      // No downloads should have occurred
      const downloadCalls = invokeCalls.filter((c) => c.cmd === "extension_download_file");
      expect(downloadCalls.length).toBe(0);
    });

    it("force=true reinstalls even when files present", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.install({ hostPath: HOST_PATH, tempPath: `${HOST_PATH}\\temp`, force: true });

      expect(result.success).toBe(true);
      // Downloads should have occurred
      const downloadCalls = invokeCalls.filter((c) => c.cmd === "extension_download_file");
      expect(downloadCalls.length).toBe(1);
    });

    it("returns error when no release provider configured", async () => {
      const manifest: ExtensionManifestV1 = {
        ...TEST_MANIFEST,
        releaseProvider: undefined,
      };
      const ext = new DeclarativeExtension(manifest);
      const result = await ext.install({ hostPath: HOST_PATH });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No release provider");
    });
  });

  describe("enable", () => {
    it("renames .bak files back to active", async () => {
      setFile(`${HOST_PATH}\\test-a.dll.bak`);
      setFile(`${HOST_PATH}\\test-b.dll.bak`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.enable({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll.bak`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-b.dll.bak`)).toBe(false);
    });

    it("succeeds with no-op when no .bak files exist", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.enable({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
    });
  });

  describe("disable", () => {
    it("renames active files to .bak", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.disable({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll.bak`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-b.dll.bak`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(false);
    });

    it("succeeds with no-op when no active files exist", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.disable({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
    });
  });

  describe("update", () => {
    it("replaces active files with new version", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.update({ hostPath: HOST_PATH, tempPath: `${HOST_PATH}\\temp` });

      expect(result.success).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(true);
    });

    it("replaces .bak files when extension is disabled", async () => {
      setFile(`${HOST_PATH}\\test-a.dll.bak`);
      setFile(`${HOST_PATH}\\test-b.dll.bak`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.update({ hostPath: HOST_PATH, tempPath: `${HOST_PATH}\\temp` });

      expect(result.success).toBe(true);
      // Should still be .bak after update (disabled state preserved)
      expect(hasFile(`${HOST_PATH}\\test-a.dll.bak`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-b.dll.bak`)).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(false);
    });

    it("returns error when extension is not installed", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.update({ hostPath: HOST_PATH });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not installed");
    });
  });

  describe("uninstall", () => {
    it("removes all managed files", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.uninstall({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(false);
    });

    it("removes both active and .bak files", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-a.dll.bak`);
      setFile(`${HOST_PATH}\\test-b.dll`);
      setFile(`${HOST_PATH}\\test-b.dll.bak`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.uninstall({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
      expect(hasFile(`${HOST_PATH}\\test-a.dll`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-a.dll.bak`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-b.dll`)).toBe(false);
      expect(hasFile(`${HOST_PATH}\\test-b.dll.bak`)).toBe(false);
    });

    it("succeeds with no-op when nothing is installed", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const result = await ext.uninstall({ hostPath: HOST_PATH });

      expect(result.success).toBe(true);
    });
  });

  describe("getInstalledVersion", () => {
    it("returns null when nothing is installed", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const version = await ext.getInstalledVersion(HOST_PATH);

      expect(version).toBeNull();
    });

    it("returns manifest version when files are present but PE header unavailable", async () => {
      setFile(`${HOST_PATH}\\test-a.dll`);
      setFile(`${HOST_PATH}\\test-b.dll`);

      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const version = await ext.getInstalledVersion(HOST_PATH);

      expect(version).toBe("1.0.0"); // falls back to manifest.version
    });
  });

  describe("getLatestVersion", () => {
    it("returns the latest release tag from GitHub", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      const version = await ext.getLatestVersion();

      expect(version).toBe("v2.0.0");
    });

    it("returns null when no release provider configured", async () => {
      const manifest: ExtensionManifestV1 = {
        ...TEST_MANIFEST,
        releaseProvider: undefined,
      };
      const ext = new DeclarativeExtension(manifest);
      const version = await ext.getLatestVersion();

      expect(version).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("returns status string", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      expect(await ext.getStatus(HOST_PATH)).toBe("available");

      setFile(`${HOST_PATH}\\test-a.dll`);
      expect(await ext.getStatus(HOST_PATH)).toBe("installed");

      setFile(`${HOST_PATH}\\test-b.dll`);
      expect(await ext.getStatus(HOST_PATH)).toBe("enabled");
    });
  });

  describe("full lifecycle", () => {
    it("install → disable → enable → update → uninstall", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);

      // Start: available
      expect(await ext.getStatus(HOST_PATH)).toBe("available");

      // Install
      const installResult = await ext.install({ hostPath: HOST_PATH, tempPath: `${HOST_PATH}\\temp` });
      expect(installResult.success).toBe(true);
      expect(await ext.getStatus(HOST_PATH)).toBe("enabled");

      // Disable
      const disableResult = await ext.disable({ hostPath: HOST_PATH });
      expect(disableResult.success).toBe(true);
      expect(await ext.getStatus(HOST_PATH)).toBe("disabled");

      // Enable
      const enableResult = await ext.enable({ hostPath: HOST_PATH });
      expect(enableResult.success).toBe(true);
      expect(await ext.getStatus(HOST_PATH)).toBe("enabled");

      // Update (files are active)
      const updateResult = await ext.update({ hostPath: HOST_PATH, tempPath: `${HOST_PATH}\\temp` });
      expect(updateResult.success).toBe(true);
      expect(await ext.getStatus(HOST_PATH)).toBe("enabled");

      // Uninstall
      const uninstallResult = await ext.uninstall({ hostPath: HOST_PATH });
      expect(uninstallResult.success).toBe(true);
      expect(await ext.getStatus(HOST_PATH)).toBe("available");
    });
  });

  describe("getBehavior", () => {
    it("returns manifest behavior when set", async () => {
      const manifest: ExtensionManifestV1 = {
        ...TEST_MANIFEST,
        behavior: { injectsDll: true },
      };
      const ext = new DeclarativeExtension(manifest);
      expect(ext.getBehavior()).toEqual({ injectsDll: true });
    });

    it("returns empty behavior when no behavior in manifest", async () => {
      const ext = new DeclarativeExtension(TEST_MANIFEST);
      expect(ext.getBehavior()).toEqual({});
    });
  });
});
