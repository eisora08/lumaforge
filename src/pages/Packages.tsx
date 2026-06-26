import { useMemo, useState } from "react";
import {
  Cloud,
  Database,
  Download,
  PackageSearch,
} from "lucide-react";

import PackageCard from "../components/packages/PackageCard";
import PackagesToolbar from "../components/packages/PackagesToolbar";

import { mockPackages } from "../data/mockPackages";
import { ApiProviderId } from "../types/provider";

export default function Packages() {
  const [query, setQuery] = useState("");
  const [selectedProvider, setSelectedProvider] =
    useState<ApiProviderId | "all">("all");

  const filteredPackages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return mockPackages.filter((game) => {
      const matchesQuery =
        !normalizedQuery ||
        game.title.toLowerCase().includes(normalizedQuery) ||
        game.appId.includes(normalizedQuery) ||
        game.sources.some((source) =>
          source.providerName.toLowerCase().includes(normalizedQuery)
        );

      const matchesProvider =
        selectedProvider === "all" ||
        game.sources.some((source) => source.providerId === selectedProvider);

      return matchesQuery && matchesProvider;
    });
  }, [query, selectedProvider]);

  const totalSources = mockPackages.reduce(
    (count, game) => count + game.sources.length,
    0
  );

  const availableSources = mockPackages.reduce(
    (count, game) =>
      count + game.sources.filter((source) => source.available).length,
    0
  );

  return (
    <div className="space-y-6 p-5 lg:p-7">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
            <PackageSearch className="h-3.5 w-3.5" />
            Multi-provider catalog
          </div>

          <h1 className="text-3xl font-bold text-(--color-text)">
            Paquetes
          </h1>

          <p className="mt-2 max-w-2xl text-(--color-muted)">
            Busca juegos, revisa fuentes disponibles y prepara descargas desde
            múltiples providers como HubcapDB, Ryuu, TwentyTwo Cloud, Sushi y
            APIs personalizadas.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MiniStat
            icon={Database}
            label="Games"
            value={mockPackages.length}
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
        </div>
      </header>

      <PackagesToolbar
        query={query}
        selectedProvider={selectedProvider}
        onQueryChange={setQuery}
        onProviderChange={setSelectedProvider}
      />

      {filteredPackages.length === 0 ? (
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
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {filteredPackages.map((game) => (
            <PackageCard key={game.appId} game={game} />
          ))}
        </section>
      )}
    </div>
  );
}

type MiniStatProps = {
  icon: React.ElementType;
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