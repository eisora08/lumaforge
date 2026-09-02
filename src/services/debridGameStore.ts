/**
 * Memory-first provider store for Debrid/Hydra game entries + disk persistence.
 *
 * Pattern: module-level state + subscriber notification (same as epicGameStore).
 * Fills from the repack catalog SQLite index.
 * Persists install state + library membership to `games/debrid/debrid-games.json`.
 */

import type { LibraryGame } from "../types/libraryGame";
import type { RepackQueryResult, DebridGameEntryJson } from "./tauri";
import {
  repackEntryToDebridGame,
  computeDebridFingerprint,
  buildDebridGameFromDiskEntry,
} from "./debridGameLibraryMapper";
import { DEBRID_LIBRARY_ENABLED, DEBRID_INSTALL_ENABLED, DEBUG_DEBRID_LIBRARY } from "../features/debrid/debridFeatureFlag";

// ── Types ──

export type DebridGameStatus = "not-downloaded" | "downloading" | "needs-setup" | "waiting-installer" | "needs-path" | "ready";

// ── Module-level state ──

let _debridGames: LibraryGame[] = [];
let _rawEntries = new Map<string, RepackQueryResult>();
/** Disk JSON entries keyed by providerGameId — used to build orphan LibraryGames when catalog row is missing. */
let _diskEntryById = new Map<string, DebridGameEntryJson>();
let _debridFingerprint = "";
let _scanWarning: string | null = null;
let _scanState: "idle" | "scanning" | "done" | "error" = "idle";
let _debridGameStatuses = new Map<string, DebridGameStatus>();
let _launchMetadataByProviderGameId = new Map<string, { installDir: string; executablePath?: string; workingDirectory?: string; launchArguments?: string }>();
let _userLibraryAppIds: Set<string> = new Set();
let _loadedFromDisk = false;
const _listeners = new Set<() => void>();

// User-overridden Steam appIds (survive catalog refresh)
let _debridAppIdOverrides = new Map<string, string>();

// User-edited display titles (survive catalog refresh + restart).
// Seeded on boot from disk entries whose title differs from the catalog title.
let _debridTitleOverrides = new Map<string, string>();

// Persisted disk title per providerGameId — used to detect user edits
// when re-mapping from the catalog (disk title != catalog title => override).
let _diskTitleByProviderGameId = new Map<string, string>();

// Session-level guard so title enrichment resolves each providerGameId once.
let _titleEnrichAttemptedThisSession = new Set<string>();

// Pending setup state: installerPath + installDir per providerGameId
let _pendingSetup = new Map<string, { installerPath: string; installDir: string }>();

// Pending completion: game whose download+extract just finished (needs-setup).
// Used by the global DebridCompletionModal to show "Install Now" / "Continue Browsing".
export type PendingCompletionInfo = {
  providerGameId: string;
  title: string;
  appId: string;
  imageUrl?: string;
  installerPath: string;
  installDir: string;
  repacker?: string;
  /** When true, the modal should show a file picker instead of "Install Now". */
  needsExePath?: boolean;
};
let _pendingCompletion: PendingCompletionInfo | null = null;

// ── Helpers ──

