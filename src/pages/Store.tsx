import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  downloadAndInstallPackage,
  scanInstalledLuaScripts,
} from "../services/tauri";

import { getBestAvailableSource, getSourceKey } from "../utils/sourceHelpers";
import { isHttpUrl } from "../services/libraryLocalCacheService";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { parseReleaseDate } from "../services/globalCatalogService";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import { searchSteamStore } from "../services/steamStoreSearchResolver";
import { resolveProviderOverlaysForStoreGames, loadStoreProviderOverlayCache } from "../services/storeProviderOverlay";
import {
  loadSourceAvailabilityIndex,
  getSourceAvailability,
  updateSourceAvailability,
  buildSourceAvailabilityFromProviders,
} from "../services/sourceAvailabilityCacheService";
import { getEnabledProviderIds } from "../services/providerSearch";
import { consumePendingStoreDetailAppId } from "../services/storeNavigationService";
import { useLibraryGames } from "../context/LibraryGamesContext";
import type { SourceAvailabilityGameEntry, SourceCheckStatus } from "../services/sourceAvailabilityCacheService";
import {
  getCachedStoreDiscover,
  setCachedStoreDiscover,
  buildCatalogFingerprint,
  getCachedStoreUI,
  setCachedStoreUI,
  getCachedStoreMetadata,
  setCachedStoreMetadata,
} from "../services/storeDiscoverCache";
import type { CacheEntry as StoreDiscoverCacheEntry } from "../services/storeDiscoverCache";
import type { StoreDiscoverSection, StoreGame } from "../services/storeDiscoverCache";
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

const ENABLE_VERBOSE_SOURCE_LOGS = false;
const DEBUG_STORE_RENDER_VERBOSE = false;

// Module-level flag: prevents auto-open of pending detail from re-firing
// when the user navigates back to Store later in the same session.
let _sessionAutoOpenDone = false;

function log(origin: string, ...args: unknown[]) {
  if (ENABLE_VERBOSE_SOURCE_LOGS) {
    console.log(`[SourceResolve][${origin}]`, ...args);
  }
}


import {
  showError,
  showSuccess,
  showWarning,
} from "../components/toast/GameToast";

import type { PackageGame, PackageSource } from "../types/package";
import type { InstalledLuaScript } from "../types/installedLua";
import type { PackageInstallStatus } from "../types/packageInstall";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import { SkeletonBox, SkeletonHero, GridSkeleton } from "../components/common/Skeleton";

type StoreTab = "discover" | "browse" | "lua-ready" | "news";

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
const INITIAL_VISIBLE_COUNT = 80;
const CATALOG_PAGE_SIZE = 40;

/**
 * Maximum number of More to Explore cards to mount in the DOM.
 * Logical visible count can be higher, but only this many are actually rendered.
 * Keeps React reconciliation fast when scrolling through hundreds of catalog items.
 */
const MORE_TO_EXPLORE_MOUNT_LIMIT = 80;
const PAGE_SIZE = 30;



const RANKING_WEIGHTS = {
  popularity: 0.35,
  metadata: 0.20,
  provider: 0.20,
  recency: 0.15,
  userInterest: 0.10,
} as const;

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

