import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Filter,
  Gamepad2,
  PackageSearch,
} from "lucide-react";

import PackageCard from "../components/packages/PackageCard";
import PackagesToolbar from "../components/packages/PackagesToolbar";
import type { StoreSearchDropdownItem } from "../components/packages/PackagesToolbar";
import ProviderSearchReport from "../components/packages/ProviderSearchReport";
import StoreDiscoverHeroCarousel from "../components/store/StoreDiscoverHeroCarousel";
import StoreHorizontalSection from "../components/store/StoreHorizontalSection";
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
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl } from "../utils/steamLinks";
import { getBestAvailableSource, getSourceKey } from "../utils/sourceHelpers";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import { resolveFeaturedStoreCategories } from "../services/steamFeaturedResolver";
import { searchSteamStore } from "../services/steamStoreSearchResolver";
import { resolveProviderOverlaysForStoreGames } from "../services/storeProviderOverlay";

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

  useEffect(() => {
    let cancelled = false;

    async function loadSteamFeaturedCategories() {
      try {
        const categories = await resolveFeaturedStoreCategories();

        if (!cancelled) {
          setSteamFeaturedCategories(categories);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setSteamFeaturedCategories([]);
        }
      }
    }

    loadSteamFeaturedCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  const steamStoreSections = useMemo(() => {
    return steamFeaturedCategories
      .map(mapSteamCategoryToStoreSection)
      .filter((section) => section.games.length > 0)
      .slice(0, 6);
  }, [steamFeaturedCategories]);

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

        const searchItems = await searchSteamStore(query);

        if (cancelled) {
          return;
        }

        const dropdownItems = searchItems.map<StoreSearchDropdownItem>(
          (item) => {
            const appId = String(item.app_id);

            return {
              appId,
              title: item.name,
              subtitle: `AppID ${appId}`,
              imageUrl: item.image_url || undefined,
              priceLabel: item.price_label || undefined,
              discountLabel: item.discount_label || undefined,
              installed: installedStatusByAppId.has(appId),
            };
          }
        );

        setSteamSearchItems(dropdownItems);
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
    const steamGames = steamStoreSections.flatMap((section) => section.games);

    if (steamGames.length === 0) {
      setProviderOverlayByAppId({});
      return;
    }

    let cancelled = false;

    async function loadProviderOverlays() {
      try {
        const overlays = await resolveProviderOverlaysForStoreGames(
          steamGames,
          settings
        );

        if (!cancelled) {
          setProviderOverlayByAppId(overlays);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setProviderOverlayByAppId({});
        }
      }
    }

    loadProviderOverlays();

    return () => {
      cancelled = true;
    };
  }, [steamStoreSections, settings]);

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

  const allStoreSections = useMemo(() => {
    return [...steamStoreSections, ...lumaForgeSections];
  }, [steamStoreSections, lumaForgeSections]);

  const browseGames = useMemo(() => {
    const allGames: PackageGame[] = [];

    steamStoreSections.forEach((section) => {
      section.games.forEach((game) => {
        allGames.push(providerOverlayByAppId[game.appId] ?? game);
      });
    });

    lumaForgeSections.forEach((section) => {
      section.games.forEach((game) => {
        allGames.push(providerOverlayByAppId[game.appId] ?? game);
      });
    });

    results.forEach((game) => {
      allGames.push(providerOverlayByAppId[game.appId] ?? game);
    });

    return dedupeGames(allGames);
  }, [steamStoreSections, lumaForgeSections, results, providerOverlayByAppId]);

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

    results.forEach(addIfReady);

    steamStoreSections.forEach((section) => {
      section.games.forEach(addIfReady);
    });

    return games;
  }, [results, steamStoreSections, providerOverlayByAppId]);

  const featuredGames = useMemo(() => {
    const seen = new Set<string>();
    const games: PackageGame[] = [];

    function tryAdd(game: PackageGame) {
      if (seen.has(game.appId)) return;
      const overlayed = providerOverlayByAppId[game.appId] ?? game;
      seen.add(game.appId);
      games.push(overlayed);
    }

    steamStoreSections.forEach((section) => {
      section.games.forEach(tryAdd);
    });

    lumaForgeSections.forEach((section) => {
      section.games.forEach(tryAdd);
    });

    results.forEach(tryAdd);

    return games.slice(0, 8);
  }, [steamStoreSections, lumaForgeSections, results, providerOverlayByAppId]);

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

  const visibleAppIds = useMemo(() => {
    const appIds = new Set<number>();

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

    if (selectedDetailGame) {
      const appId = Number(selectedDetailGame.appId);

      if (Number.isFinite(appId)) {
        appIds.add(appId);
      }
    }

    return Array.from(appIds);
  }, [results, steamStoreSections, steamSearchItems, steamSubmittedSearchGames, selectedDetailGame]);

  useEffect(() => {
    if (visibleAppIds.length === 0) {
      setStoreMetadataByAppId({});
      return;
    }

    let cancelled = false;

    async function loadStoreMetadata() {
      try {
        const metadata = await resolveGameMetadata(visibleAppIds);

        if (!cancelled) {
          setStoreMetadataByAppId(metadata);
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
  }, [visibleAppIds]);

  useEffect(() => {
    if (visibleAppIds.length === 0) {
      setReviewSummaryByAppId({});
      return;
    }

    let cancelled = false;

    async function loadReviewSummaries() {
      try {
        const summaries = await resolveGameReviewSummaries(visibleAppIds);

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
  }, [visibleAppIds]);

  const selectedDetailRelatedGames = useMemo<StoreMoreLikeThisGame[]>(() => {
    if (!selectedDetailGameWithOverlay) {
      return [];
    }

    const relatedMap = new Map<string, PackageGame>();

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
      resolveProviderOverlaysForStoreGames(games, settings).then(
        (overlays) => {
          setProviderOverlayByAppId((current) => ({
            ...current,
            ...overlays,
          }));
        }
      ).catch(console.error);
    }
  }

  function openSteamPage(appId: string) {
    openExternalUrl(getSteamStoreUrl(Number(appId)));
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

  async function openDetailsForGame(game: PackageGame) {
    setSelectedDetailGame(game);
    setActiveSectionId(null);

    try {
      const overlays = await resolveProviderOverlaysForStoreGames(
        [game],
        settings
      );

      const overlayGame = overlays[game.appId];

      if (overlayGame) {
        setProviderOverlayByAppId((current) => ({
          ...current,
          [game.appId]: overlayGame,
        }));
      }
    } catch (error) {
      console.error(error);
    }
  }

  function handleSelectSearchItem(item: StoreSearchDropdownItem) {
    const game = mapSteamDropdownItemToPackageGame(item);

    setStoreSearchQuery(item.title);
    setSubmittedSearchQuery("");
    setQuery("");
    setActiveSectionId(null);
    setSteamSearchItems([]);
    setSteamSubmittedSearchGames([]);

    openDetailsForGame(game);
  }

  function handleStoreTabChange(tab: StoreTab) {
    setActiveStoreTab(tab);
    setActiveSectionId(null);
    setActiveGenreSectionId(null);
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

  async function handlePosterDownload(game: PackageGame) {
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
      <PackageCard
        key={game.appId}
        game={gameWithOverlay}
        storeMetadata={storeMetadataByAppId[Number(game.appId)]}
        reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
        installStatus={installedStatusByAppId.get(game.appId) ?? "not-installed"}
        onInstallComplete={refreshInstalledScripts}
        onOpenDetails={openDetailsForGame}
        onOpenSourceSelector={openSourceSelectorForGame}
        onDownload={handlePosterDownload}
      />
    );
  }

  function renderPosterCard(game: PackageGame) {
    const gameWithOverlay = providerOverlayByAppId[game.appId] ?? game;

    return (
      <PackageCard
        key={game.appId}
        variant="poster"
        game={gameWithOverlay}
        storeMetadata={storeMetadataByAppId[Number(game.appId)]}
        reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
        installStatus={installedStatusByAppId.get(game.appId) ?? "not-installed"}
        onOpenDetails={openDetailsForGame}
        onOpenGame={openDetailsForGame}
        onOpenSourceSelector={openSourceSelectorForGame}
        onDownload={handlePosterDownload}
      />
    );
  }

  if (selectedDetailGameWithOverlay) {
    return (
      <div className="mx-auto w-full max-w-[1440px] p-5 lg:p-7">
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
          moreLikeThisGames={selectedDetailRelatedGames}
          onBack={() => setSelectedDetailGame(null)}
          onDownloadSource={handleDownloadSource}
          onOpenGame={openDetailsForGame}
          onSelectSourceKey={(sourceKey) =>
            setSelectedSourceKeyByAppId((current) => ({
              ...current,
              [selectedDetailGameWithOverlay.appId]: sourceKey,
            }))
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 p-5 lg:p-7">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <PackageSearch className="h-3.5 w-3.5" />
            LumaForge Store
          </div>

          <h1 className="text-2xl font-bold text-(--color-text)">
            Store
          </h1>
        </div>

        <div className="w-full lg:w-auto lg:pt-1.5">
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
      </header>

      <div className="flex gap-1 border-b border-(--surface-active-border)">
        {STORE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleStoreTabChange(tab.id)}
            className={`relative px-4 py-3 text-sm font-medium transition ${
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

      {loading ? (
        <StoreLoadingState />
      ) : activeSection ? (
        <section className="space-y-5">
          <button
            type="button"
            onClick={() => setActiveSectionId(null)}
            className="inline-flex items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {activeSection.games.map(renderPosterCard)}
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

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {mergedResults.map(renderPosterCard)}
              </div>
            </section>
          );
        })()
      ) : activeStoreTab === "browse" ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-(--color-text)">
                Browse Games
              </h2>

              <p className="mt-1 text-sm text-(--color-muted)">
                Explora todos los juegos disponibles desde Steam y providers
                compatibles.
              </p>
            </div>

            <div className="flex h-10 items-center gap-2.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3.5">
              <Filter className="h-4 w-4 shrink-0 text-(--color-muted)" />

              <select
                value={selectedProvider}
                onChange={(event) =>
                  handleProviderChange(
                    event.target.value as typeof selectedProvider
                  )
                }
                className="bg-transparent text-sm text-(--color-text) outline-none"
              >
                <option value="all" className="bg-black text-white">
                  All Providers
                </option>
                <option value="hubcapdb" className="bg-black text-white">
                  HubcapDB
                </option>
                <option value="ryuu" className="bg-black text-white">
                  Ryuu
                </option>
                <option value="twentytwo-cloud" className="bg-black text-white">
                  TwentyTwo Cloud
                </option>
                <option value="sushi" className="bg-black text-white">
                  Sushi
                </option>
                <option value="custom" className="bg-black text-white">
                  Custom API
                </option>
              </select>
            </div>
          </div>

          {steamStoreSections.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveGenreSectionId(null)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
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
                  onClick={() => setActiveGenreSectionId(section.id)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
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

          <div className="lg:flex lg:gap-6">
            <StoreBrowseFiltersPanel
              filters={browseFilters}
              onFiltersChange={setBrowseFilters}
              totalGames={browseGames.length}
              filteredGames={filteredBrowseGames.length}
            />

            <div className="min-w-0 flex-1">
              {filteredBrowseGames.length === 0 ? (
                <StoreEmptyState />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {filteredBrowseGames.map(renderPosterCard)}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : activeStoreTab === "lua-ready" ? (
        luaReadyGames.length === 0 ? (
          <StoreLuaReadyEmptyState />
        ) : (
          <section className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-(--color-text)">
                Lua Ready
              </h2>

              <p className="mt-1 text-sm text-(--color-muted)">
                Juegos con fuentes de descarga disponibles en tus providers.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {luaReadyGames.map(renderPosterCard)}
            </div>
          </section>
        )
      ) : activeStoreTab === "news" ? (
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-(--color-text)">
              News
            </h2>

            <p className="mt-1 text-sm text-(--color-muted)">
              Updates, provider changes and game news will appear here.
            </p>
          </div>

          <section className="rounded-2xl border border-(--surface-active-border) bg-white/5 p-5">
            <h3 className="text-lg font-bold text-(--color-text)">
              Coming Soon
            </h3>

            <p className="mt-2 text-sm text-(--color-muted)">
              News feed and game updates are coming in a future update.
            </p>
          </section>

          <section className="rounded-2xl border border-(--surface-active-border) bg-white/5 p-5">
            <h3 className="text-lg font-bold text-(--color-text)">
              Today
            </h3>

            <p className="mt-2 text-sm text-(--color-muted)">
              No news today.
            </p>
          </section>

          <section className="rounded-2xl border border-(--surface-active-border) bg-white/5 p-5">
            <h3 className="text-lg font-bold text-(--color-text)">
              Earlier
            </h3>

            <p className="mt-2 text-sm text-(--color-muted)">
              No earlier news.
            </p>
          </section>
        </section>
      ) : (
        <div className="space-y-8">
          <StoreDiscoverHeroCarousel
            games={featuredGames}
            storeMetadataByAppId={storeMetadataByAppId}
            installedStatusByAppId={installedStatusByAppId}
            onOpenGame={openDetailsForGame}
            onOpenSteam={openSteamPage}
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
    <section className="lf-surface rounded-2xl border p-10 text-center">
      <PackageSearch className="mx-auto h-10 w-10 animate-pulse text-(--color-accent)" />

      <h2 className="mt-4 font-semibold text-(--color-text)">
        Buscando juegos
      </h2>

      <p className="mt-2 text-sm text-(--color-muted)">
        Consultando providers habilitados...
      </p>
    </section>
  );
}

function StoreEmptyState() {
  return (
    <section className="lf-surface rounded-2xl border p-10 text-center">
      <PackageSearch className="mx-auto h-10 w-10 text-(--color-muted)" />

      <h2 className="mt-4 font-semibold text-(--color-text)">
        No se encontraron juegos
      </h2>

      <p className="mt-2 text-sm text-(--color-muted)">
        Prueba con otro AppID, nombre o provider.
      </p>
    </section>
  );
}

function StoreLuaReadyEmptyState() {
  return (
    <section className="lf-surface rounded-2xl border p-10 text-center">
      <Gamepad2 className="mx-auto h-10 w-10 text-(--color-muted)" />

      <h2 className="mt-4 font-semibold text-(--color-text)">
        No Lua-ready games found yet
      </h2>

      <p className="mt-2 text-sm text-(--color-muted)">
        Try searching for games or configuring a provider in Settings.
      </p>
    </section>
  );
}
