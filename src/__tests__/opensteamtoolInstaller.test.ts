import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @tauri-apps/api/core (same infrastructure as toggle tests) ──

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
    if (cmd === "extension_create_dir") {
      const p = args.path as string;
      if (fileSystem.has(p)) return false;
      fileSystem.set(p, "dir");
      return true;
    }
    if (cmd === "extension_remove_file") {
      const p = args.path as string;
      if (!fileSystem.has(p)) return false;
      const type = fileSystem.get(p)!;
      fileSystem.delete(p);
      if (type === "dir") {
        const prefix = p + "\\";
        const childKeys = [...fileSystem.keys()].filter((k) => k.startsWith(prefix));
        for (const childKey of childKeys) {
          fileSystem.delete(childKey);
        }
      }
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
    return null;
  },
}));

// ── Mock external dependencies (detector, github) ──
// Default: extension NOT installed (so install() runs its full pipeline)

const { mockDetect } = vi.hoisted(() => ({
  mockDetect: vi.fn(async (_steamRoot: string): Promise<{
    status: "enabled" | "disabled" | "error";
    installedFiles: string[];
    missingFiles: string[];
  }> => ({
    status: "disabled",
    installedFiles: [],
    missingFiles: ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"],
  })),
}));

vi.mock("../extensions/builtin/opensteamtool/detector", () => ({
  detect: mockDetect,
}));

vi.mock("../extensions/builtin/opensteamtool/github", () => ({
  fetchLatestRelease: vi.fn(async () => ({
    tagName: "v1.0.0-test",
    assets: [],
  })),
  findManagedAssets: vi.fn((_release: unknown, _config: unknown) => [
    { fileName: "dwmapi.dll", downloadUrl: "https://example.com/dwmapi.dll" },
    { fileName: "xinput1_4.dll", downloadUrl: "https://example.com/xinput1_4.dll" },
    { fileName: "OpenSteamTool.dll", downloadUrl: "https://example.com/OpenSteamTool.dll" },
  ]),
}));

import { install } from "../extensions/builtin/opensteamtool/installer";
import { uninstall, disable, enable } from "../extensions/builtin/opensteamtool/toggle";

const STEAM_ROOT = "C:\\Steam";

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
  // Reset detect to default: not installed
  mockDetect.mockResolvedValue({
    status: "disabled" as const,
    installedFiles: [],
    missingFiles: ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"],
  });
});

/**
 * Regression test: the exact destructive sequence reported by the user.
 *
 * 1. Install with real Lua scripts → config/lua has user data
 * 2. Uninstall → config/lua renamed to config/lua.bak (backup preserved)
 * 3. Reinstall → ensure-lua-directory should RESTORE .bak, not create empty
 * 4. Uninstall → should backup the restored scripts, not overwrite with empty
 *
 * Before the fix, step 3 created an empty config/lua, and step 4 overwrote
 * the real backup with the empty dir — permanent data loss.
 */
describe("CRITICAL: Lua folder data-loss regression", () => {
  it("install → uninstall → reinstall → uninstall preserves original scripts", async () => {
    // ── Step 1: Simulate extension installed with real Lua scripts ──
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\my-mod.lua`);
    setFile(`${STEAM_ROOT}\\config\\lua\\my-mod-config.json`);

    // detect says all DLLs installed (early return from install)
    mockDetect.mockResolvedValue({
      status: "enabled" as const,
      installedFiles: ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"],
      missingFiles: [],
    });

    // ── Step 2: Uninstall (backs up Lua) ──
    const uninstallResult1 = await uninstall({ steamRoot: STEAM_ROOT });
    expect(uninstallResult1.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\my-mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\my-mod-config.json`)).toBe(true);

    // ── Step 3: Reinstall (should restore .bak, NOT create empty) ──
    // DLLs are now .bak → detect says not installed → full install pipeline runs
    mockDetect.mockResolvedValue({
      status: "disabled" as const,
      installedFiles: [],
      missingFiles: ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"],
    });

    const installResult = await install({
      steamRoot: STEAM_ROOT,
      releaseProviderConfig: { owner: "test", repo: "test" },
    });
    expect(installResult.success).toBe(true);

    // CRITICAL: The user's scripts should still be in config/lua
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\my-mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\my-mod-config.json`)).toBe(true);
    // The .bak should be gone (restored to lua)
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);

    // ── Step 4: Second uninstall ──
    const uninstallResult2 = await uninstall({ steamRoot: STEAM_ROOT });
    expect(uninstallResult2.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    // CRITICAL: Original scripts should survive in the backup
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\my-mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\my-mod-config.json`)).toBe(true);
  });

  it("install on fresh system creates empty lua directory", async () => {
    const installResult = await install({
      steamRoot: STEAM_ROOT,
      releaseProviderConfig: { owner: "test", repo: "test" },
    });
    expect(installResult.success).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak`)).toBe(false);
  });

  it("install when lua already active skips lua step", async () => {
    // DLLs already present + lua already active
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\existing.lua`);

    // detect reports already installed → install returns early
    mockDetect.mockResolvedValue({
      status: "enabled" as const,
      installedFiles: ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"],
      missingFiles: [],
    });

    const installResult = await install({
      steamRoot: STEAM_ROOT,
      releaseProviderConfig: { owner: "test", repo: "test" },
    });
    expect(installResult.success).toBe(true);
    // Existing scripts untouched
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\existing.lua`)).toBe(true);
  });
});

describe("defense-in-depth: both lua and lua.bak coexist", () => {
  it("disable fails when both lua and lua.bak exist", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\mod.lua`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\old-mod.lua`);

    const result = await disable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(false);
    expect(result.error).toContain("both config/lua and config/lua.bak exist");
    // Nothing should have changed
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\old-mod.lua`)).toBe(true);
  });

  it("enable skips Lua rename when both already exist (lua is active)", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll.bak`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll.bak`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll.bak`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\active-mod.lua`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\stale.lua`);

    const result = await enable({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    // DLLs restored
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\dwmapi.dll.bak`)).toBe(false);
    // Active lua untouched (stale backup ignored)
    expect(hasFile(`${STEAM_ROOT}\\config\\lua\\active-mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\stale.lua`)).toBe(true);
  });

  it("uninstall with both existing: removes stale .bak, backs up active lua", async () => {
    setFile(`${STEAM_ROOT}\\dwmapi.dll`);
    setFile(`${STEAM_ROOT}\\xinput1_4.dll`);
    setFile(`${STEAM_ROOT}\\OpenSteamTool.dll`);
    setFile(`${STEAM_ROOT}\\config\\lua`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua\\current-mod.lua`);
    setFile(`${STEAM_ROOT}\\config\\lua.bak`, "dir");
    setFile(`${STEAM_ROOT}\\config\\lua.bak\\stale-backup.lua`);

    const result = await uninstall({ steamRoot: STEAM_ROOT });

    expect(result.success).toBe(true);
    // Active lua backed up (stale .bak was removed first)
    expect(hasFile(`${STEAM_ROOT}\\config\\lua`)).toBe(false);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\current-mod.lua`)).toBe(true);
    expect(hasFile(`${STEAM_ROOT}\\config\\lua.bak\\stale-backup.lua`)).toBe(false);
  });
});
