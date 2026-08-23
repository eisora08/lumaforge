import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Upload, Search, Loader2, ImageOff, Grid3x3 } from "lucide-react";
import { getRecentMedia, addRecentMedia, type ProfileMediaEntry } from "./profileRecentMedia";
import { searchProfileGifs, getTrendingProfileGifs, getGifServiceStatus, type ProfileGifResult } from "./profileGifService";
import { saveProfileMedia } from "../../services/tauri";
import { resolveProfileMediaUrl } from "./userProfile";

export type ProfileMediaKind = "avatar" | "banner";

type Props = {
  kind: ProfileMediaKind;
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, isGif: boolean, source: "upload" | "gif" | "preset") => void;
};

const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_MAX_BYTES = 15 * 1024 * 1024;

function detectIsGif(url: string): boolean {
  try {
    const path = new URL(url, window.location.href).pathname;
    return path.toLowerCase().endsWith(".gif");
  } catch {
    return url.toLowerCase().endsWith(".gif");
  }
}

function extensionFromFile(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  if (name.endsWith(".webp")) return "webp";
  if (name.endsWith(".gif")) return "gif";
  return "png";
}

async function readFileAsBytes(file: File): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(Array.from(new Uint8Array(buf)));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export default function ProfileMediaPickerModal({ kind, open, onClose, onSelect }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "gif" | "recent">("upload");
  const [error, setError] = useState<string | null>(null);

  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState<ProfileGifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifTrending, setGifTrending] = useState<ProfileGifResult[]>([]);
  const [gifKeyOk, setGifKeyOk] = useState(false);

  const recentItems = getRecentMedia(kind);

  const maxBytes = kind === "avatar" ? AVATAR_MAX_BYTES : BANNER_MAX_BYTES;
  const title = kind === "avatar" ? "Select an Avatar" : "Select a Banner";
  const squareLayout = kind === "avatar";

  useEffect(() => {
    const status = getGifServiceStatus();
    setGifKeyOk(status.available);
  }, []);

  useEffect(() => {
    if (open && gifKeyOk && gifTrending.length === 0) {
      getTrendingProfileGifs().then(setGifTrending);
    }
  }, [open, gifKeyOk, gifTrending.length]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(async () => {
      if (!gifQuery.trim()) {
        setGifResults([]);
        setGifLoading(false);
        return;
      }
      setGifLoading(true);
      const results = await searchProfileGifs(gifQuery.trim());
      setGifResults(results);
      setGifLoading(false);
    }, 400);
    return () => clearTimeout(id);
  }, [gifQuery, open]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") onClose();
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGifQuery("");
    setGifResults([]);
    setTab("upload");
  }, [open, kind]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(png|jpeg|jpg|webp|gif)$/i)) {
      setError("Unsupported file type. Use PNG, JPG, WEBP, or GIF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > maxBytes) {
      const mb = Math.round(maxBytes / 1024 / 1024);
      setError(`File too large (max ${mb}MB).`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const bytes = await readFileAsBytes(file);
      const ext = extensionFromFile(file);
      const savedPath = await saveProfileMedia(kind, ext, bytes);
      const isGif = file.type === "image/gif" || detectIsGif(file.name);
      addRecentMedia({ kind, source: "upload", url: savedPath, isGif });
      onSelect(savedPath, isGif, "upload");
    } catch (err) {
      setError(`Failed to save file: ${err}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSelectRecent(entry: ProfileMediaEntry) {
    onSelect(entry.url, entry.isGif, entry.source);
  }

  function handleSelectGif(result: ProfileGifResult) {
    addRecentMedia({ kind, source: "gif", url: result.gifUrl, isGif: true, label: result.title });
    onSelect(result.gifUrl, true, "gif");
  }

  if (!open) return null;

  const displayedGifs = gifQuery.trim() ? gifResults : gifTrending;

  const tabs = [
    { id: "upload" as const, label: "Upload", icon: Upload },
    { id: "gif" as const, label: "GIF", icon: Grid3x3, disabled: !gifKeyOk },
    { id: "recent" as const, label: "Recent", icon: ImageOff, badge: recentItems.length },
  ];

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
    >
      <div
        ref={panelRef}
        className={`relative flex flex-col rounded-2xl border border-(--color-border) bg-(--color-bg) shadow-2xl ${
          squareLayout ? "w-[480px]" : "w-[560px]"
        } max-h-[80vh]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border) px-5 py-4">
          <h2 className="text-base font-bold text-(--color-text)">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) transition hover:bg-white/8 hover:text-(--color-text)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-(--color-border) px-4 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => !t.disabled && setTab(t.id)}
              disabled={t.disabled}
              className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition ${
                tab === t.id && !t.disabled
                  ? "bg-(--color-surface) text-(--color-text) border-t border-l border-r border-(--color-border) -mb-px"
                  : t.disabled
                    ? "text-(--color-muted)/40 cursor-not-allowed"
                    : "text-(--color-muted) hover:text-(--color-text) hover:bg-white/5"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span className="ml-1 rounded-full bg-(--color-accent)/20 px-1.5 text-[10px] text-(--color-accent)">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "upload" && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div
                className={`flex cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-(--color-border) transition hover:border-(--color-accent)/40 hover:bg-white/5 ${
                  squareLayout ? "h-48 w-48" : "h-32 w-full max-w-md"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center gap-2 text-(--color-muted)">
                  <Upload className="h-8 w-8" />
                  <span className="text-sm font-medium">Click to upload</span>
                  <span className="text-[11px]">
                    {kind === "avatar" ? "PNG, JPG, WEBP, GIF (max 5MB)" : "PNG, JPG, WEBP, GIF (max 15MB)"}
                  </span>
                </div>
              </div>
              {error && (
                <p className="text-xs text-rose-400">{error}</p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                onChange={handleFilePick}
                className="hidden"
              />
            </div>
          )}

          {tab === "gif" && (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
                <input
                  type="text"
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  placeholder="Search GIFs..."
                  className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) py-2.5 pl-10 pr-4 text-sm text-(--color-text) outline-none transition focus:border-(--color-accent)/40"
                />
              </div>
              {gifLoading ? (
                <div className="flex items-center justify-center py-12 text-(--color-muted)">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : displayedGifs.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-(--color-muted)">
                  <ImageOff className="h-8 w-8" />
                  <p className="text-sm">
                    {gifQuery.trim() ? "No GIFs found" : "No trending GIFs available"}
                  </p>
                </div>
              ) : (
                <div className={`grid gap-2 ${squareLayout ? "grid-cols-3" : "grid-cols-3"}`}>
                  {displayedGifs.map((gif) => (
                    <button
                      key={gif.id}
                      onClick={() => handleSelectGif(gif)}
                      className="group relative aspect-video overflow-hidden rounded-xl bg-(--color-surface) transition hover:ring-2 hover:ring-(--color-accent)"
                    >
                      <img
                        src={gif.previewUrl}
                        alt={gif.title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/40 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                        <span className="truncate text-[10px] text-white/80">{gif.title || "GIF"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "recent" && (
            recentItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-(--color-muted)">
                <ImageOff className="h-8 w-8" />
                <p className="text-sm">No recent {kind === "avatar" ? "avatars" : "banners"}</p>
              </div>
            ) : (
              <div className={`grid gap-3 ${squareLayout ? "grid-cols-3" : "grid-cols-2"}`}>
                {recentItems.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handleSelectRecent(entry)}
                    className={`group relative overflow-hidden rounded-xl bg-(--color-surface) transition hover:ring-2 hover:ring-(--color-accent) ${
                      squareLayout ? "aspect-square" : "aspect-video"
                    }`}
                  >
                    <img
                      src={resolveProfileMediaUrl(entry.url) ?? entry.url}
                      alt={entry.label || `Recent ${kind}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {entry.isGif && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[10px] font-medium text-white">
                        GIF
                      </span>
                    )}
                    {entry.label && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                        <span className="block truncate text-[10px] text-white/90">{entry.label}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
