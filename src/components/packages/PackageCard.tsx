import { useMemo, useState } from "react";

import {
  CheckCircle2,
  Download,
  Gamepad2,
  PauseCircle,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";

import { useSettings } from "../../context/SettingsContext";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";
import { downloadAndInstallPackage } from "../../services/tauri";
import { getBestAvailableSource } from "../../utils/sourceHelpers";

import {
  showError,
  showSuccess,
  showWarning,
} from "../toast/GameToast";

import StoreSourceSelectorModal from "../store/StoreSourceSelectorModal";

type PackageCardProps = {
  game: PackageGame;
  storeMetadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  installStatus?: PackageInstallStatus;
  onInstallComplete?: () => void;
  variant?: "landscape" | "poster";
  onOpenGame?: (game: PackageGame) => void;
  onDownload?: (game: PackageGame) => void;
  onOpenDetails?: (game: PackageGame) => void;
  onOpenSourceSelector?: (game: PackageGame) => void;
  onDownloadSource?: (game: PackageGame, source: PackageSource) => void;
};

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

function getBestStoreImage(game: PackageGame, metadata?: SteamAppMetadata) {
  return (
    metadata?.header_image ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    game.imageUrl
  );
}

function getBestPosterImage(game: PackageGame, metadata?: SteamAppMetadata) {
  return (
    metadata?.capsule_image_v5 ||
    metadata?.capsule_image ||
    metadata?.header_image ||
    game.imageUrl
  );
}

function getStoreTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getStoreDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

export default function PackageCard({
  game,
  storeMetadata,
  installStatus = "not-installed",
  onInstallComplete,
  variant = "landscape",
  onOpenGame,
  onDownload,
  onOpenDetails,
  onOpenSourceSelector,
  onDownloadSource,
}: PackageCardProps) {
  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();

  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const availableSources = game.sources.filter((source) => source.available);
  const bestSource = useMemo(() => getBestAvailableSource(game), [game]);
  const installBadge = getInstallBadge(installStatus);

  const displayTitle = getStoreTitle(game, storeMetadata);
  const displayDeveloper = getStoreDeveloper(game, storeMetadata);
  const displayImageUrl = variant === "poster"
    ? getBestPosterImage(game, storeMetadata)
    : getBestStoreImage(game, storeMetadata);

  const hasLuaReady = availableSources.length > 0;

  function handleOpenDetails(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onOpenDetails) {
      onOpenDetails(game);
    } else if (onOpenGame) {
      onOpenGame(game);
    }
  }

  function handleSourceButton(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onOpenSourceSelector) {
      onOpenSourceSelector(game);
    } else {
      setSourceSelectorOpen(true);
    }
  }

  function handleDownloadAction(event?: React.MouseEvent) {
    event?.stopPropagation();

    if (onDownload) {
      onDownload(game);
      return;
    }

    const source = bestSource;

    if (!source || !source.available) {
      showWarning("No hay fuentes disponibles para este juego.", {
        title: "Sin fuentes",
      });
      return;
    }

    internalDownload(source);
  }

  async function internalDownload(source: PackageSource) {
    if (!source.downloadUrl) {
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
      providerId: source.providerId,
      providerName: source.providerName,
      fileType: source.fileType,
      downloadUrl: source.downloadUrl,
    });

    try {
      const result = await downloadAndInstallPackage({
        jobId: job.id,
        downloadUrl: source.downloadUrl,
        luaTarget: settings.luaPath,
        depotcacheTarget: settings.depotcachePath,
        createBackups: settings.createBackups,
        headers: source.authHeaders,
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

  function handleSourceDownload(source: PackageSource) {
    if (onDownloadSource) {
      onDownloadSource(game, source);
    } else {
      internalDownload(source);
    }
  }

  const actionButtons = (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleOpenDetails}
        className="w-32 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15"
      >
        Details
      </button>

      {hasLuaReady && (
        <button
          type="button"
          onClick={handleDownloadAction}
          className="flex w-32 items-center justify-center gap-1 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90"
        >
          <Download className="h-3 w-3" />
          Download
        </button>
      )}

      <button
        type="button"
        onClick={handleSourceButton}
        className="w-32 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white/75 transition hover:bg-white/15 hover:text-white"
        disabled={game.sources.length === 0}
      >
        Source
      </button>
    </div>
  );

  const cardFaceBadges = (
    <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1.5">
      {installBadge &&
        (() => {
          const Icon = installBadge.icon;

          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-md ${installBadge.className}`}
            >
              <Icon className="h-2.5 w-2.5" />
              {installBadge.label}
            </span>
          );
        })()}

      {hasLuaReady && (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 backdrop-blur-md">
          <CheckCircle2 className="h-2.5 w-2.5" />
          Lua Ready
        </span>
      )}
    </div>
  );

  if (variant === "poster") {
    return (
      <>
        <article
          role="button"
          tabIndex={0}
          onClick={handleOpenDetails}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleOpenDetails();
            }
          }}
          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:border-(--color-accent)/40"
        >
          <div className="relative aspect-[4/5] overflow-hidden">
            {displayImageUrl && !imageFailed ? (
              <img
                src={displayImageUrl}
                alt={displayTitle}
                className="h-full w-full object-cover object-[center_20%] transition duration-500 group-hover:scale-105"
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5">
                <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
              </div>
            )}

            {cardFaceBadges}

            {game.sources.length > 0 && (
              <div className="absolute right-2 top-2 z-10">
                <span className="rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[10px] text-white/70 backdrop-blur-md">
                  {availableSources.length}/{game.sources.length}
                </span>
              </div>
            )}

            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
              {actionButtons}
            </div>
          </div>

          <div className="p-2.5">
            <h3 className="line-clamp-2 text-sm font-semibold text-(--color-text)">
              {displayTitle}
            </h3>

            {displayDeveloper && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-(--color-muted)">
                {displayDeveloper}
              </p>
            )}
          </div>
        </article>

        <StoreSourceSelectorModal
          open={sourceSelectorOpen}
          game={game}
          selectedSource={bestSource}
          onClose={() => setSourceSelectorOpen(false)}
          onDownloadSource={handleSourceDownload}
          onOpenDetails={onOpenDetails || onOpenGame}
        />
      </>
    );
  }

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={handleOpenDetails}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleOpenDetails();
          }
        }}
        className="group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:border-(--color-accent)/40"
      >
        {displayImageUrl && !imageFailed ? (
          <img
            src={displayImageUrl}
            alt={displayTitle}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />

        <div className="absolute left-3 right-3 top-3 z-10 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {installBadge &&
              (() => {
                const InstallIcon = installBadge.icon;

                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur-md ${installBadge.className}`}
                  >
                    <InstallIcon className="h-3 w-3" />
                    {installBadge.label}
                  </span>
                );
              })()}

            {hasLuaReady && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 backdrop-blur-md">
                <CheckCircle2 className="h-3 w-3" />
                Lua Ready
              </span>
            )}
          </div>

          <span className="rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur-md">
            {availableSources.length} source
            {availableSources.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 p-4">
          <h3 className="line-clamp-1 text-lg font-black text-white drop-shadow">
            {displayTitle}
          </h3>

          <p className="mt-1 line-clamp-1 text-xs text-white/70">
            App ID: {game.appId} · {displayDeveloper}
          </p>
        </div>

        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/82 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          {actionButtons}
        </div>
      </article>

      <StoreSourceSelectorModal
        open={sourceSelectorOpen}
        game={game}
        selectedSource={bestSource}
        onClose={() => setSourceSelectorOpen(false)}
        onDownloadSource={handleSourceDownload}
        onOpenDetails={onOpenDetails || onOpenGame}
      />
    </>
  );
}
