import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core before importing anything that uses it
const invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
const fileSystem = new Map<string, "file" | "dir">();
/** Paths that simulate being locked by a running process (Windows "Access is denied"). */
const lockedPaths = new Set<string>();

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
      if (lockedPaths.has(from)) {
        throw new Error(`Rename failed: ${from} -> ${to}: Access is denied. (os error 5)`);
      }
      const type = fileSystem.get(from)!;
      fileSystem.delete(from);
      fileSystem.set(to, type);
      // Move child entries when renaming directories (simulates fs::rename behavior)
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
      if (lockedPaths.has(p)) {
        throw new Error(`Failed to remove file ${p}: Access is denied. (os error 5)`);
      }
      fileSystem.delete(p);
      return true;
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
    if (cmd === "extension_create_dir") {
      const p = args.path as string;
      if (fileSystem.has(p)) return false;
      fileSystem.set(p, "dir");
      return true;
    }
    return null;
  },
}));

import { enable, disable, uninstall } from "../extensions/builtin/opensteamtool/toggle";

const STEAM_ROOT = "C:\\Steam";

function setFile(path: string, type: "file" | "dir" = "file") {
  fileSystem.set(path, type);
}

function hasFile(path: string) {
  return fileSystem.has(path);
}

function lockFile(path: string) {
  lockedPaths.add(path);
}

function unlockAll() {
  lockedPaths.clear();
}

function clearAll() {
  fileSystem.clear();
  invokeCalls.length = 0;
  lockedPaths.clear();
}

beforeEach(() => {
  clearAll();
});

// ── DLL-only operations (no Lua folder) ──

describe("disable - DLLs only", () => {
  it("renames .dll to .bak when extension is enabled", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);

    const result = await disable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
  });

  it("returns success when already disabled (all DLLs are .bak, no Lua)", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);

    const result = await disable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(invokeCalls.filter((c) => c.cmd === "extension_batch_rename")).toHaveLength(0);
  });

  it("returns success when no files exist at all", async () => {
    const result = await disable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
  });
});

describe("enable - DLLs only", () => {
  it("renames .bak to .dll when extension is disabled", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);

    const result = await enable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\xinput1_4.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\OpenSteamTool.dll`)).toBe(true);
  });

  it("returns success when already enabled (all DLLs are active, no Lua)", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);

    const result = await enable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(invokeCalls.filter((c) => c.cmd === "extension_batch_rename")).toHaveLength(0);
  });

  it("returns success when no files exist at all", async () => {
    const result = await enable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
  });
});

describe("uninstall - DLLs only", () => {
  it("removes all .dll and .bak files", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);

    const result = await uninstall({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`)).toBe(false);
  });

  it("returns success when nothing exists", async () => {
    const result = await uninstall({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
  });
});

// ── Lua folder operations ──

describe("disable - Lua folder rename", () => {
  it("renames config/lua to config/lua.bak when disabling", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\test.lua`);

    const result = await disable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\test.lua`)).toBe(true);
  });

  it("skips Lua folder when config/lua does not exist", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);

    const result = await disable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });
});

describe("enable - Lua folder restore", () => {
  it("renames config/lua.bak to config/lua when enabling", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\test.lua`);

    const result = await enable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\test.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });

  it("skips Lua folder when config/lua.bak does not exist", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);

    const result = await enable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
  });
});

describe("uninstall - Lua folder", () => {
  it("renames config/lua to config/lua.bak when uninstalling with active extension", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");

    const result = await uninstall({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);
  });

  it("does not error when Lua folder is already .bak (disabled state)", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");

    const result = await uninstall({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    // .bak folder should stay as-is (no active lua folder to rename)
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);
  });
});

// ── Full cycle tests ──

describe("full toggle cycle", () => {
  it("disable → enable restores both DLLs and Lua folder", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\test.lua`);

    const disableResult = await disable({ steamRoot: STEAM_ROOT });
    expect(disableResult.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\test.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);

    const enableResult = await enable({ steamRoot: STEAM_ROOT });
    expect(enableResult.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\test.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });

  it("disable → uninstall hides Lua but does not restore it", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\script.lua`);

    await disable({ steamRoot: STEAM_ROOT });
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);

    const result = await uninstall({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);
  });

  it("enable without Lua backup still succeeds", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);

    const result = await enable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
  });
});

// ── Per-path idempotency (Fix 2) ──

describe("disable idempotency - per-path", () => {
  it("skip: already disabled (DLLs .bak, no Lua)", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);

    const result = await disable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(invokeCalls.filter((c) => c.cmd === "extension_batch_rename")).toHaveLength(0);
  });

  it("skip: Lua already .bak but DLLs active → only renames DLLs", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");

    const result = await disable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    // DLLs renamed to .bak
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
    // Lua already .bak, untouched
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
  });

  it("skip: DLLs already .bak but Lua active → only renames Lua", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\game.lua`);

    const result = await disable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    // DLLs already .bak, untouched
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
    // Lua renamed to .bak
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\game.lua`)).toBe(true);
  });

  it("fully active → disables all paths", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");

    const result = await disable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
  });
});

describe("enable idempotency - per-path", () => {
  it("skip: already enabled (DLLs active, no Lua .bak)", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);

    const result = await enable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(invokeCalls.filter((c) => c.cmd === "extension_batch_rename")).toHaveLength(0);
  });

  it("skip: Lua .bak exists but DLLs active → only restores Lua", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\script.lua`);

    const result = await enable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    // DLLs already active, untouched
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(false);
    // Lua restored from .bak
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\script.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });

  it("skip: DLLs .bak but Lua active → only restores DLLs", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\mod.lua`);

    const result = await enable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    // DLLs restored
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(false);
    // Lua already active, untouched
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });

  it("fully disabled → enables all paths", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\mod.lua`);

    const result = await enable({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });
});

