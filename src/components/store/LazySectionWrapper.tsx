import { ReactNode, useEffect, useRef, useState } from "react";

type LazySectionWrapperProps = {
  children: ReactNode;
  /** Unique identifier for the section — used as IntersectionObserver target */
  sectionId: string;
  /** Number of skeleton cards to show while loading (default 5) */
  skeletonCount?: number;
  /** If true, mount immediately without lazy loading (for above-the-fold sections) */
  immediate?: boolean;
};

function SkeletonSection({ skeletonCount = 5 }: { skeletonCount?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="mb-4 h-5 w-48 rounded bg-white/10" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div
            key={i}
            className="h-32 w-56 shrink-0 rounded-lg bg-white/8"
          />
        ))}
      </div>
    </div>
  );
}

export default function LazySectionWrapper({
  children,
  sectionId,
  skeletonCount = 5,
  immediate = false,
}: LazySectionWrapperProps) {
  const [isVisible, setIsVisible] = useState(immediate);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (immediate) {
      setIsVisible(true);
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "200px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [immediate, sectionId]);

  return (
    <div ref={sentinelRef}>
      {isVisible ? children : <SkeletonSection skeletonCount={skeletonCount} />}
    </div>
  );
}
