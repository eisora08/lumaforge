import { useTranslation } from "react-i18next";
import {
  ArrowDownAZ,
  Calendar,
  Check,
  RotateCcw,
  Search,
  Star,
  X,
} from "lucide-react";

export type BrowseFilters = {
  keywords: string;
  installed: boolean;
  hasSource: boolean;
  platforms: string[];
  sort: "name" | "rating" | "recent";
};

export const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  keywords: "",
  installed: false,
  hasSource: false,
  platforms: [],
  sort: "recent",
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
  const { t } = useTranslation();
  function update(partial: Partial<BrowseFilters>) {
    onFiltersChange({ ...filters, ...partial });
  }

  function clearAll() {
    onFiltersChange({ ...DEFAULT_BROWSE_FILTERS });
  }

  const hasAnyFilter =
    filters.installed ||
    filters.hasSource ||
    filters.platforms.length > 0 ||
    filters.sort !== "name" ||
    filters.keywords.trim().length > 0;

  return (
    <div className="w-full shrink-0 overflow-hidden rounded-3xl border border-(--surface-active-border) bg-white/5 lg:w-64 lg:sticky lg:top-[48px] lg:max-h-[calc(100vh-80px)] lg:flex lg:flex-col">
      <div className="flex shrink-0 items-center justify-between px-5 pt-5">
        <h3 className="text-sm font-semibold text-(--color-text)">
          {t("store.filters", "Filters")}
        </h3>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <RotateCcw className="h-3 w-3" />
            {t("store.reset")}
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
            placeholder={t("store.search_within")}
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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 lf-scroll-area">
        <FilterDivider />

        <FilterSection title={t("store.sort_by")}>
          <div className="flex gap-1 px-3">
            {[
              { key: "name" as const, label: t("store.sort_name"), icon: ArrowDownAZ },
              { key: "rating" as const, label: t("store.sort_rating"), icon: Star },
              { key: "recent" as const, label: t("store.sort_recent"), icon: Calendar },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => update({ sort: key })}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  filters.sort === key
                    ? "bg-(--color-accent)/20 text-(--color-accent)"
                    : "text-(--color-muted) hover:bg-white/[0.04] hover:text-(--color-text)"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </FilterSection>

        <FilterDivider />

        <FilterSection title={t("store.availability")}>
          <CheckRow
            checked={filters.installed}
            onChange={() => update({ installed: !filters.installed })}
            label={t("store.installed")}
          />
        </FilterSection>

        <FilterDivider />

        <FilterSection title={t("store.has_source")}>
          <CheckRow
            checked={filters.hasSource}
            onChange={() => update({ hasSource: !filters.hasSource })}
            label={t("store.has_source")}
          />
        </FilterSection>

        <FilterDivider />

        <FilterSection title={t("store.platform")}>
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
      </div>

      <div className="shrink-0 border-t border-(--surface-active-border) px-5 py-3">
        <p className="text-xs text-(--color-muted)">
          {t("store.games_count", { filtered: filteredGames, total: totalGames })}
        </p>
      </div>
    </div>
  );
}
