import { useEffect, useRef, useState } from "react";
import { SkeletonBox } from "./Skeleton";
import { readGameMediaDataUrl } from "../../services/gameCacheService";
import { countRender, isInteractionBusy } from "../../services/perfCounters";

type AsyncImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  skeletonClassName?: string;
  fallback?: React.ReactNode;
  onLoad?: () => void;
  onError?: () => void;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  fallbackLocalPath?: string | null;
};

const failedAssetSrcSet = new Set<string>();
const failedLocalPathSet = new Set<string>();
const successfulDataUrlCache = new Map<string, string>();

// ── Global image load status cache (survives remounts) ──
// Prevents placeholder flash when navigating back to pages with loaded images.
type ImageLoadStatus = {
  status: "loaded" | "failed" | "loading";
  lastUpdated: number;
};
const imageLoadCache = new Map<string, ImageLoadStatus>();
const DEBUG_IMG_CACHE = false;
const IMG_RETRY_FAILED_AFTER_MS = 30_000; // retry failed images after 30s

function imgLog(...args: unknown[]) {
  if (DEBUG_IMG_CACHE) {
    console.log("[IMG]", ...args);
  }
}

function urlHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function isAssetUrl(s: string): boolean {
  return s.startsWith("http://asset.localhost/") || s.startsWith("asset://");
}

function isDataUrl(s: string): boolean {
  return s.startsWith("data:");
}

