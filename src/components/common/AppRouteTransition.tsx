import { useEffect, useRef, useState, type ReactNode } from "react";

type AppRouteTransitionProps = {
  routeKey: string;
  children: ReactNode;
  className?: string;
};

const DEBUG_VISIBLE = false;

export default function AppRouteTransition({ routeKey, children, className = "" }: AppRouteTransitionProps) {
  // Start visible so the first render shows content immediately — not opacity-0.
  const [phase, setPhase] = useState<"enter" | "visible">("visible");
  const prevKey = useRef(routeKey);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      // Initial mount: stay visible, no enter animation.
      mountedRef.current = true;
      return;
    }
    if (prevKey.current !== routeKey) {
      // Route changed: play enter animation (fade-in).
      prevKey.current = routeKey;
      setPhase("enter");
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("visible");
        });
      });
      return () => cancelAnimationFrame(frame);
    }
    // routeKey unchanged: stay visible.
    setPhase("visible");
  }, [routeKey]);

  // Safety guard: if children is null/undefined, render a visible fallback
  // so lf-route-visible is never empty.
  if (children == null) {
    if (DEBUG_VISIBLE) {
      console.warn(`[ROUTE][EMPTY_GUARD] routeKey=${routeKey} children is null/undefined`);
    }
    return (
      <div className={className + " lf-route-visible"}>
        <div className="flex min-h-[200px] items-center justify-center text-sm text-(--color-muted)">
          Page failed to render
        </div>
      </div>
    );
  }

  return (
    <div className={`${className} ${phase === "enter" ? "lf-route-enter" : "lf-route-visible"}`}>
      {children}
    </div>
  );
}
