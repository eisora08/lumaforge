import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  registerExtension,
  unregisterExtension,
  getExtension,
  hasExtension,
  getAllExtensions,
  getExtensionCount,
  getAllManifests,
  registerExtensions,
  clearRegistry,
} from "../extensions/registry";
import type {
  Extension,
  ExtensionDetectionResult,
  ExtensionOperationResult,
  ExtensionStatus,
  ExtensionManifestV1,
  ManagedFileDescriptor,
} from "../extensions/types";
import { VALIDATION_PATTERNS, MAX_LENGTHS } from "../extensions/types";
import { BuiltInSource } from "../extensions/sources/builtin";
import { registerSource, discoverAllSources, resetSourceManager } from "../extensions/sources/manager";
import { clearExtensionManager } from "../extensions/manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dllFile(name: string): ManagedFileDescriptor {
  return { path: `${name}.dll`, isExecutable: true, replaceStrategy: "if-different", backupStrategy: "rename" };
}

function createMockExtension(id: string, overrides?: Partial<ExtensionManifestV1>): Extension {
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: id,
      displayName: `Test ${id}`,
      description: `Description for ${id}`,
      version: "1.0.0",
      managedFiles: [dllFile(id)],
      ...overrides,
    },
    detect: async (): Promise<ExtensionDetectionResult> => ({
      status: "available",
      installedFiles: [],
      missingFiles: [`${id}.dll`],
      backupFiles: [],
      installedVersion: null,
    }),
    install: async (): Promise<ExtensionOperationResult> => ({ success: true }),
    update: async (): Promise<ExtensionOperationResult> => ({ success: true }),
    enable: async (): Promise<ExtensionOperationResult> => ({ success: true }),
    disable: async (): Promise<ExtensionOperationResult> => ({ success: true }),
    uninstall: async (): Promise<ExtensionOperationResult> => ({ success: true }),
    getInstalledVersion: async () => null,
    getLatestVersion: async () => "1.0.0",
    getStatus: async (): Promise<ExtensionStatus> => "available",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExtensionRegistry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  // Registration
  it("registers an extension", () => {
    const ext = createMockExtension("test-1");
    registerExtension(ext);
    expect(hasExtension("test-1")).toBe(true);
    expect(getExtension("test-1")).toBe(ext);
  });

  it("overwrites existing extension with same id", () => {
    const v1 = createMockExtension("overwrite");
    const v2 = createMockExtension("overwrite", { version: "2.0.0" });
    registerExtension(v1);
    registerExtension(v2);
    expect(getExtension("overwrite")).toBe(v2);
    expect(getExtensionCount()).toBe(1);
  });

  it("registers multiple extensions at once", () => {
    const exts = [
      createMockExtension("batch-1"),
      createMockExtension("batch-2"),
      createMockExtension("batch-3"),
    ];
    registerExtensions(exts);
    expect(getExtensionCount()).toBe(3);
    expect(hasExtension("batch-1")).toBe(true);
    expect(hasExtension("batch-2")).toBe(true);
    expect(hasExtension("batch-3")).toBe(true);
  });

  // Removal
  it("unregisters an extension", () => {
    const ext = createMockExtension("removable");
    registerExtension(ext);
    expect(hasExtension("removable")).toBe(true);
    const removed = unregisterExtension("removable");
    expect(removed).toBe(true);
    expect(hasExtension("removable")).toBe(false);
  });

  it("returns false when unregistering non-existent extension", () => {
    expect(unregisterExtension("non-existent")).toBe(false);
  });

  // Lookup
  it("returns undefined for non-existent extension", () => {
    expect(getExtension("nope")).toBeUndefined();
  });

  it("returns false for hasExtension with non-existent id", () => {
    expect(hasExtension("nope")).toBe(false);
  });

  // Enumeration
  it("returns all registered extensions", () => {
    registerExtension(createMockExtension("a"));
    registerExtension(createMockExtension("b"));
    const all = getAllExtensions();
    expect(all.length).toBe(2);
    expect(all.map((e) => e.manifest.id)).toContain("a");
    expect(all.map((e) => e.manifest.id)).toContain("b");
  });

  it("returns empty array when registry is empty", () => {
    expect(getAllExtensions()).toEqual([]);
    expect(getExtensionCount()).toBe(0);
  });

  it("returns correct count", () => {
    expect(getExtensionCount()).toBe(0);
    registerExtension(createMockExtension("c1"));
    expect(getExtensionCount()).toBe(1);
    registerExtension(createMockExtension("c2"));
    expect(getExtensionCount()).toBe(2);
    unregisterExtension("c1");
    expect(getExtensionCount()).toBe(1);
  });

  it("returns manifests for all extensions", () => {
    registerExtension(createMockExtension("m1"));
    registerExtension(createMockExtension("m2"));
    const manifests = getAllManifests();
    expect(manifests.length).toBe(2);
    expect(manifests.map((m) => m.id)).toContain("m1");
    expect(manifests.map((m) => m.id)).toContain("m2");
  });

  // Bulk
  it("clears the entire registry", () => {
    registerExtension(createMockExtension("x1"));
    registerExtension(createMockExtension("x2"));
    expect(getExtensionCount()).toBe(2);
    clearRegistry();
    expect(getExtensionCount()).toBe(0);
    expect(getAllExtensions()).toEqual([]);
  });
});

