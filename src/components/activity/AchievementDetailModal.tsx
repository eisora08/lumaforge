import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, Lock, Zap } from "lucide-react";
import type { AchievementWithState } from "../../features/activity/types";
import { RARITY_COLORS, RARITY_ACCENT_BAR, RARITY_ICONS, CATEGORY_LABELS, CATEGORY_ICONS } from "../../features/activity/types";

type ProgressInfo = {
  current: number;
  target: number;
  label: string;
};

type Props = {
  open: boolean;
  achievement: AchievementWithState | null;
  progress: ProgressInfo | null;
  onClose: () => void;
};

function formatUnlockDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function AchievementDetailModal({ open, achievement, progress, onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => closeRef.current?.focus());
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onCloseRef.current();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!open || !achievement) return null;

  const rarity = RARITY_COLORS[achievement.rarity];
  const AchIcon = achievement.icon;
  const RarityIcon = RARITY_ICONS[achievement.rarity];
  const CatIcon = CATEGORY_ICONS[achievement.category];
  const isUnlocked = achievement.unlocked;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Achievement: ${achievement.title}`}
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-md lf-modal-overlay"
    >
      <div
        ref={panelRef}
        className="lf-modal-panel mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-(--color-border)/20 lf-surface shadow-2xl"
      >
        {/* Rarity accent bar */}
        <div className={`relative h-1 ${RARITY_ACCENT_BAR[achievement.rarity]}`}>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="absolute right-3 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white/70"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pt-5 pb-6">
          {/* Icon + Title + Status */}
          <div className="flex items-start gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border transition ${
                isUnlocked
                  ? `${rarity.bg} ${rarity.border}`
                  : "border-white/10 bg-white/[0.04]"
              }`}
            >
              {isUnlocked ? (
                <AchIcon className={`h-7 w-7 ${rarity.text}`} />
              ) : (
                <Lock className="h-6 w-6 text-(--color-muted)/30" />
              )}
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className={`text-lg font-bold leading-6 ${isUnlocked ? "text-(--color-text)" : "text-(--color-text)/60"}`}>
                {achievement.title}
              </h2>
              <p className={`mt-1 text-sm leading-relaxed ${isUnlocked ? "text-(--color-muted)" : "text-(--color-muted)/50"}`}>
                {achievement.hidden && !isUnlocked ? "This is a hidden achievement" : achievement.description}
              </p>
            </div>
          </div>

          {/* Status banner */}
          {isUnlocked ? (
            <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium text-emerald-300">Achievement Unlocked</span>
              {achievement.unlockedAt && (
                <span className="ml-auto text-xs text-emerald-400/60">
                  {formatUnlockDate(achievement.unlockedAt)}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <Lock className="h-4 w-4 text-(--color-muted)/40 shrink-0" />
              <span className="text-sm font-medium text-(--color-muted)">Locked</span>
            </div>
          )}

          {/* Progress / Requirement */}
          {progress && (
            <div className="mt-4 rounded-xl border border-(--color-border)/15 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between text-xs text-(--color-muted)">
                <span>{progress.label}</span>
                <span className="font-medium text-(--color-text)">
                  {progress.current} / {progress.target}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isUnlocked ? "bg-emerald-400" : "bg-(--color-accent)/60"
                  }`}
                  style={{ width: `${Math.min(100, progress.target > 0 ? (progress.current / progress.target) * 100 : 0)}%` }}
                />
              </div>
            </div>
          )}

          {!progress && !isUnlocked && (
            <div className="mt-4 rounded-xl border border-(--color-border)/15 bg-white/[0.03] px-4 py-3">
              <div className="text-xs text-(--color-muted)">
                <span className="font-medium text-(--color-text)/70">Requirement: </span>
                {achievement.description}
              </div>
            </div>
          )}

          {/* Meta row */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {/* Category */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-border)/20 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-(--color-muted)">
              <CatIcon className="h-3 w-3" />
              {CATEGORY_LABELS[achievement.category]}
            </span>

            {/* Rarity */}
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${rarity.bg} ${rarity.text}`}>
              <RarityIcon className="h-3 w-3" />
              {achievement.rarity.charAt(0).toUpperCase() + achievement.rarity.slice(1)}
            </span>

            {/* XP */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/8 px-3 py-1 text-[11px] font-bold text-amber-300">
              <Zap className="h-3 w-3" />
              +{achievement.xp} XP
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-(--color-border)/10 bg-white/[0.02] px-6 py-3">
          <div className="flex items-center gap-1 text-[10px] text-(--color-muted)/40">
            <kbd className="rounded border border-(--color-border)/30 px-1.5 py-0.5 font-mono text-[9px]">Esc</kbd>
            <span>Close</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2 text-xs font-medium text-(--color-text) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
