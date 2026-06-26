import {
  CheckCircle2,
  CircleX,
  FileArchive,
  FileCode2,
  FileText,
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
              <div className="flex items-center justify-between gap-3">
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

                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-(--color-muted)">
                    <FileIcon className="h-3 w-3" />
                    .{source.fileType}

                    {source.lastUpdated && (
                      <span className="ml-1">• {source.lastUpdated}</span>
                    )}
                  </div>
                </div>

                {isSelected && (
                  <span className="rounded-full bg-(--color-accent) px-2 py-0.5 text-[10px] font-medium text-black">
                    Selected
                  </span>
                )}
              </div>

              {!source.available && source.error && (
                <p className="mt-2 text-[11px] text-red-300">
                  {source.error}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}