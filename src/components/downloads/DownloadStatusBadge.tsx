import {
  CheckCircle2,
  CircleDashed,
  CircleX,
  Clock,
  DownloadCloud,
  FileArchive,
  HardDriveDownload,
  Loader2,
  PackageCheck,
  PauseCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { DownloadStatus } from "../../types/download";

type DownloadStatusBadgeProps = {
  status: DownloadStatus;
};

const STATUS_ICON: Record<DownloadStatus, typeof CheckCircle2> = {
  queued: CircleDashed,
  waiting: Clock,
  checking: Loader2,
  downloading: DownloadCloud,
  extracting: FileArchive,
  installing: HardDriveDownload,
  paused: PauseCircle,
  verifying: Loader2,
  done: PackageCheck,
  failed: CircleX,
  cancelled: CheckCircle2,
};

const STATUS_CLASS: Record<DownloadStatus, string> = {
  queued: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  waiting: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  checking: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  downloading: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  extracting: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  installing: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  paused: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  verifying: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  done: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  failed: "border-red-500/20 bg-red-500/10 text-red-300",
  cancelled: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
};

const STATUS_I18N_KEY: Record<DownloadStatus, string> = {
  queued: "downloads.status_queued",
  waiting: "downloads.status_waiting",
  checking: "downloads.status_checking",
  downloading: "downloads.status_downloading",
  extracting: "downloads.status_extracting",
  installing: "downloads.status_installing",
  paused: "downloads.status_paused",
  verifying: "downloads.status_checking",
  done: "downloads.status_done",
  failed: "downloads.status_failed",
  cancelled: "downloads.status_cancelled",
};

export default function DownloadStatusBadge({
  status,
}: DownloadStatusBadgeProps) {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[status];
  const label = t(STATUS_I18N_KEY[status]);

  const shouldSpin = status === "checking" || status === "downloading" || status === "verifying";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${STATUS_CLASS[status]}`}
    >
      <Icon className={`h-3.5 w-3.5 ${shouldSpin ? "animate-spin" : ""}`} />
      {label}
    </span>
  );
}