import { useMemo, useEffect, useCallback, useRef, useState } from "react";
import { ArrowLeft, Trophy, Heart, Gamepad2, Play, MoreHorizontal, Clock, HardDrive, CheckCircle2 } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { ConsoleSettings } from "./consoleSettings";
import type { GameAchievementsSummary } from "../../types/gameAchievements";
import { useFavorites } from "../../context/FavoritesContext";
import { useTheme } from "../../context/ThemeContext";
import { getPlaytimeSecondsForAppId } from "../../services/playtimeService";
import { achievementStore } from "../../services/achievementStore";
import { getConsoleHeroBackground, getConsoleCardSrc, getConsoleLogoSrc } from "./consoleMedia";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import {
  formatRelativeTime,
  formatPlaytime,
  getGameDiskSize,
  getGameLastPlayedTimestamp,
} from "./consoleGameStats";
import ConsoleSelectedPreview from "./ConsoleSelectedPreview";
import { getConsoleInputHints } from "./consoleInputHints";

const DEBUG = false;
const DEBUG_CONSOLE_ACHIEVEMENTS = false;
const ENTER_DURATION = 280;
const EXIT_DURATION = 200;
const ENTER_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const EXIT_EASING = "ease-in";

const _prefersReducedMotion = typeof window !== "undefined"
  ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
  : false;

type Props = {
  game: LibraryGame;
  onClose: () => void;
  settings: ConsoleSettings;
};

