import { useState } from "react";
import { ExternalLink, Gamepad2 } from "lucide-react";

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
];

const CATEGORY_STYLES: Record<string, string> = {
  "Lua Ready": "border-(--color-accent)/25 bg-(--color-accent)/10 text-(--color-accent)",
  Featured: "border-yellow-500/25 bg-yellow-500/10 text-yellow-300",
  DLC: "border-blue-500/25 bg-blue-500/10 text-blue-300",
  Installed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  Store: "border-purple-500/25 bg-purple-500/10 text-purple-300",
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
    <section className="space-y-5">
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
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
              activeCategory === filter.id
                ? "bg-(--color-accent) text-black"
                : "border border-(--surface-active-border) bg-white/5 text-(--color-muted) hover:text-(--color-text)"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <section className="rounded-2xl border border-(--surface-active-border) bg-white/5 p-10 text-center">
          <Gamepad2 className="mx-auto h-10 w-10 text-(--color-muted)" />
          <h3 className="mt-4 font-semibold text-(--color-text)">
            No news yet
          </h3>
          <p className="mt-2 text-sm text-(--color-muted)">
            Store updates and supported games will appear here.
          </p>
        </section>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ group, items: groupItems }) => (
            <div key={group}>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
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
      className={`overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/5 transition ${
        isClickable
          ? "cursor-pointer hover:bg-white/[0.07]"
          : ""
      }`}
    >
      <div className="flex flex-col sm:flex-row">
        {item.imageUrl && (
          <div className="aspect-video w-full shrink-0 overflow-hidden bg-white/5 sm:h-auto sm:w-44 sm:aspect-auto">
            <img
              src={item.imageUrl}
              alt={item.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        <div className="flex flex-1 flex-col justify-center p-4">
          <span
            className={`mb-2 inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[item.category] || CATEGORY_STYLES.Store}`}
          >
            {item.category}
          </span>

          <h3 className="text-sm font-semibold text-(--color-text)">
            {item.title}
          </h3>

          <p className="mt-1 text-xs leading-relaxed text-(--color-muted)">
            {item.description}
          </p>

          {isClickable && (
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-(--color-accent)">
              <ExternalLink className="h-3 w-3" />
              View Details
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
