/**
 * CriteriaEvaluator — Purely declarative game-to-extension matching.
 *
 * Tests prove that all criteria types resolve correctly against game context:
 * - No criteria / empty detection → always match
 * - files_presence: all files exist → match; missing file → non-match
 * - Unknown criteria type → non-match with diagnostic
 * - Error handling (fs throws, missing installDir)
 * - Batch filterMatchingManifests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionManifestV1 } from "../extensions/types";

// =============================================================================
// Mock: @tauri-apps/api/core (in-memory filesystem)
//
// vi.mock factories are hoisted — use vi.hoisted() to create shared state.
// =============================================================================

const mockState: {
  invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }>;
  fileSystem: Set<string>;
  crashPaths: Set<string> | null;
} = vi.hoisted(() => {
  const invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const fileSystem = new Set<string>();
  let crashPaths: Set<string> | null = null;

  return { invokeCalls, fileSystem, crashPaths };
});

vi.mock("@tauri-apps/api/core", () => {
  const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    mockState.invokeCalls.push({ cmd, args });

    if (cmd === "extension_file_exists") {
      const path = args.path as string;
      if (mockState.crashPaths && mockState.crashPaths.has(path)) {
        throw new Error("Disk error");
      }
      return mockState.fileSystem.has(path);
    }

    throw new Error(`Unexpected invoke: ${cmd}`);
  });

  return { invoke };
});

// =============================================================================
// Module under test
// =============================================================================

import {
  evaluateManifestCriteria,
  filterMatchingManifests,
} from "../extensions/runtime/criteriaEvaluator";
import type { GameContext } from "../extensions/runtime/criteriaEvaluator";

// =============================================================================
// Helpers
// =============================================================================

function makeManifest(
  overrides?: Partial<ExtensionManifestV1>,
): ExtensionManifestV1 {
  return {
    schemaVersion: 1,
    id: "test-tool",
    name: "test-tool",
    displayName: "Test Tool",
    description: "",
    version: "1.0.0",
    managedFiles: [],
    ...overrides,
  };
}

function makeGame(overrides?: Partial<GameContext>): GameContext {
  return { installDir: "C:\\Games\\MyGame", ...overrides };
}

function addFile(fullPath: string): void {
  mockState.fileSystem.add(fullPath);
}

function clearFiles(): void {
  mockState.fileSystem.clear();
}

// =============================================================================
// Tests
// =============================================================================

describe("evaluateManifestCriteria", () => {
  beforeEach(() => {
    mockState.invokeCalls.length = 0;
    clearFiles();
    mockState.crashPaths = null;
  });

  // ── No criteria ────────────────────────────────────────────────────────

  it("returns matched=true when manifest has no criteria", async () => {
    const manifest = makeManifest();
    const result = await evaluateManifestCriteria(manifest, makeGame());
    expect(result).toEqual({ matched: true });
  });

  it("returns matched=true when criteria has no detection", async () => {
    const manifest = makeManifest({ criteria: {} as any });
    const result = await evaluateManifestCriteria(manifest, makeGame());
    expect(result).toEqual({ matched: true });
  });

  // ── Install dir missing ────────────────────────────────────────────────

  it("returns non-match when installDir is missing for files_presence", async () => {
    const manifest = makeManifest({
      criteria: {
        detection: { type: "files_presence", paths: ["foo.dll"] },
      },
    });
    const result = await evaluateManifestCriteria(manifest, makeGame({ installDir: undefined }));
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/no install directory/i);
  });

  // ── files_presence: success ───────────────────────────────────────────

  it("returns matched=true when all files exist", async () => {
    addFile("C:\\Games\\MyGame\\dwmapi.dll");
    addFile("C:\\Games\\MyGame\\xinput1_4.dll");

    const manifest = makeManifest({
      criteria: {
        detection: {
          type: "files_presence",
          paths: ["dwmapi.dll", "xinput1_4.dll"],
        },
      },
    });
    const result = await evaluateManifestCriteria(manifest, makeGame());
    expect(result).toEqual({ matched: true });
  });

  it("invokes extension_file_exists for each path", async () => {
    addFile("C:\\Games\\MyGame\\target.dll");

    const manifest = makeManifest({
      criteria: {
        detection: { type: "files_presence", paths: ["target.dll"] },
      },
    });
    await evaluateManifestCriteria(manifest, makeGame());
    expect(mockState.invokeCalls.length).toBe(1);
    expect(mockState.invokeCalls[0].cmd).toBe("extension_file_exists");
    expect(mockState.invokeCalls[0].args.path).toBe("C:\\Games\\MyGame\\target.dll");
  });

  // ── files_presence: failure ───────────────────────────────────────────

  it("returns non-match with reason when a file is missing", async () => {
    addFile("C:\\Games\\MyGame\\exists.dll");

    const manifest = makeManifest({
      criteria: {
        detection: {
          type: "files_presence",
          paths: ["exists.dll", "missing.dll"],
        },
      },
    });
    const result = await evaluateManifestCriteria(manifest, makeGame());
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/missing.*missing\.dll/i);
  });

  it("returns non-match with reason when file check throws", async () => {
    mockState.crashPaths = new Set(["C:\\Games\\MyGame\\crash.dll"]);
    const manifest = makeManifest({
      criteria: {
        detection: { type: "files_presence", paths: ["crash.dll"] },
      },
    });
    const result = await evaluateManifestCriteria(manifest, makeGame());
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/failed to check/i);
  });

  // ── Unknown criteria type ─────────────────────────────────────────────

  it("returns non-match for unknown detection type", async () => {
    const manifest = makeManifest({
      criteria: {
        detection: { type: "registry_key" as any, paths: [] },
      },
    });
    const result = await evaluateManifestCriteria(manifest, makeGame());
    expect(result.matched).toBe(false);
    expect(result.reason).toMatch(/unknown detection type/i);
  });
});

// =============================================================================
// filterMatchingManifests
// =============================================================================

describe("filterMatchingManifests", () => {
  beforeEach(() => {
    mockState.invokeCalls.length = 0;
    clearFiles();
    mockState.crashPaths = null;
  });

  it("returns empty array for empty input", async () => {
    const result = await filterMatchingManifests([], makeGame());
    expect(result).toEqual([]);
  });

  it("returns only matching manifests", async () => {
    addFile("C:\\Games\\MyGame\\present.dll");

    const manifestNoCriteria = makeManifest({ id: "no-criteria", name: "no-criteria" });
    const manifestMatches = makeManifest({
      id: "matches",
      name: "matches",
      criteria: { detection: { type: "files_presence", paths: ["present.dll"] } },
    });
    const manifestMissing = makeManifest({
      id: "missing",
      name: "missing",
      criteria: { detection: { type: "files_presence", paths: ["absent.dll"] } },
    });

    const result = await filterMatchingManifests(
      [manifestNoCriteria, manifestMatches, manifestMissing],
      makeGame(),
    );
    expect(result).toHaveLength(2);
    const ids = result.map((m) => m.id);
    expect(ids).toContain("no-criteria");
    expect(ids).toContain("matches");
    expect(ids).not.toContain("missing");
  });
});
