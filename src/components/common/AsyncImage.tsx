import { useEffect, useRef, useState } from "react";
import { SkeletonBox } from "./Skeleton";

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
};

export default function AsyncImage({
  src,
  alt,
  className = "",
  skeletonClassName,
  fallback,
  onLoad,
  onError,
  loading = "lazy",
  decoding = "async",
}: AsyncImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const prevSrc = useRef(src);

  useEffect(() => {
    if (prevSrc.current !== src) {
      setLoaded(false);
      setFailed(false);
      prevSrc.current = src;
    }
  }, [src]);

  function handleLoad() {
    setLoaded(true);
    onLoad?.();
  }

  function handleError() {
    setFailed(true);
    onError?.();
  }

  if (!src || failed) {
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
        src={src}
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
