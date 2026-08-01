import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Languages, Puzzle, Star, ShieldAlert } from "lucide-react";

import type { PackageGame, PackageSource, RepackEntry } from "../../types/package";
import type { PackageInstallStatus } from "../../types/packageInstall";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import { extractStoreDrmInfo } from "../../features/drm/storeDrmInfo";
import type { StoreDrmInfo } from "../../features/drm/storeDrmInfo";
import { resolveStoreDrmInfoForDetails } from "../../features/drm/resolveStoreDrmInfo";
import type { SteamReviewSummary } from "../../types/gameReview";
import type { SourceCheckStatus } from "../../services/sourceAvailabilityCacheService";
import type { StoreDetailsSourceState } from "../../services/storeDetailsSourceState";
import { openExternalUrl } from "../../services/externalLinks";
import { setAmbientSource, clearAmbientSource } from "../../services/ambientBackgroundStore";
import { openSteamLibrary, queryRepackCatalogByAppId } from "../../services/tauri";
import {
  getSteamDbUrl,
  getSteamStoreUrl,
} from "../../utils/steamLinks";
import { DEBRID_INSTALL_ENABLED, DEBRID_STORE_ENABLED } from "../../features/debrid/debridFeatureFlag";
import { getRepacksForGameName, subscribeRepackIndex } from "../../services/repackTitleMatcher";
import { getBestAvailableSource } from "../../utils/sourceHelpers";
import { resolveGameMetadata, resolveGameMetadataForMedia } from "../../services/gameMetadataResolver";
import { saveStoreMetadataToStoreCache } from "../../services/storeLocalCacheService";
import { resolveProviderOverlaysForStoreGames, invalidateOverlayCacheForAppId } from "../../services/storeProviderOverlay";
import { resolveStoreDetailsPreviewImage, logDetailsMedia } from "../../services/storeDetailsMediaResolver";
import { buildStoreMedia } from "../../services/storeMediaService";
import {
  getStoreDetailsState,
  setStoreDetailsState,
  buildStoreDetailsState,
} from "../../services/storeDetailsSourceState";
import {
  getSourceAvailability,
  updateSourceAvailability,
  buildSourceAvailabilityFromProviders,
  loadSourceAvailabilityIndex,
} from "../../services/sourceAvailabilityCacheService";
import { useSettings } from "../../context/SettingsContext";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import { loadProviderStatus, normalizeProviderId, updateProviderRemoteStatus, type ProviderStatusOptions } from "../../services/providerStatusService";
import { getCachedProviderStatus, subscribeUpdateStatus } from "../../services/providerStatusStore";
import { fetchHubcapAppStatus, checkHubcapAppUpdate, setLocalPackageMetadata, refreshHubcapStatus } from "../../services/hubcapApiService";
import type { ProviderCheckState } from "./details/StoreGameSummaryPanel";

import { showError, showSuccess, showWarning } from "../toast/GameToast";
import { useConfirm } from "../../services/confirmService";
import { resolveDebridInstallUri } from "../../services/debridInstallChoice";
import PackageInstallSuccessModal from "../common/PackageInstallSuccessModal";

import StoreGameMediaGallery from "./details/StoreGameMediaGallery";
import StoreGameOverviewSection from "./details/StoreGameOverviewSection";
import StoreGameDlcSection from "./details/StoreGameDlcSection";
import StoreGameTechnicalSection from "./details/StoreGameTechnicalSection";
import StoreGameSummaryPanel from "./details/StoreGameSummaryPanel";
import StoreSourceSelectorModal from "./StoreSourceSelectorModal";
import StoreRepackSelectorModal from "./StoreRepackSelectorModal";
import { InfoBlock } from "./details/StoreGameDetailPrimitives";

import StoreMoreLikeThisSection from "./StoreMoreLikeThisSection";
import type { StoreMoreLikeThisGame } from "./StoreMoreLikeThisSection";

import { SkeletonBox, SkeletonHero } from "../common/Skeleton";

export type SourceProgress = {
  completed: number;
  total: number;
  successful: number;
  failed: number;
  sourceCount: number;
  requestId: number;
} | null;

type StoreGameDetailsPageProps = {
  game: PackageGame;
  metadata?: SteamAppMetadata;
  reviewSummary?: SteamReviewSummary;
  installStatus?: PackageInstallStatus;
  isSteamInstalled?: boolean;
  luaInstalled?: boolean;
  steamOwned?: boolean;
  moreLikeThisGames?: StoreMoreLikeThisGame[];
  selectedSource?: PackageSource | null;
  sourceStatus?: SourceCheckStatus;
  isBackgroundChecking?: boolean;
  sourceProgress?: SourceProgress;
  onBack: () => void;
  onDownloadSource?: (source: PackageSource) => Promise<{ success: boolean; jobId?: string }>;
  onViewInLibrary?: (appId: string, title: string) => void;
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
  if (!summary) {
    return "Review summary unavailable";
  }

  if (!summary.resolved) {
    return "Review summary unavailable";
  }

  if (summary.resolved && summary.total_reviews === 0) {
    return "No reviews yet";
  }

  if (typeof summary.positive_percent === "number") {
    return `${summary.review_score_desc} Â· ${summary.positive_percent}%`;
  }

  return summary.review_score_desc || "N/A";
}

