import type { ElementType } from "react";

import {
  Cloud,
  Database,
  Download,
  PackageSearch,
} from "lucide-react";

import PackageCard from "../components/packages/PackageCard";
import PackagesToolbar from "../components/packages/PackagesToolbar";
import ProviderSearchReport from "../components/packages/ProviderSearchReport";

import StoreHero from "../components/store/StoreHero";
import StoreSection from "../components/store/StoreSection";
import { PackageGame } from "../types/package";
import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import { scanInstalledLuaScripts } from "../services/tauri";
import { InstalledLuaScript } from "../types/installedLua";

import { PackageInstallStatus } from "../types/packageInstall";
import { useProviderSearch } from "../hooks/useProviderSearch";

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
  const [installedScripts, setInstalledScripts] = useState<InstalledLuaScript[]>([]);
  const totalSources = results.reduce(
    (count, game) => count + game.sources.length,
    0
  );

  const availableSources = results.reduce(
    (count, game) =>
      count + game.sources.filter((source) => source.available).length,
    0
  );

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



  const normalizedQuery = query.trim();
  const isSearching = normalizedQuery.length > 0;
  const featuredGames = results.slice(0, 3);
  const installedCount = results.filter((game) =>
    installedStatusByAppId.has(game.appId)
  ).length;

const installedGames = results.filter((game) =>
  installedStatusByAppId.has(game.appId)
);

  const recentlySupportedGames = results
    .filter((game) => game.sources.some((source) => source.available))
    .slice(0, 8);

  const popularPlaceholderGames = results.slice(3, 11);


  function renderStoreCard(game: PackageGame) {
    return (
      <PackageCard
        key={game.appId}
        game={game}
        installStatus={installedStatusByAppId.get(game.appId) ?? "not-installed"}
        onInstallComplete={refreshInstalledScripts}
      />
    );
  }
  useEffect(() => {
    refreshInstalledScripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.luaPath]);


  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <PackageSearch className="h-3.5 w-3.5" />
            Multi-provider fallback
          </div>


          <h1 className="text-3xl font-bold text-(--color-text)">
            Store
          </h1>

          <p className="mt-2 max-w-2xl text-(--color-muted)">
            Busca juegos, revisa fuentes disponibles y descarga Lua/manifests con providers compatibles.
          </p>

        </div>

        <div className="grid grid-cols-4 gap-3">
          <MiniStat
            icon={Database}
            label="Results"
            value={results.length}
          />

          <MiniStat
            icon={Cloud}
            label="Sources"
            value={totalSources}
          />

          <MiniStat
            icon={Download}
            label="Available"
            value={availableSources}
          />

          <MiniStat
            icon={PackageSearch}
            label="Installed"
            value={installedCount}
          />

        </div>
      </header>

      <PackagesToolbar
        query={query}
        selectedProvider={selectedProvider}
        onQueryChange={setQuery}
        onProviderChange={setSelectedProvider}
      />

      <ProviderSearchReport reports={providerReports} />

      {loading ? (
        <section className="lf-surface rounded-2xl border p-10 text-center">
          <PackageSearch className="mx-auto h-10 w-10 animate-pulse text-(--color-accent)" />

          <h2 className="mt-4 font-semibold text-(--color-text)">
            Buscando juegos
          </h2>

          <p className="mt-2 text-sm text-(--color-muted)">
            Consultando providers habilitados...
          </p>
        </section>
      ) : results.length === 0 ? (
        <section className="lf-surface rounded-2xl border p-10 text-center">
          <PackageSearch className="mx-auto h-10 w-10 text-(--color-muted)" />

          <h2 className="mt-4 font-semibold text-(--color-text)">
            No se encontraron paquetes
          </h2>

          <p className="mt-2 text-sm text-(--color-muted)">
            Prueba con otro AppID, nombre o provider.
          </p>
        </section>
      ) : (
        <div className="space-y-8">
          <StoreHero
            totalResults={results.length}
            availableSources={availableSources}
            installedCount={installedCount}
          />

          {isSearching ? (
            <StoreSection
              title="Search Results"
              description={`Resultados para "${normalizedQuery}"`}
            >
              {results.length === 0 ? (
                <EmptyStoreState />
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {results.map(renderStoreCard)}
                </div>
              )}
            </StoreSection>
          ) : (
            <>
              {featuredGames.length > 0 && (
                <StoreSection
                  title="Featured Supported Games"
                  description="Juegos destacados con metadata y fuentes preparadas para LumaForge."
                >
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    {featuredGames.map(renderStoreCard)}
                  </div>
                </StoreSection>
              )}

              {installedGames.length > 0 && (
                <StoreSection
                  title="Installed & Supported"
                  description="Juegos que ya tienen Lua instalado o detectado en tu biblioteca."
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {installedGames.map(renderStoreCard)}
                  </div>
                </StoreSection>
              )}

              {recentlySupportedGames.length > 0 && (
                <StoreSection
                  title="Recently Supported"
                  description="Juegos con fuentes disponibles en providers configurados."
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {recentlySupportedGames.map(renderStoreCard)}
                  </div>
                </StoreSection>
              )}

              {popularPlaceholderGames.length > 0 && (
                <StoreSection
                  title="Popular Picks"
                  description="Selección inicial basada en resultados disponibles. Luego esto se conectará a Steam trending."
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {popularPlaceholderGames.map(renderStoreCard)}
                  </div>
                </StoreSection>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type MiniStatProps = {
  icon: ElementType;
  label: string;
  value: string | number;
};



function MiniStat({ icon: Icon, label, value }: MiniStatProps) {
  return (
    <div className="lf-surface rounded-2xl border px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-(--color-accent)" />

        <span className="text-xs text-(--color-muted)">
          {label}
        </span>
      </div>

      <p className="mt-1 text-lg font-semibold text-(--color-text)">
        {value}
      </p>
    </div>
  );
}

function EmptyStoreState() {
  return (
    <div className="lf-surface rounded-2xl border p-10 text-center">
      <h2 className="font-semibold text-(--color-text)">
        No se encontraron juegos
      </h2>

      <p className="mt-2 text-sm text-(--color-muted)">
        Intenta buscar por AppID, nombre del juego o cambia los providers activos.
      </p>
    </div>
  );
}