import { useEffect, useRef, useState, type ReactNode } from "react";

type AppRouteTransitionProps = {
  routeKey: string;
  children: ReactNode;
  className?: string;
};

export default function AppRouteTransition({ routeKey, children, className = "" }: AppRouteTransitionProps) {
  const [phase, setPhase] = useState<"enter" | "visible">("enter");
  const prevKey = useRef(routeKey);

  useEffect(() => {
    if (prevKey.current !== routeKey) {
      prevKey.current = routeKey;
      setPhase("enter");
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("visible");
        });
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setPhase("visible");
    }
  }, [routeKey]);

  return (
    <div className={`${className} ${phase === "enter" ? "lf-route-enter" : "lf-route-visible"}`}>
      {children}
    </div>
  );
}
