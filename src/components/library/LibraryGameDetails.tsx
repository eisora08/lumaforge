// Debug flag for achievement-related details logs (noisy per-navigation logs)
const DEBUG_ACH_DETAILS = false;
const DEBUG_LAUNCH_BUTTON_RENDER = false;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countRender, isInteractionBusy } from "../../services/perfCounters";
import {
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
  FolderOpen,
  Gamepad2,
  HardDrive,
  LifeBuoy,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Play,
  Puzzle,
  Heart,
  RefreshCw,
  Square,
  Trophy,
  X,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry, GameMediaCacheEntry } from "../../services/tauri";
import type { GameAppInfo } from "../../services/gameCacheService";
import { resolveCanonicalDisplayTitle } from "../../services/gameCacheService";
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
import toast from "react-hot-toast";
import AsyncImage from "../common/AsyncImage";
import AchievementIcon from "../common/AchievementIcon";
import AchievementTooltip from "../common/AchievementTooltip";

import { useGameActivity } from "../../context/GameActivityContext";
import {
  localPathToUrl,
  isLocalPath,
} from "../../services/libraryLocalCacheService";
import { resolveSteamGameNews } from "../../services/steamNewsResolver";
import { useGamePlayStats } from "../../services/gamePlayStats";
import { getPlaytimeEntryByAppId, formatPlaytime as formatPlaytimeSeconds, computeTotalPlaytime, getLastSessionEndForAppId, getPlaytimeSourceLabel, subscribePlaytimeStore } from "../../services/playtimeService";
import type { SteamNewsItem } from "../../types/gameActivity";
import type { GameLaunchInfo } from "../../hooks/useGameLaunchState";
import type { GameAchievement, GameAchievementsSummary } from "../../types/gameAchievements";
import { resolveSteamAchievements, debugAchievements } from "../../services/steamAchievementsResolver";
import { scanSteamAppcacheAchievements } from "../../services/tauri";
import { showAchievementToast, showGroupedAchievementToast, showTestAchievementToast } from "./AchievementToast";
import { sendAchievementNativeNotification, showAchievementOverlay, showGroupedAchievementOverlay } from "../../services/achievementNotificationService";
import { achievementImageQueue, resolveImageSource, isResolvedUrl, nextGenerationId, cancelGeneration, ACHIEVEMENT_IMAGE_MIGRATION_AUTO, DEBUG_ACH_IMAGE_QUEUE, isImageResolved, markImageResolved } from "../../services/achievementImageQueue";
import { achievementAutoSyncService } from "../../services/achievementAutoSyncService";
import { achievementStore, isSourceNewerOrEqual } from "../../services/achievementStore";
import { achievementWatcherService } from "../../services/achievementWatcherService";
import { notifyMediaUpdated, getCachedSnapshot } from "../../services/startupSnapshotService";
import { useSettings } from "../../context/SettingsContext";
import { useFavorites } from "../../context/FavoritesContext";
import { useGameSession } from "../../context/GameSessionContext";
import { invoke } from "@tauri-apps/api/core";
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

function logDetailsCanonical(appId: string, msg: string): void {
  if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) {
    console.log(`[MEDIA][DETAILS_CANONICAL] appid=${appId} ${msg}`);
  }
}

