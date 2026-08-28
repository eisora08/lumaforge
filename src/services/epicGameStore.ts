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
 *
 * Phase 2: Added online library sync (owned games from Epic API).
 */

import type { LibraryGame } from "../types/libraryGame";
import {
  epicGameToLibraryGame,
  getEligibilityRejectionReasons,
  computeEpicFingerprint,
} from "./epicGameLibraryMapper";
import { EPIC_LIBRARY_ENABLED, DEBUG_EPIC_LIBRARY } from "./epicFeatureFlag";
import { mergeEpicOverrides } from "./epicOverrideStore";
import type { MediaRole } from "./providerMediaPaths";
import type { EpicMetadataResult } from "./tauri";

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

// ── Owned games state (Phase 2) ──

let _ownedGames: LibraryGame[] = [];
let _ownedFingerprint = "";
let _ownedScanState: "idle" | "scanning" | "done" | "error" = "idle";
let _ownedScanWarning: string | null = null;
let _syncedPlaytime = new Map<string, number>(); // appName → totalPlaytime

// ── Session-level metadata cache ──
// Tracks which games have already had metadata fetched this session.
// Prevents redundant API calls + downloads on re-import, mode switch, etc.
const _metadataFetchedThisSession = new Set<string>();

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

// ── Title correction helpers ──

/**
 * Heuristic for a manifest title that is NOT a proper human-readable title.
 * Epic often stores the internal codename ("Calluna") or a 32-hex appName hash
 * as DisplayName; both should be replaced with the real catalog title.
 */
function isSuspiciousEpicTitle(title: string): boolean {
  const t = (title || "").trim();
  if (!t) return true;
  // Pure 32-hex hash (Epic catalogItemId / appName hash)
  if (/^[0-9a-f]{32}$/i.test(t)) return true;
  // Single lowercase codename slug with no spaces (e.g. "calluna", "alpha-b18")
  if (/^[a-z][a-z0-9-]{1,24}$/.test(t)) return true;
  return false;
}

/**
 * Apply an EpicMetadataResult (title/artwork/metadata) to a game.
 * Artwork is applied directly; a corrected title is persisted to the override
 * store so it survives restart (mirrors Debrid's sticky-title approach).
 */
async function applyEpicMetadataToGame(
  game: LibraryGame,
  result: EpicMetadataResult,
): Promise<void> {
  const a = result.artwork ?? {};
  const patch: Record<string, string> = {};

  if (a.cover) { game.coverPath = a.cover; patch.coverPath = a.cover; }
  if (a.landscape) { game.landscapePath = a.landscape; patch.landscapePath = a.landscape; }
  if (a.background) { game.backgroundPath = a.background; patch.backgroundPath = a.background; }
  if (a.logo) { game.logoPath = a.logo; patch.logoPath = a.logo; }
  if (a.icon) { game.iconPath = a.icon; patch.iconPath = a.icon; }

  // Title correction: replace codename/hash with the real catalog title.
  // A name override is written so the corrected title is stable across restarts
  // and is applied everywhere mergeEpicOverrides runs (boot + refresh).
  const providerGameId = game.providerGameId;
  if (providerGameId && result.title && result.title.trim()) {
    const current = (game.title || "").trim();
    const resolved = result.title.trim();
    if (current !== resolved && isSuspiciousEpicTitle(current)) {
      game.title = resolved;
      patch.name = resolved;
    }
  }

  if (result.description || result.developer) {
    (game as Record<string, unknown>).metadata = {
      ...((game.metadata as Record<string, unknown>) || {}),
      resolved: true,
      name: result.title || game.title,
      short_description: result.description || undefined,
      about_the_game: result.description || undefined,
      developer: result.developer || undefined,
      genres: [],
      categories: [],
      release_date: result.releaseDate || undefined,
    };
  }

  if (Object.keys(patch).length > 0 && providerGameId) {
    const { writeEpicOverrides } = await import("./epicOverrideStore");
    writeEpicOverrides(providerGameId, patch);
  }
}

/**
 * Enrich a set of Epic games (title correction + catalog artwork/metadata) in
 * the background. Reuses the session dedup so each providerGameId is fetched
 * at most once per session. Corrected titles + artwork are persisted to the
 * override store and games are re-saved to SQLite afterwards.
 */
