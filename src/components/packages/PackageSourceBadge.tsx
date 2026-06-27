import {
  CheckCircle2,
  CircleX,
  FileArchive,
  FileCode2,
  FileText,
  KeyRound,
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

function formatCheckedAt(value?: string) {
  if (!value) return "No verificado";

  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return "No verificado";
  }
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
      title={source.providerMessage || source.error}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon
            className={`h-3.5 w-3.5 shrink-0 ${
              source.available ? "text-emerald-400" : "text-red-400"
            }`}
          />

          <span className="truncate text-xs font-medium text-(--color-text)">
            {source.providerName}
          </span>
        </div>

        {source.requiresApiKey && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
              source.hasAuth
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-yellow-500/10 text-yellow-300"
            }`}
          >
            <KeyRound className="h-3 w-3" />
            {source.hasAuth ? "Auth" : "Key"}
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-(--color-muted)">
        <FileIcon className="h-3 w-3" />
        .{source.fileType}

        {typeof source.statusCode === "number" && (
          <span>• HTTP {source.statusCode}</span>
        )}

        <span>• {formatCheckedAt(source.checkedAt)}</span>
      </div>

      {(source.providerMessage || source.error) && (
        <p className="mt-1 line-clamp-1 text-[11px] text-(--color-muted)">
          {source.providerMessage || source.error}
        </p>
      )}
    </div>
  );
}