function buildRawEntryKey(entry: RepackQueryResult): string {
  return entry.id || entry.title.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/** Split a launch-args string into tokens (whitespace-delimited) for disk persistence. */
function splitLaunchArgs(args: string): string[] {
  return args.split(/\s+/).filter((a) => a.length > 0);
}

/**
 * Replace unedited Debrid entries' titles with the clean Steam store name via
 * resolveGameMetadata (batched, cached, per-appId deduped). Only entries with
 * no title override are enriched. Returns the number of titles actually
 * applied. Clean names are promoted to sticky overrides (same treatment as a
 * user edit); the caller persists them so they survive refresh + restart.
 */
async function enrichDebridTitles(games: LibraryGame[]): Promise<number> {
  const toResolve: { game: LibraryGame; appId: number }[] = [];

  for (const game of games) {
    if (!game.providerGameId) continue;
    if (_debridTitleOverrides.has(game.providerGameId)) continue;
    if (_titleEnrichAttemptedThisSession.has(game.providerGameId)) continue;

    const appIdNum = Number(game.appId);
    if (!appIdNum || Number.isNaN(appIdNum)) continue;

    toResolve.push({ game, appId: appIdNum });
  }

  if (toResolve.length === 0) return 0;

  let applied = 0;

  try {
    const { resolveGameMetadata } = await import("./gameMetadataResolver");
    const results = await resolveGameMetadata(toResolve.map((r) => r.appId));

    for (const { game, appId } of toResolve) {
      if (!game.providerGameId) continue;

      const name = results[appId]?.name?.trim();
      if (!name || /^Steam App \d+$/.test(name)) continue;
      if (name === game.title) continue;
      game.title = name;
      // Promote the clean name to a sticky override so the title-apply loop on
      // future refreshes treats it as authoritative instead of reverting to the
      // verbose catalog/disk title.
      _debridTitleOverrides.set(game.providerGameId, name);
      _diskTitleByProviderGameId.set(game.providerGameId, name);
      // Only mark as attempted once a valid name was actually applied, so a
      // fallback/placeholder resolution (e.g. "Steam App <id>") doesn't lock
      // the verbose title for the whole session — retries are cheap because the
      // metadata resolver caches in-memory + on disk.
      _titleEnrichAttemptedThisSession.add(game.providerGameId);
      applied += 1;
      if (DEBUG_DEBRID_LIBRARY) {
        console.log(`[DEBRID_STORE] title enriched providerGameId=${game.providerGameId} appId=${appId} title="${name}"`);
      }
    }
  } catch (e) {
    if (DEBUG_DEBRID_LIBRARY) {
      console.warn("[DEBRID_STORE] title enrichment failed", e);
    }
  }

  return applied;
}

// ── Disk persistence ──

/**
 * Load Debrid games from games_v2 (GameV2[]) into memory on boot.
 * This replaces the old loadDebridGamesFromDisk() which read from the debrid_games blob.
 */
export async function loadDebridGamesFromV2(): Promise<void> {
  if (_loadedFromDisk) return;

  try {
    const { getGamesV2BySource } = await import("./tauri");

    const gamesV2 = await getGamesV2BySource("debrid");

    for (const g of gamesV2) {
      // Populate in-memory state maps from games_v2 fields
      if (g.exePath || g.installDir) {
        _launchMetadataByProviderGameId.set(g.providerGameId!, {
          installDir: g.installDir ?? "",
          executablePath: g.exePath ?? undefined,
          workingDirectory: g.workingDirectory ?? undefined,
          launchArguments: g.launchArguments ?? undefined,
        });
      }
      _userLibraryAppIds.add(g.providerGameId!);
      _diskTitleByProviderGameId.set(g.providerGameId!, g.title || "");
      if (g.appId) {
        _debridAppIdOverrides.set(g.providerGameId!, g.appId);
      }
      // Derive status from installed state
      const isInstalled = !!(g.installDir || g.exePath);
      _debridGameStatuses.set(
        g.providerGameId!,
        isInstalled ? "ready" : "not-downloaded",
      );
    }

    _loadedFromDisk = true;

    const installedCount = [..._debridGameStatuses.values()].filter(s => s === "ready").length;
    console.log(`[DEBRID_STORE][GAMES_V2] loadDebridGamesFromV2 → ${gamesV2.length} games loaded (installed=${installedCount} inLibrary=${_userLibraryAppIds.size})`);

    if (DEBUG_DEBRID_LIBRARY) {
      console.log(
        `[DEBRID_STORE] loaded ${gamesV2.length} entries from games_v2 (installed=${_launchMetadataByProviderGameId.size} inLibrary=${_userLibraryAppIds.size})`,
      );
    }
  } catch (e) {
    console.error("[DEBRID_STORE] failed to load from games_v2:", e);
  }
}

/**
 * Build the disk-serialisable entries from current in-memory state.
 */
function toDiskEntries(): DebridGameEntryJson[] {
  const entries: DebridGameEntryJson[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const id of _userLibraryAppIds) {
    const meta = _launchMetadataByProviderGameId.get(id);
    const game = _debridGames.find((g) => g.providerGameId === id);
    const raw = _rawEntries.get(id);

    const diskEntry = _diskEntryById.get(id);
    const override = _debridAppIdOverrides.get(id);
    const status = _debridGameStatuses.get(id) ?? (meta?.installDir ? "ready" : "not-downloaded");
    entries.push({
      id,
      appId: override ? Number(override) : raw?.appId ?? (game?.appId ? Number(game.appId) : null) ?? diskEntry?.appId ?? null,
      title: game?.title ?? raw?.title ?? diskEntry?.title ?? "Unknown",
      status,
      installDir: meta?.installDir ?? null,
      executablePath: meta?.executablePath ?? null,
      workingDirectory: meta?.workingDirectory ?? null,
      installerPath: null,
      launchArguments: meta?.launchArguments ? splitLaunchArgs(meta.launchArguments) : null,
      repacker: raw?.repacker ?? game?.repacker ?? null,
      fileSize: raw?.fileSize ?? null,
      installSize: raw?.installSize ?? null,
      installedAt: now,
      updatedAt: now,
    });
  }

  // Also persist installed-only entries not in library
  for (const [id, meta] of _launchMetadataByProviderGameId) {
    if (_userLibraryAppIds.has(id)) continue;
    const game = _debridGames.find((g) => g.providerGameId === id);
    const raw = _rawEntries.get(id);
    const diskEntry = _diskEntryById.get(id);
    const status = _debridGameStatuses.get(id) ?? "ready";
    entries.push({
      id,
      appId: raw?.appId ?? diskEntry?.appId ?? null,
      title: game?.title ?? raw?.title ?? diskEntry?.title ?? "Unknown",
      status,
      installDir: meta.installDir,
      executablePath: meta.executablePath ?? null,
      workingDirectory: meta.workingDirectory ?? null,
      installerPath: null,
      launchArguments: meta.launchArguments ? splitLaunchArgs(meta.launchArguments) : null,
      repacker: raw?.repacker ?? null,
      fileSize: raw?.fileSize ?? null,
      installSize: raw?.installSize ?? null,
      installedAt: now,
      updatedAt: now,
    });
  }

  return entries;
}

/**
 * Coalescing persist chain. Multiple synchronous callers (e.g. the three
 * store updates in GameEditDialog.handleSave) must not drop each other's
 * writes: a boolean in-flight guard would discard the title/appId flush
 * after the path flush already serialized the older state. Chaining instead
 * coalesces every request into a single trailing flush that calls
 * `toDiskEntries()` at flush time — so the final in-memory state (including
 * the just-edited title) is what reaches disk. Fire-and-forget API kept.
 */
let _persistChain: Promise<void> = Promise.resolve();

function persistToDisk(): Promise<void> {
  _persistChain = _persistChain
    .then(async () => {
      const { batchUpsertGamesV2 } = await import("./tauri");
      const { debridGameToGameV2 } = await import("./gameV2Mapper");
      
      // Write to games_v2 (single source of truth)
      const entries = toDiskEntries();
      const gamesV2 = entries
        .filter((e) => e.id && e.title)
        .map((e) => debridGameToGameV2({
          id: e.id,
          title: e.title,
          appId: e.appId,
          installSize: e.installSize,
          repacker: e.repacker,
          fileSize: e.fileSize,
          updatedAt: e.updatedAt,
          // Install state
          installDir: e.installDir,
          executablePath: e.executablePath,
          workingDirectory: e.workingDirectory,
          launchArguments: e.launchArguments,
        }));
      if (gamesV2.length > 0) {
        console.log(`[DEBRID_STORE][GAMES_V2] persist: ${gamesV2.length} games written to games_v2`);
        await batchUpsertGamesV2(gamesV2).catch((e) => console.warn("[DEBRID_STORE][GAMES_V2] persist FAILED:", e));
      } else {
        console.log(`[DEBRID_STORE][GAMES_V2] persist: 0 games to write`);
      }
      
      if (DEBUG_DEBRID_LIBRARY) {
        console.log(`[DEBRID_STORE] persisted ${gamesV2.length} games to games_v2`);
      }
    })
    .catch((e) => {
      console.error("[DEBRID_STORE] persist failed:", e);
    });
  return _persistChain;
}

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

// ── Scan and replace ──

/**
 * Query the repack catalog and replace in-memory Debrid game entries.
 *
 * On scanner failure: retain previous valid entries, set warning, notify once.
 * On successful empty scan: replace with empty array (stale entries removed).
 * On successful non-empty scan: replace all, clear warning, notify once.
 */
export async function refreshDebridGames(): Promise<{ count: number; warning: string | null }> {
  if (!DEBRID_LIBRARY_ENABLED) {
    return { count: 0, warning: null };
  }

  _scanState = "scanning";

  try {
    // Load persisted install state FIRST so the restore loop below can
    // re-attach installDir/executablePath. Idempotent via _loadedFromDisk,
    // so both boot orders (Stage 3.35 loader first vs refresh first) converge.
    if (!_loadedFromDisk) {
      await loadDebridGamesFromV2();
    }

    const { getAllRepackEntries, ensureRepackCatalogImported } = await import("./repackCatalogService");

    await ensureRepackCatalogImported();

    const entries = await getAllRepackEntries();

    if (DEBUG_DEBRID_LIBRARY) {
      console.log(
        `[DEBRID_STORE] catalog query complete total=${entries.length}`,
      );
    }

    _rawEntries = new Map(entries.map((e) => [buildRawEntryKey(e), e]));

    const mapped = entries.map(repackEntryToDebridGame);

    // Preserve installed state + status across re-scans
    for (const game of mapped) {
      const installed = getDebridLaunchMetadata(game.providerGameId!);
      if (installed) {
        game.isInstalled = true;
        game.isPlayable = !!installed.executablePath;
        game.installDir = installed.installDir || undefined;
        game.executablePath = installed.executablePath;
        game.workingDirectory = installed.workingDirectory;
        game.launchArguments = installed.launchArguments;
      }
      // Restore download/install status
      const status = _debridGameStatuses.get(game.providerGameId!);
      if (status) {
        game.debridStatus = status;
      }
    }

    // Apply user-overridden appIds from GameEditDialog (survive catalog refresh)
    for (const game of mapped) {
      const override = game.providerGameId ? _debridAppIdOverrides.get(game.providerGameId) : undefined;
      if (override) {
        game.appId = override;
        if (DEBUG_DEBRID_LIBRARY) {
          console.log(`[DEBRID_STORE] appId override applied providerGameId=${game.providerGameId} appId=${override}`);
        }
      }
    }

    // Apply user-edited titles (survive catalog refresh + restart).
    // An explicit override always wins; otherwise a disk title that differs
    // from the freshly-mapped catalog title is treated as a user edit and
    // promoted to an override (unedited games have disk == catalog title).
    // Placeholder titles ("Steam App <id>") are never promoted.
    for (const game of mapped) {
      if (!game.providerGameId) continue;
      const explicit = _debridTitleOverrides.get(game.providerGameId);
      const diskTitle = _diskTitleByProviderGameId.get(game.providerGameId);
      if (explicit) {
        game.title = explicit;
      } else if (
        diskTitle &&
        diskTitle !== game.title &&
        !/^Steam App \d+$/.test(diskTitle)
      ) {
        _debridTitleOverrides.set(game.providerGameId, diskTitle);
        game.title = diskTitle;
        if (DEBUG_DEBRID_LIBRARY) {
          console.log(`[DEBRID_STORE] title override restored providerGameId=${game.providerGameId} title="${diskTitle}"`);
        }
      }
    }

    // Synthesise orphan entries for user-library appIds not in the catalog.
    // These come from debrid-games.json (installed or previously added) but
    // have no matching row in the SQLite repack catalog (e.g. after rebuild).
    const catalogIds = new Set(_rawEntries.keys());
    for (const id of _userLibraryAppIds) {
      if (catalogIds.has(id)) continue;
      const diskEntry = deriveDiskEntry(id);
      if (!diskEntry) continue;
      const status = _debridGameStatuses.get(id) ?? "not-downloaded";
      const orphan = buildDebridGameFromDiskEntry(diskEntry, status);
      // Restore launch metadata onto the orphan entry
      const meta = _launchMetadataByProviderGameId.get(id);
      if (meta) {
        orphan.installDir = meta.installDir;
        orphan.executablePath = meta.executablePath;
        orphan.workingDirectory = meta.workingDirectory;
        orphan.launchArguments = meta.launchArguments;
        orphan.isInstalled = true;
        orphan.isPlayable = !!meta.executablePath;
      }
      if (DEBUG_DEBRID_LIBRARY) {
        console.log(`[DEBRID_STORE] orphan-synthesised id=${id} title="${orphan.title}" appId=${orphan.appId}`);
      }
      mapped.push(orphan);
    }

    // Enrich unedited entries with the clean Steam store name (e.g. "Rail Route"
    // instead of the verbose bundle name). Runs before the fingerprint so the
    // enriched titles are captured in a single notify.
    const titleEnrichedCount = await enrichDebridTitles(mapped);

    const newFingerprint = computeDebridFingerprint(mapped);

    const fingerprintChanged = newFingerprint !== _debridFingerprint;

    _debridGames = mapped;
    _debridFingerprint = newFingerprint;
    _scanWarning = null;
    _scanState = "done";

    // Persist state changes so debrid-games.json records them and the fix
    // survives refresh + restart. toDiskEntries reads game.title, which is now
    // clean on the mapped entries. Persisting on any fingerprint change also
    // captures restored title/appId overrides; the coalescing chain makes the
    // write idempotent (no-op when nothing changed).
    if (titleEnrichedCount > 0 || fingerprintChanged) {
      persistToDisk();
    }

    if (fingerprintChanged || mapped.length === 0) {
      if (DEBUG_DEBRID_LIBRARY) {
        console.log(
          `[DEBRID_STORE] replaced games=${mapped.length} fingerprintChanged=${fingerprintChanged}`,
        );
      }
      notifyListeners();
    } else if (DEBUG_DEBRID_LIBRARY) {
      console.log(
        `[DEBRID_STORE] no change games=${mapped.length} fingerprintUnchanged`,
      );
    }

    return { count: mapped.length, warning: null };
  } catch (error) {
    const warning = `Debrid refresh failed: ${error instanceof Error ? error.message : String(error)}`;

    _scanWarning = warning;
    _scanState = "error";

    if (DEBUG_DEBRID_LIBRARY) {
      console.warn(`[DEBRID_STORE] query error — retaining ${_debridGames.length} previous entries`, error);
    }

    notifyListeners();

    return { count: _debridGames.length, warning };
  }
}

// ── Library management ──

/**
 * Add one or more Debrid games to the user's library.
 * Gating: games not in this set are only visible in the Store / catalog, not in the main library.
 */
export function addDebridGameToLibrary(...providerGameIds: string[]): void {
  let changed = false;
  for (const id of providerGameIds) {
    if (!_userLibraryAppIds.has(id)) {
      _userLibraryAppIds.add(id);
      changed = true;
    }
  }
  if (changed) {
    _debridFingerprint = computeDebridFingerprint(_debridGames);
    if (DEBUG_DEBRID_LIBRARY) {
      console.log(`[DEBRID_STORE] added to library: ${providerGameIds.join(", ")} totalInLib=${_userLibraryAppIds.size}`);
    }
    persistToDisk();
    notifyListeners();
  }
}

/**
 * Remove one or more Debrid games from the user's library.
 *
 * Full purge: clears every trace of the entry so a restart does not bring it
 * back. Deletes library membership, the render entry, the persisted disk
 * entry, launch metadata, status, pending setup/completion, and the user
 * appId/title overrides tied to the removed game. Returns count of
 * actually-removed entries.
 */
export function removeDebridGameFromLibrary(...providerGameIds: string[]): number {
  let removed = 0;
  for (const id of providerGameIds) {
    if (_userLibraryAppIds.delete(id)) removed++;
  }
  if (removed > 0) {
    const ids = new Set(providerGameIds);

    _debridGames = _debridGames.filter((g) => !(g.providerGameId && ids.has(g.providerGameId)));
    for (const id of ids) {
      _rawEntries.delete(id);
      _diskEntryById.delete(id);
      _debridGameStatuses.delete(id);
      _launchMetadataByProviderGameId.delete(id);
      _pendingSetup.delete(id);
      _debridAppIdOverrides.delete(id);
      _debridTitleOverrides.delete(id);
      _diskTitleByProviderGameId.delete(id);
      _titleEnrichAttemptedThisSession.delete(id);
      if (_pendingCompletion && _pendingCompletion.providerGameId === id) {
        _pendingCompletion = null;
      }
    }

    _debridFingerprint = computeDebridFingerprint(_debridGames);
    if (DEBUG_DEBRID_LIBRARY) {
      console.log(`[DEBRID_STORE] removed from library: ${providerGameIds.join(", ")} remaining=${_userLibraryAppIds.size}`);
    }
    persistToDisk();
    notifyListeners();
  }
  return removed;
}

/**
 * Return the set of providerGameIds that the user has added to their library.
 */
export function getDebridLibraryAppIds(): Set<string> {
  return _userLibraryAppIds;
}

/**
 * Check if a specific Debrid game is in the user's library.
 */
export function isDebridGameInLibrary(providerGameId: string): boolean {
  return _userLibraryAppIds.has(providerGameId);
}

/**
 * Reset library state (for testing or full rescan).
 */
export function resetDebridLibraryAppIds(): void {
  _userLibraryAppIds = new Set();
  _debridFingerprint = computeDebridFingerprint(_debridGames);
  persistToDisk();
  notifyListeners();
}

// ── Library visibility self-heal ──

/**
 * Derive the disk entry for a providerGameId from live in-memory state.
 * Prefers the boot-loaded map, falling back to a freshly derived entry so
 * in-session installs (which never touch `_diskEntryById`) are covered.
 */
function deriveDiskEntry(providerGameId: string): DebridGameEntryJson | undefined {
  return _diskEntryById.get(providerGameId) ?? toDiskEntries().find((e) => e.id === providerGameId);
}

/**
 * Ensure a library-member Debrid game has a corresponding entry in
 * `_debridGames` so it renders in the Library grid even if it was added via a
 * write path that never pushed to the array (install flows) or before a
 * catalog refresh ran.
 *
 * Idempotent: no-op when the entry already exists or the id is not a library
 * member. Persists + (optionally) notifies only when a new entry was inserted.
 */
function ensureDebridGameVisible(providerGameId: string, notify = true): boolean {
  if (_debridGames.some((g) => g.providerGameId === providerGameId)) return false;
  if (!_userLibraryAppIds.has(providerGameId)) return false;

  const status = _debridGameStatuses.get(providerGameId) ?? "not-downloaded";
  const diskEntry = deriveDiskEntry(providerGameId);
  if (!diskEntry) return false;

  const orphan = buildDebridGameFromDiskEntry(diskEntry, status);
  const meta = _launchMetadataByProviderGameId.get(providerGameId);
  if (meta) {
    orphan.installDir = meta.installDir;
    orphan.executablePath = meta.executablePath;
    orphan.workingDirectory = meta.workingDirectory;
    orphan.launchArguments = meta.launchArguments;
    orphan.isInstalled = true;
    orphan.isPlayable = !!meta.executablePath;
  }

  _debridGames.push(orphan);
  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] self-healed entry id=${providerGameId} title="${orphan.title}" appId=${orphan.appId}`);
  }

  persistToDisk();
  if (notify) notifyListeners();
  return true;
}

// ── Sync reads ──

/** Return current Debrid LibraryGame entries (sync, no query). */
export function getAllDebridGames(): LibraryGame[] {
  for (const id of _userLibraryAppIds) {
    ensureDebridGameVisible(id, false);
  }
  return _debridGames;
}

/** Return a single Debrid game by providerGameId. */
export function getDebridGame(providerGameId: string): LibraryGame | undefined {
  return _debridGames.find((g) => g.providerGameId === providerGameId);
}

/** Return a single Debrid game by Steam appId. */
export function getDebridGameByAppId(appId: string): LibraryGame | undefined {
  return _debridGames.find((g) => g.appId === appId);
}

/**
 * Get the current status of a Debrid game.
 * Defaults to "not-downloaded" if no status is set.
 */
export function getDebridGameStatus(providerGameId: string): DebridGameStatus {
  return _debridGameStatuses.get(providerGameId) ?? "not-downloaded";
}

/**
 * Clear the status of a Debrid game (resets to "not-downloaded").
 * Called when a download is cancelled externally.
 */
export function clearDebridGameStatus(providerGameId: string): void {
  if (!_debridGameStatuses.has(providerGameId)) return;
  _debridGameStatuses.delete(providerGameId);
  persistToDisk();
  notifyListeners();
}

/**
 * Get all Debrid game statuses (copy of the map).
 */
export function getDebridGameStatuses(): Map<string, DebridGameStatus> {
  return new Map(_debridGameStatuses);
}

/**
 * Mark a Debrid game with a specific status.
 * Notifies listeners on change.
 */
export function markDebridGameStatus(providerGameId: string, status: DebridGameStatus): void {
  const old = _debridGameStatuses.get(providerGameId);
  if (old === status) return;

  _debridGameStatuses.set(providerGameId, status);
  _debridFingerprint = computeDebridFingerprint(_debridGames);
  ensureDebridGameVisible(providerGameId, false);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] status ${providerGameId}: ${old ?? "none"} → ${status}`);
  }

  persistToDisk();
  notifyListeners();
}

