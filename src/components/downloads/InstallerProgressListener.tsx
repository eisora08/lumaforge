import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { InstallerNetworkEvent, InstallerProgressEvent } from "../../types/download";
import type { DownloadJob } from "../../types/download";
import { discoverGameExecutable } from "../../utils/gameProcessDetection";
import { setStandalone, isStandalone as isStandaloneById } from "../../services/standaloneStore";
import { libraryCheckFixInstallations, libraryApplyGoldberg, libraryApplySteamless, seedGseSavesFolder } from "../../services/tauri";
import { updateConfigForCrack } from "../../services/achievementConfigService";
import { achievementWatcherService } from "../../services/achievementWatcherService";
import { saveDepotManifests } from "../../services/depotUpdateStore";
import { setPendingLibraryFocus } from "../../services/libraryNavigationService";
import { loadSettings } from "../../context/SettingsContext";
import { showSuccess } from "../toast/GameToast";

export default function InstallerProgressListener() {
  const { updateJob, jobs } = useDownloadQueue();
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const processedDepotJobsRef = useRef(new Set<string>());

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenNetwork: (() => void) | undefined;
    let cancelled = false;

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
          if (payload.status === "done" && !processedDepotJobsRef.current.has(payload.job_id)) {
            const job = jobsRef.current.find((j) => j.id === payload.job_id);
            if (job && job.type === "steam-depot-download" && job.destDir) {
              processedDepotJobsRef.current.add(payload.job_id);
              handleDepotDownloadComplete(job).catch((err) => {
                console.error("[DepotComplete] auto-register failed:", err);
              });
            }
          }
        }
      );

      if (cancelled) { unlistenProgress(); return; }

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
      cancelled = true;
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

  // The backend appends /{appId} to the output_dir, so files are in {destDir}/{appId}
  const installDir = `${destDir}/${appId}`;

  console.log(`[DepotComplete] processing app=${appId} title="${gameTitle}" dir="${installDir}"`);

  // 1. Auto-detect executable in the appId subfolder
  let detectedExe: string | undefined;
  try {
    const result = await discoverGameExecutable(installDir, gameTitle);
    detectedExe = result?.exePath;
    console.log(`[DepotComplete] detected exe: ${detectedExe || "(none)"}`);
  } catch (err) {
    console.warn("[DepotComplete] exe detection failed:", err);
  }

  // 2. Save depot install info (installDir + executable) linked to the Lua game
  if (job.depotSelections) {
    const depotsMap: Record<string, string> = {};
    for (const sel of job.depotSelections) {
      if (sel.manifestId) {
        depotsMap[String(sel.depotId)] = sel.manifestId;
      }
    }
    if (Object.keys(depotsMap).length > 0) {
      saveDepotManifests(appId, depotsMap, installDir, detectedExe);
      console.log(`[DepotComplete] saved depot install info + manifests for app=${appId}`);
    }
  } else {
    saveDepotManifests(appId, {}, installDir, detectedExe);
  }

  // Toast notification + auto-scroll to the Lua game in library
  showSuccess(`"${gameTitle}" downloaded and ready to play`);
  setPendingLibraryFocus(appId, gameTitle);

  // 3. Trigger library re-scan FIRST — this ensures the game appears in the library
  // even if standalone auto-apply is skipped (e.g., already active or tools not installed).
  // This also handles re-downloads after uninstall: the game transitions from uninstalled
  // back to installed state.
  window.dispatchEvent(new CustomEvent("lumaforge-lua-changed"));

  // 4. Auto-apply standalone mode if Goldberg + Steamless are installed
  try {
    // Guard: skip fixes if standalone already active for this game (but refresh still fired above)
    if (isStandaloneById(appId)) {
      console.log(`[DepotComplete] standalone already active for app=${appId}, skipping fixes`);
      return;
    }

    const status = await libraryCheckFixInstallations();
    if (!status.goldbergInstalled || !status.steamlessInstalled) {
      console.log("[DepotComplete] Goldberg/Steamless not installed, skipping standalone auto-apply");
      return;
    }

    console.log("[DepotComplete] auto-applying standalone mode...");
    const numericAppId = Number(appId);

    // Read Steam Web API key from settings (matches manual ToolsModal flow)
    const settings = loadSettings();
    const steamWebApiKey = settings.steamWebApiKey || "";

    // Wait for Windows Defender / antivirus to finish scanning newly-downloaded files.
    // On Windows, executables can be briefly locked by real-time AV scanning after download.
    // The manual ToolsModal works because user delay gives AV time to finish.
    console.log("[DepotComplete] waiting 3s for file settling (AV scan)...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Apply Goldberg with retry (up to 3 attempts)
    let goldbergOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await libraryApplyGoldberg({
          appId: numericAppId,
          name: gameTitle,
          installDir,
          steamWebApiKey,
        });
        console.log(`[DepotComplete] Goldberg applied (attempt ${attempt})`);
        goldbergOk = true;
        break;
      } catch (err) {
        console.warn(`[DepotComplete] Goldberg apply attempt ${attempt} failed:`, err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Seed GSE Saves folder for achievement tracking
    let gseSavesPath = "";
    try {
      gseSavesPath = await seedGseSavesFolder(appId);
      console.log(`[DepotComplete] GSE Saves seeded: ${gseSavesPath}`);
    } catch {
      // non-critical
    }

    // Apply Steamless with retry (up to 3 attempts)
    let steamlessOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await libraryApplySteamless({
          appId: numericAppId,
          name: gameTitle,
          installDir,
        });
        console.log(`[DepotComplete] Steamless applied (attempt ${attempt})`);
        steamlessOk = true;
        break;
      } catch (err) {
        console.warn(`[DepotComplete] Steamless apply attempt ${attempt} failed:`, err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Persist standalone flag ONLY if at least one fix succeeded
    if (goldbergOk || steamlessOk) {
      setStandalone(appId, true);
      console.log(`[DepotComplete] standalone mode activated for ${gameTitle} (goldberg=${goldbergOk} steamless=${steamlessOk})`);
    } else {
      console.warn(`[DepotComplete] both fixes failed — standalone NOT activated for ${gameTitle}`);
      return;
    }

    // Setup achievement tracking
    localStorage.setItem(`lumaforge-ach-platform-${appId}`, "steam");
    if (gseSavesPath) {
      try {
        await updateConfigForCrack(appId, gseSavesPath, gameTitle);
      } catch {
        // non-critical
      }
    }

    // Fix race condition: restart watcher FIRST, THEN set platform, THEN create schema
    // restartWatching() calls stop() which clears _platformByAppId, so we must
    // set the platform AFTER restart completes, not before.
    try {
      await achievementWatcherService.restartWatching();
    } catch {
      // non-critical
    }
    achievementWatcherService.setPlatform(appId, "steam");
    await achievementWatcherService.triggerSchemaCreation(appId);

    // Final library refresh to pick up standalone state
    window.dispatchEvent(new CustomEvent("lumaforge-lua-changed"));
  } catch (err) {
    console.warn("[DepotComplete] standalone auto-apply failed:", err);
  }
}
