import { Search, Grid3X3, List, ArrowUpDown } from "lucide-react";
import FilterDrawer from "./FilterDrawer";

type GamesSourceFilter = "all" | "steam" | "local";
type GamesInstallFilter = "all" | "installed" | "not-installed" | "missing-path";
type GamesSortKey = "name" | "installed-first";
type GamesViewMode = "grid" | "list";

type GamesFilterPanelProps = {
  open: boolean;
  sourceFilter: GamesSourceFilter;
  installFilter: GamesInstallFilter;
  localQuery: string;
  sortBy: GamesSortKey;
  viewMode: GamesViewMode;
  count: number;
  total: number;
  onLocalQueryChange: (q: string) => void;
  onSourceFilterChange: (filter: GamesSourceFilter) => void;
  onInstallFilterChange: (filter: GamesInstallFilter) => void;
  onSortByChange: (sort: GamesSortKey) => void;
  onViewModeChange: (mode: GamesViewMode) => void;
  onClose: () => void;
  onReset: () => void;
};

export type { GamesSourceFilter, GamesInstallFilter, GamesSortKey, GamesViewMode };

const sourceOptions: { key: GamesSourceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "steam", label: "Steam" },
  { key: "local", label: "Local" },
];

const installOptions: { key: GamesInstallFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "installed", label: "Installed" },
  { key: "not-installed", label: "Not Installed" },
  { key: "missing-path", label: "Missing Path" },
];

const sortOptions: { key: GamesSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "installed-first", label: "Installed First" },
];

export default function GamesFilterPanel({
  open,
  sourceFilter,
  installFilter,
  localQuery,
  sortBy,
  viewMode,
  count,
  total,
  onLocalQueryChange,
  onSourceFilterChange,
  onInstallFilterChange,
  onSortByChange,
  onViewModeChange,
  onClose,
  onReset,
}: GamesFilterPanelProps) {
  return (
    <FilterDrawer
      open={open}
      title="Games Filters"
      onClose={onClose}
      onReset={onReset}
    >
      <div className="space-y-6">
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            Search
          </h3>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
            <input
              type="text"
              value={localQuery}
              onChange={(e) => onLocalQueryChange(e.target.value)}
              placeholder="Filter games..."
              className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 py-2 pl-10 pr-3 text-sm text-(--color-text) placeholder-(--color-muted) outline-none transition focus:border-(--color-accent) focus:ring-1 focus:ring-(--color-accent)/30"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-(--color-muted)">
          <span>
            {count} / {total} games
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`rounded-lg p-1.5 transition ${
                viewMode === "grid"
                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                  : "hover:bg-white/10 hover:text-(--color-text)"
              }`}
              title="Grid view"
            >
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={`rounded-lg p-1.5 transition ${
                viewMode === "list"
                  ? "bg-(--color-accent)/20 text-(--color-accent)"
                  : "hover:bg-white/10 hover:text-(--color-text)"
              }`}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            Source
          </h3>
          <div className="space-y-1">
            {sourceOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onSourceFilterChange(option.key)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  sourceFilter === option.key
                    ? "bg-(--color-accent)/20 text-(--color-accent)"
                    : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            Installation
          </h3>
          <div className="space-y-1">
            {installOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onInstallFilterChange(option.key)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  installFilter === option.key
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            <ArrowUpDown className="h-3 w-3" />
            Sort By
          </h3>
          <div className="space-y-1">
            {sortOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onSortByChange(option.key)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  sortBy === option.key
                    ? "bg-(--color-accent)/20 text-(--color-accent)"
                    : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </FilterDrawer>
  );
}
