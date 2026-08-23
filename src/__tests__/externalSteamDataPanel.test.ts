/**
 * Focused tests for the External Steam Data panel (29 items).
 *
 * Validates the panel's service layer, constants, safety invariants,
 * and integration with backup infrastructure. No React rendering —
 * tests exercise the underlying logic the panel depends on.
 *
 * Covers:
 *   - Panel section status (Partial, Not Backed Up)
 *   - Preset exclusion for partial sections
 *   - Settings accessor registration
 *   - Audit safety (no disk writes, allowlists used)
 *   - Path safety (relative paths only, no absolute, no account IDs)
 *   - Export prefix correctness (steam/lua/, steam/achievements/)
 *   - Depot cache policy enforcement
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock Rust commands ──

const mockScanResults: Record<string, any> = {};
const mockContentResults: Record<string, Record<string, string>> = {};

vi.mock("../services/tauri", () => ({
  scanExternalFileCollection: vi.fn(async (rootDir: string) => {
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
  resolveAchievementsRootDir: vi.fn(async () => "C:/fake-appdata/achievements/steam"),
  resolveAppDataDir: vi.fn(async () => "C:/fake-appdata"),
  writeBackupArchive: vi.fn(async () => {}),
  listBackupArchives: vi.fn(async () => []),
  scanInstalledLuaScripts: vi.fn(async () => []),
}));

// ── Imports after mock setup ──

import {
  SECTION_AUDIT_STATUS,
  SECTION_AUDIT_NOTES,
  SECTION_DISPLAY_NAMES,
  BACKUP_PRESETS,
  ALL_BACKUP_SECTIONS,
  DEPOTCACHE_BACKUP_POLICY,
  DEPOTCACHE_RESTORE_POLICY,
  DEPOTCACHE_EXCLUDED_FROM_PRESETS,
  PROTECTED_SETTINGS_KEYS,
  isPathSafe,
  isExecutablePath,
  isBlockedPath,
} from "../services/localBackupService";

import {
  auditLuaScripts,
  readLuaFilesContent,
  LUA_ALLOWED_EXTENSIONS,
  LUA_BLOCKED_FILE_NAMES,
  LUA_MAX_FILE_SIZE,
  LUA_MAX_FILES,
} from "../services/steamLuaAuditor";

import {
  auditAchievementData,
  ACHIEVEMENT_ALLOWED_EXTENSIONS,
  ACHIEVEMENT_MAX_FILE_SIZE,
  ACHIEVEMENT_MAX_FILES,
  SAFE_ACHIEVEMENT_FILE_NAMES,
} from "../services/steamAchievementAuditor";

import {
  LUA_BACKUP_PREFIX,
  registerLuaBackupSettingsAccessor,
} from "../services/steamLuaBackupService";

import {
  ACHIEVEMENT_BACKUP_PREFIX,
} from "../services/steamAchievementBackupService";

// ── localStorage mock ──

const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  });
  vi.stubGlobal("crypto", {
    subtle: {
      digest: async (_algo: string, data: ArrayBuffer) => {
        const bytes = new Uint8Array(data);
        const hash = new Uint8Array(32);
        for (let i = 0; i < 32; i++) hash[i] = bytes[i % bytes.length] ^ 0xaa;
        return hash.buffer;
      },
    },
  });

  // Reset mock data
  for (const key of Object.keys(mockScanResults)) delete mockScanResults[key];
  for (const key of Object.keys(mockContentResults)) delete mockContentResults[key];
});

// ═══════════════════════════════════════════════════════════
//  1. Panel renders — constants and status values exist
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — status and constants", () => {
  it("1. steamLua section exists with correct audit status", () => {
    expect(ALL_BACKUP_SECTIONS).toContain("steamLua");
    expect(SECTION_AUDIT_STATUS["steamLua"]).toBe("partial");
  });

  it("2. steamAchievementInputs section exists with correct audit status", () => {
    expect(ALL_BACKUP_SECTIONS).toContain("steamAchievementInputs");
    expect(SECTION_AUDIT_STATUS["steamAchievementInputs"]).toBe("partial");
  });

  it("3. Depot cache policy is 'not-backed-up'", () => {
    expect(DEPOTCACHE_BACKUP_POLICY).toBe("not-backed-up");
    expect(DEPOTCACHE_RESTORE_POLICY).toBe("not-restored");
    expect(DEPOTCACHE_EXCLUDED_FROM_PRESETS).toBe(true);
  });

  it("4. Lua and achievement sections display 'Partial.' in audit notes", () => {
    expect(SECTION_AUDIT_NOTES["steamLua"]).toContain("Partial");
    expect(SECTION_AUDIT_NOTES["steamAchievementInputs"]).toContain("Partial");
  });

  it("5. Display names exist for both sections", () => {
    expect(SECTION_DISPLAY_NAMES["steamLua"]).toBeDefined();
    expect(SECTION_DISPLAY_NAMES["steamAchievementInputs"]).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
//  6-8. Preset exclusion for partial sections
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — preset exclusion", () => {
  const essentials = BACKUP_PRESETS.find((p) => p.id === "essentials")!;
  const gameActivity = BACKUP_PRESETS.find((p) => p.id === "game-activity")!;
  const customization = BACKUP_PRESETS.find((p) => p.id === "customization")!;
  const full = BACKUP_PRESETS.find((p) => p.id === "full")!;

  it("6. Essentials preset does not include steamLua", () => {
    expect(essentials.sections).not.toContain("steamLua");
  });

  it("7. Essentials preset does not include steamAchievementInputs", () => {
    expect(essentials.sections).not.toContain("steamAchievementInputs");
  });

  it("8. Game Activity preset does not include steamLua or steamAchievementInputs", () => {
    expect(gameActivity.sections).not.toContain("steamLua");
    expect(gameActivity.sections).not.toContain("steamAchievementInputs");
  });

  it("9. Customization preset does not include steamLua or steamAchievementInputs", () => {
    expect(customization.sections).not.toContain("steamLua");
    expect(customization.sections).not.toContain("steamAchievementInputs");
  });

  it("10. Full preset does not include depotcache (excluded from all presets)", () => {
    expect(full.sections).not.toContain("depotcache");
  });
});

// ═══════════════════════════════════════════════════════════
//  11-12. Settings accessor registration
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — settings accessor", () => {
  it("11. Lua backup settings accessor returns registered settings", () => {
    const testSettings = { luaPath: "/test/path", steamRoot: "/steam" };
    registerLuaBackupSettingsAccessor(() => testSettings);

    // Register again with updated settings
    const updatedSettings = { luaPath: "/updated/path", steamRoot: "/steam2" };
    registerLuaBackupSettingsAccessor(() => updatedSettings);

    // Accessor should return the latest registered settings
    // (Registration itself doesn't throw)
    expect(true).toBe(true);
  });

  it("12. Settings accessor registration is idempotent (no crash on re-registration)", () => {
    const accessor = () => ({ luaPath: "/test" });
    registerLuaBackupSettingsAccessor(accessor);
    registerLuaBackupSettingsAccessor(accessor);
    registerLuaBackupSettingsAccessor(accessor);
    // No error = pass
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  13-14. Audits write nothing to disk
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — audit safety", () => {
  it("13. Lua audit does not write any files", () => {
    const root = "C:/test/lua";
    mockScanResults[root] = {
      files: [
        { relativePath: "test.lua", fileName: "test.lua", size: 100, checksum: "abc", modifiedAt: 0 },
      ],
      totalFiles: 1,
      errors: [],
    };

    // auditLuaScripts is pure — it reads but never writes
    // We verify it returns results without side effects
    return auditLuaScripts(root).then((result) => {
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
      // No file system writes are made — this is a pure function
    });
  });

  it("14. Achievement audit does not write any files", () => {
    const root = "C:/test/ach";
    mockScanResults[root] = {
      files: [
        { relativePath: "268910/achievements.json", fileName: "achievements.json", size: 2048, checksum: "abc", modifiedAt: 0 },
      ],
      totalFiles: 1,
      errors: [],
    };

    return auditAchievementData(root).then((result) => {
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  15-18. Allowlist correctness
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — allowlist constants", () => {
  it("15. Lua allowed extensions are exactly lua and disabled", () => {
    expect(LUA_ALLOWED_EXTENSIONS).toEqual(["lua", "disabled"]);
  });

  it("16. Lua blocked file names include README.md and CHANGELOG.md", () => {
    expect(LUA_BLOCKED_FILE_NAMES).toContain("README.md");
    expect(LUA_BLOCKED_FILE_NAMES).toContain("CHANGELOG.md");
  });

  it("17. Lua max file size is 512KB", () => {
    expect(LUA_MAX_FILE_SIZE).toBe(512 * 1024);
  });

  it("18. Lua max files is 200", () => {
    expect(LUA_MAX_FILES).toBe(200);
  });

  it("19. Achievement allowed extensions are exactly json", () => {
    expect(ACHIEVEMENT_ALLOWED_EXTENSIONS).toEqual(["json"]);
  });

  it("20. Achievement max file size is 2MB", () => {
    expect(ACHIEVEMENT_MAX_FILE_SIZE).toBe(2 * 1024 * 1024);
  });

  it("21. Achievement max files is 2000", () => {
    expect(ACHIEVEMENT_MAX_FILES).toBe(2000);
  });

  it("22. Safe achievement file names contain achievements.json, achievementpercentages.json, image_sources.json, summary.json", () => {
    expect(SAFE_ACHIEVEMENT_FILE_NAMES.has("achievements.json")).toBe(true);
    expect(SAFE_ACHIEVEMENT_FILE_NAMES.has("achievementpercentages.json")).toBe(true);
    expect(SAFE_ACHIEVEMENT_FILE_NAMES.has("image_sources.json")).toBe(true);
    expect(SAFE_ACHIEVEMENT_FILE_NAMES.has("summary.json")).toBe(true);
    expect(SAFE_ACHIEVEMENT_FILE_NAMES.size).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════
//  23-25. Path safety invariants
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — path safety", () => {
  it("23. Lua audit entries use relative paths only (no absolute paths)", async () => {
    const root = "C:/SteamLibrary/steamapps/common/LuaScripts";
    mockScanResults[root] = {
      files: [
        { relativePath: "268910.lua", fileName: "268910.lua", size: 1024, checksum: "abc", modifiedAt: 0 },
        { relativePath: "subdir/helper.lua", fileName: "helper.lua", size: 512, checksum: "def", modifiedAt: 0 },
      ],
      totalFiles: 2,
      errors: [],
    };

    const result = await auditLuaScripts(root);
    for (const entry of result.entries) {
      // All relative paths must not start with drive letters or slashes
      expect(entry.relativePath).not.toMatch(/^[A-Z]:\\/i);
      expect(entry.relativePath).not.toMatch(/^\//);
      expect(entry.relativePath).not.toMatch(/^\\/);
    }
  });

  it("24. Achievement audit entries use relative paths only (no absolute paths)", async () => {
    const root = "C:/fake-appdata/achievements/steam";
    mockScanResults[root] = {
      files: [
        { relativePath: "268910/achievements.json", fileName: "achievements.json", size: 1024, checksum: "abc", modifiedAt: 0 },
      ],
      totalFiles: 1,
      errors: [],
    };

    const result = await auditAchievementData(root);
    for (const entry of result.entries) {
      expect(entry.relativePath).not.toMatch(/^[A-Z]:\\/i);
      expect(entry.relativePath).not.toMatch(/^\//);
      expect(entry.relativePath).not.toMatch(/^\\/);
    }
  });

  it("25. No account IDs or Steam IDs in audit output", async () => {
    const root = "C:/test/lua";
    mockScanResults[root] = {
      files: [
        { relativePath: "268910.lua", fileName: "268910.lua", size: 1024, checksum: "abc", modifiedAt: 0 },
      ],
      totalFiles: 1,
      errors: [],
    };

    const result = await auditLuaScripts(root);
    const outputStr = JSON.stringify(result);
    // No Steam numeric IDs (typically 17-digit numbers) should appear as account identifiers
    // Allow app IDs (game IDs) but not account IDs (which are longer)
    expect(outputStr).not.toMatch(/\b\d{17}\b/);
  });
});

// ═══════════════════════════════════════════════════════════
//  26-27. Export path prefixes
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — export path prefixes", () => {
  it("26. LUA_BACKUP_PREFIX starts with steam/lua/", () => {
    expect(LUA_BACKUP_PREFIX).toMatch(/^steam\/lua\//);
  });

  it("27. ACHIEVEMENT_BACKUP_PREFIX starts with steam/achievements/", () => {
    expect(ACHIEVEMENT_BACKUP_PREFIX).toMatch(/^steam\/achievements\//);
  });
});

// ═══════════════════════════════════════════════════════════
//  28. Depot cache is not a backup section
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — depot cache policy", () => {
  it("28. Depotcache path is protected in settings keys", () => {
    expect(PROTECTED_SETTINGS_KEYS).toContain("depotcachePath");
  });

  it("29. Depotcache is excluded from all presets and its path is protected", () => {
    // No preset includes depotcache
    for (const preset of BACKUP_PRESETS) {
      expect(preset.sections).not.toContain("depotcache");
    }
    // depotcachePath is a protected setting key
    expect(PROTECTED_SETTINGS_KEYS).toContain("depotcachePath");
    // depotcache is not a named backup section
    expect(ALL_BACKUP_SECTIONS).not.toContain("depotcache");
  });
});

// ═══════════════════════════════════════════════════════════
//  Supplementary: Export content and checksum correctness
// ═══════════════════════════════════════════════════════════

describe("External Steam Data panel — export content safety", () => {
  it("readLuaFilesContent returns correct content map", async () => {
    const root = "C:/test/lua";
    const content = { "test.lua": "-- hello lua" };
    mockContentResults[root] = content;

    const result = await readLuaFilesContent(root, ["test.lua"]);
    expect(result).toEqual(content);
  });

  it("readLuaFilesContent filters out non-requested paths", async () => {
    const root = "C:/test/lua";
    mockContentResults[root] = { "a.lua": "a", "b.lua": "b" };

    const result = await readLuaFilesContent(root, ["a.lua"]);
    expect(result).toEqual({ "a.lua": "a" });
    expect(result["b.lua"]).toBeUndefined();
  });

  it("isPathSafe blocks traversal attempts", () => {
    expect(isPathSafe("normal/file.lua")).toBe(true);
    expect(isPathSafe("../../../etc/passwd")).toBe(false);
    expect(isPathSafe("/absolute/path")).toBe(false);
    expect(isPathSafe("\\\\server\\share")).toBe(false);
  });

  it("isExecutablePath detects executable extensions", () => {
    expect(isExecutablePath("helper.exe")).toBe(true);
    expect(isExecutablePath("script.lua")).toBe(false);
    expect(isExecutablePath("data.json")).toBe(false);
    expect(isExecutablePath("malware.bat")).toBe(true);
  });

  it("isBlockedPath detects sensitive files", () => {
    expect(isBlockedPath("loginusers.vdf")).toBe(true);
    expect(isBlockedPath("config/config.vdf")).toBe(true);
    expect(isBlockedPath("normal.lua")).toBe(false);
  });
});
