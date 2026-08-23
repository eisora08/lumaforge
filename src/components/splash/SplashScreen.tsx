import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribe, getBootStatus, getBootProgress, getBootError } from "../../services/appBootCoordinator";

// Simple deterministic status cycle when we don't have per-task tracking
const STATUS_CYCLE: string[] = [
  "Loading settings...",
  "Migrating game data...",
  "Loading library...",
  "Loading achievements...",
  "Starting LumaForge...",
];

type SplashScreenProps = {
  wizardActive?: boolean;
};

export default function SplashScreen({ wizardActive = false }: SplashScreenProps) {
  const [visible, setVisible] = useState(true);
  const [statusText, setStatusText] = useState(STATUS_CYCLE[0]);
  const [progress, setProgress] = useState(0);
  const [statusColor, setStatusColor] = useState<string>("text-blue-400");
  const [fadeOut, setFadeOut] = useState(false);
  const hasClosedSplashRef = useRef(false);

  // Rotate through status messages approximately
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setStatusText((prev) => {
        const idx = STATUS_CYCLE.indexOf(prev);
        return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      });
      setProgress((p) => Math.min(85, p + 8));
    }, 2000);
    return () => clearInterval(interval);
  }, [visible]);

  // Close splash: fade overlay + optionally invoke Tauri command (once)
  function closeSplash() {
    if (hasClosedSplashRef.current) return;
    hasClosedSplashRef.current = true;

    console.log("[Boot] closing splash overlay", wizardActive ? "(wizard active — skipping close command)" : "");
    setFadeOut(true);

    // When wizard is active, don't invoke the close command — the wizard will handle it on completion
    if (!wizardActive) {
      invoke("close_splashscreen_and_show_main").catch((err: unknown) => {
        console.warn("[Boot] close splash command failed:", String(err));
      });
    }

    setTimeout(() => {
      setVisible(false);
    }, 400);
  }

  // Observe boot coordinator
  useEffect(() => {
    const unsub = subscribe(() => {
      const status = getBootStatus();
      setProgress(getBootProgress());

      if (status === "ready" || status === "timeout") {
        closeSplash();
      } else if (status === "error") {
        setStatusColor("text-amber-400");
        const err = getBootError();
        if (err) setStatusText(`Warning: ${err}`);
      }
    });
    return unsub;
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex select-none flex-col items-center justify-center transition-opacity duration-400 ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
      style={{
        backgroundColor: "#0b0b14",
      }}
    >
      {/* Logo / icon area */}
      <div className="mb-8 flex items-center gap-3">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-lg"
        >
          <rect width="48" height="48" rx="12" fill="#3b82f6" />
          <path
            d="M16 14C16 12.8954 16.8954 12 18 12H30C31.1046 12 32 12.8954 32 14V34C32 35.1046 31.1046 36 30 36H18C16.8954 36 16 35.1046 16 34V14Z"
            fill="white"
            fillOpacity="0.2"
          />
          <path
            d="M20 18C20 17.4477 20.4477 17 21 17H27C27.5523 17 28 17.4477 28 18V30C28 30.5523 27.5523 31 27 31H21C20.4477 31 20 30.5523 20 30V18Z"
            fill="white"
          />
          <rect x="22" y="20" width="4" height="2" rx="1" fill="#3b82f6" />
          <rect x="22" y="24" width="4" height="2" rx="1" fill="#3b82f6" />
        </svg>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          LumaForge
        </h1>
      </div>

      {/* Loading bar */}
      <div className="mb-4 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>

      {/* Status text */}
      <p className={`text-sm font-medium ${statusColor} transition-colors duration-300`}>
        {statusText}
      </p>
    </div>
  );
}