function getHeroImageUrl(game: LibraryGame, artwork?: SgdbArtworkData | null, appInfoEntry?: LibraryAppInfoEntry | null, mediaEntry?: GameMediaCacheEntry | null, canonicalAppInfo?: GameAppInfo | null, canonicalDiskFallback?: string | null): string | undefined {
  // Hero priority: backgroundPath > landscapePath > coverPath > remote metadata > placeholder
  if (canonicalAppInfo?.media?.backgroundPath) {
    logDetailsCanonical(game.appId ?? "", `heroSelected=background path=${canonicalAppInfo.media.backgroundPath}`);
    return canonicalAppInfo.media.backgroundPath;
  }
  if (canonicalAppInfo?.media?.landscapePath) {
    logDetailsCanonical(game.appId ?? "", `heroSelected=landscape path=${canonicalAppInfo.media.landscapePath}`);
    return canonicalAppInfo.media.landscapePath;
  }
  if (canonicalAppInfo?.media?.coverPath) {
    logDetailsCanonical(game.appId ?? "", `heroSelected=cover path=${canonicalAppInfo.media.coverPath}`);
    return canonicalAppInfo.media.coverPath;
  }
  if (mediaEntry?.hero_path) { logDetailsCanonical(game.appId ?? "", `heroSelected=mediaEntry.hero_path path=${mediaEntry.hero_path}`); return mediaEntry.hero_path; }
  if (mediaEntry?.grid_path) { logDetailsCanonical(game.appId ?? "", `heroSelected=mediaEntry.grid_path path=${mediaEntry.grid_path}`); return mediaEntry.grid_path; }
  if (appInfoEntry?.header_image) { logDetailsCanonical(game.appId ?? "", `heroSelected=appInfoEntry.header_image path=${appInfoEntry.header_image}`); return appInfoEntry.header_image; }
  if (artwork?.sgdbHeroUrl) { logDetailsCanonical(game.appId ?? "", `heroSelected=sgdbHeroUrl`); return artwork.sgdbHeroUrl; }
  if (artwork?.sgdbGridUrl) { logDetailsCanonical(game.appId ?? "", `heroSelected=sgdbGridUrl`); return artwork.sgdbGridUrl; }
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
    logDetailsCanonical(game.appId ?? "", `heroSelected=remoteMetadata`);
    return remoteSrc;
  }
  if (mediaEntry?.cover_path) { logDetailsCanonical(game.appId ?? "", `heroSelected=mediaEntry.cover_path path=${mediaEntry.cover_path}`); return mediaEntry.cover_path; }
  if (canonicalDiskFallback) { logDetailsCanonical(game.appId ?? "", `heroSelected=canonicalDiskFallback path=${canonicalDiskFallback}`); return canonicalDiskFallback; }
  logDetailsCanonical(game.appId ?? "", `heroSelected=placeholder path=null exists=false`);
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
  countRender("LibraryGameDetails");
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = game.appId ? isFavorite(game.appId) : false;
  const actionsRef = useRef<HTMLDivElement>(null);

  const detailTitle = resolveCanonicalDisplayTitle(
    game.appId ?? "",
    game,
    appInfoEntry,
    canonicalAppInfo,
  );

  if (DEBUG_LAUNCH_BUTTON_RENDER) console.debug("[LaunchButton] render", {
    gameId: game.id,
    title: detailTitle,
    appId: game.appId,
    state: launchInfo?.state,
  });

  const { settings } = useSettings();
  const { sessions: gameSessions } = useGameSession();
  const appIdStr = game.appId;
  const [achievementsSummary, setAchievementsSummary] = useState<GameAchievementsSummary | null>(() => {
    if (!appIdStr) return null;
    // 1. Check in-memory store first
    const fromStore = achievementStore.getSummary(appIdStr);
    if (fromStore) return fromStore;
    // 2. Fallback to snapshot's achievementSummary (updated by full rebuild after refresh)
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
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [achievementsRefreshing, setAchievementsRefreshing] = useState(false);
  const achievementsSyncing = achievementsSummary != null && achievementsLoading;
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);
  const [localAchSupportFound, setLocalAchSupportFound] = useState(false);
  const supportCheckDoneRef = useRef(false);

  useEffect(() => {
    if (game.achievementsSupported) {
      setLocalAchSupportFound(true);
      supportCheckDoneRef.current = true;
      return;
    }
    if (supportCheckDoneRef.current) return;
    if (!appIdStr || !settings.steamRoot) return;
    supportCheckDoneRef.current = true;
    const appIdNum = Number(appIdStr);
    if (isNaN(appIdNum)) return;
    scanSteamAppcacheAchievements({ appId: appIdNum, steamPath: settings.steamRoot }).then((res) => {
      if (res.schema_file_found || res.parsed_schema.length > 0 || res.stats_file_found) {
        setLocalAchSupportFound(true);
        console.log(`[ACH][SUPPORT_CHECK] appid=${appIdStr} source=local-appcache schema_found=${res.schema_file_found} stats_found=${res.stats_file_found} schema_entries=${res.parsed_schema.length} supported=true`);
      } else {
        console.log(`[ACH][SUPPORT_CHECK] appid=${appIdStr} source=local-appcache no-files-found supported=false`);
      }
    }).catch(() => {
      console.log(`[ACH][SUPPORT_CHECK] appid=${appIdStr} source=local-appcache error=scan-failed supported=uncertain`);
    });
  }, [appIdStr, game.achievementsSupported, settings.steamRoot]);

  const rawImageUrl = getHeroImageUrl(game, artwork, appInfoEntry, mediaEntry, canonicalAppInfo, canonicalDiskFallback);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [heroFallbackPath, setHeroFallbackPath] = useState<string | null>(null);

  useEffect(() => {
    if (!rawImageUrl) {
      setImageUrl(undefined);
      setHeroFallbackPath(null);
      return;
    }
    const resolve = async () => {
      let resolved = rawImageUrl;
      if (rawImageUrl.startsWith("media/") || rawImageUrl.startsWith("img/")) {
        const { resolveRelativeMediaPath } = await import("../../services/gameCacheService");
        resolved = await resolveRelativeMediaPath(game.appId ?? "", rawImageUrl).catch(() => rawImageUrl);
      }
      // Block cross-appid paths
      if (isLocalPath(resolved) && game.appId) {
        const pathAppIdMatch = resolved.match(/games[/\\]steam[/\\](\d+)[/\\]media/);
        if (pathAppIdMatch && pathAppIdMatch[1] !== game.appId) {
          console.log(`[MEDIA][BLOCKED] reason=cross-appid-media currentAppid=${game.appId} pathAppid=${pathAppIdMatch[1]} path=${resolved}`);
          setImageUrl(undefined);
          setHeroFallbackPath(null);
          return;
        }
      }
      const isLocal = isLocalPath(resolved);
      const url = isLocal ? (localPathToUrl(resolved) ?? undefined) : resolved;
      setImageUrl(url);
      setHeroFallbackPath(isLocal ? resolved : null);
    };
    resolve();
  }, [rawImageUrl, game.appId]);

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
  const { addActivity } = useGameActivity();
  const { recordLaunch: recordGameLaunch } = useGamePlayStats(game.id);

  const cloudStatus = game.steamCloudStatus
    ? formatCloudStatus(game.steamCloudStatus)
    : categories.includes("Steam Cloud")
      ? "Supported"
      : "Not tracked";

  // Subscribe to playtime store changes for re-render
  const [, setPlaytimeVersion] = useState(0);
  useEffect(() => {
    const unsub = subscribePlaytimeStore(() => setPlaytimeVersion(v => v + 1));
    return unsub;
  }, []);

  // Phase 1: Audit Activity playtime
  const ptEntry = getPlaytimeEntryByAppId(game.appId);
  const totalSeconds = ptEntry ? computeTotalPlaytime(ptEntry) : 0;
  const sourceLabel = getPlaytimeSourceLabel(game.appId);
  const lastPlayedFromActivity = getLastSessionEndForAppId(game.appId);
  if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log(`[ACTIVITY][PLAYTIME_AUDIT] appid=${game.appId} activityFound=${!!ptEntry} key=${ptEntry?.gameKey ?? null} totalSeconds=${totalSeconds} lastPlayedAt=${ptEntry?.lastPlayedAt ?? null} uiPlaytime=${formatPlaytimeSeconds(totalSeconds || 0)} uiLastPlayed=${lastPlayedFromActivity ?? "Never"}`);

  // Phase 3: Display Activity totalPlaytimeSeconds (overrides Steam/local fallback)
  const hasPlaytimeStore = totalSeconds > 0;
  const playTimeValue = hasPlaytimeStore
    ? Math.round(totalSeconds / 60)
    : (game.steamPlaytimeMinutes ?? game.localPlaytimeMinutes ?? 0);
  const playTimeDisplay = playTimeValue > 0
    ? (hasPlaytimeStore ? formatPlaytimeSeconds(totalSeconds) : formatPlaytime(playTimeValue))
    : "Not tracked";
  if (hasPlaytimeStore && ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) {
    console.log(`[ACTIVITY][PLAYTIME_DISPLAY] appid=${game.appId} totalSeconds=${totalSeconds} source=${sourceLabel} label=${playTimeDisplay}`);
  }
  if (game.appId === "268910") {
    console.log(`[ACTIVITY][TRACE_RENDER_SOURCE] appid=268910 source=${sourceLabel} ptEntry=${!!ptEntry} totalSeconds=${totalSeconds} lastPlayedFromActivity=${lastPlayedFromActivity ?? "null"}`);
    console.log(`[ACTIVITY][TRACE_PLAYTIME_STORE] appid=268910 key=${ptEntry?.gameKey ?? "null"} lastPlayed=${ptEntry?.lastPlayedAt ?? "null"} totalSeconds=${totalSeconds}`);
    console.log(`[ACTIVITY][TRACE_STEAM_STATS] appid=268910 steamLastPlayedAt=${game.steamLastPlayedAt ?? "null"} steamPlaytimeMinutes=${game.steamPlaytimeMinutes ?? "null"}`);
    console.log(`[ACTIVITY][TRACE_SNAPSHOT] appid=268910 lastPlayedFromActivity=${lastPlayedFromActivity ?? "null"} gameSteamLastPlayed=${game.steamLastPlayedAt ?? "null"}`);
  }

  // Phase 4: Last played — prefer Activity (updated on launch), fallback to Steam/local
  const lastPlayedSource = lastPlayedFromActivity ?? game.localLastPlayedAt ?? game.steamLastPlayedAt ?? 0;
  const lastPlayed = lastPlayedSource > 0
    ? (() => {
        if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) console.log(`[ACTIVITY][LAST_PLAYED_DISPLAY] appid=${game.appId} value=${lastPlayedSource} source=${lastPlayedFromActivity ? "activity" : (game.localLastPlayedAt ? "local" : "steam")}`);
        return formatTimestamp(lastPlayedSource);
      })()
    : "Never";

  // Trace achievement render source for Cuphead debugging
  if (game.appId === "268910") {
    const derived = achievementsSummary?.achievements?.filter(a => a.unlocked).length ?? 0;
    if (DEBUG_ACH_DETAILS) console.log(`[ACH][UI_COUNT_SOURCE] appid=268910 location=header source=${achievementsSummary?.source ?? "none"} unlocked=${achievementsSummary?.unlocked ?? "undefined"}/${achievementsSummary?.total ?? "undefined"} derivedFromList=${derived} progressAvailable=${achievementsSummary?.progressAvailable}`);
    console.log(`[ACH][SUMMARY_AVAILABLE] appid=268910 source=${achievementsSummary?.source ?? "null"} unlocked=${achievementsSummary?.unlocked ?? "null"} total=${achievementsSummary?.total ?? "null"}`);
  }

  // Derive progress from loaded achievement list if summary doesn't have it
  const derivedUnlocked = achievementsSummary?.achievements?.filter(a => a.unlocked).length ?? 0;
  const canDeriveProgress = (achievementsSummary?.achievements?.length ?? 0) > 0
    && !achievementsSummary?.progressAvailable
    && derivedUnlocked > 0; // schema-only 0/N must not claim progress available
  const effectiveUnlocked = achievementsSummary?.unlocked ?? derivedUnlocked;
  const effectiveTotal = achievementsSummary?.total ?? achievementsSummary?.achievements?.length ?? 0;
  const effectiveProgressAvailable = achievementsSummary?.progressAvailable || canDeriveProgress;
  const isPerfected = effectiveTotal > 0 && effectiveUnlocked === effectiveTotal && effectiveProgressAvailable !== false;
  if (isPerfected) console.log(`[ACH][PERFECTED_TRACE] appid=${appIdStr ?? "?"} isPerfected=true location=render-only`);
  if (DEBUG_ACH_DETAILS) {
    console.log(`[ACH][PROGRESS_AVAILABLE_CHECK] appid=${appIdStr} resolverProgressAvailable=${achievementsSummary?.progressAvailable} summaryProgressAvailable=${achievementsSummary?.progressAvailable} uiProgressAvailable=${effectiveProgressAvailable} derivedUnlocked=${derivedUnlocked} canDerive=${canDeriveProgress}`);
  }
  const achievementsStatus = achievementsSummary?.source === "disabled"
    ? ((game.achievementsSupported || localAchSupportFound) ? "Supported" : "Unavailable")
    : achievementsSummary?.source === "setup-required"
      ? "Setup required"
      : achievementsSummary?.errorReason === "missing-appid"
        ? "Unavailable"
        : effectiveProgressAvailable && effectiveTotal > 0
          ? `${effectiveUnlocked} / ${effectiveTotal}`
          : achievementsSummary && achievementsSummary.achievements.length > 0
            ? "Progress unavailable"
            : (game.achievementsSupported || localAchSupportFound)
              ? "Supported"
              : "Unavailable";
  const [steamNews, setSteamNews] = useState<SteamNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

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

  // Sync achievement summary from store when appId changes
  useEffect(() => {
    if (!appIdStr) {
      setAchievementsSummary(null);
      return;
    }
    const stored = achievementStore.getSummary(appIdStr) ?? null;
    if (stored) {
      if (DEBUG_ACH_DETAILS) console.log(`[ACH][STATE_PRESERVE] appid=${appIdStr} reason=route-change unlocked=${stored.unlocked}/${stored.total}`);
    }
    setAchievementsSummary(prev => {
      if (prev?.appId === stored?.appId && prev?.source === stored?.source && prev?.unlocked === stored?.unlocked && prev?.total === stored?.total) return prev;
      return stored;
    });
  }, [appIdStr]);

  // Load achievements — only on explicit refresh, NOT on mount (auto-disabled)
  // Safe: reads existing disk cache for current visible appId only.
  // No stats/schema scan, no migration, no cache write, no full library scan.
  const shouldAutoLoadAchievements = false; // ACHIEVEMENT_AUTO_LOAD_GAME_DETAILS — hard-disabled
  const ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP = true;
  const diskCacheRef = useRef<{ updatedAt: number } | null>(null);
  useEffect(() => {
    if (!appIdStr) return;
    if (!shouldAutoLoadAchievements) {
      let cancelled = false;
      // 1. Check in-memory store first
      const stored = achievementStore.getSummary(appIdStr);
      if (stored) {
        setAchievementsSummary(stored);
        if (appIdStr === "1167630") console.log(`[ACH][UI_PROGRESS_SOURCE] appid=1167630 headerUnlocked=${stored.unlocked} total=${stored.total} progressAvailable=${stored.progressAvailable} source=${stored.source}`);
        if (DEBUG_ACH_DETAILS) console.log(`[ACH][VISIBLE_CACHE_HIT] appid=${appIdStr} unlocked=${stored.unlocked}/${stored.total} storeUpdatedAt=${stored.updatedAt}`);
      }
      // 2. If ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP, check if disk cache is newer than store
      if (ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP) {
        const appIdNum = Number(appIdStr);
        if (Number.isFinite(appIdNum)) {
          import("../../services/tauri").then(({ readAchievementCache }) => {
              if (cancelled) return;
              readAchievementCache(appIdNum).then((diskCache) => {
                if (cancelled) return;
                const diskUpdatedAt = diskCache?.summary?.updated_at ?? 0;
                const storeUpdatedAt = achievementStore.getSummary(appIdStr)?.updatedAt ?? 0;
                const lastSeenAt = diskCacheRef.current?.updatedAt ?? 0;
                if (!diskCache || !diskCache.achievements?.length) {
                  if (appIdStr === "1167630") console.log(`[ACH][UI_UNAVAILABLE_REASON] appid=1167630 reason=no-disk-cache`);
                  if (DEBUG_ACH_DETAILS) console.log(`[ACH][VISIBLE_LOCAL_REFRESH] appid=${appIdStr} cacheFound=false`);
                  if (!stored) setAchievementsLoading(false);
                  return;
                }
                // Apply if disk is newer than what we last saw, or newer than store
                const shouldApply = diskUpdatedAt > lastSeenAt || diskUpdatedAt > storeUpdatedAt;
                if (!shouldApply) {
                  if (DEBUG_ACH_DETAILS) console.log(`[ACH][VISIBLE_LOCAL_REFRESH] appid=${appIdStr} cacheFound=true updated=false diskUpdatedAt=${diskUpdatedAt} storeUpdatedAt=${storeUpdatedAt}`);
                  if (!stored) setAchievementsLoading(false);
                  return;
                }
                diskCacheRef.current = { updatedAt: diskUpdatedAt };
                const total = diskCache.summary?.total ?? diskCache.achievements.length;
                const unlocked = diskCache.summary?.unlocked ?? diskCache.achievements.filter((a: any) => a.unlocked).length;
                const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;
                const hasRealProgress = unlocked > 0 || diskCache.summary?.progress_available === true;
                const summary = {
                  appId: appIdStr,
                  source: "local-cache" as const,
                  total,
                  unlocked,
                  percent,
                  progressAvailable: hasRealProgress,
                  updatedAt: diskCache.summary?.updated_at ?? Date.now(),
                  achievements: diskCache.achievements.map((a: any) => ({
                    id: a.api_name ?? a.id ?? "",
                    apiName: a.api_name ?? a.name ?? "",
                    name: a.display_name ?? a.name ?? a.api_name ?? "",
                    description: a.description ?? "",
                    iconUrl: a.icon_url ?? a.icon ?? undefined,
                    iconGrayUrl: a.icon_gray_url ?? a.icon_gray ?? undefined,
                    unlocked: !!a.unlocked,
                    unlockTime: a.unlock_time ?? undefined,
                    progress: a.progress ?? undefined,
                    progressMax: a.progress_max ?? undefined,
                    rarityPercent: a.rarity_percent ?? undefined,
                  })),
                };
                console.log(`[ACH][VISIBLE_LOCAL_REFRESH] appid=${appIdStr} cacheFound=true updated=true diskUpdatedAt=${diskUpdatedAt} storeUpdatedAt=${storeUpdatedAt}`);
                console.log(`[ACH][SUMMARY_APPLY] appid=${appIdStr} unlocked=${unlocked}/${total} reason=newer-local-cache`);
                if (appIdStr === "1167630") console.log(`[ACH][UI_PROGRESS_SOURCE] appid=1167630 headerUnlocked=${unlocked} total=${total} progressAvailable=${hasRealProgress} source=local-cache`);
                achievementStore.setSummary(appIdStr, summary);
                setAchievementsSummary(summary);
                setAchievementsLoading(false);
                // ── Fallback: schema-only disk cache → try resolver for librarycache progress ──
                if (!hasRealProgress && total > 0 && appIdStr) {
                  if (appIdStr === "1167630") console.log(`[ACH][UI_PROGRESS_SOURCE] appid=1167630 headerUnlocked=${unlocked} total=${total} progressAvailable=false source=local-cache`);
                  console.log(`[ACH][UI_UNAVAILABLE_REASON] appid=${appIdStr} reason=disk-cache-schema-only triggering-resolver-fallback`);
                  resolveSteamAchievements({
                    appId: appIdStr,
                    steamWebApiKey: settings.steamWebApiKey || undefined,
                    steamId64: settings.steamId64 || undefined,
                    accountId: settings.steamAccountId || undefined,
                    steamPath: settings.steamRoot || undefined,
                    steamAchievementsEnabled: settings.steamAchievementsEnabled,
                    achievementSchemaPath: settings.achievementSchemaPath || undefined,
                  }).then((resolved) => {
                    if (cancelled || !resolved.progressAvailable) {
                      if (!cancelled && appIdStr === "1167630" && !resolved.progressAvailable) console.log(`[ACH][UI_UNAVAILABLE_REASON] appid=1167630 reason=resolver-also-schema-only source=${resolved.source}`);
                      return;
                    }
                    const stored = achievementStore.getSummary(appIdStr);
                    if (stored && !isSourceNewerOrEqual(resolved.source, resolved.updatedAt, stored.source, stored.updatedAt)) return;
                    achievementStore.setSummary(appIdStr, resolved);
                    setAchievementsSummary(resolved);
                    console.log(`[ACH][SUMMARY_APPLY] appid=${appIdStr} unlocked=${resolved.unlocked}/${resolved.total} reason=resolver-librarycache-fallback`);
                  }).catch(() => {});
                }
              }).catch(() => {
                if (!cancelled && !stored) {
                  if (DEBUG_ACH_DETAILS) console.log(`[ACH][VISIBLE_LOCAL_REFRESH] appid=${appIdStr} cacheFound=false reason=disk-read-failed`);
                  setAchievementsLoading(false);
                }
              });
          });
        } else {
          if (!stored) setAchievementsLoading(false);
        }
        return;
      }
      setAchievementsLoading(false);
      return;
    }
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
          // Only update local state if resolver result is fresher than store
          const stored = achievementStore.getSummary(appIdStr);
          if (stored && stored.source !== summary.source) {
            if (!isSourceNewerOrEqual(summary.source, summary.updatedAt, stored.source, stored.updatedAt)) {
              console.debug(`[ACH][DETAILS] skip-set-from-resolver reason=store-newer source=${stored.source} updatedAt=${stored.updatedAt}`);
              setAchievementsLoading(false);
              return;
            }
          }
          setAchievementsSummary(summary);
          achievementStore.setSummary(appIdStr, summary);
          setAchievementsLoading(false);
          if (appIdStr === "1167630") console.log(`[ACH][UI_PROGRESS_SOURCE] appid=1167630 headerUnlocked=${summary.unlocked} total=${summary.total} progressAvailable=${summary.progressAvailable} source=${summary.source}`);
          console.debug(`[ACH][PROGRESS] appid=${appIdStr}`);
          console.debug(`[ACH][PROGRESS] unlocked=${summary.achievements.filter((a: any) => a.unlocked).length}/${summary.total}`);
          console.debug(`[ACH][PROGRESS] progressAvailable=${summary.progressAvailable}`);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAchievementsLoading(false);
          console.warn(`[ACH][PROGRESS] failed appid=${appIdStr} reason=${err}`);
        }
      });
    return () => { cancelled = true; };
  }, [appIdStr, settings.steamWebApiKey, settings.steamId64, settings.steamAccountId, settings.steamRoot, settings.steamAchievementsEnabled, settings.achievementSchemaPath]);

  // Auto-sync: subscribe to auto-sync events to update achievements state
  useEffect(() => {
    const unsub = achievementAutoSyncService.subscribe((event) => {
      if (event.appId !== appIdStr) return;
      setAchievementsSummary(event.summary);
      achievementStore.setSummary(event.appId, event.summary);
    });
    return unsub;
  }, [appIdStr]);

  // Derive progress from loaded achievement list if summary has list but no progress
  // Does NOT run for schema-only results (all unlocked=false) — prevents 0/N from being marked valid progress
  useEffect(() => {
    if (!appIdStr || !achievementsSummary) return;
    if (achievementsSummary.progressAvailable) return;
    const list = achievementsSummary.achievements;
    if (!list || list.length === 0) return;
    const unlocked = list.filter(a => a.unlocked).length;
    if (unlocked === 0) return; // schema-only 0/N — no real progress to derive
    const total = list.length;
    const percent = Math.round((unlocked / total) * 100);
    const patched = {
      ...achievementsSummary,
      unlocked,
      total,
      percent,
      progressAvailable: true,
    };
    if (DEBUG_ACH_DETAILS) console.log(`[ACH][SUMMARY_DERIVED] appid=${appIdStr} unlocked=${unlocked}/${total} percent=${percent}`);
    achievementStore.setSummary(appIdStr, patched);
    setAchievementsSummary(patched);
  }, [appIdStr, achievementsSummary]);

  // Store: subscribe to central store for fast patches from watcher
  useEffect(() => {
    const unsub = achievementStore.subscribe((appId, summary) => {
      if (appId !== appIdStr) return;
      setAchievementsSummary(summary);
    });
    return unsub;
  }, [appIdStr]);

  // Auto-sync: start/stop watching based on appId + settings
  useEffect(() => {
    if (!appIdStr || !settings.achievementAutoSyncEnabled) {
      if (appIdStr) achievementAutoSyncService.stopWatching(appIdStr);
      return;
    }
    achievementAutoSyncService.setEnabled(settings.achievementAutoSyncEnabled);
    achievementAutoSyncService.setIntervalSeconds(settings.achievementAutoSyncIntervalSeconds);
    achievementAutoSyncService.startWatching({
      appId: appIdStr,
      steamWebApiKey: settings.steamWebApiKey || undefined,
      steamId64: settings.steamId64 || undefined,
      accountId: settings.steamAccountId || undefined,
      steamPath: settings.steamRoot || undefined,
      steamAchievementsEnabled: settings.steamAchievementsEnabled,
      achievementSchemaPath: settings.achievementSchemaPath || undefined,
    });
    return () => {
      achievementAutoSyncService.stopWatching(appIdStr);
    };
  }, [appIdStr, settings.achievementAutoSyncEnabled, settings.achievementAutoSyncIntervalSeconds,
      settings.steamWebApiKey, settings.steamId64, settings.steamAccountId, settings.steamRoot,
      settings.steamAchievementsEnabled, settings.achievementSchemaPath]);

  // Auto-sync: game stop detection — when a session for our appId is removed
  const prevSessionsRef = useRef(gameSessions);
  useEffect(() => {
    const prev = prevSessionsRef.current;
    const current = gameSessions;
    prevSessionsRef.current = current;

    if (!appIdStr) return;
    if (!settings.achievementAutoSyncEnabled) return;

    // Check if any session with our appId was removed (game stopped)
    for (const [key, prevSession] of Object.entries(prev)) {
      if (prevSession.appId === appIdStr && !current[key]) {
        console.debug(`[ACH][AUTO_SYNC] game stopped appid=${appIdStr}, checking progress`);
        // Wait 1-2 seconds for Steam to write cache after game exit
        const timeoutId = setTimeout(() => {
          achievementAutoSyncService.triggerRefresh(appIdStr, "game-stopped");
        }, 1500);
        // Note: this timeout is not cleaned up on unmount because we want it to fire
        // even if the component re-renders. It's a best-effort cleanup.
        // The timeout is stored so we can clean it up if needed.
        if (typeof (window as any).__achAutoSyncTimeouts === "undefined") {
          (window as any).__achAutoSyncTimeouts = [];
        }
        (window as any).__achAutoSyncTimeouts.push(timeoutId);
      }
    }
  }, [gameSessions, appIdStr, settings.achievementAutoSyncEnabled]);

  // PART 3-4: Premium achievement toast notifications — max 3, then group
  // If the background watcher is running, it already showed the toasts globally.
  const lastUnlockKey = useRef<string | null>(null);
  useEffect(() => {
    if (!achievementsSummary?.newlyUnlocked?.length) return;
    if (achievementWatcherService.started) {
      console.debug(`[ACH][UNLOCK][LIBRARY] skipped reason=watcher-handles-toasts appId=${appIdStr}`);
      return;
    }
    const key = JSON.stringify(achievementsSummary.newlyUnlocked.map((e) => e.apiName));
    if (lastUnlockKey.current === key) return;
    lastUnlockKey.current = key;
    const events = achievementsSummary.newlyUnlocked;
    const toastEnabled = settings.achievementToastEnabled;
    const overlayEnabled = settings.achievementOverlayNotificationsEnabled;
    const nativeEnabled = settings.achievementNativeNotificationsEnabled;
    const maxShow = 3;
    for (let i = 0; i < Math.min(events.length, maxShow); i++) {
      if (overlayEnabled) {
        showAchievementOverlay({
          name: events[i].name,
          iconUrl: events[i].iconUrl,
          appId: appIdStr ?? undefined,
          rarity: events[i].rarityPercent,
          gameTitle: detailTitle,
        }).then((ok) => {
          if (!ok) {
            console.warn(`[ACH][OVERLAY_FALLBACK] appId=${appIdStr} apiName=${events[i].apiName} toastEnabled=${toastEnabled}`);
            if (toastEnabled) {
              showAchievementToast(events[i], appIdStr ?? undefined, detailTitle);
            }
          }
        });
      } else if (toastEnabled) {
        showAchievementToast(events[i], appIdStr ?? undefined, detailTitle);
      }
    }
    if (events.length > maxShow) {
      if (overlayEnabled) {
        showGroupedAchievementOverlay(events.length - maxShow);
      } else if (toastEnabled) {
        showGroupedAchievementToast(events.length - maxShow);
      }
    }
    if (nativeEnabled) {
      for (const ev of events) {
        sendAchievementNativeNotification(ev.name, detailTitle);
      }
    }
    const source = overlayEnabled ? 'overlay' : (toastEnabled ? 'in-app' : 'none');
    console.debug(`[ACH][UNLOCK] toasts=${Math.min(events.length, maxShow)} extra=${Math.max(0, events.length - maxShow)} native=${nativeEnabled} source=${source}`);
  }, [achievementsSummary?.newlyUnlocked, appIdStr, settings.achievementNativeNotificationsEnabled, settings.achievementOverlayNotificationsEnabled, settings.achievementToastEnabled, detailTitle]);

  // Subscribe to image download updates — filter by appId to avoid cross-AppID contamination
  useEffect(() => {
    const unsub = achievementImageQueue.subscribe((appId, apiName, type, dataUrl) => {
      if (appId !== appIdStr) return;
      setAchievementsSummary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          achievements: prev.achievements.map((a) =>
            a.apiName === apiName
              ? { ...a, [type === "icon" ? "iconUrl" : "iconGrayUrl"]: dataUrl }
              : a,
          ),
        };
      });
    });
    return unsub;
  }, [appIdStr]);

  // Enqueue missing achievement images when summary loads — once per loadKey change
  // Uses generation tokens to prevent cross-AppID contamination (Part B3)
  // Phase 3: Only resolves images for the first 5 visible achievements (matching sidebar render)
  // Phase 4: Deferred during user interaction
  // Phase 5: Per-image logs gated behind DEBUG_ACH_IMAGE_QUEUE
  const lastEnqueueKey = useRef<string>("");
  const prevAppIdRef = useRef<string>("");
  const lastGenerationRef = useRef<string>("");
  const VISIBLE_BATCH_SIZE = 5; // matches sidebar .slice(0, 5)
  useEffect(() => {
    if (!achievementsSummary?.achievements?.length || !appIdStr) return;

    // Phase 5: Skip entirely when auto-download is disabled
    if (!ACHIEVEMENT_IMAGE_MIGRATION_AUTO) return;

    // Phase 4: Defer during interaction (navigation, scroll, click)
    if (isInteractionBusy()) return;

    // Cancel previous generation when appId changes
    if (prevAppIdRef.current && prevAppIdRef.current !== appIdStr) {
      if (lastGenerationRef.current) {
        cancelGeneration(lastGenerationRef.current);
        achievementImageQueue.cancelJobsForApp(prevAppIdRef.current, "appid-changed");
      }
    }
    prevAppIdRef.current = appIdStr;

    const generationId = nextGenerationId(appIdStr, "game-details");
    lastGenerationRef.current = generationId;

    const currentKey = `${appIdStr}:${achievementsSummary.source}:${achievementsSummary.total}:${achievementsSummary.updatedAt ?? 0}`;
    if (lastEnqueueKey.current === currentKey) {
      if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG_QUEUE] ensure skipped reason=already-ensured appid=${appIdStr}`);
      return;
    }
    lastEnqueueKey.current = currentKey;

    // Phase 3: Limit to visible batch (first N achievements)
    const visibleAchievements = achievementsSummary.achievements.slice(0, VISIBLE_BATCH_SIZE);
    const items: import("../../services/achievementImageQueue").ImageQueueItem[] = [];
    const startTime = performance.now();
    let cachedCount = 0;
    let skippedCount = 0;

    for (const a of visibleAchievements) {
      // Phase 2+7: Session dedup — skip if already resolved this session
      if (a.iconUrl && !isResolvedUrl(a.iconUrl)) {
        if (isImageResolved(appIdStr, a.iconUrl, "icon")) {
          skippedCount++;
        } else {
          const resolved = resolveImageSource(a.iconUrl, appIdStr, "icon");
          if (resolved) {
            items.push({ appId: appIdStr, apiName: a.apiName, ...resolved, type: "icon", priority: "high", caller: "game-details", createdAt: Date.now(), generationId });
            markImageResolved(appIdStr, a.iconUrl, "icon");
          } else {
            cachedCount++;
          }
        }
      } else if (a.iconUrl) {
        cachedCount++;
      }

      if (a.iconGrayUrl && !isResolvedUrl(a.iconGrayUrl)) {
        if (isImageResolved(appIdStr, a.iconGrayUrl, "icon_gray")) {
          skippedCount++;
        } else {
          const resolved = resolveImageSource(a.iconGrayUrl, appIdStr, "icon_gray");
          if (resolved) {
            items.push({ appId: appIdStr, apiName: a.apiName, ...resolved, type: "icon_gray", priority: "high", caller: "game-details", createdAt: Date.now(), generationId });
            markImageResolved(appIdStr, a.iconGrayUrl, "icon_gray");
          } else {
            cachedCount++;
          }
        }
      } else if (a.iconGrayUrl) {
        cachedCount++;
      }
    }

    if (items.length > 0) {
      if (DEBUG_ACH_IMAGE_QUEUE) console.debug(`[ACH][IMG] enqueued ${items.length} images for appid=${appIdStr} visibleBatch=${VISIBLE_BATCH_SIZE}`);
      achievementImageQueue.enqueue(items);
    }
    const elapsedMs = Math.round(performance.now() - startTime);
    if (DEBUG_ACH_IMAGE_QUEUE) {
      console.debug(`[ACH][IMG_SUMMARY] appid=${appIdStr} requested=${visibleAchievements.length * 2} cachedHits=${cachedCount} queued=${items.length} skipped=${skippedCount} elapsedMs=${elapsedMs}`);
    }
  }, [achievementsSummary, appIdStr]);

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

  // PART 1: Sidebar sort — unlocked first, unlockTime desc, rarity asc, name
  const sortedSidebarAchievements = useMemo(() => {
    if (!achievementsSummary?.achievements) return null;
    return [...achievementsSummary.achievements].sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      if (a.unlocked && b.unlocked) {
        const at = a.unlockTime ?? 0;
        const bt = b.unlockTime ?? 0;
        if (at !== bt) return bt - at;
      }
      if (!a.unlocked && !b.unlocked) {
        const ar = a.rarityPercent ?? 101;
        const br = b.rarityPercent ?? 101;
        if (ar !== br) return ar - br;
      }
      return a.name.localeCompare(b.name);
    });
  }, [achievementsSummary?.achievements]);

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

  if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) {
    console.log(`[MEDIA][DETAILS_RENDER] appid=${game.appId} title=${detailTitle} imageUrl=${imageUrl ? "set" : "null"} logoUrl=${logoUrl ? "set" : "null"} canonicalMedia=${canonicalAppInfo?.media ? "set" : "null"}`);
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
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
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
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-red-500/50"
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
              {action === "open-steam" && (
                <button
                  type="button"
                  onClick={() => onOpenSteam?.(game)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in Steam
                </button>
              )}
              {action === "open-lua-folder" && (
                <button
                  type="button"
                  onClick={() => {
                    if (game.luaScripts.length > 0) {
                      const scriptPath = game.luaScripts[0].path;
                      const scriptDir = scriptPath.substring(0, Math.max(scriptPath.lastIndexOf('/'), scriptPath.lastIndexOf('\\')));
                      if (scriptDir) invoke("open_folder", { path: scriptDir }).catch((err) => toast.error(`Could not open folder: ${err}`));
                    }
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-black transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                >
                  <FolderOpen className="h-4 w-4" />
                  Lua Folder
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
              {isPerfected ? (
                <div className="inline-flex items-center gap-1.5 text-xs">
                  <Trophy className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="hidden sm:inline text-[10px] uppercase tracking-wider text-amber-400/80">Perfected:</span>
                  <span className="font-medium text-amber-400">{effectiveUnlocked}/{effectiveTotal}</span>
                </div>
              ) : (
                <StatInline icon={<Trophy className="h-5 w-5" />} label="Achievements" value={achievementsStatus} />
              )}
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
                onClick={() => { if (game.appId) toggleFavorite(game.appId); }}
                className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/5 px-2.5 py-2 text-xs transition hover:bg-white/10 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                title={favorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Heart
                  className={`h-3.5 w-3.5 ${favorite ? "text-rose-400" : "text-(--color-muted)"}`}
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
                <h3 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isPerfected ? "text-amber-400/90" : "text-(--color-muted)"}`}>
                  <Trophy className={`h-3.5 w-3.5 ${isPerfected ? "fill-amber-400 text-amber-400" : ""}`} />
                  {isPerfected ? "Perfected" : "Achievements"}
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
                ) : achievementsSummary && effectiveProgressAvailable && effectiveTotal > 0 ? (
                  <div className="mt-3 space-y-3">
                    {/* Trace: log panel count source for Cuphead */}
                    {game.appId === "268910" && DEBUG_ACH_DETAILS && (console.log(`[ACH][UI_COUNT_SOURCE] appid=268910 location=panel source=${achievementsSummary.source} effectiveUnlocked=${effectiveUnlocked}/${effectiveTotal} summaryUnlocked=${achievementsSummary.unlocked}/${achievementsSummary.total} listDerived=${derivedUnlocked}`), null)}

                    {isPerfected && (
                      <div className="rounded-xl bg-amber-500/8 border border-amber-400/15 px-3.5 py-2.5 flex items-center gap-3">
                        <Trophy className="h-5 w-5 fill-amber-400 text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-amber-300">Perfected</p>
                          <p className="text-[10px] text-amber-400/60">All achievements unlocked</p>
                        </div>
                        <span className="ml-auto shrink-0 text-[11px] font-bold text-amber-400/80">
                          {effectiveUnlocked}/{effectiveTotal} &middot; 100%
                        </span>
                      </div>
                    )}

                    {/* Progress bar */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-medium ${isPerfected ? "text-amber-400" : "text-(--color-text)"}`}>
                          {effectiveUnlocked} / {effectiveTotal}
                        </span>
                        <span className={isPerfected ? "text-amber-400/80" : "text-(--color-muted)"}>
                          {effectiveTotal > 0 ? Math.round((effectiveUnlocked / effectiveTotal) * 100) : 0}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isPerfected
                              ? "bg-gradient-to-r from-amber-400 to-yellow-300"
                              : "bg-(--color-accent)"
                          }`}
                          style={{
                            width: `${effectiveTotal > 0 ? Math.round((effectiveUnlocked / effectiveTotal) * 100) : 0}%`,
                            boxShadow: isPerfected ? "0 0 10px rgba(251,191,36,0.4)" : undefined,
                          }}
                        />
                      </div>
                      <p className={`mt-1 text-[10px] ${isPerfected ? "text-amber-400/50" : "text-(--color-muted)/60"}`}>
                        {isPerfected
                          ? "All achievements unlocked"
                          : `${effectiveTotal > 0 ? Math.round((effectiveUnlocked / effectiveTotal) * 100) : 0}% complete`}
                        {achievementsSyncing && (
                          <span className="ml-2 italic">Syncing...</span>
                        )}
                      </p>
                    </div>
                    {/* Recent achievements (top 5) */}
                    <div className="space-y-1">
                      {(sortedSidebarAchievements ?? achievementsSummary.achievements).slice(0, 5).map((ach) => (
                        <div
                          key={ach.id}
                          className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.06]"
                          aria-label={`${ach.name} — ${ach.unlocked ? "Unlocked" : "Locked"}${ach.rarityPercent != null ? `, ${ach.rarityPercent.toFixed(1)}% rarity` : ""}`}
                        >
                          <AchievementTooltip achievement={ach} appId={game.appId}>
                            <AchievementIcon
                              iconUrl={ach.iconUrl}
                              iconGrayUrl={ach.iconGrayUrl}
                              unlocked={ach.unlocked}
                              size="sm"
                              appId={game.appId}
                            />
                          </AchievementTooltip>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-(--color-text)">
                              {ach.name}
                            </span>
                            {ach.rarityPercent != null ? (
                              <span className="block text-[9px] text-(--color-muted)/50">
                                {ach.rarityPercent.toFixed(1)}% rarity
                              </span>
                            ) : (
                              <span className="block text-[9px] text-(--color-muted)/30">N/A rarity</span>
                            )}
                          </div>
                          <span className={`shrink-0 text-[9px] font-medium ${
                            ach.unlocked ? "text-emerald-400" : "text-(--color-muted)/50"
                          }`}>
                            {ach.unlocked ? "Unlocked" : "Locked"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {isPerfected ? (
                        <button
                          type="button"
                          onClick={() => setShowAchievementsModal(true)}
                          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-xs font-medium text-amber-400 transition hover:bg-amber-500/12 focus-visible:ring-2 focus-visible:ring-amber-400/50"
                        >
                          <Trophy className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          View all · {achievementsSummary.total} achievements
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowAchievementsModal(true)}
                          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                        >
                          <Trophy className="h-3.5 w-3.5" />
                          View all achievements ({achievementsSummary.total})
                        </button>
                      )}
                      {import.meta.env.DEV && (
                        <>
                          <button
                            type="button"
                            onClick={() => { if (appIdStr) debugAchievements(appIdStr, {
                              accountId: settings.steamAccountId,
                              steamPath: settings.steamRoot,
                              achievementSchemaPath: settings.achievementSchemaPath,
                            }); }}
                            className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-2 py-2 text-[10px] text-(--color-muted) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                            title="Debug achievement progress"
                          >
                            Debug
                          </button>
                          <button
                            type="button"
                            onClick={() => showTestAchievementToast(detailTitle)}
                            className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-2 py-2 text-[10px] text-(--color-accent) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                            title="Show test achievement toast"
                          >
                            Test Toast
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : achievementsSummary && !effectiveProgressAvailable && achievementsSummary.achievements.length > 0 ? (
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
                      {(sortedSidebarAchievements ?? achievementsSummary.achievements).slice(0, 5).map((ach) => (
                        <div
                          key={ach.id}
                          className="flex items-center  gap-2.5 rounded-xl bg-white/[0.03] px-2.5 py-2 transition hover:bg-white/[0.06]"
                          aria-label={`${ach.name} — ${ach.unlocked ? "Unlocked" : "Locked"}${ach.rarityPercent != null ? `, ${ach.rarityPercent.toFixed(1)}% rarity` : ""}`}
                        >
                          <AchievementTooltip achievement={ach} appId={game.appId}>
                            <AchievementIcon
                              iconUrl={ach.iconUrl}
                              iconGrayUrl={ach.iconGrayUrl}
                              unlocked={ach.unlocked}
                              size="sm"
                              appId={game.appId}
                            />
                          </AchievementTooltip>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-(--color-text)">
                              {ach.name}
                            </span>
                            {ach.rarityPercent != null ? (
                              <span className="block text-[9px] text-(--color-muted)/50">
                                {ach.rarityPercent.toFixed(1)}% rarity
                              </span>
                            ) : (
                              <span className="block text-[9px] text-(--color-muted)/30">N/A rarity</span>
                            )}
                          </div>
                          <span className={`shrink-0 text-[9px] font-medium ${
                            ach.unlocked ? "text-emerald-400" : "text-(--color-muted)/50"
                          }`}>
                            {ach.unlocked ? "Unlocked" : "Locked"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAchievementsModal(true)}
                        className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs font-medium text-(--color-accent) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                      >
                        <Trophy className="h-3.5 w-3.5" />
                        View all achievements
                      </button>
                      {import.meta.env.DEV && (
                        <button
                          type="button"
                          onClick={() => { if (appIdStr) debugAchievements(appIdStr, {
                            accountId: settings.steamAccountId,
                            steamPath: settings.steamRoot,
                            achievementSchemaPath: settings.achievementSchemaPath,
                          }); }}
                          className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-2 py-2 text-[10px] text-(--color-muted) transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                          title="Debug achievement progress"
                        >
                          Debug
                        </button>
                      )}
                    </div>
                  </div>
                ) : achievementsSummary && achievementsSummary.source === "unavailable" && (game.achievementsSupported || localAchSupportFound) ? (
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
                ) : (game.achievementsSupported || localAchSupportFound) ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-(--color-muted)">
                      Achievements not loaded
                    </p>
                    <p className="text-[10px] text-(--color-muted)/60">
                      Manual refresh checks local Steam data for this game.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        const { resolveSteamAchievements } = await import("../../services/steamAchievementsResolver");
                        if (!appIdStr) return;
                        setAchievementsLoading(true);
                        if (appIdStr === "268910") {
                          console.log(`[ACH][TRACE_REFRESH_START] appid=268910`);
                        }
                        // CRITICAL: delete existing store entry BEFORE resolving.
                        // resolveSteamAchievements has a post-call store-freshness check (line ~968)
                        // that returns store data if it has higher source priority.
                        // Without this delete, a "librarycache" entry (priority 0) would
                        // cause the resolver to return stale 13/42 instead of fresh 15/42.
                        achievementStore.deleteSummary(appIdStr);
                        try {
                          const s = await resolveSteamAchievements({
                            appId: appIdStr,
                            steamWebApiKey: settings.steamWebApiKey || undefined,
                            steamId64: settings.steamId64 || undefined,
                            accountId: settings.steamAccountId || undefined,
                            steamPath: settings.steamRoot || undefined,
                            forceRefresh: true,
                            steamAchievementsEnabled: settings.steamAchievementsEnabled,
                            achievementSchemaPath: settings.achievementSchemaPath || undefined,
                          });
                          if (appIdStr) {
                            if (appIdStr === "268910") {
                              const unlocked = s.achievements.filter((a: any) => a.unlocked).length;
                              console.log(`[ACH][TRACE_RESOLVED] appid=268910 source=${s.source} unlocked=${unlocked}/${s.total} progressAvailable=${s.progressAvailable} updatedAt=${s.updatedAt}`);
                            }
                            setAchievementsSummary(s);
                            achievementStore.setSummary(appIdStr, s);
                            const unlocked = s.achievements.filter((a: any) => a.unlocked).length;
                            if (appIdStr === "268910") {
                              console.log(`[ACH][TRACE_STORE_SET] appid=268910 source=${s.source} unlocked=${unlocked}/${s.total} updatedAt=${s.updatedAt}`);
                            }
                            console.log(`[ACH][MANUAL_REFRESH_DONE] appid=${appIdStr} count=${s.achievements.length} summary=${unlocked}/${s.total}`);
                            console.log(`[ACH][MANUAL_REFRESH_APPLY] appid=${appIdStr} unlocked=${unlocked}/${s.total}`);
                            // Phase 9: Schedule snapshot write so achievement summary persists after restart
                            notifyMediaUpdated(appIdStr, { source: "achievement-refresh" }).catch(() => {});
                          }
                        } catch (err) {
                          console.warn(`[ACH][REFRESH] failed appid=${appIdStr} reason=${err}`);
                          toast.error("Failed to refresh achievements");
                        } finally {
                          setAchievementsLoading(false);
                        }
                      }}
                      className="mt-1 cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-white/10"
                    >
                      {achievementsLoading ? "Loading..." : "Refresh Achievements"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="text-xs text-(--color-muted)">
                      Achievements are not supported for this game.
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
          gameTitle={detailTitle}
          gameIconUrl={game.metadata?.capsule_image || game.metadata?.header_image || game.imageUrl || undefined}
          onClose={() => setShowAchievementsModal(false)}
          onRefresh={() => {
            const previousSummary = achievementsSummary;
            console.debug(`[ACH][REFRESH] appid=${appIdStr} start`);
            console.debug(`[ACH][REFRESH] previous source=${previousSummary?.source} progressAvailable=${previousSummary?.progressAvailable} unlocked=${previousSummary?.unlocked}`);
            setAchievementsRefreshing(true);
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
                console.debug(`[ACH][REFRESH] next source=${s.source} progressAvailable=${s.progressAvailable} unlocked=${s.unlocked}`);
                const downgrade = previousSummary?.progressAvailable === true && s.progressAvailable === false && (s.source === "schema-only" || s.source === "global-percentages");
                console.debug(`[ACH][REFRESH] downgradeDetected=${!!downgrade}`);
                if (downgrade && previousSummary) {
                  console.debug(`[ACH][REFRESH] preservingPreviousProgress=true — merging schema metadata with previous progress`);
                  // Merge metadata from new scan, keep progress from previous
                  const merged: GameAchievement[] = s.achievements.map((a) => {
                    const prev = previousSummary.achievements.find((pa) => pa.apiName === a.apiName);
                    return {
                      ...a,
                      unlocked: prev?.unlocked ?? a.unlocked,
                      unlockTime: prev?.unlockTime ?? a.unlockTime,
                      rarityPercent: a.rarityPercent ?? prev?.rarityPercent,
                    };
                  });
                  const staleSummary: GameAchievementsSummary = {
                    appId: previousSummary.appId,
                    achievements: merged,
                    total: s.achievements.length || previousSummary.total,
                    unlocked: previousSummary.unlocked ?? merged.filter((a) => a.unlocked).length,
                    percent: previousSummary.percent ?? 0,
                    progressAvailable: true,
                    source: (previousSummary.source === "librarycache" ? "librarycache-stale" : (previousSummary.source + "-stale")) as GameAchievementsSummary["source"],
                    updatedAt: Date.now(),
                    errorReason: "showing-last-known-progress",
                  };
                  setAchievementsSummary(staleSummary);
                  if (appIdStr) achievementStore.setSummary(appIdStr, staleSummary);
                  toast("Showing last known achievement progress.", { duration: 4000, icon: "🔄" });
                } else {
                  setAchievementsSummary(s);
                  if (appIdStr) achievementStore.setSummary(appIdStr, s);
                }
                if (appIdStr) {
                  const summary = achievementStore.getSummary(appIdStr);
                  console.log(`[ACH][MANUAL_REFRESH_DONE] appid=${appIdStr} count=${summary?.achievements?.length ?? 0} summary=${summary?.unlocked}/${summary?.total}`);
                  console.log(`[ACH][SUMMARY_PERSISTED] appid=${appIdStr} unlocked=${summary?.unlocked}/${summary?.total}`);
                }
                console.debug(`[ACH][REFRESH] done`);
                setAchievementsRefreshing(false);
              })
              .catch((err) => {
                console.warn(`[ACH][REFRESH] failed keeping previous summary reason=${err}`);
                setAchievementsRefreshing(false);
                toast.error("Failed to refresh achievements", { duration: 3000 });
              });
          }}
          refreshing={achievementsRefreshing}
        />
      )}
    </div>
  );
}

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
