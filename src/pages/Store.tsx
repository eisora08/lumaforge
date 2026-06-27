import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  PackageSearch,
} from "lucide-react";

import PackageCard from "../components/packages/PackageCard";
import PackagesToolbar from "../components/packages/PackagesToolbar";
import ProviderSearchReport from "../components/packages/ProviderSearchReport";
import StoreHero from "../components/store/StoreHero";
import StoreHorizontalSection from "../components/store/StoreHorizontalSection";

import { useSettings } from "../context/SettingsContext";
import { useProviderSearch } from "../hooks/useProviderSearch";

import { scanInstalledLuaScripts } from "../services/tauri";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import { resolveFeaturedStoreCategories } from "../services/steamFeaturedResolver";

import type { PackageGame } from "../types/package";
import type { InstalledLuaScript } from "../types/installedLua";
import type { PackageInstallStatus } from "../types/packageInstall";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type {
  SteamFeaturedCategory,
  SteamFeaturedItem,
} from "../types/steamFeatured";

type StoreSectionModel = {
  id: string;
  title: string;
  description: string;
  games: PackageGame[];
};

function mapSteamFeaturedItemToPackageGame(item: SteamFeaturedItem): PackageGame {
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

export default function Store() {
  const {
    query,
    selectedProvider,
    results,
    loading,
    providerReports,
    setQuery,
    setSelectedProvider,
  } = useProviderSearch();

  const { settings } = useSettings();

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

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

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

  const availableSources = results.reduce(
    (count, game) =>
      count + game.sources.filter((source) => source.available).length,
    0
  );

  const installedCount = results.filter((game) =>
    installedStatusByAppId.has(game.appId)
  ).length;

  const normalizedQuery = query.trim();
  const isSearching = normalizedQuery.length > 0;

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

  const activeSection = activeSectionId
    ? allStoreSections.find((section) => section.id === activeSectionId)
    : undefined;

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

    return Array.from(appIds);
  }, [results, steamStoreSections]);

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

  function handleQueryChange(value: string) {
    setQuery(value);
    setActiveSectionId(null);
  }

  function handleProviderChange(value: typeof selectedProvider) {
    setSelectedProvider(value);
    setActiveSectionId(null);
  }

  function renderStoreCard(game: PackageGame) {
    return (
      <PackageCard
        key={game.appId}
        game={game}
        storeMetadata={storeMetadataByAppId[Number(game.appId)]}
        reviewSummary={reviewSummaryByAppId[Number(game.appId)]}
        installStatus={installedStatusByAppId.get(game.appId) ?? "not-installed"}
        onInstallComplete={refreshInstalledScripts}
      />
    );
  }

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="space-y-4">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
          <PackageSearch className="h-3.5 w-3.5" />
          LumaForge Store
        </div>

        <div>
          <h1 className="text-3xl font-bold text-(--color-text)">
            Store
          </h1>

          <p className="mt-2 max-w-2xl text-(--color-muted)">
            Explora juegos de Steam, descubre secciones destacadas y descarga
            Lua/manifests cuando haya providers compatibles.
          </p>
        </div>
      </header>

      <PackagesToolbar
        query={query}
        selectedProvider={selectedProvider}
        onQueryChange={handleQueryChange}
        onProviderChange={handleProviderChange}
      />

      {providerReports.length > 0 && (
        <details className="lf-surface rounded-2xl border p-4">
          <summary className="cursor-pointer text-sm font-medium text-(--color-text)">
            Provider Health
          </summary>

          <div className="mt-4">
            <ProviderSearchReport reports={providerReports} />
          </div>
        </details>
      )}

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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {activeSection.games.map(renderStoreCard)}
          </div>
        </section>
      ) : isSearching ? (
        results.length === 0 ? (
          <StoreEmptyState />
        ) : (
          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-(--color-text)">
                Search Results
              </h2>

              <p className="mt-1 text-sm text-(--color-muted)">
                Resultados para "{normalizedQuery}"
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {results.map(renderStoreCard)}
            </div>
          </section>
        )
      ) : (
        <div className="space-y-8">
          <StoreHero
            totalResults={visibleAppIds.length}
            availableSources={availableSources}
            installedCount={installedCount}
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
        </div>
      )}
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