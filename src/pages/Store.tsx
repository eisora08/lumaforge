import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countRender, isInteractionBusy } from "../services/perfCounters";
import { isBootReady } from "../services/appBootCoordinator";
import {
  ChevronLeft,
  ChevronRight,
  PackageSearch,
} from "lucide-react";

import PackageCard from "../components/packages/PackageCard";
import type { StoreSearchDropdownItem } from "../components/packages/PackagesToolbar";

import StoreDiscoverHeroCarousel from "../components/store/StoreDiscoverHeroCarousel";
import StoreGridSection from "../components/store/StoreGridSection";
import { GenreCollectionCard } from "../components/store/GenreCollectionCard";
import DebridCatalogSection from "../components/store/DebridCatalogSection";
import LazySectionWrapper from "../components/store/LazySectionWrapper";
import StoreGameDetailsPage from "../components/store/StoreGameDetailsPage";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";
import StoreBrowseFiltersPanel, {
  DEFAULT_BROWSE_FILTERS,
} from "../components/store/StoreBrowseFiltersPanel";
import type { BrowseFilters } from "../components/store/StoreBrowseFiltersPanel";
import type { StoreMoreLikeThisGame } from "../components/store/StoreMoreLikeThisSection";

import { useSettings } from "../context/SettingsContext";
import { useStoreTab } from "../context/StoreTabContext";
import { useGameDetails } from "../context/GameDetailsContext";
import { useProviderSearch } from "../hooks/useProviderSearch";
import { useDownloadQueue } from "../hooks/useDownloadQueue";

import { scanInstalledLuaScripts } from "../services/tauri";

import { getBestAvailableSource, getSourceKey } from "../utils/sourceHelpers";
import { isHttpUrl } from "../services/libraryLocalCacheService";
import { resolveGameMetadata, createResolvedFallbackMetadata } from "../services/gameMetadataResolver";
import { parseReleaseDate } from "../services/globalCatalogService";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import {
  enrichGameSearchResult,
  mapEnrichedGameSearchResultToStoreSearchDropdownItem,
} from "../features/search/gameSearchMapper";
import { useGameSearch } from "../features/search/useGameSearch";
import { useGameOwnershipLookup } from "../features/search/useGameOwnershipLookup";
import { resolveProviderOverlaysForStoreGames, loadStoreProviderOverlayCache, invalidateOverlayCacheForAppId } from "../services/storeProviderOverlay";
import {
  loadSourceAvailabilityIndex,
  getSourceAvailability,
  updateSourceAvailability,
  buildSourceAvailabilityFromProviders,
} from "../services/sourceAvailabilityCacheService";
import { getEnabledProviderIds } from "../services/providerSearch";
import { consumePendingStoreDetailAppId, consumePendingStoreDetailAppTitle, onPendingStoreDetail } from "../services/storeNavigationService";
import { setPendingLibraryFocus } from "../services/libraryNavigationService";
import { useLibraryGames } from "../context/LibraryGamesContext";
import type { ProviderProgressCallback } from "../types/providerSearch";
import type { SourceAvailabilityGameEntry, SourceCheckStatus } from "../services/sourceAvailabilityCacheService";
import {
  getCachedStoreDiscover,
  setCachedStoreDiscover,
  getPersistedDiscoverFeatured,
  buildCatalogFingerprint,
  getCachedStoreUI,
  setCachedStoreUI,
  getCachedBrowseGames,
  setCachedBrowseGames,
  getCachedStoreMetadata,
  setCachedStoreMetadata,
  getCachedReviewSummaries,
  setCachedReviewSummaries,
  isCacheComplete,
  invalidateStoreDiscoverCache,
  DISCOVER_SCORING_VERSION,
  DISCOVERY_INDEX_VERSION,
  QG_GENRE_MIN_REVIEWS,
  QG_GENRE_MIN_SCORE,
  QG_GENRE_MIN_PCT,
} from "../services/storeDiscoverCache";
import type { CacheEntry as StoreDiscoverCacheEntry, StoreDiscoveryIndex } from "../services/storeDiscoverCache";
import type { StoreDiscoverSection, StoreGame } from "../services/storeDiscoverCache";
import type { StoreCatalogSection } from "../services/storeCatalogProvider";
import { mergeEnrichedSections } from "../services/storeCatalogOrchestrator";
import { buildCuratedCatalogSections } from "../services/storeCuratedCatalog";
import {
  compileDiscoveryIndex,
  getCachedDiscoveryIndex,
  setCachedDiscoveryIndex,
  invalidateDiscoveryIndex,
  loadDiscoveryIndexFromDisk,
  saveDiscoveryIndexToDisk,
  queryIndexTopPicks,
  qualifiesTopRated,
  qualifiesNew,
  logDiscoveryIndexValidation,
  logSteamDbSchema,
} from "../services/storeDiscoveryIndexService";
import {
  getDiscoverState,
  setDiscoverState,
  isDiscoverStateValid,
} from "../services/storeDiscoverStateCache";
import {
  resolveStoreDisplayImage,
  getStoreDisplayImage,
  getBestStoreImage,
  getStoreImageCacheSize,
  getStoreImageCacheVersion,
} from "../services/storeImageCache";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import type { SgdbArtworkData } from "../services/storeArtworkResolver";
import { buildSteamCdnUrl } from "../services/gameCacheService";
import { getAllDebridGames } from "../services/debridGameStore";
import { downloadFromSource as sharedDownloadFromSource } from "../features/download/downloadFromSource";
import {
  ensureCatalogImported,
  preFetchGenreGroups,
  getLocalGenreGroups,
  isLocalCatalogReady,
  queryFeaturedGames,
  queryNewNoteworthyGames,
  queryByGenre,
} from "../services/steamCatalogService";
import type { CatalogGameResult } from "../services/tauri";

const ENABLE_VERBOSE_SOURCE_LOGS = false;
const DEBUG_STORE_RENDER_VERBOSE = false;
const DEBUG_STORE_BADGE_DECISIONS = false;
const DEBUG_STORE_DISCOVERY = false;
const DEBUG_STORE_DETAILS_BOUNDARY = false;

/** Tracks how many providers have completed during concurrent resolution. */
type SourceProgress = {
  completed: number;
  total: number;
  successful: number;
  failed: number;
  sourceCount: number;
  requestId: number;
} | null;

/** Deterministic integer hash for shuffling (same input → same output). */
/** Convert a local catalog game to a StoreGame for section rendering. */
function catalogGameToStoreGame(g: CatalogGameResult): StoreGame {
  return {
    appId: String(g.appId),
    title: g.name,
    imageUrl: g.headerImage || g.capsuleImage || undefined,
    platforms: [],
    sources: [],
  };
}

  // Module-level flags for logging dedup
  let _catalogSourceLogged = false;
  let _discoveryIndexStatusLogged = false;

// ── Render cause counters (Phase 2 audit) ──
const _renderCauseCount: Record<string, number> = {};
let _renderCauseLogged = false;
function markRenderCause(cause: string) {
  _renderCauseCount[cause] = (_renderCauseCount[cause] ?? 0) + 1;
}
function logStoreRenderCauses() {
  if (_renderCauseLogged) return;
  _renderCauseLogged = true;
  const snapshot: Record<string, number> = {};
  for (const key of Object.keys(_renderCauseCount)) {
    if (_renderCauseCount[key] > 0) snapshot[key] = _renderCauseCount[key];
  }
  const sorted = Object.entries(snapshot).sort((a, b) => b[1] - a[1]);
  console.log(`[STORE][RENDER_CAUSE_AUDIT] totalCauses=${sorted.reduce((s, [, c]) => s + c, 0)} ${sorted.map(([n, c]) => `${n}=${c}`).join(" ")}`);
}

// Log throttle: only log section/genre counts when they change
let _lastSectionBuildLog = { sections: -1, genreReady: -1, more: -1 };
let _lastMoreRenderLog = { visible: -1, mounted: -1, pool: -1, rendered: -1 };
let _lastGenreGroupsLog: string | null = null;

// Phase 8: Module-level cache for the filtered "more to explore" pool.
// Avoids re-filtering 162k catalog entries on every render when only visibleCount changes.
let _cachedMorePool: { catalogFp: string; excludeFp: string; scoreFp: string; pool: { appid: number; name: string }[] } | null = null;
function computeExcludeFingerprint(games: { appId: string }[], sections: { games: { appId: string }[] }[]): string {
  const ids: string[] = [];
  for (const g of games) ids.push(g.appId);
  for (const s of sections) for (const g of s.games) ids.push(g.appId);
  ids.sort();
  return ids.slice(0, 500).join(",");
}

// Curated catalog baseline — computed once at module level.
// Provides immediate high-quality first paint before steamdb.json + metadata/reviews arrive.
const _curatedBaseline = buildCuratedCatalogSections();

function inferCuratedSectionType(id: string): "hero" | "featured" | "rail" | "genre" | "more" {
  if (id === "featured" || id === "top-picks") return "featured";
  return "rail";
}

function log(origin: string, ...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log(`[SourceResolve][${origin}]`, ...args);
  }
}


import { showWarning } from "../components/toast/GameToast";

import type { PackageGame, PackageSource } from "../types/package";
import type { InstalledLuaScript } from "../types/installedLua";
import type { PackageInstallStatus } from "../types/packageInstall";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type { AppPage } from "../types/navigation";
import { SkeletonBox, SkeletonHero, GridSkeleton } from "../components/common/Skeleton";

type StoreTab = "discover" | "browse" | "repacks";
type StoreProps = { onNavigate?: (page: AppPage) => void };

const VIRTUAL_CARD_STYLE: React.CSSProperties = {};

type StoreSectionModel = import("../services/storeDiscoverCache").StoreSectionModel;

type StoreBadge = {
  type: "recommended" | "trending" | "top-rated" | "popular" | "new" | "has-sources";
  label: string;
};

const METADATA_CONCURRENCY = 5;
const REVIEW_CONCURRENCY = 3;
const INITIAL_VISIBLE_COUNT = 40;

/**
 * Maximum number of More to Explore cards to mount in the DOM.
 * Logical visible count can be higher, but only this many are actually rendered.
 * Keeps React reconciliation fast when scrolling through hundreds of catalog items.
 */
const MORE_TO_EXPLORE_MOUNT_LIMIT = 24;

const DISPLAY_GENRES = ["Action", "Indie", "Racing", "Shooter", "RPG", "Adventure"];
/** Max catalog entries to score in highQualityPool — avoids processing all 162K+ on every review/metadata change */
const HIGH_QUALITY_POOL_MAX = 10000;
const PAGE_SIZE = 30;



const RANKING_WEIGHTS = {
  popularity: 0.35,
  metadata: 0.20,
  provider: 0.20,
  recency: 0.15,
  userInterest: 0.10,
} as const;

/** Maximum age in days for the "New" badge to show. */
const MIN_NEW_RELEASE_DAYS = 90;

type InteractionEvent = {
  type: "view" | "click" | "download";
  timestamp: number;
};

const EVENT_WEIGHTS: Record<InteractionEvent["type"], number> = {
  view: 1,
  click: 2,
  download: 4,
};

const TRENDING_LAMBDA = 0.00003;
const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRENDING_RECALC_MS = 120000;
const MAX_EVENTS_PER_GAME = 200;

const INTENT_WINDOW_MS = 30 * 60 * 1000;
const PREDICTION_BOOST_MULTIPLIER = 3;

const INTERACTION_STORAGE_KEY = "lumaforge-store-interactions-v1";
const INTERACTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const INTERACTION_PERSIST_DEBOUNCE_MS = 2000;

function loadPersistedInteractions(): { scores: Record<string, number>; events: Record<string, InteractionEvent[]> } {
  try {
    const raw = localStorage.getItem(INTERACTION_STORAGE_KEY);
    if (!raw) return { scores: {}, events: {} };
    const parsed = JSON.parse(raw);
    const now = Date.now();
    // Prune old events on load
    const events: Record<string, InteractionEvent[]> = {};
    const scores: Record<string, number> = parsed.scores ?? {};
    for (const [appId, evts] of Object.entries(parsed.events ?? {})) {
      const pruned = (evts as InteractionEvent[]).filter((e) => now - e.timestamp < INTERACTION_MAX_AGE_MS);
      if (pruned.length > 0) events[appId] = pruned;
    }
    return { scores, events };
  } catch { return { scores: {}, events: {} }; }
}

function dedupeGames(games: PackageGame[]): PackageGame[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    if (seen.has(game.appId)) return false;
    seen.add(game.appId);
    return true;
  });
}

function batchedLoad<T>(
  items: number[],
  loader: (batch: number[]) => Promise<Record<number, T>>,
  concurrency: number
): Promise<Record<number, T>> {
  return new Promise((resolve) => {
    let index = 0;
    const result: Record<number, T> = {};
    let active = 0;
    let done = false;

    function next() {
      while (active < concurrency && index < items.length) {
        const start = index;
        const end = Math.min(start + concurrency, items.length);
        const batch = items.slice(start, end);
        index = end;
        active++;

        loader(batch).then((partial) => {
          Object.assign(result, partial);
          active--;
          if (index >= items.length && active === 0 && !done) {
            done = true;
            resolve(result);
          } else {
            next();
          }
        }).catch(() => {
          active--;
          if (index >= items.length && active === 0 && !done) {
            done = true;
            resolve(result);
          } else {
            next();
          }
        });
      }
    }

    if (items.length === 0) {
      resolve(result);
      return;
    }

    next();
  });
}

