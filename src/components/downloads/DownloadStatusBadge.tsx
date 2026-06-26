import {
  CheckCircle2,
  CircleDashed,
  CircleX,
  DownloadCloud,
  FileArchive,
  HardDriveDownload,
  Loader2,
  PackageCheck,
} from "lucide-react";

import { DownloadStatus } from "../../types/download";

type DownloadStatusBadgeProps = {
  status: DownloadStatus;
};

const statusConfig = {
  queued: {
    label: "En cola",
    icon: CircleDashed,
    className: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  },
  checking: {
    label: "Verificando",
    icon: Loader2,
    className: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
  },
  downloading: {
    label: "Descargando",
    icon: DownloadCloud,
    className: "border-blue-500/20 bg-blue-500/10 text-blue-300",
  },
  extracting: {
    label: "Extrayendo",
    icon: FileArchive,
    className: "border-purple-500/20 bg-purple-500/10 text-purple-300",
  },
  installing: {
    label: "Instalando",
    icon: HardDriveDownload,
    className: "border-orange-500/20 bg-orange-500/10 text-orange-300",
  },
  done: {
    label: "Completado",
    icon: PackageCheck,
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
  },
  failed: {
    label: "Falló",
    icon: CircleX,
    className: "border-red-500/20 bg-red-500/10 text-red-300",
  },
  cancelled: {
    label: "Cancelado",
    icon: CheckCircle2,
    className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
  },
} satisfies Record<
  DownloadStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    className: string;
  }
>;

export default function DownloadStatusBadge({
  status,
}: DownloadStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const shouldSpin = status === "checking" || status === "downloading";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${config.className}`}
    >
      <Icon className={`h-3.5 w-3.5 ${shouldSpin ? "animate-spin" : ""}`} />
      {config.label}
    </span>
  );
}