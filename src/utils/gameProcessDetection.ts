import type { ProcessInfo } from "../services/tauri";
import { listProcesses } from "../services/tauri";

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
