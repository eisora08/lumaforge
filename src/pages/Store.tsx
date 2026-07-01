import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
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
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import { resolveFeaturedStoreCategories } from "../services/steamFeaturedResolver";
import { searchSteamStore } from "../services/steamStoreSearchResolver";
import { resolveProviderOverlaysForStoreGames } from "../services/storeProviderOverlay";
import {
  loadSourceAvailabilityIndex,
  getSourceAvailability,
  updateSourceAvailability,
  buildSourceAvailabilityFromProviders,
} from "../services/sourceAvailabilityCacheService";
import type { SourceAvailabilityGameEntry, SourceCheckStatus } from "../services/sourceAvailabilityCacheService";

const ENABLE_VERBOSE_SOURCE_LOGS = false;

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
import type {
  SteamFeaturedCategory,
  SteamFeaturedItem,
} from "../types/steamFeatured";

import { SkeletonBox, SkeletonHero, GridSkeleton } from "../components/common/Skeleton";

type StoreTab = "discover" | "browse" | "lua-ready" | "news";

const STORE_TABS: { id: StoreTab; label: string }[] = [
  { id: "discover", label: "Discover" },
  { id: "browse", label: "Browse" },
  { id: "lua-ready", label: "Lua Ready" },
  { id: "news", label: "News" },
];

type StoreSectionModel = {
  id: string;
  title: string;
  description: string;
  games: PackageGame[];
};

const METADATA_CONCURRENCY = 5;
const REVIEW_CONCURRENCY = 3;
const INITIAL_CATALOG_SIZE = 500;
const BATCH_SIZE = 200;
const PAGE_SIZE = 30;

function mapSteamFeaturedItemToPackageGame(
  item: SteamFeaturedItem
): PackageGame {
  return {
    appId: String(item.app_id),
    title: item.name,
    developer: undefined,
    imageUrl:
      item.large_capsule_image ||
      item.header_image ||
      item.small_capsule_image ||
      undefined,
    platforms: item.platforms,
    sources: [],
  };
}

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

