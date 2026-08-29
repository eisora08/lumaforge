import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Square, Maximize2 } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { RunningGameSession } from "../../context/GameSessionContext";
import { getConsoleHeroBackground, getConsoleCardSrc } from "./consoleMedia";

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

type Props = {
  session: RunningGameSession;
  game: LibraryGame | undefined;
  onFocus: () => void;
  onClose: () => void;
};

export default function ConsoleRunningIndicator({ session, game, onFocus, onClose }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsedTime(session.launchedAt);
  const [modalPos, setModalPos] = useState({ top: 0, left: 0 });

  const heroSrc = game ? (getConsoleHeroBackground(game) ?? getConsoleCardSrc(game, "landscape")) : null;
  const title = session.title ?? game?.title ?? "Game";

  const handleToggle = useCallback(() => {
    if (!expanded && pillRef.current) {
      const rect = pillRef.current.getBoundingClientRect();
      setModalPos({ top: rect.bottom + 8, left: rect.right - 288 }); // 288 = w-72 (18rem * 16)
    }
    setExpanded((prev) => !prev);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modalRef.current && !modalRef.current.contains(e.target as Node) &&
        pillRef.current && !pillRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [expanded]);

  return (
    <>
      {/* Pill button */}
      <button
        ref={pillRef}
        onClick={handleToggle}
        className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 backdrop-blur-sm transition hover:bg-emerald-500/20 hover:border-emerald-500/50"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="max-w-[120px] truncate">{title}</span>
        <span className="tabular-nums text-emerald-400/70">{formatElapsed(elapsed)}</span>
      </button>

      {/* Mini modal — portal renders outside stacking contexts */}
      {expanded && createPortal(
        <div
          ref={modalRef}
          className="fixed z-[99999] w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d12]/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
          style={{ top: modalPos.top, left: modalPos.left }}
        >
          {/* Game image */}
          {heroSrc && (
            <div className="relative h-28 w-full overflow-hidden">
              <img
                src={heroSrc}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d12] via-transparent to-transparent" />
            </div>
          )}

          {/* Content */}
          <div className="px-4 pb-4">
            {/* Title + badge */}
            <div className="mb-3 flex items-center gap-2">
              <h3 className="truncate text-sm font-bold text-white">{title}</h3>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                {t("game_hero.running", "Running")}
              </span>
            </div>

            {/* Info cards */}
            <div className="mb-3 flex gap-2">
              <div className="flex-1 rounded-lg bg-white/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  {t("console_running.session_time", "Session Time")}
                </p>
                <p className="text-sm font-semibold tabular-nums text-white">{formatElapsed(elapsed)}</p>
              </div>
              <div className="flex-1 rounded-lg bg-white/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  {t("console_running.game_start", "Game Start")}
                </p>
                <p className="text-sm font-semibold tabular-nums text-white">{formatStartTime(session.launchedAt)}</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => { onFocus(); setExpanded(false); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-500/20 px-3 py-2 text-xs font-medium text-blue-400 transition hover:bg-blue-500/30"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                {t("console_running.focus_game", "Focus Game")}
              </button>
              <button
                onClick={() => { onClose(); setExpanded(false); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500/20 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/30"
              >
                <Square className="h-3.5 w-3.5" />
                {t("console_running.close_game", "Close Game")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
