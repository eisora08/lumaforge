import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Link,
  Check,
  Image as ImageIcon,
  LoaderCircle,
  AlertCircle,
  Search as SearchIcon,
  ChevronDown,
  ExternalLink,
  Globe,
} from "lucide-react";
import { searchImages, ImageSearchProvider, ImageSearchResult } from "../../services/imageSearchService";
import { invoke } from "@tauri-apps/api/core";
import { showError, showSuccess } from "../toast/GameToast";
import { notifyMediaUpdated } from "../../services/startupSnapshotService";
import { invalidateResolvedMediaCache } from "../../services/gameCacheService";
import { getGameAppInfo, updateGameAppinfoMedia } from "../../services/tauri";
import type { GameMediaPaths } from "../../services/tauri";
import { openExternalUrl } from "../../services/externalLinks";
import { downloadProviderMediaFromUrl } from "../../services/tauri";
import { updateManualGame } from "../../services/manualGameStore";

type MediaRole = "cover" | "landscape" | "background" | "logo" | "icon";

const DEBUG_MEDIA_EDIT = false;

type Props = {
  open: boolean;
  onClose: () => void;
  appId?: string;
  libraryId?: string;
  gameTitle: string;
  role: MediaRole;
  settings?: {
    googleSearchApiKey?: string;
    googleSearchCx?: string;
    bingSearchApiKey?: string;
  };
};

type SearchMode = "browser" | "api";

const ROLE_SEARCH_QUERIES: Record<MediaRole, string> = {
  cover: "cover art",
  landscape: "banner",
  background: "wallpaper hd",
  logo: "logo png transparent",
  icon: "icon square",
};

const BROWSER_SOURCES = [
  { id: "google" as const, label: "Google Images", url: (q: string) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}` },
  { id: "bing" as const, label: "Bing Images", url: (q: string) => `https://www.bing.com/images/search?q=${encodeURIComponent(q)}` },
];

const API_PROVIDERS = [
  { id: "google" as ImageSearchProvider, label: "Google Custom Search" },
  { id: "bing" as ImageSearchProvider, label: "Bing Image Search" },
];

const DEFAULT_PAGE_SIZE = 20;

