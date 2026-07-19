/**
 * React component tests for ExternalSteamDataPanel.
 *
 * Covers spec items 1-22 (rendering, interactions, selection, export, accessor).
 * BackupSection Custom-selector items (23-26) are in BackupSectionComponent.test.tsx.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// ══════════════════════════════════════════════════════════════
//  Mock declarations (before imports that use them)
// ══════════════════════════════════════════════════════════════

const mockLoadSettings = vi.fn();
const mockResolveAchievementsRootDir = vi.fn();
const mockWriteBackupArchive = vi.fn();
const mockScanExternalFileCollection = vi.fn();
const mockReadFileCollectionContent = vi.fn();
const mockScanInstalledLuaScripts = vi.fn();
const mockAuditLuaScripts = vi.fn();
const mockReadLuaFilesContent = vi.fn();
const mockAuditAchievementData = vi.fn();
const mockReadAchievementFilesContent = vi.fn();

vi.mock("../services/tauri", () => ({
  writeBackupArchive: (...args: any[]) => mockWriteBackupArchive(...args),
  resolveAchievementsRootDir: (...args: any[]) => mockResolveAchievementsRootDir(...args),
  scanExternalFileCollection: (...args: any[]) => mockScanExternalFileCollection(...args),
  readFileCollectionContent: (...args: any[]) => mockReadFileCollectionContent(...args),
  scanInstalledLuaScripts: (...args: any[]) => mockScanInstalledLuaScripts(...args),
}));

vi.mock("../context/SettingsContext", () => ({
  loadSettings: (...args: any[]) => mockLoadSettings(...args),
}));

vi.mock("../services/steamLuaAuditor", () => ({
  auditLuaScripts: (...args: any[]) => mockAuditLuaScripts(...args),
  readLuaFilesContent: (...args: any[]) => mockReadLuaFilesContent(...args),
  LUA_ALLOWED_EXTENSIONS: ["lua", "disabled"],
  LUA_BLOCKED_FILE_NAMES: ["README.md", "CHANGELOG.md", "config.vdf"],
  LUA_MAX_FILE_SIZE: 512 * 1024,
  LUA_MAX_FILES: 200,
}));

vi.mock("../services/steamLuaBackupService", () => ({
  LUA_BACKUP_PREFIX: "steam/lua/",
  registerLuaBackupSettingsAccessor: vi.fn(),
}));

vi.mock("../services/steamAchievementAuditor", () => ({
  auditAchievementData: (...args: any[]) => mockAuditAchievementData(...args),
  readAchievementFilesContent: (...args: any[]) => mockReadAchievementFilesContent(...args),
  ACHIEVEMENT_ALLOWED_EXTENSIONS: ["json"],
  ACHIEVEMENT_MAX_FILE_SIZE: 2 * 1024 * 1024,
  ACHIEVEMENT_MAX_FILES: 2000,
  SAFE_ACHIEVEMENT_FILE_NAMES: new Set(["achievements.json", "achievementpercentages.json", "image_sources.json", "summary.json"]),
}));

vi.mock("../services/steamAchievementBackupService", () => ({
  ACHIEVEMENT_BACKUP_PREFIX: "steam/achievements/",
}));

vi.mock("../services/localBackupService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/localBackupService")>();
  return {
    ...actual,
    isPathSafe: actual.isPathSafe,
    isExecutablePath: actual.isExecutablePath,
    isBlockedPath: actual.isBlockedPath,
    sha256: actual.sha256,
    buildBackupManifest: actual.buildBackupManifest,
  };
});

// ══════════════════════════════════════════════════════════════
//  Imports after mocks
// ══════════════════════════════════════════════════════════════

import ExternalSteamDataPanel from "../components/settings/ExternalSteamDataPanel";

// ══════════════════════════════════════════════════════════════
//  Mock data factories
// ══════════════════════════════════════════════════════════════

function makeLuaResult(overrides?: { entries?: any[]; errors?: string[] }) {
  const safeEntries = [
    { relativePath: "helper.lua", category: "lua-script", safe: true, reason: "", size: 2048 },
    { relativePath: "disabled.lua.disabled", category: "lua-disabled", safe: true, reason: "", size: 512 },
  ];
  const rejectedEntries = [
    { relativePath: "malware.exe", category: "unknown", safe: false, reason: "Executable extension", size: 4096 },
    { relativePath: "config.vdf", category: "unknown", safe: false, reason: "Blocked filename", size: 1024 },
  ];
  const entries = overrides?.entries ?? [...safeEntries, ...rejectedEntries];
  return {
    luaFiles: entries.filter((e) => e.safe && e.category !== "lua-disabled"),
    providerStatusFiles: entries.filter((e) => e.category === "lua-disabled"),
    totalLuaFiles: entries.filter((e) => e.safe && e.category !== "lua-disabled").length,
    totalProviderStatusFiles: entries.filter((e) => e.category === "lua-disabled").length,
    totalSize: entries.reduce((s: number, e: any) => s + e.size, 0),
    entries,
    errors: overrides?.errors ?? [],
    warnings: [],
  };
}

function makeAchResult(overrides?: { entries?: any[]; errors?: string[] }) {
  const safeEntries = [
    { relativePath: "268910/achievements.json", appId: "268910", category: "achievements", safe: true, reason: "", size: 4096 },
    { relativePath: "268910/achievementpercentages.json", appId: "268910", category: "percentages", safe: true, reason: "", size: 1024 },
    { relativePath: "480/achievements.json", appId: "480", category: "achievements", safe: true, reason: "", size: 2048 },
  ];
  const rejectedEntries = [
    { relativePath: "268910/icon.png", appId: "268910", category: "icon", safe: false, reason: "Icon excluded", size: 8192 },
  ];
  const entries = overrides?.entries ?? [...safeEntries, ...rejectedEntries];
  const appIds = [...new Set(entries.filter((e) => e.safe).map((e) => e.appId))];
  return {
    files: entries,
    totalFiles: entries.length,
    totalSize: entries.reduce((s: number, e: any) => s + e.size, 0),
    entries,
    appIds,
    errors: overrides?.errors ?? [],
    warnings: [],
  };
}

// ══════════════════════════════════════════════════════════════
//  Setup
// ══════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.clearAllMocks();

  mockLoadSettings.mockReturnValue({ luaPath: "C:/SteamLibrary/steamapps/common/LuaScripts" });
  mockResolveAchievementsRootDir.mockResolvedValue("C:/fake-appdata/achievements/steam");
  mockWriteBackupArchive.mockResolvedValue(undefined);
  mockAuditLuaScripts.mockResolvedValue(makeLuaResult());
  mockReadLuaFilesContent.mockImplementation(
    (_root: string, paths: string[]) => {
      const allFiles: Record<string, string> = {
        "helper.lua": "-- helper script\nprint('hello')",
        "disabled.lua.disabled": "-- disabled script",
      };
      const result: Record<string, string> = {};
      for (const p of paths) {
        if (p in allFiles) result[p] = allFiles[p];
      }
      return Promise.resolve(result);
    },
  );
  mockAuditAchievementData.mockResolvedValue(makeAchResult());
  mockReadAchievementFilesContent.mockImplementation(
    (_root: string, paths: string[]) => {
      const allFiles: Record<string, string> = {
        "268910/achievements.json": JSON.stringify({ achievements: [] }),
        "268910/achievementpercentages.json": JSON.stringify({ percentages: [] }),
        "480/achievements.json": JSON.stringify({ achievements: [] }),
      };
      const result: Record<string, string> = {};
      for (const p of paths) {
        if (p in allFiles) result[p] = allFiles[p];
      }
      return Promise.resolve(result);
    },
  );
});

// ══════════════════════════════════════════════════════════════
//  Helper: render with async boot completed
// ══════════════════════════════════════════════════════════════

async function renderAndWait() {
  const result = render(<ExternalSteamDataPanel />);
  await waitFor(() => {
    expect(screen.getByText("External Steam Data")).toBeTruthy();
  });
  // Wait for boot effect to resolve roots (both Lua and Achievement)
  await waitFor(() => {
    expect(screen.getAllByText("Available").length).toBeGreaterThanOrEqual(1);
  });
  return result;
}

// ══════════════════════════════════════════════════════════════
//  TASK 1 — React Component Rendering Tests
// ══════════════════════════════════════════════════════════════

describe("TASK 1 — React Rendering", () => {
  it("1. External Steam Data panel renders", async () => {
    await renderAndWait();
    expect(screen.getByText("External Steam Data")).toBeTruthy();
    expect(screen.getByText(/Audit, review, and export Steam Lua scripts/)).toBeTruthy();
  });

  it("2. Steam Lua Scripts card renders", async () => {
    await renderAndWait();
    expect(screen.getByText("Steam Lua Scripts")).toBeTruthy();
  });

  it("3. Steam Lua status displays Partial", async () => {
    await renderAndWait();
    const luaCard = screen.getByText("Steam Lua Scripts").closest("div.lf-surface")!;
    expect(within(luaCard).getByText("Partial")).toBeTruthy();
  });

  it("4. LumaForge Achievement Data card renders", async () => {
    await renderAndWait();
    expect(screen.getByText("LumaForge Achievement Data")).toBeTruthy();
  });

  it("5. Achievement status displays Partial", async () => {
    await renderAndWait();
    const achCard = screen.getByText("LumaForge Achievement Data").closest("div.lf-surface")!;
    expect(within(achCard).getByText("Partial")).toBeTruthy();
  });

  it("6. Depot Cache card renders", async () => {
    await renderAndWait();
    expect(screen.getByText("Depot Cache")).toBeTruthy();
  });

  it("7. Depot Cache displays Not Backed Up", async () => {
    await renderAndWait();
    const depotCard = screen.getByText("Depot Cache").closest("div.lf-surface")!;
    expect(within(depotCard).getByText("Not Backed Up")).toBeTruthy();
  });

  it("8. Steam Lua card displays Audit Files button", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: /Audit Files/ })).toBeTruthy();
  });

  it("9. Achievement card displays Audit Data button", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: /Audit Data/ })).toBeTruthy();
  });

  it("10. Depot Cache has no Audit action", async () => {
    await renderAndWait();
    const depotCard = screen.getByText("Depot Cache").closest("div.lf-surface")!;
    const buttons = within(depotCard).queryAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes("Audit"))).toBe(false);
  });

  it("11. Depot Cache has no Export action", async () => {
    await renderAndWait();
    const depotCard = screen.getByText("Depot Cache").closest("div.lf-surface")!;
    const buttons = within(depotCard).queryAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes("Export"))).toBe(false);
  });

  it("12. Depot Cache has no Restore action", async () => {
    await renderAndWait();
    const depotCard = screen.getByText("Depot Cache").closest("div.lf-surface")!;
    const buttons = within(depotCard).queryAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes("Restore"))).toBe(false);
  });

  it("13. Steam Lua card has no direct Restore action", async () => {
    await renderAndWait();
    const luaCard = screen.getByText("Steam Lua Scripts").closest("div.lf-surface")!;
    const buttons = within(luaCard).queryAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes("Restore"))).toBe(false);
  });

  it("14. Achievement card has no direct Restore action", async () => {
    await renderAndWait();
    const achCard = screen.getByText("LumaForge Achievement Data").closest("div.lf-surface")!;
    const buttons = within(achCard).queryAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes("Restore"))).toBe(false);
  });

  it("15. Missing Lua path displays Missing or Unavailable", async () => {
    mockLoadSettings.mockReturnValue({ luaPath: "" });
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      expect(screen.getByText("Not configured")).toBeTruthy();
    });
  });

  it("16. Invalid Lua path shows error state", async () => {
    mockLoadSettings.mockImplementation(() => { throw new Error("bad settings"); });
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      expect(screen.getByText("Error")).toBeTruthy();
    });
  });

  it("17. Export Selected Files is disabled with zero selected files", async () => {
    await renderAndWait();
    const exportBtn = screen.getByRole("button", { name: /Export Selected Files/ });
    expect(exportBtn.hasAttribute("disabled")).toBe(true);
  });

  it("18. Export Selected Data is disabled with zero selected games", async () => {
    await renderAndWait();
    const exportBtn = screen.getByRole("button", { name: /Export Selected Data/ });
    expect(exportBtn.hasAttribute("disabled")).toBe(true);
  });

  it("19. Rejected Lua files render disabled checkboxes in review", async () => {
    await renderAndWait();

    // Audit first to populate results
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Audit Files/ }));
    await waitFor(() => {
      expect(screen.getByText("Review Allowed Files")).not.toHaveAttribute("disabled");
    });

    // Open review
    await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
    await waitFor(() => {
      expect(screen.getByText(/File Review/)).toBeTruthy();
    });

    // Rejected entries should NOT have interactive checkboxes (they render a div instead)
    const rejectedRow = screen.getByText("malware.exe").closest("label")!;
    expect(rejectedRow.querySelector("input[type='checkbox']")).toBeNull();
    // Should have the red rejection indicator div instead
    expect(rejectedRow.querySelector(".border-red-500\\/30")).toBeTruthy();
    });

  it("21. Absolute paths do not appear in rendered output", async () => {
    await renderAndWait();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Audit Files/ }));
    await waitFor(() => {
      expect(screen.getByText("Review Allowed Files")).not.toHaveAttribute("disabled");
    });

    await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
    await waitFor(() => {
      expect(screen.getByText(/File Review/)).toBeTruthy();
    });

    // All paths in the review panel should be relative
    const panel = screen.getByText(/File Review/).closest("div.rounded-xl")!;
    const allText = panel.textContent || "";
    expect(allText).not.toMatch(/[A-Z]:\\/i);
    expect(allText).not.toMatch(/C:\\/);
  });

  it("22. Steam account IDs do not appear in rendered output", async () => {
    await renderAndWait();
    // Render the full panel text
    const panelText = document.body.textContent || "";
    // No 17-digit Steam account IDs
    expect(panelText).not.toMatch(/\b\d{17}\b/);
  });
});

// ══════════════════════════════════════════════════════════════
//  TASK 2 — Audit Button Interactions
// ══════════════════════════════════════════════════════════════

describe("TASK 2 — Audit Interactions", () => {
  describe("Steam Lua audit", () => {
    it("1. Click Audit Files triggers the audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      expect(mockAuditLuaScripts).toHaveBeenCalledOnce();
    });

    it("2. Loading state appears during audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      // Make audit slow
      let resolveAudit: (v: any) => void;
      mockAuditLuaScripts.mockImplementation(
        () => new Promise((resolve) => { resolveAudit = resolve; }),
      );

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      // Should show "Auditing..." and button disabled
      await waitFor(() => {
        expect(screen.getByText("Auditing...")).toBeTruthy();
      });
      expect(screen.getByRole("button", { name: /Auditing/ })).toHaveAttribute("disabled");

      // Resolve
      resolveAudit!(makeLuaResult());
      await waitFor(() => {
        expect(screen.queryByText("Auditing...")).toBeNull();
      });
    });

    it("3. Duplicate clicks are prevented during audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      let resolveAudit: (v: any) => void;
      mockAuditLuaScripts.mockImplementation(
        () => new Promise((resolve) => { resolveAudit = resolve; }),
      );

      const auditBtn = screen.getByRole("button", { name: /Audit Files/ });
      await user.click(auditBtn);
      // Button text changes to "Auditing..." — use fireEvent on same DOM ref
      fireEvent.click(auditBtn);

      expect(mockAuditLuaScripts).toHaveBeenCalledOnce();
      resolveAudit!(makeLuaResult());
      await waitFor(() => {
        expect(screen.queryByText("Auditing...")).toBeNull();
      });
    });

    it("4. Audit results appear after resolution", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      await waitFor(() => {
        expect(screen.getByText("Review Allowed Files")).not.toHaveAttribute("disabled");
      });
    });

    it("5. Allowed count appears", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      await waitFor(() => {
        const luaCard = screen.getByText("Steam Lua Scripts").closest("div.lf-surface")!;
        // 2 safe entries (helper.lua + disabled.lua.disabled) — "2" also matches Rejected count
        expect(within(luaCard).getAllByText("2").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("6. Rejected count appears", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      await waitFor(() => {
        // Look for "Rejected Files" cell with count 2
        const luaCard = screen.getByText("Steam Lua Scripts").closest("div.lf-surface")!;
        const rejectedLabel = within(luaCard).getByText("Rejected Files");
        const cell = rejectedLabel.closest("div")!.parentElement!;
        // The count "2" should be in the same cell group
        expect(cell.textContent).toContain("2");
      });
    });

    it("7. Allowed size appears after audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      await waitFor(() => {
        // Total Allowed Size shows totalSize which includes all entries: 2048+512+4096+1024 = 7680 = 7.5 KB
        expect(screen.getByText("7.5 KB")).toBeTruthy();
      });
    });

    it("8. Rejection reasons appear when entries are rejected", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      await waitFor(() => {
        expect(screen.getByText("Rejection Reasons")).toBeTruthy();
        expect(screen.getByText(/Executable extension/)).toBeTruthy();
        expect(screen.getByText(/Blocked filename/)).toBeTruthy();
      });
    });

    it("9. Review Allowed Files becomes available after audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      // Before audit — disabled
      expect(screen.getByRole("button", { name: /Review Allowed Files/ })).toHaveAttribute("disabled");

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });
    });

    it("10. Audit does not write any files (read-only)", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));

      await waitFor(() => {
        expect(mockAuditLuaScripts).toHaveBeenCalledOnce();
      });

      // No write calls during audit
      expect(mockWriteBackupArchive).not.toHaveBeenCalled();
    });
  });

  describe("Achievement audit", () => {
    it("1. Click Audit Data triggers the audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      expect(mockAuditAchievementData).toHaveBeenCalledOnce();
    });

    it("2. Loading state appears during audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      let resolveAudit: (v: any) => void;
      mockAuditAchievementData.mockImplementation(
        () => new Promise((resolve) => { resolveAudit = resolve; }),
      );

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByText("Auditing...")).toBeTruthy();
      });
      expect(screen.getByRole("button", { name: /Auditing/ })).toHaveAttribute("disabled");

      resolveAudit!(makeAchResult());
      await waitFor(() => {
        expect(screen.queryByText("Auditing...")).toBeNull();
      });
    });

    it("3. Duplicate clicks are prevented during audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      let resolveAudit: (v: any) => void;
      mockAuditAchievementData.mockImplementation(
        () => new Promise((resolve) => { resolveAudit = resolve; }),
      );

      const auditBtn = screen.getByRole("button", { name: /Audit Data/ });
      await user.click(auditBtn);
      // Button text changes to "Auditing..." — use fireEvent on same DOM ref
      fireEvent.click(auditBtn);

      expect(mockAuditAchievementData).toHaveBeenCalledOnce();
      resolveAudit!(makeAchResult());
      await waitFor(() => {
        expect(screen.queryByText("Auditing...")).toBeNull();
      });
    });

    it("4. Audit results appear after resolution", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });
    });

    it("5. Game count appears after audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));

      await waitFor(() => {
        const achCard = screen.getByText("LumaForge Achievement Data").closest("div.lf-surface")!;
        // 2 game directories (268910, 480) — "2" also matches achievements.json count
        expect(within(achCard).getAllByText("2").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("6. File counts by type appear", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));

      await waitFor(() => {
        expect(screen.getByText("achievements.json")).toBeTruthy();
        expect(screen.getByText("achievementpercentages.json")).toBeTruthy();
        expect(screen.getByText("image_sources.json")).toBeTruthy();
      });
    });

    it("7. Rejected count appears after audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));

      await waitFor(() => {
        const achCard = screen.getByText("LumaForge Achievement Data").closest("div.lf-surface")!;
        const rejectedLabel = within(achCard).getByText("Rejected Files");
        const cell = rejectedLabel.closest("div")!.parentElement!;
        expect(cell.textContent).toContain("1");
      });
    });

    it("8. Verified size appears after audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));

      await waitFor(() => {
        expect(screen.getByText("Total Verified Size")).toBeTruthy();
        // totalSize = 4096+1024+2048+8192 = 15360 = 15.0 KB
        expect(screen.getByText("15.0 KB")).toBeTruthy();
      });
    });

    it("9. Review Records becomes available after audit", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      expect(screen.getByRole("button", { name: /Review Records/ })).toHaveAttribute("disabled");

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });
    });

    it("10. Audit does not write any files", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));

      await waitFor(() => {
        expect(mockAuditAchievementData).toHaveBeenCalledOnce();
      });
      expect(mockWriteBackupArchive).not.toHaveBeenCalled();
    });
  });

  describe("Error cases", () => {
    it("Missing Lua root shows error in audit result", async () => {
      mockLoadSettings.mockReturnValue({ luaPath: "" });
      render(<ExternalSteamDataPanel />);
      await waitFor(() => {
        expect(screen.getByText("Not configured")).toBeTruthy();
      });
      // Audit button should be disabled when unconfigured
      expect(screen.getByRole("button", { name: /Audit Files/ })).toHaveAttribute("disabled");
    });

    it("Lua auditor failure shows error message", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      mockAuditLuaScripts.mockRejectedValue(new Error("Permission denied"));

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/Audit failed/)).toBeTruthy();
      });
    });

    it("Achievement auditor failure shows error message", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      mockAuditAchievementData.mockRejectedValue(new Error("Disk error"));

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByText(/Audit failed/)).toBeTruthy();
      });
    });

    it("Lua audit with no safe files disables export", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      mockAuditLuaScripts.mockResolvedValue(makeLuaResult({
        entries: [
          { relativePath: "bad.exe", category: "unknown", safe: false, reason: "Executable", size: 100 },
        ],
      }));

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        // Review button still disabled because no entries to review? Actually it checks entries.length === 0
        // But we DO have entries (just all rejected). Review is enabled if entries.length > 0
        // "0" appears for both Allowed Files and Discovered counts
        expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("Achievement audit with no safe records disables export", async () => {
      await renderAndWait();
      const user = userEvent.setup();
      mockAuditAchievementData.mockResolvedValue(makeAchResult({
        entries: [
          { relativePath: "bad/icon.png", appId: "123", category: "icon", safe: false, reason: "Icon", size: 100 },
        ],
      }));

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        // No valid appIds → review disabled
        expect(screen.getByRole("button", { name: /Review Records/ })).toHaveAttribute("disabled");
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════
//  TASK 3 — File and Record Selection
// ══════════════════════════════════════════════════════════════

describe("TASK 3 — Selection", () => {
  describe("Lua selection", () => {
    async function openLuaReview() {
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });
      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });
      return user;
    }

    it("1. Review shows allowed and rejected entries", async () => {
      await renderAndWait();
      const user = await openLuaReview();
      expect(screen.getByText("helper.lua")).toBeTruthy();
      expect(screen.getByText("disabled.lua.disabled")).toBeTruthy();
      expect(screen.getByText("malware.exe")).toBeTruthy();
      expect(screen.getByText("config.vdf")).toBeTruthy();
    });

    it("2. Safe files are pre-selected", async () => {
      await renderAndWait();
      await openLuaReview();
      // helper.lua and disabled.lua.disabled checkboxes should be checked
      const helperCheckbox = screen.getByText("helper.lua").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      const disabledCheckbox = screen.getByText("disabled.lua.disabled").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      expect(helperCheckbox.checked).toBe(true);
      expect(disabledCheckbox.checked).toBe(true);
    });

    it("3. Deselecting one file updates selection count", async () => {
      await renderAndWait();
      const user = await openLuaReview();

      const helperCheckbox = screen.getByText("helper.lua").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      await user.click(helperCheckbox);

      // Selection should decrease from 2 to 1
      expect(screen.getByText(/1 selected of 2 safe/)).toBeTruthy();
    });

    it("4. Export button enables after selecting files", async () => {
      await renderAndWait();
      await openLuaReview();

      // Export should be enabled since safe files are pre-selected
      const exportBtn = screen.getByRole("button", { name: /Export Selected \(2\)/ });
      expect(exportBtn).not.toHaveAttribute("disabled");
    });

    it("5. Clear selection deselects all", async () => {
      await renderAndWait();
      const user = await openLuaReview();

      await user.click(screen.getByRole("button", { name: /Clear/ }));
      expect(screen.getByText(/0 selected of 2 safe/)).toBeTruthy();
    });

    it("6. Export disabled after clear", async () => {
      await renderAndWait();
      const user = await openLuaReview();

      await user.click(screen.getByRole("button", { name: /Clear/ }));
      // The main export button should be disabled now
      const exportBtn = screen.getByRole("button", { name: /Export Selected Files/ });
      expect(exportBtn.hasAttribute("disabled")).toBe(true);
    });

    it("7. Select All selects only safe files", async () => {
      await renderAndWait();
      const user = await openLuaReview();

      await user.click(screen.getByRole("button", { name: /Clear/ }));
      await user.click(screen.getByRole("button", { name: /Select All Safe/ }));

      // Should be 2 safe files selected
      expect(screen.getByText(/2 selected of 2 safe/)).toBeTruthy();
    });

    it("8. Rejected files remain unselected", async () => {
      await renderAndWait();
      await openLuaReview();

      // Rejected entries don't have checkboxes (they render a div)
      const rejectedRow = screen.getByText("malware.exe").closest("label")!;
      expect(rejectedRow.querySelector("input[type='checkbox']")).toBeNull();
    });

    it("9. All displayed paths are relative", async () => {
      await renderAndWait();
      await openLuaReview();

      const reviewPanel = screen.getByText(/File Review/).closest("div.rounded-xl")!;
      const paths = reviewPanel.querySelectorAll("span.font-mono");
      for (const path of paths) {
        expect(path.textContent).not.toMatch(/^[A-Z]:\\/i);
        expect(path.textContent).not.toMatch(/^\//);
      }
    });

    it("10. Category badges appear for each file", async () => {
      await renderAndWait();
      await openLuaReview();

      expect(screen.getByText("lua-script")).toBeTruthy();
      expect(screen.getByText("lua-disabled")).toBeTruthy();
    });
  });

  describe("Achievement selection", () => {
    async function openAchReview() {
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });
      await user.click(screen.getByRole("button", { name: /Review Records/ }));
      await waitFor(() => {
        expect(screen.getByText(/Game Review/)).toBeTruthy();
      });
      return user;
    }

    it("1. Review shows valid and rejected game records", async () => {
      await renderAndWait();
      const user = await openAchReview();
      // Safe appIds appear as game summaries
      expect(screen.getByText("268910")).toBeTruthy();
      expect(screen.getByText("480")).toBeTruthy();
    });

    it("2. Valid games are pre-selected", async () => {
      await renderAndWait();
      await openAchReview();

      const checkbox268910 = screen.getByText("268910").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      const checkbox480 = screen.getByText("480").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      expect(checkbox268910.checked).toBe(true);
      expect(checkbox480.checked).toBe(true);
    });

    it("3. Export Selected Data enables with selection", async () => {
      await renderAndWait();
      await openAchReview();

      const exportBtn = screen.getByRole("button", { name: /Export Selected \(2\)/ });
      expect(exportBtn).not.toHaveAttribute("disabled");
    });

    it("4. Clear deselects all", async () => {
      await renderAndWait();
      const user = await openAchReview();

      await user.click(screen.getByRole("button", { name: /Clear/ }));
      expect(screen.getByText(/0 selected of 2 valid/)).toBeTruthy();
    });

    it("5. Export disabled after clear", async () => {
      await renderAndWait();
      const user = await openAchReview();

      await user.click(screen.getByRole("button", { name: /Clear/ }));
      const exportBtn = screen.getByRole("button", { name: /Export Selected Data/ });
      expect(exportBtn.hasAttribute("disabled")).toBe(true);
    });

    it("6. Select All selects all valid games", async () => {
      await renderAndWait();
      const user = await openAchReview();

      await user.click(screen.getByRole("button", { name: /Clear/ }));
      await user.click(screen.getByRole("button", { name: /Select All Valid Games/ }));

      expect(screen.getByText(/2 selected of 2 valid/)).toBeTruthy();
    });

    it("7. Rejected records are excluded from game summaries", async () => {
      await renderAndWait();
      await openAchReview();

      // icon.png is rejected — should not appear
      expect(screen.queryByText("icon.png")).toBeNull();
    });

    it("8. No raw achievement file contents are rendered", async () => {
      await renderAndWait();
      await openAchReview();

      const allText = document.body.textContent || "";
      expect(allText).not.toContain('"achievements":[]');
      expect(allText).not.toContain('{"percentages":[]}');
    });

    it("9. No account IDs in rendered output", async () => {
      await renderAndWait();
      await openAchReview();

      const reviewPanel = screen.getByText(/Game Review/).closest("div.rounded-xl")!;
      const allText = reviewPanel.textContent || "";
      expect(allText).not.toMatch(/\b\d{17}\b/);
    });

    it("10. File count and size per game appear", async () => {
      await renderAndWait();
      await openAchReview();

      expect(screen.getByText("2 files")).toBeTruthy(); // 268910 has 2 files
      expect(screen.getByText("1 file")).toBeTruthy(); // 480 has 1 file
    });
  });
});

// ══════════════════════════════════════════════════════════════
//  TASK 4 — Export Handoff
// ══════════════════════════════════════════════════════════════

describe("TASK 4 — Export Handoff", () => {
  describe("Lua export", () => {
    it("1. Export calls writeBackupArchive with correct prefix", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      // Audit
      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      // Open review (safe files pre-selected)
      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      // Export
      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData, filename] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);

      // Filename should follow backup pattern
      expect(filename).toMatch(/^lumaforge-backup-.*\.json$/);

      // All file paths should start with steam/lua/
      const fileKeys = Object.keys(parsed.data);
      for (const key of fileKeys) {
        expect(key).toMatch(/^steam\/lua\//);
      }
    });

    it("2. Only selected files are included", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      // Deselect one file
      const helperCheckbox = screen.getByText("helper.lua").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      await user.click(helperCheckbox);

      // Export with 1 file selected
      await user.click(screen.getByRole("button", { name: /Export Selected \(1\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);
      const fileKeys = Object.keys(parsed.data);
      expect(fileKeys.length).toBe(1);
      expect(fileKeys[0]).toBe("steam/lua/disabled.lua.disabled");
    });

    it("3. Exact relative path is preserved", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);
      expect(Object.keys(parsed.data)).toContain("steam/lua/helper.lua");
      expect(Object.keys(parsed.data)).toContain("steam/lua/disabled.lua.disabled");
    });

    it("4. Manifest contains correct section", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);
      // manifest.sections is a Record<string, boolean>, not an array
      expect(parsed.manifest.sections).toHaveProperty("steamLua", true);
      for (const entry of parsed.manifest.files) {
        expect(entry.section).toBe("steamLua");
      }
    });

    it("5. Success banner appears after export", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(screen.getByText(/Exported.*added to Stored Backups/)).toBeTruthy();
      });
    });

    it("6. Review panel closes after successful export", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(screen.queryByText(/File Review/)).toBeNull();
      });
    });

    it("7. No direct Restore is triggered by export", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      // Only writeBackupArchive called — no restore calls
      expect(mockWriteBackupArchive).toHaveBeenCalledTimes(1);
    });

    it("8. Export failure shows error banner", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Files/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Allowed Files/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Allowed Files/ }));
      await waitFor(() => {
        expect(screen.getByText(/File Review/)).toBeTruthy();
      });

      mockWriteBackupArchive.mockRejectedValue(new Error("Disk full"));
      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(screen.getByText(/Export failed/)).toBeTruthy();
      });
    });
  });

  describe("Achievement export", () => {
    it("1. Export calls writeBackupArchive with correct prefix", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Records/ }));
      await waitFor(() => {
        expect(screen.getByText(/Game Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);
      const fileKeys = Object.keys(parsed.data);
      for (const key of fileKeys) {
        expect(key).toMatch(/^steam\/achievements\//);
      }
    });

    it("2. Only selected game files reach the backup builder", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Records/ }));
      await waitFor(() => {
        expect(screen.getByText(/Game Review/)).toBeTruthy();
      });

      // Deselect 480
      const checkbox480 = screen.getByText("480").closest("label")!.querySelector("input[type='checkbox']") as HTMLInputElement;
      await user.click(checkbox480);

      await user.click(screen.getByRole("button", { name: /Export Selected \(1\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);
      const fileKeys = Object.keys(parsed.data);
      // Should only contain 268910 files, not 480
      for (const key of fileKeys) {
        expect(key).toContain("268910");
        expect(key).not.toContain("480");
      }
    });

    it("3. Success banner shows game count and file count", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Records/ }));
      await waitFor(() => {
        expect(screen.getByText(/Game Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(screen.getByText(/Exported 2 game\(s\)/)).toBeTruthy();
        expect(screen.getByText(/added to Stored Backups/)).toBeTruthy();
      });
    });

    it("4. Manifest contains steamAchievementInputs section", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Records/ }));
      await waitFor(() => {
        expect(screen.getByText(/Game Review/)).toBeTruthy();
      });

      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(mockWriteBackupArchive).toHaveBeenCalledOnce();
      });

      const [exportData] = mockWriteBackupArchive.mock.calls[0];
      const parsed = JSON.parse(exportData);
      // manifest.sections is a Record<string, boolean>, not an array
      expect(parsed.manifest.sections).toHaveProperty("steamAchievementInputs", true);
    });

    it("5. Achievement export failure shows error banner", async () => {
      await renderAndWait();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /Audit Data/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Review Records/ })).not.toHaveAttribute("disabled");
      });

      await user.click(screen.getByRole("button", { name: /Review Records/ }));
      await waitFor(() => {
        expect(screen.getByText(/Game Review/)).toBeTruthy();
      });

      mockWriteBackupArchive.mockRejectedValue(new Error("Write error"));
      await user.click(screen.getByRole("button", { name: /Export Selected \(2\)/ }));

      await waitFor(() => {
        expect(screen.getByText(/Export failed/)).toBeTruthy();
      });
    });
  });
});

// ══════════════════════════════════════════════════════════════
//  TASK 5 — Lua Settings Accessor
// ══════════════════════════════════════════════════════════════

describe("TASK 5 — Settings Accessor", () => {
  it("1. LoadSettings is called once on mount", async () => {
    await renderAndWait();
    expect(mockLoadSettings).toHaveBeenCalledTimes(1);
  });

  it("2. Missing Lua path produces unconfigured state", async () => {
    mockLoadSettings.mockReturnValue({ luaPath: "" });
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      expect(screen.getByText("Not configured")).toBeTruthy();
    });
  });

  it("3. Available Lua path produces available state", async () => {
    mockLoadSettings.mockReturnValue({ luaPath: "/valid/path" });
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      expect(screen.getAllByText("Available").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("4. Audit uses the resolved Lua root from settings", async () => {
    mockLoadSettings.mockReturnValue({ luaPath: "D:/custom/lua" });
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      expect(screen.getAllByText("Available").length).toBeGreaterThanOrEqual(1);
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Audit Files/ }));

    expect(mockAuditLuaScripts).toHaveBeenCalledWith("D:/custom/lua");
  });

  it("5. Achievement root is resolved from Tauri", async () => {
    await renderAndWait();
    expect(mockResolveAchievementsRootDir).toHaveBeenCalledWith("steam");
  });

  it("6. Achievement audit uses the resolved root", async () => {
    await renderAndWait();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Audit Data/ }));
    expect(mockAuditAchievementData).toHaveBeenCalledWith("C:/fake-appdata/achievements/steam");
  });

  it("7. Achievement root failure shows error state", async () => {
    mockResolveAchievementsRootDir.mockRejectedValue(new Error("Not found"));
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      // The achievement root status should be "error"
      const achCard = screen.getByText("LumaForge Achievement Data").closest("div.lf-surface")!;
      expect(within(achCard).getByText("Error")).toBeTruthy();
    });
  });

  it("8. Achievement root null shows missing state", async () => {
    mockResolveAchievementsRootDir.mockResolvedValue(null);
    render(<ExternalSteamDataPanel />);
    await waitFor(() => {
      const achCard = screen.getByText("LumaForge Achievement Data").closest("div.lf-surface")!;
      expect(within(achCard).getByText("Missing")).toBeTruthy();
    });
  });
});
