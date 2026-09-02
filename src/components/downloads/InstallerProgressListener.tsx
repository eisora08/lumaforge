import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { InstallerNetworkEvent, InstallerProgressEvent } from "../../types/download";
import type { DownloadJob } from "../../types/download";
import { discoverGameExecutable } from "../../utils/gameProcessDetection";
import { saveManualGame, type ManualGameEntry } from "../../services/manualGameStore";
import { setStandalone } from "../../services/standaloneStore";
import { libraryCheckFixInstallations, libraryApplyGoldberg, libraryApplySteamless, seedGseSavesFolder } from "../../services/tauri";
import { updateConfigForCrack } from "../../services/achievementConfigService";
import { achievementWatcherService } from "../../services/achievementWatcherService";
import { saveDepotManifests } from "../../services/depotUpdateStore";

export default function InstallerProgressListener() {
  const { updateJob, jobs } = useDownloadQueue();
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenNetwork: (() => void) | undefined;
    const processedDepotJobs = new Set<string>();

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

          // Auto-register depot download as standalone manual game on completion
          if (payload.status === "done" && !processedDepotJobs.has(payload.job_id)) {
            const job = jobsRef.current.find((j) => j.id === payload.job_id);
            if (job && job.type === "steam-depot-download" && job.destDir) {
              processedDepotJobs.add(payload.job_id);
              handleDepotDownloadComplete(job).catch((err) => {
                console.error("[DepotComplete] auto-register failed:", err);
              });
            }
          }
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

/**
 * Handle depot download completion: auto-detect exe, register as manual game,
 * and auto-apply standalone mode (Goldberg + Steamless) if tools are installed.
 */
async function handleDepotDownloadComplete(job: DownloadJob): Promise<void> {
  const { appId, gameTitle, destDir } = job;
  if (!destDir || !appId) return;

  console.log(`[DepotComplete] processing app=${appId} title="${gameTitle}" dir="${destDir}"`);

  // 1. Auto-detect executable in output directory
  let detectedExe: string | undefined;
  try {
    const result = await discoverGameExecutable(destDir, gameTitle);
    detectedExe = result?.exePath;
    console.log(`[DepotComplete] detected exe: ${detectedExe || "(none)"}`);
  } catch (err) {
    console.warn("[DepotComplete] exe detection failed:", err);
  }

  // 2. Register as manual game
  const entry: ManualGameEntry = {
    id: crypto.randomUUID(),
    name: gameTitle,
    installDir: destDir,
    executablePath: detectedExe,
    linkedSteamAppId: appId,
    appId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  try {
    saveManualGame(entry);
    console.log(`[DepotComplete] registered manual game: ${entry.id}`);
  } catch (err) {
    console.error("[DepotComplete] saveManualGame failed:", err);
    return;
  }

  // 2b. Save manifest IDs for update detection
  if (job.depotSelections) {
    const depotsMap: Record<string, string> = {};
    for (const sel of job.depotSelections) {
      if (sel.manifestId) {
        depotsMap[String(sel.depotId)] = sel.manifestId;
      }
    }
    if (Object.keys(depotsMap).length > 0) {
      saveDepotManifests(appId, depotsMap, destDir);
      console.log(`[DepotComplete] saved depot manifests for update detection`);
    }
  }

  // 3. Auto-apply standalone mode if Goldberg + Steamless are installed
  try {
    const status = await libraryCheckFixInstallations();
    if (status.goldbergInstalled && status.steamlessInstalled) {
      console.log("[DepotComplete] auto-applying standalone mode...");
      const numericAppId = Number(appId);
      const installDir = destDir;

      // Apply Goldberg (Steam API emulation)
      try {
        await libraryApplyGoldberg({
          appId: numericAppId,
          name: gameTitle,
          installDir,
          steamWebApiKey: "",
        });
        console.log("[DepotComplete] Goldberg applied");
      } catch (err) {
        console.warn("[DepotComplete] Goldberg apply failed:", err);
      }

      // Seed GSE Saves folder for achievement tracking
      let gseSavesPath = "";
      try {
        gseSavesPath = await seedGseSavesFolder(appId);
        console.log(`[DepotComplete] GSE Saves seeded: ${gseSavesPath}`);
      } catch {
        // non-critical
      }

      // Apply Steamless (DRM removal) if applicable
      try {
        await libraryApplySteamless({
          appId: numericAppId,
          name: gameTitle,
          installDir,
        });
        console.log("[DepotComplete] Steamless applied");
      } catch (err) {
        console.warn("[DepotComplete] Steamless apply failed (may not have DRM):", err);
      }

      // Persist standalone flag
      setStandalone(appId, true);

      // Setup achievement tracking
      localStorage.setItem(`lumaforge-ach-platform-${appId}`, "steam");
      if (gseSavesPath) {
        try {
          await updateConfigForCrack(appId, gseSavesPath, gameTitle);
        } catch {
          // non-critical
        }
      }
      achievementWatcherService.setPlatform(appId, "steam");
      achievementWatcherService.triggerSchemaCreation(appId).catch(() => {});
      achievementWatcherService.restartWatching().catch(() => {});

      console.log(`[DepotComplete] standalone mode activated for ${gameTitle}`);
    } else {
      console.log("[DepotComplete] Goldberg/Steamless not installed, skipping standalone auto-apply");
    }
  } catch (err) {
    console.warn("[DepotComplete] standalone auto-apply failed:", err);
  }
}