function mapSteamCategoryToStoreSection(
  category: SteamFeaturedCategory
): StoreSectionModel {
  return {
    id: `steam-${category.id}`,
    title: category.name,
    description: "Selección destacada desde Steam Store.",
    games: category.items.map(mapSteamFeaturedItemToPackageGame),
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
  >({});

  const [reviewSummaryByAppId, setReviewSummaryByAppId] = useState<
    Record<number, SteamReviewSummary>
  >({});

  const [steamFeaturedCategories, setSteamFeaturedCategories] = useState<
    SteamFeaturedCategory[]
  >([]);

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

  const [steamCatalog, setSteamCatalog] = useState<{ appid: number; name: string }[]>([]);
  const [visibleCount] = useState(INITIAL_CATALOG_SIZE);

  const sourceCacheLoadedRef = useRef(false);
  useEffect(() => {
    if (sourceCacheLoadedRef.current) return;
    sourceCacheLoadedRef.current = true;
    loadSourceAvailabilityIndex().catch(() => {});
  }, []);

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

  const featuredRequestRef = useRef(0);

  useEffect(() => {
    const requestId = ++featuredRequestRef.current;

    async function loadSteamFeaturedCategories() {
      try {
        const categories = await resolveFeaturedStoreCategories();

        if (requestId === featuredRequestRef.current) {
          setSteamFeaturedCategories(categories);
        }
      } catch (error) {
        console.error(error);

        if (requestId === featuredRequestRef.current) {
          setSteamFeaturedCategories([]);
        }
      }
    }

    loadSteamFeaturedCategories();
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
          console.log(`[Store] steamdb.json loaded: ${data.length} total games`);
        }
      })
      .catch((err) => {
        console.error("[Store] Failed to load steamdb.json", err);
      });
    return () => { cancelled = true; };
  }, []);

  const steamStoreSections = useMemo(() => {
    return steamFeaturedCategories
      .map(mapSteamCategoryToStoreSection)
      .filter((section) => section.games.length > 0)
      .slice(0, 6);
  }, [steamFeaturedCategories]);

  const rankedSteamCatalog = useMemo(() => {
    if (steamCatalog.length === 0) return [];

    const featuredSet = new Set<string>();
    steamStoreSections.forEach((section) => {
      section.games.forEach((g) => featuredSet.add(g.appId));
    });

    const sorted = [...steamCatalog];
    sorted.sort((a, b) => {
      const aScore = featuredSet.has(String(a.appid)) ? 10000 : 0;
      const bScore = featuredSet.has(String(b.appid)) ? 10000 : 0;
      if (bScore !== aScore) return bScore - aScore;
      return a.appid - b.appid;
    });

    return sorted;
  }, [steamCatalog, steamStoreSections]);

  const catalogGames = useMemo(() => {
    const slice = rankedSteamCatalog.slice(0, visibleCount);
    console.log(`[Store] catalogGames: ${slice.length} / ${rankedSteamCatalog.length} games rendered (visibleCount: ${visibleCount})`);
    return slice.map((entry) => ({
      appId: String(entry.appid),
      title: entry.name,
      imageUrl: undefined as string | undefined,
      platforms: [] as string[],
      sources: [] as PackageSource[],
    }));
  }, [rankedSteamCatalog, visibleCount]);

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
    const featuredGames = steamStoreSections.flatMap((section) => section.games);
    const allGames = [...featuredGames, ...catalogGames];

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
  }, [steamStoreSections, catalogGames]);

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

  const dynamicDiscoverSections = useMemo(() => {
    const usedIds = new Set<string>();
    steamStoreSections.forEach((s) => s.games.forEach((g) => usedIds.add(g.appId)));
    lumaForgeSections.forEach((s) => s.games.forEach((g) => usedIds.add(g.appId)));

    function takeUnique(games: PackageGame[], limit: number) {
      const out: PackageGame[] = [];
      for (const g of games) {
        if (usedIds.has(g.appId)) continue;
        usedIds.add(g.appId);
        out.push(g);
        if (out.length >= limit) break;
      }
      return out;
    }

    const sections: StoreSectionModel[] = [];

    const topRaw = rankedSteamCatalog.slice(0, 500);
    const topGames: PackageGame[] = topRaw.map((e) => ({
      appId: String(e.appid),
      title: e.name,
      imageUrl: undefined as string | undefined,
      platforms: [] as string[],
      sources: [] as PackageSource[],
    }));

    // --- New Releases ---
    const newest = [...topGames].sort((a, b) => Number(b.appId) - Number(a.appId));
    const nr = takeUnique(newest, 20);
    if (nr.length > 0) {
      sections.push({ id: "new-releases", title: "New Releases", description: "Latest games added to the catalog.", games: nr });
    }

    // --- Trending Now ---
    const trending = [...topGames].sort((a, b) => Number(b.appId) - Number(a.appId));
    const tr = takeUnique(trending, 20);
    if (tr.length > 0) {
      sections.push({ id: "trending", title: "Trending Now", description: "Popular games in the catalog.", games: tr });
    }

    // --- Top Sellers ---
    const ts = takeUnique(topGames, 20);
    if (ts.length > 0) {
      sections.push({ id: "top-sellers", title: "Top Sellers", description: "Popular games in the catalog.", games: ts });
    }

    // --- Specials (daily rotating selection) ---
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
    const specialsPool = topGames.filter((g) => !usedIds.has(g.appId));
    if (specialsPool.length > 20) {
      const start = dayOfYear % (specialsPool.length - 20);
      const specials = takeUnique(specialsPool.slice(start, start + 40), 20);
      if (specials.length > 0) {
        sections.push({ id: "specials", title: "Specials", description: "Curated selection for today.", games: specials });
      }
    }

    // --- Genres (from metadata, limited to top games) ---
    const genreGroups = new Map<string, PackageGame[]>();
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
    const TARGET_GENRES = ["Action", "RPG", "Shooter", "Indie", "Simulation", "Adventure", "Strategy"];
    for (const genre of TARGET_GENRES) {
      const games = genreGroups.get(genre);
      if (games && games.length >= 4) {
        sections.push({ id: `genre-${genre.toLowerCase()}`, title: genre, description: `Popular ${genre} games`, games });
        games.forEach((g) => usedIds.add(g.appId));
      }
    }

    // --- Recommended for You (based on installed games' genres) ---
    const preferredGenres = new Set<string>();
    for (const [appIdStr] of installedStatusByAppId) {
      const meta = storeMetadataByAppId[Number(appIdStr)];
      if (meta?.genres) meta.genres.forEach((g) => preferredGenres.add(g));
    }
    if (preferredGenres.size > 0) {
      const recommended = topGames.filter((g) => {
        if (usedIds.has(g.appId) || installedStatusByAppId.has(g.appId)) return false;
        const meta = storeMetadataByAppId[Number(g.appId)];
        return meta?.genres?.some((gen) => preferredGenres.has(gen));
      });
      const rec = takeUnique(recommended, 20);
      if (rec.length > 0) {
        sections.push({ id: "recommended", title: "Recommended for You", description: "Based on your installed games.", games: rec });
      }
    }

    return sections;
  }, [steamStoreSections, lumaForgeSections, rankedSteamCatalog, storeMetadataByAppId, installedStatusByAppId]);

  const allStoreSections = useMemo(() => {
    return [...steamStoreSections, ...lumaForgeSections, ...dynamicDiscoverSections];
  }, [steamStoreSections, lumaForgeSections, dynamicDiscoverSections]);

  const browseGames = useMemo(() => {
    const gameMap = new Map<string, PackageGame>();

    catalogGames.forEach((game) => {
      gameMap.set(game.appId, game);
    });

    steamStoreSections.forEach((section) => {
      section.games.forEach((game) => {
        gameMap.set(game.appId, providerOverlayByAppId[game.appId] ?? game);
      });
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
    console.log(`[Store] browseGames: ${games.length} total games`);
    return games;
  }, [catalogGames, steamStoreSections, lumaForgeSections, results, providerOverlayByAppId]);

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

    steamStoreSections.forEach((section) => {
      section.games.forEach(addIfReady);
    });

    console.log(`[Store] luaReadyGames: ${games.length} games`);
    return games;
  }, [catalogGames, results, steamStoreSections, providerOverlayByAppId]);

  const featuredGames = useMemo(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));

    const pool: PackageGame[] = [];
    const seen = new Set<string>();

    function tryAdd(game: PackageGame) {
      if (seen.has(game.appId)) return;
      seen.add(game.appId);
      pool.push(providerOverlayByAppId[game.appId] ?? game);
    }

    // Priority: ranked catalog (first 200 are most relevant)
    catalogGames.slice(0, 200).forEach(tryAdd);
    // Also include featured/luma/results for variety
    steamStoreSections.forEach((s) => s.games.forEach(tryAdd));
    lumaForgeSections.forEach((s) => s.games.forEach(tryAdd));
    results.forEach(tryAdd);

    // Rotate based on day of year so hero changes daily
    const count = Math.min(pool.length, 8);
    const start = dayOfYear % Math.max(1, pool.length - count + 1);
    return pool.slice(start, start + count);
  }, [catalogGames, steamStoreSections, lumaForgeSections, results, providerOverlayByAppId]);

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

    const topGames = browseGames.slice(0, 12);
    for (const game of topGames) {
      const meta = storeMetadataByAppId[Number(game.appId)];
      const hasSources = game.sources.some((s) => s.available);
      const isInstalled = installedStatusByAppId.has(game.appId);

      if (hasSources) {
        tryAdd(game, "Lua Ready", "Today", `${game.title} is Lua Ready`, `${game.title} has compatible download sources available in LumaForge.`);
      }

      if (isInstalled) {
        tryAdd(game, "Installed", "Today", `${game.title} is installed and ready`, `${game.title} is installed in your library and ready to use.`);
      }

      if (meta && meta.dlc_count > 0) {
        const dlcLabel = meta.dlc_count === 1 ? "1 DLC" : `${meta.dlc_count} DLCs`;
        tryAdd(game, "DLC", "This Week", `${game.title} has ${dlcLabel} available`, `Additional content detected from Steam metadata for ${game.title}.`);
      }
    }

    for (const section of steamStoreSections.slice(0, 3)) {
      for (const game of section.games.slice(0, 2)) {
        if (usedAppIds.has(game.appId)) continue;
        tryAdd(game, "Featured", "This Week", `${game.title} is featured in Store`, `${game.title} is featured in the "${section.title}" collection on the Store.`);
      }
    }

    const extraGames = results.filter((g) => !usedAppIds.has(g.appId)).slice(0, 4);
    for (const game of extraGames) {
      tryAdd(game, "Store", "Earlier", `${game.title} found in provider search`, `${game.title} was found in search results from your configured providers.`);
    }

    return items;
  }, [browseGames, steamStoreSections, results, providerOverlayByAppId, storeMetadataByAppId, installedStatusByAppId]);

  const filteredBrowseGames = useMemo(() => {
    let games = browseGames;

    if (activeGenreSectionId) {
      const section = steamStoreSections.find(
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
    steamStoreSections,
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
  const visibleAppIds = useMemo(() => {
    const appIds = new Set<number>();

    catalogGames.forEach((game) => {
      const appId = Number(game.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    });

    results.forEach((game) => {
      const appId = Number(game.appId);
      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    });

    steamStoreSections.forEach((section) => {
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
    console.log(`[Store] visibleAppIds: ${ids.length} total unique app IDs`);
    return ids;
    // NOTE: storeMetadataByAppId intentionally NOT in deps to avoid render loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogGames, results, steamStoreSections, steamSearchItems, steamSubmittedSearchGames, selectedDetailGame]);

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
          console.log(`[Store] metadata loaded: ${Object.keys(metadata).length} games resolved`);
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

  // Smart preload: proactively load metadata for upcoming items
  useEffect(() => {
    const preloadIds: number[] = [];

    // Next batch of catalog games (beyond current visibleCount)
    const nextBatchEnd = Math.min(visibleCount + BATCH_SIZE, rankedSteamCatalog.length);
    for (let i = visibleCount; i < nextBatchEnd; i++) {
      const entry = rankedSteamCatalog[i];
      if (entry) preloadIds.push(entry.appid);
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
  }, [visibleCount, steamCatalog.length]);

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

  function openSourceSelectorForGame(game: PackageGame) {
    setSourceSelectorGame(game);
  }

  const sourceResolveReqRef = useRef(0);

  function openDetailsForGame(game: PackageGame) {
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

      if (cached.status === "ready" || cached.status === "none") {
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

  function renderStoreCard(game: PackageGame) {
    const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;

    return (
      <div
        key={game.appId}
        className="lf-virtual-card"
        style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
      >
        <PackageCard
          game={gameWithOverlay}
          storeMetadata={storeMetadataByAppId[Number(game.appId)]}
          reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
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
    <div className="mx-auto w-full max-w-[1440px] space-y-5 px-5 pb-5 lg:px-7 lg:pb-7 lf-fade-in">
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
          selectedSource={getSelectedSourceForGame(selectedDetailGameWithOverlay)}
          sourceStatus={sourceStatus}
          moreLikeThisGames={selectedDetailRelatedGames}
          onBack={handleBackFromDetails}
          onDownloadSource={handleDownloadSource}
          onOpenGame={openDetailsForGame}
          onSelectSourceKey={(sourceKey) =>
            setSelectedSourceKeyByAppId((current) => ({
              ...current,
              [selectedDetailGameWithOverlay.appId]: sourceKey,
            }))
          }
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
            {activeSection.games.map(renderStoreCard)}
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
                {mergedResults.map(renderStoreCard)}
              </div>
            </section>
          );
        })()
      ) : activeStoreTab === "browse" ? (
        <section className="space-y-5">
          {steamStoreSections.length > 0 && (
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

              {steamStoreSections.map((section) => (
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
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lf-card-stagger">
                        {pageGames.map((game) => {
                          const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;
                          return (
                            <div
                              key={game.appId}
                              className="lf-virtual-card"
                              style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
                            >
                              <PackageCard
                                game={gameWithOverlay}
                                storeMetadata={storeMetadataByAppId[Number(game.appId)]}
                                reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
                                onInstallComplete={refreshInstalledScripts}
                                onOpenDetails={openDetailsForGame}
                                onOpenSourceSelector={openSourceSelectorForGame}
                                onDownload={handleGameDownload}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 pt-4">
                        <button
                          type="button"
                          disabled={safePage <= 1}
                          onClick={() => setBrowsePage(safePage - 1)}
                          className="cursor-pointer rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) transition hover:bg-white/10 disabled:cursor-default disabled:opacity-30"
                        >
                          Previous
                        </button>

                        {(() => {
                          const pages: (number | "...")[] = [];
                          const maxVisible = 7;

                          if (totalPages <= maxVisible + 2) {
                            for (let i = 1; i <= totalPages; i++) pages.push(i);
                          } else {
                            pages.push(1);
                            let start = Math.max(2, safePage - 2);
                            let end = Math.min(totalPages - 1, safePage + 2);

                            if (safePage <= 4) {
                              end = Math.min(maxVisible - 1, totalPages - 1);
                            }
                            if (safePage >= totalPages - 3) {
                              start = Math.max(2, totalPages - maxVisible + 2);
                            }

                            if (start > 2) pages.push("...");
                            for (let i = start; i <= end; i++) pages.push(i);
                            if (end < totalPages - 1) pages.push("...");
                            pages.push(totalPages);
                          }

                          return pages.map((p, i) =>
                            p === "..." ? (
                              <span key={`ellipsis-${i}`} className="px-1 text-sm text-(--color-muted)">...</span>
                            ) : (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setBrowsePage(p)}
                                className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                                  safePage === p
                                    ? "bg-(--color-accent) text-black"
                                    : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:text-(--color-text)"
                                }`}
                              >
                                {p}
                              </button>
                            )
                          );
                        })()}

                        <button
                          type="button"
                          disabled={safePage >= totalPages}
                          onClick={() => setBrowsePage(safePage + 1)}
                          className="cursor-pointer rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) transition hover:bg-white/10 disabled:cursor-default disabled:opacity-30"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </section>
      ) : activeStoreTab === "lua-ready" ? (
        luaReadyGames.length === 0 ? (
          <StoreLuaReadyEmptyState />
        ) : (
          <section className="space-y-5">

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 lf-card-stagger">
              {luaReadyGames.map(renderStoreCard)}
            </div>
          </section>
        )
      ) : activeStoreTab === "news" ? (
        <StoreNewsFeed
          items={newsItems}
          onOpenGame={openDetailsForGame}
        />
      ) : (
        <div className="space-y-8">
          <StoreDiscoverHeroCarousel
            games={featuredGames}
            storeMetadataByAppId={storeMetadataByAppId}
            onOpenGame={openDetailsForGame}
            onDownload={handleGameDownload}
            onOpenSourceSelector={openSourceSelectorForGame}
          />

          {allStoreSections.map((section) => (
            <StoreHorizontalSection
              key={section.id}
              title={section.title}
              description={section.description}
              onViewAll={() => setActiveSectionId(section.id)}
            >
              {section.games.map(renderStoreCard)}
            </StoreHorizontalSection>
          ))}

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
        </div>
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
