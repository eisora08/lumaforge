import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { DownloadJob, DownloadStatus } from "../types/download";
import { useSteamInstallSync } from "../hooks/useSteamInstallSync";
import { useEpicInstallSync } from "../hooks/useEpicInstallSync";
import { useDebridInstallSync, type DebridInstallHandle } from "../hooks/useDebridInstallSync";
import { cancelDebridDownload, pauseDebridDownload } from "../services/tauri";
import type { DebridInstallMethod, RepackInstallOptions } from "../services/debridInstallChoice";
import type { ProviderId } from "../services/debridProviderService";

type CreateDownloadJobInput = {
  appId: string;
  gameTitle: string;
  providerId: string;
  providerName: string;
  fileType: DownloadJob["fileType"];
  downloadUrl?: string;
  type?: DownloadJob["type"];
  progressMode?: DownloadJob["progressMode"];
  message?: string;
  artworkUrl?: string;
};

type UpdateDownloadJobInput = {
  status?: DownloadStatus;
  progress?: number;
  bytesRead?: number;
  totalBytes?: number;
  error?: string;
  message?: string;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  progressMode?: DownloadJob["progressMode"];
  artworkUrl?: string;
  installedSize?: number;
  peers?: number;
  seeds?: number;
};

type DownloadQueueContextValue = {
  jobs: DownloadJob[];
  addJob: (input: CreateDownloadJobInput) => DownloadJob;
  addSteamInstallJob: (appId: string, title: string, artworkUrl?: string) => string;
  addDebridInstallJob: (providerGameId: string, title: string, downloadUri: string, installerType: string, appId?: string, artworkUrl?: string, repacker?: string, installMethod?: DebridInstallMethod, options?: RepackInstallOptions) => string;
  updateJob: (jobId: string, update: UpdateDownloadJobInput) => void;
  cancelJob: (jobId: string) => void;
  pauseJob: (jobId: string) => void;
  resumeJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  clearCompleted: () => void;
  getJobByAppId: (appId: string) => DownloadJob | undefined;
};

const STORAGE_KEY = "lumaforge-download-queue";

const activeStatuses: DownloadStatus[] = [
  "queued",
  "waiting",
  "checking",
  "downloading",
  "extracting",
  "installing",
  "paused",
];

const DownloadQueueContext =
  createContext<DownloadQueueContextValue | null>(null);

function createJobId(input: CreateDownloadJobInput) {
  return `${input.appId}-${input.providerId}-${input.fileType}-${Date.now()}`;
}

function createSteamJobId(appId: string): string {
  return `steam-install-${appId}`;
}

function createDebridJobId(providerGameId: string): string {
  return `debrid-install-${providerGameId}`;
}