/**
 * Mark a Debrid game as extracted (download+extract done, needs-setup).
 *
 * This adds the game to the user's library (so it appears in Sidebar/Library
 * even before setup runs) and signals the global DebridCompletionModal.
 */
export function markDebridGameExtracted(
  providerGameId: string,
  installerPath: string,
  installDir: string,
  extras?: { title?: string; appId?: string; repacker?: string },
): void {
  _debridGameStatuses.set(providerGameId, "needs-setup");
  _userLibraryAppIds.add(providerGameId);
  _launchMetadataByProviderGameId.set(providerGameId, { installDir });
  ensureDebridGameVisible(providerGameId, false);

  // Also update the _debridGames[] entry so isInstalled=true + installDir
  // are reflected immediately when getDebridLibraryGames() is called.
  const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
  if (idx !== -1) {
    _debridGames[idx] = {
      ..._debridGames[idx],
      isInstalled: true,
      installDir,
    };
  }

  // Store pending completion info for the global modal
  const game = _debridGames.find((g) => g.providerGameId === providerGameId);
  _pendingCompletion = {
    providerGameId,
    title: extras?.title ?? game?.title ?? "Game",
    appId: extras?.appId ?? game?.appId ?? providerGameId,
    installerPath,
    installDir,
    repacker: extras?.repacker ?? game?.repacker,
  };

  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(
      `[DEBRID_STORE] extracted ${providerGameId}: added to library, pending completion`,
    );
  }

  persistToDisk();
  notifyListeners();
}

