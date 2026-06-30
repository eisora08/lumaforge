import { useMemo } from "react";
import { Activity } from "lucide-react";
import GameHero from "../components/dashboard/GameHero";
import ContinuePlayingSection from "../components/dashboard/ContinuePlayingSection";
import LuaReadySection from "../components/dashboard/LuaReadySection";
import LibrarySection from "../components/dashboard/LibrarySection";
import StoreHighlightsSection from "../components/dashboard/StoreHighlightsSection";
import QuickActionsCompact from "../components/dashboard/QuickActionsCompact";
import { getCachedSnapshot } from "../services/startupSnapshotService";
import { useGameActivity } from "../context/GameActivityContext";
import { useGameSession } from "../context/GameSessionContext";
import type { AppPage } from "../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

type DedupedActivity = {
  id: string;
  title: string;
  count: number;
  createdAt: number;
};

function formatTimestamp(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function deduplicateActivities(activities: { id: string; title: string; createdAt: number }[]): DedupedActivity[] {
  const seen = new Map<string, DedupedActivity>();
  for (const a of activities) {
    const key = a.title;
    const existing = seen.get(key);
    if (existing) {
      existing.count++;
    } else {
      seen.set(key, { id: a.id, title: a.title, count: 1, createdAt: a.createdAt });
    }
  }
  return Array.from(seen.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
}

export default function Home({ onNavigate }: Props) {
  const snapshot = useMemo(() => getCachedSnapshot(), []);
  const { activities } = useGameActivity();
  const { sessions } = useGameSession();

  const runningAppId = useMemo(() => {
    const running = Object.values(sessions).find((s) => s.state === "running");
    return running?.appId;
  }, [sessions]);

  const dedupedActivity = useMemo(() => deduplicateActivities(activities), [activities]);

  const installedCount = snapshot?.library?.games?.filter((g) => g.installed).length ?? 0;
  const lastSync = snapshot?.updatedAt
    ? new Date(snapshot.updatedAt * 1000).toLocaleString()
    : null;

  return (
    <div className="mx-auto w-full max-w-[1760px] px-6 py-6 lg:px-8 xl:px-10">
      <div className="space-y-8">
        <GameHero onNavigate={onNavigate} />
        <ContinuePlayingSection
          snapshot={snapshot}
          onNavigate={onNavigate}
          excludeAppId={runningAppId}
        />
        <LuaReadySection onNavigate={onNavigate} />
        <LibrarySection
          snapshot={snapshot}
          onNavigate={onNavigate}
          excludeAppIds={[runningAppId].filter(Boolean) as string[]}
        />
        <StoreHighlightsSection onNavigate={onNavigate} />
        <QuickActionsCompact onNavigate={onNavigate} />

        {/* Compact system strip */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs text-(--color-muted)">System Ready</span>
          </div>

          {lastSync && (
            <span className="text-xs text-(--color-muted)/60">
              Last sync: {lastSync}
            </span>
          )}

          <span className="text-xs text-(--color-muted)/60">
            {installedCount} game{installedCount !== 1 ? "s" : ""} installed
          </span>

          {dedupedActivity.length > 0 && (
            <div className="flex items-center gap-3 border-l border-(--surface-active-border) pl-4">
              <Activity className="h-3.5 w-3.5 text-(--color-muted)/60" />
              {dedupedActivity.map((a) => (
                <div key={a.id} className="flex items-center gap-1.5">
                  <span className="line-clamp-1 max-w-[160px] text-xs text-(--color-muted)/80">
                    {a.count > 1 ? `${a.title} \u00b7 ${a.count}x` : a.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-(--color-muted)/40">
                    {formatTimestamp(a.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
