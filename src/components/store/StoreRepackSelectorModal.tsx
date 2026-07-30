import { useState } from "react";
import {
  Box,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Package,
  X,
} from "lucide-react";

import type { PackageGame, RepackEntry } from "../../types/package";
import AsyncImage from "../common/AsyncImage";

type StoreRepackSelectorModalProps = {
  open: boolean;
  game: PackageGame;
  repackEntries: RepackEntry[];
  onClose: () => void;
  onInstall?: (entry: RepackEntry) => void;
};

/** Format bytes into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Format an ISO date string to a short locale date. */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** Truncate a string with ellipsis. */
function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

export default function StoreRepackSelectorModal({
  open,
  game,
  repackEntries,
  onClose,
  onInstall,
}: StoreRepackSelectorModalProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="lf-surface w-full max-w-xl overflow-hidden rounded-3xl border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
              <AsyncImage
                src={game.imageUrl}
                alt={game.title}
                className="h-full w-full"
                fallback={
                  <div className="flex h-14 w-14 items-center justify-center">
                    <Package className="h-6 w-6 text-(--color-muted)" />
                  </div>
                }
              />
            </div>
            <div className="min-w-0">
              <h2 className="line-clamp-1 text-lg font-bold text-(--color-text)">
                {game.title}
              </h2>
              <p className="mt-0.5 text-sm text-(--color-muted)">
                AppID {game.appId}
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

        {/* Repack list */}
        <div className="flex items-center gap-2 border-t border-(--surface-active-border) px-5 py-3">
          <HardDrive className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-(--color-text)">
            {repackEntries.length === 1
              ? "1 repack installer available"
              : `${repackEntries.length} repack installers available`
            }
          </span>
        </div>

        <div className="max-h-[460px] overflow-y-auto px-5 pb-4">
          {repackEntries.length === 0 ? (
            <p className="py-8 text-center text-sm text-(--color-muted)">
              No repack entries found for this game.
            </p>
          ) : (
            <div className="space-y-2.5 pt-2">
              {repackEntries.map((entry) => {
                const isExpanded = expandedId === entry.id;

                return (
                  <div
                    key={entry.id}
                    className={`overflow-hidden rounded-xl border transition ${
                      isExpanded
                        ? "border-cyan-500/30 bg-cyan-500/5"
                        : "border-(--surface-active-border) bg-white/[0.03]"
                    }`}
                  >
                    {/* Collapsed row */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="flex w-full items-center gap-3 p-3.5 text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                        <Box className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-(--color-text)">
                            {entry.repacker}
                          </span>
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-(--color-muted)">
                            {entry.installerType}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-(--color-muted)">
                          <span className="inline-flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            {formatBytes(entry.fileSize)}
                          </span>
                          {entry.installSize != null && (
                            <span className="inline-flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              install {formatBytes(entry.installSize)}
                            </span>
                          )}
                          <span>{formatDate(entry.updatedAt)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {entry.downloadUris.length > 0 && onInstall && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInstall(entry);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20"
                          >
                            <Download className="h-3 w-3" />
                            Install
                          </button>
                        )}

                        <svg
                          className={`h-4 w-4 text-(--color-muted) transition ${isExpanded ? "rotate-90" : ""}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-cyan-500/10 px-3.5 pb-3.5 pt-3">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-(--color-muted)">
                          <div>
                            <span className="block text-[10px] uppercase tracking-wider text-(--color-muted)/60">
                              Repacker
                            </span>
                            <span className="text-(--color-text)">{entry.repacker}</span>
                          </div>

                          <div>
                            <span className="block text-[10px] uppercase tracking-wider text-(--color-muted)/60">
                              Installer Type
                            </span>
                            <span className="text-(--color-text)">{entry.installerType}</span>
                          </div>

                          <div>
                            <span className="block text-[10px] uppercase tracking-wider text-(--color-muted)/60">
                              File Size
                            </span>
                            <span className="text-(--color-text)">{formatBytes(entry.fileSize)}</span>
                          </div>

                          {entry.installSize != null && (
                            <div>
                              <span className="block text-[10px] uppercase tracking-wider text-(--color-muted)/60">
                                Install Size
                              </span>
                              <span className="text-(--color-text)">{formatBytes(entry.installSize)}</span>
                            </div>
                          )}

                          <div>
                            <span className="block text-[10px] uppercase tracking-wider text-(--color-muted)/60">
                              Updated
                            </span>
                            <span className="text-(--color-text)">{formatDate(entry.updatedAt)}</span>
                          </div>

                          {entry.languages.length > 0 && (
                            <div>
                              <span className="block text-[10px] uppercase tracking-wider text-(--color-muted)/60">
                                Languages
                              </span>
                              <span className="text-(--color-text)">
                                {entry.languages.length <= 3
                                  ? entry.languages.join(", ")
                                  : `${entry.languages.slice(0, 3).join(", ")} +${entry.languages.length - 3}`}
                              </span>
                            </div>
                          )}
                        </div>

                        {entry.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {entry.tags.slice(0, 5).map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-(--color-muted)"
                              >
                                {truncate(tag, 20)}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex items-center gap-2">
                          {onInstall && entry.downloadUris.length > 0 && (
                            <button
                              type="button"
                              onClick={() => onInstall(entry)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20"
                            >
                              <Download className="h-3 w-3" />
                              Install in LumaForge
                            </button>
                          )}

                          {entry.sourceUrl && (
                            <a
                              href={entry.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Open Source
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-(--surface-active-border) px-5 py-3">
          <p className="text-xs text-(--color-muted)/60">
            Repack data from the Debrid catalog
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3.5 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
