import { useEffect, useRef } from "react";
import { epicInstallTrackerService } from "../services/epicInstallTrackerService";
import type { DownloadJob } from "../types/download";

type SyncApi = {
  addEpicInstallJob: (appName: string, title: string, artworkUrl?: string) => string;
  updateJob: (jobId: string, update: Partial<{
    status: DownloadJob["status"];
    progress: number;
    message: string;
    progressMode: DownloadJob["progressMode"];
  }>) => void;
  removeJob: (jobId: string) => void;
};

export function useEpicInstallSync(sync: SyncApi): void {
  const startedRef = useRef<Set<string>>(new Set());
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    return epicInstallTrackerService.onAny((appName, state) => {
      const jobId = `epic-install-${appName}`;

      if (state.status === "waiting" && !startedRef.current.has(appName)) {
        startedRef.current.add(appName);
        const title = state.title || appName;
        syncRef.current.addEpicInstallJob(appName, title, state.artworkUrl);
        syncRef.current.updateJob(jobId, {
          status: "waiting",
          message: "Waiting for Epic Games Launcher\u2026",
          progressMode: "indeterminate",
        });
        return;
      }

      if (state.status === "detecting") {
        syncRef.current.updateJob(jobId, {
          status: "waiting",
          message: "Waiting for Epic Games Launcher\u2026",
          progressMode: "indeterminate",
        });
        return;
      }

      if (state.status === "installed") {
        syncRef.current.updateJob(jobId, {
          status: "done",
          progress: 100,
          message: "Installed \u00b7 Ready to play",
          progressMode: "determinate",
        });
        startedRef.current.delete(appName);
        return;
      }

      if (state.status === "timeout") {
        syncRef.current.updateJob(jobId, {
          status: "failed",
          message: "Timeout waiting for Epic Games Launcher to complete installation.",
          progressMode: "indeterminate",
        });
        startedRef.current.delete(appName);
        return;
      }

      if (state.status === "dismissed") {
        syncRef.current.removeJob(jobId);
        startedRef.current.delete(appName);
        return;
      }
    });
  }, []);
}
