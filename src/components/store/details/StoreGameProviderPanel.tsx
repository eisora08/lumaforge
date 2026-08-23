import { Download, FileArchive, FileCode2, FileText } from "lucide-react";

import type { PackageSource } from "../../../types/package";

type StoreGameProviderPanelProps = {
  sources: PackageSource[];
  onDownloadSource?: (source: PackageSource) => void;
};

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function getSourceStatus(source: PackageSource) {
  if (source.available) {
    return {
      label: "Ready",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      label: "Needs setup",
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    };
  }

  return {
    label: "Unavailable",
    className: "border-red-500/20 bg-red-500/10 text-red-300",
  };
}

export default function StoreGameProviderPanel({
  sources,
  onDownloadSource,
}: StoreGameProviderPanelProps) {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <h2 className="text-lg font-bold text-(--color-text)">
        Provider Sources
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        Selecciona una fuente compatible para descargar Lua/manifests.
      </p>

      {sources.length === 0 ? (
        <div className="mt-4 rounded-xl border border-(--surface-active-border) bg-white/5 p-4 text-sm text-(--color-muted)">
          No hay fuentes disponibles para este juego todavía.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {sources.map((source) => {
            const FileIcon = getFileIcon(source.fileType);
            const status = getSourceStatus(source);

            return (
              <div
                key={`${source.providerId}-${source.fileType}`}
                className="flex flex-col gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileIcon className="h-4 w-4 text-(--color-accent)" />

                    <p className="font-semibold text-(--color-text)">
                      {source.providerName}
                    </p>

                    <span className="rounded-md bg-black/30 px-2 py-0.5 text-[11px] text-(--color-muted)">
                      .{source.fileType}
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-1 text-xs text-(--color-muted)">
                    {source.providerMessage ||
                      source.error ||
                      "Provider source detected."}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${status.className}`}
                  >
                    {status.label}
                  </span>

                  <button
                    type="button"
                    disabled={!source.available || !onDownloadSource}
                    onClick={() => onDownloadSource?.(source)}
                    className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
