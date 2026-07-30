import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  Globe,
  HardDrive,
  Languages,
  Package,
  X,
} from "lucide-react";

import type { RepackQueryResult } from "../../services/tauri";

type DebridSourceSelectorModalProps = {
  open: boolean;
  repacks: RepackQueryResult[];
  gameTitle: string;
  appId?: string;
  onInstallSource: (repack: RepackQueryResult) => void;
  onClose: () => void;
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function getInstallerLabel(type: string): string {
  if (type === "sfx") return "SFX";
  if (type === "zip") return "ZIP";
  if (type === "inno") return "Inno Setup";
  return type;
}

function getInstallerColor(type: string): string {
  if (type === "sfx") return "text-amber-400 bg-amber-400/10";
  if (type === "zip") return "text-sky-400 bg-sky-400/10";
  if (type === "inno") return "text-emerald-400 bg-emerald-400/10";
  return "text-zinc-400 bg-zinc-400/10";
}

export default function DebridSourceSelectorModal({
  open,
  repacks,
  gameTitle,
  appId,
  onInstallSource,
  onClose,
}: DebridSourceSelectorModalProps) {
  if (!open) return null;

  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [open]);

  const selectedRepack = repacks[selectedIndex] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="lf-surface w-full max-w-lg overflow-hidden rounded-3xl border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/5">
              <Package className="h-6 w-6 text-(--color-muted)" />
            </div>

            <div className="min-w-0">
              <h2 className="line-clamp-1 text-lg font-bold text-(--color-text)">
                {gameTitle}
              </h2>

              <p className="mt-0.5 text-sm text-(--color-muted)">
                {appId ? `AppID ${appId}` : "Debrid game"}
                {" · "}{repacks.length} repack{repacks.length === 1 ? "" : "s"} available
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/5 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto border-t border-(--surface-active-border) px-5 py-4">
          <div className="space-y-2">
            {repacks.map((repack, i) => {
              const isSelected = selectedIndex === i;

              return (
                <button
                  key={repack.id}
                  type="button"
                  onClick={() => setSelectedIndex(i)}
                  className={`w-full rounded-xl border p-3.5 text-left transition ${
                    isSelected
                      ? "border-(--color-accent) bg-(--color-accent)/10"
                      : "border-(--surface-active-border) bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-(--color-text)">
                          {repack.repacker}
                        </span>

                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${getInstallerColor(repack.installerType)}`}>
                          {getInstallerLabel(repack.installerType)}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-muted)">
                        <span className="inline-flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {formatFileSize(repack.fileSize)}
                          {repack.installSize != null && (
                            <> → {formatFileSize(repack.installSize)}</>
                          )}
                        </span>

                        {repack.languages.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Languages className="h-3 w-3" />
                            {repack.languages.length > 3
                              ? `${repack.languages.length} languages`
                              : repack.languages.join(", ")}
                          </span>
                        )}

                        <span className="inline-flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          {formatDate(repack.updatedAt)}
                        </span>
                      </div>
                    </div>

                    {isSelected && (
                      <span className="mt-0.5 shrink-0">
                        <CheckCircle2 className="h-5 w-5 text-(--color-accent)" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-(--surface-active-border) p-4">
          <button
            type="button"
            onClick={() => {
              if (selectedRepack) {
                onInstallSource(selectedRepack);
                onClose();
              }
            }}
            disabled={!selectedRepack}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Install{selectedRepack ? ` (${selectedRepack.repacker})` : ""}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) transition hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
