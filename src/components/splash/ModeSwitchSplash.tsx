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
                d="m 553.57868,345.61285 c 10.74538,-0.21775 89.94629,-3.15317 89.59078,-3.90113 -76.74897,28.95779 -125.67853,151.02132 -126.79264,168.42181 40.86843,-1.51434 38.70701,-3.72198 120.16457,-8.55243 l -253.80472,182.59603 162.25929,-143.80071 -96.24559,6.09459 c 36.74374,-66.06584 76.00335,-130.80087 104.82831,-200.85816 z"
              />
              {/* Thunder fill — cyan, clipPath reveals bottom→top */}
              <path
                style={{
                  fill: "#19b5ff",
                  stroke: "none",
                  clipPath: `inset(0 0 ${clipBottom}% 0)`,
                  transition: reduced ? "none" : "clip-path 0.05s linear",
                }}
                d="m 553.57868,345.61285 c 10.74538,-0.21775 89.94629,-3.15317 89.59078,-3.90113 -76.74897,28.95779 -125.67853,151.02132 -126.79264,168.42181 40.86843,-1.51434 38.70701,-3.72198 120.16457,-8.55243 l -253.80472,182.59603 162.25929,-143.80071 -96.24559,6.09459 c 36.74374,-66.06584 76.00335,-130.80087 104.82831,-200.85816 z"
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
                style={{ fill: "#f3f6fa", fillOpacity: 1, stroke: "none" }}
                d="m 303.2454,444.20636 v 45.11247 h -50.02669 v 36.50537 h 50.02669 v 45.11255 h 40.48207 V 525.8242 h 50.02669 v -36.50537 h -50.02669 v -45.11247 z"
              />
              {/* 4 Buttons */}
              <path
                style={{ fill: "#f3f6fa", fillOpacity: 1, stroke: "none" }}
                d="m 718.4919,436.46506 a 25.232653,24.988824 0 0 0 -25.23231,24.98903 25.232653,24.988824 0 0 0 25.23231,24.98903 25.232653,24.988824 0 0 0 25.23231,-24.98903 25.232653,24.988824 0 0 0 -25.23231,-24.98903 z m -48.76711,45.89348 a 25.232653,24.988824 0 0 0 -25.23231,24.98901 25.232653,24.988824 0 0 0 25.23231,24.98807 25.232653,24.988824 0 0 0 25.23342,-24.98807 25.232653,24.988824 0 0 0 -25.23342,-24.98901 z m 94.8654,0.23982 a 25.232653,24.988824 0 0 0 -25.23237,24.98904 25.232653,24.988824 0 0 0 25.23237,24.98897 25.232653,24.988824 0 0 0 25.23225,-24.98897 25.232653,24.988824 0 0 0 -25.23225,-24.98904 z m -47.06843,47.09448 a 25.232653,24.988824 0 0 0 -25.23342,24.98904 25.232653,24.988824 0 0 0 25.23342,24.98896 25.232653,24.988824 0 0 0 25.23225,-24.98896 25.232653,24.988824 0 0 0 -25.23225,-24.98904 z"
              />
            </g>

            {/* WolfLeft — stroke draw-on + fill + eye + ear highlight */}
            <g>
              {/* WolfLeft body — stroke draw-on */}
              <path
                className="wolf-draw-path"
                d="m 617.10358,21.999997 v 0.0012 c 0,-1.33e-4 0,1.39e-4 0,1.2e-5 z m 0,0.0012 C 547.87104,33.783259 482.18746,54.390278 421.49951,87.4249 360.59511,58.133701 286.97445,75.560276 230.37621,90.31824 c 26.82477,9.225049 57.01735,15.92938 71.82927,34.14407 -84.43205,1.39997 -195.53813,69.91845 -250.58613,116.10659 35.522623,-6.11477 117.85264,-49.63403 160.07161,-35.76304 -35.86295,4.7888 -64.30085,41.59003 -86.4124,66.13926 C 51.603532,351.9475 -1.6749694,509.52817 23.189686,583.38208 24.079788,586.02589 46.659382,486.81149 63.051704,481.37456 -11.047707,829.7062 337.1315,983.53096 431.50829,966.57785 c 19.44531,-28.39606 37.97574,-56.88406 50.76102,-88.62888 -27.05628,-93.96512 8.50364,-75.56174 8.80116,-152.57976 l 23.87498,-29.06644 -5.4172,-85.7491 c -4.02351,59.98418 -26.10611,109.76788 -55.81446,161.24001 -14.42629,25.36925 -112.6037,-4.40573 -102.22744,-15.59519 26.02929,-28.06925 29.83206,-43.21159 18.72565,-33.53606 -10.38684,9.0487 -49.95821,15.54558 -41.36638,9.10473 16.13088,-12.09257 66.28281,-56.11961 52.21801,-48.98658 C 293.45083,727.21422 205.6026,628.11222 193.78616,564.69173 165.26973,411.6396 307.68761,347.93488 375.69727,347.64271 l -47.50859,-35.0676 c 27.15088,13.98989 66.13537,28.59347 78.09266,53.49259 20.6955,41.79337 52.43519,83.20215 108.99193,51.7612 l -5.70918,-90.37072 23.87489,-29.06646 c 0.29755,-77.01795 35.85752,-58.6146 8.80117,-152.57969 18.03956,-44.79069 47.51618,-83.09749 74.86226,-123.81101 z"
                stroke="#f3f6fa"
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
                fill="#f3f6fa"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfLeft body shading */}
              <path
                d="m 341.47852,275.92383 c -50.71674,8.19155 -78.85099,25.95397 -112.63477,61.38281 l 54.82813,1.19141 C 13.144851,504.4295 219.72858,687.5383 289.99805,683.36523 240.10037,660.55148 201.35413,605.30466 193.78711,564.69141 165.27068,411.63928 307.68761,347.93475 375.69727,347.64258 l -47.50782,-35.06836 c 1.92296,0.99083 3.90378,1.9859 5.93164,2.98633 l -4.5625,-3.28321 c 2.26064,1.45273 4.45677,2.87698 6.58985,4.27735 26.29965,12.85403 59.30249,26.96127 70.13281,49.51367 17.12398,34.58088 41.80896,68.89825 81.85742,61.90234 2.35669,-0.79255 4.50881,-1.65653 6.49805,-2.46289 C 404.71101,408.09108 448.80673,301.4353 300.35742,303.93359 Z"
                fill="#d8e1eb"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="m 375.13281,719.73828 c -0.95565,-0.0219 -2.61692,0.91753 -4.91992,2.92383 -9.99408,8.70654 -47.00734,15.0514 -42.13867,9.78125 l -32.18555,4.14844 c 23.0095,17.25712 53.62425,9.66702 78.70508,-10.92969 1.82437,-3.80693 1.93579,-5.89184 0.53906,-5.92383 z"
                fill="#d8e1eb"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 83.4375,436.14844 C 41.184498,472.09036 32.721496,513.38975 24.019531,566.57031 l -0.974609,16.37891 c 1.94e-4,5.9e-4 -1.95e-4,10e-4 0,0.002 0.04777,0.14427 0.09617,0.28801 0.144531,0.43164 0.0063,0.0188 0.01688,0.0344 0.02539,0.043 0.0022,0.002 0.0074,0.005 0.0098,0.006 0.02359,0.009 0.05527,-0.0131 0.0918,-0.0644 l 0.002,-0.002 0.605469,-1.56054 c 7e-5,-2.2e-4 -7e-5,-0.002 0,-0.002 C 28.0373,569.1452 47.973438,486.92605 62.888756,481.43183 l 0.320312,-0.82617 C 68.055791,464.8259 75.609558,450.55185 83.4375,436.14844 Z"
                fill="#d8e1eb"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="m 544.36914,64.375 c -0.25321,0.03226 -0.50908,0.06911 -0.76758,0.107422 -56.98565,24.381504 -111.97228,52.391058 -156.73047,102.167968 26.98731,-4.23165 55.3692,-9.62353 77.56055,3.42188 l -0.041,-0.375 c -2.3e-4,-0.002 -0.002,-0.004 -0.002,-0.006 -1.33185,-9.32178 -4.90907,-26.12659 -3.77734,-28.07422 l -0.0176,-0.0801 c 0.009,0.0215 0.0182,0.043 0.0273,0.0644 0.0372,-0.06 0.0798,-0.10441 0.12696,-0.13281 l 25.18554,34.86719 c -3.75373,-21.78395 -7.96401,-34.87627 -24.37109,-48.20703 22.80361,-25.07087 54.91683,-45.438223 82.80664,-63.75391 z"
                fill="#3f495f"
                fillOpacity={0.15291937}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="m 509.52734,610.55273 c -4.23307,46.47605 -22.50829,89.90021 -34.55717,134.68003 l -14.89795,41.41967 c -7.42165,36.0087 -9.82909,48.99386 -0.89454,86.71094 -7.06812,31.83287 -32.57524,69.52957 -52.05078,94.19336 9.29822,0.58478 17.5113,0.25548 24.38086,-0.97852 19.44531,-28.39606 37.97644,-56.88408 50.76172,-88.6289 -27.05628,-93.96512 8.50326,-75.56206 8.80078,-152.58008 l 23.875,-29.06641 z"
                fill="#d8e1eb"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 406.57227 81.238281 C 394.80266 92.380104 386.39726 106.37414 387.36719 121.87109 L 421.7832 87.753906 L 419.23828 86.361328 C 419.23751 86.360971 419.2371 86.359732 419.23633 86.359375 C 415.06902 84.443374 410.84465 82.742487 406.57227 81.238281 z "
                fill="#c6d4e1"
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
                d="m 386.87019,166.65058 c 26.99266,-4.23249 55.38152,-9.62629 77.57482,3.42902 -1.32941,-9.55293 -5.23826,-27.68347 -3.69746,-28.61033 l 28.88159,39.98364 c 6.59005,-52.06407 42.68867,-89.919418 72.78695,-124.88839 -63.61386,26.414796 -125.87769,54.84856 -175.5459,110.08606 z"
                fill="#cbd6e3"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfLeft edge highlights */}
              <path
                d="m 126.6901,187.84023 27.88867,-8.90039 c 61.39329,-19.01662 108.7789,-33.64768 173.86719,-19.2207 -12.31305,-20.92454 -17.7107,-31.71381 -31.00781,-39.20313 1.5225,1.4295 2.93961,2.93814 4.23828,4.53516 -54.63196,0.90584 -120.43141,29.91349 -174.98633,62.78906 z"
                fill="#d8e1eb"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 36.345658,435.7915 C 76.667149,336.64262 157.78973,261.41023 237.61908,207.69579 l -30.76172,-3.79296 -0.10351,0.0449 c 1.5333,0.3438 3.02375,0.7505 4.4668,1.22461 -6.72364,0.89791 -13.18761,2.9227 -19.39649,5.77929 -6.20947,2.857 -12.16587,6.54678 -17.875,10.7793 -19.03012,14.10822 -35.32099,34.23697 -49.14062,49.58008 -4.0813,4.48719 -8.10058,9.2107 -12.04688,14.14062 l -0.002,0.002 c -5.5e-4,6.8e-4 -10e-4,0.001 -0.002,0.002 l -0.002,0.004 c -6.19555,7.7403 -11.5627,17.21218 -17.363271,25.87109 l -17.36523,25.87109 c -7.1e-4,10e-4 -10e-4,0.003 -0.002,0.004 -7.1e-4,0.001 -0.001,0.003 -0.002,0.004 -10.74927,18.89227 -20.09577,39.19128 -28.46289,59.66797 -2.56227,6.27551 -4.60602,12.58454 -6.90625,18.90234 -2.44162,6.71073 -4.65771,12.94282 -6.78266,19.643 z"
                fill="#d8e1eb"
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
                stroke="#7180a1"
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
                fill="#7180a1"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfRight shadow detail */}
              <path
                d="m 593.56464,816.15138 c -8.61232,-23.44444 -6.03645,-34.5619 -2.68177,-58.9989 2.52868,-32.72788 -14.95492,-48.89529 -37.84273,-67.34217 l -6.25745,-3.87367 c 17.44676,43.22244 16.67672,94.50852 46.78195,130.21474 z"
                fill="#3f495f"
                fillOpacity={0.184314}
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
              {/* WolfRight ear shadow */}
              <path
                d="m 636.57363,854.77397 c -26.99267,4.23244 -55.38151,9.62627 -77.57483,-3.42902 l 3.69744,28.61035 -28.88157,-39.98368 c -6.59005,52.0641 -42.68864,89.91939 -72.78688,124.88837 63.61386,-26.41477 125.87764,-54.84853 175.54584,-110.08602 z"
                fill="#56627c"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              {/* WolfRight edge highlights */}
              <path
                d="m 609.88867,56.173828 c -6.4679,-0.08394 -12.30156,0.332835 -17.39648,1.248047 -19.445,28.396257 -37.97644,56.884105 -50.76172,88.628905 27.05636,93.96514 -8.50329,75.56211 -8.80078,152.58008 l -23.875,29.06641 5.41601,85.74804 c 4.02357,-59.98408 26.10612,-109.76618 55.81446,-161.23828 14.42629,-25.36927 112.60472,4.40429 102.22851,15.59375 -26.02937,28.06924 -29.83295,43.21259 -18.72656,33.53711 10.38684,-9.04866 49.95897,-15.54639 41.36719,-9.10547 -16.13093,12.09257 -66.28357,56.11937 -52.21875,48.98633 87.61277,-44.43359 175.46088,54.66935 187.27734,118.08984 28.51641,153.05208 -113.90046,216.75666 -181.91016,217.04883 l 47.50782,35.06836 c -6.55698,-3.37858 -14.22138,-7.35683 -21.61133,-10.94336 l 0.88281,0.72656 -1.875,-1.22851 c -22.90794,-11.14963 -46.55127,-23.43889 -55.48828,-42.04883 -1.7853,-3.60531 -3.65281,-7.2067 -5.61133,-10.75976 -4.39815,-6.86612 -9.28327,-14.48827 -13.80664,-21.53907 -17.13312,-22.50328 -39.93157,-37.35837 -71.67187,-27.32812 0.0327,0.1648 0.0722,0.3332 0.11914,0.5039 37.36298,10.9548 47.02385,29.38157 65.73828,61.10157 31.35363,70.2587 118.33655,69.24162 136.11328,68.26757 l -46.77539,-37.5039 c 140.10008,6.36549 330.90148,-229.3349 24.4414,-418.44922 l -36.66216,10.1121 26.54888,-26.54765 C 651.7992,224.65613 623.66635,217.44183 573.10352,223.3418 l -7.58589,-72.05952 44.37299,-95.108452 z"
                fill="#63708d"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 1000.6602 440.66797 C 998.50724 444.15537 977.12679 536.04498 961.28711 542.50195 C 955.10459 557.51833 948.46113 572.2297 941.00195 586.41406 C 996.7903 547.84531 1001.0418 467.83114 1000.6602 440.66797 z "
                fill="#63708d"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 987.76301,588.81321 C 947.44152,687.96209 866.31893,763.19448 786.48958,816.90892 l 30.76172,3.79296 0.10351,-0.0449 c -1.5333,-0.3438 -3.02375,-0.7505 -4.4668,-1.22461 6.72364,-0.89791 13.18761,-2.9227 19.39649,-5.77929 6.20947,-2.857 12.16587,-6.54678 17.875,-10.7793 19.03012,-14.10822 35.32099,-34.23697 49.14062,-49.58008 4.0813,-4.48719 8.10058,-9.2107 12.04688,-14.14062 l 0.002,-0.002 c 5.5e-4,-6.8e-4 10e-4,-10e-4 0.002,-0.002 l 0.002,-0.004 c 6.19555,-7.7403 11.5627,-17.21218 17.36328,-25.87109 l 17.36523,-25.87109 c 7.1e-4,-0.001 10e-4,-0.003 0.002,-0.004 7.1e-4,-10e-4 10e-4,-0.003 0.002,-0.004 10.74927,-18.89227 20.09577,-39.19128 28.46289,-59.66797 2.56227,-6.27551 4.60602,-12.58454 6.90625,-18.90234 2.44162,-6.71073 4.65771,-12.94282 6.78266,-19.643 z"
                fill="#63708d"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 896.78125 836.75 L 868.89258 845.65039 C 807.49929 864.66701 760.11368 879.29807 695.02539 864.87109 C 707.33844 885.79563 712.73609 896.5849 726.0332 904.07422 C 724.5107 902.64472 723.09359 901.13608 721.79492 899.53906 C 776.42688 898.63322 842.22633 869.62557 896.78125 836.75 z "
                fill="#63708d"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="m 602.25701,935.91893 c 15.54502,-13.57866 31.00328,-31.02432 45.43669,-49.60522 7.23611,19.81866 -6.25635,30.60482 -23.13974,58.8605 -8.21531,-2.53255 -17.07459,-4.81812 -22.29695,-9.25528 z"
                fill="#56627c"
                fillOpacity={0.799}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="M 643.76562 915.16992 L 624.41211 944.75195 C 630.95912 946.48144 636.80556 947.91295 642.4707 949.3418 C 692.16699 958.35222 745.63493 946.1087 789.55078 934.74023 C 789.55278 934.73972 789.55464 934.7388 789.55664 934.73828 L 792.83203 933.41211 C 792.55721 933.31832 792.28133 933.22417 792.00586 933.13086 C 747.6935 936.97425 693.44762 934.45848 643.76562 915.16992 z "
                fill="#63708d"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity ${wolfDrawDuration} ease-out ${wolfDrawDelay}`,
                }}
              />
              <path
                d="m 478.94061,957.15825 c 0.25321,-0.0323 0.50908,-0.0691 0.76758,-0.10743 56.98565,-24.3815 111.97228,-52.39105 156.73046,-102.16797 -26.9873,4.23165 -55.36919,9.62353 -77.56055,-3.42188 l 0.041,0.375 c 2.3e-4,0.002 0.002,0.004 0.002,0.006 1.33185,9.32178 4.90907,26.12659 3.77734,28.07422 l 0.0176,0.0801 c -0.009,-0.0215 -0.0182,-0.043 -0.0273,-0.0644 -0.0372,0.06 -0.0798,0.10442 -0.12696,0.13281 l -25.18554,-34.86719 c 3.75373,21.78395 7.96401,34.87627 24.37109,48.20704 -22.80361,25.07086 -54.91682,45.43822 -82.80663,63.7539 z"
                fill="#3f495f"
                fillOpacity={0.184314}
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
