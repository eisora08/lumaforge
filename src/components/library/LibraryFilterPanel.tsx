  import { Search, RotateCcw } from "lucide-react";

  export type LibraryFilter = "all" | "lua" | "installed" | "disabled" | "updates" | "epic";

  export type LibrarySort = "name" | "size" | "updated";

  type Props = {
    filter: LibraryFilter;
    sort: LibrarySort;
    query: string;
    filteredCount: number;
    totalCount: number;
    panelWidth?: number;
    onFilterChange: (filter: LibraryFilter) => void;
    onSortChange: (sort: LibrarySort) => void;
    onQueryChange: (query: string) => void;
    onReset: () => void;
  };

  const statusFilters: { key: LibraryFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "lua", label: "Lua" },
    { key: "installed", label: "Installed" },
    { key: "epic", label: "Epic" },
    { key: "disabled", label: "Disabled" },
    { key: "updates", label: "Updates" },
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
    panelWidth = 280,
    onFilterChange,
    onSortChange,
    onQueryChange,
    onReset,
  }: Props) {
    return (
      <div className="shrink-0" style={{ width: panelWidth }}>
        <div className="sticky top-0 max-h-[calc(100vh-120px)] overflow-y-auto rounded-2xl bg-white/[0.015] p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xs font-bold text-(--color-text)">Filters</h3>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1 text-[10px] text-(--color-muted)/50 transition hover:text-(--color-text)"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset
            </button>
          </div>

          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search library..."
              className="w-full rounded-xl border border-(--surface-active-border)/40 bg-white/5 py-1.5 pl-8 pr-2.5 text-[11px] text-(--color-text) outline-none placeholder:text-(--color-muted)/40 focus:border-(--color-accent)/30"
            />
          </div>

          <div className="mb-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--color-muted)/50">Status</p>
            <div className="space-y-0.5">
              {statusFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onFilterChange(f.key)}
                  className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[11px] transition ${
                    filter === f.key
                      ? "bg-(--color-accent)/8 text-(--color-accent) font-medium"
                      : "text-(--color-muted) hover:bg-white/[0.03] hover:text-(--color-text)"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--color-muted)/50">Sort</p>
            <div className="space-y-0.5">
              {sortOptions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onSortChange(s.key)}
                  className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[11px] transition ${
                    sort === s.key
                      ? "bg-(--color-accent)/8 text-(--color-accent) font-medium"
                      : "text-(--color-muted) hover:bg-white/[0.03] hover:text-(--color-text)"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-(--surface-active-border)/30 pt-3 text-[10px] text-(--color-muted)/50">
            {filteredCount} / {totalCount} items
          </div>
        </div>
      </div>
    );
  }