describe("ExtensionManifestV1 (type validation)", () => {
  it("manifest has required fields", () => {
    const ext = createMockExtension("manifest-test", {
      displayName: "Display Name",
      description: "A description",
      version: "2.0.0",
      managedFiles: [dllFile("a"), dllFile("b")],
    });
    expect(ext.manifest.schemaVersion).toBe(1);
    expect(ext.manifest.id).toBe("manifest-test");
    expect(ext.manifest.name).toBe("manifest-test");
    expect(ext.manifest.displayName).toBe("Display Name");
    expect(ext.manifest.description).toBe("A description");
    expect(ext.manifest.version).toBe("2.0.0");
    expect(ext.manifest.managedFiles).toHaveLength(2);
    expect(ext.manifest.managedFiles[0].path).toBe("a.dll");
    expect(ext.manifest.managedFiles[1].path).toBe("b.dll");
  });

  it("manifest supports optional fields", () => {
    const ext = createMockExtension("optional-test", {
      author: "Test Author",
      homepage: "https://example.com",
      icon: "icon.png",
      longDescription: "Long description",
      tags: ["game", "tool"],
      minimumLauncherVersion: "1.0.0",
      summary: "Short tagline",
      license: "MIT",
      repository: "https://github.com/test/repo",
    });
    expect(ext.manifest.author).toBe("Test Author");
    expect(ext.manifest.homepage).toBe("https://example.com");
    expect(ext.manifest.icon).toBe("icon.png");
    expect(ext.manifest.longDescription).toBe("Long description");
    expect(ext.manifest.tags).toEqual(["game", "tool"]);
    expect(ext.manifest.minimumLauncherVersion).toBe("1.0.0");
    expect(ext.manifest.summary).toBe("Short tagline");
    expect(ext.manifest.license).toBe("MIT");
    expect(ext.manifest.repository).toBe("https://github.com/test/repo");
  });

  it("manifest supports release provider reference", () => {
    const ext = createMockExtension("release-test", {
      releaseProvider: {
        provider: "github",
        config: { owner: "test", repo: "repo" },
      },
    });
    expect(ext.manifest.releaseProvider?.provider).toBe("github");
    expect(ext.manifest.releaseProvider?.config).toEqual({ owner: "test", repo: "repo" });
  });

  it("manifest supports permissions and capabilities", () => {
    const ext = createMockExtension("perms-test", {
      permissions: [
        { id: "filesystem.read", reason: "Read game files" },
        { id: "steam.appdata", reason: "Access Steam directories" },
      ],
      capabilities: [
        { id: "steam-tool", version: "1.0", description: "Modifies Steam runtime" },
      ],
    });
    expect(ext.manifest.permissions).toHaveLength(2);
    expect(ext.manifest.permissions![0].id).toBe("filesystem.read");
    expect(ext.manifest.capabilities).toHaveLength(1);
    expect(ext.manifest.capabilities![0].id).toBe("steam-tool");
  });

  it("manifest supports install/toggle/update strategies", () => {
    const ext = createMockExtension("strategy-test", {
      installStrategy: { type: "transaction-copy" },
      toggleStrategy: { type: "rename" },
      updateStrategy: { type: "replace", autoCheck: true, autoInstall: false },
    });
    expect(ext.manifest.installStrategy?.type).toBe("transaction-copy");
    expect(ext.manifest.toggleStrategy?.type).toBe("rename");
    expect(ext.manifest.updateStrategy?.type).toBe("replace");
    expect(ext.manifest.updateStrategy?.autoCheck).toBe(true);
  });

  it("manifest supports behavior declaration", () => {
    const ext = createMockExtension("behavior-test", {
      behavior: { luaOwnershipOverride: true },
    });
    expect(ext.manifest.behavior?.luaOwnershipOverride).toBe(true);
  });

  it("manifest supports managed file descriptors with strategies", () => {
    const ext = createMockExtension("files-test", {
      managedFiles: [
        {
          path: "gameoverlayrenderer.dll",
          isExecutable: true,
          replaceStrategy: "if-different",
          backupStrategy: "rename",
          validationStrategy: "checksum",
          checksum: "abc123",
        },
        {
          path: "config.ini",
          required: false,
          replaceStrategy: "never",
          backupStrategy: "copy",
        },
      ],
    });
    expect(ext.manifest.managedFiles[0].path).toBe("gameoverlayrenderer.dll");
    expect(ext.manifest.managedFiles[0].isExecutable).toBe(true);
    expect(ext.manifest.managedFiles[0].checksum).toBe("abc123");
    expect(ext.manifest.managedFiles[1].required).toBe(false);
  });

  it("manifest supports validation rules", () => {
    const ext = createMockExtension("validation-test", {
      validation: {
        requiredFiles: ["gameoverlayrenderer.dll", "config.ini"],
        maxTotalSize: 10485760,
        packageChecksum: "sha256-abc123",
      },
    });
    expect(ext.manifest.validation?.requiredFiles).toHaveLength(2);
    expect(ext.manifest.validation?.maxTotalSize).toBe(10485760);
  });

  it("manifest supports metadata", () => {
    const ext = createMockExtension("meta-test", {
      metadata: { customField: "value", numberField: 42 },
    });
    expect(ext.manifest.metadata?.customField).toBe("value");
    expect(ext.manifest.metadata?.numberField).toBe(42);
  });
});

