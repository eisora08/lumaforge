import { useState } from "react";
import { ArrowLeft, Languages, Puzzle, Star } from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";

import { openExternalUrl } from "../../services/externalLinks";
import {
  getSteamDbUrl,
  getSteamStoreUrl,
} from "../../utils/steamLinks";
import { getBestAvailableSource } from "../../utils/sourceHelpers";

import { showError } from "../toast/GameToast";

import StoreGameMediaGallery from "./details/StoreGameMediaGallery";
import StoreGameContentSection from "./details/StoreGameContentSection";
import StoreGameTechnicalSection from "./details/StoreGameTechnicalSection";
import StoreGameLanguagesPanel from "./details/StoreGameLanguagesPanel";
import StoreGameSummaryPanel from "./details/StoreGameSummaryPanel";
import StoreSourceSelectorModal from "./StoreSourceSelectorModal";
import { InfoBlock } from "./details/StoreGameDetailPrimitives";

import StoreMoreLikeThisSection from "./StoreMoreLikeThisSection";
import type { StoreMoreLikeThisGame } from "./StoreMoreLikeThisSection";

type StoreGameDetailsPageProps = {
  game: PackageGame;
  metadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  installStatus?: PackageInstallStatus;
  moreLikeThisGames?: StoreMoreLikeThisGame[];
  onBack: () => void;
  onDownloadSource?: (source: PackageSource) => void;
  onOpenGame?: (game: PackageGame) => void;
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

export default function StoreGameDetailsPage({
  game,
  metadata,
  reviewSummary,
  installStatus = "not-installed",
  moreLikeThisGames = [],
  onBack,
  onDownloadSource,
  onOpenGame,
}: StoreGameDetailsPageProps) {
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);

  const title = getTitle(game, metadata);
  const developer = getDeveloper(game, metadata);
  const imageUrl = getBestImage(game, metadata);
  const galleryImages = [
    metadata?.header_image,
    metadata?.capsule_image,
    metadata?.capsule_image_v5,
    game.imageUrl,
  ].filter((img): img is string => !!img);
  const platforms = getPlatforms(game, metadata);
  const languages = metadata?.languages ?? [];
  const languagesLabel = getLanguagesLabel(metadata);
  const dlcLabel = getDlcLabel(metadata);
  const dlcCount = metadata?.dlc_count ?? 0;
  const reviewLabel = getReviewLabel(reviewSummary);
  const reviewSubLabel = getReviewSubLabel(reviewSummary);

  const availableSources = game.sources.filter((source) => source.available);
  const bestSource = getBestAvailableSource(game);

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

  function handleDownload() {
    if (bestSource) {
      onDownloadSource?.(bestSource);
    }
  }

  function handleDownloadFromSource(source: PackageSource) {
    onDownloadSource?.(source);
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
        <StoreGameMediaGallery
          title={title}
          imageUrl={imageUrl}
          galleryImages={galleryImages}
          installStatus={installStatus}
          availableSourcesCount={availableSources.length}
          appId={game.appId}
          developer={developer}
          platforms={platforms}
        />

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
          </section>

          <aside className="space-y-4">
            <StoreGameSummaryPanel
              game={game}
              installStatus={installStatus}
              developer={developer}
              platforms={platforms}
              availableSources={availableSources.length}
              totalSources={game.sources.length}
              onDownload={handleDownload}
              onChangeSource={() => setSourceSelectorOpen(true)}
              onOpenSteam={handleOpenSteam}
              onOpenSteamDb={handleOpenSteamDb}
            />
          </aside>
        </div>
      </section>

      <StoreGameContentSection dlcLabel={dlcLabel} dlcCount={dlcCount} />

      <StoreGameTechnicalSection />

      {languages.length > 0 && (
        <StoreGameLanguagesPanel languages={languages} />
      )}

      {moreLikeThisGames.length > 0 && (
        <StoreMoreLikeThisSection
          games={moreLikeThisGames}
          onOpenGame={onOpenGame}
        />
      )}

      <StoreSourceSelectorModal
        open={sourceSelectorOpen}
        game={game}
        selectedSource={bestSource}
        onClose={() => setSourceSelectorOpen(false)}
        onDownloadSource={handleDownloadFromSource}
        onOpenDetails={onOpenGame}
      />
    </div>
  );
}
