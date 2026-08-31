import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  FolderOpen,
  X,
  HardDrive,
  Check,
  Loader2,
  Settings,
  Monitor,
  Apple,
  Terminal,
  Globe,
  Package,
  Puzzle,
  Share2,
  Lock,
} from "lucide-react";
import {
  pickFolder,
  depotDownloaderResolveDepots,
  depotDownloaderStart,
  depotDownloaderStatus,
} from "../../services/tauri";
import type { DepotInfo, DepotSelection } from "../../types/download";
import { showError } from "../toast/GameToast";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";

type Props = {
  open: boolean;
  onClose: () => void;
  appId: number;
  gameName: string;
  headerImage?: string;
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
  if (!os) return <Globe className="h-3 w-3" />;
  if (os.includes("windows")) return <Monitor className="h-3 w-3" />;
  if (os.includes("mac")) return <Apple className="h-3 w-3" />;
  if (os.includes("linux")) return <Terminal className="h-3 w-3" />;
  return <Globe className="h-3 w-3" />;
}

function osLabel(os?: string, t?: (key: string, fallback: string) => string) {
  if (!os) return t?.("store.depot_all_platforms", "All platforms") ?? "All platforms";
  if (os.includes("windows")) return "Windows";
  if (os.includes("mac")) return "macOS";
  if (os.includes("linux")) return "Linux";
  return os;
}

type DepotGroup = {
  label: string;
  icon: React.ReactNode;
  depots: DepotInfo[];
};

