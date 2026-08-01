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

// ── Disk persistence ──

/**
 * Read `debrid-games.json` from disk and populate in-memory state.
 * Must be called once on boot before refreshDebridGames().
 */
export async function loadDebridGamesFromDisk(): Promise<DebridGameEntryJson[]> {
  if (_loadedFromDisk) return await toDiskEntries();

  try {
    const { readDebridGames } = await import("./tauri");
    const entries = await readDebridGames();

    _diskEntryById = new Map(entries.map((e) => [e.id, e]));

    for (const entry of entries) {
      if (entry.installDir) {
        _launchMetadataByProviderGameId.set(entry.id, {
          installDir: entry.installDir,
          executablePath: entry.executablePath ?? undefined,
          workingDirectory: entry.workingDirectory ?? undefined,
          launchArguments: entry.launchArguments?.join(" ") || undefined,
        });
      }
      _userLibraryAppIds.add(entry.id);
      // Restore user-overridden appIds so the override loop survives a restart.
      // The disk `appId` field is authoritative (written from the override map).
      if (entry.appId) {
        _debridAppIdOverrides.set(entry.id, String(entry.appId));
      }
      // Restore status — preserve needs-setup, default to "ready" for installed entries
      const preservedStatus = entry.status === "needs-setup" ? "needs-setup" : null;
      _debridGameStatuses.set(
        entry.id,
        preservedStatus ?? (entry.installDir ? "ready" : (entry.installerPath ? "ready" : (entry.status === "downloading" ? "downloading" : "not-downloaded")))
      );
    }

    // Mark loaded only after a successful read — a transient failure must not
    // freeze the in-memory state as empty for the rest of the session.
    _loadedFromDisk = true;

    if (DEBUG_DEBRID_LIBRARY) {
      console.log(
        `[DEBRID_STORE] loaded ${entries.length} entries from disk (installed=${_launchMetadataByProviderGameId.size} inLibrary=${_userLibraryAppIds.size})`,
      );
    }

    return entries;
  } catch (e) {
    console.error("[DEBRID_STORE] failed to load from disk:", e);
    return [];
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

let _persistInFlight = false;

/**
 * Write current install/library state to `debrid-games.json` (fire-and-forget).
 * Guards against concurrent writes via _persistInFlight flag.
 */
async function persistToDisk(): Promise<void> {
  if (_persistInFlight) return;
  _persistInFlight = true;
  try {
    const { writeDebridGames } = await import("./tauri");
    const entries = toDiskEntries();
    await writeDebridGames(entries);
    if (DEBUG_DEBRID_LIBRARY) {
      console.log(`[DEBRID_STORE] persisted ${entries.length} entries to disk`);
    }
  } catch (e) {
    console.error("[DEBRID_STORE] persist failed:", e);
  } finally {
    _persistInFlight = false;
  }
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
    await loadDebridGamesFromDisk();

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
        game.installDir = installed.installDir;
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

    // Synthesise orphan entries for user-library appIds not in the catalog.
    // These come from debrid-games.json (installed or previously added) but
    // have no matching row in the SQLite repack catalog (e.g. after rebuild).
    const catalogIds = new Set(_rawEntries.keys());
    for (const id of _userLibraryAppIds) {
      if (catalogIds.has(id)) continue;
      const diskEntry = _diskEntryById.get(id);
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

    const newFingerprint = computeDebridFingerprint(mapped);

    const fingerprintChanged = newFingerprint !== _debridFingerprint;

    _debridGames = mapped;
    _debridFingerprint = newFingerprint;
    _scanWarning = null;
    _scanState = "done";

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
 * Returns count of actually-removed entries.
 */
export function removeDebridGameFromLibrary(...providerGameIds: string[]): number {
  let removed = 0;
  for (const id of providerGameIds) {
    if (_userLibraryAppIds.delete(id)) removed++;
  }
  if (removed > 0) {
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

// ── Sync reads ──

/** Return current Debrid LibraryGame entries (sync, no query). */
export function getAllDebridGames(): LibraryGame[] {
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

  // Auto-add to library if not already
  _userLibraryAppIds.add(providerGameId);

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
      isPlayable: !!executablePath || !!_debridGames[idx].executablePath,
      installDir,
      executablePath: executablePath ?? _debridGames[idx].executablePath,
      workingDirectory: workingDirectory ?? _debridGames[idx].workingDirectory,
      launchArguments: launchArguments ?? _debridGames[idx].launchArguments,
      debridStatus: executablePath || _debridGames[idx].executablePath ? "ready" : (_debridGames[idx].debridStatus ?? "waiting-installer"),
    };
  }

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
  _debridFingerprint = computeDebridFingerprint(_debridGames);

  if (DEBUG_DEBRID_LIBRARY) {
    console.log(`[DEBRID_STORE] title updated providerGameId=${providerGameId} title="${trimmed}"`);
  }

  persistToDisk();
  notifyListeners();
  return true;
}
