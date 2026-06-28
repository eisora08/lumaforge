import { useMemo, useState } from "react";

import {
  Download,
  Gamepad2,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
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
  onInstallComplete?: () => void;
  variant?: "landscape" | "poster";
  onOpenGame?: (game: PackageGame) => void;
  onDownload?: (game: PackageGame) => void;
  onOpenDetails?: (game: PackageGame) => void;
  onOpenSourceSelector?: (game: PackageGame) => void;
  onDownloadSource?: (game: PackageGame, source: PackageSource) => void;
};

function getBestCardImage(
  game: PackageGame,
  metadata?: SteamAppMetadata,
  variant?: "landscape" | "poster",
): string | undefined {
  if (variant === "poster") {
    return (
      metadata?.capsule_image_v5 ||
      metadata?.capsule_image ||
      game.imageUrl ||
      metadata?.header_image ||
      undefined
    );
  }

  return (
    metadata?.header_image ||
    game.imageUrl ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    undefined
  );
}

function getStoreTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getStoreDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

function CardImage({
  src,
  alt,
  objectClass,
  onError,
}: {
  src: string;
  alt: string;
  objectClass: string;
  onError: () => void;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={`h-full w-full transition duration-500 ${objectClass}`}
      loading="lazy"
      onError={onError}
    />
  );
}

export default function PackageCard({
  game,
  storeMetadata,
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

  const displayTitle = getStoreTitle(game, storeMetadata);
  const displayDeveloper = getStoreDeveloper(game, storeMetadata);
  const displayImageUrl = getBestCardImage(game, storeMetadata, variant);

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
        className="w-32 cursor-pointer rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15"
      >
        Details
      </button>

      {hasLuaReady && (
        <button
          type="button"
          onClick={handleDownloadAction}
          className="flex w-32 cursor-pointer items-center justify-center gap-1 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90"
        >
          <Download className="h-3 w-3" />
          Download
        </button>
      )}

      <button
        type="button"
        onClick={handleSourceButton}
        className="w-32 cursor-pointer rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-medium text-white/75 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed"
        disabled={game.sources.length === 0}
      >
        Source
      </button>
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
          className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition hover:border-(--color-accent)/40"
        >
          <div className="relative w-full shrink-0 overflow-hidden">
            {displayImageUrl && !imageFailed ? (
              <CardImage
                src={displayImageUrl}
                alt={displayTitle}
                objectClass="object-cover group-hover:scale-105"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5">
                <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
              </div>
            )}

            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/75 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
              {actionButtons}
            </div>
          </div>

          <div className="flex min-h-[60px] flex-col justify-center p-2.5">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-(--color-text)">
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
          <CardImage
            src={displayImageUrl}
            alt={displayTitle}
            objectClass="object-cover group-hover:scale-105"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 z-10 p-4">
          <h3 className="line-clamp-1 text-lg font-black text-white drop-shadow">
            {displayTitle}
          </h3>
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