async function enrichEpicGamesFromCatalog(games: LibraryGame[]): Promise<void> {
  try {
    const { epicFetchAndSaveMetadata } = await import("./tauri");
    for (const game of games) {
      const providerGameId = game.providerGameId;
      if (!providerGameId || _metadataFetchedThisSession.has(providerGameId)) continue;
      const parts = providerGameId.split(":");
      if (parts.length < 2) continue;
      const [ns, catId] = parts;
      if (!ns || !catId) continue;
      // Skip if we already have artwork AND the title doesn't need correction.
      const titleNeedsWork = isSuspiciousEpicTitle(game.title || "");
      if (game.coverPath && !titleNeedsWork) continue;
      try {
        const result = await epicFetchAndSaveMetadata(providerGameId, ns, catId);
        _metadataFetchedThisSession.add(providerGameId);
        await applyEpicMetadataToGame(game, result);
      } catch {
        // Artwork/metadata fetch failed for this game — continue with others
      }
    }

    // Persist any corrections so next boot loads full data instantly.
    notifyListeners();
    persistEpicGamesToSqlite([..._epicGames, ..._ownedGames]).catch(() => {});
  } catch (err) {
    console.warn("[EPIC_STORE] catalog enrichment failed:", err);
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

  // Re-entry guard: skip if already scanning
  if (_scanState === "scanning") {
    return { count: _epicGames.length, warning: null };
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

    // Persist to SQLite so next boot loads complete data (names + media) instantly.
    persistEpicGamesToSqlite([...finalMapped, ..._ownedGames]).catch(() => {});

    // Fire-and-forget: enrich titles/artwork from the catalog for installed games.
    // Runs from the local scanner path too, so corrections apply even without an
    // Epic login (owned-games sync is not a prerequisite).
    enrichEpicGamesFromCatalog(_epicGames).catch(() => {});

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

// ── Owned games (Phase 2: Online Library Sync) ──

/**
 * Fetch owned games from the Epic API and merge them with installed games.
 *
 * Owned games that are NOT installed appear as "owned, not installed" entries.
 * Installed games are enriched with playtime data.
 */
export async function refreshOwnedGames(): Promise<{
  count: number;
  warning: string | null;
}> {
  if (!EPIC_LIBRARY_ENABLED) {
    return { count: 0, warning: null };
  }

  // Re-entry guard: skip if already scanning
  if (_ownedScanState === "scanning") {
    return { count: _ownedGames.length, warning: null };
  }

  try {
    _ownedScanState = "scanning";
    _ownedScanWarning = null;

    const { epicSyncLibrary } = await import("./tauri");
    const result = await epicSyncLibrary();

    // Build playtime map
    _syncedPlaytime = new Map();
    for (const pt of result.playtime) {
      if (pt.artifactId && pt.totalTime) {
        _syncedPlaytime.set(pt.artifactId, pt.totalTime);
      }
    }

    // Convert owned games to LibraryGame entries
    const ownedMapped: LibraryGame[] = [];
    const installedAppNames = new Set(
      _epicGames.map((g) => g.providerGameId?.split(":").pop()).filter(Boolean),
    );

    for (const owned of result.ownedGames) {
      // Skip if already installed (will be enriched separately)
      if (installedAppNames.has(owned.appName)) continue;

      // Build providerGameId (triple-identity for protocol URIs)
      const providerGameId = owned.namespace && owned.catalogItemId && owned.appName
        ? `${owned.namespace}:${owned.catalogItemId}:${owned.appName}`
        : owned.namespace && owned.catalogItemId
          ? `${owned.namespace}:${owned.catalogItemId}`
          : owned.appName;

      // Skip if no valid ID
      if (!providerGameId) continue;

      // Get playtime
      const playtime = _syncedPlaytime.get(owned.appName) || 0;

      // Build minimal LibraryGame for uninstalled owned games
      const game: LibraryGame = {
        id: `epic:${providerGameId}`,
        libraryId: `epic:${providerGameId}`,
        title: owned.labelName || owned.appName,
        source: "epic",
        providerId: "epic",
        providerGameId,
        isInstalled: false,
        localPlaytimeMinutes: Math.floor(playtime / 60),
        localLastPlayedAt: 0,
        // Steam-specific fields (not applicable)
        steamInstalled: false,
        steamPlaytimeMinutes: 0,
        steamPlaytime2Weeks: 0,
        steamLastPlayedAt: 0,
        steamCloudStatus: "",
        isPlayable: false,
        isInstallable: true,
        hasLua: false,
        isLuaActive: false,
        isLuaDisabled: false,
        hasLuaSource: false,
        sources: [],
        luaScripts: [],
        sizeOnDisk: 0,
        // Override fields
        coverPath: "",
        landscapePath: "",
        backgroundPath: "",
        logoPath: "",
        iconPath: "",
        // Metadata fields
        executablePath: "",
        workingDirectory: "",
        launchArguments: "",
        installDir: "",
        libraryPath: "",
        repacker: "",
        imageUrl: "",
        // Achievement fields
        achievementUnlocked: 0,
        achievementTotal: 0,
        achievementsSupported: false,
        completionStatus: "not-played",
        isFavorite: false,
        isStandalone: false,
        customTitle: "",
        linkedSteamAppId: "",
        linkedIgdbId: "",
        hasUpdate: false,
        debridStatus: "",
      };

      ownedMapped.push(game);
    }

    // Enrich installed games with playtime
    for (const installed of _epicGames) {
      const appName = installed.providerGameId?.split(":").pop();
      if (appName) {
        const playtime = _syncedPlaytime.get(appName) || 0;
        if (playtime > 0 && (installed.localPlaytimeMinutes || 0) < Math.floor(playtime / 60)) {
          installed.localPlaytimeMinutes = Math.floor(playtime / 60);
        }
      }
    }

    // Compute fingerprint
    const newFingerprint = computeEpicFingerprint([..._epicGames, ...ownedMapped]);
    const fingerprintChanged = newFingerprint !== _ownedFingerprint;

    // Replace state
    _ownedGames = ownedMapped.map((g) =>
      g.providerGameId
        ? (mergeEpicOverrides(g as unknown as Record<string, unknown>, g.providerGameId) as LibraryGame)
        : g,
    );
    _ownedFingerprint = newFingerprint;
    _ownedScanState = "done";

    if (DEBUG_EPIC_LIBRARY) {
      console.log(
        `[EPIC_STORE] owned sync: owned=${ownedMapped.length} installed=${_epicGames.length} fingerprintChanged=${fingerprintChanged}`,
      );
    }

    // Fire-and-forget: fetch artwork + metadata (and correct titles) for games.
    // Runs for both owned and installed games. Corrected titles and artwork are
    // persisted to the override store + SQLite so next boot has full data instantly.
    enrichEpicGamesFromCatalog([...ownedMapped, ..._epicGames]).catch((err) =>
      console.warn("[EPIC_STORE] metadata fetch batch failed:", err),
    );

    // Notify on change
    if (fingerprintChanged || ownedMapped.length === 0) {
      notifyListeners();
    }

    return { count: ownedMapped.length, warning: null };
  } catch (error) {
    const warning = `Epic owned games sync failed: ${error instanceof Error ? error.message : String(error)}`;
    _ownedScanWarning = warning;
    _ownedScanState = "error";

    if (DEBUG_EPIC_LIBRARY) {
      console.warn(`[EPIC_STORE] owned sync error`, error);
    }

    notifyListeners();
    return { count: _ownedGames.length, warning };
  }
}

// ── Cache loading (from SQLite on boot) ──

/**
 * Load Epic games from SQLite cache into memory on boot.
 * This makes Epic games appear instantly without waiting for manifest scan + API call.
 */
export function loadEpicGamesFromCache(cachedGames: Array<{
  appId: string;
  title: string;
  installed: boolean;
  playtime: number;
  lastPlayed: number;
  provider?: string;
  mediaJson?: string;
}>): void {
  const UUID_RE = /^[0-9a-f]{32}$/i;
  const libGames: LibraryGame[] = cachedGames.map((g) => {
    const media = g.mediaJson ? (() => { try { return JSON.parse(g.mediaJson); } catch { return {}; } })() : {};
    const providerGameId = g.appId.replace(/^epic:/, "");
    const libraryId = g.appId;
    // If title is a UUID-like catalogItemId, use the appName (last segment of providerGameId) as fallback
    let title = g.title || "Unknown Epic Game";
    if (UUID_RE.test(title)) {
      const parts = providerGameId.split(":");
      const appName = parts[parts.length - 1];
      if (appName && !UUID_RE.test(appName)) title = appName;
    }
    return {
      id: g.appId,
      title,
      source: "epic",
      libraryId,
      providerId: "epic",
      providerGameId,
      appId: undefined,
      isPlayable: true,
      isInstallable: false,
      steamInstalled: false,
      isInstalled: g.installed,
      steamPlaytimeMinutes: g.playtime,
      steamLastPlayedAt: g.lastPlayed,
      coverPath: media.coverPath || undefined,
      landscapePath: media.landscapePath || undefined,
      backgroundPath: media.backgroundPath || undefined,
      logoPath: media.logoPath || undefined,
      iconPath: media.iconPath || undefined,
      luaScripts: [],
      hasLua: false,
      isLuaActive: false,
      isLuaDisabled: false,
      hasLuaSource: false,
      sources: [],
    } as LibraryGame;
  });

  // Separate installed vs owned
  const installed = libGames.filter((g) => g.isInstalled);
  const owned = libGames.filter((g) => !g.isInstalled);

  // Apply persisted overrides (corrected titles + media) to BOTH installed and
  // owned games so boot shows the real name and images on the first frame —
  // not the raw manifest codename/hash.
  const applyOverrides = (g: LibraryGame) =>
    g.providerGameId
      ? (mergeEpicOverrides(g as unknown as Record<string, unknown>, g.providerGameId) as LibraryGame)
      : g;

  if (installed.length > 0) _epicGames = installed.map(applyOverrides);
  if (owned.length > 0) _ownedGames = owned.map(applyOverrides);

  _epicFingerprint = computeEpicFingerprint([..._epicGames, ..._ownedGames]);
  _ownedFingerprint = _epicFingerprint;
  _scanState = installed.length > 0 ? "done" : _scanState;
  _ownedScanState = owned.length > 0 ? "done" : _ownedScanState;

  if (DEBUG_EPIC_LIBRARY) {
    console.log(`[EPIC_STORE] loaded from cache: installed=${installed.length} owned=${owned.length}`);
  }

  notifyListeners();
}

/** Return all Epic games (installed + owned). */
export function getAllEpicGamesIncludingOwned(): LibraryGame[] {
  return [
    ..._epicGames,
    ..._ownedGames.map((g) =>
      g.providerGameId
        ? (mergeEpicOverrides(g as unknown as Record<string, unknown>, g.providerGameId) as LibraryGame)
        : g,
    ),
  ];
}

/** Return only owned (not installed) Epic games. */
export function getOwnedEpicGames(): LibraryGame[] {
  return _ownedGames.map((g) =>
    g.providerGameId
      ? (mergeEpicOverrides(g as unknown as Record<string, unknown>, g.providerGameId) as LibraryGame)
      : g,
  );
}

/** Return owned games scan state. */
export function getOwnedScanState(): "idle" | "scanning" | "done" | "error" {
  return _ownedScanState;
}

/** Return owned games scan warning. */
export function getOwnedScanWarning(): string | null {
  return _ownedScanWarning;
}

/** Get playtime for a specific game (from synced data). */
export function getEpicPlaytime(appName: string): number {
  return _syncedPlaytime.get(appName) || 0;
}

// ── SQLite persistence ──

/**
 * Persist Epic games to SQLite so they load instantly on next boot.
 * Fire-and-forget — errors are non-critical.
 */
async function persistEpicGamesToSqlite(games: LibraryGame[]): Promise<void> {
  if (games.length === 0) return;
  try {
    const { batchUpsertGames } = await import("./tauri");
    const entries = games
      .filter((g) => g.id)
      .map((g) => ({
        appId: g.id!,
        title: g.title || "Unknown",
        installed: g.isInstalled || false,
        playtime: g.steamPlaytimeMinutes ?? 0,
        lastPlayed: g.steamLastPlayedAt ?? 0,
        metadataJson: "{}",
        updatedAt: Math.floor(Date.now() / 1000),
        provider: "epic",
        mediaJson: JSON.stringify({
          coverPath: g.coverPath || null,
          landscapePath: g.landscapePath || null,
          backgroundPath: g.backgroundPath || null,
          logoPath: g.logoPath || null,
          iconPath: g.iconPath || null,
        }),
      }));
    if (entries.length > 0) {
      await batchUpsertGames(entries);
      if (DEBUG_EPIC_LIBRARY) {
        console.log(`[EPIC_STORE] persisted ${entries.length} games to SQLite`);
      }
    }
  } catch (err) {
    console.warn("[EPIC_STORE] failed to persist to SQLite:", err);
  }
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

  // Owned (not installed) games live in a separate array. They must be re-merged
  // with overrides too, otherwise media/metadata edits made in GameEditDialog are
  // written to the override store but never reflected in the library UI.
  if (idx === -1) {
    const ownedIdx = _ownedGames.findIndex((g) => g.providerGameId === providerGameId);
    if (ownedIdx === -1) {
      // Game not in current Epic list — possibly not scanned yet; skip
      return;
    }

    const ownedGame = _ownedGames[ownedIdx];
    const ownedUpdated = mergeEpicOverrides(
      ownedGame as unknown as Record<string, unknown>,
      providerGameId,
    ) as LibraryGame;

    _ownedGames = [
      ..._ownedGames.slice(0, ownedIdx),
      ownedUpdated,
      ..._ownedGames.slice(ownedIdx + 1),
    ];
    _ownedFingerprint = computeEpicFingerprint([..._epicGames, ..._ownedGames]);

    if (DEBUG_EPIC_LIBRARY) {
      console.log(
        `[EPIC_STORE] owned overrides applied providerGameId=${providerGameId} title="${ownedUpdated.title}" hasMetadata=${!!(ownedUpdated as any).metadata}`,
      );
    }

    notifyListeners();
    return;
  }

  // Re-apply overrides from localStorage for installed games
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
}
