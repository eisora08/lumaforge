import {
  Ban,
  FileArchive,
  FileCode2,
  FileText,
  Trash2,
} from "lucide-react";

import { DownloadJob } from "../../types/download";
import DownloadProgressBar from "./DownloadProgressBar";
import DownloadStatusBadge from "./DownloadStatusBadge";

type DownloadJobCardProps = {
  job: DownloadJob;
  onCancel: (jobId: string) => void;
  onRemove: (jobId: string) => void;
};

function formatBytes(bytes: number) {
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

function getFileIcon(fileType: DownloadJob["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function canCancel(status: DownloadJob["status"]) {
  return (
    status === "queued" ||
    status === "checking" ||
    status === "downloading" ||
    status === "extracting" ||
    status === "installing"
  );
}

function canRemove(status: DownloadJob["status"]) {
  return (
    status === "done" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export default function DownloadJobCard({
  job,
  onCancel,
  onRemove,
}: DownloadJobCardProps) {
  const FileIcon = getFileIcon(job.fileType);

  return (
    <article className="lf-surface rounded-2xl border p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
              <FileIcon className="h-5 w-5 text-(--color-accent)" />
            </div>

            <div>
              <h3 className="font-semibold text-(--color-text)">
                {job.gameTitle}
              </h3>

              <p className="mt-0.5 text-xs text-(--color-muted)">
                AppID: {job.appId} · {job.providerName} · .{job.fileType}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DownloadStatusBadge status={job.status} />

          {canCancel(job.status) && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <Ban className="h-3.5 w-3.5" />
              Cancelar
            </button>
          )}

          {canRemove(job.status) && (
            <button
              type="button"
              onClick={() => onRemove(job.id)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Quitar
            </button>
          )}
        </div>
      </div>

      <div className="mt-5">
        <DownloadProgressBar progress={job.progress} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-(--color-muted) md:grid-cols-3">
        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
          <p>Leído</p>
          <p className="mt-1 font-medium text-(--color-text)">
            {formatBytes(job.bytesRead)}
          </p>
        </div>

        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
          <p>Total</p>
          <p className="mt-1 font-medium text-(--color-text)">
            {formatBytes(job.totalBytes)}
          </p>
        </div>

        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
          <p>Actualizado</p>
          <p className="mt-1 font-medium text-(--color-text)">
            {new Date(job.updatedAt).toLocaleTimeString()}
          </p>
        </div>
      </div>

      {job.error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          {job.error}
        </div>
      )}
    </article>
  );
}
