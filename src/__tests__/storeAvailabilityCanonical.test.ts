/**
 * Store Availability Canonical Tests
 *
 * Validates:
 * - Lua-only games show "In Library" badge, not "Not in Library"
 * - Lua-only games show "Not Installed" button, not "Download Package"
 * - installStatus derivation: canonical library OR Lua scanner → "active"
 * - Steam-installed games still show provider status buttons
 * - Disabled Lua games show "Disabled" badge
 */

import { describe, it, expect } from "vitest";

type PackageInstallStatus = "not-installed" | "active" | "disabled";
type ProviderCheckState =
  | "idle" | "checking" | "no-sources" | "needs-config"
  | "no-data" | "unknown" | "up-to-date" | "update-available"
  | "provider-updating" | "provider-needs-refresh" | "provider-unavailable"
  | "auth-required" | "rate-limited" | "error";

// ── Inline copies of the tested functions (same as storeDetailsBoundary.test.ts pattern) ──

type ButtonConfig = {
  label: string;
  enabled: boolean;
  onClick: (() => void) | undefined;
  reason: string;
};

function getButtonConfig(
  providerCheckState: ProviderCheckState,
  luaInstalled: boolean,
  isSteamInstalled: boolean,
  steamOwned: boolean,
  isChecking: boolean,
  isNone: boolean,
  isNeedsConfig: boolean,
  needsRetry: boolean,
  canDownload: boolean,
  selectedSource: { fileType: string } | null | undefined,
  onDownload: (() => void) | undefined,
  onCheckForUpdates: (() => void) | undefined,
  _sourceProgress: unknown,
): ButtonConfig {
  if (isChecking) {
    return { label: "Checking sources...", enabled: false, onClick: undefined, reason: "checking-sources" };
  }

  // Steam-installed games: provider status always shown regardless of source checks
  if (isSteamInstalled) {
    if (steamOwned) {
      return { label: "Already in account", enabled: false, onClick: undefined, reason: "steam-owned" };
    }
    switch (providerCheckState) {
      case "update-available":
        return { label: "Update Package", enabled: true, onClick: onDownload, reason: "update-available" };
      case "no-data":
        return { label: "Check for updates", enabled: true, onClick: onCheckForUpdates, reason: "no-provider-data" };
      case "up-to-date":
        return { label: "Up to date", enabled: false, onClick: undefined, reason: "up-to-date" };
      case "unknown":
        return { label: "Check again", enabled: true, onClick: onCheckForUpdates, reason: "unknown-no-local-data" };
      case "provider-updating":
        return { label: "Provider updating", enabled: false, onClick: undefined, reason: "provider-updating" };
      case "provider-needs-refresh":
        return { label: "Provider needs refresh", enabled: false, onClick: undefined, reason: "provider-needs-refresh" };
      case "provider-unavailable":
        return { label: "Provider unavailable", enabled: false, onClick: undefined, reason: "provider-unavailable" };
      case "auth-required":
        return { label: "Auth required", enabled: false, onClick: undefined, reason: "auth-required" };
      case "rate-limited":
        return { label: "Rate limited", enabled: false, onClick: undefined, reason: "rate-limited" };
      case "error":
        return { label: "Check again", enabled: true, onClick: onCheckForUpdates, reason: "provider-error" };
      default:
        return { label: "Check for updates", enabled: true, onClick: onCheckForUpdates, reason: "default" };
    }
  }

  // Non-installed / Lua-only games
  if (isNone) {
    return { label: "No Sources Available", enabled: false, onClick: undefined, reason: "no-sources" };
  }
  if (isNeedsConfig) {
    return { label: "Configure Providers", enabled: false, onClick: undefined, reason: "needs-configuration" };
  }
  if (needsRetry) {
    return { label: "Source check failed", enabled: false, onClick: undefined, reason: "source-check-failed" };
  }
  if (steamOwned) {
    return { label: "Already in account", enabled: false, onClick: undefined, reason: "steam-owned" };
  }
  if (luaInstalled && !isSteamInstalled) {
    return { label: "Not Installed", enabled: false, onClick: undefined, reason: "lua-in-library-not-installed" };
  }
  if (!canDownload) {
    return { label: "Select a Source", enabled: false, onClick: undefined, reason: "no-source-selected" };
  }
  let label = "Download";
  if (selectedSource?.fileType === "lua") label = "Download Lua";
  else if (selectedSource?.fileType === "zip") label = "Download Package";
  return { label, enabled: true, onClick: onDownload, reason: "download-ready" };
}

