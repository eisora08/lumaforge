import type { ProcessInfo } from "../services/tauri";
import { listProcesses, discoverExecutables } from "../services/tauri";

export type ProcessCandidate = {
  pid: number;
  name: string;
  exe?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type FindProcessInput = {
  executablePath?: string;
  installDir?: string;
  processName?: string;
  title?: string;
  appId?: string;
};

const EXCLUDED_PROCESSES = new Set([
  "steam.exe",
  "steamwebhelper.exe",
  "epicgameslauncher.exe",
  "epicwebhelper.exe",
  "epicGamesLauncher.exe",
  "eosoverlay.exe",
  "eosoverlayrenderer.exe",
  "unrealcefsubprocess.exe",
  "cefsubprocess.exe",
  "crashreporter.exe",
  "crashreportclient.exe",
  "unitycrashhandler.exe",
  "ngscrt64.exe",
  "scp_service.exe",
  "gamerserviceservice.exe",
  "gamerservicesnet.exe",
  "gamerservicerenderer.exe",
]);

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().trim();
}

function getExeNameFromPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const last = parts[parts.length - 1];
  return last || "";
}

function getDirFromPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : normalized;
}

function isExcluded(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED_PROCESSES.has(lower) || EXCLUDED_PROCESSES.has(`exe ${lower}`) || EXCLUDED_PROCESSES.has(lower.replace(".exe", ""));
}

function scoreCandidate(
  proc: ProcessInfo,
  game: FindProcessInput,
  snapshotBefore: ProcessInfo[]
): ProcessCandidate | null {
  const pexe = proc.exe ? normalizePath(proc.exe) : "";
  const pdir = proc.exe ? getDirFromPath(pexe) : "";

  if (isExcluded(proc.name)) return null;

  // Check if this process existed before launch
  const existedBefore = snapshotBefore.some((b) => b.pid === proc.pid || normalizePath(b.exe || "") === pexe);
  if (existedBefore) return null;

  // High confidence: direct PID match from local launch
  // (handled directly in the hook, not here)

  // High confidence: exe path exact match
  if (game.executablePath) {
    const normGameExe = normalizePath(game.executablePath);
    if (pexe === normGameExe) {
      return {
        pid: proc.pid,
        name: proc.name,
        exe: proc.exe,
        confidence: "high",
        reason: `exe path exact match: ${normGameExe}`,
      };
    }
  }

  // High confidence: exe inside game install directory
  if (game.installDir) {
    const normInstall = normalizePath(game.installDir);
    if (pexe.includes(normInstall)) {
      return {
        pid: proc.pid,
        name: proc.name,
        exe: proc.exe,
        confidence: "high",
        reason: `exe inside install directory: ${normInstall}`,
      };
    }
  }

  // High confidence: exe name matches game title
  if (game.title) {
    const titleWords = game.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const exeBase = proc.exe ? getExeNameFromPath(proc.exe).toLowerCase().replace(".exe", "") : proc.name.toLowerCase().replace(".exe", "");
    for (const word of titleWords) {
      if (word.length > 3 && (exeBase.includes(word) || word.includes(exeBase))) {
        return {
          pid: proc.pid,
          name: proc.name,
          exe: proc.exe,
          confidence: "medium",
          reason: `exe name "${exeBase}" matches game title word "${word}"`,
        };
      }
    }
  }

  // Medium: process name matches executable file name
  if (game.executablePath) {
    const gameExeName = getExeNameFromPath(game.executablePath).toLowerCase().replace(".exe", "");
    const procExeName = proc.exe ? getExeNameFromPath(proc.exe).toLowerCase().replace(".exe", "") : proc.name.toLowerCase().replace(".exe", "");
    if (gameExeName === procExeName) {
      return {
        pid: proc.pid,
        name: proc.name,
        exe: proc.exe,
        confidence: "medium",
        reason: `process name matches executable name: ${gameExeName}`,
      };
    }
    // Also check if gameExeName contains procExeName or vice versa
    if (gameExeName.includes(procExeName) || procExeName.includes(gameExeName)) {
      return {
        pid: proc.pid,
        name: proc.name,
        exe: proc.exe,
        confidence: "medium",
        reason: `process name partially matches executable name: ${gameExeName} ~ ${procExeName}`,
      };
    }
  }

  // Medium: process in same directory as game
  if (game.executablePath) {
    const gameDir = getDirFromPath(normalizePath(game.executablePath));
    if (pdir === gameDir) {
      return {
        pid: proc.pid,
        name: proc.name,
        exe: proc.exe,
        confidence: "medium",
        reason: `process in same directory as game executable: ${gameDir}`,
      };
    }
  }

  return null;
}

export function findCandidates(
  processes: ProcessInfo[],
  game: FindProcessInput,
  snapshotBefore: ProcessInfo[]
): ProcessCandidate[] {
  const candidates: ProcessCandidate[] = [];

  for (const proc of processes) {
    const candidate = scoreCandidate(proc, game, snapshotBefore);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // Sort by confidence
  const rank = { high: 0, medium: 1, low: 2 };
  candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence]);

  console.debug("[ProcessTracking] candidates", candidates);
  return candidates;
}

export function pickBestCandidate(candidates: ProcessCandidate[]): ProcessCandidate | null {
  if (candidates.length === 0) return null;
  // Return the highest-confidence candidate
  const best = candidates[0];
  if (best.confidence === "low") return null;
  console.debug("[ProcessTracking] selected", best);
  return best;
}