export default function Store({ onNavigate }: StoreProps = {}) {
  countRender("Store");
  const {
    results,
    loading,
    setQuery,
  } = useProviderSearch();

  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();

  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");

  const {
    query: storeSearchQuery,
    setQuery: setStoreSearchQuery,
    results: storeGameSearchResults,
  } = useGameSearch({ debounceMs: 350 });

  const [steamSubmittedSearchGames, setSteamSubmittedSearchGames] = useState<
    PackageGame[]
  >([]);

  const [installedScripts, setInstalledScripts] = useState<
    InstalledLuaScript[]
  >([]);

  const [storeMetadataByAppId, setStoreMetadataByAppId] = useState<
    Record<number, SteamAppMetadata>
  >(() => {
    const cached = getCachedStoreMetadata();
    if (cached && Object.keys(cached).length > 0) {
      return cached as unknown as Record<number, SteamAppMetadata>;
    }
    return {};
  });

  const [reviewSummaryByAppId, setReviewSummaryByAppId] = useState<
    Record<number, SteamReviewSummary>
  >(() => {
    const cached = getCachedReviewSummaries();
    if (cached && Object.keys(cached).length > 0) {
      return cached as unknown as Record<number, SteamReviewSummary>;
    }
    return {};
  });

  const [providerOverlayByAppId, setProviderOverlayByAppId] = useState<
    Record<string, PackageGame>
  >({});

  const { activeStoreTab, setStoreTab: setActiveStoreTab } = useStoreTab();
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selectedDetailGame, setSelectedDetailGame] =
    useState<PackageGame | null>(null);

  const [sourceSelectorGame, setSourceSelectorGame] =
    useState<PackageGame | null>(null);

  const [selectedSourceKeyByAppId, setSelectedSourceKeyByAppId] = useState<
    Record<string, string>
  >({});

  const [browseFilters, setBrowseFilters] = useState<BrowseFilters>(
    DEFAULT_BROWSE_FILTERS
  );
  const [activeGenreSectionId, setActiveGenreSectionId] = useState<
    string | null
  >(null);

  const [browsePage, setBrowsePage] = useState(1);



  const [sourcesLoadingByAppId, setSourcesLoadingByAppId] = useState<
    Record<string, boolean>
  >({});
  const [backgroundCheckingByAppId, setBackgroundCheckingByAppId] = useState<
    Record<string, boolean>
  >({});
  const [sourceProgressByAppId, setSourceProgressByAppId] = useState<
    Record<string, SourceProgress>
  >({});

  const [steamCatalog, setSteamCatalog] = useState<{ appid: number; name: string }[]>(() => {
    const cached = getCachedStoreDiscover();
    if (cached) return cached.rankedSteamCatalog;
    return [];
  });
  const [visibleCount] = useState(() => {
    const ui = getCachedStoreUI();
    return ui?.visibleCount ?? INITIAL_VISIBLE_COUNT;
  });
  const [discoverMoreVisibleCount, setDiscoverMoreVisibleCount] = useState(() => {
    const ui = getCachedStoreUI();
    return ui?.discoverMoreVisibleCount ?? 0;
  });
  const [storeImageCacheVer, setStoreImageCacheVer] = useState(getStoreImageCacheVersion);
  // Phase: Deferred discover build trigger — incremented when boot becomes ready
  const [deferredBuildKey, setDeferredBuildKey] = useState(0);
  const bootPollRef = useRef<number | null>(null);
  const [selectedHeroIndex, setSelectedHeroIndex] = useState(() => {
    const ui = getCachedStoreUI();
    return ui?.selectedHeroIndex ?? 0;
  });
  // Phase 1+6: Audit log on mount — log state sources once
  const auditLogged = useRef(false);
  if (!auditLogged.current && (steamCatalog.length > 0 || getCachedStoreDiscover() !== null)) {
    auditLogged.current = true;
    const cached = getCachedStoreDiscover();
    const ds = getDiscoverState();
    console.log(
      `[STORE][STATE_AUDIT] cachedDiscover=${cached ? "yes" : "no"} ` +
      `cachedPartial=${cached?.isPartialCache ? "true" : cached ? "false" : "n/a"} ` +
      `cachedComplete=${cached ? isCacheComplete(cached) : false} ` +
      `discoverState=${ds ? "yes" : "no"} ` +
      `allSections=${cached?.allStoreSections?.length ?? 0} ` +
      `sectionModels=${cached?.discoverSections?.length ?? 0} ` +
      `featured=${cached?.featuredGames?.length ?? 0} ` +
      `more=${ds?.moreToExploreGames?.length ?? 0}`
    );
  }

  const catalogFingerprint = steamCatalog.length > 0 ? buildCatalogFingerprint(steamCatalog) : "";
  // Invalidate cache if scoring version changed — forces rebuild with new ranking/filtering
  const cachedDiscover = getCachedStoreDiscover();
  if (cachedDiscover && cachedDiscover.scoringVersion !== DISCOVER_SCORING_VERSION) {
    console.log(`[STORE][DISCOVERY_CACHE_INVALIDATE] reason=scoring-version-changed old=${cachedDiscover.scoringVersion} new=${DISCOVER_SCORING_VERSION}`);
    invalidateStoreDiscoverCache();
    invalidateDiscoveryIndex();
  } else if (cachedDiscover && cachedDiscover.scoringVersion === DISCOVER_SCORING_VERSION) {
    if (DEBUG_STORE_DISCOVERY) {
      console.log(`[STORE][DISCOVERY_CACHE_VERSION] version=${DISCOVER_SCORING_VERSION} valid=true`);
    }
  }

  // Invalidate discovery index if index version changed
  const cachedIndex = getCachedDiscoveryIndex();
  if (cachedIndex && cachedIndex.version !== DISCOVERY_INDEX_VERSION) {
    console.log(`[STORE][DISCOVERY_INDEX_INVALIDATE] reason=index-version-changed old=${cachedIndex.version} new=${DISCOVERY_INDEX_VERSION}`);
    invalidateDiscoveryIndex();
  }
  const cacheHitLogged = useRef(false);

  // On unmount, persist Store UI state for instant restore on re-entry
  const uiStateRef = useRef({
    activeStoreTab: "discover" as StoreTab,
    storeSearchQuery: "",
    submittedSearchQuery: "",
    browseFilters: DEFAULT_BROWSE_FILTERS,
    visibleCount: INITIAL_VISIBLE_COUNT,
    selectedHeroIndex: 0,
    selectedDetailAppId: null as string | null,
    browsePage: 1,
    activeGenreSectionId: null as string | null,
    discoverMoreVisibleCount: 0,
  });
  uiStateRef.current = {
    activeStoreTab,
    storeSearchQuery,
    submittedSearchQuery,
    browseFilters,
    visibleCount,
    selectedHeroIndex,
    selectedDetailAppId: null,
    browsePage,
    activeGenreSectionId,
    discoverMoreVisibleCount,
  };
  useEffect(() => {
    return () => {
      logStoreRenderCauses();
      setCachedStoreUI(uiStateRef.current);
    };
  }, []);

  const _persistedInteractionsRef = useRef(loadPersistedInteractions());
  const [interactionScoreByAppId, setInteractionScoreByAppId] = useState<Record<string, number>>(() => _persistedInteractionsRef.current.scores);
  const [interactionEventsByAppId, setInteractionEventsByAppId] = useState<
    Record<string, InteractionEvent[]>
  >(() => _persistedInteractionsRef.current.events);
  const [trendRecalcKey, setTrendRecalcKey] = useState(0);

  // Persist interaction data to localStorage (debounced, cross-session)
  const _persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (_persistTimerRef.current) clearTimeout(_persistTimerRef.current);
    _persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(INTERACTION_STORAGE_KEY, JSON.stringify({
          scores: interactionScoreByAppId,
          events: interactionEventsByAppId,
        }));
      } catch { /* quota exceeded — best-effort */ }
    }, INTERACTION_PERSIST_DEBOUNCE_MS);
    return () => { if (_persistTimerRef.current) clearTimeout(_persistTimerRef.current); };
  }, [interactionScoreByAppId, interactionEventsByAppId]);

  const sourceCacheLoadedRef = useRef(false);
  useEffect(() => {
    if (sourceCacheLoadedRef.current) return;
    sourceCacheLoadedRef.current = true;
    loadSourceAvailabilityIndex().catch((err) => console.warn(err));
    // Auto-import bundled catalog if not in SQLite, then pre-fetch genre groups + featured/new&noteworthy
    if (!isLocalCatalogReady()) {
      ensureCatalogImported()
        .then(async () => {
          await preFetchGenreGroups(DISPLAY_GENRES, 20);
          // Pre-fetch Featured + New & Noteworthy from local catalog
          try {
            const [featured, newNoteworthy] = await Promise.all([
              queryFeaturedGames(8),
              queryNewNoteworthyGames(8),
            ]);
            if (featured.games.length > 0) setCatalogFeaturedGames(featured.games);
            if (newNoteworthy.games.length > 0) setCatalogNewNoteworthyGames(newNoteworthy.games);
          } catch { /* non-critical */ }
        })
        .catch((err) => console.warn(err));
    }
  }, []);

  // Cancellation guard for async Tauri operations — prevents setState after unmount
  const _mountedRef = useRef(true);
  const _pendingTimeouts = useRef<Set<number>>(new Set());
  useEffect(() => {
    _mountedRef.current = true;
    return () => {
      _mountedRef.current = false;
      for (const id of _pendingTimeouts.current) clearTimeout(id);
      _pendingTimeouts.current.clear();
    };
  }, []);

  const { refresh: libraryRefresh } = useLibraryGames();
  const ownershipLookup = useGameOwnershipLookup();

  const pendingAppIdRef = useRef<string | null>(null);

  // Defer heavy Tauri invokes (metadata batch, review batch, lua scan) until after first paint
  const [storeFirstPaintDone, setStoreFirstPaintDone] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setStoreFirstPaintDone(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Store Catalog Orchestrator (RAWG enriched sections, cache-first) ──
  const [enrichedCatalogSections, setEnrichedCatalogSections] = useState<StoreCatalogSection[]>([]);
  const enrichedVersionRef = useRef(0);
  // Flicker prevention: track quality fingerprint of current enriched data
  const enrichedQualityRef = useRef<{ totalGames: number; sectionCount: number; curatedCount: number }>({ totalGames: 0, sectionCount: 0, curatedCount: 0 });

  // ── Local catalog async sections (Featured, New & Noteworthy) ──
  const [catalogFeaturedGames, setCatalogFeaturedGames] = useState<CatalogGameResult[]>([]);
  const [catalogNewNoteworthyGames, setCatalogNewNoteworthyGames] = useState<CatalogGameResult[]>([]);

  // ── Free catalog data (SteamSpy for top-players only, local catalog for trending/leaderboard/featured/hidden-gems/most-played) ──
  // Seed from cached discoverSections to prevent sections disappearing on remount (no keep-alive).
  function _seedFreeFromCache(sectionId: string): StoreGame[] {
    try {
      const cached = getCachedStoreDiscover();
      if (!cached?.discoverSections) return [];
      const sec = cached.discoverSections.find((s) => s.id === sectionId);
      return sec?.items ?? [];
    } catch { return []; }
  }
  const [freeRecentGames, setFreeRecentGames] = useState<StoreGame[]>(() => _seedFreeFromCache("free-recent"));
  const [freeTrendingGames, setFreeTrendingGames] = useState<StoreGame[]>(() => _seedFreeFromCache("free-trending"));
  const [freeTopByPlayersGames, setFreeTopByPlayersGames] = useState<StoreGame[]>(() => _seedFreeFromCache("free-top-players"));
  const [freeLeaderboardGames, setFreeLeaderboardGames] = useState<StoreGame[]>(() => _seedFreeFromCache("free-leaderboard"));
  const [freeFeaturedGames, setFreeFeaturedGames] = useState<StoreGame[]>(() => _seedFreeFromCache("free-featured"));
  const [freeHiddenGems, setFreeHiddenGems] = useState<StoreGame[]>(() => _seedFreeFromCache("free-hidden-gems"));
  const [freeMostPlayed, setFreeMostPlayed] = useState<StoreGame[]>(() => _seedFreeFromCache("free-most-played"));
  const [mostPlayedNow, setMostPlayedNow] = useState<StoreGame[]>(() => _seedFreeFromCache("most-played-now"));
  const [risingStars, setRisingStars] = useState<StoreGame[]>(() => _seedFreeFromCache("rising-stars"));
  const [freeCatalogLoading, setFreeCatalogLoading] = useState(false);


  // ── View All paginated state ──
  const [viewAllGames, setViewAllGames] = useState<CatalogGameResult[]>([]);
  const [viewAllLoading, setViewAllLoading] = useState(false);
  const [viewAllPage, setViewAllPage] = useState(1);
  const [viewAllHasMore, setViewAllHasMore] = useState(true);
  const viewAllPageRef = useRef(1);

  // Init orchestrator after first paint — loads disk cache, optionally triggers background refresh
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    let cancelled = false;
    (async () => {
      const { initCatalogOrchestrator, subscribeCatalogSections } = await import("../services/storeCatalogOrchestrator");
      await initCatalogOrchestrator({
        rawgApiKey: settings.rawgApiKey,
        igdbClientId: settings.igdbClientId,
        igdbClientSecret: settings.igdbClientSecret,
      });
      const unsub = subscribeCatalogSections((sections) => {
        if (cancelled) return;

        // Flicker prevention: only update if new quality >= current quality
        const newTotalGames = sections.reduce((sum, s) => sum + s.games.length, 0);
        const newCuratedCount = sections.filter((s) => s.provider === "curated").reduce((sum, s) => sum + s.games.length, 0);
        const newQuality = { totalGames: newTotalGames, sectionCount: sections.length, curatedCount: newCuratedCount };
        const cur = enrichedQualityRef.current;

        // Allow update if: more total games, OR same games but more sections, OR first load
        const isFirstLoad = cur.totalGames === 0 && cur.sectionCount === 0;
        const isQualityUpgrade = newQuality.totalGames >= cur.totalGames &&
          newQuality.sectionCount >= cur.sectionCount &&
          newQuality.curatedCount <= cur.curatedCount; // fewer curated = provider took over (good)

        if (!isFirstLoad && !isQualityUpgrade) {
          // New data is lower quality — skip update to prevent flicker
          console.log(`[STORE_CATALOG][FLICKER_GUARD] skipped update: newGames=${newTotalGames} newSections=${sections.length} curGames=${cur.totalGames} curSections=${cur.sectionCount}`);
          return;
        }

        enrichedQualityRef.current = newQuality;
        enrichedVersionRef.current++;
        setEnrichedCatalogSections([...sections]);
        // One-shot source chain diagnostic
        if (!_catalogSourceLogged) {
          _catalogSourceLogged = true;
          const providerSections = sections.filter((s) => s.provider !== "curated");
          const totalGames = sections.reduce((sum, s) => sum + s.games.length, 0);
          console.log(`[STORE_CATALOG][CACHE_STATUS] catalogCacheSections=${sections.length} catalogCacheTotalGames=${totalGames} catalogCacheValid=${sections.length > 0} source=${providerSections.length > 0 ? "provider" : "curated"}`);
        }
      });
      return unsub;
    })();
    return () => { cancelled = true; };
  }, [storeFirstPaintDone, settings.rawgApiKey, settings.igdbClientId, settings.igdbClientSecret]);

  // ── Free catalog data fetch (SteamSpy for recent/trending/top-players, local catalog for leaderboard/featured/hidden-gems/most-played) ──
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    let cancelled = false;
    setFreeCatalogLoading(true);
    (async () => {
      const { getRecentGames, getTrendingGames, getTopByPlayers, getLeaderboard, getFeaturedGames, getHiddenGems, getMostPlayed, getMostPlayedNow, getRisingStars } = await import("../services/freeCatalogService");
      try {
        // Recent = SteamSpy top100in2days (48h window — fresh releases)
        const recentPromise = getRecentGames(20).catch(() => ({ games: [] as StoreGame[] }));
        // Trending = SteamSpy top100in2weeks (2-week window — sustained momentum)
        const trendingPromise = getTrendingGames(20).catch(() => ({ games: [] as StoreGame[] }));

        const [recent, trending, players, leaderboard, featured, hiddenGems, mostPlayed, mpNow, rising] = await Promise.allSettled([
          recentPromise,
          trendingPromise,
          getTopByPlayers(20),
          getLeaderboard(20),
          getFeaturedGames(20),
          getHiddenGems(16),
          getMostPlayed(16),
          getMostPlayedNow(20),
          getRisingStars(20),
        ]);
        if (cancelled) return;

        // Dedup: when data is seeded from cache, skip setState if lengths match
        const newRecent = recent.status === "fulfilled" ? recent.value.games : [];
        const newTrending = trending.status === "fulfilled" ? trending.value.games : [];
        const newPlayers = players.status === "fulfilled" ? players.value.games : [];
        const newLeaderboard = leaderboard.status === "fulfilled" ? leaderboard.value.games : [];
        const newFeatured = featured.status === "fulfilled" ? featured.value.games : [];
        const newHiddenGems = hiddenGems.status === "fulfilled" ? hiddenGems.value.games : [];
        const newMostPlayed = mostPlayed.status === "fulfilled" ? mostPlayed.value.games : [];
        const newMpNow = mpNow.status === "fulfilled" ? mpNow.value.games : [];
        const newRising = rising.status === "fulfilled" ? rising.value.games : [];

        let changed = false;
        if (newRecent.length > 0 && newRecent.length !== freeRecentGames.length) { setFreeRecentGames(newRecent); changed = true; }
        if (newTrending.length > 0 && newTrending.length !== freeTrendingGames.length) { setFreeTrendingGames(newTrending); changed = true; }
        if (newPlayers.length > 0 && newPlayers.length !== freeTopByPlayersGames.length) { setFreeTopByPlayersGames(newPlayers); changed = true; }
        if (newLeaderboard.length > 0 && newLeaderboard.length !== freeLeaderboardGames.length) { setFreeLeaderboardGames(newLeaderboard); changed = true; }
        if (newFeatured.length > 0 && newFeatured.length !== freeFeaturedGames.length) { setFreeFeaturedGames(newFeatured); changed = true; }
        if (newHiddenGems.length > 0 && newHiddenGems.length !== freeHiddenGems.length) { setFreeHiddenGems(newHiddenGems); changed = true; }
        if (newMostPlayed.length > 0 && newMostPlayed.length !== freeMostPlayed.length) { setFreeMostPlayed(newMostPlayed); changed = true; }
        if (newMpNow.length > 0 && newMpNow.length !== mostPlayedNow.length) { setMostPlayedNow(newMpNow); changed = true; }
        if (newRising.length > 0 && newRising.length !== risingStars.length) { setRisingStars(newRising); changed = true; }

        const totalGames = newRecent.length + newTrending.length + newPlayers.length + newLeaderboard.length;
        console.log(`[STORE][FREE_CATALOG] loaded=${totalGames} recent=${newRecent.length} trending=${newTrending.length} players=${newPlayers.length} leaderboard=${newLeaderboard.length} mpNow=${newMpNow.length} rising=${newRising.length} changed=${changed}`);
      } catch (err) {
        console.warn("[STORE][FREE_CATALOG] failed:", err);
      } finally {
        if (!cancelled) setFreeCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storeFirstPaintDone]);

  const refreshInstalledScripts = useCallback(async () => {
    if (!settings.luaPath) {
      setInstalledScripts([]);
      return;
    }

    try {
      const scripts = await scanInstalledLuaScripts(settings.luaPath);
      setInstalledScripts(scripts);
    } catch (error) {
      console.error(error);
      setInstalledScripts([]);
    }
  }, [settings.luaPath]);

  useEffect(() => {
    if (!storeFirstPaintDone) return;
    refreshInstalledScripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.luaPath, storeFirstPaintDone]);

  // Load persisted discovery index from disk on mount
  const indexLoadedRef = useRef(false);
  useEffect(() => {
    if (indexLoadedRef.current) return;
    indexLoadedRef.current = true;
    loadDiscoveryIndexFromDisk().then((loaded) => {
      if (loaded && !_mountedRef.current) return;
      if (loaded && DEBUG_STORE_RENDER_VERBOSE) {
        console.log(`[STORE][DISCOVERY_INDEX_DISK_LOAD] version=${loaded.version} topPicks=${loaded.sections.topPicks.length} featured=${loaded.sections.featured.length}`);
      }
    }).catch((err) => console.warn(err));
  }, []);

  // On mount, consume any pending store detail appId set before Store mounted
  useEffect(() => {
    const pending = consumePendingStoreDetailAppId();
    if (pending) {
      pendingAppIdRef.current = pending;
      console.log(`[STORE][PENDING_NAV] appid=${pending} waiting for catalog`);
    }
  }, []);

  // Reactive: open details when a new pending appId is set while Store is already mounted
  useEffect(() => {
    function tryOpenPending() {
      const pending = consumePendingStoreDetailAppId();
      if (!pending) return;
      if (steamCatalog.length === 0) {
        pendingAppIdRef.current = pending;
        console.log(`[STORE][PENDING_NAV] appid=${pending} catalog not ready, deferring`);
        return;
      }
      const fallbackTitle = consumePendingStoreDetailAppTitle();
      const appIdNum = parseInt(pending, 10);
      const entry = steamCatalog.find((e) => e.appid === appIdNum);
      if (entry) {
        console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${pending} reason=notification-click`);
        openDetailsForGame({ appId: pending, title: entry.name, platforms: [], sources: [] });
      } else if (fallbackTitle) {
        console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${pending} reason=notification-fallback title=${fallbackTitle}`);
        openDetailsForGame({ appId: pending, title: fallbackTitle, platforms: [], sources: [] });
      } else {
        console.log(`[STORE][PENDING_NAV] appid=${pending} not found in catalog`);
      }
    }
    const unsub = onPendingStoreDetail(tryOpenPending);
    return unsub;
  }, [steamCatalog]);

  // Phase 8: Skip fetch if initialized from complete cache with valid fingerprint
  const skipCatalogFetch = useMemo(() => {
    const cached = getCachedStoreDiscover();
    if (cached && cached.rankedSteamCatalog.length > 0 && catalogFingerprint) {
      const cachedFp = cached.catalogFingerprint;
      if (cachedFp === catalogFingerprint && cached.isPartialCache !== true) {
        console.log(`[STORE][CATALOG_FETCH_SKIP] reason=complete-cache-present count=${cached.rankedSteamCatalog.length}`);
        return true;
      }
    }
    return false;
  }, [catalogFingerprint]);

  useEffect(() => {
    if (skipCatalogFetch) return;
    let cancelled = false;
    fetch("/data/steamdb.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ appid: number; name: string }[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setSteamCatalog(data);
          console.log(`[STORE][CATALOG_SOURCE] total=${data.length} source=steamdb.json`);
          logSteamDbSchema(data);
        }
      })
      .catch((err) => {
        console.error("[Store] Failed to load steamdb.json", err);
      });
    return () => { cancelled = true; };
  }, [skipCatalogFetch]);

  // Restore Store UI state from module-level cache on mount
  const restoreLoggedRef = useRef(false);
  useEffect(() => {
    if (restoreLoggedRef.current) return;
    restoreLoggedRef.current = true;

    const ui = getCachedStoreUI();
    if (ui) {
      if (ui.selectedHeroIndex !== undefined) setSelectedHeroIndex(ui.selectedHeroIndex);
      if (ui.activeStoreTab && ui.activeStoreTab !== activeStoreTab) {
        markRenderCause("cache-restore");
        setActiveStoreTab(ui.activeStoreTab as StoreTab);
      }
      if (ui.storeSearchQuery) setStoreSearchQuery(ui.storeSearchQuery);
      if (ui.submittedSearchQuery) setSubmittedSearchQuery(ui.submittedSearchQuery);
      if (ui.browsePage && ui.browsePage !== 1) setBrowsePage(ui.browsePage);
      if (ui.activeGenreSectionId !== undefined) setActiveGenreSectionId(ui.activeGenreSectionId);
      if (ui.discoverMoreVisibleCount !== undefined) setDiscoverMoreVisibleCount(ui.discoverMoreVisibleCount);
      // Do NOT auto-restore selectedDetailAppId — it was set to null in uiStateRef
      const cachedSections = getCachedStoreDiscover()?.allStoreSections?.length ?? 0;
      console.log(`[STORE][STATE_RESTORE] fromCache=true visibleCount=${ui.visibleCount} sections=${cachedSections}`);
    }

    // Validate whether the unified Discover state is complete after restore
    const discoverState = getDiscoverState();
    const isValid = isDiscoverStateValid(discoverState);
    if (discoverState && !isValid) {
      console.warn(`[STORE][DISCOVER_STATE_INCOMPLETE] fingerprint=${discoverState.fingerprint} featured=${discoverState.featuredGames.length} dynamic=${discoverState.dynamicDiscoverSections.length} moreToExplore=${discoverState.moreToExploreGames.length}`);
    } else if (isValid) {
      console.log(`[STORE][DISCOVER_STATE_RESTORED] fingerprint=${discoverState!.fingerprint} featured=${discoverState!.featuredGames.length} sections=${discoverState!.allStoreSections.length} moreToExplore=${discoverState!.moreToExploreGames.length}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When steamCatalog is loaded and there's a pending appId from mount, auto-open details.
  const openedPendingRef = useRef(false);
  useEffect(() => {
    if (steamCatalog.length === 0) return;
    if (openedPendingRef.current) return;
    const appIdStr = pendingAppIdRef.current;
    if (!appIdStr) return;
    openedPendingRef.current = true;

    const fallbackTitle = consumePendingStoreDetailAppTitle();
    const appIdNum = parseInt(appIdStr, 10);
    const entry = steamCatalog.find((e) => e.appid === appIdNum);
    if (entry) {
      console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${appIdStr} reason=pending-nav`);
      openDetailsForGame({ appId: appIdStr, title: entry.name, platforms: [], sources: [] });
    } else if (fallbackTitle) {
      console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${appIdStr} reason=pending-nav-fallback title=${fallbackTitle}`);
      openDetailsForGame({ appId: appIdStr, title: fallbackTitle, platforms: [], sources: [] });
    } else {
      console.log(`[STORE][PENDING_NAV] appid=${appIdStr} not found in catalog`);
    }
  }, [steamCatalog]);

  // React to store image cache changes — re-render when cache version bumps
  // Throttled to 5s to avoid re-rendering the whole Store on every image load.
  // Skipped entirely while user is interacting (scrolling/clicking/navigating).
  useEffect(() => {
    const id = setInterval(() => {
      if (isInteractionBusy()) return;
      const ver = getStoreImageCacheVersion();
      if (ver !== storeImageCacheVer) {
        markRenderCause("image-cache");
        setStoreImageCacheVer(ver);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [storeImageCacheVer]);

  // Recalculate trending scores every 30s
  useEffect(() => {
    const id = setInterval(() => { markRenderCause("trending"); setTrendRecalcKey((n) => n + 1); }, TRENDING_RECALC_MS);
    return () => clearInterval(id);
  }, []);

  // Recalculate trending on window focus
  useEffect(() => {
    const onFocus = () => { markRenderCause("trending"); setTrendRecalcKey((n) => n + 1); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const rankedSteamCatalog = useMemo(() => {
    if (steamCatalog.length === 0) return [];

    // Check module cache for instant restore on re-mount
    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint) {
      if (!cacheHitLogged.current) {
        cacheHitLogged.current = true;
        console.log(`[STORE][DISCOVER_CACHE_HIT] fingerprint=${catalogFingerprint} cachedAt=${new Date(cached.builtAt).toISOString()}`);
      }
      return cached.rankedSteamCatalog;
    }

    // Phase: Defer cold build during boot critical path — heavy over 162K games
    if (!isCacheComplete(cached) && !isBootReady()) {
      console.log(`[STORE][BUILD_DEFER] reason=boot-critical-no-complete-cache`);
      return [];
    }

    console.log(`[STORE][DISCOVER_BUILD_START] catalogSize=${steamCatalog.length}`);

    // Deterministic hash-shuffle so old games don't always appear first.
    // Same input → same output every time (no randomness).
    // Pre-compute hashes to avoid O(n log n) hash calls during sort.
    const hashCache = new Map<number, number>();
    const getHash = (appid: number) => {
      let h = hashCache.get(appid);
      if (h === undefined) {
        h = appid | 0;
        h = ((h >> 16) ^ h) * 0x45d9f3b;
        h = ((h >> 16) ^ h) * 0x45d9f3b;
        h = (h >> 16) ^ h;
        hashCache.set(appid, h);
      }
      return h;
    };
    const sorted = [...steamCatalog];
    sorted.sort((a, b) => getHash(a.appid) - getHash(b.appid));

    return sorted;
  }, [steamCatalog, catalogFingerprint, deferredBuildKey]);

  // Phase: Poll for boot readiness when discover build was deferred
  useEffect(() => {
    if (steamCatalog.length === 0) return;
    const cached = getCachedStoreDiscover();
    if (isCacheComplete(cached)) return;
    if (isBootReady()) return;

    if (bootPollRef.current) return; // already polling
    const id = window.setInterval(() => {
      if (isBootReady()) {
        window.clearInterval(id);
        bootPollRef.current = null;
        setDeferredBuildKey((k) => k + 1);
      }
    }, 300);
    bootPollRef.current = id;
    return () => {
      if (bootPollRef.current !== null) {
        window.clearInterval(bootPollRef.current);
        bootPollRef.current = null;
      }
    };
  }, [steamCatalog.length]);

  const genreConfidence = useMemo(() => {
    const scores: Record<string, number> = {};
    const now = Date.now();

    for (const [appId, events] of Object.entries(interactionEventsByAppId)) {
      const meta = storeMetadataByAppId[Number(appId)];
      if (!meta?.genres || meta.genres.length === 0) continue;

      const recent = events.filter((e) => now - e.timestamp < INTENT_WINDOW_MS);
      if (recent.length === 0) continue;

      const totalWeight = recent.reduce((sum, e) => sum + EVENT_WEIGHTS[e.type], 0);
      for (const genre of meta.genres) {
        scores[genre] = (scores[genre] ?? 0) + totalWeight;
      }
    }

    return scores;
  }, [interactionEventsByAppId, storeMetadataByAppId, trendRecalcKey]);

  const highQualityPool = useMemo(() => {
    if (rankedSteamCatalog.length === 0) return [];

    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint) {
      return cached.highQualityPool;
    }

    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[PERF][STORE_COMPUTE] highQualityPool catalogSize=${rankedSteamCatalog.length}`);
    // Cap to HIGH_QUALITY_POOL_MAX entries — scoring all 162K+ is wasteful
    const candidates = rankedSteamCatalog.length > HIGH_QUALITY_POOL_MAX
      ? rankedSteamCatalog.slice(0, HIGH_QUALITY_POOL_MAX)
      : rankedSteamCatalog;
    return candidates.map((entry) => {
      const id = String(entry.appid);
      const appIdNum = entry.appid;
      const overlay = providerOverlayByAppId[id];
      const meta = storeMetadataByAppId[appIdNum];
      const review = reviewSummaryByAppId[appIdNum];
      const interaction = interactionScoreByAppId[id] ?? 0;

      const metaScore = (meta?.header_image || meta?.capsule_image_v5) ? 1 : (meta ? 0.5 : 0);
      const provScore = (overlay && overlay.sources.some((s) => s.available)) ? 1 : 0;
      const recScore = 0;

      const totalReviews = review?.total_reviews ?? 0;
      const positivePct = review?.positive_percent ?? 0;
      const reviewQuality = totalReviews > 0
        ? Math.min(1, totalReviews / 50000) * 0.4 + (positivePct / 100) * 0.6
        : 0;
      const reviewConfidence = review?.resolved === true ? 1 : (review ? 0.5 : 0);

      const userScore = Math.min(1, interaction / 5);
      const predictionBoost = meta?.genres
        ? meta.genres.reduce((sum, g) => sum + (genreConfidence[g] ?? 0), 0) * PREDICTION_BOOST_MULTIPLIER
        : 0;

      const score =
        RANKING_WEIGHTS.popularity * reviewQuality * reviewConfidence +
        RANKING_WEIGHTS.metadata * metaScore +
        RANKING_WEIGHTS.provider * provScore +
        RANKING_WEIGHTS.recency * recScore +
        RANKING_WEIGHTS.userInterest * (userScore + predictionBoost);

      return {
        appId: id,
        title: entry.name,
        score,
        hasSource: provScore > 0,
        hasMeta: metaScore > 0,
      };
    }).sort((a, b) => b.score - a.score);
  }, [rankedSteamCatalog, providerOverlayByAppId, storeMetadataByAppId, reviewSummaryByAppId, interactionScoreByAppId, genreConfidence, catalogFingerprint]);

  // ── Compiled Discovery Index ──
  // A derived snapshot of enriched metadata + quality-gated scores for top candidates.
  // Compiled from already-cached data — no async I/O.
  const compiledDiscoveryIndex = useMemo<StoreDiscoveryIndex | null>(() => {
    if (highQualityPool.length === 0) return null;

    const cached = getCachedDiscoveryIndex();
    const cachedDiscover = getCachedStoreDiscover();
    // Return cached index when fingerprint matches and no new reviews have arrived
    if (cached && cached.version === DISCOVERY_INDEX_VERSION && Object.keys(reviewSummaryByAppId).length > 0) {
      if (cachedDiscover && cachedDiscover.catalogFingerprint === catalogFingerprint) {
        return cached;
      }
    }

    const index = compileDiscoveryIndex(
      highQualityPool,
      storeMetadataByAppId,
      reviewSummaryByAppId,
      genreConfidence,
      interactionScoreByAppId,
      rankedSteamCatalog.length || steamCatalog.length,
    );

    setCachedDiscoveryIndex(index);
    logDiscoveryIndexValidation(index);
    // One-shot discovery index status
    if (!_discoveryIndexStatusLogged) {
      _discoveryIndexStatusLogged = true;
      const hasFeatured = (index.sections.featured?.length ?? 0) > 0;
      const hasTopPicks = (index.sections.topPicks?.length ?? 0) > 0;
      const genreCount = Object.keys(index.sections.genres ?? {}).length;
      const hasReviews = (index.stats.withReviews ?? 0) > 0;
      console.log(`[STORE_CATALOG][DISCOVERY_INDEX_STATUS] featured=${hasFeatured} topPicks=${hasTopPicks} genres=${genreCount} withReviews=${index.stats.withReviews} qualityAvailable=${hasReviews || hasFeatured || hasTopPicks}`);
    }
    return index;
  }, [highQualityPool, storeMetadataByAppId, reviewSummaryByAppId, genreConfidence, interactionScoreByAppId, catalogFingerprint, steamCatalog.length]);

  // Save compiled discovery index to disk after build — skip if content unchanged
  const indexSaveRef = useRef<number>(0);
  const indexContentRef = useRef<string>("");
  useEffect(() => {
    if (!compiledDiscoveryIndex) return;
    if (indexSaveRef.current === compiledDiscoveryIndex.builtAt) return;
    // Skip save if content fingerprint matches (sections + score count unchanged)
    const contentFp = `${compiledDiscoveryIndex.sections.topPicks.length}:${compiledDiscoveryIndex.sections.featured.length}:${Object.keys(compiledDiscoveryIndex.sections.genres).length}:${Object.keys(compiledDiscoveryIndex.scores).length}`;
    if (indexContentRef.current === contentFp) return;
    indexSaveRef.current = compiledDiscoveryIndex.builtAt;
    indexContentRef.current = contentFp;
    saveDiscoveryIndexToDisk(compiledDiscoveryIndex).catch((err) => console.warn(err));
  }, [compiledDiscoveryIndex]);

  const trendingScoreByAppId = useMemo(() => {
    const scores: Record<string, number> = {};
    const now = Date.now();

    for (const [appId, events] of Object.entries(interactionEventsByAppId)) {
      if (events.length === 0) continue;
      let total = 0;
      for (const event of events) {
        const age = now - event.timestamp;
        const baseWeight = EVENT_WEIGHTS[event.type];
        const decayedWeight = baseWeight * Math.exp(-TRENDING_LAMBDA * age);
        total += decayedWeight;
      }
      if (total > 0.01) scores[appId] = total;
    }

    return scores;
  }, [interactionEventsByAppId, trendRecalcKey]);

  // Full catalog base — independent of visibleCount for Browse filters
  const catalogBaseGames = useMemo(() => {
    return rankedSteamCatalog.map((entry) => {
      const appId = String(entry.appid);
      const meta = storeMetadataByAppId[entry.appid];
      const cachedImage = getStoreDisplayImage(appId, "capsule") || getStoreDisplayImage(appId, "header");
      return {
        appId,
        title: entry.name,
        imageUrl: cachedImage || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
        platforms: meta?.platforms || [],
        sources: [] as PackageSource[],
      };
    });
    // NOTE: storeMetadataByAppId intentionally omitted from deps — imageUrl is best-effort
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedSteamCatalog]);

  // Visible catalog window — used by non-Browse consumers (discover sections, etc.)
  const catalogGames = useMemo(() => {
    const slice = catalogBaseGames.slice(0, visibleCount);
    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[Store] catalogGames: ${slice.length} / ${catalogBaseGames.length} games rendered (visibleCount: ${visibleCount})`);
    return slice;
  }, [catalogBaseGames, visibleCount]);

  const installedStatusByAppId = useMemo(() => {
    const map = new Map<string, PackageInstallStatus>();

    installedScripts.forEach((script) => {
      map.set(
        String(script.app_id),
        script.is_disabled ? "disabled" : "active"
      );
    });

    return map;
  }, [installedScripts]);

  const steamSearchItems: StoreSearchDropdownItem[] = useMemo(() => {
    return storeGameSearchResults.map((result) => {
      const luaActive = ownershipLookup.isLuaActive(result.appId) || installedStatusByAppId.get(result.appId) === "active";
      const enriched = enrichGameSearchResult(result, {
        owned: ownershipLookup.isOwned(result.appId),
        installed: ownershipLookup.isSteamInstalled(result.appId),
        luaActive,
      });
      const badgeLabels = enriched.owned
        ? enriched.installed
          ? "Owned, Installed"
          : "Owned, In Library"
        : enriched.installed
          ? "Installed"
          : luaActive
            ? "In Library"
            : "none";
      console.log(
        `[STORE][SEARCH_RESULT_STATE] appid=${result.raw.app_id} owned=${enriched.owned} installed=${enriched.installed} luaInstalled=${luaActive} inLibrary=${enriched.inLibrary} badgeLabels=${badgeLabels}`,
      );
      return mapEnrichedGameSearchResultToStoreSearchDropdownItem(enriched);
    });
  }, [storeGameSearchResults, ownershipLookup, installedStatusByAppId]);
 
  useEffect(() => {
    const allGames = [...catalogGames];

    if (allGames.length === 0) {
      return;
    }

    const hydrated: Record<string, PackageGame> = {};

    for (const game of allGames) {
      const cached = getSourceAvailability(game.appId);
      if (cached && cached.status === "ready" && cached.availableSources.length > 0) {
        hydrated[game.appId] = {
          ...game,
          sources: cached.availableSources.map((s) => ({
            providerId: s.id as any,
            providerName: s.name,
            fileType: s.type as any,
            available: s.status === "ready",
            downloadUrl: s.packageUrl,
          })),
        };
      }
    }

    if (Object.keys(hydrated).length > 0) {
      markRenderCause("overlay");
      setProviderOverlayByAppId((current) => ({
        ...current,
        ...hydrated,
      }));
    }
  }, [catalogGames]);

  const isSearchResultsView = submittedSearchQuery.trim().length > 0;

  const lumaForgeSections = useMemo(() => {
    const usedAppIds = new Set<string>();

    function takeUnique(games: PackageGame[], limit?: number) {
      const output: PackageGame[] = [];

      for (const game of games) {
        if (usedAppIds.has(game.appId)) {
          continue;
        }

        output.push(game);
        usedAppIds.add(game.appId);

        if (limit && output.length >= limit) {
          break;
        }
      }

      return output;
    }

    const featuredGames = takeUnique(results, 12);

    const installedGames = takeUnique(
      results.filter((game) => installedStatusByAppId.has(game.appId))
    );

    const recentlySupportedGames = takeUnique(
      results.filter((game) =>
        game.sources.some((source) => source.available)
      )
    );

    const sections: StoreSectionModel[] = [
      {
        id: "lumaforge-featured",
        title: "Lua Ready Games",
        description:
          "Juegos encontrados en tus providers compatibles con LumaForge.",
        games: featuredGames,
      },
      {
        id: "lumaforge-installed-supported",
        title: "Installed & Supported",
        description:
          "Juegos que ya tienen Lua instalado o detectado en tu biblioteca.",
        games: installedGames,
      },
      {
        id: "lumaforge-recently-supported",
        title: "Recently Supported",
        description:
          "Juegos con fuentes disponibles en providers configurados.",
        games: recentlySupportedGames,
      },
    ];

    return sections.filter((section) => section.games.length > 0);
  }, [results, installedStatusByAppId]);

  // Hydration gate for the hero (mirrors the discoverSections rail gate):
  // on a remount the pool starts as the curated baseline (Sekiro→Cyberpunk) while
  // enrichedCatalogSections (provider games Hades/CS2) hydrate async over ~500ms.
  // Without this restore, boot and navigating-back produced DIFFERENT hero content.
  // Restore the stable cached featuredGames (boot == return) until all critical
  // inputs are read; then recompute from the live, fully-loaded pool. Computed
  // OUTSIDE the memo so it participates in the dependency array — otherwise the
  // hero would stay persisted because none of the async inputs are memo deps.
  const featuredInputsReady =
    Object.keys(storeMetadataByAppId).length > 20 &&
    Object.keys(reviewSummaryByAppId).length > 0 &&
    installedStatusByAppId.size > 0 &&
    Object.keys(providerOverlayByAppId).length > 0 &&
    !freeCatalogLoading;

  const featuredGames = useMemo(() => {
    const HERO_MAX = 8;

    if (!featuredInputsReady) {
      const cachedFeatured = getCachedStoreDiscover();
      if (cachedFeatured && cachedFeatured.catalogFingerprint === catalogFingerprint && cachedFeatured.featuredGames && cachedFeatured.featuredGames.length >= 4 && !cachedFeatured.isPartialCache) {
        return cachedFeatured.featuredGames;
      }
      // Cold boot: the module-level cache is null and catalogFingerprint is "" until
      // steamdb.json loads, so the in-memory restore above can never hit. Fall back to
      // the persisted hero source (same list the return path recomputes) -> boot == return.
      const persistedFeatured = getPersistedDiscoverFeatured();
      if (persistedFeatured && persistedFeatured.length >= 4) {
        return persistedFeatured;
      }
    }

    // Deterministic day-seeded shuffle: Fisher-Yates with a hash of YYYY-MM-DD
    function daySeededShuffle<T>(arr: T[], seed: number): T[] {
      const out = [...arr];
      let s = seed;
      for (let i = out.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const j = s % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    function todaySeed(): number {
      const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }

    // Collect pool from all available featured/top-picks sections
    const pool: StoreGame[] = [];

    if (enrichedCatalogSections.length > 0) {
      for (const s of enrichedCatalogSections) {
        if (s.sectionId === "featured" || s.sectionId === "top-picks") {
          for (const game of s.games) {
            pool.push({
              appId: game.steamAppId ?? String(game.igdbId ?? game.rawgId ?? ""),
              title: game.title,
              imageUrl: game.imageUrl ?? game.backgroundImageUrl ?? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId ?? game.igdbId ?? game.rawgId ?? ""}/library_600x900.jpg`,
              platforms: [] as string[],
              sources: [] as PackageSource[],
            });
          }
        }
      }
    }

    if (pool.length === 0) {
      for (const s of _curatedBaseline) {
        if (s.sectionId === "featured" || s.sectionId === "top-picks") {
          for (const g of s.games) {
            pool.push({
              appId: g.steamAppId ?? g.id,
              title: g.title,
              imageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${g.steamAppId ?? g.id}/library_600x900.jpg`,
              platforms: [] as string[],
              sources: [] as PackageSource[],
            });
          }
        }
      }
    }

    if (pool.length === 0) {
      for (const s of highQualityPool.slice(0, 60)) {
        pool.push({
          appId: s.appId,
          title: s.title,
          imageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${s.appId}/library_600x900.jpg`,
          platforms: [] as string[],
          sources: [] as PackageSource[],
        });
      }
    }

    if (pool.length === 0) return [];

    // Dedupe by appId (same game could appear in featured + top-picks)
    const seen = new Set<string>();
    const unique = pool.filter((g) => {
      if (!g.appId || seen.has(g.appId)) return false;
      seen.add(g.appId);
      return true;
    });

    // Shuffle deterministically by day, pick first HERO_MAX
    const shuffled = daySeededShuffle(unique, todaySeed());
    return shuffled.slice(0, HERO_MAX);
  }, [highQualityPool, catalogFingerprint, enrichedCatalogSections, featuredInputsReady]);

  // ── Genre name normalization ──
  function normalizeGenreName(raw: string): string | null {
    const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9+\-_\s]/g, "").replace(/[-/]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    const known = new Map<string, string>([
      ["action", "Action"],
      ["indie", "Indie"],
      ["racing", "Racing"],
      ["race", "Racing"],
      ["shooter", "Shooter"],
      ["fps", "Shooter"],
      ["first person", "Shooter"],
      ["first-person", "Shooter"],
      ["rpg", "RPG"],
      ["role playing", "RPG"],
      ["role-playing", "RPG"],
      ["adventure", "Adventure"],
    ]);
    for (const [key, label] of known) {
      if (cleaned === key || cleaned.startsWith(key + " ") || cleaned.endsWith(" " + key) || cleaned.includes(" " + key + " ")) {
        return label;
      }
    }
    // Fuzzy match keywords within compound labels like "Action-Adventure"
    const tokens = cleaned.split(/\s+/);
    const matched = tokens.filter((t) => known.has(t));
    if (matched.length > 0) {
      // Return first matched display genre
      const first = known.get(matched[0]);
      if (first) return first;
    }
    return null;
  }

  // ── Rich Discover sections (new model) ──
  // Phase 2+3: Input fingerprint to skip expensive 300-line section builder when material inputs unchanged.
  const _sectionBuildFpRef = useRef({ fp: "", sections: null as StoreDiscoverSection[] | null });
  const _lastSectionBuildMsRef = useRef(0);
  // Freeze "For You" per catalog fingerprint: computed once per catalog, cached for the session.
  // Prevents the async hydration (~500ms) from re-windowing the personalized rail on every recomposition.
  const _forYouCacheRef = useRef({ fp: "", items: null as StoreGame[] | null });
  const discoverSections = useMemo(() => {
    const cached = getCachedStoreDiscover();

    // Hydration gate: keep returning cached sections until ALL critical async inputs are ready.
    // On remount, 5+ state slices hydrate over ~500ms (metadata, reviews, installed scripts,
    // provider overlays, enriched catalog). Each triggers a different section composition.
    // Returning cached sections until all inputs are present prevents 3-4 visible section
    // recompositions — the user sees the same stable sections from T+0 until the full rebuild.
    const _gateMeta = Object.keys(storeMetadataByAppId).length;
    const _gateReviews = Object.keys(reviewSummaryByAppId).length;
    const _gateInstalled = installedStatusByAppId.size;
    const _gateProviders = Object.keys(providerOverlayByAppId).length;
    // Free-catalog datasets load async AFTER first paint (SteamSpy / local catalog).
    // Holding cached sections while `freeCatalogLoading` prevents the async fetch from
    // replacing the stable cached sections with a progressively-built version on boot —
    // the same composition the user sees when navigating back into the Store.
    const allCriticalReady = _gateMeta > 20 && _gateReviews > 0 && _gateInstalled > 0 && _gateProviders > 0 && featuredGames.length > 0 && !freeCatalogLoading;

    if (cached && cached.catalogFingerprint === catalogFingerprint && cached.discoverSections && cached.discoverSections.length > 0 && !cached.isPartialCache && !allCriticalReady) {
      // Filter deprecated sections that may exist in stale caches
      const _COLD_DEPRECATED = new Set(["featured", "new-noteworthy"]);
      return cached.discoverSections.filter((s) => !_COLD_DEPRECATED.has(s.id));
    }

    // Phase 2+3: Skip full rebuild when material inputs haven't changed.
    // Fingerprint captures: metadata count, review count, installed count,
    // interaction count, provider overlay count, featured count, enriched sections, discovery index hash.
    const inputFp = [
      Object.keys(storeMetadataByAppId).length,
      Object.keys(reviewSummaryByAppId).length,
      installedStatusByAppId.size,
      Object.keys(interactionScoreByAppId).length,
      Object.keys(providerOverlayByAppId).length,
      featuredGames.length,
      enrichedCatalogSections.length,
      compiledDiscoveryIndex?.sections.topPicks.length ?? 0,
      highQualityPool.length,
      catalogFingerprint,
      freeRecentGames.length,
      freeTrendingGames.length,
      freeTopByPlayersGames.length,
      freeLeaderboardGames.length,
      freeFeaturedGames.length,
      freeHiddenGems.length,
      freeMostPlayed.length,
      mostPlayedNow.length,
      risingStars.length,
    ].join(":");
    if (_sectionBuildFpRef.current.fp === inputFp && _sectionBuildFpRef.current.sections) {
      return _sectionBuildFpRef.current.sections;
    }

    // Debounce: skip full rebuild if last build was <200ms ago (rapid input changes)
    const now = Date.now();
    if (_lastSectionBuildMsRef.current > 0 && now - _lastSectionBuildMsRef.current < 200 && _sectionBuildFpRef.current.sections) {
      return _sectionBuildFpRef.current.sections;
    }
    _lastSectionBuildMsRef.current = now;

    const usedIds = new Set<string>();
    lumaForgeSections.forEach((s) => s.games.forEach((g) => usedIds.add(g.appId)));
    featuredGames.forEach((g) => usedIds.add(g.appId));

    function takeUnique(games: StoreGame[], limit: number) {
      const out: StoreGame[] = [];
      for (const g of games) {
        if (usedIds.has(g.appId)) continue;
        usedIds.add(g.appId);
        out.push(g);
        if (out.length >= limit) break;
      }
      return out;
    }

    const sections: StoreDiscoverSection[] = [];

    // ── Curated baseline (immediate, no network, no metadata required) ──
    // Provides high-quality games on first load — enriched catalog replaces where quality is better.
    // The "featured" rail rotates DAILY with the same day-seeded set as the hero (featuredGames),
    // so the rail always mirrors the hero art instead of a static curated list.
    for (const cs of _curatedBaseline) {
      let items: StoreGame[] = cs.games.map((g) => ({
        appId: g.steamAppId ?? g.id,
        title: g.title,
        imageUrl: undefined,
        platforms: [] as string[],
        sources: [] as PackageSource[],
      }));
      if (cs.sectionId === "featured" && featuredGames.length > 0) {
        items = featuredGames.map((g) => ({
          appId: g.appId,
          title: g.title,
          imageUrl: g.imageUrl,
          platforms: g.platforms,
          sources: g.sources,
        }));
      }
      sections.push({
        id: cs.sectionId,
        title: cs.title,
        type: inferCuratedSectionType(cs.sectionId),
        items,
        source: "curated" as const,
      });
      // Mark curated games as used — steamdb sections won't duplicate them
      cs.games.forEach((g) => {
        const id = g.steamAppId ?? g.id;
        if (id) usedIds.add(id);
      });
    }

    // Filter to score>0 only — blocks completely un-scored games from premium sections
    const topHQ = highQualityPool.filter((s) => s.score > 0);

    const topGames: StoreGame[] = topHQ.map((s) => ({
      appId: s.appId,
      title: s.title,
      imageUrl: getBestStoreImage(s.appId, ["capsule", "header", "hero"]) || undefined,
      platforms: [] as string[],
      sources: [] as PackageSource[],
    }));

    // ── Free catalog sections (SteamSpy: recent (48h), trending (2wk), top-players; local catalog: leaderboard, featured, hidden gems, most played) ──
    if (freeRecentGames.length > 0) {
      const items = takeUnique(freeRecentGames, 20);
      if (items.length > 0) {
        sections.push({ id: "free-recent", title: "Recent Games", type: "rail", items, source: "catalog" as const });
      }
    }
    if (freeTrendingGames.length > 0) {
      const items = takeUnique(freeTrendingGames, 20);
      if (items.length > 0) {
        sections.push({ id: "free-trending", title: "Trending Now", type: "rail", items, source: "catalog" as const });
      }
    }
    if (freeTopByPlayersGames.length > 0) {
      const items = takeUnique(freeTopByPlayersGames, 20);
      if (items.length > 0) {
        sections.push({ id: "free-top-players", title: "Top by Players", type: "rail", items, source: "catalog" as const });
      }
    }
    if (freeLeaderboardGames.length > 0) {
      const items = takeUnique(freeLeaderboardGames, 20);
      if (items.length > 0) {
        sections.push({ id: "free-leaderboard", title: "Leaderboard", type: "featured", items, source: "catalog" as const });
      }
    }

    // ── Free catalog collection sections (local catalog: featured, hidden gems, most played) ──
    if (freeFeaturedGames.length > 0) {
      const items = takeUnique(freeFeaturedGames, 20);
      if (items.length > 0) {
        sections.push({ id: "free-featured", title: "Staff Picks", type: "featured", items, source: "catalog" as const });
      }
    }
    if (freeHiddenGems.length > 0) {
      const items = takeUnique(freeHiddenGems, 16);
      if (items.length > 0) {
        sections.push({ id: "free-hidden-gems", title: "Hidden Gems", type: "rail", items, source: "catalog" as const });
      }
    }
    if (freeMostPlayed.length > 0) {
      const items = takeUnique(freeMostPlayed, 16);
      if (items.length > 0) {
        sections.push({ id: "free-most-played", title: "Dedicated Fan Bases", type: "rail", items, source: "catalog" as const });
      }
    }
    if (mostPlayedNow.length > 0) {
      const items = takeUnique(mostPlayedNow, 6);
      if (items.length > 0) {
        sections.push({ id: "most-played-now", title: "Most Played Right Now", type: "rail", items, source: "catalog" as const });
      }
    }
    if (risingStars.length > 0) {
      const items = takeUnique(risingStars, 6);
      if (items.length > 0) {
        sections.push({ id: "rising-stars", title: "Rising Stars", type: "rail", items, source: "catalog" as const });
      }
    }

    // ── Build raw genre index BEFORE usedIds is heavily mutated ──
    const rawGenreGroups = new Map<string, StoreGame[]>();
    const metaCount = Object.keys(storeMetadataByAppId).filter((k) => {
      const m = storeMetadataByAppId[Number(k)];
      return m?.genres?.length;
    }).length;
    const gamesWithMetaCount = topGames.filter((g) => {
      const meta = storeMetadataByAppId[Number(g.appId)];
      return meta?.genres?.length;
    }).length;
    // Merge local catalog genre data first (pre-fetched from SQLite)
    const localGenreData = getLocalGenreGroups();
    if (localGenreData && localGenreData.size > 0) {
      for (const [genre, catalogGames] of localGenreData) {
        const list: StoreGame[] = [];
        for (const g of catalogGames) {
          if (list.length >= 20) break;
          const id = g.appId;
          list.push({
            appId: String(id),
            title: g.name,
            imageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
            platforms: [],
            sources: [],
          });
        }
        if (list.length > 0) rawGenreGroups.set(genre, list);
      }
      if (DEBUG_STORE_DISCOVERY) {
        console.log(`[STORE][GENRE_INDEX_READY] source=local-catalog genres=${localGenreData.size}`);
      }
    }
    // Supplement with runtime metadata enrichment (may add games already in catalog)
    for (const game of topGames) {
      const meta = storeMetadataByAppId[Number(game.appId)];
      if (!meta?.genres?.length) continue;
      const seenInGame = new Set<string>();
      for (const rawGenre of meta.genres) {
        const normalized = normalizeGenreName(rawGenre);
        if (!normalized || seenInGame.has(normalized)) continue;
        seenInGame.add(normalized);
        if (!rawGenreGroups.has(normalized)) rawGenreGroups.set(normalized, []);
        const list = rawGenreGroups.get(normalized)!;
        if (list.length < 20 && !list.some((g) => g.appId === game.appId)) list.push(game);
      }
    }
    if (metaCount > 0 && DEBUG_STORE_DISCOVERY && !localGenreData) {
      console.log(`[STORE][GENRE_INDEX_READY] source=metadata games=${metaCount} topGamesWithGenres=${gamesWithMetaCount}`);
    }

    const rawGenreCountsStr = DISPLAY_GENRES.map((g) => `${g}=${rawGenreGroups.get(g)?.length ?? 0}`).join(" ");
    const genreGroupsFingerprint = `${rawGenreGroups.size}:${rawGenreCountsStr}`;
    if (genreGroupsFingerprint !== _lastGenreGroupsLog) {
      _lastGenreGroupsLog = genreGroupsFingerprint;
      console.log(`[STORE][GENRE_GROUPS_RAW] genres=${rawGenreGroups.size} ${rawGenreCountsStr}`);
    }

    // --- For You (personalized genre overlap, was "Recommended for You") ---
    // Frozen per catalog fingerprint: reuse the first computed window for this catalog so the
    // personalized rail is stable across async hydration, recomputing only when the catalog truly changes.
    if (_forYouCacheRef.current.items && _forYouCacheRef.current.fp === catalogFingerprint) {
      const frozen = _forYouCacheRef.current.items;
      if (frozen.length > 0) {
        sections.push({ id: "for-you", title: "For You", type: "rail", items: frozen, source: "personalized" });
      }
    } else {
      const preferredGenres = new Set<string>();
      for (const [appIdStr, score] of Object.entries(interactionScoreByAppId)) {
        if (score > 0) {
          const meta = storeMetadataByAppId[Number(appIdStr)];
          if (meta?.genres) meta.genres.forEach((g) => preferredGenres.add(g));
        }
      }
      for (const [appIdStr] of installedStatusByAppId) {
        const meta = storeMetadataByAppId[Number(appIdStr)];
        if (meta?.genres) meta.genres.forEach((g) => preferredGenres.add(g));
      }

      if (preferredGenres.size > 0 || Object.keys(interactionScoreByAppId).length > 0) {
        const scored = topGames.map((g) => {
          let matchScore = 0;
          const meta = storeMetadataByAppId[Number(g.appId)];
          const gs = meta?.genres ?? [];
          const overlap = gs.filter((gen) => preferredGenres.has(gen)).length;
          matchScore += overlap * 3;
          const interaction = interactionScoreByAppId[g.appId] ?? 0;
          matchScore += interaction * 5;
          const predBoost = gs.reduce((sum, gen) => sum + (genreConfidence[gen] ?? 0), 0) * PREDICTION_BOOST_MULTIPLIER;
          matchScore += predBoost;
          if (installedStatusByAppId.has(g.appId)) matchScore = -999;
          return { game: g, score: matchScore };
        });
        scored.sort((a, b) => b.score - a.score);
        const rec = takeUnique(scored.filter((s) => s.score >= 0).map((s) => s.game), 20);
        if (rec.length > 0) {
          _forYouCacheRef.current = { fp: catalogFingerprint, items: rec };
          sections.push({ id: "for-you", title: "For You", type: "rail", items: rec, source: "personalized" });
        }
      }
    }

    // --- Top Picks (quality-gated: requires real review data + images) ---
    // Use compiled discovery index for pre-computed quality-gated picks when available
    // If the index has no picks after reviews are loaded, the section is hidden — no fallback garbage.
    const hasResolvedReviews = Object.values(reviewSummaryByAppId).some(
      (r) => r?.resolved === true && (r?.total_reviews ?? 0) > 0,
    );
    const topPickAppIds = compiledDiscoveryIndex ? queryIndexTopPicks(compiledDiscoveryIndex, 20) : [];
    if (topPickAppIds.length > 0) {
      const items = takeUnique(
        topPickAppIds
          .map((appId) => topGames.find((g) => g.appId === appId))
          .filter((g): g is StoreGame => g !== undefined),
        20,
      );
      if (items.length >= 2) {
        sections.push({ id: "top-picks", title: "Top Picks", type: "featured", items, source: "catalog" });
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_SECTION] name=Top Picks count=${items.length} appids=${JSON.stringify(items.map((i) => i.appId))} names=${JSON.stringify(items.map((i) => i.title))}`);
      } else {
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_FALLBACK] section=Top Picks reason=not-enough-unique items=${items.length}`);
      }
    } else if (!compiledDiscoveryIndex && !hasResolvedReviews) {
      // No index yet AND no reviews loaded — still waiting for data
      if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=Top Picks reason=waiting-for-reviews`);
    } else {
      // Reviews are loaded but no candidates passed the quality gate — hide section
      if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=Top Picks reason=no-qualified-candidates`);
    }

    // --- Genre collection cards (2×2 mosaic) — single section replacing individual genre rails ---
    const minGenreItems = metaCount < 100 ? 2 : 4;
    if (metaCount > 0 && metaCount < 100 && DEBUG_STORE_DISCOVERY) {
      console.log(`[STORE][GENRE_THRESHOLD] metaCount=${metaCount} minItems=${minGenreItems}`);
    }
    const genreGroupsForCollection: { genre: string; items: StoreGame[] }[] = [];
    for (const genre of DISPLAY_GENRES) {
      const candidates = rawGenreGroups.get(genre);
      if (!candidates || candidates.length < minGenreItems) {
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=${genre} reason=no-qualified-candidates`);
        continue;
      }
      // Quality gate: only include candidates with resolved reviews + review threshold
      const qualityGated = candidates.filter((g) => {
        const review = reviewSummaryByAppId[Number(g.appId)];
        return review?.resolved === true &&
          (review.total_reviews ?? 0) >= QG_GENRE_MIN_REVIEWS &&
          (review.review_score ?? 0) >= QG_GENRE_MIN_SCORE &&
          (review.positive_percent ?? 0) >= QG_GENRE_MIN_PCT;
      });
      // If reviews are loaded but no candidates pass quality gate, use metadata-only as fallback
      // Check both runtime metadata AND local catalog imageUrl (games from SQLite catalog have imageUrl but no storeMetadataByAppId entry)
      const effective = (hasResolvedReviews && qualityGated.length < minGenreItems)
        ? candidates.filter((g) => {
            const meta = storeMetadataByAppId[Number(g.appId)];
            return meta?.header_image || meta?.capsule_image_v5 || g.imageUrl;
          })
        : qualityGated.length >= minGenreItems ? qualityGated : candidates;
      if (effective.length < minGenreItems && hasResolvedReviews) {
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=${genre} reason=no-qualified-candidates`);
        continue;
      }
      // First try excluding globally usedIds; fallback to raw deduped list
      const uniqueNotUsed = effective.filter((g) => !usedIds.has(g.appId));
      const dedupedCandidates = [...new Map(effective.map((g) => [g.appId, g])).values()];
      const items = uniqueNotUsed.length >= minGenreItems
        ? takeUnique([...uniqueNotUsed], 4)
        : dedupedCandidates.slice(0, 4);
      if (items.length >= minGenreItems) {
        genreGroupsForCollection.push({ genre, items });
      } else {
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=genre-${genre.toLowerCase()} reason=no-qualified-candidates`);
      }
    }
    if (genreGroupsForCollection.length > 0) {
      sections.push({
        id: "browse-by-genre",
        title: "Browse by Genre",
        type: "genre-collection",
        items: [],
        source: "genre",
        genreGroups: genreGroupsForCollection,
      });
      if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][GENRE_COLLECTION] genres=${genreGroupsForCollection.length}`);
    }

    // (Lua Ready Picks section removed — broken, replaced by Browse filter)

    const genreReady = DISPLAY_GENRES.filter((g) => {
      const list = rawGenreGroups.get(g);
      return list && list.length >= minGenreItems;
    }).length;
    // Throttled: only log when values change
    if (sections.length !== _lastSectionBuildLog.sections || genreReady !== _lastSectionBuildLog.genreReady || highQualityPool.length !== _lastSectionBuildLog.more) {
      _lastSectionBuildLog = { sections: sections.length, genreReady, more: highQualityPool.length };
      console.log(`[STORE][DISCOVER_SECTIONS_BUILD] sections=${sections.length} genres=${genreReady} more=${highQualityPool.length}`);
    }

    // ── Dedupe sections by ID (curated takes priority — appears first in array) ──
    const DEPRECATED_SECTION_IDS = new Set(["featured", "new-noteworthy"]);
    const dedupedSections: StoreDiscoverSection[] = [];
    const seenSectionIds = new Set<string>();
    for (const sec of sections) {
      if (seenSectionIds.has(sec.id)) continue;
      if (DEPRECATED_SECTION_IDS.has(sec.id)) continue;
      seenSectionIds.add(sec.id);
      dedupedSections.push(sec);
    }

    // ── Merge enriched catalog sections (provider-first: IGDB/RAWG/curated) ──
    if (enrichedCatalogSections.length > 0) {
      const merged = mergeEnrichedSections(dedupedSections, enrichedCatalogSections);
      if (DEBUG_STORE_DISCOVERY) {
        const summary = merged.map((s) => `${s.id}:${s.items.length}:${s.source ?? "?"}`).join(" | ");
        console.log(`[STORE_CATALOG][FINAL_SECTION] curated+provider=true sections=${merged.length} ${summary}`);
      }
      _sectionBuildFpRef.current = { fp: inputFp, sections: merged };
      return merged;
    }

    // ── Curated IS the baseline — always available, no network needed ──
    const curatedCount = dedupedSections.filter((s) => s.source === "curated").reduce((sum, s) => sum + s.items.length, 0);
    if (DEBUG_STORE_DISCOVERY) console.log(`[STORE_CATALOG][FINAL_SECTION] curated=true sections=${dedupedSections.length} curatedGames=${curatedCount}`);
    _sectionBuildFpRef.current = { fp: inputFp, sections: dedupedSections };
    return dedupedSections;
  }, [lumaForgeSections, highQualityPool, storeMetadataByAppId, installedStatusByAppId, interactionScoreByAppId, providerOverlayByAppId, featuredGames, trendingScoreByAppId, genreConfidence, reviewSummaryByAppId, catalogFingerprint, compiledDiscoveryIndex, enrichedCatalogSections, catalogFeaturedGames, catalogNewNoteworthyGames, freeRecentGames, freeTrendingGames, freeTopByPlayersGames, freeLeaderboardGames, freeFeaturedGames, freeHiddenGems, freeMostPlayed, mostPlayedNow, risingStars]);

  // Backward-compat StoreSectionModel[] for consumers that still need it
  const sectionModels = useMemo<StoreSectionModel[]>(
    () => discoverSections.map((s) => ({ id: s.id, title: s.title, description: "", games: s.items as PackageGame[] })),
    [discoverSections],
  );

  // Determine if Discover sections are still pending (catalog loaded, metadata empty)
  const catalogLoaded = steamCatalog.length > 0;
  const discoverPending = catalogLoaded && discoverSections.length === 0;

  // ── "More to Explore" games for Discover tab ──
  // Uses discoverMoreVisibleCount (independent of catalogGames' visibleCount).
  // Show More affects only discoverMoreVisibleCount, not Browse.
  const _moreToExploreCacheRef = useRef<{ fp: string; result: PackageGame[] } | null>(null);
  const moreToExploreGames = useMemo(() => {
    const effectiveDiscoverCount = discoverMoreVisibleCount > 0 ? discoverMoreVisibleCount : INITIAL_VISIBLE_COUNT;

    // Lightweight input fingerprint — avoids expensive scoreLookup/excludeFp
    // when nothing semantically changed (only reference identity).
    const inputFp = [
      catalogFingerprint,
      effectiveDiscoverCount,
      featuredGames.length + ":" + featuredGames.slice(0, 3).map(g => g.appId).join(","),
      sectionModels.length + ":" + sectionModels.map(s => s.id + ":" + s.games.length).join("|"),
      highQualityPool.length,
      Object.keys(storeMetadataByAppId).length,
      rankedSteamCatalog.length,
    ].join("|");

    if (_moreToExploreCacheRef.current?.fp === inputFp) {
      return _moreToExploreCacheRef.current.result;
    }

    // Build score lookup from highQualityPool for sorting More to Explore
    const scoreLookup = new Map<string, number>();
    for (const hq of highQualityPool) {
      scoreLookup.set(hq.appId, hq.score);
    }

    // Lightweight score fingerprint (O(5)) to detect meaningful score changes
    const scoreFp = highQualityPool.length + ":" +
      highQualityPool.slice(0, 5).map(h => h.appId.slice(0, 8) + ":" + Math.round(h.score)).join(",");

    // Phase 8: Use module-level cached pool to avoid re-filtering 162k entries.
    // Only rebuild pool when catalog, exclusions, or scores change.
    const excludeFp = computeExcludeFingerprint(featuredGames, sectionModels);
    if (!_cachedMorePool || _cachedMorePool.catalogFp !== catalogFingerprint || _cachedMorePool.excludeFp !== excludeFp || _cachedMorePool.scoreFp !== scoreFp) {
      const excludeIds = new Set<string>();
      featuredGames.forEach((g) => excludeIds.add(g.appId));
      sectionModels.forEach((s) => s.games.forEach((g) => excludeIds.add(g.appId)));
      const seen = new Set<string>();
      const pool = rankedSteamCatalog.filter((entry) => {
        const appId = String(entry.appid);
        if (excludeIds.has(appId)) return false;
        if (seen.has(appId)) return false;
        seen.add(appId);
        return true;
      });
      // Sort by score descending for better quality in More to Explore
      pool.sort((a, b) => {
        const sa = scoreLookup.get(String(a.appid)) ?? 0;
        const sb = scoreLookup.get(String(b.appid)) ?? 0;
        return sb - sa;
      });
      _cachedMorePool = { catalogFp: catalogFingerprint, excludeFp, scoreFp, pool };
    }
    // else: pool is already sorted correctly, skip re-sort
    const pool = _cachedMorePool.pool;

    const games = pool.slice(0, effectiveDiscoverCount).map((entry) => {
      const appId = String(entry.appid);
      const meta = storeMetadataByAppId[entry.appid];
      return {
        appId,
        title: entry.name,
        imageUrl: meta?.header_image || `https://shared.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
        platforms: meta?.platforms || [],
        sources: [],
      };
    });
    const mounted = Math.min(games.length, MORE_TO_EXPLORE_MOUNT_LIMIT);
    const windowStart = 0;
    const windowEnd = mounted;
    // Throttled: only log when values change
    if (DEBUG_STORE_RENDER_VERBOSE && (effectiveDiscoverCount !== _lastMoreRenderLog.visible || mounted !== _lastMoreRenderLog.mounted || pool.length !== _lastMoreRenderLog.pool || games.length !== _lastMoreRenderLog.rendered)) {
      _lastMoreRenderLog = { visible: effectiveDiscoverCount, mounted, pool: pool.length, rendered: games.length };
      console.log(`[STORE][MORE_RENDER] logicalVisible=${effectiveDiscoverCount} mounted=${mounted} totalPool=${pool.length} rendered=${games.length}`);
      console.log(`[STORE][MORE_WINDOW] logicalVisible=${effectiveDiscoverCount} mounted=${mounted} start=${windowStart} end=${windowEnd}`);
    }
    _moreToExploreCacheRef.current = { fp: inputFp, result: games };
    return games;
  }, [rankedSteamCatalog, discoverMoreVisibleCount, featuredGames, sectionModels, storeMetadataByAppId, highQualityPool, catalogFingerprint]);

  const allStoreSections = useMemo(() => {
    // Always compute from memoized lumaForgeSections + sectionModels.
    // Cache reads are intentionally removed here: stale caches contain old
    // section structures (e.g. individual genre rails) that block new layouts
    // (e.g. mosaic browse-by-genre) from ever rendering.  Both arrays are
    // already memoized so the concat is effectively free.
    if (lumaForgeSections.length > 0 || sectionModels.length > 0) {
      return [...lumaForgeSections, ...sectionModels];
    }
    // Fallback: complete cache when nothing computed yet
    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint && isCacheComplete(cached) && cached.allStoreSections.length > 0) {
      return cached.allStoreSections;
    }
    return [];
  }, [lumaForgeSections, sectionModels, catalogFingerprint]);

  const browseGames = useMemo(() => {
    // Check dedicated Browse cache first
    const browseCached = getCachedBrowseGames(catalogFingerprint);
    if (browseCached && browseCached.browseGames.length > 0) {
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[PERF][STORE_COMPUTE] browseGames cache-hit count=${browseCached.browseGames.length}`);
      return browseCached.browseGames;
    }

    const t0 = performance.now();
    const gameMap = new Map<string, PackageGame>();

    // Source from steamdb.json (162K+ games) with Steam CDN image URLs
    for (const entry of steamCatalog) {
      const appId = String(entry.appid);
      if (!gameMap.has(appId)) {
        const capsuleUrl = buildSteamCdnUrl(appId, "capsule") || undefined;
        gameMap.set(appId, {
          appId,
          title: entry.name || `App ${entry.appid}`,
          imageUrl: capsuleUrl,
          platforms: ["windows"],
          sources: [] as PackageSource[],
        });
      }
    }

    // Merge provider overlays (games with known sources get their full data)
    lumaForgeSections.forEach((section) => {
      section.games.forEach((game) => {
        gameMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      });
    });

    results.forEach((game) => {
      gameMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
    });

    // Sort by appid ascending — oldest games first (natural SteamDB order)
    const games = Array.from(gameMap.values()).sort((a, b) => {
      const aId = Number(a.appId) || 0;
      const bId = Number(b.appId) || 0;
      return aId - bId;
    });

    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[PERF][STORE_COMPUTE] browseGames count=${games.length} elapsed=${(performance.now() - t0).toFixed(1)}ms`);
    return games;
  }, [steamCatalog, lumaForgeSections, results, providerOverlayByAppId, catalogFingerprint]);


  // ── Performance logs and cache save ──
  const storeRenderLogRef = useRef({ sections: 0, cards: 0 });
  const storeStartRef = useRef(Date.now());
  useEffect(() => {
    const totalCards = catalogGames.length;
    const totalSections = allStoreSections.length;
    const prev = storeRenderLogRef.current;
    if (prev.sections !== totalSections || prev.cards !== totalCards || Math.abs(totalCards - prev.cards) > 20) {
      // The browse tab paginates at PAGE_SIZE=30, so the actual DOM count is bounded
      const domEstimate = activeStoreTab === "browse" ? Math.min(PAGE_SIZE, totalCards) : totalSections * 20;
      console.log(`[STORE][WINDOW_RENDER] logicalVisible=${totalCards} domEstimate=${domEstimate} sections=${totalSections}`);
      storeRenderLogRef.current = { sections: totalSections, cards: totalCards };
    }

    // Phase 10: Skip cache write when complete cache with same fingerprint exists
    if (catalogFingerprint && rankedSteamCatalog.length > 0) {
      const existing = getCachedStoreDiscover();
      // Phase 10: Early skip — same fingerprint + complete cache + same section count
      if (existing && existing.catalogFingerprint === catalogFingerprint && !existing.isPartialCache && discoverSections.length > 0 && discoverSections.length === (existing.discoverSections?.length ?? 0)) {
        if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][CACHE_EFFECT_SKIP] reason=complete-cache-same-fingerprint sections=${discoverSections.length}`);
        // Still update Discover state for render path
        if (allStoreSections.length > 0 || featuredGames.length > 0) {
          setDiscoverState({
            fingerprint: catalogFingerprint,
            status: "complete",
            featuredGames,
            dynamicDiscoverSections: sectionModels,
            allStoreSections,
            lumaForgeSections,
            moreToExploreGames,
            selectedHeroIndex,
            builtAt: Date.now(),
          });
        }
        return;
      }

      // Phase 9: Metadata readiness — at least 50 games must have genre metadata
      // before we consider the state complete enough to cache as complete.
      // This ensures genre sections are populated before writing a "complete" cache entry.
      const metadataReadyCount = Object.values(storeMetadataByAppId).filter((m) => m?.genres?.length).length;
      const metadataReady = metadataReadyCount >= 50 || rankedSteamCatalog.length < 100;
      const stateComplete =
        featuredGames.length >= 4 &&
        discoverSections.length >= 5 &&
        moreToExploreGames.length >= 20 &&
        metadataReady;
      const fingerprintChanged = !existing || existing.catalogFingerprint !== catalogFingerprint;

      // Determine if we should write: complete always, partial only when no complete exists
      const countGenreSections = (sections: StoreDiscoverSection[] | undefined): number =>
        sections ? sections.filter((s) => s.source === "genre").length : 0;
      const existingGenreCount = existing ? countGenreSections(existing.discoverSections) : 0;
      const currentGenreCount = countGenreSections(discoverSections);

      // Write conditions: complete state, fingerprint change, genre upgrade, section upgrade
      const shouldUpgradeCache =
        fingerprintChanged ||
        (stateComplete && (!existing || existing.isPartialCache)) ||
        (stateComplete && currentGenreCount > existingGenreCount) ||
        (stateComplete && discoverSections.length > (existing?.discoverSections?.length ?? 0));

      if (shouldUpgradeCache) {
        if (!stateComplete) {
          // Partial write: only when no complete cache exists and boot is ready
          if (!isBootReady()) {
            console.log(`[STORE][PARTIAL_BUILD_DEFER] reason=boot-critical`);
          } else if (existing && isCacheComplete(existing)) {
            console.log(`[STORE][DISCOVER_CACHE_WRITE_SKIP] reason=complete-cache-exists currentPartial=true`);
          } else if (discoverSections.length === 0) {
            console.log(`[STORE][DISCOVER_CACHE_WRITE_SKIP] reason=sections-empty`);
          } else {
            const elapsedMs = Date.now() - storeStartRef.current;
            console.log(`[STORE][DISCOVER_CACHE_BUILD] partial=true featured=${featuredGames.length} sections=${discoverSections.length} more=${moreToExploreGames.length} elapsedMs=${elapsedMs}`);
            setCachedStoreDiscover({
              catalogFingerprint,
              scoringVersion: DISCOVER_SCORING_VERSION,
              rankedSteamCatalog,
              highQualityPool,
              dynamicDiscoverSections: sectionModels,
              discoverSections,
              lumaForgeSections,
              allStoreSections,
              featuredGames,
              browseGames: browseGames as unknown as StoreDiscoverCacheEntry["browseGames"],
              discoveryIndex: compiledDiscoveryIndex || undefined,
              builtAt: Date.now(),
              isPartialCache: true,
            });
            setCachedBrowseGames(browseGames as unknown as StoreDiscoverCacheEntry["browseGames"], catalogFingerprint);
          }
        } else {
          const elapsedMs = Date.now() - storeStartRef.current;
          const upgradeMsg = !existing || existing.isPartialCache ? "partial-to-complete" : currentGenreCount > existingGenreCount ? "more-genres" : "more-sections";
          console.log(`[STORE][DISCOVER_CACHE_UPGRADE] reason=${upgradeMsg}`);
          console.log(`[STORE][DISCOVER_CACHE_BUILD] complete=true featured=${featuredGames.length} sections=${discoverSections.length} more=${moreToExploreGames.length} elapsedMs=${elapsedMs}`);
            setCachedStoreDiscover({
              catalogFingerprint,
              scoringVersion: DISCOVER_SCORING_VERSION,
              rankedSteamCatalog,
              highQualityPool,
              dynamicDiscoverSections: sectionModels,
              discoverSections,
              lumaForgeSections,
              allStoreSections,
              featuredGames,
               browseGames: browseGames as unknown as StoreDiscoverCacheEntry["browseGames"],
               discoveryIndex: compiledDiscoveryIndex || undefined,
               builtAt: Date.now(),
            });
            setCachedBrowseGames(browseGames as unknown as StoreDiscoverCacheEntry["browseGames"], catalogFingerprint);
        }
      }

      // Phase 2+3: Also save the unified Discover render state with status
      if (allStoreSections.length > 0 || featuredGames.length > 0) {
        setDiscoverState({
          fingerprint: catalogFingerprint,
          status: stateComplete ? "complete" : "partial",
          featuredGames,
          dynamicDiscoverSections: sectionModels,
          allStoreSections,
          lumaForgeSections,
          moreToExploreGames,
          selectedHeroIndex,
          builtAt: Date.now(),
        });
      }
    }
  }, [
    catalogGames, allStoreSections, activeStoreTab,
    catalogFingerprint, rankedSteamCatalog, storeMetadataByAppId,
    featuredGames, discoverSections, moreToExploreGames,
    sectionModels, lumaForgeSections, browseGames,
    selectedHeroIndex, compiledDiscoveryIndex,
  ]);


  const filteredBrowseGames = useMemo(() => {
    // Phase 9: Skip heavy compute when Browse tab is inactive
    if (activeStoreTab !== "browse") {
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][COMPUTE_SKIP] target=filteredBrowseGames reason=inactive-tab`);
      return [];
    }

    let games = browseGames;

    if (activeGenreSectionId) {
      const section = allStoreSections.find(
        (s) => s.id === activeGenreSectionId
      );

      if (section) {
        const genreIds = new Set(section.games.map((g) => g.appId));
        games = games.filter((g) => genreIds.has(g.appId));
      }
    }

    const kw = browseFilters.keywords.toLowerCase().trim();

    if (kw) {
      games = games.filter(
        (g) =>
          g.title.toLowerCase().includes(kw) ||
          g.appId.toLowerCase().includes(kw) ||
          (g.developer && g.developer.toLowerCase().includes(kw))
      );
    }

    if (browseFilters.installed) {
      games = games.filter((g) => installedStatusByAppId.has(g.appId));
    }

    if (browseFilters.hasSource) {
      games = games.filter((g) => {
        const overlayed = providerOverlayByAppId[g.appId] ?? g;
        return overlayed.sources.length > 0;
      });
    }

    if (browseFilters.platforms.length > 0) {
      const platformSet = new Set(browseFilters.platforms);

      games = games.filter((g) => {
        const metadata = storeMetadataByAppId[Number(g.appId)];
        const platforms =
          metadata?.platforms?.length ? metadata.platforms : g.platforms;
        return platforms.some((p) => platformSet.has(p));
      });
    }

    if (browseFilters.sort !== "name") {
      games = [...games].sort((a, b) => {
        if (browseFilters.sort === "rating") {
          const aReview = reviewSummaryByAppId[Number(a.appId)];
          const bReview = reviewSummaryByAppId[Number(b.appId)];
          const aScore = aReview?.positive_percent ?? 0;
          const bScore = bReview?.positive_percent ?? 0;
          return bScore - aScore;
        }
        if (browseFilters.sort === "recent") {
          const aMeta = storeMetadataByAppId[Number(a.appId)];
          const bMeta = storeMetadataByAppId[Number(b.appId)];
          const aDate = aMeta?.release_date ?? "";
          const bDate = bMeta?.release_date ?? "";
          // When both have metadata dates, compare dates; otherwise fall back to appid (higher = newer)
          if (aDate && bDate) return bDate.localeCompare(aDate);
          if (aDate) return -1;
          if (bDate) return 1;
          return (Number(a.appId) || 0) - (Number(b.appId) || 0);
        }
        return a.title.localeCompare(b.title);
      });
    }

    return games;
  }, [
    browseGames,
    browseFilters,
    activeGenreSectionId,
    allStoreSections,
    providerOverlayByAppId,
    installedStatusByAppId,
    storeMetadataByAppId,
    reviewSummaryByAppId,
    activeStoreTab,
  ]);

  const activeSection = activeSectionId
    ? allStoreSections.find((section) => section.id === activeSectionId)
    : undefined;

  // ── View All: Load paginated catalog data when a section is opened ──
  const viewAllPageSize = 24;
  const viewAllInitializedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSectionId) {
      viewAllInitializedRef.current = null;
      return;
    }
    // Deduplicate: don't re-init for the same section
    if (viewAllInitializedRef.current === activeSectionId) return;
    viewAllInitializedRef.current = activeSectionId;

    // Reset pagination state
    setViewAllGames([]);
    setViewAllPage(1);
    viewAllPageRef.current = 1;
    setViewAllHasMore(true);

    // Genre sections: paginated catalog query
    const genreMatch = activeSectionId.match(/^genre-(.+)$/);
    if (genreMatch) {
      const genre = DISPLAY_GENRES.find((g) => g.toLowerCase() === genreMatch[1]) ?? genreMatch[1];
      setViewAllLoading(true);
      queryByGenre(genre, viewAllPageSize, 0)
        .then(({ games }) => {
          setViewAllGames(games);
          setViewAllHasMore(games.length >= viewAllPageSize);
        })
        .catch(() => setViewAllHasMore(false))
        .finally(() => setViewAllLoading(false));
      return;
    }

    // Non-genre sections (free-*, for-you, top-picks, etc.): use section's own games
    // Note: viewAllGames is set here for type compat, but the render path uses
    // activeSection.games directly (line ~3596) — so this is a safe cast.
    const section = allStoreSections.find((s) => s.id === activeSectionId);
    if (section && section.games.length > 0) {
      setViewAllGames(section.games as unknown as CatalogGameResult[]);
      setViewAllHasMore(false); // static — no more pages
    }
  }, [activeSectionId, allStoreSections]);

  // Load more page for View All
  const loadMoreViewAll = useCallback(async () => {
    const genreMatch = activeSectionId?.match(/^genre-(.+)$/);
    if (!genreMatch || viewAllLoading || !viewAllHasMore) return;

    const genre = DISPLAY_GENRES.find((g) => g.toLowerCase() === genreMatch[1]) ?? genreMatch[1];
    const nextPage = viewAllPage + 1;
    const offset = (nextPage - 1) * viewAllPageSize;

    setViewAllLoading(true);
    try {
      const { games } = await queryByGenre(genre, viewAllPageSize, offset);
      if (games.length > 0) {
        setViewAllGames((prev) => [...prev, ...games]);
        setViewAllPage(nextPage);
        viewAllPageRef.current = nextPage;
        setViewAllHasMore(games.length >= viewAllPageSize);
      } else {
        setViewAllHasMore(false);
      }
    } finally {
      setViewAllLoading(false);
    }
  }, [activeSectionId, viewAllLoading, viewAllHasMore, viewAllPage]);

  const selectedDetailGameWithOverlay = selectedDetailGame
    ? { ...selectedDetailGame, ...(providerOverlayByAppId[selectedDetailGame.appId] ?? {}) }
    : null;

  // Stable key for visibleAppIds to prevent render loops
  const appIdScopeKeyRef = useRef("");
  const reviewScopeKeyRef = useRef("");

  // Visible appIds for metadata loading - does NOT depend on storeMetadataByAppId
  // Phase 8: Reduced cap from 200→80. Detail game has its own dedicated effect (~line 2383).
  const visibleAppIds = useMemo(() => {
    const appIds = new Set<number>();

    // Base window: first INITIAL_VISIBLE_COUNT catalog games (covers browse pages 1-2)
    for (const game of catalogGames.slice(0, INITIAL_VISIBLE_COUNT)) {
      const appId = Number(game.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    }

    // On browse tab, also include current page + next page for deeper pagination
    if (activeStoreTab === "browse" && catalogGames.length > INITIAL_VISIBLE_COUNT) {
      const totalPages = Math.ceil(catalogGames.length / PAGE_SIZE) || 1;
      const safePage = Math.min(browsePage, totalPages);
      const startIdx = (safePage - 1) * PAGE_SIZE;
      const windowEnd = Math.min(startIdx + PAGE_SIZE * 2, catalogGames.length);
      for (const game of catalogGames.slice(startIdx, windowEnd)) {
        const appId = Number(game.appId);
        if (Number.isFinite(appId)) appIds.add(appId);
      }
    }

    results.forEach((game) => {
      const appId = Number(game.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    });

    allStoreSections.forEach((section) => {
      section.games.forEach((game) => {
        const appId = Number(game.appId);
        if (Number.isFinite(appId)) {
          appIds.add(appId);
        }
      });
    });

    steamSearchItems.forEach((item) => {
      const appId = Number(item.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    });

    steamSubmittedSearchGames.forEach((game) => {
      const appId = Number(game.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    });

    // Fold preload IDs directly into the single metadata batch — eliminates the race condition
    // from 3 concurrent useEffects all calling resolveGameMetadata simultaneously.
    // Effect 3 (smart preload) and Effect 4 (curated preload) are removed; their IDs live here.

    // High-quality pool: top-scored catalog entries for "More to Explore" + hero candidates
    for (const entry of highQualityPool.slice(0, 12)) {
      const id = Number(entry.appId);
      if (Number.isFinite(id)) appIds.add(id);
    }

    // Featured games — ensures hero images are available on first paint
    for (const game of featuredGames) {
      const id = Number(game.appId);
      if (Number.isFinite(id)) appIds.add(id);
    }

    // First items of each section — ensures section headers render with metadata
    for (const section of allStoreSections) {
      for (const game of section.games.slice(0, 3)) {
        const id = Number(game.appId);
        if (Number.isFinite(id)) appIds.add(id);
      }
    }

    // NOTE: selectedDetailGame excluded from this batch — handled by dedicated detail effect below (line ~2383)

    const ids = Array.from(appIds);
    // Phase 9: Cap metadata fetch scope — 100 covers hero + sections + preload IDs.
    // Detail game gets its own effect; section games beyond the cap load on scroll.
    const METADATA_WINDOW_MAX = 200;
    const capped = ids.length > METADATA_WINDOW_MAX ? ids.slice(0, METADATA_WINDOW_MAX) : ids;
    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][METADATA_WINDOW_LOAD] requested=${ids.length} capped=${capped.length}`);
    return capped;
    // NOTE: storeMetadataByAppId intentionally NOT in deps to avoid render loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogGames, results, allStoreSections, steamSearchItems, steamSubmittedSearchGames, activeStoreTab, browsePage, highQualityPool, featuredGames]);

  const visibleAppIdsKey = visibleAppIds.join(",");

  // Only reload metadata when the key actually changes
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (visibleAppIdsKey === appIdScopeKeyRef.current) return;
    appIdScopeKeyRef.current = visibleAppIdsKey;

    if (visibleAppIds.length === 0) {
      // Preserve metadata for the detail game (which is excluded from visibleAppIds)
      setStoreMetadataByAppId((prev) => {
        const detailId = selectedDetailGameWithOverlay ? Number(selectedDetailGameWithOverlay.appId) : 0;
        if (detailId > 0 && prev[detailId]) return { [detailId]: prev[detailId] };
        return {};
      });
      return;
    }

    let cancelled = false;

    async function loadStoreMetadata() {
      if (DEBUG_STORE_RENDER_VERBOSE) {
        const isDetailOpen = !!selectedDetailGame;
        console.log(`[STORE][METADATA_RESOLVE_SCOPE] count=${visibleAppIds.length} scope=${isDetailOpen ? "discovery+detail" : "discovery"} detail=${isDetailOpen ? selectedDetailGame.appId : "none"}`);
      }
      try {
        const metadata = await batchedLoad(
          visibleAppIds,
          resolveGameMetadata,
          METADATA_CONCURRENCY
        );

        if (!cancelled) {
          // Only update if metadata actually changed — avoids re-rendering all cards
          // Merge into existing map to preserve metadata for games not in this batch
          // (e.g. the detail game from global search, which has its own dedicated effect)
          const current = storeMetadataByAppId;
          const keys = Object.keys(metadata);
          let changed = false;
          for (const key of keys) {
            const k = Number(key);
            const m = metadata[k];
            const c = current[k];
            if (!m) continue;
            if (!c || m.name !== c.name || m.developer !== c.developer ||
                m.header_image !== c.header_image ||
                m.capsule_image !== c.capsule_image ||
                m.capsule_image_v5 !== c.capsule_image_v5 ||
                JSON.stringify(m.genres?.slice().sort()) !== JSON.stringify(c.genres?.slice().sort()) ||
                JSON.stringify(m.platforms?.slice().sort()) !== JSON.stringify(c.platforms?.slice().sort()) ||
                JSON.stringify(m.movies) !== JSON.stringify(c.movies) ||
                JSON.stringify(m.screenshots?.slice().sort()) !== JSON.stringify(c.screenshots?.slice().sort()) ||
                m.short_description !== c.short_description ||
                m.about_the_game !== c.about_the_game ||
                m.detailed_description !== c.detailed_description ||
                m.release_date !== c.release_date ||
                m.resolved !== c.resolved) {
              changed = true;
              break;
            }
          }
          if (!changed) {
            if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][METADATA_SKIP] reason=unchanged keys=${keys.length}`);
            return;
          }
          markRenderCause("metadata");
          setStoreMetadataByAppId((prev) => ({ ...prev, ...metadata }));
          if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[Store] metadata loaded: ${Object.keys(metadata).length} games resolved`);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          // On batch error, keep existing metadata (don't wipe detail game's resolved data)
          if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][METADATA_BATCH_ERROR] keeping existing cache`);
        }
      }
    }

    loadStoreMetadata();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAppIdsKey, storeFirstPaintDone]);

  // Persist metadata to module-level cache so it survives mount/unmount
  useEffect(() => {
    if (Object.keys(storeMetadataByAppId).length > 0) {
      setCachedStoreMetadata(storeMetadataByAppId as unknown as Record<number, Record<string, unknown>>);
    }
  }, [storeMetadataByAppId]);

  // Persist review summaries to module-level cache (same pattern as metadata)
  useEffect(() => {
    if (Object.keys(reviewSummaryByAppId).length > 0) {
      setCachedReviewSummaries(reviewSummaryByAppId as unknown as Record<number, Record<string, unknown>>);
    }
  }, [reviewSummaryByAppId]);

  // Dedicated metadata load for the selected detail game.
  // The visibleAppIds batch effect (above) caps at 80 IDs dominated by Browse catalog.
  // Detail games from local-catalog sections often fall outside that window.
  // This effect guarantees metadata is loaded for whichever game the user opens.
  const _detailMetadataReqRef = useRef(0);
  const _metadataRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function fetchDetailMetadata(appId: number, reqId: number, retryCount = 0) {
    resolveGameMetadata([appId], { skipInFlight: true })
      .then((metadata) => {
        if (!_mountedRef.current) return;
        if (reqId !== _detailMetadataReqRef.current) return;
        const meta = metadata[appId];
        if (meta && meta.resolved) {
          setStoreMetadataByAppId((prev) => ({ ...prev, [appId]: meta }));
        } else if (retryCount === 0) {
          // First attempt failed — retry once after 2s
          console.log(`[STORE][METADATA_RETRY] appId=${appId} retrying-in-2s`);
          _metadataRetryTimer.current = setTimeout(() => {
            if (_mountedRef.current && reqId === _detailMetadataReqRef.current) {
              fetchDetailMetadata(appId, reqId, 1);
            }
          }, 2000);
        } else {
          // Retry also failed — write resolved fallback so page renders
          const fallback = createResolvedFallbackMetadata(appId, meta?.name);
          setStoreMetadataByAppId((prev) => ({ ...prev, [appId]: fallback }));
        }
      })
      .catch((err) => {
        if (!_mountedRef.current) return;
        if (reqId !== _detailMetadataReqRef.current) return;
        if (retryCount === 0) {
          console.log(`[STORE][METADATA_RETRY] appId=${appId} retrying-in-2s err=${String(err).slice(0, 60)}`);
          _metadataRetryTimer.current = setTimeout(() => {
            if (_mountedRef.current && reqId === _detailMetadataReqRef.current) {
              fetchDetailMetadata(appId, reqId, 1);
            }
          }, 2000);
        } else {
          const fallback = createResolvedFallbackMetadata(appId);
          setStoreMetadataByAppId((prev) => ({ ...prev, [appId]: fallback }));
        }
      });
  }

  useEffect(() => {
    const appId = Number(selectedDetailGameWithOverlay?.appId);
    if (!appId || appId <= 0) return;

    const existing = storeMetadataByAppId[appId];
    if (existing && existing.resolved) return;

    const reqId = ++_detailMetadataReqRef.current;
    if (_metadataRetryTimer.current) { clearTimeout(_metadataRetryTimer.current); _metadataRetryTimer.current = null; }

    fetchDetailMetadata(appId, reqId, 0);

    return () => {
      if (_metadataRetryTimer.current) { clearTimeout(_metadataRetryTimer.current); _metadataRetryTimer.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetailGameWithOverlay?.appId]);

  // Pre-populate Store image cache for visible app IDs (display-only, no local media index)
  // Re-runs when metadata loads so URLs become available for cached Discover sections.
  // resolveStoreDisplayImage is idempotent — calls for already-cached entries are no-ops.
  // Defer via requestIdleCallback to avoid blocking the main thread on mount.
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (visibleAppIds.length === 0) return;
    if (!_mountedRef.current) return;
    if (isInteractionBusy()) {
      if (ENABLE_VERBOSE_SOURCE_LOGS) console.log(`[STORE][IMAGE_CACHE_SEED_SKIP] reason=interaction-busy`);
      return;
    }
    const rafId = requestIdleCallback(() => {
      if (!_mountedRef.current) return;
      let seeded = 0;
      for (const appIdNum of visibleAppIds) {
        const appId = String(appIdNum);
        const meta = storeMetadataByAppId[appIdNum];
        const existingCapsule = getStoreDisplayImage(appId, "capsule");
        if (!existingCapsule) {
          resolveStoreDisplayImage(appId, "capsule", {
            catalogCapsule: meta?.capsule_image_v5,
            catalogHeader: meta?.capsule_image,
            metadataCapsule: meta?.capsule_image_v5,
            metadataHeader: meta?.header_image,
          });
        }
        const existingHeader = getStoreDisplayImage(appId, "header");
        if (!existingHeader) {
          resolveStoreDisplayImage(appId, "header", {
            catalogCapsule: meta?.capsule_image_v5,
            catalogHeader: meta?.capsule_image,
            metadataCapsule: meta?.capsule_image_v5,
            metadataHeader: meta?.header_image,
          });
        }
        if (!existingCapsule || !existingHeader) seeded++;
      }
      if (seeded > 0) {
        if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][IMAGE_CACHE_SEED] newlySeeded=${seeded}/${visibleAppIds.length} cacheSize=${getStoreImageCacheSize()}`);
      }
    }, { timeout: 500 });
    return () => cancelIdleCallback(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAppIdsKey, storeMetadataByAppId]);

  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (visibleAppIdsKey === reviewScopeKeyRef.current) return;
    reviewScopeKeyRef.current = visibleAppIdsKey;

    if (visibleAppIds.length === 0) {
      setReviewSummaryByAppId({});
      return;
    }

    let cancelled = false;

    async function loadReviewSummaries() {
      const appIdSet = new Set(visibleAppIds);
      const appIdList = Array.from(appIdSet);
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][REVIEWS_FETCH_START] appids=${JSON.stringify(appIdList)} count=${appIdList.length}`);
      try {
        const summaries = await batchedLoad(
          appIdList,
          resolveGameReviewSummaries,
          REVIEW_CONCURRENCY
        );

        if (!cancelled) {
          const resolvedCount = Object.values(summaries).filter((s: SteamReviewSummary) => s.resolved).length;
          if (DEBUG_STORE_RENDER_VERBOSE) {
            for (const [appId, summary] of Object.entries(summaries)) {
              const s = summary as SteamReviewSummary;
              console.log(`[STORE][REVIEWS_FETCH_RESULT] appid=${appId} resolved=${s.resolved} total=${s.total_reviews} score=${s.review_score} label=${s.review_score_desc} pct=${s.positive_percent}`);
            }
          }
          setReviewSummaryByAppId(summaries);
          if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][REVIEWS_FETCH_DONE] count=${Object.keys(summaries).length} resolved=${resolvedCount}`);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setReviewSummaryByAppId({});
        }
      }
    }

    loadReviewSummaries();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAppIdsKey, storeFirstPaintDone]);

  // SGDB artwork for Store cards + hero — cover for cards, hero for carousel
  const sgdbScopeRef = useRef("");
  const [sgdbArtworkByAppId, setSgdbArtworkByAppId] = useState<Record<string, SgdbArtworkData>>({});

  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (!settings.steamGridDbArtworkEnabled || !settings.steamGridDbApiKey) return;
    if (visibleAppIdsKey === sgdbScopeRef.current) return;
    sgdbScopeRef.current = visibleAppIdsKey;
    if (visibleAppIds.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await resolveArtworkForAppIds(visibleAppIds, settings.steamGridDbApiKey);
        if (!cancelled && Object.keys(result).length > 0) {
          setSgdbArtworkByAppId((prev) => ({ ...prev, ...result }));
        }
      } catch {
        // silent — cards gracefully fall back to Steam CDN
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAppIdsKey, storeFirstPaintDone, settings.steamGridDbArtworkEnabled, settings.steamGridDbApiKey]);

  // Part 8: Dedicated review fetch for the selected detail game.
  // Ensures the details page gets review data even if the main batch didn't include it yet.
  useEffect(() => {
    const detailAppId = selectedDetailGameWithOverlay?.appId;
    if (!detailAppId) return;

    const appIdNum = Number(detailAppId);
    if (!Number.isFinite(appIdNum)) return;

    // If review already loaded, just log state and return
    const existing = reviewSummaryByAppId[appIdNum];
    if (existing) {
      const state = existing.resolved && existing.total_reviews > 0 ? "available" : existing.resolved && existing.total_reviews === 0 ? "no-reviews" : "unavailable";
      console.log(`[STORE][REVIEWS_DETAIL_STATE] appid=${detailAppId} state=${state} source=cached`);
      return;
    }

    let cancelled = false;
    async function fetchDetailReview() {
      console.log(`[STORE][REVIEWS_DETAIL_FETCH_START] appid=${detailAppId}`);
      try {
        const summaries = await resolveGameReviewSummaries([appIdNum]);
        if (cancelled) return;
        const summary = summaries[appIdNum];
        if (summary) {
          console.log(`[STORE][REVIEWS_DETAIL_FETCH_RESULT] appid=${detailAppId} resolved=${summary.resolved} total=${summary.total_reviews} score=${summary.review_score} label=${summary.review_score_desc} pct=${summary.positive_percent}`);
        }
        setReviewSummaryByAppId((prev) => ({ ...prev, ...summaries }));
      } catch (error) {
        console.error(error);
      }
    }
    fetchDetailReview();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDetailGameWithOverlay?.appId]);

  const selectedDetailRelatedGames = useMemo<StoreMoreLikeThisGame[]>(() => {
    if (!selectedDetailGameWithOverlay) {
      return [];
    }

    const selectedId = selectedDetailGameWithOverlay.appId;
    const selectedMeta = storeMetadataByAppId[Number(selectedId)];
    const selectedDeveloper = selectedMeta?.developer?.toLowerCase() ?? "";
    const selectedPublishers = selectedMeta?.publishers ?? [];
    const selectedGenres = selectedMeta?.genres ?? [];

    // Build a score lookup — prefer compiled discovery index for richer scores
    const indexScoreMap = new Map<string, number>();
    if (compiledDiscoveryIndex) {
      for (const [appId, s] of Object.entries(compiledDiscoveryIndex.scores)) {
        indexScoreMap.set(appId, s.final);
      }
    } else {
      for (const hq of highQualityPool) {
        indexScoreMap.set(hq.appId, hq.score);
      }
    }

    const candidateMap = new Map<string, PackageGame>();

    catalogGames.forEach((game) => {
      if (game.appId !== selectedId) {
        candidateMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      }
    });

    allStoreSections.forEach((section) => {
      section.games.forEach((game) => {
        if (game.appId !== selectedId) {
          candidateMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
        }
      });
    });

    results.forEach((game) => {
      if (game.appId !== selectedId) {
        candidateMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      }
    });

    const scored = Array.from(candidateMap.values()).reduce<{ game: PackageGame; score: number; reasons: string[] }[]>((acc, game) => {
      const meta = storeMetadataByAppId[Number(game.appId)];
      const review = reviewSummaryByAppId[Number(game.appId)];
      const reasons: string[] = [];
      if (!meta || !meta.genres?.length) {
        acc.push({ game, score: 0, reasons: ["no-metadata"] });
        return acc;
      }
      let score = 0;
      const dev = meta.developer?.toLowerCase() ?? "";
      const pubs = meta.publishers ?? [];
      const genres = meta.genres ?? [];
      if (selectedDeveloper && dev === selectedDeveloper) { score += 4; reasons.push("same-dev"); }
      for (const pub of pubs) {
        if (selectedPublishers.some((sp) => sp.toLowerCase() === pub.toLowerCase())) {
          score += 2;
          reasons.push("same-pub");
          break;
        }
      }
      const sharedGenres = genres.filter((g) => selectedGenres.some((sg) => sg.toLowerCase() === g.toLowerCase()));
      if (sharedGenres.length > 0) { score += sharedGenres.length; reasons.push(`genres=${sharedGenres.length}`); }
      // Review/popularity boost — use review count as popularity proxy
      if (review && review.resolved && (review.total_reviews ?? 0) > 0) {
        const reviewCountFactor = Math.min(1, (review.total_reviews ?? 0) / 50000);
        const positivePctFactor = (review.positive_percent ?? 50) / 100;
        const reviewBoost = (reviewCountFactor * 0.5 + positivePctFactor * 0.5) * 3;
        score += reviewBoost;
        reasons.push(`review=${review.total_reviews}`);
      }
      // Image availability bonus
      if (meta?.header_image || meta?.capsule_image_v5) {
        score += 1;
        reasons.push("has-image");
      }
      // Discovery index score bonus (prefers games with metadata/reviews)
      const idxScore = indexScoreMap.get(game.appId) ?? 0;
      if (idxScore > 0) {
        score += idxScore * 2;
        reasons.push(`idx=${idxScore.toFixed(2)}`);
      }
      if (score === 0) {
        reasons.push("no-relevance-match");
      }
      acc.push({ game, score, reasons });
      return acc;
    }, []);

    // Log per-candidate scores for the selected game
    const scoredWithReasons = scored.filter((s) => s.score > 0).slice(0, 15);
    for (const s of scoredWithReasons) {
      console.log(`[STORE][MORE_LIKE_SCORE] target=${selectedId} candidate=${s.game.appId} score=${s.score.toFixed(2)} reasons=${s.reasons.join(",")} title=${s.game.title}`);
    }
    // Log candidates filtered out (score === 0)
    const filteredOut = scored.filter((s) => s.score === 0).slice(0, 5);
    for (const s of filteredOut) {
      console.log(`[STORE][MORE_LIKE_FILTER] target=${selectedId} candidate=${s.game.appId} reason=score-zero ${s.reasons.join(",")} title=${s.game.title}`);
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score > 0).slice(0, 12);

    const maxScore = top.length > 0 ? top[0].score : 0;

    const rawCount = candidateMap.size;
    const keptCount = top.length;
    const appIds = top.slice(0, keptCount).map((s) => s.game.appId);
    console.log(`[STORE][MORE_LIKE_RAW] appid=${selectedId} source=catalog candidateCount=${rawCount}`);
    console.log(`[STORE][MORE_LIKE_NORMALIZED] appid=${selectedId} count=${keptCount} maxScore=${maxScore.toFixed(2)} appids=${JSON.stringify(appIds)}`);

    if (keptCount === 0) {
      console.log(`[STORE][MORE_LIKE_FALLBACK] appid=${selectedId} reason=hidden-no-relevant-candidates maxScore=${maxScore}`);
      return [];
    }

    return top.map(({ game }) => ({
      game,
      metadata: storeMetadataByAppId[Number(game.appId)],
      reviewSummary: reviewSummaryByAppId[Number(game.appId)],
      installStatus:
        installedStatusByAppId.get(game.appId) ?? "not-installed",
    }));
  }, [
    selectedDetailGameWithOverlay,
    catalogGames,
    allStoreSections,
    results,
    providerOverlayByAppId,
    storeMetadataByAppId,
    reviewSummaryByAppId,
    installedStatusByAppId,
    highQualityPool,
    compiledDiscoveryIndex,
  ]);

  function getSelectedSourceForGame(game: PackageGame): PackageSource | undefined {
    const key = selectedSourceKeyByAppId[game.appId];
    if (key) {
      const match = game.sources.find((s) => getSourceKey(s) === key);
      if (match) return match;
    }
    return getBestAvailableSource(game);
  }

  function pushInteractionEvent(appId: string, type: InteractionEvent["type"]) {
    const now = Date.now();
    setInteractionEventsByAppId((prev) => {
      const events = prev[appId] ?? [];
      const updated = [...events, { type, timestamp: now }];
      // Keep only most recent events within the time window
      const cutoff = now - TRENDING_WINDOW_MS;
      const pruned = updated.filter((e) => e.timestamp >= cutoff);
      if (pruned.length > MAX_EVENTS_PER_GAME) {
        return { ...prev, [appId]: pruned.slice(-MAX_EVENTS_PER_GAME) };
      }
      return { ...prev, [appId]: pruned };
    });
  }

  const openSourceSelectorForGame = useCallback((game: PackageGame) => {
    markRenderCause("source-selector");
    setSourceSelectorGame(game);
  }, []);

  const sourceResolveReqRef = useRef(0);

  function tryLoadOverlayCache(appId: string) {
    try {
      const enabledProviderIds = getEnabledProviderIds(settings);
      const overlayCache = loadStoreProviderOverlayCache();
      const cacheKey = `${appId}::${enabledProviderIds.slice().sort().join(",")}`;
      const cached = overlayCache[cacheKey];
      if (cached && cached.game && Array.isArray(cached.game.sources) && cached.game.sources.length > 0) {
        const overlayHasImage = !!cached.game.imageUrl;
        const overlaySourceReady = cached.game.sources.some((s) => s.available);
        log("store-search", `overlay cache hit { appId: "${appId}", hasImage: ${overlayHasImage}, sourceReady: ${overlaySourceReady} }`);
        setProviderOverlayByAppId((current) => ({
          ...current,
          [appId]: cached.game,
        }));
        if (ENABLE_VERBOSE_SOURCE_LOGS) console.log(`[STORE][SOURCES_LOAD] appid=${appId} savedSelected=${overlaySourceReady} provider=${cached.game.sources.find(s => s.available)?.providerName || "unknown"} status=ready`);
        return true;
      }
    } catch (e) {
      log("store-search", `overlay cache error { appId: "${appId}", error: ${e} }`);
    }
    return false;
  }

  function openDetailsForGame(game: PackageGame) {
    if (ENABLE_VERBOSE_SOURCE_LOGS) console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${game.appId} reason=click`);
    // Push to navigation history so ← can come back to Store
    window.dispatchEvent(new CustomEvent("lumaforge-store-detail-open"));
    if (DEBUG_STORE_DETAILS_BOUNDARY) {
      const appIdNum = Number(game.appId);
      console.log(`[STORE_DETAILS_BOUNDARY][OPEN] callerSurface=store-card rawAppId=${game.appId} normalizedAppId=${appIdNum} title=${game.title} source=local-catalog-or-browse existingCallback=openDetailsForGame`);
    }
    const appId = game.appId;
    const cached = getSourceAvailability(appId);

    // CRITICAL PATH — show detail panel immediately
    markRenderCause("detail");
    setActiveSectionId(null);

    // Fast path: hydrate from cache if possible
    if (cached && cached.status === "ready" && (game.sources ?? []).length === 0) {
      const hydratedGame: PackageGame = {
        ...game,
        sources: cached.availableSources.map((s) => ({
          providerId: s.id as any,
          providerName: s.name,
          fileType: s.type as any,
          available: s.status === "ready",
          downloadUrl: s.packageUrl,
        })),
      };
      setSelectedDetailGame(hydratedGame);
    } else {
      setSelectedDetailGame(game);
    }

    if (cached?.status === "ready") {
      tryLoadOverlayCache(appId);
      return;
    }

    // Part 7: Set loading synchronously before deferring — prevents false "No Sources" flash
    if (!cached || cached.status === "idle" || cached.status === "checking" || cached.status === "error" || cached.status === "timeout" || cached.status === "needs-configuration") {
      setSourcesLoadingByAppId((current) => ({
        ...current,
        [appId]: true,
      }));
      setSourceProgressByAppId((current) => ({
        ...current,
        [appId]: { completed: 0, total: 0, successful: 0, failed: 0, sourceCount: 0, requestId: 0 },
      }));
    }

    // DEFERRED PATH — analytics + source resolution (outside click handler)
    // Note: status "none" is no longer blocked here — always re-check so stale "none" results
    // from a previous failed discovery don't permanently block source resolution on click.
    const requestId = ++sourceResolveReqRef.current;
    const title = game.title;
    scheduleSourceResolve(requestId, appId, title, game);
  }

  function scheduleSourceResolve(
    requestId: number,
    appId: string,
    title: string,
    game: PackageGame,
  ) {
    const timeoutId = window.setTimeout(() => {
      _pendingTimeouts.current.delete(timeoutId);
      if (!_mountedRef.current) return;
      if (requestId !== sourceResolveReqRef.current) return;

      pushInteractionEvent(appId, "view");
      pushInteractionEvent(appId, "click");
      setInteractionScoreByAppId((prev) => ({
        ...prev,
        [appId]: (prev[appId] ?? 0) + 1,
      }));

      log("store-search", `start { appId: "${appId}", title: "${title}" }`);
      log("store-search", `cache miss { appId: "${appId}" }`);

      // Owned or non-installed Lua games should not trigger provider resolution.
      if (ownershipLookup.isOwned(appId) || (!ownershipLookup.isSteamInstalled(appId) && ownershipLookup.isLuaActive(appId))) {
        console.log(`[STORE][SOURCE_SKIP_NO_PROVIDER_NEEDED] appid=${appId} owned=${ownershipLookup.isOwned(appId)} luaOnly=${!ownershipLookup.isSteamInstalled(appId) && ownershipLookup.isLuaActive(appId)}`);
        setSourcesLoadingByAppId((current) => ({ ...current, [appId]: false }));
        return;
      }

      // Part 7: Loading already set synchronously in openDetailsForGame.
      // Only set here as a safety fallback (e.g. when called from handleSelectSearchItem).
      setSourcesLoadingByAppId((current) => ({
        ...current,
        [appId]: true,
      }));

      updateSourceAvailability(appId, {
        appId,
        title,
        status: "checking",
        luaReady: false,
        availableSources: [],
        sourceCount: 0,
        totalProviderCount: 0,
        updatedAt: Math.floor(Date.now() / 1000),
      }).catch((err) => console.warn(err));

      const foregroundStartedAt = Date.now();
      const onEarlyResult: ProviderProgressCallback = (result) => {
        if (requestId !== sourceResolveReqRef.current) return;

        console.log(`[STORE][PROVIDER_DISCOVERY_EARLY_RESULT] appid=${result.appId} provider=${result.providerName} available=${result.source.available}`);

        // Part 11: Update source progress counter
        setSourceProgressByAppId((current) => {
          const prev = current[appId];
          if (!prev || prev.requestId !== requestId) {
            return { ...current, [appId]: { completed: 1, total: result.totalEnabled, successful: result.source.available ? 1 : 0, failed: result.source.available ? 0 : 1, sourceCount: result.allSources.length, requestId } };
          }
          const nextCompleted = prev.completed + 1;
          return { ...current, [appId]: { completed: nextCompleted, total: result.totalEnabled, successful: prev.successful + (result.source.available ? 1 : 0), failed: prev.failed + (result.source.available ? 0 : 1), sourceCount: result.allSources.length, requestId } };
        });

        setProviderOverlayByAppId((current) => ({
          ...current,
          [appId]: {
            ...game,
            sources: result.allSources,
          },
        }));

        const entry = buildSourceAvailabilityFromProviders(appId, title, result.allSources, result.totalEnabled);
        // Only save partial results when at least one source is available, or status is meaningful
        // Prevents onEarlyResult from overwriting "checking" with transient empty results
        if (entry.status === "ready" || entry.status === "needs-configuration" || entry.status === "error" || entry.status === "timeout") {
          updateSourceAvailability(appId, entry).catch((err) => console.warn(err));
        } else {
          log("store-search", `early-skip-empty { appId: "${appId}", provider: "${result.providerName}", availability: ${result.source.available} }`);
        }

        if (result.source.available) {
          const currentEntry = getSourceAvailability(appId);
          const alreadySelected = currentEntry?.selectedSourceId;
          if (!alreadySelected) {
            // First available provider — unblock UI immediately
            setSourcesLoadingByAppId((prev) => ({
              ...prev,
              [appId]: false,
            }));
            setBackgroundCheckingByAppId((prev) => ({
              ...prev,
              [appId]: true,
            }));
            console.log(`[STORE][SOURCE_READY_EARLY] appid=${appId} provider=${result.providerName} checking=false backgroundChecking=true`);
            console.log(`[STORE][PROVIDER_DISCOVERY_FAST_DONE] appid=${appId} selectedProvider=${result.providerName} elapsedMs=${Date.now() - foregroundStartedAt}`);
          } else {
            console.log(`[STORE][SOURCE_BACKGROUND_MERGE] appid=${appId} provider=${result.providerName} count=${result.allSources.length}`);
          }
        }
      };

      resolveProviderOverlaysForStoreGames([game], settings, onEarlyResult)
        .then((overlays) => {
          if (requestId !== sourceResolveReqRef.current) return;

          const overlayGame = overlays[appId];
          if (overlayGame) {
            setProviderOverlayByAppId((current) => ({
              ...current,
              [appId]: overlayGame,
            }));
          }

          const resolvedGame = overlayGame ?? game;
          const totalProviders = resolvedGame.sources.length;
          const hasPreview = !!(resolvedGame.imageUrl && isHttpUrl(resolvedGame.imageUrl));

          const successes = resolvedGame.sources.filter(s => s.available).length;
          const timedOut = resolvedGame.sources.filter(s => !s.available && s.error?.toLowerCase().includes("timeout")).length;
          const skipped = resolvedGame.sources.filter(s => !s.available && s.error?.toLowerCase().includes("cooldown")).length;
          console.log(`[STORE][PROVIDER_DISCOVERY_BACKGROUND_DONE] appid=${appId} total=${totalProviders} successes=${successes} skipped=${skipped} timedOut=${timedOut}`);
          resolvedGame.sources.forEach(s => {
            console.log(`[STORE][PROVIDER_DISCOVERY_RESULT_DETAIL] appid=${appId} provider=${s.providerId} success=${s.available} available=${s.available} timedOut=${(s.error?.toLowerCase().includes("timeout"))} reason="${s.error || "ok"}"`);
          });

          const entry = buildSourceAvailabilityFromProviders(
            appId,
            title,
            resolvedGame.sources,
            totalProviders
          );
          const savedProvider = resolvedGame.sources.find(s => s.available)?.providerName || "none";
          if (!savedProvider || savedProvider === "none") {
            console.warn("[STORE][SOURCE_SAVE_SKIP]", { appid: appId, reason: "no-provider" });
            console.log(`[STORE][SOURCE_NO_PROVIDER_TRANSITION] appid=${appId} nextState=retryable status=${entry.status}`);
            console.log(`[PACKAGE][CHECK_BLOCKED] appid=${appId} reason=missing-provider-selection`);

            // Part 8: Use classifyProviderOutcomes result instead of hardcoded "none"
            updateSourceAvailability(appId, entry).catch((err) => console.warn(err));
            return;
          }
          console.log(`[STORE][SOURCE_SAVE] appid=${appId} provider=${savedProvider} hasPreview=${hasPreview}`);
          log("store-search", `saved { appId: "${appId}", sourceCount: ${entry.sourceCount} }`);

          updateSourceAvailability(appId, entry).catch((err) => console.warn(err));
        })
        .catch((error: unknown) => {
          if (requestId !== sourceResolveReqRef.current) return;

          const message = error instanceof Error ? error.message : String(error);
          const isTimeout = message.toLowerCase().includes("timeout");

          log("store-search", `${isTimeout ? "timeout" : "error"} { appId: "${appId}", error: "${message}" }`);

          if (isTimeout) {
            const existing = getSourceAvailability(appId);
            if (existing && existing.availableSources.length > 0) {
              log("store-search", `timeout-preserve { appId: "${appId}", previousSources: ${existing.availableSources.length} }`);
              updateSourceAvailability(appId, { ...existing, status: "timeout", updatedAt: Math.floor(Date.now() / 1000) }).catch((err) => console.warn(err));
              return;
            }
            log("store-search", `timeout-nocache { appId: "${appId}" }`);
            // Fix: set status to "timeout" instead of leaving "checking" — otherwise UI shows
            // "Checking sources..." forever with no way to retry
            updateSourceAvailability(appId, {
              appId,
              title,
              status: "timeout",
              luaReady: false,
              availableSources: [],
              sourceCount: 0,
              totalProviderCount: 0,
              updatedAt: Math.floor(Date.now() / 1000),
            }).catch((err) => console.warn(err));
            return;
          }
          updateSourceAvailability(appId, {
            appId,
            title,
            status: "error",
            luaReady: false,
            availableSources: [],
            sourceCount: 0,
            totalProviderCount: 0,
            updatedAt: Math.floor(Date.now() / 1000),
          }).catch((err) => console.warn(err));
        })
        .finally(() => {
          // Part 10: Always clean up — regardless of requestId.
          // Bookkeeping (loading/progress state) must be cleared even when result publication is skipped.
          setSourcesLoadingByAppId((current) => ({
            ...current,
            [appId]: false,
          }));
          setBackgroundCheckingByAppId((prev) => ({
            ...prev,
            [appId]: false,
          }));
          setSourceProgressByAppId((current) => ({
            ...current,
            [appId]: null,
          }));
        });
    }, 0);
    _pendingTimeouts.current.add(timeoutId);
  }

  function handleBackFromDetails() {
    setSelectedDetailGame(null);
  }

  // Listen for back navigation from TopBar ← button when on Store page
  useEffect(() => {
    const handler = () => {
      if (selectedDetailGame) {
        setSelectedDetailGame(null);
      } else if (activeSectionId) {
        setActiveSectionId(null);
      }
    };
    window.addEventListener("lumaforge-store-detail-back", handler);
    return () => window.removeEventListener("lumaforge-store-detail-back", handler);
  }, [selectedDetailGame, activeSectionId]);

  function handleStoreTabChange(tab: StoreTab) {
    markRenderCause("tab");
    setActiveStoreTab(tab);
    setActiveSectionId(null);
    setActiveGenreSectionId(null);
    setSelectedDetailGame(null);
    setSteamSubmittedSearchGames([]);
    setStoreSearchQuery("");
    setSubmittedSearchQuery("");
    setQuery("");
  }

  // Listen for tab changes from TopBar via custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) handleStoreTabChange(detail.tab);
    };
    window.addEventListener("store-tab-change", handler);
    return () => window.removeEventListener("store-tab-change", handler);
  }, []);

  // When search selects a game, open it inline in the Store (keeps tabs visible)
  const { selectedGame: searchSelectedGame, clearSelection: clearGameSelection } = useGameDetails();
  const _searchOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (searchSelectedGame) {
      // Don't re-open if we already opened details for this exact game
      if (_searchOpenedRef.current === searchSelectedGame.appId) return;
      // If already viewing a different game, close it first
      if (selectedDetailGame && selectedDetailGame.appId !== searchSelectedGame.appId) {
        setSelectedDetailGame(null);
      }
      const browseGame = browseGames.find((g) => g.appId === searchSelectedGame.appId);
      const pkg: PackageGame = browseGame ?? {
        appId: searchSelectedGame.appId,
        title: searchSelectedGame.title,
        imageUrl: searchSelectedGame.imageUrl,
        platforms: [],
        sources: [],
      };
      _searchOpenedRef.current = searchSelectedGame.appId;
      openDetailsForGame(pkg);
      clearGameSelection();
    } else {
      _searchOpenedRef.current = null;
    }
  }, [searchSelectedGame, browseGames]);

  async function downloadFromSource(game: PackageGame, source: PackageSource): Promise<{ success: boolean; jobId?: string }> {
    return await sharedDownloadFromSource(game, source, {
      settings,
      addJob,
      updateJob,
      libraryRefresh,
      refreshInstalledScripts,
      mountedRef: _mountedRef,
      updateSourceAvailability,
    });
  }

  async function handleDownloadSource(source: PackageSource): Promise<{ success: boolean; jobId?: string }> {
    const game = selectedDetailGameWithOverlay;

    if (!game) {
      return { success: false };
    }

    return await downloadFromSource(game, source);
  }

  async function handleDownloadSourceForGame(
    game: PackageGame,
    source: PackageSource
  ) {
    await downloadFromSource(game, source);
  }

  async function handleGameDownload(game: PackageGame) {
    if (!_mountedRef.current) return;
    // Track download interaction
    pushInteractionEvent(game.appId, "download");
    setInteractionScoreByAppId((prev) => ({
      ...prev,
      [game.appId]: (prev[game.appId] ?? 0) + 3,
    }));

    const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;
    const source = getBestAvailableSource(gameWithOverlay);

    if (!source) {
      showWarning("No hay fuentes disponibles para este juego.", {
        title: "Sin fuentes",
      });

      return;
    }

    await downloadFromSource(gameWithOverlay, source);
  }

  function getBadgesForGame(appId: string): StoreBadge[] {
    const MAX_BADGES = 2;

    const meta = storeMetadataByAppId[Number(appId)];
    const overlay = providerOverlayByAppId[appId];
    const interaction = interactionScoreByAppId[appId] ?? 0;
    const isInstalled = installedStatusByAppId.has(appId);

    // Priority order: Recommended > Trending > Top Rated > Popular > New > Has Sources
    const candidates: { type: StoreBadge["type"]; label: string; score: number }[] = [];

    // 1. Recommended
    if (interaction >= 1 && !isInstalled) {
      candidates.push({ type: "recommended", label: "Recommended", score: 6 });
    }

    // 2. Trending: high interaction or has sources + not every game
    if (interaction >= 2 || (overlay && (overlay.sources ?? []).some((s) => s.available) && (interaction >= 1))) {
      candidates.push({ type: "trending", label: "Trending", score: 5 });
    }

    // 3. Top Rated: only shown when compiled discovery index exists (reviews loaded + scored)
    const isTopRated = compiledDiscoveryIndex
      ? qualifiesTopRated(compiledDiscoveryIndex, appId)
      : false;
    if (isTopRated) {
      candidates.push({ type: "top-rated", label: "Top Rated", score: 4 });
    }

    // 4. Popular
    if (interaction >= 3) {
      candidates.push({ type: "popular", label: "Popular", score: 3 });
    }

    // 5. New: uses discovery index if available; otherwise release_date check
    const isNew = compiledDiscoveryIndex
      ? qualifiesNew(meta)
      : (meta?.release_date ? (() => {
          const releaseTs = parseReleaseDate(meta.release_date);
          if (releaseTs > 0) {
            const ageDays = (Date.now() - releaseTs) / (1000 * 60 * 60 * 24);
            return ageDays >= 0 && ageDays <= MIN_NEW_RELEASE_DAYS;
          }
          return false;
        })() : false);
    if (isNew) {
      candidates.push({ type: "new", label: "New", score: 2 });
    }

    // 6. Has Sources
    if (overlay && overlay.sources.some((s) => s.available)) {
      candidates.push({ type: "has-sources", label: "Has Sources", score: 1 });
    }

    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates.slice(0, MAX_BADGES).map(({ type, label }) => ({ type, label }));
    if (selected.length > 0 && DEBUG_STORE_BADGE_DECISIONS) {
      console.log(`[STORE][BADGE_DECISION] appid=${appId} badges=${JSON.stringify(selected)} reasons=${JSON.stringify(candidates.map(c => c.type + "=" + c.score))}`);
    }
    return selected;
  }

  function renderStoreCard(game: PackageGame) {
    const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;
    const badges = getBadgesForGame(game.appId);

    return (
      <div
        className="lf-virtual-card"
        style={VIRTUAL_CARD_STYLE}
      >
        <PackageCard
          game={gameWithOverlay}
          storeMetadata={storeMetadataByAppId[Number(game.appId)]}
          reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
          badges={badges}
          variant="poster"
          sgdbArtwork={sgdbArtworkByAppId[game.appId]}
          onOpenDetails={openDetailsForGame}
          onOpenSourceSelector={openSourceSelectorForGame}
          onDownload={handleGameDownload}
        />
      </div>
    );
  }

  const selectedAppId = selectedDetailGameWithOverlay?.appId;
  const isLoadingSources =
    selectedAppId ? sourcesLoadingByAppId[selectedAppId] ?? false : false;
  const isBackgroundChecking =
    selectedAppId ? backgroundCheckingByAppId[selectedAppId] ?? false : false;
  const sourceProgress: SourceProgress =
    selectedAppId ? sourceProgressByAppId[selectedAppId] ?? null : null;
  const cachedEntry: SourceAvailabilityGameEntry | undefined =
    selectedAppId ? getSourceAvailability(selectedAppId) : undefined;

  const sourceStatus: SourceCheckStatus =
    isLoadingSources
      ? "checking"
      : cachedEntry
        ? cachedEntry.status
        : selectedDetailGameWithOverlay &&
            (selectedDetailGameWithOverlay.sources ?? []).some((s) => s.available)
          ? "ready"
          : "idle";

  if (selectedAppId) {
    log("store-search", `final status { appId: "${selectedAppId}", status: "${sourceStatus}", backgroundChecking: ${isBackgroundChecking}, sourceCount: ${(selectedDetailGameWithOverlay?.sources ?? []).length} }`);
  }



  return (
    <div className="mx-auto w-full max-w-[1920px] space-y-5 px-4 pb-5 sm:px-6 lg:px-8 xl:px-10 xl:pb-7 lf-page-in">
      {selectedDetailGameWithOverlay ? (
        <StoreGameDetailsPage
          game={selectedDetailGameWithOverlay}
          metadata={
            storeMetadataByAppId[Number(selectedDetailGameWithOverlay.appId)]
          }
          reviewSummary={
            reviewSummaryByAppId[Number(selectedDetailGameWithOverlay.appId)]
          }
          installStatus={
            installedStatusByAppId.get(selectedDetailGameWithOverlay.appId) === "disabled"
              ? "disabled"
              : (ownershipLookup.isLuaActive(selectedDetailGameWithOverlay.appId) ||
                 installedStatusByAppId.get(selectedDetailGameWithOverlay.appId) === "active")
                ? "active"
                : "not-installed"
          }
          isSteamInstalled={ownershipLookup.isSteamInstalled(selectedDetailGameWithOverlay.appId)}
          luaInstalled={
            ownershipLookup.isLuaActive(selectedDetailGameWithOverlay.appId) ||
            installedStatusByAppId.get(selectedDetailGameWithOverlay.appId) === "active"
          }
          steamOwned={ownershipLookup.isOwned(selectedDetailGameWithOverlay.appId)}
          selectedSource={getSelectedSourceForGame(selectedDetailGameWithOverlay)}
          sourceStatus={sourceStatus}
          isBackgroundChecking={isBackgroundChecking}
          sourceProgress={sourceProgress}
          moreLikeThisGames={selectedDetailRelatedGames}
          onBack={handleBackFromDetails}
          onDownloadSource={handleDownloadSource}
          onViewInLibrary={(appId, gameTitle) => {
            setPendingLibraryFocus(appId, gameTitle);
            onNavigate?.("library");
          }}
          onOpenGame={openDetailsForGame}
          onSelectSourceKey={(sourceKey) => {
            const appId = selectedDetailGameWithOverlay.appId;
            const game = selectedDetailGameWithOverlay;
            const oldSource = getSelectedSourceForGame(game);
            console.log(`[STORE][SOURCE_CHANGE] appid=${appId} from=${oldSource?.providerName || "null"} to=${sourceKey}`);
            setSelectedSourceKeyByAppId((current) => ({
              ...current,
              [appId]: sourceKey,
            }));
          }}
          onRefreshSources={() => {
            const game = selectedDetailGameWithOverlay;
            if (!game) return;
            const appId = game.appId;

            // Owned or non-installed Lua games should not trigger provider resolution.
            if (ownershipLookup.isOwned(appId) || (!ownershipLookup.isSteamInstalled(appId) && ownershipLookup.isLuaActive(appId))) {
              console.log(`[STORE][SOURCE_RETRY_SKIP_NO_PROVIDER_NEEDED] appid=${appId} owned=${ownershipLookup.isOwned(appId)} luaOnly=${!ownershipLookup.isSteamInstalled(appId) && ownershipLookup.isLuaActive(appId)}`);
              return;
            }

            const requestId = ++sourceResolveReqRef.current;

            log("store-search", `retry { appId: "${appId}" }`);

            setSourcesLoadingByAppId((current) => ({
              ...current,
              [appId]: true,
            }));
            setSourceProgressByAppId((current) => ({
              ...current,
              [appId]: { completed: 0, total: 0, successful: 0, failed: 0, sourceCount: 0, requestId },
            }));
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

            const retryForegroundStartedAt = Date.now();
            const onRetryEarlyResult: ProviderProgressCallback = (result) => {
              if (requestId !== sourceResolveReqRef.current) return;

              console.log(`[STORE][PROVIDER_DISCOVERY_EARLY_RESULT] appid=${result.appId} provider=${result.providerName} available=${result.source.available}`);

              // Part 11: Update source progress counter
              setSourceProgressByAppId((current) => {
                const prev = current[appId];
                if (!prev || prev.requestId !== requestId) {
                  return { ...current, [appId]: { completed: 1, total: result.totalEnabled, successful: result.source.available ? 1 : 0, failed: result.source.available ? 0 : 1, sourceCount: result.allSources.length, requestId } };
                }
                const nextCompleted = prev.completed + 1;
                return { ...current, [appId]: { completed: nextCompleted, total: result.totalEnabled, successful: prev.successful + (result.source.available ? 1 : 0), failed: prev.failed + (result.source.available ? 0 : 1), sourceCount: result.allSources.length, requestId } };
              });

              setProviderOverlayByAppId((current) => ({
                ...current,
                [appId]: {
                  ...game,
                  sources: result.allSources,
                },
              }));

              const retryEntry = buildSourceAvailabilityFromProviders(appId, game.title, result.allSources, result.totalEnabled);
              if (retryEntry.status === "ready" || retryEntry.status === "needs-configuration" || retryEntry.status === "error" || retryEntry.status === "timeout") {
                updateSourceAvailability(appId, retryEntry).catch((err) => console.warn(err));
              } else {
                log("store-search", `retry-early-skip-empty { appId: "${appId}", provider: "${result.providerName}", availability: ${result.source.available} }`);
              }

              if (result.source.available) {
                const currentEntry = getSourceAvailability(appId);
                const alreadySelected = currentEntry?.selectedSourceId;
                if (!alreadySelected) {
                  setSourcesLoadingByAppId((prev) => ({
                    ...prev,
                    [appId]: false,
                  }));
                  setBackgroundCheckingByAppId((prev) => ({
                    ...prev,
                    [appId]: true,
                  }));
                  console.log(`[STORE][SOURCE_READY_EARLY] appid=${appId} provider=${result.providerName} checking=false backgroundChecking=true`);
            console.log(`[STORE][PROVIDER_DISCOVERY_FAST_DONE] appid=${appId} selectedProvider=${result.providerName} elapsedMs=${Date.now() - retryForegroundStartedAt}`);
                } else {
                  console.log(`[STORE][SOURCE_BACKGROUND_MERGE] appid=${appId} provider=${result.providerName} count=${result.allSources.length}`);
                }
              }
            };

            resolveProviderOverlaysForStoreGames([game], settings, onRetryEarlyResult)
              .then((overlays) => {
                if (requestId !== sourceResolveReqRef.current) return;
                const overlayGame = overlays[appId];
                if (overlayGame) {
                  setProviderOverlayByAppId((current) => ({
                    ...current,
                    [appId]: overlayGame,
                  }));
                }
                const resolvedGame = overlayGame ?? game;
                const totalProviders = resolvedGame.sources.length;
                const successes = resolvedGame.sources.filter(s => s.available).length;
                const timedOut = resolvedGame.sources.filter(s => !s.available && s.error?.toLowerCase().includes("timeout")).length;
                console.log(`[STORE][PROVIDER_DISCOVERY_BACKGROUND_DONE] appid=${appId} total=${totalProviders} successes=${successes} timedOut=${timedOut}`);
                resolvedGame.sources.forEach(s => {
                  console.log(`[STORE][PROVIDER_DISCOVERY_RESULT_DETAIL] appid=${appId} provider=${s.providerId} success=${s.available} available=${s.available} timedOut=${(s.error?.toLowerCase().includes("timeout"))} reason="${s.error || "ok"}"`);
                });

                const entry = buildSourceAvailabilityFromProviders(
                  appId,
                  game.title,
                  resolvedGame.sources,
                  totalProviders
                );
        log("store-search", `saved { appId: "${appId}", sourceCount: ${entry.sourceCount} }`);
                const savedProvider = resolvedGame.sources.find(s => s.available)?.providerName || "none";
                if (!savedProvider || savedProvider === "none") {
                  console.warn("[STORE][SOURCE_SAVE_SKIP]", { appid: appId, reason: "no-provider" });
                  console.log(`[STORE][SOURCE_NO_PROVIDER_TRANSITION] appid=${appId} nextState=retryable status=${entry.status}`);
                  console.log(`[PACKAGE][CHECK_BLOCKED] appid=${appId} reason=missing-provider-selection`);

                  // Part 8: Use classifyProviderOutcomes result instead of hardcoded "none"
                  updateSourceAvailability(appId, entry).catch((err) => console.warn(err));
                  return;
                }
                updateSourceAvailability(appId, entry).catch((err) => console.warn(err));
              })
              .catch((error: unknown) => {
                if (requestId !== sourceResolveReqRef.current) return;
                const message = error instanceof Error ? error.message : String(error);
                const isTimeout = message.toLowerCase().includes("timeout");
        log("store-search", `${isTimeout ? "timeout" : "error"} { appId: "${appId}", error: "${message}" }`);
                if (isTimeout) {
                  const existing = getSourceAvailability(appId);
                  if (existing && existing.availableSources.length > 0) {
                    log("store-search", `timeout-preserve { appId: "${appId}", previousSources: ${existing.availableSources.length} }`);
                    updateSourceAvailability(appId, { ...existing, status: "timeout", updatedAt: Math.floor(Date.now() / 1000) }).catch((err) => console.warn(err));
                    return;
                  }
                  log("store-search", `timeout-nocache { appId: "${appId}" }`);
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
                // Part 10: Always clean up — regardless of requestId
                setSourcesLoadingByAppId((current) => ({
                  ...current,
                  [appId]: false,
                }));
                setBackgroundCheckingByAppId((prev) => ({
                  ...prev,
                  [appId]: false,
                }));
                setSourceProgressByAppId((current) => ({
                  ...current,
                  [appId]: null,
                }));
              });
          }}
        />
      ) : loading ? (
        <StoreLoadingState />
      ) : activeSectionId?.startsWith("genre-") ? (
        (() => {
          const genreLabel = activeSectionId.replace(/^genre-/, "");
          const displayName = DISPLAY_GENRES.find((g) => g.toLowerCase() === genreLabel) ?? genreLabel.charAt(0).toUpperCase() + genreLabel.slice(1);
          const displayGames = viewAllGames.map(catalogGameToStoreGame);

          return (
            <section className="space-y-5 lf-page-in">

              <div>
                <h2 className="text-2xl font-bold text-(--color-text)">
                  {displayName}
                </h2>
                <p className="mt-1 text-sm text-(--color-muted)">
                  {viewAllGames.length > 0
                    ? `${viewAllGames.length} games from local catalog`
                    : "Loading games..."}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 lf-card-stagger">
                {displayGames.map((game) => (
                  <div key={"store:genre:" + game.appId}>{renderStoreCard(game)}</div>
                ))}
              </div>

              {viewAllLoading && (
                <div className="flex justify-center py-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
                </div>
              )}

              {viewAllHasMore && !viewAllLoading && (
                <div className="flex justify-center pb-4">
                  <button
                    type="button"
                    onClick={loadMoreViewAll}
                    className="cursor-pointer rounded-full border border-(--surface-active-border) bg-white/5 px-6 py-2 text-sm text-(--color-muted) transition duration-150 hover:border-(--color-accent) hover:text-(--color-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97]"
                  >
                    Load More
                  </button>
                </div>
              )}
            </section>
          );
        })()
      ) : activeSection ? (
        (() => {
          const isGenreView = activeSectionId?.startsWith("genre-");
          const displayGames = isGenreView && viewAllGames.length > 0
            ? viewAllGames.map(catalogGameToStoreGame)
            : activeSection.games;

          return (
            <section className="space-y-5 lf-page-in">

              <div>
                <h2 className="text-2xl font-bold text-(--color-text)">
                  {activeSection.title}
                </h2>

                <p className="mt-1 text-sm text-(--color-muted)">
                  {isGenreView && viewAllGames.length > 0
                    ? `${viewAllGames.length} games from local catalog`
                    : activeSection.description}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 lf-card-stagger">
                {displayGames.map((game) => (
                  <div key={"store:section:" + game.appId}>{renderStoreCard(game)}</div>
                ))}
              </div>

              {viewAllLoading && (
                <div className="flex justify-center py-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
                </div>
              )}

              {isGenreView && viewAllHasMore && !viewAllLoading && (
                <div className="flex justify-center pb-4">
                  <button
                    type="button"
                    onClick={loadMoreViewAll}
                    className="cursor-pointer rounded-full border border-(--surface-active-border) bg-white/5 px-6 py-2 text-sm text-(--color-muted) transition duration-150 hover:border-(--color-accent) hover:text-(--color-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97]"
                  >
                    Load More
                  </button>
                </div>
              )}
            </section>
          );
        })()
      ) : activeSectionId && !activeSection && viewAllGames.length > 0 ? (
        // Fallback: section ID set but section not found in allStoreSections — show viewAllGames
        (() => {
          const displayGames = viewAllGames.map(catalogGameToStoreGame);
          return (
            <section className="space-y-5 lf-page-in">
              <div>
                <h2 className="text-2xl font-bold text-(--color-text)">
                  {activeSectionId.replace(/^genre-/, "").replace(/-/g, " ")}
                </h2>
                <p className="mt-1 text-sm text-(--color-muted)">
                  {viewAllGames.length} games from catalog
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2:grid-cols-6 lf-card-stagger">
                {displayGames.map((game) => (
                  <div key={"store:fallback:" + game.appId}>{renderStoreCard(game)}</div>
                ))}
              </div>
            </section>
          );
        })()
      ) : isSearchResultsView ? (
        (() => {
          const steamGames = steamSubmittedSearchGames.map(
            (g) => providerOverlayByAppId[g.appId] ?? g
          );

          const mergedResults = dedupeGames([
            ...steamGames,
            ...results,
          ]);

          return mergedResults.length === 0 ? (
            <StoreEmptyState />
          ) : (
            <section className="space-y-4 lf-page-in">
              <div>
                <h2 className="text-xl font-bold text-(--color-text)">
                  Search Results for "{submittedSearchQuery}"
                </h2>

                <p className="mt-1 text-sm text-(--color-muted)">
                  {mergedResults.length} game
                  {mergedResults.length === 1 ? "" : "s"} found
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 lf-card-stagger">
                {mergedResults.map((game) => (
                  <div key={"store:search:" + game.appId}>{renderStoreCard(game)}</div>
                ))}
              </div>
            </section>
          );
        })()
      ) : activeStoreTab === "browse" ? (
        <div key="store-tab-browse" className="lf-tab-panel-in"><section className="space-y-5">
          {allStoreSections.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => { setActiveGenreSectionId(null); setBrowsePage(1); }}
                className={`whitespace-nowrap cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] ${
                  activeGenreSectionId === null
                    ? "bg-(--color-accent) text-(--color-accent-text)"
                    : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                All
              </button>

              {allStoreSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => { setActiveGenreSectionId(section.id); setBrowsePage(1); }}
                  className={`whitespace-nowrap cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] ${
                    activeGenreSectionId === section.id
                      ? "bg-(--color-accent) text-(--color-accent-text)"
                      : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </div>
          )}

          <div className="lg:flex lg:gap-6 lg:items-start">
            <StoreBrowseFiltersPanel
              filters={browseFilters}
              onFiltersChange={(filters) => { setBrowseFilters(filters); setBrowsePage(1); }}
              totalGames={browseGames.length}
              filteredGames={filteredBrowseGames.length}
            />

            <div className="min-w-0 flex-1">
              {(() => {
                const totalPages = Math.ceil(filteredBrowseGames.length / PAGE_SIZE) || 1;
                const safePage = Math.min(browsePage, totalPages);
                const startIdx = (safePage - 1) * PAGE_SIZE;
                const endIdx = startIdx + PAGE_SIZE;
                const pageGames = filteredBrowseGames.slice(startIdx, endIdx);

                return (
                  <div className="space-y-5">
                    {pageGames.length === 0 ? (
                      <StoreEmptyState />
                    ) : (
                      <div key={safePage} className="lf-fade-in">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 lf-card-stagger">
                          {pageGames.map((game) => {
                            const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;
                            return (
                              <div
                                key={"store:browse:steam:" + game.appId}
                                className="lf-virtual-card"
                                style={VIRTUAL_CARD_STYLE}
                              >
                                <PackageCard
                                  game={gameWithOverlay}
                                  storeMetadata={storeMetadataByAppId[Number(game.appId)]}
                                  reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
                                  badges={getBadgesForGame(game.appId)}
                                onOpenDetails={openDetailsForGame}
                                onOpenSourceSelector={openSourceSelectorForGame}
                                onDownload={handleGameDownload}
                              />
                            </div>
                          );
                        })}
                        </div>
                      </div>
                    )}

                    <div className="mt-5 flex items-center justify-center">
                      {totalPages > 1 && (() => {
                        const pages: (number | "...")[] = [];
                        const delta = 1;
                        const left = Math.max(2, safePage - delta);
                        const right = Math.min(totalPages - 1, safePage + delta);

                        pages.push(1);
                        if (left > 2) pages.push("...");
                        for (let i = left; i <= right; i++) pages.push(i);
                        if (right < totalPages - 1) pages.push("...");
                        if (totalPages > 1) pages.push(totalPages);

                        return (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={safePage <= 1}
                              onClick={() => { setBrowsePage(safePage - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                              className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition duration-150 hover:text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            {pages.map((p, i) =>
                              p === "..." ? (
                                <span key={`e${i}`} className="inline-flex h-7 w-5 items-center justify-center text-xs text-(--color-muted)">...</span>
                              ) : (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => { setBrowsePage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                                   className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-xs font-medium transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] ${
                                    safePage === p
                                      ? "bg-(--color-accent)/20 text-(--color-accent)"
                                      : "text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
                                  }`}
                                >
                                  {p}
                                </button>
                              )
                            )}
                            <button
                              type="button"
                              disabled={safePage >= totalPages}
                              onClick={() => { setBrowsePage(safePage + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                              className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition duration-150 hover:text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </section></div>
      ) : activeStoreTab === "repacks" ? (
        <div key="store-tab-repacks" className="lf-tab-panel-in">
          <DebridCatalogSection onNavigateToGame={(appId) => {
            const entry = rankedSteamCatalog.find((g: any) => String(g.appid || g.appId) === appId);
            if (entry) {
              openDetailsForGame(entry as any);
            } else {
              const debridGame = getAllDebridGames().find(g => g.appId === appId);
              if (debridGame) {
                const numId = Number(appId);
                if (numId > 0 && !storeMetadataByAppId[numId]) {
                  resolveGameMetadata([numId]);
                }
                openDetailsForGame({
                  appId: debridGame.appId || appId,
                  title: debridGame.title,
                  platforms: [],
                  sources: [],
                });
              }
            }
          }} />
        </div>
      ) : (
        <div key="store-tab-discover" className="lf-tab-panel-in"><div className="space-y-8">
          {/* Hero breaks out of max-w-[1920px] container to span full viewport width */}
          <div className="-mx-4 -mt-1 sm:-mx-6 lg:-mx-8 xl:-mx-10">
            <StoreDiscoverHeroCarousel
              games={featuredGames}
              storeMetadataByAppId={storeMetadataByAppId}
              reviewSummaryByAppId={reviewSummaryByAppId}
              sgdbArtworkByAppId={sgdbArtworkByAppId}
              initialIndex={selectedHeroIndex}
              onIndexChange={setSelectedHeroIndex}
              onOpenGame={openDetailsForGame}
              onDownload={handleGameDownload}
              onOpenSourceSelector={openSourceSelectorForGame}
            />
          </div>

          {discoverPending ? (
            <div className="space-y-6">
              <div className="lf-surface rounded-2xl border p-6">
                <div className="mb-4 h-5 w-48 rounded bg-white/10" />
                <div className="flex gap-4 overflow-hidden">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-32 w-56 shrink-0 rounded-lg bg-white/8" />
                  ))}
                </div>
              </div>
            </div>
          ) : discoverSections.map((section, idx) => {
            // Genre collection cards — horizontal row of 2×2 mosaic cards
            if (section.type === "genre-collection" && section.genreGroups?.length) {
              return (
                <LazySectionWrapper
                  key={section.id}
                  sectionId={section.id}
                  immediate={idx < 2}
                >
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-xl font-bold">{section.title}</h2>
                      <p className="mt-1 text-sm text-white/50">Explore games by category.</p>
                    </div>
                    <div className="flex gap-5 overflow-x-auto pb-2 scrollbar-none">
                      {section.genreGroups.map((group) => (
                        <GenreCollectionCard
                          key={group.genre}
                          genre={group.genre}
                          games={group.items}
                          onClick={() => setActiveSectionId(`genre-${group.genre.toLowerCase()}`)}
                        />
                      ))}
                    </div>
                  </section>
                </LazySectionWrapper>
              );
            }

            const desc = section.id === "for-you"
              ? "Personalized picks based on your activity."
              : section.id === "top-picks"
                ? "Highest scored games in the catalog."
                : section.id === "popular-genres"
                  ? "Browse games by genre."
                    : section.id === "vgi-trending"
                          ? "Games gaining traction right now."
                          : section.id === "vgi-top-players"
                            ? "Most played games today."
                            : section.id === "vgi-leaderboard"
                              ? "Highest rated games of all time."
                              : section.id === "vgi-featured"
                                ? "Staff picks — standout games across every genre."
                                : section.id === "vgi-hidden-gems"
                                  ? "Under-the-radar gems worth discovering."
                                    : section.id === "vgi-most-played"
                                    ? "Games with deeply dedicated fan bases."
                                    : section.id === "free-recent"
                                    ? "Fresh releases getting attention right now."
                                    : section.id === "free-trending"
                                    ? "Games with sustained momentum over 2 weeks."
                                    : section.id === "free-top-players"
                                    ? "Most played games today."
                                    : section.id === "free-leaderboard"
                                    ? "Highest rated games in the catalog."
                                    : section.id === "free-featured"
                                    ? "Staff picks — standout games across every genre."
                                    : section.id === "free-hidden-gems"
                                    ? "Under-the-radar gems worth discovering."
                                    : section.id === "free-most-played"
                                    ? "Games with deeply dedicated fan bases."
                                    : section.id === "most-played-now"
                                    ? "Highest concurrent players across all of Steam."
                                    : section.id === "rising-stars"
                                    ? "Games gaining momentum relative to their all-time base."
                                    : section.id.startsWith("genre-")
                                    ? `Popular ${section.title} games.`
                                    : "";
            const isFreeCatalog = section.id.startsWith("free-");
            const sectionLoading = isFreeCatalog && freeCatalogLoading && section.items.length === 0;
            const sectionEl = (
              <StoreGridSection
                key={section.id}
                sectionKey={section.id}
                title={section.title}
                description={desc}
                onViewAll={section.items.length > 0 ? () => setActiveSectionId(section.id) : undefined}
                loading={sectionLoading}
                skeletonCount={isFreeCatalog ? 12 : 8}
                accent={isFreeCatalog}
              >
                {section.items.slice(0, 6).map((game, i) => {
                  if (DEBUG_STORE_RENDER_VERBOSE && i === 0) console.log(`[STORE][CARD_MOUNT_BUDGET] section=${section.id} total=${section.items.length} limit=6`);
                  return renderStoreCard(game);
                })}
              </StoreGridSection>
            );
            return (
              <LazySectionWrapper
                key={section.id}
                sectionId={section.id}
                immediate={idx < 2}
              >
                {sectionEl}
              </LazySectionWrapper>
            );
          })}
{/* 
          {providerReports.length > 0 && (
            <details className="lf-surface rounded-2xl border p-4">
              <summary className="cursor-pointer text-sm font-medium text-(--color-muted)">
                Advanced provider status
              </summary>

              <div className="mt-4">
                <ProviderSearchReport reports={providerReports} />
              </div>
            </details>
          )} */}
        </div></div>
      )}

      <StoreSourceSelectorModal
        open={sourceSelectorGame !== null}
        game={sourceSelectorGame ? (providerOverlayByAppId[sourceSelectorGame.appId] ?? sourceSelectorGame) : null}
        selectedSource={
          sourceSelectorGame
            ? getSelectedSourceForGame(
                providerOverlayByAppId[sourceSelectorGame.appId] ?? sourceSelectorGame
              )
            : undefined
        }
        onClose={() => setSourceSelectorGame(null)}
        onSelectSource={(sourceKey) => {
          const game = sourceSelectorGame;
          if (game) {
            setSelectedSourceKeyByAppId((current) => ({
              ...current,
              [game.appId]: sourceKey,
            }));
          }
        }}
        onDownloadSource={(source) => {
          const game = sourceSelectorGame;
          if (game) {
            handleDownloadSourceForGame(
              providerOverlayByAppId[game.appId] ?? game,
              source
            );
          }
        }}
        onOpenDetails={(game) => {
          setSourceSelectorGame(null);
          openDetailsForGame(game);
        }}
      />
    </div>
  );
}

function StoreLoadingState() {
  return (
    <div className="space-y-6 animate-pulse">
      <SkeletonHero />
      <div className="space-y-4">
        <SkeletonBox className="h-5 w-48" />
        <GridSkeleton count={4} />
      </div>
      <div className="space-y-4">
        <SkeletonBox className="h-5 w-56" />
        <GridSkeleton count={4} />
      </div>
    </div>
  );
}

function StoreEmptyState() {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
        <PackageSearch className="h-7 w-7 text-(--color-muted)" />
      </div>

      <h2 className="mt-4 font-semibold text-(--color-text)">
        No games match these filters
      </h2>

      <p className="mt-1.5 text-sm text-(--color-muted)">
        Try adjusting your filters or clearing them.
      </p>
    </div>
  );
}
