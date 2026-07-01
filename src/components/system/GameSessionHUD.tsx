import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Play, Square } from "lucide-react";
import { useGameSession } from "../../context/GameSessionContext";
import { getMediaPaths } from "../../services/gameDataService";
import { focusGameWindow } from "../../services/tauri";
import { showError } from "../toast/GameToast";
import type { AppPage } from "../../types/navigation";

function useElapsedTime(startedAt: number | undefined): string {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (startedAt == null) {
      setElapsed("");
      return;
    }

    const update = () => {
      const diff = Date.now() - startedAt;
      const totalSec = Math.floor(diff / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };

    setElapsed(update());
    const id = setInterval(() => setElapsed(update()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return elapsed;
}

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function GameSessionHUD({ onNavigate: _onNavigate }: Props) {
  const { sessions, stopSession } = useGameSession();
  const [hovered, setHovered] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [renderPhase, setRenderPhase] = useState<"hidden" | "visible" | "exiting">("hidden");
  const fetchRef = useRef<string | undefined>(undefined);
  const prevKeyRef = useRef<string | undefined>(undefined);

  const activeSession = useMemo(() => {
    for (const s of Object.values(sessions)) {
      if (s.state === "running" || s.state === "launching") return s;
    }
    return undefined;
  }, [sessions]);

  useLayoutEffect(() => {
    const key = activeSession?.gameKey;
    if (key && !prevKeyRef.current) {
      setRenderPhase("visible");
    } else if (!key && prevKeyRef.current) {
      setRenderPhase("exiting");
      const timer = setTimeout(() => {
        setRenderPhase("hidden");
      }, 300);
      prevKeyRef.current = undefined;
      return () => clearTimeout(timer);
    }
    prevKeyRef.current = key;
  }, [activeSession?.gameKey]);

  useEffect(() => {
    const appId = activeSession?.appId;
    if (!appId) {
      setImageUrl(null);
      fetchRef.current = undefined;
      return;
    }

    if (fetchRef.current === appId) return;
    fetchRef.current = appId;

    setImageUrl(null);
    getMediaPaths(appId).then((media) => {
      if (fetchRef.current === appId) {
        setImageUrl(media?.landscape ?? media?.cover ?? null);
      }
    });

    return () => {
      fetchRef.current = undefined;
    };
  }, [activeSession?.appId]);

  const elapsed = useElapsedTime(activeSession?.launchedAt);
  const isLaunching = activeSession?.state === "launching";

  const handleStop = useCallback(() => {
    if (activeSession) stopSession(activeSession.gameKey);
  }, [activeSession, stopSession]);

  const handleResume = useCallback(async () => {
    if (!activeSession) return;
    const pid = activeSession.pid;
    if (pid == null) return;
    try {
      await focusGameWindow(pid);
    } catch {
      showError("Could not focus game window");
    }
  }, [activeSession]);

  if (renderPhase === "hidden") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-5 z-[99999] flex justify-center">
      <div
        className={`pointer-events-auto origin-center ${
          renderPhase === "exiting" ? "lf-hud-exit" : "lf-hud-entry"
        }`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className={`flex items-center gap-3 rounded-full border border-white/10 bg-black/60 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-out ${
            hovered
              ? "scale-105 bg-black/75 px-5 py-2.5"
              : "scale-100 px-4 py-2"
          }`}
        >
          {/* Artwork / Icon */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setImageUrl(null)}
              />
            ) : (
              <Gamepad2 className="h-4 w-4 text-white/60" />
            )}
          </div>

          {/* Title + Elapsed */}
          <div className="flex flex-col leading-tight">
            <span className="max-w-[140px] truncate text-sm font-medium text-white">
              {activeSession?.title || "Unknown Game"}
            </span>
            {!isLaunching && (
              <span className="tabular-nums text-xs text-white/50">
                {elapsed}
              </span>
            )}
          </div>

          {/* Hover actions */}
          <div
            className={`flex items-center gap-2 overflow-hidden transition-all duration-300 ease-out ${
              hovered ? "ml-1 w-auto opacity-100" : "w-0 opacity-0"
            }`}
          >
            {/* Resume */}
            <button
              onClick={handleResume}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-90"
              aria-label="Resume game"
            >
              <Play className="h-3 w-3 ml-0.5 fill-current" />
            </button>

            {/* Stop */}
            <button
              onClick={handleStop}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--color-accent) text-black transition hover:bg-(--color-accent)/80 active:scale-90"
              aria-label="Stop game"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
