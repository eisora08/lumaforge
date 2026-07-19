import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mock fetch to serve local files from public/ directory
const _realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/")) {
      const filePath = resolve(process.cwd(), "public", url.slice(1));
      try {
        const body = readFileSync(filePath, "utf-8");
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
    return _realFetch(input, _init);
  };
});
afterAll(() => {
  globalThis.fetch = _realFetch;
});

// Manifest Loader
import { loadManifestFromObject, loadManifestFromString } from "../extensions/manifests";
import type { ExtensionManifestV1, PermissionEntry, CapabilityEntry } from "../extensions/types";

// Errors
import {
  ManifestParseError,
  ManifestValidationError,
  SchemaVersionUnsupportedError,
  RepositoryIndexError,
} from "../extensions/errors";

// Extension Manager
import {
  registerLoadedExtension,
  unregisterLoadedExtension,
  getRegisteredExtension,
  listExtensions,
  getExtensionsBySurface,
  getRegisteredExtensionCount,
  clearExtensionManager,
} from "../extensions/manager";

// BuiltInSource
import { BuiltInSource } from "../extensions/sources/builtin";

// Source Manager
import {
  registerSource,
  discoverAllSources,
  resetSourceManager,
} from "../extensions/sources/manager";

// Repository Loader
import {
  parseRepositoryIndex,
  loadRepositoryIndexFromString,
  loadRepositoryManifests,
} from "../extensions/repository";
import type { RepositoryIndex } from "../extensions/types";

// Bootstrap
import {
  bootstrapExtensions,
  resetBootstrap,
} from "../extensions/bootstrap";

// =============================================================================
// Helpers
// =============================================================================

function validManifest(overrides?: Partial<ExtensionManifestV1>): ExtensionManifestV1 {
  return {
    schemaVersion: 1,
    id: "test-ext",
    name: "test-ext",
    displayName: "Test Extension",
    description: "A test extension",
    version: "1.0.0",
    managedFiles: [],
    ...overrides,
  };
}

// =============================================================================
// ManifestLoader
// =============================================================================

