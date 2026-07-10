import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import {
  Play, Square, Heart, Eye, Search, Image, RefreshCw, ExternalLink, Copy, ArrowLeft,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleInputHintStyle } from "./consoleSettings";
import { getConsoleInputHints } from "./consoleInputHints";
import { useFavorites } from "../../context/FavoritesContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { focusGameWindow } from "../../services/tauri";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { showError } from "../../components/toast/GameToast";

const FADE_DURATION = 180;

type Props = {
  game: LibraryGame;
  open: boolean;
  onClose: () => void;
  onOpenDetails?: () => void;
  onOpenSearch?: () => void;
  onPlayGame?: (game: LibraryGame) => void;
  inDetails: boolean;
  inputHints: ConsoleInputHintStyle;
};

export default function ConsoleGameOptionsOverlay({
  game, open, onClose, onOpenDetails, onOpenSearch, onPlayGame, inDetails, inputHints,
}: Props) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const sessionCtx = useGameSession();
  const gameKey = useMemo(() => computeGameKey(game), [game]);
  const sessionState = sessionCtx.getState(gameKey);
  const gameSession = sessionCtx.getSession(gameKey);
  const isLaunching = sessionState === "launching";
  const isRunning = sessionState === "running";
  const isStopping = sessionState === "stopping";
  const isFav = game?.appId ? favoriteIds.has(game.appId) : false;
  const hints = useMemo(() => getConsoleInputHints(inputHints), [inputHints]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Enter animation ── */
  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
  }, [open]);

  /* ── Reset focus index when game changes ── */
  useEffect(() => {
    setFocusIndex(0);
    setToastMsg(null);
  }, [game?.appId]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2000);
  }, []);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const handleFavToggle = useCallback(() => {
    if (game?.appId) toggleFavorite(game.appId);
  }, [game, toggleFavorite]);

  /* ── Row definitions ── */
  const rows = useMemo(() => {
    const list: {
      id: string;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      disabled?: boolean;
      action: () => void;
      highlight?: boolean;
    }[] = [];

    const action = getLauncherGamePrimaryAction(game);

    if (isRunning) {
      list.push({
        id: "stop",
        label: "Stop Game",
        icon: Square,
        action: () => {
          if (game?.appId) sessionCtx.stopGameByAppId(game.appId);
          onClose();
        },
      });
      if (gameSession?.pid != null) {
        list.push({
          id: "return",
          label: "Return to Game",
          icon: Play,
          action: () => {
            if (gameSession.pid != null) {
              focusGameWindow(gameSession.pid).catch(() => {
                showError("Game window could not be focused");
              });
            }
            onClose();
          },
        });
      }
    } else if (isLaunching) {
      list.push({
        id: "play",
        label: "Launching…",
        icon: Play,
        disabled: true,
        action: () => {},
      });
    } else if (isStopping) {
      list.push({
        id: "play",
        label: "Stopping…",
        icon: Square,
        disabled: true,
        action: () => {},
      });
    } else {
      const isPlayable = game.isPlayable && action === "play" && !isLaunching;
      list.push({
        id: "play",
        label: isPlayable ? "Play" : `Play (${action})`,
        icon: Play,
        disabled: !isPlayable,
        action: () => { if (isPlayable) { onPlayGame?.(game); onClose(); } },
        highlight: false,
      });
    }

    list.push({
      id: "favorite",
      label: isFav ? "Remove from Favorites" : "Add to Favorites",
      icon: Heart,
      action: handleFavToggle,
      highlight: isFav,
    });

    if (!inDetails && onOpenDetails) {
      list.push({
        id: "view-details",
        label: "View Details",
        icon: Eye,
        action: () => { onOpenDetails(); onClose(); },
      });
    }

    list.push({
      id: "search",
      label: "Search",
      icon: Search,
      action: () => { onOpenSearch?.(); onClose(); },
    });

    list.push({
      id: "manage-artwork",
      label: "Manage Artwork",
      icon: Image,
      disabled: true,
      action: () => showToast("Artwork management is available in Library for now"),
    });

    list.push({
      id: "check-update",
      label: "Check Update",
      icon: RefreshCw,
      disabled: true,
      action: () => showToast("Use Library details for update checks for now"),
    });

    list.push({
      id: "open-steam",
      label: "Open Steam Page",
      icon: ExternalLink,
      action: () => { window.open(`steam://store/${game.appId}`, "_blank"); onClose(); },
    });

    list.push({
      id: "copy-appid",
      label: "Copy App ID",
      icon: Copy,
      action: () => {
        navigator.clipboard.writeText(game?.appId ?? "").catch(() => {});
        showToast("App ID copied!");
      },
    });

    list.push({
      id: "back",
      label: "Back",
      icon: ArrowLeft,
      action: onClose,
    });

    return list;
  }, [isFav, inDetails, onOpenDetails, game, handleFavToggle, showToast, onClose, onPlayGame, isLaunching, isRunning, isStopping, gameSession, sessionCtx]);

  /* ── Clamp focus index after rows change ── */
  useEffect(() => {
    setFocusIndex((prev) => Math.min(prev, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  /* ── Keyboard navigation ── */
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((i) => (i > 0 ? i - 1 : rows.length - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((i) => (i < rows.length - 1 ? i + 1 : 0));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          {
            const row = rows[focusIndex];
            if (row && !row.disabled) row.action();
          }
          break;
        case "Escape":
        case "o":
        case "O":
        case "ContextMenu":
        case "Apps":
          e.preventDefault();
          onClose();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, rows, focusIndex, onClose]);

  /* ── Render helpers ── */
  const overlayOpacity = visible ? 1 : 0;

  const iconForRow = (RowIcon: React.ComponentType<{ className?: string }>, highlight?: boolean) => (
    <RowIcon className={`h-5 w-5 ${highlight ? "text-rose-400" : "text-(--color-muted)"}`} />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Game options"
      className="fixed inset-0 z-[200] flex items-start justify-center"
      style={{
        transition: `opacity ${FADE_DURATION}ms ease`,
        opacity: overlayOpacity,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Toast */}
      {toastMsg && (
        <div className="pointer-events-none fixed left-1/2 top-[15%] z-[300] -translate-x-1/2 rounded-lg bg-amber-600/85 px-5 py-2.5 text-sm font-medium text-white shadow-xl backdrop-blur-sm">
          {toastMsg}
        </div>
      )}

      {/* Panel */}
      <div
        className="relative mt-[clamp(60px,8vh,120px)] w-[clamp(320px,28vw,420px)] rounded-2xl border border-(--color-border)/30 bg-(--color-surface)/90 shadow-2xl shadow-black/50 backdrop-blur-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        style={{
          transition: `transform ${FADE_DURATION}ms ease, opacity ${FADE_DURATION}ms ease`,
          transform: visible ? "translateY(0)" : "translateY(-12px)",
          opacity: overlayOpacity,
        }}
      >
        {/* Header */}
        <div className="border-b border-(--color-border)/20 px-5 py-4">
          <h2 className="text-base font-bold text-(--color-text) truncate">{game?.title ?? "Game Options"}</h2>
          <p className="text-xs text-(--color-muted) mt-0.5">
            {game?.appId ? `App ID: ${game.appId}` : "\u00a0"}
          </p>
        </div>

        {/* Rows */}
        <div className="max-h-[55vh] overflow-y-auto py-2 px-2 space-y-0.5 scrollbar-thin scrollbar-thumb-(--color-border)/20">
          {rows.map((row, i) => {
            const focused = focusIndex === i;
            return (
              <button
                key={row.id}
                type="button"
                disabled={row.disabled}
                onMouseEnter={() => setFocusIndex(i)}
                onClick={() => { if (!row.disabled) row.action(); }}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none transition-all duration-100 ${
                  focused
                    ? "bg-(--color-accent)/15 ring-1 ring-(--color-accent)/40"
                    : "hover:bg-(--color-surface)/40"
                } ${row.disabled ? "opacity-40 cursor-default" : "cursor-pointer"}`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {iconForRow(row.icon, row.highlight)}
                </span>
                <span className={`flex-1 text-sm font-medium ${
                  row.highlight ? "text-rose-400" : "text-(--color-text)"
                }`}>
                  {row.label}
                </span>
                {row.disabled && (
                  <span className="text-[10px] text-(--color-muted)/50 uppercase tracking-wider">No-op</span>
                )}
                {row.highlight && (
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint bar */}
        <div className="border-t border-(--color-border)/20 px-5 py-3">
          <div className="flex items-center justify-center gap-4">
            <HintPill label={hints.select} primary />
            <HintPill label={hints.back} />
            <HintPill label={hints.navigate} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HintPill({ label, primary }: { label: string; primary?: boolean }) {
  const m = label.match(/^\[(.+?)\]\s*(.*)$/);
  if (!m) return <span className="text-xs text-(--color-muted)/60">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)/70">
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold leading-none ${
        primary
          ? "bg-(--color-accent) text-white"
          : "bg-white/[0.09] text-white/60"
      }`}>
        {m[1]}
      </span>
      <span>{m[2]}</span>
    </span>
  );
}
