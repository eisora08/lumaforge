import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileText,
  Gamepad2,
  Languages,
  Puzzle,
  Server,
  Star,
} from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";

import { openExternalUrl } from "../../services/externalLinks";
import {
  getSteamDbUrl,
  getSteamStoreUrl,
} from "../../utils/steamLinks";

import { showError } from "../toast/GameToast";

type StoreGameDetailsPageProps = {
  game: PackageGame;
  metadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  installStatus?: PackageInstallStatus;
  onBack: () => void;
  onDownloadSource?: (source: PackageSource) => void;
};

function getBestImage(game: PackageGame, metadata?: SteamAppMetadata) {
  return (
    metadata?.header_image ||
    metadata?.capsule_image ||
    metadata?.capsule_image_v5 ||
    game.imageUrl
  );
}

function getTitle(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.name || game.title;
}

function getDeveloper(game: PackageGame, metadata?: SteamAppMetadata) {
  return metadata?.developer || game.developer || "Developer unknown";
}

function getPlatforms(game: PackageGame, metadata?: SteamAppMetadata) {
  if (metadata?.platforms?.length) {
    return metadata.platforms;
  }

  return game.platforms;
}

function getLanguagesLabel(metadata?: SteamAppMetadata) {
  const languages = metadata?.languages ?? [];

  if (languages.length === 0) {
    return "Unknown";
  }

  if (languages.length <= 6) {
    return languages.join(", ");
  }

  return `${languages.slice(0, 6).join(", ")} +${languages.length - 6} more`;
}

function getDlcLabel(metadata?: SteamAppMetadata) {
  const count = metadata?.dlc_count ?? 0;

  if (count <= 0) {
    return "Base Game Only";
  }

  if (count === 1) {
    return "1 DLC Available";
  }

  return `${count} DLCs Available`;
}

function getReviewLabel(summary?: SteamReviewSummary) {
  if (!summary || !summary.resolved || summary.total_reviews === 0) {
    return "No reviews";
  }

  if (typeof summary.positive_percent === "number") {
    return `${summary.review_score_desc} · ${summary.positive_percent}%`;
  }

  return summary.review_score_desc || "N/A";
}

function getReviewSubLabel(summary?: SteamReviewSummary) {
  if (!summary || !summary.resolved || summary.total_reviews === 0) {
    return "Steam review summary unavailable.";
  }

  return `${summary.total_reviews.toLocaleString()} reviews · ${summary.total_positive.toLocaleString()} positive`;
}

function getFileIcon(fileType: PackageSource["fileType"]) {
  if (fileType === "zip") return FileArchive;
  if (fileType === "lua") return FileCode2;
  return FileText;
}

