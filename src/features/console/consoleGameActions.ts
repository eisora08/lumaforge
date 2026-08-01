/**
 * Console Mode action dispatcher.
 *
 * Thin UI adapter over existing Store/Library install/update/check flows.
 * Does NOT duplicate provider/source selection, download pipeline, or status writing.
 *
 * Install/Update:
 *   Reads from sourceAvailabilityCacheService (populated by Store provider discovery).
 *   Uses getBestAvailableSource (sourceHelpers.ts) for provider priority.
 *   Delegates to downloadFromSource (canonical Store download pipeline).
 *
 * Check Update:
 *   HubcapDB-only (only provider with update-checking capability).
 *   Same function chain as StoreGameDetailsPage.handleCheckForUpdates:
 *     fetchHubcapAppStatus → checkHubcapAppUpdate → updateProviderRemoteStatus (saves to disk + notifies store)
 *
 * Steam Install:
 *   Only opens steam://install when getLauncherGamePrimaryAction returns "install"
 *   AND game.source === "steam" (confirmed Steam app).
 *   Provider/Lua games never trigger Steam install.
 */

import type { LibraryGame } from "../../types/libraryGame";
import type { AppSettings } from "../../types/settings";
import type { PackageGame, PackageSource } from "../../types/package";
import type { DownloadJob } from "../../types/download";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { getBestAvailableSource } from "../../utils/sourceHelpers";
import {
  getUpdateStatus,

} from "../../services/providerStatusStore";
import {
  fetchHubcapAppStatus,
  checkHubcapAppUpdate,
} from "../../services/hubcapApiService";
import { updateProviderRemoteStatus } from "../../services/providerStatusService";
import { downloadFromSource } from "../download/downloadFromSource";
import {
  loadSourceAvailabilityIndex,
  getSourceAvailability,
} from "../../services/sourceAvailabilityCacheService";
import { installSteamApp } from "../../services/tauri";
import { installTrackerService } from "../../services/installTrackingService";
import { showError, showSuccess, showWarning } from "../../components/toast/GameToast";
import {
  DEBRID_INSTALL_ENABLED,
  DEBRID_LIBRARY_ENABLED,
  DEBUG_DEBRID_INSTALL,
} from "../../features/debrid/debridFeatureFlag";
import { pickInstallUriWithoutDialog } from "../../services/debridInstallChoice";

const DEBUG_CONSOLE_ACTIONS = false;

export type ConsolePrimaryAction =
  | "play"
  | "install"
  | "update"
  | "check-update"
  | "up-to-date"
  | "installing"
  | "select-exe"
  | "blocked"
  | "unavailable";

export interface ConsoleGameActionModel {
  /** Primary action for the main button */
  action: ConsolePrimaryAction;
  label: string;
  enabled: boolean;
  reason?: string;

  /** Per-row flags for Options overlay (decoupled from primary) */
  showInstallRow: boolean;
  installRowEnabled: boolean;
  installRowReason?: string;

  showUpdateRow: boolean;

  showCheckUpdateRow: boolean;

  showUpToDateRow: boolean;

  showBlockedRow: boolean;
  blockedRowReason?: string;

  /** Raw state for reference */
  baseAction: import("../../utils/launcherGameActions").PrimaryAction;
  updateStatus?: import("../../services/providerStatusStore").UpdateStatus;
}

export interface ConsoleGameActionOptions {
  settings: AppSettings;
  addJob: (input: {
    appId: string;
    gameTitle: string;
    providerId: string;
    providerName: string;
    fileType: DownloadJob["fileType"];
    downloadUrl?: string;
  }) => DownloadJob;
  updateJob: (jobId: string, update: {
    status?: DownloadJob["status"];
    progress?: number;
    bytesRead?: number;
    totalBytes?: number;
    error?: string;
  }) => void;
  libraryRefresh: () => Promise<void>;
  mountedRef: { current: boolean };
  onPlayGame?: (game: LibraryGame) => void;
}

export interface ConsoleActionResult {
  action: ConsolePrimaryAction;
  success: boolean;
  error?: string;
}

