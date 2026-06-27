import { useEffect, useMemo, useState } from "react";
import type { ElementType } from "react";

import {
  CheckCircle2,
  ChevronDown,
  CircleX,
  Clock3,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileText,
  Gamepad2,
  Languages,
  PauseCircle,
  Puzzle,
  SearchCheck,
  Server,
  Star,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";

import { useSettings } from "../../context/SettingsContext";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { downloadAndInstallPackage } from "../../services/tauri";
import { openExternalUrl } from "../../services/externalLinks";
import {
  getSteamDbUrl,
  getSteamStoreUrl,
} from "../../utils/steamLinks";

import {
  showError,
  showSuccess,
  showWarning,
} from "../toast/GameToast";

import PackageDetailsModal from "./PackageDetailsModal";

type PackageCardProps = {
  game: PackageGame;
  storeMetadata?: SteamAppMetadata;
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
      className: "border-emerald-500/25 bg-emerald-500/15 text-emerald-300",
    };
  }

  if (status === "disabled") {
    return {
      label: "Disabled",
      icon: PauseCircle,
      className: "border-yellow-500/25 bg-yellow-500/15 text-yellow-300",
    };
  }

  return null;
}

function getFriendlySourceStatus(source?: PackageSource) {
  if (!source) {
    return {
      label: "No source",
      description: "No hay una fuente seleccionada.",
      className: "text-zinc-300",
      icon: CircleX,
    };
  }

  if (source.available) {
    return {
      label: "Ready",
      description: "Lista para descargar.",
      className: "text-emerald-300",
      icon: CheckCircle2,
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      label: "Needs setup",
      description: "Configura la API key en Settings.",
      className: "text-yellow-300",
      icon: Server,
    };
  }

  return {
    label: "Unavailable",
    description: "Esta fuente no está disponible ahora.",
    className: "text-red-300",
    icon: CircleX,
  };
}

