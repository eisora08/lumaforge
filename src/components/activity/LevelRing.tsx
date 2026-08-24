import { useTranslation } from "react-i18next";
import { useGrowOnMount } from "../../hooks/useGrowOnMount";

interface LevelRingProps {
  percent: number;
  level: number;
  svgClassName?: string;
  levelClassName?: string;
  labelClassName?: string;
}

/**
 * Shared animated level/XP ring used by both LauncherAchievements and
 * ActivityStats. Grows the stroke from empty to `percent` when it mounts
 * (page-entry animation) via useGrowOnMount + the existing CSS transition.
 */
export default function LevelRing({
  percent,
  level,
  svgClassName = "h-24 w-24",
  levelClassName = "text-2xl",
  labelClassName = "text-[8px]",
}: LevelRingProps) {
  const { t } = useTranslation();
  const grow = useGrowOnMount();
  const circumference = 2 * Math.PI * 38;
  const offset = circumference * (1 - (grow ? percent / 100 : 0));

  return (
    <div className="relative shrink-0">
      <svg className={`${svgClassName} -rotate-90`} viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="38" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/[0.06]" />
        <circle
          cx="44" cy="44" r="38" fill="none" stroke="currentColor" strokeWidth="5"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={`${offset}`}
          strokeLinecap="round"
          className="text-amber-400 transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${levelClassName} font-bold text-amber-400`}>{level}</span>
        <span className={`${labelClassName} uppercase tracking-widest text-amber-400/60 -mt-0.5`}>{t("launcher_achievements.status.level", "Level")}</span>
      </div>
    </div>
  );
}
