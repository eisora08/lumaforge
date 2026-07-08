import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Check, RotateCcw, Upload, Trash2 } from "lucide-react";
import type { UserProfile } from "./userProfile";
import { DEFAULT_USER_PROFILE } from "./userProfile";
import { AVATAR_PRESETS, BANNER_PRESETS, getAvatarPreset, getBannerPreset } from "./profilePresets";

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

type Props = {
  open: boolean;
  profile: UserProfile;
  onSave: (updated: UserProfile) => void;
  onClose: () => void;
};

function detectIsGif(url: string): boolean {
  try {
    const path = new URL(url, window.location.href).pathname;
    return path.toLowerCase().endsWith(".gif");
  } catch {
    return url.toLowerCase().endsWith(".gif");
  }
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProfileModal({ open, profile, onSave, onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<UserProfile>(() => ({ ...profile, updatedAt: Date.now() }));

  useEffect(() => {
    if (open) setDraft({ ...profile, updatedAt: Date.now() });
  }, [open, profile]);

  const avatarPreset = useMemo(() => getAvatarPreset(draft.avatarPreset), [draft.avatarPreset]);
  const bannerPreset = useMemo(() => getBannerPreset(draft.bannerPreset), [draft.bannerPreset]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") { onClose(); return; }
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [open]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
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
  }, [open]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  function patch(p: Partial<UserProfile>) {
    setDraft((prev) => ({ ...prev, ...p, updatedAt: Date.now() }));
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    const isGif = file.type === "image/gif" || detectIsGif(file.name);
    patch({ avatarUrl: dataUrl, avatarIsGif: isGif });
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataURL(file);
    const isGif = file.type === "image/gif" || detectIsGif(file.name);
    patch({ bannerUrl: dataUrl, bannerIsGif: isGif });
    if (bannerInputRef.current) bannerInputRef.current.value = "";
  }

  function handleClearAvatar() {
    patch({ avatarUrl: null, avatarIsGif: false });
  }

  function handleClearBanner() {
    patch({ bannerUrl: null, bannerIsGif: false });
  }

  function handleSave() {
    onSave({ ...draft, updatedAt: Date.now() });
    onClose();
  }

  function handleReset() {
    const defaults = { ...DEFAULT_USER_PROFILE, updatedAt: Date.now() };
    setDraft(defaults);
  }

  if (!open) return null;

  const showCustomAvatar = draft.avatarUrl || draft.avatarIsGif;
  const showCustomBanner = draft.bannerUrl || draft.bannerIsGif;

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        className="relative mx-4 flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-(--color-border) bg-(--color-bg) shadow-2xl"
      >
        {/* ====== BANNER + AVATAR PREVIEW ====== */}
        <div className="relative shrink-0">
          <div
            className="h-36 rounded-t-2xl bg-cover bg-center"
            style={{
              background: bannerPreset?.gradient ?? "var(--color-accent)",
              ...(draft.bannerUrl ? { backgroundImage: `url(${draft.bannerUrl})` } : {}),
            }}
          />
          <div className="absolute -bottom-12 left-6">
            <div
              className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-(--color-bg) ring-2 ring-white/10"
              style={{ background: avatarPreset?.gradient ?? "var(--color-accent)" }}
            >
              {draft.avatarUrl ? (
                <img
                  src={draft.avatarUrl}
                  alt=""
                  className={`h-full w-full object-cover ${draft.avatarIsGif ? "" : ""}`}
                />
              ) : (
                <span className="text-3xl">{avatarPreset?.icon ?? "🎮"}</span>
              )}
              <div
                className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-(--color-bg)"
                style={{ background: draft.accentMode === "custom" && draft.accentColor ? draft.accentColor : "var(--color-accent)" }}
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition hover:bg-black/60 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          {draft.bannerUrl && (
            <button
              onClick={handleClearBanner}
              className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg bg-black/50 px-2 py-1 text-[10px] text-white/70 backdrop-blur-sm transition hover:bg-black/70 hover:text-white"
              title="Clear custom banner"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {/* Name + status under banner */}
        <div className="mt-14 px-6 pb-2">
          <h2 className="text-lg font-bold text-(--color-text)">{draft.displayName}</h2>
          <p className="text-sm text-(--color-muted)">{draft.status}</p>
        </div>

        {/* ====== SECTIONS ====== */}
        <div className="flex flex-col gap-5 px-6 pb-6">
          {/* --- Identity --- */}
          <Section title="Identity">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-(--color-muted)">Display Name</span>
              <input
                type="text"
                value={draft.displayName}
                onChange={(e) => patch({ displayName: e.target.value })}
                maxLength={32}
                className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none transition focus:border-(--color-accent)/40"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-(--color-muted)">Status</span>
              <input
                type="text"
                value={draft.status}
                onChange={(e) => patch({ status: e.target.value })}
                maxLength={48}
                className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm text-(--color-text) outline-none transition focus:border-(--color-accent)/40"
              />
            </label>
          </Section>

          {/* --- Avatar --- */}
          <Section title="Avatar">
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => patch({ avatarPreset: p.id, avatarUrl: null, avatarIsGif: false })}
                  className={`flex aspect-square items-center justify-center rounded-xl transition hover:scale-105 active:scale-95 ${
                    draft.avatarPreset === p.id && !showCustomAvatar
                      ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-bg)"
                      : "ring-1 ring-white/10 opacity-60 hover:opacity-100"
                  }`}
                  style={{ background: p.gradient }}
                  title={p.label}
                >
                  <span className="text-lg">{p.icon}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--color-border) bg-(--color-surface) px-3 py-2 text-xs font-medium text-(--color-text) transition hover:bg-white/8"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Image
              </button>
              {showCustomAvatar && (
                <button
                  onClick={handleClearAvatar}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-400 transition hover:bg-rose-500/15"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
              {draft.avatarIsGif && (
                <span className="flex items-center gap-1 rounded-lg bg-(--color-accent)/10 px-2 py-1 text-[10px] font-medium text-(--color-accent)">
                  GIF
                </span>
              )}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </Section>

          {/* --- Banner --- */}
          <Section title="Banner">
            <div className="grid grid-cols-3 gap-2">
              {BANNER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => patch({ bannerPreset: p.id, bannerUrl: null, bannerIsGif: false })}
                  className={`flex h-14 items-center justify-center rounded-xl text-xs font-medium text-white/80 transition hover:scale-[1.02] active:scale-[0.98] ${
                    draft.bannerPreset === p.id && !showCustomBanner
                      ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-bg)"
                      : "ring-1 ring-white/10 opacity-60 hover:opacity-100"
                  }`}
                  style={{ background: p.gradient }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => bannerInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-(--color-border) bg-(--color-surface) px-3 py-2 text-xs font-medium text-(--color-text) transition hover:bg-white/8"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Image
              </button>
              {showCustomBanner && (
                <button
                  onClick={handleClearBanner}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs font-medium text-rose-400 transition hover:bg-rose-500/15"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
              {draft.bannerIsGif && (
                <span className="flex items-center gap-1 rounded-lg bg-(--color-accent)/10 px-2 py-1 text-[10px] font-medium text-(--color-accent)">
                  GIF
                </span>
              )}
            </div>
            <input
              ref={bannerInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              onChange={handleBannerUpload}
              className="hidden"
            />
          </Section>

          {/* --- Accent --- */}
          <Section title="Accent Color">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => patch({ accentMode: "follow-theme", accentColor: null })}
                className={`rounded-xl px-3 py-2 text-sm transition ${
                  draft.accentMode === "follow-theme"
                    ? "bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/30"
                    : "bg-(--color-surface) text-(--color-muted) ring-1 ring-(--color-border) hover:text-(--color-text)"
                }`}
              >
                Follow Theme
              </button>
              <button
                onClick={() => patch({ accentMode: "custom", accentColor: draft.accentColor ?? "#6366f1" })}
                className={`rounded-xl px-3 py-2 text-sm transition ${
                  draft.accentMode === "custom"
                    ? "bg-(--color-accent)/15 text-(--color-accent) ring-1 ring-(--color-accent)/30"
                    : "bg-(--color-surface) text-(--color-muted) ring-1 ring-(--color-border) hover:text-(--color-text)"
                }`}
              >
                Custom
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
        <div className="sticky bottom-0 flex items-center justify-between border-t border-(--color-border) bg-(--color-bg) px-6 py-4">
          <button
            onClick={handleReset}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-rose-400/80 transition hover:bg-rose-500/10 hover:text-rose-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Profile
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="cursor-pointer rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-2 text-sm font-medium text-(--color-text) transition hover:bg-white/8"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 active:scale-[0.97]"
            >
              <Check className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
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
