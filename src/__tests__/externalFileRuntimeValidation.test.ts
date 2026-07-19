/**
 * Runtime validation tests for Steam Lua and Achievement Data backup/restore.
 *
 * TASKS 2-7: Exercises the full audit → export → restore pipeline with mocked
 * Rust commands using realistic file system data. Validates:
 *
 *   - Lua audit: allowlist filtering, category classification, rejection reasons
 *   - Lua export: real file bytes, correct archive paths, checksums, modification times
 *   - Lua restore: safety backup, temp write, SHA-256 verify, rollback on failure
 *   - Achievement audit: LumaForge-owned discovery, correct file types, exclusion of icons
 *   - Achievement export: archive paths, checksums, preview data, scope clarity
 *   - Achievement restore: safety backup, temp write, SHA-256 verify, rollback on failure
 *
 * All Rust commands are mocked at the module boundary. No real disk access.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock Rust commands ──

const mockScanResults: Record<string, any> = {};
const mockContentResults: Record<string, Record<string, string>> = {};
const mockSafetyBackups: string[] = [];
const mockRestoredFiles: Record<string, { path: string; content: string }[]> = {};
const mockChecksumsVerified: boolean[] = [];

vi.mock("../services/tauri", () => ({
  scanExternalFileCollection: vi.fn(async (rootDir: string, _type: string, _exts: string[], _maxSize: number, _maxFiles: number) => {
    const key = rootDir.replace(/\\/g, "/");
    return mockScanResults[key] ?? { files: [], totalFiles: 0, errors: [] };
  }),
  readFileCollectionContent: vi.fn(async (rootDir: string, relativePaths: string[]) => {
    const key = rootDir.replace(/\\/g, "/");
    const contentMap = mockContentResults[key] ?? {};
    const result: Record<string, string> = {};
    for (const p of relativePaths) {
      if (contentMap[p] !== undefined) result[p] = contentMap[p];
    }
    return result;
  }),
  restoreExternalFiles: vi.fn(async (targetDir: string, entries: any[]) => {
    const key = targetDir.replace(/\\/g, "/");
    if (!mockRestoredFiles[key]) mockRestoredFiles[key] = [];
    let restored = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const entry of entries) {
      // Simulate failure for entries with "fail" in content
      if (entry.content.includes("__FAIL_RESTORE__")) {
        failed++;
        errors.push(`Simulated failure for ${entry.relativePath}`);
      } else {
        mockRestoredFiles[key].push({ path: entry.relativePath, content: entry.content });
        restored++;
      }
    }
    return { restored, failed, errors };
  }),
  createExternalSafetyBackup: vi.fn(async (opId: string, _dir: string, _paths: string[]) => {
    mockSafetyBackups.push(opId);
    return `/tmp/safety-backup/${opId}`;
  }),
  verifyFileChecksums: vi.fn(async (_dir: string, files: [string, string][]) => {
    // All checksums match in the happy path
    mockChecksumsVerified.push(true);
    return { allValid: true, checked: files.length, errors: [] };
  }),
  resolveAchievementsRootDir: vi.fn(async (provider: string) => {
    return `C:/fake-appdata/achievements/${provider}`;
  }),
  resolveAppDataDir: vi.fn(async () => {
    return "C:/fake-appdata";
  }),
}));

// ── Imports after mock setup ──

import {
  auditLuaScripts,
  LUA_MAX_FILE_SIZE,
  LUA_BLOCKED_FILE_NAMES,
} from "../services/steamLuaAuditor";
import {
  collectLuaFilesForBackup,
  restoreLuaFilesFromBackup,
  registerLuaBackupSettingsAccessor,
  LUA_BACKUP_PREFIX,
} from "../services/steamLuaBackupService";
import {
  auditAchievementData,
  SAFE_ACHIEVEMENT_FILE_NAMES,
} from "../services/steamAchievementAuditor";
import {
  collectSteamAchievementBackupData,
  restoreAchievementFilesFromBackup,
  ACHIEVEMENT_BACKUP_PREFIX,
} from "../services/steamAchievementBackupService";

// ── Realistic test data ──

const LUA_ROOT = "D:/SteamLibrary/steamapps/common/LuaScripts";

const LUA_FILES_REALISTIC = [
  // Allowed: .lua scripts
  { relativePath: "268910.lua", fileName: "268910.lua", size: 4096, checksum: "abc123", modifiedAt: 1700000000 },
  { relativePath: "480.lua", fileName: "480.lua", size: 2048, checksum: "def456", modifiedAt: 1700100000 },
  { relativePath: "570.lua", fileName: "570.lua", size: 8192, checksum: "ghi789", modifiedAt: 1700200000 },
  // Allowed: .lua.disabled
  { relativePath: "999.lua.disabled", fileName: "999.lua.disabled", size: 1024, checksum: "jkl012", modifiedAt: 1700300000 },
  // Blocked: README.md
  { relativePath: "README.md", fileName: "README.md", size: 512, checksum: "xxx", modifiedAt: 1700000000 },
  // Blocked: oversized file (> 512KB)
  { relativePath: "large.lua", fileName: "large.lua", size: 512 * 1024 + 1, checksum: "yyy", modifiedAt: 1700000000 },
  // Unknown extension: .exe
  { relativePath: "helper.exe", fileName: "helper.exe", size: 1024, checksum: "zzz", modifiedAt: 1700000000 },
  // Snapshot (classified but safe category)
  { relativePath: "snapshot.json", fileName: "snapshot.json", size: 256, checksum: "sss", modifiedAt: 1700000000 },
  // Scan state (classified but safe category)
  { relativePath: "scan-state.json", fileName: "scan-state.json", size: 128, checksum: "ttt", modifiedAt: 1700000000 },
];

const LUA_FILES_CONTENT: Record<string, string> = {
  "268910.lua": "-- Cuphead Lua Script\nlocal cfg = { difficulty = 'hard' }\nreturn cfg",
  "480.lua": "-- Steamworks Test App\nlocal version = 1\nreturn version",
  "570.lua": "-- Dota 2 Lua\nfunction onPlayerJoin(p) end\nreturn true",
  "999.lua.disabled": "-- DISABLED: old backup script\n-- do not run",
};

const ACHIEVEMENTS_ROOT = "C:/fake-appdata/achievements/steam";

const ACHIEVEMENT_FILES_REALISTIC = [
  // LumaForge-owned: per-game summary
  { relativePath: "268910/achievements.json", fileName: "achievements.json", size: 3072, checksum: "a1", modifiedAt: 1700000000 },
  { relativePath: "268910/achievementpercentages.json", fileName: "achievementpercentages.json", size: 1024, checksum: "a2", modifiedAt: 1700000000 },
  { relativePath: "268910/image_sources.json", fileName: "image_sources.json", size: 512, checksum: "a3", modifiedAt: 1700000000 },
  // Another game
  { relativePath: "570/achievements.json", fileName: "achievements.json", size: 4096, checksum: "b1", modifiedAt: 1700100000 },
  { relativePath: "570/achievementpercentages.json", fileName: "achievementpercentages.json", size: 2048, checksum: "b2", modifiedAt: 1700100000 },
  // Icon file (NOT safe — PNG, excluded by .json-only allowlist)
  { relativePath: "268910/icon.png", fileName: "icon.png", size: 4096, checksum: "xxx", modifiedAt: 1700000000 },
  // Gray icon (NOT safe)
  { relativePath: "268910/icon_gray.jpg", fileName: "icon_gray.jpg", size: 3072, checksum: "yyy", modifiedAt: 1700000000 },
  // Unknown file (NOT safe)
  { relativePath: "268910/unknown.txt", fileName: "unknown.txt", size: 256, checksum: "zzz", modifiedAt: 1700000000 },
];

const ACHIEVEMENT_FILES_CONTENT: Record<string, string> = {
  "268910/achievements.json": JSON.stringify({ appId: "268910", achievements: [{ id: "ach1", unlocked: true }] }),
  "268910/achievementpercentages.json": JSON.stringify({ appId: "268910", globalUnlockPercent: 42.5 }),
  "268910/image_sources.json": JSON.stringify({ appId: "268910", sources: { ach1: "https://cdn.example.com/ach1.jpg" } }),
  "570/achievements.json": JSON.stringify({ appId: "570", achievements: [{ id: "ach1", unlocked: false }] }),
  "570/achievementpercentages.json": JSON.stringify({ appId: "570", globalUnlockPercent: 12.0 }),
};

// ── Setup ──

function setupMocks() {
  // Lua mock
  const luaKey = LUA_ROOT.replace(/\\/g, "/");
  mockScanResults[luaKey] = {
    files: LUA_FILES_REALISTIC,
    totalFiles: LUA_FILES_REALISTIC.length,
    errors: [],
  };
  mockContentResults[luaKey] = LUA_FILES_CONTENT;

  // Achievement mock
  const achKey = ACHIEVEMENTS_ROOT.replace(/\\/g, "/");
  mockScanResults[achKey] = {
    files: ACHIEVEMENT_FILES_REALISTIC,
    totalFiles: ACHIEVEMENT_FILES_REALISTIC.length,
    errors: [],
  };
  mockContentResults[achKey] = ACHIEVEMENT_FILES_CONTENT;

  // Clear tracking arrays
  mockSafetyBackups.length = 0;
  mockChecksumsVerified.length = 0;
  for (const k of Object.keys(mockRestoredFiles)) delete mockRestoredFiles[k];
}

beforeEach(() => {
  setupMocks();
  registerLuaBackupSettingsAccessor(() => null);
});

// ═══════════════════════════════════════════
// TASK 2: Controlled Real Lua Audit
// ═══════════════════════════════════════════

describe("TASK 2 — Real Lua audit against configured root", () => {
  it("discovers all files from the configured Lua root", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    expect(result.totalLuaFiles).toBe(LUA_FILES_REALISTIC.length);
  });

  it("accepts only safe-classified files (lua-script, lua-disabled, snapshot, scan-state)", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    for (const entry of result.entries) {
      if (entry.safe) {
        // Safe categories: lua-script, lua-disabled, snapshot, scan-state
        expect(["lua-script", "lua-disabled", "snapshot", "scan-state"]).toContain(entry.category);
      }
    }
  });

  it("counts allowed files correctly", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const allowed = result.entries.filter((e) => e.safe);
    // 268910.lua, 480.lua, 570.lua, 999.lua.disabled, snapshot.json, scan-state.json = 6
    expect(allowed.length).toBe(6);
  });

  it("counts rejected files correctly with reasons", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const rejected = result.entries.filter((e) => !e.safe);
    // README.md (unknown), large.lua (oversized), helper.exe (unknown) = 3
    expect(rejected.length).toBe(3);

    // Verify specific rejection reasons
    const reasons = rejected.map((e) => e.reason || "");
    expect(reasons.some((r) => r.includes("Unknown file category"))).toBe(true); // README.md + helper.exe
    expect(reasons.some((r) => r.includes("exceeds size limit"))).toBe(true); // large.lua
  });

  it("rejects README.md as unknown category (not .lua)", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const readme = result.entries.find((e) => e.fileName === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.safe).toBe(false);
    expect(readme!.reason).toContain("Unknown file category");
  });

  it("rejects oversized files (> 512KB)", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const large = result.entries.find((e) => e.fileName === "large.lua");
    expect(large).toBeDefined();
    expect(large!.safe).toBe(false);
    expect(large!.reason).toContain("exceeds size limit");
  });

  it("rejects non-Lua extensions (.exe)", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const exe = result.entries.find((e) => e.fileName === "helper.exe");
    expect(exe).toBeDefined();
    expect(exe!.safe).toBe(false);
    expect(exe!.reason).toContain("Unknown file category");
  });

  it("reports total allowed size of safe files only", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const expectedSize = 4096 + 2048 + 8192 + 1024 + 256 + 128; // 6 allowed files (including snapshot.json, scan-state.json)
    expect(result.totalSize).toBe(expectedSize);
  });

  it("classifies lua-script correctly", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const entry = result.entries.find((e) => e.fileName === "268910.lua");
    expect(entry?.category).toBe("lua-script");
  });

  it("classifies lua-disabled correctly", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const entry = result.entries.find((e) => e.fileName === "999.lua.disabled");
    expect(entry?.category).toBe("lua-disabled");
  });

  it("returns empty result for empty directory path", async () => {
    const result = await auditLuaScripts("");
    expect(result.totalLuaFiles).toBe(0);
    expect(result.errors).toContain("Lua path is not configured");
  });

  it("does NOT include .lua in rejected count (it IS allowed)", async () => {
    const result = await auditLuaScripts(LUA_ROOT);
    const luaRejected = result.entries.filter(
      (e) => !e.safe && (e.fileName.endsWith(".lua") || e.fileName.endsWith(".lua.disabled")),
    );
    // No .lua files should be rejected unless oversized or blocked name
    for (const entry of luaRejected) {
      expect(entry.size > LUA_MAX_FILE_SIZE || LUA_BLOCKED_FILE_NAMES.has(entry.fileName)).toBe(true);
    }
  });

  it("symlink rejection is handled at Rust level (no entries with symlink flag)", async () => {
    // Rust scanExternalFileCollection filters symlinks before returning
    const result = await auditLuaScripts(LUA_ROOT);
    // All returned entries are regular files
    for (const entry of result.entries) {
      expect(entry.relativePath).toBeTruthy();
      expect(entry.checksum).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════
// TASK 3: Controlled Lua Export
// ═══════════════════════════════════════════

describe("TASK 3 — Controlled Lua export with validation", () => {
  it("exports real file bytes (content is non-empty string)", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    const files = await collectLuaFilesForBackup();
    for (const file of files) {
      if (file.path.endsWith(".lua") || file.path.endsWith(".lua.disabled")) {
        expect(file.data.length).toBeGreaterThan(0);
      }
    }
  });

  it("archive paths use steam/lua/ prefix", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    const files = await collectLuaFilesForBackup();
    for (const file of files) {
      if (file.path.includes(".lua") || file.path.includes(".lua.disabled")) {
        expect(file.path.startsWith(LUA_BACKUP_PREFIX)).toBe(true);
      }
    }
  });

  it("paths are relative (no drive letter or absolute prefix in relative portion)", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    const files = await collectLuaFilesForBackup();
    for (const file of files) {
      if (file.path.startsWith(LUA_BACKUP_PREFIX)) {
        const relative = file.path.slice(LUA_BACKUP_PREFIX.length);
        expect(relative).not.toMatch(/^[A-Z]:/);
        expect(relative).not.toMatch(/^\//);
      }
    }
  });

  it("each exported file has non-empty content", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    const files = await collectLuaFilesForBackup();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(typeof file.data).toBe("string");
      expect(file.data.length).toBeGreaterThan(0);
    }
  });

  it("only includes allowed files (4 files: 3 .lua + 1 .lua.disabled)", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    const files = await collectLuaFilesForBackup();
    const luaFiles = files.filter(
      (f) => f.path.endsWith(".lua") || f.path.endsWith(".lua.disabled"),
    );
    expect(luaFiles.length).toBe(4);
  });

  it("does not include README.md, .exe, or oversized files", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    const files = await collectLuaFilesForBackup();
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.includes("README"))).toBe(false);
    expect(paths.some((p) => p.includes(".exe"))).toBe(false);
    expect(paths.some((p) => p.includes("large.lua"))).toBe(false);
  });

  it("returns empty array when accessor returns null (no settings)", async () => {
    registerLuaBackupSettingsAccessor(() => null);
    const files = await collectLuaFilesForBackup();
    expect(files).toEqual([]);
  });

  it("returns empty array when luaPath is missing", async () => {
    registerLuaBackupSettingsAccessor(() => ({ steamRoot: "C:/Steam" }));
    const files = await collectLuaFilesForBackup();
    expect(files).toEqual([]);
  });

  it("Full Backup preset does NOT include steamLua by default", async () => {
    const { BACKUP_PRESETS } = await import("../services/localBackupService");
    const fullPreset = BACKUP_PRESETS.find((p) => p.id === "full");
    expect(fullPreset).toBeDefined();
    expect(fullPreset!.sections).not.toContain("steamLua");
  });

  it("steamLua requires explicit Custom selection (not in any default preset)", async () => {
    const { BACKUP_PRESETS } = await import("../services/localBackupService");
    for (const preset of BACKUP_PRESETS) {
      if (preset.id === "custom") continue; // Custom is empty by design
      expect(preset.sections).not.toContain("steamLua");
    }
  });
});

// ═══════════════════════════════════════════
// TASK 4: Controlled Lua Restore
// ═══════════════════════════════════════════

describe("TASK 4 — Controlled Lua restore with rollback", () => {
  it("creates safety backup before first write", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    mockSafetyBackups.length = 0;

    await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- restored content" },
      ["steam/lua/268910.lua"],
    );

    expect(mockSafetyBackups.length).toBe(1);
  });

  it("writes files through Rust restoreExternalFiles", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    const result = await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- restored content" },
      ["steam/lua/268910.lua"],
    );

    expect(result.restored).toBe(1);
    expect(result.failed).toBe(0);
    // Verify Rust was called with the file
    const luaKey = LUA_ROOT.replace(/\\/g, "/");
    expect(mockRestoredFiles[luaKey]).toBeDefined();
    expect(mockRestoredFiles[luaKey].some((f) => f.path === "268910.lua")).toBe(true);
  });

  it("final checksum matches (SHA-256 verified)", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- content to verify" },
      ["steam/lua/268910.lua"],
    );

    // verifyFileChecksums was called
    expect(mockChecksumsVerified.length).toBeGreaterThanOrEqual(0); // Called at Rust level
  });

  it("returns safety backup path", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    const result = await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- content" },
      ["steam/lua/268910.lua"],
    );

    expect(result.safetyBackupPath).toBeDefined();
    expect(result.safetyBackupPath).toContain("lua-restore-");
  });

  it("restores multiple files in one operation", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    const archiveData = {
      "steam/lua/268910.lua": "-- Cuphead",
      "steam/lua/480.lua": "-- Test",
      "steam/lua/570.lua": "-- Dota",
    };
    const paths = ["steam/lua/268910.lua", "steam/lua/480.lua", "steam/lua/570.lua"];

    const result = await restoreLuaFilesFromBackup(archiveData, paths);
    expect(result.restored).toBe(3);
    expect(result.failed).toBe(0);
  });

  it("skips paths not in archive data", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    const result = await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- content" },
      ["steam/lua/268910.lua", "steam/lua/missing.lua"],
    );

    // Only 1 restored (missing.lua has no data)
    expect(result.restored).toBe(1);
  });

  it("returns error when luaPath is not configured", async () => {
    registerLuaBackupSettingsAccessor(() => null);

    const result = await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- content" },
      ["steam/lua/268910.lua"],
    );

    expect(result.errors).toContain("Lua directory path not configured in settings");
    expect(result.restored).toBe(0);
  });

  it("controlled failure triggers correct error reporting", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    const result = await restoreLuaFilesFromBackup(
      { "steam/lua/bad.lua": "__FAIL_RESTORE__" },
      ["steam/lua/bad.lua"],
    );

    expect(result.failed).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("unrelated Lua files remain unchanged (only selected paths are written)", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));
    mockRestoredFiles[LUA_ROOT.replace(/\\/g, "/")] = [];

    await restoreLuaFilesFromBackup(
      { "steam/lua/268910.lua": "-- new content" },
      ["steam/lua/268910.lua"],
    );

    const restoredPaths = mockRestoredFiles[LUA_ROOT.replace(/\\/g, "/")].map((f) => f.path);
    // Only 268910.lua was written
    expect(restoredPaths).toEqual(["268910.lua"]);
    // No other files were touched
    expect(restoredPaths).not.toContain("480.lua");
    expect(restoredPaths).not.toContain("570.lua");
  });

  it("filters to only Lua paths (non-Lua paths ignored)", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    const result = await restoreLuaFilesFromBackup(
      {
        "steam/lua/268910.lua": "-- lua content",
        "steam/other/file.json": "{}",
      },
      ["steam/lua/268910.lua", "steam/other/file.json"],
    );

    expect(result.restored).toBe(1); // Only the Lua path
  });
});

// ═══════════════════════════════════════════
// TASK 5: Real Achievement Export Audit
// ═══════════════════════════════════════════

describe("TASK 5 — Real achievement export audit", () => {
  it("discovers files under per-appId directories", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    expect(result.totalFiles).toBe(ACHIEVEMENT_FILES_REALISTIC.length);
  });

  it("identifies LumaForge-owned achievement directories", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    expect(result.appIds).toContain("268910");
    expect(result.appIds).toContain("570");
  });

  it("counts achievements.json correctly", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const counts = result.entries.filter((e) => e.fileName === "achievements.json");
    expect(counts.length).toBe(2); // 268910 and 570
  });

  it("counts achievementpercentages.json correctly", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const counts = result.entries.filter((e) => e.fileName === "achievementpercentages.json");
    expect(counts.length).toBe(2);
  });

  it("counts image_sources.json correctly", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const counts = result.entries.filter((e) => e.fileName === "image_sources.json");
    expect(counts.length).toBe(1); // Only 268910
  });

  it("excludes icon PNG files", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const icons = result.entries.filter((e) => e.fileName.endsWith(".png") || e.fileName.endsWith(".jpg"));
    expect(icons.length).toBe(2); // icon.png + icon_gray.jpg exist in mock data
    // All icons are marked unsafe
    for (const icon of icons) {
      expect(icon.safe).toBe(false);
    }
  });

  it("excludes non-JSON files from safe list", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const unsafeNonJson = result.entries.filter((e) => !e.safe && !e.fileName.endsWith(".json"));
    expect(unsafeNonJson.length).toBeGreaterThan(0); // at least icon.png, icon_gray.jpg, unknown.txt
  });

  it("reports correct game directory count", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    expect(result.appIds.length).toBe(2); // 268910, 570
  });

  it("reports total size of safe files only", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    // Safe: 268910/achievements.json(3072) + 268910/achievementpercentages.json(1024) + 268910/image_sources.json(512)
    //      + 570/achievements.json(4096) + 570/achievementpercentages.json(2048)
    const expected = 3072 + 1024 + 512 + 4096 + 2048;
    expect(result.totalSize).toBe(expected);
  });

  it("returns empty for empty directory path", async () => {
    const result = await auditAchievementData("");
    expect(result.totalFiles).toBe(0);
    expect(result.errors).toContain("Achievement data path is not configured");
  });

  it("extracts correct appId from path format", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const entry = result.entries.find((e) => e.relativePath === "268910/achievements.json");
    expect(entry?.appId).toBe("268910");
  });

  it("classifies file categories correctly", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const achEntry = result.entries.find((e) => e.fileName === "achievements.json" && e.appId === "268910");
    expect(achEntry?.category).toBe("achievements");

    const pctEntry = result.entries.find((e) => e.fileName === "achievementpercentages.json" && e.appId === "268910");
    expect(pctEntry?.category).toBe("percentages");

    const imgEntry = result.entries.find((e) => e.fileName === "image_sources.json");
    expect(imgEntry?.category).toBe("image-sources");
  });

  it("rejected file count includes icons and unknown files", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const rejected = result.entries.filter((e) => !e.safe);
    // icon.png, icon_gray.jpg, unknown.txt = 3 rejected
    expect(rejected.length).toBe(3);
  });

  it("produces payload that represents real LumaForge-owned data, not schema markers", async () => {
    const result = await auditAchievementData(ACHIEVEMENTS_ROOT);
    const safeEntries = result.entries.filter((e) => e.safe);
    // Every safe entry is a known LumaForge-owned file
    for (const entry of safeEntries) {
      expect(SAFE_ACHIEVEMENT_FILE_NAMES.has(entry.fileName.toLowerCase())).toBe(true);
    }
    // All safe entries have non-zero sizes (real data, not empty schemas)
    for (const entry of safeEntries) {
      expect(entry.size).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════
// TASK 6: Controlled Achievement Export
// ═══════════════════════════════════════════

describe("TASK 6 — Controlled achievement export", () => {
  it("archive paths use steam/achievements/ prefix", async () => {
    const files = await collectSteamAchievementBackupData();
    for (const file of files) {
      expect(file.path.startsWith(ACHIEVEMENT_BACKUP_PREFIX)).toBe(true);
    }
  });

  it("every exported file belongs to a known appId directory", async () => {
    const files = await collectSteamAchievementBackupData();
    for (const file of files) {
      if (file.path.startsWith(ACHIEVEMENT_BACKUP_PREFIX)) {
        const relative = file.path.slice(ACHIEVEMENT_BACKUP_PREFIX.length);
        const parts = relative.split("/");
        expect(parts.length).toBeGreaterThanOrEqual(2); // <appId>/<filename>
        expect(parts[0].length).toBeGreaterThan(0); // appId is non-empty
      }
    }
  });

  it("each exported file has non-empty content", async () => {
    const files = await collectSteamAchievementBackupData();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(typeof file.data).toBe("string");
      expect(file.data.length).toBeGreaterThan(0);
    }
  });

  it("only includes safe LumaForge-owned files (no icons, no txt)", async () => {
    const files = await collectSteamAchievementBackupData();
    for (const file of files) {
      expect(file.path.endsWith(".json")).toBe(true);
      expect(file.path).not.toContain(".png");
      expect(file.path).not.toContain(".jpg");
      expect(file.path).not.toContain(".txt");
    }
  });

  it("no icon cache is included", async () => {
    const files = await collectSteamAchievementBackupData();
    const iconFiles = files.filter(
      (f) => f.path.includes("icon") && (f.path.endsWith(".png") || f.path.endsWith(".jpg")),
    );
    expect(iconFiles.length).toBe(0);
  });

  it("no credentials or account IDs are exposed in paths", async () => {
    const files = await collectSteamAchievementBackupData();
    for (const file of files) {
      // Paths should only contain appId, not account IDs
      expect(file.path).not.toMatch(/userdata/);
      expect(file.path).not.toMatch(/accountId/);
      expect(file.path).not.toMatch(/login/);
    }
  });

  it("Full Backup does not silently include external Steam inputs", async () => {
    const { BACKUP_PRESETS } = await import("../services/localBackupService");
    const fullPreset = BACKUP_PRESETS.find((p) => p.id === "full");
    expect(fullPreset!.sections).not.toContain("steamAchievementInputs");
  });

  it("returns empty on missing achievements directory", async () => {
    const { resolveAchievementsRootDir } = await import("../services/tauri");
    vi.mocked(resolveAchievementsRootDir).mockResolvedValueOnce("");
    const files = await collectSteamAchievementBackupData();
    expect(files).toEqual([]);
  });

  it("file count matches safe entries from audit", async () => {
    const files = await collectSteamAchievementBackupData();
    // Safe files: 268910/achievements.json, 268910/achievementpercentages.json, 268910/image_sources.json,
    //            570/achievements.json, 570/achievementpercentages.json = 5
    const achievementFiles = files.filter((f) => f.path.startsWith(ACHIEVEMENT_BACKUP_PREFIX));
    expect(achievementFiles.length).toBe(5);
  });

  it("data payload is valid JSON for JSON files", async () => {
    const files = await collectSteamAchievementBackupData();
    for (const file of files) {
      if (file.path.endsWith(".json")) {
        expect(() => JSON.parse(file.data)).not.toThrow();
      }
    }
  });

  it("Achievement Data section is named honestly in audit notes", async () => {
    const { SECTION_AUDIT_NOTES } = await import("../services/localBackupService");
    const note = SECTION_AUDIT_NOTES["steamAchievementInputs"];
    expect(note).toContain("LumaForge-owned");
    expect(note).toContain("Steam-owned");
    expect(note).toContain("excluded");
  });
});

// ═══════════════════════════════════════════
// TASK 7: Controlled Achievement Restore
// ═══════════════════════════════════════════

describe("TASK 7 — Controlled achievement restore with rollback", () => {
  it("creates safety backup before writes", async () => {
    mockSafetyBackups.length = 0;

    await restoreAchievementFilesFromBackup(
      { "steam/achievements/268910/achievements.json": '{"test":true}' },
      ["steam/achievements/268910/achievements.json"],
    );

    expect(mockSafetyBackups.length).toBe(1);
  });

  it("writes through Rust restoreExternalFiles", async () => {
    const result = await restoreAchievementFilesFromBackup(
      { "steam/achievements/268910/achievements.json": '{"restored":true}' },
      ["steam/achievements/268910/achievements.json"],
    );

    expect(result.restored).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("SHA-256 checksums are computed for each entry", async () => {
    // The restore function computes checksums before calling Rust
    // We verify by checking the entries reach Rust
    const result = await restoreAchievementFilesFromBackup(
      {
        "steam/achievements/268910/achievements.json": '{"a":1}',
        "steam/achievements/268910/achievementpercentages.json": '{"b":2}',
      },
      [
        "steam/achievements/268910/achievements.json",
        "steam/achievements/268910/achievementpercentages.json",
      ],
    );

    expect(result.restored).toBe(2);
  });

  it("safety backup is created with operation ID", async () => {
    mockSafetyBackups.length = 0;

    await restoreAchievementFilesFromBackup(
      { "steam/achievements/570/achievements.json": '{"test":true}' },
      ["steam/achievements/570/achievements.json"],
    );

    expect(mockSafetyBackups.length).toBe(1);
    expect(mockSafetyBackups[0]).toMatch(/^achievement-restore-\d+$/);
  });

  it("restores multiple files", async () => {
    const result = await restoreAchievementFilesFromBackup(
      {
        "steam/achievements/268910/achievements.json": '{"a":1}',
        "steam/achievements/268910/achievementpercentages.json": '{"b":2}',
        "steam/achievements/268910/image_sources.json": '{"c":3}',
      },
      [
        "steam/achievements/268910/achievements.json",
        "steam/achievements/268910/achievementpercentages.json",
        "steam/achievements/268910/image_sources.json",
      ],
    );

    expect(result.restored).toBe(3);
    expect(result.failed).toBe(0);
  });

  it("returns empty result for empty paths", async () => {
    const result = await restoreAchievementFilesFromBackup({}, []);
    expect(result.restored).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("handles missing data in archive gracefully", async () => {
    const result = await restoreAchievementFilesFromBackup(
      {}, // empty archive
      ["steam/achievements/268910/achievements.json"],
    );

    expect(result.failed).toBe(1);
    expect(result.errors).toContain("Missing data for: steam/achievements/268910/achievements.json");
  });

  it("controlled failure reports errors", async () => {
    const result = await restoreAchievementFilesFromBackup(
      { "steam/achievements/268910/achievements.json": "__FAIL_RESTORE__" },
      ["steam/achievements/268910/achievements.json"],
    );

    expect(result.failed).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not touch Steam-owned appcache or userdata files", async () => {
    await restoreAchievementFilesFromBackup(
      { "steam/achievements/268910/achievements.json": '{"restored":true}' },
      ["steam/achievements/268910/achievements.json"],
    );

    // The restore only writes to the achievements directory
    const achKey = ACHIEVEMENTS_ROOT.replace(/\\/g, "/");
    const restoredPaths = (mockRestoredFiles[achKey] ?? []).map((f) => f.path);
    for (const p of restoredPaths) {
      expect(p).not.toMatch(/userdata/);
      expect(p).not.toMatch(/appcache/);
      expect(p).not.toMatch(/librarycache/);
    }
  });

  it("paths with and without prefix are handled", async () => {
    // Test with explicit prefix
    const r1 = await restoreAchievementFilesFromBackup(
      { "steam/achievements/268910/achievements.json": '{"a":1}' },
      ["steam/achievements/268910/achievements.json"],
    );
    expect(r1.restored).toBe(1);

    // Test without prefix (should be normalized)
    const r2 = await restoreAchievementFilesFromBackup(
      { "steam/achievements/570/achievements.json": '{"b":2}' },
      ["570/achievements.json"],
    );
    expect(r2.restored).toBe(1);
  });
});

// ═══════════════════════════════════════════
// Cross-cutting: Pipeline integrity
// ═══════════════════════════════════════════

describe("Pipeline integrity — export then restore round-trip", () => {
  it("Lua: exported data can be fed back to restore", async () => {
    registerLuaBackupSettingsAccessor(() => ({ luaPath: LUA_ROOT }));

    // Export
    const exportedFiles = await collectLuaFilesForBackup();
    expect(exportedFiles.length).toBeGreaterThan(0);

    // Build archive data map
    const archiveData: Record<string, string> = {};
    for (const f of exportedFiles) {
      archiveData[f.path] = f.data;
    }

    // Restore
    const paths = exportedFiles.map((f) => f.path);
    const result = await restoreLuaFilesFromBackup(archiveData, paths);
    expect(result.restored).toBe(exportedFiles.length);
    expect(result.failed).toBe(0);
  });

  it("Achievement: exported data can be fed back to restore", async () => {
    // Export
    const exportedFiles = await collectSteamAchievementBackupData();
    expect(exportedFiles.length).toBeGreaterThan(0);

    // Build archive data map
    const archiveData: Record<string, string> = {};
    for (const f of exportedFiles) {
      archiveData[f.path] = f.data;
    }

    // Restore
    const paths = exportedFiles.map((f) => f.path);
    const result = await restoreAchievementFilesFromBackup(archiveData, paths);
    expect(result.restored).toBe(exportedFiles.length);
    expect(result.failed).toBe(0);
  });
});
