import { useMemo, useState } from "react";
import { Activity, Filter, Trash2 } from "lucide-react";
import type { GameActivityItem, GameActivityKind } from "../../types/gameActivity";
import { useGameActivity } from "../../context/GameActivityContext";
import ActivityCard from "./ActivityCard";

const KIND_FILTERS: { label: string; value: GameActivityKind | null }[] = [
  { label: "All", value: null },
  { label: "Games", value: "game-detected" },
  { label: "Installs", value: "game-installed" },
  { label: "Launches", value: "game-launched" },
  { label: "Lua", value: "lua-installed" },
  { label: "Metadata", value: "metadata-refreshed" },
  { label: "DLC", value: "dlc-detected" },
  { label: "Files", value: "local-file-change" },
];

const SOURCE_FILTERS: { label: string; value: GameActivityItem["source"] | null }[] = [
  { label: "All Sources", value: null },
  { label: "Local", value: "local" },
  { label: "Steam", value: "steam" },
  { label: "Lua", value: "lua" },
  { label: "Provider", value: "provider" },
  { label: "System", value: "system" },
];

function getTimeGroup(ts: number): string {
  const diff = Date.now() - ts;
  const msInDay = 86400000;
  if (diff < msInDay) return "Today";
  if (diff < 7 * msInDay) return "This Week";
  if (diff < 30 * msInDay) return "This Month";
  return "Earlier";
}

const GROUP_ORDER = ["Today", "This Week", "This Month", "Earlier"];

export default function ActivityFeed() {
  const { activities, clearActivities } = useGameActivity();
  const [kindFilter, setKindFilter] = useState<GameActivityKind | null>(null);
  const [sourceFilter, setSourceFilter] = useState<GameActivityItem["source"] | null>(null);

  const filtered = useMemo(() => {
    let result = activities;
    if (kindFilter) {
      result = result.filter((a) => a.kind === kindFilter);
    }
    if (sourceFilter) {
      result = result.filter((a) => a.source === sourceFilter);
    }
    return result;
  }, [activities, kindFilter, sourceFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, GameActivityItem[]>();
    for (const item of filtered) {
      const group = getTimeGroup(item.createdAt);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(item);
    }
    return GROUP_ORDER.map((g) => ({
      group: g,
      items: map.get(g) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-(--color-text)">
            Activity Feed
          </h2>
          <p className="mt-1 text-sm text-(--color-muted)">
            Game events, system actions and updates.
          </p>
        </div>

        {activities.length > 0 && (
          <button
            type="button"
            onClick={clearActivities}
            className="flex items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-(--color-muted) transition hover:border-red-500/30 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear All
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-(--color-muted)" />
        {KIND_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setKindFilter(f.value)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              kindFilter === f.value
                ? "bg-(--color-accent) text-black"
                : "border border-(--surface-active-border) bg-white/[0.03] text-(--color-muted) hover:border-(--color-muted) hover:text-(--color-text)"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-(--surface-active-border)" />
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setSourceFilter(f.value)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              sourceFilter === f.value
                ? "bg-(--color-accent) text-black"
                : "border border-(--surface-active-border) bg-white/[0.03] text-(--color-muted) hover:border-(--color-muted) hover:text-(--color-text)"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <section className="rounded-2xl border border-(--surface-active-border) bg-white/[0.03] p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
            <Activity className="h-7 w-7 text-(--color-muted)" />
          </div>
          <h3 className="mt-4 font-semibold text-(--color-text)">
            No activity yet
          </h3>
          <p className="mt-1.5 text-sm text-(--color-muted)">
            Game events and system actions will appear here.
          </p>
        </section>
      ) : (
        <div className="space-y-10">
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-(--color-muted)">
                {group}
              </h3>
              <div className="space-y-2">
                {items.map((item) => (
                  <ActivityCard key={item.id} activity={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
