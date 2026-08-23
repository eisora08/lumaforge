import { Trophy, X } from "lucide-react";
import type { UnlockEvent } from "../../types/gameAchievements";
import { resolveImageSource } from "../../services/achievementImageQueue";

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";

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

function getRarityTier(pct: number | undefined | null, isPlatinum?: boolean): "platinum" | "gold" | "silver" | "bronze" | null {
  if (isPlatinum) return "platinum";
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return null;
  if (pct <= 1) return "gold";
  if (pct <= 5) return "silver";
  if (pct <= 10) return "bronze";
  return null;
}

function getRarityLabel(tier: "platinum" | "gold" | "silver" | "bronze" | null): string {
  switch (tier) {
    case "platinum": return "Platinum Trophy";
    case "gold": return "Ultra Rare";
    case "silver": return "Rare";
    case "bronze": return "Uncommon";
    default: return "";
  }
}

function getRarityColors(tier: "platinum" | "gold" | "silver" | "bronze" | null) {
  switch (tier) {
    case "platinum":
      return {
        border: "border-[#a78bfa]/80",
        glow: "shadow-[0_0_18px_rgba(167,139,250,0.6)]",
        label: "text-[#a78bfa]",
        iconRing: "ring-[#a78bfa]/50",
      };
    case "gold":
      return {
        border: "border-[#f9c74f]/80",
        glow: "shadow-[0_0_16px_rgba(249,199,79,0.6)]",
        label: "text-[#f9c74f]",
        iconRing: "ring-[#f9c74f]/40",
      };
    case "silver":
      return {
        border: "border-[#c7d0d9]/80",
        glow: "shadow-[0_0_14px_rgba(199,208,217,0.5)]",
        label: "text-[#c7d0d9]",
        iconRing: "ring-[#c7d0d9]/40",
      };
    case "bronze":
      return {
        border: "border-[#cd7f32]/80",
        glow: "shadow-[0_0_14px_rgba(205,127,50,0.5)]",
        label: "text-[#cd7f32]",
        iconRing: "ring-[#cd7f32]/40",
      };
    default:
      return {
        border: "border-(--surface-active-border)",
        glow: "",
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
  const tier = getRarityTier(event.rarityPercent, event.isPlatinum);
  const colors = getRarityColors(tier);
  const isRare = tier !== null;
  const isPlatinum = event.isPlatinum === true;

  return (
    <div
      className={`pointer-events-auto w-96 overflow-hidden rounded-2xl border ${colors.border} ${colors.glow} bg-(--color-bg)/95 backdrop-blur-xl shadow-2xl ${
        isRare ? "lf-ach-toast-rare-glow" : ""
      } ${visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"} ${isPlatinum ? "lf-ach-toast-platinum" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="relative px-5 py-4">
        <div className="flex items-start gap-4">
          {/* Icon — spring bounce in */}
          <div className="relative shrink-0 lf-ach-icon-reveal">
            <div className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-(--color-accent)/10 ring-2 ${colors.iconRing} ${isPlatinum ? "lf-ach-platinum-ring" : ""}`}>
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
            {isPlatinum && (
              <div className="absolute -inset-1 rounded-xl lf-ach-platinum-sparkle pointer-events-none" />
            )}
          </div>

          {/* Text — slide in from right */}
          <div className="min-w-0 flex-1 pt-0.5 lf-ach-text-reveal">
            <p className={`text-[11px] font-bold uppercase tracking-[0.15em] ${colors.label}`}>
              {isPlatinum ? "Platinum Trophy" : isRare ? `${getRarityLabel(tier)} Achievement` : "Achievement Unlocked"}
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug text-(--color-text)">
              {event.name}
            </p>
            {event.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted)/70 line-clamp-2">
                {event.description}
              </p>
            )}
            {gameTitle && (
              <p className="mt-1 text-[10px] font-medium text-(--color-muted)/60 truncate">
                {gameTitle}
              </p>
            )}
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

// ── Multi-achievement strip (horizontal icon row, Steam-style) ──

export type MultiAchievementStripProps = {
  unlocks: UnlockEvent[];
  appId?: string;
  gameTitle?: string;
  visible?: boolean;
  onClose?: () => void;
};

export function MultiAchievementStrip({ unlocks, appId, gameTitle, visible = true, onClose }: MultiAchievementStripProps) {
  const maxIcons = 6;
  const shown = unlocks.slice(0, maxIcons);
  const overflow = unlocks.length - shown.length;

  const highestTier = unlocks.reduce<"platinum" | "gold" | "silver" | "bronze" | null>((best, u) => {
    const t = getRarityTier(u.rarityPercent, u.isPlatinum);
    if (!t) return best;
    const order = ["platinum", "gold", "silver", "bronze"];
    if (!best || order.indexOf(t) < order.indexOf(best)) return t;
    return best;
  }, null);
  const colors = getRarityColors(highestTier);
  const isPlatinum = highestTier === "platinum";

  return (
    <div
      className={`pointer-events-auto overflow-hidden rounded-2xl border ${colors.border} ${colors.glow} bg-(--color-bg)/95 backdrop-blur-xl shadow-2xl ${
        highestTier ? "lf-ach-toast-rare-glow" : ""
      } ${visible ? "lf-ach-toast-enter" : "lf-ach-toast-exit"} ${isPlatinum ? "lf-ach-toast-platinum" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="px-5 py-4">
        <div className="flex items-center gap-3">
          {/* Header */}
          <div className="min-w-0 flex-1">
            <p className={`text-[11px] font-bold uppercase tracking-[0.15em] ${colors.label}`}>
              {isPlatinum ? "Platinum Trophy" : "Achievements Unlocked"}
            </p>
            {gameTitle && (
              <p className="mt-0.5 text-[10px] font-medium text-(--color-muted)/60 truncate">
                {gameTitle}
              </p>
            )}
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

        {/* Icon row — staggered reveal */}
        <div className="mt-3 flex items-center gap-2">
          {shown.map((u, i) => {
            const src = resolveIconSrc(u.iconUrl, appId) || resolveIconSrc(u.iconGrayUrl, appId);
            const t = getRarityTier(u.rarityPercent, u.isPlatinum);
            const c = getRarityColors(t);
            return (
              <div
                key={u.apiName}
                className="lf-ach-strip-icon-reveal"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ${c.iconRing}`}>
                  {src ? (
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-(--color-accent)/10">
                      <Trophy className="h-5 w-5 text-(--color-accent)" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {overflow > 0 && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[10px] font-bold text-(--color-muted) lf-ach-strip-icon-reveal"
              style={{ animationDelay: `${shown.length * 80}ms` }}
            >
              +{overflow}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
