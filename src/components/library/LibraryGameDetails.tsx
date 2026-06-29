import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BookMarked,
  BookOpen,
  Calendar,
  Cloud,
  Clock,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  Gamepad2,
  HardDrive,
  LifeBuoy,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Play,
  Puzzle,
  RefreshCw,
  Square,
  Star,
  Trophy,
  Unlock,
  X,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry, GameMediaCacheEntry } from "../../services/tauri";
import type { GameAppInfo } from "../../services/gameCacheService";
import type { SgdbArtworkData } from "../../services/storeArtworkResolver";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { openExternalUrl } from "../../services/externalLinks";
import {
  getSteamStoreUrl,
  getSteamCommunityUrl,
  getSteamDiscussionsUrl,
  getSteamGuidesUrl,
  getSteamSupportUrl,
  getSteamDbUrl,
} from "../../utils/steamLinks";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import { useGameActivity } from "../../context/GameActivityContext";
import {
  localPathToUrl,
  isLocalPath,
} from "../../services/libraryLocalCacheService";
import { resolveSteamGameNews } from "../../services/steamNewsResolver";
import { useGamePlayStats } from "../../services/gamePlayStats";
import type { GameActivityItem, SteamNewsItem } from "../../types/gameActivity";
import type { GameLaunchInfo } from "../../hooks/useGameLaunchState";
import type { GameAchievementsSummary } from "../../types/gameAchievements";
import { resolveSteamAchievements } from "../../services/steamAchievementsResolver";
import { useSettings } from "../../context/SettingsContext";
import AchievementsModal from "./AchievementsModal";
import type { AppPage } from "../../types/navigation";

type LibraryGameDetailsProps = {
  game: LibraryGame;
  artwork?: SgdbArtworkData | null;
  appInfoEntry?: LibraryAppInfoEntry | null;
  mediaEntry?: GameMediaCacheEntry | null;
  canonicalAppInfo?: GameAppInfo | null;
  canonicalDiskFallback?: string | null;
  localDetailsData?: unknown;
  loading?: boolean;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onSync?: (game: LibraryGame) => void;
  onToggleScript?: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
  onOpenSteam?: (game: LibraryGame) => void;
  onOpenSteamDb?: (game: LibraryGame) => void;
  onOpenSourceSelector?: (game: LibraryGame) => void;
  onBack: () => void;
  onRefreshArtwork?: () => void;
  onNavigate?: (page: AppPage) => void;
  launchInfo?: GameLaunchInfo;
  onCancelLaunch?: () => void;
  onOpenStopModal?: () => void;
};

const ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS = false;

