import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Languages, Puzzle, Star } from "lucide-react";

import type { PackageGame, PackageSource } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import type { SteamReviewSummary } from "../../types/gameReview";
import type { SourceCheckStatus } from "../../services/sourceAvailabilityCacheService";
import { openExternalUrl } from "../../services/externalLinks";
import {
  getSteamDbUrl,
  getSteamStoreUrl,
} from "../../utils/steamLinks";
import { getBestAvailableSource } from "../../utils/sourceHelpers";
import { resolveGameMetadata } from "../../services/gameMetadataResolver";
import { saveStoreMetadataToStoreCache } from "../../services/storeLocalCacheService";
import { enqueueMediaDownload } from "../../services/mediaDownloadQueue";

import { showError } from "../toast/GameToast";

import StoreGameMediaGallery from "./details/StoreGameMediaGallery";
import StoreGameOverviewSection from "./details/StoreGameOverviewSection";
import StoreGameDlcSection from "./details/StoreGameDlcSection";
import StoreGameTechnicalSection from "./details/StoreGameTechnicalSection";
import StoreGameSummaryPanel from "./details/StoreGameSummaryPanel";
import StoreSourceSelectorModal from "./StoreSourceSelectorModal";
import { InfoBlock } from "./details/StoreGameDetailPrimitives";

import StoreMoreLikeThisSection from "./StoreMoreLikeThisSection";
import type { StoreMoreLikeThisGame } from "./StoreMoreLikeThisSection";

import { SkeletonBox, SkeletonHero } from "../common/Skeleton";

type StoreGameDetailsPageProps = {
  game: PackageGame;
  metadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  installStatus?: PackageInstallStatus;
  moreLikeThisGames?: StoreMoreLikeThisGame[];
  selectedSource?: PackageSource | null;
  sourceStatus?: SourceCheckStatus;
  onBack: () => void;
  onDownloadSource?: (source: PackageSource) => void;
  onOpenGame?: (game: PackageGame) => void;
  onSelectSourceKey?: (sourceKey: string) => void;
  onRefreshSources?: () => void;
};