function getStatusBadge(
  isSteamInstalled: boolean,
  installStatus: PackageInstallStatus,
  luaInstalled: boolean,
  _steamOwned: boolean,
): { label: string } | null {
  if (isSteamInstalled || (installStatus === "active" && luaInstalled === false)) {
    return { label: "Installed" };
  }
  if (installStatus === "active" || luaInstalled) {
    return { label: "In Library" };
  }
  if (installStatus === "disabled") {
    return { label: "Disabled" };
  }
  return null;
}

/** Simulates Store.tsx prop derivation for installStatus + luaInstalled */
function deriveStoreProps(
  ownershipIsLuaActive: boolean,
  scannerStatus: PackageInstallStatus | undefined,
) {
  const luaInstalled =
    ownershipIsLuaActive || scannerStatus === "active";

  const installStatus: PackageInstallStatus =
    scannerStatus === "disabled"
      ? "disabled"
      : (ownershipIsLuaActive || scannerStatus === "active")
        ? "active"
        : "not-installed";

  return { luaInstalled, installStatus };
}

// ── Default args for getButtonConfig (minimally configured) ──
const DEFAULTS = {
  providerCheckState: "idle" as ProviderCheckState,
  luaInstalled: false,
  isSteamInstalled: false,
  steamOwned: false,
  isChecking: false,
  isNone: false,
  isNeedsConfig: false,
  needsRetry: false,
  canDownload: false,
  selectedSource: null as { fileType: string } | null,
  onDownload: undefined as (() => void) | undefined,
  onCheckForUpdates: undefined as (() => void) | undefined,
  sourceProgress: null,
};

