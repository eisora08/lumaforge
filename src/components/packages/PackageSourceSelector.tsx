import {
  CheckCircle2,
  CircleX,
  FileArchive,
  FileCode2,
  FileText,
  KeyRound,
} from "lucide-react";

import { PackageSource } from "../../types/package";

type PackageSourceSelectorProps = {
  sources: PackageSource[];
  selectedSourceKey: string;
  onSelect: (sourceKey: string) => void;
};

function getSourceKey(source: PackageSource) {
  return `${source.providerId}-${source.fileType}`;
}

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function formatCheckedAt(value?: string) {
  if (!value) return "No verificado";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "No verificado";
  }
}

export default function PackageSourceSelector({
  sources,
  selectedSourceKey,
  onSelect,
}: PackageSourceSelectorProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
        Fuente de descarga
      </p>

      <div className="grid grid-cols-1 gap-2">
        {sources.map((source) => {
          const sourceKey = getSourceKey(source);
          const isSelected = selectedSourceKey === sourceKey;
          const FileIcon = getFileIcon(source.fileType);
          const StatusIcon = source.available ? CheckCircle2 : CircleX;

          return (
            <button
              key={sourceKey}
              type="button"
              disabled={!source.available}
              onClick={() => onSelect(sourceKey)}
              className={`rounded-xl border p-3 text-left transition ${
                isSelected
                  ? "border-(--color-accent) bg-(--color-accent)/10"
                  : "border-(--surface-active-border) bg-white/5 hover:bg-white/10"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon
                      className={`h-3.5 w-3.5 ${
                        source.available
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    />

                    <span className="truncate text-xs font-medium text-(--color-text)">
                      {source.providerName}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-(--color-muted)">
                    <FileIcon className="h-3 w-3" />
                    .{source.fileType}

                    {typeof source.statusCode === "number" && (
                      <span>• HTTP {source.statusCode}</span>
                    )}

                    <span>• {formatCheckedAt(source.checkedAt)}</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
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

                  {isSelected && (
                    <span className="rounded-full bg-(--color-accent) px-2 py-0.5 text-[10px] font-medium text-(--color-accent-text)">
                      Selected
                    </span>
                  )}
                </div>
              </div>

              {(source.providerMessage || source.error) && (
                <p
                  className={`mt-2 text-[11px] ${
                    source.available ? "text-(--color-muted)" : "text-red-300"
                  }`}
                >
                  {source.providerMessage || source.error}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}