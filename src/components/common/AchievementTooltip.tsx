import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Lock, Trophy } from "lucide-react";
import type { GameAchievement } from "../../types/gameAchievements";

type Props = {
  achievement: GameAchievement;
  children: React.ReactNode;
};

function formatRarityPercent(pct: number | undefined | null): string | null {
  if (pct == null) return null;
  if (!Number.isFinite(pct)) return null;
  return pct.toFixed(1);
}

function formatAchievementDate(ts: number | undefined): string | null {
  if (!ts || ts <= 0) return null;
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AchievementTooltip({ achievement, children }: Props) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [side, setSide] = useState<"right" | "left">("right");

  const TOOLTIP_WIDTH = 280;
  const SPACING = 10;
  const VIEWPORT_PAD = 12;

  function show() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const fitsRight = rect.right + SPACING + TOOLTIP_WIDTH <= window.innerWidth - VIEWPORT_PAD;
    const anchorSide = fitsRight ? "right" : "left";
    setSide(anchorSide);

    let top = rect.top + rect.height / 2;
    const approxHeight = 160;
    const minTop = VIEWPORT_PAD + approxHeight / 2;
    const maxTop = window.innerHeight - VIEWPORT_PAD - approxHeight / 2;
    if (top < minTop) top = minTop;
    if (top > maxTop) top = maxTop;

    const leftPos = anchorSide === "right"
      ? rect.right + SPACING
      : rect.left - SPACING;

    setPos({ top, left: leftPos });
    setVisible(true);
  }

  function hide() {
    setVisible(false);
  }

  const rarity = formatRarityPercent(achievement.rarityPercent);
  const dateStr = achievement.unlocked ? formatAchievementDate(achievement.unlockTime) : null;

  return (
    <div
      ref={triggerRef}
      className="inline-flex cursor-pointer items-center *:focus-visible:outline-none"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? "ach-tooltip" : undefined}
    >
      {children}
      {visible && createPortal(
        <div
          role="tooltip"
          id="ach-tooltip"
          className="fixed z-[60] pointer-events-none"
          style={{
            top: pos.top,
            left: pos.left,
            transform: `translateY(-50%) ${side === "left" ? "translateX(-100%)" : ""}`,
          }}
        >
          <div
            className="lf-achievement-tooltip-in"
            style={{ transformOrigin: side === "left" ? "right center" : "left center" }}
          >
            <div className="w-[280px] rounded-xl border border-(--surface-active-border) bg-(--color-surface) p-3 shadow-xl">
              <div className="flex items-start gap-2.5">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
                  {achievement.unlocked && achievement.iconUrl ? (
                    <img src={achievement.iconUrl} alt="" className="h-full w-full" />
                  ) : achievement.iconGrayUrl ? (
                    <img src={achievement.iconGrayUrl} alt="" className="h-full w-full opacity-50" />
                  ) : achievement.iconUrl ? (
                    <img src={achievement.iconUrl} alt="" className="h-full w-full object-cover opacity-40 grayscale" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-(--color-muted)">
                      {achievement.unlocked ? <Trophy className="h-5 w-5 text-emerald-400" /> : <Lock className="h-5 w-5" />}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-(--color-text) leading-tight truncate">
                    {achievement.name}
                  </p>
                  {achievement.description && (
                    <p className="mt-1 text-[11px] text-(--color-muted)/80 leading-relaxed line-clamp-2">
                      {achievement.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 border-t border-(--surface-active-border) pt-2">
                <span className={`text-[10px] font-medium ${achievement.unlocked ? "text-emerald-400" : "text-(--color-muted)/70"}`}>
                  {achievement.unlocked ? "Unlocked" : "Locked"}
                </span>
                {rarity !== null ? (
                  <span className="text-[10px] text-(--color-muted)/50">{rarity}% rarity</span>
                ) : (
                  <span className="text-[10px] text-(--color-muted)/30">N/A rarity</span>
                )}
                {dateStr && (
                  <span className="text-[10px] text-(--color-muted)/40 ml-auto">{dateStr}</span>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