describe("uninstall idempotency - from any state", () => {
  it("from enabled state: removes DLLs, hides Lua as .bak", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\script.lua`);

    const result = await uninstall({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\OpenSteamTool.dll`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\script.lua`)).toBe(true);
  });

  it("from disabled state: removes .bak DLLs, keeps Lua .bak", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\mod.lua`);

    const result = await uninstall({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`)).toBe(false);
    // Lua .bak stays — nothing to rename
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\mod.lua`)).toBe(true);
  });

  it("from clean state: no-op, no error", async () => {
    const result = await uninstall({ steamRoot: STEAM_ROOT });
    expect(result.success).toBe(true);
  });
});

// ── File-locked error handling ──

describe("file-locked errors", () => {
  it("disable returns fileLocked when a DLL is locked by a running process", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    lockFile(`${STEAM_ROOT}\\dwmapi.dll`);

    const result = await disable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(false);
    expect(result.fileLocked).toBe(true);
    expect(result.error).toContain("Access is denied");
    // Rollback should restore the files that were already renamed before the lock
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
  });

  it("enable returns fileLocked when a .bak DLL is locked", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    lockFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);

    const result = await enable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(false);
    expect(result.fileLocked).toBe(true);
  });

  it("uninstall returns fileLocked when a DLL is locked", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    lockFile(`${STEAM_ROOT}\\xinput1_4.dll`);

    const result = await uninstall({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(false);
    expect(result.fileLocked).toBe(true);
  });

  it("disable succeeds after lock is released (retry scenario)", async () => {
    // Phase 1: files exist but DLL is locked → fileLocked result
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    lockFile(`${STEAM_ROOT}\\dwmapi.dll`);

    const firstResult = await disable({ steamRoot: STEAM_ROOT });
    expect(firstResult.success).toBe(false);
    expect(firstResult.fileLocked).toBe(true);

    // Phase 2: lock released → retry succeeds
    unlockAll();

    const secondResult = await disable({ steamRoot: STEAM_ROOT });
    expect(secondResult.success).toBe(true);
    expect(secondResult.fileLocked).toBeUndefined();
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(false);
  });

  it("renameFile and removeFile throw FileLockedError on Access is denied", async () => {
    const { renameFile, removeFile } = await import("../extensions/services/transactionManager");

    setFile(`${STEAM_ROOT}\\test.dll`);
    lockFile(`${STEAM_ROOT}\\test.dll`);

    await expect(renameFile(`${STEAM_ROOT}\\test.dll`, `${STEAM_ROOT}\\test.dll.bak`))
      .rejects.toThrow("Access is denied");

    await expect(removeFile(`${STEAM_ROOT}\\test.dll`))
      .rejects.toThrow("Access is denied");
  });
});

describe("isFileLockedError utility", () => {
  it("returns true for FileLockedError instances", async () => {
    const { FileLockedError, isFileLockedError } = await import("../extensions/services/transactionManager");
    const err = new FileLockedError("Access denied", "/some/path");
    expect(isFileLockedError(err)).toBe(true);
  });

  it("returns false for plain Error instances", async () => {
    const { isFileLockedError } = await import("../extensions/services/transactionManager");
    expect(isFileLockedError(new Error("some error"))).toBe(false);
  });

  it("returns false for non-Error values", async () => {
    const { isFileLockedError } = await import("../extensions/services/transactionManager");
    expect(isFileLockedError("string")).toBe(false);
    expect(isFileLockedError(null)).toBe(false);
    expect(isFileLockedError(undefined)).toBe(false);
  });
});