describe("ManifestLoader", () => {
  describe("loadManifestFromObject", () => {
    it("loads a valid manifest", () => {
      const manifest = loadManifestFromObject(validManifest());
      expect(manifest.id).toBe("test-ext");
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.version).toBe("1.0.0");
    });

    it("loads manifest with all optional fields", () => {
      const full = validManifest({
        author: "Test Author",
        homepage: "https://example.com",
        repository: "https://github.com/test/repo",
        license: "MIT",
        icon: "icon.png",
        summary: "Short tagline",
        longDescription: "Long description",
        categories: ["tools"],
        tags: ["test"],
        permissions: [{ id: "filesystem.read" } as PermissionEntry],
        capabilities: [{ id: "steam-tool" } as CapabilityEntry],
      });
      const manifest = loadManifestFromObject(full);
      expect(manifest.author).toBe("Test Author");
      expect(manifest.homepage).toBe("https://example.com");
      expect(manifest.permissions).toHaveLength(1);
      expect(manifest.capabilities).toHaveLength(1);
    });

    it("rejects non-object input", () => {
      expect(() => loadManifestFromObject(null)).toThrow(ManifestParseError);
      expect(() => loadManifestFromObject("string")).toThrow(ManifestParseError);
      expect(() => loadManifestFromObject(42)).toThrow(ManifestParseError);
      expect(() => loadManifestFromObject([])).toThrow(ManifestParseError);
    });

    it("rejects unsupported schema version", () => {
      expect(() => loadManifestFromObject(validManifest({ schemaVersion: 2 as 1 })))
        .toThrow(SchemaVersionUnsupportedError);
    });

    it("rejects missing required fields", () => {
      expect(() => loadManifestFromObject({ schemaVersion: 1 }))
        .toThrow(ManifestValidationError);
      expect(() => loadManifestFromObject({ schemaVersion: 1, id: "x" }))
        .toThrow(ManifestValidationError);
    });

    it("rejects invalid id format", () => {
      expect(() => loadManifestFromObject(validManifest({ id: "UPPERCASE" })))
        .toThrow(ManifestValidationError);
      expect(() => loadManifestFromObject(validManifest({ id: "has space" })))
        .toThrow(ManifestValidationError);
      expect(() => loadManifestFromObject(validManifest({ id: "-starts-dash" })))
        .toThrow(ManifestValidationError);
    });

    it("rejects invalid version format", () => {
      expect(() => loadManifestFromObject(validManifest({ version: "not-a-version" })))
        .toThrow(ManifestValidationError);
      expect(() => loadManifestFromObject(validManifest({ version: "1.0" })))
        .toThrow(ManifestValidationError);
    });

    it("rejects non-array managedFiles", () => {
      const raw = { ...validManifest(), managedFiles: "not-array" };
      expect(() => loadManifestFromObject(raw)).toThrow(ManifestValidationError);
    });

    it("rejects invalid managed file entry", () => {
      const emptyEntry = { ...validManifest(), managedFiles: [{}] };
      expect(() => loadManifestFromObject(emptyEntry as unknown)).toThrow(ManifestValidationError);

      const escapePath = { ...validManifest(), managedFiles: [{ path: "../escape" }] };
      expect(() => loadManifestFromObject(escapePath as unknown)).toThrow(ManifestValidationError);
    });

    it("rejects invalid homepage URL", () => {
      expect(() => loadManifestFromObject(validManifest({ homepage: "not-a-url" })))
        .toThrow(ManifestValidationError);
    });

    it("rejects categories exceeding max count", () => {
      expect(() => loadManifestFromObject(validManifest({ categories: ["a", "b", "c", "d"] })))
        .toThrow(ManifestValidationError);
    });

    it("rejects invalid permissions format", () => {
      const raw = { ...validManifest(), permissions: ["not-object"] };
      expect(() => loadManifestFromObject(raw as unknown)).toThrow(ManifestValidationError);
    });

    it("rejects invalid capabilities format", () => {
      const raw = { ...validManifest(), capabilities: [{}] };
      expect(() => loadManifestFromObject(raw as unknown)).toThrow(ManifestValidationError);
    });
  });

  describe("loadManifestFromString", () => {
    it("parses valid JSON", () => {
      const json = JSON.stringify(validManifest());
      const manifest = loadManifestFromString(json);
      expect(manifest.id).toBe("test-ext");
    });

    it("rejects invalid JSON", () => {
      expect(() => loadManifestFromString("{invalid")).toThrow(ManifestParseError);
    });

    it("rejects valid JSON with invalid manifest", () => {
      expect(() => loadManifestFromString('{"schemaVersion":1}')).toThrow(ManifestValidationError);
    });
  });

  describe("placeholder manifest", () => {
    it("placeholder JSON is valid via loadManifestFromObject", async () => {
      const response = await fetch("/extensions/builtin/placeholder/manifest.json");
      const raw = await response.json();
      const manifest = loadManifestFromObject(raw, { path: "placeholder/manifest.json" });
      expect(manifest.id).toBe("placeholder");
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.version).toBe("1.0.0");
      expect(manifest.displayName).toBe("Placeholder Extension");
    });
  });
});

// =============================================================================
// ExtensionManager
// =============================================================================

