/**
 * Pure mapper: RepackQueryResult (SQLite repack catalog) → LibraryGame (Debrid source).
 *
 * Phase 2 boundary:
 *   - No launch adapter → isPlayable = false
 *   - Not on disk → isInstalled = false
 *   - Installable via Debrid → isInstallable = true
 *   - No Steam actions → steamInstalled = false
 *   - Links to Steam via appId for metadata resolution
 */

import type { LibraryGame } from "../types/libraryGame";
import type { RepackQueryResult, DebridGameEntryJson } from "./tauri";
import type { DebridGameStatus } from "./debridGameStore";
import { DEBUG_DEBRID_LIBRARY } from "../features/debrid/debridFeatureFlag";

/**
 * Build a stable providerGameId from a repack catalog entry.
 * Uses the repack catalog internal ID as the canonical game identity.
 */
function buildProviderGameId(entry: RepackQueryResult): string {
  return entry.id || entry.title.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Map a single repack catalog entry to a LibraryGame with source="debrid".
 *
 * This function is pure — no side effects, no async, no network calls.
 */
export function repackEntryToDebridGame(entry: RepackQueryResult): LibraryGame {
  const providerGameId = buildProviderGameId(entry);
  const libraryId = `debrid:${providerGameId}`;

  // debridStatus is set by debridGameStore via _debridGameStatuses restoration,
  // not by the mapper. Catalog entries start with no debridStatus so
  // launcherGameActions can fall through to isInstallable → "install".
  const mapped: LibraryGame = {
    id: libraryId,
    title: entry.title || "Unknown Repack",
    source: "debrid",
    libraryId,
    providerId: "debrid",
    providerGameId,

    // Link to Steam appId for metadata resolution (cover art, description, etc.)
    appId: entry.appId > 0 ? String(entry.appId) : undefined,

    // Only playable after install (updated via updateDebridGame)
    isPlayable: false,
    // Debrid games can be installed/streamed via Hydra
    isInstallable: true,
    // Not on disk by default — updated by store after install
    isInstalled: false,
    // No Steam install state
    steamInstalled: false,

    // Repacker metadata
    repacker: entry.repacker || undefined,

    // No local install paths
    installDir: undefined,
    executablePath: undefined,

    // No Lua
    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,

    // No sources
    sources: [],

    // Metadata from repack catalog
    sizeOnDisk: entry.installSize ?? (entry.fileSize || undefined),
    lastUpdated: entry.updatedAt ? new Date(entry.updatedAt).getTime() : undefined,
  };

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(
      `[DEBRID_MAPPER] providerGameId=${providerGameId} title="${mapped.title}" appId=${entry.appId} repacker=${entry.repacker} installerType=${entry.installerType} fileSize=${entry.fileSize}`,
    );
  }

  return mapped;
}

/**
 * Compute a deterministic fingerprint for a set of Debrid LibraryGame entries.
 * Used by the store to detect meaningful changes and avoid duplicate notifications.
 */
export function computeDebridFingerprint(games: LibraryGame[]): string {
  return games
    .slice()
    .sort((a, b) => (a.providerGameId || "").localeCompare(b.providerGameId || ""))
    .map(
      (g) =>
        `${g.providerGameId}:${g.title}:${!!g.isInstalled}:${!!g.isPlayable}:${g.repacker ?? ""}:${g.sizeOnDisk ?? ""}:${g.lastUpdated ?? ""}`,
    )
    .join("|");
}

/**
 * Build a LibraryGame from a disk entry (debrid-games.json) when no matching
 * repack catalog entry exists. This ensures Debrid games that were installed
 * or added to the library always appear in the Library grid even if the
 * SQLite repack catalog has been refreshed / rebuilt.
 */
export function buildDebridGameFromDiskEntry(
  entry: DebridGameEntryJson,
  status: string,
): LibraryGame {
  const providerGameId = entry.id;
  const libraryId = `debrid:${providerGameId}`;
  const appId = entry.appId != null ? String(entry.appId) : undefined;

  const mapped: LibraryGame = {
    id: libraryId,
    title: entry.title || "Unknown Game",
    source: "debrid",
    libraryId,
    providerId: "debrid",
    providerGameId,
    appId,

    isPlayable: status === "ready" && !!entry.executablePath,
    isInstallable: !entry.installDir || status === "not-downloaded",
    isInstalled: !!entry.installDir,
    steamInstalled: false,

    repacker: entry.repacker || undefined,
    installDir: entry.installDir || undefined,
    executablePath: entry.executablePath || undefined,

    luaScripts: [],
    hasLua: false,
    isLuaActive: false,
    isLuaDisabled: false,
    hasLuaSource: false,

    sources: [],

    sizeOnDisk: entry.installSize ?? undefined,
    lastUpdated: entry.updatedAt ? entry.updatedAt * 1000 : undefined,

    debridStatus: status as DebridGameStatus,
  };

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(
      `[DEBRID_MAPPER][DISK_ENTRY] providerGameId=${providerGameId} title="${mapped.title}" appId=${entry.appId} status=${status} installDir=${entry.installDir}`,
    );
  }

  return mapped;
}
