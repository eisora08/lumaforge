import { useCallback, useRef } from "react";

import { DEBRID_INSTALL_ENABLED, DEBRID_LIBRARY_ENABLED, DEBUG_DEBRID_INSTALL } from "../features/debrid/debridFeatureFlag";
import { markDebridGameInstalling, setPendingCompletionNeedsPath, updateDebridGame, markDebridGameExtracted, markDebridGameStatus, setPendingSetup, updateDebridGameAppId, updateDebridGameTitle } from "../services/debridGameStore";
import { checkInstallerStatus, detectInstallPathFromRegistry, discoverExecutables, downloadDebridPackage, resolveAppDataDir, startTorrentDownload } from "../services/tauri";
import type { DebridDownloadResult } from "../services/tauri";
import { resolveDebridUri } from "../services/debridProviderService";
import type { DebridInstallMethod, RepackInstallOptions } from "../services/debridInstallChoice";
import type { ProviderId } from "../services/debridProviderService";
import type { DebridProviderConfig } from "../types/settings";
import type { DownloadJob } from "../types/download";

export type UpdateDebridJobFn = (jobId: string, update: Partial<{
  status: DownloadJob["status"];
  progress: number;
  bytesRead: number;
  totalBytes: number;
  message: string;
  progressMode: DownloadJob["progressMode"];
  speedBytesPerSec: number;
  etaSeconds: number;
  error: string;
  installedSize: number;
  installDir: string;
}>) => void;

export type DebridInstallHandle = {
  startInstall: (
    jobId: string,
    providerGameId: string,
    downloadUri: string,
    installerType: string,
    title: string,
    installMethod?: DebridInstallMethod,
    options?: RepackInstallOptions,
    appId?: string,
  ) => Promise<void>;
};

/**
 * Creates an install handler for Debrid repack games.
 *
 * The hook returns a stable handle with `startInstall()` that:
 *   1. Calls Rust installDebridPackage() to download + extract
 *   2. On success, updates the Debrid game store (isInstalled=true)
 *   3. Updates the DownloadJob throughout the lifecycle
 *
 * The handle is stored via a ref by DownloadQueueProvider and called
 * from addDebridInstallJob() after the job is created in the queue.
 */
const POLL_INSTALLER_MS = 2_000;
const POLL_TIMEOUT_MS = 600_000; // 10 min — installer likely requires user interaction

/**
 * Resolves a magnet URI through the configured debrid providers (TorBox,
 * Real-Debrid, AllDebrid, Premiumize). Non-magnet URIs pass through unchanged.
 *
 * Returns the direct download URL when a provider resolves the magnet. Throws
 * with the resolver's error message on failure. Callers may catch the throw
 * and fall back to the built-in torrent client for the same magnet (see
 * `startInstall`), since a raw magnet can never be fed to `download_file_to_dest`.
 */
/**
 * Resolves a magnet URI through the configured debrid providers (TorBox,
 * Real-Debrid, AllDebrid, Premiumize). Non-magnet URIs pass through unchanged.
 *
 * Returns the direct download URL (and the provider-provided filename, which
 * preserves the real extension, e.g. `setup.exe` for a FitGirl repack — the
 * CDN URL alone has no usable filename). Throws with the resolver's error
 * message on failure. Callers may catch the throw and fall back to the built-in
 * torrent client for the same magnet (see `startInstall`), since a raw magnet
 * can never be fed to `download_file_to_dest`.
 */