export default function DepotPickerModal({
  open,
  onClose,
  appId,
  gameName,
  headerImage,
  onDownloadStart,
}: Props) {
  const { t } = useTranslation();
  const { addDepotDownloadJob } = useDownloadQueueContext();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [depots, setDepots] = useState<DepotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDepots, setSelectedDepots] = useState<Set<number>>(new Set());
  const [outputDir, setOutputDir] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [toolInstalled, setToolInstalled] = useState<boolean | null>(null);
  const [gameNameFromApi, setGameNameFromApi] = useState("");

  const defaultOutputDir = useMemo(() => {
    return "Downloads/LumaForge/Depot";
  }, []);

  const resolvedImage = headerImage || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

  // Check tool status and resolve depots when opened
  useEffect(() => {
    if (!open || !appId) return;
    setLoading(true);
    setError(null);
    setDepots([]);
    setSelectedDepots(new Set());
    setGameNameFromApi("");

    // Load saved output dir or use default
    const savedDir = localStorage.getItem("lumaforge-depot-output-dir");
    setOutputDir(savedDir || defaultOutputDir);

    depotDownloaderStatus()
      .then((status) => {
        setToolInstalled(status.installed);
        if (!status.installed) {
          setLoading(false);
          return;
        }
        return depotDownloaderResolveDepots(appId);
      })
      .then((result) => {
        if (result) {
          setDepots(result.depots);
          setGameNameFromApi(result.gameName || "");
          const initial = new Set(
            result.depots.filter((d) => d.manifestId).map((d) => d.depotId)
          );
          setSelectedDepots(initial);
        }
      })
      .catch((err) => {
        setError(typeof err === "string" ? err : "Failed to resolve depots");
      })
      .finally(() => setLoading(false));
  }, [open, appId, defaultOutputDir]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose]
  );

  const toggleDepot = useCallback((depotId: number) => {
    setSelectedDepots((prev) => {
      const next = new Set(prev);
      if (next.has(depotId)) next.delete(depotId);
      else next.add(depotId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedDepots((prev) => {
      const available = depots.filter((d) => d.manifestId).map((d) => d.depotId);
      if (prev.size === available.length) return new Set();
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

  const handleOutputDirChange = useCallback((value: string) => {
    setOutputDir(value);
    localStorage.setItem("lumaforge-depot-output-dir", value);
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

    if (selections.length === 0) return;

    setDownloading(true);
    try {
      const title = gameNameFromApi || gameName;
      // Create a queue job so the progress shows in DownloadsModal
      const jobId = addDepotDownloadJob(String(appId), title, selections, resolvedImage, outputDir);

      // Pass the same job_id to the Rust backend
      await depotDownloaderStart({
        jobId,
        appId,
        gameName: title,
        depots: selections,
        outputDir,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(
        t("store.depot_download_failed", "Depot download failed: {{message}}", {
          message: msg,
        }),
        { title: "Depot Download" }
      );
    } finally {
      setDownloading(false);
    }
  }, [depots, selectedDepots, outputDir, appId, gameName, gameNameFromApi, onClose, t, addDepotDownloadJob, resolvedImage]);

  // Group depots by type
  const groups: DepotGroup[] = useMemo(() => {
    const base: DepotInfo[] = [];
    const dlc: DepotInfo[] = [];
    const shared: DepotInfo[] = [];

    for (const d of depots) {
      if (d.isShared) shared.push(d);
      else if (d.dlcAppId) dlc.push(d);
      else base.push(d);
    }

    const result: DepotGroup[] = [];
    if (base.length > 0)
      result.push({
        label: t("store.depot_base_game", "Base Game"),
        icon: <Package className="h-3.5 w-3.5" />,
        depots: base,
      });
    if (dlc.length > 0)
      result.push({
        label: t("store.depot_dlc", "DLC"),
        icon: <Puzzle className="h-3.5 w-3.5" />,
        depots: dlc,
      });
    if (shared.length > 0)
      result.push({
        label: t("store.depot_shared", "Shared Redistributables"),
        icon: <Share2 className="h-3.5 w-3.5" />,
        depots: shared,
      });
    return result;
  }, [depots, t]);

  const totalSelectedSize = depots
    .filter((d) => selectedDepots.has(d.depotId))
    .reduce((sum, d) => sum + (d.sizeOnDisk || 0), 0);

  const selectableCount = depots.filter((d) => d.manifestId).length;

  if (!open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/40"
    >
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-(--color-border) lf-surface shadow-2xl">
        {/* Header Image */}
        <div className="relative h-[200px] shrink-0 overflow-hidden">
          <img
            src={resolvedImage}
            alt={gameName}
            className="h-full w-full object-cover brightness-[0.5] saturate-[1.05]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="absolute inset-0 bg-linear-to-t from-(--color-bg) via-(--color-bg)/60 to-transparent" />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60"
          >
            <X size={16} />
          </button>
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-4 pt-8">
            <h2 className="text-lg font-bold text-(--color-text)">
              {gameNameFromApi || gameName || `App ${appId}`}
            </h2>
            <p className="mt-0.5 text-xs text-(--color-muted)">
              {t("store.depot_select", "Select depots to download")}
            </p>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="relative z-10 flex-1 overflow-y-auto px-6 py-4">
          {/* Tool not installed */}
          {toolInstalled === false && (
            <div className="text-center py-8">
              <Settings size={32} className="mx-auto mb-3 text-(--color-muted)" />
              <p className="text-sm font-medium text-(--color-text) mb-1">
                {t("store.depot_tool_not_installed", "DepotDownloaderMod not installed")}
              </p>
              <p className="text-xs text-(--color-muted) mb-4">
                {t(
                  "store.depot_tool_not_installed_desc",
                  "Install it from Settings > Integrations > Third-Party Tools to use depot downloads."
                )}
              </p>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-accent)/10 px-4 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
              >
                <Settings size={12} />
                {t("store.open_settings", "Open Settings")}
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-(--color-muted)">
              <Loader2 className="mr-3 h-5 w-5 animate-spin text-(--color-accent)" />
              <span className="text-sm">{t("store.depot_resolving", "Resolving depots...")}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Empty */}
          {!loading && !error && !toolInstalled && depots.length === 0 && null}
          {!loading && !error && toolInstalled !== false && depots.length === 0 && (
            <div className="py-8 text-center">
              <HardDrive size={32} className="mx-auto mb-2 text-(--color-muted)" />
              <p className="text-sm text-(--color-muted)">
                {t("store.depot_empty", "No depots found for this game.")}
              </p>
              <p className="mt-1 text-xs text-(--color-muted)">
                {t("store.depot_empty_hint", "Make sure the .lua file is installed.")}
              </p>
            </div>
          )}

          {/* Depot Groups */}
          {!loading && !error && depots.length > 0 && (
            <>
              {/* Select All */}
              {selectableCount > 1 && (
                <button
                  onClick={toggleAll}
                  className="mb-3 flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/5"
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded border transition ${
                      selectedDepots.size === selectableCount
                        ? "border-(--color-accent) bg-(--color-accent)"
                        : "border-white/30"
                    }`}
                  >
                    {selectedDepots.size === selectableCount && (
                      <Check size={10} className="text-white" />
                    )}
                  </div>
                  {t("store.depot_select_all", "Select All")} ({selectableCount})
                </button>
              )}

              {/* Groups */}
              {groups.map((group) => (
                <div key={group.label} className="mb-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-muted)">
                    {group.icon}
                    {group.label}
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                      {group.depots.length}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.depots.map((depot) => {
                      const isSelected = selectedDepots.has(depot.depotId);
                      const hasManifest = !!depot.manifestId;

                      return (
                        <button
                          key={depot.depotId}
                          onClick={() => hasManifest && toggleDepot(depot.depotId)}
                          disabled={!hasManifest}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                            isSelected
                              ? "border-(--color-accent)/30 bg-(--color-accent)/10"
                              : "border-white/[0.06] hover:bg-white/[0.04]"
                          } ${!hasManifest ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                        >
                          <div
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                              isSelected
                                ? "border-(--color-accent) bg-(--color-accent)"
                                : "border-white/30"
                            }`}
                          >
                            {isSelected && <Check size={10} className="text-white" />}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-(--color-text)">
                              {depot.name || `Depot ${depot.depotId}`}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {/* OS badge */}
                              <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-(--color-muted)">
                                {osIcon(depot.os)}
                                {osLabel(depot.os, t)}
                              </span>
                              {/* Language badge */}
                              {depot.language && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-(--color-muted)">
                                  {depot.language}
                                </span>
                              )}
                              {/* Size */}
                              {depot.sizeOnDisk ? (
                                <span className="text-[10px] text-(--color-muted)">
                                  {formatSize(depot.sizeOnDisk)}
                                </span>
                              ) : null}
                              {/* Encrypted */}
                              {depot.encrypted && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400">
                                  <Lock size={9} />
                                  Encrypted
                                </span>
                              )}
                              {/* DLC label */}
                              {depot.dlcAppId && (
                                <span className="inline-flex items-center gap-0.5 rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400">
                                  DLC {depot.dlcAppId}
                                </span>
                              )}
                              {/* Shared label */}
                              {depot.isShared && (
                                <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                                  <Share2 size={9} />
                                  Shared
                                </span>
                              )}
                            </div>
                          </div>

                          {!hasManifest && (
                            <span className="text-[10px] text-(--color-muted)">
                              {t("store.depot_no_manifest", "No manifest")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Fixed Footer: Output Directory + Actions */}
        {!loading && depots.length > 0 && (
          <div className="shrink-0 border-t border-(--surface-active-border) px-6 py-4">
            {/* Output Directory */}
            <div className="mb-3">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-(--color-muted)">
                {t("store.depot_output_dir", "Output Directory")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={outputDir}
                  onChange={(e) => handleOutputDirChange(e.target.value)}
                  placeholder="Downloads/LumaForge/Depot"
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-(--color-text) placeholder:text-white/20 focus:border-(--color-accent)/50 focus:outline-none"
                />
                <button
                  onClick={handlePickFolder}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-(--color-muted) transition hover:bg-white/10"
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-(--color-muted)">
                {selectedDepots.size} depot{selectedDepots.size !== 1 ? "s" : ""}
                {totalSelectedSize > 0 && ` · ${formatSize(totalSelectedSize)}`}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-(--color-text) transition hover:bg-white/10"
                >
                  {t("common.cancel", "Cancel")}
                </button>
                <button
                  onClick={(e) => {
                    onDownloadStart?.(e.currentTarget as HTMLElement);
                    handleDownload();
                  }}
                  disabled={!outputDir || selectedDepots.size === 0 || downloading}
                  className="flex items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-2 text-sm font-bold text-(--color-accent-text) transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t("store.depot_download", "Download")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
