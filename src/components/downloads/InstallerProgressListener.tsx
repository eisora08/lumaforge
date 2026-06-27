import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { InstallerProgressEvent } from "../../types/download";

export default function InstallerProgressListener() {
  const { updateJob } = useDownloadQueue();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setupListener() {
      unlisten = await listen<InstallerProgressEvent>(
        "installer-progress",
        (event) => {
          const payload = event.payload;

          updateJob(payload.job_id, {
            status: payload.status,
            progress: payload.progress,

            // Importante:
            // No sobrescribimos los bytes con 0 en eventos como extracting,
            // installing o done.
            ...(payload.bytes_read > 0
              ? { bytesRead: payload.bytes_read }
              : {}),

            ...(payload.total_bytes > 0
              ? { totalBytes: payload.total_bytes }
              : {}),
          });
        }
      );
    }

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [updateJob]);

  return null;
}