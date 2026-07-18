/**
 * Memory-first provider store for Epic Games Library entries.
 *
 * Pattern: module-level state + subscriber notification (same as manualGameStore).
 * No persistence to disk — Epic entries are re-scanned from manifests on each refresh.
 * No React dependency — subscribers re-apply games via LibraryGamesContext.
 *
 * Phase 1B boundary:
 *   - No auth, no owned games, no uninstalled games
 *   - Only local installed eligible entries
 *   - Scanner failure: retain previous valid entries, surface warning
 *   - Successful empty scan: replace with empty, remove stale entries
 *   - No duplicate listeners, one notification per meaningful replacement
 */

import type { LibraryGame } from "../types/libraryGame";
import {
  epicGameToLibraryGame,
  getEligibilityRejectionReasons,
  computeEpicFingerprint,
} from "./epicGameLibraryMapper";
import { EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LIBRARY } from "./epicFeatureFlag";
import type { MediaRole } from "./providerMediaPaths";

// ── Launch metadata ──

export type EpicLaunchMetadata = {
  appName?: string;
  namespace?: string;
  catalogItemId?: string;
  executablePath?: string;
  launchArguments?: string;
  processNames: string[];
  installLocation?: string;
  manifestPath?: string;
};

// ── Module-level state ──

let _epicGames: LibraryGame[] = [];
let _epicFingerprint = "";
let _scanWarning: string | null = null;
let _scanState: "idle" | "scanning" | "done" | "error" = "idle";
const _listeners = new Set<() => void>();
const _launchMetadataByProviderGameId = new Map<string, EpicLaunchMetadata>();

// ── Notification ──

function notifyListeners(): void {
  for (const listener of _listeners) {
    try {
      listener();
    } catch {
      // listener error must not break other listeners
    }
  }
}

// ── Media auto-discovery ──

const MEDIA_ROLES: MediaRole[] = ["cover", "landscape", "background", "logo", "icon"];

/**
 * Auto-discover media files on disk for Epic games that lack override paths.
 *
 * Only writes overrides when:
 * - No stored path exists for the role
 * - A valid file exists on disk for the role
 * - The discovered file is non-zero bytes
 *
 * Batches all override writes into a single notification cycle.
 */
async function autoDiscoverMediaPaths(
  games: Array<{ providerGameId?: string; coverPath?: string; landscapePath?: string; backgroundPath?: string; logoPath?: string; iconPath?: string }>,
): Promise<void> {
  const { discoverAllProviderMediaRoles } = await import("./gameCacheService");
  const { writeEpicOverrides } = await import("./epicOverrideStore");

  let anyWritten = false;

  for (const game of games) {
    if (!game.providerGameId) continue;

    const hasAllPaths =
      game.coverPath && game.landscapePath && game.backgroundPath && game.logoPath && game.iconPath;
    if (hasAllPaths) continue; // all roles already have paths — skip scan

    // Find what's missing
    const missingRoles = MEDIA_ROLES.filter((role) => {
      const pathKey = `${role}Path` as "coverPath" | "landscapePath" | "backgroundPath" | "logoPath" | "iconPath";
      return !(game as Record<string, string | undefined>)[pathKey];
    });
    if (missingRoles.length === 0) continue;

    // Scan the media directory for all roles in one batched IPC call
    try {
      const discovered = await discoverAllProviderMediaRoles("epic", game.providerGameId);
      if (Object.keys(discovered).length === 0) continue;

      // Build the override patch — only for missing roles with valid discovered files
      const patch: Record<string, string> = {};
      for (const role of missingRoles) {
        const path = discovered[role];
        if (path) {
          patch[`${role}Path`] = path;
        }
      }

      if (Object.keys(patch).length > 0) {
        writeEpicOverrides(game.providerGameId, patch);
        anyWritten = true;
        if (DEBUG_EPIC_LIBRARY) {
          console.log(
            `[EPIC_STORE][MEDIA_DISCOVER] game=${game.providerGameId} paths=${JSON.stringify(patch)}`,
          );
        }
      }
    } catch {
      // Discovery failure is non-fatal — continue with other games
    }
  }

  // One notification for all writes (already done per-write by writeEpicOverrides,
  // but the Epic store will rebuild once on the next mergeEpicOverrides call)
  if (anyWritten && DEBUG_EPIC_LIBRARY) {
    console.log("[EPIC_STORE][MEDIA_DISCOVER] auto-discovery complete");
  }
}

// ── Scan and replace ──

/**
 * Run Epic local scanner and replace in-memory entries with fresh results.
 *
 * On scanner failure: retain previous valid entries, set warning, notify once.
 * On successful empty scan: replace with empty array (stale entries removed).
 * On successful non-empty scan: replace all, clear warning, notify once.
 *
 * @param steamRoot — not used by Epic scanner, but kept for future multi-store integration
 */