/**
 * Return the current pending completion info (or null if none).
 * Used by DebridCompletionModal to know which game to show.
 */
export function getPendingCompletion(): PendingCompletionInfo | null {
  return _pendingCompletion;
}

/**
 * Pop (consume) the pending completion — called when the user dismisses the
 * modal or completes setup. Returns the info so callers can navigate / action.
 */
export function popPendingCompletion(): PendingCompletionInfo | null {
  const info = _pendingCompletion;
  _pendingCompletion = null;
  return info;
}

/**
 * Mark a Debrid game as having its installer auto-running.
 * Adds to library, sets status to "waiting-installer", and stores
 * launch metadata — without setting the completion modal.
 */
export function markDebridGameInstalling(
  providerGameId: string,
  installDir: string,
): void {
  _debridGameStatuses.set(providerGameId, "waiting-installer");
  _userLibraryAppIds.add(providerGameId);
  _launchMetadataByProviderGameId.set(providerGameId, { installDir });
  ensureDebridGameVisible(providerGameId, false);

  const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
  if (idx !== -1) {
    _debridGames[idx] = {
      ..._debridGames[idx],
      isInstalled: true,
      installDir,
    };
  }

  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] installing ${providerGameId}`);
  }

  persistToDisk();
  notifyListeners();
}

/**
 * Store pending completion for the needs-path modal.
 */
export function setPendingCompletionNeedsPath(
  providerGameId: string,
  installDir: string,
  extras?: { title?: string; appId?: string; repacker?: string },
): void {
  ensureDebridGameVisible(providerGameId, false);
  const game = _debridGames.find((g) => g.providerGameId === providerGameId);
  _pendingCompletion = {
    providerGameId,
    title: extras?.title ?? game?.title ?? "Game",
    appId: extras?.appId ?? game?.appId ?? providerGameId,
    installerPath: "",
    installDir,
    repacker: extras?.repacker ?? game?.repacker,
    needsExePath: true,
  };

  // Update status so getLauncherGamePrimaryAction returns "select-exe"
  _debridGameStatuses.set(providerGameId, "needs-path");
  if (game) {
    _debridGames = _debridGames.map((g) =>
      g.providerGameId === providerGameId ? { ...g, debridStatus: "needs-path" as const } : g,
    );
  }
  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] pending-completion-needs-path ${providerGameId}`);
  }

  persistToDisk();
  notifyListeners();
}

