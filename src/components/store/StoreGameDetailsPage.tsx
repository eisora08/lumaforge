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
import { resolveProviderOverlaysForStoreGames } from "../../services/storeProviderOverlay";
import {
  getSourceAvailability,
  updateSourceAvailability,
  buildSourceAvailabilityFromProviders,
  loadSourceAvailabilityIndex,
} from "../../services/sourceAvailabilityCacheService";
import { useSettings } from "../../context/SettingsContext";

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

const ENABLE_VERBOSE_SOURCE_LOGS = false;

function sourceLog(...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log("[StoreDetailsSource]", ...args);
  }
}

export default function StoreGameDetailsPage({
  game,
  metadata,
  reviewSummary,
  installStatus = "not-installed",
  moreLikeThisGames = [],
  selectedSource: selectedSourceProp,
  sourceStatus: sourceStatusProp,
  onBack,
  onDownloadSource,
  onOpenGame,
  onSelectSourceKey,
  onRefreshSources: onRefreshSourcesProp,
}: StoreGameDetailsPageProps) {
  const { settings } = useSettings();
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
  const [dlcMetadata, setDlcMetadata] = useState<SteamAppMetadata[]>([]);

  // Internal source checking — used when parent does not provide sourceStatus/onRefreshSources
  const [internalSourceStatus, setInternalSourceStatus] = useState<SourceCheckStatus | undefined>();
  const [internalSources, setInternalSources] = useState<PackageSource[]>(game.sources);
  const sourceResolveReqRef = useRef(0);

  const hasParentSourceControl =
    sourceStatusProp !== undefined || onRefreshSourcesProp !== undefined;

  const effectiveSourceStatus: SourceCheckStatus =
    sourceStatusProp ?? internalSourceStatus ?? "idle";

  const effectiveSources =
    hasParentSourceControl ? game.sources : internalSources;

  const effectiveSelectedSource: PackageSource | null | undefined =
    selectedSourceProp ?? getBestAvailableSource({ ...game, sources: effectiveSources });

  const effectiveRefreshSources = onRefreshSourcesProp ?? (() => {
    const requestId = ++sourceResolveReqRef.current;
    const appId = game.appId;

    sourceLog("retry (internal)", { appId });

    setInternalSourceStatus("checking");
    updateSourceAvailability(appId, {
      appId,
      title: game.title,
      status: "checking",
      luaReady: false,
      availableSources: [],
      sourceCount: 0,
      totalProviderCount: 0,
      updatedAt: Math.floor(Date.now() / 1000),
    }).catch(() => {});

    resolveProviderOverlaysForStoreGames([game], settings)
      .then((overlays) => {
        if (requestId !== sourceResolveReqRef.current) return;
        const overlayGame = overlays[appId];
        if (overlayGame) {
          setInternalSources(overlayGame.sources);
        }
        const resolvedGame = overlayGame ?? game;
        const totalProviders = resolvedGame.sources.length;
        const entry = buildSourceAvailabilityFromProviders(
          appId,
          game.title,
          resolvedGame.sources,
          totalProviders
        );
        sourceLog("saved (internal)", { appId, sourceCount: entry.sourceCount });
        setInternalSourceStatus(entry.status);
        updateSourceAvailability(appId, entry).catch(() => {});
      })
      .catch((error: unknown) => {
        if (requestId !== sourceResolveReqRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.toLowerCase().includes("timeout");
        sourceLog(isTimeout ? "timeout" : "error", { appId, message });
        const status: SourceCheckStatus = isTimeout ? "timeout" : "error";
        setInternalSourceStatus(status);
        updateSourceAvailability(appId, {
          appId,
          title: game.title,
          status,
          luaReady: false,
          availableSources: [],
          sourceCount: 0,
          totalProviderCount: 0,
          updatedAt: Math.floor(Date.now() / 1000),
        }).catch(() => {});
      })
      .finally(() => {
        if (requestId !== sourceResolveReqRef.current) return;
      });
  });

  // Origin-independent source check on mount/appId change
  useEffect(() => {
    if (hasParentSourceControl) return; // parent handles it

    const appId = game.appId;
    let cancelled = false;
    sourceLog("origin-independent check", { appId, title: game.title });

    async function checkSources() {
      await loadSourceAvailabilityIndex();
      if (cancelled) return;

      const cached = getSourceAvailability(appId);
      if (cached) {
        sourceLog("cache hit", { appId, status: cached.status });
        if (cached.status === "ready" && cached.availableSources.length > 0) {
          if (!cancelled) {
            const mapped = cached.availableSources.map((s) => ({
              providerId: s.id as any,
              providerName: s.name,
              fileType: s.type as any,
              available: s.status === "ready",
              downloadUrl: s.packageUrl,
            }));
            setInternalSources(mapped);
            setInternalSourceStatus("ready");
          }
          return;
        }
        if (cached.status === "none" || cached.status === "error" || cached.status === "timeout") {
          if (!cancelled) {
            setInternalSources([]);
            setInternalSourceStatus(cached.status);
          }
          return;
        }
      } else {
        sourceLog("cache miss", { appId });
      }

      // Not cached or still checking — run resolver
      setInternalSourceStatus("checking");
      setInternalSources([]);

      try {
        const overlays = await resolveProviderOverlaysForStoreGames([game], settings);
        if (cancelled) return;

        const overlayGame = overlays[appId];
        const resolvedGame = overlayGame ?? game;
        const totalProviders = resolvedGame.sources.length;
        const entry = buildSourceAvailabilityFromProviders(
          appId,
          game.title,
          resolvedGame.sources,
          totalProviders
        );
        sourceLog("resolved (internal)", { appId, sourceCount: entry.sourceCount, status: entry.status });
        if (!cancelled) {
          setInternalSources(resolvedGame.sources);
          setInternalSourceStatus(entry.status);
        }
        await updateSourceAvailability(appId, entry);
      } catch (error: unknown) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.toLowerCase().includes("timeout");
        sourceLog(isTimeout ? "timeout" : "error", { appId, message });
        const status: SourceCheckStatus = isTimeout ? "timeout" : "error";
        if (!cancelled) {
          setInternalSources([]);
          setInternalSourceStatus(status);
        }
        await updateSourceAvailability(appId, {
          appId,
          title: game.title,
          status,
          luaReady: false,
          availableSources: [],
          sourceCount: 0,
          totalProviderCount: 0,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
    }

    checkSources();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId]);

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

  const availableSources = effectiveSources.filter((source) => source.available);
  const bestSource = effectiveSelectedSource ?? getBestAvailableSource({ ...game, sources: effectiveSources });

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
    const source = effectiveSelectedSource?.available ? effectiveSelectedSource : bestSource;
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
              game={{ ...game, sources: effectiveSources }}
              installStatus={installStatus}
              developer={developer}
              platforms={platforms}
              availableSources={availableSources.length}
              totalSources={effectiveSources.length}
              selectedSource={effectiveSelectedSource ?? bestSource}
              sourceStatus={effectiveSourceStatus}
              onDownload={handleDownload}
              onChangeSource={() => setSourceSelectorOpen(true)}
              onOpenSteam={handleOpenSteam}
              onOpenSteamDb={handleOpenSteamDb}
              onRefreshSources={effectiveRefreshSources}
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
        game={{ ...game, sources: effectiveSources }}
        selectedSource={effectiveSelectedSource ?? bestSource}
        onClose={() => setSourceSelectorOpen(false)}
        onSelectSource={onSelectSourceKey}
        onDownloadSource={handleDownloadFromSource}
        onOpenDetails={onOpenGame}
      />
    </div>
  );
}