function persistJobs(jobs: DownloadJob[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function loadJobs(): DownloadJob[] {
  try {
    const savedJobs = localStorage.getItem(STORAGE_KEY);

    if (!savedJobs) {
      return [];
    }

    const parsedJobs = JSON.parse(savedJobs) as DownloadJob[];

    return parsedJobs.map((job) => {
      // Migration: set defaults for new optional fields
      const migrated: DownloadJob = {
        ...job,
        type: job.type ?? (job.fileType === "lua" ? "lua-package" : job.fileType === "zip" ? "zip" : "other"),
        progressMode: job.progressMode ?? "determinate",
      };

      // App reload while active — mark as failed unless it's a steam-install (can't verify on reload)
      if (activeStatuses.includes(migrated.status)) {
        if (migrated.type === "debrid-install") {
          // Debrid installs resume from their HTTP `.part` checkpoint or torrent
          // fastresume — keep them "paused" for a manual resume instead of failing.
          return {
            ...migrated,
            status: "paused",
            error: undefined,
            message: "Download paused",
            updatedAt: new Date().toISOString(),
          };
        }

        return {
          ...migrated,
          status: "failed",
          error:
            job.error ||
            "La app fue recargada mientras esta descarga estaba activa.",
          updatedAt: new Date().toISOString(),
        };
      }

      return migrated;
    });
  } catch {
    return [];
  }
}

export function DownloadQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState<DownloadJob[]>(() => {
    const loadedJobs = loadJobs();
    persistJobs(loadedJobs);
    return loadedJobs;
  });

  function commitJobs(nextJobs: DownloadJob[]) {
    setJobs(nextJobs);
    persistJobs(nextJobs);
  }

  // Bridge Steam install tracker into the download queue
  const syncRef = useRef({ addSteamInstallJob, updateJob, removeJob });
  syncRef.current = { addSteamInstallJob, updateJob, removeJob };
  useSteamInstallSync({
    addSteamInstallJob: (appId, title, artworkUrl) => syncRef.current.addSteamInstallJob(appId, title, artworkUrl),
    updateJob: (jobId, update) => syncRef.current.updateJob(jobId, update as any),
    removeJob: (jobId) => syncRef.current.removeJob(jobId),
  });

  // Bridge Epic install tracker into the download queue
  const epicSyncRef = useRef({ addEpicInstallJob, updateJob, removeJob });
  epicSyncRef.current = { addEpicInstallJob, updateJob, removeJob };
  useEpicInstallSync({
    addEpicInstallJob: (appName, title, artworkUrl) => epicSyncRef.current.addEpicInstallJob(appName, title, artworkUrl),
    updateJob: (jobId, update) => epicSyncRef.current.updateJob(jobId, update as any),
    removeJob: (jobId) => epicSyncRef.current.removeJob(jobId),
  });

  // Bridge Debrid install into the download queue
  const debridInstallRef = useRef<DebridInstallHandle>({ startInstall: async () => {} });
  const debridHandle = useDebridInstallSync(updateJob);
  debridInstallRef.current = debridHandle;

  function addJob(input: CreateDownloadJobInput) {
    const now = new Date().toISOString();

    const job: DownloadJob = {
      id: createJobId(input),
      appId: input.appId,
      gameTitle: input.gameTitle,
      providerId: input.providerId,
      providerName: input.providerName,
      fileType: input.fileType,
      downloadUrl: input.downloadUrl,
      type: input.type ?? "other",
      progressMode: input.progressMode ?? "determinate",
      message: input.message,
      artworkUrl: input.artworkUrl,

      status: "queued",
      progress: 0,
      bytesRead: 0,
      totalBytes: 0,

      createdAt: now,
      updatedAt: now,
    };

    const nextJobs = [job, ...jobs];
    commitJobs(nextJobs);

    return job;
  }

  function addSteamInstallJob(appId: string, title: string, artworkUrl?: string): string {
    const jobId = createSteamJobId(appId);
    const existing = jobs.find((j) => j.id === jobId);
    if (existing && activeStatuses.includes(existing.status)) {
      return jobId;
    }

    const now = new Date().toISOString();

    const job: DownloadJob = {
      id: jobId,
      appId,
      gameTitle: title,
      providerId: "steam",
      providerName: "Steam",
      fileType: "manifest",
      type: "steam-install",
      progressMode: "indeterminate",
      message: "Opening Steam install\u2026",
      artworkUrl,

      status: "waiting",
      progress: 0,
      bytesRead: 0,
      totalBytes: 0,

      createdAt: now,
      updatedAt: now,
    };

    // Replace any existing terminal job for same appId
    const filtered = jobs.filter((j) => j.id !== jobId);
    const nextJobs = [job, ...filtered];
    commitJobs(nextJobs);

    return jobId;
  }

  function addEpicInstallJob(appName: string, title: string, artworkUrl?: string): string {
    const jobId = `epic-install-${appName}`;
    const existing = jobs.find((j) => j.id === jobId);
    if (existing && activeStatuses.includes(existing.status)) {
      return jobId;
    }

    const now = new Date().toISOString();

    const job: DownloadJob = {
      id: jobId,
      appId: appName,
      gameTitle: title,
      providerId: "epic",
      providerName: "Epic Games",
      fileType: "manifest",
      type: "epic-install",
      progressMode: "indeterminate",
      message: "Waiting for Epic Games Launcher\u2026",
      artworkUrl,

      status: "waiting",
      progress: 0,
      bytesRead: 0,
      totalBytes: 0,

      createdAt: now,
      updatedAt: now,
    };

    const filtered = jobs.filter((j) => j.id !== jobId);
    const nextJobs = [job, ...filtered];
    commitJobs(nextJobs);

    return jobId;
  }

  function addDebridInstallJob(providerGameId: string, title: string, downloadUri: string, installerType: string, appId?: string, artworkUrl?: string, repacker?: string, installMethod?: DebridInstallMethod, options?: RepackInstallOptions): string {
    const jobId = createDebridJobId(providerGameId);
    const existing = jobs.find((j) => j.id === jobId);
    if (existing && activeStatuses.includes(existing.status)) {
      return jobId;
    }

    const now = new Date().toISOString();

    const job: DownloadJob = {
      id: jobId,
      appId: appId ?? "",
      gameTitle: title,
      providerId: "debrid",
      providerName: "Debrid",
      fileType: "zip",
      type: "debrid-install",
      progressMode: "indeterminate",
      message: "Starting Debrid install\u2026",
      downloadUrl: downloadUri,
      artworkUrl: artworkUrl,
      repacker: repacker,
      installMethod: installMethod ?? options?.method,
      debridProviderId: options?.provider,
      destDir: options?.destDir,
      autoExtract: options?.autoExtract,
      deleteArchive: options?.deleteArchive,

      status: "queued",
      progress: 0,
      bytesRead: 0,
      totalBytes: 0,

      createdAt: now,
      updatedAt: now,
    };

    const filtered = jobs.filter((j) => j.id !== jobId);
    const nextJobs = [job, ...filtered];
    commitJobs(nextJobs);

    // Start install asynchronously
    debridInstallRef.current.startInstall(jobId, providerGameId, downloadUri, installerType, title, job.installMethod, options, job.appId);

    return jobId;
  }

  function updateJob(jobId: string, update: UpdateDownloadJobInput) {
    setJobs((currentJobs) => {
      const nextJobs = currentJobs.map((job) => {
        if (job.id !== jobId) return job;

        // Once a job reaches a terminal state, only allow metadata updates
        // (message, progress, bytesRead, etc.) — never allow status rollback
        // from a stale Rust progress event after user cancellation.
        if (["done", "failed", "cancelled"].includes(job.status) && update.status) {
          const { status: _status, ...rest } = update;
          return { ...job, ...rest, updatedAt: new Date().toISOString() };
        }

        return { ...job, ...update, updatedAt: new Date().toISOString() };
      });

      persistJobs(nextJobs);

      return nextJobs;
    });
  }

  async function cancelJob(jobId: string) {
    updateJob(jobId, {
      status: "cancelled",
      error: "Cancelled by user",
    });
    // Bug 4 fix: also abort the in-flight Rust download
    try {
      await cancelDebridDownload(jobId);
    } catch (e) {
      console.warn("[DOWNLOAD][CANCEL] Failed to abort Rust download:", e);
    }
  }

  /** Pause a debrid-install job (HTTP checkpoint or torrent fastresume kept on disk). */
  async function pauseJob(jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.type !== "debrid-install") return;

    updateJob(jobId, {
      status: "paused",
      message: "Pausing\u2026",
    });
    try {
      await pauseDebridDownload(jobId);
    } catch (e) {
      console.warn("[DOWNLOAD][PAUSE] Failed to pause Rust download:", e);
      // Revert to the pre-pause state — nothing was paused on the Rust side.
      updateJob(jobId, {
        status: job.status,
        message: job.message,
      });
    }
  }

  /** Resume a previously paused debrid-install job (re-invokes the install pipeline). */
  async function resumeJob(jobId: string) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.type !== "debrid-install") return;

    const providerGameId = jobId.replace("debrid-install-", "");
    if (!providerGameId || !job.downloadUrl) return;

    updateJob(jobId, {
      status: "queued",
      message: "Resuming\u2026",
      error: undefined,
    });
    // Rebuild the install options from the persisted job so a resumed download
    // honors the original destination directory and auto-extract/delete flags.
    const resumeOptions: RepackInstallOptions | undefined =
      job.destDir || job.autoExtract !== undefined || job.deleteArchive !== undefined
        ? {
            method: job.installMethod ?? "debrid",
            provider: job.debridProviderId as ProviderId | undefined,
            destDir: job.destDir ?? "",
            autoExtract: job.autoExtract ?? true,
            deleteArchive: job.deleteArchive ?? false,
          }
        : undefined;
    await debridInstallRef.current.startInstall(
      jobId,
      providerGameId,
      job.downloadUrl,
      "zip",
      job.gameTitle,
      job.installMethod,
      resumeOptions,
      job.appId,
    );
  }

  function removeJob(jobId: string) {
    setJobs((currentJobs) => {
      const nextJobs = currentJobs.filter((job) => job.id !== jobId);
      persistJobs(nextJobs);
      return nextJobs;
    });
  }

  function clearCompleted() {
    setJobs((currentJobs) => {
      const nextJobs = currentJobs.filter(
        (job) =>
          job.status !== "done" &&
          job.status !== "failed" &&
          job.status !== "cancelled"
      );

      persistJobs(nextJobs);

      return nextJobs;
    });
  }

  function getJobByAppId(appId: string): DownloadJob | undefined {
    return jobs.find((j) => j.appId === appId);
  }

  const value = useMemo(
    () => ({
      jobs,
      addJob,
      addSteamInstallJob,
      addEpicInstallJob,
      addDebridInstallJob,
      updateJob,
      cancelJob,
      pauseJob,
      resumeJob,
      removeJob,
      clearCompleted,
      getJobByAppId,
    }),
    [jobs]
  );

  return (
    <DownloadQueueContext.Provider value={value}>
      {children}
    </DownloadQueueContext.Provider>
  );
}

export function useDownloadQueueContext() {
  const context = useContext(DownloadQueueContext);

  if (!context) {
    throw new Error(
      "useDownloadQueueContext debe usarse dentro de DownloadQueueProvider"
    );
  }

  return context;
}