async function resolveInstallUri(
  downloadUri: string,
  preferredProvider?: ProviderId,
): Promise<{
  url: string;
  fileName?: string;
  fileCount?: number;
  resolvedUrls?: string[];
  fileNames?: string[];
}> {
  if (!downloadUri.startsWith("magnet:")) {
    return { url: downloadUri };
  }

  let settings;
  try {
    const { loadSettings } = await import("../context/SettingsContext");
    settings = loadSettings();
  } catch (err) {
    console.warn("[DEBRID_INSTALL] magnet resolution error loading settings", err);
    throw new Error(
      "Could not load debrid settings to resolve the magnet link. Configure a debrid provider in Settings.",
    );
  }

  const config: DebridProviderConfig = settings.debridProviders;

  let result;
  try {
    result = await resolveDebridUri(downloadUri, config, preferredProvider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[DEBRID_INSTALL] magnet resolution error", err);
    throw new Error(`Could not resolve magnet link via debrid provider: ${msg}`);
  }

  if (result.success && result.resolvedUrl) {
    if (DEBUG_DEBRID_INSTALL) {
      console.log(
        `[DEBRID_INSTALL] magnet resolved provider=${result.provider} url=${result.resolvedUrl.slice(0, 80)}\u2026`,
      );
    }
    return {
      url: result.resolvedUrl,
      fileName: result.fileName,
      fileCount: result.fileCount,
      resolvedUrls: result.resolvedUrls,
      fileNames: result.fileNames,
    };
  }

  throw new Error(
    result.error
      ? `No debrid provider resolved the magnet link: ${result.error}`
      : "No debrid provider resolved the magnet link. Configure a debrid provider in Settings.",
  );
}

/**
 * Picks which file of a multivolume repack must be downloaded + extracted LAST.
 * The volumes (`.bin` parts) are downloaded first with autoExtract=false so they
 * are all present on disk; the primary part is fetched last with autoExtract=true
 * so the set reassembles in order and its installer auto-runs. Priority:
 *
 *   1. The installer executable (*.exe) — the last one in the list is picked so
 *      every `.bin` volume it reads already exists on disk. Only files ending in
 *      `.exe` match: volume parts named like `setup-1.bin`/`installer.bin` must
 *      NEVER be treated as the installer (they carry no archive/PE magic and
 *      would fail detection), so the regex anchors on `.exe$` exclusively.
 *   2. The first-volume archive (.part1.rar / .rar / .r00) — the piece that
 *      reassembles a multivolume archive set.
 *   3. Fallback: the last item in the list.
 */
function pickPrimaryPartIndex(fileNames: string[]): number {
  let installerIndex = -1;
  for (let i = 0; i < fileNames.length; i++) {
    const n = fileNames[i].toLowerCase();
    if (/\.exe$/.test(n)) installerIndex = i;
  }
  if (installerIndex >= 0) return installerIndex;

  for (let i = 0; i < fileNames.length; i++) {
    const n = fileNames[i].toLowerCase();
    if (/part0*1\.rar$|\.rar$|\.r00$/.test(n)) return i;
  }

  return fileNames.length - 1;
}

/** Fire-and-forget native media materialization for an installed Debrid game.
 * Fire-and-forget native media materialization for an installed Debrid game.
 * Once the game has a valid Steam appId, this queues a repair scan that resolves
 * Steam metadata + artwork and downloads missing roles to games/steam/<appId>/media/.
 * That makes the Library grid + details render the real Steam artwork immediately
 * (the pipeline is appId-keyed, not source-keyed).
 */
function queueNativeArtworkRefresh(appId?: string): void {
  const num = appId ? Number(appId) : NaN;
  const valid = Number.isInteger(num) && num > 0;
  if (!valid) return;
  const validAppId = String(num);
  import("../services/gameCacheService")
    .then(({ detectAndQueueMissingMedia }) =>
      // "refresh-artwork" is a MANUAL_ARTWORK_SOURCE — passes the emergency
      // stabilization gate (global/boot repair stays disabled).
      detectAndQueueMissingMedia(validAppId, "refresh-artwork"),
    )
    .catch((e) => console.warn("[DEBRID_INSTALL] native artwork refresh skipped", e));
}

/**
 * Persist the clean Steam title + appId onto the Debrid store entry and kick off
 * the native artwork materialization. AppId overrides survive catalog refresh +
 * restart (persisted to debrid-games.json), which is what unlocks the appId-keyed
 * media pipeline.
 */
function persistDebridIdentity(providerGameId: string, title: string, appId?: string): void {
  const num = appId ? Number(appId) : NaN;
  const validAppId = Number.isInteger(num) && num > 0;
  if (validAppId) {
    updateDebridGameAppId(providerGameId, String(num));
  }
  if (title && title.trim() && !/^Steam App \d+$/.test(title.trim())) {
    updateDebridGameTitle(providerGameId, title.trim());
  }
  if (validAppId) {
    queueNativeArtworkRefresh(String(num));
  }
}

export function useDebridInstallSync(updateJob: UpdateDebridJobFn): DebridInstallHandle {
  const updateJobRef = useRef(updateJob);
  updateJobRef.current = updateJob;

  async function pollInstallerUntilDone(
    pid: number,
    installDir: string,
    jobId: string,
    providerGameId: string,
    title: string,
    appId?: string,
  ): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastLog = 0;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INSTALLER_MS));

      try {
        const poll = await checkInstallerStatus({ pid, installDir });

        if (poll.status === "ready") {
          persistDebridIdentity(providerGameId, title, appId);
          updateDebridGame(providerGameId, installDir, poll.executablePath ?? undefined);
          updateJobRef.current(jobId, {
            status: "done",
            progress: 100,
            message: "Installed \u00b7 Ready to play",
            progressMode: "determinate",
            installedSize: 0,
            installDir,
          });
          if (DEBUG_DEBRID_INSTALL) {
            console.log(`[DEBRID_INSTALL] installer-done jobId=${jobId} exe=${poll.executablePath}`);
          }
          return;
        }

        if (poll.status === "needs-path") {
          // Try registry auto-detect first before showing the file picker modal
          try {
            const registryMatch = await detectInstallPathFromRegistry(title);
            if (registryMatch?.installLocation) {
              // Look for .exe files in the detected install location
              const exes = await discoverExecutables(registryMatch.installLocation);
              const best =
                exes.find(
                  (e) =>
                    !e.file_name.toLowerCase().includes("setup") &&
                    !e.file_name.toLowerCase().includes("uninstall") &&
                    !/^unins000/i.test(e.file_name) &&
                    !/^UnityCrashHandler64/i.test(e.file_name),
                ) ?? exes[0];
              if (best) {
                updateDebridGame(providerGameId, registryMatch.installLocation, best.exe_path);
                persistDebridIdentity(providerGameId, title, appId);
                updateJobRef.current(jobId, {
                  status: "done",
                  progress: 100,
                  message: "Installed \u00b7 Ready to play",
                  progressMode: "determinate",
                  installedSize: 0,
                  installDir: registryMatch.installLocation,
                });
                if (DEBUG_DEBRID_INSTALL) {
                  console.log(`[DEBRID_INSTALL] registry-detect jobId=${jobId} location=${registryMatch.installLocation} exe=${best.exe_path}`);
                }
                return;
              }
            }
          } catch {
            // Registry scan failed — fall through to modal
          }

          // Show modal with file picker for the user to select the game executable
          setPendingCompletionNeedsPath(providerGameId, installDir, { title, appId });
          setPendingSetup(providerGameId, "", installDir);
          updateJobRef.current(jobId, {
            status: "done",
            progress: 100,
            message: "Installer finished \u00b7 Select game executable",
            progressMode: "determinate",
            installedSize: 0,
            installDir,
          });
          if (DEBUG_DEBRID_INSTALL) {
            console.log(`[DEBRID_INSTALL] needs-path jobId=${jobId}`);
          }
          return;
        }

        // still running — log every 30s
        if (DEBUG_DEBRID_INSTALL && Date.now() - lastLog > 30_000) {
          lastLog = Date.now();
          console.log(`[DEBRID_INSTALL] installer-running jobId=${jobId} pid=${pid}`);
        }
      } catch {
        // poll failed (e.g. pid died between checks) — fall through to timeout
        break;
      }
    }

    // Timeout — show modal for the user to re-run the installer manually
    if (DEBUG_DEBRID_INSTALL) {
      console.log(`[DEBRID_INSTALL] installer-timeout jobId=${jobId} pid=${pid}`);
    }
    setPendingCompletionNeedsPath(providerGameId, installDir, { title, appId });
    setPendingSetup(providerGameId, "", installDir);
    updateJobRef.current(jobId, {
      status: "done",
      progress: 100,
      message: "Installer timed out \u00b7 Re-run setup manually",
      progressMode: "determinate",
      installedSize: 0,
      installDir,
    });
  }

  async function handleInstallResult(
    result: DebridDownloadResult,
    providerGameId: string,
    jobId: string,
    title: string,
    appId?: string,
  ): Promise<void> {
    if (!result.success && result.status === "paused") {
      // Paused by the user — the HTTP `.part` checkpoint (or torrent fastresume +
      // persistence) is kept on disk. Keep the job "paused" so it can be resumed
      // later; do NOT reset the Debrid store status (it was never marked done).
      updateJobRef.current(jobId, {
        status: "paused",
        message: result.message || "Download paused",
      });
      if (DEBUG_DEBRID_INSTALL) {
        console.log(`[DEBRID_INSTALL] paused jobId=${jobId} msg=${result.message}`);
      }
      return;
    }

    if (result.success) {
      if (result.status === "downloaded") {
        // autoExtract was off — download only, archive left on disk. Do NOT mark
        // the game as installed and do NOT touch the Debrid store: the user has
        // to extract the archive manually before the game is playable.
        updateJobRef.current(jobId, {
          status: "done",
          progress: 100,
          message: "Descarga completada \u00b7 Extrae el archivo manualmente",
          progressMode: "determinate",
          installedSize: 0,
          installDir: result.installDir,
        });

        if (DEBUG_DEBRID_INSTALL) {
          console.log(
            `[DEBRID_INSTALL] downloaded jobId=${jobId} installDir=${result.installDir}`,
          );
        }
      } else if (result.status === "ready") {
        // ZIP/RAR extracted, game executable found
        updateDebridGame(providerGameId, result.installDir, result.executablePath ?? undefined);
        persistDebridIdentity(providerGameId, title, appId);

        updateJobRef.current(jobId, {
          status: "done",
          progress: 100,
          message: "Installed \u00b7 Ready to play",
          progressMode: "determinate",
          installedSize: 0,
          installDir: result.installDir,
        });

        if (DEBUG_DEBRID_INSTALL) {
          console.log(
            `[DEBRID_INSTALL] ready jobId=${jobId} installDir=${result.installDir} exe=${result.executablePath}`,
          );
        }
      } else if (result.status === "installing") {
        // Installer detached and running — add game to library, poll for completion
        markDebridGameInstalling(providerGameId, result.installDir);
        // Persist identity early (steps/install dir known) so the appId-keyed
        // source resolution can start while the installer runs.
        persistDebridIdentity(providerGameId, title, appId);

        updateJobRef.current(jobId, {
          status: "downloading",
          progress: 80,
          message: "Installing\u2026 Wait for the installer to finish",
          progressMode: "indeterminate",
          installDir: result.installDir,
        });

        if (result.installerPid) {
          await pollInstallerUntilDone(result.installerPid, result.installDir, jobId, providerGameId, title, appId);
        } else {
          // No PID — fall back to needs-setup
          markDebridGameExtracted(providerGameId, result.installerPath ?? "", result.installDir, {
            title,
            repacker: (result as any).repacker,
            appId,
          });
          updateJobRef.current(jobId, {
            status: "done",
            progress: 100,
            message: "Extraction complete \u00b7 Setup required",
            progressMode: "determinate",
            installedSize: 0,
            installDir: result.installDir,
          });
        }
      } else if (result.status === "needs-setup") {
        // Extraction complete, setup.exe ready on disk — add to library + show modal
        markDebridGameExtracted(providerGameId, result.installerPath ?? "", result.installDir, {
          title,
          repacker: (result as any).repacker,
          appId,
        });
        persistDebridIdentity(providerGameId, title, appId);

        if (result.installerPath) {
          setPendingSetup(providerGameId, result.installerPath, result.installDir);
        }

        updateJobRef.current(jobId, {
          status: "done",
          progress: 100,
          message: "Extraction complete \u00b7 Setup required",
          progressMode: "determinate",
          installedSize: 0,
          installDir: result.installDir,
        });

        if (DEBUG_DEBRID_INSTALL) {
          console.log(
            `[DEBRID_INSTALL] needs-setup jobId=${jobId} installDir=${result.installDir} installer=${result.installerPath}`,
          );
        }
      }
    } else {
      markDebridGameStatus(providerGameId, "not-downloaded");
      updateJobRef.current(jobId, {
        status: "failed",
        message: result.message || "Download failed",
        error: result.message,
        progressMode: "indeterminate",
      });
    }
  }

  const startInstall = useCallback(
    async (
      jobId: string,
      providerGameId: string,
      downloadUri: string,
      installerType: string,
      title: string,
      installMethod?: DebridInstallMethod,
      options?: RepackInstallOptions,
      appId?: string,
    ) => {
      if (!DEBRID_INSTALL_ENABLED || !DEBRID_LIBRARY_ENABLED) {
        updateJobRef.current(jobId, {
          status: "failed",
          message: "Debrid install is disabled",
          error: "Feature not enabled",
        });
        return;
      }

      updateJobRef.current(jobId, {
        status: "downloading",
        message: `Downloading ${title}\u2026`,
        progressMode: "indeterminate",
      });

      if (DEBUG_DEBRID_INSTALL) {
        console.log(
          `[DEBRID_INSTALL] start jobId=${jobId} providerGameId=${providerGameId} type=${installerType} method=${installMethod ?? "auto"}`,
        );
      }

      try {
        // Custom destination directory wins; otherwise default to
        // <appData>/games/debrid/<providerGameId>.
        let destDir = options?.destDir;
        if (!destDir) {
          const appDataDir = await resolveAppDataDir();
          destDir = `${appDataDir}/games/debrid/${providerGameId}`;
        }
        const autoExtract = options?.autoExtract ?? true;
        const deleteArchive = options?.deleteArchive ?? false;

        let result: DebridDownloadResult | null = null;

        if (installMethod === "torrent") {
          // Magnet downloaded by the built-in torrent client (librqbit).
          result = await startTorrentDownload({
            jobId,
            magnet: downloadUri,
            destDir,
            autoExtract,
            deleteArchive,
          });
        } else {
          // Magnets need to be resolved through a configured debrid provider
          // (TorBox / Real-Debrid / AllDebrid / Premiumize) to get a direct URL.
let effectiveUri: string | undefined;
          let effectiveFileName: string | undefined;
          try {
            const resolved = await resolveInstallUri(downloadUri, options?.provider);
            // A multivolume repack (setup.exe + several `.bin` parts) reports
            // multiple resolvedUrls. Each part is downloaded sequentially through
            // the debrid provider: every volume first (autoExtract=false, just
            // saved to disk), then the primary part — the installer exe or the
            // first-volume archive — LAST (autoExtract=true) so the set
            // reassembles in order and setup runs once everything is present.
            const urls = resolved.resolvedUrls ?? [];
            if (urls.length > 1 && downloadUri.startsWith("magnet:")) {
              const names = resolved.fileNames ?? [];
              const primaryIndex = pickPrimaryPartIndex(names);
              console.log(
                `[DEBRID_INSTALL] multivolume files=${urls.length} primary=${names[primaryIndex] ?? primaryIndex} jobId=${jobId}`,
              );
              // Download every volume first (autoExtract=false, just saved to
              // disk) and the primary part LAST (autoExtract=true) so the set
              // reassembles in order and setup.exe auto-runs only once every
              // volume it reads is verified on disk. The loop is sequential
              // (await per part), so the queue is empty by construction when the
              // primary starts — this ordering guarantees that even if the
              // primary appears first in the file list.
              const order = [
                ...urls.map((_, i) => i).filter((i) => i !== primaryIndex),
                primaryIndex,
              ];
              for (const i of order) {
                const isPrimary = i === primaryIndex;
                result = await downloadDebridPackage({
                  jobId,
                  downloadUri: urls[i],
                  downloadName: names[i] || undefined,
                  destDir,
                  autoExtract: isPrimary ? autoExtract : false,
                  deleteArchive: isPrimary ? deleteArchive : false,
                  sourceKey: downloadUri,
                });
                if (!result?.success) break;
              }
            } else {
              effectiveUri = resolved.url;
              effectiveFileName = resolved.fileName;
            }
          } catch (resolveErr) {
            // Debrid resolution failed — if the source is a magnet, fall back to
            // the built-in torrent client so the download always proceeds.
            if (!downloadUri.startsWith("magnet:")) throw resolveErr;
            const msg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
            console.warn(
              `[DEBRID_INSTALL] debrid-resolve-failed reason=${msg} \u2192 torrent fallback jobId=${jobId}`,
            );
            result = await startTorrentDownload({
              jobId,
              magnet: downloadUri,
              destDir,
              autoExtract,
              deleteArchive,
            });
          }

          if (effectiveUri) {
            result = await downloadDebridPackage({
              jobId,
              downloadUri: effectiveUri,
              downloadName: effectiveFileName,
              destDir,
              autoExtract,
              deleteArchive,
              sourceKey: downloadUri,
            });
          }
        }

        if (result) {
          await handleInstallResult(result, providerGameId, jobId, title, appId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        markDebridGameStatus(providerGameId, "not-downloaded");
        updateJobRef.current(jobId, {
          status: "failed",
          message: "Download failed",
          error: msg,
          progressMode: "indeterminate",
        });

        if (DEBUG_DEBRID_INSTALL) {
          console.error(`[DEBRID_INSTALL] error jobId=${jobId} err=`, err);
        }
      }
    },
    [],
  );

  return { startInstall };
}
