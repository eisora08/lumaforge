import { createContext, useContext, useState, useCallback, useMemo, useTransition } from "react";
import type { ReactNode } from "react";

const ENABLE_VERBOSE_TRANSITION_LOGS = false;
const NAV_PERF_ENABLED = true;

type RouteTransitionState = {
  isPending: boolean;
  navigatingTo: string | null;
  startRouteTransition: (route: string, fn: () => void) => void;
};

const RouteTransitionContext = createContext<RouteTransitionState | null>(null);

export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const startRouteTransition = useCallback((route: string, fn: () => void) => {
    const startTime = NAV_PERF_ENABLED ? performance.now() : 0;

    setNavigatingTo(route);

    startTransition(() => {
      fn();
      if (NAV_PERF_ENABLED) {
        const elapsed = Math.round(performance.now() - startTime);
        if (ENABLE_VERBOSE_TRANSITION_LOGS) {
          console.log(`[NavPerf] ${route} route update: ${elapsed}ms`);
        }
      }
      setNavigatingTo(null);
    });
  }, []);

  const ctxValue = useMemo(() => ({ isPending, navigatingTo, startRouteTransition }), [isPending, navigatingTo]);

  return (
    <RouteTransitionContext.Provider value={ctxValue}>
      {children}
    </RouteTransitionContext.Provider>
  );
}

export function useRouteTransition(): RouteTransitionState {
  const ctx = useContext(RouteTransitionContext);
  if (!ctx) {
    throw new Error("useRouteTransition must be used within RouteTransitionProvider");
  }
  return ctx;
}
