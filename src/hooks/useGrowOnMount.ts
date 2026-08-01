import { useEffect, useState } from "react";

/**
 * Returns `false` on the first render, then `true` after the next animation
 * frame. Pairs with an existing CSS transition on the target element to grow a
 * bar/fill from 0 to its current value when it mounts (page-entry animation).
 * Under `prefers-reduced-motion` it resolves to `true` immediately so the bar
 * renders at its final value with no empty-bar flash.
 */
export function useGrowOnMount(): boolean {
  const [grow, setGrow] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setGrow(true);
      return;
    }
    const raf = requestAnimationFrame(() => setGrow(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return grow;
}