function getBestImage(
  game: PackageGame,
  metadata?: SteamAppMetadata
) {
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
  selectedSource,
  sourceStatus = "idle",
  onBack,
  onDownloadSource,
  onOpenGame,
  onSelectSourceKey,
  onRefreshSources,
}: StoreGameDetailsPageProps) {
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
  const [dlcMetadata, setDlcMetadata] = useState<SteamAppMetadata[]>([]);

  const metadataLoading = !metadata?.resolved;

  const title = getTitle(game, metadata);
  const developer = getDeveloper(game, metadata);
  const imageUrl = getBestImage(game, metadata);
  const galleryImages = useMemo(
    () =>
      [
        metadata?.header_image,
        metadata?.capsule_image,
        metadata?.capsule_image_v5,
        ...(metadata?.screenshots ?? []),
        game.imageUrl,
      ].filter((img): img is string => !!img),
    [
      metadata?.header_image,
      metadata?.capsule_image,
      metadata?.capsule_image_v5,
      metadata?.screenshots,
      game.imageUrl,
    ],
  );
  const platforms = getPlatforms(game, metadata);
  const languagesLabel = getLanguagesLabel(metadata);
  const dlcLabel = getDlcLabel(metadata);
  const dlcCount = metadata?.dlc_count ?? 0;
  const dlcAppIds = useMemo(
    () => metadata?.dlc_app_ids ?? [],
    [metadata?.dlc_app_ids],
  );
  const reviewLabel = getReviewLabel(reviewSummary);
  const reviewSubLabel = getReviewSubLabel(reviewSummary);

  // Save main game metadata to store cache when resolved — stable deps only
  const prevAppIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (metadata?.resolved && metadata.app_id !== prevAppIdRef.current) {
      prevAppIdRef.current = metadata.app_id;
      saveStoreMetadataToStoreCache(metadata);

      // Populate canonical game cache for the opened game from store metadata.
      // Enqueue landscape from header_image and optionally background from background/background_raw.
      // Do NOT overwrite SGDB artwork — only fill gaps for the currently opened game.
      const appId = String(metadata.app_id);
      if (metadata.header_image) {
        enqueueMediaDownload({
          id: `store-header-${appId}-landscape`,
          appId,
          provider: "steam",
          mediaType: "landscape",
          url: metadata.header_image,
          target: "canonical",
          priority: "low",
        }).catch(() => {});
      }
      if (metadata.background_image || (metadata as any).background_raw) {
        const bgUrl = metadata.background_image || (metadata as any).background_raw;
        if (bgUrl) {
          enqueueMediaDownload({
            id: `store-bg-${appId}-background`,
            appId,
            provider: "steam",
            mediaType: "background",
            url: bgUrl,
            target: "canonical",
            priority: "low",
          }).catch(() => {});
        }
      }
    }
  }, [metadata?.resolved, metadata?.app_id]);

  const dlcRequestRef = useRef(0);
  useEffect(() => {
    if (!dlcAppIds || dlcAppIds.length === 0) {
      setDlcMetadata([]);
      return;
    }

    const requestId = ++dlcRequestRef.current;

    async function load() {
      try {
        const resolved = await resolveGameMetadata(dlcAppIds);
        if (requestId !== dlcRequestRef.current) return;
        const items = dlcAppIds
          .map((id) => resolved[id])
          .filter((item): item is SteamAppMetadata => !!item);

        setDlcMetadata(items);
        for (const dlc of items) {
          if (dlc.resolved) {
            saveStoreMetadataToStoreCache(dlc);
          }
        }
      } catch {
        if (requestId === dlcRequestRef.current) {
          setDlcMetadata([]);
        }
      }
    }

    load();
  }, [dlcAppIds]);

  const availableSources = game.sources.filter((source) => source.available);
  const bestSource = selectedSource ?? getBestAvailableSource(game);

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
    const source = selectedSource?.available ? selectedSource : bestSource;
    if (source) {
      onDownloadSource?.(source);
    }
  }

  function handleDownloadFromSource(source: PackageSource) {
    onDownloadSource?.(source);
  }

  if (metadataLoading) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver al Store
        </button>
        <SkeletonHero />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <SkeletonBox className="h-20 rounded-xl" />
              <SkeletonBox className="h-20 rounded-xl" />
              <SkeletonBox className="h-20 rounded-xl" />
            </div>
            <SkeletonBox className="h-32 w-full rounded-xl" />
          </div>
          <aside className="space-y-4">
            <SkeletonBox className="h-64 w-full rounded-xl" />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
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

            <StoreGameOverviewSection title={title} metadata={metadata} />
          </section>

          <aside className="space-y-4">
            <StoreGameSummaryPanel
              game={game}
              installStatus={installStatus}
              developer={developer}
              platforms={platforms}
              availableSources={availableSources.length}
              totalSources={game.sources.length}
              selectedSource={selectedSource ?? bestSource}
              sourceStatus={sourceStatus}
              onDownload={handleDownload}
              onChangeSource={() => setSourceSelectorOpen(true)}
              onOpenSteam={handleOpenSteam}
              onOpenSteamDb={handleOpenSteamDb}
              onRefreshSources={onRefreshSources}
            />
          </aside>
        </div>
      </section>

      <StoreGameDlcSection dlcCount={dlcCount} dlcMetadata={dlcMetadata} />

      {moreLikeThisGames.length > 0 && (
        <StoreMoreLikeThisSection
          games={moreLikeThisGames}
          onOpenGame={onOpenGame}
        />
      )}

      <StoreGameTechnicalSection metadata={metadata} />

      <StoreSourceSelectorModal
        open={sourceSelectorOpen}
        game={game}
        selectedSource={selectedSource ?? bestSource}
        onClose={() => setSourceSelectorOpen(false)}
        onSelectSource={onSelectSourceKey}
        onDownloadSource={handleDownloadFromSource}
        onOpenDetails={onOpenGame}
      />
    </div>
  );
}
