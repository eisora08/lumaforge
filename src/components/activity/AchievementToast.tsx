import toast, { Toaster, Toast } from "react-hot-toast";
import type { AchievementDef } from "../../features/activity/types";
import { RARITY_COLORS, RARITY_ACCENT_BAR } from "../../features/activity/types";

const TOAST_Z = 2147483646;

type Props = {
  t: Toast;
  achievement: AchievementDef;
  duration: number;
};

function AchievementToastInner({ t, achievement, duration }: Props) {
  const rarity = RARITY_COLORS[achievement.rarity];
  const AchIcon = achievement.icon;

  return (
    <div
      className={`pointer-events-auto relative min-w-80 max-w-100 overflow-hidden rounded-2xl border bg-[#0d1117]/95 backdrop-blur-xl px-5 py-4 text-white ${
        t.visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"
      }`}
      style={{ borderColor: `var(--toast-border, rgba(255,255,255,0.1))` }}
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.75 ${RARITY_ACCENT_BAR[achievement.rarity]}`} />

      <div className="relative z-10 flex items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 lf-ach-icon-reveal">
          <AchIcon className="h-5 w-5 text-white/80" />
        </div>

        <div className="min-w-0 flex-1 lf-ach-text-reveal">
          <p className="text-[10px] uppercase tracking-widest text-amber-400/80 font-semibold">
            Achievement Unlocked
          </p>
          <p className="mt-0.5 text-sm font-bold text-white leading-5">
            {achievement.title}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${rarity.bg} ${rarity.text}`}>
              {achievement.rarity}
            </span>
            <span className="text-[10px] font-bold text-amber-400">
              +{achievement.xp} XP
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/30 transition hover:bg-white/10 hover:text-white/60"
        >
          ×
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 h-0.75 w-full bg-white/5">
        <div
          className="h-full origin-left bg-linear-to-r from-amber-400 to-amber-500"
          style={{ animation: `lf-toast-progress ${duration}ms linear forwards` }}
        />
      </div>
    </div>
  );
}

let _shownThisSession = new Set<string>();

export function showAchievementToast(achievement: AchievementDef, duration = 4000): void {
  if (_shownThisSession.has(achievement.id)) return;
  _shownThisSession.add(achievement.id);

  toast.custom(
    (t) => (
      <AchievementToastInner t={t} achievement={achievement} duration={duration} />
    ),
    { duration, style: { zIndex: TOAST_Z } }
  );
}

export function showAchievementToasts(achievements: AchievementDef[], delay = 600): void {
  achievements.forEach((ach, i) => {
    setTimeout(() => showAchievementToast(ach), i * delay);
  });
}

export function resetAchievementToastDedup(): void {
  _shownThisSession.clear();
}

export function AchievementToastViewport() {
  return (
    <Toaster
      position="bottom-right"
      gutter={10}
      containerStyle={{
        zIndex: TOAST_Z,
        bottom: 18,
        right: 18,
        pointerEvents: "none",
      }}
    />
  );
}
