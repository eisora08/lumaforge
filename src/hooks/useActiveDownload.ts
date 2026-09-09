import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DownloadJob, DownloadStatus } from "../types/download";
import { getBootSnapshot } from "../services/appBootCoordinator";
import { localPathToUrl } from "../services/gameCacheService";

export type ActiveDownload = {
  id: string;
  appId: string;
  gameName: string;
  coverImageUrl?: string;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  timeRemaining?: string;
  status: DownloadStatus;
  currentSpeedBytes?: number;
  peakSpeedBytes?: number;
  isTorrent: boolean;
  isSteam: boolean;
  isDebrid: boolean;
  isDepotDownload: boolean;
  repacker?: string;
  peers?: number;
  seeds?: number;
  speedHistory: number[];
  progressMode: "determinate" | "indeterminate";
  message?: string;
};

const HISTORY_LEN = 40;
const MAX_RAW_SAMPLES = 200;

type Sample = { t: number; bytes: number };

const _samplesByJob = new Map<string, Sample[]>();

const TERMINAL_STATUSES = new Set<DownloadStatus>(["done", "failed", "cancelled"]);

const ACTIVE_STATUSES = new Set<DownloadStatus>([
  "queued",
  "waiting",
  "checking",
  "downloading",
  "extracting",
  "installing",
  "paused",
  "verifying",
]);

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEtaLong(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

function resolveDisplayTitle(job: DownloadJob): string {
  if (
    job.gameTitle &&
    !/^\d+$/.test(job.gameTitle) &&
    !job.gameTitle.startsWith("Steam App ")
  ) {
    return job.gameTitle;
  }
  const snapshot = getBootSnapshot();
  const sg = snapshot?.library.games.find(
    (g) => g.appId === job.appId || g.appId.endsWith(`-${job.appId}`)
  );
  if (sg?.title && !sg.title.startsWith("Steam App ") && !/^\d+$/.test(sg.title)) {
    return sg.title;
  }
  return `Steam App ${job.appId}`;
}

function isLocalPath(s: string): boolean {
  return /^[A-Za-z]:\\|^\\\\|^\//.test(s);
}

function resolveCoverUrl(job: DownloadJob): string | undefined {
  if (job.artworkUrl) {
    if (isLocalPath(job.artworkUrl)) {
      console.log(`[ACTIVE_DL] artworkUrl is local path, converting: ${job.artworkUrl}`);
      return localPathToUrl(job.artworkUrl) ?? undefined;
    }
    return job.artworkUrl;
  }
  if (job.type === "steam-install" || job.type === "steam-depot-download") {
    const snapshot = getBootSnapshot();
    const media = snapshot?.library.games.find(
      (g) => g.appId === job.appId || g.appId.endsWith(`-${job.appId}`)
    )?.media;
    const path = media?.landscapePath || media?.coverPath || media?.backgroundPath;
    if (path) {
      console.log(`[ACTIVE_DL] fallback to snapshot media: ${path}`);
      return localPathToUrl(path) ?? undefined;
    }
  }
  console.log(`[ACTIVE_DL] no artwork found for appId=${job.appId} type=${job.type}`);
  return undefined;
}

/**
 * Derives the premium `ActiveDownload` view-model from a `DownloadJob`.
 *
 * A module-level ring buffer samples bytes deltas per jobId (max 40 speed
 * readings), from which current/peak speed, ETA and the live bar chart are
 * computed. Works for both HTTP and torrent installs (both emit bytes via the
 * `installer-progress` event). Seeds/peers stay undefined for non-torrent jobs
 * (no backend source) — the card hides them.
 */
export function useActiveDownload(job: DownloadJob): ActiveDownload {
  const { t } = useTranslation();
  return useMemo(() => {
    const terminal = TERMINAL_STATUSES.has(job.status);

    if (!terminal && ACTIVE_STATUSES.has(job.status) && job.bytesRead > 0) {
      const arr = _samplesByJob.get(job.id) ?? [];
      const last = arr[arr.length - 1];
      const now = Date.now();
      if (!last || job.bytesRead !== last.bytes) {
        arr.push({ t: now, bytes: job.bytesRead });
        if (arr.length > MAX_RAW_SAMPLES) arr.shift();
        _samplesByJob.set(job.id, arr);
      }
    } else if (terminal) {
      _samplesByJob.delete(job.id);
    }

    const samples = _samplesByJob.get(job.id) ?? [];
    const speeds: number[] = [];
    const WINDOW_MS = 5000;
    const EMA_ALPHA = 0.3;
    let emaSpeed: number | null = null;
    for (let i = 1; i < samples.length; i += 1) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000;
      if (dt <= 0) continue;
      // Find the sample closest to WINDOW_MS ago
      const cutoff = samples[i].t - WINDOW_MS;
      let older = samples[i - 1];
      for (let j = i - 2; j >= 0; j--) {
        if (samples[j].t <= cutoff) { older = samples[j]; break; }
      }
      const db = samples[i].bytes - older.bytes;
      const windowDt = (samples[i].t - older.t) / 1000;
      if (windowDt > 0.3 && db >= 0) {
        const raw = db / windowDt;
        // Exponential moving average for smoothness
        emaSpeed = emaSpeed === null ? raw : EMA_ALPHA * raw + (1 - EMA_ALPHA) * emaSpeed;
        speeds.push(emaSpeed);
      }
    }
    const history = speeds.slice(-HISTORY_LEN);

    const currentSpeed =
      job.speedBytesPerSec && job.speedBytesPerSec > 0
        ? job.speedBytesPerSec
        : history.length > 0
          ? history[history.length - 1]
          : undefined;
    const peakSpeed = history.length > 0 ? Math.max(...history) : undefined;

    const totalBytes = job.totalBytes > 0 ? job.totalBytes : 0;
    const downloadedBytes = job.bytesRead > 0 ? job.bytesRead : 0;
    const percentage =
      totalBytes > 0
        ? Math.min(100, (downloadedBytes / totalBytes) * 100)
        : job.progress;

    let timeRemaining: string | undefined;
    if (totalBytes > 0 && currentSpeed && currentSpeed > 0) {
      const secs = (totalBytes - downloadedBytes) / currentSpeed;
      if (secs > 0 && secs < 10 * 86400) {
        timeRemaining = `${t("downloads.eta_in")} ${formatEtaLong(secs)}`;
      }
    }

    return {
      id: job.id,
      appId: job.appId,
      gameName: resolveDisplayTitle(job),
      coverImageUrl: resolveCoverUrl(job),
      downloadedBytes,
      totalBytes,
      percentage,
      timeRemaining,
      status: job.status,
      currentSpeedBytes: currentSpeed,
      peakSpeedBytes: peakSpeed,
      isTorrent: job.installMethod === "torrent",
      isSteam: job.type === "steam-install",
      isDebrid: job.type === "debrid-install",
      isDepotDownload: job.type === "steam-depot-download",
      repacker: job.repacker,
      peers: job.peers,
      seeds: job.seeds,
      speedHistory: history,
      progressMode: job.progressMode ?? "determinate",
      message: job.message,
    };
  }, [job]);
}
