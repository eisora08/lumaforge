import { useState, useEffect } from "react";
import { Lock, Trophy } from "lucide-react";
import AsyncImage from "./AsyncImage";

type AchievementIconProps = {
  iconUrl?: string | null;
  iconGrayUrl?: string | null;
  unlocked: boolean;
  size?: "sm" | "md";
  appId?: string;
};

function useResolvedUrl(url: string | null | undefined, appId?: string): string | null | undefined {
  const [resolved, setResolved] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!url || !appId || (!url.startsWith("img/") && !url.startsWith("media/"))) {
      setResolved(url);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { resolveRelativeAchievementImagePath, localPathToUrl } = await import("../../services/gameCacheService");
        const absPath = await resolveRelativeAchievementImagePath(appId, url);
        const finalUrl = localPathToUrl(absPath);
        if (!cancelled) setResolved(finalUrl ?? url);
      } catch {
        if (!cancelled) setResolved(url);
      }
    })();
    return () => { cancelled = true; };
  }, [url, appId]);
  return resolved;
}

export default function AchievementIcon({ iconUrl, iconGrayUrl, unlocked, size = "md", appId }: AchievementIconProps) {
  const dimensions = size === "sm" ? "h-7 w-7" : "h-10 w-10";
  const resolvedUrl = useResolvedUrl(iconUrl, appId);
  const resolvedGrayUrl = useResolvedUrl(iconGrayUrl, appId);

  // Unlocked: show colored icon
  if (unlocked && resolvedUrl) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5`}>
        <AsyncImage
          src={resolvedUrl}
          alt=""
          className="h-full w-full"
          fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)"><Trophy className="h-5 w-5" /></div>}
        />
      </div>
    );
  }

  // Locked: show gray icon with lock overlay
  if (resolvedGrayUrl) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 relative`}>
        <AsyncImage
          src={resolvedGrayUrl}
          alt=""
          className="h-full w-full opacity-50"
          fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)/50"><Lock className="h-5 w-5" /></div>}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Lock className="h-4 w-4 text-white/70" />
        </div>
      </div>
    );
  }

  // No gray icon but have colored icon: show colored with grayscale + lock
  if (resolvedUrl) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 relative`}>
        <img
          src={resolvedUrl}
          alt=""
          className="h-full w-full object-cover opacity-40 grayscale"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Lock className="h-4 w-4 text-white/70" />
        </div>
      </div>
    );
  }

  // No image at all: show placeholder
  return (
    <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 flex items-center justify-center text-(--color-muted)`}>
      {unlocked ? <Trophy className="h-5 w-5 text-emerald-400" /> : <Lock className="h-5 w-5" />}
    </div>
  );
}