/* ── In-flight guard per appId ── */
const _inFlight = new Map<string, ConsolePrimaryAction>();

export function isInFlight(appId: string): boolean {
  return _inFlight.has(appId);
}

export function getInFlightAction(appId: string): ConsolePrimaryAction | undefined {
  return _inFlight.get(appId);
}

export function clearInFlight(appId?: string): void {
  if (appId) _inFlight.delete(appId);
  else _inFlight.clear();
}

/* ── Shared action model ── single source of truth ── */

export function getConsoleGameActionModel(game: LibraryGame): ConsoleGameActionModel {
  const baseAction = getLauncherGamePrimaryAction(game);
  const updateStatus = game.appId ? getUpdateStatus(game.appId) : undefined;

  // ── Default state ──
  let action: ConsolePrimaryAction = "unavailable";
  let enabled = false;
  let reason: string | undefined;

  let showInstallRow = false;
  let installRowEnabled = false;
  let installRowReason: string | undefined;

  let showUpdateRow = false;

  let showCheckUpdateRow = false;

  let showUpToDateRow = false;

  let showBlockedRow = false;
  let blockedRowReason: string | undefined;

  // ── Derive ──
  const isPlayable = baseAction === "play";

  if (isPlayable) {
    // Rule 2: playable → Play
    action = "play";
    enabled = true;

    // Rule 3: Update available → show Updates in Options
    if (updateStatus === "update-available") {
      showUpdateRow = true;
    }

    // Rule 5+6: known up-to-date / unknown → show info row in Options
    if (updateStatus === "up-to-date") {
      showUpToDateRow = true;
    }
    if (!updateStatus || updateStatus === "unknown" || updateStatus === "provider-unavailable" || updateStatus === "auth-required") {
      showCheckUpdateRow = true;
    }
  } else if (baseAction === "install") {
    // Installable game: ALWAYS show Install as primary (provider status is secondary only)
    action = "install";
    // enabled = true only when Library/GameDetails install action is available (numeric Steam appId)
    const hasNumericAppId = !!game.appId && /^\d+$/.test(game.appId);
    if (hasNumericAppId) {
      enabled = true;
    } else {
      enabled = false;
      installRowReason = "Install source unavailable";
    }
    showInstallRow = true;
    installRowEnabled = enabled;

    // Provider status rows (secondary only, never affect primary action)
    if (updateStatus === "update-available") {
      showUpdateRow = true;
    }
    if (updateStatus === "up-to-date") {
      showUpToDateRow = true;
    }
    if (!updateStatus || updateStatus === "unknown" || updateStatus === "provider-unavailable" || updateStatus === "auth-required") {
      showCheckUpdateRow = true;
    }
  } else if (baseAction === "installing") {
    action = "installing";
    enabled = false;
    reason = "Installer is running";
    showBlockedRow = true;
    blockedRowReason = "Game is being installed";
  } else if (baseAction === "select-exe") {
    action = "select-exe";
    enabled = true;
  } else if (baseAction === "missing-path") {
    action = "blocked";
    enabled = false;
    reason = "Game files missing";
    showBlockedRow = true;
    blockedRowReason = "Game files missing";
  } else if (baseAction === "open-steam" || baseAction === "open-lua-folder" || baseAction === "details") {
    action = "unavailable";
    enabled = false;
    reason = "This game is not playable yet";
    showBlockedRow = true;
    blockedRowReason = reason;

    // Check Update still available for provider games
    if (updateStatus === "update-available") {
      showUpdateRow = true;
    }
    if (!updateStatus || updateStatus === "unknown" || updateStatus === "provider-unavailable" || updateStatus === "auth-required") {
      showCheckUpdateRow = true;
    }
  }

  const label = getConsolePrimaryActionLabel(action);

  if (DEBUG_CONSOLE_ACTIONS) {
    console.log(
      `[CONSOLE_ACTION_MODEL] appid=${game.appId} title="${game.title}" baseAction=${baseAction} updateStatus=${updateStatus} finalAction=${action} enabled=${enabled} reason=${reason ?? "none"}`,
    );
  }

  return {
    action,
    label,
    enabled,
    reason,
    showInstallRow,
    installRowEnabled,
    installRowReason,
    showUpdateRow,
    showCheckUpdateRow,
    showUpToDateRow,
    showBlockedRow,
    blockedRowReason,
    baseAction,
    updateStatus,
  };
}