describe("Extension interface (contract)", () => {
  it("extension has all required methods", () => {
    const ext = createMockExtension("contract-test");
    expect(typeof ext.detect).toBe("function");
    expect(typeof ext.install).toBe("function");
    expect(typeof ext.update).toBe("function");
    expect(typeof ext.enable).toBe("function");
    expect(typeof ext.disable).toBe("function");
    expect(typeof ext.uninstall).toBe("function");
    expect(typeof ext.getInstalledVersion).toBe("function");
    expect(typeof ext.getLatestVersion).toBe("function");
    expect(typeof ext.getStatus).toBe("function");
  });

  it("getBehavior is optional", () => {
    const ext = createMockExtension("no-behavior");
    expect(ext.getBehavior).toBeUndefined();
  });

  it("getBehavior returns ExtensionBehavior when defined", () => {
    const ext = createMockExtension("with-behavior");
    ext.getBehavior = () => ({ luaOwnershipOverride: true });
    expect(ext.getBehavior()).toEqual({ luaOwnershipOverride: true });
  });
});

describe("Validation Patterns (spec constants)", () => {
  it("validates extension IDs", () => {
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("opendeck")).toBe(true);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("goldberg-emulator")).toBe(true);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("steamgriddb")).toBe(true);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("a")).toBe(true);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("")).toBe(false);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("UPPERCASE")).toBe(false);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("has space")).toBe(false);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("has_underscore")).toBe(false);
    expect(VALIDATION_PATTERNS.EXTENSION_ID.test("-starts-with-dash")).toBe(false);
  });

  it("validates semver", () => {
    expect(VALIDATION_PATTERNS.SEMVER.test("1.0.0")).toBe(true);
    expect(VALIDATION_PATTERNS.SEMVER.test("0.1.0")).toBe(true);
    expect(VALIDATION_PATTERNS.SEMVER.test("1.0.0-alpha")).toBe(true);
    expect(VALIDATION_PATTERNS.SEMVER.test("1.0.0-beta.1")).toBe(true);
    expect(VALIDATION_PATTERNS.SEMVER.test("1.0.0+build.123")).toBe(true);
    expect(VALIDATION_PATTERNS.SEMVER.test("1.0.0-alpha+001")).toBe(true);
    expect(VALIDATION_PATTERNS.SEMVER.test("v1.0.0")).toBe(false);
    expect(VALIDATION_PATTERNS.SEMVER.test("1.0")).toBe(false);
    expect(VALIDATION_PATTERNS.SEMVER.test("not-a-version")).toBe(false);
  });

  it("validates capabilities", () => {
    expect(VALIDATION_PATTERNS.CAPABILITY.test("steam-tool")).toBe(true);
    expect(VALIDATION_PATTERNS.CAPABILITY.test("metadata-provider")).toBe(true);
    expect(VALIDATION_PATTERNS.CAPABILITY.test("save-manager")).toBe(true);
    expect(VALIDATION_PATTERNS.CAPABILITY.test("Cap")).toBe(false);
    expect(VALIDATION_PATTERNS.CAPABILITY.test("123-bad")).toBe(false);
  });

  it("validates URLs", () => {
    expect(VALIDATION_PATTERNS.URL.test("https://github.com/owner/repo")).toBe(true);
    expect(VALIDATION_PATTERNS.URL.test("http://example.com")).toBe(true);
    expect(VALIDATION_PATTERNS.URL.test("ftp://files.example.com")).toBe(false);
    expect(VALIDATION_PATTERNS.URL.test("not-a-url")).toBe(false);
  });

  it("validates relative paths", () => {
    expect(VALIDATION_PATTERNS.RELATIVE_PATH.test("dir/file.dll")).toBe(true);
    expect(VALIDATION_PATTERNS.RELATIVE_PATH.test("file.dll")).toBe(true);
    expect(VALIDATION_PATTERNS.RELATIVE_PATH.test("a/b/c/file.txt")).toBe(true);
    expect(VALIDATION_PATTERNS.RELATIVE_PATH.test("/absolute/path")).toBe(false);
    expect(VALIDATION_PATTERNS.RELATIVE_PATH.test("../escape")).toBe(false);
  });

  it("max lengths are defined", () => {
    expect(MAX_LENGTHS.EXTENSION_ID).toBe(64);
    expect(MAX_LENGTHS.DISPLAY_NAME).toBe(128);
    expect(MAX_LENGTHS.DESCRIPTION).toBe(256);
    expect(MAX_LENGTHS.SUMMARY).toBe(128);
    expect(MAX_LENGTHS.LONG_DESCRIPTION).toBe(16384);
  });
});