export async function refreshEpicGames(
  _steamRoot?: string,
): Promise<{ count: number; warning: string | null }> {
  if (!EPIC_LIBRARY_ENABLED) {
    return { count: 0, warning: null };
  }

  _scanState = "scanning";

  try {
    const { scanEpicInstalledGames } = await import("./tauri");
    const result = await scanEpicInstalledGames();

    const entries = Array.isArray(result?.games) ? result.games : [];

    if (DEBUG_EPIC_LIBRARY) {
      console.log(
        `[EPIC_STORE] scan complete total=${entries.length} manifestDir=${result?.manifestDirectory ?? "null"}`,
      );
    }

    // Filter to eligible entries with per-record rejection logging
    const eligible: typeof entries = [];
    for (const entry of entries) {
      const reasons = getEligibilityRejectionReasons(entry);
      if (reasons.length === 0) {
        eligible.push(entry);
      } else if (DEBUG_EPIC_LIBRARY) {
        console.log(
          `[EPIC_STORE][REJECTION] id=${entry.providerGameId || entry.displayName || "?"} reasons=${reasons.join(",")}`,
        );
      }
    }

    if (DEBUG_EPIC_LIBRARY) {
      // Log raw record details for every entry
      for (const entry of entries) {
        const dirExists = entry.installLocation
          ? "present"
          : "missing";
        console.log(
          `[EPIC_STORE][RAW] id=${entry.providerGameId || "?"} ` +
          `title="${entry.displayName || "?"}" ` +
          `classification=${entry.classification} ` +
          `sourceKind=${entry.sourceKind} ` +
          `manifestValid=${entry.manifestValid} ` +
          `installed=${entry.installed} ` +
          `incompleteInstall=${entry.incompleteInstall} ` +
          `appName=${entry.appName || "null"} ` +
          `namespace=${entry.namespace || "null"} ` +
          `catalogItemId=${entry.catalogItemId || "null"} ` +
          `installLocation=${dirExists} ` +
          `executableExists=${entry.executableExists} ` +
          `processNames=${entry.processNames?.length ?? 0} ` +
          `mainGameAppName=${entry.mainGameAppName || "null"} ` +
          `mainGameCatalogItemId=${entry.mainGameCatalogItemId || "null"} ` +
          `warnings=${entry.warnings?.length ?? 0}`,
        );
      }
      console.log(
        `[EPIC_STORE] eligible=${eligible.length} filtered=${entries.length - eligible.length}`,
      );
    }

    // Retain launch metadata for eligible entries (needed by launch adapter)
    _launchMetadataByProviderGameId.clear();
    for (const game of eligible) {
      _launchMetadataByProviderGameId.set(game.providerGameId, {
        appName: game.appName,
        namespace: game.namespace,
        catalogItemId: game.catalogItemId,
        executablePath: game.executablePath,
        launchArguments: game.launchArguments,
        processNames: game.processNames,
        installLocation: game.installLocation,
        manifestPath: game.manifestPath,
      });
    }

    // Map to LibraryGame
    const rawMapped = eligible.map(epicGameToLibraryGame);

    // Apply user overrides (metadata + media paths) from localStorage
    const { mergeEpicOverrides } = await import("./epicOverrideStore");
    const mapped = rawMapped.map((g) =>
      mergeEpicOverrides(g as Record<string, unknown>, g.providerGameId ?? "") as typeof g,
    );

    // Auto-discover media files on disk for games missing override paths
    // This runs after mergeEpicOverrides so we can see which paths are still missing
    await autoDiscoverMediaPaths(mapped);

    // Re-apply overrides after auto-discovery wrote new paths
    const finalMapped = mapped.map((g) =>
      mergeEpicOverrides(g as Record<string, unknown>, g.providerGameId ?? "") as typeof g,
    );

    // Compute fingerprint of new state
    const newFingerprint = computeEpicFingerprint(finalMapped);

    // Detect meaningful change
    const fingerprintChanged = newFingerprint !== _epicFingerprint;

    // Replace state
    _epicGames = finalMapped;
    _epicFingerprint = newFingerprint;
    _scanWarning = null;
    _scanState = "done";

    // Notify only on meaningful change
    if (fingerprintChanged || finalMapped.length === 0) {
      if (DEBUG_EPIC_LIBRARY) {
        console.log(
          `[EPIC_STORE] replaced games=${finalMapped.length} fingerprintChanged=${fingerprintChanged}`,
        );
      }
      notifyListeners();
    } else if (DEBUG_EPIC_LIBRARY) {
      console.log(
        `[EPIC_STORE] no change games=${finalMapped.length} fingerprintUnchanged`,
      );
    }

    return { count: finalMapped.length, warning: null };
  } catch (error) {
    const warning = `Epic scan failed: ${error instanceof Error ? error.message : String(error)}`;

    // Scanner failure: retain previous valid entries
    _scanWarning = warning;
    _scanState = "error";

    if (DEBUG_EPIC_LIBRARY) {
      console.warn(`[EPIC_STORE] scan error — retaining ${_epicGames.length} previous entries`, error);
    }

    // Notify so UI can surface the warning
    notifyListeners();

    return { count: _epicGames.length, warning };
  }
}

