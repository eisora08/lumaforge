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

function getRarityTier(pct: number | undefined | null): "gold" | "silver" | "bronze" | null {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return null;
  if (pct <= 1) return "gold";
  if (pct <= 5) return "silver";
  if (pct <= 10) return "bronze";
  return null;
}

function getRarityLabel(tier: "gold" | "silver" | "bronze" | null): string {
  switch (tier) {
    case "gold": return "Ultra Rare";
    case "silver": return "Rare";
    case "bronze": return "Uncommon";
    default: return "";
  }
}

function getRarityColors(tier: "gold" | "silver" | "bronze" | null) {
  switch (tier) {
    case "gold":
      return {
        border: "border-[#f9c74f]/80",
        glow: "shadow-[0_0_16px_rgba(249,199,79,0.6)]",
        badge: "bg-[#f9c74f]/15 border-[#f9c74f]/60 text-[#ffe08a]",
        label: "text-[#f9c74f]",
        iconRing: "ring-[#f9c74f]/40",
      };
    case "silver":
      return {
        border: "border-[#c7d0d9]/80",
        glow: "shadow-[0_0_14px_rgba(199,208,217,0.5)]",
        badge: "bg-[#c7d0d9]/15 border-[#c7d0d9]/60 text-[#edf3f8]",
        label: "text-[#c7d0d9]",
        iconRing: "ring-[#c7d0d9]/40",
      };
    case "bronze":
      return {
        border: "border-[#cd7f32]/80",
        glow: "shadow-[0_0_14px_rgba(205,127,50,0.5)]",
        badge: "bg-[#cd7f32]/15 border-[#cd7f32]/60 text-[#efb475]",
        label: "text-[#cd7f32]",
        iconRing: "ring-[#cd7f32]/40",
      };
    default:
      return {
        border: "border-(--surface-active-border)",
        glow: "",
        badge: "",
        label: "text-(--color-accent)",
        iconRing: "ring-(--color-accent)/20",
      };
  }
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
  const tier = getRarityTier(event.rarityPercent);
  const colors = getRarityColors(tier);
  const isRare = tier !== null;

  return (
    <div
      className={`pointer-events-auto w-96 overflow-hidden rounded-2xl border ${colors.border} ${colors.glow} bg-(--color-bg)/95 backdrop-blur-xl shadow-2xl ${
        isRare ? "lf-ach-toast-rare-glow" : ""
      } ${visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"}`}
      role="status"
      aria-live="polite"
    >
      <div className="relative px-5 py-4">
        <div className="flex items-start gap-4">
          {/* Icon with rarity ring */}
          <div className="relative shrink-0">
            <div className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-(--color-accent)/10 ring-2 ${colors.iconRing}`}>
              {iconSrc ? (
                <img
                  src={iconSrc}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Trophy className="h-7 w-7 text-(--color-accent)" />
              )}
            </div>
            {/* Rarity badge below icon */}
            {isRare && rarity && (
              <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${colors.badge}`}>
                {rarity}%
              </div>
            )}
          </div>

          {/* Text content */}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className={`text-[11px] font-bold uppercase tracking-[0.15em] ${colors.label}`}>
              {isRare ? `${getRarityLabel(tier)} Achievement` : "Achievement Unlocked"}
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug text-(--color-text)">
              {event.name}
            </p>
            {event.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted)/70 line-clamp-2">
                {event.description}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              {gameTitle && (
                <span className="truncate text-[10px] font-medium text-(--color-muted)/60">
                  {gameTitle}
                </span>
              )}
              {rarity !== null && (
                <>
                  {gameTitle && <span className="text-[10px] text-(--color-muted)/30">·</span>}
                  <span className={`text-[10px] font-medium ${colors.label}`}>
                    {rarity}% rarity
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Close button */}
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
      className={`pointer-events-auto w-96 overflow-hidden rounded-2xl border border-(--surface-active-border) bg-(--color-bg)/95 backdrop-blur-xl px-5 py-4 text-(--color-text) shadow-2xl ${
        visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-(--color-accent)/10">
          <Trophy className="h-7 w-7 text-(--color-accent)" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-(--color-accent)">
            Achievements Unlocked
          </p>
          <p className="mt-1 text-sm font-medium leading-snug text-(--color-text)">
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
