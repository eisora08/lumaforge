import { useState } from "react";
import { ChevronRight, Gamepad2 } from "lucide-react";

import type { PackageGame } from "../../types/package";

export type StoreNewsItem = {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  appId?: string;
  category: "Lua Ready" | "Featured" | "DLC" | "Installed" | "Store";
  group: "Today" | "This Week" | "Earlier";
  game?: PackageGame;
};

type StoreNewsFeedProps = {
  items: StoreNewsItem[];
  onOpenGame?: (game: PackageGame) => void;
};

const CATEGORY_FILTERS = [
  { id: null as string | null, label: "All" },
  { id: "Lua Ready", label: "Lua Ready" },
  { id: "Featured", label: "Featured" },
  { id: "DLC", label: "DLC" },
  { id: "Installed", label: "Installed" },
  { id: "Store", label: "Store" },
];

const CATEGORY_STYLES: Record<string, string> = {
  "Lua Ready": "border-(--color-accent)/20 bg-(--color-accent)/8 text-(--color-accent)",
  Featured: "border-yellow-500/20 bg-yellow-500/8 text-yellow-300",
  DLC: "border-blue-500/20 bg-blue-500/8 text-blue-300",
  Installed: "border-emerald-500/20 bg-emerald-500/8 text-emerald-300",
  Store: "border-purple-400/20 bg-purple-400/8 text-purple-300",
};

const GROUP_ORDER = ["Today", "This Week", "Earlier"] as const;

export default function StoreNewsFeed({
  items,
  onOpenGame,
}: StoreNewsFeedProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = activeCategory
    ? items.filter((item) => item.category === activeCategory)
    : items;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: filtered.filter((item) => item.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-(--color-text)">News</h2>
        <p className="mt-1 text-sm text-(--color-muted)">
          Store updates, supported games and LumaForge activity.
        </p>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {CATEGORY_FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => setActiveCategory(filter.id)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              activeCategory === filter.id
                ? "bg-(--color-accent) text-black"
                : "border border-(--surface-active-border) bg-white/[0.03] text-(--color-muted) hover:border-(--color-muted) hover:text-(--color-text)"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
            <Gamepad2 className="h-7 w-7 text-(--color-muted)" />
          </div>
          <h3 className="mt-4 font-semibold text-(--color-text)">
            No news yet
          </h3>
          <p className="mt-1.5 text-sm text-(--color-muted)">
            Store updates and supported games will appear here.
          </p>
        </section>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ group, items: groupItems }) => (
            <div key={group}>
              <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-(--color-muted)">
                {group}
              </h3>

              <div className="space-y-3">
                {groupItems.map((item) => (
                  <NewsCard
                    key={item.id}
                    item={item}
                    onOpenGame={onOpenGame}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type NewsCardProps = {
  item: StoreNewsItem;
  onOpenGame?: (game: PackageGame) => void;
};

function NewsCard({ item, onOpenGame }: NewsCardProps) {
  const isClickable = !!item.game && !!onOpenGame;

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={() => {
        if (isClickable && item.game) {
          onOpenGame(item.game);
        }
      }}
      onKeyDown={(e) => {
        if (isClickable && item.game && (e.key === "Enter" || e.key === " ")) {
          onOpenGame(item.game);
        }
      }}
      className={`group overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/[0.03] transition ${
        isClickable
          ? "cursor-pointer hover:border-white/15 hover:bg-white/[0.06]"
          : ""
      }`}
    >
      <div className={`flex flex-col sm:flex-row ${!item.imageUrl ? "sm:items-center" : ""}`}>
        {item.imageUrl && (
          <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-white/[0.04] sm:h-[160px] sm:w-56 sm:aspect-auto">
            <img
              src={item.imageUrl}
              alt={item.title}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          </div>
        )}

        <div className={`flex flex-1 flex-col justify-center ${item.imageUrl ? "p-4 sm:p-5" : "px-4 py-5"}`}>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium leading-normal ${CATEGORY_STYLES[item.category] || CATEGORY_STYLES.Store}`}
            >
              {item.category}
            </span>
          </div>

          <h3 className="mt-2 text-sm font-semibold leading-snug text-(--color-text)">
            {item.title}
          </h3>

          <p className="mt-1.5 text-xs leading-relaxed text-(--color-muted) line-clamp-2">
            {item.description}
          </p>

          {isClickable && (
            <span className="mt-3 inline-flex items-center gap-0.5 text-xs font-medium text-(--color-accent) opacity-0 transition group-hover:opacity-100">
              View Details
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
