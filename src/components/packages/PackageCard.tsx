import { useEffect, useMemo, useState } from "react";

import {
  CheckCircle2,
  ChevronDown,
  CircleX,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileText,
  Gamepad2,
  PauseCircle,
  SearchCheck,
} from "lucide-react";

import { PackageGame, PackageSource } from "../../types/package";
import { PackageInstallStatus } from "../../types/packageInstall";

import { useSettings } from "../../context/SettingsContext";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { downloadAndInstallPackage } from "../../services/tauri";
import { openExternalUrl } from "../../services/externalLinks";
import { getSteamStoreUrl } from "../../utils/steamLinks";

import {
  showError,
  showSuccess,
  showWarning,
} from "../toast/GameToast";

import PackageDetailsModal from "./PackageDetailsModal";

type PackageCardProps = {
  game: PackageGame;
  installStatus?: PackageInstallStatus;
  recheckingSources?: boolean;
  onInstallComplete?: () => void;
  onRecheckSources?: (appId: string) => void;
};

function getSourceKey(source: PackageSource) {
  return `${source.providerId}-${source.fileType}`;
}

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function getInstallBadge(status: PackageInstallStatus) {
  if (status === "active") {
    return {
      label: "Installed",
      icon: CheckCircle2,
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (status === "disabled") {
    return {
      label: "Disabled",
      icon: PauseCircle,
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    };
  }

  return null;
}

function getFriendlySourceStatus(source?: PackageSource) {
  if (!source) {
    return {
      label: "Sin fuente",
      description: "No hay una fuente disponible.",
      className: "text-zinc-300",
      dotClassName: "bg-zinc-400",
    };
  }

  if (source.available) {
    return {
      label: "Disponible",
      description: "Lista para descargar.",
      className: "text-emerald-300",
      dotClassName: "bg-emerald-400",
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      label: "Requiere configuración",
      description: "Configura la API key en Settings.",
      className: "text-yellow-300",
      dotClassName: "bg-yellow-400",
    };
  }

  return {
    label: "No disponible",
    description: "Esta fuente no está disponible ahora.",
    className: "text-red-300",
    dotClassName: "bg-red-400",
  };
}

function getLastCheckedLabel(source?: PackageSource) {
  if (!source?.checkedAt && !source?.lastUpdated) {
    return "No revisado";
  }

  if (source.lastUpdated) {
    return source.lastUpdated;
  }

  if (!source.checkedAt) {
    return "No revisado";
  }

  try {
    return new Date(source.checkedAt).toLocaleString();
  } catch {
    return "No revisado";
  }
}

export default function PackageCard({
  game,
  installStatus = "not-installed",
  recheckingSources = false,
  onInstallComplete,
  onRecheckSources,
}: PackageCardProps) {
  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  const availableSources = game.sources.filter((source) => source.available);

  const defaultSourceKey = availableSources[0]
    ? getSourceKey(availableSources[0])
    : game.sources[0]
      ? getSourceKey(game.sources[0])
      : "";

  const [selectedSourceKey, setSelectedSourceKey] =
    useState(defaultSourceKey);

  useEffect(() => {
    const currentExists = game.sources.some(
      (source) => getSourceKey(source) === selectedSourceKey
    );

    if (!currentExists) {
      setSelectedSourceKey(defaultSourceKey);
    }
  }, [defaultSourceKey, game.sources, selectedSourceKey]);

  const selectedSource = useMemo(() => {
    return game.sources.find(
      (source) => getSourceKey(source) === selectedSourceKey
    );
  }, [game.sources, selectedSourceKey]);

  const selectedStatus = getFriendlySourceStatus(selectedSource);
  const selectedFileIcon = selectedSource
    ? getFileIcon(selectedSource.fileType)
    : FileArchive;

  const SelectedFileIcon = selectedFileIcon;
  const installBadge = getInstallBadge(installStatus);

  async function handleOpenSteamPage() {
    try {
      await openExternalUrl(getSteamStoreUrl(Number(game.appId)));
    } catch (error) {
      console.error(error);

      showError("No se pudo abrir la página de Steam.", {
        title: "Error abriendo enlace",
      });
    }
  }

  async function handleDownload() {
    if (!selectedSource || !selectedSource.available) {
      showWarning("Selecciona una fuente disponible antes de descargar.", {
        title: "Fuente requerida",
      });

      return;
    }

    if (!selectedSource.downloadUrl) {
      showError("Esta fuente no tiene una URL de descarga válida.", {
        title: "URL inválida",
      });

      return;
    }

    if (!settings.luaPath || !settings.depotcachePath) {
      showWarning("Configura o detecta las rutas de Steam antes de instalar.", {
        title: "Rutas requeridas",
      });

      return;
    }

    const job = addJob({
      appId: game.appId,
      gameTitle: game.title,
      providerId: selectedSource.providerId,
      providerName: selectedSource.providerName,
      fileType: selectedSource.fileType,
      downloadUrl: selectedSource.downloadUrl,
    });

    try {
      const result = await downloadAndInstallPackage({
        jobId: job.id,
        downloadUrl: selectedSource.downloadUrl,
        luaTarget: settings.luaPath,
        depotcacheTarget: settings.depotcachePath,
        createBackups: settings.createBackups,
        headers: selectedSource.authHeaders,
        tempFolder: settings.tempFolder,
      });

      updateJob(job.id, {
        status: "done",
        progress: 100,
        bytesRead: result.bytes_read,
        totalBytes: result.total_bytes,
      });

      showSuccess(result.message, {
        title: "Paquete instalado",
      });

      onInstallComplete?.();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "No se pudo instalar el paquete.";

      updateJob(job.id, {
        status: "failed",
        progress: 0,
        error: message,
      });

      showError(message, {
        title: "Instalación fallida",
      });
    }
  }

  return (
    <>
      <article className="lf-surface group overflow-hidden rounded-2xl border transition">
        <div className="relative h-36 overflow-hidden bg-white/5">
          {game.imageUrl ? (
            <img
              src={game.imageUrl}
              alt={game.title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Gamepad2 className="h-8 w-8 text-(--color-muted)" />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />

          {installBadge && (() => {
            const InstallIcon = installBadge.icon;

            return (
              <div
                className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${installBadge.className}`}
              >
                <InstallIcon className="h-3.5 w-3.5" />
                {installBadge.label}
              </div>
            );
          })()}

          <div className="absolute bottom-3 left-3 right-3">
            <h3 className="line-clamp-1 font-semibold text-white">
              {game.title}
            </h3>

            <p className="mt-0.5 text-xs text-white/70">
              AppID: {game.appId}
            </p>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="line-clamp-1 text-sm text-(--color-muted)">
                {game.developer || "Developer unknown"}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {game.platforms.map((platform) => (
                  <span
                    key={platform}
                    className="rounded-full border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[11px] text-(--color-muted)"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            </div>

            <span className="shrink-0 rounded-full bg-white/8 px-3 py-1 text-xs text-(--color-text)">
              {availableSources.length} source
              {availableSources.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="rounded-2xl border border-(--surface-active-border) bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
                Fuente seleccionada
              </p>

              {recheckingSources && (
                <span className="text-[11px] text-(--color-accent)">
                  Revisando...
                </span>
              )}
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${selectedStatus.dotClassName}`}
                  />

                  <span className="truncate text-sm font-semibold text-(--color-text)">
                    {selectedSource?.providerName || "Sin fuente"}
                  </span>

                  {selectedSource && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-(--color-muted)">
                      <SelectedFileIcon className="h-3 w-3" />
                      .{selectedSource.fileType}
                    </span>
                  )}
                </div>

                <p className={`mt-1 text-xs ${selectedStatus.className}`}>
                  {selectedStatus.label}
                </p>

                <p className="mt-1 text-[11px] text-(--color-muted)">
                  {selectedSource
                    ? `Última revisión: ${getLastCheckedLabel(selectedSource)}`
                    : selectedStatus.description}
                </p>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setSourceMenuOpen((value) => !value)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
                >
                  Cambiar
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {sourceMenuOpen && (
                  <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-(--surface-active-border) bg-black/90 p-2 shadow-2xl backdrop-blur-xl">
                    <div className="mb-2 px-2 py-1 text-[11px] uppercase tracking-wide text-white/40">
                      Fuentes
                    </div>

                    <div className="space-y-1">
                      {game.sources.map((source) => {
                        const sourceKey = getSourceKey(source);
                        const isSelected = sourceKey === selectedSourceKey;
                        const sourceStatus = getFriendlySourceStatus(source);
                        const FileIcon = getFileIcon(source.fileType);

                        return (
                          <button
                            key={sourceKey}
                            type="button"
                            onClick={() => {
                              setSelectedSourceKey(sourceKey);
                              setSourceMenuOpen(false);
                            }}
                            className={`w-full rounded-xl px-3 py-2 text-left transition ${
                              isSelected
                                ? "bg-(--color-accent)/15"
                                : "hover:bg-white/10"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`h-2 w-2 rounded-full ${sourceStatus.dotClassName}`}
                                  />

                                  <span className="truncate text-xs font-medium text-white">
                                    {source.providerName}
                                  </span>
                                </div>

                                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/50">
                                  <FileIcon className="h-3 w-3" />
                                  .{source.fileType}
                                  <span>• {sourceStatus.label}</span>
                                </div>
                              </div>

                              {isSelected && (
                                <CheckCircle2 className="h-4 w-4 text-(--color-accent)" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
            >
              <SearchCheck className="h-3.5 w-3.5" />
              Details
            </button>

            <button
              type="button"
              disabled={!selectedSource || !selectedSource.available}
              onClick={handleDownload}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-medium text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenSteamPage}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Steam page
          </button>
        </div>
      </article>

      <PackageDetailsModal
        game={game}
        installStatus={installStatus}
        selectedSource={selectedSource}
        open={detailsOpen}
        rechecking={recheckingSources}
        onClose={() => setDetailsOpen(false)}
        onSelectSource={setSelectedSourceKey}
        onDownload={handleDownload}
        onRecheckSources={(appId) => onRecheckSources?.(appId)}
      />
    </>
  );
}
``