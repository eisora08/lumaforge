import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { installTrackerService } from "../services/installTrackingService";
import type { DownloadJob } from "../types/download";

type SyncApi = {
  addSteamInstallJob: (appId: string, title: string, artworkUrl?: string) => string;
  updateJob: (jobId: string, update: Partial<{
    status: DownloadJob["status"];
    progress: number;
    bytesRead: number;
    totalBytes: number;
    message: string;
    progressMode: DownloadJob["progressMode"];
    speedBytesPerSec: number;
    etaSeconds: number;
    error: string;
    artworkUrl: string;
    installedSize: number;
  }>) => void;
  removeJob: (jobId: string) => void;
};

export function useSteamInstallSync(sync: SyncApi): void {
  const { t } = useTranslation();
  const startedRef = useRef<Set<string>>(new Set());
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    return installTrackerService.onAny((appId, state) => {
      const jobId = `steam-install-${appId}`;

      if (state.status === "opening-steam" && !startedRef.current.has(appId)) {
        startedRef.current.add(appId);
        const title = state.title || state.appId;
        syncRef.current.addSteamInstallJob(appId, title, state.artworkUrl);
        syncRef.current.updateJob(jobId, {
          status: "waiting",
          message: "Opening Steam install\u2026",
          progressMode: "indeterminate",
          artworkUrl: state.artworkUrl ?? "",
        });
        return;
      }

      if (state.status === "waiting") {
        const elapsed = Math.floor(state.elapsedMs / 1000);
        syncRef.current.updateJob(jobId, {
          status: "waiting",
          message: elapsed > 15
            ? "Waiting for Steam to start installation\u2026"
            : "Starting Steam installation\u2026",
          progressMode: "indeterminate",
        });
        return;
      }

      if (state.status === "installing") {
        const dp = state.downloadProgress;
        if (dp && dp.bytesToDownload > 0) {
          // total size is known — distinguish bytesDownloaded>0 vs ===0
          if (dp.bytesDownloaded > 0 && dp.bytesDownloaded <= dp.bytesToDownload) {
            syncRef.current.updateJob(jobId, {
              status: "downloading",
              progress: Math.round(dp.percent),
              bytesRead: dp.bytesDownloaded,
              totalBytes: dp.bytesToDownload,
              progressMode: "determinate",
              message: `Downloading\u2026 ${Math.round(dp.percent)}%`,
              speedBytesPerSec: state.speedBytesPerSec ?? 0,
              etaSeconds: state.etaSeconds ?? undefined,
            });
          } else {
            // total known, but Steam has not started reporting downloaded bytes yet
            syncRef.current.updateJob(jobId, {
              status: "waiting",
              message: t("downloads.steam_waiting"),
              progressMode: "indeterminate",
              bytesRead: 0,
              totalBytes: dp.bytesToDownload,
            });
          }
        } else {
          // no download progress info at all
          syncRef.current.updateJob(jobId, {
            status: "waiting",
            message: "Installing with Steam\u2026",
            progressMode: "indeterminate",
            bytesRead: 0,
            totalBytes: 0,
          });
        }
        return;
      }

      if (state.status === "installed") {
        const installedSize = state.sizeOnDisk ?? state.downloadProgress?.bytesToDownload ?? 0;
        syncRef.current.updateJob(jobId, {
          status: "done",
          progress: 100,
          message: "Installed \u00b7 Ready to play",
          progressMode: "determinate",
          totalBytes: installedSize,
          installedSize,
          etaSeconds: undefined,
          speedBytesPerSec: undefined,
        });
        startedRef.current.delete(appId);
        return;
      }

      if (state.status === "timeout") {
        syncRef.current.updateJob(jobId, {
          status: "failed",
          message: "Steam did not start the installation",
          error: "Timeout waiting for Steam to begin downloading.",
          progressMode: "indeterminate",
        });
        startedRef.current.delete(appId);
        return;
      }

      if (state.status === "dismissed") {
        syncRef.current.removeJob(jobId);
        startedRef.current.delete(appId);
        return;
      }
    });
  }, []);
}