function getHeroImageUrl(game: LibraryGame, artwork?: SgdbArtworkData | null, appInfoEntry?: LibraryAppInfoEntry | null, mediaEntry?: GameMediaCacheEntry | null, canonicalAppInfo?: GameAppInfo | null, canonicalDiskFallback?: string | null): string | undefined {
  // Hero priority: background.jpg > landscape.jpg > remote background/header > cover.jpg as last local fallback > placeholder
  if (canonicalAppInfo?.media?.backgroundPath) {
    if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: backgroundPath");
    return canonicalAppInfo.media.backgroundPath;
  }
  if (canonicalAppInfo?.media?.landscapePath) {
    if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: landscapePath");
    return canonicalAppInfo.media.landscapePath;
  }
  if (mediaEntry?.hero_path) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: mediaEntry.hero_path"); return mediaEntry.hero_path; }
  if (mediaEntry?.grid_path) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: mediaEntry.grid_path"); return mediaEntry.grid_path; }
  if (appInfoEntry?.header_image) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: appInfoEntry.header_image"); return appInfoEntry.header_image; }
  if (artwork?.sgdbHeroUrl) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: sgdbHeroUrl"); return artwork.sgdbHeroUrl; }
  if (artwork?.sgdbGridUrl) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: sgdbGridUrl"); return artwork.sgdbGridUrl; }
  const remoteSrc = game.metadata?.library_hero_image
    || game.metadata?.background_image
    || game.metadata?.hero_image
    || game.metadata?.library_header_image
    || game.metadata?.header_image
    || game.metadata?.capsule_image
    || game.metadata?.wide_cover_image
    || game.metadata?.capsule_image_v5
    || game.imageUrl;
  if (remoteSrc) {
    if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: remote metadata");
    return remoteSrc;
  }
  if (canonicalAppInfo?.media?.coverPath) {
    if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: coverPath (fallback)");
    return canonicalAppInfo.media.coverPath;
  }
  if (mediaEntry?.cover_path) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: mediaEntry.cover_path"); return mediaEntry.cover_path; }
  if (canonicalDiskFallback) { if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: canonicalDiskFallback"); return canonicalDiskFallback; }
  if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log("[LibraryDetails] selected hero source: none (placeholder)");
  return undefined;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatPlaytime(minutes: number): string {
  if (minutes <= 0) return "Not tracked";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  if (h >= 10) return `${h}.${Math.round(m / 6)}h`;
  return `${h}h ${m}m`;
}

function formatCloudStatus(status: string): string {
  switch (status) {
    case "synchronized": return "Up to date";
    case "pending": return "Pending";
    case "conflict": return "Conflict";
    default: return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  }
}

function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}

function uniqueLabels(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function StatInline({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-(--color-muted)">
      <span className="shrink-0">{icon}</span>
      <span className="hidden sm:inline text-[10px] uppercase tracking-wider">{label}:</span>
      <span className="font-medium text-(--color-text)">{value}</span>
    </div>
  );
}

export default function LibraryGameDetails({
  game,
  artwork,
  appInfoEntry,
  mediaEntry,
  canonicalAppInfo,
  canonicalDiskFallback,
  localDetailsData,
  loading = false,
  onPlay,
  onInstall,
  onDeleteScript,
  onOpenSteam,
  onOpenSteamDb,
  onBack,
  onRefreshArtwork,
  onNavigate,
  launchInfo,
  onCancelLaunch,
  onOpenStopModal,
}: LibraryGameDetailsProps) {
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const detailTitle = appInfoEntry?.name || game.title || (game.appId ? `Steam App ${game.appId}` : "Unknown Game");

  console.debug("[LaunchButton] render", {
    gameId: game.id,
    title: detailTitle,
    appId: game.appId,
    state: launchInfo?.state,
  });

  const { settings } = useSettings();
  const [achievementsSummary, setAchievementsSummary] = useState<GameAchievementsSummary | null>(null);
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);

  const rawImageUrl = getHeroImageUrl(game, artwork, appInfoEntry, mediaEntry, canonicalAppInfo, canonicalDiskFallback);
  const rawImageIsLocal = !!rawImageUrl && isLocalPath(rawImageUrl);
  const imageUrl = rawImageIsLocal
    ? (localPathToUrl(rawImageUrl) ?? undefined)
    : rawImageUrl;
  const heroFallbackPath = rawImageIsLocal ? rawImageUrl : null;

  const rawLogoUrl = (() => {
    const src = canonicalAppInfo?.media?.logoPath
      || artwork?.sgdbLogoUrl
      || game.metadata?.logo_image
      || game.metadata?.library_logo_image;
    if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) {
      if (canonicalAppInfo?.media?.logoPath) console.log("[LibraryDetails] selected logo source: logoPath");
      else if (artwork?.sgdbLogoUrl) console.log("[LibraryDetails] selected logo source: sgdbLogoUrl");
      else if (game.metadata?.logo_image) console.log("[LibraryDetails] selected logo source: logo_image");
      else if (game.metadata?.library_logo_image) console.log("[LibraryDetails] selected logo source: library_logo_image");
      else console.log("[LibraryDetails] selected logo source: none");
    }
    return src;
  })();
  const logoUrl = rawLogoUrl && isLocalPath(rawLogoUrl)
    ? (localPathToUrl(rawLogoUrl) ?? undefined)
    : rawLogoUrl;
  const script = game.luaScripts[0];
  const action = getLauncherGamePrimaryAction(game);

  const rawShort = game.metadata?.short_description;
  const rawAbout = game.metadata?.about_the_game;
  const rawDetailed = game.metadata?.detailed_description;

  const aboutText = rawAbout ? stripHtml(rawAbout) : "";
  const detailedText = rawDetailed ? stripHtml(rawDetailed) : "";

  const shortIntro = (rawShort && stripHtml(rawShort)) || (aboutText ? aboutText.slice(0, 300) + (aboutText.length > 300 ? "…" : "") : "") || (detailedText ? detailedText.slice(0, 300) + (detailedText.length > 300 ? "…" : "") : "");
  const longDescText = aboutText || detailedText || "";
  const descriptionsMatch = shortIntro && longDescText && (longDescText.startsWith(shortIntro.replace(/…$/, "")) || shortIntro === longDescText);
  const hasLongDescription = longDescText.length > 300;
  const displayedDescription = hasLongDescription && !showFullDescription
    ? longDescText.slice(0, 300) + "…"
    : longDescText;

  const genres = useMemo(
    () => uniqueLabels(game.metadata?.genres || []),
    [game.id, game.metadata?.genres]
  );
  const categories = useMemo(
    () => uniqueLabels(game.metadata?.categories || []),
    [game.id, game.metadata?.categories]
  );

  const appIdNum = game.appId ? Number(game.appId) : null;
  const appIdStr = game.appId;
  const { activities, addActivity } = useGameActivity();
  const { recordLaunch: recordGameLaunch } = useGamePlayStats(game.id);

  const cloudStatus = game.steamCloudStatus
    ? formatCloudStatus(game.steamCloudStatus)
    : categories.includes("Steam Cloud")
      ? "Supported"
      : "Not tracked";

  const lastPlayedSource = game.localLastPlayedAt || game.steamLastPlayedAt || 0;
  const lastPlayed = lastPlayedSource > 0
    ? formatTimestamp(lastPlayedSource)
    : "Never";

  const playTimeValue = game.steamPlaytimeMinutes ?? game.localPlaytimeMinutes ?? 0;
  const playTimeDisplay = playTimeValue > 0
    ? formatPlaytime(playTimeValue)
    : "Not tracked";

  const achievementsStatus = achievementsSummary?.source === "disabled"
    ? (game.achievementsSupported ? "Supported" : "Unavailable")
    : achievementsSummary?.source === "setup-required"
      ? "Setup required"
      : achievementsSummary?.errorReason === "missing-appid"
        ? "Unavailable"
        : achievementsSummary?.progressAvailable
          ? `${achievementsSummary.unlocked} / ${achievementsSummary.total}`
          : achievementsSummary && achievementsSummary.achievements.length > 0
            ? "Progress unavailable"
            : game.achievementsSupported
              ? "Supported"
              : "Unavailable";
  const [steamNews, setSteamNews] = useState<SteamNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  const gameActivities: GameActivityItem[] = useMemo(() => {
    const fromContext = activities.filter(
      (a) => a.gameId === game.id || (appIdStr && a.appId === appIdStr)
    );
    if (fromContext.length > 0) return fromContext;

    const fallback: GameActivityItem[] = [];
    const now = Date.now();
    let idx = 0;

    if (game.steamInstalled) {
      fallback.push({
        id: `fb-act-${idx++}`,
        gameId: game.id,
        appId: appIdStr,
        kind: "game-installed",
        title: "Installed detected",
        description: `Game is installed on this system.`,
        createdAt: game.lastUpdated || now,
        source: "steam",
        severity: "success",
      });
    }

    if (game.hasLua && game.luaScripts.length > 0) {
      if (game.isLuaDisabled) {
        fallback.push({
          id: `fb-act-${idx++}`,
          gameId: game.id,
          appId: appIdStr,
          kind: "lua-disabled",
          title: "Lua disabled",
          description: `Lua script "${game.luaScripts[0].file_name}" is disabled.`,
          createdAt: now,
          source: "lua",
          severity: "warning",
        });
      } else {
        fallback.push({
          id: `fb-act-${idx++}`,
          gameId: game.id,
          appId: appIdStr,
          kind: "lua-installed",
          title: "Lua installed",
          description: `Lua script "${game.luaScripts[0].file_name}" is active.`,
          createdAt: now,
          source: "lua",
          severity: "success",
        });
      }
    }

    if (game.metadata?.dlc_count && game.metadata.dlc_count > 0) {
      fallback.push({
        id: `fb-act-${idx++}`,
        gameId: game.id,
        appId: appIdStr,
        kind: "dlc-detected",
        title: "DLC detected",
        description: `${game.metadata.dlc_count} DLC items available.`,
        createdAt: now,
        source: "provider",
        severity: "info",
      });
    }

    if (game.metadata?.resolved) {
      fallback.push({
        id: `fb-act-${idx++}`,
        gameId: game.id,
        appId: appIdStr,
        kind: "metadata-refreshed",
        title: "Metadata loaded",
        description: `Game metadata resolved for "${game.metadata.name || game.title}".`,
        createdAt: now,
        source: "system",
        severity: "info",
      });
    }

    return fallback;
  }, [activities, game.id, appIdStr, game.steamInstalled, game.hasLua, game.luaScripts, game.isLuaDisabled, game.metadata, game.lastUpdated, game.title]);

  const fetchSteamNews = useCallback(() => {
    if (!appIdStr) {
      setSteamNews([]);
      setNewsError(null);
      return;
    }

    setNewsLoading(true);
    setNewsError(null);

    resolveSteamGameNews(appIdStr)
      .then(({ items, stale }) => {
        setSteamNews(items);
        setNewsLoading(false);
        if (stale && items.length > 0) {
          setNewsError("Cached results — couldn't refresh from Steam.");
        }
      })
      .catch(() => {
        setNewsError("Could not load Steam updates right now.");
        setNewsLoading(false);
      });
  }, [appIdStr]);

  useEffect(() => {
    fetchSteamNews();
  }, [fetchSteamNews]);

  // Load achievements
  useEffect(() => {
    if (!appIdStr) return;
    let cancelled = false;
    setAchievementsLoading(true);
    resolveSteamAchievements({
      appId: appIdStr,
      steamWebApiKey: settings.steamWebApiKey || undefined,
      steamId64: settings.steamId64 || undefined,
      accountId: settings.steamAccountId || undefined,
      steamPath: settings.steamRoot || undefined,
      steamAchievementsEnabled: settings.steamAchievementsEnabled,
      achievementSchemaPath: settings.achievementSchemaPath || undefined,
    })
      .then((summary) => {
        if (!cancelled) {
          setAchievementsSummary(summary);
          setAchievementsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setAchievementsLoading(false);
      });
    return () => { cancelled = true; };
  }, [appIdStr, settings.steamWebApiKey, settings.steamId64, settings.steamAchievementsEnabled]);

  useEffect(() => {
    if (!showActions) return;
    function handleClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showActions]);

  if (loading) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
          </div>
        </div>
        <div className="h-72 animate-pulse bg-white/5 lg:h-96" />
        <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
            <div className="mb-2 h-9 w-24 animate-pulse rounded-xl bg-white/10" />
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-3 w-24 animate-pulse rounded bg-white/5" />
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-5 py-6 lg:py-8">
            <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">
              <div className="space-y-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
              </div>
              <div className="mt-6 lg:mt-0">
                <div className="h-64 animate-pulse rounded-2xl bg-white/5" />
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Back bar */}
      <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-2 text-sm text-(--color-muted) transition hover:text-(--color-text) focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </button>
        </div>
      </div>

      {/* Hero banner */}
      <div className="relative h-72 shrink-0 overflow-hidden bg-white/5 lg:h-96">
        <AsyncImage
          src={imageUrl}
          alt={detailTitle}
          className="absolute inset-0 h-full w-full"
          fallbackLocalPath={heroFallbackPath}
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-white/10 via-white/5 to-black/50">
              <Gamepad2 className="h-20 w-20 text-(--color-muted)" />
            </div>
          }
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/95 via-black/50 to-transparent" />

        {/* Logo overlay */}
        {logoUrl ? (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <img
              src={logoUrl}
              alt={`${detailTitle} logo`}
              loading="lazy"
              decoding="async"
              className="max-h-28 max-w-[300px] object-contain drop-shadow-2xl lg:max-h-36 lg:max-w-[420px]"
            />
          </div>
        ) : null}

        <div className="absolute bottom-0 left-0 right-0">
          <div className="mx-auto w-full max-w-[1440px] px-5 pb-5 lg:pb-6">
            <h1 className="line-clamp-1 text-2xl font-black text-white drop-shadow-sm lg:text-3xl">
              {detailTitle}
            </h1>

            {(game.metadata?.developer || (localDetailsData as any)?.developer) && (
              <p className="mt-1 text-sm text-white/70">
                {(localDetailsData as any)?.developer || game.metadata?.developer}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Compact action/stats row */}
      <div className="shrink-0 border-b border-(--surface-active-border) bg-white/[0.02]">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Play / Install button */}
            <div className="shrink-0">
              {action === "play" && (
                <>
                  {(!launchInfo || launchInfo.state === "idle" || launchInfo.state === "error") && (
                    <button
                      type="button"
                      onClick={() => {
                        console.debug("[LaunchButton] click", {
                          state: launchInfo?.state,
                          action: "play",
                        });
                        recordGameLaunch();
                        addActivity({
                          gameId: game.id,
                          appId: appIdStr,
                          kind: "game-launched",
                          title: "Game launched",
                          source: "local",
                          severity: "info",
                        });
                        onPlay(game);
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                    >
                      <Play className="h-4 w-4" />
                      Play
                    </button>
                  )}
                  {launchInfo?.state === "launching" && (
                    <>
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            console.debug("[LaunchButton] click", {
                              state: launchInfo.state,
                              action: "cancel",
                            });
                            onCancelLaunch?.();
                          }}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </button>
                        <span className="inline-flex items-center gap-1 text-xs text-(--color-muted)">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Launching...
                        </span>
                      </div>
                    </>
                  )}
                  {launchInfo?.state === "running" && (
                    <>
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            console.debug("[LaunchButton] click", {
                              state: launchInfo.state,
                              action: "stop",
                            });
                            console.debug("[Launch] opening stop modal", game.id);
                            onOpenStopModal?.();
                          }}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                        >
                          <Square className="h-4 w-4" />
                          Stop
                        </button>
                        <span className="inline-flex items-center gap-1 text-xs text-(--color-muted)">
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          Running
                        </span>
                      </div>
                    </>
                  )}
                  {launchInfo?.state === "stopping" && (
                    <>
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          disabled
                          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black opacity-60 transition"
                        >
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Stopping...
                        </button>
                        <span className="inline-flex items-center gap-1 text-xs text-(--color-muted)">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Stopping...
                        </span>
                      </div>
                    </>
                  )}
                  {launchInfo?.state === "error" && launchInfo.error && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                      {launchInfo.error}
                    </span>
                  )}
                </>
              )}
              {action === "install" && (
                <button
                  type="button"
                  onClick={() => onInstall(game)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <Download className="h-4 w-4" />
                  Install
                </button>
              )}
              {action === "missing-path" && (
                <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-bold text-red-300">
                  Missing Path
                </span>
              )}
            </div>

            {/* Inline stats */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              <StatInline icon={<Cloud className="h-5 w-5" />} label="Cloud Status" value={cloudStatus} />
              <StatInline icon={<Clock className="h-5 w-5" />} label="Last Played" value={lastPlayed} />
              <StatInline icon={<Trophy className="h-5 w-5" />} label="Play Time" value={playTimeDisplay} />
              <StatInline icon={<HardDrive className="h-5 w-5" />} label="Size" value={formatBytes(game.sizeOnDisk)} />
              <StatInline icon={<Star className="h-5 w-5" />} label="Achievements" value={achievementsStatus} />
            </div>

            {/* Right side: Actions + Favorite */}
            <div className="flex items-center gap-1">
              {/* Actions dropdown */}
              <div className="relative" ref={actionsRef}>
                <button
                  type="button"
                  onClick={() => setShowActions(!showActions)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Actions</span>
                </button>

                {showActions && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowActions(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-xl border border-(--surface-active-border) bg-(--color-bg) p-1 shadow-lg">
                      {game.isPlayable && (
                        <DropdownItem
                          label="Uninstall Game"
                          disabled
                          subtitle="Coming soon"
                        />
                      )}
                      {script && onDeleteScript && (
                        <DropdownItem
                          label="Delete Lua"
                          onClick={() => {
                            setShowActions(false);
                            onDeleteScript(game);
                          }}
                        />
                      )}
                      {(!script || !onDeleteScript) && (
                        <DropdownItem
                          label="Delete Lua"
                          disabled={!script}
                          subtitle={!script ? "No Lua script" : undefined}
                        />
                      )}
                      <div className="border-t border-(--surface-active-border) my-1" />
                      <DropdownItem
                        label="Refresh Artwork"
                        onClick={() => {
                          setShowActions(false);
                          onRefreshArtwork?.();
                        }}
                      />
                      <DropdownItem
                        label="Close"
                        onClick={() => setShowActions(false)}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Favorite button */}
              <button
                type="button"
                onClick={() => setFavorite(!favorite)}
                className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs transition hover:bg-white/10 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                title={favorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  className={`h-3.5 w-3.5 ${favorite ? "text-yellow-400" : "text-(--color-muted)"}`}
                  fill={favorite ? "currentColor" : "none"}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content: two columns */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-6 lg:py-8">
          <div className="lg:grid lg:grid-cols-[1fr_340px] lg:gap-8">
            {/* Left: Overview */}
            <div className="min-w-0 space-y-8">
              {/* Short intro */}
              {shortIntro && (
                <p className="text-sm leading-relaxed text-(--color-text)/80">
                  {shortIntro}
                </p>
              )}

              {/* Genres & Features metadata block */}
              {(genres.length > 0 || categories.length > 0) && (
                <section>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    {/* Genres column */}
                    {genres.length > 0 && (
                      <div>
                        <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-(--color-muted)">
                          Genres
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {genres.map((genre) => (
                            <span
                              key={genre}
                              className="rounded-full border border-(--surface-active-border) bg-white/5 px-3 py-1 text-[10px] text-(--color-text)/70"
                            >
                              {genre}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Features column */}
                    {categories.length > 0 && (
                      <div>
                        <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-(--color-muted)">
                          Features
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {categories.map((cat) => (
                            <span
                              key={cat}
                              className="rounded-full border border-(--color-accent)/20 bg-(--color-accent)/5 px-3 py-1 text-[10px] text-(--color-accent)/80"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Divider below metadata */}
                  {(genres.length > 0 || categories.length > 0) && (
                    <div className="mt-6 border-t border-(--surface-active-border)" />
                  )}
                </section>
              )}

              {/* About This Game (only if longer than short intro) */}
              {longDescText && !descriptionsMatch && (
                <section>
                  <h2 className="mb-3 text-base font-bold text-(--color-text)">
                    <BookOpen className="mr-2 inline h-4 w-4 text-(--color-accent)" />
                    About This Game
                  </h2>
                  <div className="space-y-3">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-(--color-text)/70">
                      {displayedDescription}
                    </p>
                    {hasLongDescription && (
                      <button
                        type="button"
                        onClick={() => setShowFullDescription(!showFullDescription)}
                        className="cursor-pointer text-xs font-medium text-(--color-accent) transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                      >
                        {showFullDescription ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {!shortIntro && !longDescText && (
                <p className="text-sm text-(--color-muted)">
                  Game description is not available yet.
                </p>
              )}

              {/* Updates — Steam news only */}
              <section>
                <h2 className="mb-3 text-base font-bold text-(--color-text)">
                  <RefreshCw className="mr-2 inline h-4 w-4 text-(--color-accent)" />
                  Updates
                </h2>

                {!appIdStr ? (
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-4 text-center">
                    <RefreshCw className="mx-auto h-6 w-6 text-(--color-muted)" />
                    <p className="mt-2 text-sm text-(--color-muted)">
                      Game updates are only available for Steam apps.
                    </p>
                  </div>
                ) : newsLoading ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-3">
                      <div className="mb-2 h-3 w-20 animate-pulse rounded bg-white/5" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                      <div className="mt-2 h-3 w-full animate-pulse rounded bg-white/5" />
                      <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-white/5" />
                    </div>
                    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-3">
                      <div className="mb-2 h-3 w-20 animate-pulse rounded bg-white/5" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                      <div className="mt-2 h-3 w-full animate-pulse rounded bg-white/5" />
                      <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-white/5" />
                    </div>
                    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-3">
                      <div className="mb-2 h-3 w-20 animate-pulse rounded bg-white/5" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-white/10" />
                      <div className="mt-2 h-3 w-full animate-pulse rounded bg-white/5" />
                      <div className="mt-1 h-3 w-2/3 animate-pulse rounded bg-white/5" />
                    </div>
                  </div>
                ) : newsError && steamNews.length === 0 ? (
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-4 text-center">
                    <RefreshCw className="mx-auto h-6 w-6 text-(--color-muted)" />
                    <p className="mt-2 text-sm text-(--color-muted)">
                      {newsError}
                    </p>
                    <p className="mt-1 text-xs text-(--color-muted)/50">
                      Steam news may be unavailable or blocked. Try again later.
                    </p>
                    <button
                      type="button"
                      onClick={fetchSteamNews}
                      className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent)/10 px-3.5 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-(--color-accent)/20"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Retry
                    </button>
                  </div>
                ) : steamNews.length > 0 ? (
                  <div className="space-y-3">
                    {newsError && (
                      <p className="text-xs text-amber-400/80 text-center">
                        {newsError}
                      </p>
                    )}
                    {steamNews.map((news) => (
                      <SteamNewsCard key={news.gid} news={news} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-4 text-center">
                    <RefreshCw className="mx-auto h-6 w-6 text-(--color-muted)" />
                    <p className="mt-2 text-sm text-(--color-muted)">
                      No recent game updates found.
                    </p>
                  </div>
                )}
              </section>

              {/* Activity */}
              <section>
                <h2 className="mb-3 text-base font-bold text-(--color-text)">
                  <Activity className="mr-2 inline h-4 w-4 text-(--color-accent)" />
                  Activity
                </h2>

                {loading ? (
                  <div className="space-y-3">
                    <SkeletonBox className="h-14 w-full" />
                    <SkeletonBox className="h-14 w-full" />
                  </div>
                ) : gameActivities.length > 0 ? (
                  <div className="space-y-2">
                    {gameActivities.map((act) => (
                      <ActivityRow key={act.id} activity={act} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-4 text-center">
                    <Activity className="mx-auto h-6 w-6 text-(--color-muted)" />
                    <p className="mt-2 text-sm text-(--color-muted)">
                      No activity yet.
                    </p>
                    <p className="mt-0.5 text-xs text-(--color-muted)/60">
                      Game scans, launches and Lua sync activity will appear here.
                    </p>
                  </div>
                )}
              </section>
            </div>

            {/* Right: Side panel */}
            <aside className="mt-8 lg:mt-0">
              <div className="sticky top-4 space-y-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                  Links
                </h3>
                <div className="space-y-1">
                  <ShortcutRow
                    icon={<ExternalLink className="h-3.5 w-3.5" />}
                    label="Store Page"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum && onOpenSteam) onOpenSteam(game);
                      else if (appIdNum) openExternalUrl(getSteamStoreUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<Puzzle className="h-3.5 w-3.5" />}
                    label="DLC"
                    subtitle={
                      game.metadata && game.metadata.dlc_count > 0
                        ? `${game.metadata.dlc_count} available`
                        : undefined
                    }
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamStoreUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<MessageCircle className="h-3.5 w-3.5" />}
                    label="Community Hub"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamCommunityUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<MessageCircle className="h-3.5 w-3.5" />}
                    label="Discussions"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamDiscussionsUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<BookMarked className="h-3.5 w-3.5" />}
                    label="Guides"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamGuidesUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<LifeBuoy className="h-3.5 w-3.5" />}
                    label="Support"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum) openExternalUrl(getSteamSupportUrl(appIdNum));
                    }}
                  />

                  <ShortcutRow
                    icon={<Database className="h-3.5 w-3.5" />}
                    label="SteamDB"
                    enabled={!!appIdNum}
                    onClick={() => {
                      if (appIdNum && onOpenSteamDb) onOpenSteamDb(game);
                      else if (appIdNum) openExternalUrl(getSteamDbUrl(appIdNum));
                    }}
                  />
                </div>
              </div>

              {/* Achievements */}
              <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                  <Trophy className="mr-1.5 inline h-3.5 w-3.5" />
                  Achievements
                </h3>

                {achievementsLoading ? (
                  <div className="mt-3 space-y-2">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-white/5" />
                    <div className="h-2 w-full animate-pulse rounded bg-white/5" />
                    <div className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
                    <div className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
                    <div className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
                  </div>
                ) : achievementsSummary && achievementsSummary.source === "disabled" ? (
                  <div className="mt-3">
                    <p className="text-xs text-(--color-muted)">
                      Steam Achievements Tracking is disabled.
                    </p>
                    <p className="mt-1 text-[10px] text-(--color-accent) cursor-pointer hover:underline"
                      onClick={() => onNavigate?.("settings")}
                    >
                      Enable in Settings
                    </p>
                  </div>
                ) : achievementsSummary && achievementsSummary.errorReason === "missing-appid" ? (
                  <div className="mt-3">
                    <p className="text-xs text-(--color-muted)">
                      Achievements are unavailable because this game has no Steam AppID.
                    </p>
                  </div>
                ) : achievementsSummary && achievementsSummary.source === "setup-required" ? (
                  <div className="mt-3">
                    <p className="text-xs text-(--color-muted)">
                      Configure Steam Web API in Settings to load achievement progress.
                    </p>
                    <p className="mt-1 text-[10px] text-(--color-accent) cursor-pointer hover:underline"
                      onClick={() => onNavigate?.("settings")}
                    >
                      Open Settings
                    </p>
                  </div>
                ) : achievementsSummary && achievementsSummary.progressAvailable && achievementsSummary.total > 0 ? (
                  <div className="mt-3 space-y-3">
                    {/* Progress bar */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-(--color-text) font-medium">
                          {achievementsSummary.unlocked} / {achievementsSummary.total}
                        </span>
                        <span className="text-(--color-muted)">
                          {achievementsSummary.percent}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-(--color-accent) transition-all duration-500"
                          style={{ width: `${achievementsSummary.percent}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-(--color-muted)/60">
                        {achievementsSummary.percent}% complete
                      </p>
                    </div>
                    {/* Recent achievements (top 5) */}
                    <div className="space-y-1">
                      {achievementsSummary.achievements.slice(0, 5).map((ach) => (
                        <div
                          key={ach.id}
                          className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.06]"
                        >
                          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md bg-white/5">
                            {ach.unlocked && ach.iconUrl ? (
                              <img
                                src={ach.iconUrl}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : ach.iconGrayUrl ? (
                              <img
                                src={ach.iconGrayUrl}
                                alt=""
                                className="h-full w-full object-cover opacity-50"
                                loading="lazy"
                              />
                              ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                {ach.unlocked
                                  ? <Unlock className="h-4 w-4 text-emerald-400" />
                                  : <Lock className="h-4 w-4 text-(--color-muted)" />}
                              </div>
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-xs text-(--color-text)">
                            {ach.name}
                          </span>
                          <span className={`shrink-0 text-[9px] font-medium ${
                            ach.unlocked ? "text-emerald-400" : "text-(--color-muted)/50"
                          }`}>
                            {ach.unlocked ? "Unlocked" : "Locked"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAchievementsModal(true)}
                      className="w-full cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                    >
                      View all achievements ({achievementsSummary.total})
                    </button>
                  </div>
                ) : achievementsSummary && !achievementsSummary.progressAvailable && achievementsSummary.achievements.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-(--color-muted)">
                      Achievement list available. Progress unavailable.
                    </p>
                    {achievementsSummary.errorReason === "api-403-fallback" && (
                      <p className="text-[10px] text-(--color-muted)/60">
                        Steam Web API could not load your progress. LumaForge will try local Steam cache.
                      </p>
                    )}
                    <div className="space-y-1">
                      {achievementsSummary.achievements.slice(0, 5).map((ach) => (
                        <div
                          key={ach.id}
                          className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.06]"
                        >
                          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md bg-white/5">
                            {ach.iconGrayUrl ? (
                              <img
                                src={ach.iconGrayUrl}
                                alt=""
                                className="h-full w-full object-cover opacity-50"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Lock className="h-4 w-4 text-(--color-muted)" />
                              </div>
                            )}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-xs text-(--color-text)">
                            {ach.name}
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAchievementsModal(true)}
                      className="w-full cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                    >
                      View all achievements
                    </button>
                  </div>
                ) : achievementsSummary && achievementsSummary.source === "unavailable" && game.achievementsSupported ? (
                  <div className="mt-3">
                    <p className="text-xs text-(--color-muted)">
                      Achievement tracking requires Steam Web API setup.
                    </p>
                    <p className="mt-1 text-[10px] text-(--color-accent) cursor-pointer hover:underline"
                      onClick={() => onNavigate?.("settings")}
                    >
                      Configure in Settings
                    </p>
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="text-xs text-(--color-muted)">
                      Achievements are not available for this game.
                    </p>
                  </div>
                )}
              </div>

              {/* Release Date */}
              <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                  <Calendar className="mr-1.5 inline h-3.5 w-3.5" />
                  Release Date
                </h3>
                <p className="mt-1 text-sm text-(--color-text)">
                  {game.metadata?.release_date || "Unknown"}
                </p>
              </div>

              {/* Lua section */}
              {(script || game.hasLua || game.hasLuaSource) && (
                <div className="mt-4 space-y-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                  <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                    <FileCode2 className="mr-1.5 inline h-3.5 w-3.5" />
                    Lua
                  </h3>
                  <div className="space-y-2">
                    {script && (
                      <>
                        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-2.5">
                          <p className="text-[10px] text-(--color-muted)">Script</p>
                          <p className="mt-0.5 text-xs font-medium text-(--color-text)">
                            {script.file_name}
                          </p>
                        </div>
                        <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-2.5">
                          <p className="text-[10px] text-(--color-muted)">Status</p>
                          <p className="mt-0.5 text-xs text-(--color-text)">
                            {game.isLuaDisabled ? "Disabled" : "Active"}
                          </p>
                        </div>
                      </>
                    )}
                    {!script && game.hasLuaSource && (
                      <div className="rounded-xl border border-(--surface-active-border) bg-white/5 p-2.5">
                        <p className="text-[10px] text-(--color-muted)">Source</p>
                        <p className="mt-0.5 text-xs text-(--color-text)">
                          Available — sync to install
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* App ID */}
              {game.appId && (
                <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                  <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                    App ID
                  </h3>
                  <p className="mt-1 text-sm font-mono text-(--color-text)">
                    {game.appId}
                  </p>
                </div>
              )}
            </aside>
            </div>
          </div>
      </div>

      {/* Achievements modal */}
      {showAchievementsModal && achievementsSummary && achievementsSummary.achievements.length > 0 && (
        <AchievementsModal
          summary={achievementsSummary}
          appIdStr={appIdStr}
          onClose={() => setShowAchievementsModal(false)}
          onRefresh={() => {
            setAchievementsLoading(true);
            resolveSteamAchievements({
              appId: appIdStr!,
              steamWebApiKey: settings.steamWebApiKey || undefined,
              steamId64: settings.steamId64 || undefined,
              accountId: settings.steamAccountId || undefined,
              steamPath: settings.steamRoot || undefined,
              forceRefresh: true,
              steamAchievementsEnabled: settings.steamAchievementsEnabled,
              achievementSchemaPath: settings.achievementSchemaPath || undefined,
            })
              .then((s) => {
                setAchievementsSummary(s);
                setAchievementsLoading(false);
              })
              .catch(() => setAchievementsLoading(false));
          }}
          refreshing={achievementsLoading}
        />
      )}
    </div>
  );
}

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  success: <Activity className="h-3.5 w-3.5 text-emerald-400" />,
  warning: <Activity className="h-3.5 w-3.5 text-amber-400" />,
  error: <Activity className="h-3.5 w-3.5 text-red-400" />,
};

function formatTimestamp(ts: number) {
  if (!ts || ts <= 0 || ts < 1000000000000) return "Recently";

  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

type ActivityRowProps = {
  activity: GameActivityItem;
};

function ActivityRow({ activity }: ActivityRowProps) {
  return (
    <div className="flex gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-3 transition hover:border-white/15 hover:bg-white/[0.06]">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
        {SEVERITY_ICONS[activity.severity ?? "info"] ?? (
          <Activity className="h-3.5 w-3.5 text-(--color-muted)" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium text-(--color-text)">
            {activity.title}
          </span>
          <span className="shrink-0 text-[10px] text-(--color-muted)">
            {formatTimestamp(activity.createdAt)}
          </span>
        </div>
        {activity.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-(--color-muted)">
            {activity.description}
          </p>
        )}
      </div>
    </div>
  );
}

const CATEGORY_BG: Record<string, string> = {
  "MAJOR UPDATE": "bg-purple-500/15 text-purple-300",
  "UPDATE": "bg-blue-500/15 text-blue-300",
  "EVENT": "bg-amber-500/15 text-amber-300",
  "NEWS": "bg-gray-500/15 text-gray-300",
};

function formatNewsDate(ts: number): string {
  const d = new Date(ts);
  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const now = new Date();
  if (year === now.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${year}`;
}

function SteamNewsCard({ news }: { news: SteamNewsItem }) {
  const categoryStyle = CATEGORY_BG[news.category] ?? "bg-gray-500/15 text-gray-300";
  const [imgError, setImgError] = useState(false);

  return (
    <div className="group rounded-xl border border-(--surface-active-border) bg-white/[0.03] p-0 transition hover:border-white/15 hover:bg-white/[0.06]">
      {/* Date label */}
      <div className="px-3 pt-2.5 pb-1">
        <span className="text-[10px] font-bold tracking-wider text-(--color-muted)/60">
          {formatNewsDate(news.date)}
        </span>
      </div>

      {/* Inner content */}
      <div className="flex gap-3 px-3 pb-3">
        {/* Thumbnail */}
        {news.thumbnail && !imgError && (
          <div className="mt-0.5 h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-white/5">
            <img
              src={news.thumbnail}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Category + external link */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wider ${categoryStyle}`}
            >
              {news.category}
            </span>
            {news.url && news.isExternalUrl && (
              <ExternalLink className="h-3 w-3 shrink-0 text-(--color-muted)/40" />
            )}
          </div>

          {/* Title */}
          {news.url ? (
            <a
              href={news.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-sm font-semibold text-(--color-text) transition hover:text-(--color-accent)"
            >
              {news.title}
            </a>
          ) : (
            <p className="mt-1 text-sm font-semibold text-(--color-text)">
              {news.title}
            </p>
          )}

          {/* Summary */}
          {news.summary && (
            <p className="mt-1 text-xs leading-relaxed text-(--color-muted) line-clamp-2">
              {news.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type ShortcutRowProps = {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  enabled: boolean;
  onClick: () => void;
};

function ShortcutRow({ icon, label, subtitle, enabled, onClick }: ShortcutRowProps) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition ${
        enabled
          ? "cursor-pointer text-(--color-text) hover:bg-white/5 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
          : "cursor-not-allowed text-(--color-muted)/40"
      }`}
    >
      <span className="shrink-0 text-(--color-muted)">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {subtitle && (
        <span className="shrink-0 text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}

function DropdownItem({
  label,
  subtitle,
  disabled,
  onClick,
}: {
  label: string;
  subtitle?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : "cursor-pointer text-(--color-text) hover:bg-white/5"
      }`}
    >
      <span className="flex-1">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-(--color-muted)">{subtitle}</span>
      )}
    </button>
  );
}
