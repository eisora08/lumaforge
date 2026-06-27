import type { ElementType } from "react";

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
  Monitor,
  Puzzle,
  Server,
  ShieldAlert,
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

function getLanguages(metadata?: SteamAppMetadata) {
  return metadata?.languages ?? [];
}

function getLanguagesLabel(metadata?: SteamAppMetadata) {
  const languages = getLanguages(metadata);

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

function getInstallLabel(status: PackageInstallStatus) {
  if (status === "active") {
    return "Installed";
  }

  if (status === "disabled") {
    return "Disabled";
  }

  return "Not installed";
}

function getGalleryImages(game: PackageGame, metadata?: SteamAppMetadata) {
  const images = [
    metadata?.header_image,
    metadata?.capsule_image,
    metadata?.capsule_image_v5,
    game.imageUrl,
  ].filter(Boolean) as string[];

  return Array.from(new Set(images));
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
  const galleryImages = getGalleryImages(game, metadata);
  const platforms = getPlatforms(game, metadata);
  const languages = getLanguages(metadata);
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

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              {installStatus === "active" && (
                <StatusPill
                  icon={CheckCircle2}
                  label="Installed"
                  className="border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                />
              )}

              {availableSources.length > 0 && (
                <StatusPill
                  icon={Server}
                  label="Lua Ready"
                  className="border-(--color-accent)/20 bg-(--color-accent)/10 text-(--color-accent)"
                />
              )}

              <span className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-xs text-(--color-muted)">
                AppID {game.appId}
              </span>
            </div>

            <h1 className="text-3xl font-black text-(--color-text) lg:text-4xl">
              {title}
            </h1>

            <p className="mt-2 text-sm text-(--color-muted)">
              {developer}
            </p>
          </div>

          <StoreGameMediaGallery
            title={title}
            imageUrl={imageUrl}
            galleryImages={galleryImages}
          />

          <StoreProviderPanel
            sources={game.sources}
            onDownloadSource={onDownloadSource}
          />

          <StoreContentSection
            dlcLabel={dlcLabel}
            dlcCount={metadata?.dlc_count ?? 0}
          />

          <StoreMoreLikeThisSection />

          <StoreTechnicalSection />
        </div>

        <aside className="space-y-4">
          <StoreSummaryPanel
            game={game}
            title={title}
            developer={developer}
            imageUrl={imageUrl}
            platforms={platforms}
            reviewLabel={reviewLabel}
            reviewSubLabel={reviewSubLabel}
            dlcLabel={dlcLabel}
            languagesLabel={languagesLabel}
            installStatus={installStatus}
            availableSources={availableSources.length}
            totalSources={game.sources.length}
            onOpenSteam={handleOpenSteam}
            onOpenSteamDb={handleOpenSteamDb}
          />

          {languages.length > 0 && (
            <StoreLanguagesPanel languages={languages} />
          )}
        </aside>
      </section>
    </div>
  );
}

type StoreGameMediaGalleryProps = {
  title: string;
  imageUrl?: string;
  galleryImages: string[];
};

