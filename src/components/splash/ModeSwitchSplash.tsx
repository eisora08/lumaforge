import { useEffect, useRef, useState } from "react";

export type ModeSwitchMode = "enter-console" | "exit-console";

type Props = {
  mode: ModeSwitchMode;
  visible: boolean;
  onComplete?: () => void;
};

const ENTER_MS = 280;
const HOLD_MS = 420;
const EXIT_MS = 280;

function hasReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function ModeSwitchSplash({ mode, visible, onComplete }: Props) {
  const [phase, setPhase] = useState<"entering" | "visible" | "exiting" | "hidden">("hidden");
  const completeCalledRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setPhase("hidden");
      return;
    }

    const reduced = hasReducedMotion();
    completeCalledRef.current = false;

    // Enter
    const enterTimer = setTimeout(() => {
      setPhase("entering");
      // Force next frame for CSS transition to kick in
      requestAnimationFrame(() => {
        setPhase("visible");
      });
    }, reduced ? 0 : 10);

    // Hold → begin exit
    const holdTimer = setTimeout(() => {
      setPhase("exiting");
    }, reduced ? 10 : ENTER_MS + HOLD_MS);

    // Exit → done
    const exitTimer = setTimeout(() => {
      setPhase("hidden");
      if (!completeCalledRef.current) {
        completeCalledRef.current = true;
        onComplete?.();
      }
    }, reduced ? 10 : ENTER_MS + HOLD_MS + EXIT_MS);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(holdTimer);
      clearTimeout(exitTimer);
    };
  }, [visible, onComplete]);

  // Safety: never stay stuck more than 2s
  useEffect(() => {
    if (!visible) return;
    const safety = setTimeout(() => {
      if (!completeCalledRef.current) {
        completeCalledRef.current = true;
        setPhase("hidden");
        onComplete?.();
      }
    }, 2000);
    return () => clearTimeout(safety);
  }, [visible, onComplete]);

  if (phase === "hidden") return null;

  const isEntering = mode === "enter-console";
  const reduced = hasReducedMotion();

  const isVisible = phase === "entering" || phase === "visible";
  const overlayClass = reduced
    ? "opacity-100"
    : isVisible
      ? "opacity-100"
      : "opacity-0";

  const contentClass = reduced
    ? "scale-100 opacity-100"
    : isVisible
      ? "scale-100 opacity-100"
      : "scale-95 opacity-0";

  const contentTransition = reduced
    ? ""
    : "transition-all duration-[280ms] ease-out";

  const overlayTransition = reduced
    ? ""
    : "transition-opacity duration-[280ms] ease-out";

  return (
    <div
      className={`fixed inset-0 z-[9998] flex select-none flex-col items-center justify-center ${overlayTransition} ${overlayClass}`}
      style={{ backgroundColor: "rgba(11, 11, 20, 0.92)" }}
      role="status"
      aria-live="polite"
      aria-label={isEntering ? "Entering Gaming Mode" : "Returning to Desktop"}
    >
      {/* Scanline grid overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Content */}
      <div className={`relative flex flex-col items-center gap-5 ${contentTransition} ${contentClass}`}>
        {/* Gamepad icon with accent glow */}
        <div className="relative mb-2">
          <div
            className="h-16 w-16 rounded-2xl"
            style={{
              background: "var(--color-accent)",
              boxShadow: "0 0 40px color-mix(in srgb, var(--color-accent) 40%, transparent)",
            }}
          />
          <svg
            className="absolute inset-0 h-16 w-16 p-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="6" x2="10" y1="11" y2="11" />
            <line x1="8" x2="8" y1="9" y2="13" />
            <line x1="15" x2="15.01" y1="13" y2="13" />
            <line x1="18" x2="18.01" y1="11" y2="11" />
            <rect x="2" y="6" width="20" height="12" rx="2" />
          </svg>
        </div>

        {/* Title */}
        <h1
          className="text-center text-3xl font-extrabold tracking-tight drop-shadow-lg"
          style={{ color: "var(--color-text)" }}
        >
          {isEntering ? "Gaming Mode" : "Desktop Mode"}
        </h1>

        {/* Subtitle */}
        <p
          className="text-center text-sm font-medium"
          style={{ color: "var(--color-muted)" }}
        >
          {isEntering ? "Entering fullscreen experience" : "Returning to desktop"}
        </p>

        {/* Small loading bar */}
        <div className="mt-4 h-[3px] w-40 overflow-hidden rounded-full" style={{ backgroundColor: "var(--color-surface)" }}>
          <div
            className={`h-full w-full origin-left rounded-full`}
            style={{
              backgroundColor: "var(--color-accent)",
              animation: phase === "visible" ? "lf-progress-indeterminate 0.8s ease-in-out infinite" : "none",
              transform: phase === "entering" ? "scaleX(0.15)" : phase === "visible" ? "scaleX(1)" : "scaleX(0)",
              transition: "transform 280ms ease-out",
            }}
          />
        </div>
      </div>
    </div>
  );
}
