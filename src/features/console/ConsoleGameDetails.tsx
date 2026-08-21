import { useMemo, useEffect, useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft, Trophy, Heart, Gamepad2, Play, Square, HardDrive, CheckCircle2,
  Star, Languages, Layers, Download, RefreshCw, Search, FileSearch, Loader2, MoreHorizontal,
} from "lucide-react";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleSettings } from "./consoleSettings";
import type { StoreMediaItem, StoreTrailerMedia } from "../../types/store";
import { useFavorites } from "../../context/FavoritesContext";
import { useTheme } from "../../context/ThemeContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { getPlaytimeSecondsForAppId, getPlaytimeSecondsByGameKey, resolvePlaytimeKey } from "../../services/playtimeService";
import { getFavoriteKey } from "../../services/gameCacheService";
import { setAmbientSource, clearAmbientSource } from "../../services/ambientBackgroundStore";
import { subscribeHeroTransition, getHeroTransitionSnapshot } from "../../services/heroTransitionStore";
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
  | "hero"
  | "cards"
  | "actions"
  | "media-preview"
  | "media-carousel"
  | "hints";

type Props = {
  game: LibraryGame;
  onClose: () => void;
  settings: ConsoleSettings;
  onSearchOpen?: () => void;
  onPlayGame?: (game: LibraryGame) => void;
  onProfileOpen?: () => void;
  gamepadDisabled?: boolean;
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

  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");
  const reducedMotion = _prefersReducedMotion;

  /* ══════════════════════════════════════════
     FOCUS ZONE STATE
     ══════════════════════════════════════════ */
  const [focusZone, setFocusZone] = useState<FocusZone>("hero");
  const [carouselFocusIndex, setCarouselFocusIndex] = useState<number>(0);
  const [carouselSelectedIndex, setCarouselSelectedIndex] = useState<number>(0);

  useEffect(() => {
    setCarouselSelectedIndex(0);
  }, [game?.appId]);
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

  const mediaBundle = useMemo(() => {
    if (!game?.appId) return null;
    if (!artwork) return null;
    return consoleArtworkToBundle(game.appId, artwork);
  }, [game, artwork]);

  /* ══════════════════════════════════════════
     UNIFIED MEDIA
     ══════════════════════════════════════════ */
  const mediaItems = useMemo<StoreMediaItem[]>(() => {
    if (!game?.metadata) return [];
    return buildStoreMedia(game.metadata);
  }, [game?.metadata]);

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

  const playerMode = useMemo<"thumbnail" | "details">(() => {
    if (!isCurrentTrailer || !trailerData) return "thumbnail";
    return trailerData.playableType !== "none" ? "details" : "thumbnail";
  }, [isCurrentTrailer, trailerData]);

  const hasPlayableVideo = playerMode === "details" && trailerData?.playableType !== "none";

  const mediaIdentityKey = useMemo(() => {
    return `${game?.appId ?? "?"}-${carouselSelectedIndex}-${currentMedia?.type ?? "none"}`;
  }, [game?.appId, carouselSelectedIndex, currentMedia?.type]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("visible"));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    setOptionsOpen(false);
  }, [game?.appId]);

  const handleClose = useCallback(() => {
    if (phase === "exit") return;
    setPhase("exit");
    setTimeout(() => onClose(), EXIT_DURATION + 20);
  }, [phase, onClose]);

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
    if (game) toggleFavorite(getFavoriteKey(game) ?? game.id);
  }, [game, toggleFavorite]);

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

  const quickMenuOpenRef = useRef(quickMenuOpen);
  quickMenuOpenRef.current = quickMenuOpen;

  /* ══════════════════════════════════════════
     KEYBOARD NAVIGATION — Focus zone model (mejorado)
     ══════════════════════════════════════════ */
  const handleZoneKeyDown = useCallback((e: KeyboardEvent) => {
    if (DEBUG_CONSOLE_GAMEPAD) {
      console.log(`[CONSOLE_GAMEPAD][HANDLER_RECEIVED] key=${e.key} location=ConsoleGameDetails target=${(e.target as any)?.tagName ?? typeof e.target}`);
    }
    if (quickMenuOpenRef.current) return;
    if (e.key === "Alt" || e.key === "Meta") return;

    // O / Menu key opens options
    if (e.key === "o" || e.key === "O" || e.key === "ContextMenu" || e.key === "Apps") {
      e.preventDefault();
      if (!optionsOpen) setOptionsOpen(true);
      return;
    }
    if (optionsOpen) return;
    if (installModalOpen) return;
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
    // V/View opens Profile
    if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      onProfileOpen?.();
      return;
    }
    // Y or / opens search
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
      case "back-button": {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("hero");
        }
        break;
      }
      case "hero": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("cards");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("back-button");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusZone("actions");
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlePlay();
        }
        break;
      }
      case "cards": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("actions");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("hero");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusZone("media-preview");
        } else if (e.key === "PageUp" || e.key === "PageDown") {
          const container = document.querySelector('[data-scroll-container]');
          if (container) {
            const delta = e.key === "PageUp" ? -80 : 80;
            container.scrollBy({ top: delta, behavior: 'smooth' });
          }
        }
        break;
      }
      case "actions": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("media-preview");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("cards");
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
          activateFocusedLeftAction();
        }
        break;
      }
      case "media-preview": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("media-carousel");
          setCarouselFocusIndex(carouselSelectedIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("actions");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFocusZone("cards");
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const video = document.querySelector<HTMLVideoElement>(
            `[data-console-preview-video="${game?.appId}"]`
          );
          if (video && hasPlayableVideo) {
            if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
          }
        }
        break;
      }
      case "media-carousel": {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setCarouselFocusIndex((i) => Math.max(0, i - 1));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setCarouselFocusIndex((i) => Math.min(mediaItems.length - 1, i + 1));
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setCarouselSelectedIndex(carouselFocusIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("media-preview");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("hints");
        } else if (e.key === "PageUp" || e.key === "q" || e.key === "Q") {
          e.preventDefault();
          setCarouselFocusIndex((i) => Math.max(0, i - 5));
        } else if (e.key === "PageDown" || e.key === "e" || e.key === "E") {
          e.preventDefault();
          setCarouselFocusIndex((i) => Math.min(mediaItems.length - 1, i + 5));
        }
        break;
      }
      case "hints": {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("media-carousel");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("back-button");
        }
        break;
      }
    }
  }, [focusZone, carouselFocusIndex, carouselSelectedIndex, mediaItems.length, handleClose, hasPlayableVideo, game?.appId, optionsOpen, installModalOpen, onSearchOpen, handlePlay, leftActionSubIndex, activateFocusedLeftAction, maxSubIndex]);

  useEffect(() => {
    window.addEventListener("keydown", handleZoneKeyDown);
    return () => window.removeEventListener("keydown", handleZoneKeyDown);
  }, [handleZoneKeyDown]);

  useEffect(() => {
    setCarouselFocusIndex(carouselSelectedIndex);
  }, [carouselSelectedIndex]);

  useConsoleGamepadInput(!optionsOpen && !installModalOpen && !gamepadDisabled && !quickMenuOpen, { suppressHeldOnEnable: true });

  useEffect(() => {
    const el = document.querySelector(`[data-focus-zone="${focusZone}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focusZone]);

  useEffect(() => {
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE][DETAILS] mount appId=${game?.appId} title="${game?.title}"`);
    }
  }, [game?.appId, game?.title]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  }, [handleClose]);

  /* ── Derived data ── */
  const heroSrc = mediaBundle?.background?.url ?? getConsoleHeroBackground(game);
  const coverSrc = mediaBundle?.cover?.url ?? getConsoleCardSrc(game, "poster");
  useSyncExternalStore(subscribeHeroTransition, getHeroTransitionSnapshot, getHeroTransitionSnapshot);
  const heroTransition = getHeroTransitionSnapshot().id;
  const consoleHeroClass =
    heroTransition === "kenburns"
      ? "animate-hero-kenburns-in"
      : heroTransition === "focus"
        ? "animate-hero-focus-in"
        : "animate-hero-crossfade-in";

  useEffect(() => {
    if (!heroSrc) return;
    setAmbientSource("console-details", heroSrc);
  }, [heroSrc]);

  useEffect(() => {
    clearAmbientSource("console-details");
  }, [game?.appId]);

  useEffect(() => {
    return () => clearAmbientSource("console-details");
  }, []);

  const logoSrc = useMemo(() => {
    const raw = mediaBundle?.logo?.url ?? getConsoleLogoSrc(game);
    if (!raw) return null;
    if (game?.appId) {
      const appIdMatch = raw.match(/steam\/apps\/(\d+)\//);
      if (appIdMatch && appIdMatch[1] !== game.appId) {
        if (DEBUG) console.log(`[LOGO_DISPLAY][REJECT] appid=${game.appId} path=${raw} reason=cross-app-steam-url urlAppid=${appIdMatch[1]}`);
        return null;
      }
    }
    return raw;
  }, [mediaBundle?.logo?.url, game]);

  const isFav = game ? favoriteIds.has(getFavoriteKey(game) ?? game.id) : false;

  const playtimeSeconds = useMemo(() => {
    if (!game) return 0;
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

  const aboutTheGame = useMemo(() => {
    const raw = game?.metadata?.about_the_game || game?.metadata?.detailed_description;
    if (!raw) return null;
    const stripped = stripHtml(raw);
    if (stripped.length < 20) return null;
    return stripped.length > 260 ? stripped.slice(0, 260) + "…" : stripped;
  }, [game?.metadata]);

  const languagesLabel = useMemo(() => {
    const langs = game?.metadata?.languages;
    if (!langs || langs.length === 0) return null;
    if (langs.length <= 6) return langs.join(", ");
    return `${langs.slice(0, 6).join(", ")} +${langs.length - 6} more`;
  }, [game?.metadata]);

  const dlcCount = game?.metadata?.dlc_count ?? 0;
  const dlcLabel = dlcCount <= 0 ? null : dlcCount === 1 ? "1 DLC Available" : `${dlcCount} DLCs Available`;

  const {
    reviewSummary,
    isLoading: reviewIsLoading,
  } = useConsoleReviews(appIdStr);

  const reviewColors = reviewSummary
    ? (REVIEW_COLORS[reviewSummary.review_score_desc] ?? DEFAULT_REVIEW_COLOR)
    : DEFAULT_REVIEW_COLOR;

  /* ── Hints dinámicos según zona ── */
  const dynamicHints = useMemo(() => {
    const all = hints;
    if (focusZone === "actions") {
      return [all.play, all.select, all.back, all.navigate, all.options, all.search, all.profile];
    } else if (focusZone === "media-preview" || focusZone === "media-carousel") {
      return [all.media, all.select, all.back, all.navigate, all.page];
    } else if (focusZone === "cards") {
      return [all.navigate, all.select, all.back, all.page];
    } else if (focusZone === "hints") {
      return [all.navigate, all.back];
    } else {
      return [all.play, all.select, all.back, all.navigate, all.media, all.options, all.search, all.profile, all.page];
    }
  }, [focusZone, hints]);

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
    const translateY = phase === "exit" ? 40 : phase === "enter" ? 56 : 0;
    const scale = phase === "exit" ? 0.99 : phase === "enter" ? 0.99 : 1;
    return {
      transition: `transform ${dur}ms ${easing}, opacity ${dur}ms ${easing}`,
      transform: `translateY(${translateY}px) scale(${scale})`,
      opacity: phase === "visible" ? 1 : 0,
    };
  }, [phase, reducedMotion, enterDur, exitDur]);

  const isSolid = surfaceMode === "solid";
  const surfaceBg = isSolid
    ? "bg-(--color-surface)"
    : "lf-surface";

  /* ══════════════════════════════════════════
     FOCUS VISUALS — con efectos mejorados
     ══════════════════════════════════════════ */
  const zoneFocusClass = (zone: FocusZone): string => {
    if (focusZone !== zone) return "";
    switch (zone) {
      case "back-button":
        return "ring-3 ring-(--color-accent)/70 shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.3)] scale-[1.02] transition-all duration-200";
      case "hero":
        return "ring-3 ring-(--color-accent)/60 shadow-[0_0_25px_rgba(var(--color-accent-rgb),0.25)] transition-all duration-200";
      case "actions":
        return "ring-3 ring-(--color-accent)/50 ring-inset shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.2)] rounded-xl transition-all duration-200";
      case "media-preview":
        return "ring-3 ring-(--color-accent)/60 shadow-[0_0_30px_rgba(var(--color-accent-rgb),0.25)] transition-all duration-200";
      case "media-carousel":
        return "ring-3 ring-(--color-accent)/50 ring-inset shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.2)] rounded-xl transition-all duration-200";
      case "cards":
        return "ring-3 ring-(--color-accent)/40 ring-inset shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.15)] rounded-xl transition-all duration-200";
      case "hints":
        return "ring-3 ring-(--color-accent)/50 shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.2)] transition-all duration-200";
      default:
        return "ring-3 ring-(--color-accent)/50 transition-all duration-200";
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
            className={`h-full w-full object-cover ${consoleHeroClass}`}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-full w-full bg-(--console-bg)" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
      </div>

      {/* ── Back button ── */}
      <div className="pointer-events-none absolute left-5 top-4 z-30">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          onFocus={() => setFocusZone("back-button")}
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-3 py-1.5 text-xs font-medium text-white/90 shadow-md shadow-black/30 ring-1 ring-white/10 backdrop-blur-md transition hover:bg-(--color-accent)/80 hover:text-white outline-none ${zoneFocusClass("back-button")}`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>

      {/* ── Media page counter ── */}
      {mediaItems.length > 0 && (
        <div className="pointer-events-none absolute right-5 top-4 z-30">
          <span className="rounded-md bg-black/55 px-2.5 py-1 text-xs font-bold tabular-nums text-white/90 shadow-md shadow-black/30 ring-1 ring-white/10 backdrop-blur-md">
            {carouselSelectedIndex + 1}
          </span>
        </div>
      )}

      {/* ── Content ── */}
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={game.title}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 z-10 flex flex-col outline-none"
        style={sheetStyle}
      >
        {/* ═══ Logo / Title ═══ */}
        <div
          data-focus-zone="hero"
          tabIndex={-1}
          onFocus={() => setFocusZone("hero")}
          className={`mx-auto mt-8 w-full max-w-[1500px] cursor-pointer rounded-xl px-6 py-1 outline-none md:mt-12 lg:px-12 ${zoneFocusClass("hero")}`}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={game.title}
              className="max-h-[120px] w-auto object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.8)]"
            />
          ) : (
            <h1 className="text-4xl font-black leading-tight text-white drop-shadow-2xl">{game.title}</h1>
          )}
        </div>

        <div className="flex-1 lg:max-h-[220px]" />

        {/* ═══ Two-column panel ═══ */}
        <div className="mx-auto mb-6 flex w-full max-w-[1500px] flex-col gap-4 px-6 md:mb-10 lg:flex-row lg:items-stretch lg:px-12">

          {/* ── LEFT: info card mejorada ── */}
          <div className={`${surfaceBg} flex w-full flex-col rounded-2xl p-5 shadow-2xl shadow-black/60 ring-1 ring-white/[0.08] backdrop-blur-md lg:w-[440px] lg:shrink-0`}>
            {/* Header row: cover + title/meta */}
            <div className="flex items-start gap-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10">
                {coverSrc ? (
                  <img src={coverSrc} alt="" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/5">
                    <Gamepad2 className="h-6 w-6 text-white/20" />
                  </div>
                )}
                {/* Badge IN-GAME */}
                {isRunning && (
                  <span className="absolute -right-1 -top-1 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold text-(--color-text)">{game.title}</h2>
                <p className="mt-0.5 truncate text-[11px] text-(--color-muted)/70">
                  {[releaseYear, developer].filter(Boolean).join("  ·  ")}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-(--color-muted)/60">
                  <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" />{getGameDiskSize(game)}</span>
                  {game.steamInstalled && <span className="rounded bg-emerald-500/80 px-1.5 py-0.5 font-semibold text-black">Installed</span>}
                  {game.isLuaActive && <span className="rounded bg-violet-500/80 px-1.5 py-0.5 font-semibold text-white">Lua</span>}
                  {game.source === "debrid" && game.repacker && (
                    <span className="rounded bg-cyan-500/80 px-1.5 py-0.5 font-semibold text-black">{game.repacker.toUpperCase()}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Rating + genres (zone: cards) */}
            <div
              data-focus-zone="cards"
              tabIndex={-1}
              onFocus={() => setFocusZone("cards")}
              onClick={() => setFocusZone("cards")}
              className={`mt-3 flex flex-wrap items-center gap-1.5 rounded-lg p-1 outline-none ${zoneFocusClass("cards")}`}
            >
              {reviewSummary && reviewSummary.resolved && reviewSummary.total_reviews > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${reviewColors.bg} ${reviewColors.text}`}>
                  <Star className="h-3 w-3 fill-current" />
                  {reviewSummary.positive_percent != null ? `${Math.round(reviewSummary.positive_percent)}%` : reviewSummary.review_score_desc}
                </span>
              )}
              {!reviewSummary && reviewIsLoading && (
                <span className="text-[10px] text-(--color-muted)/50">Loading reviews…</span>
              )}
              {genres?.map((g) => (
                <span key={g} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-(--color-muted) ring-1 ring-white/10">{g}</span>
              ))}
            </div>

            {/* Stats: Time Played / Last Played */}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <div className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
                <span className="block text-[9px] font-medium uppercase tracking-wider text-white/35">Time Played</span>
                <span className="block truncate text-[12px] font-semibold text-white/85">{playtimeDisplay}</span>
              </div>
              <div className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
                <span className="block text-[9px] font-medium uppercase tracking-wider text-white/35">Last Played</span>
                <span className="block truncate text-[12px] font-semibold text-white/85">{lastPlayedStr}</span>
              </div>
            </div>

            {/* Achievements bar y lista reciente */}
            {achievementsSummary && effectiveTotal > 0 && (
              <div className="mt-2 rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-white/60">
                    <Trophy className={`h-3 w-3 ${isPerfected ? "fill-amber-400 text-amber-400" : ""}`} />
                    Achievements
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums text-white/70">
                    {effectiveUnlocked}/{effectiveTotal} ({effectivePercent}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isPerfected ? "bg-gradient-to-r from-amber-400 to-yellow-300" : "bg-(--color-accent)"}`}
                    style={{ width: `${effectivePercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Actions row mejorada: botón principal full-width */}
            <div
              data-focus-zone="actions"
              onFocus={() => { setFocusZone("actions"); setLeftActionSubIndex(0); }}
              className={`mt-3 rounded-xl p-1 outline-none ${zoneFocusClass("actions")}`}
            >
              {isRunning ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleStop}
                    className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                  >
                    <Square className="mr-2 inline h-4 w-4 fill-current" /> Stop
                  </button>
                  {gameSession?.pid != null && (
                    <button
                      type="button"
                      onClick={handleReturn}
                      className="flex-1 rounded-xl border border-white/20 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                    >
                      <Play className="mr-2 inline h-4 w-4" /> Return
                    </button>
                  )}
                </div>
              ) : isLaunching ? (
                <button type="button" disabled className="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-(--color-accent-text) shadow-xl shadow-(--color-accent)/25 opacity-50 cursor-not-allowed">
                  <div className="mr-2 inline h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Launching…
                </button>
              ) : isStopping ? (
                <button type="button" disabled className="w-full rounded-xl bg-red-500/60 py-3 text-sm font-bold text-white opacity-50 cursor-not-allowed">
                  <div className="mr-2 inline h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Stopping…
                </button>
              ) : actionInFlight ? (
                <button type="button" disabled className="w-full rounded-xl bg-(--color-accent)/70 py-3 text-sm font-bold text-(--color-accent-text) shadow-lg opacity-60 cursor-not-allowed">
                  <div className="mr-2 inline h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {actionModel?.label ?? "Play"}…
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  disabled={!actionModel?.enabled}
                  className={`w-full rounded-xl py-3 text-sm font-bold transition-all ${
                    actionModel?.enabled === false
                      ? "bg-white/20 text-white opacity-50 cursor-not-allowed shadow-none"
                      : "bg-(--color-accent) text-(--color-accent-text) shadow-lg shadow-(--color-accent)/30 hover:shadow-(--color-accent)/50"
                  } ${focusZone === "actions" && leftActionSubIndex === 0 ? "scale-[1.02] ring-2 ring-(--color-accent) ring-offset-2" : ""}`}
                >
                  <ActionIcon action={actionModel?.action ?? "unavailable"} className="mr-2 inline h-4 w-4" />
                  {actionModel?.label ?? "Play"}
                </button>
              )}
              {/* Botones secundarios */}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOptionsOpen(true)}
                  className="inline-flex items-center justify-center rounded-xl border border-white/20 px-3 py-1.5 text-white/60 transition hover:bg-white/10"
                  title="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleFavoriteToggle}
                  className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 text-xs transition hover:bg-white/10 ${
                    isFav ? "text-rose-400" : "text-white/60"
                  } ${focusZone === "actions" && ((hasReturn && leftActionSubIndex === 2) || (!hasReturn && leftActionSubIndex === 1)) ? "border-(--color-accent)/50 ring-2 ring-(--color-accent)/40" : "border-white/20"}`}
                  title={isFav ? "Remove from Favorites" : "Add to Favorites"}
                >
                  <Heart className={`h-4 w-4 ${isFav ? "fill-rose-400 text-rose-400" : ""}`} />
                </button>
              </div>
            </div>

            {/* About + secondary metadata con scroll container */}
            <div className="mt-3 flex flex-1 flex-col">
              <div
                data-scroll-container
                className="max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1"
              >
                {aboutTheGame && (
                  <p className="text-[11px] leading-relaxed text-(--color-muted)/75">{aboutTheGame}</p>
                )}
              </div>

              {(languagesLabel || dlcLabel || (publisher && publisher !== developer)) && (
                <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-2 text-[10px] text-(--color-muted)/60">
                  {publisher && publisher !== developer && (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="uppercase tracking-wider text-white/35">Pub</span>
                      <span className="truncate text-right">{publisher}</span>
                    </div>
                  )}
                  {languagesLabel && (
                    <div className="flex items-start gap-1.5">
                      <Languages className="mt-0.5 h-3 w-3 shrink-0 text-white/35" />
                      <span className="truncate">{languagesLabel}</span>
                    </div>
                  )}
                  {dlcLabel && (
                    <div className="flex items-start gap-1.5">
                      <Layers className="mt-0.5 h-3 w-3 shrink-0 text-white/35" />
                      <span>{dlcLabel}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: media preview + carousel ── */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div
              className={`relative aspect-video w-full overflow-hidden rounded-2xl ${surfaceBg} ring-1 ring-white/[0.08] shadow-2xl shadow-black/50 outline-none ${zoneFocusClass("media-preview")}`}
              data-focus-zone="media-preview"
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

            {settings.spotlightContent.showScreenshots && mediaItems.length > 0 && (
              <div
                className={`rounded-xl outline-none ${zoneFocusClass("media-carousel")}`}
                data-focus-zone="media-carousel"
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
          </div>
        </div>

        {/* ═══ Hints dinámicos ═══ */}
        <div
          className={`mx-auto mb-4 flex w-full max-w-[1500px] flex-wrap justify-center gap-x-4 gap-y-1 rounded-xl px-6 py-2 outline-none lg:px-12 ${zoneFocusClass("hints")}`}
          data-focus-zone="hints"
          onClick={() => setFocusZone("hints")}
          tabIndex={-1}
          onFocus={() => setFocusZone("hints")}
        >
          {dynamicHints.map((hint, idx) => (
            <HintLabel key={idx} focus={focusZone === "hints"}>{hint}</HintLabel>
          ))}
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

      {/* Install modal */}
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
  const cls = className ?? "h-4 w-4";
  switch (action) {
    case "install": return <Download className={cls} />;
    case "update": return <RefreshCw className={cls} />;
    case "check-update": return <Search className={cls} />;
    case "up-to-date": return <CheckCircle2 className={cls} />;
    case "installing": return <Loader2 className={`${cls} animate-spin`} />;
    case "select-exe": return <FileSearch className={cls} />;
    default: return <Play className={cls} />;
  }
}