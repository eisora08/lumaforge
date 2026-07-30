import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import {
  Play, Square, Heart, Eye, Search, Edit, RefreshCw, ExternalLink, Copy, ArrowLeft, Trash2,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleInputHintStyle } from "./consoleSettings";
import { getConsoleInputHints } from "./consoleInputHints";
import { useConsoleGamepadInput, DEBUG_CONSOLE_GAMEPAD } from "./useConsoleGamepadInput";
import { useFavorites } from "../../context/FavoritesContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { focusGameWindow } from "../../services/tauri";
import { showError, showSuccess, showInfo } from "../../components/toast/GameToast";
import GameEditDialog from "../../components/games/GameEditDialog";
import { useSettings } from "../../context/SettingsContext";
import { removeManualGame, normalizeManualGameId } from "../../services/manualGameStore";
import {
  getConsoleGameActionModel, isInFlight, type ConsolePrimaryAction, type ConsoleGameActionModel,
} from "./consoleGameActions";

const FADE_DURATION = 180;
const DEBUG_MANUAL_REMOVE = false;

type Props = {
  game: LibraryGame;
  open: boolean;
  onClose: () => void;
  onOpenDetails?: () => void;
  onOpenSearch?: () => void;
  onPlayGame?: (game: LibraryGame) => void;
  onAction?: (action: ConsolePrimaryAction) => void;
  onRemoveManual?: (game: LibraryGame) => void;
  inDetails: boolean;
  inputHints: ConsoleInputHintStyle;
};