describe("ExtensionManager", () => {
  beforeEach(() => {
    clearExtensionManager();
  });

  it("registers and retrieves an extension", () => {
    const manifest = validManifest();
    registerLoadedExtension(manifest, "builtin");
    const ext = getRegisteredExtension("test-ext");
    expect(ext).toBeDefined();
    expect(ext!.manifest.id).toBe("test-ext");
    expect(ext!.sourceId).toBe("builtin");
    expect(ext!.status).toBe("available");
  });

  it("unregisters an extension", () => {
    registerLoadedExtension(validManifest(), "builtin");
    const removed = unregisterLoadedExtension("test-ext");
    expect(removed).toBe(true);
    expect(getRegisteredExtension("test-ext")).toBeUndefined();
  });

  it("returns false when unregistering non-existent extension", () => {
    expect(unregisterLoadedExtension("nonexistent")).toBe(false);
  });

  it("lists all extensions", () => {
    registerLoadedExtension(validManifest({ id: "ext-a" }), "builtin");
    registerLoadedExtension(validManifest({ id: "ext-b" }), "builtin");
    const all = listExtensions();
    expect(all.length).toBe(2);
    expect(all.map((e) => e.manifest.id)).toContain("ext-a");
    expect(all.map((e) => e.manifest.id)).toContain("ext-b");
  });

  it("returns correct count", () => {
    expect(getRegisteredExtensionCount()).toBe(0);
    registerLoadedExtension(validManifest({ id: "c1" }), "builtin");
    expect(getRegisteredExtensionCount()).toBe(1);
    registerLoadedExtension(validManifest({ id: "c2" }), "builtin");
    expect(getRegisteredExtensionCount()).toBe(2);
  });

  it("gets extensions by surface from metadata", () => {
    registerLoadedExtension(
      validManifest({ id: "settings-ext", metadata: { surfaces: ["settings"] } }),
      "builtin",
    );
    registerLoadedExtension(
      validManifest({ id: "tools-ext", metadata: { surfaces: ["tools"] } }),
      "builtin",
    );
    registerLoadedExtension(
      validManifest({ id: "multi-ext", metadata: { surfaces: ["settings", "library"] } }),
      "builtin",
    );

    const settingsExts = getExtensionsBySurface("settings");
    expect(settingsExts.length).toBe(2);
    expect(settingsExts.map((e) => e.manifest.id)).toContain("settings-ext");
    expect(settingsExts.map((e) => e.manifest.id)).toContain("multi-ext");

    const toolsExts = getExtensionsBySurface("tools");
    expect(toolsExts.length).toBe(1);
    expect(toolsExts[0].manifest.id).toBe("tools-ext");

    const libraryExts = getExtensionsBySurface("library");
    expect(libraryExts.length).toBe(1);
    expect(libraryExts[0].manifest.id).toBe("multi-ext");
  });

  it("defaults surface to settings when metadata.surfaces is absent", () => {
    registerLoadedExtension(validManifest({ id: "no-surface" }), "builtin");
    const ext = getRegisteredExtension("no-surface");
    expect(ext!.surfaces).toEqual(["settings"]);
  });

  it("replaces extension with same id on re-register", () => {
    registerLoadedExtension(validManifest({ version: "1.0.0" }), "builtin");
    registerLoadedExtension(validManifest({ version: "2.0.0" }), "builtin");
    expect(getRegisteredExtensionCount()).toBe(1);
    expect(getRegisteredExtension("test-ext")!.manifest.version).toBe("2.0.0");
  });
});

// =============================================================================
// BuiltInSource
// =============================================================================

describe("BuiltInSource", () => {
  it("has correct identity", () => {
    const source = new BuiltInSource();
    expect(source.id).toBe("builtin");
    expect(source.priority).toBe(0);
    expect(source.enabled).toBe(true);
  });

  it("discovers the placeholder extension", async () => {
    const source = new BuiltInSource();
    const result = await source.discover();
    expect(result.success).toBe(true);
    expect(result.extensions.length).toBeGreaterThanOrEqual(1);
    const placeholder = result.extensions.find((e) => e.manifest.id === "placeholder");
    expect(placeholder).toBeDefined();
    expect(placeholder!.manifest.displayName).toBe("Placeholder Extension");
    expect(placeholder!.sourceId).toBe("builtin");
  });

  it("findById returns the placeholder", async () => {
    const source = new BuiltInSource();
    const ext = await source.findById("placeholder");
    expect(ext).not.toBeNull();
    expect(ext!.manifest.id).toBe("placeholder");
  });

  it("findById returns null for non-existent", async () => {
    const source = new BuiltInSource();
    const ext = await source.findById("nonexistent");
    expect(ext).toBeNull();
  });
});

// =============================================================================
// SourceManager + discoverAllSources
// =============================================================================

