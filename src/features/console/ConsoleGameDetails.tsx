import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import {
  ArrowLeft, Trophy, Heart, Gamepad2, Play, Clock, HardDrive, CheckCircle2,
  Star, Languages, Layers,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleSettings } from "./consoleSettings";
import type { GameAchievementsSummary } from "../../types/gameAchievements";
import type { SteamReviewSummary } from "../../types/gameReview";
import type { StoreMediaItem, StoreTrailerMedia } from "../../types/store";
import { useFavorites } from "../../context/FavoritesContext";
import { useTheme } from "../../context/ThemeContext";
import { getPlaytimeSecondsForAppId } from "../../services/playtimeService";
import { achievementStore } from "../../services/achievementStore";
import { resolveGameReviewSummaries } from "../../services/gameReviewResolver";
import { buildStoreMedia } from "../../services/storeMediaService";
import { getConsoleHeroBackground, getConsoleCardSrc, getConsoleLogoSrc } from "./consoleMedia";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import { useSettings } from "../../context/SettingsContext";
import {
  formatRelativeTime,
  formatPlaytime,
  getGameDiskSize,
  getGameLastPlayedTimestamp,
} from "./consoleGameStats";
import ConsoleMediaGallery from "./ConsoleMediaGallery";
import ConsoleSelectedPreview from "./ConsoleSelectedPreview";
import { getConsoleInputHints } from "./consoleInputHints";
import type { TrailerData } from "./consoleTrailerData";
import { resolveConsoleDetailsArtwork, clearConsoleArtworkCache, consoleArtworkToBundle } from "./consoleArtworkResolver";
import type { ConsoleArtwork, ConsoleArtworkOptions } from "./consoleArtworkResolver";
import { stripHtml } from "../../utils/stripHtml";

const DEBUG = false;
const DEBUG_CONSOLE_ACHIEVEMENTS = false;
const ENTER_DURATION = 280;
const EXIT_DURATION = 200;
const ENTER_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const EXIT_EASING = "ease-in";

const _prefersReducedMotion = typeof window !== "undefined"
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

type FocusZone = "back-button" | "left-info" | "media-player" | "media-carousel" | "info-cards" | "action-hints";

