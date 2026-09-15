import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { InstallerNetworkEvent, InstallerProgressEvent } from "../../types/download";
import type { DownloadJob } from "../../types/download";
import { discoverGameExecutable } from "../../utils/gameProcessDetection";
import { setStandalone, isStandalone as isStandaloneById } from "../../services/standaloneStore";
import {
  libraryCheckFixInstallations,
  libraryApplyGoldberg,
  libraryApplySteamless,
  seedGseSavesFolder,
  slssteamStatus,
  slssteamConfigAddAdditionalApp,
  slssteamConfigAddAppToken,
  slssteamKillSteam,
  slssteamStartSteam,
  steamLibraryDetect,
  steamLibraryEnsureStructure,
  steamLibraryMoveManifests,
  steamLibraryUpdateVdf,
  steamAcfCreate,
  DepotInfo,
} from "../../services/tauri";
import { updateConfigForCrack } from "../../services/achievementConfigService";
import { achievementWatcherService } from "../../services/achievementWatcherService";
import { saveDepotManifests } from "../../services/depotUpdateStore";
import { setPendingLibraryFocus } from "../../services/libraryNavigationService";
import { loadSettings } from "../../context/SettingsContext";
import { showSuccess } from "../toast/GameToast";

async function detectPlatform(): Promise<string> {
  try {
    // Try Tauri's OS detection via Rust
    const { invoke } = await import("@tauri-apps/api/core");
    const sysInfo = await invoke<{ os: string }>("get_system_info");
    return sysInfo.os?.toLowerCase() || "unknown";
  } catch {
    // Fallback to navigator
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("linux")) return "linux";
    if (ua.includes("windows")) return "windows";
    if (ua.includes("mac")) return "macos";
    return "unknown";
  }
}

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

  // On Linux, the backend now downloads directly to steamapps/common/<game_name>
  // On Windows, the backend appends /{appId} to the output_dir
  const platform = navigator.platform.toLowerCase().includes("linux") ? "linux" : "windows";
  const installDir = platform === "linux"
    ? (() => {
        // Match the sanitized name the Rust backend uses exactly:
        // keep alphanumeric, space, -, . → everything else becomes _
        // then trim and replace each space with _
        const safeName = (gameTitle || "")
          .replace(/[^a-zA-Z0-9 .-]/g, "_")
          .trim()
          .replace(/ /g, "_");
        const installdir = safeName || `App_${appId}`;
        return `${destDir}/steamapps/common/${installdir}`;
      })()
    : `${destDir}/${appId}`;

  console.log(`[DepotComplete] processing app=${appId} title="${gameTitle}" dir="${installDir}" platform=${platform}`);

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

  // 4. Platform-specific injection: SLS Steam (Linux) or Goldberg (Windows)
  const detectedPlatform = await detectPlatform();

  if (detectedPlatform === "linux") {
    // ── Linux: Full SLS Steam integration (ACCELA-style flow) ────────────
    try {
      const slsStatus = await slssteamStatus();
      if (!slsStatus.installed) {
        console.log("[DepotComplete] SLS Steam not installed on Linux, skipping injection");
        return;
      }

      console.log("[DepotComplete] SLS Steam detected, starting full integration...");

      const numericAppId = Number(appId);

      // 1. Detect Steam libraries and pick the primary one
      const libraries = await steamLibraryDetect();
      if (libraries.length === 0) {
        console.error("[DepotComplete] No Steam libraries found on Linux");
        return;
      }
      const targetLib = libraries.find((l) => l.is_primary) || libraries[0];
      console.log(`[DepotComplete] Using Steam library: ${targetLib.path}`);

      // 2. Ensure steamapps structure exists
      await steamLibraryEnsureStructure(targetLib.path);

      // 3. Game files are ALREADY at steamapps/common/<installdir> (Rust backend put them there)
      // No file move needed — just log the path
      const safeGameName = (gameTitle || "").replace(/[^a-zA-Z0-9 .-]/g, "_").trim().replace(/ /g, "_");
      const installdir = safeGameName || `App_${numericAppId}`;
      console.log(`[DepotComplete] Game files already at ${targetLib.path}/steamapps/common/${installdir}`);

      // 4. Move manifests to depotcache
      const depotsMap: [number, string][] = [];
      if (job.depotSelections) {
        for (const sel of job.depotSelections) {
          if (sel.manifestId) {
            depotsMap.push([sel.depotId, sel.manifestId]);
          }
        }
      }
      if (depotsMap.length > 0) {
        try {
          const moved = await steamLibraryMoveManifests(installDir, targetLib.path, depotsMap, numericAppId);
          console.log(`[DepotComplete] Moved ${moved} manifest(s) to depotcache`);
        } catch (err) {
          console.warn("[DepotComplete] Failed to move manifests to depotcache:", err);
        }
      }

      // 5. Create appmanifest_{appid}.acf
      const depotsForAcf: DepotInfo[] = depotsMap.map(([depotId, gid]) => ({
        depot_id: depotId,
        manifest_gid: gid,
        size: 0,
        os: undefined,
      }));

      // Detect if Proton is needed (Windows-only depots)
      // On Linux, DepotDownloaderMod downloads Windows depots — always need Proton
      const isProtonGame = detectedPlatform === "linux";

      try {
        await steamAcfCreate(
          targetLib.path,
          numericAppId,
          gameTitle || `App ${appId}`,
          installdir,
          "0", // buildid — we don't have this yet
          0, // sizeOnDisk
          depotsForAcf,
          isProtonGame,
        );
        console.log("[DepotComplete] Created appmanifest ACF");
      } catch (err) {
        console.warn("[DepotComplete] Failed to create ACF:", err);
      }

      // 6. Update libraryfolders.vdf
      try {
        await steamLibraryUpdateVdf(targetLib.path, numericAppId);
        console.log("[DepotComplete] Updated libraryfolders.vdf");
      } catch (err) {
        console.warn("[DepotComplete] Failed to update libraryfolders.vdf:", err);
      }

      // 7. Add game to AdditionalApps in SLS Steam config
      const added = await slssteamConfigAddAdditionalApp(appId, gameTitle);
      if (added) {
        console.log(`[DepotComplete] Added app ${appId} to SLS Steam AdditionalApps`);
      }

      // 8. Add app token if available
      const appToken = (job as any).appToken;
      if (appToken) {
        await slssteamConfigAddAppToken(appId, appToken);
        console.log(`[DepotComplete] Added app token for ${appId}`);
      }

      // 9. Kill Steam and restart with LD_AUDIT injection
      console.log("[DepotComplete] Restarting Steam with SLS Steam injection...");
      await slssteamKillSteam();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await slssteamStartSteam();

      showSuccess(`"${gameTitle}" ready — Steam restarted with SLS Steam`);
    } catch (err) {
      console.warn("[DepotComplete] SLS Steam injection failed:", err);
    }
  } else {
    // ── Windows: Goldberg + Steamless (existing flow) ───────────────────
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
}
