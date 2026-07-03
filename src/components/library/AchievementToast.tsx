import { Toast, toast } from "react-hot-toast";
import { Trophy, X } from "lucide-react";
import type { UnlockEvent } from "../../types/gameAchievements";
import { resolveImageSource } from "../../services/achievementImageQueue";

export const ACHIEVEMENT_TOAST_DURATION = 4500;
export const ACHIEVEMENT_TOAST_EXIT_DURATION = 180;

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

function formatRarityPercent(pct: number | undefined | null): string | null {
  if (pct == null) return null;
  if (!Number.isFinite(pct)) return null;
  return pct.toFixed(1);
}

type AchievementToastProps = {
  t: Toast;
  event: UnlockEvent;
  appId?: string;
  gameTitle?: string;
};

export function showAchievementToast(event: UnlockEvent, appId?: string, gameTitle?: string) {
  toast.custom(
    (t) => <AchievementToastComponent t={t} event={event} appId={appId} gameTitle={gameTitle} />,
    { duration: ACHIEVEMENT_TOAST_DURATION, position: "bottom-right" },
  );
  if (import.meta.env.DEV) {
    const hasIcon = !!event.iconUrl;
    const hasGrayIcon = !!event.iconGrayUrl;
    console.debug(`[ACH][TOAST] show apiName=${event.apiName} hasIconUrl=${hasIcon} hasIconGrayUrl=${hasGrayIcon}`);
    if (!hasIcon && !hasGrayIcon) {
      console.debug(`[ACH][TOAST] missing icon apiName=${event.apiName}`);
    }
  }
}

export function showGroupedAchievementToast(count: number) {
  toast.custom(
    (t) => <GroupedToast t={t} count={count} />,
    { duration: ACHIEVEMENT_TOAST_DURATION, position: "bottom-right" },
  );
  if (import.meta.env.DEV) {
    console.debug(`[ACH][TOAST] grouped count=${count}`);
  }
}

function resolveIconSrc(value: string | undefined, appId?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("data:") || value.startsWith("file://") || value.startsWith("asset://")) return value;
  if (/^[a-f0-9]{40}$/i.test(value) && appId) return `${STEAM_CDN}/${appId}/${value}.jpg`;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("img/") && appId) {
    const resolved = resolveImageSource(value, appId, "icon");
    if (resolved) return resolved.sourceUrl;
  }
  return undefined;
}

function GroupedToast({ t, count }: { t: Toast; count: number }) {
  return (
    <div
      className={`pointer-events-auto w-80 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/95 backdrop-blur-xl px-4 py-3 text-(--color-text) shadow-2xl ${
        t.visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--color-accent)/10">
          <Trophy className="h-5 w-5 text-(--color-accent)" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-(--color-accent)">
            Achievements Unlocked
          </p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-(--color-text)">
            +{count} more achievements unlocked
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toast.dismiss(t.id); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function AchievementToastComponent({ t, event, appId, gameTitle }: AchievementToastProps) {
  const iconSrc = resolveIconSrc(event.iconUrl, appId) || resolveIconSrc(event.iconGrayUrl, appId);
  const rarity = formatRarityPercent(event.rarityPercent);

  return (
    <div
      className={`pointer-events-auto w-80 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/95 backdrop-blur-xl px-4 py-3 text-(--color-text) shadow-2xl ${
        t.visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-(--color-accent)/10 ring-1 ring-(--color-accent)/20">
          {iconSrc ? (
            <img
              src={iconSrc}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <Trophy className="h-5 w-5 text-(--color-accent)" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-(--color-accent)">
            Achievement Unlocked
          </p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-(--color-text)">
            {event.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            {gameTitle && (
              <span className="text-[10px] font-medium text-(--color-muted)/70 truncate">
                {gameTitle}
              </span>
            )}
            {rarity !== null && (
              <>
                {gameTitle && <span className="text-[10px] text-(--color-muted)/30">·</span>}
                <span className="text-[10px] text-(--color-muted)/50">
                  {rarity}% rarity
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          aria-label="Dismiss achievement notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function showTestAchievementToast(gameTitle?: string) {
  const testEvent: UnlockEvent = {
    apiName: "test_achievement",
    name: "Test Achievement",
    iconUrl: undefined,
    iconGrayUrl: undefined,
    unlockTime: Date.now(),
    rarityPercent: 31.1,
  };
  showAchievementToast(testEvent, undefined, gameTitle);
}