function getSourceStatus(source: PackageSource) {
  if (source.available) {
    return {
      label: "Ready",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (source.requiresApiKey && !source.hasAuth) {
    return {
      label: "Needs setup",
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    };
  }

  return {
    label: "Unavailable",
    className: "border-red-500/20 bg-red-500/10 text-red-300",
  };
}

export default function StoreGameDetailsPage({
  game,
  metadata,
  reviewSummary,
  installStatus = "not-installed",
  onBack,
  onDownloadSource,
}: StoreGameDetailsPageProps) {
  const title = getTitle(game, metadata);
  const developer = getDeveloper(game, metadata);
  const imageUrl = getBestImage(game, metadata);
  const platforms = getPlatforms(game, metadata);
  const languagesLabel = getLanguagesLabel(metadata);
  const dlcLabel = getDlcLabel(metadata);
  const reviewLabel = getReviewLabel(reviewSummary);
  const reviewSubLabel = getReviewSubLabel(reviewSummary);

  const availableSources = game.sources.filter((source) => source.available);

  async function handleOpenSteam() {
    try {
      await openExternalUrl(getSteamStoreUrl(Number(game.appId)));
    } catch (error) {
      console.error(error);

      showError("No se pudo abrir Steam.", {
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

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al Store
      </button>

      <section className="overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5">
        <div className="relative h-90 overflow-hidden bg-white/5">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
            </div>
          )}

          <div className="absolute inset-0 bg-linear-to-t from-black via-black/45 to-transparent" />

          <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
            <div className="mb-3 flex flex-wrap gap-2">
              {installStatus === "active" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Installed
                </span>
              )}

              {availableSources.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                  <Server className="h-3.5 w-3.5" />
                  Lua Ready
                </span>
              )}

              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70">
                AppID {game.appId}
              </span>
            </div>

            <h1 className="max-w-4xl text-4xl font-black text-white">
              {title}
            </h1>

            <p className="mt-2 text-sm text-white/70">
              {developer}
            </p>

            {platforms.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {platforms.map((platform) => (
                  <span
                    key={platform}
                    className="rounded-md border border-white/10 bg-white/10 px-2.5 py-1 text-xs text-white/75"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[1fr_360px] lg:p-6">
          <section className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InfoBlock
                icon={Star}
                label="Review Score"
                value={reviewLabel}
                description={reviewSubLabel}
              />

              <InfoBlock
                icon={Puzzle}
                label="DLC Content"
                value={dlcLabel}
                description="Detected from Steam metadata."
              />

              <InfoBlock
                icon={Languages}
                label="Languages"
                value={languagesLabel}
                description="Supported languages from Steam metadata."
              />
            </div>

            <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
              <h2 className="text-lg font-bold text-(--color-text)">
                Provider Sources
              </h2>

              <p className="mt-1 text-sm text-(--color-muted)">
                Selecciona una fuente compatible para descargar Lua/manifests.
              </p>

              {game.sources.length === 0 ? (
                <div className="mt-4 rounded-xl border border-(--surface-active-border) bg-white/5 p-4 text-sm text-(--color-muted)">
                  No hay fuentes disponibles para este juego todavía.
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {game.sources.map((source) => {
                    const FileIcon = getFileIcon(source.fileType);
                    const status = getSourceStatus(source);

                    return (
                      <div
                        key={`${source.providerId}-${source.fileType}`}
                        className="flex flex-col gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <FileIcon className="h-4 w-4 text-(--color-accent)" />

                            <p className="font-semibold text-(--color-text)">
                              {source.providerName}
                            </p>

                            <span className="rounded-md bg-black/30 px-2 py-0.5 text-[11px] text-(--color-muted)">
                              .{source.fileType}
                            </span>
                          </div>

                          <p className="mt-1 line-clamp-1 text-xs text-(--color-muted)">
                            {source.providerMessage ||
                              source.error ||
                              "Provider source detected."}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] ${status.className}`}
                          >
                            {status.label}
                          </span>

                          <button
                            type="button"
                            disabled={!source.available || !onDownloadSource}
                            onClick={() => onDownloadSource?.(source)}
                            className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
              <h2 className="font-bold text-(--color-text)">
                Actions
              </h2>

              <div className="mt-4 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={handleOpenSteam}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Steam Page
                </button>

                <button
                  type="button"
                  onClick={handleOpenSteamDb}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
                >
                  <Database className="h-4 w-4" />
                  Open SteamDB
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
              <h2 className="font-bold text-(--color-text)">
                Summary
              </h2>

              <div className="mt-4 space-y-3 text-sm">
                <SummaryLine label="AppID" value={game.appId} />
                <SummaryLine
                  label="Install Status"
                  value={installStatus}
                />
                <SummaryLine
                  label="Sources"
                  value={`${availableSources.length}/${game.sources.length} available`}
                />
                <SummaryLine label="Developer" value={developer} />
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

type InfoBlockProps = {
  icon: typeof Star;
  label: string;
  value: string;
  description: string;
};

function InfoBlock({
  icon: Icon,
  label,
  value,
  description,
}: InfoBlockProps) {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-(--color-muted)">
        <Icon className="h-4 w-4 text-(--color-accent)" />
        {label}
      </div>

      <p className="text-sm font-bold text-(--color-text)">
        {value}
      </p>

      <p className="mt-1 text-xs text-(--color-muted)">
        {description}
      </p>
    </div>
  );
}

type SummaryLineProps = {
  label: string;
  value: string;
};

function SummaryLine({ label, value }: SummaryLineProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2">
      <span className="text-xs text-(--color-muted)">
        {label}
      </span>

      <span className="truncate text-xs font-semibold text-(--color-text)">
        {value}
      </span>
    </div>
  );
}