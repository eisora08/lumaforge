import {
  CheckCircle2,
  CircleX,
  FileArchive,
  FileCode2,
  FileText,
} from "lucide-react";

import { PackageSource } from "../../types/package";

type PackageSourceBadgeProps = {
  source: PackageSource;
};

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

export default function PackageSourceBadge({
  source,
}: PackageSourceBadgeProps) {
  const FileIcon = getFileIcon(source.fileType);
  const StatusIcon = source.available ? CheckCircle2 : CircleX;

  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        source.available
          ? "border-emerald-500/20 bg-emerald-500/10"
          : "border-red-500/20 bg-red-500/10"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon
          className={`h-3.5 w-3.5 ${
            source.available ? "text-emerald-400" : "text-red-400"
          }`}
        />

        <span className="text-xs font-medium text-(--color-text)">
          {source.providerName}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-(--color-muted)">
        <FileIcon className="h-3 w-3" />
        .{source.fileType}

        {source.lastUpdated && (
          <span className="ml-1">• {source.lastUpdated}</span>
        )}
      </div>
    </div>
  );
}