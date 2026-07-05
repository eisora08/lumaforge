import { Trophy, X } from "lucide-react";
import type { UnlockEvent } from "../../types/gameAchievements";
import { resolveImageSource } from "../../services/achievementImageQueue";

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

function formatRarityPercent(pct: number | undefined | null): string | null {
  if (pct == null) return null;
  if (!Number.isFinite(pct)) return null;
  return pct.toFixed(1);
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

export type AchievementToastBodyProps = {
  event: UnlockEvent;
  appId?: string;
  gameTitle?: string;
  visible?: boolean;
  onClose?: () => void;
};

export function AchievementToastBody({ event, appId, gameTitle, visible = true, onClose }: AchievementToastBodyProps) {
  const iconSrc = resolveIconSrc(event.iconUrl, appId) || resolveIconSrc(event.iconGrayUrl, appId);
  const rarity = formatRarityPercent(event.rarityPercent);

  return (
    <div
      className={`pointer-events-auto w-80 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/95 backdrop-blur-xl px-4 py-3 text-(--color-text) shadow-2xl ${
        visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"
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
              <span className="truncate text-[10px] font-medium text-(--color-muted)/70">
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
            onClose?.();
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

export type GroupedAchievementToastBodyProps = {
  count: number;
  visible?: boolean;
  onClose?: () => void;
};

export function GroupedAchievementToastBody({ count, visible = true, onClose }: GroupedAchievementToastBodyProps) {
  return (
    <div
      className={`pointer-events-auto w-80 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/95 backdrop-blur-xl px-4 py-3 text-(--color-text) shadow-2xl ${
        visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"
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
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose?.(); }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
