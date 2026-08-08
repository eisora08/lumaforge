import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { InstallerNetworkEvent, InstallerProgressEvent } from "../../types/download";

export default function InstallerProgressListener() {
  const { updateJob } = useDownloadQueue();

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenNetwork: (() => void) | undefined;

    async function setupListener() {
      unlistenProgress = await listen<InstallerProgressEvent>(
        "installer-progress",
        (event) => {
          const payload = event.payload;

          updateJob(payload.job_id, {
            status: payload.status,
            progress: payload.progress,
            message: payload.message,

            ...(payload.total_bytes > 0
              ? { progressMode: "determinate", totalBytes: payload.total_bytes }
              : {}),

            ...(payload.bytes_read > 0
              ? { bytesRead: payload.bytes_read }
              : {}),
          });
        }
      );

      unlistenNetwork = await listen<InstallerNetworkEvent>(
        "installer-network",
        (event) => {
          const payload = event.payload;

          updateJob(payload.job_id, {
            peers: payload.peers,
            seeds: payload.seeds,
          });
        }
      );
    }

    setupListener();

    return () => {
      if (unlistenProgress) {
        unlistenProgress();
      }
      if (unlistenNetwork) {
        unlistenNetwork();
      }
    };
  }, [updateJob]);

  return null;
}
