import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Loader2,
  HardDrive,
  ChevronDown,
  ChevronUp,
  Monitor,
  Globe,
  Lock,
  Puzzle,
  Share2,
} from "lucide-react";
import {
  depotDownloaderResolveDepots,
  depotDownloaderStatus,
  pickFolder,
} from "../../services/tauri";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import type { DepotInfo, DepotSelection } from "../../types/download";

type StoreDepotCardProps = {
  appId: number;
  onDownload: (selections: DepotSelection[], outputDir: string) => void;
  onDownloadStart?: (buttonEl: HTMLElement) => void;
};

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return "";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function osIcon(os?: string) {
  if (!os) return <Globe className="h-2.5 w-2.5" />;
  if (os.includes("windows")) return <Monitor className="h-2.5 w-2.5" />;
  if (os.includes("linux")) return <HardDrive className="h-2.5 w-2.5" />;
  return <Globe className="h-2.5 w-2.5" />;
}

function osLabel(os?: string) {
  if (!os) return "All";
  if (os.includes("windows")) return "Win";
  if (os.includes("mac")) return "Mac";
  if (os.includes("linux")) return "Linux";
  return os;
}

export default function StoreDepotCard({
  appId,
  onDownload,
  onDownloadStart,
}: StoreDepotCardProps) {
  const { t } = useTranslation();
  const { getJobByAppId } = useDownloadQueueContext();
  const [depots, setDepots] = useState<DepotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDepots, setSelectedDepots] = useState<Set<number>>(new Set());
  const [outputDir, setOutputDir] = useState(() => {
    return localStorage.getItem("lumaforge-depot-output-dir") || "Downloads/LumaForge/Depot";
  });
  const [expanded, setExpanded] = useState(true);
  const [toolInstalled, setToolInstalled] = useState<boolean | null>(null);

  // Check tool status on mount
  useEffect(() => {
    depotDownloaderStatus()
      .then((status) => setToolInstalled(status.installed))
      .catch(() => setToolInstalled(false));
  }, []);

  // Resolve depots when component mounts (only if tool is installed)
  useEffect(() => {
    if (!appId || toolInstalled === false) return;

    setLoading(true);
    setError(null);

    depotDownloaderResolveDepots(appId)
      .then((result) => {
        setDepots(result.depots);
        // Auto-select depots that have manifests
        const initial = new Set(
          result.depots.filter((d) => d.manifestId).map((d) => d.depotId)
        );
        setSelectedDepots(initial);
      })
      .catch((err) => {
        setError(typeof err === "string" ? err : "Failed to resolve depots");
        setDepots([]);
      })
      .finally(() => setLoading(false));
  }, [appId, toolInstalled]);

  const toggleDepot = useCallback((depotId: number) => {
    setSelectedDepots((prev) => {
      const next = new Set(prev);
      if (next.has(depotId)) {
        next.delete(depotId);
      } else {
        next.add(depotId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedDepots((prev) => {
      const available = depots.filter((d) => d.manifestId).map((d) => d.depotId);
      if (prev.size === available.length) {
        return new Set();
      }
      return new Set(available);
    });
  }, [depots]);

  const handlePickFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) {
      setOutputDir(folder);
      localStorage.setItem("lumaforge-depot-output-dir", folder);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!outputDir || selectedDepots.size === 0) return;

    const selections: DepotSelection[] = depots
      .filter((d) => selectedDepots.has(d.depotId) && d.manifestId && d.manifestPath)
      .map((d) => ({
        depotId: d.depotId,
        manifestId: d.manifestId!,
        manifestPath: d.manifestPath!,
        size: d.sizeOnDisk || 0,
      }));

    if (selections.length > 0) {
      await onDownload(selections, outputDir);
    }
  }, [depots, selectedDepots, outputDir, onDownload]);

  // Check if there's an active download for this game in the queue
  const activeJob = useMemo(() => {
    const job = getJobByAppId(String(appId));
    if (!job) return undefined;
    const activeStatuses = ["waiting", "downloading", "verifying", "paused", "starting"];
    if (!activeStatuses.includes(job.status)) return undefined;
    return job;
  }, [appId, getJobByAppId]);

  const isDownloading = !!activeJob && activeJob.status !== "paused";

  const totalSelectedSize = depots
    .filter((d) => selectedDepots.has(d.depotId))
    .reduce((sum, d) => sum + (d.sizeOnDisk || 0), 0);

  const selectableCount = depots.filter((d) => d.manifestId).length;

  return (
    <div className="flex max-h-[520px] flex-col rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-(--color-text)">
          <HardDrive size={14} />
          Depot Download
          {loading && <Loader2 className="h-4 w-4 animate-spin text-(--color-muted)" />}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-lg p-1 text-(--color-muted) hover:bg-white/5 transition"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <>
          {/* Tool status */}
          {toolInstalled === false && (
            <div className="mt-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
              {t("store.depot_tool_not_installed_desc", "Install it from Settings > Integrations > Third-Party Tools to use depot downloads.")}
            </div>
          )}

          {/* Loading state */}
          {loading && depots.length === 0 && (
            <p className="mt-3 shrink-0 text-xs text-(--color-muted)">
              Resolving depots...
            </p>
          )}

          {/* Error state */}
          {error && (
            <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && depots.length === 0 && (
            <p className="mt-3 shrink-0 text-xs text-(--color-muted)">
              No depots found. Make sure the .lua file is installed.
            </p>
          )}

          {/* Depot list */}
          {!loading && depots.length > 0 && (
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 lf-scroll-area">
              {/* Select All */}
              {selectableCount > 1 && (
                <button
                  onClick={toggleAll}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-(--color-muted) hover:bg-white/5 transition"
                >
                  <div
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition ${
                      selectedDepots.size === selectableCount
                        ? "bg-(--color-accent) border-(--color-accent)"
                        : "border-white/30"
                    }`}
                  >
                    {selectedDepots.size === selectableCount && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  Select All ({selectableCount})
                </button>
              )}

              {/* Individual depots */}
              {depots.map((depot) => {
                const isSelected = selectedDepots.has(depot.depotId);
                const hasManifest = !!depot.manifestId;

                return (
                  <button
                    key={depot.depotId}
                    onClick={() => hasManifest && toggleDepot(depot.depotId)}
                    disabled={!hasManifest}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition ${
                      isSelected
                        ? "bg-(--color-accent)/10 border border-(--color-accent)/30"
                        : "border border-transparent hover:bg-white/5"
                    } ${!hasManifest ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition ${
                        isSelected
                          ? "bg-(--color-accent) border-(--color-accent)"
                          : "border-white/30"
                      }`}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="truncate text-xs font-medium text-(--color-text)">
                        {depot.name || `Depot ${depot.depotId}`}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-(--color-muted)">
                          {osIcon(depot.os)}
                          {osLabel(depot.os)}
                        </span>
                        {depot.language && (
                          <span className="text-[10px] text-(--color-muted)">
                            {depot.language}
                          </span>
                        )}
                        {depot.sizeOnDisk ? (
                          <span className="text-[10px] text-(--color-muted)">
                            {formatSize(depot.sizeOnDisk)}
                          </span>
                        ) : null}
                        {depot.encrypted && (
                          <Lock className="h-2 w-2 text-amber-400" />
                        )}
                        {depot.dlcAppId && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-purple-500/10 px-1 text-[9px] text-purple-400">
                            <Puzzle className="h-2 w-2" />
                            DLC
                          </span>
                        )}
                        {depot.isShared && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-blue-500/10 px-1 text-[9px] text-blue-400">
                            <Share2 className="h-2 w-2" />
                            Shared
                          </span>
                        )}
                      </div>
                    </div>

                    {!hasManifest && (
                      <span className="text-[10px] text-(--color-muted) opacity-60">
                        No manifest
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Output Directory */}
          {!loading && depots.length > 0 && (
            <div className="mt-3 shrink-0">
              <label className="block text-[10px] uppercase tracking-wider text-(--color-muted) mb-1">
                Output Directory
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={outputDir}
                  onChange={(e) => {
                    setOutputDir(e.target.value);
                    localStorage.setItem("lumaforge-depot-output-dir", e.target.value);
                  }}
                  placeholder="Select download location..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-(--color-text) placeholder:text-white/30 focus:outline-none focus:border-(--color-accent)/50"
                />
                <button
                  onClick={handlePickFolder}
                  className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-(--color-muted) hover:bg-white/10 transition"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          {!loading && depots.length > 0 && (
            <div className="mt-3 shrink-0 space-y-2 border-t border-(--surface-active-border) pt-3">
              <div className="text-[10px] text-(--color-muted)">
                {selectedDepots.size} depot{selectedDepots.size !== 1 ? "s" : ""} selected
                {totalSelectedSize > 0 && ` · ${formatSize(totalSelectedSize)}`}
              </div>
              <button
                onClick={(e) => {
                  onDownloadStart?.(e.currentTarget as HTMLElement);
                  handleDownload();
                }}
                disabled={!outputDir || selectedDepots.size === 0 || isDownloading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-3 text-sm font-bold text-(--color-accent-text) shadow-lg shadow-(--color-accent)/25 transition duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isDownloading ? "Descargando..." : "Depot Download"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