function btn(overrides: Partial<typeof DEFAULTS> = {}) {
  const c = { ...DEFAULTS, ...overrides };
  return getButtonConfig(
    c.providerCheckState, c.luaInstalled, c.isSteamInstalled, c.steamOwned,
    c.isChecking, c.isNone, c.isNeedsConfig, c.needsRetry, c.canDownload,
    c.selectedSource, c.onDownload, c.onCheckForUpdates, c.sourceProgress,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tests: getButtonConfig
// ═══════════════════════════════════════════════════════════════════

describe("getButtonConfig — Lua-only games", () => {
  it("shows 'Not Installed' for Lua-only game with available source", () => {
    const result = btn({ luaInstalled: true, canDownload: true });
    expect(result.label).toBe("Not Installed");
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("lua-in-library-not-installed");
  });

  it("shows 'Not Installed' for Lua-only game without source", () => {
    const result = btn({ luaInstalled: true, canDownload: false });
    expect(result.label).toBe("Not Installed");
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("lua-in-library-not-installed");
  });

  it("shows 'No Sources Available' for Lua-only game when no sources exist (in library but nothing to download)", () => {
    const result = btn({ luaInstalled: true, isNone: true });
    expect(result.label).toBe("No Sources Available");
    expect(result.reason).toBe("no-sources");
  });

  it("does NOT show 'Download Package' for Lua-only game", () => {
    const result = btn({ luaInstalled: true, canDownload: true });
    expect(result.label).not.toBe("Download Package");
    expect(result.label).not.toBe("Download Lua");
    expect(result.label).not.toBe("Download");
  });
});

describe("getButtonConfig — Steam-installed games", () => {
  it("shows 'Update Package' for Steam-installed game with update available", () => {
    const result = btn({
      isSteamInstalled: true,
      providerCheckState: "update-available",
    });
    expect(result.label).toBe("Update Package");
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("update-available");
  });

  it("shows 'Check for updates' for Steam-installed game with no provider data", () => {
    const result = btn({
      isSteamInstalled: true,
      providerCheckState: "no-data",
    });
    expect(result.label).toBe("Check for updates");
    expect(result.reason).toBe("no-provider-data");
  });

  it("shows 'Already in account' for Steam-owned + Steam-installed", () => {
    const result = btn({
      isSteamInstalled: true,
      steamOwned: true,
    });
    expect(result.label).toBe("Already in account");
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("steam-owned");
  });
});

describe("getButtonConfig — non-installed, non-Lua", () => {
  it("shows 'No Sources Available' when sources check returned none", () => {
    const result = btn({ isNone: true });
    expect(result.label).toBe("No Sources Available");
    expect(result.reason).toBe("no-sources");
  });

  it("shows 'Already in account' for Steam-owned non-installed game", () => {
    const result = btn({ steamOwned: true });
    expect(result.label).toBe("Already in account");
    expect(result.reason).toBe("steam-owned");
  });

  it("shows 'Download Package' when source selected and can download", () => {
    const result = btn({
      canDownload: true,
      selectedSource: { fileType: "zip" },
    });
    expect(result.label).toBe("Download Package");
    expect(result.enabled).toBe(true);
    expect(result.reason).toBe("download-ready");
  });

  it("shows 'Download Lua' for lua source", () => {
    const result = btn({
      canDownload: true,
      selectedSource: { fileType: "lua" },
    });
    expect(result.label).toBe("Download Lua");
    expect(result.reason).toBe("download-ready");
  });
});

describe("getButtonConfig — checking state overrides all", () => {
  it("returns checking even for Lua-only game", () => {
    const result = btn({ isChecking: true, luaInstalled: true });
    expect(result.label).toContain("Checking");
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("checking-sources");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tests: getStatusBadge
// ═══════════════════════════════════════════════════════════════════

describe("getStatusBadge", () => {
  it("shows 'Installed' for Steam-installed games", () => {
    expect(getStatusBadge(true, "active", true, true)?.label).toBe("Installed");
  });

  it("shows 'Installed' for active package (non-Lua) installed games", () => {
    expect(getStatusBadge(false, "active", false, false)?.label).toBe("Installed");
  });

  it("shows 'In Library' for Lua-only active games", () => {
    const badge = getStatusBadge(false, "active", true, false);
    expect(badge?.label).toBe("In Library");
  });

  it("shows 'In Library' when luaInstalled is true (independent of installStatus)", () => {
    const badge = getStatusBadge(false, "not-installed", true, false);
    expect(badge?.label).toBe("In Library");
  });

  it("shows 'Disabled' for disabled Lua games", () => {
    const badge = getStatusBadge(false, "disabled", false, false);
    expect(badge?.label).toBe("Disabled");
  });

  it("returns null for non-installed, non-Lua games", () => {
    expect(getStatusBadge(false, "not-installed", false, false)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tests: Store.tsx prop derivation
// ═══════════════════════════════════════════════════════════════════

describe("deriveStoreProps — canonical library + scanner fallback", () => {
  it("canonical Lua active + no scanner → active/active", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(true, undefined);
    expect(luaInstalled).toBe(true);
    expect(installStatus).toBe("active");
  });

  it("canonical Lua inactive + scanner active → active/active", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(false, "active");
    expect(luaInstalled).toBe(true);
    expect(installStatus).toBe("active");
  });

  it("both sources inactive → not-installed", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(false, undefined);
    expect(luaInstalled).toBe(false);
    expect(installStatus).toBe("not-installed");
  });

  it("scanner disabled + canonical active → luaInstalled=true (canonical is source of truth), installStatus=disabled", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(true, "disabled");
    expect(luaInstalled).toBe(true);
    expect(installStatus).toBe("disabled");
  });

  it("scanner disabled + canonical inactive → disabled", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(false, "disabled");
    expect(luaInstalled).toBe(false);
    expect(installStatus).toBe("disabled");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tests: Cross-surface consistency
// ═══════════════════════════════════════════════════════════════════

describe("cross-surface consistency", () => {
  it("Lua-only game: badge=In Library, button=Not Installed (not Download Package)", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(true, undefined);
    const badge = getStatusBadge(false, installStatus, luaInstalled, false);
    const button = btn({ luaInstalled, isSteamInstalled: false, steamOwned: false, canDownload: true, selectedSource: { fileType: "zip" } });

    expect(badge?.label).toBe("In Library");
    expect(button.label).toBe("Not Installed");
    expect(button.label).not.toBe("Download Package");
  });

  it("Lua-only game with no source: badge=In Library, button=Not Installed", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(true, undefined);
    const badge = getStatusBadge(false, installStatus, luaInstalled, false);
    const button = btn({ luaInstalled, isSteamInstalled: false, steamOwned: false, canDownload: false });

    expect(badge?.label).toBe("In Library");
    expect(button.label).toBe("Not Installed");
  });

  it("Steam-installed + Lua: badge=Installed, button=Update Package", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(true, undefined);
    const badge = getStatusBadge(true, installStatus, luaInstalled, false);
    const button = btn({ luaInstalled, isSteamInstalled: true, steamOwned: false, providerCheckState: "update-available" });

    expect(badge?.label).toBe("Installed");
    expect(button.label).toBe("Update Package");
  });

  it("Non-library game: no badge, Download when source available", () => {
    const { luaInstalled, installStatus } = deriveStoreProps(false, undefined);
    const badge = getStatusBadge(false, installStatus, luaInstalled, false);
    const button = btn({ luaInstalled, isSteamInstalled: false, steamOwned: false, canDownload: true, selectedSource: { fileType: "zip" } });

    expect(badge).toBeNull();
    expect(button.label).toBe("Download Package");
  });
});
