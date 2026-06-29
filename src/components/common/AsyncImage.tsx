import { useEffect, useRef, useState } from "react";
import { SkeletonBox } from "./Skeleton";
import { readGameMediaDataUrl } from "../../services/gameCacheService";

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
const successfulDataUrlCache = new Map<string, string>();

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

    if (fallbackLocalPath && !fallbackLocalPath.endsWith(".tmp")) {
      const cached = successfulDataUrlCache.get(fallbackLocalPath);
      if (cached) {
        setDisplaySrc(cached);
        return;
      }
      if (isAssetUrl(src) && failedAssetSrcSet.has(src)) {
        failedAssetSrcSet.add(src);
        triggerDataUrlFallback(src, fallbackLocalPath);
        return;
      }
    }

    setDisplaySrc(src);
  }, [src, fallbackLocalPath]);

  useEffect(() => {
    if (displaySrc === null && !dataUrlAttemptedRef.current) {
      if (!src) return;

      if (fallbackLocalPath && !fallbackLocalPath.endsWith(".tmp")) {
        const cached = successfulDataUrlCache.get(fallbackLocalPath);
        if (cached) {
          setDisplaySrc(cached);
          return;
        }
        if (isAssetUrl(src) && failedAssetSrcSet.has(src)) {
          failedAssetSrcSet.add(src);
          triggerDataUrlFallback(src, fallbackLocalPath);
          return;
        }
      }

      setDisplaySrc(src);
    }
  }, []);

  function triggerDataUrlFallback(originalSrc: string, localPath: string) {
    if (dataUrlAttemptedRef.current) return;
    dataUrlAttemptedRef.current = true;

    console.warn("[AsyncImage] asset failed, trying data URL fallback", {
      src: originalSrc.slice(0, 80),
      fallbackLocalPath: localPath,
    });

    readGameMediaDataUrl(localPath)
      .then((dataUrl) => {
        if (!mountedRef.current) return;
        if (!dataUrl || !dataUrl.startsWith("data:")) {
          console.warn("[AsyncImage] data URL fallback returned invalid data", {
            fallbackLocalPath: localPath,
            prefix: dataUrl?.slice(0, 40),
          });
          setFailed(true);
          onErrorRef.current?.();
          return;
        }
        successfulDataUrlCache.set(localPath, dataUrl);
        console.debug("[AsyncImage] data URL fallback loaded", {
          fallbackLocalPath: localPath,
          byteLengthApprox: dataUrl.length,
        });
        setFailed(false);
        setDisplaySrc(dataUrl);
      })
      .catch((err) => {
        console.warn("[AsyncImage] data URL fallback failed", {
          fallbackLocalPath: localPath,
          error: String(err),
        });
        if (mountedRef.current) {
          setFailed(true);
          onErrorRef.current?.();
        }
      });
  }

  function handleLoad() {
    if (!mountedRef.current) return;
    setLoaded(true);
    const cur = displaySrc;
    console.debug("[AsyncImage] image loaded", {
      currentSrcPrefix: cur ? cur.slice(0, 40) : null,
    });
    onLoadRef.current?.();
  }

  function handleError() {
    if (!mountedRef.current) return;
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
        console.warn("[AsyncImage] data URL fallback failed to render", {
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