export async function findGameProcess(
  game: FindProcessInput,
  snapshotBefore: ProcessInfo[]
): Promise<ProcessCandidate | null> {
  const processes = await listProcesses();
  console.debug("[ProcessTracking] snapshot after count", processes.length);
  const candidates = findCandidates(processes, game, snapshotBefore);
  return pickBestCandidate(candidates);
}

export async function findGameProcesses(
  game: FindProcessInput,
  snapshotBefore: ProcessInfo[]
): Promise<ProcessCandidate[]> {
  const processes = await listProcesses();
  console.debug("[ProcessTracking] snapshot after count", processes.length);
  return findCandidates(processes, game, snapshotBefore);
}

const COMMON_LAUNCHER_EXES = new Set([
  "setup.exe",
  "install.exe",
  "installer.exe",
  "uninstall.exe",
  "unins000.exe",
  "unins001.exe",
  "dxsetup.exe",
  "vcredist_x86.exe",
  "vcredist_x64.exe",
  "vc_redist.x86.exe",
  "vc_redist.x64.exe",
  "dotnetfx.exe",
  "directx.exe",
  "dxwebsetup.exe",
  "oalinst.exe",
  "gfwlivesetup.exe",
  "steam.exe",
  "steamwebhelper.exe",
  "epicgameslauncher.exe",
  "eosoverlay.exe",
  "eosoverlayrenderer.exe",
  "crashreporter.exe",
  "unitycrashhandler.exe",
  "ngscrt64.exe",
  "scp_service.exe",
  "gamerserviceservice.exe",
  "gamerservicesnet.exe",
  "gamerservicerenderer.exe",
  "updater.exe",
  "update.exe",
  "redist.exe",
  "launcher.exe",
  "launch.exe",
]);

function isLauncherExe(name: string): boolean {
  return COMMON_LAUNCHER_EXES.has(name.toLowerCase());
}

export async function discoverGameExecutable(
  installDir: string,
  title?: string
): Promise<{ exePath: string; exeName: string } | null> {
  try {
    const executables = await discoverExecutables(installDir);
    if (executables.length === 0) return null;

    // Filter out known launcher/setup files
    const candidates = executables.filter(
      (exe) => !isLauncherExe(exe.file_name)
    );

    if (candidates.length === 0) return null;

    // Priority 1: Find exe in Win64/ directory
    const win64Candidates = candidates.filter((exe) => {
      const path = exe.exe_path.replace(/\\/g, "/").toLowerCase();
      const parts = path.split("/");
      return parts.some((p) => p === "win64");
    });
    if (win64Candidates.length > 0) {
      const best = win64Candidates[0];
      return { exePath: best.exe_path, exeName: best.file_name };
    }

    // Priority 2: Find exe in bin/ directory
    const binCandidates = candidates.filter((exe) => {
      const path = exe.exe_path.replace(/\\/g, "/").toLowerCase();
      const parts = path.split("/");
      return parts.some((p) => p === "bin");
    });
    if (binCandidates.length > 0) {
      const best = binCandidates[0];
      return { exePath: best.exe_path, exeName: best.file_name };
    }

    // Priority 3: Match by title keywords
    if (title) {
      const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const titleMatch = candidates.find((exe) => {
        const base = exe.file_name.toLowerCase().replace(".exe", "");
        return titleWords.some(
          (word) =>
            word.length > 3 &&
            (base.includes(word) || word.includes(base))
        );
      });
      if (titleMatch) {
        return { exePath: titleMatch.exe_path, exeName: titleMatch.file_name };
      }
    }

    // Priority 4: Root directory (closest to install root)
    const installNorm = installDir.replace(/\\/g, "/").replace(/\/+$/, "");
    const rootCandidates = candidates.filter((exe) => {
      const exeDir = exe.exe_path.replace(/\\/g, "/");
      const lastSlash = exeDir.lastIndexOf("/");
      const dir = lastSlash >= 0 ? exeDir.substring(0, lastSlash) : exeDir;
      return dir === installNorm;
    });
    if (rootCandidates.length > 0) {
      const best = rootCandidates[0];
      return { exePath: best.exe_path, exeName: best.file_name };
    }

    // Priority 5: Largest file (already sorted by size from backend)
    const best = candidates[0];
    return { exePath: best.exe_path, exeName: best.file_name };
  } catch {
    return null;
  }
}

export async function resolveExecutablePath(
  gameId: string,
  installDir: string | undefined,
  title: string | undefined
): Promise<{ exePath: string; exeName: string } | null> {
  // Check registry first
  if (gameId) {
    try {
      const { getExePathFromEntry, getExeNameFromEntry } = await import("../services/installedGamesRegistry");
      const [registeredPath, registeredName] = await Promise.all([
        getExePathFromEntry(gameId),
        getExeNameFromEntry(gameId),
      ]);
      if (registeredPath && registeredName) {
        return { exePath: registeredPath, exeName: registeredName };
      }
    } catch {
      // fall through to discovery
    }
  }

  // Fallback to discovery
  if (!installDir) return null;
  return discoverGameExecutable(installDir, title);
}

export function extractExeName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

export function getDirPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : normalized;
}

export function getExeNamesFromSession(session: {
  processName?: string;
  executablePath?: string;
  title?: string;
}): string[] {
  const names: string[] = [];
  if (session.processName) {
    const clean = session.processName.toLowerCase().replace(".exe", "");
    names.push(clean);
    names.push(`${clean}.exe`);
  }
  if (session.executablePath) {
    const exeName = extractExeName(session.executablePath);
    const clean = exeName.toLowerCase().replace(".exe", "");
    names.push(clean);
    names.push(exeName);
  }
  if (session.title) {
    const clean = session.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
    names.push(clean);
    names.push(`${clean}.exe`);
  }
  return [...new Set(names)];
}