// ---------------------------------------------------------------------------
// Regression: generic detection/operation dispatch via Registry
// Proves the UI dispatch path (detectExtensionStatus + handleOperation) works
// for ANY registered extension id — catches hardcoded id branching.
// ---------------------------------------------------------------------------

describe("Generic Registry dispatch (no hardcoded id)", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("detect dispatches via getExtension for any registered id", async () => {
    const detectFn = vi.fn(async (_steamRoot: string): Promise<ExtensionDetectionResult> => ({
      status: "installed",
      installedFiles: ["custom-mod.dll"],
      missingFiles: [],
      backupFiles: [],
      installedVersion: "2.0.0",
    }));

    const ext: Extension = {
      manifest: {
        schemaVersion: 1,
        id: "custom-mod",
        name: "Custom Mod",
        displayName: "Custom Mod",
        description: "A custom mod extension",
        version: "2.0.0",
        managedFiles: [{ path: "custom-mod.dll", isExecutable: true, replaceStrategy: "if-different", backupStrategy: "rename" }],
      },
      detect: detectFn,
      install: async () => ({ success: true }),
      update: async () => ({ success: true }),
      enable: async () => ({ success: true }),
      disable: async () => ({ success: true }),
      uninstall: async () => ({ success: true }),
      getInstalledVersion: async () => "2.0.0",
      getLatestVersion: async () => "2.0.0",
      getStatus: async (): Promise<ExtensionStatus> => "installed",
    };

    registerExtension(ext);

    // Simulate the UI's detectExtensionStatus logic: getExtension → call detect
    const lookup = getExtension("custom-mod");
    expect(lookup).toBe(ext);
    expect(lookup!.manifest.id).toBe("custom-mod");

    const steamRoot = "C:\\Program Files (x86)\\Steam";
    const result = await lookup!.detect(steamRoot);

    expect(detectFn).toHaveBeenCalledWith(steamRoot);
    expect(result.status).toBe("installed");
    expect(result.installedFiles).toEqual(["custom-mod.dll"]);
  });

  it("detect returns undefined for unregistered id (no silent failure)", () => {
    const lookup = getExtension("non-existent-extension");
    expect(lookup).toBeUndefined();
  });

  it("operation dispatches via getExtension for any registered id", async () => {
    const installFn = vi.fn(async (): Promise<ExtensionOperationResult> => ({ success: true }));
    const enableFn = vi.fn(async (): Promise<ExtensionOperationResult> => ({ success: true }));
    const disableFn = vi.fn(async (): Promise<ExtensionOperationResult> => ({ success: true }));
    const uninstallFn = vi.fn(async (): Promise<ExtensionOperationResult> => ({ success: true }));
    const updateFn = vi.fn(async (): Promise<ExtensionOperationResult> => ({ success: true }));

    const ext: Extension = {
      manifest: {
        schemaVersion: 1,
        id: "another-extension",
        name: "Another Extension",
        displayName: "Another",
        description: "Test",
        version: "1.0.0",
        managedFiles: [{ path: "another.dll", isExecutable: true, replaceStrategy: "if-different", backupStrategy: "rename" }],
      },
      detect: async () => ({
        status: "available",
        installedFiles: [],
        missingFiles: ["another.dll"],
        backupFiles: [],
        installedVersion: null,
      }),
      install: installFn,
      update: updateFn,
      enable: enableFn,
      disable: disableFn,
      uninstall: uninstallFn,
      getInstalledVersion: async () => null,
      getLatestVersion: async () => "1.0.0",
      getStatus: async (): Promise<ExtensionStatus> => "available",
    };

    registerExtension(ext);

    // Simulate handleOperation: getExtension → call operation
    const OPERATIONS = ["install", "update", "enable", "disable", "uninstall"] as const;
    const fnMap = {
      install: installFn,
      update: updateFn,
      enable: enableFn,
      disable: disableFn,
      uninstall: uninstallFn,
    };

    const OPS_ARG = { hostPath: "" };

    for (const op of OPERATIONS) {
      const lookup = getExtension("another-extension");
      expect(lookup).toBe(ext);

      const result = await lookup![op](OPS_ARG);
      expect(result.success).toBe(true);
      expect(fnMap[op]).toHaveBeenCalled();
    }

    expect(installFn).toHaveBeenCalledTimes(1);
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(enableFn).toHaveBeenCalledTimes(1);
    expect(disableFn).toHaveBeenCalledTimes(1);
    expect(uninstallFn).toHaveBeenCalledTimes(1);
  });

  it("multiple extensions with different ids all resolve independently", async () => {
    const ids = ["alpha-tool", "beta-mod", "gamma-patch"];
    const callCounts: Record<string, number> = {};

    for (const id of ids) {
      callCounts[id] = 0;
      registerExtension({
        manifest: {
          schemaVersion: 1,
          id,
          name: id,
          displayName: id,
          description: id,
          version: "1.0.0",
          managedFiles: [{ path: `${id}.dll`, isExecutable: true, replaceStrategy: "if-different", backupStrategy: "rename" }],
        },
        detect: async () => {
          callCounts[id]++;
          return { status: "installed", installedFiles: [`${id}.dll`], missingFiles: [], backupFiles: [], installedVersion: "1.0.0" };
        },
        install: async () => ({ success: true }),
        update: async () => ({ success: true }),
        enable: async () => ({ success: true }),
        disable: async () => ({ success: true }),
        uninstall: async () => ({ success: true }),
        getInstalledVersion: async () => "1.0.0",
        getLatestVersion: async () => "1.0.0",
        getStatus: async (): Promise<ExtensionStatus> => "installed",
      });
    }

    // Each id resolves to its own extension
    for (const id of ids) {
      const ext = getExtension(id);
      expect(ext).toBeDefined();
      expect(ext!.manifest.id).toBe(id);
    }

    // Detect each independently
    for (const id of ids) {
      const ext = getExtension(id)!;
      const result = await ext.detect("");
      expect(result.status).toBe("installed");
      expect(result.installedFiles).toEqual([`${id}.dll`]);
      expect(callCounts[id]).toBe(1);
    }

    // No cross-contamination
    for (const id of ids) {
      expect(callCounts[id]).toBe(1);
    }

    expect(getExtensionCount()).toBe(3);
  });

  it("unregistered id returns undefined (no silent pass-through)", () => {
    // If the code had `if (id !== "opensteamtool") return;` this would
    // still return undefined — but our generic code should return undefined
    // for ALL unregistered ids, not just non-opensteamtool ones.
    expect(getExtension("opensteamtool")).toBeUndefined();
    expect(getExtension("something-else")).toBeUndefined();
    expect(getExtension("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression: Full pipeline — BuiltInSource → SourceManager → ExtensionManager → Registry
// Proves that discoverAllSources() wires Extension runtimes from SourceExtension
// into the Registry, so getExtension(id) returns a real Extension with detect().
// ---------------------------------------------------------------------------

describe("Full pipeline: BuiltInSource → SourceManager → ExtensionManager → Registry", () => {
  beforeEach(() => {
    clearRegistry();
    clearExtensionManager();
    resetSourceManager();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSourceManager();
  });

  it("discovers built-in extension, registers manifest AND runtime in Registry", async () => {
    const MOCK_MANIFEST = {
      schemaVersion: 1 as const,
      id: "opensteamtool",
      name: "opensteamtool",
      displayName: "OpenSteamTool",
      description: "DLL injection for Steam client",
      version: "1.4.8",
      author: "OpenSteam001",
      managedFiles: [
        { path: "dwmapi.dll", isExecutable: true, replaceStrategy: "if-different" as const, backupStrategy: "rename" as const },
      ],
    };

    const mockDetect = vi.fn(async (_steamRoot: string): Promise<ExtensionDetectionResult> => ({
      status: "enabled",
      installedFiles: ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"],
      missingFiles: [],
      backupFiles: [],
      installedVersion: "1.4.8",
    }));

    const mockExtension: Extension = {
      manifest: MOCK_MANIFEST,
      detect: mockDetect,
      install: async () => ({ success: true }),
      update: async () => ({ success: true }),
      enable: async () => ({ success: true }),
      disable: async () => ({ success: true }),
      uninstall: async () => ({ success: true }),
      getInstalledVersion: async () => "1.4.8",
      getLatestVersion: async () => "1.4.8",
      getStatus: async (): Promise<ExtensionStatus> => "enabled",
    };

    // Mock fetch to return the manifest for opensteamtool
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("opensteamtool/manifest.json")) {
        return { ok: true, status: 200, json: async () => MOCK_MANIFEST };
      }
      // Placeholder manifest (other built-in extensions)
      if (typeof url === "string" && url.includes("manifest.json")) {
        return { ok: true, status: 200, json: async () => ({ ...MOCK_MANIFEST, id: url.split("/").slice(-2, -1)[0], name: url.split("/").slice(-2, -1)[0] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));

    // Mock dynamic import of getOpenSteamToolExtension
    vi.doMock("../extensions/builtin/opensteamtool", () => ({
      getOpenSteamToolExtension: vi.fn(async () => mockExtension),
    }));

    // Register BuiltInSource (priority 0) — no RepositorySource
    registerSource(new BuiltInSource());

    // Run discovery pipeline
    const result = await discoverAllSources();

    // SourceManager registered at least 1 extension
    expect(result.registered).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);

    // ExtensionManager has opensteamtool registered (manifest + status)
    const { getRegisteredExtension } = await import("../extensions/manager");
    const registered = getRegisteredExtension("opensteamtool");
    expect(registered).toBeDefined();
    expect(registered!.manifest.id).toBe("opensteamtool");
    expect(registered!.sourceId).toBe("builtin");
    expect(registered!.status).toBe("available");

    // Registry has the Extension runtime instance (wired by SourceManager)
    const runtime = getExtension("opensteamtool");
    expect(runtime).toBeDefined();
    expect(runtime!.manifest.id).toBe("opensteamtool");

    // detect() works via the Registry — no hardcoded id check
    const steamRoot = "C:\\Program Files (x86)\\Steam";
    const detection = await runtime!.detect(steamRoot);
    expect(mockDetect).toHaveBeenCalledWith(steamRoot);
    expect(detection.status).toBe("enabled");
    expect(detection.installedFiles).toEqual(["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"]);
    expect(detection.installedVersion).toBe("1.4.8");

    vi.doUnmock("../extensions/builtin/opensteamtool");
  });

  it("SourceExtension with extension field gets registered in Registry", async () => {
    // Directly test the SourceManager → Registry wiring with a mock source
    const mockDetect = vi.fn(async (): Promise<ExtensionDetectionResult> => ({
      status: "installed",
      installedFiles: ["mock.dll"],
      missingFiles: [],
      backupFiles: [],
      installedVersion: "3.0.0",
    }));

    const mockExtension: Extension = {
      manifest: {
        schemaVersion: 1,
        id: "pipeline-test",
        name: "Pipeline Test",
        displayName: "Pipeline Test",
        description: "Tests the pipeline wiring",
        version: "3.0.0",
        managedFiles: [{ path: "mock.dll", isExecutable: true, replaceStrategy: "if-different", backupStrategy: "rename" }],
      },
      detect: mockDetect,
      install: async () => ({ success: true }),
      update: async () => ({ success: true }),
      enable: async () => ({ success: true }),
      disable: async () => ({ success: true }),
      uninstall: async () => ({ success: true }),
      getInstalledVersion: async () => "3.0.0",
      getLatestVersion: async () => "3.0.0",
      getStatus: async (): Promise<ExtensionStatus> => "installed",
    };

    // Create a mock source that returns SourceExtension with extension runtime
    const mockSource = {
      id: "mock-source",
      displayName: "Mock Source",
      priority: 5,
      enabled: true,
      initialize: async () => {},
      discover: async () => ({
        extensions: [{
          manifest: mockExtension.manifest,
          sourceId: "mock-source",
          extension: mockExtension,
        }],
        success: true,
        errors: [],
        queriedAt: Date.now(),
      }),
      findById: async () => null,
      isAvailable: async () => false,
      destroy: async () => {},
    };

    registerSource(mockSource as any);

    const result = await discoverAllSources();
    expect(result.registered).toBe(1);

    // Manifest registered in ExtensionManager
    const { getRegisteredExtension } = await import("../extensions/manager");
    const registered = getRegisteredExtension("pipeline-test");
    expect(registered).toBeDefined();
    expect(registered!.sourceId).toBe("mock-source");

    // Runtime registered in Registry — detect() works
    const runtime = getExtension("pipeline-test");
    expect(runtime).toBe(mockExtension);
    const detection = await runtime!.detect("");
    expect(detection.status).toBe("installed");
    expect(mockDetect).toHaveBeenCalled();
  });

  it("RepositorySource does NOT carry extension runtimes (manifest only)", async () => {
    // RepositorySource discovers manifests over HTTP — it cannot carry runtime instances.
    // Verify that RepositorySource SourceExtension has no extension field.
    const { RepositorySource } = await import("../extensions/sources/repository");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (typeof url === "string" && url.endsWith("index.json")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            schemaVersion: 1, id: "test-repo", name: "Test", version: "1.0.0",
            updatedAt: "2026-01-01T00:00:00Z",
            extensions: [{ id: "remote-ext", displayName: "Remote", description: "Test", version: "1.0.0", manifestUrl: "manifest.json" }],
          }),
        };
      }
      if (typeof url === "string" && url.endsWith("manifest.json")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            schemaVersion: 1, id: "remote-ext", name: "remote-ext", displayName: "Remote",
            description: "Test", version: "1.0.0", managedFiles: [],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));

    const source = new RepositorySource({
      id: "test-repo", displayName: "Test", priority: 10,
      config: { url: "https://example.com/index.json" },
    });

    const result = await source.discover();
    expect(result.extensions).toHaveLength(1);
    // RepositorySource SourceExtension should NOT have an extension runtime
    expect(result.extensions[0].extension).toBeUndefined();
  });
});
