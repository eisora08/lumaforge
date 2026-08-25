import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  subscribe,
  subscribeEarlyShow,
  getBootStatus,
  getBootProgress,
  getBootError,
} from "../../services/appBootCoordinator";

const STATUS_CYCLE: string[] = [
  "Loading settings...",
  "Migrating game data...",
  "Loading library...",
  "Loading achievements...",
  "Starting LumaForge...",
];

const SPLASH_CSS = `
@keyframes eyeGlow {
  0%   { opacity: 0.6; filter: drop-shadow(0 0 1px rgba(0,183,255,0.4)); }
  30%  { opacity: 1;   filter: drop-shadow(0 0 3px rgba(0,183,255,0.8)) drop-shadow(0 0 6px rgba(0,183,255,0.4)); }
  50%  { opacity: 0.7; filter: drop-shadow(0 0 1px rgba(0,183,255,0.4)); }
  70%  { opacity: 1;   filter: drop-shadow(0 0 4px rgba(0,183,255,0.9)) drop-shadow(0 0 8px rgba(0,183,255,0.5)); }
  85%  { opacity: 0.85;filter: drop-shadow(0 0 2px rgba(0,183,255,0.6)); }
  100% { opacity: 0.6; filter: drop-shadow(0 0 1px rgba(0,183,255,0.4)); }
}
@keyframes lightningPulse {
  0%    { filter: drop-shadow(0 0 1px rgba(0,183,255,0.2)); }
  20%   { filter: brightness(1.4) drop-shadow(0 0 6px rgba(0,183,255,0.8)) drop-shadow(0 0 12px rgba(0,183,255,0.4)); }
  22%   { filter: brightness(0.8) drop-shadow(0 0 1px rgba(0,183,255,0.2)); }
  24%   { filter: brightness(1.5) drop-shadow(0 0 8px rgba(0,183,255,1)) drop-shadow(0 0 16px rgba(0,183,255,0.5)); }
  40%   { filter: drop-shadow(0 0 2px rgba(0,183,255,0.3)); }
  100%  { filter: drop-shadow(0 0 1px rgba(0,183,255,0.2)); }
}
@keyframes logoIn {
  from { opacity: 0; transform: scale(0.88) translateY(10px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes textIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.wolf-eye {
  animation: eyeGlow 3s ease-in-out infinite;
  animation-delay: 0.5s;
}
.lightning-track-group {
  animation: lightningPulse 4s ease-in-out infinite;
  animation-delay: 1s;
}
`;

type SplashScreenProps = {
  wizardActive?: boolean;
};

