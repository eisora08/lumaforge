import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Square, Maximize2, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { RunningGameSession } from "../../context/GameSessionContext";
import { getConsoleHeroBackground, getConsoleCardSrc, getConsoleLogoSrc } from "./consoleMedia";
import { playNavigateSound, playSelectSound, playOpenSound } from "../../services/soundEffectsService";

function useElapsedTime(launchedAt: number): number {
  const [elapsed, setElapsed] = useState(Date.now() - launchedAt);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - launchedAt), 1000);
    return () => clearInterval(id);
  }, [launchedAt]);
  return elapsed;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatStartTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type OverlayPhase = "entering" | "active" | "exiting";

type Props = {
  game: LibraryGame;
  session: RunningGameSession;
  returnTo: "grid" | "spotlight";
  onClose: () => void;
  onFocus: () => void;
  onContinue: () => void;
};

export default function ConsoleGameRunningOverlay({
  game,
  session,
  returnTo: _returnTo,
  onClose,
  onFocus,
  onContinue,
}: Props) {
  const { t } = useTranslation();
  const elapsed = useElapsedTime(session.launchedAt);
  const isLaunching = session.state === "launching";

  const heroSrc = getConsoleHeroBackground(game);
  const logoSrc = getConsoleLogoSrc(game);
  const posterSrc = getConsoleCardSrc(game, "poster");
  const title = session.title ?? game.title;

  const [phase, setPhase] = useState<OverlayPhase>("entering");
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const exitingRef = useRef(false);

  // Navigation — keyboard only (useConsoleGamepadInput dispatches ArrowLeft/Right as keyboard events)
  const buttonCount = isLaunching ? 1 : 3;
  const [activeButtonIndex, setActiveButtonIndex] = useState(2);

  // Clamp index when transitioning from launching to running
  useEffect(() => {
    if (!isLaunching && activeButtonIndex > 2) {
      setActiveButtonIndex(0);
    }
  }, [isLaunching, activeButtonIndex]);

  // Phase transitions
  useEffect(() => {
    if (phase === "entering") {
      playOpenSound();
      const timer = setTimeout(() => setPhase("active"), 800);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // Parallax mouse tracking
  useEffect(() => {
    if (phase !== "active") return;
    const handler = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 8;
      const y = (e.clientY / window.innerHeight - 0.5) * 8;
      setMousePos({ x, y });
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [phase]);

  // Exit handler with animation
  const handleExit = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setPhase("exiting");
    setTimeout(onContinue, 350);
  }, [onContinue]);

  // Execute action by index
  const executeByIndex = useCallback((idx: number) => {
    switch (idx) {
      case 0: onClose(); break;
      case 1: onFocus(); break;
      case 2: handleExit(); break;
    }
  }, [onClose, onFocus, handleExit]);

  // Keyboard navigation — useConsoleGamepadInput dispatches gamepad as keyboard events
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { playSelectSound(); handleExit(); }
      if (e.key === "ArrowLeft") { playNavigateSound(); setActiveButtonIndex((i) => Math.max(0, i - 1)); }
      if (e.key === "ArrowRight") { playNavigateSound(); setActiveButtonIndex((i) => Math.min(buttonCount - 1, i + 1)); }
      if (e.key === "Enter") {
        e.preventDefault();
        playSelectSound();
        // Read current index from functional updater to avoid stale state
        setActiveButtonIndex((current) => {
          executeByIndex(current);
          return current;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleExit, buttonCount, executeByIndex]);

  const bgStyle = useMemo(() => {
    if (phase === "entering") {
      return { transform: "scale(1)", filter: "blur(0px)" };
    }
    if (phase === "exiting") {
      return { transform: "scale(1)", filter: "blur(0px)", opacity: 0 };
    }
    return {
      transform: `scale(1.15) translate(${-mousePos.x}px, ${-mousePos.y}px)`,
      filter: "blur(8px)",
    };
  }, [phase, mousePos]);

  const contentStyle = useMemo(() => {
    if (phase === "entering") {
      return { opacity: 0, transform: "translateY(24px)" };
    }
    if (phase === "exiting") {
      return { opacity: 0, transform: "translateY(-12px)" };
    }
    return { opacity: 1, transform: "translateY(0)" };
  }, [phase]);

  const buttonRingClass = "ring-2 ring-white/60 ring-offset-2 ring-offset-transparent";

  return (
    <div className="fixed inset-0 z-[99999]">
      {/* Background with zoom transition */}
      <div
        className="absolute inset-0 transition-all ease-out"
        style={{
          ...bgStyle,
          transitionDuration: phase === "entering" ? "800ms" : phase === "exiting" ? "350ms" : "600ms",
          transitionTimingFunction: phase === "active" ? "cubic-bezier(0.16, 1, 0.3, 1)" : "ease-out",
        }}
      >
        {heroSrc ? (
          <img
            src={heroSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[#0a0a14] via-[#0d0d1a] to-[#0a0a14]" />
        )}
      </div>

      {/* Dark overlay */}
      <div
        className="absolute inset-0 transition-opacity duration-700 ease-out"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: phase === "active" ? "blur(8px)" : "blur(0px)",
          transitionDuration: phase === "entering" ? "700ms" : "350ms",
        }}
      />

      {/* Gradient overlay */}
      <div
        className="absolute inset-0 transition-opacity duration-700 ease-out"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 40%, rgba(0,0,0,0.4) 100%)",
          opacity: phase === "active" ? 1 : phase === "entering" ? 0.6 : 0,
        }}
      />

      {/* Light sweep on entering */}
      {phase === "entering" && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.06) 55%, transparent 70%)",
            animation: "console-shine-sweep 1s ease-in-out forwards",
          }}
        />
      )}

      {/* Content */}
      <div
        className="relative z-20 flex h-full flex-col items-center justify-center gap-5 px-4 transition-all"
        style={{
          ...contentStyle,
          transitionDuration: phase === "entering" ? "500ms" : "300ms",
          transitionDelay: phase === "entering" ? "300ms" : "0ms",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Game icon/logo — scale-in */}
        <div
          className="relative transition-all"
          style={{
            transform: phase === "active" ? "scale(1)" : "scale(0.85)",
            opacity: phase === "entering" ? 0 : 1,
            transitionDuration: "500ms",
            transitionDelay: phase === "entering" ? "200ms" : "0ms",
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={title}
              className="h-20 w-auto object-contain drop-shadow-2xl"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                const next = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement;
                if (next) next.style.display = "flex";
              }}
            />
          ) : null}
          <div
            className={`h-20 w-20 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20 ${logoSrc ? "hidden" : "flex"}`}
          >
            {posterSrc ? (
              <img src={posterSrc} alt="" className="h-full w-full rounded-2xl object-cover" />
            ) : (
              <span className="text-3xl">🎮</span>
            )}
          </div>
        </div>

        {/* Title */}
        <h2
          className="max-w-md text-center text-2xl font-bold text-white drop-shadow-lg transition-all"
          style={{
            opacity: phase === "active" ? 1 : 0,
            transform: phase === "active" ? "translateY(0)" : "translateY(12px)",
            transitionDuration: "400ms",
            transitionDelay: phase === "entering" ? "350ms" : "0ms",
          }}
        >
          {title}
        </h2>

        {/* Status */}
        <div
          className="flex items-center gap-3 transition-all"
          style={{
            opacity: phase === "active" ? 1 : 0,
            transform: phase === "active" ? "scale(1)" : "scale(0.9)",
            transitionDuration: "400ms",
            transitionDelay: phase === "entering" ? "450ms" : "0ms",
          }}
        >
          {isLaunching ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
              <span className="text-sm font-medium text-blue-400">
                {t("game_hero.launching", "Starting...")}
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-400 animate-pulse" />
              <span className="text-sm font-medium text-emerald-400">
                {t("game_hero.running", "Running")}
              </span>
            </>
          )}
        </div>

        {/* Info pills */}
        <div
          className="flex gap-3 transition-all"
          style={{
            opacity: phase === "active" ? 1 : 0,
            transform: phase === "active" ? "translateY(0)" : "translateY(10px)",
            transitionDuration: "400ms",
            transitionDelay: phase === "entering" ? "550ms" : "0ms",
          }}
        >
          <div className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm">
            <span className="text-white/50">{t("console_running.session_time", "Session")}: </span>
            <span className="tabular-nums">{formatElapsed(elapsed)}</span>
          </div>
          <div className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm">
            <span className="text-white/50">{t("console_running.game_start", "Started")}: </span>
            <span className="tabular-nums">{formatStartTime(session.launchedAt)}</span>
          </div>
        </div>

        {/* Action buttons — gamepad navigable, conditional on session state */}
        <div
          className="mt-2 flex gap-3"
          style={{
            opacity: phase === "active" ? 1 : 0,
            transform: phase === "active" ? "translateY(0)" : "translateY(10px)",
            transitionDuration: "400ms",
            transitionDelay: phase === "entering" ? "650ms" : "0ms",
          }}
        >
          {/* Close Game — only visible when running */}
          <button
            onClick={onClose}
            className={`flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-500/30 px-5 py-3 text-sm font-medium text-red-400 transition-all duration-300 hover:bg-red-500/30 hover:border-red-500/50 ${activeButtonIndex === 0 ? buttonRingClass : ""} ${isLaunching ? "pointer-events-none scale-90 opacity-0" : "scale-100 opacity-100"}`}
          >
            <Square className="h-4 w-4" />
            {t("console_running.close_game", "Close Game")}
          </button>

          {/* Focus Game — only visible when running */}
          <button
            onClick={onFocus}
            className={`flex items-center gap-2 rounded-xl bg-blue-500/20 border border-blue-500/30 px-5 py-3 text-sm font-medium text-blue-400 transition-all duration-300 hover:bg-blue-500/30 hover:border-blue-500/50 ${activeButtonIndex === 1 ? buttonRingClass : ""} ${isLaunching ? "pointer-events-none scale-90 opacity-0" : "scale-100 opacity-100"}`}
            style={{ transitionDelay: isLaunching ? "0ms" : "100ms" }}
          >
            <Maximize2 className="h-4 w-4" />
            {t("console_running.focus_game", "Focus Game")}
          </button>

          {/* Continue — always visible */}
          <button
            onClick={handleExit}
            className={`flex items-center gap-2 rounded-xl bg-white/10 border border-white/20 px-5 py-3 text-sm font-medium text-white/80 transition hover:bg-white/20 hover:text-white ${activeButtonIndex === 2 ? buttonRingClass : ""}`}
          >
            {t("console_running.continue", "Continue")}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
