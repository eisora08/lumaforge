import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Search, Loader2, ChevronDown, ImageIcon, Eye, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WebImageResult } from "../../services/tauri";
import { searchWebImages } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";

type MediaRole = "cover" | "landscape" | "background" | "logo" | "icon";

type SizePreset = {
  label: string;
  width?: number;
  height?: number;
};

function getPresets(t: (key: string, fallback: string) => string): Record<MediaRole, SizePreset[]> {
  return {
    cover: [
      { label: t("web_image_search.preset_cover_600x900", "600x900 (Recommended)"), width: 600, height: 900 },
      { label: t("web_image_search.preset_steam_header", "Steam Header (460x215)"), width: 460, height: 215 },
      { label: t("web_image_search.preset_fhd_portrait", "Full HD Portrait (1080x1920)"), width: 1080, height: 1920 },
      { label: t("web_image_search.size_any", "Any size") },
    ],
    landscape: [
      { label: t("web_image_search.preset_landscape_1920x628", "1920x628 (Recommended)"), width: 1920, height: 628 },
      { label: t("web_image_search.preset_4k_header", "4K Header (3840x1256)"), width: 3840, height: 1256 },
      { label: t("web_image_search.preset_small_header", "Small Header (1280x409)"), width: 1280, height: 409 },
      { label: t("web_image_search.size_any", "Any size") },
    ],
    background: [
      { label: t("web_image_search.preset_bg_1920x1080", "1920x1080 (Recommended)"), width: 1920, height: 1080 },
      { label: t("web_image_search.preset_1440p", "1440p (2560x1440)"), width: 2560, height: 1440 },
      { label: t("web_image_search.preset_4k", "4K (3840x2160)"), width: 3840, height: 2160 },
      { label: t("web_image_search.size_any", "Any size") },
    ],
    icon: [
      { label: t("web_image_search.preset_icon_256", "256x256 (Recommended)"), width: 256, height: 256 },
      { label: t("web_image_search.preset_128", "128x128"), width: 128, height: 128 },
      { label: t("web_image_search.preset_512", "512x512"), width: 512, height: 512 },
      { label: t("web_image_search.size_any", "Any size") },
    ],
    logo: [
      { label: t("web_image_search.preset_logo_400x183", "400x183 (Recommended)"), width: 400, height: 183 },
      { label: t("web_image_search.preset_200x91", "200x91"), width: 200, height: 91 },
      { label: t("web_image_search.preset_800x366", "800x366"), width: 800, height: 366 },
      { label: t("web_image_search.size_any", "Any size") },
    ],
  };
}

function detectFormat(w: number, h: number): string {
  if (w === 0 || h === 0) return "Unknown";
  const ratio = w / h;
  if (Math.abs(ratio - 2 / 3) < 0.15) return "Cover (2:3)";
  if (Math.abs(ratio - 3 / 2) < 0.15) return "Landscape (3:2)";
  if (Math.abs(ratio - 16 / 9) < 0.15) return "Hero (16:9)";
  if (Math.abs(ratio - 1) < 0.15) return "Icon (1:1)";
  if (Math.abs(ratio - 21 / 9) < 0.15) return "Ultra-wide (21:9)";
  return `${w}x${h} (${ratio.toFixed(2)}:1)`;
}

type Props = {
  query: string;
  role?: MediaRole;
  onSelect: (url: string) => void;
};