export function getConsolePrimaryActionLabel(action: ConsolePrimaryAction): string {
  switch (action) {
    case "play": return "Play";
    case "install": return "Install";
    case "update": return "Update Available";
    case "check-update": return "Check Update";
    case "up-to-date": return "Up to Date";
    case "installing": return "Installing";
    case "select-exe": return "Select Executable";
    case "blocked": return "Play";
    case "unavailable": return "Play";
  }
}

export function getConsolePrimaryActionIcon(action: ConsolePrimaryAction): string {
  switch (action) {
    case "play": return "play";
    case "install": return "download";
    case "update": return "refresh";
    case "check-update": return "search";
    case "up-to-date": return "check";
    case "installing": return "spinner";
    case "select-exe": return "search";
    case "blocked": return "play";
    case "unavailable": return "play";
  }
}

function modelBlockedReason(baseAction: string): string {
  switch (baseAction) {
    case "install": return "Install required";
    case "missing-path": return "Game files missing";
    case "open-steam": return "Open in Steam to play";
    case "open-lua-folder": return "Configure Lua script to play";
    default: return "This game is not playable yet";
  }
}

/* ── Resolve a PackageSource from source availability cache ── */

/**
 * Look up the best available source for this game from the source availability cache
 * (populated by Store provider discovery). Returns null when no cached source is found —
 * caller should show a toast directing user to configure sources in Store.
 */
async function resolveCachedSource(appId: string): Promise<PackageSource | null> {
  await loadSourceAvailabilityIndex();
  const entry = getSourceAvailability(appId);
  if (!entry || entry.availableSources.length === 0) {
    if (DEBUG_CONSOLE_ACTIONS) {
      console.log(`[CONSOLE][SOURCE_MISS] appid=${appId} reason=${!entry ? "no-cache-entry" : "no-available-sources"}`);
    }
    return null;
  }

  // Build a minimal PackageGame-like object for getBestAvailableSource
  const sources: PackageSource[] = entry.availableSources.map((s) => ({
    providerId: s.id as PackageSource["providerId"],
    providerName: s.name,
    fileType: (s.type === "lua" || s.type === "zip" || s.type === "manifest") ? s.type as PackageSource["fileType"] : "zip",
    available: s.status === "ready",
    downloadUrl: s.packageUrl,
  }));

  const pseudoGame: PackageGame = {
    appId,
    title: entry.title,
    sources,
    imageUrl: undefined,
    platforms: [],
  };

  const best = getBestAvailableSource(pseudoGame);

  if (DEBUG_CONSOLE_ACTIONS) {
    console.log(
      `[CONSOLE][SOURCE_RESOLVE] appid=${appId} cachedSources=${sources.length} best=${best?.providerName ?? "none"}`,
    );
  }

  return best ?? null;
}

/* ── Check for provider updates (HubcapDB) ── */

/**
 * Check for updates via HubcapDB (the only provider with update-checking capability).
 * Same function chain as StoreGameDetailsPage.handleCheckForUpdates:
 *   fetchHubcapAppStatus → checkHubcapAppUpdate → updateProviderRemoteStatus (saves to disk + notifies store)
 */
