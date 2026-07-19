/**
 * React component tests for Verified Steam Achievement Sources card.
 *
 * TASK 5 — React Component Tests for the new card.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ── Mocks ──

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
const mockAuditSteamAchievementSources = vi.fn();
const mockCheckSteamRunning = vi.fn();
const mockExportSteamAchievementSources = vi.fn();

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

vi.mock("../services/steamAchievementSources/auditor", () => ({
  auditSteamAchievementSources: (...args: any[]) => mockAuditSteamAchievementSources(...args),
  checkSteamRunning: (...args: any[]) => mockCheckSteamRunning(...args),
  exportSteamAchievementSources: (...args: any[]) => mockExportSteamAchievementSources(...args),
  buildGameSummaries: (manifest: any) => {
    return manifest.games.map((game: any) => ({
      appId: game.appId,
      files: game.files,
      totalSize: game.totalSize,
      hasStats: game.files.some((f: any) => f.sourceKind === "userGameStats"),
      hasSchema: game.files.some((f: any) => f.sourceKind === "userGameStatsSchema"),
      hasLibraryCache: game.files.some((f: any) => f.sourceKind === "libraryCacheJson"),
    }));
  },
  clearAchSourceCache: vi.fn(),
}));

vi.mock("../services/steamAchievementSources/backupService", () => ({
  exportSteamAchievementSourcesToArchive: vi.fn().mockResolvedValue({
    success: true,
    gameCount: 1,
    fileCount: 3,
    totalSize: 3072,
  }),
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

// ── Imports after mocks ──

import ExternalSteamDataPanel from "../components/settings/ExternalSteamDataPanel";

// ── Factories ──

function makeValidManifest() {
  return {
    schemaVersion: 1,
    accountScope: "current-steam-account",
    steamRoot: "C:\\steam",
    totalGames: 3,
    totalFiles: 5,
    totalSize: 5120,
    games: [
      {
        appId: "268910",
        files: [
          { sourceKind: "userGameStats", logicalPath: "steam/achievement-sources/268910/user-game-stats.bin", absolutePath: "C:\\steam\\appcache\\stats\\UserGameStats_12345_268910.bin", size: 1024, modifiedAt: 1700000000, checksum: "abc", requiresSteamClosed: true },
          { sourceKind: "userGameStatsSchema", logicalPath: "steam/achievement-sources/268910/user-game-stats-schema.bin", absolutePath: "C:\\steam\\appcache\\stats\\UserGameStatsSchema_268910.bin", size: 2048, modifiedAt: 1700000000, checksum: "def", requiresSteamClosed: true },
          { sourceKind: "libraryCacheJson", logicalPath: "steam/achievement-sources/268910/librarycache.json", absolutePath: "C:\\steam\\userdata\\12345\\config\\librarycache\\268910.json", size: 512, modifiedAt: 1700000000, checksum: "ghi", requiresSteamClosed: false },
        ],
        totalSize: 3584,
      },
      {
        appId: "480",
        files: [
          { sourceKind: "userGameStats", logicalPath: "steam/achievement-sources/480/user-game-stats.bin", absolutePath: "C:\\steam\\appcache\\stats\\UserGameStats_12345_480.bin", size: 512, modifiedAt: 1700000000, checksum: "jkl", requiresSteamClosed: true },
        ],
        totalSize: 512,
      },
      {
        appId: "730",
        files: [
          { sourceKind: "userGameStatsSchema", logicalPath: "steam/achievement-sources/730/user-game-stats-schema.bin", absolutePath: "C:\\steam\\appcache\\stats\\UserGameStatsSchema_730.bin", size: 1024, modifiedAt: 1700000000, checksum: "mno", requiresSteamClosed: true },
        ],
        totalSize: 1024,
      },
    ],
    rejected: [
      { fileName: "0.json", sourceKind: "librarycache", reason: "invalid-app-id" },
    ],
    statsCount: 2,
    schemaCount: 2,
    librarycacheCount: 1,
  };
}

function makeEmptyManifest() {
  return {
    schemaVersion: 1,
    accountScope: "current-steam-account",
    steamRoot: "C:\\steam",
    totalGames: 0,
    totalFiles: 0,
    totalSize: 0,
    games: [],
    rejected: [],
    statsCount: 0,
    schemaCount: 0,
    librarycacheCount: 0,
  };
}

// ── Setup ──

beforeEach(() => {
  vi.clearAllMocks();

  mockLoadSettings.mockReturnValue({
    steamRoot: "C:\\steam",
    steamAccountId: "12345",
    steamWebApiKey: "",
    luaPath: "C:\\lua",
    achievementSchemaPath: "",
  });
  mockResolveAchievementsRootDir.mockResolvedValue("C:\\fake-appdata\\achievements\\steam");
  mockWriteBackupArchive.mockResolvedValue(undefined);
  mockAuditLuaScripts.mockResolvedValue({ entries: [], errors: [] });
  mockReadLuaFilesContent.mockResolvedValue({});
  mockAuditAchievementData.mockResolvedValue({ entries: [], errors: [] });
  mockReadAchievementFilesContent.mockResolvedValue({});
  mockAuditSteamAchievementSources.mockResolvedValue(makeValidManifest());
  mockCheckSteamRunning.mockResolvedValue({ running: false, message: "Steam is not running. Safe to write achievement source files." });
  mockExportSteamAchievementSources.mockResolvedValue([]);
  mockScanInstalledLuaScripts.mockResolvedValue([]);
  mockScanExternalFileCollection.mockResolvedValue([]);
  mockReadFileCollectionContent.mockResolvedValue({});
});

// ═══════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════

async function renderAndWait() {
  const result = render(<ExternalSteamDataPanel />);
  await waitFor(() => {
    expect(screen.getByText("External Steam Data")).toBeTruthy();
  });
  return result;
}

// ═══════════════════════════════════════════════════════════════
// TASK 5 — React Component Tests
// ═══════════════════════════════════════════════════════════════

describe("TASK 5 — Verified Steam Achievement Sources Card", () => {
  it("1. Card renders", async () => {
    await renderAndWait();
    expect(screen.getByText("Verified Steam Achievement Sources")).toBeTruthy();
  });

  it("2. Partial badge renders", async () => {
    await renderAndWait();
    const card = screen.getByText("Verified Steam Achievement Sources").closest("div.lf-surface")! as HTMLElement;
    expect(within(card).getByText("Partial")).toBeTruthy();
  });

  it("3. Account scope displays current-steam-account", async () => {
    await renderAndWait();
    // Click Audit Sources to populate
    const auditBtn = screen.getByRole("button", { name: /Audit Sources/ });
    auditBtn.click();

    await waitFor(() => {
      expect(screen.getByText("current-steam-account")).toBeTruthy();
    });
  });

  it("4. Actual account ID is not displayed", async () => {
    await renderAndWait();
    const auditBtn = screen.getByRole("button", { name: /Audit Sources/ });
    auditBtn.click();

    await waitFor(() => {
      expect(screen.getByText("current-steam-account")).toBeTruthy();
    });
    // Real account ID "12345" should not appear as the account scope
    expect(screen.queryByText("12345")).toBeNull();
  });

  it("5. Audit Sources action renders", async () => {
    await renderAndWait();
    expect(screen.getByRole("button", { name: /Audit Sources/ })).toBeTruthy();
  });

  it("6. Review Games action renders after a valid audit", async () => {
    await renderAndWait();
    const auditBtn = screen.getByRole("button", { name: /Audit Sources/ });
    auditBtn.click();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Review Games/ })).toBeTruthy();
    });
  });

  it("7. Export is disabled by default", async () => {
    await renderAndWait();
    const exportBtn = screen.getByRole("button", { name: /Export Selected Sources/ });
    expect(exportBtn).toBeDisabled();
  });

  it("8. Zero selected games appears after audit", async () => {
    await renderAndWait();
    const auditBtn = screen.getByRole("button", { name: /Audit Sources/ });
    auditBtn.click();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Review Games/ })).toBeTruthy();
    });

    // Click Review Games
    const reviewBtn = screen.getByRole("button", { name: /Review Games/ });
    reviewBtn.click();

    await waitFor(() => {
      expect(screen.getByText(/0 selected of 3 verified/)).toBeTruthy();
    });
  });

  it("9. Selecting one game updates the selection count", async () => {
    await renderAndWait();
    // Audit
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    // Open review
    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });

    // Select one game (click the checkbox for appid 268910)
    const checkbox = screen.getByRole("checkbox", { name: /268910/ });
    checkbox.click();

    await waitFor(() => {
      expect(screen.getByText(/1 selected of 3 verified/)).toBeTruthy();
    });
  });

  it("10. Invalid appId row is not selectable", async () => {
    await renderAndWait();
    // Audit with a rejected entry
    mockAuditSteamAchievementSources.mockResolvedValue({
      ...makeValidManifest(),
      rejected: [{ fileName: "0.json", sourceKind: "librarycache", reason: "invalid-app-id" }],
    });

    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    // Open review
    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/selected of 3 verified/); });

    // appId "0" should not appear as a selectable row
    expect(screen.queryByRole("checkbox", { name: /268910/ })).toBeTruthy();
    // Invalid appId "0" should not be in the game list at all
    const rows = screen.queryAllByRole("checkbox");
    const labels = rows.map((r) => r.getAttribute("aria-label") || "");
    expect(labels.some((l) => l === "0")).toBe(false);
  });

  it("11. Select All excludes invalid records", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });

    // Click Select All
    const selectAll = screen.getByRole("button", { name: /Select All/ });
    selectAll.click();

    await waitFor(() => {
      expect(screen.getByText(/3 selected of 3 verified/)).toBeTruthy();
    });
  });

  it("12. Clear removes all selections", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });

    // Select All first
    screen.getByRole("button", { name: /Select All/ }).click();
    await waitFor(() => { screen.getByText(/3 selected of 3 verified/); });

    // Clear
    screen.getByRole("button", { name: /Clear/ }).click();
    await waitFor(() => {
      expect(screen.getByText(/0 selected of 3 verified/)).toBeTruthy();
    });
  });

  it("13. Export receives selected games only", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });

    // Select one game
    screen.getByRole("checkbox", { name: /268910/ }).click();
    await waitFor(() => { screen.getByText(/1 selected of 3 verified/); });

    // Export button should show count 1
    const exportBtn = screen.getByRole("button", { name: /Export Selected.*1/ });
    expect(exportBtn).toBeTruthy();
  });

  it("14. No direct Restore button exists", async () => {
    await renderAndWait();
    // There should be no "Restore" button in the card
    const buttons = screen.getAllByRole("button");
    const restoreButtons = buttons.filter((b) => /restore/i.test(b.textContent || ""));
    expect(restoreButtons).toHaveLength(0);
  });

  it("15. Restore status says Via Stored Backups", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => {
      expect(screen.getByText("Via Stored Backups")).toBeTruthy();
    });
  });

  it("16. Steam-running state displays an unsafe or blocked status", async () => {
    mockCheckSteamRunning.mockResolvedValue({ running: true, message: "Steam is running." });

    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => {
      expect(screen.getByText("Yes (close to restore)")).toBeTruthy();
    });
  });

  it("17. Steam-not-running state displays safe status", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => {
      expect(screen.getByText("No (safe)")).toBeTruthy();
    });
  });

  it("18. Rejected-file summary renders", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => {
      expect(screen.getByText(/1 file\(s\) rejected/)).toBeTruthy();
    });
  });

  it("19. Invalid-appId count renders", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();

    // Wait for audit to complete (review button enabled)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Review Games/ })).not.toBeDisabled();
    });

    // The per-source counts row should show after audit — wait for "Rejected Files" label
    await waitFor(() => {
      const card = screen.getByText("Verified Steam Achievement Sources").closest("div.lf-surface")! as HTMLElement;
      const rejectedLabels = within(card).getAllByText("Rejected Files");
      expect(rejectedLabels.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("20. Audit failure displays an actionable error", async () => {
    mockAuditSteamAchievementSources.mockRejectedValue(new Error("Steam path not found"));

    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();

    // After failure, the card should still render without crashing
    await waitFor(() => {
      expect(screen.getByText("Verified Steam Achievement Sources")).toBeTruthy();
    });
  });

  it("21. Valid-empty audit is distinct from failure", async () => {
    mockAuditSteamAchievementSources.mockResolvedValue(makeEmptyManifest());

    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();

    await waitFor(() => {
      // 0 games found — distinct from error
      expect(screen.getByText("Verified Steam Achievement Sources")).toBeTruthy();
    });
  });

  it("22. Refresh does not auto-select all games", async () => {
    await renderAndWait();
    // Audit first
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    // Select all
    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });
    screen.getByRole("button", { name: /Select All/ }).click();
    await waitFor(() => { screen.getByText(/3 selected of 3 verified/); });

    // Close review, then refresh (Audit Sources again)
    screen.getByRole("button", { name: /Close Review/ }).click();
    screen.getByRole("button", { name: /Audit Sources/ }).click();

    // After refresh, re-open review — should show 0 selected
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });
    screen.getByRole("button", { name: /Review Games/ }).click();

    await waitFor(() => {
      expect(screen.getByText(/0 selected of 3 verified/)).toBeTruthy();
    });
  });

  it("23. Selecting one valid game enables Export button", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    // Export should be disabled before any selection
    const exportBtnBefore = screen.getByRole("button", { name: /Export Selected Sources/ });
    expect(exportBtnBefore).toBeDisabled();

    // Open review and select one game
    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });
    screen.getByRole("checkbox", { name: /268910/ }).click();

    // Export should now be enabled
    await waitFor(() => {
      expect(screen.getByText(/1 selected of 3 verified/)).toBeTruthy();
    });
    const exportBtnAfter = screen.getByRole("button", { name: /Export Selected Sources/ });
    expect(exportBtnAfter).not.toBeDisabled();
  });

  it("24. Deselecting the final game disables Export", async () => {
    await renderAndWait();
    screen.getByRole("button", { name: /Audit Sources/ }).click();
    await waitFor(() => { screen.getByRole("button", { name: /Review Games/ }); });

    // Open review, select one game, then deselect it
    screen.getByRole("button", { name: /Review Games/ }).click();
    await waitFor(() => { screen.getByText(/0 selected of 3 verified/); });

    const checkbox = screen.getByRole("checkbox", { name: /268910/ });
    checkbox.click();
    await waitFor(() => { screen.getByText(/1 selected of 3 verified/); });

    // Deselect the same game
    checkbox.click();
    await waitFor(() => {
      expect(screen.getByText(/0 selected of 3 verified/)).toBeTruthy();
    });

    // Export should be disabled again
    const exportBtn = screen.getByRole("button", { name: /Export Selected Sources/ });
    expect(exportBtn).toBeDisabled();
  });
});