export default function ConsoleGameDetails({ game, onClose, settings }: Props) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { surfaceMode } = useTheme();
  const hints = useMemo(() => getConsoleInputHints(settings.inputHints), [settings.inputHints]);
  const sheetRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");
  const reducedMotion = _prefersReducedMotion;

  /* ── Kick off enter animation ── */
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

  /* ── Escape closes ── */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); handleClose(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

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
  const heroSrc = getConsoleHeroBackground(game);
  const coverSrc = getConsoleCardSrc(game, "poster");
  const logoSrc = getConsoleLogoSrc(game);
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

  /* ── Achievements — matches Library GameDetails data source ── */
  const appIdStr = game?.appId ?? null;

  // Match Library: useState initializer checks store → snapshot fallback
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

  // Subscribe to central store for live updates (matches Library)
  useEffect(() => {
    if (!appIdStr) return;
    const unsub = achievementStore.subscribe((appId, summary) => {
      if (appId !== appIdStr) return;
      setAchievementsSummary(summary);
    });
    return unsub;
  }, [appIdStr]);

  // Derive progress from loaded achievement list if summary doesn't have it (matches Library)
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

  // Derive unlocked/total from available list (matches Library effectiveUnlocked/effectiveTotal)
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

  const handleFavoriteToggle = useCallback(() => {
    if (game?.appId) toggleFavorite(game.appId);
  }, [game, toggleFavorite]);

  /* ── Animation style tokens ── */
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

  /* ── Invalid game fallback ── */
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

  /* ═══════════════════════════════════════════════
     VALID GAME — Bottom cinematic sheet
     ═══════════════════════════════════════════════ */
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

      {/* ── Dim overlay ── */}
      <div className="pointer-events-none absolute inset-0 z-[5] bg-black/30" />

      {/* ── Back button ── */}
      <div className="pointer-events-none absolute left-4 top-3 z-30">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm transition hover:bg-(--color-accent)/80 hover:text-white"
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
        {/* Surface-aware background layer */}
        <div className={`${surfaceBg} absolute inset-0`} />

        {/* Subtle top-edge shine */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* ── Content ── */}
        <div className="relative z-10 flex h-full w-full gap-8 p-8">
          {/* ════════════════════════════════════════
             LEFT COLUMN (42%) — Cover, info, stats, actions
             ════════════════════════════════════════ */}
          <div className="flex w-[42%] shrink-0 flex-col gap-5 overflow-y-auto">
            {/* Cover + title row */}
            <div className="flex gap-5">
              {/* Cover poster — fixed 200px width, 2:3 */}
              <div className="w-[200px] shrink-0 overflow-hidden rounded-2xl bg-(--color-surface)/60 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]">
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

              {/* Title + badges column */}
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={game.title}
                    className="max-h-[40px] w-full object-contain"
                  />
                ) : (
                  <h2 className="text-lg font-bold leading-tight text-(--color-text)">
                    {game.title}
                  </h2>
                )}
                {releaseYear && (
                  <p className="text-sm text-(--color-muted)">{releaseYear}</p>
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

                {/* Badges */}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {game.steamInstalled && (
                    <span className="rounded-md bg-emerald-500/80 px-2.5 py-0.5 text-xs font-medium text-black">
                      Installed
                    </span>
                  )}
                  {game.isLuaActive && (
                    <span className="rounded-md bg-violet-500/80 px-2.5 py-0.5 text-xs font-medium text-white">
                      Lua
                    </span>
                  )}
                  {isFav && (
                    <span className="rounded-md bg-rose-500/80 px-2.5 py-0.5 text-xs font-medium text-white">
                      Favorite
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Stats grid — 2x2 card-like blocks */}
            <div className="grid grid-cols-2 gap-3">
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
                  className="rounded-xl bg-(--color-surface)/40 px-4 py-3 ring-1 ring-white/[0.04]"
                >
                  <div className="flex items-center gap-2 text-(--color-muted)">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
                  </div>
                  <p className="mt-0.5 text-base font-semibold text-(--color-text)">{value}</p>
                </div>
              ))}
            </div>

            {/* Short description — 3 lines max */}
            {description && (
              <p className="line-clamp-3 text-sm leading-relaxed text-(--color-muted)">
                {description}
              </p>
            )}

            {/* Action row — read-only except Favorite */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-xl bg-(--color-accent)/50 px-6 py-2.5 text-sm font-semibold text-white opacity-80"
              >
                <Play className="h-5 w-5" />
                Play
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-xl border border-(--color-border)/60 px-5 py-2.5 text-sm font-medium text-(--color-muted) opacity-60"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={handleFavoriteToggle}
                className="inline-flex items-center gap-2 rounded-xl border border-(--color-border)/60 px-5 py-2.5 text-sm font-medium text-(--color-muted) transition hover:bg-(--color-surface)/40"
                title={isFav ? "Remove from Favorites" : "Add to Favorites"}
              >
                <Heart className={`h-5 w-5 ${isFav ? "fill-rose-400 text-rose-400" : ""}`} />
              </button>
            </div>
          </div>

          {/* ════════════════════════════════════════
             RIGHT COLUMN (58%) — Preview, genres, achievements, hints
             ════════════════════════════════════════ */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">

            {/* Large preview / trailer area */}
            <div
              className="relative w-full overflow-hidden rounded-2xl bg-(--color-surface)/30 shadow-xl shadow-black/20 ring-1 ring-white/[0.06]"
              style={{ height: "clamp(300px, 42vh, 520px)", minHeight: "clamp(300px, 42vh, 520px)" }}
            >
              <ConsoleSelectedPreview game={game} showTrailerPreview />
            </div>

            {/* Genre chips */}
            {genres && (
              <div className="flex flex-wrap gap-1.5">
                {genres.map((t) => (
                  <span
                    key={t}
                    className="rounded-lg bg-(--color-surface)/60 px-3 py-1 text-xs font-medium text-(--color-muted) ring-1 ring-(--color-border)/30"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Achievements — uses achievementStore (same data source as LibraryGameDetails) */}
            <div className="rounded-2xl bg-(--color-surface)/40 px-5 py-4 ring-1 ring-white/[0.04]">
              <div className="flex items-center gap-2">
                <Trophy
                  className={`h-5 w-5 ${isPerfected ? "fill-amber-400 text-amber-400" : "text-(--color-muted)"}`}
                />
                <span className="text-sm font-semibold text-(--color-text)">
                  Achievements
                </span>
              </div>
              {achievementsSummary && effectiveTotal > 0 ? (
                <div className="mt-3">
                  {/* Count row */}
                  <div className="flex items-center justify-between text-sm">
                    <span
                      className={
                        isPerfected ? "font-semibold text-amber-400" : "font-medium text-(--color-text)"
                      }
                    >
                      {effectiveUnlocked} / {effectiveTotal}
                    </span>
                    <span className={isPerfected ? "text-amber-400/80" : "text-(--color-muted)"}>
                      {effectivePercent}%
                    </span>
                  </div>

                  {/* Progress bar — matches LibraryGameDetails styling */}
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isPerfected
                          ? "bg-gradient-to-r from-amber-400 to-yellow-300"
                          : "bg-(--color-accent)"
                      }`}
                      style={{
                        width: `${effectivePercent}%`,
                        boxShadow: isPerfected ? "0 0 10px rgba(251,191,36,0.4)" : undefined,
                      }}
                    />
                  </div>

                  {/* Status text */}
                  <p
                    className={`mt-1.5 text-xs ${
                      isPerfected ? "text-amber-400/50" : "text-(--color-muted)/60"
                    }`}
                  >
                    {isPerfected ? "All achievements unlocked" : `${effectivePercent}% complete`}
                  </p>
                </div>
              ) : achievementsSummary && achievementsSummary.achievements.length > 0 ? (
                <p className="mt-2 text-sm text-(--color-muted)">Progress unavailable</p>
              ) : (
                <p className="mt-2 text-sm text-(--color-muted)">No achievement data</p>
              )}
            </div>

            {/* Input hints */}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
              {hints.selectPlay && <HintLabel>{hints.selectPlay}</HintLabel>}
              <HintLabel>{hints.details}</HintLabel>
              <HintLabel>{hints.options}</HintLabel>
              <HintLabel>{hints.search}</HintLabel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Keyboard hint label helper ── */
function HintLabel({ children }: { children: string | null }) {
  if (!children) return null;
  const m = children.match(/^\[(.+?)\]\s*(.+)$/);
  if (!m) {
    return <span className="text-xs text-(--color-muted)">{children}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)">
      <span className="rounded border border-(--color-border) bg-(--color-surface)/60 px-1.5 py-0.5 text-[10px] font-bold tracking-tight text-(--color-muted)">
        {m[1]}
      </span>
      {m[2]}
    </span>
  );
}