export default function Store() {
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

  const [storeSearchQuery, setStoreSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");

  const [steamSearchItems, setSteamSearchItems] = useState<
    StoreSearchDropdownItem[]
  >([]);

  const [steamSearchLoading, setSteamSearchLoading] = useState(false);

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
  const [selectedHeroIndex, setSelectedHeroIndex] = useState(() => {
    const ui = getCachedStoreUI();
    return ui?.selectedHeroIndex ?? 0;
  });
  const [cachedAllStoreSections, setCachedAllStoreSections] = useState<StoreSectionModel[]>(() => {
    const cached = getCachedStoreDiscover();
    if (cached && cached.allStoreSections) return cached.allStoreSections;
    return [];
  });

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
      console.log(`[STORE][SHOW_MORE] old=${prev} added=${CATALOG_PAGE_SIZE} next=${next}`);
      return next;
    });
  }, []);

  const catalogFingerprint = steamCatalog.length > 0 ? buildCatalogFingerprint(steamCatalog) : "";
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
  }, []);

  // Cancellation guard for async Tauri operations — prevents setState after unmount
  const _mountedRef = useRef(true);
  useEffect(() => {
    _mountedRef.current = true;
    return () => { _mountedRef.current = false; };
  }, []);

  const { refresh: libraryRefresh, games } = useLibraryGames();

  async function refreshInstalledScripts() {
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
  }

  useEffect(() => {
    refreshInstalledScripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.luaPath]);

  const pendingAppIdRef = useRef<string | null>(null);

  // On mount, consume any pending store detail appId set by dashboard discovery sections
  useEffect(() => {
    const pending = consumePendingStoreDetailAppId();
    if (pending) {
      pendingAppIdRef.current = pending;
      console.log(`[STORE][PENDING_NAV] appid=${pending} waiting for catalog`);
    }
  }, []);

  useEffect(() => {
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
        }
      })
      .catch((err) => {
        console.error("[Store] Failed to load steamdb.json", err);
      });
    return () => { cancelled = true; };
  }, []);

  // Restore Store UI state from module-level cache on mount
  useEffect(() => {
    const ui = getCachedStoreUI();
    if (ui) {
      if (ui.selectedHeroIndex !== undefined) setSelectedHeroIndex(ui.selectedHeroIndex);
      if (ui.activeStoreTab && ui.activeStoreTab !== activeStoreTab) {
        setActiveStoreTab(ui.activeStoreTab as StoreTab);
      }
      if (ui.storeSearchQuery) setStoreSearchQuery(ui.storeSearchQuery);
      if (ui.submittedSearchQuery) setSubmittedSearchQuery(ui.submittedSearchQuery);
      if (ui.browsePage && ui.browsePage !== 1) setBrowsePage(ui.browsePage);
      if (ui.activeGenreSectionId !== undefined) setActiveGenreSectionId(ui.activeGenreSectionId);
      if (ui.discoverMoreVisibleCount !== undefined) setDiscoverMoreVisibleCount(ui.discoverMoreVisibleCount);
      // Do NOT auto-restore selectedDetailAppId — it was set to null in uiStateRef
      console.log(`[STORE][STATE_RESTORE] fromCache=true visibleCount=${ui.visibleCount} sections=${cachedAllStoreSections.length}`);
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
  }, [steamCatalog.length]);

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
    if (entry) {
      console.log(`[STORE][DETAILS_OPEN_EXPLICIT] appid=${appIdStr} reason=pending-nav`);
      const game: PackageGame = {
        appId: appIdStr,
        title: entry.name,
        platforms: [],
        sources: [],
      };
      openDetailsForGame(game);
    } else {
      console.log(`[STORE][PENDING_NAV] appid=${appIdStr} not found in catalog`);
    }
  }, [steamCatalog]);

  // React to store image cache changes — re-render when cache version bumps
  useEffect(() => {
    const id = setInterval(() => {
      const ver = getStoreImageCacheVersion();
      if (ver !== storeImageCacheVer) {
        setStoreImageCacheVer(ver);
      }
    }, 500);
    return () => clearInterval(id);
  }, [storeImageCacheVer]);

  // Recalculate trending scores every 30s
  useEffect(() => {
    const id = setInterval(() => setTrendRecalcKey((n) => n + 1), TRENDING_RECALC_MS);
    return () => clearInterval(id);
  }, []);

  // Recalculate trending on window focus
  useEffect(() => {
    const onFocus = () => setTrendRecalcKey((n) => n + 1);
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

    console.log(`[STORE][DISCOVER_BUILD_START] catalogSize=${steamCatalog.length}`);

    const sorted = [...steamCatalog];
    sorted.sort((a, b) => a.appid - b.appid);

    return sorted;
  }, [steamCatalog, catalogFingerprint]);

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

    return rankedSteamCatalog.map((entry) => {
      const id = String(entry.appid);
      const overlay = providerOverlayByAppId[id];
      const meta = storeMetadataByAppId[entry.appid];
      const interaction = interactionScoreByAppId[id] ?? 0;

      const metaScore = (meta?.header_image || meta?.capsule_image_v5) ? 1 : (meta ? 0.5 : 0);
      const provScore = (overlay && overlay.sources.some((s) => s.available)) ? 1 : 0;
      const recScore = Math.min(1, entry.appid / 400000);
      const userScore = Math.min(1, interaction / 5);
      const predictionBoost = meta?.genres
        ? meta.genres.reduce((sum, g) => sum + (genreConfidence[g] ?? 0), 0) * PREDICTION_BOOST_MULTIPLIER
        : 0;

      return {
        appId: id,
        title: entry.name,
        score:
          RANKING_WEIGHTS.popularity * 0 +
          RANKING_WEIGHTS.metadata * metaScore +
          RANKING_WEIGHTS.provider * provScore +
          RANKING_WEIGHTS.recency * recScore +
          RANKING_WEIGHTS.userInterest * (userScore + predictionBoost),
        hasSource: provScore > 0,
        hasMeta: metaScore > 0,
      };
    }).sort((a, b) => b.score - a.score);
  }, [rankedSteamCatalog, providerOverlayByAppId, storeMetadataByAppId, interactionScoreByAppId, genreConfidence, catalogFingerprint]);

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

  const steamInstalledByAppId = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => {
      if (g.appId && g.steamInstalled) set.add(g.appId);
    });
    return set;
  }, [games]);

  const luaInstalledByAppId = useMemo(() => {
    const set = new Set<string>();
    for (const [appId, status] of installedStatusByAppId) {
      if (status === "active") set.add(appId);
    }
    return set;
  }, [installedStatusByAppId]);

  useEffect(() => {
    const query = storeSearchQuery.trim();

    if (query.length < 2) {
      setSteamSearchItems([]);
      setSteamSearchLoading(false);
      return;
    }

    let cancelled = false;

    const timeoutId = window.setTimeout(async () => {
      try {
        setSteamSearchLoading(true);

        const steamItems = await searchSteamStore(query);

        if (cancelled) {
          return;
        }

        const steamDropdownItems: StoreSearchDropdownItem[] = steamItems.map(
          (item) => ({
            appId: String(item.app_id),
            title: item.name,
            subtitle: `AppID ${item.app_id}`,
            imageUrl: item.image_url || undefined,
            priceLabel: item.price_label || undefined,
            discountLabel: item.discount_label || undefined,
            installed: installedStatusByAppId.has(String(item.app_id)),
          })
        );

        setSteamSearchItems(steamDropdownItems);
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setSteamSearchItems([]);
        }
      } finally {
        if (!cancelled) {
          setSteamSearchLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [storeSearchQuery, installedStatusByAppId]);

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
    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint) {
      return cached.featuredGames;
    }

    const pool = highQualityPool.slice(0, 60);
    if (pool.length === 0) return [];

    // Day rotation within the top-scored pool for variety
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
    const count = Math.min(pool.length, 8);
    const start = dayOfYear % Math.max(1, pool.length - count + 1);
    const slice = pool.slice(start, start + count);

    return slice.map((s) => ({
      appId: s.appId,
      title: s.title,
      imageUrl: getBestStoreImage(s.appId, ["hero", "header", "capsule"]) || undefined,
      platforms: [] as string[],
      sources: [] as PackageSource[],
    }));
  }, [highQualityPool, catalogFingerprint]);

  // ── Rich Discover sections (new model) ──
  const discoverSections = useMemo(() => {
    const cached = getCachedStoreDiscover();
    // Bypass partial/incomplete cache — rebuild sections when metadata becomes available.
    // This ensures genre sections appear after metadata loads, even if first render cached nothing.
    if (cached && cached.catalogFingerprint === catalogFingerprint && cached.discoverSections && cached.discoverSections.length > 0 && !cached.isPartialCache) {
      return cached.discoverSections;
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
    const topHQ = highQualityPool.slice(0, 500);

    const topGames: StoreGame[] = topHQ.map((s) => ({
      appId: s.appId,
      title: s.title,
      imageUrl: getBestStoreImage(s.appId, ["capsule", "header", "hero"]) || undefined,
      platforms: [] as string[],
      sources: [] as PackageSource[],
    }));

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

    // --- Top Picks (top scored from high quality pool) ---
    const topPicks = topGames.slice(0, 20);
    const topUsed = new Set(usedIds);
    const topFiltered = topPicks.filter((g) => !topUsed.has(g.appId));
    if (topFiltered.length >= 4) {
      const items = takeUnique(topFiltered, 20);
      if (items.length > 0) {
        sections.push({ id: "top-picks", title: "Top Picks", type: "featured", items, source: "catalog" });
      }
    }

    // --- New and Noteworthy (by release date) ---
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
        sections.push({ id: "new-noteworthy", title: "New and Noteworthy", type: "rail", items: newest, source: "catalog" });
      }
    }

    // --- Genre groups (from metadata) ---
    const genreGroups = new Map<string, StoreGame[]>();
    for (const game of topGames) {
      if (usedIds.has(game.appId)) continue;
      const meta = storeMetadataByAppId[Number(game.appId)];
      if (!meta?.genres?.length) continue;
      for (const genre of meta.genres) {
        if (!genreGroups.has(genre)) genreGroups.set(genre, []);
        const list = genreGroups.get(genre)!;
        if (list.length < 20) {
          list.push(game);
        }
      }
    }

    // --- Genre rails (Action, Indie, Racing, Shooter) ---
    const DISPLAY_GENRES = ["Action", "Indie", "Racing", "Shooter"];
    for (const genre of DISPLAY_GENRES) {
      const games = genreGroups.get(genre);
      if (games && games.length >= 4) {
        const items = takeUnique([...games], 20);
        sections.push({ id: `genre-${genre.toLowerCase()}`, title: genre, type: "genre", items, source: "genre" });
      }
    }

    // --- Popular Genres overview (genre navigation rail) ---
    const availableGenres = DISPLAY_GENRES.filter((g) => genreGroups.has(g) && (genreGroups.get(g)?.length ?? 0) >= 4);
    if (availableGenres.length > 0) {
      const genreCards = availableGenres.slice(0, 7).flatMap((g) => (genreGroups.get(g) ?? []).slice(0, 2));
      const unique = takeUnique(genreCards, 20);
      if (unique.length > 0) {
        sections.push({ id: "popular-genres", title: "Popular Genres", type: "rail", items: unique, source: "catalog" });
      }
    }

    // --- Featured (high quality with media, was "Top Rated") ---
    const featuredCandidates = topGames.filter((g) => {
      const meta = storeMetadataByAppId[Number(g.appId)];
      return meta?.header_image || meta?.capsule_image_v5;
    });
    if (featuredCandidates.length >= 4) {
      const items = takeUnique(featuredCandidates, 20);
      if (items.length > 0) {
        sections.push({ id: "featured", title: "Featured", type: "featured", items, source: "catalog" });
      }
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

    return sections;
  }, [lumaForgeSections, highQualityPool, storeMetadataByAppId, installedStatusByAppId, interactionScoreByAppId, providerOverlayByAppId, featuredGames, trendingScoreByAppId, genreConfidence, catalogFingerprint]);

  // Backward-compat StoreSectionModel[] for consumers that still need it
  const sectionModels = useMemo<StoreSectionModel[]>(
    () => discoverSections.map((s) => ({ id: s.id, title: s.title, description: "", games: s.items as PackageGame[] })),
    [discoverSections],
  );

  // ── "More to Explore" games for Discover tab ──
  // Uses discoverMoreVisibleCount (independent of catalogGames' visibleCount).
  // Show More affects only discoverMoreVisibleCount, not Browse.
  const moreToExploreGames = useMemo(() => {
    const excludeIds = new Set<string>();
    featuredGames.forEach((g) => excludeIds.add(g.appId));
    sectionModels.forEach((s) => s.games.forEach((g) => excludeIds.add(g.appId)));
    const seen = new Set<string>();
    const effectiveDiscoverCount = discoverMoreVisibleCount > 0 ? discoverMoreVisibleCount : INITIAL_VISIBLE_COUNT;
    const games = rankedSteamCatalog
      .slice(0, effectiveDiscoverCount)
      .filter((entry) => {
        const appId = String(entry.appid);
        if (excludeIds.has(appId)) return false;
        if (seen.has(appId)) return false;
        seen.add(appId);
        return true;
      })
      .map((entry) => {
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
    console.log(`[STORE][MORE_RENDER] logicalVisible=${effectiveDiscoverCount} mounted=${mounted} totalPool=${games.length}`);
    return games;
  }, [rankedSteamCatalog, discoverMoreVisibleCount, featuredGames, sectionModels, storeMetadataByAppId]);

  const allStoreSections = useMemo(() => {
    const cached = getCachedStoreDiscover();
    if (cached && cached.catalogFingerprint === catalogFingerprint && cached.allStoreSections && cached.allStoreSections.length > 0) {
      return cached.allStoreSections;
    }
    const computed = [...lumaForgeSections, ...sectionModels];
    if (computed.length === 0 && cachedAllStoreSections.length > 0) {
      return cachedAllStoreSections;
    }
    return computed;
  }, [lumaForgeSections, sectionModels, catalogFingerprint, cachedAllStoreSections]);

  const browseGames = useMemo(() => {
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
    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[Store] browseGames: ${games.length} total games`);
    return games;
  }, [catalogBaseGames, lumaForgeSections, results, providerOverlayByAppId]);

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

    // Save to module-level cache for cross-navigation persistence
    if (catalogFingerprint && rankedSteamCatalog.length > 0) {
      const existing = getCachedStoreDiscover();
      const isComplete =
        featuredGames.length >= 4 &&
        discoverSections.length >= 5 &&
        moreToExploreGames.length >= 20;
      const fingerprintChanged = !existing || existing.catalogFingerprint !== catalogFingerprint;

      if (fingerprintChanged) {
        if (!isComplete) {
          // Incomplete — only save as partial if no valid existing cache exists
          if (!existing || existing.isPartialCache) {
            const elapsedMs = Date.now() - storeStartRef.current;
            console.log(`[STORE][DISCOVER_CACHE_BUILD] partial=true featured=${featuredGames.length} sections=${discoverSections.length} more=${moreToExploreGames.length} elapsedMs=${elapsedMs}`);
            setCachedStoreDiscover({
              catalogFingerprint,
              rankedSteamCatalog,
              highQualityPool,
              dynamicDiscoverSections: sectionModels,
              discoverSections,
              lumaForgeSections,
              allStoreSections,
              featuredGames,
              browseGames: browseGames as unknown as StoreDiscoverCacheEntry["browseGames"],
              luaReadyGames: luaReadyGames as unknown as StoreDiscoverCacheEntry["luaReadyGames"],
              builtAt: Date.now(),
              isPartialCache: true,
            });
          } else {
            console.log(`[STORE][DISCOVER_CACHE_WRITE_SKIP] reason=incomplete featured=${featuredGames.length} sections=${discoverSections.length} more=${moreToExploreGames.length}`);
          }
        } else {
          const elapsedMs = Date.now() - storeStartRef.current;
          console.log(`[STORE][DISCOVER_CACHE_BUILD] complete=true featured=${featuredGames.length} sections=${discoverSections.length} more=${moreToExploreGames.length} elapsedMs=${elapsedMs}`);
          setCachedStoreDiscover({
            catalogFingerprint,
            rankedSteamCatalog,
            highQualityPool,
            dynamicDiscoverSections: sectionModels,
            discoverSections,
            lumaForgeSections,
            allStoreSections,
            featuredGames,
            browseGames: browseGames as unknown as StoreDiscoverCacheEntry["browseGames"],
            luaReadyGames: luaReadyGames as unknown as StoreDiscoverCacheEntry["luaReadyGames"],
            builtAt: Date.now(),
          });
        }
        setCachedAllStoreSections(allStoreSections);
      }

      // Also save the unified Discover render state (includes moreToExploreGames, hero index)
      if (allStoreSections.length > 0 || featuredGames.length > 0) {
        setDiscoverState({
          fingerprint: catalogFingerprint,
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
  });

  const newsItems = useMemo<StoreNewsItem[]>(() => {
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

    return items;
  }, [browseGames, results, catalogGames, providerOverlayByAppId, storeMetadataByAppId, reviewSummaryByAppId, installedStatusByAppId, interactionScoreByAppId]);

  const filteredBrowseGames = useMemo(() => {
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

  // Visible appIds for metadata loading - does NOT depend on storeMetadataByAppId
  // Window includes: INITIAL_VISIBLE_COUNT base + current browse page window when on browse tab
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

    // Only add selected detail game's appId (not DLC - DLC is loaded in the detail page)
    if (selectedDetailGame) {
      const appId = Number(selectedDetailGame.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    }

    const ids = Array.from(appIds);
    if (DEBUG_STORE_RENDER_VERBOSE) console.log(`[STORE][METADATA_WINDOW_LOAD] requested=${ids.length}`);
    return ids;
    // NOTE: storeMetadataByAppId intentionally NOT in deps to avoid render loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogGames, results, allStoreSections, steamSearchItems, steamSubmittedSearchGames, selectedDetailGame, activeStoreTab, browsePage]);

  const visibleAppIdsKey = visibleAppIds.join(",");

  // Only reload metadata when the key actually changes
  useEffect(() => {
    if (visibleAppIdsKey === appIdScopeKeyRef.current) return;
    appIdScopeKeyRef.current = visibleAppIdsKey;

    if (visibleAppIds.length === 0) {
      setStoreMetadataByAppId({});
      return;
    }

    let cancelled = false;

    async function loadStoreMetadata() {
      try {
        const metadata = await batchedLoad(
          visibleAppIds,
          resolveGameMetadata,
          METADATA_CONCURRENCY
        );

        if (!cancelled) {
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
  }, [visibleAppIdsKey]);

  // Persist metadata to module-level cache so it survives mount/unmount
  useEffect(() => {
    if (Object.keys(storeMetadataByAppId).length > 0) {
      setCachedStoreMetadata(storeMetadataByAppId as unknown as Record<number, Record<string, unknown>>);
    }
  }, [storeMetadataByAppId]);

  // Smart preload: proactively load metadata for upcoming items
  useEffect(() => {
    const preloadIds: number[] = [];

    // Top scored games from high quality pool
    for (const entry of highQualityPool.slice(0, 30)) {
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
        setStoreMetadataByAppId((prev) => ({ ...prev, ...metadata }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highQualityPool, featuredGames, allStoreSections, steamCatalog.length]);

  // Pre-populate Store image cache for visible app IDs (display-only, no local media index)
  // Re-runs when metadata loads so URLs become available for cached Discover sections.
  // resolveStoreDisplayImage is idempotent — calls for already-cached entries are no-ops.
  useEffect(() => {
    if (visibleAppIds.length === 0) return;
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
      console.log(`[STORE][IMAGE_CACHE_SEED] newlySeeded=${seeded}/${visibleAppIds.length} cacheSize=${getStoreImageCacheSize()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAppIdsKey, storeMetadataByAppId]);

  useEffect(() => {
    if (visibleAppIdsKey === appIdScopeKeyRef.current) return;

    if (visibleAppIds.length === 0) {
      setReviewSummaryByAppId({});
      return;
    }

    let cancelled = false;

    async function loadReviewSummaries() {
      try {
        const summaries = await batchedLoad(
          visibleAppIds,
          resolveGameReviewSummaries,
          REVIEW_CONCURRENCY
        );

        if (!cancelled) {
          setReviewSummaryByAppId(summaries);
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
  }, [visibleAppIdsKey]);

  const selectedDetailRelatedGames = useMemo<StoreMoreLikeThisGame[]>(() => {
    if (!selectedDetailGameWithOverlay) {
      return [];
    }

    const relatedMap = new Map<string, PackageGame>();

    catalogGames.forEach((game) => {
      if (game.appId !== selectedDetailGameWithOverlay.appId) {
        relatedMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      }
    });

    allStoreSections.forEach((section) => {
      section.games.forEach((game) => {
        if (game.appId !== selectedDetailGameWithOverlay.appId) {
          relatedMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
        }
      });
    });

    results.forEach((game) => {
      if (game.appId !== selectedDetailGameWithOverlay.appId) {
        relatedMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      }
    });

    return Array.from(relatedMap.values())
      .slice(0, 16)
      .map((game) => ({
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

  function openSourceSelectorForGame(game: PackageGame) {
    setSourceSelectorGame(game);
  }

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
        console.log(`[STORE][SOURCES_LOAD] appid=${appId} savedSelected=${overlaySourceReady} provider=${cached.game.sources.find(s => s.available)?.providerName || "unknown"} status=ready`);
        return true;
      }
    } catch (e) {
      log("store-search", `overlay cache error { appId: "${appId}", error: ${e} }`);
    }
    return false;
  }

  function openDetailsForGame(game: PackageGame) {
    // Track view + click interactions
    pushInteractionEvent(game.appId, "view");
    pushInteractionEvent(game.appId, "click");

    // Track interaction for user profile (legacy counter)
    setInteractionScoreByAppId((prev) => ({
      ...prev,
      [game.appId]: (prev[game.appId] ?? 0) + 1,
    }));

    const requestId = ++sourceResolveReqRef.current;
    const cached = getSourceAvailability(game.appId);
    const appId = game.appId;

    log("store-search", `start { appId: "${appId}", title: "${game.title}" }`);

    if (cached) {
      log("store-search", `cache hit { appId: "${appId}", status: "${cached.status}" }`);

      if (cached.status === "ready" && game.sources.length === 0) {
        log("store-search", `browse cache hit { appId: "${appId}", hydrating ${cached.sourceCount} sources }`);
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

      if (cached.status === "ready") {
        const loadedOverlay = tryLoadOverlayCache(appId);
        if (loadedOverlay) {
          console.log(`[STORE][SOURCES_SEARCH_SKIP] appid=${appId} reason=saved-selected-source provider=${cached.availableSources[0]?.name || "unknown"}`);
        }
        return;
      }

      if (cached.status === "none") {
        return;
      }
    } else {
      log("store-search", `cache miss { appId: "${appId}" }`);
      setSelectedDetailGame(game);
    }

    setActiveSectionId(null);

    setSourcesLoadingByAppId((current) => ({
      ...current,
      [appId]: true,
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

    resolveProviderOverlaysForStoreGames([game], settings)
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

        const entry = buildSourceAvailabilityFromProviders(
          appId,
          game.title,
          resolvedGame.sources,
          totalProviders
        );
        const savedProvider = resolvedGame.sources.find(s => s.available)?.providerName || "none";
        console.log(`[STORE][SOURCE_SAVE] appid=${appId} provider=${savedProvider} hasPreview=${hasPreview}`);
        log("store-search", `saved { appId: "${appId}", sourceCount: ${entry.sourceCount} }`);

        updateSourceAvailability(appId, entry).catch(() => {});
      })
      .catch((error: unknown) => {
        if (requestId !== sourceResolveReqRef.current) return;

        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = message.toLowerCase().includes("timeout");

        log("store-search", `${isTimeout ? "timeout" : "error"} { appId: "${appId}", error: "${message}" }`);

        updateSourceAvailability(appId, {
          appId,
          title: game.title,
          status: isTimeout ? "timeout" : "error",
          luaReady: false,
          availableSources: [],
          sourceCount: 0,
          totalProviderCount: 0,
          updatedAt: Math.floor(Date.now() / 1000),
        }).catch(() => {});
      })
      .finally(() => {
        if (requestId !== sourceResolveReqRef.current) {
          return;
        }
        setSourcesLoadingByAppId((current) => ({
          ...current,
          [appId]: false,
        }));
      });
  }

  function handleSelectSearchItem(item: StoreSearchDropdownItem) {
    const game = mapSteamDropdownItemToPackageGame(item);

    setStoreSearchQuery("");
    setSubmittedSearchQuery("");
    setQuery("");
    setActiveSectionId(null);
    setSteamSearchItems([]);
    setSteamSubmittedSearchGames([]);

    // Open details immediately — source resolution (+ cache hydration) happens inside openDetailsForGame
    openDetailsForGame(game);
  }

  function handleBackFromDetails() {
    setSelectedDetailGame(null);
    setStoreSearchQuery("");
    setSubmittedSearchQuery("");
    setQuery("");
    setSteamSearchItems([]);
    setSteamSubmittedSearchGames([]);
  }

  function handleStoreTabChange(tab: StoreTab) {
    setActiveStoreTab(tab);
    setActiveSectionId(null);
    setActiveGenreSectionId(null);
    setSelectedDetailGame(null);
    setSteamSearchItems([]);
    setSteamSubmittedSearchGames([]);
    setStoreSearchQuery("");
    setSubmittedSearchQuery("");
    setQuery("");
  }

  function handleProviderChange(value: typeof selectedProvider) {
    setSelectedProvider(value);
    setActiveSectionId(null);
  }

  async function downloadFromSource(game: PackageGame, source: PackageSource) {
    if (!_mountedRef.current) return;

    if (!source.available) {
      showWarning("Selecciona una fuente disponible antes de descargar.", {
        title: "Fuente requerida",
      });
      return;
    }

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
      gameTitle: game.title,
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

      if (!_mountedRef.current) {
        console.log(`[STORE][ASYNC_CANCELLED] appid=${game.appId} stage=after-download`);
        return;
      }

      updateJob(job.id, {
        status: "done",
        progress: 100,
        bytesRead: result.bytes_read,
        totalBytes: result.total_bytes,
      });

      showSuccess(result.message, {
        title: "Paquete instalado",
      });

      refreshInstalledScripts();

      // Auto-register newly installed Lua package with library games context
      console.log(`[LUA][REGISTER_PACKAGE] appid=${game.appId} provider=${source.providerName} title="${game.title}"`);
      libraryRefresh().then(() => {
        console.log(`[LIBRARY][GAME_UPSERT] appid=${game.appId} action=refresh`);
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[LIBRARY][GAME_UPSERT] appid=${game.appId} error="${msg}"`);
      });
    } catch (error) {
      if (!_mountedRef.current) {
        console.log(`[STORE][ASYNC_CANCELLED] appid=${game.appId} stage=error`);
        return;
      }

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

      // Parse HTTP status code from Rust error message (e.g. "Status: 401")
      const statusMatch = message.match(/Status:\s*(\d+)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const isAuthError = statusCode === 401 || statusCode === 403;

      if (isAuthError) {
        console.log(`[STORE][PROVIDER_DOWNLOAD_FAILED] appid=${game.appId} provider=${source.providerName} status=${statusCode} title="${game.title}"`);

        // Mark source as failed in cache, but preserve available sources for Change Source option
        updateSourceAvailability(game.appId, {
          appId: game.appId,
          title: game.title,
          status: "error",
          luaReady: false,
          availableSources: game.sources.filter((s) => s.available).map((s) => ({
            id: s.providerId,
            name: s.providerName,
            type: s.fileType,
            status: "ready",
            packageUrl: s.downloadUrl,
            updatedAt: Math.floor(Date.now() / 1000),
          })),
          sourceCount: game.sources.filter((s) => s.available).length,
          totalProviderCount: game.sources.length,
          updatedAt: Math.floor(Date.now() / 1000),
        }).catch(() => {});

        const settingsHint = source.providerName === "HubcapDB"
          ? `Revisa la API key en Configuración > Providers.`
          : `Verifica la API key o permisos.`;
        showError(
          `${source.providerName} rechazó la descarga. ${settingsHint} (HTTP ${statusCode})`,
          { title: "Descarga fallida" }
        );
      } else {
        showError(message, {
          title: "Instalación fallida",
        });
      }
    }
  }

  async function handleDownloadSource(source: PackageSource) {
    const game = selectedDetailGameWithOverlay;

    if (!game) {
      return;
    }

    await downloadFromSource(game, source);
  }

  async function handleDownloadSourceForGame(
    game: PackageGame,
    source: PackageSource
  ) {
    await downloadFromSource(game, source);
  }

  async function handleGameDownload(game: PackageGame) {
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
    const appIdNum = Number(appId);

    // Priority order: Recommended > Trending > Top Rated > Popular > New > Has Sources
    const candidates: { type: StoreBadge["type"]; label: string; score: number }[] = [];

    // 1. Recommended
    if (interaction >= 1 && !isInstalled) {
      candidates.push({ type: "recommended", label: "Recommended", score: 6 });
    }

    // 2. Trending: high interaction or has sources + recent
    if (interaction >= 2 || (overlay && overlay.sources.some((s) => s.available) && appIdNum > 200000)) {
      candidates.push({ type: "trending", label: "Trending", score: 5 });
    }

    // 3. Top Rated: has metadata with images
    if (meta?.header_image || meta?.capsule_image_v5) {
      candidates.push({ type: "top-rated", label: "Top Rated", score: 4 });
    }

    // 4. Popular
    if (interaction >= 3) {
      candidates.push({ type: "popular", label: "Popular", score: 3 });
    }

    // 5. New: high appId (recently added to Steam)
    if (appIdNum > 300000) {
      candidates.push({ type: "new", label: "New", score: 2 });
    }

    // 6. Has Sources
    if (overlay && overlay.sources.some((s) => s.available)) {
      candidates.push({ type: "has-sources", label: "Has Sources", score: 1 });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, MAX_BADGES).map(({ type, label }) => ({ type, label }));
  }

  function renderStoreCard(game: PackageGame) {
    const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;
    const badges = getBadgesForGame(game.appId);

    return (
      <div
        className="lf-virtual-card"
        style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
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
          : "none";

  if (selectedAppId) {
    log("store-search", `final status { appId: "${selectedAppId}", status: "${sourceStatus}", sourceCount: ${selectedDetailGameWithOverlay?.sources.length ?? 0} }`);
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
          isSteamInstalled={steamInstalledByAppId.has(selectedDetailGameWithOverlay.appId)}
          luaInstalled={luaInstalledByAppId.has(selectedDetailGameWithOverlay.appId)}
          selectedSource={getSelectedSourceForGame(selectedDetailGameWithOverlay)}
          sourceStatus={sourceStatus}
          moreLikeThisGames={selectedDetailRelatedGames}
          onBack={handleBackFromDetails}
          onDownloadSource={handleDownloadSource}
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
                  setProviderOverlayByAppId((current) => ({
                    ...current,
                    [appId]: overlayGame,
                  }));
                }
                const resolvedGame = overlayGame ?? game;
                const totalProviders = resolvedGame.sources.length;
                const entry = buildSourceAvailabilityFromProviders(
                  appId,
                  game.title,
                  resolvedGame.sources,
                  totalProviders
                );
        log("store-search", `saved { appId: "${appId}", sourceCount: ${entry.sourceCount} }`);
                updateSourceAvailability(appId, entry).catch(() => {});
              })
              .catch((error: unknown) => {
                if (requestId !== sourceResolveReqRef.current) return;
                const message = error instanceof Error ? error.message : String(error);
                const isTimeout = message.toLowerCase().includes("timeout");
        log("store-search", `${isTimeout ? "timeout" : "error"} { appId: "${appId}", error: "${message}" }`);
                updateSourceAvailability(appId, {
                  appId,
                  title: game.title,
                  status: isTimeout ? "timeout" : "error",
                  luaReady: false,
                  availableSources: [],
                  sourceCount: 0,
                  totalProviderCount: 0,
                  updatedAt: Math.floor(Date.now() / 1000),
                }).catch(() => {});
              })
              .finally(() => {
                if (requestId !== sourceResolveReqRef.current) return;
                setSourcesLoadingByAppId((current) => ({
                  ...current,
                  [appId]: false,
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
                                style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
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

          {discoverSections.map((section) => {
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
                {section.items.map(renderStoreCard)}
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
