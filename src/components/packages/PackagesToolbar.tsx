import {
  Filter,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { ApiProviderId } from "../../types/provider";

type PackagesToolbarProps = {
  query: string;
  selectedProvider: ApiProviderId | "all";
  onQueryChange: (query: string) => void;
  onProviderChange: (provider: ApiProviderId | "all") => void;
};

const providerOptions: {
  label: string;
  value: ApiProviderId | "all";
}[] = [
  { label: "All Providers", value: "all" },
  { label: "HubcapDB", value: "hubcapdb" },
  { label: "Ryuu", value: "ryuu" },
  { label: "TwentyTwo Cloud", value: "twentytwo-cloud" },
  { label: "Sushi", value: "sushi" },
  { label: "Custom API", value: "custom" },
];

export default function PackagesToolbar({
  query,
  selectedProvider,
  onQueryChange,
  onProviderChange,
}: PackagesToolbarProps) {
  return (
    <section className="lf-surface rounded-2xl border p-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px_auto]">
        <div className="flex h-11 items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4">
          <Search className="h-4 w-4 text-(--color-muted)" />

          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nombre, AppID o provider..."
            className="w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)"
          />
        </div>

        <div className="flex h-11 items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/5 px-4">
          <Filter className="h-4 w-4 text-(--color-muted)" />

          <select
            value={selectedProvider}
            onChange={(event) =>
              onProviderChange(event.target.value as ApiProviderId | "all")
            }
            className="w-full bg-transparent text-sm text-(--color-text) outline-none"
          >
            {providerOptions.map((provider) => (
              <option
                key={provider.value}
                value={provider.value}
                className="bg-black text-white"
              >
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        <button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 text-sm text-(--color-text) transition hover:bg-white/10">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
        </button>
      </div>
    </section>
  );
}