export default function SplashScreen({ wizardActive = false }: SplashScreenProps) {
  const [visible, setVisible] = useState(true);
  const [statusText, setStatusText] = useState(STATUS_CYCLE[0]);
  const [progress, setProgress] = useState(0);
  const [statusColor, setStatusColor] = useState("text-cyan-400");
  const [fadeOut, setFadeOut] = useState(false);
  const hasClosedSplashRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setStatusText((prev) => {
        const idx = STATUS_CYCLE.indexOf(prev);
        return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [visible]);

  function closeSplash() {
    if (hasClosedSplashRef.current) return;
    hasClosedSplashRef.current = true;

    console.log("[Boot] closing splash overlay", wizardActive ? "(wizard active)" : "");
    setFadeOut(true);

    if (!wizardActive) {
      invoke("close_splashscreen_and_show_main").catch((err: unknown) => {
        console.warn("[Boot] close splash command failed:", String(err));
      });
    }

    setTimeout(() => {
      setVisible(false);
    }, 400);
  }

  useEffect(() => {
    const unsubBoot = subscribe(() => {
      const status = getBootStatus();
      setProgress(getBootProgress());

      if (status === "ready" || status === "timeout") {
        closeSplash();
      } else if (status === "error") {
        setStatusColor("text-amber-400");
        const err = getBootError();
        if (err) setStatusText("Warning: " + err);
      }
    });

    const unsubEarly = subscribeEarlyShow(() => {
      if (hasClosedSplashRef.current) return;
      hasClosedSplashRef.current = true;
      setProgress(90);
      setFadeOut(true);
      setTimeout(() => setVisible(false), 400);
    });

    return () => {
      unsubBoot();
      unsubEarly();
    };
  }, []);

  if (!visible) return null;

  const clipBottom = Math.max(0, 100 - progress);

  return (
    <div
      className={
        "fixed inset-0 z-[9999] flex select-none flex-col items-center justify-center transition-opacity duration-400 " +
        (fadeOut ? "opacity-0" : "opacity-100")
      }
      style={{
        background:
          "radial-gradient(circle at 50% 38%, rgba(0,183,255,0.05) 0%, transparent 45%), radial-gradient(ellipse at center, #0f1525 0%, #0a0e1a 50%, #060912 100%)",
      }}
    >
      <style>{SPLASH_CSS}</style>

      <div
        className="flex flex-col items-center"
        style={{ animation: "logoIn 600ms cubic-bezier(0.16, 1, 0.3, 1) 0ms both" }}
      >
        <div className="mb-7 h-[310px] w-[310px] flex-shrink-0">
          <svg
            width="310"
            height="310"
            viewBox="0 0 2048 2048"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="block h-full w-full"
            shapeRendering="geometricPrecision"
          >
            {/* Thunder: Lightning bolt (track + fill) */}
            <g id="layer7" className="lightning-track-group">
              <path
                className="animate-[fadeIn_300ms_ease-out_500ms_both]"
                style={{ fill: "rgba(0,183,255,0.15)", stroke: "none" }}
                d="m 1085.579,766.0522 c 16.0121,-0.33781 134.0328,-4.89181 133.503,-6.0522 -56.7684,22.29947 -94.8287,69.89784 -117.3222,109.67253 -18.9307,33.47466 -68.6821,103.8956 -71.6169,151.61637 61.097,-3.3758 58.571,-10.4178 179.0624,-13.2682 L 831,1291.2994 l 241.7895,-223.0918 -143.41967,9.4551 C 983.53543,973.79257 1046.8811,869.9224 1085.579,766.05226 Z"
              />
              <path
                style={{
                  fill: "#19b5ff",
                  stroke: "none",
                  clipPath: `inset(0 0 ${clipBottom}% 0)`,
                  transition: "clip-path 0.5s ease-out",
                }}
                d="m 1085.579,766.0522 c 16.0121,-0.33781 134.0328,-4.89181 133.503,-6.0522 -56.7684,22.29947 -94.8287,69.89784 -117.3222,109.67253 -18.9307,33.47466 -68.6821,103.8956 -71.6169,151.61637 61.097,-3.3758 58.571,-10.4178 179.0624,-13.2682 L 831,1291.2994 l 241.7895,-223.0918 -143.41967,9.4551 C 983.53543,973.79257 1046.8811,869.9224 1085.579,766.05226 Z"
              />
            </g>

            {/* Pad: DPad + Buttons */}
            <g id="layer6">
              <path
                style={{ fill: "#f2f2f2", fillOpacity: 1, stroke: "none" }}
                d="m 712.54691,919.00982 v 69.98731 H 638 v 56.63427 h 74.54691 v 69.9874 h 60.32406 v -69.9874 h 74.54691 v -56.63427 h -74.54691 v -69.98731 z"
              />
              <path
                style={{ fill: "#f2f2f2", fillOpacity: 1, stroke: "none" }}
                d="m 1331.3235,907 a 37.600255,38.767557 0 0 0 -37.5998,38.76788 37.600255,38.767557 0 0 0 37.5998,38.76788 37.600255,38.767557 0 0 0 37.5997,-38.76788 A 37.600255,38.767557 0 0 0 1331.3235,907 Z m -72.67,71.19895 a 37.600255,38.767557 0 0 0 -37.5997,38.76785 37.600255,38.767557 0 0 0 37.5997,38.7664 37.600255,38.767557 0 0 0 37.6014,-38.7664 37.600255,38.767557 0 0 0 -37.6014,-38.76785 z m 141.363,0.37206 a 37.600255,38.767557 0 0 0 -37.5998,38.76789 37.600255,38.767557 0 0 0 37.5998,38.7678 37.600255,38.767557 0 0 0 37.5997,-38.7678 37.600255,38.767557 0 0 0 -37.5997,-38.76789 z m -70.1387,73.06219 a 37.600255,38.767557 0 0 0 -37.6014,38.7679 37.600255,38.767557 0 0 0 37.6014,38.7678 37.600255,38.767557 0 0 0 37.5997,-38.7678 37.600255,38.767557 0 0 0 -37.5997,-38.7679 z"
              />
            </g>

            {/* WolfLeft */}
            <g id="layer5">
              <path
                style={{ fill: "#e5e5e5", fillOpacity: 1, stroke: "none" }}
                d="m 1180.24,264 v 0.002 c 0,-2.1e-4 0,2.1e-4 0,2e-5 z m 0,0.002 c -103.1664,18.27871 -201.04428,50.24836 -291.47799,101.49813 -90.75625,-45.44224 -200.46154,-18.40673 -284.801,4.48872 39.97274,14.3117 84.96399,24.71276 107.03586,52.97096 -125.8158,2.17191 -291.37973,108.4712 -373.4091,180.12729 52.93378,-9.48642 175.61726,-77.00204 238.52955,-55.48264 -53.44091,7.42933 -95.81745,64.5226 -128.76682,102.60819 C 337.5642,775.8794 258.17163,1020.3494 295.22351,1134.926 c 1.32638,4.1016 34.9732,-149.81917 59.4001,-158.254 -110.4187,540.4003 408.41802,779.0434 549.05291,752.7424 28.97628,-44.0536 56.58928,-88.2497 75.64117,-137.4985 -40.31772,-145.7771 12.67163,-117.2262 13.11498,-236.7116 l 35.57713,-45.0936 -8.0724,-133.0308 c -5.9956,93.059 -38.90182,170.2933 -83.17151,250.1469 -21.49723,39.3578 -167.79558,-6.835 -152.33348,-24.1943 38.78736,-43.5465 44.45403,-67.0383 27.90389,-52.0277 -15.47788,14.0381 -74.44486,24.1174 -61.6418,14.125 24.03731,-18.7603 98.77084,-87.0637 77.81229,-75.9975 C 697.9512,1358.0664 567.0448,1204.32 549.43661,1105.9297 506.94306,868.48527 719.16603,769.65403 820.51013,769.20076 l -70.79458,-54.40373 c 40.45869,21.70386 98.55115,44.35979 116.36921,82.98819 30.83926,64.83805 78.13592,129.07947 162.41354,80.3021 l -8.5075,-140.20075 35.577,-45.0936 c 0.4434,-119.48532 53.4328,-90.93444 13.115,-236.7115 26.8815,-69.48809 70.8059,-128.91709 111.5555,-192.07988 z"
              />
              <path
                style={{ fill: "#000000", fillOpacity: 1, stroke: "none" }}
                d="m 968.00716,744.19667 18.92546,-72.10448 -63.53408,-98.19355 7.25288,45.86647 -12.34183,55.03594 z"
              />
              <path
                className="wolf-eye"
                style={{ fill: "#00b7ff", fillOpacity: 1, stroke: "none" }}
                d="m 961.63158,705.21684 10.14054,-29.49295 -28.91186,-48.09502 -8.39077,44.54003 z"
              />
              <path
                style={{ fill: "#d2d2d2", fillOpacity: 1, stroke: "none" }}
                d="m 837.15939,488.41032 c 40.22291,-6.56627 82.52636,-14.9342 115.59755,5.31976 l -5.50974,-44.38595 43.03768,62.03046 c 9.82012,-80.77198 63.61222,-139.50061 108.46292,-193.75133 -94.7937,40.97981 -187.57569,85.09182 -261.58841,170.78706 z"
              />
            </g>

            {/* WolfRight */}
            <g id="layer3">
              <path
                style={{ fill: "#66738f", fillOpacity: 1, stroke: "none" }}
                d="m 867.001,1784.3681 h 0.002 c -0.001,2e-4 -0.002,-2e-4 -0.003,0 z m 0.002,0 c 103.16473,-18.2791 201.0426,-50.2488 291.4763,-101.4985 90.7563,45.4422 200.4615,18.4067 284.801,-4.4888 -39.9728,-14.3117 -84.964,-24.7127 -107.0358,-52.9709 125.8158,-2.1719 291.3797,-108.4712 373.409,-180.1273 -52.9337,9.4864 -175.6173,77.002 -238.5296,55.4826 53.441,-7.4293 95.8175,-64.5226 128.7669,-102.6082 109.7863,-125.6667 189.1789,-370.1367 152.127,-484.71334 -1.3264,-4.10154 -34.9732,149.81914 -59.4001,158.25404 110.4184,-540.40199 -408.4184,-779.04497 -549.0532,-752.74401 -28.9758,44.05384 -56.5893,88.24975 -75.6412,137.49851 40.3178,145.77712 -12.6716,117.22623 -13.1149,236.71159 l -35.5771,45.09358 8.0723,133.0308 c 5.9957,-93.05906 38.9018,-170.29331 83.1715,-250.14691 21.4972,-39.35778 167.7956,6.83504 152.3335,24.19432 -38.7874,43.5465 -44.454,67.03823 -27.9039,52.02772 15.4779,-14.03806 74.4449,-24.11742 61.6419,-14.12501 -24.0374,18.76036 -98.7709,87.06366 -77.8123,75.99749 130.5555,-68.93409 261.4619,84.81234 279.0701,183.20263 42.4936,237.44439 -169.7294,336.27569 -271.0735,336.72899 l 70.7946,54.4037 c -40.4587,-21.7039 -98.5512,-44.3598 -116.3692,-82.9882 -30.8393,-64.8381 -78.136,-129.0795 -162.4136,-80.3021 l 8.5075,140.2007 -35.57705,45.0936 c -0.44334,119.4853 -53.43267,90.9345 -13.11495,236.7115 -26.88143,69.4881 -70.80589,128.9171 -111.55547,192.0799 z"
              />
              <path
                style={{ fill: "#000000", fillOpacity: 1, stroke: "#000000", strokeWidth: 5.53937, strokeLinejoin: "round" }}
                d="m 1078.4053,1300.1759 -18.9254,72.1045 63.5341,98.1935 -7.2529,-45.8664 12.3418,-55.036 z"
              />
              <path
                className="wolf-eye"
                style={{ fill: "#00b7ff", fillOpacity: 1, stroke: "#000000", strokeWidth: 5.53937, strokeLinejoin: "round" }}
                d="m 1084.7809,1339.1557 -10.1405,29.493 28.9119,48.095 8.3907,-44.54 z"
              />
              <path
                style={{ fill: "#536079", fillOpacity: 1, stroke: "none" }}
                d="m 1209.2531,1555.9623 c -40.2229,6.5662 -82.5263,14.9342 -115.5975,-5.3198 l 5.5097,44.386 -43.0377,-62.0305 c -9.8201,80.772 -63.61216,139.5006 -108.46284,193.7513 94.79374,-40.9798 187.57564,-85.0918 261.58834,-170.787 z"
              />
            </g>
          </svg>
        </div>

        <h1
          className="mb-2 text-[44px] font-semibold uppercase text-[#e8eaf0]"
          style={{ letterSpacing: "0.35em", animation: "textIn 500ms cubic-bezier(0.16, 1, 0.3, 1) 600ms both" }}
        >
          LUMAFORGE
        </h1>
        <p
          className="mb-8 text-[15px] font-normal tracking-wide text-[#7a7f99]"
          style={{ animation: "fadeIn 400ms ease-out 800ms both" }}
        >
          Forge Your Library
        </p>
      </div>

      <p
        className={"text-sm font-medium transition-colors duration-300 " + statusColor}
        style={{ animation: "fadeIn 400ms ease-out 1000ms both" }}
      >
        {statusText}
      </p>
    </div>
  );
}
