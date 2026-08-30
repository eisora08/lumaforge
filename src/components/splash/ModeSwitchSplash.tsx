import { useEffect, useMemo, useRef, useState } from "react";
import { playEntrySound, playExitSound } from "../../services/soundEffectsService";

export type ModeSwitchMode = "enter-console" | "exit-console";

type Props = {
  mode: ModeSwitchMode;
  visible: boolean;
  onComplete?: () => void;
};

const ENTER_MS = 200;
const HOLD_MS = 300;
const EXIT_MS = 200;
const TOTAL_MS = ENTER_MS + HOLD_MS + EXIT_MS;

function hasReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const PARTICLE_COUNT = 10;

function generateParticles() {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    left: `${10 + Math.random() * 80}%`,
    delay: `${Math.random() * 400}ms`,
    duration: `${800 + Math.random() * 600}ms`,
    size: 2 + Math.random() * 3,
    opacity: 0.2 + Math.random() * 0.4,
    bottom: `${20 + Math.random() * 30}%`,
  }));
}

export default function ModeSwitchSplash({ mode, visible, onComplete }: Props) {
  const [phase, setPhase] = useState<"entering" | "visible" | "exiting" | "hidden">("hidden");
  const [progress, setProgress] = useState(0);
  const completeCalledRef = useRef(false);
  const particles = useMemo(() => generateParticles(), []);
  const startTimeRef = useRef(0);
  const rafRef = useRef(0);

  // Time-based progress for thunder clipPath
  useEffect(() => {
    if (!visible) {
      setProgress(0);
      return;
    }

    const reduced = hasReducedMotion();
    if (reduced) {
      setProgress(100);
      return;
    }

    startTimeRef.current = performance.now();

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      const FILL_MS = 400;
      const p = Math.min(100, (elapsed / FILL_MS) * 100);
      setProgress(p);
      if (p < 100) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setPhase("hidden");
      return;
    }

    const reduced = hasReducedMotion();
    completeCalledRef.current = false;

    if (mode === "enter-console") {
      playEntrySound();
    } else {
      playExitSound();
    }

    const enterTimer = setTimeout(() => {
      setPhase("entering");
      requestAnimationFrame(() => {
        setPhase("visible");
      });
    }, reduced ? 0 : 10);

    const holdTimer = setTimeout(() => {
      setPhase("exiting");
    }, reduced ? 10 : ENTER_MS + HOLD_MS);

    const exitTimer = setTimeout(() => {
      setPhase("hidden");
      if (!completeCalledRef.current) {
        completeCalledRef.current = true;
        onComplete?.();
      }
    }, reduced ? 10 : TOTAL_MS);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(holdTimer);
      clearTimeout(exitTimer);
    };
  }, [visible, onComplete]);

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
  const isExiting = phase === "exiting";

  const overlayOpacity = reduced ? 1 : isVisible ? 1 : 0;
  const contentScale = reduced ? 1 : isVisible ? 1 : 0.95;
  const contentOpacity = reduced ? 1 : isVisible ? 1 : 0;
  const blurPx = reduced ? 0 : isExiting ? 0 : isVisible ? 12 : 0;
  const wolfDrawDuration = reduced ? "0ms" : "400ms";
  const wolfDrawDelay = reduced ? "0ms" : "50ms";
  const eyeGlowActive = !reduced && (phase === "visible" || phase === "entering");
  const clipBottom = Math.max(0, 100 - progress);

  return (
    <div
      className="fixed inset-0 z-[9998] flex select-none flex-col items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label={isEntering ? "Entering Gaming Mode" : "Returning to Desktop"}
      style={{ opacity: overlayOpacity, transition: `opacity ${EXIT_MS}ms ease-in` }}
    >
      {/* Backdrop blur layer */}
      {!reduced && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backdropFilter: `blur(${blurPx}px)`,
            WebkitBackdropFilter: `blur(${blurPx}px)`,
            transition: `backdrop-filter ${isExiting ? EXIT_MS : ENTER_MS}ms ease-out`,
          }}
        />
      )}

      {/* Dark overlay */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(11, 11, 20, 0.92)" }}
      />

      {/* Animated scanlines */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          animation: reduced ? "none" : "mode-scanline-scroll 3s linear infinite",
        }}
      />

      {/* Floating particles */}
      {!reduced && isVisible && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {particles.map((p) => (
            <div
              key={p.id}
              className="absolute rounded-full"
              style={{
                left: p.left,
                bottom: p.bottom,
                width: p.size,
                height: p.size,
                backgroundColor: "var(--color-accent)",
                opacity: 0,
                "--p-opacity": p.opacity,
                animation: `mode-particle-float ${p.duration} ease-out ${p.delay} forwards`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      {/* Center content */}
      <div
        className="relative flex flex-col items-center gap-5"
        style={{
          transform: `scale(${contentScale})`,
          opacity: contentOpacity,
          transition: `transform ${ENTER_MS}ms cubic-bezier(0.16,1,0.3,1), opacity ${ENTER_MS}ms ease-out`,
        }}
      >
        {/* FULL 300px logo with thunder clipPath loading */}
        <div className="relative mb-2">
          <svg
            className="h-[300px] w-[300px]"
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            shapeRendering="geometricPrecision"
          >
            {/* Thunder: track (translucent bg) + fill (cyan, clipPath reveal) */}
            <g>
              {/* Thunder track — translucent background */}
              <path
                style={{
                  fill: "rgba(0,183,255,0.15)",
                  stroke: "none",
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity 400ms ease-out 100ms`,
                }}
                d="m 553.57868,345.61285 c 10.74538,-0.21775 89.94629,-3.15317 89.59078,-3.90113 -38.09597,14.37381 -63.63735,45.05481 -78.73219,70.69281 -12.70395,21.57712 -46.09097,66.96911 -48.06045,97.729 41.00076,-2.17598 39.30564,-6.71511 120.16457,-8.55243 l -253.80472,182.59603 162.25929,-143.80071 -96.24559,6.09459 c 36.34926,-66.9527 78.85906,-133.90542 104.82831,-200.85812 z"
              />
              {/* Thunder fill — cyan, clipPath reveals bottom→top */}
              <path
                style={{
                  fill: "#19b5ff",
                  stroke: "none",
                  clipPath: `inset(0 0 ${clipBottom}% 0)`,
                  transition: reduced ? "none" : "clip-path 0.05s linear",
                }}
                d="m 553.57868,345.61285 c 10.74538,-0.21775 89.94629,-3.15317 89.59078,-3.90113 -38.09597,14.37381 -63.63735,45.05481 -78.73219,70.69281 -12.70395,21.57712 -46.09097,66.96911 -48.06045,97.729 41.00076,-2.17598 39.30564,-6.71511 120.16457,-8.55243 l -253.80472,182.59603 162.25929,-143.80071 -96.24559,6.09459 c 36.34926,-66.9527 78.85906,-133.90542 104.82831,-200.85812 z"
              />
            </g>

            {/* Pad: DPad + Buttons — fade in after wolves */}
            <g
              style={{
                opacity: isVisible ? 1 : 0,
                transition: `opacity 400ms ease-out 200ms`,
              }}
            >
              {/* DPad cross */}
              <path
                style={{ fill: "#f2f2f2", fillOpacity: 1, stroke: "none" }}
                d="m 303.2454,444.20636 v 45.11247 h -50.02669 v 36.50537 h 50.02669 v 45.11255 h 40.48207 V 525.8242 h 50.02669 v -36.50537 h -50.02669 v -45.11247 z"
              />
              {/* 4 Buttons */}
              <path
                style={{ fill: "#f2f2f2", fillOpacity: 1, stroke: "none" }}
                d="m 718.4919,436.46506 a 25.232653,24.988824 0 0 0 -25.23231,24.98903 25.232653,24.988824 0 0 0 25.23231,24.98903 25.232653,24.988824 0 0 0 25.23231,-24.98903 25.232653,24.988824 0 0 0 -25.23231,-24.98903 z m -48.76711,45.89348 a 25.232653,24.988824 0 0 0 -25.23231,24.98901 25.232653,24.988824 0 0 0 25.23231,24.98807 25.232653,24.988824 0 0 0 25.23342,-24.98807 25.232653,24.988824 0 0 0 -25.23342,-24.98901 z m 94.8654,0.23982 a 25.232653,24.988824 0 0 0 -25.23237,24.98904 25.232653,24.988824 0 0 0 25.23237,24.98897 25.232653,24.988824 0 0 0 25.23225,-24.98897 25.232653,24.988824 0 0 0 -25.23225,-24.98904 z m -47.06843,47.09448 a 25.232653,24.988824 0 0 0 -25.23342,24.98904 25.232653,24.988824 0 0 0 25.23342,24.98896 25.232653,24.988824 0 0 0 25.23225,-24.98896 25.232653,24.988824 0 0 0 -25.23225,-24.98904 z"
              />
            </g>

            {/* WolfLeft — stroke draw-on + fill + eye + ear highlight */}
            <g>
              {/* WolfLeft body — stroke draw-on */}
              <path
                className="wolf-draw-path"
                d="m 617.10358,21.999997 v 0.0012 c 0,-1.33e-4 0,1.39e-4 0,1.2e-5 z m 0,0.0012 C 547.87104,33.783259 482.18746,54.390278 421.49951,87.4249 360.59511,58.133701 286.97445,75.560276 230.37621,90.31824 c 26.82477,9.225049 57.01735,15.92938 71.82927,34.14407 -84.43205,1.39997 -195.53813,69.91845 -250.58613,116.10659 35.522623,-6.11477 117.85264,-49.63403 160.07161,-35.76304 -35.86295,4.7888 -64.30085,41.59003 -86.4124,66.13926 C 51.603532,351.9475 -1.6749694,509.52817 23.189686,583.38208 24.079788,586.02589 46.659382,486.81149 63.051704,481.37456 -11.047707,829.7062 337.1315,983.53096 431.50829,966.57785 c 19.44531,-28.39606 37.97574,-56.88406 50.76102,-88.62888 -27.05628,-93.96512 8.50364,-75.56174 8.80116,-152.57976 l 23.87498,-29.06644 -5.4172,-85.7491 c -4.02351,59.98418 -26.10611,109.76788 -55.81446,161.24001 -14.42629,25.36925 -112.6037,-4.40573 -102.22744,-15.59519 26.02929,-28.06925 29.83206,-43.21159 18.72565,-33.53606 -10.38684,9.0487 -49.95821,15.54558 -41.36638,9.10473 16.13088,-12.09257 66.28281,-56.11961 52.21801,-48.98658 C 293.45083,727.21422 205.6026,628.11222 193.78616,564.69173 165.26973,411.6396 307.68761,347.93488 375.69727,347.64271 l -47.50859,-35.0676 c 27.15088,13.98989 66.13537,28.59347 78.09266,53.49259 20.6955,41.79337 52.43519,83.20215 108.99193,51.7612 l -5.70918,-90.37072 23.87489,-29.06646 c 0.29755,-77.01795 35.85752,-58.6146 8.80117,-152.57969 18.03956,-44.79069 47.51618,-83.09749 74.86226,-123.81101 z"
                stroke="#e5e5e5"
                strokeWidth="3"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: 3200,
                  strokeDashoffset: isVisible ? 0 : 3200,
                  transition: `stroke-dashoffset ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfLeft body fill */}
              <path
                className="wolf-fill-layer"
                d="m 617.10358,21.999997 v 0.0012 c 0,-1.33e-4 0,1.39e-4 0,1.2e-5 z m 0,0.0012 C 547.87104,33.783259 482.18746,54.390278 421.49951,87.4249 360.59511,58.133701 286.97445,75.560276 230.37621,90.31824 c 26.82477,9.225049 57.01735,15.92938 71.82927,34.14407 -84.43205,1.39997 -195.53813,69.91845 -250.58613,116.10659 35.522623,-6.11477 117.85264,-49.63403 160.07161,-35.76304 -35.86295,4.7888 -64.30085,41.59003 -86.4124,66.13926 C 51.603532,351.9475 -1.6749694,509.52817 23.189686,583.38208 24.079788,586.02589 46.659382,486.81149 63.051704,481.37456 -11.047707,829.7062 337.1315,983.53096 431.50829,966.57785 c 19.44531,-28.39606 37.97574,-56.88406 50.76102,-88.62888 -27.05628,-93.96512 8.50364,-75.56174 8.80116,-152.57976 l 23.87498,-29.06644 -5.4172,-85.7491 c -4.02351,59.98418 -26.10611,109.76788 -55.81446,161.24001 -14.42629,25.36925 -112.6037,-4.40573 -102.22744,-15.59519 26.02929,-28.06925 29.83206,-43.21159 18.72565,-33.53606 -10.38684,9.0487 -49.95821,15.54558 -41.36638,9.10473 16.13088,-12.09257 66.28281,-56.11961 52.21801,-48.98658 C 293.45083,727.21422 205.6026,628.11222 193.78616,564.69173 165.26973,411.6396 307.68761,347.93488 375.69727,347.64271 l -47.50859,-35.0676 c 27.15088,13.98989 66.13537,28.59347 78.09266,53.49259 20.6955,41.79337 52.43519,83.20215 108.99193,51.7612 l -5.70918,-90.37072 23.87489,-29.06646 c 0.29755,-77.01795 35.85752,-58.6146 8.80117,-152.57969 18.03956,-44.79069 47.51618,-83.09749 74.86226,-123.81101 z"
                fill="#e5e5e5"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfLeft eye outline */}
              <path
                d="m 474.67907,331.52556 12.70044,-46.47717 -42.63624,-63.29368 4.86725,29.56465 -8.28232,35.47511 z"
                fill="#000"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity 300ms ease-out 250ms`,
                }}
              />
              {/* WolfLeft eye — glow pulse */}
              <path
                className="wolf-eyes-group"
                d="m 470.40058,306.3999 6.80507,-19.01059 -19.40207,-31.00112 -5.63085,28.70964 z"
                fill="#00b7ff"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity 300ms ease-out 200ms`,
                  animation: eyeGlowActive && !isExiting ? "wolf-eye-glow 1.2s ease-in-out 2" : "none",
                }}
              />
              {/* WolfLeft ear highlight */}
              <path
                d="m 386.87019,166.65058 c 26.99266,-4.23249 55.38152,-9.62629 77.57482,3.42902 l -3.69746,-28.61033 28.88159,39.98364 c 6.59005,-52.06407 42.68867,-89.919418 72.78695,-124.88839 -63.61386,26.414796 -125.87769,54.84856 -175.5459,110.08606 z"
                fill="#d2d2d2"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
            </g>

            {/* WolfRight — stroke draw-on + fill + eye + shadow */}
            <g>
              {/* WolfRight body — stroke draw-on */}
              <path
                className="wolf-draw-path"
                d="m 406.89622,1002 h 10e-4 c -5.9e-4,10e-5 -10e-4,-10e-5 -0.002,0 z m 10e-4,0 c 69.23144,-11.78239 134.91499,-32.38944 195.6029,-65.42402 60.90445,29.29119 134.52505,11.86458 191.12333,-2.89342 -26.82462,-9.22505 -57.01716,-15.92933 -71.82905,-34.14399 84.43206,-1.39996 195.53809,-69.91846 250.58606,-116.10662 -35.52259,6.11474 -117.85268,49.634 -160.07163,35.76303 35.86297,-4.78879 64.30087,-41.59006 86.41247,-66.13923 73.67516,-81.00235 126.9537,-238.58305 102.089,-312.43695 -0.89012,-2.64377 -23.46967,96.57054 -39.86201,102.00752 C 1035.0475,194.29357 686.86827,40.46888 592.49151,57.421977 c -19.445,28.396257 -37.97575,56.884093 -50.76103,88.628893 27.05636,93.96514 -8.50361,75.56178 -8.8011,152.57975 l -23.87496,29.06646 5.41713,85.7491 c 4.02357,-59.98408 26.10609,-109.7678 55.81443,-161.2399 14.42629,-25.36927 112.60371,4.40574 102.2275,15.5952 -26.02937,28.06924 -29.83207,43.21155 -18.72568,33.53607 10.38684,-9.04866 49.95823,-15.54563 41.36645,-9.10471 -16.13093,12.09257 -66.28286,56.11956 -52.21804,48.98652 87.61277,-44.43359 175.461,54.66841 187.27746,118.0889 28.51641,153.05208 -113.90143,216.75688 -181.91113,217.04905 l 47.50864,35.06756 C 668.66025,697.43496 629.67575,682.83141 617.7185,657.9323 597.02298,616.13888 565.28328,574.73009 508.72653,606.17112 l 5.70918,90.37068 -23.87492,29.06644 c -0.29752,77.01791 -35.85742,58.61464 -8.80114,152.5797 -18.0395,44.79069 -47.51618,83.09744 -74.86227,123.81096 z"
                stroke="#66738f"
                strokeWidth="3"
                strokeLinejoin="round"
                style={{
                  strokeDasharray: 3200,
                  strokeDashoffset: isVisible ? 0 : 3200,
                  transition: `stroke-dashoffset ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfRight body fill */}
              <path
                className="wolf-fill-layer"
                d="m 406.89622,1002 h 10e-4 c -5.9e-4,10e-5 -10e-4,-10e-5 -0.002,0 z m 10e-4,0 c 69.23144,-11.78239 134.91499,-32.38944 195.6029,-65.42402 60.90445,29.29119 134.52505,11.86458 191.12333,-2.89342 -26.82462,-9.22505 -57.01716,-15.92933 -71.82905,-34.14399 84.43206,-1.39996 195.53809,-69.91846 250.58606,-116.10662 -35.52259,6.11474 -117.85268,49.634 -160.07163,35.76303 35.86297,-4.78879 64.30087,-41.59006 86.41247,-66.13923 73.67516,-81.00235 126.9537,-238.58305 102.089,-312.43695 -0.89012,-2.64377 -23.46967,96.57054 -39.86201,102.00752 C 1035.0475,194.29357 686.86827,40.46888 592.49151,57.421977 c -19.445,28.396257 -37.97575,56.884093 -50.76103,88.628893 27.05636,93.96514 -8.50361,75.56178 -8.8011,152.57975 l -23.87496,29.06646 5.41713,85.7491 c 4.02357,-59.98408 26.10609,-109.7678 55.81443,-161.2399 14.42629,-25.36927 112.60371,4.40574 102.2275,15.5952 -26.02937,28.06924 -29.83207,43.21155 -18.72568,33.53607 10.38684,-9.04866 49.95823,-15.54563 41.36645,-9.10471 -16.13093,12.09257 -66.28286,56.11956 -52.21804,48.98652 87.61277,-44.43359 175.461,54.66841 187.27746,118.0889 28.51641,153.05208 -113.90143,216.75688 -181.91113,217.04905 l 47.50864,35.06756 C 668.66025,697.43496 629.67575,682.83141 617.7185,657.9323 597.02298,616.13888 565.28328,574.73009 508.72653,606.17112 l 5.70918,90.37068 -23.87492,29.06644 c -0.29752,77.01791 -35.85742,58.61464 -8.80114,152.5797 -18.0395,44.79069 -47.51618,83.09744 -74.86227,123.81096 z"
                fill="#66738f"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfRight eye outline */}
              <path
                d="m 548.76472,689.89898 -12.70041,46.47721 42.63628,63.29363 -4.8673,-29.56463 8.2823,-35.47514 z"
                fill="#000"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity 300ms ease-out 250ms`,
                }}
              />
              {/* WolfRight eye — glow pulse */}
              <path
                className="wolf-eyes-group"
                d="m 553.0432,715.02463 -6.80501,19.01062 19.40206,31.00112 5.63083,-28.70962 z"
                fill="#00b7ff"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity 300ms ease-out 200ms`,
                  animation: eyeGlowActive && !isExiting ? "wolf-eye-glow 1.2s ease-in-out 2" : "none",
                }}
              />
              {/* WolfRight shadow */}
              <path
                d="m 636.57363,854.77397 c -26.99267,4.23244 -55.38151,9.62627 -77.57483,-3.42902 l 3.69744,28.61035 -28.88157,-39.98368 c -6.59005,52.0641 -42.68864,89.91939 -72.78688,124.88837 63.61386,-26.41477 125.87764,-54.84853 175.54584,-110.08602 z"
                fill="#536079"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
            </g>
          </svg>
        </div>

        {/* Staggered title */}
        <h1
          className="text-center text-3xl font-extrabold tracking-tight drop-shadow-lg"
          style={{
            color: "var(--color-text)",
            animationFillMode: "both",
            animationDuration: reduced ? "0ms" : `${ENTER_MS}ms`,
            animationTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
            animationDelay: reduced ? "0ms" : "80ms",
            animationName: !reduced && isVisible ? "mode-text-reveal" : "none",
          }}
        >
          {isEntering ? "Gaming Mode" : "Desktop Mode"}
        </h1>

        {/* Staggered subtitle */}
        <p
          className="text-center text-sm font-medium"
          style={{
            color: "var(--color-muted)",
            animationFillMode: "both",
            animationDuration: reduced ? "0ms" : `${ENTER_MS}ms`,
            animationTimingFunction: "cubic-bezier(0.16,1,0.3,1)",
            animationDelay: reduced ? "0ms" : "160ms",
            animationName: !reduced && isVisible ? "mode-text-reveal" : "none",
          }}
        >
          {isEntering ? "Entering fullscreen experience" : "Returning to desktop"}
        </p>
      </div>
    </div>
  );
}
