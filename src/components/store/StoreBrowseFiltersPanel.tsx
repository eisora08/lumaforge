import { X } from "lucide-react";

export type BrowseFilters = {
  keywords: string;
  luaReady: boolean;
  installed: boolean;
  hasSource: boolean;
  platforms: string[];
  sourceTypes: string[];
};

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  keywords: "",
  luaReady: false,
  installed: false,
  hasSource: false,
  platforms: [],
  sourceTypes: [],
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

function toggleArrayItem<T>(arr: T[], item: T): T[] {
  if (arr.includes(item)) {
    return arr.filter((i) => i !== item);
  }

  return [...arr, item];
}

export default function StoreBrowseFiltersPanel({
  filters,
  onFiltersChange,
  totalGames,
  filteredGames,
}: StoreBrowseFiltersPanelProps) {
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
    filters.sourceTypes.length > 0;

  return (
    <div className="w-full shrink-0 space-y-4 lg:w-64">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-(--color-text)">
          Filters
        </h3>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 text-[11px] text-(--color-muted) hover:text-(--color-text)"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <div>
        <input
          type="text"
          value={filters.keywords}
          onChange={(e) => update({ keywords: e.target.value })}
          placeholder="Search within results..."
          className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
        />
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
          Availability
        </h4>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={filters.luaReady}
            onChange={() => update({ luaReady: !filters.luaReady })}
            className="accent-(--color-accent)"
          />

          <span className="text-sm text-(--color-text)">Lua Ready</span>
        </label>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={filters.installed}
            onChange={() => update({ installed: !filters.installed })}
            className="accent-(--color-accent)"
          />

          <span className="text-sm text-(--color-text)">Installed</span>
        </label>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
          Source
        </h4>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={filters.hasSource}
            onChange={() => update({ hasSource: !filters.hasSource })}
            className="accent-(--color-accent)"
          />

          <span className="text-sm text-(--color-text)">Has Source</span>
        </label>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
          Platform
        </h4>

        {PLATFORM_OPTIONS.map((platform) => (
          <label
            key={platform}
            className="flex cursor-pointer items-center gap-2"
          >
            <input
              type="checkbox"
              checked={filters.platforms.includes(platform)}
              onChange={() =>
                update({
                  platforms: toggleArrayItem(filters.platforms, platform),
                })
              }
              className="accent-(--color-accent)"
            />

            <span className="text-sm text-(--color-text)">
              {PLATFORM_LABELS[platform] || platform}
            </span>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-(--color-muted)">
          Source Type
        </h4>

        {SOURCE_TYPE_OPTIONS.map((type) => (
          <label
            key={type}
            className="flex cursor-pointer items-center gap-2"
          >
            <input
              type="checkbox"
              checked={filters.sourceTypes.includes(type)}
              onChange={() =>
                update({
                  sourceTypes: toggleArrayItem(filters.sourceTypes, type),
                })
              }
              className="accent-(--color-accent)"
            />

            <span className="text-sm text-(--color-text)">.{type}</span>
          </label>
        ))}
      </div>

      <div className="border-t border-(--surface-active-border) pt-3 text-xs text-(--color-muted)">
        {filteredGames} / {totalGames} games
      </div>
    </div>
  );
}
