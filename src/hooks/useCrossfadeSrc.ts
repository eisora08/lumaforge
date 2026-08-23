import { useEffect, useRef, useState } from "react";

export const CROSSFADE_HOLD_MS = 650;

// Two-layer crossfade state for single-image surfaces. When `src` changes, the
// previous source stays mounted (fade-out) while the new source mounts (fade-in).
// Returns `null` when there is no previous layer to keep.
export function useCrossfadeSrc(
  src: string | null | undefined,
  holdMs: number = CROSSFADE_HOLD_MS,
): { prevSrc: string | null; currentSrc: string | null } {
  const [prevSrc, setPrevSrc] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);

  const resolved = src ?? null;

  useEffect(() => {
    if (resolved === currentRef.current) {
      return;
    }
    if (currentRef.current !== null) {
      setPrevSrc(currentRef.current);
    }
    currentRef.current = resolved;
    if (resolved === null) {
      setPrevSrc(null);
      return;
    }
    const t = window.setTimeout(() => setPrevSrc(null), holdMs);
    return () => window.clearTimeout(t);
  }, [resolved, holdMs]);

  return { prevSrc, currentSrc: resolved };
}