/**
 * Store pending setup info (installerPath, installDir) for a game whose
 * download+extract completed with status="needs-setup".
 */
export function setPendingSetup(
  providerGameId: string,
  installerPath: string,
  installDir: string,
): void {
  _pendingSetup.set(providerGameId, { installerPath, installDir });
}

/**
 * Return the pending setup info for a game, or undefined if none.
 */
export function getPendingSetup(
  providerGameId: string,
): { installerPath: string; installDir: string } | undefined {
  return _pendingSetup.get(providerGameId);
}

/**
 * Clear pending setup info (e.g. after setup_debrid_game completes or is cancelled).
 */
export function clearPendingSetup(providerGameId: string): void {
  _pendingSetup.delete(providerGameId);
}

/**
 * Return the full raw repack entry for a providerGameId.
 * Contains downloadUris, installerType, repacker, fileSize, etc.
 */
export function getDebridRepackEntry(providerGameId: string): RepackQueryResult | undefined {
  return _rawEntries.get(providerGameId);
}

/**
 * Update a Debrid game in-place after install completes.
 *
 * Sets isInstalled=true, isPlayable=true, installDir, executablePath.
 * Persists to disk automatically.
 * Notifies listeners so LibraryGamesContext re-applies the game.
 */
export function updateDebridGame(
  providerGameId: string,
  installDir: string,
  executablePath?: string,
  launchArguments?: string,
  workingDirectory?: string,
): boolean {
  if (!DEBRID_INSTALL_ENABLED || !DEBRID_LIBRARY_ENABLED) return false;

  // Auto-add to library so the game is visible even if the install flow never
  // went through markDebridGameExtracted / markDebridGameInstalling, then
  // heal the render array so a fresh (non-catalog) game gets an entry.
  _userLibraryAppIds.add(providerGameId);
  ensureDebridGameVisible(providerGameId, false);

  const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
  if (idx === -1) return false;

  _debridGames[idx] = {
    ..._debridGames[idx],
    isInstalled: true,
    isPlayable: !!executablePath,
    installDir,
    executablePath,
    workingDirectory,
    launchArguments,
    debridStatus: "ready",
  };

  // Store launch metadata for the launch adapter
  _launchMetadataByProviderGameId.set(providerGameId, { installDir, executablePath, workingDirectory, launchArguments });

  // Mark as ready
  _debridGameStatuses.set(providerGameId, "ready");

  // Update fingerprint to reflect state change
  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(
      `[DEBRID_STORE] updated providerGameId=${providerGameId} isInstalled=true installDir=${installDir}`,
    );
  }

  // Persist to disk
  persistToDisk();

  notifyListeners();
  return true;
}

