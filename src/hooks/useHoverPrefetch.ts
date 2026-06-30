import { useEffect, useRef, useCallback } from "react";
import { requestGameData, LoadPriority } from "../services/gameDataService";

export function useHoverPrefetch(appId: string | undefined) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prefetchedRef = useRef(false);

  const onMouseEnter = useCallback(() => {
    if (!appId || prefetchedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      prefetchedRef.current = true;
      requestGameData(appId, LoadPriority.VIEWPORT);
    }, 100);
  }, [appId]);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { onMouseEnter, onMouseLeave };
}
