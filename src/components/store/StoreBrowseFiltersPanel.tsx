import { useState } from "react";
import {
  Check,
  ChevronDown,
  RotateCcw,
  Search,
  X,
} from "lucide-react";

export type BrowseFilters = {
  keywords: string;
  luaReady: boolean;
  installed: boolean;
  hasSource: boolean;
  platforms: string[];
  sourceTypes: string[];
  providers: string[];
};

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  keywords: "",
  luaReady: false,
  installed: false,
  hasSource: false,
  platforms: [],
  sourceTypes: [],
  providers: [],
};

type StoreBrowseFiltersPanelProps = {
  filters: BrowseFilters;
  onFiltersChange: (filters: BrowseFilters) => void;
  totalGames: number;
  filteredGames: number;
};

const PLATFORM_OPTIONS = ["windows", "mac", "linux"];
const PLATFORM_LABELS: Record<string, string> = {
  windows: "Windows",
  mac: "macOS",
  linux: "Linux",
};
const SOURCE_TYPE_OPTIONS = ["lua", "zip", "manifest"];
const PROVIDER_OPTIONS = [
  { id: "hubcapdb", label: "HubcapDB" },
  { id: "ryuu", label: "Ryuu" },
  { id: "sushi", label: "Sushi" },
  { id: "twentytwo-cloud", label: "TwentyTwo Cloud" },
  { id: "custom", label: "Custom API" },
];

function toggleArrayItem<T>(arr: T[], item: T): T[] {
  if (arr.includes(item)) {
    return arr.filter((i) => i !== item);
  }

  return [...arr, item];
}

type CheckRowProps = {
  checked: boolean;
  onChange: () => void;
  label: string;
};

function CheckRow({ checked, onChange, label }: CheckRowProps) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
          checked
            ? "border-(--color-accent) bg-(--color-accent)"
            : "border-(--surface-active-border) bg-white/5"
        }`}
      >
        {checked && <Check className="h-3 w-3 text-black" />}
      </span>
      <span className="text-sm text-(--color-text)">{label}</span>
    </button>
  );
}

export default function StoreBrowseFiltersPanel({
  filters,
  onFiltersChange,
  totalGames,
  filteredGames,
}: StoreBrowseFiltersPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  function update(partial: Partial<BrowseFilters>) {
    onFiltersChange({ ...filters, ...partial });
  }

  function clearAll() {
    onFiltersChange({ ...DEFAULT_BROWSE_FILTERS });
  }

  const hasAnyFilter =
    filters.luaReady ||
    filters.installed ||
    filters.hasSource ||
    filters.platforms.length > 0 ||
    filters.sourceTypes.length > 0 ||
    filters.providers.length > 0 ||
    filters.keywords.trim().length > 0;

  return (
    <div className="w-full shrink-0 space-y-5 lg:w-64">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            Filters
          </h3>
          <p className="mt-0.5 text-xs text-(--color-muted)">
            {filteredGames} / {totalGames} games
          </p>
        </div>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)" />
        <input
          type="text"
          value={filters.keywords}
          onChange={(e) => update({ keywords: e.target.value })}
          placeholder="Search within results..."
          className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 py-2 pl-9 pr-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
        />
        {filters.keywords && (
          <button
            type="button"
            onClick={() => update({ keywords: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-muted) hover:text-(--color-text)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="px-2 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
          Availability
        </h4>
        <CheckRow
          checked={filters.luaReady}
          onChange={() => update({ luaReady: !filters.luaReady })}
          label="Lua Ready"
        />
        <CheckRow
          checked={filters.installed}
          onChange={() => update({ installed: !filters.installed })}
          label="Installed"
        />
      </div>

      <div className="space-y-1">
        <h4 className="px-2 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
          Source
        </h4>
        <CheckRow
          checked={filters.hasSource}
          onChange={() => update({ hasSource: !filters.hasSource })}
          label="Has Source"
        />
      </div>

      <div className="space-y-1">
        <h4 className="px-2 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
          Platform
        </h4>
        {PLATFORM_OPTIONS.map((platform) => (
          <CheckRow
            key={platform}
            checked={filters.platforms.includes(platform)}
            onChange={() =>
              update({
                platforms: toggleArrayItem(filters.platforms, platform),
              })
            }
            label={PLATFORM_LABELS[platform] || platform}
          />
        ))}
      </div>

      <div className="space-y-1">
        <h4 className="px-2 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
          Source Type
        </h4>
        {SOURCE_TYPE_OPTIONS.map((type) => (
          <CheckRow
            key={type}
            checked={filters.sourceTypes.includes(type)}
            onChange={() =>
              update({
                sourceTypes: toggleArrayItem(filters.sourceTypes, type),
              })
            }
            label={`.${type}`}
          />
        ))}
      </div>

      <div className="space-y-1">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
        >
          Providers
          <ChevronDown
            className={`h-3.5 w-3.5 transition ${showAdvanced ? "rotate-180" : ""}`}
          />
        </button>

        {showAdvanced && (
          <div className="space-y-0.5">
            {PROVIDER_OPTIONS.map((provider) => (
              <CheckRow
                key={provider.id}
                checked={filters.providers.includes(provider.id)}
                onChange={() =>
                  update({
                    providers: toggleArrayItem(filters.providers, provider.id),
                  })
                }
                label={provider.label}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
