import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import { DownloadJob, DownloadStatus } from "../types/download";

type CreateDownloadJobInput = {
  appId: string;
  gameTitle: string;
  providerId: string;
  providerName: string;
  fileType: DownloadJob["fileType"];
  downloadUrl?: string;
};

type UpdateDownloadJobInput = {
  status?: DownloadStatus;
  progress?: number;
  bytesRead?: number;
  totalBytes?: number;
  error?: string;
};

type DownloadQueueContextValue = {
  jobs: DownloadJob[];
  addJob: (input: CreateDownloadJobInput) => DownloadJob;
  updateJob: (jobId: string, update: UpdateDownloadJobInput) => void;
  cancelJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  clearCompleted: () => void;
};

const STORAGE_KEY = "lumaforge-download-queue";

const activeStatuses: DownloadStatus[] = [
  "queued",
  "checking",
  "downloading",
  "extracting",
  "installing",
];

const DownloadQueueContext =
  createContext<DownloadQueueContextValue | null>(null);

function createJobId(input: CreateDownloadJobInput) {
  return `${input.appId}-${input.providerId}-${input.fileType}-${Date.now()}`;
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
      if (activeStatuses.includes(job.status)) {
        return {
          ...job,
          status: "failed",
          error:
            job.error ||
            "La app fue recargada mientras esta descarga estaba activa.",
          updatedAt: new Date().toISOString(),
        };
      }

      return job;
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

  function updateJob(jobId: string, update: UpdateDownloadJobInput) {
    setJobs((currentJobs) => {
      const nextJobs = currentJobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              ...update,
              updatedAt: new Date().toISOString(),
            }
          : job
      );

      persistJobs(nextJobs);

      return nextJobs;
    });
  }

  function cancelJob(jobId: string) {
    updateJob(jobId, {
      status: "cancelled",
      error: "Cancelled by user",
    });
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

  const value = useMemo(
    () => ({
      jobs,
      addJob,
      updateJob,
      cancelJob,
      removeJob,
      clearCompleted,
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