// ── Sync reads ──

/** Return current Epic LibraryGame entries (sync, no scan). */
export function getAllEpicGames(): LibraryGame[] {
  return _epicGames;
}

/** Return a single Epic game by providerGameId. */
export function getEpicGame(providerGameId: string): LibraryGame | undefined {
  return _epicGames.find((g) => g.providerGameId === providerGameId);
}

/** Return current fingerprint. */
export function getEpicFingerprint(): string {
  return _epicFingerprint;
}

/** Return current scan state. */
export function getEpicScanState(): "idle" | "scanning" | "done" | "error" {
  return _scanState;
}

/** Return current scan warning (null if no warning). */
export function getEpicScanWarning(): string | null {
  return _scanWarning;
}

/** Return launch metadata for a specific Epic game (by providerGameId). */
export function getEpicLaunchMetadata(providerGameId: string): EpicLaunchMetadata | undefined {
  return _launchMetadataByProviderGameId.get(providerGameId);
}

// ── Subscription ──

/**
 * Subscribe to Epic game store changes.
 * Returns an unsubscribe function. Safe to call from React useEffect.
 * One notification per meaningful replacement — no duplicate listeners.
 */
export function subscribeEpicGames(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

// ── Cache management ──

/** Clear in-memory Epic cache. Used for testing or full rescan. */
export function resetEpicGameCache(): void {
  _epicGames = [];
  _epicFingerprint = "";
  _scanWarning = null;
  _scanState = "idle";
  _launchMetadataByProviderGameId.clear();

  if (DEBUG_EPIC_LIBRARY) {
    console.log(`[EPIC_STORE] cache reset`);
  }

  notifyListeners();
}

// ── Override change handling ──

let _overrideUnsubscribe: (() => void) | null = null;

/**
 * Subscribe to Epic override changes (metadata/media writes from GameEditDialog).
 * On change: re-apply overrides to the affected game and notify library.
 * Called once from epicGameStore init — safe to call multiple times (idempotent).
 */
export function initOverrideSubscription(): void {
  if (_overrideUnsubscribe) return;
  // Lazy import to avoid circular deps
  import("./epicOverrideStore").then(({ subscribeEpicOverridesChanged }) => {
    _overrideUnsubscribe = subscribeEpicOverridesChanged((providerGameId: string) => {
      applyEpicOverridesUpdate(providerGameId);
    });
  });
}

/**
 * Re-apply overrides for a single game and notify if the game changed.
 * Called when GameEditDialog writes to epicOverrideStore.
 * Debounced per-providerGameId to avoid redundant rebuilds on rapid saves
 * (e.g., applying multiple media roles in image search).
 */
const _overrideDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const OVERRIDE_DEBOUNCE_MS = 150;

function applyEpicOverridesUpdate(providerGameId: string): void {
  if (!EPIC_LIBRARY_ENABLED) return;

  const existing = _overrideDebounceTimers.get(providerGameId);
  if (existing) clearTimeout(existing);

  _overrideDebounceTimers.set(providerGameId, setTimeout(() => {
    _overrideDebounceTimers.delete(providerGameId);
    _applyEpicOverridesUpdateInner(providerGameId);
  }, OVERRIDE_DEBOUNCE_MS));
}

function _applyEpicOverridesUpdateInner(providerGameId: string): void {

  const idx = _epicGames.findIndex((g) => g.providerGameId === providerGameId);
  if (idx === -1) {
    // Game not in current Epic list — possibly not scanned yet; skip
    return;
  }

  // Re-apply overrides from localStorage
  import("./epicOverrideStore").then(({ mergeEpicOverrides }) => {
    const game = _epicGames[idx];
    const updated = mergeEpicOverrides(
      game as unknown as Record<string, unknown>,
      providerGameId,
    ) as LibraryGame;

    // Replace in array (immutably)
    _epicGames = [..._epicGames.slice(0, idx), updated, ..._epicGames.slice(idx + 1)];

    // Recompute fingerprint
    _epicFingerprint = computeEpicFingerprint(_epicGames);

    if (DEBUG_EPIC_LIBRARY) {
      console.log(
        `[EPIC_STORE] overrides applied providerGameId=${providerGameId} title="${updated.title}" hasMetadata=${!!(updated as any).metadata}`,
      );
    }

    // Always notify — metadata changes (description, genres, etc.) may not
    // affect the fingerprint but still need UI re-render
    notifyListeners();
  });
}
