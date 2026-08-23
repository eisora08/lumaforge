/**
 * Contract tests for the Tools system.
 *
 * Tests the ToolManager registry, DeclarativeTool construction,
 * and the Tool interface contract. Tauri invoke is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Tauri invoke ──

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Mock localStorage ──

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

// ── Imports ──

import type {
  Tool,
  ToolConfig,
  ToolDetectionResult,
  ToolApplyResult,
  ToolManagedFile,
  ToolGameStatus,
} from "../extensions/tools/types";

import {
  extractToolConfig,
} from "../extensions/tools/DeclarativeTool";

import {
  initToolManager,
  registerToolForTest as registerTool,
  unregisterToolForTest as unregisterTool,
  resetToolManagerForTest,
  getAllTools,
  getTool,
  detectToolsForGame,
  applyTool,
  revertTool,
  subscribeToolManager,
} from "../extensions/tools/ToolManager";

// ── Fixtures ──

function makeToolConfig(overrides: Partial<ToolConfig> = {}): ToolConfig {
  return {
    type: "copy-files",
    description: "Test tool",
    icon: "wrench",
    category: "utility",
    priority: 50,
    files: [
      { source: "test.dll", target: "test.dll", required: true },
    ],
    ...overrides,
  };
}

function makeManagedFile(overrides: Partial<ToolManagedFile> = {}): ToolManagedFile {
  return {
    source: "test.dll",
    target: "test.dll",
    required: true,
    ...overrides,
  };
}

function makeMockTool(id = "test-tool", overrides: Partial<Tool> = {}): Tool {
  return {
    id,
    displayName: `Test Tool ${id}`,
    description: `Test tool ${id} description`,
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
      affectedFiles: ["test.dll"],
    })),
    revert: vi.fn(async (): Promise<ToolApplyResult> => ({
      success: true,
      affectedFiles: ["test.dll"],
    })),
    ...overrides,
  };
}

// ── Tests ──

describe("ToolConfig types", () => {
  it("has valid type values", () => {
    const copyConfig = makeToolConfig({ type: "copy-files" });
    expect(copyConfig.type).toBe("copy-files");

    const renameConfig = makeToolConfig({ type: "rename-proxy" });
    expect(renameConfig.type).toBe("rename-proxy");

    const customConfig = makeToolConfig({ type: "custom" });
    expect(customConfig.type).toBe("custom");
  });

  it("has files with source and target", () => {
    const file = makeManagedFile({ source: "src.dll", target: "dst.dll" });
    expect(file.source).toBe("src.dll");
    expect(file.target).toBe("dst.dll");
    expect(file.required).toBe(true);
  });

  it("supports optional files", () => {
    const file = makeManagedFile({ required: false });
    expect(file.required).toBe(false);
  });

  it("supports originalName for rename-proxy", () => {
    const file = makeManagedFile({
      source: "proxy.dll",
      target: "steam_api.dll",
      originalName: "steam_api.dll",
    });
    expect(file.originalName).toBe("steam_api.dll");
  });
});

describe("extractToolConfig", () => {
  it("extracts toolConfig from manifest metadata", () => {
    const toolConfig = makeToolConfig();
    const manifest = {
      metadata: { toolConfig },
    } as any;

    const result = extractToolConfig(manifest);
    expect(result).toEqual(toolConfig);
  });

  it("returns null when metadata is missing", () => {
    const manifest = {} as any;
    const result = extractToolConfig(manifest);
    expect(result).toBeNull();
  });

  it("returns null when toolConfig is missing from metadata", () => {
    const manifest = { metadata: {} } as any;
    const result = extractToolConfig(manifest);
    expect(result).toBeNull();
  });

  it("returns null for non-object metadata", () => {
    const manifest = { metadata: "string" } as any;
    const result = extractToolConfig(manifest);
    expect(result).toBeNull();
  });
});

describe("ToolManager registry", () => {
  beforeEach(() => {
    resetToolManagerForTest();
    vi.clearAllMocks();
    localStorageStore.clear();
    initToolManager();
  });

  it("starts with zero tools", () => {
    const tools = getAllTools();
    expect(tools).toEqual([]);
  });

  it("registers a tool", () => {
    const tool = makeMockTool("my-tool");
    registerTool(tool);

    const tools = getAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe("my-tool");
  });

  it("registers multiple tools", () => {
    registerTool(makeMockTool("tool-a"));
    registerTool(makeMockTool("tool-b"));
    registerTool(makeMockTool("tool-c"));

    const tools = getAllTools();
    expect(tools).toHaveLength(3);
  });

  it("gets tool by id", () => {
    registerTool(makeMockTool("findme"));
    const tool = getTool("findme");
    expect(tool).toBeDefined();
    expect(tool!.id).toBe("findme");
  });

  it("returns undefined for unknown id", () => {
    const tool = getTool("nonexistent");
    expect(tool).toBeUndefined();
  });

  it("unregisters a tool", () => {
    registerTool(makeMockTool("to-remove"));
    expect(getAllTools()).toHaveLength(1);

    unregisterTool("to-remove");
    expect(getAllTools()).toHaveLength(0);
    expect(getTool("to-remove")).toBeUndefined();
  });

  it("does not duplicate tools with same id", () => {
    registerTool(makeMockTool("same-id"));
    registerTool(makeMockTool("same-id"));
    expect(getAllTools()).toHaveLength(1);
  });

  it("notifies subscribers on register", () => {
    const listener = vi.fn();
    subscribeToolManager(listener);

    registerTool(makeMockTool("notify-test"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on unregister", () => {
    registerTool(makeMockTool("to-unreg"));
    const listener = vi.fn();
    subscribeToolManager(listener);

    unregisterTool("to-unreg");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsub = subscribeToolManager(listener);

    registerTool(makeMockTool("before-unsub"));
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    registerTool(makeMockTool("after-unsub"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("detectToolsForGame", () => {
  beforeEach(() => {
    resetToolManagerForTest();
    vi.clearAllMocks();
    localStorageStore.clear();
    initToolManager();
  });

  it("returns empty map when no tools registered", async () => {
    mockInvoke.mockResolvedValue({});
    const results = await detectToolsForGame("/fake/game/dir");
    expect(results.size).toBe(0);
  });

  it("calls detect on each registered tool", async () => {
    const tool1 = makeMockTool("d1", {
      detect: vi.fn(async () => ({ applied: true, fileStatus: { "test.dll": true } })),
    });
    const tool2 = makeMockTool("d2", {
      detect: vi.fn(async () => ({ applied: false, fileStatus: {} })),
    });

    registerTool(tool1);
    registerTool(tool2);

    const results = await detectToolsForGame("/fake/game");
    expect(results.size).toBe(2);
    expect(results.get("d1")?.applied).toBe(true);
    expect(results.get("d2")?.applied).toBe(false);
    expect(tool1.detect).toHaveBeenCalledWith("/fake/game");
    expect(tool2.detect).toHaveBeenCalledWith("/fake/game");
  });

  it("handles tool detect errors gracefully", async () => {
    const badTool = makeMockTool("bad-detect", {
      detect: vi.fn(async () => { throw new Error("Detect failed"); }),
    });
    registerTool(badTool);

    const results = await detectToolsForGame("/fake/game");
    expect(results.size).toBe(1);
    const result = results.get("bad-detect");
    expect(result?.applied).toBe(false);
    expect(result?.message).toContain("Detect failed");
  });
});

describe("applyTool", () => {
  beforeEach(() => {
    resetToolManagerForTest();
    vi.clearAllMocks();
    localStorageStore.clear();
    initToolManager();
  });

  it("calls tool.apply", async () => {
    const tool = makeMockTool("apply-test", {
      apply: vi.fn(async () => ({ success: true, affectedFiles: ["out.dll"] })),
    });
    registerTool(tool);

    const result = await applyTool("apply-test", "/game/dir", "/ext/dir");

    expect(result.success).toBe(true);
    expect(result.affectedFiles).toEqual(["out.dll"]);
    expect(tool.apply).toHaveBeenCalledWith("/game/dir", "/ext/dir");
  });

  it("returns failure result on failure", async () => {
    const tool = makeMockTool("fail-apply", {
      apply: vi.fn(async () => ({ success: false, error: "Copy failed", affectedFiles: [] })),
    });
    registerTool(tool);

    const result = await applyTool("fail-apply", "/game/dir", "/ext/dir");
    expect(result.success).toBe(false);
  });

  it("returns failure for unknown tool id", async () => {
    const result = await applyTool("nonexistent", "/game", "/ext");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("notifies subscribers", async () => {
    const listener = vi.fn();
    subscribeToolManager(listener);

    const tool = makeMockTool("notify-apply");
    registerTool(tool);

    await applyTool("notify-apply", "/game", "/ext");

    expect(listener).toHaveBeenCalled();
  });
});

describe("revertTool", () => {
  beforeEach(() => {
    resetToolManagerForTest();
    vi.clearAllMocks();
    localStorageStore.clear();
    initToolManager();
  });

  it("calls tool.revert", async () => {
    const tool = makeMockTool("rev-test", {
      revert: vi.fn(async () => ({ success: true, affectedFiles: ["test.dll"] })),
    });
    registerTool(tool);

    const result = await revertTool("rev-test", "/game/dir");
    expect(result.success).toBe(true);
    expect(tool.revert).toHaveBeenCalledWith("/game/dir");
  });

  it("returns failure for unknown tool id", async () => {
    const result = await revertTool("nonexistent", "/game");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("Tool type contracts", () => {
  it("ToolGameStatus covers expected states", () => {
    const states: ToolGameStatus[] = [
      "not-applied", "applied", "partial", "error", "detecting", "applying", "reverting",
    ];
    expect(states).toHaveLength(7);
  });

  it("ToolDetectionResult shape", () => {
    const result: ToolDetectionResult = {
      applied: true,
      fileStatus: { "a.dll": true, "b.dll": false },
      message: "ok",
    };
    expect(result.applied).toBe(true);
    expect(result.fileStatus["a.dll"]).toBe(true);
    expect(result.fileStatus["b.dll"]).toBe(false);
  });

  it("ToolApplyResult shape", () => {
    const result: ToolApplyResult = {
      success: true,
      affectedFiles: ["x.dll"],
      rolledBack: false,
    };
    expect(result.success).toBe(true);
    expect(result.affectedFiles).toContain("x.dll");
  });
});