/** Return current fingerprint. */
export function getDebridFingerprint(): string {
  return _debridFingerprint;
}

/**
 * Return launch metadata for a Debrid game.
 * Used by the provider launch adapter to resolve executable path for spawning.
 */
export function getDebridLaunchMetadata(
  providerGameId: string,
): { installDir: string; executablePath?: string; workingDirectory?: string; launchArguments?: string } | undefined {
  return _launchMetadataByProviderGameId.get(providerGameId);
}

/** Return current scan state. */
export function getDebridScanState(): "idle" | "scanning" | "done" | "error" {
  return _scanState;
}

/** Return current scan warning (null if no warning). */
export function getDebridScanWarning(): string | null {
  return _scanWarning;
}

// ── Subscription ──

/**
 * Subscribe to Debrid game store changes.
 * Returns an unsubscribe function. Safe to call from React useEffect.
 * One notification per meaningful replacement — no duplicate listeners.
 */
export function subscribeDebridGames(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

// ── Cache management ──

/** Clear in-memory Debrid cache. Used for testing or full rescan. */
export function resetDebridGameCache(): void {
  _debridGames = [];
  _rawEntries = new Map();
  _diskEntryById = new Map();
  _launchMetadataByProviderGameId = new Map();
  _debridGameStatuses = new Map();
  _pendingSetup = new Map();
  _pendingCompletion = null;
  _debridAppIdOverrides = new Map();
  _debridTitleOverrides = new Map();
  _diskTitleByProviderGameId = new Map();
  _titleEnrichAttemptedThisSession = new Set();
  _userLibraryAppIds = new Set();
  _debridFingerprint = "";
  _scanWarning = null;
  _scanState = "idle";

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] cache reset`);
  }

  persistToDisk();
  notifyListeners();
}

// ── Path editing support ──

/**
 * Update the install path for a Debris game that has been moved.
 * Persists to disk immediately.
 */
export function updateDebridGamePath(
  providerGameId: string,
  installDir: string,
  executablePath?: string,
  workingDirectory?: string,
  launchArguments?: string,
): boolean {
  if (!DEBRID_LIBRARY_ENABLED) return false;

  let meta = _launchMetadataByProviderGameId.get(providerGameId);
  if (!meta) {
    meta = { installDir, executablePath, workingDirectory, launchArguments };
    _launchMetadataByProviderGameId.set(providerGameId, meta);
  } else {
    meta.installDir = installDir;
    if (executablePath !== undefined) meta.executablePath = executablePath;
    if (workingDirectory !== undefined) meta.workingDirectory = workingDirectory;
    if (launchArguments !== undefined) meta.launchArguments = launchArguments;
  }

  // Update the LibraryGame in memory too
  const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
  if (idx !== -1) {
    _debridGames[idx] = {
      ..._debridGames[idx],
      isInstalled: true,
      isInstallable: false,
      isPlayable: !!executablePath || !!_debridGames[idx].executablePath,
      installDir,
      executablePath: executablePath ?? _debridGames[idx].executablePath,
      workingDirectory: workingDirectory ?? _debridGames[idx].workingDirectory,
      launchArguments: launchArguments ?? _debridGames[idx].launchArguments,
      debridStatus: executablePath || _debridGames[idx].executablePath ? "ready" : (_debridGames[idx].debridStatus ?? "waiting-installer"),
    };
  }

  _debridGameStatuses.set(providerGameId, meta.installDir || meta.executablePath ? "ready" : "waiting-installer");
  _userLibraryAppIds.add(providerGameId);
  ensureDebridGameVisible(providerGameId, false);

  _debridFingerprint = computeDebridFingerprint(_debridGames);
  persistToDisk();
  notifyListeners();

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] path updated providerGameId=${providerGameId} installDir=${installDir}`);
  }

  return true;
}

