import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countRender, isInteractionBusy } from "../services/perfCounters";
import { isBootReady } from "../services/appBootCoordinator";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  PackageSearch,
} from "lucide-react";

import PackageCard from "../components/packages/PackageCard";
import PackagesToolbar from "../components/packages/PackagesToolbar";
import type { StoreSearchDropdownItem } from "../components/packages/PackagesToolbar";
import ProviderSearchReport from "../components/packages/ProviderSearchReport";
import StoreDiscoverHeroCarousel from "../components/store/StoreDiscoverHeroCarousel";
import StoreHorizontalSection from "../components/store/StoreHorizontalSection";
import StoreNewsFeed from "../components/store/StoreNewsFeed";
import type { StoreNewsItem } from "../components/store/StoreNewsFeed";
import StoreGameDetailsPage from "../components/store/StoreGameDetailsPage";
import StoreSourceSelectorModal from "../components/store/StoreSourceSelectorModal";
import StoreBrowseFiltersPanel, {
  DEFAULT_BROWSE_FILTERS,
} from "../components/store/StoreBrowseFiltersPanel";
import type { BrowseFilters } from "../components/store/StoreBrowseFiltersPanel";
import type { StoreMoreLikeThisGame } from "../components/store/StoreMoreLikeThisSection";

import { useSettings } from "../context/SettingsContext";
import { useProviderSearch } from "../hooks/useProviderSearch";
import { useDownloadQueue } from "../hooks/useDownloadQueue";

import { scanInstalledLuaScripts } from "../services/tauri";

import { getBestAvailableSource, getSourceKey } from "../utils/sourceHelpers";
import { isHttpUrl } from "../services/libraryLocalCacheService";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
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
import { consumePendingStoreDetailAppId, consumePendingStoreDetailAppTitle } from "../services/storeNavigationService";
import { setPendingLibraryFocus } from "../services/libraryNavigationService";
import { useLibraryGames } from "../context/LibraryGamesContext";
import type { ProviderProgressCallback } from "../types/providerSearch";
import type { SourceAvailabilityGameEntry, SourceCheckStatus } from "../services/sourceAvailabilityCacheService";
import {
  getCachedStoreDiscover,
  setCachedStoreDiscover,
  buildCatalogFingerprint,
  getCachedStoreUI,
  setCachedStoreUI,
  getCachedStoreMetadata,
  setCachedStoreMetadata,
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
  queryIndexFeatured,
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
import { downloadFromSource as sharedDownloadFromSource } from "../features/download/downloadFromSource";
import {
  preFetchGenreGroups,
  getLocalGenreGroups,
  isLocalCatalogReady,
} from "../services/steamCatalogService";

const ENABLE_VERBOSE_SOURCE_LOGS = false;
const DEBUG_STORE_RENDER_VERBOSE = false;
const DEBUG_STORE_BADGE_DECISIONS = false;
const DEBUG_STORE_DISCOVERY = false;

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
function simpleHash(n: number): number {
  let h = n | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return h;
}

  // Module-level flag: prevents auto-open of pending detail from re-firing
  // when the user navigates back to Store later in the same session.
  let _sessionAutoOpenDone = false;
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
let _cachedMorePool: { catalogFp: string; excludeFp: string; pool: { appid: number; name: string }[] } | null = null;
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
  if (id.startsWith("genre-")) return "genre";
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

type StoreTab = "discover" | "browse" | "lua-ready" | "news";
type StoreProps = { onNavigate?: (page: AppPage) => void };

const VIRTUAL_CARD_STYLE: React.CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "280px" };
const STORE_TABS: { id: StoreTab; label: string }[] = [
  { id: "discover", label: "Discover" },
  { id: "browse", label: "Browse" },
  { id: "lua-ready", label: "Lua Ready" },
  { id: "news", label: "News" },
];

type StoreSectionModel = import("../services/storeDiscoverCache").StoreSectionModel;

type StoreBadge = {
  type: "recommended" | "trending" | "top-rated" | "popular" | "new" | "has-sources";
  label: string;
};

const METADATA_CONCURRENCY = 5;
const REVIEW_CONCURRENCY = 3;
const INITIAL_VISIBLE_COUNT = 40;
const CATALOG_PAGE_SIZE = 40;

/**
 * Maximum number of More to Explore cards to mount in the DOM.
 * Logical visible count can be higher, but only this many are actually rendered.
 * Keeps React reconciliation fast when scrolling through hundreds of catalog items.
 */
const MORE_TO_EXPLORE_MOUNT_LIMIT = 20;
const SECTION_RAIL_INITIAL_COUNT = 8;
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
const TRENDING_RECALC_MS = 30000;
const MAX_EVENTS_PER_GAME = 200;

const INTENT_WINDOW_MS = 30 * 60 * 1000;
const PREDICTION_BOOST_MULTIPLIER = 3;

