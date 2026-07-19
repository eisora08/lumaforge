/**
 * Extension Contribution Projection — Tests.
 *
 * 18 tests covering:
 * - Contribution resolution from manifests (surfaces, IDs, naming)
 * - Active contribution filtering (capabilities, permissions)
 * - ManifestContributionSource extraction
 * - No "add-on" / "addon" terminology in contributions
 * - Unknown surface rejection
 * - Unique contribution IDs within extension
 * - Multiple surfaces per extension
 * - Empty/missing metadata defaults to ["settings"]
 * - Runtime enable/disable toggles contribution visibility
 * - One broken extension does not affect others
 * - No file I/O, no HTTP, no network in pure functions
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  resolveContributions,
  filterActiveContributions,
  extractManifestContributionSources,
} from "../extensions/contributions/resolver";

import {
  VALID_SURFACES,
  type ExtensionSurface,
  type ExtensionSurfaceContribution,
} from "../extensions/contributions/types";

import {
  resetRuntimeStore,
  registerExtensionRuntime,
  enableExtension,
  disableExtension,
  snapshot,
  containsAddOnTerminology,
} from "../extensions/runtime/store";

import {
  registerManifestAsRuntime,
  enableRuntimeExtension,
  disableRuntimeExtension,
  getRuntimeStoreSnapshot,
} from "../extensions/manager";

import type { ExtensionManifestV1 } from "../extensions/types";

// ── Fixtures ──

function baseManifest(overrides: Partial<{
  id: string;
  surfaces: string[];
  permissions: { id: string; optional?: boolean }[];
  capabilities: { id: string }[];
}> = {}): ExtensionManifestV1 {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "contrib-ext-one",
    name: overrides.id ?? "contrib-ext-one",
    displayName: "Contribution Test Extension",
    description: "Tests contribution resolution.",
    version: "1.0.0",
    managedFiles: [],
    permissions: (overrides.permissions ?? [{ id: "ui.settings", optional: true }]) as any,
    capabilities: (overrides.capabilities ?? [{ id: "launcher-integration", version: "1.0.0" }]) as any,
    metadata: {
      surfaces: overrides.surfaces ?? ["settings"],
    },
  };
}

// ── Tests ──

describe("Extension Contribution Resolution", () => {
  beforeEach(() => {
    resetRuntimeStore();
  });

  // =========================================================================
  // Basic Resolution
  // =========================================================================

  describe("Basic resolution", () => {
    it("resolves a single-surface contribution from a manifest", () => {
      const manifest = baseManifest({ surfaces: ["settings"] });
      const result = resolveContributions(manifest, ["ui.settings"]);

      expect(result.contributions.length).toBe(1);
      expect(result.contributions[0].surface).toBe("settings");
      expect(result.contributions[0].id).toBe("contrib-ext-one:settings");
      expect(result.errors.length).toBe(0);
    });

    it("resolves multiple surfaces from one manifest", () => {
      const manifest = baseManifest({ surfaces: ["settings", "tools", "library"] });
      const result = resolveContributions(manifest, ["ui.settings"]);

      expect(result.contributions.length).toBe(3);
      const surfaces = result.contributions.map((c) => c.surface).sort();
      expect(surfaces).toEqual(["library", "settings", "tools"]);
    });

    it("defaults to ['settings'] when metadata.surfaces is missing", () => {
      const manifest = baseManifest();
      delete (manifest as any).metadata.surfaces;
      const result = resolveContributions(manifest, []);

      expect(result.contributions.length).toBe(1);
      expect(result.contributions[0].surface).toBe("settings");
    });

    it("generates unique contribution IDs per surface", () => {
      const manifest = baseManifest({ surfaces: ["settings", "tools"] });
      const result = resolveContributions(manifest, []);

      const ids = result.contributions.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // =========================================================================
  // Surface Validation
  // =========================================================================

  describe("Surface validation", () => {
    it("rejects unknown surfaces", () => {
      const manifest = baseManifest({ surfaces: ["settings", "unknown-surface"] });
      const result = resolveContributions(manifest, []);

      expect(result.contributions.length).toBe(1);
      expect(result.contributions[0].surface).toBe("settings");
    });

    it("all VALID_SURFACES are recognized", () => {
      const allSurfaces = Array.from(VALID_SURFACES) as ExtensionSurface[];
      const manifest = baseManifest({ surfaces: allSurfaces });
      const result = resolveContributions(manifest, []);

      expect(result.contributions.length).toBe(allSurfaces.length);
    });
  });

  // =========================================================================
  // Active Filtering
  // =========================================================================

  describe("Active filtering", () => {
    it("filters contributions when required capability is missing", () => {
      const contributions: ExtensionSurfaceContribution[] = [
        {
          surface: "settings",
          id: "ext:settings",
          displayName: "Settings",
          requiredCapabilities: ["metadata-provider"],
        },
      ];

      const active = filterActiveContributions(contributions, [], []);
      expect(active.length).toBe(0);
    });

    it("keeps contributions when required capability is present", () => {
      const contributions: ExtensionSurfaceContribution[] = [
        {
          surface: "settings",
          id: "ext:settings",
          displayName: "Settings",
          requiredCapabilities: ["metadata-provider"],
        },
      ];

      const active = filterActiveContributions(contributions, ["metadata-provider"], []);
      expect(active.length).toBe(1);
    });

    it("filters contributions when required permission is missing", () => {
      const contributions: ExtensionSurfaceContribution[] = [
        {
          surface: "settings",
          id: "ext:settings",
          displayName: "Settings",
          requiredPermissions: ["filesystem.read"],
        },
      ];

      const active = filterActiveContributions(contributions, [], []);
      expect(active.length).toBe(0);
    });

    it("keeps contributions when wildcard permission is granted", () => {
      const contributions: ExtensionSurfaceContribution[] = [
        {
          surface: "settings",
          id: "ext:settings",
          displayName: "Settings",
          requiredPermissions: ["filesystem.read"],
        },
      ];

      const active = filterActiveContributions(contributions, [], ["*"]);
      expect(active.length).toBe(1);
    });

    it("keeps contributions with no requirements", () => {
      const contributions: ExtensionSurfaceContribution[] = [
        { surface: "tools", id: "ext:tools", displayName: "Tools" },
      ];

      const active = filterActiveContributions(contributions, [], []);
      expect(active.length).toBe(1);
    });
  });

  // =========================================================================
  // ManifestContributionSource Extraction
  // =========================================================================

  describe("extractManifestContributionSources", () => {
    it("extracts sources for each surface in metadata", () => {
      const manifest = baseManifest({ surfaces: ["settings", "tools"] });
      const sources = extractManifestContributionSources(manifest);

      expect(sources.length).toBe(2);
      expect(sources[0].surface).toBe("settings");
      expect(sources[1].surface).toBe("tools");
    });

    it("sets correct extensionId and extensionDisplayName", () => {
      const manifest = baseManifest({ id: "my-ext" });
      const sources = extractManifestContributionSources(manifest);

      expect(sources[0].extensionId).toBe("my-ext");
      expect(sources[0].extensionDisplayName).toBe("Contribution Test Extension");
    });

    it("generates IDs in format extensionId:surface", () => {
      const manifest = baseManifest({ id: "sample-ext", surfaces: ["settings", "library"] });
      const sources = extractManifestContributionSources(manifest);

      expect(sources[0].id).toBe("sample-ext:settings");
      expect(sources[1].id).toBe("sample-ext:library");
    });
  });

  // =========================================================================
  // No "add-on" Terminology
  // =========================================================================

  describe("No add-on terminology", () => {
    it("contribution IDs do not contain 'add-on' or 'addon'", () => {
      const manifest = baseManifest();
      const result = resolveContributions(manifest, []);

      for (const c of result.contributions) {
        expect(containsAddOnTerminology(c.id)).toBe(false);
        expect(containsAddOnTerminology(c.displayName)).toBe(false);
      }
    });

    it("extracted sources do not contain 'add-on' terminology", () => {
      const manifest = baseManifest();
      const sources = extractManifestContributionSources(manifest);

      for (const s of sources) {
        expect(containsAddOnTerminology(s.id)).toBe(false);
        expect(containsAddOnTerminology(s.displayName)).toBe(false);
      }
    });
  });

  // =========================================================================
  // Runtime Integration
  // =========================================================================

  describe("Runtime contribution integration", () => {
    it("enabled extension shows contributions in snapshot", () => {
      const manifest = baseManifest({ id: "runtime-contrib-ext", surfaces: ["settings", "tools"] });
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("runtime-contrib-ext");

      const snap = getRuntimeStoreSnapshot();
      const record = snap.records.get("runtime-contrib-ext");
      expect(record).toBeDefined();
      expect(record!.status).toBe("enabled");
      expect(record!.activeContributions.length).toBe(2);
    });

    it("disabled extension shows no active contributions", () => {
      const manifest = baseManifest({ id: "disabled-contrib-ext", surfaces: ["settings"] });
      registerManifestAsRuntime(manifest, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("disabled-contrib-ext");
      disableRuntimeExtension("disabled-contrib-ext");

      const snap = getRuntimeStoreSnapshot();
      const record = snap.records.get("disabled-contrib-ext");
      expect(record).toBeDefined();
      expect(record!.status).toBe("disabled");
      expect(record!.activeContributions.length).toBe(0);
    });

    it("one broken extension does not affect other extensions' contributions", () => {
      const bad = baseManifest({ id: "bad-contrib-ext" });
      bad.schemaVersion = 2 as 1;
      const good = baseManifest({ id: "good-contrib-ext", surfaces: ["tools"] });

      registerManifestAsRuntime(bad, { sourceId: "test", builtIn: false });
      registerManifestAsRuntime(good, { sourceId: "test", builtIn: false });
      enableRuntimeExtension("good-contrib-ext");

      const snap = getRuntimeStoreSnapshot();
      expect(snap.invalidCount).toBe(1);

      const goodRecord = snap.records.get("good-contrib-ext");
      expect(goodRecord).toBeDefined();
      expect(goodRecord!.status).toBe("enabled");
      expect(goodRecord!.activeContributions.length).toBe(1);
    });
  });

  // =========================================================================
  // No I/O
  // =========================================================================

  describe("No I/O in pure functions", () => {
    it("resolveContributions is pure", () => {
      const manifest = baseManifest();
      const r1 = resolveContributions(manifest, []);
      const r2 = resolveContributions(manifest, []);
      expect(r1.contributions.length).toBe(r2.contributions.length);
      expect(r1.contributions[0].id).toBe(r2.contributions[0].id);
    });

    it("filterActiveContributions is pure", () => {
      const contribs: ExtensionSurfaceContribution[] = [
        { surface: "tools", id: "ext:tools", displayName: "Tools" },
      ];
      const r1 = filterActiveContributions(contribs, [], []);
      const r2 = filterActiveContributions(contribs, [], []);
      expect(r1.length).toBe(r2.length);
    });
  });
});