describe("SourceManager", () => {
  beforeEach(() => {
    resetSourceManager();
    clearExtensionManager();
  });

  it("registers and queries sources", async () => {
    registerSource(new BuiltInSource());
    const result = await discoverAllSources();
    expect(result.registered).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it("skips duplicate source registration", () => {
    const source = new BuiltInSource();
    registerSource(source);
    registerSource(source);
    const sources = [source];
    expect(sources.length).toBe(1);
  });
});

// =============================================================================
// RepositoryLoader
// =============================================================================

describe("RepositoryLoader", () => {
  const sampleIndex: RepositoryIndex = {
    schemaVersion: 1,
    id: "test-repo",
    name: "Test Repository",
    version: "1.0.0",
    updatedAt: "2026-01-01T00:00:00Z",
    extensions: [
      {
        id: "placeholder",
        displayName: "Placeholder Extension",
        description: "A placeholder",
        version: "1.0.0",
        manifestUrl: "extensions/builtin/placeholder/manifest.json",
      },
    ],
  };

  it("parses a valid index", () => {
    const index = parseRepositoryIndex(sampleIndex);
    expect(index.id).toBe("test-repo");
    expect(index.extensions).toHaveLength(1);
  });

  it("rejects invalid index", () => {
    expect(() => parseRepositoryIndex(null)).toThrow(RepositoryIndexError);
    expect(() => parseRepositoryIndex({})).toThrow(RepositoryIndexError);
    expect(() => parseRepositoryIndex({ id: "x" })).toThrow(RepositoryIndexError);
  });

  it("parses index from JSON string", () => {
    const index = loadRepositoryIndexFromString(JSON.stringify(sampleIndex));
    expect(index.id).toBe("test-repo");
  });

  it("rejects invalid JSON string", () => {
    expect(() => loadRepositoryIndexFromString("{bad")).toThrow(RepositoryIndexError);
  });

  it("loads manifests from local repository", async () => {
    const basePath = "/extensions/builtin";
    const result = await loadRepositoryManifests(
      {
        schemaVersion: 1,
        id: "local-test",
        name: "Local Test",
        version: "1.0.0",
        updatedAt: "2026-01-01T00:00:00Z",
        extensions: [
          {
            id: "placeholder",
            displayName: "Placeholder Extension",
            description: "A placeholder",
            version: "1.0.0",
            manifestUrl: "placeholder/manifest.json",
          },
        ],
      },
      basePath,
    );
    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0].manifest.id).toBe("placeholder");
    expect(result.errors).toHaveLength(0);
  });
});

// =============================================================================
// End-to-End: BuiltInSource → ExtensionManager → listExtensions
// =============================================================================

describe("End-to-End Extension Lifecycle", () => {
  beforeEach(() => {
    resetSourceManager();
    clearExtensionManager();
    resetBootstrap();
  });

  it("bootstrap discovers, validates, and registers the placeholder extension", async () => {
    const result = await bootstrapExtensions();
    expect(result.registered).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);

    const extensions = listExtensions();
    expect(extensions.length).toBeGreaterThanOrEqual(1);

    const placeholder = extensions.find((e) => e.manifest.id === "placeholder");
    expect(placeholder).toBeDefined();
    expect(placeholder!.manifest.schemaVersion).toBe(1);
    expect(placeholder!.manifest.displayName).toBe("Placeholder Extension");
    expect(placeholder!.sourceId).toBe("builtin");
    expect(placeholder!.status).toBe("available");
    expect(placeholder!.surfaces).toEqual(["settings"]);
  });

  it("getExtensionsBySurface returns placeholder in settings", async () => {
    await bootstrapExtensions();
    const settingsExts = getExtensionsBySurface("settings");
    expect(settingsExts.some((e) => e.manifest.id === "placeholder")).toBe(true);
  });

  it("bootstrap is idempotent", async () => {
    const result1 = await bootstrapExtensions();
    const result2 = await bootstrapExtensions();
    expect(result2.extensions.length).toBe(result1.extensions.length);
  });
});
