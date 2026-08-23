import {
  FolderOpen,
  Tag,
  Brain,
  Gamepad2,
  Clock,
  Heart,
  Inbox,
  Plus,
  Lock,
} from "lucide-react";
import SettingsSection from "./SettingsSection";

interface CollectionTypeEntry {
  id: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  count: number;
  status: "available" | "coming-soon";
}

const COLLECTION_TYPES: CollectionTypeEntry[] = [
  {
    id: "manual",
    label: "Manual Collections",
    icon: <Tag className="h-4 w-4" />,
    description: "User-created groups for organizing games however you like.",
    count: 0,
    status: "coming-soon",
  },
  {
    id: "smart",
    label: "Smart Collections",
    icon: <Brain className="h-4 w-4" />,
    description: "Auto-updating groups based on rules like genre, playtime, or status.",
    count: 0,
    status: "coming-soon",
  },
  {
    id: "genre",
    label: "Genre Collections",
    icon: <Gamepad2 className="h-4 w-4" />,
    description: "Automatically grouped by game genre metadata from Steam and providers.",
    count: 0,
    status: "available",
  },
  {
    id: "provider",
    label: "Provider Collections",
    icon: <FolderOpen className="h-4 w-4" />,
    description: "Group games by source: Steam, Lua, Manual, or future providers.",
    count: 0,
    status: "available",
  },
  {
    id: "recent",
    label: "Recently Played",
    icon: <Clock className="h-4 w-4" />,
    description: "Games sorted by most recent play session.",
    count: 0,
    status: "available",
  },
  {
    id: "favorites",
    label: "Favorites",
    icon: <Heart className="h-4 w-4" />,
    description: "Your favorited games across all sources.",
    count: 0,
    status: "available",
  },
  {
    id: "backlog",
    label: "Backlog",
    icon: <Inbox className="h-4 w-4" />,
    description: "Owned but unplayed games. Requires completion tracking.",
    count: 0,
    status: "coming-soon",
  },
];

export default function CollectionsSection() {
  return (
    <>
      <SettingsSection
        title="Collections"
        description="Manage game collections and grouping behavior across your library."
      >
        <div className="space-y-4">
          {/* Summary card */}
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-(--color-text)">
                  Collection Overview
                </p>
                <p className="mt-0.5 text-xs text-(--color-muted)">
                  Collections group games across all providers: Steam, Manual, Lua, and future sources.
                </p>
              </div>
              <div className="flex gap-3 text-center">
                <div>
                  <p className="text-lg font-bold text-(--color-accent)">0</p>
                  <p className="text-[10px] text-(--color-muted)">Custom</p>
                </div>
                <div className="h-8 w-px bg-(--surface-active-border)" />
                <div>
                  <p className="text-lg font-bold text-(--color-text)">4</p>
                  <p className="text-[10px] text-(--color-muted)">Built-in</p>
                </div>
              </div>
            </div>
          </div>

          {/* New Collection button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-3 py-2 text-xs text-(--color-muted) opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New Collection
            </button>
            <p className="text-[11px] text-(--color-muted)">
              Collection creation will be available in a future update.
            </p>
          </div>

          {/* Collection types */}
          <div className="space-y-2">
            {COLLECTION_TYPES.map((ct) => (
              <div
                key={ct.id}
                className="flex items-center gap-4 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--color-accent)/10 text-(--color-accent)">
                  {ct.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-(--color-text)">
                      {ct.label}
                    </p>
                    {ct.status === "coming-soon" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)">
                        <Lock className="h-2.5 w-2.5" />
                        Coming soon
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-(--color-muted)">
                    {ct.description}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-mono font-semibold text-(--color-text)">
                    {ct.count}
                  </p>
                  <p className="text-[10px] text-(--color-muted)">games</p>
                </div>
              </div>
            ))}
          </div>

          {/* Info note */}
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <p className="text-xs text-(--color-muted)">
              <strong className="text-(--color-text)">Note:</strong>{" "}
              Collections use stable game identifiers across all providers. Steam games use{" "}
              <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">
                steam:{"<appId>"}
              </code>
              {" "}and manual games use{" "}
              <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">
                manual:{"<uuid>"}
              </code>
              . Manual collection management, smart rules, and drag-and-drop reordering
              are planned for a future release.
            </p>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