function mapSteamDropdownItemToPackageGame(
  item: StoreSearchDropdownItem
): PackageGame {
  return {
    appId: item.appId,
    title: item.title,
    developer: undefined,
    imageUrl: item.imageUrl,
    platforms: [],
    sources: [],
  };
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
    selectedProvider,
    results,
    loading,
    providerReports,
    setQuery,
    setSelectedProvider,
  } = useProviderSearch();

  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();

  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");

  const {
    query: storeSearchQuery,
    setQuery: setStoreSearchQuery,
    results: storeGameSearchResults,
    loading: steamSearchLoading,
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
  >({});

  /** Incremented after each review batch completes, forces cache rebuild in discovery sections. */
  const [reviewVersion, setReviewVersion] = useState(0);

  const [providerOverlayByAppId, setProviderOverlayByAppId] = useState<
    Record<string, PackageGame>
  >({});

  const [activeStoreTab, setActiveStoreTab] = useState<StoreTab>("discover");
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

  // ── Show More expansion for Discover tab "More to Explore" ──
  // Dedup: guard against repeated calls within 150ms window.
  const _showMoreLastTick = useRef(0);
  const increaseDiscoverVisibleCount = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const now = Date.now();
    if (now - _showMoreLastTick.current < 150) {
      return; // dedup repeated calls within 150ms window
    }
    _showMoreLastTick.current = now;
    setDiscoverMoreVisibleCount((prev) => {
      const next = prev + CATALOG_PAGE_SIZE;
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][SHOW_MORE] old=${prev} added=${CATALOG_PAGE_SIZE} next=${next}`);
      return next;
    });
  }, []);

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

  const [interactionScoreByAppId, setInteractionScoreByAppId] = useState<Record<string, number>>({});
  const [interactionEventsByAppId, setInteractionEventsByAppId] = useState<
    Record<string, InteractionEvent[]>
  >({});
  const [trendRecalcKey, setTrendRecalcKey] = useState(0);

  const sourceCacheLoadedRef = useRef(false);
  useEffect(() => {
    if (sourceCacheLoadedRef.current) return;
    sourceCacheLoadedRef.current = true;
    loadSourceAvailabilityIndex().catch(() => {});
    // Pre-fetch local catalog genre groups for Discover sections
    if (!isLocalCatalogReady()) {
      const DISPLAY_GENRES = ["Action", "Indie", "Racing", "Shooter", "RPG", "Adventure"];
      preFetchGenreGroups(DISPLAY_GENRES, 20).catch(() => {});
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
    }).catch(() => {});
  }, []);

  // On mount, consume any pending store detail appId set by dashboard discovery sections
  useEffect(() => {
    const pending = consumePendingStoreDetailAppId();
    if (pending) {
      pendingAppIdRef.current = pending;
      console.log(`[STORE][PENDING_NAV] appid=${pending} waiting for catalog`);
    }
  }, []);

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

  // When steamCatalog is loaded and there's a pending appId, auto-open details.
  // Module-level flag survives mount/unmount so re-entering Store does not re-open.
  const openedPendingRef = useRef(false);
  useEffect(() => {
    if (_sessionAutoOpenDone) {
      console.log(`[STORE][DETAILS_AUTO_OPEN_SKIP] reason=already-done-this-session`);
      return;
    }
    if (steamCatalog.length === 0) return;
    if (openedPendingRef.current) return;
    const appIdStr = pendingAppIdRef.current;
    if (!appIdStr) return;
    openedPendingRef.current = true;
    _sessionAutoOpenDone = true;

    const appIdNum = parseInt(appIdStr, 10);
    const entry = steamCatalog.find((e) => e.appid === appIdNum);
    const fallbackTitle = consumePendingStoreDetailAppTitle();
    if (entry) {
      console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${appIdStr} reason=pending-nav`);
      const game: PackageGame = {
        appId: appIdStr,
        title: entry.name,
        platforms: [],
        sources: [],
      };
      openDetailsForGame(game);
    } else if (fallbackTitle) {
      console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${appIdStr} reason=pending-nav-fallback title=${fallbackTitle}`);
      const game: PackageGame = {
        appId: appIdStr,
        title: fallbackTitle,
        platforms: [],
        sources: [],
      };
      openDetailsForGame(game);
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
    const sorted = [...steamCatalog];
    sorted.sort((a, b) => {
      const ha = simpleHash(a.appid);
      const hb = simpleHash(b.appid);
      return ha - hb;
    });

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
    saveDiscoveryIndexToDisk(compiledDiscoveryIndex).catch(() => {});
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
        imageUrl: cachedImage || meta?.capsule_image_v5 || meta?.capsule_image || meta?.header_image || undefined,
        platforms: meta?.platforms || [],
        sources: [] as PackageSource[],
      };
    });
    // NOTE: storeMetadataByAppId intentionally omitted from deps — imageUrl is best-effort
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedSteamCatalog]);

  // Visible catalog window — used by non-Browse consumers (news, luaReady, etc.)
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

  const featuredGames = useMemo(() => {
    const HERO_MAX = 5;
    let games: StoreGame[];

    // Prefer provider/cache featured sections when available
    if (enrichedCatalogSections.length > 0) {
      const featured = enrichedCatalogSections.find(
        (s) => s.sectionId === "featured" || s.sectionId === "top-picks",
      );
      if (featured && featured.games.length > 0) {
        games = featured.games.map((game) => ({
          appId: game.steamAppId ?? String(game.igdbId ?? game.rawgId ?? ""),
          title: game.title,
          imageUrl: game.imageUrl ?? game.backgroundImageUrl,
          platforms: [] as string[],
          sources: [] as PackageSource[],
        }));
        return games.slice(0, HERO_MAX);
      }
    }

    // Fallback: cache hit
    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint && cached.featuredGames.length > 0) {
      return cached.featuredGames.slice(0, HERO_MAX);
    }

    // Fallback: curated featured (immediate, no network needed)
    const curatedFeatured = _curatedBaseline.find(
      (s) => s.sectionId === "featured" || s.sectionId === "top-picks",
    );
    if (curatedFeatured && curatedFeatured.games.length > 0) {
      return curatedFeatured.games.map((g) => ({
        appId: g.steamAppId ?? g.id,
        title: g.title,
        imageUrl: undefined,
        platforms: [] as string[],
        sources: [] as PackageSource[],
      })).slice(0, HERO_MAX);
    }

    // Fallback: steamdb highQualityPool day rotation
    const pool = highQualityPool.slice(0, 60);
    if (pool.length === 0) return [];

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
    const count = Math.min(pool.length, HERO_MAX);
    const start = dayOfYear % Math.max(1, pool.length - count + 1);
    const slice = pool.slice(start, start + count);

    return slice.map((s) => ({
      appId: s.appId,
      title: s.title,
      imageUrl: getBestStoreImage(s.appId, ["hero", "header", "capsule"]) || undefined,
      platforms: [] as string[],
      sources: [] as PackageSource[],
    }));
  }, [highQualityPool, catalogFingerprint, enrichedCatalogSections]);

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
  const discoverSections = useMemo(() => {
    // Skip stale cache when enriched provider data is available — always recompute
    const hasEnrichedData = enrichedCatalogSections.length > 0;
    const cached = getCachedStoreDiscover();
    const hasReviewsLoaded = Object.keys(reviewSummaryByAppId).length > 0;
    // Bypass partial/incomplete cache — rebuild sections when metadata or reviews become available.
    // Only return cached data when no reviews have been loaded yet (cold cache from prior session).
    // Once reviews arrive, rebuild to apply review-based quality gates.
    // Also skip cache when enriched data exists — merge must run to produce provider-first sections.
    if (!hasEnrichedData && cached && cached.catalogFingerprint === catalogFingerprint && cached.discoverSections && cached.discoverSections.length > 0 && !cached.isPartialCache && !hasReviewsLoaded) {
      return cached.discoverSections;
    }

    // Phase 2+3: Skip full rebuild when material inputs haven't changed.
    // Fingerprint captures: metadata count, review count, review version, installed count,
    // interaction count, provider overlay count, featured count, enriched sections, discovery index hash.
    const inputFp = [
      Object.keys(storeMetadataByAppId).length,
      Object.keys(reviewSummaryByAppId).length,
      reviewVersion,
      installedStatusByAppId.size,
      Object.keys(interactionScoreByAppId).length,
      Object.keys(providerOverlayByAppId).length,
      featuredGames.length,
      enrichedCatalogSections.length,
      compiledDiscoveryIndex?.sections.topPicks.length ?? 0,
      highQualityPool.length,
      catalogFingerprint,
    ].join(":");
    if (_sectionBuildFpRef.current.fp === inputFp && _sectionBuildFpRef.current.sections) {
      return _sectionBuildFpRef.current.sections;
    }

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
    // Provides high-quality games on first paint — enriched catalog replaces where quality is better
    for (const cs of _curatedBaseline) {
      sections.push({
        id: cs.sectionId,
        title: cs.title,
        type: inferCuratedSectionType(cs.sectionId),
        items: cs.games.map((g) => ({
          appId: g.steamAppId ?? g.id,
          title: g.title,
          imageUrl: undefined,
          platforms: [] as string[],
          sources: [] as PackageSource[],
        })),
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
          list.push({
            appId: String(g.appId),
            title: g.name,
            imageUrl: g.headerImage || g.capsuleImage || undefined,
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

    const DISPLAY_GENRES = ["Action", "Indie", "Racing", "Shooter", "RPG", "Adventure"];
    const rawGenreCountsStr = DISPLAY_GENRES.map((g) => `${g}=${rawGenreGroups.get(g)?.length ?? 0}`).join(" ");
    const genreGroupsFingerprint = `${rawGenreGroups.size}:${rawGenreCountsStr}`;
    if (genreGroupsFingerprint !== _lastGenreGroupsLog) {
      _lastGenreGroupsLog = genreGroupsFingerprint;
      console.log(`[STORE][GENRE_GROUPS_RAW] genres=${rawGenreGroups.size} ${rawGenreCountsStr}`);
    }

    // --- For You (personalized genre overlap, was "Recommended for You") ---
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
        sections.push({ id: "for-you", title: "For You", type: "rail", items: rec, source: "personalized" });
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

    // --- New & Noteworthy (by release date) ---
    const datedGames = topGames
      .map((g) => {
        const meta = storeMetadataByAppId[Number(g.appId)];
        const ts = meta?.release_date ? parseReleaseDate(meta.release_date) : 0;
        return { game: g, ts };
      })
      .filter((x) => x.ts > 0)
      .sort((a, b) => b.ts - a.ts);
    if (datedGames.length >= 4) {
      const newest = takeUnique(datedGames.map((x) => x.game), 20);
      if (newest.length > 0) {
        sections.push({ id: "new-noteworthy", title: "New & Noteworthy", type: "rail", items: newest, source: "catalog" });
      }
    }

    // --- Genre rails (Action, Indie, Racing, Shooter, RPG, Adventure) with adaptive threshold ---
    const minGenreItems = metaCount < 100 ? 2 : 4;
    if (metaCount > 0 && metaCount < 100 && DEBUG_STORE_DISCOVERY) {
      console.log(`[STORE][GENRE_THRESHOLD] metaCount=${metaCount} minItems=${minGenreItems}`);
    }
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
      // (genre match + hasImage is still meaningful, just without review quality signal)
      const effective = (hasResolvedReviews && qualityGated.length < minGenreItems)
        ? candidates.filter((g) => {
            const meta = storeMetadataByAppId[Number(g.appId)];
            return meta?.header_image || meta?.capsule_image_v5;
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
        ? takeUnique([...uniqueNotUsed], 20)
        : dedupedCandidates.slice(0, 20);
      if (items.length >= minGenreItems) {
        sections.push({ id: `genre-${genre.toLowerCase()}`, title: genre, type: "genre", items, source: "genre" });
        if (items.length <= 10 && DEBUG_STORE_DISCOVERY) {
          console.log(`[STORE][DISCOVERY_SECTION] name=${genre} count=${items.length} appids=${JSON.stringify(items.map((i) => i.appId))} names=${JSON.stringify(items.map((i) => i.title))}`);
        }
      } else {
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=genre-${genre.toLowerCase()} reason=no-qualified-candidates`);
      }
    }

    // --- Popular Genres overview (genre navigation rail) ---
    const availableGenres = DISPLAY_GENRES.filter((g) => {
      const list = rawGenreGroups.get(g);
      return list && list.length >= minGenreItems;
    });
    if (availableGenres.length > 0) {
      const genreCards = availableGenres.slice(0, 7).flatMap((g) => (rawGenreGroups.get(g) ?? []).slice(0, 2));
      const seen = new Set<string>();
      const unique = genreCards.filter((g) => { if (seen.has(g.appId)) return false; seen.add(g.appId); return true; }).slice(0, 20);
      if (unique.length >= minGenreItems) {
        sections.push({ id: "popular-genres", title: "Popular Genres", type: "rail", items: unique, source: "catalog" });
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][POPULAR_GENRES_READY] genres=${availableGenres.length} items=${unique.length}`);
      }
    }

    // --- Featured (high quality with media, requires review/rating data) ---
    // No fallback garbage — if index has no featured candidates after reviews loaded, hide section.
    const featuredAppIds = compiledDiscoveryIndex ? queryIndexFeatured(compiledDiscoveryIndex, 20) : [];
    if (featuredAppIds.length > 0) {
      const items = takeUnique(
        featuredAppIds
          .map((appId) => topGames.find((g) => g.appId === appId))
          .filter((g): g is StoreGame => g !== undefined),
        20,
      );
      if (items.length > 0) {
        sections.push({ id: "featured", title: "Featured", type: "featured", items, source: "catalog" });
        if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_SECTION] name=Featured count=${items.length} appids=${JSON.stringify(items.map((i) => i.appId))} names=${JSON.stringify(items.map((i) => i.title))}`);
      }
    } else if (!compiledDiscoveryIndex && !hasResolvedReviews) {
      if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=Featured reason=waiting-for-reviews`);
    } else {
      if (DEBUG_STORE_DISCOVERY) console.log(`[STORE][DISCOVERY_NO_SECTION] section=Featured reason=no-qualified-candidates`);
    }

    // --- Lua Ready Picks (catalog games with available download sources) ---
    const luaReady = topGames.filter((g) => {
      const overlay = providerOverlayByAppId[g.appId];
      return overlay && overlay.sources.some((s) => s.available);
    });
    if (luaReady.length >= 4) {
      const items = takeUnique(luaReady, 20);
      if (items.length > 0) {
        sections.push({ id: "lua-ready-picks", title: "Lua Ready Picks", type: "rail", items, source: "lua" });
      }
    }

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
    const dedupedSections: StoreDiscoverSection[] = [];
    const seenSectionIds = new Set<string>();
    for (const sec of sections) {
      if (seenSectionIds.has(sec.id)) continue;
      seenSectionIds.add(sec.id);
      dedupedSections.push(sec);
    }

    // ── Merge enriched catalog sections (provider-first: IGDB/RAWG/curated) ──
    // Curated sections are in dedupedSections as baseline; enriched can replace where quality is better
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
  }, [lumaForgeSections, highQualityPool, storeMetadataByAppId, installedStatusByAppId, interactionScoreByAppId, providerOverlayByAppId, featuredGames, trendingScoreByAppId, genreConfidence, reviewSummaryByAppId, reviewVersion, catalogFingerprint, compiledDiscoveryIndex, enrichedCatalogSections]);

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
  const moreToExploreGames = useMemo(() => {
    const effectiveDiscoverCount = discoverMoreVisibleCount > 0 ? discoverMoreVisibleCount : INITIAL_VISIBLE_COUNT;

    // Build score lookup from highQualityPool for sorting More to Explore
    const scoreLookup = new Map<string, number>();
    for (const hq of highQualityPool) {
      scoreLookup.set(hq.appId, hq.score);
    }

    // Phase 8: Use module-level cached pool to avoid re-filtering 162k entries.
    // Only rebuild pool when catalog or exclusions change.
    const excludeFp = computeExcludeFingerprint(featuredGames, sectionModels);
    if (!_cachedMorePool || _cachedMorePool.catalogFp !== catalogFingerprint || _cachedMorePool.excludeFp !== excludeFp) {
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
      _cachedMorePool = { catalogFp: catalogFingerprint, excludeFp, pool };
    } else {
      // Re-sort if scoreLookup changed (e.g., reviews loaded)
      const pool = _cachedMorePool.pool;
      pool.sort((a, b) => {
        const sa = scoreLookup.get(String(a.appid)) ?? 0;
        const sb = scoreLookup.get(String(b.appid)) ?? 0;
        return sb - sa;
      });
    }
    const pool = _cachedMorePool.pool;

    const games = pool.slice(0, effectiveDiscoverCount).map((entry) => {
      const appId = String(entry.appid);
      const meta = storeMetadataByAppId[entry.appid];
      return {
        appId,
        title: entry.name,
        imageUrl: getBestStoreImage(appId, ["capsule", "header", "hero"], meta) || undefined,
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
    return games;
  }, [rankedSteamCatalog, discoverMoreVisibleCount, featuredGames, sectionModels, storeMetadataByAppId, highQualityPool, catalogFingerprint]);

  const allStoreSections = useMemo(() => {
    // Phase 5: Priority chain — primary state > complete cache > computed
    const cached = getCachedStoreDiscover();
    const ds = getDiscoverState();
    // 1. Primary StoreDiscoverState (most recent render snapshot)
    if (ds && ds.status === "complete" && ds.allStoreSections.length > 0 && ds.fingerprint === catalogFingerprint) {
      return ds.allStoreSections;
    }
    // 2. Complete cache entry
    if (cached && cached.catalogFingerprint === catalogFingerprint && isCacheComplete(cached) && cached.allStoreSections.length > 0) {
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][ALL_SECTIONS_SOURCE] source=complete-cache sections=${cached.allStoreSections.length}`);
      return cached.allStoreSections;
    }
    // 3. Computed from lumaForgeSections + sectionModels
    if (lumaForgeSections.length > 0 || sectionModels.length > 0) {
      return [...lumaForgeSections, ...sectionModels];
    }
    // 4. Partial cache fallback (only when nothing else available)
    if (cached && cached.allStoreSections.length > 0 && !isCacheComplete(cached)) {
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][ALL_SECTIONS_SOURCE] source=partial-fallback sections=${cached.allStoreSections.length}`);
      return cached.allStoreSections;
    }
    return [];
  }, [lumaForgeSections, sectionModels, catalogFingerprint]);

  const browseGames = useMemo(() => {
    // Phase 5: Check cache first — skip 162K iteration on re-mount when
    // fingerprint hasn't changed (e.g. returning to Store from another route).
    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint && cached.browseGames?.length > 0) {
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[PERF][STORE_COMPUTE] browseGames cache-hit count=${cached.browseGames.length}`);
      return cached.browseGames as unknown as PackageGame[];
    }

    const t0 = performance.now();
    const gameMap = new Map<string, PackageGame>();

    // Use catalogBaseGames (full catalog) so Browse filters cover all games
    catalogBaseGames.forEach((game) => {
      gameMap.set(game.appId, game);
    });

    lumaForgeSections.forEach((section) => {
      section.games.forEach((game) => {
        gameMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      });
    });

    results.forEach((game) => {
      gameMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
    });

    const games = Array.from(gameMap.values());
    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[PERF][STORE_COMPUTE] browseGames count=${games.length} elapsed=${(performance.now() - t0).toFixed(1)}ms`);
    return games;
  }, [catalogBaseGames, lumaForgeSections, results, providerOverlayByAppId, catalogFingerprint]);

  const luaReadyGames = useMemo(() => {
    const seen = new Set<string>();
    const games: PackageGame[] = [];

    const addIfReady = (game: PackageGame) => {
      if (seen.has(game.appId)) return;
      const overlayed = providerOverlayByAppId[game.appId] ?? game;
      if (overlayed.sources.some((s) => s.available)) {
        seen.add(game.appId);
        games.push(overlayed);
      }
    };

    catalogGames.forEach(addIfReady);
    results.forEach(addIfReady);

    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[Store] luaReadyGames: ${games.length} games`);
    return games;
  }, [catalogGames, results, providerOverlayByAppId]);

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
              luaReadyGames: luaReadyGames as unknown as StoreDiscoverCacheEntry["luaReadyGames"],
              discoveryIndex: compiledDiscoveryIndex || undefined,
              builtAt: Date.now(),
              isPartialCache: true,
            });
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
             luaReadyGames: luaReadyGames as unknown as StoreDiscoverCacheEntry["luaReadyGames"],
             discoveryIndex: compiledDiscoveryIndex || undefined,
             builtAt: Date.now(),
           });
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
    luaReadyGames, selectedHeroIndex, compiledDiscoveryIndex,
  ]);

  const newsItems = useMemo<StoreNewsItem[]>(() => {
    // Phase 9: Skip heavy compute when News tab is inactive
    if (activeStoreTab !== "news") {
      if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][COMPUTE_SKIP] target=newsItems reason=inactive-tab`);
      return [];
    }

    const t0 = performance.now();
    const items: StoreNewsItem[] = [];
    const usedAppIds = new Set<string>();

    const tryAdd = (game: PackageGame, category: StoreNewsItem["category"], group: StoreNewsItem["group"], title: string, description: string) => {
      if (usedAppIds.has(game.appId)) return;
      usedAppIds.add(game.appId);
      const overlayed = providerOverlayByAppId[game.appId] ?? game;
      items.push({
        id: `${category}-${game.appId}-${items.length}`,
        title,
        description,
        imageUrl: overlayed.imageUrl || storeMetadataByAppId[Number(game.appId)]?.capsule_image_v5 || storeMetadataByAppId[Number(game.appId)]?.header_image || undefined,
        appId: game.appId,
        category,
        group,
        game: overlayed,
      });
    };

    // 1. Recently discovered / newly available from provider search
    for (const game of results.slice(0, 6)) {
      const hasSources = game.sources.some((s) => s.available);
      if (hasSources) {
        tryAdd(game, "Lua Ready", "Today", `${game.title} is Lua Ready`, `${game.title} has compatible download sources available in LumaForge.`);
      } else {
        tryAdd(game, "Store", "Today", `${game.title} found in provider search`, `${game.title} was discovered through your configured providers.`);
      }
    }

    // 2. Top browse games: installed, Lua-ready, DLC
    const topGames = browseGames.slice(0, 12);
    for (const game of topGames) {
      if (usedAppIds.has(game.appId)) continue;
      const meta = storeMetadataByAppId[Number(game.appId)];
      const hasSources = game.sources.some((s) => s.available);
      const isInstalled = installedStatusByAppId.has(game.appId);

      if (isInstalled) {
        tryAdd(game, "Installed", "Today", `${game.title} is installed and ready`, `${game.title} is installed in your library and ready to use.`);
      } else if (hasSources) {
        tryAdd(game, "Lua Ready", "Today", `${game.title} is Lua Ready`, `${game.title} has compatible download sources available in LumaForge.`);
      }

      if (meta && meta.dlc_count > 0) {
        const dlcLabel = meta.dlc_count === 1 ? "1 DLC" : `${meta.dlc_count} DLCs`;
        tryAdd(game, "DLC", "This Week", `${game.title} has ${dlcLabel} available`, `Additional content detected from Steam metadata for ${game.title}.`);
      }
    }

    // 3. New & noteworthy from catalog (high appId = recently added to Steam)
    const catalogWithMeta = catalogGames.filter((g) => storeMetadataByAppId[Number(g.appId)]?.release_date || Number(g.appId) > 300000);
    const sortedByNew = [...catalogWithMeta].sort((a, b) => Number(b.appId) - Number(a.appId));
    for (const game of sortedByNew.slice(0, 4)) {
      if (usedAppIds.has(game.appId)) continue;
      tryAdd(game, "Store", "This Week", `${game.title} is now on the catalog`, `${game.title} was recently added to the catalog.`);
    }

    // 4. High-quality games with metadata but no source yet
    const withMetaNoSource = catalogGames.filter((g) => {
      if (usedAppIds.has(g.appId)) return false;
      const meta = storeMetadataByAppId[Number(g.appId)];
      return meta && (meta.header_image || meta.capsule_image_v5) && !installedStatusByAppId.has(g.appId);
    });
    // Pick a few that have review scores
    const withReviews = withMetaNoSource.filter((g) => reviewSummaryByAppId[Number(g.appId)]?.total_reviews && reviewSummaryByAppId[Number(g.appId)].total_reviews > 500);
    for (const game of withReviews.slice(0, 3)) {
      if (usedAppIds.has(game.appId)) continue;
      const meta = storeMetadataByAppId[Number(game.appId)];
      const reviewPct = reviewSummaryByAppId[Number(game.appId)]?.positive_percent ?? 0;
      tryAdd(game, "Store", "Earlier", `${game.title} — ${reviewPct}% positive reviews`, `${meta?.developer || "Unknown developer"}'s game has ${reviewPct}% positive reviews on Steam.`);
    }

    // 5. Trending based on interaction scores
    const withInteraction = catalogGames.filter((g) => {
      if (usedAppIds.has(g.appId)) return false;
      return (interactionScoreByAppId[g.appId] ?? 0) >= 1;
    });
    const sortedByTrend = [...withInteraction].sort((a, b) => (interactionScoreByAppId[b.appId] ?? 0) - (interactionScoreByAppId[a.appId] ?? 0));
    for (const game of sortedByTrend.slice(0, 3)) {
      if (usedAppIds.has(game.appId)) continue;
      tryAdd(game, "Store", "Earlier", `${game.title} is trending`, `Recently viewed and interacted with in the catalog.`);
    }

    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[PERF][STORE_COMPUTE] newsItems count=${items.length} elapsed=${(performance.now() - t0).toFixed(1)}ms`);
    return items;
  }, [browseGames, results, catalogGames, providerOverlayByAppId, storeMetadataByAppId, reviewSummaryByAppId, installedStatusByAppId, interactionScoreByAppId]);

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

    if (browseFilters.luaReady) {
      games = games.filter((g) => {
        const overlayed = providerOverlayByAppId[g.appId] ?? g;
        return overlayed.sources.some((s) => s.available);
      });
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

    if (browseFilters.sourceTypes.length > 0) {
      const typeSet = new Set(browseFilters.sourceTypes);

      games = games.filter((g) => {
        const overlayed = providerOverlayByAppId[g.appId] ?? g;
        return overlayed.sources.some((s) => typeSet.has(s.fileType));
      });
    }

    if (browseFilters.providers.length > 0) {
      const providerSet = new Set(browseFilters.providers);

      games = games.filter((g) => {
        const overlayed = providerOverlayByAppId[g.appId] ?? g;
        return overlayed.sources.some((s) => providerSet.has(s.providerId));
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
  ]);

  const activeSection = activeSectionId
    ? allStoreSections.find((section) => section.id === activeSectionId)
    : undefined;

  const selectedDetailGameWithOverlay = selectedDetailGame
    ? providerOverlayByAppId[selectedDetailGame.appId] ?? selectedDetailGame
    : null;

  // Stable key for visibleAppIds to prevent render loops
  const appIdScopeKeyRef = useRef("");
  const reviewScopeKeyRef = useRef("");

  // Visible appIds for metadata loading - does NOT depend on storeMetadataByAppId
  // Phase 8: Reduced cap from 200→80. Detail game has its own dedicated effect below.
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

    // NOTE: selectedDetailGame excluded — it has its own dedicated metadata effect below

    const ids = Array.from(appIds);
    // Phase 8: Cap metadata fetch scope — 80 covers hero + sections (8×8=64) + browse page.
    // Detail game gets its own effect; section games beyond the cap load on scroll.
    const METADATA_WINDOW_MAX = 80;
    const capped = ids.length > METADATA_WINDOW_MAX ? ids.slice(0, METADATA_WINDOW_MAX) : ids;
    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][METADATA_WINDOW_LOAD] requested=${ids.length} capped=${capped.length}`);
    return capped;
    // NOTE: storeMetadataByAppId intentionally NOT in deps to avoid render loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogGames, results, allStoreSections, steamSearchItems, steamSubmittedSearchGames, activeStoreTab, browsePage]);

  const visibleAppIdsKey = visibleAppIds.join(",");

  // Only reload metadata when the key actually changes
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (visibleAppIdsKey === appIdScopeKeyRef.current) return;
    appIdScopeKeyRef.current = visibleAppIdsKey;

    if (visibleAppIds.length === 0) {
      setStoreMetadataByAppId({});
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
          const current = storeMetadataByAppId;
          const keys = Object.keys(metadata);
          let changed = keys.length !== Object.keys(current).length;
          if (!changed) {
            for (const key of keys) {
              const k = Number(key);
              const m = metadata[k];
              const c = current[k];
              if (!m || !c) { changed = true; break; }
              if (m.name !== c.name || m.developer !== c.developer ||
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
          }
          if (!changed) {
            if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][METADATA_SKIP] reason=unchanged keys=${keys.length}`);
            return;
          }
          markRenderCause("metadata");
          setStoreMetadataByAppId(metadata);
          if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[Store] metadata loaded: ${Object.keys(metadata).length} games resolved`);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setStoreMetadataByAppId({});
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

  // Smart preload: proactively load metadata for upcoming items
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    const preloadIds: number[] = [];

    // Top scored games from high quality pool — Phase 8: reduced from 30→12 (covers hero + top of first sections)
    for (const entry of highQualityPool.slice(0, 12)) {
      const id = Number(entry.appId);
      if (Number.isFinite(id)) preloadIds.push(id);
    }

    // Featured games
    for (const game of featuredGames) {
      const id = Number(game.appId);
      if (Number.isFinite(id)) preloadIds.push(id);
    }

    // First items of each discover section
    for (const section of allStoreSections) {
      for (const game of section.games.slice(0, 3)) {
        const id = Number(game.appId);
        if (Number.isFinite(id)) preloadIds.push(id);
      }
    }

    if (preloadIds.length === 0) return;

    const unique = Array.from(new Set(preloadIds));
    const missing = unique.filter((id) => !storeMetadataByAppId[id]);

    if (missing.length === 0) return;

    resolveGameMetadata(missing)
      .then((metadata) => {
        if (!_mountedRef.current) return;
        setStoreMetadataByAppId((prev) => ({ ...prev, ...metadata }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highQualityPool, featuredGames, allStoreSections, steamCatalog.length]);

  // Curated metadata preload — ensures images are available for curated games on first paint
  const curatedPreloadedRef = useRef(false);
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (curatedPreloadedRef.current) return;
    curatedPreloadedRef.current = true;

    const curatedAppIds: number[] = [];
    for (const section of _curatedBaseline) {
      for (const game of section.games) {
        const id = Number(game.steamAppId);
        if (Number.isFinite(id)) curatedAppIds.push(id);
      }
    }
    const uniqueIds = [...new Set(curatedAppIds)];
    if (uniqueIds.length === 0) return;

    const unloaded = uniqueIds.filter((id) => !storeMetadataByAppId[id]);
    if (unloaded.length === 0) return;

    let cancelled = false;
    batchedLoad(unloaded, resolveGameMetadata, METADATA_CONCURRENCY)
      .then((metadata) => {
        if (cancelled || !_mountedRef.current) return;
        const count = Object.keys(metadata).length;
        if (count > 0) {
          setStoreMetadataByAppId((prev) => {
            const merged = { ...prev };
            for (const [key, value] of Object.entries(metadata)) {
              if (!merged[Number(key)]) merged[Number(key)] = value;
            }
            return merged;
          });
          if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][CURATED_PRELOAD] loaded=${count} games from ${unloaded.length} curated`);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeFirstPaintDone]);

  // Pre-populate Store image cache for visible app IDs (display-only, no local media index)
  // Re-runs when metadata loads so URLs become available for cached Discover sections.
  // resolveStoreDisplayImage is idempotent — calls for already-cached entries are no-ops.
  useEffect(() => {
    if (!storeFirstPaintDone) return;
    if (visibleAppIds.length === 0) return;
    if (!_mountedRef.current) return;
    if (isInteractionBusy()) {
      if (ENABLE_VERBOSE_SOURCE_LOGS) console.log(`[STORE][IMAGE_CACHE_SEED_SKIP] reason=interaction-busy`);
      return;
    }
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
          setReviewVersion((v) => v + 1);
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
        setReviewVersion((v) => v + 1);
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

  function handleToolbarQueryChange(value: string) {
    setStoreSearchQuery(value);
    setActiveSectionId(null);

    if (value.trim().length === 0) {
      setSubmittedSearchQuery("");
      setQuery("");
      setSteamSubmittedSearchGames([]);
    }
  }

  function submitSteamSearch() {
    const query = storeSearchQuery.trim();

    if (query.length === 0) {
      return;
    }

    const games = steamSearchItems.map(mapSteamDropdownItemToPackageGame);
    setSteamSubmittedSearchGames(games);
    setSubmittedSearchQuery(query);
    setQuery(query);
    setActiveSectionId(null);
    setSelectedDetailGame(null);

    if (games.length > 0) {
      const hydrated: Record<string, PackageGame> = {};
      for (const game of games) {
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
      setProviderOverlayByAppId((current) => ({ ...current, ...hydrated }));
    }
  }

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
      if (cached && cached.game && cached.game.sources.length > 0) {
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
    const appId = game.appId;
    const cached = getSourceAvailability(appId);

    // CRITICAL PATH — show detail panel immediately
    markRenderCause("detail");
    setActiveSectionId(null);

    // Fast path: hydrate from cache if possible
    if (cached && cached.status === "ready" && game.sources.length === 0) {
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

    // Only skip source resolution when confirmed "none" (all queryable providers returned empty)
    if (cached?.status === "none") {
      return;
    }

    // DEFERRED PATH — analytics + source resolution (outside click handler)
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
      }).catch(() => {});

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
          updateSourceAvailability(appId, entry).catch(() => {});
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
            updateSourceAvailability(appId, entry).catch(() => {});
            return;
          }
          console.log(`[STORE][SOURCE_SAVE] appid=${appId} provider=${savedProvider} hasPreview=${hasPreview}`);
          log("store-search", `saved { appId: "${appId}", sourceCount: ${entry.sourceCount} }`);

          updateSourceAvailability(appId, entry).catch(() => {});
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
              updateSourceAvailability(appId, { ...existing, status: "timeout", updatedAt: Math.floor(Date.now() / 1000) }).catch(() => {});
              return;
            }
            log("store-search", `timeout-nocache { appId: "${appId}" }`);
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
          }).catch(() => {});
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

  function handleSelectSearchItem(item: StoreSearchDropdownItem) {
    const game = mapSteamDropdownItemToPackageGame(item);

    setStoreSearchQuery("");
    setSubmittedSearchQuery("");
    setQuery("");
    setActiveSectionId(null);
    setSteamSubmittedSearchGames([]);

    // Open details immediately — source resolution (+ cache hydration) happens inside openDetailsForGame
    openDetailsForGame(game);
  }

  function handleBackFromDetails() {
    setSelectedDetailGame(null);
    setStoreSearchQuery("");
    setSubmittedSearchQuery("");
    setQuery("");
    setSteamSubmittedSearchGames([]);
  }

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

  function handleProviderChange(value: typeof selectedProvider) {
    setSelectedProvider(value);
    setActiveSectionId(null);
  }

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
    if (interaction >= 2 || (overlay && overlay.sources.some((s) => s.available) && (interaction >= 1))) {
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
          onInstallComplete={refreshInstalledScripts}
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
            selectedDetailGameWithOverlay.sources.some((s) => s.available)
          ? "ready"
          : "idle";

  if (selectedAppId) {
    log("store-search", `final status { appId: "${selectedAppId}", status: "${sourceStatus}", backgroundChecking: ${isBackgroundChecking}, sourceCount: ${selectedDetailGameWithOverlay?.sources.length ?? 0} }`);
  }



  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 px-5 pb-5 lg:px-7 lg:pb-7 lf-page-in">
      <div className="sticky top-0 z-30 -mx-5 border-b border-(--surface-active-border) bg-(--color-surface)/80 px-5 py-2.5 backdrop-blur-md lg:-mx-7 lg:px-7">
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {STORE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleStoreTabChange(tab.id)}
                    className={`relative cursor-pointer px-3 py-1.5 text-sm font-medium transition ${
                  activeStoreTab === tab.id
                    ? "text-(--color-accent)"
                    : "text-(--color-muted) hover:text-(--color-text)"
                }`}
              >
                {tab.label}
                {activeStoreTab === tab.id && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-(--color-accent)" />
                )}
              </button>
            ))}
          </div>

          <div className="ml-auto w-full max-w-[360px]">
            <PackagesToolbar
              compact
              query={storeSearchQuery}
              selectedProvider={selectedProvider}
              onQueryChange={handleToolbarQueryChange}
              onProviderChange={handleProviderChange}
              searchItems={steamSearchItems}
              searchLoading={steamSearchLoading}
              onSubmitSearch={submitSteamSearch}
              onViewAllSearchResults={submitSteamSearch}
              onSelectSearchItem={handleSelectSearchItem}
            />
          </div>
        </div>
      </div>

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
            installedStatusByAppId.get(selectedDetailGameWithOverlay.appId) ??
            "not-installed"
          }
          isSteamInstalled={ownershipLookup.isSteamInstalled(selectedDetailGameWithOverlay.appId)}
          luaInstalled={installedStatusByAppId.get(selectedDetailGameWithOverlay.appId) === "active"}
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
            const requestId = ++sourceResolveReqRef.current;
            const appId = game.appId;

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
            }).catch(() => {});

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
                updateSourceAvailability(appId, retryEntry).catch(() => {});
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
                  updateSourceAvailability(appId, entry).catch(() => {});
                  return;
                }
                updateSourceAvailability(appId, entry).catch(() => {});
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
                    updateSourceAvailability(appId, { ...existing, status: "timeout", updatedAt: Math.floor(Date.now() / 1000) }).catch(() => {});
                    return;
                  }
                  log("store-search", `timeout-nocache { appId: "${appId}" }`);
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
                }).catch(() => {});
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
      ) : activeSection ? (
        <section className="space-y-5">
          <button
            type="button"
            onClick={() => setActiveSectionId(null)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver al Store
          </button>

          <div>
            <h2 className="text-2xl font-bold text-(--color-text)">
              {activeSection.title}
            </h2>

            <p className="mt-1 text-sm text-(--color-muted)">
              {activeSection.description}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lf-card-stagger">
            {activeSection.games.map((game) => (
              <div key={"store:section:" + game.appId}>{renderStoreCard(game)}</div>
            ))}
          </div>
        </section>
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
            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-(--color-text)">
                  Search Results for "{submittedSearchQuery}"
                </h2>

                <p className="mt-1 text-sm text-(--color-muted)">
                  {mergedResults.length} game
                  {mergedResults.length === 1 ? "" : "s"} found
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lf-card-stagger">
                {mergedResults.map((game) => (
                  <div key={"store:search:" + game.appId}>{renderStoreCard(game)}</div>
                ))}
              </div>
            </section>
          );
        })()
      ) : activeStoreTab === "browse" ? (
        <div className="lf-tab-panel-in"><section className="space-y-5">
          {allStoreSections.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => { setActiveGenreSectionId(null); setBrowsePage(1); }}
                className={`whitespace-nowrap cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  activeGenreSectionId === null
                    ? "bg-(--color-accent) text-black"
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
                  className={`whitespace-nowrap cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    activeGenreSectionId === section.id
                      ? "bg-(--color-accent) text-black"
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
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lf-card-stagger">
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
                                onInstallComplete={refreshInstalledScripts}
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
                              className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
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
                                  className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-xs font-medium transition ${
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
                              className="inline-flex cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-xs text-(--color-muted) transition hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-30"
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
      ) : activeStoreTab === "lua-ready" ? (
        <div className="lf-tab-panel-in">
          {luaReadyGames.length === 0 ? (
            <StoreLuaReadyEmptyState />
          ) : (
            <section className="space-y-5">

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lf-card-stagger">
                {luaReadyGames.map((game) => (
                  <div key={"store:lua:" + game.appId}>{renderStoreCard(game)}</div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : activeStoreTab === "news" ? (
        <div className="lf-tab-panel-in"><StoreNewsFeed
          items={newsItems}
          onOpenGame={openDetailsForGame}
        /></div>
      ) : (
        <div className="lf-tab-panel-in"><div className="space-y-8">
          <StoreDiscoverHeroCarousel
            games={featuredGames}
            storeMetadataByAppId={storeMetadataByAppId}
            initialIndex={selectedHeroIndex}
            onIndexChange={setSelectedHeroIndex}
            onOpenGame={openDetailsForGame}
            onDownload={handleGameDownload}
            onOpenSourceSelector={openSourceSelectorForGame}
          />

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
          ) : discoverSections.map((section) => {
            const desc = section.id === "for-you"
              ? "Personalized picks based on your activity."
              : section.id === "top-picks"
                ? "Highest scored games in the catalog."
                : section.id === "new-noteworthy"
                  ? "Recently released games."
                  : section.id === "popular-genres"
                    ? "Browse games by genre."
                    : section.id === "featured"
                      ? "Curated high-quality games."
                      : section.id === "lua-ready-picks"
                        ? "Games with available download sources."
                        : section.id.startsWith("genre-")
                        ? `Popular ${section.title} games.`
                        : "";
            return (
              <StoreHorizontalSection
                key={section.id}
                sectionKey={section.id}
                title={section.title}
                description={desc}
                onViewAll={() => setActiveSectionId(section.id)}
              >
                {section.items.slice(0, SECTION_RAIL_INITIAL_COUNT).map((game, i) => {
                  if (DEBUG_STORE_RENDER_VERBOSE && i === 0) console.log(`[STORE][CARD_MOUNT_BUDGET] section=${section.id} total=${section.items.length} limit=${SECTION_RAIL_INITIAL_COUNT}`);
                  return renderStoreCard(game);
                })}
              </StoreHorizontalSection>
            );
          })}

          {moreToExploreGames.length > 0 && (
            <StoreHorizontalSection
              key="more-to-explore"
              sectionKey="more-to-explore"
              title="More to Explore"
              description={`${moreToExploreGames.length} games from the catalog`}
            >
              {moreToExploreGames.slice(0, MORE_TO_EXPLORE_MOUNT_LIMIT).map(renderStoreCard)}
            </StoreHorizontalSection>
          )}

          {providerReports.length > 0 && (
            <details className="lf-surface rounded-2xl border p-4">
              <summary className="cursor-pointer text-sm font-medium text-(--color-muted)">
                Advanced provider status
              </summary>

              <div className="mt-4">
                <ProviderSearchReport reports={providerReports} />
              </div>
            </details>
          )}

          {moreToExploreGames.length > 0 && rankedSteamCatalog.length > discoverMoreVisibleCount + CATALOG_PAGE_SIZE && (
            <div className="flex justify-center pb-4">
              <button
                type="button"
                onClick={increaseDiscoverVisibleCount}
                onMouseDown={(e) => e.stopPropagation()}
                className="cursor-pointer rounded-full border border-(--surface-active-border) bg-white/5 px-6 py-2 text-sm text-(--color-muted) transition hover:border-(--color-accent) hover:text-(--color-accent)"
              >
                Show More Games
              </button>
            </div>
          )}
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

function StoreLuaReadyEmptyState() {
  return (
    <div className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
        <Gamepad2 className="h-7 w-7 text-(--color-muted)" />
      </div>

      <h2 className="mt-4 font-semibold text-(--color-text)">
        No Lua-ready games found yet
      </h2>

      <p className="mt-1.5 text-sm text-(--color-muted)">
        Try configuring a provider in Settings or searching for games.
      </p>
    </div>
  );
}
