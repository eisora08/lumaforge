import { Toast, toast } from "react-hot-toast";
import { Trophy, X } from "lucide-react";
import AsyncImage from "../common/AsyncImage";
import type { UnlockEvent } from "../../types/gameAchievements";

export const ACHIEVEMENT_TOAST_DURATION = 4500;

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

type AchievementToastProps = {
  t: Toast;
  event: UnlockEvent;
  appId?: string;
};

export function showAchievementToast(event: UnlockEvent, appId?: string) {
  toast.custom(
    (t) => <AchievementToastComponent t={t} event={event} appId={appId} />,
    { duration: ACHIEVEMENT_TOAST_DURATION, position: "top-right" },
  );
}

function resolveIconSrc(value: string | undefined, appId?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("data:") || value.startsWith("file://") || value.startsWith("asset://")) return value;
  if (/^[a-f0-9]{40}$/i.test(value) && appId) return `${STEAM_CDN}/${appId}/${value}.jpg`;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return undefined;
}

function AchievementToastComponent({ t, event, appId }: AchievementToastProps) {
  const iconSrc = resolveIconSrc(event.iconUrl, appId) || resolveIconSrc(event.iconGrayUrl, appId);

  return (
    <div
      className={`pointer-events-auto relative w-80 overflow-hidden rounded-2xl border border-emerald-500/20 bg-(--color-bg)/95 backdrop-blur-xl px-4 py-3 text-(--color-text) shadow-2xl shadow-emerald-500/10 ${
        t.visible ? "lf-toast-entry" : "lf-toast-exit"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute -left-12 -top-12 h-24 w-24 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-emerald-400 via-green-400 to-emerald-500" />

      <div className="relative z-10 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
          {iconSrc ? (
            <AsyncImage
              src={iconSrc}
              alt=""
              className="h-full w-full object-cover"
              fallback={<Trophy className="h-5 w-5 text-emerald-400" />}
            />
          ) : (
            <Trophy className="h-5 w-5 text-emerald-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
            Achievement Unlocked
          </p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-(--color-text)">
            {event.name}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-full bg-(--surface-active-border)">
        <div
          className="h-full origin-left bg-linear-to-r from-emerald-400 via-green-400 to-emerald-500"
          style={{ animation: `lf-toast-progress ${ACHIEVEMENT_TOAST_DURATION}ms linear forwards` }}
        />
      </div>
    </div>
  );
}