/**
 * Override or clear the Steam appId for a Debrid game.
 *
 * The override survives catalog refresh — entries rebuilt from SQLite's
 * repack index will re-apply the stored override on next scan.
 * Pass empty string to clear the override.
 */
export function updateDebridGameAppId(providerGameId: string, appId: string): void {
  if (!DEBRID_LIBRARY_ENABLED) return;

  const trimmed = appId.trim();
  if (trimmed) {
    _debridAppIdOverrides.set(providerGameId, trimmed);

    // Update the in-memory LibraryGame immediately
    const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
    if (idx !== -1) {
      _debridGames[idx] = { ..._debridGames[idx], appId: trimmed };
    }
  } else {
    _debridAppIdOverrides.delete(providerGameId);

    // Reset appId back to catalog value
    const raw = _rawEntries.get(providerGameId);
    const catalogAppId = raw?.appId ? String(raw.appId) : undefined;
    const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
    if (idx !== -1) {
      _debridGames[idx] = { ..._debridGames[idx], appId: catalogAppId ?? "" };
    }
  }

  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] appId override ${providerGameId}: ${trimmed || "(cleared)"}`);
  }

  persistToDisk();
  notifyListeners();
}

/**
 * Persist a user-edited display title for a Debrid game.
 * Only the title is persisted (per decision: name + dialog); description,
 * genres and artwork stay session-level. Survives catalog refresh + restart.
 */
export function updateDebridGameTitle(providerGameId: string, title: string): boolean {
  if (!DEBRID_LIBRARY_ENABLED) return false;

  const trimmed = title.trim();
  if (!trimmed) return false;

  const idx = _debridGames.findIndex((g) => g.providerGameId === providerGameId);
  if (idx === -1) return false;

  _debridGames[idx] = { ..._debridGames[idx], title: trimmed };
  _debridTitleOverrides.set(providerGameId, trimmed);
  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] title updated providerGameId=${providerGameId} title="${trimmed}"`);
  }

  persistToDisk();
  notifyListeners();
  return true;
}
