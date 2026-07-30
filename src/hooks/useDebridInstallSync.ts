import { useCallback, useRef } from "react";

import { DEBRID_INSTALL_ENABLED, DEBRID_LIBRARY_ENABLED, DEBUG_DEBRID_INSTALL } from "../features/debrid/debridFeatureFlag";
import { markDebridGameInstalling, setPendingCompletionNeedsPath, updateDebridGame, markDebridGameExtracted, markDebridGameStatus, setPendingSetup } from "../services/debridGameStore";
import { checkInstallerStatus, detectInstallPathFromRegistry, discoverExecutables, downloadDebridPackage, resolveAppDataDir } from "../services/tauri";
import type { DebridDownloadResult } from "../services/tauri";
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

export function useDebridInstallSync(updateJob: UpdateDebridJobFn): DebridInstallHandle {
  const updateJobRef = useRef(updateJob);
  updateJobRef.current = updateJob;

  async function pollInstallerUntilDone(
    pid: number,
    installDir: string,
    jobId: string,
    providerGameId: string,
    title: string,
  ): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastLog = 0;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INSTALLER_MS));

      try {
        const poll = await checkInstallerStatus({ pid, installDir });

        if (poll.status === "ready") {
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
              const best = exes.find((e) => !e.file_name.toLowerCase().includes("setup") && !e.file_name.toLowerCase().includes("uninstall"))
                ?? exes[0];
              if (best) {
                updateDebridGame(providerGameId, registryMatch.installLocation, best.exe_path);
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
          setPendingCompletionNeedsPath(providerGameId, installDir, { title });
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
    setPendingCompletionNeedsPath(providerGameId, installDir, { title });
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

  const startInstall = useCallback(
    async (
      jobId: string,
      providerGameId: string,
      downloadUri: string,
      installerType: string,
      title: string,
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
          `[DEBRID_INSTALL] start jobId=${jobId} providerGameId=${providerGameId} type=${installerType}`,
        );
      }

      try {
        const appDataDir = await resolveAppDataDir();
        const destDir = `${appDataDir}/games/debrid/${providerGameId}`;
        const result: DebridDownloadResult = await downloadDebridPackage({
          jobId,
          downloadUri,
          destDir,
        });

        if (result.success) {
          if (result.status === "ready") {
            // ZIP/RAR extracted, game executable found
            updateDebridGame(providerGameId, result.installDir, result.executablePath ?? undefined);

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

            updateJobRef.current(jobId, {
              status: "downloading",
              progress: 80,
              message: "Installing\u2026 Wait for the installer to finish",
              progressMode: "indeterminate",
              installDir: result.installDir,
            });

            if (result.installerPid) {
              await pollInstallerUntilDone(result.installerPid, result.installDir, jobId, providerGameId, title);
            } else {
              // No PID — fall back to needs-setup
              markDebridGameExtracted(providerGameId, result.installerPath ?? "", result.installDir, {
                title,
                repacker: (result as any).repacker,
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
            });

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
