import { Lock, Trophy } from "lucide-react";
import AsyncImage from "./AsyncImage";

type AchievementIconProps = {
  iconUrl?: string | null;
  iconGrayUrl?: string | null;
  unlocked: boolean;
  size?: "sm" | "md";
};

export default function AchievementIcon({ iconUrl, iconGrayUrl, unlocked, size = "md" }: AchievementIconProps) {
  const dimensions = size === "sm" ? "h-7 w-7" : "h-10 w-10";

  // Unlocked: show colored icon
  if (unlocked && iconUrl) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5`}>
        <AsyncImage
          src={iconUrl}
          alt=""
          className="h-full w-full"
          fallback={<div className="flex h-full w-full items-center justify-center text-(--color-muted)"><Trophy className="h-5 w-5" /></div>}
        />
      </div>
    );
  }

  // Locked: show gray icon with lock overlay
  if (iconGrayUrl) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 relative`}>
        <AsyncImage
          src={iconGrayUrl}
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
  if (iconUrl) {
    return (
      <div className={`${dimensions} shrink-0 overflow-hidden rounded-lg bg-white/5 relative`}>
        <img
          src={iconUrl}
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