export default function ConsoleGameOptionsOverlay({
  game, open, onClose, onOpenDetails, onOpenSearch, onPlayGame, onAction, onRemoveManual, inDetails, inputHints,
}: Props) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const sessionCtx = useGameSession();
  const { settings } = useSettings();
  const gameKey = useMemo(() => computeGameKey(game), [game]);
  const sessionState = sessionCtx.getState(gameKey);
  const gameSession = sessionCtx.getSession(gameKey);
  const isLaunching = sessionState === "launching";
  const isRunning = sessionState === "running";
  const isStopping = sessionState === "stopping";
  const isFav = game ? favoriteIds.has(game.appId || game.id) : false;
  const hints = useMemo(() => getConsoleInputHints(inputHints), [inputHints]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    setConfirmDelete(false);
  }, [game?.appId || game?.id]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2000);
  }, []);

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  const handleFavToggle = useCallback(() => {
    if (game) toggleFavorite(game.appId || game.id);
  }, [game, toggleFavorite]);

  /* ── Shared action model — single source of truth ── */
  const actionModel = useMemo<ConsoleGameActionModel | null>(
    () => (game ? getConsoleGameActionModel(game) : null),
    [game],
  );

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

    const inFlight = game.appId ? isInFlight(game.appId) : false;
    const model = actionModel;

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
      // Play row always shows "Play"; disabled when Library says not playable
      const isPlayable = model?.baseAction === "play";
      const playEnabled = isPlayable && !isLaunching;
      list.push({
        id: "play",
        label: "Play",
        icon: Play,
        disabled: !playEnabled,
        action: () => { if (playEnabled) { onPlayGame?.(game); onClose(); } },
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
      icon: Edit,
      disabled: false,
      action: () => { setEditDialogOpen(true); },
    });

    // Install row — from shared model (never disagrees with primary button)
    if (model?.showInstallRow) {
      list.push({
        id: "install",
        label: "Install",
        icon: RefreshCw,
        disabled: inFlight || !model.installRowEnabled,
        action: () => { if (model.installRowEnabled) { onAction?.("install"); onClose(); } },
      });
      // Show disabled reason badge for Install when not executable
      if (!model.installRowEnabled && model.installRowReason) {
        // reason shown as label suffix through no-op badge
      }
    }

    // Update Available row — from shared model
    if (model?.showUpdateRow) {
      list.push({
        id: "update",
        label: "Update Available",
        icon: RefreshCw,
        disabled: inFlight,
        action: () => { onAction?.("update"); onClose(); },
        highlight: true,
      });
    }

    // Check Update row — from shared model
    if (model?.showCheckUpdateRow) {
      list.push({
        id: "check-update",
        label: "Check Update",
        icon: Search,
        disabled: inFlight,
        action: () => { onAction?.("check-update"); onClose(); },
      });
    }

    // Up to Date row — from shared model
    if (model?.showUpToDateRow) {
      list.push({
        id: "up-to-date",
        label: "Up to Date",
        icon: RefreshCw,
        disabled: true,
        action: () => {},
      });
    }

    // Blocked row — from shared model
    if (model?.showBlockedRow && model.blockedRowReason) {
      list.push({
        id: "blocked",
        label: model.blockedRowReason,
        icon: RefreshCw,
        disabled: true,
        action: () => {},
      });
    }

    list.push({
      id: "open-steam",
      label: game.appId ? "Open Steam Page" : "Open Game Folder",
      icon: ExternalLink,
      action: () => {
        if (game.appId) {
          window.open(`steam://store/${game.appId}`, "_blank");
        } else if (game.executablePath) {
          const path = game.executablePath.replace(/[\\\/][^\\\/]+$/, "");
          import("@tauri-apps/plugin-opener").then(({ openPath }) => openPath(path));
        }
        onClose();
      },
    });

    list.push({
      id: "copy-appid",
      label: game.appId ? "Copy App ID" : "Copy Game ID",
      icon: Copy,
      action: () => {
        navigator.clipboard.writeText(game?.appId || game?.id || "").catch(() => {});
        showToast(game.appId ? "App ID copied!" : "Game ID copied!");
      },
    });

    if (game.source === "debrid") {
      list.push({
        id: "debrid-remove",
        label: "Remove from Library",
        icon: Trash2,
        action: () => {
          showInfo("Debrid catalog entries managed by the repack catalog. Disable the Debrid integration in Settings > Integrations to remove all entries.", { title: "Debrid" });
          onClose();
        },
      });
    }

    if (game.source === "manual" && !isRunning) {
      if (confirmDelete) {
        list.push({
          id: "confirm-remove",
          label: "Confirm Remove",
          icon: Trash2,
          action: () => {
            const rawId = normalizeManualGameId(game.providerGameId || game.id || "");
            if (rawId) {
              if (DEBUG_MANUAL_REMOVE) console.log(`[MANUAL_REMOVE][CONSOLE] rawId=${rawId} title="${game.title}"`);
              removeManualGame(rawId);
              showSuccess(`"${game.title ?? rawId}" removed from library`);
            }
            onRemoveManual?.(game);
            onClose();
          },
          highlight: true,
        });
      } else {
        list.push({
          id: "remove-manual",
          label: "Remove from Library",
          icon: Trash2,
          action: () => { setConfirmDelete(true); },
        });
      }
    }

    list.push({
      id: "back",
      label: "Back",
      icon: ArrowLeft,
      action: onClose,
    });

    return list;
  }, [isFav, inDetails, onOpenDetails, game, handleFavToggle, showToast, onClose, onPlayGame, onAction, onRemoveManual, isLaunching, isRunning, isStopping, gameSession, sessionCtx, actionModel, confirmDelete]);

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
      if (DEBUG_CONSOLE_GAMEPAD) {
        console.log(`[CONSOLE_GAMEPAD][HANDLER_RECEIVED] key=${e.key} location=ConsoleGameOptionsOverlay target=${(e.target as any)?.tagName ?? typeof e.target}`);
      }
      if (!activeRef.current) return;
      // Yield to the GameEditDialog when open (dialog has own Escape/Enter handlers)
      if (editDialogOpen) return;
      if (e.key === "Alt" || e.key === "Meta") return;
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
          e.preventDefault();
          onClose();
          break;
        // V/View is reserved for Profile/Quick Menu — ignore in options context
        case "v":
        case "V":
          e.preventDefault();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, rows, focusIndex, onClose]);

  /* ── Gamepad input ── */
  useConsoleGamepadInput(open);

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

      {(game.appId || game.id) && (
        <GameEditDialog
          appId={game.appId}
          manualGameId={game.source === "manual" ? game.providerGameId : undefined}
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          initialTab="media"
          settings={{
            rawgApiKey: settings.rawgApiKey,
            igdbClientId: settings.igdbClientId,
            igdbClientSecret: settings.igdbClientSecret,
            steamGridDbApiKey: settings.steamGridDbApiKey,
            steamGridDbArtworkEnabled: settings.steamGridDbArtworkEnabled,
            googleSearchApiKey: (settings as Record<string, unknown>).googleSearchApiKey as string,
            googleSearchCx: (settings as Record<string, unknown>).googleSearchCx as string,
            bingSearchApiKey: (settings as Record<string, unknown>).bingSearchApiKey as string,
          }}
        />
      )}
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
          ? "bg-(--color-accent) text-(--color-accent-text)"
          : "bg-white/[0.09] text-white/60"
      }`}>
        {m[1]}
      </span>
      <span>{m[2]}</span>
    </span>
  );
}
