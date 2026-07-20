/**
 * ToolManager + CriteriaEvaluator — Integration test.
 *
 * Proves that getApplicableTools() applies manifest criteria filtering
 * when tools have registered extensions with criteria blocks.
 * Tools without registered extensions always pass (backward compat).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionManifestV1 } from "../extensions/types";
import type { Tool, ToolDetectionResult, ToolApplyResult } from "../extensions/tools/types";

// =============================================================================
// Mocks
// =============================================================================

// Mock Tauri invoke for extension_file_exists
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "extension_file_exists") {
      // Simulate: "present.dll" exists, everything else is missing
      return (args.path as string).includes("present.dll");
    }
    throw new Error(`Unexpected invoke: ${cmd}`);
  },
}));

// Mock the extension manager module so we can control getRegisteredExtension
const mockGetRegisteredExtension = vi.fn();
vi.mock("../extensions/manager/index", () => ({
  getRegisteredExtension: (...args: unknown[]) => mockGetRegisteredExtension(...args),
  getExtensionsBySurface: vi.fn(() => []),
  subscribeExtensionManager: vi.fn(),
  getRegisteredExtensionCount: vi.fn(() => 0),
}));

// Mock localStorage for ToolManager persistence
const localStorageStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageStore.set(key, value); }),
  removeItem: vi.fn((key: string) => { localStorageStore.delete(key); }),
  clear: vi.fn(() => { localStorageStore.clear(); }),
  get length() { return localStorageStore.size; },
  key: vi.fn((_i: number) => null),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// =============================================================================
// Module under test
// =============================================================================

import {
  initToolManager,
  registerToolForTest as registerTool,
  resetToolManagerForTest,
  getApplicableTools,
} from "../extensions/tools/ToolManager";
import type { GameContext } from "../extensions/runtime/criteriaEvaluator";

// =============================================================================
// Helpers
// =============================================================================

function makeTool(id: string, overrides?: Partial<Tool>): Tool {
  return {
    id,
    displayName: `Tool ${id}`,
    description: `Test tool ${id}`,
    extensionId: id,
    category: "utility",
    icon: "wrench",
    priority: 50,
    detect: vi.fn(async (): Promise<ToolDetectionResult> => ({
      applied: false,
      fileStatus: {},
    })),
    apply: vi.fn(async (): Promise<ToolApplyResult> => ({
      success: true,
      affectedFiles: [],
    })),
    revert: vi.fn(async (): Promise<ToolApplyResult> => ({
      success: true,
      affectedFiles: [],
    })),
    ...overrides,
  };
}

function makeManifest(
  id: string,
  overrides?: Partial<ExtensionManifestV1>,
): ExtensionManifestV1 {
  return {
    schemaVersion: 1,
    id,
    name: id,
    displayName: `Test ${id}`,
    description: "",
    version: "1.0.0",
    managedFiles: [],
    ...overrides,
  };
}

function installDirGame(): GameContext {
  return { installDir: "C:\\Games\\Cuphead" };
}

// =============================================================================
// Tests
// =============================================================================

describe("getApplicableTools with criteria", () => {
  beforeEach(() => {
    resetToolManagerForTest();
    vi.clearAllMocks();
    localStorageStore.clear();
    initToolManager();
  });

  it("passes tools without registered extension (backward compat)", async () => {
    const tool = makeTool("unregistered-tool");
    registerTool(tool);

    const result = await getApplicableTools(installDirGame());

    expect(result.size).toBe(1);
    expect(result.has("unregistered-tool")).toBe(true);
    // getRegisteredExtension should have been called but returned undefined
    expect(mockGetRegisteredExtension).toHaveBeenCalledWith("unregistered-tool");
  });

  it("includes tool when manifest criteria match", async () => {
    registerTool(makeTool("criteria-match-tool"));

    mockGetRegisteredExtension.mockReturnValue({
      manifest: makeManifest("criteria-match-tool", {
        criteria: {
          detection: { type: "files_presence", paths: ["present.dll"] },
        },
      }),
      state: "registered" as const,
    });

    const result = await getApplicableTools(installDirGame());

    expect(result.size).toBe(1);
    expect(result.has("criteria-match-tool")).toBe(true);
  });

  it("excludes tool when manifest criteria do not match", async () => {
    registerTool(makeTool("criteria-no-match-tool"));

    mockGetRegisteredExtension.mockReturnValue({
      manifest: makeManifest("criteria-no-match-tool", {
        criteria: {
          detection: { type: "files_presence", paths: ["missing.dll"] },
        },
      }),
      state: "registered" as const,
    });

    const result = await getApplicableTools(installDirGame());

    expect(result.size).toBe(0);
    expect(result.has("criteria-no-match-tool")).toBe(false);
  });

  it("excludes tool with unknown detection type", async () => {
    registerTool(makeTool("unknown-criteria"));

    mockGetRegisteredExtension.mockReturnValue({
      manifest: makeManifest("unknown-criteria", {
        criteria: {
          detection: { type: "registry_key" as any, paths: [] },
        },
      }),
      state: "registered" as const,
    });

    const result = await getApplicableTools(installDirGame());

    expect(result.size).toBe(0);
  });

  it("handles mixed set of matching and non-matching tools", async () => {
    registerTool(makeTool("tool-no-ext"));
    registerTool(makeTool("tool-matches"));

    mockGetRegisteredExtension.mockImplementation((id: string) => {
      if (id === "tool-matches") {
        return {
          manifest: makeManifest("tool-matches", {
            criteria: {
              detection: { type: "files_presence", paths: ["present.dll"] },
            },
          }),
          state: "registered" as const,
        };
      }
      // tool-no-ext has no registered extension → undefined
      return undefined;
    });

    const result = await getApplicableTools(installDirGame());

    expect(result.size).toBe(2);
    expect(result.has("tool-no-ext")).toBe(true);
    expect(result.has("tool-matches")).toBe(true);
  });

  it("excludes tool with missing installDir in game context", async () => {
    registerTool(makeTool("needs-installdir"));

    mockGetRegisteredExtension.mockReturnValue({
      manifest: makeManifest("needs-installdir", {
        criteria: {
          detection: { type: "files_presence", paths: ["present.dll"] },
        },
      }),
      state: "registered" as const,
    });

    const result = await getApplicableTools({});

    expect(result.size).toBe(0);
  });
});
