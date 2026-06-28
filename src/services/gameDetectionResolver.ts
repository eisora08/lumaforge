import {
  scanLocalGameFolders,
  scanSteamInstalledGames,
} from "./tauri";
import { resolveGameMetadata } from "./gameMetadataResolver";
import type { LauncherGame } from "../types/launcherGame";
import type { AppSettings } from "../types/settings";
import type { LocalExecutableGame } from "../types/localExecutableGame";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().trim() : "";
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function stableIdFromString(prefix: string, value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(36)}`;
}

function getParentDirPath(exePath: string): string {
  const normalized = exePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : "";
}

function getDirNameFromPath(exePath: string): string {
  const parent = getParentDirPath(exePath);
  const lastSlash = parent.lastIndexOf("/");
  return lastSlash >= 0 ? parent.substring(lastSlash + 1) : parent;
}

const IGNORED_EXE_PATTERNS: RegExp[] = [
  /^unins/i,
  /^uninstall/i,
  /setup/i,
  /installer/i,
  /installhelper/i,
  /crash/i,
  /crashreport/i,
  /crashreporter/i,
  /bugreport/i,
  /bugreportclient/i,
  /bootstrapper/i,
  /helper$/i,
  /^updater/i,
  /^update/i,
  /service/i,
  /^server/i,
  /broker/i,
  /brokerinstaller/i,
  /^redist/i,
  /redistributable/i,
  /vc_redist/i,
  /vcredist/i,
  /^directx/i,
  /dxsetup/i,
  /dotnet/i,
  /runtime/i,
  /unitycrashhandler/i,
  /unrealcefsubprocess/i,
  /cefsubprocess/i,
  /webhelper/i,
  /notification/i,
  /telemetry/i,
  /diagnostic/i,
  /launcherhelper/i,
  /maintenanceservice/i,
  /applicationwallpaperinject/i,
  /^apputil/i,
  /^beservice/i,
  /battleye/i,
  /easyanticheat/i,
  /eosoverlayrenderer/i,
  /epicwebhelper/i,
  /ueprereqsetup/i,
  /installuwo/i,
  /oalinst/i,
  /xnafx/i,
  /gfm/i,
  /pyro/i,
  /msi/i,
  /vulkan/i,
  /physx/i,
  /^steam/i,
  /^config/i,
  /^launcher/i,
  /^notification/i,
];

const IGNORED_DIR_NAMES: RegExp[] = [
  /^_commonredist$/i,
  /^__installer$/i,
  /^redist$/i,
  /^installer$/i,
  /^directx$/i,
  /^vc_redist$/i,
  /^vcredist$/i,
  /^_installer$/i,
  /^commonredist$/i,
  /^support$/i,
  /^extras$/i,
  /^tools$/i,
  /^crashreporter$/i,
  /^updater$/i,
  /^service$/i,
];

function isIgnoredExe(fileName: string): boolean {
  for (const pattern of IGNORED_EXE_PATTERNS) {
    if (pattern.test(fileName)) return true;
  }
  return false;
}

function isIgnoredDir(dirName: string): boolean {
  for (const pattern of IGNORED_DIR_NAMES) {
    if (pattern.test(dirName)) return true;
  }
  return false;
}

function scoreExeName(exeName: string, dirName: string): number {
  const exeLower = exeName.toLowerCase();
  const dirLower = dirName.toLowerCase();
  if (exeLower === dirLower) return 4;
  if (exeLower.startsWith(dirLower) || dirLower.startsWith(exeLower)) return 3;
  if (exeLower.includes(dirLower) || dirLower.includes(exeLower)) return 2;
  return 1;
}

function pickBestExe(candidates: LocalExecutableGame[], groupDirName: string): LocalExecutableGame | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestScore = scoreExeName(best.fileName, groupDirName);

  for (let i = 1; i < candidates.length; i++) {
    const score = scoreExeName(candidates[i].fileName, groupDirName);
    if (score > bestScore || (score === bestScore && candidates[i].fileName.length < best.fileName.length)) {
      best = candidates[i];
      bestScore = score;
    }
  }

  return best;
}

export type DetectionResult = {
  games: LauncherGame[];
  warnings: string[];
  errors: string[];
};

export async function resolveLauncherGames(
  settings: AppSettings
): Promise<DetectionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  console.log("[gameDetectionResolver] Starting game detection...");

  // ---- Step 1: Steam game detection ----
  let steamApps: Awaited<ReturnType<typeof scanSteamInstalledGames>> = [];
  try {
    steamApps = await scanSteamInstalledGames({
      steamPath: settings.steamRoot || undefined,
      luaPath: settings.luaPath || undefined,
      depotcachePath: settings.depotcachePath || undefined,
      gameScanFolders: settings.gameScanFolders.length > 0 ? settings.gameScanFolders : undefined,
    });
    console.log(`[gameDetectionResolver] Steam apps found: ${steamApps.length}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Steam scan failed";
    console.error("[gameDetectionResolver] Steam scan error:", error);
    errors.push(`Steam scan: ${msg}`);
  }

  // Build set of Steam install directory paths for dedup
  const steamInstallPaths = new Set(
    steamApps
      .map((app) => app.installPath)
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((p) => p.replace(/\\/g, "/").toLowerCase())
  );

  // ---- Step 2: Local EXE detection + filtering + grouping ----
  let rawLocalExes: Awaited<ReturnType<typeof scanLocalGameFolders>> = [];
  try {
    if (settings.scanLocalGames && settings.gameScanFolders.length > 0) {
      rawLocalExes = await scanLocalGameFolders(settings.gameScanFolders);
      console.log(`[gameDetectionResolver] Raw local EXEs found: ${rawLocalExes.length}`);
    } else if (!settings.scanLocalGames) {
      warnings.push("Local EXE scanning is disabled in Settings.");
    } else if (settings.gameScanFolders.length === 0) {
      warnings.push("No game scan folders configured in Settings.");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Local EXE scan failed";
    console.error("[gameDetectionResolver] Local EXE scan error:", error);
    errors.push(`Local EXE scan: ${msg}`);
  }

  // Filter out ignored EXEs by file name
  const filteredExes = rawLocalExes.filter((exe) => {
    if (isIgnoredExe(exe.fileName)) return false;
    const parentDir = getDirNameFromPath(exe.executablePath);
    if (isIgnoredDir(parentDir)) return false;
    // Skip EXEs inside Steam game install directories
    const normalizedPath = exe.executablePath.replace(/\\/g, "/").toLowerCase();
    for (const steamPath of steamInstallPaths) {
      if (normalizedPath.startsWith(steamPath + "/") || normalizedPath.startsWith(steamPath + "\\")) {
        return false;
      }
    }
    return true;
  });

  console.log(`[gameDetectionResolver] Local EXEs after name/dir filter: ${filteredExes.length}`);

  // Group by parent directory path
  const groups = new Map<string, LocalExecutableGame[]>();
  for (const exe of filteredExes) {
    const groupKey = getParentDirPath(exe.executablePath);
    const list = groups.get(groupKey);
    if (list) {
      list.push(exe);
    } else {
      groups.set(groupKey, [exe]);
    }
  }

  console.log(`[gameDetectionResolver] Local EXE groups (directories): ${groups.size}`);

  // Pick best exe per group and create LauncherGame
  const localGames: LauncherGame[] = [];
  for (const [groupDirPath, exes] of groups) {
    const groupDirName = groupDirPath.split("/").pop() || "";
    const best = pickBestExe(exes, groupDirName);
    if (!best) continue;
    const title = best.fileName || "Unknown Game";
    localGames.push({
      id: stableIdFromString("local", best.executablePath),
      title,
      source: "local",
      executablePath: best.executablePath,
      installDir: groupDirName,
      isInstalled: true,
      isPlayable: true,
    });
  }

  console.log(`[gameDetectionResolver] Local games after grouping: ${localGames.length}`);

  // ---- Step 3: Build Steam LauncherGames ----
  const steamGames: LauncherGame[] = [];
  for (const app of steamApps) {
    const appId = typeof app.appId === "number" ? app.appId : null;
    if (appId === null) {
      console.warn("[gameDetectionResolver] Skipping Steam app with no appId:", app);
      continue;
    }
    const title = safeString(app.name) || `App ${appId}`;
    steamGames.push({
      id: `steam-${appId}`,
      appId: String(appId),
      title,
      source: "steam",
      installDir: safeString(app.installDir) || undefined,
      libraryPath: safeString(app.libraryPath) || undefined,
      imageUrl: undefined,
      isInstalled: app.isInstalled === true,
      isPlayable: app.isInstalled === true,
      sizeOnDisk: typeof app.sizeOnDisk === "number" ? app.sizeOnDisk : undefined,
      lastUpdated: typeof app.lastUpdated === "number" ? app.lastUpdated : undefined,
    });
  }

  // ---- Step 4: Merge and deduplicate ----
  const allGames = [...steamGames, ...localGames];

  const beforeDedup = allGames.length;
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const deduped: LauncherGame[] = [];
  for (const game of allGames) {
    if (!game.id) continue;
    if (seenIds.has(game.id)) continue;
    const normalizedTitle = normalizeText(game.title);
    if (game.source === "local" && seenTitles.has(normalizedTitle)) continue;
    seenIds.add(game.id);
    seenTitles.add(normalizedTitle);
    deduped.push(game);
  }
  const duplicatesRemoved = beforeDedup - deduped.length;
  if (duplicatesRemoved > 0) {
    console.log(`[gameDetectionResolver] Duplicates removed: ${duplicatesRemoved}`);
  }

  // ---- Step 5: Metadata resolution ----
  const steamAppIds = steamApps
    .map((app) => app.appId)
    .filter((id): id is number => typeof id === "number");

  let metadata: Record<number, { resolved: boolean; name?: string; header_image?: string | null; capsule_image?: string | null; capsule_image_v5?: string | null }> = {};
  if (steamAppIds.length > 0) {
    try {
      metadata = await resolveGameMetadata(steamAppIds);
    } catch (error) {
      console.error("[gameDetectionResolver] Metadata resolution error:", error);
      warnings.push("Game metadata could not be loaded; games will show without images.");
    }
  }
  const metadataCount = Object.values(metadata).filter((m) => m.resolved).length;
  console.log(`[gameDetectionResolver] Metadata loaded: ${metadataCount}/${steamAppIds.length}`);

  // ---- Step 6: Merge metadata into games ----
  const merged: LauncherGame[] = deduped.map((game) => {
    if (game.source === "steam" && game.appId) {
      const appIdNum = Number(game.appId);
      if (Number.isFinite(appIdNum)) {
        const meta = metadata[appIdNum];
        if (meta) {
          const imageUrl =
            meta.header_image ||
            meta.capsule_image ||
            meta.capsule_image_v5 ||
            undefined;
          const title = safeString(meta.name) || game.title;
          return { ...game, title, imageUrl };
        }
      }
    }
    return game;
  });

  // ---- Step 7: Sort ----
  merged.sort((a, b) => {
    const titleA = normalizeText(a.title);
    const titleB = normalizeText(b.title);
    return titleA.localeCompare(titleB);
  });

  console.log(`[gameDetectionResolver] Final launcher games: ${merged.length}`);

  if (warnings.length > 0) {
    console.log(`[gameDetectionResolver] Warnings: ${warnings.length}`);
    warnings.forEach((w) => console.warn("  -", w));
  }
  if (errors.length > 0) {
    console.log(`[gameDetectionResolver] Errors: ${errors.length}`);
    errors.forEach((e) => console.error("  -", e));
  }

  return { games: merged, warnings, errors };
}