type Props = {
  game: LibraryGame;
  onClose: () => void;
  settings: ConsoleSettings;
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

export default function ConsoleGameDetails({ game, onClose, settings }: Props) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { surfaceMode } = useTheme();
  const { settings: appSettings } = useSettings();
  const hints = useMemo(() => getConsoleInputHints(settings.inputHints), [settings.inputHints]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");
  const reducedMotion = _prefersReducedMotion;

  /* ══════════════════════════════════════════
     FOCUS ZONE MODEL
     ══════════════════════════════════════════ */
  const [focusZone, setFocusZone] = useState<FocusZone>("media-player");
  const [carouselFocusIndex, setCarouselFocusIndex] = useState<number>(0);
  const [carouselSelectedIndex, setCarouselSelectedIndex] = useState<number>(0);

  /* ── Multi-source artwork enrichment ── */
  const [artwork, setArtwork] = useState<ConsoleArtwork | null>(null);

  useEffect(() => {
    const appId = game?.appId;
    if (!appId) return;
    setArtwork(null);

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

  /* ── Enter animation ── */
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("visible"));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = useCallback(() => {
    if (phase === "exit") return;
    setPhase("exit");
    setTimeout(() => onClose(), EXIT_DURATION + 20);
  }, [phase, onClose]);

  /* ══════════════════════════════════════════
     KEYBOARD NAVIGATION — Focus zone model
     ══════════════════════════════════════════ */
  const handleZoneKeyDown = useCallback((e: KeyboardEvent) => {
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
        } else if (e.key === "ArrowDown" || e.key === "Tab") {
          e.preventDefault();
          setFocusZone("media-carousel");
        }
        break;
      }
      case "media-player": {
        if (e.key === "ArrowDown" || e.key === "Tab") {
          e.preventDefault();
          setFocusZone("media-carousel");
          setCarouselFocusIndex(carouselSelectedIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("left-info");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusZone("media-carousel");
          setCarouselFocusIndex(carouselSelectedIndex);
        }
        break;
      }
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
          setFocusZone("media-player");
        } else if (e.key === "ArrowDown" || e.key === "Tab") {
          e.preventDefault();
          setFocusZone("info-cards");
        }
        break;
      }
      case "info-cards": {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("media-carousel");
        } else if (e.key === "ArrowDown" || e.key === "Tab") {
          e.preventDefault();
          setFocusZone("action-hints");
        }
        break;
      }
      case "action-hints": {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("info-cards");
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setFocusZone("left-info");
        } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          setFocusZone("back-button");
        }
        break;
      }
      case "left-info": {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusZone("media-player");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusZone("action-hints");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setFocusZone("media-player");
        }
        break;
      }
    }
  }, [focusZone, carouselFocusIndex, carouselSelectedIndex, mediaItems.length, handleClose]);

  useEffect(() => {
    window.addEventListener("keydown", handleZoneKeyDown);
    return () => window.removeEventListener("keydown", handleZoneKeyDown);
  }, [handleZoneKeyDown]);

  /* ── Sync carousel focus when selected changes ── */
  useEffect(() => {
    setCarouselFocusIndex(carouselSelectedIndex);
  }, [carouselSelectedIndex]);

  /* ── Auto-scroll left panel when focused ── */
  useEffect(() => {
    if (focusZone === "left-info" && leftPanelRef.current) {
      leftPanelRef.current.focus({ preventScroll: false });
    }
  }, [focusZone]);

  useEffect(() => {
    if (DEBUG) {
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
  const logoSrc = mediaBundle?.logo?.url ?? getConsoleLogoSrc(game);
  const isFav = game?.appId ? favoriteIds.has(game.appId) : false;

  const playtimeSeconds = useMemo(
    () => (game?.appId ? getPlaytimeSecondsForAppId(game.appId) : 0),
    [game],
  );
  const playtimeDisplay = useMemo(() => {
    const s = formatPlaytime(playtimeSeconds);
    return s ?? "< 1h";
  }, [playtimeSeconds]);
  const lastPlayedTs = useMemo(() => (game ? getGameLastPlayedTimestamp(game) : null), [game]);
  const lastPlayedStr = lastPlayedTs ? formatRelativeTime(lastPlayedTs) : "Never";

  /* ── Achievements ── */
  const appIdStr = game?.appId ?? null;

  const [achievementsSummary, setAchievementsSummary] = useState<GameAchievementsSummary | null>(() => {
    if (!appIdStr) return null;
    const fromStore = achievementStore.getSummary(appIdStr);
    if (fromStore) return fromStore;
    const snap = getCachedSnapshot();
    const snapGame = snap?.library?.games?.find(g => g.appId === appIdStr);
    if (snapGame?.achievementSummary && snapGame.achievementSummary.total > 0) {
      const a = snapGame.achievementSummary;
      return {
        appId: appIdStr,
        source: "local-cache" as const,
        total: a.total,
        unlocked: a.unlocked ?? 0,
        percent: a.percent ?? 0,
        progressAvailable: a.progressAvailable ?? false,
        updatedAt: snapGame.updatedAt ?? 0,
        achievements: [],
      };
    }
    return null;
  });

  useEffect(() => {
    if (!appIdStr) return;
    const unsub = achievementStore.subscribe((appId, summary) => {
      if (appId !== appIdStr) return;
      setAchievementsSummary(summary);
    });
    return unsub;
  }, [appIdStr]);

  useEffect(() => {
    if (!appIdStr || !achievementsSummary) return;
    if (achievementsSummary.progressAvailable) return;
    const list = achievementsSummary.achievements;
    if (!list || list.length === 0) return;
    const unlocked = list.filter(a => a.unlocked).length;
    if (unlocked === 0) return;
    const total = list.length;
    const percent = Math.round((unlocked / total) * 100);
    const patched: GameAchievementsSummary = {
      ...achievementsSummary,
      unlocked,
      total,
      percent,
      progressAvailable: true,
    };
    if (DEBUG_CONSOLE_ACHIEVEMENTS) console.log(`[CONSOLE_ACHIEVEMENTS][DERIVED] appid=${appIdStr} unlocked=${unlocked}/${total} percent=${percent}`);
    achievementStore.setSummary(appIdStr, patched);
    setAchievementsSummary(patched);
  }, [appIdStr, achievementsSummary]);

  const derivedUnlocked = achievementsSummary?.achievements?.filter(a => a.unlocked).length ?? 0;
  const effectiveUnlocked = achievementsSummary?.unlocked ?? derivedUnlocked;
  const effectiveTotal = achievementsSummary?.total ?? achievementsSummary?.achievements?.length ?? 0;
  const effectivePercent = effectiveTotal > 0 ? Math.round((effectiveUnlocked / effectiveTotal) * 100) : 0;
  const isPerfected = effectiveTotal > 0 && effectiveUnlocked >= effectiveTotal;

  if (DEBUG_CONSOLE_ACHIEVEMENTS) {
    const libSource = achievementStore.getSummary(appIdStr ?? "")?.source ?? "null";
    console.log(`[CONSOLE_ACHIEVEMENTS] appid=${appIdStr} console=${achievementsSummary ? `${effectiveUnlocked}/${effectiveTotal}` : "null"} librarySource=${libSource} source=${achievementsSummary?.source ?? "null"}`);
  }

  const releaseYear = useMemo(() => {
    if (!game?.metadata?.release_date) return null;
    const m = game.metadata.release_date.match(/^(\d{4})/);
    return m ? m[1] : null;
  }, [game]);

  const developer = game?.metadata?.developer ?? null;
  const publisher = game?.metadata?.publishers?.join(", ") ?? null;
  const genres = useMemo(() => game?.metadata?.genres?.slice(0, 4) ?? null, [game]);
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

  const categories = useMemo(() => game?.metadata?.categories?.slice(0, 6) ?? null, [game?.metadata]);

  const languagesLabel = useMemo(() => {
    const langs = game?.metadata?.languages;
    if (!langs || langs.length === 0) return null;
    if (langs.length <= 6) return langs.join(", ");
    return `${langs.slice(0, 6).join(", ")} +${langs.length - 6} more`;
  }, [game?.metadata]);

  const dlcCount = game?.metadata?.dlc_count ?? 0;
  const dlcLabel = dlcCount <= 0 ? null : dlcCount === 1 ? "1 DLC Available" : `${dlcCount} DLCs Available`;

  const hasRequirements = !!(game?.metadata?.pc_requirements?.minimum || game?.metadata?.pc_requirements?.recommended);

  const handleFavoriteToggle = useCallback(() => {
    if (game?.appId) toggleFavorite(game.appId);
  }, [game, toggleFavorite]);

  /* ── Achievement mini rows (up to 2, compact) ── */
  const achievementMiniRows = useMemo(() => {
    const list = achievementsSummary?.achievements;
    if (!list || list.length === 0) return null;
    const sorted = [...list].sort((a, b) => (b.unlocked === a.unlocked ? 0 : b.unlocked ? 1 : -1));
    return sorted.slice(0, 2);
  }, [achievementsSummary]);

  /* ══════════════════════════════════════════
     REVIEWS CARD
     ══════════════════════════════════════════ */
  const [reviewSummary, setReviewSummary] = useState<SteamReviewSummary | null>(null);
  const reviewFetchRef = useRef(false);

  useEffect(() => {
    if (!game?.appId) return;
    reviewFetchRef.current = false;
  }, [game?.appId]);

  useEffect(() => {
    if (!game?.appId) return;
    const appIdNum = Number(game.appId);
    if (!appIdNum || appIdNum <= 0) return;
    if (reviewFetchRef.current) return;
    reviewFetchRef.current = true;

    resolveGameReviewSummaries([appIdNum]).then((result) => {
      const s = result[appIdNum];
      if (s && s.resolved && s.total_reviews > 0) {
        setReviewSummary(s);
      }
    });
  }, [game?.appId]);

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

  /* ── Zone focus class ── */
  const zoneFocus = (zone: FocusZone) =>
    focusZone === zone ? "ring-2 ring-(--color-accent)/50 shadow-lg shadow-(--color-accent)/10 transition-all duration-150" : "";

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
              className="rounded-lg bg-(--color-accent) px-6 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
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
            key={game.appId}
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

      {/* ── Back button ── */}
      <div className="pointer-events-none absolute left-4 top-3 z-30">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          onFocus={() => setFocusZone("back-button")}
          className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm transition hover:bg-(--color-accent)/80 hover:text-white ${zoneFocus("back-button")}`}
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
             LEFT COLUMN — Scrollable game info panel
             ════════════════════════════════════════ */}
          <div
            ref={leftPanelRef}
            tabIndex={-1}
            onFocus={() => setFocusZone("left-info")}
            data-focused={focusZone === "left-info" ? "true" : undefined}
            className={`relative w-[35%] shrink-0 overflow-y-auto rounded-2xl bg-(--color-surface)/10 scrollbar-thin scrollbar-thumb-(--color-border)/20 ${zoneFocus("left-info")}`}
          >
            {/* Fade edge at top/bottom to signal scrollability */}
            <div className="pointer-events-none sticky top-0 z-10 h-6 bg-gradient-to-b from-(--color-surface)/40 to-transparent" />

            {/* Fixed identity section at top */}
            <div className="shrink-0 px-3">
              {/* IdentityRow: Cover + GameInfo (logo, dev, badges) */}
              <div className="flex gap-3.5">
                <div className="w-[140px] shrink-0 overflow-hidden rounded-2xl bg-(--color-surface)/60 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]">
                  {coverSrc ? (
                    <img
                      key={game.appId}
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
                      <Gamepad2 className="h-10 w-10 text-(--color-muted)/30" />
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                  {logoSrc ? (
                    <img
                      src={logoSrc}
                      alt={game.title}
                      className="max-h-[32px] max-w-[220px] object-contain"
                    />
                  ) : (
                    <h2 className="text-base font-bold leading-tight text-(--color-text)">
                      {game.title}
                    </h2>
                  )}
                  {releaseYear && (
                    <p className="text-xs text-(--color-muted)">{releaseYear}</p>
                  )}
                  {developer && (
                    <p className="truncate text-xs text-(--color-muted)" title={developer}>
                      {developer}
                    </p>
                  )}
                  {publisher && !developer && (
                    <p className="truncate text-xs text-(--color-muted)" title={publisher}>
                      {publisher}
                    </p>
                  )}

                  {/* Badges — compact under title */}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {game.steamInstalled && (
                      <span className="rounded-md bg-emerald-500/80 px-2 py-0.5 text-[11px] font-medium text-black">
                        Installed
                      </span>
                    )}
                    {game.isLuaActive && (
                      <span className="rounded-md bg-violet-500/80 px-2 py-0.5 text-[11px] font-medium text-white">
                        Lua
                      </span>
                    )}
                    {isFav && (
                      <span className="rounded-md bg-rose-500/80 px-2 py-0.5 text-[11px] font-medium text-white">
                        Favorite
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-2.5">
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1.5 rounded-lg bg-(--color-accent)/50 px-4 py-2 text-sm font-semibold text-white opacity-70"
                >
                  <Play className="h-4 w-4" />
                  Play
                </button>
                <button
                  type="button"
                  onClick={handleFavoriteToggle}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-(--color-border)/60 px-3 py-2 text-sm font-medium text-(--color-muted) transition hover:bg-(--color-surface)/40"
                  title={isFav ? "Remove from Favorites" : "Add to Favorites"}
                >
                  <Heart className={`h-4 w-4 ${isFav ? "fill-rose-400 text-rose-400" : ""}`} />
                </button>
              </div>

              {/* Stats grid — 2x2 compact */}
              <div className="mt-3 grid grid-cols-2 gap-2">
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
                    className="rounded-xl bg-(--color-surface)/40 px-3 py-2 ring-1 ring-white/[0.04]"
                  >
                    <div className="flex items-center gap-1.5 text-(--color-muted)">
                      <Icon className="h-3 w-3" />
                      <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-(--color-text)">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Scrollable info sections */}
            <div className="mt-4 space-y-3.5 px-3 pb-6">
              {/* About the Game */}
              {aboutTheGame && (
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
            </div>

            {/* Bottom fade */}
            <div className="pointer-events-none sticky bottom-0 z-10 h-6 bg-gradient-to-t from-(--color-surface)/40 to-transparent" />
          </div>

          {/* ════════════════════════════════════════
             RIGHT COLUMN — Media Frame → Carousel → Info Cards → Hints
             ════════════════════════════════════════ */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* ── Media Player Frame ── */}
            <div
              className={`relative w-full overflow-hidden rounded-2xl bg-black/50 shadow-xl shadow-black/30 ring-1 ring-white/[0.06] ${zoneFocus("media-player")}`}
              style={{ aspectRatio: "16/9", maxHeight: "clamp(200px, 32vh, 400px)" }}
              onClick={() => setFocusZone("media-player")}
            >
              <ConsoleSelectedPreview
                game={game}
                showTrailerPreview
                trailerData={trailerData}
                screenshotOverrideUrl={screenshotOverrideUrl}
                mode={playerMode}
                autoplay
              />
            </div>

            {/* ── Media Carousel (below player, 16px gap) ── */}
            {mediaItems.length > 0 && (
              <div
                className={zoneFocus("media-carousel")}
                onClick={() => { setFocusZone("media-carousel"); setCarouselFocusIndex(carouselSelectedIndex); }}
              >
                <ConsoleMediaGallery
                  items={mediaItems}
                  selectedIndex={carouselSelectedIndex}
                  onSelect={(idx) => setCarouselSelectedIndex(idx)}
                  focusedIndex={focusZone === "media-carousel" ? carouselFocusIndex : undefined}
                />
              </div>
            )}

            {/* ── Two-column row: Achievements | Reviews ── */}
            <div
              className={`grid grid-cols-2 gap-3 ${zoneFocus("info-cards")}`}
              onClick={() => setFocusZone("info-cards")}
            >
              {/* ═══ Achievements Card (compact) ═══ */}
              <div className="rounded-2xl bg-(--color-surface)/40 ring-1 ring-white/[0.04]">
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

              {/* ═══ Reviews Card ═══ */}
              <div className={`rounded-2xl ${reviewColors.bg} ${reviewColors.border} ring-1 ring-inset`}>
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
                      {reviewFetchRef.current ? "Loading review data…" : "No review data"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Action hints — bottom-right ── */}
            <div
              className={`mt-auto flex justify-end gap-x-4 gap-y-1 pt-2 rounded-xl px-3 py-2 ${zoneFocus("action-hints")}`}
              onClick={() => setFocusZone("action-hints")}
            >
              <HintLabel focus={focusZone === "action-hints"}>{hints.selectPlay}</HintLabel>
              <HintLabel focus={focusZone === "action-hints"}>{hints.details}</HintLabel>
              <HintLabel focus={focusZone === "action-hints"}>{hints.options}</HintLabel>
              <HintLabel focus={focusZone === "action-hints"}>{hints.back}</HintLabel>
            </div>
          </div>
        </div>
      </div>
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
