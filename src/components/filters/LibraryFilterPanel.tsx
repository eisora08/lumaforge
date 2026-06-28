import { Search, Grid3X3, List, ArrowUpDown } from "lucide-react";
import FilterDrawer from "./FilterDrawer";

type LibraryStatusFilter = "all" | "active" | "disabled";
type LibrarySortKey = "name" | "appid" | "modified" | "size";
type LibraryViewMode = "grid" | "list";

type LibraryFilterPanelProps = {
  open: boolean;
  statusFilter: LibraryStatusFilter;
  sortBy: LibrarySortKey;
  luaReadyOnly: boolean;
  updatesOnly: boolean;
  localQuery: string;
  viewMode: LibraryViewMode;
  count: number;
  total: number;
  onLocalQueryChange: (q: string) => void;
  onStatusFilterChange: (filter: LibraryStatusFilter) => void;
  onSortByChange: (sort: LibrarySortKey) => void;
  onLuaReadyOnlyChange: (value: boolean) => void;
  onUpdatesOnlyChange: (value: boolean) => void;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onClose: () => void;
  onReset: () => void;
};

export type { LibraryStatusFilter, LibrarySortKey, LibraryViewMode };

const statusOptions: { key: LibraryStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "disabled", label: "Disabled" },
];

const sortOptions: { key: LibrarySortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "appid", label: "App ID" },
  { key: "modified", label: "Modified" },
  { key: "size", label: "Size" },
];

export default function LibraryFilterPanel({
  open,
  statusFilter,
  sortBy,
  luaReadyOnly,
  updatesOnly,
  localQuery,
  viewMode,
  count,
  total,
  onLocalQueryChange,
  onStatusFilterChange,
  onSortByChange,
  onLuaReadyOnlyChange,
  onUpdatesOnlyChange,
  onViewModeChange,
  onClose,
  onReset,
}: LibraryFilterPanelProps) {
  return (
    <FilterDrawer
      open={open}
      title="Library Filters"
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
              placeholder="Filter library..."
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
            Status
          </h3>
          <div className="space-y-1">
            {statusOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onStatusFilterChange(option.key)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  statusFilter === option.key
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

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
            Special Filters
          </h3>
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onLuaReadyOnlyChange(!luaReadyOnly)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                luaReadyOnly
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
              }`}
            >
              {luaReadyOnly ? "Only Lua Ready" : "Lua Ready"}
            </button>
            <button
              type="button"
              onClick={() => onUpdatesOnlyChange(!updatesOnly)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                updatesOnly
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
              }`}
            >
              {updatesOnly ? "Only Updates" : "Updates"}
            </button>
          </div>
        </div>
      </div>
    </FilterDrawer>
  );
}
