import { useMemo } from "react";
import {
  Ban,
  DownloadCloud,
  ExternalLink,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  FolderOpen,
  Package,
  Trash2,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { DownloadJob } from "../../types/download";
import DownloadProgressBar from "./DownloadProgressBar";
import DownloadStatusBadge from "./DownloadStatusBadge";
import { getBootSnapshot } from "../../services/appBootCoordinator";
import { localPathToUrl } from "../../services/gameCacheService";

type DownloadJobCardProps = {
  job: DownloadJob;
  onCancel: (jobId: string) => void;
  onRemove: (jobId: string) => void;
  onOpenDetails: (appId: string) => void;
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function getTypeIcon(job: DownloadJob) {
  if (job.type === "steam-install") return DownloadCloud;
  if (job.type === "debrid-install") return Package;
  if (job.fileType === "zip") return FileArchive;
  if (job.fileType === "lua") return FileCode2;
  return FileText;
}

function getProviderBadge(job: DownloadJob): { label: string; className: string } {
  if (job.type === "steam-install") {
    return { label: "Steam", className: "bg-blue-500/15 text-blue-300 border-blue-500/20" };
  }
  if (job.type === "debrid-install") {
    return { label: "Debrid", className: "bg-cyan-500/15 text-cyan-300 border-cyan-500/20" };
  }
  if (job.providerId === "lua") {
    return { label: "Lua", className: "bg-purple-500/15 text-purple-300 border-purple-500/20" };
  }
  if (job.fileType === "zip") {
    return { label: "ZIP", className: "bg-amber-500/15 text-amber-300 border-amber-500/20" };
  }
  if (job.fileType === "manifest") {
    return { label: "Manifest", className: "bg-cyan-500/15 text-cyan-300 border-cyan-500/20" };
  }
  return { label: job.providerName || "Paquete", className: "bg-white/5 text-(--color-muted) border-(--surface-active-border)" };
}

function canCancel(status: DownloadJob["status"]) {
  return (
    status === "queued" ||
    status === "waiting" ||
    status === "checking" ||
    status === "downloading" ||
    status === "extracting" ||
    status === "installing" ||
    status === "paused"
  );
}

function canRemove(status: DownloadJob["status"]) {
  return (
    status === "done" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export default function DownloadJobCard({
  job,
  onCancel,
  onRemove,
  onOpenDetails,
}: DownloadJobCardProps) {
  const TypeIcon = getTypeIcon(job);
  const providerBadge = getProviderBadge(job);
  const progressMode = job.progressMode ?? "determinate";
  const isSteamInstall = job.type === "steam-install";
  const isDebridInstall = job.type === "debrid-install";

  const snapshotGame = useMemo(() => {
    const snapshot = getBootSnapshot();
    if (!snapshot) return null;
    return snapshot.library.games.find(g => g.appId === job.appId || g.appId.endsWith(`-${job.appId}`)) ?? null;
  }, [job.appId]);

  const displayTitle = useMemo(() => {
    if (job.gameTitle && !/^\d+$/.test(job.gameTitle) && !job.gameTitle.startsWith("Steam App ")) {
      return job.gameTitle;
    }
    if (snapshotGame?.title && !snapshotGame.title.startsWith("Steam App ") && !/^\d+$/.test(snapshotGame.title)) {
      return snapshotGame.title;
    }
    return `Steam App ${job.appId}`;
  }, [job.gameTitle, job.appId, snapshotGame]);

  const displayArtworkUrl = useMemo(() => {
    if (job.artworkUrl) return job.artworkUrl;
    if (isSteamInstall) {
      const mediaPath = snapshotGame?.media?.landscapePath || snapshotGame?.media?.coverPath || snapshotGame?.media?.backgroundPath;
      if (mediaPath) {
        const url = localPathToUrl(mediaPath);
        if (url) return url;
      }
    }
    return "";
  }, [job.artworkUrl, job.appId, isSteamInstall, snapshotGame]);

  const installPath = useMemo(() => {
    if (!isSteamInstall) return null;
    return snapshotGame?.installPath ?? null;
  }, [isSteamInstall, snapshotGame?.installPath]);

  /* ── Debrid completed — compact card ── */
  if (isDebridInstall && job.status === "done") {
    return (
      <article className="lf-surface rounded-2xl border p-4 transition hover:border-(--color-accent)/20">
        <div className="flex items-start gap-3">
          {displayArtworkUrl ? (
            <img
              src={displayArtworkUrl}
              alt=""
              className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/5">
              <TypeIcon className="h-6 w-6 text-(--color-accent)" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-(--color-text)">
                {displayTitle}
              </h3>
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-cyan-500/15 text-cyan-300 border-cyan-500/20">
                Debrid
              </span>
              {job.repacker && (
                <span className="inline-flex items-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                  {job.repacker.toUpperCase()}
                </span>
              )}
              <DownloadStatusBadge status={job.status} />
            </div>

            <p className="mt-0.5 text-sm text-(--color-muted)">
              {job.message || "Instalado \u00b7 Listo para jugar"}
            </p>

            {job.installedSize != null && job.installedSize > 0 && (
              <p className="mt-1 text-xs text-(--color-muted)">
                Tama\u00f1o instalado:{" "}
                <span className="font-medium text-(--color-text)">
                  {formatBytes(job.installedSize)}
                </span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onRemove(job.id)}
            className="flex-shrink-0 rounded-xl border border-(--surface-active-border) bg-white/5 p-2 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            title="Quitar"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-(--color-accent)" style={{ width: "100%" }} />
          </div>
          <span className="text-[10px] text-(--color-muted)">100%</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenDetails(job.appId)}
            className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90"
          >
            <Eye className="h-4 w-4" />
            Ver detalles
          </button>

          {job.installDir && (
            <button
              type="button"
              onClick={() => { revealItemInDir(job.installDir!); }}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Abrir carpeta
            </button>
          )}
        </div>
      </article>
    );
  }

  /* ── Steam completed — compact card ── */
  if (isSteamInstall && job.status === "done") {
    return (
      <article className="lf-surface rounded-2xl border p-4 transition hover:border-(--color-accent)/20">
        <div className="flex items-start gap-3">
          {displayArtworkUrl ? (
            <img
              src={displayArtworkUrl}
              alt=""
              className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/5">
              <TypeIcon className="h-6 w-6 text-(--color-accent)" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-(--color-text)">
                {displayTitle}
              </h3>
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-blue-500/15 text-blue-300 border-blue-500/20">
                Steam
              </span>
              <DownloadStatusBadge status={job.status} />
            </div>

            <p className="mt-0.5 text-sm text-(--color-muted)">
              Instalado · Listo para jugar
            </p>

            {job.installedSize != null && job.installedSize > 0 && (
              <p className="mt-1 text-xs text-(--color-muted)">
                Tamaño instalado:{" "}
                <span className="font-medium text-(--color-text)">
                  {formatBytes(job.installedSize)}
                </span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onRemove(job.id)}
            className="flex-shrink-0 rounded-xl border border-(--surface-active-border) bg-white/5 p-2 text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            title="Quitar"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-(--color-accent)" style={{ width: "100%" }} />
          </div>
          <span className="text-[10px] text-(--color-muted)">100%</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenDetails(job.appId)}
            className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90"
          >
            <Eye className="h-4 w-4" />
            Ver detalles
          </button>

          {installPath && (
            <button
              type="button"
              onClick={() => { revealItemInDir(installPath); }}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Abrir carpeta
            </button>
          )}

          <a
            href={`steam://store/${job.appId}`}
            className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Steam
          </a>
        </div>
      </article>
    );
  }

  return (
    <article className="lf-surface rounded-2xl border p-5 transition hover:border-(--color-accent)/20">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {/* Icon/artwork */}
          {isSteamInstall && displayArtworkUrl ? (
            <img
              src={displayArtworkUrl}
              alt=""
              className="h-14 w-14 flex-shrink-0 rounded-xl object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/5">
              <TypeIcon className="h-6 w-6 text-(--color-accent)" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-(--color-text)">
                {displayTitle}
              </h3>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${providerBadge.className}`}
              >
                {providerBadge.label}
              </span>
              {job.type === "debrid-install" && job.repacker && (
                <span className="inline-flex items-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
                  {job.repacker.toUpperCase()}
                </span>
              )}
            </div>

            {job.message ? (
              <p className="mt-0.5 text-sm text-(--color-muted)">
                {job.message}
              </p>
            ) : job.type === "steam-install" ? (
              <p className="mt-0.5 text-sm text-(--color-muted)">
                Instalación en progreso
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-(--color-muted)">
                {job.providerName} · .{job.fileType}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DownloadStatusBadge status={job.status} />

          {canCancel(job.status) && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <Ban className="h-3.5 w-3.5" />
              Cancelar
            </button>
          )}

          {canRemove(job.status) && (
            <button
              type="button"
              onClick={() => onRemove(job.id)}
              className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Quitar
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-5">
        <DownloadProgressBar
          progress={job.progress}
          mode={progressMode}
        />
      </div>

      {/* Steam install — stats row (active or completed) */}
      {isSteamInstall ? (
        <div className="mt-4 flex flex-wrap gap-3">
          {job.status === "done" ? (
            /* Completed: show installed size only */
            job.installedSize != null && job.installedSize > 0 ? (
              <div className="rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs">
                <span className="text-(--color-muted)">Tamaño instalado: </span>
                <span className="font-medium text-(--color-text)">{formatBytes(job.installedSize)}</span>
              </div>
            ) : null
          ) : (
            /* Active: size/speed/eta — only show labels when we have data to display */
            <>
              {job.totalBytes > 0 && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs">
                  {job.bytesRead > 0 ? (
                    <>
                      <span className="text-(--color-muted)">Descargado </span>
                      <span className="font-medium text-(--color-text)">
                        {formatBytes(job.bytesRead)} / {formatBytes(job.totalBytes)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-(--color-muted)">Total </span>
                      <span className="font-medium text-(--color-text)">
                        {formatBytes(job.totalBytes)}
                      </span>
                    </>
                  )}
                </div>
              )}

              {job.speedBytesPerSec != null && job.speedBytesPerSec > 0 && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs">
                  <span className="text-(--color-muted)">Velocidad </span>
                  <span className="font-medium text-(--color-text)">
                    {formatSpeed(job.speedBytesPerSec)}
                  </span>
                </div>
              )}

              {job.etaSeconds != null && job.etaSeconds > 0 && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs">
                  <span className="text-(--color-muted)">ETA </span>
                  <span className="font-medium text-(--color-text)">
                    {formatEta(job.etaSeconds)}
                  </span>
                </div>
              )}

              {job.status === "waiting" && job.totalBytes > 0 && (
                <div className="rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs">
                  <span className="text-(--color-muted)">Esperando </span>
                  <span className="font-medium text-(--color-text)">
                    {(() => {
                      const elapsed = Math.floor((Date.now() - new Date(job.updatedAt).getTime()) / 1000);
                      if (elapsed < 60) return `${elapsed}s`;
                      return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
                    })()}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Non-Steam — existing stat card layout */
        <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-(--color-muted) md:grid-cols-4">
          {progressMode === "determinate" && job.totalBytes > 0 && (
            <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
              <p>Descargado</p>
              <p className="mt-1 font-medium text-(--color-text)">
                {formatBytes(job.bytesRead)} / {formatBytes(job.totalBytes)}
              </p>
            </div>
          )}

          {job.speedBytesPerSec != null && job.speedBytesPerSec > 0 && (
            <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
              <p>Velocidad</p>
              <p className="mt-1 font-medium text-(--color-text)">
                {formatSpeed(job.speedBytesPerSec)}
              </p>
            </div>
          )}

          {job.etaSeconds != null && job.etaSeconds > 0 && (
            <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
              <p>ETA</p>
              <p className="mt-1 font-medium text-(--color-text)">
                {formatEta(job.etaSeconds)}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-3">
            <p>Actualizado</p>
            <p className="mt-1 font-medium text-(--color-text)">
              {new Date(job.updatedAt).toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}

      {/* Active Steam install action */}
      {(isSteamInstall && (job.status === "waiting" || job.status === "downloading")) && (
        <div className="mt-3">
          <a
            href={`steam://install/${job.appId}`}
            className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Steam
          </a>
        </div>
      )}

      {/* Error */}
      {job.error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
          {job.error}
        </div>
      )}
    </article>
  );
}