function getReviewSubLabel(summary?: SteamReviewSummary) {
  if (!summary) {
    return "Steam review summary unavailable.";
  }

  if (!summary.resolved) {
    return "Steam review summary unavailable.";
  }

  if (summary.resolved && summary.total_reviews === 0) {
    return "No reviews available for this game.";
  }

  return `${summary.total_reviews.toLocaleString()} reviews Â· ${summary.total_positive.toLocaleString()} positive`;
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
  installStatus,
  isSteamInstalled,
  luaInstalled,
  moreLikeThisGames,
  selectedSource,
  sourceStatus,
  isBackgroundChecking = false,
  sourceProgress = null,
  steamOwned = false,
  onBack,
  onDownloadSource,
  onViewInLibrary,
  onOpenGame,
  onSelectSourceKey,
  onRefreshSources,
}: StoreGameDetailsPageProps) {
  const { settings } = useSettings();
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false);
  const [dlcMetadata, setDlcMetadata] = useState<SteamAppMetadata[]>([]);
  const [englishMovies, setEnglishMovies] = useState<SteamAppMetadata["movies"] | null>(null);
  const [refinedDrmInfo, setRefinedDrmInfo] = useState<StoreDrmInfo | null>(null);
  const _drmResolveReqRef = useRef(0);
  const _mediaEnrichReqRef = useRef(0);

  // Feed the ambient background with the hero gallery's current media. Follows
  // the carousel via onMediaSelect and clears on unmount so the store-hero feed
  // / context fallback can take over. Covers both Store and Global Search routes.
  const handleAmbientMedia = useCallback((imageUrl: string | null) => {
    setAmbientSource("store-details", imageUrl);
  }, []);
  useEffect(() => () => clearAmbientSource("store-details"), []);

  // Success modal state â€” shown after package download completes
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [completedGameTitle, setCompletedGameTitle] = useState("");
  const [completedJobId, setCompletedJobId] = useState<string | undefined>();

  console.log(
    `[STORE][DETAILS_PROPS_RECEIVED] appid=${game.appId} installStatus=${installStatus} luaInstalled=${luaInstalled} isSteamInstalled=${isSteamInstalled} steamOwned=${steamOwned}`,
  );

  // Log ownership state once on mount
  useEffect(() => {
    const isInstalled = isSteamInstalled || (installStatus === "active" && !luaInstalled);
    const inLibrary = (!steamOwned && luaInstalled) || (steamOwned && !isInstalled);
    const source = steamOwned ? "steam-owned-cache" : luaInstalled ? "lua" : isSteamInstalled ? "steam-library" : "none";
    console.log(`[STORE][OWNERSHIP_STATE] appid=${game.appId} title=${getTitle(game, metadata)} owned=${steamOwned} installed=${isSteamInstalled} luaInstalled=${luaInstalled} inLibrary=${inLibrary} source=${source}`);
  }, [game.appId, steamOwned, isSteamInstalled, luaInstalled, installStatus]);

  // Fetch English-language media metadata for trailers
  useEffect(() => {
    const appId = Number(game.appId);
    if (!appId || appId <= 0) return;

    const reqId = ++_mediaEnrichReqRef.current;

    setEnglishMovies(null);

    resolveGameMetadataForMedia([appId]).then((enriched) => {
      if (reqId !== _mediaEnrichReqRef.current) return;
      const entry = enriched[appId];
      const movies = entry?.movies ?? [];
      if (movies.length > 0) {
        setEnglishMovies(movies);
        console.log(`[STORE][MEDIA_ENRICH] appid=${appId} movies=${movies.length}`);
      } else {
        console.log(`[STORE][MEDIA_ENRICH_SKIP] appid=${appId} reason=no-english-movies`);
      }
    }).catch((err: unknown) => {
      if (reqId !== _mediaEnrichReqRef.current) return;
      console.warn(`[STORE][MEDIA_ENRICH_FAIL] appid=${appId} err=${String(err)}`);
    });
  }, [game.appId]);

  // Provider-status sidecar state
  const [providerCheckState, setProviderCheckState] = useState<ProviderCheckState>("no-data");
  const [providerCheckReason, setProviderCheckReason] = useState<string>("");
  const [providerRemoteFileModified, setProviderRemoteFileModified] = useState<string | undefined>();
  const [providerRemoteFileSize, setProviderRemoteFileSize] = useState<number | undefined>();
  const [isProviderChecking, setIsProviderChecking] = useState(false);

  // Provider-check in-flight guard + stale result protection
  const _checkRequestIdRef = useRef(0);
  const _checkInFlightRef = useRef(false);

  // Repack catalog state — populated from SQLite repack index when DEBRID_STORE_ENABLED
  const [repackEntries, setRepackEntries] = useState<RepackEntry[]>([]);
  const [repacksLoading, setRepacksLoading] = useState(false);
  const [repackSelectorOpen, setRepackSelectorOpen] = useState(false);

  const downloadQueue = useDownloadQueueContext();
  const { confirm } = useConfirm();

  const handleInstallRepack = useCallback(async (entry: RepackEntry) => {
    if (!DEBRID_INSTALL_ENABLED) {
      showWarning("Debrid install is not enabled in settings.", { title: "Not available" });
      return;
    }
    const resolved = await resolveDebridInstallUri(entry.downloadUris, confirm, entry.title);
    if (!resolved.ok) {
      if (resolved.reason === "no-uri") {
        showWarning("No download URI available for this repack.", { title: "Not available" });
      }
      return;
    }
    try {
      downloadQueue.addDebridInstallJob(
        entry.id,
        entry.title,
        resolved.uri,
        entry.installerType || "zip",
        game.appId ?? "",
        game.imageUrl,
        entry.repacker,
        resolved.method,
      );
      setRepackSelectorOpen(false);
      showSuccess(`Install started: ${entry.title}`, { title: "Debrid" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(`Failed to start install: ${msg}`, { title: "Debrid" });
    }
  }, [downloadQueue, game.appId, game.imageUrl, confirm]);

  // Internal source checking â€” used when parent does not provide sourceStatus/onRefreshSources
  const [internalSourceStatus, setInternalSourceStatus] = useState<SourceCheckStatus | undefined>();
  const [internalSources, setInternalSources] = useState<PackageSource[]>(game.sources);
  const sourceResolveReqRef = useRef(0);

  const hasParentSourceControl =
    sourceStatus !== undefined || onRefreshSources !== undefined;

  const effectiveSourceStatus: SourceCheckStatus =
    sourceStatus ?? internalSourceStatus ?? "idle";

  const effectiveSources =
    hasParentSourceControl ? game.sources : internalSources;

  const effectiveSelectedSource: PackageSource | null | undefined =
    selectedSource ?? getBestAvailableSource({ ...game, sources: effectiveSources });

  const effectiveRefreshSources = onRefreshSources ?? (() => {
    const requestId = ++sourceResolveReqRef.current;
    const appId = game.appId;
    const savedProvider = getStoreDetailsState(appId)?.selectedProvider;

    sourceLog("retry (internal)", { appId });
    console.log(`[STORE][SOURCE_RETRY_CLICK] appid=${appId} reason=user-retry savedProvider=${savedProvider || "none"}`);
    console.log(`[STORE][SOURCE_RETRY_CLEAR_TRANSIENT] appid=${appId}`);
    console.log(`[STORE][SOURCE_RETRY_START] appid=${appId}`);

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
    }).catch((err) => console.warn(err));

    // Invalidate overlay cache so retry actually calls providers instead of returning stale cached data
    invalidateOverlayCacheForAppId(appId);

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
        const successes = resolvedGame.sources.filter(s => s.available).length;
        const timedOut = resolvedGame.sources.filter(s => !s.available && s.error?.toLowerCase().includes("timeout")).length;
        const savedProvider = resolvedGame.sources.find(s => s.available)?.providerName || "none";
        console.log(`[STORE][SOURCE_RETRY_RESULT] appid=${appId} total=${totalProviders} successes=${successes} timedOut=${timedOut} selectedProvider=${savedProvider}`);
        if (!savedProvider || savedProvider === "none") {
          console.warn("[STORE][SOURCE_SAVE_SKIP]", { appid: appId, reason: "no-provider" });
          console.log(`[STORE][SOURCE_RETRY_FAILED] appid=${appId} retryable=true reason=no-provider status=${entry.status}`);
          setInternalSourceStatus(entry.status);
          const existing = getSourceAvailability(appId);
          if (existing && existing.availableSources.length > 0) {
            sourceLog("preserve", { appId, previousSources: existing.availableSources.length });
            updateSourceAvailability(appId, { ...existing, status: entry.status, updatedAt: Math.floor(Date.now() / 1000) }).catch((err) => console.warn(err));
          } else if (existing) {
            updateSourceAvailability(appId, { ...existing, status: entry.status, updatedAt: Math.floor(Date.now() / 1000) }).catch((err) => console.warn(err));
          }
          return;
        }
        sourceLog("saved (internal)", { appId, sourceCount: entry.sourceCount });
        setInternalSourceStatus(entry.status);
        updateSourceAvailability(appId, entry).catch((err) => console.warn(err));
      })
      .catch((error: unknown) => {
        if (requestId !== sourceResolveReqRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.toLowerCase().includes("timeout");
        sourceLog(isTimeout ? "timeout" : "error", { appId, message });
        console.log(`[STORE][SOURCE_RETRY_FAILED] appid=${appId} retryable=${!message.toLowerCase().includes("cooldown")} reason=${isTimeout ? "timeout" : "error"}`);
        if (isTimeout) {
          const existing = getSourceAvailability(appId);
          if (existing && existing.availableSources.length > 0) {
            sourceLog("timeout-preserve", { appId, previousSources: existing.availableSources.length });
            updateSourceAvailability(appId, { ...existing, status: "timeout", updatedAt: Math.floor(Date.now() / 1000) }).catch((err) => console.warn(err));
            return;
          }
          sourceLog("timeout-nocache", { appId });
          // Fix: set status to "timeout" instead of leaving "checking" forever
          updateSourceAvailability(appId, {
            appId,
            title: game.title,
            status: "timeout",
            luaReady: false,
            availableSources: [],
            sourceCount: 0,
            totalProviderCount: 0,
            updatedAt: Math.floor(Date.now() / 1000),
          }).catch((err) => console.warn(err));
          return;
        }
        setInternalSourceStatus("error");
        updateSourceAvailability(appId, {
          appId,
          title: game.title,
          status: "error",
          luaReady: false,
          availableSources: [],
          sourceCount: 0,
          totalProviderCount: 0,
          updatedAt: Math.floor(Date.now() / 1000),
        }).catch((err) => console.warn(err));
      })
      .finally(() => {
        if (requestId !== sourceResolveReqRef.current) return;
      });
  });

  // Origin-independent source check on mount/appId change
  useEffect(() => {
    if (hasParentSourceControl) return; // parent handles it
    // Owned or non-installed Lua games should not trigger provider resolution.
    if (steamOwned || (!isSteamInstalled && luaInstalled)) return;

    const appId = game.appId;
    let cancelled = false;
    let unsubRepackIndex: (() => void) | null = null;
    sourceLog("origin-independent check", { appId, title: game.title });

    async function checkSources() {
      await loadSourceAvailabilityIndex();
      if (cancelled) return;

      // Step 1: Try to rebuild selectedSource from saved store details state
      const detailsState = getStoreDetailsState(appId);
      const savedProvider = detailsState?.selectedProvider;
      const hadProviderResults = (detailsState?.providerResults ?? 0) > 0;
      if (savedProvider && hadProviderResults) {
        sourceLog("saved provider", { appId, provider: savedProvider, providerResults: detailsState!.providerResults });
      }

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
        if (cached.status === "none" || cached.status === "error" || cached.status === "timeout" || cached.status === "needs-configuration" || cached.status === "checking") {
          // Step 2: Stale cache (including stuck "checking") but saved provider exists â€” try to rebuild from cache sources
          if (savedProvider && cached.availableSources.length > 0) {
            const matchingSource = cached.availableSources.find(
              (s) => s.name === savedProvider || s.id === savedProvider,
            );
            if (matchingSource) {
              const rebuilt: PackageSource = {
                providerId: matchingSource.id as any,
                providerName: matchingSource.name,
                fileType: matchingSource.type as any,
                available: matchingSource.status === "ready",
                downloadUrl: matchingSource.packageUrl,
              };
              if (!cancelled) {
                setInternalSources([rebuilt]);
                setInternalSourceStatus("ready");
                sourceLog("rebuilt from saved provider", { appId, provider: savedProvider });
                console.log(`[STORE][SOURCE_REBUILD_FROM_CACHE] appid=${appId} provider=${savedProvider} success=true`);
              }
              return;
            }
            console.log(`[STORE][SOURCE_REBUILD_FROM_CACHE] appid=${appId} provider=${savedProvider} success=failure`);
          }
          // Treat stale "checking" as "timeout" to avoid infinite resolver loop
          const resolvedStatus = cached.status === "checking" ? "timeout" : cached.status;
          if (!cancelled) {
            setInternalSources([]);
            setInternalSourceStatus(resolvedStatus);
            sourceLog("stale cache resolved", { appId, from: cached.status, to: resolvedStatus });
          }
          return;
        }
      } else {
        sourceLog("cache miss", { appId });
        if (savedProvider && hadProviderResults) {
          console.log(`[STORE][SOURCE_RESTORE_MISS] appid=${appId} action=show-retry`);
        }
      }

      // Not cached â€” run resolver
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
        const savedProvider = resolvedGame.sources.find(s => s.available)?.providerName || "none";
        if (!savedProvider || savedProvider === "none") {
          console.warn("[STORE][SOURCE_SAVE_SKIP]", { appid: appId, reason: "no-provider" });
          if (!cancelled) {
            setInternalSources([]);
            setInternalSourceStatus(entry.status);
          }
          const existing = getSourceAvailability(appId);
          if (existing && existing.availableSources.length > 0) {
            sourceLog("preserve", { appId, previousSources: existing.availableSources.length });
            await updateSourceAvailability(appId, { ...existing, status: entry.status, updatedAt: Math.floor(Date.now() / 1000) });
          } else if (existing) {
            await updateSourceAvailability(appId, { ...existing, status: entry.status, updatedAt: Math.floor(Date.now() / 1000) });
          }
          return;
        }
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
        if (isTimeout) {
          if (!cancelled) {
            setInternalSources([]);
            setInternalSourceStatus("timeout");
          }
          const existing = getSourceAvailability(appId);
          if (existing && existing.availableSources.length > 0) {
            sourceLog("timeout-preserve", { appId, previousSources: existing.availableSources.length });
            await updateSourceAvailability(appId, { ...existing, status: "timeout", updatedAt: Math.floor(Date.now() / 1000) });
            return;
          }
          sourceLog("timeout-nocache", { appId });
          // Fix: set status to "timeout" instead of leaving "checking" forever
          await updateSourceAvailability(appId, {
            appId,
            title: game.title,
            status: "timeout",
            luaReady: false,
            availableSources: [],
            sourceCount: 0,
            totalProviderCount: 0,
            updatedAt: Math.floor(Date.now() / 1000),
          });
          return;
        }
        if (!cancelled) {
          setInternalSources([]);
          setInternalSourceStatus("error");
        }
        await updateSourceAvailability(appId, {
          appId,
          title: game.title,
          status: "error",
          luaReady: false,
          availableSources: [],
          sourceCount: 0,
          totalProviderCount: 0,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }

      // Step 3: Discover repack catalog entries for this appId (independent of provider sources)
      if (DEBRID_STORE_ENABLED) {
        try {
          setRepacksLoading(true);
          const repacks = await queryRepackCatalogByAppId(Number(appId));
          if (!cancelled) {
            // Fallback: if SQLite catalog has no matches, try runtime title matcher against raw JSON
            if (repacks.length === 0) {
              const gameName = metadata?.name || game.title || "";
              const matched = await getRepacksForGameName(Number(appId), gameName);
              if (!cancelled && matched.length > 0) {
                setRepackEntries(matched);
                const repackerNames = [...new Set(matched.map((r) => r.repacker))];
                console.log(`[STORE][REPACK_MATCH] appid=${appId} title="${gameName}" matches=${matched.length} repackers=${repackerNames.join(",")}`);
              } else if (!cancelled) {
                setRepackEntries(repacks);
              }
            } else {
              setRepackEntries(repacks);
              const repackerNames = [...new Set(repacks.map((r) => r.repacker))];
              console.log(`[STORE][REPACK_DISCOVERY] appid=${appId} repacks=${repacks.length} repackers=${repackerNames.join(",")}`);
            }
          }
        } catch (err: unknown) {
          if (!cancelled) {
            console.warn(`[STORE][REPACK_DISCOVERY_FAIL] appid=${appId} err=${String(err)}`);
          }
        } finally {
          if (!cancelled) {
            setRepacksLoading(false);
          }
        }
      }

      // Step 4: Subscribe to repack index updates (FitGirl background loading)
      // When fitgirl.json finishes, re-run matching to pick up new entries.
      if (DEBRID_STORE_ENABLED) {
        try {
          unsubRepackIndex = subscribeRepackIndex(async () => {
            if (cancelled) return;
            const gameName = metadata?.name || game.title || "";
            const matched = await getRepacksForGameName(Number(appId), gameName);
            if (cancelled) return;
            if (matched.length > 0) {
              setRepackEntries(matched);
              const repackerNames = [...new Set(matched.map((r) => r.repacker))];
              console.log(`[STORE][REPACK_DEFERRED] appid=${appId} title="${gameName}" matches=${matched.length} repackers=${repackerNames.join(",")}`);
            }
          });
        } catch { /* subscription setup is infallible */ }
      }
    }

    checkSources();
    return () => {
      cancelled = true;
      unsubRepackIndex?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId]);

  const metadataLoading = !metadata?.resolved;

  // Safety timeout: if metadata never resolves, show error after 30s instead of infinite skeleton
  const [metadataTimedOut, setMetadataTimedOut] = useState(false);
  const _timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!metadataLoading) {
      setMetadataTimedOut(false);
      if (_timeoutRef.current) { clearTimeout(_timeoutRef.current); _timeoutRef.current = null; }
      return;
    }
    _timeoutRef.current = setTimeout(() => {
      setMetadataTimedOut(true);
      console.warn(`[STORE_DETAILS_BOUNDARY][RESULT] appId=${game.appId} timeout=true loadingCleared=false finalRenderedState=error`);
    }, 30_000);
    return () => {
      if (_timeoutRef.current) { clearTimeout(_timeoutRef.current); _timeoutRef.current = null; }
    };
  }, [metadataLoading, game.appId]);

  const title = getTitle(game, metadata);
  const developer = getDeveloper(game, metadata);
  const imageUrl = getBestImage(game, metadata);

  const isChecking = (effectiveSourceStatus === "checking" || effectiveSourceStatus === "idle") && !isBackgroundChecking;
  const providerResults = game.sources?.length ?? 0;
  const availableSourceCount = (effectiveSources ?? []).filter(s => s.available).length;
  console.log(`[STORE][SOURCE_CHECK_STATE] appid=${game.appId} checking=${isChecking} sourceStatus=${effectiveSourceStatus} providerResults=${providerResults} available=${availableSourceCount}`);

  // Resolve preview image independent of checking state
  const previewResult = resolveStoreDetailsPreviewImage({
    appId: game.appId,
    game,
    metadata,
    selectedSource: effectiveSelectedSource,
    providerResults: null,
    isChecking,
  });

  // Store details source state cache â€” persists across mount/unmount
  // On mount, restore cached state and detect saved/selected provider mismatches
  useEffect(() => {
    const appId = game.appId;
    const cached = getStoreDetailsState(appId);
    if (cached) {
      const savedProvider = cached.savedSelectedProvider;
      const currProvider = effectiveSelectedSource?.providerName || null;
      if (savedProvider && currProvider !== savedProvider) {
        console.log(
          `[STORE][DETAILS_SOURCE_MISMATCH_FIXED] appid=${appId} saved=${savedProvider} selected=${currProvider}`,
        );
      }
      console.log(
        `[STORE][DETAILS_STATE_RESTORE] appid=${appId} selectedProvider=${cached.selectedProvider} status=${cached.status} hasMedia=${cached.hasCatalogMedia || cached.hasSelectedMedia}`,
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId]);

  // Diagnostic â€” source state on mount/change (change-only)
  useEffect(() => {
    const hasSavedSource = !!(effectiveSelectedSource || ((game.sources?.length ?? 0) > 0));
    const key = `${game.appId}|${isChecking}|${hasSavedSource}|${effectiveSelectedSource?.providerName || "null"}|${game.sources?.length ?? 0}|${!!imageUrl}`;
    if (diagLogRef.current !== key) {
      diagLogRef.current = key;
      console.log(
        `[STORE][SOURCE_STATE] appid=${game.appId} checking=${isChecking} backgroundChecking=${isBackgroundChecking} savedSelected=${hasSavedSource} selectedProvider=${effectiveSelectedSource?.providerName || "null"} providerResults=${game.sources?.length ?? 0} hasPreview=${!!imageUrl}`,
      );
      if (ENABLE_VERBOSE_SOURCE_LOGS) {
        logDetailsMedia(game.appId, previewResult, isChecking);
      }
    }
  });

  // Load provider-status sidecar on mount when provider is known
  useEffect(() => {
    const appId = game.appId;
    const providerId = effectiveSelectedSource?.providerId;
    if (!appId || !providerId) return;

    const pid: string = providerId;
    let cancelled = false;

    async function loadStatus() {
      const normalizedId = normalizeProviderId(pid);
      const statusFile = await loadProviderStatus(appId, normalizedId);
      if (cancelled) return;

      if (!statusFile || !statusFile.result) {
        setProviderCheckState("no-data");
        setProviderCheckReason("");
        return;
      }

      setProviderCheckState(statusFile.result.status as ProviderCheckState);
      setProviderCheckReason(statusFile.result.reason);
      setProviderRemoteFileModified(statusFile.remote?.fileModified ?? undefined);
      setProviderRemoteFileSize(statusFile.remote?.fileSize ?? undefined);

      // Seed local package metadata for comparison
      if (statusFile.local) {
        const rawSource = statusFile.local.metadataSource;
        const metadataSource: "local-lua" | "remote" | "auto-baseline" | "unknown" =
          rawSource === "local-lua-file" ? "local-lua"
          : rawSource === "auto-baseline" ? "auto-baseline"
          : rawSource === "remote" ? "remote"
          : "unknown";
        setLocalPackageMetadata(appId, {
          fileModifiedAtInstall: statusFile.local.fileModifiedAtInstall ?? undefined,
          fileSizeAtInstall: statusFile.local.fileSizeAtInstall ?? undefined,
          metadataSource,
        });
      }
    }

    loadStatus();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId, effectiveSelectedSource?.providerId]);

  // Subscribe to reactive provider-status store so the detail page updates immediately
  // when provider-status changes (scan, check, download, update).
  useEffect(() => {
    const appId = game.appId;
    const providerId = effectiveSelectedSource?.providerId;
    if (!appId || !providerId) return;

    const normalizedId = normalizeProviderId(providerId);

    const unsub = subscribeUpdateStatus(() => {
      // Re-read provider-status from store cache (no disk I/O â€” store already loaded it)
      getCachedProviderStatus(appId, normalizedId).then((statusFile) => {
        if (!statusFile || !statusFile.result) {
          setProviderCheckState("no-data");
          setProviderCheckReason("");
          return;
        }
        setProviderCheckState(statusFile.result.status as ProviderCheckState);
        setProviderCheckReason(statusFile.result.reason);
        setProviderRemoteFileModified(statusFile.remote?.fileModified ?? undefined);
        setProviderRemoteFileSize(statusFile.remote?.fileSize ?? undefined);

        if (statusFile.local) {
          const rawSource = statusFile.local.metadataSource;
          const metadataSource: "local-lua" | "remote" | "auto-baseline" | "unknown" =
            rawSource === "local-lua-file" ? "local-lua"
            : rawSource === "auto-baseline" ? "auto-baseline"
            : rawSource === "remote" ? "remote"
            : "unknown";
          setLocalPackageMetadata(appId, {
            fileModifiedAtInstall: statusFile.local.fileModifiedAtInstall ?? undefined,
            fileSizeAtInstall: statusFile.local.fileSizeAtInstall ?? undefined,
            metadataSource,
          });
        }

        console.log(`[PACKAGE][SUMMARY_STATE] appid=${appId} providerCheckState=${statusFile.result?.status ?? "unknown"} reason=${statusFile.result?.reason ?? ""} hasLocal=${!!statusFile.local} hasRemote=${!!statusFile.remote}`);
        console.log(`[PACKAGE][BUTTON_STATE] appid=${appId} button=${statusFile.result?.status === "update-available" ? "update-available" : statusFile.result?.status === "up-to-date" ? "up-to-date" : "other"} enabled=true reason=store-subscription`);
      });
    });

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId, effectiveSelectedSource?.providerId]);

  // Update source state cache when effective state changes
  useEffect(() => {
    if (!game.appId) return;
    const sources = game.sources ?? [];
    const status: StoreDetailsSourceState["status"] =
      isChecking ? "checking"
        : sources.some(s => s.available) ? "ready"
        : sources.length > 0 ? "missing"
        : "idle";
    const prevState = getStoreDetailsState(game.appId);
    const currentSelectedName = effectiveSelectedSource?.providerName
      || sources.find(s => s.available)?.providerName
      || null;
    const currentSavedName = (effectiveSelectedSource && sources.length > 0)
      ? effectiveSelectedSource.providerName
      : (sources.length > 0 && prevState?.savedSelectedProvider)
        ? prevState.savedSelectedProvider
        : null;
    setStoreDetailsState(game.appId, buildStoreDetailsState(game.appId, {
      selectedProvider: currentSelectedName,
      savedSelectedProvider: currentSavedName,
      providerResults: sources.length,
      hasCatalogMedia: !!imageUrl,
      hasSelectedMedia: !!previewResult.url,
      status,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId, effectiveSelectedSource?.providerName, game.sources?.length ?? 0, imageUrl, previewResult.url, isChecking]);
  const mediaItems = useMemo(() => {
    const mediaMeta = (englishMovies && metadata)
      ? { ...metadata, movies: englishMovies }
      : metadata;
    return buildStoreMedia(mediaMeta, englishMovies ? "english" : undefined, englishMovies ? "US" : undefined);
  }, [metadata, englishMovies]);

  // Resolve DRM info asynchronously (curated index + optional Steam Store HTML fetch)
  // for the currently visible details appId only.
  useEffect(() => {
    const reqId = ++_drmResolveReqRef.current;
    const names = metadata?.developer ? [metadata.developer] : [];
    const publishers = metadata?.publishers || [];
    resolveStoreDrmInfoForDetails({
      appId: game.appId,
      metadata,
      title: metadata?.name || game.title,
      developerNames: names,
      publisherNames: publishers,
    }).then((info) => {
      if (reqId !== _drmResolveReqRef.current) return;
      setRefinedDrmInfo(info);
    });
  }, [game.appId, metadata]);

  const drmInfo = useMemo(() => {
    return refinedDrmInfo ?? extractStoreDrmInfo(metadata);
  }, [metadata, refinedDrmInfo]);

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

  const reviewsState = !reviewSummary ? "unavailable" : !reviewSummary.resolved ? "unavailable" : reviewSummary.total_reviews === 0 ? "no-reviews" : "available";
  console.log(`[STORE][REVIEWS_STATE] appid=${game.appId} state=${reviewsState} total=${reviewSummary?.total_reviews ?? 0} resolved=${reviewSummary?.resolved ?? false} source=steam-appreviews`);

  const drmLogRef = useRef("");
  useEffect(() => {
    const key = `${game.appId}|${drmInfo.hasDenuvo}|${drmInfo.hasThirdPartyDrm}|${drmInfo.source}`;
    if (drmLogRef.current === key) return;
    drmLogRef.current = key;
    console.log(
      `[STORE][DRM_INFO] appid=${game.appId} hasDenuvo=${drmInfo.hasDenuvo} hasThirdPartyDrm=${drmInfo.hasThirdPartyDrm} source=${drmInfo.source} matched="${drmInfo.matchedText ?? ""}"`,
    );
  }, [game.appId, drmInfo]);

  // Save main game metadata to store cache when resolved â€” stable deps only
  // NOTE: does NOT enqueue media downloads â€” Store display images must NOT
  // update local MediaIndex, appinfo, or BootSnapshot. See mediaDownloadQueue
  // Store guard and startupSnapshotService Store guard for enforcement.
  const prevAppIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (metadata?.resolved && metadata.app_id !== prevAppIdRef.current) {
      prevAppIdRef.current = metadata.app_id;
      saveStoreMetadataToStoreCache(metadata);
    }
  }, [metadata?.resolved, metadata?.app_id]);

  const dlcRequestRef = useRef(0);
  const diagLogRef = useRef<string>("");
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

  const availableSources = (effectiveSources ?? []).filter((source) => source.available);
  const bestSource = effectiveSelectedSource ?? getBestAvailableSource({ ...game, sources: effectiveSources ?? [] });

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

  async function handleOpenSteamLibrary() {
    try {
      await openSteamLibrary(Number(game.appId));
    } catch (error) {
      console.error(error);

      showError("No se pudo abrir Steam Library.", {
        title: "Error abriendo enlace",
      });
    }
  }

  async function reloadProviderStatus() {
    const appId = game.appId;
    const providerId = effectiveSelectedSource?.providerId;
    if (!appId || !providerId) return;

    const pid: string = providerId;
    const normalizedId = normalizeProviderId(pid);
    const statusFile = await loadProviderStatus(appId, normalizedId);
    if (!statusFile || !statusFile.result) {
      setProviderCheckState("no-data");
      setProviderCheckReason("");
      return;
    }
    setProviderCheckState(statusFile.result.status as ProviderCheckState);
    setProviderCheckReason(statusFile.result.reason);
    setProviderRemoteFileModified(statusFile.remote?.fileModified ?? undefined);
    setProviderRemoteFileSize(statusFile.remote?.fileSize ?? undefined);
    if (statusFile.local) {
      const rawSource = statusFile.local.metadataSource;
      const metadataSource: "local-lua" | "remote" | "auto-baseline" | "unknown" =
        rawSource === "local-lua-file" ? "local-lua"
        : rawSource === "auto-baseline" ? "auto-baseline"
        : rawSource === "remote" ? "remote"
        : "unknown";
      setLocalPackageMetadata(appId, {
        fileModifiedAtInstall: statusFile.local.fileModifiedAtInstall ?? undefined,
        fileSizeAtInstall: statusFile.local.fileSizeAtInstall ?? undefined,
        metadataSource,
      });
    }
  }

  async function handleDownload() {
    const source = effectiveSelectedSource?.available ? effectiveSelectedSource : bestSource;
    if (source) {
      const result = await onDownloadSource?.(source);
      await reloadProviderStatus();

      // Show success modal if download succeeded
      if (result?.success) {
        setCompletedGameTitle(title);
        setCompletedJobId(result.jobId);
        setSuccessModalOpen(true);
        console.log(`[PACKAGE][SUCCESS_MODAL] appid=${game.appId} title="${title}" jobId=${result.jobId}`);
      }

      // Refresh Hubcap badge usage/status after download/update
      const hubcapSettings = settings.providers?.hubcapdb;
      if (hubcapSettings?.baseUrl && hubcapSettings?.apiKey) {
        refreshHubcapStatus(hubcapSettings.baseUrl, hubcapSettings.apiKey).then(() => {
          console.log(`[HUBCAP][BADGES] surface=store-details after-download appid=${game.appId}`);
        });
      }
    }
  }

  async function handleDownloadFromSource(source: PackageSource) {
    const result = await onDownloadSource?.(source);
    await reloadProviderStatus();

    // Show success modal if download succeeded
    if (result?.success) {
      setCompletedGameTitle(title);
      setCompletedJobId(result.jobId);
      setSuccessModalOpen(true);
      console.log(`[PACKAGE][SUCCESS_MODAL] appid=${game.appId} title="${title}" source-selector jobId=${result.jobId}`);
    }
  }

  async function handleCheckForUpdates() {
    // Guard: only installed Steam games can have package updates.
    // Non-installed Lua games (orphaned config/lua files) must not trigger provider checks.
    if (!isSteamInstalled) return;
    const appId = game.appId;
    const providerId = effectiveSelectedSource?.providerId;
    if (!appId || !providerId) return;

    const pid: string = providerId;
    const hubcapSettings = settings.providers?.hubcapdb;
    if (!hubcapSettings?.apiKey || !hubcapSettings?.baseUrl) {
      console.log(`[PACKAGE][CHECK_FOR_UPDATES] appid=${appId} skipped=no-hubcap-settings`);
      return;
    }

    // In-flight guard â€” prevent duplicate checks
    if (_checkInFlightRef.current) {
      console.log(`[PACKAGE][CHECK_SKIP] appid=${appId} provider=${pid} reason=already-running`);
      return;
    }

    const requestId = ++_checkRequestIdRef.current;
    _checkInFlightRef.current = true;
    setIsProviderChecking(true);

    console.log(`[PACKAGE][CHECK_START] appid=${appId} provider=${pid} requestId=${requestId}`);

    try {
      const remote = await fetchHubcapAppStatus(hubcapSettings.baseUrl, hubcapSettings.apiKey, appId);
      // Stale result protection â€” only apply if requestId matches latest
      if (_checkRequestIdRef.current !== requestId) {
        console.log(`[PACKAGE][CHECK_STALE_IGNORED] appid=${appId} provider=${pid} requestId=${requestId}`);
        return;
      }

      if (!remote) {
        setProviderCheckState("error");
        setProviderCheckReason("fetch-failed");
        return;
      }

      const result = checkHubcapAppUpdate(appId, remote);

      const providerOptions: ProviderStatusOptions = {
        luaDir: settings.luaPath || undefined,
        steamRoot: settings.steamRoot || undefined,
      };
      await updateProviderRemoteStatus(appId, pid, {
        status: remote.status,
        gameName: remote.gameName ?? null,
        manifestFileExists: remote.manifestFileExists ?? null,
        autoUpdateEnabled: remote.autoUpdateEnabled ?? null,
        updateInProgress: remote.updateInProgress ?? null,
        fileSize: remote.fileSize ?? null,
        fileModified: remote.fileModified ?? null,
        fileAgeDays: remote.fileAgeDays ?? null,
        needsUpdate: remote.needsUpdate ?? null,
        updateReason: remote.updateReason ?? null,
        timestamp: remote.timestamp ?? null,
      }, {
        status: result.status,
        reason: result.reason,
      }, providerOptions);

      // Reload from disk to pick up any auto-baseline changes
      await reloadProviderStatus();

      console.log(
        `[PACKAGE][CHECK_APPLY] appid=${appId} provider=${pid} requestId=${requestId} status=${result.status} reason=${result.reason}`,
      );

      // Refresh Hubcap badge usage/status after check completes
      if (hubcapSettings.baseUrl && hubcapSettings.apiKey) {
        refreshHubcapStatus(hubcapSettings.baseUrl, hubcapSettings.apiKey).then(() => {
          console.log(`[HUBCAP][BADGES] surface=store-details after-check appid=${appId}`);
        });
      }
    } catch (err) {
      if (_checkRequestIdRef.current !== requestId) {
        console.log(`[PACKAGE][CHECK_STALE_IGNORED] appid=${appId} provider=${pid} requestId=${requestId} reason=stale-error`);
        return;
      }
      console.log(`[PACKAGE][CHECK_FOR_UPDATES] appid=${appId} error="${String(err)}"`);
      setProviderCheckState("error");
      setProviderCheckReason(String(err));
    } finally {
      _checkInFlightRef.current = false;
      setIsProviderChecking(false);
    }
  }

  if (metadataLoading) {
    if (metadataTimedOut) {
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
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-(--surface-active-border) bg-white/5 p-12 text-center">
            <div className="text-sm font-medium text-(--color-text)">Could not load game details</div>
            <div className="text-xs text-(--color-muted)">The Steam Store API did not respond in time.</div>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              Back to Store
            </button>
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

  console.log(
    `[STORE][SUMMARY_PROPS_FORWARD] appid=${game.appId} installStatus=${installStatus} luaInstalled=${luaInstalled} isSteamInstalled=${isSteamInstalled} steamOwned=${steamOwned}`,
  );

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
          mediaItems={mediaItems}
          appId={game.appId}
          developer={developer}
          platforms={platforms}
          onMediaSelect={handleAmbientMedia}
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

            {drmInfo.hasThirdPartyDrm && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  {drmInfo.hasDenuvo
                    ? "Denuvo Anti-Tamper"
                    : "3rd-party DRM"}
                </span>
              </div>
            )}

            <StoreGameOverviewSection title={title} metadata={metadata} />
          </section>

          <aside className="space-y-4">
            <StoreGameSummaryPanel
              game={{ ...game, sources: effectiveSources }}
              previewImageUrl={imageUrl}
              installStatus={installStatus}
              isSteamInstalled={isSteamInstalled}
              luaInstalled={luaInstalled}
              developer={developer}
              platforms={platforms}
              availableSources={availableSources.length}
              totalSources={(effectiveSources ?? []).length}
              selectedSource={effectiveSelectedSource ?? bestSource}
              sourceStatus={effectiveSourceStatus}
              isBackgroundChecking={isBackgroundChecking}
              sourceProgress={sourceProgress}
              onDownload={handleDownload}
              onChangeSource={() => setSourceSelectorOpen(true)}
              onOpenSteam={handleOpenSteam}
              onOpenSteamDb={handleOpenSteamDb}
              onOpenSteamLibrary={handleOpenSteamLibrary}
              onRefreshSources={effectiveRefreshSources}
              providerCheckState={providerCheckState}
              providerCheckReason={providerCheckReason}
              providerRemoteFileModified={providerRemoteFileModified}
              providerRemoteFileSize={providerRemoteFileSize}
              hasLocalPackage={luaInstalled}
              steamOwned={steamOwned}
              isProviderChecking={isProviderChecking}
              onCheckForUpdates={handleCheckForUpdates}
            />

            {/* Repack catalog card */}
            {DEBRID_STORE_ENABLED && (repackEntries.length > 0 || repacksLoading) && (
              <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-(--color-text)">
                      Repacks
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRepackSelectorOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-400 transition hover:bg-cyan-500/20"
                  >
                    {repacksLoading ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
                    ) : (
                      <>
                        {repackEntries.length} available
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
                {!repacksLoading && repackEntries.length > 0 && (
                  <p className="mt-1.5 text-xs text-(--color-muted)">
                    {repackEntries.length === 1
                      ? "1 repack installer available from the Debrid catalog"
                      : `${repackEntries.length} repack installers available from the Debrid catalog`
                    }
                  </p>
                )}
              </div>
            )}
          </aside>
        </div>
      </section>

      <StoreGameDlcSection dlcCount={dlcCount} dlcMetadata={dlcMetadata} />

      {moreLikeThisGames && moreLikeThisGames.length > 0 && (
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

      <StoreRepackSelectorModal
        open={repackSelectorOpen}
        game={game}
        repackEntries={repackEntries}
        onClose={() => setRepackSelectorOpen(false)}
        onInstall={handleInstallRepack}
      />

      <PackageInstallSuccessModal
        open={successModalOpen}
        gameTitle={completedGameTitle}
        appId={game.appId}
        jobId={completedJobId}
        imageUrl={imageUrl}
        providerName={effectiveSelectedSource?.providerName}
        onViewInLibrary={() => {
          setSuccessModalOpen(false);
          onViewInLibrary?.(game.appId, completedGameTitle);
        }}
        onContinueBrowsing={() => {
          setSuccessModalOpen(false);
        }}
      />
    </div>
  );
}
