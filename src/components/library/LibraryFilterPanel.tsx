import { Search, RotateCcw } from "lucide-react";

export type LibraryFilter = "all" | "lua" | "installed" | "disabled";

export type LibrarySort = "name" | "size" | "updated";

type Props = {
  filter: LibraryFilter;
  sort: LibrarySort;
  query: string;
  filteredCount: number;
  totalCount: number;
  onFilterChange: (filter: LibraryFilter) => void;
  onSortChange: (sort: LibrarySort) => void;
  onQueryChange: (query: string) => void;
  onReset: () => void;
};

const statusFilters: { key: LibraryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "lua", label: "Lua" },
  { key: "installed", label: "Installed" },
  { key: "disabled", label: "Disabled" },
];

const sortOptions: { key: LibrarySort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "size", label: "Size" },
  { key: "updated", label: "Updated" },
];

export default function LibraryFilterPanel({
  filter,
  sort,
  query,
  filteredCount,
  totalCount,
  onFilterChange,
  onSortChange,
  onQueryChange,
  onReset,
}: Props) {
  return (
    <div className="w-[280px] shrink-0">
      <div className="sticky top-0 max-h-[calc(100vh-140px)] overflow-y-auto rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-(--color-text)">Filters</h3>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-[11px] text-(--color-muted) transition hover:text-(--color-text)"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search library..."
            className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 py-2 pl-8 pr-3 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
          />
        </div>

        <div className="mb-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-(--color-muted)">Status</p>
          <div className="space-y-1">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onFilterChange(f.key)}
                className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs transition ${
                  filter === f.key
                    ? "bg-(--color-accent)/10 text-(--color-accent) font-medium"
                    : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-(--color-muted)">Sort</p>
          <div className="space-y-1">
            {sortOptions.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onSortChange(s.key)}
                className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs transition ${
                  sort === s.key
                    ? "bg-(--color-accent)/10 text-(--color-accent) font-medium"
                    : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-(--surface-active-border) pt-3 text-[11px] text-(--color-muted)">
          {filteredCount} / {totalCount} items
        </div>
      </div>
    </div>
  );
}
