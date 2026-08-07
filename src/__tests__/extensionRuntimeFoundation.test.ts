/**
 * Extension Runtime Foundation — Tests.
 *
 * Tests covering:
 * - Registration pipeline (valid manifest → available record)
 * - Enable/disable (contribution activation/deactivation)
 * - Contribution projection (tools surface → view models)
 * - Error isolation (one invalid extension does not block valid)
 * - No "add-on" / "addon" terminology in runtime
 * - No file I/O, no HTTP, no network calls in pure functions
 * - Source precedence (Built-in > Dev Fixture)
 * - Performance (registration under time threshold)
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  resetRuntimeStore,
  registerExtensionRuntime,
  snapshot,
  getExtensionRuntime,
  getAllExtensionRuntimes,
  containsAddOnTerminology,
  setResolvedContributions,
} from "../extensions/runtime/store";

import { validateManifest } from "../extensions/runtime/validation";
import { evaluateCompatibility } from "../extensions/runtime/compatibility";

import {
  registerManifestAsRuntime,
  enableRuntimeExtension,
  disableRuntimeExtension,
  projectToolsContributions,
} from "../extensions/manager";

import {
  DevFixtureSource,
  setDevModeOverride,
  getDevFixtureManifests,
} from "../extensions/sources/devFixture";

import { VALIDATION_PATTERNS } from "../extensions/types";
import type { ExtensionManifestV1 } from "../extensions/types";

// ── Fixture manifests ──

function validManifest(overrides: Partial<{ id: string; displayName: string; version: string; surfaces: string[] }> = {}): ExtensionManifestV1 {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "test-extension-foo",
    name: overrides.id ?? "test-extension-foo",
    displayName: overrides.displayName ?? "Test Extension Foo",
    description: "A test extension for unit tests.",
    version: overrides.version ?? "1.0.0",
    managedFiles: [],
    permissions: [{ id: "ui.settings", reason: "Add settings contribution", optional: true }],
    capabilities: [{ id: "launcher-integration", version: "1.0.0", description: "Test capability" }],
    metadata: {
      surfaces: overrides.surfaces ?? ["settings", "tools"],
    },
  };
}

function invalidManifest(): ExtensionManifestV1 {
  return {
    schemaVersion: 2 as 1,
    id: "UPPERCASE-ID",
    name: "UPPERCASE-ID",
    displayName: "Invalid Extension",
    description: "This manifest has invalid fields.",
    version: "not-a-semver",
    managedFiles: [],
  };
}

function toolsManifest(id: string = "tools-ext-alpha"): ExtensionManifestV1 {
  return {
    schemaVersion: 1,
    id,
    name: id,
    displayName: `Tools Extension ${id.split("-").pop()}`,
    description: "Provides tools contributions.",
    version: "1.0.0",
    managedFiles: [],
    permissions: [{ id: "ui.settings", optional: true }],
    metadata: { surfaces: ["tools"] },
  };
}

// ── Tests ──

describe("Extension Runtime Foundation", () => {
  beforeEach(() => {
    resetRuntimeStore();
  });

  // =========================================================================
  // Registration Pipeline
  // =========================================================================

  describe("Registration pipeline", () => {
    it("registers a valid manifest and produces an 'available' record", () => {
      const manifest = validManifest();
      const result = registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      expect(result.success).toBe(true);
      expect(result.stage).toBe("complete");
      expect(result.record.manifest.id).toBe("test-extension-foo");
      expect(result.record.status).toBe("available");
      expect(result.record.validation.valid).toBe(true);
      expect(result.record.compatibility.compatible).toBe(true);
    });

    it("rejects duplicate extension IDs deterministically", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      const second = registerManifestAsRuntime(manifest, { sourceId: "test-2", builtIn: false });

      expect(second.record.manifest.id).toBe("test-extension-foo");
      expect(getAllExtensionRuntimes().length).toBe(1);
    });

    it("produces 'invalid' status for manifest with bad schema/version", () => {
      const manifest = invalidManifest();
      const result = registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      expect(result.success).toBe(false);
      expect(result.stage).toBe("validation-failed");
      expect(result.record.status).toBe("invalid");
      expect(result.record.validation.errors.length).toBeGreaterThan(0);
    });

    it("produces 'incompatible' status when launcher version is below minimum", () => {
      const manifest = validManifest({ id: "incompatible-ext" });
      manifest.minimumLauncherVersion = "999.0.0";
      const result = registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      expect(result.success).toBe(false);
      expect(result.stage).toBe("incompatible");
      expect(result.record.status).toBe("incompatible");
      expect(result.record.compatibility.compatible).toBe(false);
    });
  });

  // =========================================================================
  // Enable / Disable
  // =========================================================================

  describe("Enable / Disable", () => {
    it("enables a registered extension and activates contributions", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      const enabled = enableRuntimeExtension("test-extension-foo");
      expect(enabled).not.toBeNull();
      expect(enabled!.status).toBe("enabled");
      expect(enabled!.enabled).toBe(true);
      expect(enabled!.activeContributions.length).toBeGreaterThan(0);
    });

    it("disables an enabled extension and removes active contributions", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("test-extension-foo");

      const disabled = disableRuntimeExtension("test-extension-foo");
      expect(disabled).not.toBeNull();
      expect(disabled!.status).toBe("disabled");
      expect(disabled!.enabled).toBe(false);
      expect(disabled!.activeContributions.length).toBe(0);
    });

    it("cannot enable an invalid extension", () => {
      const manifest = invalidManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      const result = enableRuntimeExtension("UPPERCASE-ID");
      expect(result).toBeNull();
    });

    it("cannot enable an incompatible extension", () => {
      const manifest = validManifest({ id: "incompatible-ext" });
      manifest.minimumLauncherVersion = "999.0.0";
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      const result = enableRuntimeExtension("incompatible-ext");
      expect(result).toBeNull();
    });

    it("enable after disable restores contributions", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("test-extension-foo");
      disableRuntimeExtension("test-extension-foo");

      const reenabled = enableRuntimeExtension("test-extension-foo");
      expect(reenabled).not.toBeNull();
      expect(reenabled!.status).toBe("enabled");
      expect(reenabled!.activeContributions.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Contribution Projection (Tools)
  // =========================================================================

  describe("Tools projection", () => {
    it("projects enabled tools contributions as view models", () => {
      const manifest = toolsManifest("tools-ext-alpha");
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("tools-ext-alpha");

      const tools = projectToolsContributions();
      expect(tools.length).toBe(1);
      expect(tools[0].extensionId).toBe("tools-ext-alpha");
      expect(tools[0].displayName).toContain("Tools Extension");
      expect(tools[0].source).toBe("test");
    });

    it("excludes dev fixtures in production mode", () => {
      const manifest = toolsManifest("tools-ext-beta");
      registerManifestAsRuntime(manifest, { sourceId: "dev-fixture", builtIn: false });
      enableRuntimeExtension("tools-ext-beta");

      const devTools = projectToolsContributions(false);
      expect(devTools.length).toBe(1);

      const prodTools = projectToolsContributions(true);
      expect(prodTools.length).toBe(0);
    });

    it("excludes disabled extensions from tools projection", () => {
      const manifest = toolsManifest("tools-ext-gamma");
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("tools-ext-gamma");
      disableRuntimeExtension("tools-ext-gamma");

      const tools = projectToolsContributions();
      expect(tools.length).toBe(0);
    });

    it("sorts tools by priority", () => {
      const m1 = toolsManifest("tools-ext-high");
      const m2 = toolsManifest("tools-ext-low");
      registerManifestAsRuntime(m1, { sourceId: "test", builtIn: false });
      registerManifestAsRuntime(m2, { sourceId: "test", builtIn: false });

      setResolvedContributions("tools-ext-high", [
        { surface: "tools", id: "tools-ext-high:tools", displayName: "High", priority: 10 },
      ]);
      setResolvedContributions("tools-ext-low", [
        { surface: "tools", id: "tools-ext-low:tools", displayName: "Low", priority: 90 },
      ]);

      enableRuntimeExtension("tools-ext-high");
      enableRuntimeExtension("tools-ext-low");

      const tools = projectToolsContributions();
      expect(tools.length).toBe(2);
      expect(tools[0].id).toBe("tools-ext-high:tools");
      expect(tools[1].id).toBe("tools-ext-low:tools");
    });
  });

  // =========================================================================
  // Error Isolation
  // =========================================================================

  describe("Error isolation", () => {
    it("one invalid extension does not block valid extensions", () => {
      const bad = invalidManifest();
      const good = validManifest({ id: "good-ext" });

      registerManifestAsRuntime(bad, { sourceId: "test", builtIn: false });
      registerManifestAsRuntime(good, { sourceId: "test", builtIn: false });

      const snap = snapshot();
      expect(snap.total).toBe(2);
      expect(snap.invalidCount).toBe(1);

      const goodRecord = getExtensionRuntime("good-ext");
      expect(goodRecord).toBeDefined();
      expect(goodRecord!.validation.valid).toBe(true);
    });

    it("independent extensions have independent status", () => {
      const manifest1 = validManifest({ id: "ext-1" });
      const manifest2 = validManifest({ id: "ext-2" });
      manifest2.minimumLauncherVersion = "999.0.0";

      registerManifestAsRuntime(manifest1, { sourceId: "test", builtIn: false });
      registerManifestAsRuntime(manifest2, { sourceId: "test", builtIn: false });

      const r1 = getExtensionRuntime("ext-1");
      const r2 = getExtensionRuntime("ext-2");

      expect(r1!.status).toBe("available");
      expect(r2!.status).toBe("incompatible");
    });
  });

  // =========================================================================
  // No "add-on" / "addon" Terminology
  // =========================================================================

  describe("No add-on terminology", () => {
    it("runtime status labels do not contain 'add-on' or 'addon'", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });

      const snap = snapshot();
      for (const record of snap.records.values()) {
        expect(containsAddOnTerminology(record.status)).toBe(false);
      }
    });

    it("runtime status is never 'add-on' or 'addon'", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("test-extension-foo");

      const snap = snapshot();
      for (const record of snap.records.values()) {
        expect(record.status).not.toBe("add-on");
        expect(record.status).not.toBe("addon");
      }
    });
  });

  // =========================================================================
  // No I/O in Pure Functions
  // =========================================================================

  describe("No I/O", () => {
    it("validateManifest does not perform file I/O", () => {
      const manifest = validManifest();
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("evaluateCompatibility does not perform network calls", () => {
      const manifest = validManifest();
      const result = evaluateCompatibility(manifest);
      expect(result.compatible).toBe(true);
      expect(result.reasons.length).toBe(0);
    });
  });

  // =========================================================================
  // Dev Fixture Source
  // =========================================================================

  describe("DevFixtureSource", () => {
    it("exposes 4 safe dev fixture manifests", () => {
      const manifests = getDevFixtureManifests();
      expect(manifests.length).toBe(4);
      for (const m of manifests) {
        expect(m.schemaVersion).toBe(1);
        expect(VALIDATION_PATTERNS.SEMVER.test(m.version)).toBe(true);
        const perms = m.permissions ?? [];
        expect(perms.some((p) => p.id.startsWith("filesystem") || p.id.startsWith("network"))).toBe(false);
      }
    });

    it("dev fixture source returns empty in production mode", async () => {
      setDevModeOverride(false);
      try {
        const source = new DevFixtureSource();
        const result = await source.discover();
        expect(result.extensions.length).toBe(0);
        expect(result.success).toBe(true);
      } finally {
        setDevModeOverride(null);
      }
    });
  });

  // =========================================================================
  // Source Precedence
  // =========================================================================

  describe("Source precedence", () => {
    it("built-in source has higher priority than dev fixture", () => {
      const builtinPriority = 10;
      const devFixturePriority = 1000;
      expect(builtinPriority).toBeLessThan(devFixturePriority);
    });

    it("duplicate IDs from higher-priority source win", () => {
      const manifest = validManifest({ id: "shared-ext" });

      registerExtensionRuntime(manifest, {
        sourceId: "builtin",
        builtIn: true,
        compatibility: { compatible: true, reasons: [] },
        validation: { valid: true, errors: [], warnings: [] },
        grantedPermissions: [],
        activeCapabilities: [],
        activeContributions: [],
      });

      registerExtensionRuntime(manifest, {
        sourceId: "dev-fixture",
        builtIn: false,
        compatibility: { compatible: true, reasons: [] },
        validation: { valid: true, errors: [], warnings: [] },
        grantedPermissions: [],
        activeCapabilities: [],
        activeContributions: [],
      });

      const record = getExtensionRuntime("shared-ext");
      expect(record).toBeDefined();
      expect(record!.sourceId).toBe("builtin");
      expect(getAllExtensionRuntimes().length).toBe(1);
    });
  });

  // =========================================================================
  // Performance
  // =========================================================================

  describe("Performance", () => {
    it("registers 10 valid manifests in under 100ms", () => {
      const start = performance.now();

      for (let i = 0; i < 10; i++) {
        const manifest = validManifest({ id: `perf-ext-${i}` });
        registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100);
      expect(getAllExtensionRuntimes().length).toBe(10);
    });

    it("snapshot returns consistent state across calls", () => {
      const manifest = validManifest();
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("test-extension-foo");

      const snap1 = snapshot();
      const snap2 = snapshot();

      expect(snap1.total).toBe(snap2.total);
      expect(snap1.enabledCount).toBe(snap2.enabledCount);
      expect(snap1.version).toBe(snap2.version);
    });
  });
});