function StoreGameMediaGallery({
  title,
  imageUrl,
  galleryImages,
}: StoreGameMediaGalleryProps) {
  return (
    <section className="overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover"
          />
        ) : (
          <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/35 via-transparent to-transparent" />

        <div className="absolute left-4 top-4 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs text-white/70 backdrop-blur-md">
          Media Preview
        </div>
      </div>

      {galleryImages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-(--surface-active-border) bg-black/30 p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {galleryImages.slice(0, 8).map((image) => (
            <div
              key={image}
              className="h-16 w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5"
            >
              <img
                src={image}
                alt={title}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type StoreSummaryPanelProps = {
  game: PackageGame;
  title: string;
  developer: string;
  imageUrl?: string;
  platforms: string[];
  reviewLabel: string;
  reviewSubLabel: string;
  dlcLabel: string;
  languagesLabel: string;
  installStatus: PackageInstallStatus;
  availableSources: number;
  totalSources: number;
  onOpenSteam: () => void;
  onOpenSteamDb: () => void;
};

function StoreSummaryPanel({
  game,
  title,
  developer,
  imageUrl,
  platforms,
  reviewLabel,
  reviewSubLabel,
  dlcLabel,
  languagesLabel,
  installStatus,
  availableSources,
  totalSources,
  onOpenSteam,
  onOpenSteamDb,
}: StoreSummaryPanelProps) {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <div className="overflow-hidden rounded-2xl bg-black/30">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-40 w-full object-cover"
          />
        ) : (
          <div className="flex h-40 items-center justify-center">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}
      </div>

      <p className="mt-4 text-sm text-(--color-muted)">
        Store metadata, provider sources and installation actions for this game.
      </p>

      <div className="mt-4 space-y-3">
        <SideInfo
          icon={Star}
          label="Review Score"
          value={reviewLabel}
          description={reviewSubLabel}
        />

        <SideInfo
          icon={Puzzle}
          label="DLC Content"
          value={dlcLabel}
          description="Detected from Steam metadata."
        />

        <SideInfo
          icon={Languages}
          label="Languages"
          value={languagesLabel}
          description="Supported languages from Steam metadata."
        />

        <SideInfo
          icon={Monitor}
          label="Platforms"
          value={platforms.length > 0 ? platforms.join(", ") : "Unknown"}
          description="Available platform metadata."
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2">
        <button
          type="button"
          onClick={onOpenSteam}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
        >
          <ExternalLink className="h-4 w-4" />
          Open Steam Page
        </button>

        <button
          type="button"
          onClick={onOpenSteamDb}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-3 text-sm text-(--color-text) transition hover:bg-white/10"
        >
          <Database className="h-4 w-4" />
          Open SteamDB
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <SummaryLine label="AppID" value={game.appId} />
        <SummaryLine label="Developer" value={developer} />
        <SummaryLine label="Install Status" value={getInstallLabel(installStatus)} />
        <SummaryLine
          label="Sources"
          value={`${availableSources}/${totalSources} available`}
        />
      </div>
    </section>
  );
}

type StoreProviderPanelProps = {
  sources: PackageSource[];
  onDownloadSource?: (source: PackageSource) => void;
};

function StoreProviderPanel({
  sources,
  onDownloadSource,
}: StoreProviderPanelProps) {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-(--color-text)">
            Lua / Manifest Sources
          </h2>

          <p className="mt-1 text-sm text-(--color-muted)">
            Select a compatible provider source to download Lua/manifests.
          </p>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-black/20 p-5 text-sm text-(--color-muted)">
          No provider source is available for this game yet.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {sources.map((source) => {
            const FileIcon = getFileIcon(source.fileType);
            const status = getSourceStatus(source);

            return (
              <div
                key={`${source.providerId}-${source.fileType}`}
                className="flex flex-col gap-3 rounded-2xl border border-(--surface-active-border) bg-black/20 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileIcon className="h-4 w-4 text-(--color-accent)" />

                    <p className="font-semibold text-(--color-text)">
                      {source.providerName}
                    </p>

                    <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-(--color-muted)">
                      .{source.fileType}
                    </span>

                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-1 text-xs text-(--color-muted)">
                    {source.providerMessage ||
                      source.error ||
                      "Provider source detected."}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!source.available || !onDownloadSource}
                  onClick={() => onDownloadSource?.(source)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-3 py-2 text-xs font-bold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type StoreContentSectionProps = {
  dlcLabel: string;
  dlcCount: number;
};

function StoreContentSection({
  dlcLabel,
  dlcCount,
}: StoreContentSectionProps) {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-(--color-text)">
            Content For This Game
          </h2>

          <p className="mt-1 text-sm text-(--color-muted)">
            DLC and extra content detected from Steam metadata.
          </p>
        </div>

        <span className="rounded-full border border-(--surface-active-border) bg-black/20 px-3 py-1 text-xs text-(--color-muted)">
          {dlcLabel}
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
        {dlcCount > 0 ? (
          <p className="text-sm text-(--color-text)">
            {dlcCount} DLC item{dlcCount === 1 ? "" : "s"} detected. Detailed DLC cards will be added in a future update.
          </p>
        ) : (
          <p className="text-sm text-(--color-muted)">
            This game currently appears as base game only in the metadata available to LumaForge.
          </p>
        )}
      </div>
    </section>
  );
}

function StoreMoreLikeThisSection() {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <h2 className="text-xl font-bold text-(--color-text)">
        More Like This
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        Recommendations based on Steam tags, provider availability and local library data will appear here.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="aspect-video rounded-2xl border border-(--surface-active-border) bg-black/25"
          />
        ))}
      </div>
    </section>
  );
}

function StoreTechnicalSection() {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <h2 className="text-xl font-bold text-(--color-text)">
        System Requirements
      </h2>

      <p className="mt-1 text-sm text-(--color-muted)">
        Minimum and recommended requirements will be shown here once LumaForge connects extended Steam app details.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <RequirementBox title="Minimum" />
        <RequirementBox title="Recommended" />
      </div>
    </section>
  );
}

function RequirementBox({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-4">
      <h3 className="font-semibold text-(--color-text)">
        {title}
      </h3>

      <p className="mt-2 text-sm text-(--color-muted)">
        Requirements metadata pending.
      </p>
    </div>
  );
}

function StoreLanguagesPanel({ languages }: { languages: string[] }) {
  return (
    <section className="rounded-3xl border border-(--surface-active-border) bg-white/5 p-4">
      <h2 className="font-bold text-(--color-text)">
        Languages
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {languages.map((language) => (
          <span
            key={language}
            className="rounded-full border border-(--surface-active-border) bg-black/20 px-3 py-1 text-xs text-(--color-muted)"
          >
            {language}
          </span>
        ))}
      </div>
    </section>
  );
}

type StatusPillProps = {
  icon: ElementType;
  label: string;
  className: string;
};

function StatusPill({
  icon: Icon,
  label,
  className,
}: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

type SideInfoProps = {
  icon: ElementType;
  label: string;
  value: string;
  description: string;
};

function SideInfo({
  icon: Icon,
  label,
  value,
  description,
}: SideInfoProps) {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-black/20 p-3">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-(--color-muted)">
        <Icon className="h-3.5 w-3.5 text-(--color-accent)" />
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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-(--surface-active-border) bg-black/20 px-3 py-2">
      <span className="text-xs text-(--color-muted)">
        {label}
      </span>

      <span className="truncate text-xs font-semibold text-(--color-text)">
        {value}
      </span>
    </div>
  );
}