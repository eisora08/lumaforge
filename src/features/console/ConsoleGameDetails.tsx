import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import {
  ArrowLeft, Trophy, Heart, Gamepad2, Play, Square, Clock, HardDrive, CheckCircle2,
  Star, Languages, Layers, Download, RefreshCw, Search,
} from "lucide-react";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleSettings } from "./consoleSettings";
import type { StoreMediaItem, StoreTrailerMedia } from "../../types/store";
import { useFavorites } from "../../context/FavoritesContext";
import { useTheme } from "../../context/ThemeContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { getPlaytimeSecondsForAppId, getPlaytimeSecondsByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";
import { buildStoreMedia } from "../../services/storeMediaService";
import { getConsoleHeroBackground, getConsoleCardSrc, getConsoleLogoSrc } from "./consoleMedia";
import { useConsoleAchievements, useConsoleReviews } from "./useConsoleGameDetailsData";
import { useSettings } from "../../context/SettingsContext";
import {
  formatRelativeTime,
  formatPlaytime,
  getGameDiskSize,
  getGameLastPlayedTimestamp,
} from "./consoleGameStats";
import ConsoleMediaGallery from "./ConsoleMediaGallery";
import ConsoleSelectedPreview from "./ConsoleSelectedPreview";
import ConsoleGameOptionsOverlay from "./ConsoleGameOptionsOverlay";
import ConsoleInstallModal from "./ConsoleInstallModal";
import { getConsoleInputHints } from "./consoleInputHints";
import type { TrailerData } from "./consoleTrailerData";
import { resolveConsoleDetailsArtwork, clearConsoleArtworkCache, consoleArtworkToBundle } from "./consoleArtworkResolver";
import type { ConsoleArtwork, ConsoleArtworkOptions } from "./consoleArtworkResolver";
import { stripHtml } from "../../utils/stripHtml";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { focusGameWindow } from "../../services/tauri";
import { showWarning, showError } from "../../components/toast/GameToast";
import { useConsoleGamepadInput, DEBUG_CONSOLE_GAMEPAD } from "./useConsoleGamepadInput";
import { handleConsolePrimaryAction, getConsoleGameActionModel, isInFlight, type ConsolePrimaryAction, type ConsoleGameActionModel } from "./consoleGameActions";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";

const DEBUG = false;
const DEBUG_CONSOLE_PLAY = false;
const DEBUG_CONSOLE_DETAILS_ACTION = false;

function getBlockedReason(action: string): string {
  switch (action) {
    case "install": return "Install required";
    case "update": return "Update required";
    case "download": return "Download required";
    case "missing-path": return "Game files missing";
    case "uninstalling": return "Game is being uninstalled";
    case "open-steam": return "Open in Steam to play";
    case "open-lua-folder": return "Configure Lua script to play";
    default: return "This game is not playable yet";
  }
}
const ENTER_DURATION = 280;
const EXIT_DURATION = 200;
const ENTER_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const EXIT_EASING = "ease-in";

const _prefersReducedMotion = typeof window !== "undefined"
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

/* ══════════════════════════════════════════
   FOCUS ZONE MODEL
   ══════════════════════════════════════════ */
type FocusZone =
  | "back-button"
  | "left-actions"
  | "left-info"
  | "media-preview"
  | "media-carousel"
  | "info-cards"
  | "footer-actions";

type InfoCardSide = "achievements" | "reviews";

type Props = {
  game: LibraryGame;
  onClose: () => void;
  settings: ConsoleSettings;
  onSearchOpen?: () => void;
  onPlayGame?: (game: LibraryGame) => void;
  onProfileOpen?: () => void;
  /** When true, gamepad input is yielded to a higher-priority overlay (e.g. Search) */
  gamepadDisabled?: boolean;
  /** When true, Quick Menu is open and owns all input */
  quickMenuOpen?: boolean;
};

/* ── Media helpers ── */
function getPreferredSrc(item: StoreTrailerMedia): string | undefined {
  return item.mp4 || item.webm || item.hls_h264 || item.dash_h264 || item.dash_av1 || item.hls || item.dash || undefined;
}

function getPlayType(item: StoreTrailerMedia): TrailerData["playableType"] {
  if (item.mp4 || item.webm) return "direct";
  if (item.hls_h264 || item.hls) return "hls";
  if (item.dash_h264 || item.dash_av1 || item.dash) return "dash";
  return "none";
}

function mediaItemToTrailerData(item: StoreTrailerMedia): TrailerData {
  const playableUrl = getPreferredSrc(item);
  const playableType = getPlayType(item);
  const hasDirectVideo = !!(item.mp4 || item.webm);
  const hasStreamFallback = !hasDirectVideo && !!(item.hls_h264 || item.hls || item.dash_h264 || item.dash_av1 || item.dash);
  return {
    thumbnail: item.poster || item.thumbnail || null,
    mp4Url: item.mp4 || null,
    webmUrl: item.webm || null,
    hlsUrl: item.hls || null,
    hls_h264: item.hls_h264 || null,
    dash_h264: item.dash_h264 || null,
    dash_av1: item.dash_av1 || null,
    playableUrl: playableUrl || null,
    playableType,
    hasTrailer: hasDirectVideo || hasStreamFallback,
    movieCount: 1,
    hasDirectVideo,
    hasStreamFallback,
  };
}

