/**
 * Pure mapper: EpicInstalledGame (Rust scan result) → LibraryGame.
 *
 * Eligible records (strict filter at call site):
 *   - classification === "baseGame"
 *   - manifestValid === true
 *   - installed === true
 *   - incompleteInstall === false
 *   - non-empty providerGameId
 *   - non-empty displayName
 *
 * Identity strategy: `{namespace}:{catalogItemId}` → `{namespace}:{appName}` → `{appName}`
 *
 * Phase 1B boundary:
 *   - No launch adapter → isPlayable = false
 *   - No Steam actions → steamInstalled = false, isInstallable = false
 *   - Provider-neutral isInstalled = true (game exists on disk)
 */

import type { LibraryGame } from "../types/libraryGame";
import type { EpicInstalledGame } from "./tauri";
import { EPIC_LAUNCH_ENABLED, EPIC_DIRECT_LAUNCH_ENABLED, EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LIBRARY } from "./epicFeatureFlag";

/**
 * Build a stable providerGameId from an Epic manifest.
 * Strategy: `{namespace}:{catalogItemId}:{appName}` → `{namespace}:{catalogItemId}` → `{namespace}:{appName}` → `{appName}`
 */
function buildProviderGameId(game: EpicInstalledGame): string {
  const ns = game.namespace || "";
  const catalogId = game.catalogItemId || "";
  const appName = game.appName || "";

  // Preferred: triple-identity (required for Epic protocol URIs)
  if (ns && catalogId && appName) return `${ns}:${catalogId}:${appName}`;
  if (ns && catalogId) return `${ns}:${catalogId}`;
  if (ns && appName) return `${ns}:${appName}`;
  return appName || `unknown-${game.installSize ?? 0}`;
}

/**
 * Map a single eligible Epic manifest entry to a LibraryGame.
 *
 * This function is pure — no side effects, no async, no network calls.
 */
export function epicGameToLibraryGame(game: EpicInstalledGame): LibraryGame {
  const providerGameId = buildProviderGameId(game);
  const libraryId = `epic:${providerGameId}`;

  // Derive isPlayable: Epic launch enabled + has a viable launch method
  // Protocol launch requires appName; direct executable requires EPIC_DIRECT_LAUNCH_ENABLED + executablePath
  const hasProtocol = !!game.appName;
  const hasDirect = EPIC_DIRECT_LAUNCH_ENABLED && !!game.executablePath;
  const canLaunch = EPIC_LAUNCH_ENABLED && EPIC_LIBRARY_ENABLED && (hasProtocol || hasDirect);

  const mapped: LibraryGame = {
    id: libraryId,
    title: game.displayName || "Unknown Epic Game",
    source: "epic",
    libraryId,
    providerId: "epic",
    providerGameId,

    // No Steam appId for Epic games
    appId: undefined,

    // Phase 2A: playable when launch adapter is enabled and launch identity exists
    isPlayable: canLaunch,
    // Phase 1B: no install/uninstall adapter → not installable via LumaForge
    isInstallable: false,
    // Phase 1B: no Steam install state
    steamInstalled: false,
    // Provider-neutral installed flag — game exists on disk
    isInstalled: true,

    // Paths from manifest
    installDir: game.installLocation || undefined,
    executablePath: game.executablePath || undefined,

    // No Lua
    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,

    // No Steam sources
    sources: [],

    // Metadata we have from the manifest
    sizeOnDisk: game.installSize || undefined,
    lastUpdated: undefined,
  };

  if (DEBUG_EPIC_LIBRARY) {
    console.log(
      `[EPIC_MAPPER] providerGameId=${providerGameId} title="${mapped.title}" executablePath=${game.executablePath || "null"} installDir=${game.installLocation || "null"} installed=${game.incompleteInstall ? "incomplete" : "ok"}`,
    );
  }

  return mapped;
}

/**
 * Return the exact rejection reasons for a scanner record.
 * Empty array = eligible.
 */
export function getEligibilityRejectionReasons(game: EpicInstalledGame): string[] {
  const reasons: string[] = [];
  if (game.classification !== "baseGame") reasons.push(`classification-${game.classification}`);
  if (!game.manifestValid) reasons.push("manifest-invalid");
  if (!game.installed) reasons.push("not-installed");
  if (game.incompleteInstall) reasons.push("incomplete-install");
  if (!game.providerGameId) reasons.push("provider-id-missing");
  if (!game.displayName || game.displayName.trim().length === 0) reasons.push("display-name-missing");
  return reasons;
}

/**
 * Filter predicate: is this Epic manifest entry eligible for Phase 1B inclusion?
 */
export function isEpicEntryEligible(game: EpicInstalledGame): boolean {
  return getEligibilityRejectionReasons(game).length === 0;
}

/**
 * Build a deterministic fingerprint for a set of Epic LibraryGame entries.
 * Used by the store to detect meaningful changes and avoid duplicate notifications.
 */
export function computeEpicFingerprint(games: LibraryGame[]): string {
  return games
    .slice()
    .sort((a, b) => (a.providerGameId || "").localeCompare(b.providerGameId || ""))
    .map(
      (g) =>
        `${g.providerGameId}:${g.title}:${!!g.isInstalled}:${!!g.isPlayable}:${!!g.executablePath}:${!!g.installDir}:${g.sizeOnDisk ?? ""}:${g.lastUpdated ?? ""}`,
    )
    .join("|");
}
