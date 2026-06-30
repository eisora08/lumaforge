import { useEffect, useRef, useState } from "react";

type UseInViewportOptions = {
  rootMargin?: string;
  threshold?: number;
};

const DEFAULT_ROOT_MARGIN = "150px 0px";
const DEFAULT_THRESHOLD = 0.1;

export function useInViewport(options?: UseInViewportOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (observerRef.current) {
            observerRef.current.unobserve(el);
          }
        }
      },
      {
        root: null,
        rootMargin: options?.rootMargin ?? DEFAULT_ROOT_MARGIN,
        threshold: options?.threshold ?? DEFAULT_THRESHOLD,
      }
    );

    observerRef.current.observe(el);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return { ref, isVisible };
}
