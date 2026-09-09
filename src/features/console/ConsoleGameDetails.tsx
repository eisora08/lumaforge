import { useMemo, useEffect, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Trophy, Heart, Gamepad2, Play, Square, HardDrive, CheckCircle2,
  Star, Languages, Layers, Download, RefreshCw, Search, FileSearch, Loader2, MoreHorizontal,
  CircleCheck, CircleDashed, Clock, Volume2, VolumeX,
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
import { getPlatformShortName } from "../../utils/platformUtils";
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
import { getConsoleInputHints, isGamepadDetected } from "./consoleInputHints";
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
import { playNavigateSound, playSelectSound, playLaunchSound, playOpenSound, playCloseSound } from "../../services/soundEffectsService";

import { useCrossfadeSrc } from "../../hooks/useCrossfadeSrc";

const DEBUG = false;
const DEBUG_CONSOLE_PLAY = false;
const DEBUG_CONSOLE_DETAILS_ACTION = false;

function getBlockedReason(action: string, t: (key: string, fallback: string) => string): string {
  switch (action) {
    case "install": return t("console_settings.install_required", "Install required");
    case "update": return t("console_settings.update_required", "Update required");
    case "download": return t("console_settings.download_required", "Download required");
    case "missing-path": return t("console_settings.game_files_missing", "Game files missing");
    case "uninstalling": return t("console_settings.game_being_uninstalled", "Game is being uninstalled");
    case "open-steam": return t("console_settings.open_steam_to_play", "Open in Steam to play");
    case "open-lua-folder": return t("console_settings.configure_lua_to_play", "Configure Lua script to play");
    default: return t("console_settings.not_playable_yet", "This game is not playable yet");
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
  railGames?: LibraryGame[];
  railIndex?: number;
  onNavigateRail?: (dir: "next" | "prev") => void;
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

export default function ConsoleGameDetails({ game, onClose, settings, onSearchOpen, onPlayGame, onProfileOpen, gamepadDisabled = false, quickMenuOpen = false, railGames, railIndex, onNavigateRail }: Props) {
  const { t } = useTranslation();
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
  const gamepadActive = isGamepadDetected();
  const sheetRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");
  const reducedMotion = _prefersReducedMotion;

  /* ══════════════════════════════════════════
     FOCUS ZONE STATE
     ══════════════════════════════════════════ */
  const [focusZone, setFocusZone] = useState<FocusZone>("actions");
  const [carouselFocusIndex, setCarouselFocusIndex] = useState<number>(0);
  const [carouselSelectedIndex, setCarouselSelectedIndex] = useState<number>(0);

  useEffect(() => {
    setCarouselSelectedIndex(0);
    setActionsBrowsingMedia(false);
    setMuted(false);
  }, [game?.appId]);

  /* Auto-focus play button on game change (LB/RB navigation or first mount) */
  useEffect(() => {
    setFocusZone("actions");
    setLeftActionSubIndex(0);
  }, [game?.appId]);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [leftActionSubIndex, setLeftActionSubIndex] = useState(0);
  const [actionsBrowsingMedia, setActionsBrowsingMedia] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  const [playPulse, setPlayPulse] = useState(false);
  const [previewHovered, setPreviewHovered] = useState(false);
  const playPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const installModalClosedAtRef = useRef(0);
  const BOUNCE_GUARD_MS = 400;

  /* ── Hero zoom: mouse hover OR keyboard focus on Play ── */
  const showHeroZoom = playHovered || (focusZone === "actions" && !actionsBrowsingMedia && !isRunning && leftActionSubIndex === 0);
  const heroZoomClass = playPulse ? "scale-[1.06] brightness-125" : showHeroZoom ? "scale-[1.03] brightness-110" : "";

  /* Cleanup pulse timer on unmount */
  useEffect(() => {
    return () => { if (playPulseTimerRef.current) clearTimeout(playPulseTimerRef.current); };
  }, []);

  /* ── Video mute state (controlled from actions zone secondary buttons) ── */
  const [muted, setMuted] = useState(true);
  const toggleVideoMute = useCallback(() => {
    const video = document.querySelector<HTMLVideoElement>(
      `[data-console-preview-video="${game?.appId || game?.id}"]`
    );
    if (video) {
      video.muted = !video.muted;
      setMuted(video.muted);
    }
  }, [game?.appId]);

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
    if (!artwork) return null;
    const bundleAppId = game?.appId ?? game?.id;
    if (!bundleAppId) return null;
    return consoleArtworkToBundle(bundleAppId, artwork);
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
    if (isCurrentTrailer && trailerData && trailerData.playableType !== "none") return "details";
    return "thumbnail";
  }, [isCurrentTrailer, trailerData]);

  const hasPlayableVideo = playerMode === "details" && trailerData?.playableType !== "none";

  /* ── Video seek (for LT/RT triggers) ── */
  const seekVideo = useCallback((delta: number) => {
    const video = document.querySelector<HTMLVideoElement>(
      `[data-console-preview-video="${game?.appId || game?.id}"]`
    );
    if (video && hasPlayableVideo) {
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
    }
  }, [game?.appId || game?.id, hasPlayableVideo]);

  const mediaIdentityKey = useMemo(() => {
    return `${game?.appId ?? "?"}-${carouselSelectedIndex}-${currentMedia?.type ?? "none"}`;
  }, [game?.appId, carouselSelectedIndex, currentMedia?.type]);

  useEffect(() => {
    playOpenSound();
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
    playCloseSound();
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
      showWarning(getBlockedReason(action, t), { id: `console-details-blocked-${game.appId ?? game.id}`, duration: 3000 });
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
      /* Premium play pulse: hero zooms in then returns */
      if (!playPulse) {
        setPlayPulse(true);
        if (playPulseTimerRef.current) clearTimeout(playPulseTimerRef.current);
        playPulseTimerRef.current = setTimeout(() => setPlayPulse(false), 600);
      }
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
  }, [game, actionModel, handlePlay, appSettings, addJob, updateJob, libCtx.refresh, onPlayGame, playPulse]);

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

  /* SubIndex layout: isRunning=false → [0=Play, 1=Options, 2=Mute, 3=Favorites]
     isRunning=true  → [0=Stop, 1=Return, 2=Options, 3=Mute, 4=Favorites] */
  const maxSubIndex = isRunning ? 4 : 3;
  const activateFocusedLeftAction = useCallback(() => {
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE_DETAILS_ACTION][KEY_ACTIVATE] appid=${game?.appId ?? "?"} subIndex=${leftActionSubIndex} isRunning=${isRunning}`);
    }
    if (isRunning) {
      if (leftActionSubIndex === 0) handleStop();
      else if (leftActionSubIndex === 1) handleReturn();
      else if (leftActionSubIndex === 2) setOptionsOpen(true);
      else if (leftActionSubIndex === 3) toggleVideoMute();
      else if (leftActionSubIndex === 4) handleFavoriteToggle();
    } else {
      if (leftActionSubIndex === 0) handlePrimaryAction();
      else if (leftActionSubIndex === 1) setOptionsOpen(true);
      else if (leftActionSubIndex === 2) toggleVideoMute();
      else if (leftActionSubIndex === 3) handleFavoriteToggle();
    }
  }, [leftActionSubIndex, handlePrimaryAction, handleFavoriteToggle, handleStop, handleReturn, toggleVideoMute, game?.appId, isRunning]);

  const handleInstallConfirm = useCallback(() => {
    if (DEBUG_CONSOLE_DETAILS_ACTION) {
      console.log(`[CONSOLE_DETAILS_ACTION][INSTALL_MODAL_CONFIRM] appid=${game?.appId}`);
    }
    installModalClosedAtRef.current = Date.now();
    setInstallModalOpen(false);
    if (!game) return;
    if (!game.appId && game.source !== "epic") return;
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
      playLaunchSound();
      handlePlay();
      return;
    }
    // LB/RB (q/e) = navigate rail games from any zone
    if (onNavigateRail) {
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        playNavigateSound();
        onNavigateRail("prev");
        return;
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        playNavigateSound();
        onNavigateRail("next");
        return;
      }
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
          playSelectSound();
          handleClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("hero");
        } else if (e.key === "ArrowLeft" && onNavigateRail) {
          e.preventDefault();
          playNavigateSound();
          onNavigateRail("prev");
        } else if (e.key === "ArrowRight" && onNavigateRail) {
          e.preventDefault();
          playNavigateSound();
          onNavigateRail("next");
        }
        break;
      }
      case "hero": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("cards");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("back-button");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("actions");
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playLaunchSound();
          handlePlay();
        }
        break;
      }
      case "cards": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("actions");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("hero");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("media-preview");
        } else if (e.key === "PageUp" || e.key === "PageDown") {
          playNavigateSound();
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
          playNavigateSound();
          setActionsBrowsingMedia(false);
          setLeftActionSubIndex((i) => (i < maxSubIndex ? i + 1 : 0));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          playNavigateSound();
          setActionsBrowsingMedia(false);
          setLeftActionSubIndex((i) => (i > 0 ? i - 1 : maxSubIndex));
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          playNavigateSound();
          setActionsBrowsingMedia(true);
          setCarouselFocusIndex((i) => {
            const next = Math.max(0, i - 1);
            setCarouselSelectedIndex(next);
            return next;
          });
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          playNavigateSound();
          setActionsBrowsingMedia(true);
          setCarouselFocusIndex((i) => {
            const next = Math.min(mediaItems.length - 1, i + 1);
            setCarouselSelectedIndex(next);
            return next;
          });
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          playSelectSound();
          if (actionsBrowsingMedia) {
            const video = document.querySelector<HTMLVideoElement>(
              `[data-console-preview-video="${game?.appId || game?.id}"]`
            );
            if (video && hasPlayableVideo) {
              if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
            }
          } else {
            activateFocusedLeftAction();
          }
        } else if ((e.key === "PageUp" || e.key === "PageDown") && actionsBrowsingMedia) {
          e.preventDefault();
          seekVideo(e.key === "PageUp" ? -10 : 10);
        }
        break;
      }
      case "media-preview": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("media-carousel");
          setCarouselFocusIndex(carouselSelectedIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("actions");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("cards");
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playSelectSound();
          const video = document.querySelector<HTMLVideoElement>(
            `[data-console-preview-video="${game?.appId || game?.id}"]`
          );
          if (video && hasPlayableVideo) {
            if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
          }
        } else if (e.key === "PageUp" || e.key === "PageDown") {
          e.preventDefault();
          playNavigateSound();
          seekVideo(e.key === "PageUp" ? -10 : 10);
        }
        break;
      }
      case "media-carousel": {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          playNavigateSound();
          setCarouselFocusIndex((i) => {
            const next = Math.max(0, i - 1);
            setCarouselSelectedIndex(next);
            return next;
          });
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          playNavigateSound();
          setCarouselFocusIndex((i) => {
            const next = Math.min(mediaItems.length - 1, i + 1);
            setCarouselSelectedIndex(next);
            return next;
          });
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playSelectSound();
          // Play/pause the currently selected trailer
          const video = document.querySelector<HTMLVideoElement>(
            `[data-console-preview-video="${game?.appId || game?.id}"]`
          );
          if (video) {
            if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
          }
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("media-preview");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("hints");
        } else if (e.key === "PageUp" || e.key === "PageDown") {
          e.preventDefault();
          playNavigateSound();
          seekVideo(e.key === "PageUp" ? -10 : 10);
        }
        break;
      }
      case "hints": {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("media-carousel");
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          playNavigateSound();
          setFocusZone("back-button");
        }
        break;
      }
    }
  }, [focusZone, carouselFocusIndex, carouselSelectedIndex, mediaItems.length, handleClose, hasPlayableVideo, game?.appId, optionsOpen, installModalOpen, onSearchOpen, handlePlay, leftActionSubIndex, activateFocusedLeftAction, maxSubIndex, onNavigateRail, actionsBrowsingMedia, seekVideo]);

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
  const { prevSrc, currentSrc: crossfadeSrc } = useCrossfadeSrc(heroSrc);
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
    if (!crossfadeSrc) return;
    setAmbientSource("console-details", crossfadeSrc);
  }, [crossfadeSrc]);

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
    return s ?? t("console_settings.less_than_hour", "< 1h");
  }, [playtimeSeconds, t]);
  const lastPlayedTs = useMemo(() => (game ? getGameLastPlayedTimestamp(game) : null), [game]);
  const lastPlayedStr = lastPlayedTs ? formatRelativeTime(lastPlayedTs) : t("console_settings.never", "Never");

  const appIdStr = game?.appId ?? null;

  const {
    achievementsSummary,
    effectiveUnlocked,
    effectiveTotal,
    effectivePercent,
    isPerfected,
  } = useConsoleAchievements(appIdStr, game);

  const [animatedPercent, setAnimatedPercent] = useState(0);
  useEffect(() => {
    setAnimatedPercent(0);
    const raf = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        setAnimatedPercent(effectivePercent);
      });
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf);
  }, [effectivePercent]);

  const gameStatus = useMemo(() => {
    if (isPerfected) return { label: t("console_settings.completed", "Completed"), color: "text-emerald-400", Icon: CircleCheck };
    if (playtimeSeconds > 0) return { label: t("console_settings.in_progress", "In Progress"), color: "text-blue-400", Icon: Clock };
    return { label: t("console_settings.never_played", "Never Played"), color: "text-white/40", Icon: CircleDashed };
  }, [playtimeSeconds, isPerfected, t]);

  const releaseYear = useMemo(() => {
    if (!game?.metadata?.release_date) return null;
    const raw = game.metadata.release_date;
    const d = typeof raw === "string" ? raw : (raw as any)?.date ?? "";
    const m = d.match(/^(\d{4})/);
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
    return `${langs.slice(0, 6).join(", ")} ${t("console_settings.languages_more", "+{{count}} more", { count: langs.length - 6 })}`;
  }, [game?.metadata, t]);

  const dlcCount = game?.metadata?.dlc_count ?? 0;
  const dlcLabel = dlcCount <= 0 ? null : dlcCount === 1 ? t("console_settings.dlc_available_1", "1 DLC Available") : t("console_settings.dlcs_available_x", "{{count}} DLCs Available", { count: dlcCount });

  const {
    reviewSummary,
    isLoading: reviewIsLoading,
  } = useConsoleReviews(appIdStr);

  const reviewColors = reviewSummary
    ? (REVIEW_COLORS[reviewSummary.review_score_desc] ?? DEFAULT_REVIEW_COLOR)
    : DEFAULT_REVIEW_COLOR;

  /* ── Custom hint labels ── */
  const browseMediaHint = `[←/→] ${t("console_settings.browse_media", "Browse media")}`;
  const seekHint = `[LT/RT] ${t("console_settings.seek_video", "Seek video")}`;
  const playTrailerHint = useMemo(() => {
    if (gamepadActive) {
      const isPs = settings.inputHints === "playstation" || (settings.inputHints === "auto" && navigator.platform?.toLowerCase().includes("mac"));
      return isPs ? `[✕] ${t("console_settings.play_trailer", "Play trailer")}` : `[A] ${t("console_settings.play_trailer", "Play trailer")}`;
    }
    return `[Enter] ${t("console_settings.play_trailer", "Play trailer")}`;
  }, [gamepadActive, settings.inputHints, t]);

  /* ── Hints dinámicos según zona ── */
  const dynamicHints = useMemo(() => {
    const all = hints;
    if (focusZone === "actions" && actionsBrowsingMedia) {
      return [`[←/→] ${t("console_settings.browse", "Browse")}`, playTrailerHint, all.navigate, all.back, seekHint];
    } else if (focusZone === "actions") {
      return [all.play, all.select, browseMediaHint, all.navigate, all.back, all.options];
    } else if (focusZone === "media-preview" || focusZone === "media-carousel") {
      return [`[←/→] ${t("console_settings.browse", "Browse")}`, all.select, all.back, all.navigate, seekHint];
    } else if (focusZone === "cards") {
      return [all.navigate, all.select, all.back];
    } else if (focusZone === "hints") {
      return [all.navigate, all.back];
    } else {
      return [all.play, all.select, browseMediaHint, all.navigate, all.back, all.options, all.search, all.profile];
    }
  }, [focusZone, actionsBrowsingMedia, hints, playTrailerHint]);

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
            <p className="text-lg font-semibold text-(--color-text)">{t("console_settings.unable_to_load", "Unable to load game details")}</p>
            <p className="text-sm text-(--color-muted)">{t("console_settings.no_game_selected", "No game selected")}</p>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-(--color-accent) px-6 py-2.5 text-sm font-medium text-(--color-accent-text) transition hover:brightness-110"
            >
              {t("console_settings.go_back", "Go Back")}
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
      {/* ── Background hero with crossfade ── */}
      <div className="absolute inset-0 overflow-hidden">
        {prevSrc && (
          <img
            key={`prev-${prevSrc}`}
            src={prevSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover animate-hero-media-out"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        )}
        {crossfadeSrc ? (
          <img
            key={`current-${crossfadeSrc}`}
            src={crossfadeSrc}
            alt=""
            className={`h-full w-full object-cover transition-[transform,filter] duration-300 ease-out ${consoleHeroClass} ${heroZoomClass}`}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-full w-full bg-(--console-bg)" />
        )}
        {/* Subtle overall dim — pushes hero art back visually */}
        <div className="absolute inset-0 bg-black/20" />
        {/* Vignette — cinema spotlight effect, edges darken */}
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.55) 100%)" }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
      </div>

      {/* ── Top bar: Back + counter only ── */}
      <div className="pointer-events-none absolute left-5 top-4 z-30 flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          onFocus={() => setFocusZone("back-button")}
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-3 py-1.5 text-xs font-medium text-white/90 shadow-md shadow-black/30 ring-1 ring-white/10 backdrop-blur-md transition hover:bg-(--color-accent)/80 hover:text-white outline-none ${zoneFocusClass("back-button")}`}
        >
          {gamepadActive ? (
            <>
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-white/15 text-[9px] font-bold leading-none">{hints.back.startsWith("[") ? hints.back.split("]")[0].slice(1) : "B"}</span>
              {t("console_settings.back", "Back")}
            </>
          ) : (
            <><ArrowLeft className="h-3.5 w-3.5" /> {t("console_settings.back", "Back")}</>
          )}
        </button>
        {onNavigateRail && railGames && railIndex != null && railGames.length > 1 && (
          <span className="inline-flex items-center rounded-md bg-black/55 px-2 py-1 text-[10px] font-bold tabular-nums text-white/70 shadow-md shadow-black/30 ring-1 ring-white/10 backdrop-blur-md">
            {railIndex + 1} / {railGames.length}
          </span>
        )}
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
          className={`mx-auto mt-8 w-full max-w-[min(1800px,90vw)] cursor-pointer rounded-xl px-[clamp(24px,4vw,64px)] py-1 outline-none md:mt-12 ${zoneFocusClass("hero")}`}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={game.title}
              className="max-h-[clamp(100px,10vw,160px)] w-auto object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.8)]"
            />
          ) : (
            <h1 className="flex h-[clamp(80px,10vw,140px)] items-center text-4xl font-black leading-tight text-white drop-shadow-2xl lg:text-5xl">{game.title}</h1>
          )}
        </div>

        <div className="flex-1 lg:max-h-[220px]" />

        {/* ═══ Two-column panel ═══ */}
        <div className="mx-auto mb-6 flex w-full max-w-[min(1800px,90vw)] flex-col gap-4 px-[clamp(24px,4vw,64px)] md:mb-10 lg:flex-row lg:items-stretch lg:gap-6 lg:mb-[clamp(24px,4vh,56px)]">

          {/* ── LEFT: info card mejorada ── */}
          <div className={`${surfaceBg} flex w-full flex-col rounded-2xl p-5 shadow-2xl shadow-black/60 ring-1 ring-white/[0.08] backdrop-blur-md lg:w-[clamp(420px,28vw,600px)] lg:shrink-0 lg:p-[clamp(20px,2vw,32px)]`}>
            {/* Header row: cover + title/meta */}
            <div className="flex items-start gap-3 lg:gap-5">
              <div className="relative h-[clamp(80px,10vw,160px)] w-[clamp(70px,8vw,120px)] shrink-0 overflow-hidden rounded-2xl bg-black/10 ring-1 ring-white/10">
                {coverSrc ? (
                  <img src={coverSrc} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="flex h-full w-[100px] items-center justify-center bg-white/5">
                    <Gamepad2 className="h-8 w-8 text-white/20 lg:h-10 lg:w-10" />
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
                <h2 className="truncate text-sm font-bold text-(--color-text) lg:text-lg">{game.title}</h2>
                <p className="mt-0.5 truncate text-[11px] text-(--color-muted)/70 lg:text-[12px]">
                  {[releaseYear, developer].filter(Boolean).join("  ·  ")}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-(--color-muted)/60 lg:text-[11px]">
                  <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" />{getGameDiskSize(game)}</span>
                  {game.steamInstalled && <span className="rounded bg-emerald-500/80 px-1.5 py-0.5 font-semibold text-black">{t("settings.installed", "Installed")}</span>}
                  {game.isLuaActive && <span className="rounded bg-violet-500/80 px-1.5 py-0.5 font-semibold text-white">{t("console_settings.lua", "Lua")}</span>}
                  {game.source === "steam" && !game.hasLua && (
                    <span className="rounded bg-blue-500/80 px-1.5 py-0.5 font-semibold text-white">{t("console_settings.steam", "Steam")}</span>
                  )}
                  {game.source === "epic" && (
                    <span className="rounded bg-purple-500/80 px-1.5 py-0.5 font-semibold text-white">{t("console_settings.epic", "Epic")}</span>
                  )}
                  {game.source === "debrid" && game.repacker && (
                    <span className="rounded bg-cyan-500/80 px-1.5 py-0.5 font-semibold text-black">{game.repacker.toUpperCase()}</span>
                  )}
                  {game.source === "emulator" && (
                    <span className="rounded bg-rose-500/80 px-1.5 py-0.5 font-semibold text-white">
                      {getPlatformShortName(game.emulatorPlatform) ? `${getPlatformShortName(game.emulatorPlatform)} • EMULATOR` : "EMULATOR"}
                    </span>
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
                <span className="text-[10px] text-(--color-muted)/50">{t("console_settings.loading_reviews", "Loading reviews…")}</span>
              )}
              {genres?.map((g) => (
                <span key={g} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-(--color-muted) ring-1 ring-white/10 lg:text-[11px]">{g}</span>
              ))}
            </div>

            {/* Stats: Time Played / Last Played / Status */}
            <div className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
              <div className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
                <span className="block text-[9px] font-medium uppercase tracking-wider text-white/35 lg:text-[10px]">{t("console_settings.time_played", "Time Played")}</span>
                <span className="block truncate text-[12px] font-semibold text-white/85 lg:text-[13px]">{playtimeDisplay}</span>
              </div>
              <div className="rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
                <span className="block text-[9px] font-medium uppercase tracking-wider text-white/35 lg:text-[10px]">{t("console_settings.last_played", "Last Played")}</span>
                <span className="block truncate text-[12px] font-semibold text-white/85 lg:text-[13px]">{lastPlayedStr}</span>
              </div>
              <div className="col-span-2 rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06] lg:col-span-1">
                <span className="block text-[9px] font-medium uppercase tracking-wider text-white/35 lg:text-[10px]">{t("console_settings.status", "Status")}</span>
                <span className={`inline-flex items-center gap-1 text-[12px] font-semibold lg:text-[13px] ${gameStatus.color}`}>
                  <gameStatus.Icon className="h-3 w-3" />
                  {gameStatus.label}
                </span>
              </div>
            </div>

            {/* Achievements bar y lista reciente */}
            {achievementsSummary && effectiveTotal > 0 && (
              <div className="mt-2 rounded-lg bg-black/20 px-2.5 py-1.5 ring-1 ring-white/[0.06]">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-white/60 lg:text-[11px]">
                    <Trophy className={`h-3.5 w-3.5 ${isPerfected ? "fill-amber-400 text-amber-400" : ""}`} />
                    {t("console_settings.achievements", "Achievements")}
                  </span>
                  <span className="text-[10px] font-semibold tabular-nums text-white/70 lg:text-[11px]">
                    {effectiveUnlocked}/{effectiveTotal} ({effectivePercent}%)
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isPerfected ? "bg-gradient-to-r from-amber-400 to-yellow-300" : "bg-(--color-accent)"}`}
                    style={{ width: `${animatedPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Actions row mejorada */}
            <div
              data-focus-zone="actions"
              onFocus={() => { setFocusZone("actions"); setLeftActionSubIndex(0); }}
              className={`mt-3 rounded-xl p-1 outline-none ${zoneFocusClass("actions")}`}
            >
              {isRunning ? (
                <div className="flex flex-col gap-1.5">
                  {/* Stop — subIndex 0 */}
                  <button
                    type="button"
                    onClick={handleStop}
                    className={`w-full rounded-xl bg-red-500 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110 ${focusZone === "actions" && !actionsBrowsingMedia && leftActionSubIndex === 0 ? "scale-[1.02] ring-2 ring-(--color-accent) ring-offset-2" : ""}`}
                  >
                    <Square className="mr-2 inline h-4 w-4 fill-current" /> {t("console_settings.stop", "Stop")}
                  </button>
                  {/* Return — subIndex 1 */}
                  {gameSession?.pid != null && (
                    <button
                      type="button"
                      onClick={handleReturn}
                      className={`w-full rounded-xl border border-white/20 py-3 text-sm font-medium text-white transition hover:bg-white/10 ${focusZone === "actions" && !actionsBrowsingMedia && leftActionSubIndex === 1 ? "scale-[1.02] ring-2 ring-(--color-accent) ring-offset-2" : ""}`}
                    >
                      <Play className="mr-2 inline h-4 w-4" /> {t("console_settings.return", "Return")}
                    </button>
                  )}
                </div>
              ) : isLaunching ? (
                <button type="button" disabled className="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-(--color-accent-text) shadow-xl shadow-(--color-accent)/25 opacity-50 cursor-not-allowed">
                  <div className="mr-2 inline h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {t("console_settings.launching", "Launching…")}
                </button>
              ) : isStopping ? (
                <button type="button" disabled className="w-full rounded-xl bg-red-500/60 py-3 text-sm font-bold text-white opacity-50 cursor-not-allowed">
                  <div className="mr-2 inline h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {t("console_settings.stopping", "Stopping…")}
                </button>
              ) : actionInFlight ? (
                <button type="button" disabled className="w-full rounded-xl bg-(--color-accent)/70 py-3 text-sm font-bold text-(--color-accent-text) shadow-lg opacity-60 cursor-not-allowed">
                  <div className="mr-2 inline h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {actionModel?.label ?? t("console_settings.play", "Play")}…
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  onMouseEnter={() => setPlayHovered(true)}
                  onMouseLeave={() => setPlayHovered(false)}
                  disabled={!actionModel?.enabled}
                  className={`w-full rounded-xl py-3 text-sm font-bold transition-all duration-150 ${
                    actionModel?.enabled === false
                      ? "bg-white/20 text-white opacity-50 cursor-not-allowed shadow-none"
                      : "bg-(--color-accent) text-(--color-accent-text) shadow-lg shadow-(--color-accent)/30 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(var(--color-accent-rgb,59,130,246),0.4)] hover:brightness-110 active:scale-[0.98]"
                  } ${focusZone === "actions" && !actionsBrowsingMedia && leftActionSubIndex === 0 ? "scale-[1.02] ring-2 ring-(--color-accent) ring-offset-2" : ""}`}
                >
                  <ActionIcon action={actionModel?.action ?? "unavailable"} className="mr-2 inline h-4 w-4" />
                  {actionModel?.label ?? t("console_settings.play", "Play")}
                </button>
              )}
              {/* Botones secundarios: Options + Mute + Favorites */}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOptionsOpen(true)}
                  className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 transition-all duration-150 ${
                    focusZone === "actions" && !actionsBrowsingMedia && leftActionSubIndex === (isRunning ? 2 : 1)
                      ? "border-(--color-accent)/50 ring-2 ring-(--color-accent)/40 text-white"
                      : "border-white/20 text-white/60 hover:bg-white/10"
                  }`}
                  title={t("console_settings.more_options", "More options")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleVideoMute}
                  className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 transition-all duration-150 ${
                    focusZone === "actions" && !actionsBrowsingMedia && leftActionSubIndex === (isRunning ? 3 : 2)
                      ? "border-(--color-accent)/50 ring-2 ring-(--color-accent)/40 text-white"
                      : "border-white/20 text-white/60 hover:bg-white/10"
                  }`}
                  title={muted ? t("console_settings.unmute_video", "Unmute video") : t("console_settings.mute_video", "Mute video")}
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleFavoriteToggle}
                  className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 text-xs transition-all duration-150 ${
                    isFav ? "text-rose-400" : "text-white/60"
                  } ${focusZone === "actions" && !actionsBrowsingMedia && leftActionSubIndex === (isRunning ? 4 : 3) ? "border-(--color-accent)/50 ring-2 ring-(--color-accent)/40" : "border-white/20 hover:bg-white/10"}`}
                  title={isFav ? t("console_settings.remove_from_favorites", "Remove from Favorites") : t("console_settings.add_to_favorites", "Add to Favorites")}
                >
                  <Heart className={`h-4 w-4 ${isFav ? "fill-rose-400 text-rose-400" : ""}`} />
                </button>
              </div>
            </div>

            {/* About + secondary metadata con scroll container */}
            <div className="mt-3 flex flex-1 flex-col">
              <div
                data-scroll-container
                className="max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent pr-1 lg:max-h-[160px]"
              >
                {aboutTheGame && (
                  <p className="text-[11px] leading-relaxed text-(--color-muted)/75 lg:text-[12px]">{aboutTheGame}</p>
                )}
              </div>

              {(languagesLabel || dlcLabel || (publisher && publisher !== developer)) && (
                <div className="mt-auto space-y-1 border-t border-white/[0.06] pt-2 text-[10px] text-(--color-muted)/60 lg:text-[11px]">
                  {publisher && publisher !== developer && (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="uppercase tracking-wider text-white/35">{t("console_settings.publisher_abbr", "Pub")}</span>
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
              onMouseEnter={() => setPreviewHovered(true)}
              onMouseLeave={() => setPreviewHovered(false)}
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
                autoplay={playerMode === "details"}
                showVideo={previewHovered || actionsBrowsingMedia || isRunning}
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

        {/* ═══ Side navigation arrows ═══ */}
        {onNavigateRail && railGames && railGames.length > 1 && (
          <>
            {/* Left arrow — prev game (hidden at first) */}
            {railIndex != null && railIndex > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigateRail("prev"); }}
                className="pointer-events-auto absolute left-[clamp(8px,2vw,28px)] top-1/2 z-20 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-black/55 px-2 py-3 text-white/80 shadow-xl shadow-black/40 ring-1 ring-white/10 backdrop-blur-md transition-all duration-200 hover:bg-(--color-accent)/80 hover:text-white hover:shadow-(--color-accent)/30 hover:ring-(--color-accent)/40"
                title={t("console_settings.previous_game", "Previous game")}
              >
                <ChevronLeft className="h-5 w-5" />
                {gamepadActive && <span className="text-[8px] font-bold tracking-wider text-white/50">LB</span>}
              </button>
            )}
            {/* Right arrow — next game (hidden at last) */}
            {railIndex != null && railIndex < railGames.length - 1 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onNavigateRail("next"); }}
                className="pointer-events-auto absolute right-[clamp(8px,2vw,28px)] top-1/2 z-20 flex flex-col items-center justify-center gap-0.5 rounded-xl bg-black/55 px-2 py-3 text-white/80 shadow-xl shadow-black/40 ring-1 ring-white/10 backdrop-blur-md transition-all duration-200 hover:bg-(--color-accent)/80 hover:text-white hover:shadow-(--color-accent)/30 hover:ring-(--color-accent)/40"
                title={t("console_settings.next_game", "Next game")}
              >
                <ChevronRight className="h-5 w-5" />
                {gamepadActive && <span className="text-[8px] font-bold tracking-wider text-white/50">RB</span>}
              </button>
            )}
          </>
        )}

        {/* ═══ Hints dinámicos ═══ */}
        <div
          className={`mx-auto mb-4 flex w-full max-w-[min(1800px,90vw)] flex-wrap justify-center gap-x-4 gap-y-1 rounded-xl px-[clamp(24px,4vw,64px)] py-2 outline-none ${zoneFocusClass("hints")}`}
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