/* ── Review score color mapping ── */
const REVIEW_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Overwhelmingly Positive": { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/20" },
  "Very Positive": { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/20" },
  "Mostly Positive": { bg: "bg-teal-500/15", text: "text-teal-400", border: "border-teal-500/20" },
  Positive: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/20" },
  Mixed: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/20" },
  "Mostly Negative": { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/20" },
  Negative: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/20" },
  "Very Negative": { bg: "bg-rose-500/15", text: "text-rose-400", border: "border-rose-500/20" },
  "Overwhelmingly Negative": { bg: "bg-rose-700/20", text: "text-rose-300", border: "border-rose-700/20" },
};
const DEFAULT_REVIEW_COLOR = { bg: "bg-white/5", text: "text-(--color-muted)", border: "border-white/[0.04]" };

export default function ConsoleGameDetails({ game, onClose, settings, onSearchOpen, onPlayGame, onProfileOpen, gamepadDisabled = false, quickMenuOpen = false }: Props) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { surfaceMode } = useTheme();
  const { settings: appSettings } = useSettings();
  const sessionCtx = useGameSession();
  const gameKey = useMemo(() => computeGameKey(game), [game]);
  const sessionState = sessionCtx.getState(gameKey);
  const gameSession = sessionCtx.getSession(gameKey);
  const isLaunching = sessionState === "launching";
  const isRunning = sessionState === "running";
  const isStopping = sessionState === "stopping";
  const hints = useMemo(() => getConsoleInputHints(settings.inputHints), [settings.inputHints]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");
  const reducedMotion = _prefersReducedMotion;

  /* ══════════════════════════════════════════
     FOCUS ZONE STATE
     ══════════════════════════════════════════ */
  const [focusZone, setFocusZone] = useState<FocusZone>("media-preview");
  const [carouselFocusIndex, setCarouselFocusIndex] = useState<number>(0);
  const [carouselSelectedIndex, setCarouselSelectedIndex] = useState<number>(0);

  /* ── Reset carousel index when game changes ── */
  useEffect(() => {
    setCarouselSelectedIndex(0);
  }, [game?.appId]);
  const [infoCardSide, setInfoCardSide] = useState<InfoCardSide>("achievements");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [leftActionSubIndex, setLeftActionSubIndex] = useState(0);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const installModalClosedAtRef = useRef(0);
  const BOUNCE_GUARD_MS = 400;

  /* ── Multi-source artwork enrichment ── */
  const [artwork, setArtwork] = useState<ConsoleArtwork | null>(null);
  const _pendingArtworkRef = useRef<string | null>(null);

  useEffect(() => {
    const appId = game?.appId;

    // Manual games (no appId): build artwork from _consoleMedia (resolved URLs)
    if (!appId) {
      const cm = (game as { _consoleMedia?: { coverSrc?: string | null; landscapeSrc?: string | null; backgroundSrc?: string | null; logoSrc?: string | null; heroSrc?: string | null } } | null)?._consoleMedia;
      if (cm && (cm.coverSrc || cm.heroSrc)) {
        setArtwork({
          coverSrc: cm.coverSrc ?? null,
          landscapeSrc: cm.landscapeSrc ?? null,
          backgroundSrc: cm.backgroundSrc ?? null,
          logoSrc: cm.logoSrc ?? null,
          heroSrc: cm.heroSrc ?? cm.coverSrc ?? null,
          coverSource: "local-cached",
          heroSource: "local-cached",
          logoSource: cm.logoSrc ? "local-cached" : "none",
        });
      } else {
        setArtwork(null);
      }
      return;
    }

    setArtwork(null);
    _pendingArtworkRef.current = appId;

    const opts: ConsoleArtworkOptions = {
      sgdbApiKey: appSettings.steamGridDbApiKey,
      rawgApiKey: appSettings.rawgApiKey,
      igdbClientId: appSettings.igdbClientId,
      igdbClientSecret: appSettings.igdbClientSecret,
      useSteamGridDb: settings.useSteamGridDb,
      useRawg: settings.useRawg,
      useIgdb: settings.useIgdb,
    };

    resolveConsoleDetailsArtwork(game, opts).then((a) => {
      if (_pendingArtworkRef.current !== appId) {
        if (DEBUG) console.log(`[CONSOLE][ARTWORK_STALE] appId=${appId} current=${_pendingArtworkRef.current} reason=stale-result`);
        return;
      }
      setArtwork(a);
    });

    return () => {
      clearConsoleArtworkCache(appId!);
    };
  }, [game?.appId]);

  /* ── Normalized media bundle ── */
  const mediaBundle = useMemo(() => {
    if (!game?.appId) return null;
    if (!artwork) return null;
    return consoleArtworkToBundle(game.appId, artwork);
  }, [game, artwork]);

  /* ══════════════════════════════════════════
     UNIFIED MEDIA: carousel items
     ══════════════════════════════════════════ */
  const mediaItems = useMemo<StoreMediaItem[]>(() => {
    if (!game?.metadata) return [];
    return buildStoreMedia(game.metadata);
  }, [game?.metadata]);

  /* ── Selected media item → trailerData / screenshotOverrideUrl ── */
  const currentMedia = mediaItems[carouselSelectedIndex] ?? null;
  const isCurrentTrailer = currentMedia?.type === "trailer";

  const trailerData = useMemo<TrailerData | null>(() => {
    if (!isCurrentTrailer || !currentMedia) return null;
    return mediaItemToTrailerData(currentMedia as StoreTrailerMedia);
  }, [isCurrentTrailer, currentMedia]);

  const screenshotOverrideUrl = useMemo<string | null>(() => {
    if (!currentMedia || currentMedia.type !== "screenshot") return null;
    return currentMedia.image;
  }, [currentMedia]);

  /* ── Player mode: "details" for playable trailers, "thumbnail" for screenshots / unsupported ── */
  const playerMode = useMemo<"thumbnail" | "details">(() => {
    if (!isCurrentTrailer || !trailerData) return "thumbnail";
    return trailerData.playableType !== "none" ? "details" : "thumbnail";
  }, [isCurrentTrailer, trailerData]);

  /* ── Is the current trailer playable (not just a thumbnail with no video)? ── */
  const hasPlayableVideo = playerMode === "details" && trailerData?.playableType !== "none";

  /* ── Media identity key — changes on every carousel selection to force clean video remount ── */
  const mediaIdentityKey = useMemo(() => {
    return `${game?.appId ?? "?"}-${carouselSelectedIndex}-${currentMedia?.type ?? "none"}`;
  }, [game?.appId, carouselSelectedIndex, currentMedia?.type]);

  /* ── Enter animation ── */
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("visible"));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Close options overlay on game change ── */
  useEffect(() => {
    setOptionsOpen(false);
  }, [game?.appId]);

  const handleClose = useCallback(() => {
    if (phase === "exit") return;
    setPhase("exit");
    setTimeout(() => onClose(), EXIT_DURATION + 20);
  }, [phase, onClose]);

  /* ── Session action handlers ── */
  const handlePlay = useCallback(() => {
    if (!game) return;
    if (isRunning && game.appId) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][DETAILS_STOP] appid=${game.appId}`);
      sessionCtx.stopGameByAppId(game.appId).catch(() => {});
      return;
    }
    if (isLaunching || isStopping) return;
    const action = getLauncherGamePrimaryAction(game);
    if (action !== "play" || !game.isPlayable) {
      if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][DETAILS_BLOCKED] appid=${game.appId ?? "manual"} action=${action}`);
      showWarning(getBlockedReason(action), { id: `console-details-blocked-${game.appId ?? game.id}`, duration: 3000 });
      return;
    }
    onPlayGame?.(game);
  }, [game, onPlayGame, isLaunching, isRunning, isStopping, sessionCtx]);

  const handleStop = useCallback(() => {
    if (!game?.appId) return;
    if (DEBUG_CONSOLE_PLAY) console.log(`[CONSOLE_PLAY][DETAILS_STOP] appid=${game.appId}`);
    sessionCtx.stopGameByAppId(game.appId).catch(() => {});
  }, [game, sessionCtx]);

  const handleReturn = useCallback(async () => {
    if (!gameSession?.pid) return;
    try {
      await focusGameWindow(gameSession.pid);
    } catch {
      showError("Game window could not be focused");
    }
  }, [gameSession]);

  /* ── Shared action model — single source of truth ── */
  const actionModel = useMemo<ConsoleGameActionModel | null>(
    () => (game ? getConsoleGameActionModel(game) : null),
    [game],
  );
  const actionInFlight = game?.appId ? isInFlight(game.appId) : false;
  const { addJob, updateJob } = useDownloadQueueContext();
  const libCtx = useLibraryGames();
  const _mountedRef = useRef(true);

  useEffect(() => {
    _mountedRef.current = true;
    return () => { _mountedRef.current = false; };
  }, []);

  const handlePrimaryAction = useCallback(() => {
    if (!game || !actionModel) return;
    const action = actionModel.action;
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE_DETAILS_ACTION][RUN] appid=${game.appId ?? "manual"} action=${action} enabled=${actionModel.enabled}`);
    }
    if (action === "play") {
      handlePlay();
      return;
    }
    if (action === "install") {
      setInstallModalOpen(true);
      return;
    }
    if (!game.appId) return;
    handleConsolePrimaryAction(game, action, {
      settings: appSettings,
      addJob,
      updateJob,
      libraryRefresh: libCtx.refresh,
      mountedRef: _mountedRef,
      onPlayGame,
    });
  }, [game, actionModel, handlePlay, appSettings, addJob, updateJob, libCtx.refresh, onPlayGame]);

  const handleConsoleAction = useCallback((action: ConsolePrimaryAction) => {
    if (!game) return;
    if (action === "play") {
      handlePlay();
      return;
    }
    if (action === "install") {
      setInstallModalOpen(true);
      return;
    }
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE_ACTION_CLICK] appid=${game.appId} action=${action} enabled=${actionModel?.enabled ?? false}`);
    }
    handleConsolePrimaryAction(game, action, {
      settings: appSettings,
      addJob,
      updateJob,
      libraryRefresh: libCtx.refresh,
      mountedRef: _mountedRef,
      onPlayGame,
    });
  }, [game, actionModel, appSettings, addJob, updateJob, libCtx.refresh, handlePlay, onPlayGame]);

  const handleFavoriteToggle = useCallback(() => {
    if (game) toggleFavorite(game.appId || game.id);
  }, [game, toggleFavorite]);

  /* ── Sub-focus activation for left-actions zone ── */
  /* Index 0 = primary action (Play/Install/Stop), 1 = Return (running) or Favorite, 2 = Favorite (running with pid) */
  const hasReturn = isRunning && gameSession?.pid != null;
  const maxSubIndex = hasReturn ? 2 : 1;
  const activateFocusedLeftAction = useCallback(() => {
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE_DETAILS_ACTION][KEY_ACTIVATE] appid=${game?.appId ?? "?"} subIndex=${leftActionSubIndex}`);
    }
    if (leftActionSubIndex === 0) {
      if (isRunning) {
        handleStop();
      } else {
        handlePrimaryAction();
      }
    } else if (leftActionSubIndex === 1 && hasReturn) {
      handleReturn();
    } else {
      handleFavoriteToggle();
    }
  }, [leftActionSubIndex, handlePrimaryAction, handleFavoriteToggle, handleStop, handleReturn, game?.appId, isRunning, hasReturn]);

  /* ── Install modal confirm ── */
  const handleInstallConfirm = useCallback(() => {
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE_DETAILS_ACTION][INSTALL_MODAL_CONFIRM] appid=${game?.appId}`);
    }
    installModalClosedAtRef.current = Date.now();
    setInstallModalOpen(false);
    if (!game || !game.appId) return;
    handleConsolePrimaryAction(game, "install", {
      settings: appSettings,
      addJob,
      updateJob,
      libraryRefresh: libCtx.refresh,
      mountedRef: _mountedRef,
      onPlayGame,
    });
  }, [game, appSettings, addJob, updateJob, libCtx.refresh, onPlayGame]);

  /* ── Ref for quickMenuOpen (avoid deps churn on handler) ── */
  const quickMenuOpenRef = useRef(quickMenuOpen);
  quickMenuOpenRef.current = quickMenuOpen;

  /* ══════════════════════════════════════════
     KEYBOARD NAVIGATION — Focus zone model
     ══════════════════════════════════════════ */
  const handleZoneKeyDown = useCallback((e: KeyboardEvent) => {
    if (DEBUG_CONSOLE_GAMEPAD) {
      console.log(`[CONSOLE_GAMEPAD][HANDLER_RECEIVED] key=${e.key} location=ConsoleGameDetails target=${(e.target as any)?.tagName ?? typeof e.target}`);
    }
    // Quick Menu owns all input when open
    if (quickMenuOpenRef.current) return;

    // Ignore Alt/Meta — browser/OS synthetic from unmapped controller buttons
    if (e.key === "Alt" || e.key === "Meta") return;

    // O / Menu key opens options overlay (does not close — use B/Escape for that)
    if (e.key === "o" || e.key === "O" || e.key === "ContextMenu" || e.key === "Apps") {
      e.preventDefault();
      if (!optionsOpen) setOptionsOpen(true);
      return;
    }

    // When options overlay is open, ignore all zone keys (overlay handles its own)
    if (optionsOpen) return;

    // When install modal is open, ignore all zone keys (modal handles its own)
    if (installModalOpen) return;

    // Post-modal close bounce guard: ignore Enter/Space/Escape within 400ms of modal close.
    // Catches the second Enter dispatched by the gamepad hook transition race
    // (parent hook re-enables with empty heldButtons while A is still physically held).
    if ((e.key === "Enter" || e.key === " " || e.key === "Escape") && installModalClosedAtRef.current > 0) {
      const elapsed = Date.now() - installModalClosedAtRef.current;
      if (elapsed < BOUNCE_GUARD_MS) {
        if (DEBUG_CONSOLE_GAMEPAD) console.log(`[INSTALL_MODAL][BOUNCE_GUARD] key=${e.key} elapsed=${elapsed}ms installModalOpen=${installModalOpen}`);
        e.preventDefault();
        return;
      }
    }

    // X = Play from any zone
    if (e.key === "x" || e.key === "X") {
      e.preventDefault();
      handlePlay();
      return;
    }

    // Search key: / or Y opens search overlay
    // V/View opens Profile/Quick Menu
    if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      onProfileOpen?.();
      return;
    }

    if (e.key === "/" || e.key === "y" || e.key === "Y") {
      e.preventDefault();
      onSearchOpen?.();
      return;
    }

    if (e.key === "Escape") {
      if (focusZone === "back-button") {
        e.preventDefault();
        handleClose();
      } else {
        e.preventDefault();
        setFocusZone("back-button");
      }
      return;
    }

    const activeEl = document.activeElement;
    const inInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
    if (inInput) return;

    switch (focusZone) {
      /* ── back-button ── */
      case "back-button": {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("left-actions");
        }
        break;
      }

      /* ── left-actions ── */
      case "left-actions": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("left-info");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("back-button");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setLeftActionSubIndex((i) => (i > 0 ? i - 1 : maxSubIndex));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setLeftActionSubIndex((i) => (i < maxSubIndex ? i + 1 : 0));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (DEBUG_CONSOLE_DETAILS_ACTION) {
            const labels = ["primary", hasReturn ? "return" : "favorite", "favorite"];
            const actionLabel = labels[leftActionSubIndex] ?? "favorite";
            console.log(`[CONSOLE_DETAILS_ACTION][KEY_ACTIVATE] appid=${game?.appId ?? "?"} subIndex=${leftActionSubIndex} action=${actionLabel}`);
          }
          activateFocusedLeftAction();
          if (DEBUG_CONSOLE_DETAILS_ACTION) {
            console.log(`[INSTALL_MODAL][OPEN_FROM_ACTION] key=${e.key} stopped=true`);
          }
        }
        break;
      }

      /* ── left-info: scrollable info panel ── */
      case "left-info": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (leftPanelRef.current) {
            leftPanelRef.current.scrollBy({ top: 120, behavior: "smooth" });
          } else {
            setFocusZone("media-preview");
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (leftPanelRef.current && leftPanelRef.current.scrollTop > 10) {
            leftPanelRef.current.scrollBy({ top: -120, behavior: "smooth" });
          } else {
            setFocusZone("left-actions");
          }
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusZone("media-preview");
        }
        break;
      }

      /* ── media-preview: Enter toggles play/pause ── */
      case "media-preview": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("media-carousel");
          setCarouselFocusIndex(carouselSelectedIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("left-info");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFocusZone("left-info");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusZone("media-carousel");
          setCarouselFocusIndex(carouselSelectedIndex);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          // Enter on preview toggles trailer play/pause
          const video = document.querySelector<HTMLVideoElement>(
            `[data-console-preview-video="${game?.appId}"]`
          );
          if (video && hasPlayableVideo) {
            if (video.paused) {
              video.play().catch(() => {});
            } else {
              video.pause();
            }
          }
        }
        break;
      }

      /* ── media-carousel ── */
      case "media-carousel": {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const next = Math.max(0, carouselFocusIndex - 1);
          setCarouselFocusIndex(next);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const next = Math.min(mediaItems.length - 1, carouselFocusIndex + 1);
          setCarouselFocusIndex(next);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setCarouselSelectedIndex(carouselFocusIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("media-preview");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("info-cards");
        } else if (e.key === "PageUp" || e.key === "q" || e.key === "Q") {
          e.preventDefault();
          const next = Math.max(0, carouselFocusIndex - 5);
          setCarouselFocusIndex(next);
        } else if (e.key === "PageDown" || e.key === "e" || e.key === "E") {
          e.preventDefault();
          const next = Math.min(mediaItems.length - 1, carouselFocusIndex + 5);
          setCarouselFocusIndex(next);
        }
        break;
      }

      /* ── info-cards: ArrowLeft/Right switches achievements/reviews ── */
      case "info-cards": {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setInfoCardSide("achievements");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setInfoCardSide("reviews");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("media-carousel");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("footer-actions");
        }
        break;
      }

      /* ── footer-actions ── */
      case "footer-actions": {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("info-cards");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("back-button");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFocusZone("left-info");
        }
        break;
      }
    }
  }, [focusZone, carouselFocusIndex, carouselSelectedIndex, mediaItems.length, handleClose, hasPlayableVideo, game?.appId, optionsOpen, installModalOpen, onSearchOpen, handlePlay, leftActionSubIndex, activateFocusedLeftAction, actionModel, maxSubIndex]);

  useEffect(() => {
    window.addEventListener("keydown", handleZoneKeyDown);
    return () => window.removeEventListener("keydown", handleZoneKeyDown);
  }, [handleZoneKeyDown]);

  /* ── Sync carousel focus when selected changes ── */
  useEffect(() => {
    setCarouselFocusIndex(carouselSelectedIndex);
  }, [carouselSelectedIndex]);

  /* ── Gamepad input: enabled while visible and no inner overlay active ── */
  useConsoleGamepadInput(!optionsOpen && !installModalOpen && !gamepadDisabled && !quickMenuOpen);

  /* ── Auto-focus left panel when entering left-info zone ── */
  useEffect(() => {
    if (focusZone === "left-info" && leftPanelRef.current) {
      leftPanelRef.current.focus({ preventScroll: false });
    }
  }, [focusZone]);

  useEffect(() => {
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE][DETAILS] mount appId=${game?.appId} title="${game?.title}"`);
    }
    sheetRef.current?.focus();
  }, [game?.appId, game?.title]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  }, [handleClose]);

  /* ── Derived data ── */
  const heroSrc = mediaBundle?.background?.url ?? getConsoleHeroBackground(game);
  const coverSrc = mediaBundle?.cover?.url ?? getConsoleCardSrc(game, "poster");
  const isManualGame = game?.source === "manual";
  const logoSrc = useMemo(() => {
    const raw = mediaBundle?.logo?.url ?? getConsoleLogoSrc(game);
    if (!raw) return null;
    // Skip cross-app Steam URL check for manual games (no Steam appIds)
    if (game?.appId) {
      const appIdMatch = raw.match(/steam\/apps\/(\d+)\//);
      if (appIdMatch && appIdMatch[1] !== game.appId) {
        if (DEBUG) console.log(`[LOGO_DISPLAY][REJECT] appid=${game.appId} path=${raw} reason=cross-app-steam-url urlAppid=${appIdMatch[1]}`);
        return null;
      }
    }
    return raw;
  }, [mediaBundle?.logo?.url, game]);
  const isFav = game ? favoriteIds.has(game.appId || game.id) : false;

  const playtimeSeconds = useMemo(() => {
    if (!game) return 0;
    // Try appId first (Steam), then gameKey (manual/future)
    const byAppId = game.appId ? getPlaytimeSecondsForAppId(game.appId) : 0;
    if (byAppId > 0) return byAppId;
    return getPlaytimeSecondsByGameKey(resolvePlaytimeKey(game));
  }, [game]);
  const playtimeDisplay = useMemo(() => {
    const s = formatPlaytime(playtimeSeconds);
    return s ?? "< 1h";
  }, [playtimeSeconds]);
  const lastPlayedTs = useMemo(() => (game ? getGameLastPlayedTimestamp(game) : null), [game]);
  const lastPlayedStr = lastPlayedTs ? formatRelativeTime(lastPlayedTs) : "Never";

  const appIdStr = game?.appId ?? null;

  const {
    achievementsSummary,
    effectiveUnlocked,
    effectiveTotal,
    effectivePercent,
    isPerfected,
    hasData: _hasAchievements,
  } = useConsoleAchievements(appIdStr);

  const releaseYear = useMemo(() => {
    if (!game?.metadata?.release_date) return null;
    const m = game.metadata.release_date.match(/^(\d{4})/);
    return m ? m[1] : null;
  }, [game]);

  const developer = game?.metadata?.developer ?? null;
  const publisher = game?.metadata?.publishers?.join(", ") ?? null;
  const genres = useMemo(() => {
    const raw = game?.metadata?.genres ?? [];
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const g of raw) {
      if (!seen.has(g)) { seen.add(g); deduped.push(g); }
      if (deduped.length >= 4) break;
    }
    return deduped.length > 0 ? deduped : null;
  }, [game?.metadata]);
  const description = game?.metadata?.short_description ?? null;

  /* ══════════════════════════════════════════
     SCROLLABLE LEFT PANEL — game info sections
     ══════════════════════════════════════════ */
  const aboutTheGame = useMemo(() => {
    const raw = game?.metadata?.about_the_game || game?.metadata?.detailed_description;
    if (!raw) return null;
    const stripped = stripHtml(raw);
    if (stripped.length < 20) return null;
    return stripped.length > 500 ? stripped.slice(0, 500) + "…" : stripped;
  }, [game?.metadata]);

  const categories = useMemo(() => {
    const raw = game?.metadata?.categories ?? [];
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const c of raw) {
      if (!seen.has(c)) { seen.add(c); deduped.push(c); }
      if (deduped.length >= 6) break;
    }
    return deduped.length > 0 ? deduped : null;
  }, [game?.metadata]);

  const languagesLabel = useMemo(() => {
    const langs = game?.metadata?.languages;
    if (!langs || langs.length === 0) return null;
    if (langs.length <= 6) return langs.join(", ");
    return `${langs.slice(0, 6).join(", ")} +${langs.length - 6} more`;
  }, [game?.metadata]);

  const dlcCount = game?.metadata?.dlc_count ?? 0;
  const dlcLabel = dlcCount <= 0 ? null : dlcCount === 1 ? "1 DLC Available" : `${dlcCount} DLCs Available`;

  const hasRequirements = !!(game?.metadata?.pc_requirements?.minimum || game?.metadata?.pc_requirements?.recommended);

  /* ── Achievement mini rows (up to 2, compact) ── */
  const achievementMiniRows = useMemo(() => {
    const list = achievementsSummary?.achievements;
    if (!list || list.length === 0) return null;
    const sorted = [...list].sort((a, b) => (b.unlocked === a.unlocked ? 0 : b.unlocked ? 1 : -1));
    return sorted.slice(0, 2);
  }, [achievementsSummary]);

  const {
    reviewSummary,
    isLoading: reviewIsLoading,
    hasData: _hasReviewData,
  } = useConsoleReviews(appIdStr);

  const reviewColors = reviewSummary
    ? (REVIEW_COLORS[reviewSummary.review_score_desc] ?? DEFAULT_REVIEW_COLOR)
    : DEFAULT_REVIEW_COLOR;

  /* ── Animation tokens ── */
  const enterDur = reducedMotion ? 120 : ENTER_DURATION;
  const exitDur = reducedMotion ? 100 : EXIT_DURATION;

  const overlayStyle: React.CSSProperties = useMemo(() => ({
    transition: `opacity ${reducedMotion ? 120 : 220}ms ${ENTER_EASING}`,
    opacity: phase === "exit" ? 0 : 1,
  }), [phase, reducedMotion]);

  const sheetStyle: React.CSSProperties = useMemo(() => {
    if (reducedMotion) {
      return { transition: "opacity 120ms ease", opacity: phase === "exit" ? 0 : 1 };
    }
    const dur = phase === "exit" ? exitDur : enterDur;
    const easing = phase === "exit" ? EXIT_EASING : ENTER_EASING;
    const translateY = phase === "exit" ? 60 : phase === "enter" ? 80 : 0;
    const scale = phase === "exit" ? 0.99 : phase === "enter" ? 0.985 : 1;
    return {
      transition: `transform ${dur}ms ${easing}, opacity ${dur}ms ${easing}`,
      transform: `translateY(${translateY}px) scale(${scale})`,
      opacity: phase === "visible" ? 1 : 0,
    };
  }, [phase, reducedMotion, enterDur, exitDur]);

  /* ── Surface style ── */
  const isSolid = surfaceMode === "solid";
  const isLiquidGlass = surfaceMode === "liquid-glass";
  const surfaceBg = isSolid
    ? "bg-(--color-surface)"
    : isLiquidGlass
      ? "bg-(--color-surface)/40 backdrop-blur-2xl"
      : "bg-(--color-surface)/85 backdrop-blur-sm";

  /* ══════════════════════════════════════════
     FOCUS VISUALS — per-zone focus styling
     ══════════════════════════════════════════ */
  const zoneFocusClass = (zone: FocusZone): string => {
    if (focusZone !== zone) return "";
    switch (zone) {
      case "back-button":
        return "ring-2 ring-(--color-accent)/60 shadow-lg shadow-(--color-accent)/20 scale-[1.02] transition-all duration-150";
      case "left-actions":
        return "ring-2 ring-(--color-accent)/40 ring-inset shadow-lg shadow-(--color-accent)/10 transition-all duration-150";
      case "left-info":
        return "ring-2 ring-(--color-accent)/30 ring-inset shadow-lg shadow-(--color-accent)/8 transition-all duration-150";
      case "media-preview":
        return "ring-2 ring-(--color-accent)/50 shadow-xl shadow-(--color-accent)/15 transition-all duration-150 scale-[1.005]";
      case "media-carousel":
        return "ring-2 ring-(--color-accent)/40 ring-inset shadow-lg shadow-(--color-accent)/10 rounded-xl transition-all duration-150";
      case "info-cards":
        return "ring-2 ring-(--color-accent)/30 ring-inset shadow-lg shadow-(--color-accent)/8 rounded-2xl transition-all duration-150";
      case "footer-actions":
        return "ring-2 ring-(--color-accent)/40 shadow-lg shadow-(--color-accent)/10 transition-all duration-150";
      default:
        return "ring-2 ring-(--color-accent)/40 transition-all duration-150";
    }
  };

  if (!game) {
    return (
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
        style={overlayStyle}
      >
        <div
          className="absolute left-[clamp(48px,5vw,96px)] right-[clamp(48px,5vw,96px)] bottom-[clamp(36px,5vh,72px)] flex items-center justify-center rounded-3xl border border-(--color-border)/40 shadow-2xl shadow-black/50 outline-none"
          style={{ height: "clamp(240px, 30vh, 400px)", ...sheetStyle }}
        >
          <div className={`${surfaceBg} absolute inset-0 rounded-3xl`} />
          <div className="relative z-10 flex flex-col items-center gap-4 px-8">
            <Gamepad2 className="h-14 w-14 text-(--color-muted)/30" />
            <p className="text-lg font-semibold text-(--color-text)">Unable to load game details</p>
            <p className="text-sm text-(--color-muted)">No game selected</p>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-(--color-accent) px-6 py-2.5 text-sm font-medium text-(--color-accent-text) transition hover:brightness-110"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100]"
      onClick={handleBackdropClick}
      style={overlayStyle}
    >
      {/* ── Background hero ── */}
      <div className="absolute inset-0 overflow-hidden">
        {heroSrc ? (
          <img
            key={game.appId || game.id}
            src={heroSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-full w-full bg-(--color-bg)" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      </div>

      <div className="pointer-events-none absolute inset-0 z-[5] bg-black/30" />

      {/* ── Back button (zone: back-button) ── */}
      <div className="pointer-events-none absolute left-4 top-3 z-30">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          onFocus={() => setFocusZone("back-button")}
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm transition hover:bg-(--color-accent)/80 hover:text-white outline-none ${zoneFocusClass("back-button")}`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>

      {/* ── Bottom sheet ── */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={game.title}
        onClick={(e) => e.stopPropagation()}
        className="absolute z-10 overflow-hidden rounded-[32px] border border-(--color-border)/30 shadow-2xl shadow-black/50 outline-none"
        style={{
          left: "clamp(48px, 5vw, 96px)",
          right: "clamp(48px, 5vw, 96px)",
          bottom: "clamp(36px, 5vh, 72px)",
          height: "clamp(560px, 68vh, 820px)",
          ...sheetStyle,
        }}
      >
        <div className={`${surfaceBg} absolute inset-0`} />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* ── Content ── */}
        <div className="relative z-10 flex h-full w-full gap-5 p-6">
          {/* ════════════════════════════════════════
             LEFT COLUMN — Mini card + actions + scrollable info
             ════════════════════════════════════════ */}
          <div className="relative w-[35%] shrink-0 flex flex-col">
            {/* ── Compact identity + actions + stats (zone: left-actions) ── */}
            <div
              tabIndex={-1}
              onFocus={() => { setFocusZone("left-actions"); setLeftActionSubIndex(0); }}
              className={`shrink-0 space-y-2.5 rounded-2xl px-3 pt-3 pb-2 outline-none ${zoneFocusClass("left-actions")}`}
            >
              {/* Mini card row: 120px cover + inline title/dev/badges */}
              <div className="flex gap-3">
                <div className="w-[120px] shrink-0 overflow-hidden rounded-2xl bg-(--color-surface)/60 shadow-lg shadow-black/40 ring-1 ring-white/[0.06]">
                  {coverSrc ? (
                    <img
                      key={game.appId || game.id}
                      src={coverSrc}
                      alt={game.title}
                      className="w-full object-cover"
                      style={{ aspectRatio: "2/3" }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div
                      className="flex w-full items-center justify-center bg-(--color-surface)/40"
                      style={{ aspectRatio: "2/3" }}
                    >
                      <Gamepad2 className="h-8 w-8 text-(--color-muted)/30" />
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                  {logoSrc ? (
                    <img
                      src={logoSrc}
                      alt={game.title}
                      className="max-h-[28px] max-w-[180px] object-contain"
                    />
                  ) : (
                    <h2 className="text-sm font-bold leading-tight text-(--color-text)">
                      {game.title}
                    </h2>
                  )}
                  {releaseYear && (
                    <p className="text-[11px] text-(--color-muted)">{releaseYear}</p>
                  )}
                  {developer && (
                    <p className="truncate text-[11px] text-(--color-muted)" title={developer}>
                      {developer}
                    </p>
                  )}
                  {publisher && !developer && (
                    <p className="truncate text-[11px] text-(--color-muted)" title={publisher}>
                      {publisher}
                    </p>
                  )}

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1">
                    {game.steamInstalled && (
                      <span className="rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[10px] font-medium text-black">
                        Installed
                      </span>
                    )}
                    {game.isLuaActive && (
                      <span className="rounded-md bg-violet-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Lua
                      </span>
                    )}
                    {isFav && (
                      <span className="rounded-md bg-rose-500/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Favorite
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action row — large buttons */}
              <div className="flex items-center gap-2.5">
                {isRunning ? (
                  <>
                    <button
                      type="button"
                      onClick={() => { handleStop(); }}
                      tabIndex={0}
                      onFocus={() => setLeftActionSubIndex(0)}
                      className={`inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 ${
                        focusZone === "left-actions" && leftActionSubIndex === 0
                          ? "ring-2 ring-(--color-accent)/50 shadow-lg shadow-(--color-accent)/20"
                          : ""
                      }`}
                    >
                      <Square className="h-4 w-4 fill-current" />
                      Stop
                    </button>
                    {gameSession?.pid != null && (
                      <button
                        type="button"
                        onClick={() => { handleReturn(); }}
                        tabIndex={0}
                        onFocus={() => setLeftActionSubIndex(1)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-(--color-surface)/40 ${
                          focusZone === "left-actions" && leftActionSubIndex === 1
                            ? "border-(--color-accent)/50 ring-2 ring-(--color-accent)/40"
                            : "border-(--color-border)/60"
                        }`}
                        title="Return to game"
                      >
                        <Play className="h-4 w-4" />
                        Return
                      </button>
                    )}
                  </>
                ) : isLaunching ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-accent) px-5 py-2.5 text-sm font-semibold text-(--color-accent-text) shadow-lg shadow-(--color-accent)/25 opacity-50 cursor-not-allowed"
                  >
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Launching…
                  </button>
                ) : isStopping ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/60 px-5 py-2.5 text-sm font-semibold text-white opacity-50 cursor-not-allowed"
                  >
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Stopping…
                  </button>
                ) : actionInFlight ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-accent)/70 px-5 py-2.5 text-sm font-semibold text-(--color-accent-text) shadow-lg opacity-60 cursor-not-allowed"
                  >
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {actionModel?.label ?? "Play"}…
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (DEBUG_CONSOLE_DETAILS_ACTION) {
                        console.log(`[CONSOLE_DETAILS_ACTION][MOUSE_CLICK] appid=${game?.appId} action=${actionModel?.action ?? "none"}`);
                      }
                      handlePrimaryAction();
                    }}
                    disabled={!actionModel?.enabled}
                    tabIndex={0}
                    onFocus={() => setLeftActionSubIndex(0)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition ${
                      actionModel?.enabled === false
                        ? "bg-(--color-accent)/50 opacity-50 cursor-not-allowed"
                        : "bg-(--color-accent) shadow-lg shadow-(--color-accent)/25 hover:brightness-110"
                    } ${
                      focusZone === "left-actions" && leftActionSubIndex === 0
                        ? "ring-2 ring-(--color-accent)/50 shadow-lg shadow-(--color-accent)/20"
                        : ""
                    }`}
                  >
                    <ActionIcon action={actionModel?.action ?? "unavailable"} />
                    {actionModel?.label ?? "Play"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleFavoriteToggle}
                  tabIndex={0}
                  onFocus={() => setLeftActionSubIndex(hasReturn ? 2 : 1)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition hover:bg-(--color-surface)/40 ${
                    isFav ? "text-rose-400" : "text-(--color-muted)"
                  } ${
                    focusZone === "left-actions" && ((hasReturn && leftActionSubIndex === 2) || (!hasReturn && leftActionSubIndex === 1))
                      ? "border-(--color-accent)/50 ring-2 ring-(--color-accent)/40"
                      : "border-(--color-border)/60"
                  }`}
                  title={isFav ? "Remove from Favorites" : "Add to Favorites"}
                >
                  <Heart className={`h-4 w-4 ${isFav ? "fill-rose-400 text-rose-400" : ""}`} />
                </button>
              </div>

              {/* Compact horizontal stats row */}
              <div className="flex gap-1.5">
                {[
                  { icon: Clock, label: "Played", value: playtimeDisplay },
                  { icon: Clock, label: "Last", value: lastPlayedStr },
                  { icon: HardDrive, label: "Size", value: getGameDiskSize(game) },
                  {
                    icon: CheckCircle2,
                    label: "Status",
                    value: isPerfected ? "Completed" : playtimeSeconds > 0 ? "In Progress" : "Not Played",
                  },
                ].map(({ icon: Icon, label, value }) => (
                  <div
                    key={label}
                    className="flex flex-1 items-center gap-1.5 rounded-xl bg-(--color-surface)/40 px-2.5 py-1.5 ring-1 ring-white/[0.04]"
                  >
                    <Icon className="h-3 w-3 shrink-0 text-(--color-muted)" />
                    <div className="min-w-0 flex-1">
                      <span className="text-[9px] font-medium uppercase tracking-wider text-(--color-muted)/60 block">{label}</span>
                      <span className="text-[11px] font-semibold text-(--color-text) block truncate">{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Scrollable info section (zone: left-info) ── */}
            <div
              ref={leftPanelRef}
              tabIndex={-1}
              onFocus={() => setFocusZone("left-info")}
              data-focused={focusZone === "left-info" ? "true" : undefined}
              className={`relative mt-2 flex-1 overflow-y-auto rounded-2xl bg-(--color-surface)/10 scrollbar-thin scrollbar-thumb-(--color-border)/20 outline-none ${zoneFocusClass("left-info")}`}
            >
              {/* Top fade edge */}
              <div className="pointer-events-none sticky top-0 z-10 h-6 bg-gradient-to-b from-(--color-surface)/40 to-transparent" />

              <div className="space-y-3.5 px-3 pb-6">
                {/* About the Game */}
                {settings.spotlightContent.showAboutGame && aboutTheGame && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-muted) mb-1.5">
                      About the Game
                    </h3>
                    <p className="text-xs leading-relaxed text-(--color-muted)/90">
                      {aboutTheGame}
                    </p>
                  </div>
                )}

                {/* Short Description (if distinct from About) */}
                {description && (!aboutTheGame || !aboutTheGame.startsWith(stripHtml(description).slice(0, 60))) && (
                  <p className="text-xs leading-relaxed text-(--color-muted)/70 italic">
                    {description}
                  </p>
                )}

                {settings.spotlightContent.showMetadata && (<>
                  {/* Developer / Publisher / Release Date */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {developer && (
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Developer</span>
                        <p className="text-xs text-(--color-text)">{developer}</p>
                      </div>
                    )}
                    {publisher && publisher !== developer && (
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Publisher</span>
                        <p className="text-xs text-(--color-text)">{publisher}</p>
                      </div>
                    )}
                    {game?.metadata?.release_date && (
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Released</span>
                        <p className="text-xs text-(--color-text)">{game.metadata.release_date}</p>
                      </div>
                    )}
                  </div>

                  {/* Genres */}
                  {genres && genres.length > 0 && (
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Genres</span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {genres.map((g) => (
                          <span key={g} className="rounded-lg bg-(--color-surface)/60 px-2 py-0.5 text-[11px] font-medium text-(--color-muted) ring-1 ring-(--color-border)/30">
                            {g}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Features / Categories */}
                  {categories && categories.length > 0 && (
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Features</span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {categories.map((cat) => (
                          <span key={cat} className="rounded-lg bg-(--color-surface)/40 px-2 py-0.5 text-[10px] text-(--color-muted)/80 ring-1 ring-(--color-border)/20">
                            {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Languages */}
                  {languagesLabel && (
                    <div className="flex items-start gap-2">
                      <Languages className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-muted)/50" />
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Languages</span>
                        <p className="text-xs text-(--color-muted)/80">{languagesLabel}</p>
                      </div>
                    </div>
                  )}

                  {/* DLC */}
                  {dlcLabel && (
                    <div className="flex items-start gap-2">
                      <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-muted)/50" />
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">DLC</span>
                        <p className="text-xs text-(--color-muted)/80">{dlcLabel}</p>
                      </div>
                    </div>
                  )}

                  {/* Requirements */}
                  {hasRequirements && (
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-muted)/50">Requirements</span>
                      <p className="mt-0.5 text-xs text-(--color-muted)/70">
                        {game.metadata?.pc_requirements?.minimum ? "Minimum specs available" : "Recommended specs available"}
                      </p>
                    </div>
                  )}

                  {/* Platforms */}
                  {game.metadata?.platforms && game.metadata.platforms.length > 0 && (
                    <div className="flex gap-1.5">
                      {game.metadata.platforms.map((p) => (
                        <span key={p} className="rounded-md bg-(--color-surface)/40 px-2 py-0.5 text-[10px] font-medium text-(--color-muted)/60 ring-1 ring-(--color-border)/20">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </>)}
              </div>

              {/* Bottom fade */}
              <div className="pointer-events-none sticky bottom-0 z-10 h-6 bg-gradient-to-t from-(--color-surface)/40 to-transparent" />
            </div>
          </div>

          {/* ════════════════════════════════════════
             RIGHT COLUMN — Media Frame → Carousel → Info Cards → Hints
             ════════════════════════════════════════ */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* ── Media Player Frame (zone: media-preview) ── */}
            <div
              className={`relative w-full overflow-hidden rounded-2xl bg-black/50 shadow-xl shadow-black/30 ring-1 ring-white/[0.06] outline-none ${zoneFocusClass("media-preview")}`}
              style={{ aspectRatio: "16/9", maxHeight: "clamp(200px, 32vh, 400px)" }}
              onClick={() => setFocusZone("media-preview")}
              tabIndex={-1}
              onFocus={() => setFocusZone("media-preview")}
            >
              <ConsoleSelectedPreview
                key={`preview-${mediaIdentityKey}`}
                game={game}
                showTrailerPreview={settings.spotlightContent.showTrailerPreview}
                trailerData={trailerData}
                screenshotOverrideUrl={screenshotOverrideUrl}
                mode={playerMode}
                autoplay
                mediaIdentityKey={mediaIdentityKey}
              />
            </div>

            {/* ── Media Carousel (zone: media-carousel) ── */}
            {settings.spotlightContent.showScreenshots && mediaItems.length > 0 && (
              <div
                className={`rounded-xl outline-none ${zoneFocusClass("media-carousel")}`}
                onClick={() => { setFocusZone("media-carousel"); setCarouselFocusIndex(carouselSelectedIndex); }}
                tabIndex={-1}
                onFocus={() => setFocusZone("media-carousel")}
              >
                <ConsoleMediaGallery
                  items={mediaItems}
                  selectedIndex={carouselSelectedIndex}
                  onSelect={(idx) => setCarouselSelectedIndex(idx)}
                  focusedIndex={focusZone === "media-carousel" ? carouselFocusIndex : undefined}
                />
              </div>
            )}

            {/* ── Two-column row: Achievements | Reviews (zone: info-cards) ── */}
            {!isManualGame && (
              settings.spotlightContent.showAchievements ||
              settings.spotlightContent.showReviews
            ) && (
              <div
                className={`grid gap-3 rounded-2xl p-0.5 outline-none ${
                  settings.spotlightContent.showAchievements && settings.spotlightContent.showReviews
                    ? "grid-cols-2"
                    : "grid-cols-1"
                } ${zoneFocusClass("info-cards")}`}
                onClick={() => setFocusZone("info-cards")}
                tabIndex={-1}
                onFocus={() => setFocusZone("info-cards")}
              >
              {/* ═══ Achievements Card ═══ */}
              {settings.spotlightContent.showAchievements && (
              <div className={`rounded-2xl bg-(--color-surface)/40 ring-1 ring-white/[0.04] transition-all duration-150 ${
                focusZone === "info-cards" && infoCardSide === "achievements"
                  ? "ring-2 ring-(--color-accent)/30 shadow-md shadow-(--color-accent)/10 scale-[1.02]"
                  : ""
              }`}>
                {achievementsSummary && effectiveTotal > 0 ? (
                  <div className="px-3.5 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Trophy
                          className={`h-3.5 w-3.5 ${isPerfected ? "fill-amber-400 text-amber-400" : "text-(--color-muted)"}`}
                        />
                        <span className="text-xs font-semibold text-(--color-text)">Achievements</span>
                      </div>
                      <span className={`text-xs font-semibold tabular-nums ${
                        isPerfected ? "text-amber-400" : "text-(--color-text)"
                      }`}>
                        {effectivePercent}%
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isPerfected
                              ? "bg-gradient-to-r from-amber-400 to-yellow-300"
                              : "bg-(--color-accent)"
                          }`}
                          style={{
                            width: `${effectivePercent}%`,
                            boxShadow: isPerfected ? "0 0 8px rgba(251,191,36,0.35)" : undefined,
                          }}
                        />
                      </div>
                      <span className={`whitespace-nowrap text-[11px] tabular-nums ${
                        isPerfected ? "font-semibold text-amber-400" : "font-medium text-(--color-muted)"
                      }`}>
                        {effectiveUnlocked}/{effectiveTotal}
                      </span>
                    </div>

                    {achievementMiniRows && !isPerfected && (
                      <div className="mt-2 space-y-1 border-t border-(--color-border)/10 pt-2">
                        {achievementMiniRows.map((ach, i) => (
                          <div key={ach.apiName ?? i} className="flex items-center gap-2">
                            <div className={`h-4 w-4 shrink-0 rounded-full ${ach.unlocked ? "bg-(--color-accent)/20" : "bg-white/5"}`}>
                            {ach.iconUrl ? (
                              <img src={ach.iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
                              ) : (
                                <div className={`flex h-full w-full items-center justify-center rounded-full text-[8px] font-bold ${
                                  ach.unlocked ? "text-(--color-accent)" : "text-white/20"
                                }`}>
                                  {ach.unlocked ? "✓" : "?"}
                                </div>
                              )}
                            </div>
                            <span className="min-w-0 flex-1 truncate text-[10px] text-(--color-muted)">
                              {ach.name ?? `Achievement ${i + 1}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {isPerfected && (
                      <div className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-amber-500/10 py-1">
                        <Trophy className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span className="text-[10px] font-semibold text-amber-400">All unlocked</span>
                      </div>
                    )}
                  </div>
                ) : achievementsSummary && achievementsSummary.achievements.length > 0 ? (
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <Trophy className="h-3.5 w-3.5 text-(--color-muted)" />
                      <span className="text-xs font-semibold text-(--color-text)">Achievements</span>
                    </div>
                    <p className="mt-1 text-[11px] text-(--color-muted)">Progress unavailable</p>
                  </div>
                ) : (
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <Trophy className="h-3.5 w-3.5 text-(--color-muted)" />
                      <span className="text-xs font-semibold text-(--color-text)">Achievements</span>
                    </div>
                    <p className="mt-1 text-[11px] text-(--color-muted)">No data</p>
                  </div>
                )}
              </div>
              )}

              {/* ═══ Reviews Card ═══ */}
              {settings.spotlightContent.showReviews && (
              <div className={`rounded-2xl ${reviewColors.bg} ${reviewColors.border} ring-1 ring-inset transition-all duration-150 ${
                focusZone === "info-cards" && infoCardSide === "reviews"
                  ? "ring-2 ring-(--color-accent)/30 shadow-md shadow-(--color-accent)/10 scale-[1.02]"
                  : ""
              }`}>
                {reviewSummary && reviewSummary.resolved && reviewSummary.total_reviews > 0 ? (
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <Star className={`h-3.5 w-3.5 ${reviewColors.text}`} />
                      <span className="text-xs font-semibold text-(--color-text)">Reviews</span>
                    </div>

                    <p className={`mt-1.5 text-sm font-bold ${reviewColors.text}`}>
                      {reviewSummary.review_score_desc}
                    </p>

                    <p className="mt-0.5 text-[11px] font-medium text-(--color-muted)">
                      {reviewSummary.positive_percent != null
                        ? `${Math.round(reviewSummary.positive_percent)}% positive`
                        : `${reviewSummary.total_positive.toLocaleString()} positive`}
                    </p>

                    <p className="mt-0.5 text-[10px] text-(--color-muted)/60">
                      {reviewSummary.total_reviews.toLocaleString()} reviews
                    </p>
                  </div>
                ) : (
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-1.5">
                      <Star className="h-3.5 w-3.5 text-(--color-muted)" />
                      <span className="text-xs font-semibold text-(--color-text)">Reviews</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-(--color-muted)">
                      {reviewIsLoading ? "Loading review data…" : "No review data"}
                    </p>
                  </div>
                )}
              </div>
              )}
            </div>
            )}

            {/* ── Action hints (zone: footer-actions) ── */}
            <div
              className={`mt-auto flex justify-end gap-x-4 gap-y-1 rounded-xl px-3 py-2 outline-none ${zoneFocusClass("footer-actions")}`}
              onClick={() => setFocusZone("footer-actions")}
              tabIndex={-1}
              onFocus={() => setFocusZone("footer-actions")}
            >
              <HintLabel focus={focusZone === "footer-actions"}>{hints.play}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.select}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.back}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.navigate}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.media}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.options}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.search}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.profile}</HintLabel>
              <HintLabel focus={focusZone === "footer-actions"}>{hints.page}</HintLabel>
            </div>
          </div>
        </div>
      </div>

      {/* Options overlay */}
      {optionsOpen && (
        <ConsoleGameOptionsOverlay
          game={game}
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          onOpenSearch={() => { setOptionsOpen(false); onSearchOpen?.(); }}
          onPlayGame={(g) => { setOptionsOpen(false); onPlayGame?.(g); }}
          onRemoveManual={() => { setOptionsOpen(false); onClose(); }}
          onAction={handleConsoleAction}
          inDetails={true}
          inputHints={settings.inputHints}
        />
      )}

      {/* Install confirmation modal */}
      <ConsoleInstallModal
        game={game}
        open={installModalOpen}
        onClose={() => {
          installModalClosedAtRef.current = Date.now();
          setInstallModalOpen(false);
        }}
        onConfirm={handleInstallConfirm}
        inputHints={settings.inputHints}
      />
    </div>
  );
}

/* ── Keyboard hint label helper ── */
function HintLabel({ children, focus }: { children: string | null; focus?: boolean }) {
  if (!children) return null;
  const m = children.match(/^\[(.+?)\]\s*(.+)$/);
  if (!m) {
    return <span className={`text-xs ${focus ? "text-(--color-muted)" : "text-(--color-muted)/60"}`}>{children}</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs transition-colors duration-150 ${
      focus ? "text-(--color-muted)/90" : "text-(--color-muted)/50"
    }`}>
      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-tight transition-colors duration-150 ${
        focus
          ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
          : "border-(--color-border)/40 bg-(--color-surface)/30 text-(--color-muted)/60"
      }`}>
        {m[1]}
      </span>
      {m[2]}
    </span>
  );
}

/* ── Action icon helper ── */
function ActionIcon({ action, className }: { action: ConsolePrimaryAction; className?: string }) {
  const cls = `h-4 w-4 ${className ?? ""}`;
  switch (action) {
    case "install": return <Download className={cls} />;
    case "update": return <RefreshCw className={cls} />;
    case "check-update": return <Search className={cls} />;
    case "up-to-date": return <CheckCircle2 className={cls} />;
    default: return <Play className={cls} />;
  }
}