export default function WebImageGrid({ query, role = "cover", onSelect }: Props) {
  const { t } = useTranslation();
  const [results, setResults] = useState<WebImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [source, setSource] = useState<"google" | "duckduckgo">("duckduckgo");
  const [searchQuery, setSearchQuery] = useState(query);
  const [safeSearch, setSafeSearch] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(3); // Default: "Any size"
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const SIZE_PRESETS = useMemo(() => getPresets(t), [t]);
  const presets = SIZE_PRESETS[role] ?? SIZE_PRESETS.cover;
  const currentPreset = presets[selectedPresetIdx];

  const getResolution = useCallback((): { width?: number; height?: number } => {
    if (customWidth && customHeight) {
      const w = parseInt(customWidth, 10);
      const h = parseInt(customHeight, 10);
      if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
        return { width: w, height: h };
      }
    }
    if (currentPreset?.width && currentPreset?.height) {
      return { width: currentPreset.width, height: currentPreset.height };
    }
    return {};
  }, [customWidth, customHeight, currentPreset]);

  const doSearch = useCallback(
    async (q: string, src: "google" | "duckduckgo", pageNum: number, append: boolean) => {
      if (!q.trim()) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const { width, height } = getResolution();

      setLoading(true);
      setError(null);
      try {
        const imgs = await searchWebImages(q, src, pageNum, safeSearch, width, height, transparent);
        if (ctrl.signal.aborted) return;
        setResults((prev) => (append ? [...prev, ...imgs] : imgs));
        setHasMore(imgs.length >= 20);
        if (imgs.length === 0 && !append) {
          setError(t("web_image_search.no_results", "No results found"));
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [t, safeSearch, transparent, getResolution]
  );

  // Initial search on mount / query change
  useEffect(() => {
    if (query) {
      setSearchQuery(query);
      setPage(0);
      doSearch(query, source, 0, false);
    }
    return () => abortRef.current?.abort();
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-search when transparent changes
  useEffect(() => {
    if (searchQuery) {
      setPage(0);
      doSearch(searchQuery, source, 0, false);
    }
  }, [transparent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    setPage(0);
    doSearch(searchQuery, source, 0, false);
  };

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    doSearch(searchQuery, source, next, true);
  };

  const handlePresetChange = (idx: number) => {
    setSelectedPresetIdx(idx);
    setCustomWidth("");
    setCustomHeight("");
  };

  const handleSelect = (img: WebImageResult, idx: number) => {
    setSelectedIdx(idx);
    onSelect(img.url);
  };

  const isCustomPreset = currentPreset?.label === t("web_image_search.size_any", "Any size");

  return (
    <div className="flex flex-col gap-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as "google" | "duckduckgo")}
          className="rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--color-text)]"
        >
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
        </select>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("web_image_search.placeholder", "Search images...")}
          className="flex-1 rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          {t("web_image_search.search", "Search")}
        </button>
      </div>

      {/* Size presets + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selectedPresetIdx}
          onChange={(e) => handlePresetChange(Number(e.target.value))}
          className="rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--color-text)]"
        >
          {presets.map((p, i) => (
            <option key={i} value={i}>{p.label}</option>
          ))}
        </select>

        {isCustomPreset && (
          <>
            <input
              type="number"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              placeholder={t("web_image_search.width", "Width")}
              min="1"
              className="w-20 rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
            />
            <span className="text-xs text-[var(--color-muted)]">x</span>
            <input
              type="number"
              value={customHeight}
              onChange={(e) => setCustomHeight(e.target.value)}
              placeholder={t("web_image_search.height", "Height")}
              min="1"
              className="w-20 rounded-lg border border-[var(--surface-active-border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
              className="h-3 w-3 rounded border-[var(--surface-active-border)]"
            />
            {t("web_image_search.transparent", "Transparent")}
          </label>

          <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={safeSearch}
              onChange={(e) => setSafeSearch(e.target.checked)}
              className="h-3 w-3 rounded border-[var(--surface-active-border)]"
            />
            {t("web_image_search.safe_search", "Safe search")}
          </label>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {results.map((img, idx) => (
            <button
              key={`${img.url}-${idx}`}
              onClick={() => handleSelect(img, idx)}
              className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 ${
                selectedIdx === idx
                  ? "border-(--color-accent) ring-2 ring-(--color-accent)/30"
                  : "border-transparent hover:ring-1 hover:ring-[var(--surface-active-border)]"
              }`}
            >
              <div className="aspect-square bg-[var(--surface-1)]">
                <AsyncImage
                  src={img.thumb || img.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-[var(--color-muted)]" />
                    </div>
                  }
                />
              </div>
              {/* Preview button */}
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewIdx(idx); }}
                className="absolute top-1 right-1 rounded-md bg-black/60 p-1 opacity-0 group-hover:opacity-100 transition"
              >
                <Eye className="h-3 w-3 text-white" />
              </button>
              {/* Dimensions badge */}
              {img.width > 0 && img.height > 0 && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center text-[10px] text-white/80 opacity-0 group-hover:opacity-100">
                  {img.width}x{img.height}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && results.length > 0 && (
        <button
          onClick={handleLoadMore}
          disabled={loading}
          className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-[var(--surface-active-border)] bg-white/5 px-3 py-1.5 text-xs text-[var(--color-text)] transition hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {t("web_image_search.load_more", "Load more")}
        </button>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <ImageIcon className="mb-2 h-8 w-8 text-[var(--color-muted)]" />
          <p className="text-xs text-[var(--color-muted)]">
            {t("web_image_search.hint", "Search for game images using Google or DuckDuckGo")}
          </p>
        </div>
      )}

      {/* Preview modal */}
      {previewIdx !== null && results[previewIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewIdx(null)}
        >
          <div
            className="mx-4 flex max-h-[85vh] w-full max-w-[700px] flex-col rounded-xl bg-[var(--surface-1)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text)]">
                {t("web_image_search.preview", "Preview")}
              </span>
              <button
                onClick={() => setPreviewIdx(null)}
                className="rounded-lg p-1 text-[var(--color-muted)] hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Image */}
            <div className="flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/30">
              <img
                src={results[previewIdx].url}
                alt=""
                className="max-h-[60vh] max-w-full object-contain"
              />
            </div>

            {/* Info */}
            <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-muted)]">
              <span>
                {results[previewIdx].width > 0 && results[previewIdx].height > 0
                  ? `${results[previewIdx].width}x${results[previewIdx].height}`
                  : "—"}
              </span>
              <span className="rounded-md bg-white/10 px-2 py-0.5">
                {detectFormat(results[previewIdx].width, results[previewIdx].height)}
              </span>
            </div>

            {/* Actions */}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setPreviewIdx(null)}
                className="rounded-lg border border-[var(--surface-active-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-white/5"
              >
                {t("web_image_search.close", "Close")}
              </button>
              <button
                onClick={() => {
                  handleSelect(results[previewIdx], previewIdx);
                  setPreviewIdx(null);
                }}
                className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-(--color-accent-text) hover:opacity-90"
              >
                {t("web_image_search.select", "Select")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