export default function GameImageSearchDialog({
  open,
  onClose,
  appId,
  libraryId,
  gameTitle,
  role,
  settings,
}: Props) {
  const hasGoogleApi = !!(settings?.googleSearchApiKey && settings?.googleSearchCx);
  const hasBingApi = !!settings?.bingSearchApiKey;
  const hasAnyApi = hasGoogleApi || hasBingApi;

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("browser");

  // API search state
  const [apiProvider, setApiProvider] = useState<ImageSearchProvider>("google");
  const [results, setResults] = useState<ImageSearchResult[]>([]);
  const [totalEstimate, setTotalEstimate] = useState(0);
  const [nextStartIndex, setNextStartIndex] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [safeSearch, setSafeSearch] = useState(true);
  const [imageSize, setImageSize] = useState<"large" | "medium" | "icon" | null>(null);
  const [imageType, setImageType] = useState<"photo" | "clipart" | "transparent" | null>(null);

  // Paste URL state (shared across modes)
  const [pasteUrl, setPasteUrl] = useState("");
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [pastePreviewError, setPastePreviewError] = useState(false);
  const [applying, setApplying] = useState(false);

  const pasteRef = useRef<HTMLInputElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    const suffix = ROLE_SEARCH_QUERIES[role] ?? "cover";
    setQuery(`${gameTitle || appId} ${suffix}`);
    setResults([]);
    setTotalEstimate(0);
    setNextStartIndex(undefined);
    setSelectedUrl(null);
    setApiError(null);
    setPasteUrl("");
    setPastePreview(null);
    setPastePreviewError(false);

    if (hasAnyApi) {
      setMode("api");
      setApiProvider(hasGoogleApi ? "google" : "bing");
    } else {
      setMode("browser");
    }
  }, [open, gameTitle, appId, role, hasAnyApi, hasGoogleApi]);

  // Auto-preview paste URL
  useEffect(() => {
    const url = pasteUrl.trim();
    if (!url) { setPastePreview(null); setPastePreviewError(false); return; }
    if (!url.startsWith("http://") && !url.startsWith("https://")) { setPastePreview(null); return; }
    setPastePreviewError(false);
    setPastePreview(url);
  }, [pasteUrl]);

  // ── API search ──

  const fetchResults = useCallback(async (append: boolean) => {
    if (!query.trim() || !hasAnyApi) return;
    const startIdx = append ? (nextStartIndex ?? 1) : 1;
    const setLoader = append ? setLoadingMore : setLoading;
    setLoader(true);
    setApiError(null);
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      const resp = await searchImages({
        query: query.trim(),
        provider: apiProvider,
        credentials: {
          googleApiKey: settings?.googleSearchApiKey,
          googleCx: settings?.googleSearchCx,
          bingApiKey: settings?.bingSearchApiKey,
        },
        startIndex: startIdx,
        pageSize: DEFAULT_PAGE_SIZE,
        safeSearch,
        imageSize,
        imageType: imageType ?? undefined,
      });
      if (controller.signal.aborted) return;
      if (append) {
        setResults((prev) => [...prev, ...resp.results]);
      } else {
        setResults(resp.results);
      }
      setTotalEstimate(resp.totalEstimate);
      setNextStartIndex(resp.nextStartIndex);
    } catch (err) {
      if (controller.signal.aborted) return;
      setApiError(err instanceof Error ? err.message : "Search failed");
      if (!append) setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoader(false);
    }
  }, [query, apiProvider, settings, nextStartIndex, safeSearch, imageSize, imageType, hasAnyApi]);

  const handleSearch = useCallback(() => {
    setNextStartIndex(undefined);
    fetchResults(false);
  }, [fetchResults]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && mode === "api") handleSearch();
  }, [handleSearch, mode]);

  // ── Download & apply (shared for both modes) ──

  const applyUrl = useCallback(async (url: string, source: string) => {
    if (!url.startsWith("http://") && !url.startsWith("https://")) return;
    const isEpic = !!libraryId && libraryId.startsWith("epic:");
    const isManual = !!libraryId && !appId && !isEpic;
    console.log(`[WEB_IMAGE_SEARCH][APPLY_URL_START] role=${role} source=${source} manual=${isManual} epic=${isEpic}`);
    setApplying(true);
    try {
      if (isEpic && libraryId) {
        // ── Epic game — use provider media adapter ──
        const providerGameId = libraryId.replace(/^epic:/, "");
        const relativePath = await downloadProviderMediaFromUrl("epic", providerGameId, role, url);
        if (relativePath) {
          console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_SUCCESS] role=${role} path=${relativePath} epic=${providerGameId}`);
          // Update epic overrides store with the new media path
          const { writeEpicOverrides } = await import("../../services/epicOverrideStore");
          const mediaKey = `${role}Path` as keyof import("../../services/tauri").GameMediaPaths;
          writeEpicOverrides(providerGameId, { [mediaKey]: relativePath });
          showSuccess(`${role} downloaded`);
          onClose();
        } else {
          console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_FAIL] role=${role} error=null-result epic=${providerGameId}`);
          showError(`Failed to download ${role}`);
        }
      } else if (isManual && libraryId) {
        // ── Manual game — use provider media adapter ──
        const relativePath = await downloadProviderMediaFromUrl("manual", libraryId, role, url);
        if (relativePath) {
          console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_SUCCESS] role=${role} path=${relativePath} manual=${libraryId}`);
          const mediaKey = `${role}Path` as keyof GameMediaPaths;
          const patch = { [mediaKey]: relativePath };
          updateManualGame(libraryId, patch);
          showSuccess(`${role} downloaded`);
          onClose();
        } else {
          console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_FAIL] role=${role} error=null-result manual=${libraryId}`);
          showError(`Failed to download ${role}`);
        }
      } else if (appId) {
        // ── Steam game — existing flow ──
        const result = await invoke<string | null>("safe_download_image", {
          url,
          appId: Number(appId),
          mediaType: role,
        });
        if (result) {
          console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_SUCCESS] role=${role} path=${result}`);
          invalidateResolvedMediaCache(appId);
          try {
            const currentInfo = await getGameAppInfo(appId);
            const mediaKey = `${role}Path` as keyof GameMediaPaths;
            const mergedMedia: GameMediaPaths = {
              coverPath: currentInfo?.media?.coverPath ?? null,
              landscapePath: currentInfo?.media?.landscapePath ?? null,
              backgroundPath: currentInfo?.media?.backgroundPath ?? null,
              logoPath: currentInfo?.media?.logoPath ?? null,
              iconPath: currentInfo?.media?.iconPath ?? null,
              [mediaKey]: result,
            };
            await updateGameAppinfoMedia(appId, currentInfo?.name ?? null, mergedMedia, currentInfo?.remote ?? null, currentInfo?.mediaSources ?? null);
          } catch (e) {
            if (DEBUG_MEDIA_EDIT) console.log(`[WEB_IMAGE_SEARCH][APPINFO_WRITE_FAIL] error=${e}`);
          }
          notifyMediaUpdated(appId, { source: `image-search-${source}` });
          showSuccess(`${role} downloaded`);
          onClose();
        } else {
          console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_FAIL] role=${role} error=null-result`);
          showError(`Failed to download ${role}`);
        }
      } else {
        showError("No game identifier available");
      }
    } catch (err) {
      console.log(`[WEB_IMAGE_SEARCH][DOWNLOAD_FAIL] role=${role} error=${err instanceof Error ? err.message : String(err)}`);
      showError(`Failed to download ${role}`);
    } finally {
      setApplying(false);
    }
  }, [appId, libraryId, role, onClose]);

  const handleSelect = useCallback(() => {
    if (!selectedUrl) return;
    applyUrl(selectedUrl, "api");
  }, [selectedUrl, applyUrl]);

  const handlePasteApply = useCallback(() => {
    applyUrl(pasteUrl.trim(), "paste");
  }, [pasteUrl, applyUrl]);

  // ── Browser open ──

  const handleBrowserOpen = useCallback((sourceId: "google" | "bing") => {
    const source = BROWSER_SOURCES.find((s) => s.id === sourceId);
    if (!source) return;
    const searchUrl = source.url(query.trim() || `${gameTitle || appId} ${ROLE_SEARCH_QUERIES[role] ?? "cover"}`);
    console.log(`[WEB_IMAGE_SEARCH][OPEN_EXTERNAL] provider=${sourceId} url=${searchUrl}`);
    openExternalUrl(searchUrl);
  }, [query, gameTitle, appId, role]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => { searchAbortRef.current?.abort(); };
  }, []);

  if (!open) return null;

  const canApplyPaste = pasteUrl.trim().startsWith("http");

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Web Image Search"
    >
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-[720px] flex-col rounded-2xl border border-(--color-border) lf-surface shadow-2xl">
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) px-5 py-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-(--color-accent)" />
            <h2 className="text-sm font-semibold text-(--color-text)">
              Web Image Search
            </h2>
            <span className="rounded-full bg-(--color-accent)/10 px-2 py-0.5 text-[10px] font-medium text-(--color-accent) capitalize">
              {role}
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-(--color-muted)">
              {gameTitle}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── Mode toggle (only when API keys available) ── */}
        {hasAnyApi && (
          <div className="flex shrink-0 border-b border-(--color-border)">
            <button
              type="button"
              onClick={() => setMode("api")}
              className={`flex-1 cursor-pointer py-2.5 text-xs font-medium transition ${
                mode === "api"
                  ? "border-b-2 border-(--color-accent) text-(--color-text)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              <SearchIcon className="mr-1.5 inline h-3.5 w-3.5" />
              Search Results
            </button>
            <button
              type="button"
              onClick={() => setMode("browser")}
              className={`flex-1 cursor-pointer py-2.5 text-xs font-medium transition ${
                mode === "browser"
                  ? "border-b-2 border-(--color-accent) text-(--color-text)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              <Globe className="mr-1.5 inline h-3.5 w-3.5" />
              Open in Browser
            </button>
          </div>
        )}

        {/* ── Query row (always visible) ── */}
        <div className="shrink-0 space-y-3 px-5 pt-4 pb-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)/50" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search for images..."
                className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 pl-8 pr-3 py-2 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted)/40 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
              />
            </div>
            {mode === "api" && (
              <button
                type="button"
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-4 py-2 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SearchIcon className="h-3.5 w-3.5" />
                )}
                Search
              </button>
            )}
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {mode === "api" && hasAnyApi ? (
            /* ══════ API MODE: inline result grid ══════ */
            <div className="space-y-3">
              {/* Provider + filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <select
                    value={apiProvider}
                    onChange={(e) => { setApiProvider(e.target.value as ImageSearchProvider); setResults([]); }}
                    className="appearance-none rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 pr-7 text-xs text-(--color-text) outline-none focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                  >
                    {API_PROVIDERS.filter((p) =>
                      p.id === "google" ? hasGoogleApi : hasBingApi
                    ).map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) px-3 py-1.5 text-xs text-(--color-muted) hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={safeSearch}
                    onChange={(e) => setSafeSearch(e.target.checked)}
                    className="h-3 w-3 accent-(--color-accent)"
                  />
                  SafeSearch
                </label>
                <div className="relative">
                  <select
                    value={imageSize ?? ""}
                    onChange={(e) => setImageSize(e.target.value as typeof imageSize)}
                    className="appearance-none rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 pr-7 text-xs text-(--color-muted) outline-none focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                  >
                    <option value="">Any size</option>
                    <option value="large">Large</option>
                    <option value="medium">Medium</option>
                    <option value="icon">Icon</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
                </div>
                <div className="relative">
                  <select
                    value={imageType ?? ""}
                    onChange={(e) => setImageType(e.target.value as typeof imageType)}
                    className="appearance-none rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 pr-7 text-xs text-(--color-muted) outline-none focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                  >
                    <option value="">Any type</option>
                    <option value="photo">Photo</option>
                    <option value="clipart">Clipart</option>
                    <option value="transparent">Transparent</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
                </div>
              </div>

              {/* Results */}
              {apiError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span className="text-xs text-rose-300">{apiError}</span>
                </div>
              )}
              {loading && results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16">
                  <LoaderCircle className="mb-3 h-8 w-8 animate-spin text-(--color-accent)" />
                  <p className="text-xs text-(--color-muted)">Searching...</p>
                </div>
              )}
              {!loading && !apiError && query && results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16">
                  <ImageIcon className="mb-3 h-10 w-10 text-(--color-muted)/30" />
                  <p className="text-sm font-medium text-(--color-muted)/60">No results</p>
                  <p className="mt-1 text-xs text-(--color-muted)/40">Try a different query or adjust filters</p>
                </div>
              )}
              {results.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-(--color-muted)/60">
                      ~{totalEstimate.toLocaleString()} results
                    </p>
                    {selectedUrl && <p className="text-[10px] text-(--color-accent)">1 selected</p>}
                  </div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                    {results.map((img, i) => (
                      <button
                        key={`${img.sourceUrl}-${i}`}
                        type="button"
                        onClick={() => setSelectedUrl(selectedUrl === img.sourceUrl ? null : img.sourceUrl)}
                        className={`group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-lg border-2 bg-black/30 transition ${
                          selectedUrl === img.sourceUrl
                            ? "border-(--color-accent) ring-2 ring-(--color-accent)/40"
                            : "border-transparent hover:border-(--color-accent)/40"
                        }`}
                      >
                        <img
                          src={img.thumbnailUrl}
                          alt={img.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).src = img.sourceUrl; }}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-4">
                          <p className="truncate text-[10px] text-white/80">{img.title}</p>
                          <p className="text-[9px] text-white/50">{img.width}x{img.height}</p>
                        </div>
                        {selectedUrl === img.sourceUrl && (
                          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-(--color-accent)">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  {nextStartIndex && (
                    <div className="flex justify-center pt-2 pb-1">
                      <button
                        type="button"
                        onClick={() => fetchResults(true)}
                        disabled={loadingMore}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-(--surface-active-border) bg-white/5 px-5 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
                      >
                        {loadingMore ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {loadingMore ? "Loading..." : "Load More"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* ══════ BROWSER MODE: open in browser + paste URL ══════ */
            <div className="space-y-4">
                {/* Browser buttons */}
              <div className="grid grid-cols-2 gap-3">
                {BROWSER_SOURCES.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => handleBrowserOpen(source.id)}
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-5 transition hover:bg-white/5 hover:border-(--color-accent)/40 active:bg-white/10"
                  >
                    <Globe className="h-8 w-8 text-(--color-accent)/60" />
                    <span className="text-sm font-medium text-(--color-text)">{source.label}</span>
                    <span className="text-[10px] text-(--color-muted)/50">New browser tab</span>
                    <ExternalLink className="mt-1 h-3.5 w-3.5 text-(--color-muted)/40" />
                  </button>
                ))}
              </div>

              <p className="text-center text-[11px] leading-relaxed text-(--color-muted)/60">
                Open image search in your browser. Find an image, copy its URL, paste it below, then click <strong className="text-(--color-muted)/80">Apply URL</strong>.
              </p>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-(--color-border)" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
                  <span className="bg-(--color-bg) px-2 text-(--color-muted)/50">Or paste an image URL</span>
                </div>
              </div>

              {/* Paste URL input + preview */}
              <div className="space-y-3">
                <div className="relative">
                  <Link className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-muted)/40" />
                  <input
                    ref={pasteRef}
                    type="text"
                    value={pasteUrl}
                    onChange={(e) => setPasteUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 pl-8 pr-3 py-2 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted)/40 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    onKeyDown={(e) => { if (e.key === "Enter" && canApplyPaste) handlePasteApply(); }}
                  />
                </div>

                {pastePreview && !pastePreviewError && (
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
                    <label className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">Preview</label>
                    <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-black/20">
                      <img
                        src={pastePreview}
                        alt="Preview"
                        className="max-h-[220px] max-w-full object-contain"
                        onError={() => setPastePreviewError(true)}
                      />
                    </div>
                  </div>
                )}
                {pastePreview && pastePreviewError && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span className="text-xs text-amber-300">Could not load preview. The URL may not point to a valid image.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--color-border) px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-(--surface-active-border) bg-white/5 px-4 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            Cancel
          </button>

          {mode === "api" ? (
            <button
              type="button"
              onClick={handleSelect}
              disabled={!selectedUrl || applying}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-4 py-2 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {applying ? "Downloading..." : "Select & Download"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePasteApply}
              disabled={!canApplyPaste || applying}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-4 py-2 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {applying ? "Downloading..." : "Apply URL"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