async function handleConsoleCheckUpdates(
  game: LibraryGame,
  settings: AppSettings,
): Promise<boolean> {
  const appId = game.appId;
  if (!appId) return false;

  const hubcapSettings = settings.providers?.hubcapdb;
  if (!hubcapSettings?.apiKey || !hubcapSettings?.baseUrl) {
    showWarning("HubcapDB API key not configured. Configure in Settings > Providers.", {
      id: `console-check-${appId}`,
      duration: 3000,
    });
    return false;
  }

  const providerId = "hubcapdb";

  if (DEBUG_CONSOLE_ACTIONS) {
    console.log(`[CONSOLE][CHECK_UPDATE] appid=${appId}`);
  }

  try {
    const remote = await fetchHubcapAppStatus(
      hubcapSettings.baseUrl,
      hubcapSettings.apiKey,
      appId,
    );
    if (!remote) {
      showError("Failed to check for updates from HubcapDB.", {
        id: `console-check-${appId}`,
        duration: 3000,
      });
      return false;
    }

    const result = checkHubcapAppUpdate(appId, remote);

    await updateProviderRemoteStatus(
      appId,
      providerId,
      {
        status: remote.status,
        gameName: remote.gameName ?? null,
        manifestFileExists: remote.manifestFileExists ?? null,
        autoUpdateEnabled: remote.autoUpdateEnabled ?? null,
        updateInProgress: remote.updateInProgress ?? null,
        fileSize: remote.fileSize ?? null,
        fileModified: remote.fileModified ?? null,
        fileAgeDays: remote.fileAgeDays ?? null,
        needsUpdate: remote.needsUpdate ?? null,
        updateReason: remote.updateReason ?? null,
        timestamp: remote.timestamp ?? null,
      },
      {
        status: result.status,
        reason: result.reason,
      },
      {
        luaDir: settings.luaPath || undefined,
        steamRoot: settings.steamRoot || undefined,
      },
    );

    if (DEBUG_CONSOLE_ACTIONS) {
      console.log(
        `[CONSOLE][CHECK_RESULT] appid=${appId} status=${result.status} reason=${result.reason}`,
      );
    }

    if (result.status === "update-available") {
      showSuccess(`Update available for ${game.title}`, {
        id: `console-update-ready-${appId}`,
        duration: 4000,
      });
    } else if (result.status === "up-to-date") {
      showSuccess(`${game.title} is up to date`, {
        id: `console-up-to-date-${appId}`,
        duration: 3000,
      });
    } else if (result.status === "provider-unavailable") {
      showWarning(`${result.reason}`, {
        id: `console-provider-unavailable-${appId}`,
        duration: 3000,
      });
    } else {
      showWarning(`Status: ${result.status} - ${result.reason}`, {
        id: `console-check-result-${appId}`,
        duration: 3000,
      });
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError(`Update check failed: ${msg}`, {
      id: `console-check-error-${appId}`,
      duration: 3000,
    });
    return false;
  }
}

/* ── Primary action dispatcher ── */

export async function handleConsolePrimaryAction(
  game: LibraryGame,
  action: ConsolePrimaryAction,
  options: ConsoleGameActionOptions,
): Promise<ConsoleActionResult> {
  const appId = game.appId;
  if (!appId) {
    return { action: "unavailable", success: false, error: "no-appId" };
  }

  // In-flight guard
  if (_inFlight.has(appId)) {
    const currentAction = _inFlight.get(appId)!;
    if (DEBUG_CONSOLE_ACTIONS) {
      console.log(
        `[CONSOLE_ACTION][IN_FLIGHT] appid=${appId} current=${currentAction} attempted=${action}`,
      );
    }
    showWarning(`Action already in progress`, {
      id: `console-inflight-${appId}`,
      duration: 2000,
    });
    return { action, success: false, error: "in-flight" };
  }

  _inFlight.set(appId, action);

  try {
    switch (action) {
      case "play": {
        options.onPlayGame?.(game);
        return { action, success: true };
      }

      case "install": {
        // Debrid install (download + extract)
        if (game.source === "debrid" && DEBRID_INSTALL_ENABLED && DEBRID_LIBRARY_ENABLED) {
          try {
            const { getRepacksForAppId } = await import("../../services/repackCatalogService");
            const repacks = await getRepacksForAppId(Number(appId));
            if (repacks.length === 0) {
              showWarning("No Debrid repack sources found.", { id: `console-debrid-nosrc-${appId}`, duration: 3000 });
              return { action, success: false, error: "no-repacks" };
            }
            const rawEntry = repacks[0];
            const downloadUri = pickInstallUriWithoutDialog(rawEntry.downloadUris);
            if (!downloadUri) {
              showWarning("No download URI available for this Debrid game.", { id: `console-debrid-nouri-${appId}`, duration: 3000 });
              return { action, success: false, error: "no-download-uri" };
            }
            if (DEBUG_DEBRID_INSTALL) {
              console.log(`[DEBRID][CONSOLE_INSTALL] appId=${appId} repacks=${repacks.length} using=${rawEntry.repacker}`);
            }
            options.addJob({
              id: `debrid-install-${rawEntry.id}-${Date.now()}`,
              type: "debrid-install",
              title: game.title,
              status: "queued",
              progress: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              providerGameId: rawEntry.id,
              downloadUri,
              installerType: rawEntry.installerType || "zip",
              appId,
              artworkUrl: game.imageUrl,
            } as any);
            showSuccess(`Queued Debrid install (${rawEntry.repacker})`, { id: `console-debrid-queued-${appId}`, duration: 3000 });
            return { action, success: true };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showError(`Debrid install failed: ${msg}`, { id: `console-debrid-error-${appId}`, duration: 3000 });
            return { action, success: false, error: msg };
          }
        }

        // Reuse Library/GameDetails install flow (installSteamApp + installTrackerService)
        if (!appId || !appId.match(/^\d+$/)) {
          showWarning("This game cannot be installed through Steam because it has no AppID.", {
            id: `console-install-noappid-${appId}`,
            duration: 3000,
          });
          return { action, success: false, error: "no-numeric-appid" };
        }

        try {
          await installSteamApp(Number(appId));
          installTrackerService.startTracking(
            appId,
            options.settings.steamRoot,
            game.title || appId,
            game.imageUrl,
          );
          showSuccess("Opening Steam to install the game…", {
            id: `console-steam-install-${appId}`,
            duration: 3000,
          });
          return { action, success: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showError(`Failed to start Steam install: ${msg}`, {
            id: `console-steam-install-error-${appId}`,
            duration: 3000,
          });
          return { action, success: false, error: msg };
        }
      }

      case "update": {
        const source = await resolveCachedSource(appId);
        if (source) {
          const pkg: PackageGame = {
            appId,
            title: game.title || appId,
            platforms: [],
            sources: [source],
          };
          const result = await downloadFromSource(pkg, source, {
            settings: options.settings,
            addJob: options.addJob,
            updateJob: options.updateJob,
            libraryRefresh: options.libraryRefresh,
            mountedRef: options.mountedRef,
          });
          return { action, success: result.success, error: result.error };
        }

        showWarning(
          "Update source not available. Use Store to configure sources.",
          { id: `console-update-nosrc-${appId}`, duration: 4000 },
        );
        return { action, success: false, error: "no-source" };
      }

      case "select-exe": {
        try {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const { updateDebridGame } = await import("../../services/debridGameStore");
          const selected = await open({
            title: "Select game executable",
            filters: [{ name: "Executables", extensions: ["exe", "com", "bat"] }],
            defaultPath: game.installDir || "C:\\",
            multiple: false,
          });
          if (selected && game.providerGameId) {
            updateDebridGame(game.providerGameId, game.installDir || "", selected);
            showSuccess("Game executable set. Ready to play!");
          }
          return { action, success: !!selected };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          showError(`File picker failed: ${msg}`);
          return { action, success: false, error: msg };
        }
      }

      case "installing": {
        showWarning("Game is still installing", {
          id: `console-installing-${appId}`,
          duration: 2500,
        });
        return { action, success: false, error: "installing" };
      }

      case "check-update": {
        const ok = await handleConsoleCheckUpdates(game, options.settings);
        return { action, success: ok };
      }

      case "up-to-date": {
        showSuccess(`${game.title} is up to date`, {
          id: `console-already-updated-${appId}`,
          duration: 2500,
        });
        return { action, success: true };
      }

      case "blocked": {
        const reason = modelBlockedReason(getLauncherGamePrimaryAction(game));
        showWarning(reason, {
          id: `console-blocked-${appId}`,
          duration: 3000,
        });
        return { action, success: false, error: "blocked" };
      }

      default: {
        showWarning("This game is not playable yet", {
          id: `console-unavailable-${appId}`,
          duration: 3000,
        });
        return { action, success: false, error: "unavailable" };
      }
    }
  } finally {
    _inFlight.delete(appId);
  }
}