export default function AsyncImage({
  src, alt, className = "", skeletonClassName,
  fallback, onLoad, onError, loading = "lazy", decoding = "async",
  fallbackLocalPath,
}: AsyncImageProps) {
  countRender("AsyncImage");
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);
  const dataUrlAttemptedRef = useRef(false);
  const srcRef = useRef(src);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const fallbackLocalPathRef = useRef(fallbackLocalPath);

  onLoadRef.current = onLoad;
  onErrorRef.current = onError;
  srcRef.current = src;
  fallbackLocalPathRef.current = fallbackLocalPath;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setDisplaySrc(null);
    dataUrlAttemptedRef.current = false;

    if (!src) return;

    // Check global imageLoadCache — if already loaded, render immediately
    const cachedStatus = imageLoadCache.get(src);
    if (cachedStatus) {
      if (cachedStatus.status === "loaded") {
        setDisplaySrc(src);
        setLoaded(true);
        imgLog("CACHE_HIT", `urlHash=${urlHash(src)} status=loaded`);
        return;
      }
      if (cachedStatus.status === "failed") {
        imgLog("CACHE_HIT", `urlHash=${urlHash(src)} status=failed`);
        // Retry failed images after cooldown
        if (Date.now() - cachedStatus.lastUpdated < IMG_RETRY_FAILED_AFTER_MS) {
          // Still in cooldown — fall through to fallback
        } else {
          // Expired cooldown — retry
          imageLoadCache.delete(src);
        }
      } else if (cachedStatus.status === "loading") {
        // Already loading, don't re-set
        imgLog("CACHE_HIT", `urlHash=${urlHash(src)} status=loading`);

      }
    }
    if (!imageLoadCache.has(src)) {
      imageLoadCache.set(src, { status: "loading", lastUpdated: Date.now() });
    }

    if (fallbackLocalPath && !fallbackLocalPath.endsWith(".tmp")) {
      const cached = successfulDataUrlCache.get(fallbackLocalPath);
      if (cached) {
        setDisplaySrc(cached);
        return;
      }
      if (isAssetUrl(src) && failedAssetSrcSet.has(src)) {
        triggerDataUrlFallback(src, fallbackLocalPath);
        return;
      }
    }

    setDisplaySrc(src);
  }, [src, fallbackLocalPath]);

  function triggerDataUrlFallback(originalSrc: string, localPath: string) {
    if (dataUrlAttemptedRef.current) return;

    // Never attempt data URL fallback for missing local paths
    if (!localPath) {
      console.warn("[AsyncImage] no fallbackLocalPath provided — showing placeholder", {
        src: originalSrc.slice(0, 80),
      });
      setFailed(true);
      onErrorRef.current?.();
      return;
    }

    // Skip already-failed paths
    if (failedLocalPathSet.has(localPath)) {
      setFailed(true);
      onErrorRef.current?.();
      return;
    }

    dataUrlAttemptedRef.current = true;

    readGameMediaDataUrl(localPath)
      .then((dataUrl) => {
        if (!mountedRef.current) return;
        if (!dataUrl || !dataUrl.startsWith("data:")) {
          setFailed(true);
          onErrorRef.current?.();
          return;
        }
        successfulDataUrlCache.set(localPath, dataUrl);
        setFailed(false);
        setDisplaySrc(dataUrl);
      })
      .catch((err) => {
        const errStr = String(err);
        if (errStr.includes("os error 2") || errStr.includes("Invalid path") || errStr.includes("file not found") || errStr.includes("No such file")) {
          failedLocalPathSet.add(localPath);
        }
        if (mountedRef.current) {
          setFailed(true);
          onErrorRef.current?.();
        }
      });
  }

  function handleLoad() {
    if (!mountedRef.current) return;
    setLoaded(true);
    if (srcRef.current) {
      imageLoadCache.set(srcRef.current, { status: "loaded", lastUpdated: Date.now() });
      imgLog("LOAD_DONE", `urlHash=${urlHash(srcRef.current)}`);
    }
    // Disabled by default. Set window.__DEBUG_ASYNC_IMAGE = true in dev console to enable.
    if ((window as any).__DEBUG_ASYNC_IMAGE) {
      console.log(`[MEDIA][ASYNC_IMAGE] status=loaded displaySrcPrefix=${displaySrc ? displaySrc.slice(0, 60) : "null"}`);
    }
    onLoadRef.current?.();
  }

  function handleError(event: React.SyntheticEvent<HTMLImageElement, Event>) {
    if (!mountedRef.current) return;
    if (srcRef.current) {
      imageLoadCache.set(srcRef.current, { status: "failed", lastUpdated: Date.now() });
      imgLog("LOAD_FAIL", `urlHash=${urlHash(srcRef.current)}`);
    }
    // Only log terminal errors (no parent fallback handler) to reduce noise.
    // When onError is set (e.g. PackageCard fallback chain), the parent handles
    // retrying with alternate URLs — errors during fallback are expected.
    const isTerminal = !onErrorRef.current;
    if (isTerminal || fallbackLocalPathRef.current) {
      console.log(`[MEDIA][ASYNC_IMAGE_ERROR] displaySrcPrefix=${displaySrc ? displaySrc.slice(0, 60) : "null"} dataUrlAttempted=${dataUrlAttemptedRef.current} hasFallbackPath=${!!fallbackLocalPathRef.current} terminal=${isTerminal} event=${event.type}`);
    }
    // Phase 8: Skip data URL fallback during active interaction (scroll/click)
    if (isInteractionBusy()) {
      setFailed(true);
      onErrorRef.current?.();
      return;
    }

    if (
      !dataUrlAttemptedRef.current &&
      fallbackLocalPathRef.current &&
      !fallbackLocalPathRef.current.endsWith(".tmp") &&
      srcRef.current
    ) {
      failedAssetSrcSet.add(srcRef.current);
      triggerDataUrlFallback(srcRef.current, fallbackLocalPathRef.current);
    } else {
      if (dataUrlAttemptedRef.current) {
        const msg = fallbackLocalPathRef.current
          ? "[AsyncImage] data URL fallback failed to render"
          : "[AsyncImage] no fallbackLocalPath — showing placeholder";
        console.warn(msg, {
          fallbackLocalPath: fallbackLocalPathRef.current,
        });
      }
      setFailed(true);
      onErrorRef.current?.();
    }
  }

  const imgKey = displaySrc && isDataUrl(displaySrc)
    ? `data-${fallbackLocalPath || "unknown"}`
    : `src-${displaySrc || "none"}`;

  if (!displaySrc || failed) {
    return (
      <div className={`flex items-center justify-center bg-white/5 ${className}`}>
        {fallback ?? <span className="text-[10px] text-(--color-muted)">--</span>}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {!loaded && (
        <SkeletonBox className={`absolute inset-0 ${skeletonClassName ?? ""}`} />
      )}
      <img
        key={imgKey}
        src={displaySrc}
        alt={alt}
        className={`h-full w-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        loading={loading}
        decoding={decoding}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
}
