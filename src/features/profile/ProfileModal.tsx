import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X, Check, RotateCcw, Pencil, ImagePlus, Trash2 } from "lucide-react";
import type { UserProfile } from "./userProfile";
import { DEFAULT_USER_PROFILE, resolveProfileMediaUrl } from "./userProfile";
import { getAvatarPreset, getBannerPreset } from "./profilePresets";
import ProfileMediaPickerModal from "./ProfileMediaPickerModal";
import type { ProfileMediaKind } from "./ProfileMediaPickerModal";

type Props = {
  open: boolean;
  profile: UserProfile;
  onSave: (updated: UserProfile) => void;
  onClose: () => void;
};

export default function ProfileModal({ open, profile, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const bannerMenuRef = useRef<HTMLDivElement>(null);
  const avatarTriggerRef = useRef<HTMLButtonElement>(null);
  const bannerTriggerRef = useRef<HTMLButtonElement>(null);

  const [draft, setDraft] = useState<UserProfile>(() => ({ ...profile, updatedAt: Date.now() }));
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [bannerMenuOpen, setBannerMenuOpen] = useState(false);
  const [mediaPickerKind, setMediaPickerKind] = useState<ProfileMediaKind | null>(null);
  const [avatarMenuPos, setAvatarMenuPos] = useState<{ top: number; left: number }>({ top: 80, left: 16 });
  const [bannerMenuPos, setBannerMenuPos] = useState<{ top: number; left: number }>({ top: 80, left: 16 });

  // Animation state: mounted survives close until exit animation finishes
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open && !mounted && !exiting) {
      setMounted(true);
      setExiting(false);
    }
  }, [open, mounted, exiting]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const animatedClose = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    closeTimerRef.current = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
      onClose();
    }, 200);
  }, [exiting, onClose]);

  useEffect(() => {
    if (open) setDraft({ ...profile, updatedAt: Date.now() });
  }, [open, profile]);

  const avatarPreset = useMemo(() => getAvatarPreset(draft.avatarPreset), [draft.avatarPreset]);
  const bannerPreset = useMemo(() => getBannerPreset(draft.bannerPreset), [draft.bannerPreset]);

  const avatarDisplayUrl = useMemo(() => resolveProfileMediaUrl(draft.avatarUrl), [draft.avatarUrl]);
  const bannerDisplayUrl = useMemo(() => resolveProfileMediaUrl(draft.bannerUrl), [draft.bannerUrl]);

  const hasCustomAvatar = !!draft.avatarUrl;
  const hasCustomBanner = !!draft.bannerUrl;

  const menuW = 224;
  const menuH = 180;
  const positionMenuBelow = (triggerRef: React.RefObject<HTMLButtonElement | null>, center = false) => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return { top: 80, left: 16 };
    let top = rect.bottom + 8;
    let left = center ? rect.left + rect.width / 2 - menuW / 2 : rect.left;
    if (top + menuH > window.innerHeight) top = rect.top - menuH - 8;
    if (top < 8) top = 8;
    if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    return { top, left };
  };

  // Close context menus on outside click
  useEffect(() => {
    if (!mounted && !exiting) return;
    function handleClick(e: MouseEvent) {
      if (
        avatarMenuOpen &&
        avatarMenuRef.current &&
        !avatarMenuRef.current.contains(e.target as Node) &&
        avatarTriggerRef.current &&
        !avatarTriggerRef.current.contains(e.target as Node)
      ) {
        setAvatarMenuOpen(false);
      }
      if (
        bannerMenuOpen &&
        bannerMenuRef.current &&
        !bannerMenuRef.current.contains(e.target as Node) &&
        bannerTriggerRef.current &&
        !bannerTriggerRef.current.contains(e.target as Node)
      ) {
        setBannerMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [mounted, exiting, avatarMenuOpen, bannerMenuOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!mounted && !exiting) return;
    if (e.key === "Escape") {
      if (avatarMenuOpen) { setAvatarMenuOpen(false); return; }
      if (bannerMenuOpen) { setBannerMenuOpen(false); return; }
      animatedClose();
    }
  }, [mounted, exiting, animatedClose, avatarMenuOpen, bannerMenuOpen]);

  useEffect(() => {
    if (!mounted && !exiting) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mounted, exiting, handleKeyDown]);

  useEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !panelRef.current) return;
    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    panel.addEventListener("keydown", handleTab);
    return () => panel.removeEventListener("keydown", handleTab);
  }, [mounted]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) animatedClose();
  }

  function patch(p: Partial<UserProfile>) {
    setDraft((prev) => ({ ...prev, ...p, updatedAt: Date.now() }));
  }

  function handleSave() {
    onSave({ ...draft, updatedAt: Date.now() });
    animatedClose();
  }

  function handleReset() {
    const defaults = { ...DEFAULT_USER_PROFILE, updatedAt: Date.now() };
    setDraft(defaults);
  }

  function handleMediaSelect(url: string, isGif: boolean, _source: "upload" | "gif" | "preset") {
    if (mediaPickerKind === "avatar") {
      patch({ avatarUrl: url, avatarIsGif: isGif, avatarPreset: "custom" });
    } else if (mediaPickerKind === "banner") {
      patch({ bannerUrl: url, bannerIsGif: isGif, bannerPreset: "custom" });
    }
    setMediaPickerKind(null);
  }

  // Don't render at all after exit animation completes
  if (!mounted && !exiting) return null;

  const isAnimating = exiting;
  const reducedMotionClass = "motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:translate-y-0 motion-reduce:opacity-100";

  return createPortal(
    <>
      <div
        ref={backdropRef}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-label={t("profile.edit_profile")}
        className={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-200 ease-out ${isAnimating ? "bg-black/0" : "bg-black/40"} ${reducedMotionClass}`}
      >
        <div
          ref={panelRef}
          className={`relative mx-4 w-full max-w-lg flex max-h-[85vh] flex-col overflow-y-auto rounded-2xl border border-(--color-border) lf-surface shadow-2xl transition-all duration-200 ease-out ${isAnimating ? "scale-95 translate-y-2 opacity-0" : "scale-100 translate-y-0 opacity-100"} ${reducedMotionClass}`}
        >
          {/* ====== BANNER + AVATAR PREVIEW (clickable) ====== */}
          <div className="relative shrink-0">
            {/* Banner — clickable */}
            <button
              ref={bannerTriggerRef}
              onClick={() => {
                const next = !bannerMenuOpen;
                if (next) setBannerMenuPos(positionMenuBelow(bannerTriggerRef, true));
                setBannerMenuOpen(next);
              }}
              className="group relative block h-36 w-full rounded-t-2xl bg-cover bg-center text-left outline-none transition"
              style={{
                background: bannerPreset?.gradient ?? "var(--color-accent)",
                ...(bannerDisplayUrl ? { backgroundImage: `url(${bannerDisplayUrl})` } : {}),
              }}
              aria-label={t("profile.change_banner")}
            >
              {/* Hover pencil overlay — fully hidden by default, visible on group hover */}
              <div className="absolute inset-0 flex items-center justify-center rounded-t-2xl opacity-0 transition-all duration-150 ease-out group-hover:opacity-100 group-hover:bg-black/30 motion-reduce:transition-none">
                <span className="flex h-8 w-8 items-center justify-center rounded-full scale-90 opacity-0 transition-all duration-150 ease-out group-hover:scale-100 group-hover:opacity-100 group-hover:bg-black/50 group-hover:text-white/90 group-hover:backdrop-blur-sm motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:opacity-100">
                  <Pencil className="h-4 w-4" />
                </span>
              </div>
              {draft.bannerIsGif && (
                <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  GIF
                </span>
              )}
            </button>

            {/* Avatar — clickable */}
            <button
              ref={avatarTriggerRef}
              onClick={() => {
                const next = !avatarMenuOpen;
                if (next) setAvatarMenuPos(positionMenuBelow(avatarTriggerRef));
                setAvatarMenuOpen(next);
              }}
              className="group absolute -bottom-12 left-6 outline-none"
              aria-label={t("profile.change_avatar")}
            >
              <div
                className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-(--color-bg) ring-2 ring-white/10 transition"
                style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
              >
                {avatarDisplayUrl ? (
                  <img src={avatarDisplayUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl">{avatarPreset?.icon ?? "🎮"}</span>
                )}
                {/* Hover pencil overlay — fully hidden by default, visible on group hover */}
                <div className="absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-all duration-150 ease-out group-hover:opacity-100 group-hover:bg-black/40 motion-reduce:transition-none">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full scale-90 opacity-0 transition-all duration-150 ease-out group-hover:scale-100 group-hover:opacity-100 group-hover:bg-black/60 group-hover:text-white/90 group-hover:backdrop-blur-sm motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:opacity-100">
                    <Pencil className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
              <span
                className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-(--color-bg)"
                style={{ background: draft.accentMode === "custom" && draft.accentColor ? draft.accentColor : "var(--color-accent)" }}
              />
              {draft.avatarIsGif && (
                <span className="absolute -top-1 -right-1 rounded bg-(--color-accent)/80 px-1 text-[9px] font-bold text-(--color-accent-text)">
                  GIF
                </span>
              )}
            </button>

            {/* Close button */}
            <button
              onClick={animatedClose}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition hover:bg-black/60 hover:text-white"
              aria-label={t("topbar.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Name + status under banner */}
          <div className="mt-14 px-6 pb-2">
            <h2 className="text-lg font-bold text-(--color-text)">{draft.displayName}</h2>
            <p className="text-sm text-(--color-muted)">{draft.status}</p>
          </div>

          {/* ====== SECTIONS ====== */}
          <div className="flex flex-col gap-5 px-6 pb-6">
            {/* --- Identity --- */}
            <Section title={t("profile.identity")}>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-(--color-muted)">{t("profile.display_name")}</span>
                <input
                  type="text"
                  value={draft.displayName}
                  onChange={(e) => patch({ displayName: e.target.value })}
                  maxLength={32}
                  className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none transition focus:border-(--color-accent)/40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-(--color-muted)">{t("profile.status")}</span>
                <input
                  type="text"
                  value={draft.status}
                  onChange={(e) => patch({ status: e.target.value })}
                  maxLength={48}
                  className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none transition focus:border-(--color-accent)/40"
                />
              </label>
            </Section>

            {/* --- Accent --- */}
            <Section title={t("profile.accent_color")}>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => patch({ accentMode: "follow-theme", accentColor: null })}
                  className={`rounded-xl px-3 py-2 text-sm transition ${
                    draft.accentMode === "follow-theme"
                      ? "bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/30"
                      : "bg-(--color-surface) text-(--color-muted) ring-1 ring-(--color-border) hover:text-(--color-text)"
                  }`}
                >
                  {t("profile.follow_theme")}
                </button>
                <button
                  onClick={() => patch({ accentMode: "custom", accentColor: draft.accentColor ?? "#6366f1" })}
                  className={`rounded-xl px-3 py-2 text-sm transition ${
                    draft.accentMode === "custom"
                      ? "bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/30"
                      : "bg-(--color-surface) text-(--color-muted) ring-1 ring-(--color-border) hover:text-(--color-text)"
                  }`}
                >
                  {t("profile.custom")}
                </button>
              </div>
              {draft.accentMode === "custom" && (
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="color"
                    value={draft.accentColor ?? "#6366f1"}
                    onChange={(e) => patch({ accentColor: e.target.value })}
                    className="h-9 w-9 cursor-pointer rounded-lg border border-(--color-border) bg-transparent p-0.5"
                  />
                  <span className="text-xs text-(--color-muted)">{draft.accentColor ?? "#6366f1"}</span>
                </div>
              )}
            </Section>
          </div>

          {/* ====== FOOTER ====== */}
          <div className="sticky bottom-0 flex items-center justify-between border-t border-(--color-border) lf-surface px-6 py-4">
            <button
              onClick={handleReset}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-400/80 transition hover:bg-rose-500/10 hover:text-rose-400"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("profile.reset_profile")}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={animatedClose}
                className="cursor-pointer rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-2 text-sm font-medium text-(--color-text) transition hover:bg-white/8"
              >
                {t("profile.cancel")}
              </button>
              <button
                onClick={handleSave}
                className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:opacity-90 active:scale-[0.97]"
              >
                <Check className="h-4 w-4" />
                {t("profile.save")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ====== AVATAR CONTEXT MENU ====== */}
      {avatarMenuOpen && (
        <div
          ref={avatarMenuRef}
          className="fixed z-[70] w-56 rounded-xl border border-(--color-border) bg-(--color-surface) p-1.5 shadow-2xl"
          style={{ top: `${avatarMenuPos.top}px`, left: `${avatarMenuPos.left}px` }}
        >
          <ContextMenuItem
            icon={ImagePlus}
            label={t("profile.change_avatar")}
            onClick={() => {
              setAvatarMenuOpen(false);
              setMediaPickerKind("avatar");
            }}
          />
          {hasCustomAvatar && (
            <div className="my-1 border-t border-(--color-border)" />
          )}
          {hasCustomAvatar && (
            <ContextMenuItem
              icon={Trash2}
              label={t("profile.remove_avatar")}
              danger
              onClick={() => {
                setAvatarMenuOpen(false);
                patch({ avatarUrl: null, avatarIsGif: false, avatarPreset: "gamepad" });
              }}
            />
          )}
        </div>
      )}

      {/* ====== BANNER CONTEXT MENU ====== */}
      {bannerMenuOpen && (
        <div
          ref={bannerMenuRef}
          className="fixed z-[70] w-56 rounded-xl border border-(--color-border) bg-(--color-surface) p-1.5 shadow-2xl"
          style={{ top: `${bannerMenuPos.top}px`, left: `${bannerMenuPos.left}px` }}
        >
          <ContextMenuItem
            icon={ImagePlus}
            label={t("profile.change_banner")}
            onClick={() => {
              setBannerMenuOpen(false);
              setMediaPickerKind("banner");
            }}
          />
          {hasCustomBanner && (
            <div className="my-1 border-t border-(--color-border)" />
          )}
          {hasCustomBanner && (
            <ContextMenuItem
              icon={Trash2}
              label={t("profile.remove_banner")}
              danger
              onClick={() => {
                setBannerMenuOpen(false);
                patch({ bannerUrl: null, bannerIsGif: false, bannerPreset: "midnight" });
              }}
            />
          )}
        </div>
      )}

      {/* ====== MEDIA PICKER MODAL ====== */}
      <ProfileMediaPickerModal
        kind={mediaPickerKind ?? "avatar"}
        open={mediaPickerKind !== null}
        onClose={() => {
          setMediaPickerKind(null);
        }}
        onSelect={handleMediaSelect}
      />
    </>,
    document.body
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-(--color-muted)">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function ContextMenuItem({
  icon: Icon,
  label,
  subtitle,
  disabled,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  if (disabled) {
    return (
      <div className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-(--color-muted)/40">
        <Icon className="h-4 w-4 shrink-0 opacity-40" />
        <div className="flex flex-col">
          <span>{label}</span>
          {subtitle && (
            <span className="text-[10px] text-(--color-muted)/30">{subtitle}</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        danger
          ? "text-rose-400 hover:bg-rose-500/10"
          : "text-(--color-text) hover:bg-white/8"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${danger ? "text-rose-400" : "text-(--color-muted)"}`} />
      <span>{label}</span>
    </button>
  );
}