function formatCheckedAt(source?: PackageSource) {
  const value = source?.checkedAt || source?.lastUpdated;

  if (!value) {
    return "Not checked";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getBestStoreImage(game: PackageGame, metadata?: SteamAppMetadata) {
  return (
    metadata?.header_image ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    game.imageUrl
  );
}

function getStoreTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getStoreDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

function getStorePlatforms(game: PackageGame, metadata?: SteamAppMetadata) {
  if (metadata?.platforms?.length) {
    return metadata.platforms;
  }

  return game.platforms;
}

function getDlcLabel(metadata?: SteamAppMetadata) {
  const dlcCount = metadata?.dlc_count ?? 0;

  if (dlcCount <= 0) {
    return "Base Game Only";
  }

  if (dlcCount === 1) {
    return "1 DLC Available";
  }

  return `${dlcCount} DLCs Available`;
}

function getLanguagesLabel(metadata?: SteamAppMetadata) {
  const languages = metadata?.languages ?? [];

  if (languages.length === 0) {
    return "Unknown";
  }

  if (languages.length <= 3) {
    return languages.join(", ");
  }

  return `${languages.slice(0, 3).join(", ")} +${languages.length - 3} more`;
}

function getReviewScoreLabel() {
  return "N/A";
}

export default function PackageCard({
  game,
  storeMetadata,
  installStatus = "not-installed",
  recheckingSources = false,
  onInstallComplete,
  onRecheckSources,
}: PackageCardProps) {
  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

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
  const SelectedStatusIcon = selectedStatus.icon;

  const selectedFileIcon = selectedSource
    ? getFileIcon(selectedSource.fileType)
    : FileArchive;

  const SelectedFileIcon = selectedFileIcon;
  const installBadge = getInstallBadge(installStatus);

  const displayTitle = getStoreTitle(game, storeMetadata);
  const displayDeveloper = getStoreDeveloper(game, storeMetadata);
  const displayImageUrl = getBestStoreImage(game, storeMetadata);
  const displayPlatforms = getStorePlatforms(game, storeMetadata);
  const dlcLabel = getDlcLabel(storeMetadata);
  const languagesLabel = getLanguagesLabel(storeMetadata);

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

  async function handleOpenSteamDb() {
    try {
      await openExternalUrl(getSteamDbUrl(Number(game.appId)));
    } catch (error) {
      console.error(error);

      showError("No se pudo abrir SteamDB.", {
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
      gameTitle: displayTitle,
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
      <article className="group lf-surface overflow-hidden rounded-2xl border transition hover:border-(--color-accent)/35">
        <div className="relative h-36 overflow-hidden bg-white/5">
          {displayImageUrl && !imageFailed ? (
            <img
              src={displayImageUrl}
              alt={displayTitle}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5">
              <Gamepad2 className="h-9 w-9 text-(--color-muted)" />
            </div>
          )}

          <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/35 to-transparent" />

          {installBadge &&
            (() => {
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
            <h3 className="line-clamp-1 font-bold text-white">
              {displayTitle}
            </h3>

            <p className="mt-0.5 text-xs text-white/70">
              App ID: {game.appId}
            </p>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="line-clamp-1 text-sm text-(--color-muted)">
                {displayDeveloper}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {displayPlatforms.map((platform) => (
                  <span
                    key={platform}
                    className="rounded-md border border-(--surface-active-border) bg-white/5 px-2 py-0.5 text-[11px] text-(--color-muted)"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            </div>

            <span className="shrink-0 rounded-full border border-(--surface-active-border) bg-white/5 px-2.5 py-1 text-[11px] text-(--color-muted)">
              {availableSources.length} source
              {availableSources.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <StoreInfoBlock
              icon={Puzzle}
              label="DLC Content"
              value={dlcLabel}
            />

            <StoreInfoBlock
              icon={Star}
              label="Review Score"
              value={getReviewScoreLabel()}
            />

            <StoreInfoBlock
              icon={Clock3}
              label="Last Checked"
              value={formatCheckedAt(selectedSource)}
            />

            <StoreInfoBlock
              icon={Languages}
              label="Languages"
              value={languagesLabel}
            />
          </div>

          <div className="rounded-2xl border border-(--surface-active-border) bg-white/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
                Lua Provider
              </p>

              {recheckingSources && (
                <span className="text-[11px] text-(--color-accent)">
                  Rechecking...
                </span>
              )}
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SelectedStatusIcon
                    className={`h-3.5 w-3.5 ${selectedStatus.className}`}
                  />

                  <span className="truncate text-sm font-semibold text-(--color-text)">
                    {selectedSource?.providerName || "No source"}
                  </span>

                  {selectedSource && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-black/20 px-2 py-0.5 text-[11px] text-(--color-muted)">
                      <SelectedFileIcon className="h-3 w-3" />
                      .{selectedSource.fileType}
                    </span>
                  )}
                </div>

                <p className={`mt-1 text-xs ${selectedStatus.className}`}>
                  {selectedStatus.label}
                </p>

                <p className="mt-1 line-clamp-1 text-[11px] text-(--color-muted)">
                  {selectedStatus.description}
                </p>
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setSourceMenuOpen((value) => !value)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-black/20 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
                >
                  Source
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>

                {sourceMenuOpen && (
                  <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-(--surface-active-border) bg-black/95 p-2 shadow-2xl backdrop-blur-xl">
                    <div className="mb-2 px-2 py-1 text-[11px] uppercase tracking-wide text-white/40">
                      Select provider
                    </div>

                    <div className="space-y-1">
                      {game.sources.map((source) => {
                        const sourceKey = getSourceKey(source);
                        const isSelected = sourceKey === selectedSourceKey;
                        const sourceStatus = getFriendlySourceStatus(source);
                        const SourceStatusIcon = sourceStatus.icon;
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
                                  <SourceStatusIcon
                                    className={`h-3.5 w-3.5 ${sourceStatus.className}`}
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

          <div className="grid grid-cols-[1fr_1.4fr] gap-2">
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
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Check & Download
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleOpenSteamPage}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Steam
            </button>

            <button
              type="button"
              onClick={handleOpenSteamDb}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              <Server className="h-3.5 w-3.5" />
              SteamDB
            </button>
          </div>
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

type StoreInfoBlockProps = {
  icon: ElementType;
  label: string;
  value: string;
};

function StoreInfoBlock({
  icon: Icon,
  label,
  value,
}: StoreInfoBlockProps) {
  return (
    <div className="rounded-xl border border-(--surface-active-border) bg-black/20 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-(--color-muted)">
        <Icon className="h-3 w-3 text-(--color-accent)" />
        {label}
      </div>

      <p className="line-clamp-1 text-xs font-semibold text-(--color-text)">
        {value}
      </p>
    </div>
  );
}