import { useMemo, useState } from "react";

import {
  Download,
  ExternalLink,
  Gamepad2,
  SearchCheck,
} from "lucide-react";

import {
  showError,
  showSuccess,
  showWarning,
} from "../toast/GameToast";

import { PackageGame, PackageSource } from "../../types/package";
import PackageSourceBadge from "./PackageSourceBadge";
import PackageSourceSelector from "./PackageSourceSelector";
import { useDownloadQueue } from "../../hooks/useDownloadQueue";

import { useSettings } from "../../context/SettingsContext";
import { downloadAndInstallPackage } from "../../services/tauri";

type PackageCardProps = {
  game: PackageGame;
};

function getSourceKey(source: PackageSource) {
  return `${source.providerId}-${source.fileType}`;
}

export default function PackageCard({ game }: PackageCardProps) {
  const availableSources = game.sources.filter((source) => source.available);

  const defaultSourceKey = availableSources[0]
    ? getSourceKey(availableSources[0])
    : "";

  const [selectedSourceKey, setSelectedSourceKey] =
    useState(defaultSourceKey);
  const { settings } = useSettings();
  const selectedSource = useMemo(() => {
    return game.sources.find(
      (source) => getSourceKey(source) === selectedSourceKey
    );
  }, [game.sources, selectedSourceKey]);

  const { addJob, updateJob } = useDownloadQueue();

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
      updateJob(job.id, {
        status: "checking",
        progress: 5,
      });

      updateJob(job.id, {
        status: "downloading",
        progress: 20,
      });

      const result = await downloadAndInstallPackage({
        downloadUrl: selectedSource.downloadUrl,
        luaTarget: settings.luaPath,
        depotcacheTarget: settings.depotcachePath,
        createBackups: settings.createBackups,
      });

      updateJob(job.id, {
        status: "done",
        progress: 100,
        bytesRead: 0,
        totalBytes: 0,
      });

      showSuccess(result.message, {
        title: "Paquete instalado",
      });
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

        <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />

        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="line-clamp-1 font-semibold text-white">
            {game.title}
          </h3>

          <p className="mt-0.5 text-xs text-gray-300">
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

          <span className="shrink-0 rounded-full bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            {availableSources.length} source
            {availableSources.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {game.sources.map((source) => (
            <PackageSourceBadge
              key={`${game.appId}-${source.providerId}-${source.fileType}`}
              source={source}
            />
          ))}
        </div>

        <PackageSourceSelector
          sources={game.sources}
          selectedSourceKey={selectedSourceKey}
          onSelect={setSelectedSourceKey}
        />

        <div className="grid grid-cols-2 gap-2">
          <button className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10">
            <SearchCheck className="h-3.5 w-3.5" />
            Details
          </button>

          <button
            disabled={!selectedSource || !selectedSource.available}
            onClick={handleDownload}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-medium text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>

        <button className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)">
          <ExternalLink className="h-3.5 w-3.5" />
          Open Steam page
        </button>
      </div>
    </article>
  );
}