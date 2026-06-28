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
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-(--color-text) transition hover:bg-white/[0.04]"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition ${
          checked
            ? "border-(--color-accent) bg-(--color-accent)"
            : "border-(--surface-active-border) bg-white/[0.03]"
        }`}
      >
        {checked && <Check className="h-3 w-3 text-black" />}
      </span>
      {label}
    </button>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
        {title}
      </span>
      {children}
    </div>
  );
}

function FilterDivider() {
  return (
    <div className="border-t border-(--surface-active-border)" />
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
    <div className="w-full shrink-0 overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5 lg:w-64 lg:sticky lg:top-[48px] lg:max-h-[calc(100vh-80px)] lg:flex lg:flex-col">
      <div className="flex shrink-0 items-center justify-between px-5 pt-5">
        <h3 className="text-sm font-semibold text-(--color-text)">
          Filters
        </h3>

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

      <div className="shrink-0 px-5 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)" />
          <input
            type="text"
            value={filters.keywords}
            onChange={(e) => update({ keywords: e.target.value })}
            placeholder="Search within results..."
            className="w-full rounded-xl border border-(--surface-active-border) bg-black/20 py-2 pl-9 pr-8 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
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
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <FilterDivider />

        <FilterSection title="Availability">
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
        </FilterSection>

        <FilterDivider />

        <FilterSection title="Source">
          <CheckRow
            checked={filters.hasSource}
            onChange={() => update({ hasSource: !filters.hasSource })}
            label="Has Source"
          />
        </FilterSection>

        <FilterDivider />

        <FilterSection title="Platform">
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
        </FilterSection>

        <FilterDivider />

        <FilterSection title="Source Type">
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
        </FilterSection>

        <FilterDivider />

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-(--color-muted) transition hover:bg-white/[0.04] hover:text-(--color-text)"
          >
            Advanced Providers
            <ChevronDown
              className={`h-3.5 w-3.5 transition ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="mt-0.5 space-y-0.5">
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

      <div className="shrink-0 border-t border-(--surface-active-border) px-5 py-3">
        <p className="text-xs text-(--color-muted)">
          {filteredGames} / {totalGames} games
        </p>
      </div>
    </div>
  );
}
