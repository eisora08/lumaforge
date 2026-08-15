// Debug flag for achievement-related details logs (noisy per-navigation logs)
const DEBUG_ACH_DETAILS = false;
const DEBUG_LAUNCH_BUTTON_RENDER = false;
const DEBUG_MANUAL_REMOVE = false;
// Debug flag for hero layer composition (blur backdrop vs sharp foreground)
const DEBUG_HERO_LAYERS = false;

// Compares two media URLs/paths by normalized basename (case-insensitive, ignores query/hash).
// The snapshot stores relative paths (media/background.jpg) while canonicalAppInfo resolves
// to absolute paths — both point to the same file. Keeping the same string avoids the
// <img key={imageUrl}> remount (and its opacity-0 gap) when only the path format changed.
function sameHeroFile(a: string, b: string): boolean {
  const base = (s: string) => {
    const clean = s.split(/[?#]/)[0] ?? s;
    const parts = clean.split(/[\\/]/);
    const name = parts[parts.length - 1] ?? clean;
    return name.toLowerCase();
  };
  const na = base(a);
  const nb = base(b);
  return na.length > 0 && na === nb;
}

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { countRender, isInteractionBusy } from "../../services/perfCounters";
import {
  BookMarked,
  BookOpen,
  Calendar,
  Cloud,
  CalendarClock ,
  ClockFading,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileSearch,
  FolderOpen,
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
  XCircle,
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry, GameMediaCacheEntry } from "../../services/tauri";
import type { GameAppInfo } from "../../services/gameCacheService";
import { resolveCanonicalDisplayTitle, isPendingUninstall, clearPendingUninstall, markPendingUninstall, subscribePendingUninstall, getPendingUninstallVersion, getFavoriteKey } from "../../services/gameCacheService";
import { setAmbientSource, clearAmbientSource, rememberLibraryDetails } from "../../services/ambientBackgroundStore";
import { subscribeHeroTransition, getHeroTransitionSnapshot } from "../../services/heroTransitionStore";
import { showInfo, showSuccess, showError } from "../toast/GameToast";
import { removeManualGame, normalizeManualGameId } from "../../services/manualGameStore";
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
import { open } from "@tauri-apps/plugin-dialog";
import { updateDebridGame, removeDebridGameFromLibrary } from "../../services/debridGameStore";

import AchievementIcon from "../common/AchievementIcon";
import AchievementTooltip from "../common/AchievementTooltip";

import { useInstallTracker } from "../../hooks/useInstallTracker";
import { useGrowOnMount } from "../../hooks/useGrowOnMount";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import { useGameActivity } from "../../context/GameActivityContext";
import {
  localPathToUrl,
  isLocalPath,
} from "../../services/libraryLocalCacheService";
import type { ResolvedGameMediaBundle } from "../../types/gameMedia";
import { resolveSteamGameNews } from "../../services/steamNewsResolver";
import { useGamePlayStats } from "../../services/gamePlayStats";
import { getPlaytimeEntryByAppId, getPlaytimeEntryByGameKey, resolvePlaytimeKey, formatPlaytime as formatPlaytimeSeconds, computeTotalPlaytime, getLastSessionEndForAppId, subscribePlaytimeStore } from "../../services/playtimeService";
import type { SteamNewsItem } from "../../types/gameActivity";
import type { GameLaunchInfo } from "../../hooks/useGameLaunchState";
import type { GameAchievement, GameAchievementsSummary } from "../../types/gameAchievements";
import { resolveSteamAchievements, debugAchievements } from "../../services/steamAchievementsResolver";
import { scanSteamAppcacheAchievements, uninstallSteamApp, openSteamStoreApp } from "../../services/tauri";
import { showAchievementToast, showGroupedAchievementToast, showTestAchievementToast } from "./AchievementToast";
import { sendAchievementNativeNotification, showAchievementOverlay, showGroupedAchievementOverlay } from "../../services/achievementNotificationService";
import { achievementImageQueue, resolveImageSource, isResolvedUrl, nextGenerationId, cancelGeneration, ACHIEVEMENT_IMAGE_MIGRATION_AUTO, DEBUG_ACH_IMAGE_QUEUE, isImageResolved, markImageResolved } from "../../services/achievementImageQueue";
import { achievementAutoSyncService } from "../../services/achievementAutoSyncService";
import { achievementStore, isSourceNewerOrEqual } from "../../services/achievementStore";
import { ACHIEVEMENT_AUTO_LOAD_GAME_DETAILS } from "../../services/achievementAutoFlags";
import { achievementWatcherService } from "../../services/achievementWatcherService";
import { getCachedSnapshot } from "../../services/startupSnapshotService";
import { useSettings } from "../../context/SettingsContext";
import { useFavorites } from "../../context/FavoritesContext";
import GameEditDialog from "../games/GameEditDialog";
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
  fallbackBundle?: ResolvedGameMediaBundle | null;
  loading?: boolean;
  canonicalLoaded?: boolean;
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
  onOpenTools?: (game: LibraryGame) => void;
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

function getHeroImageUrl(game: LibraryGame, artwork?: SgdbArtworkData | null, appInfoEntry?: LibraryAppInfoEntry | null, mediaEntry?: GameMediaCacheEntry | null, canonicalAppInfo?: GameAppInfo | null, canonicalDiskFallback?: string | null, fallbackBundle?: ResolvedGameMediaBundle | null): string | undefined {
  // Priority: snapshot/canonical local disk paths first so the sharp hero targets the
  // same high-res asset the blurred backdrop shows from frame 1 (no visible swap when
  // remote sources like appInfoEntry/SGDB/fallbackBundle resolve later) → mediaEntry →
  // materialized fallbackBundle localPath → Steam metadata primary → Steam header →
  // SGDB → fallbackBundle remote URL → metadata secondary → imageUrl → placeholder.
  if (canonicalAppInfo?.media?.backgroundPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=background path=${canonicalAppInfo.media.backgroundPath}`); return canonicalAppInfo.media.backgroundPath; }
  if (game.backgroundPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=game.backgroundPath path=${game.backgroundPath}`); return game.backgroundPath; }
  if (canonicalAppInfo?.media?.landscapePath) { logDetailsCanonical(game.appId ?? "", `heroSelected=landscape path=${canonicalAppInfo.media.landscapePath}`); return canonicalAppInfo.media.landscapePath; }
  if (game.landscapePath) { logDetailsCanonical(game.appId ?? "", `heroSelected=game.landscapePath path=${game.landscapePath}`); return game.landscapePath; }
  if (canonicalAppInfo?.media?.coverPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=cover path=${canonicalAppInfo.media.coverPath}`); return canonicalAppInfo.media.coverPath; }
  if (game.coverPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=game.coverPath path=${game.coverPath}`); return game.coverPath; }
  if (mediaEntry?.hero_path) { logDetailsCanonical(game.appId ?? "", `heroSelected=mediaEntry.hero_path`); return mediaEntry.hero_path; }
  if (mediaEntry?.grid_path) { logDetailsCanonical(game.appId ?? "", `heroSelected=mediaEntry.grid_path`); return mediaEntry.grid_path; }
  // FallbackBundle: resolved by multi-provider chain (steam-appdetails metadata → cached → SGDB → IGDB → RAWG)
  // Prefer localPath (materialized on disk) before remote URL
  if (fallbackBundle?.background?.localPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=fallbackBundle.background.localPath path=${fallbackBundle.background.localPath}`); return fallbackBundle.background.localPath; }
  if (fallbackBundle?.landscape?.localPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=fallbackBundle.landscape.localPath path=${fallbackBundle.landscape.localPath}`); return fallbackBundle.landscape.localPath; }
  if (fallbackBundle?.cover?.localPath) { logDetailsCanonical(game.appId ?? "", `heroSelected=fallbackBundle.cover.localPath path=${fallbackBundle.cover.localPath}`); return fallbackBundle.cover.localPath; }
  // Metadata primary background fields
  const metaPrimary = game.metadata?.background_image
    || (game.metadata as any)?.background
    || (game.metadata as any)?.background_raw
    || game.metadata?.library_hero_image
    || game.metadata?.hero_image;
  if (metaPrimary) { logDetailsCanonical(game.appId ?? "", `heroSelected=metadataPrimary`); return metaPrimary; }
  if (appInfoEntry?.header_image) { logDetailsCanonical(game.appId ?? "", `heroSelected=appInfoEntry.header_image`); return appInfoEntry.header_image; }
  if (artwork?.sgdbHeroUrl) { logDetailsCanonical(game.appId ?? "", `heroSelected=sgdbHeroUrl`); return artwork.sgdbHeroUrl; }
  if (artwork?.sgdbGridUrl) { logDetailsCanonical(game.appId ?? "", `heroSelected=sgdbGridUrl`); return artwork.sgdbGridUrl; }
  if (fallbackBundle?.background?.url) { logDetailsCanonical(game.appId ?? "", `heroSelected=fallbackBundle.background source=${fallbackBundle.background.source}`); return fallbackBundle.background.url; }
  if (fallbackBundle?.landscape?.url) { logDetailsCanonical(game.appId ?? "", `heroSelected=fallbackBundle.landscape source=${fallbackBundle.landscape.source}`); return fallbackBundle.landscape.url; }
  if (fallbackBundle?.cover?.url) { logDetailsCanonical(game.appId ?? "", `heroSelected=fallbackBundle.cover source=${fallbackBundle.cover.source}`); return fallbackBundle.cover.url; }
  // Metadata secondary fields (less reliable as hero images)
  const metaSecondary = game.metadata?.header_image
    || (game.metadata?.screenshots?.[0])
    || game.metadata?.capsule_image
    || game.metadata?.capsule_image_v5;
  if (metaSecondary) { logDetailsCanonical(game.appId ?? "", `heroSelected=metadataSecondary`); return metaSecondary; }
  if (game.imageUrl) { logDetailsCanonical(game.appId ?? "", `heroSelected=imageUrl`); return game.imageUrl; }
  if (mediaEntry?.cover_path) { logDetailsCanonical(game.appId ?? "", `heroSelected=mediaEntry.cover_path`); return mediaEntry.cover_path; }
  if (canonicalDiskFallback) { logDetailsCanonical(game.appId ?? "", `heroSelected=canonicalDiskFallback`); return canonicalDiskFallback; }
  logDetailsCanonical(game.appId ?? "", `heroSelected=placeholder`);
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
  canonicalLoaded = true,
  onPlay,
  onInstall,
  onDeleteScript,
  onOpenSteam,
  onOpenSteamDb,
  onBack,
  onRefreshArtwork,
  onOpenTools,
  onNavigate,
  launchInfo,
  onCancelLaunch,
  onOpenStopModal,
  fallbackBundle,
}: LibraryGameDetailsProps) {
  countRender("LibraryGameDetails");
  if (game.appId === "4717430") {
    console.log(`[LIB_MEDIA_DEBUG][FALLBACK_BUNDLE_PROP] appid=4717430 hasBundle=${!!fallbackBundle} hasBg=${!!fallbackBundle?.background?.url} bgUrl=${fallbackBundle?.background?.url ?? "(null)"} source=${fallbackBundle?.background?.source ?? "(null)"}`);
  }
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDialogTab, setEditDialogTab] = useState<"general" | "media">("general");
  const [heroImgError, setHeroImgError] = useState(false);
  const [loadedHeroUrl, setLoadedHeroUrl] = useState<string | undefined>(undefined);
  const [placeholderUrl, setPlaceholderUrl] = useState<string | undefined>(undefined);
  const [backdropLayers, setBackdropLayers] = useState<string[]>([]);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favoriteId = getFavoriteKey(game) ?? game.id;
  const favorite = isFavorite(favoriteId);
  const actionsRef = useRef<HTMLDivElement>(null);
  const isManualGame = game.source === "manual";
  const isEpicGame = game.source === "epic";
  const linkedSteamAppId = isManualGame ? ((localDetailsData as any)?.linkedSteamAppId ?? null) : null;

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
  const gameSessionKey = game.id;
  const isManualRunning = game.source === "manual" && !!(gameSessions[gameSessionKey]?.state === "running" || gameSessions[gameSessionKey]?.state === "launching");
  const appIdStr = game.appId;
  const snapshotHydratedRef = useRef(false);
  const [achievementsSummary, setAchievementsSummary] = useState<GameAchievementsSummary | null>(() => {
    if (!appIdStr) return null;
    // 1. Check in-memory store first
    const fromStore = achievementStore.getSummary(appIdStr, "steam-official");
    if (fromStore) return fromStore;
    // 2. Fallback to snapshot's achievementSummary (updated by full rebuild after refresh)
    const snap = getCachedSnapshot();
    const snapGame = snap?.library?.games?.find(g => g.appId === appIdStr);
    if (snapGame?.achievementSummary && snapGame.achievementSummary.total > 0) {
      const a = snapGame.achievementSummary;
      if (!a.unlocked || a.unlocked === 0) snapshotHydratedRef.current = true;
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
  // When the initial state came from the snapshot (stale, achievements: []),
  // the effect below will async-load the real disk cache — show a loading state
  // so the UI doesn't flash stale numbers.
  const [achievementsLoading, setAchievementsLoading] = useState(() => snapshotHydratedRef.current);
  const [achievementsRefreshing, setAchievementsRefreshing] = useState(false);
  const achievementsSyncing = achievementsSummary != null && achievementsLoading;
  const [showAchievementsModal, setShowAchievementsModal] = useState(false);
  const [localAchSupportFound, setLocalAchSupportFound] = useState(false);
  const [achSource, setAchSource] = useState<"steam-official" | "steam">("steam-official");
  const [hasCrackSave, setHasCrackSave] = useState(false);

  // Auto-detect crack source on mount — respect persisted user choice
  // The cancelled flag prevents the async callback from overwriting a manual user switch:
  // if the user changes the dropdown before detectCrackType resolves, the callback is a no-op.
  useEffect(() => {
    if (!appIdStr) return;
    userSwitchedSourceRef.current = false;
    let cancelled = false;
    const saved = localStorage.getItem(`lumaforge-ach-platform-${appIdStr}`) as "steam-official" | "steam" | null;
    import("../../services/achievementConfigService").then(({ detectCrackType }) => {
      detectCrackType(appIdStr).then((result: any) => {
        if (cancelled) return; // user already switched manually — don't overwrite
        const hasCrack = !!result?.savePath;
        setHasCrackSave(hasCrack);
        if (saved) {
          setAchSource(saved);
          console.log(`[ACH][PLATFORM_SELECT] appid=${appIdStr} loaded from localStorage=${saved} hasCrack=${hasCrack}`);
        } else if (hasCrack) {
          setAchSource("steam");
          console.log(`[ACH][SOURCE_DETECT] appid=${appIdStr} detected crack save=${result.savePath} type=${result.crackType}`);
        } else {
          setAchSource("steam-official");
        }
      }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [appIdStr]);

  // Re-resolve achievements when source changes — always re-resolve, even without summary
  const achSourceRef = useRef<string | null>(null); // null = never fired → forces resolve on mount
  const userSwitchedSourceRef = useRef(false);
  useEffect(() => {
    if (!appIdStr) return;
    if (achSourceRef.current === achSource) return;
    achSourceRef.current = achSource;
    userSwitchedSourceRef.current = true; // block disk cache effect during resolve
    // Trigger refresh with new source
    (async () => {
      const { resolveSteamAchievements } = await import("../../services/steamAchievementsResolver");
      setAchievementsLoading(true);
      try {
        const gameSource = achSource === "steam" ? "debrid" : "steam";
        const s = await resolveSteamAchievements({
          appId: appIdStr,
          steamWebApiKey: settings.steamWebApiKey || undefined,
          steamId64: settings.steamId64 || undefined,
          accountId: settings.steamAccountId || undefined,
          steamPath: settings.steamRoot || undefined,
          forceRefresh: true,
          steamAchievementsEnabled: settings.steamAchievementsEnabled,
          achievementSchemaPath: settings.achievementSchemaPath || undefined,
          gameSource,
          platform: achSource,
        });
        if (appIdStr) {
          achievementStore.deleteSummary(appIdStr, achSource);
          setAchievementsSummary(s);
          achievementStore.setSummary(appIdStr, s, achSource);
          console.log(`[ACH][SOURCE_CHANGED] appid=${appIdStr} source=${achSource} count=${s.achievements.length} unlocked=${s.unlocked}/${s.total}`);
        }
      } catch (err) {
        console.warn(`[ACH][SOURCE_CHANGED] failed appid=${appIdStr} reason=${err}`);
      } finally {
        setAchievementsLoading(false);
      }
    })();
  }, [achSource]);
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

  const rawImageUrl = getHeroImageUrl(game, artwork, appInfoEntry, mediaEntry, canonicalAppInfo, canonicalDiskFallback, fallbackBundle);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);

  // Reset hero image states when a new URL is resolved
  // Clear error on candidate changes, but keep the last good hero visible (crossfade).
  // Only reset the loaded hero when switching to a different game.
  const prevHeroAppIdRef = useRef(game.appId);
  useEffect(() => {
    setHeroImgError(false);
  }, [rawImageUrl]);

  useEffect(() => {
    if (prevHeroAppIdRef.current !== game.appId) {
      prevHeroAppIdRef.current = game.appId;
      setLoadedHeroUrl(undefined);
      setHeroImgError(false);
      setBackdropLayers([]);
    }
  }, [game.appId]);

  const backdropSrc = loadedHeroUrl ?? placeholderUrl;
  useEffect(() => {
    if (!backdropSrc) return;
    setBackdropLayers((prev) => (prev[prev.length - 1] === backdropSrc ? prev : [...prev.slice(-1), backdropSrc]));
  }, [backdropSrc]);

  useEffect(() => {
    if (backdropLayers.length < 2) return;
    const t = setTimeout(() => setBackdropLayers((prev) => prev.slice(-1)), 600);
    return () => clearTimeout(t);
  }, [backdropLayers]);

  useEffect(() => {
    if (!rawImageUrl) {
      setImageUrl(undefined);
      return;
    }
    const resolve = async () => {
      let resolved = rawImageUrl;
      if (rawImageUrl.startsWith("media/") || rawImageUrl.startsWith("img/")) {
        const { resolveRelativeMediaPath } = await import("../../services/gameCacheService");
        resolved = await resolveRelativeMediaPath(game.appId ?? "", rawImageUrl).catch(() => rawImageUrl);
      } else if (rawImageUrl.startsWith("games/")) {
        const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
        resolved = await resolveProviderMediaPreviewUrl(rawImageUrl).catch(() => rawImageUrl) ?? rawImageUrl;
      }
      // Block cross-appid paths
      if (isLocalPath(resolved) && game.appId) {
        const pathAppIdMatch = resolved.match(/games[/\\]steam[/\\](\d+)[/\\]media/);
        if (pathAppIdMatch && pathAppIdMatch[1] !== game.appId) {
          console.log(`[MEDIA][BLOCKED] reason=cross-appid-media currentAppid=${game.appId} pathAppid=${pathAppIdMatch[1]} path=${resolved}`);
          setImageUrl(undefined);
          return;
        }
      }
      const isLocal = isLocalPath(resolved);
      const url = isLocal ? (localPathToUrl(resolved) ?? undefined) : resolved;
      // Keep the current string when the resolved URL points to the same file (basename match).
      // Snapshot paths are relative (media/background.jpg) while canonicalAppInfo resolves to
      // absolute paths; same file → same key={imageUrl} → no <img> remount → no opacity-0 gap.
      setImageUrl((prev) => (prev && url && sameHeroFile(prev, url) ? prev : url));
      if (game.appId === "4717430") {
        console.log(`[LIB_MEDIA_DEBUG][HERO_FINAL] appid=4717430 url=${url ?? "(null)"} rawUrl=${rawImageUrl} fallbackBundle=${!!fallbackBundle} fbBg=${fallbackBundle?.background?.url ?? "(null)"} canonicalBg=${canonicalAppInfo?.media?.backgroundPath ?? "(null)"} metaBg=${game.metadata?.background_image ?? "(null)"}`);
      }
    };
    resolve();
  }, [rawImageUrl, game.appId, fallbackBundle, canonicalAppInfo, game.metadata?.background_image]);

  // ─── Ambient background: feed hero art synchronously from in-memory snapshot media
  // (first paint, no async), then upgrade to the resolved imageUrl. On game change/unmount
  // the store falls back to the navigation-level page-context so the background never
  // goes stale or blank during the canonical-resolution window. ──
  useEffect(() => {
    if (imageUrl) {
      setAmbientSource("library-details", imageUrl);
      rememberLibraryDetails(imageUrl);
      return;
    }
    const syncPath = game.backgroundPath || game.landscapePath || game.coverPath;
    if (
      syncPath &&
      !syncPath.startsWith("media/") &&
      !syncPath.startsWith("img/") &&
      !syncPath.startsWith("games/")
    ) {
      const url = isLocalPath(syncPath) ? (localPathToUrl(syncPath) ?? undefined) : syncPath;
      if (url) {
        setAmbientSource("library-details", url);
        rememberLibraryDetails(url);
      }
    }
  }, [imageUrl, game.appId, game.backgroundPath, game.landscapePath, game.coverPath]);

  useEffect(() => {
    clearAmbientSource("library-details");
  }, [game.appId]);

  useEffect(() => {
    return () => clearAmbientSource("library-details");
  }, []);

  // Resolve a fast colorful placeholder (snapshot media) so the hero never flashes black
  // while canonicalAppInfo/imageUrl load asynchronously for Steam/Lua games.
  const rawPlaceholder = game.backgroundPath || game.landscapePath || game.coverPath;
  useEffect(() => {
    if (!rawPlaceholder) {
      setPlaceholderUrl(undefined);
      return;
    }
    const resolve = async () => {
      let resolved = rawPlaceholder;
      if (resolved.startsWith("media/") || resolved.startsWith("img/")) {
        const { resolveRelativeMediaPath } = await import("../../services/gameCacheService");
        resolved = await resolveRelativeMediaPath(game.appId ?? "", resolved).catch(() => rawPlaceholder);
      } else if (resolved.startsWith("games/")) {
        const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
        resolved = await resolveProviderMediaPreviewUrl(resolved).catch(() => rawPlaceholder) ?? rawPlaceholder;
      }
      const isLocal = isLocalPath(resolved);
      const url = isLocal ? (localPathToUrl(resolved) ?? undefined) : resolved;
      setPlaceholderUrl(url);
    };
    resolve();
  }, [rawPlaceholder, game.appId]);

  const rawLogoUrl = (() => {
    const fallbackLogoSrc = fallbackBundle?.logo?.url;
    const fallbackLogoLocal = fallbackBundle?.logo?.localPath;
    const src = canonicalAppInfo?.media?.logoPath
      || artwork?.sgdbLogoUrl
      || game.metadata?.logo_image
      || game.metadata?.library_logo_image
      || fallbackLogoLocal
      || fallbackLogoSrc;
    if (ENABLE_VERBOSE_LIBRARY_DETAILS_LOGS) {
      if (canonicalAppInfo?.media?.logoPath) console.log("[LibraryDetails] selected logo source: logoPath");
      else if (artwork?.sgdbLogoUrl) console.log("[LibraryDetails] selected logo source: sgdbLogoUrl");
      else if (game.metadata?.logo_image) console.log("[LibraryDetails] selected logo source: logo_image");
      else if (game.metadata?.library_logo_image) console.log("[LibraryDetails] selected logo source: library_logo_image");
      else if (fallbackLogoSrc) console.log("[LibraryDetails] selected logo source: fallbackBundle");
      else console.log("[LibraryDetails] selected logo source: none");
    }
    return src;
  })();
  // Defense-in-depth: reject logo URL from a different appId's Steam CDN
  const _validatedLogoSrc = (() => {
    if (!rawLogoUrl || !game.appId) return rawLogoUrl;
    const appIdMatch = rawLogoUrl.match(/steam\/apps\/(\d+)\//);
    if (appIdMatch && appIdMatch[1] !== game.appId) {
      console.log(`[LOGO_DISPLAY][REJECT] appid=${game.appId} reason=cross-app-steam-url urlAppid=${appIdMatch[1]}`);
      return undefined;
    }
    return rawLogoUrl;
  })();
  const [resolvedRelativeLogoUrl, setResolvedRelativeLogoUrl] = useState<string | undefined>(undefined);
  const [logoNaturalHeight, setLogoNaturalHeight] = useState<number | null>(null);
  const handleLogoLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setLogoNaturalHeight(e.currentTarget.naturalHeight);
  }, []);
  // Resolve the logo URL synchronously during render when possible (absolute/local/http
  // paths) so the first render after canonicalLoaded already shows the logo — no title flash.
  // Only relative paths (games/, media/, img/) need the async resolution below.
  const resolvedLogoSync = useMemo(() => {
    if (!_validatedLogoSrc) return undefined;
    if (_validatedLogoSrc.startsWith("games/") || _validatedLogoSrc.startsWith("media/") || _validatedLogoSrc.startsWith("img/")) {
      return undefined;
    }
    return isLocalPath(_validatedLogoSrc) ? (localPathToUrl(_validatedLogoSrc) ?? undefined) : _validatedLogoSrc;
  }, [_validatedLogoSrc]);
  useEffect(() => {
    if (!_validatedLogoSrc || resolvedLogoSync) { setResolvedRelativeLogoUrl(undefined); return; }
    const resolveLogo = async () => {
      let resolved: string | null = _validatedLogoSrc;
      if (_validatedLogoSrc.startsWith("games/")) {
        const { resolveProviderMediaPreviewUrl } = await import("../../services/gameCacheService");
        resolved = await resolveProviderMediaPreviewUrl(_validatedLogoSrc).catch(() => _validatedLogoSrc);
      } else {
        const { resolveRelativeMediaPath } = await import("../../services/gameCacheService");
        resolved = await resolveRelativeMediaPath(game.appId ?? "", _validatedLogoSrc).catch(() => _validatedLogoSrc);
      }
      setResolvedRelativeLogoUrl(resolved ?? undefined);
    };
    resolveLogo();
  }, [_validatedLogoSrc, resolvedLogoSync, game.appId]);
  const logoUrl = resolvedLogoSync ?? resolvedRelativeLogoUrl;
  useEffect(() => { setLogoNaturalHeight(null); }, [logoUrl]);
  // Responsive logo sizing: width scales with the viewport, height stays proportional to the
  // logo's intrinsic aspect ratio once loaded. max-height caps extreme ratios.
  const logoWidth = "clamp(160px, 44vw, 540px)";
  const logoHeightFallback = "clamp(80px, 14vh, 200px)";
  const logoMaxHeight = "clamp(80px, 18vh, 240px)";
  const script = game.luaScripts[0];
  const action = getLauncherGamePrimaryAction(game);
  const { installState, dismiss } = useInstallTracker(game.appId);
  const { getJobByAppId } = useDownloadQueueContext();
  const installJob = game.appId ? getJobByAppId(game.appId) : undefined;
  const activeInstallStatuses: string[] = ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"];
  const hasActiveInstall = installJob?.type === "steam-install" && activeInstallStatuses.includes(installJob.status);
  // Subscribe to pending uninstall state changes so React re-renders when the module-level Map changes
  useSyncExternalStore(subscribePendingUninstall, getPendingUninstallVersion, getPendingUninstallVersion);
  const hasPendingUninstall = game.appId ? isPendingUninstall(game.appId) : false;
  // Subscribe to the selectable hero/background transition (Settings → Animaciones)
  useSyncExternalStore(subscribeHeroTransition, getHeroTransitionSnapshot, getHeroTransitionSnapshot);
  const heroTransition = getHeroTransitionSnapshot().id;
  // Sharp-image animation per transition: crossfade (default, soft two-layer
  // fade), focus (current blur→sharp reveal) or kenburns (continuous zoom).
  const sharpHeroClass =
    heroTransition === "kenburns"
      ? "animate-hero-kenburns-in"
      : heroTransition === "focus"
        ? "animate-hero-focus-in"
        : "animate-hero-crossfade-in";
  const effectiveAction = hasPendingUninstall
    ? "uninstalling"
    : hasActiveInstall
    ? "installing"
    : installState.status === "timeout"
      ? "timeout"
      : action;
  if (DEBUG_LAUNCH_BUTTON_RENDER) {
    console.log(`[GAME_ACTION_RENDER] appid=${game.appId} location=gamedetails uninstallPending=${hasPendingUninstall} baseAction=${action} effectiveAction=${effectiveAction} renderedPrimary=${hasPendingUninstall ? "Uninstalling" : effectiveAction === "play" ? "Play" : effectiveAction === "install" ? "Install" : effectiveAction}`);
  }

  const rawShort = game.metadata?.short_description || (localDetailsData as any)?.shortDescription;
  const rawAbout = game.metadata?.about_the_game || (localDetailsData as any)?.description;
  const rawDetailed = game.metadata?.detailed_description || (localDetailsData as any)?.description;

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
    () => uniqueLabels(game.metadata?.genres || (localDetailsData as any)?.genres || []),
    [game.id, game.metadata?.genres, (localDetailsData as any)?.genres]
  );
  const categories = useMemo(
    () => uniqueLabels(game.metadata?.categories || (localDetailsData as any)?.categories || []),
    [game.id, game.metadata?.categories, (localDetailsData as any)?.categories]
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

  // Phase 1: Audit Activity playtime (try appId first, then gameKey for manual games)
  const ptEntry = getPlaytimeEntryByAppId(game.appId) ?? getPlaytimeEntryByGameKey(resolvePlaytimeKey(game));
  const totalSeconds = ptEntry ? computeTotalPlaytime(ptEntry) : 0;
  const sourceLabel = ptEntry ? (ptEntry.playtimeSource ?? ptEntry.provider ?? "unknown") : "unknown";
  const lastPlayedFromActivity = (() => {
    // Try appId first, then gameKey
    const byAppId = getLastSessionEndForAppId(game.appId);
    if (byAppId) return byAppId;
    if (!ptEntry) return null;
    if (ptEntry.lastPlayedAt) return ptEntry.lastPlayedAt;
    if (ptEntry.sessions.length > 0) {
      const sorted = [...ptEntry.sessions].sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
      return sorted[0].endedAt ?? sorted[0].startedAt;
    }
    return null;
  })();
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
    if (userSwitchedSourceRef.current) return; // user manually chose platform — don't overwrite
    const stored = achievementStore.getSummary(appIdStr, achSource) ?? null;
    if (stored) {
      if (DEBUG_ACH_DETAILS) console.log(`[ACH][STATE_PRESERVE] appid=${appIdStr} reason=route-change unlocked=${stored.unlocked}/${stored.total}`);
    }
    setAchievementsSummary(prev => {
      if (prev?.appId === stored?.appId && prev?.source === stored?.source && prev?.unlocked === stored?.unlocked && prev?.total === stored?.total) return prev;
      return stored;
    });
  }, [appIdStr, achSource]);

  // Load achievements on mount when auto-load is enabled, or on explicit refresh
  // Safe: reads existing disk cache for current visible appId only.
  // No stats/schema scan, no migration, no cache write, no full library scan.
  const shouldAutoLoadAchievements = ACHIEVEMENT_AUTO_LOAD_GAME_DETAILS;
  const ACHIEVEMENT_READ_EXISTING_CACHE_FOR_VISIBLE_APP = true;
  const diskCacheRef = useRef<{ updatedAt: number } | null>(null);
  useEffect(() => {
    if (!appIdStr) return;
    if (userSwitchedSourceRef.current) return; // user manually chose platform — don't overwrite
    if (!shouldAutoLoadAchievements) {
      let cancelled = false;
      // 1. Check in-memory store first
      const stored = achievementStore.getSummary(appIdStr, achSource);
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
              readAchievementCache(appIdNum, achSource).then((diskCache) => {
                if (cancelled) return;
                const diskUpdatedAt = diskCache?.summary?.updated_at ?? 0;
                const storeUpdatedAt = achievementStore.getSummary(appIdStr, achSource)?.updatedAt ?? 0;
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
                achievementStore.setSummary(appIdStr, summary, achSource);
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
                    gameSource: game.source,
                    platform: achSource,
                  }).then((resolved) => {
                    if (cancelled || !resolved.progressAvailable) {
                      if (!cancelled && appIdStr === "1167630" && !resolved.progressAvailable) console.log(`[ACH][UI_UNAVAILABLE_REASON] appid=1167630 reason=resolver-also-schema-only source=${resolved.source}`);
                      return;
                    }
          const stored = achievementStore.getSummary(appIdStr, achSource);
                    if (stored && !isSourceNewerOrEqual(resolved.source, resolved.updatedAt, stored.source, stored.updatedAt)) return;
                    achievementStore.setSummary(appIdStr, resolved, achSource);
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
      gameSource: game.source,
      platform: achSource,
    })
      .then((summary) => {
        if (!cancelled) {
          if (userSwitchedSourceRef.current) return; // user already switched — this resolve is stale
          // Only update local state if resolver result is fresher than store
          const stored = achievementStore.getSummary(appIdStr, achSource);
          if (stored && stored.source !== summary.source) {
            if (!isSourceNewerOrEqual(summary.source, summary.updatedAt, stored.source, stored.updatedAt)) {
              console.debug(`[ACH][DETAILS] skip-set-from-resolver reason=store-newer source=${stored.source} updatedAt=${stored.updatedAt}`);
              setAchievementsLoading(false);
              return;
            }
          }
          achievementStore.deleteSummary(appIdStr, achSource);
          setAchievementsSummary(summary);
          achievementStore.setSummary(appIdStr, summary, achSource);
          setAchievementsLoading(false);
          // Enqueue image downloads for this game (fire-and-forget)
          import("../../services/backgroundJobQueue").then(({ enqueueAchievementImageJobs }) => {
            enqueueAchievementImageJobs([appIdStr], "normal");
          }).catch(() => {});
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
      achievementStore.setSummary(event.appId, event.summary, achSource);
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
    if (userSwitchedSourceRef.current) return;
    achievementStore.setSummary(appIdStr, patched, achSource);
    setAchievementsSummary(patched);
  }, [appIdStr, achievementsSummary, achSource]);

  // Store: subscribe to central store for fast patches from watcher
  useEffect(() => {
    const unsub = achievementStore.subscribe((appId, summary, subPlatform) => {
      if (appId !== appIdStr) return;
      if (subPlatform && subPlatform !== achSource) return; // platform filter already guards cross-platform
      setAchievementsSummary(summary);
    });
    return unsub;
  }, [appIdStr, achSource]);

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
      platform: achSource,
    });
    return () => {
      achievementAutoSyncService.stopWatching(appIdStr);
    };
  }, [appIdStr, achSource, settings.achievementAutoSyncEnabled, settings.achievementAutoSyncIntervalSeconds,
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
        const remainingUnlocks = events.slice(maxShow);
        showGroupedAchievementToast(remainingUnlocks, appIdStr ?? undefined, detailTitle);
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
        <div className="relative aspect-[21/9] min-h-[340px] max-h-[520px] overflow-hidden bg-black">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-black/40" />
        </div>
        <div className="relative z-10 shrink-0 bg-linear-to-b from-white/[0.03] to-transparent">
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
  if (DEBUG_HERO_LAYERS) {
    console.log(`[HERO_LAYERS] appid=${game.appId} source=${game.source} canonicalLoaded=${canonicalLoaded} imageUrl=${imageUrl ? "set" : "null"} loadedHeroUrl=${loadedHeroUrl ? "set" : "null"} placeholderUrl=${placeholderUrl ? "set" : "null"} heroImgError=${heroImgError} backdropLayers=${backdropLayers.length}`);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Hero banner — Steam-style header */}
      <div className="relative aspect-[21/9] min-h-[340px] max-h-[520px] w-full shrink-0 overflow-hidden bg-black">
        {/* Layer 1 — Steam-style colorful blurred backdrop */}
        {/* brightness-0.65 keeps colors visible so blur visually connects to main image;
            object-position: center ensures the same crop region as the sharp image.
            animate-hero-entrance replays on every game switch (component remounts
            via key=source:appId), so all sources get a visible background fade-in. */}
        <div className="absolute inset-0 animate-hero-entrance overflow-hidden brightness-[0.65] saturate-[1.1]">
          {backdropLayers.length > 0 ? (
            backdropLayers.map((src, i) => (
              <img
                key={`b-${src}`}
                src={src}
                alt=""
                onError={() => setBackdropLayers((prev) => prev.filter((s) => s !== src))}
                className={`absolute inset-0 h-full w-full scale-105 object-cover blur-2xl transition-opacity duration-500 ${i === backdropLayers.length - 1 ? "opacity-100 animate-hero-blur-in" : "opacity-0"}`}
              />
            ))
          ) : (
            <div className="h-full w-full bg-gradient-to-b from-white/[0.03] to-black/40" />
          )}
        </div>

        {/* Layer 2 — Main sharp image centered, with graduated side fade */}
        {/* 0-4% transparent buffer → 4-12% linear fade-in → 12-88% full opacity → 88-96% fade-out → 96-100% transparent.
            Wider 8% transition zone creates a smooth, invisible seam with the blurred backdrop. */}
        <div className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
          {imageUrl && !heroImgError ? (
            <img
              key={imageUrl}
              src={imageUrl}
              alt={detailTitle}
              onError={() => { if (!loadedHeroUrl) setHeroImgError(true); }}
              onLoad={() => setLoadedHeroUrl(imageUrl)}
              className={`block h-full w-auto max-w-none shrink-0 ${imageUrl === loadedHeroUrl ? `opacity-100 ${sharpHeroClass}` : "opacity-0"} [mask-image:linear-gradient(to_right,transparent_0%,transparent_4%,black_12%,black_88%,transparent_96%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,transparent_4%,black_12%,black_88%,transparent_96%,transparent_100%)]`}
            />
          ) : (
            <div className="h-full w-full" />
          )}
        </div>

        {/* Layer 3 — Gentle side vignette + bottom gradient */}
        {/* Light enough that the colorful blur still shows through */}
        <div className="absolute inset-y-0 left-0 z-20 w-[clamp(40px,5vw,100px)] bg-linear-to-r from-black/10 to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 z-20 w-[clamp(40px,5vw,100px)] bg-linear-to-l from-black/10 to-transparent pointer-events-none" />
        {/* Bottom: readability gradient with minimal darkening */}
        <div className="absolute inset-x-0 bottom-0 z-20 h-[clamp(80px,15vh,180px)] bg-linear-to-t from-black/60 via-black/5 to-transparent pointer-events-none" />

        {/* Bottom content: logo + title */}
        {canonicalLoaded && (
        <div className="absolute bottom-0 left-0 right-0 z-30">
          <div className="mx-auto w-full max-w-[1440px] px-5 pb-4 lg:pb-5">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${detailTitle} logo`}
                loading="eager"
                decoding="async"
                onLoad={handleLogoLoad}
                className="mb-2 object-contain drop-shadow-2xl"
                style={{
                  width: logoWidth,
                  height: logoNaturalHeight != null ? "auto" : logoHeightFallback,
                  maxHeight: logoMaxHeight,
                }}
              />
            ) : rawLogoUrl ? (
              <div className="mb-2" aria-hidden="true" style={{ width: logoWidth, height: logoHeightFallback }} />
            ) : (
              <h1 className="line-clamp-1 text-xl font-black text-white drop-shadow-sm lg:text-2xl">
                {detailTitle}
              </h1>
            )}

            {(game.metadata?.developer || (localDetailsData as any)?.developer) && (
              <p className="mt-0.5 text-sm text-white/70">
                {(localDetailsData as any)?.developer || game.metadata?.developer}
              </p>
            )}
            {game.source === "debrid" && game.repacker && (
              <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-400 ring-1 ring-cyan-500/25">
                {game.repacker.toUpperCase()}
              </span>
            )}
            {(() => {
              const srcBadge = game.hasLua
                ? { label: "LUA", cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25" }
                : game.source === "epic"
                  ? { label: "EPIC", cls: "bg-purple-500/15 text-purple-400 ring-purple-500/25" }
                  : game.source === "debrid"
                    ? { label: "DEBRID", cls: "bg-cyan-500/15 text-cyan-400 ring-cyan-500/25" }
                    : game.source === "manual"
                      ? { label: "MANUAL", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/25" }
                      : game.source === "steam"
                        ? { label: "STEAM", cls: "bg-blue-500/15 text-blue-400 ring-blue-500/25" }
                        : null;
              if (!srcBadge) return null;
              return (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${srcBadge.cls}`}>
                  {srcBadge.label}
                </span>
              );
            })()}
          </div>
        </div>
        )}
      </div>
      <div className="relative z-10 shrink-0 bg-linear-to-b from-white/[0.03] to-transparent">
        <div className="mx-auto w-full max-w-[1440px] px-5 py-3">
          <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Play / Install button */}
            <div className="shrink-0">
              {effectiveAction === "play" && !hasActiveInstall && installState.status !== "timeout" && (
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
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
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
                          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) opacity-60 transition"
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
              {hasActiveInstall ? (
                <div className="flex flex-col gap-2 rounded-xl bg-amber-500/10 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-amber-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {installJob.message || (
                        installJob.status === "waiting" || installJob.status === "queued"
                          ? "Waiting for Steam…"
                          : installJob.status === "downloading"
                            ? `Downloading ${installJob.progress}%`
                            : installJob.status === "extracting" || installJob.status === "installing"
                              ? "Installing…"
                              : installJob.status === "checking"
                                ? "Checking…"
                                : installJob.status === "paused"
                                  ? "Paused"
                                  : "Installing…"
                      )}
                    </div>
                    <span className="text-[11px] text-amber-400/50">
                      {/* elapsed time not available from DownloadJob — tracker hook still provides it */}
                      {installState.elapsedMs > 0 ? `${Math.floor(installState.elapsedMs / 1000)}s` : ""}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    {installJob.progressMode === "determinate" && installJob.progress > 0 ? (
                      <div
                        className="h-full rounded-full bg-amber-400 transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, installJob.progress)}%` }}
                      />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-400/50" />
                    )}
                  </div>
                  {installJob.bytesRead !== undefined && installJob.totalBytes !== undefined && installJob.totalBytes > 0 && (
                    <div className="text-[11px] text-amber-400/40">
                      {formatBytes(installJob.bytesRead)} / {formatBytes(installJob.totalBytes)}
                    </div>
                  )}
                </div>
              ) : installState.status === "timeout" ? (
                <div className="inline-flex items-center gap-2">
                  <span className="text-sm text-amber-400/70">Install taking longer than expected?</span>
                  <button
                    type="button"
                    onClick={() => onInstall(game)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97]"
                  >
                    <Download className="h-4 w-4" />
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-(--color-muted) transition hover:bg-white/5"
                  >
                    <X className="h-4 w-4" />
                    Dismiss
                  </button>
                </div>
              ) : hasPendingUninstall ? (
                <div className="inline-flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 px-5 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">Uninstalling…</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!game.appId) return;
                      console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel before=${isPendingUninstall(game.appId)}`);
                      clearPendingUninstall(game.appId);
                      showInfo(`"${game.title ?? game.appId}" uninstall tracking cancelled.`);
                      console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel after=${isPendingUninstall(game.appId)}`);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/5"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel tracking
                  </button>
                </div>
              ) : (
                <>
                  {action === "install" && (
                    <button
                      type="button"
                      onClick={() => onInstall(game)}
className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                    >
                      <Download className="h-4 w-4" />
                      Install
                    </button>
                  )}
                  {action === "open-steam" && (
                    <button
                      type="button"
                      onClick={() => onOpenSteam?.(game)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
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
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
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
                  {action === "installing" && (
                    <span className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-(--color-muted)/50">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Installing
                    </span>
                  )}
                  {action === "select-exe" && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const selected = await open({
                            title: "Select game executable",
                            filters: [{ name: "Executables", extensions: ["exe", "com", "bat"] }],
                            defaultPath: game.installDir || "C:\\",
                            multiple: false,
                          });
                          if (selected && game.providerGameId) {
                            updateDebridGame(game.providerGameId, game.installDir || "", selected);
                            toast.success("Game executable set. Ready to play!");
                          }
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : String(err);
                          toast.error(`File picker failed: ${msg}`);
                        }
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-sm font-bold text-(--color-accent-text) transition hover:bg-(--color-accent)/80 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-(--color-accent)/50"
                    >
                      <FileSearch className="h-4 w-4" />
                      Select Executable
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Inline stats */}
            <div className="flex min-w-0 flex-1 animate-stats-in flex-wrap items-center gap-x-4 gap-y-1">
              {/*    */}
              <StatInline icon={<CalendarClock  className="h-5 w-5" />} label="Last Played" value={lastPlayed} />
              <StatInline icon={<ClockFading className="h-5 w-5" />} label="Play Time" value={playTimeDisplay} />
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
                    <div className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-xl border border-(--surface-active-border) lf-surface p-1 shadow-lg">
                      {hasPendingUninstall ? (
                        <DropdownItem
                          label="Cancel tracking"
                          onClick={() => {
                            setShowActions(false);
                            if (!game.appId) return;
                            console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel before=${isPendingUninstall(game.appId)} source=gamedetails-actions`);
                            clearPendingUninstall(game.appId);
                            showInfo(`"${game.title ?? game.appId}" uninstall tracking cancelled.`);
                            console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel after=${isPendingUninstall(game.appId)} source=gamedetails-actions`);
                          }}
                        />
                      ) : game.source === "debrid" ? (
                        <DropdownItem
                          label="Remove from Library"
                          destructive
                          onClick={() => {
                            setShowActions(false);
                            const providerGameId = game.providerGameId;
                            if (providerGameId) {
                              removeDebridGameFromLibrary(providerGameId);
                              showSuccess(`"${game.title ?? providerGameId}" removed from library. Files on disk are kept.`);
                            } else {
                              showError("Could not remove this game from the library.");
                            }
                          }}
                        />
                      ) : game.steamInstalled && game.source !== "epic" ? (
                        <DropdownItem
                          label="Uninstall in Steam"
                          onClick={async () => {
                            setShowActions(false);
                            const appIdStr = String(game.appId);
                            const appIdNum = Number(game.appId);
                            markPendingUninstall(appIdStr);
                            console.log(`[UNINSTALL_PENDING] appid=${appIdStr} phase=start source=gamedetails-actions`);
                            showInfo("Steam uninstall opened. Complete uninstall in Steam. LumaForge will update automatically.", { title: "Uninstall" });
                            try {
                              console.log(`[STEAM_UNINSTALL_OPEN] appid=${appIdNum} source=gamedetails-actions`);
                              await uninstallSteamApp(appIdNum);
                              console.log(`[STEAM_UNINSTALL_OPEN] appid=${appIdNum} result=ok source=gamedetails-actions`);
                            } catch (e1) {
                              console.log(`[STEAM_UNINSTALL_OPEN] appid=${appIdNum} result=error error=${e1} source=gamedetails-actions`);
                              try {
                                console.log(`[STEAM_UNINSTALL_FALLBACK] appid=${appIdNum} attempt=2 source=gamedetails-actions`);
                                await openSteamStoreApp(appIdNum);
                              } catch (e2) {
                                console.log(`[STEAM_UNINSTALL_FALLBACK] appid=${appIdNum} uri=${getSteamStoreUrl(appIdNum)} attempt=3 source=gamedetails-actions`);
                                await openExternalUrl(getSteamStoreUrl(appIdNum));
                              }
                            }
                          }}
                        />
                      ) : null}
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
                      {game.source === "manual" && (
                        <DropdownItem
                          label="Remove from Library"
                          destructive
                          disabled={isManualRunning}
                          subtitle={isManualRunning ? "Stop the game first" : undefined}
                          onClick={() => {
                            if (isManualRunning) return;
                            setShowActions(false);
                            const rawId = normalizeManualGameId(game.providerGameId || game.id || "");
                            if (rawId && window.confirm(`Remove "${game.title}" from your library?`)) {
                              if (DEBUG_MANUAL_REMOVE) console.log(`[MANUAL_REMOVE][DETAILS] rawId=${rawId} title="${game.title}"`);
                              removeManualGame(rawId);
                              showInfo(`"${game.title ?? rawId}" removed from library`);
                              onBack();
                            }
                          }}
                        />
                      )}
                      <DropdownItem
                        label="Edit Game Details"
                        onClick={() => {
                          setShowActions(false);
                          setEditDialogTab("general");
                          setEditDialogOpen(true);
                        }}
                      />
                      <DropdownItem
                        label={game.source === "epic" || (game.source === "manual" && !game.appId) ? "Manage Artwork" : "Refresh Artwork"}
                        onClick={() => {
                          setShowActions(false);
                          if (game.source === "epic" || (game.source === "manual" && !game.appId)) {
                            setEditDialogTab("media");
                            setEditDialogOpen(true);
                          } else {
                            onRefreshArtwork?.();
                          }
                        }}
                      />
                      {onOpenTools && (
                        <DropdownItem
                          label="Game Fixes"
                          onClick={() => {
                            setShowActions(false);
                            onOpenTools(game);
                          }}
                        />
                      )}
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
                onClick={() => { toggleFavorite(favoriteId); }}
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

              {/* About This Game (only if longer than short intro, hidden for manual games without appId) */}
              {(!isManualGame || !!appIdStr) && longDescText && !descriptionsMatch && (
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

              {/* Updates — Steam news only (hidden for manual without appId and epic games) */}
              {(!isManualGame || !!appIdStr) && !isEpicGame && (
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
              )}


            </div>

            {/* Right: Side panel */}
            <aside className="mt-8 lg:mt-0">
              {(!isManualGame || linkedSteamAppId || !!appIdStr) && (!isEpicGame || linkedSteamAppId) && (
              <div className="sticky top-4 space-y-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                  {isManualGame ? "Steam Links" : "Links"}
                </h3>
                <div className="space-y-1">
                  {isManualGame && linkedSteamAppId ? (
                    <>
                      <ShortcutRow
                        icon={<ExternalLink className="h-3.5 w-3.5" />}
                        label="Steam Store Page"
                        enabled={!!linkedSteamAppId}
                        onClick={() => {
                          if (linkedSteamAppId) openExternalUrl(getSteamStoreUrl(Number(linkedSteamAppId)));
                        }}
                      />
                      <ShortcutRow
                        icon={<Database className="h-3.5 w-3.5" />}
                        label="SteamDB"
                        enabled={!!linkedSteamAppId}
                        onClick={() => {
                          if (linkedSteamAppId) openExternalUrl(getSteamDbUrl(Number(linkedSteamAppId)));
                        }}
                      />
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </div>
              )}

              {/* Achievements — hidden for manual without appId and epic games */}
              {(!isManualGame || !!appIdStr) && !isEpicGame && (
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

                    {/* Source selector + refresh — only shown when crack save exists */}
                    {hasCrackSave && (
                    <div className="flex items-center gap-2">
                      <select
                        value={achSource}
                        onChange={(e) => { const v = e.target.value as "steam-official" | "steam"; if (appIdStr) { localStorage.setItem(`lumaforge-ach-platform-${appIdStr}`, v); console.log(`[ACH][PLATFORM_SELECT] appid=${appIdStr} selected=${v}`); } setAchSource(v); }}
                        className="rounded-lg border border-(--surface-active-border) bg-(--color-surface)/50 px-2 py-1 text-[10px] text-(--color-text) backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-(--color-accent)/50"
                      >
                        <option value="steam-official">Steam Official</option>
                        <option value="steam">Crack Save (RUNE/GSE/OnlineFix)</option>
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          const { resolveSteamAchievements } = await import("../../services/steamAchievementsResolver");
                          if (!appIdStr) return;
                          setAchievementsLoading(true);
                          try {
                            achievementStore.deleteSummary(appIdStr, achSource);
                            const { deleteAchievementCache } = await import("../../services/tauri");
                            const appIdNum = Number(appIdStr);
                            if (Number.isFinite(appIdNum)) {
                              await deleteAchievementCache(appIdNum, achSource).catch(() => {});
                            }
                            const gameSource = achSource === "steam" ? "debrid" : "steam";
                            const s = await resolveSteamAchievements({
                              appId: appIdStr,
                              steamWebApiKey: settings.steamWebApiKey || undefined,
                              steamId64: settings.steamId64 || undefined,
                              accountId: settings.steamAccountId || undefined,
                              steamPath: settings.steamRoot || undefined,
                              forceRefresh: true,
                              steamAchievementsEnabled: settings.steamAchievementsEnabled,
                              achievementSchemaPath: settings.achievementSchemaPath || undefined,
                              gameSource,
                              platform: achSource,
                            });
                            if (appIdStr) {
                              setAchievementsSummary(s);
                              achievementStore.setSummary(appIdStr, s, achSource);
                              const { notifyMediaUpdated } = await import("../../services/startupSnapshotService");
                              notifyMediaUpdated(appIdStr, { source: "achievement-refresh" }).catch(() => {});
                            }
                          } catch (err) {
                            console.warn(`[ACH][REFRESH] failed appid=${appIdStr} reason=${err}`);
                          } finally {
                            setAchievementsLoading(false);
                          }
                        }}
                        className="cursor-pointer rounded-lg border border-(--surface-active-border) bg-white/5 px-2 py-1 text-[10px] text-(--color-muted) transition hover:bg-white/10"
                        title="Refresh from selected source"
                      >
                        {achievementsLoading ? "..." : "↻"}
                      </button>
                    </div>
                    )}

                    {/* Progress bar */}
                    <AchievementProgressBar
                      unlocked={effectiveUnlocked}
                      total={effectiveTotal}
                      isPerfected={isPerfected}
                      syncing={achievementsSyncing}
                    />
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
                    {/* Source selector — only shown when crack save exists */}
                    {hasCrackSave && (
                    <div className="flex items-center gap-2">
                      <select
                        value={achSource}
                        onChange={(e) => { const v = e.target.value as "steam-official" | "steam"; if (appIdStr) { localStorage.setItem(`lumaforge-ach-platform-${appIdStr}`, v); console.log(`[ACH][PLATFORM_SELECT] appid=${appIdStr} selected=${v}`); } setAchSource(v); }}
                        className="rounded-lg border border-(--surface-active-border) bg-(--color-surface)/50 px-2 py-1 text-[10px] text-(--color-text) backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-(--color-accent)/50"
                      >
                        <option value="steam-official">Steam Official</option>
                        <option value="steam">Crack Save (RUNE/GSE/OnlineFix)</option>
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          const { resolveSteamAchievements } = await import("../../services/steamAchievementsResolver");
                          if (!appIdStr) return;
                          setAchievementsLoading(true);
                          try {
                            achievementStore.deleteSummary(appIdStr, achSource);
                            const { deleteAchievementCache } = await import("../../services/tauri");
                            const appIdNum = Number(appIdStr);
                            if (Number.isFinite(appIdNum)) {
                              await deleteAchievementCache(appIdNum, achSource).catch(() => {});
                            }
                            const gameSource = achSource === "steam" ? "debrid" : "steam";
                            const s = await resolveSteamAchievements({
                              appId: appIdStr,
                              steamWebApiKey: settings.steamWebApiKey || undefined,
                              steamId64: settings.steamId64 || undefined,
                              accountId: settings.steamAccountId || undefined,
                              steamPath: settings.steamRoot || undefined,
                              forceRefresh: true,
                              steamAchievementsEnabled: settings.steamAchievementsEnabled,
                              achievementSchemaPath: settings.achievementSchemaPath || undefined,
                              gameSource,
                              platform: achSource,
                            });
                            if (appIdStr) {
                              setAchievementsSummary(s);
                              achievementStore.setSummary(appIdStr, s, achSource);
                              const { notifyMediaUpdated } = await import("../../services/startupSnapshotService");
                              notifyMediaUpdated(appIdStr, { source: "achievement-refresh" }).catch(() => {});
                            }
                          } catch (err) {
                            console.warn(`[ACH][REFRESH] failed appid=${appIdStr} reason=${err}`);
                          } finally {
                            setAchievementsLoading(false);
                          }
                        }}
                        className="cursor-pointer rounded-lg border border-(--surface-active-border) bg-white/5 px-2 py-1 text-[10px] text-(--color-muted) transition hover:bg-white/10"
                        title="Refresh from selected source"
                      >
                        {achievementsLoading ? "..." : "↻"}
                      </button>
                    </div>
                    )}

                    <p className="text-xs text-(--color-muted)">
                      Achievement list available. Progress unavailable for this source.
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
                  <div className="mt-3 space-y-3">
                    {/* Source selector — only shown when crack save exists */}
                    {hasCrackSave && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-medium text-(--color-muted) uppercase tracking-wider">Source:</label>
                      <select
                        value={achSource}
                        onChange={(e) => { const v = e.target.value as "steam-official" | "steam"; if (appIdStr) { localStorage.setItem(`lumaforge-ach-platform-${appIdStr}`, v); console.log(`[ACH][PLATFORM_SELECT] appid=${appIdStr} selected=${v}`); } setAchSource(v); }}
                        className="rounded-lg border border-(--surface-active-border) bg-(--color-surface)/50 px-2 py-1 text-xs text-(--color-text) backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-(--color-accent)/50"
                      >
                        <option value="steam-official">Steam Official (appcache/stats)</option>
                        <option value="steam">Crack Save (RUNE/GSE/OnlineFix)</option>
                      </select>
                    </div>
                    )}
                    <p className="text-xs text-(--color-muted)">
                      {achSource === "steam"
                        ? "No achievement data found in crack save directory."
                        : "Achievement tracking requires Steam Web API setup."}
                    </p>
                    <p className="text-[10px] text-(--color-muted)/60">
                      {achSource === "steam"
                        ? "Try Manual Refresh to read from crack save (achievements.ini)."
                        : "Configure in Settings or switch to Crack Save source."}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const { resolveSteamAchievements } = await import("../../services/steamAchievementsResolver");
                          if (!appIdStr) return;
                          setAchievementsLoading(true);
                          try {
                            achievementStore.deleteSummary(appIdStr, achSource);
                            const { deleteAchievementCache } = await import("../../services/tauri");
                            const appIdNum = Number(appIdStr);
                            if (Number.isFinite(appIdNum)) {
                              await deleteAchievementCache(appIdNum, achSource).catch(() => {});
                            }
                            const gameSource = achSource === "steam" ? "debrid" : "steam";
                            const s = await resolveSteamAchievements({
                              appId: appIdStr,
                              steamWebApiKey: settings.steamWebApiKey || undefined,
                              steamId64: settings.steamId64 || undefined,
                              accountId: settings.steamAccountId || undefined,
                              steamPath: settings.steamRoot || undefined,
                              forceRefresh: true,
                              steamAchievementsEnabled: settings.steamAchievementsEnabled,
                              achievementSchemaPath: settings.achievementSchemaPath || undefined,
                              gameSource,
                              platform: achSource,
                            });
                            if (appIdStr) {
                              setAchievementsSummary(s);
                              achievementStore.setSummary(appIdStr, s, achSource);
                              const unlocked = s.achievements.filter((a: any) => a.unlocked).length;
                              console.log(`[ACH][MANUAL_REFRESH_DONE] appid=${appIdStr} source=${achSource} count=${s.achievements.length} unlocked=${unlocked}/${s.total}`);
                              const { notifyMediaUpdated } = await import("../../services/startupSnapshotService");
                              notifyMediaUpdated(appIdStr, { source: "achievement-refresh" }).catch(() => {});
                            }
                          } catch (err) {
                            console.warn(`[ACH][REFRESH] failed appid=${appIdStr} reason=${err}`);
                            toast.error("Failed to refresh achievements");
                          } finally {
                            setAchievementsLoading(false);
                          }
                        }}
                        className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-white/10"
                      >
                        {achievementsLoading ? "Loading..." : "Refresh Achievements"}
                      </button>
                      {achSource === "steam-official" && (
                        <button
                          type="button"
                          onClick={() => onNavigate?.("settings")}
                          className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-muted) transition hover:bg-white/10"
                        >
                          Settings
                        </button>
                      )}
                    </div>
                  </div>
                ) : (game.achievementsSupported || localAchSupportFound) ? (
                  <div className="mt-3 space-y-3">
                    {/* Source selector — only shown when crack save exists */}
                    {hasCrackSave && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-medium text-(--color-muted) uppercase tracking-wider">Source:</label>
                      <select
                        value={achSource}
                        onChange={(e) => { const v = e.target.value as "steam-official" | "steam"; if (appIdStr) { localStorage.setItem(`lumaforge-ach-platform-${appIdStr}`, v); console.log(`[ACH][PLATFORM_SELECT] appid=${appIdStr} selected=${v}`); } setAchSource(v); }}
                        className="rounded-lg border border-(--surface-active-border) bg-(--color-surface)/50 px-2 py-1 text-xs text-(--color-text) backdrop-blur-sm focus:outline-none focus:ring-1 focus:ring-(--color-accent)/50"
                      >
                        <option value="steam-official">Steam Official (appcache/stats)</option>
                        <option value="steam">Crack Save (RUNE/GSE/OnlineFix)</option>
                      </select>
                    </div>
                    )}
                    <p className="text-xs text-(--color-muted)">
                      Achievements not loaded for this source.
                    </p>
                    <p className="text-[10px] text-(--color-muted)/60">
                      {achSource === "steam"
                        ? "Reading from crack save directory (achievements.ini)."
                        : "Reading from Steam appcache/stats binary files."}
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        const { resolveSteamAchievements } = await import("../../services/steamAchievementsResolver");
                        if (!appIdStr) return;
                        setAchievementsLoading(true);
                        try {
                          // CRITICAL: delete ALL cache layers BEFORE resolving.
                          achievementStore.deleteSummary(appIdStr, achSource);
                          const { deleteAchievementCache } = await import("../../services/tauri");
                          const appIdNum = Number(appIdStr);
                          if (Number.isFinite(appIdNum)) {
                            await deleteAchievementCache(appIdNum, achSource).catch(() => {});
                          }
                          try {
                            const { getCachedSnapshot, notifyMediaUpdated } = await import("../../services/startupSnapshotService");
                            const snap = getCachedSnapshot();
                            if (snap?.library?.games) {
                              const g = snap.library.games.find((sg: any) => sg.appId === appIdStr);
                              if (g?.achievementSummary) {
                                g.achievementSummary = undefined;
                                notifyMediaUpdated(appIdStr, { source: "achievement-refresh-clear" }).catch(() => {});
                              }
                            }
                          } catch { /* non-critical */ }
                          // Pass gameSource based on selected source
                          const gameSource = achSource === "steam" ? "debrid" : "steam";
                          const s = await resolveSteamAchievements({
                            appId: appIdStr,
                            steamWebApiKey: settings.steamWebApiKey || undefined,
                            steamId64: settings.steamId64 || undefined,
                            accountId: settings.steamAccountId || undefined,
                            steamPath: settings.steamRoot || undefined,
                            forceRefresh: true,
                            steamAchievementsEnabled: settings.steamAchievementsEnabled,
                            achievementSchemaPath: settings.achievementSchemaPath || undefined,
                            gameSource,
                            platform: achSource,
                          });
                          if (appIdStr) {
                            setAchievementsSummary(s);
                            achievementStore.setSummary(appIdStr, s, achSource);
                            const unlocked = s.achievements.filter((a: any) => a.unlocked).length;
                            console.log(`[ACH][MANUAL_REFRESH_DONE] appid=${appIdStr} source=${achSource} count=${s.achievements.length} unlocked=${unlocked}/${s.total}`);
                            const { notifyMediaUpdated } = await import("../../services/startupSnapshotService");
                            notifyMediaUpdated(appIdStr, { source: "achievement-refresh" }).catch(() => {});
                          }
                        } catch (err) {
                          console.warn(`[ACH][REFRESH] failed appid=${appIdStr} reason=${err}`);
                          toast.error("Failed to refresh achievements");
                        } finally {
                          setAchievementsLoading(false);
                        }
                      }}
                      className="cursor-pointer rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-accent) transition hover:bg-white/10"
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
              )}

              {/* Release Date */}
              <div className="mt-4 rounded-2xl border border-(--surface-active-border) bg-white/[0.02] p-4">
                <h3 className="text-xs font-bold text-(--color-muted) uppercase tracking-wider">
                  <Calendar className="mr-1.5 inline h-3.5 w-3.5" />
                  Release Date
                </h3>
                <p className="mt-1 text-sm text-(--color-text)">
                  {game.metadata?.release_date || (localDetailsData as any)?.releaseDate || "Unknown"}
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
      {showAchievementsModal && achievementsSummary && (achievementsSummary.total > 0 || achievementsSummary.progressAvailable === true) && (
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

            const handleResult = (s: GameAchievementsSummary) => {
              console.debug(`[ACH][REFRESH] next source=${s.source} progressAvailable=${s.progressAvailable} unlocked=${s.unlocked}`);
              const downgrade = previousSummary?.progressAvailable === true && s.progressAvailable === false && (s.source === "schema-only" || s.source === "global-percentages");
              console.debug(`[ACH][REFRESH] downgradeDetected=${!!downgrade}`);
              if (downgrade && previousSummary) {
                console.debug(`[ACH][REFRESH] preservingPreviousProgress=true — merging schema metadata with previous progress`);
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
                if (appIdStr) achievementStore.setSummary(appIdStr, staleSummary, achSource);
                toast("Showing last known achievement progress.", { duration: 4000, icon: "🔄" });
              } else {
                setAchievementsSummary(s);
                if (appIdStr) achievementStore.setSummary(appIdStr, s, achSource);
              }
              if (appIdStr) {
                const summary = achievementStore.getSummary(appIdStr, achSource);
                console.log(`[ACH][MANUAL_REFRESH_DONE] appid=${appIdStr} count=${summary?.achievements?.length ?? 0} summary=${summary?.unlocked}/${summary?.total}`);
                console.log(`[ACH][SUMMARY_PERSISTED] appid=${appIdStr} unlocked=${summary?.unlocked}/${summary?.total}`);
              }
              console.debug(`[ACH][REFRESH] done`);
              setAchievementsRefreshing(false);
            };

            const handleError = (err: unknown) => {
              console.warn(`[ACH][REFRESH] failed keeping previous summary reason=${err}`);
              setAchievementsRefreshing(false);
              toast.error("Failed to refresh achievements", { duration: 3000 });
            };

            // CRITICAL: delete existing store entry BEFORE resolving, mirroring the
            // panel button (L2334). resolveSteamAchievements has a post-call
            // store-freshness check (~L1248) that returns store data when it has
            // higher source priority. Without this delete, a "librarycache" entry
            // would cause the resolver to return the stale stored summary — the UI
            // would show old progress until restart (fresh data is only on disk).
            achievementStore.deleteSummary(appIdStr!, achSource);
            resolveSteamAchievements({
              appId: appIdStr!,
              steamWebApiKey: settings.steamWebApiKey || undefined,
              steamId64: settings.steamId64 || undefined,
              accountId: settings.steamAccountId || undefined,
              steamPath: settings.steamRoot || undefined,
              forceRefresh: true,
              steamAchievementsEnabled: settings.steamAchievementsEnabled,
              achievementSchemaPath: settings.achievementSchemaPath || undefined,
              platform: achSource,
            }).then(handleResult).catch(handleError);
          }}
          refreshing={achievementsRefreshing}
        />
      )}

      {(game.appId || game.source === "manual" || game.source === "epic" || game.source === "debrid") && (
        <GameEditDialog
          appId={game.source === "steam" || game.source === "lua" ? game.appId : undefined}
          manualGameId={game.source === "manual" ? game.providerGameId : undefined}
          epicProviderGameId={game.source === "epic" ? game.providerGameId : undefined}
          debridProviderGameId={game.source === "debrid" ? game.providerGameId : undefined}
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          initialTab={editDialogTab}
          game={game}
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
  destructive,
  onClick,
}: {
  label: string;
  subtitle?: string;
  disabled?: boolean;
  destructive?: boolean;
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
          : destructive
            ? "cursor-pointer text-rose-400 hover:bg-rose-400/10"
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

/**
 * Achievements progress bar. Grows from 0 to its current width on mount
 * (page-entry / game-switch animation) via `useGrowOnMount`, keeping the
 * existing `transition-all duration-500` on the fill.
 */
function AchievementProgressBar({
  unlocked,
  total,
  isPerfected,
  syncing,
}: {
  unlocked: number;
  total: number;
  isPerfected: boolean;
  syncing: boolean;
}) {
  const grow = useGrowOnMount();
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className={`font-medium ${isPerfected ? "text-amber-400" : "text-(--color-text)"}`}>
          {unlocked} / {total}
        </span>
        <span className={isPerfected ? "text-amber-400/80" : "text-(--color-muted)"}>
          {percent}%
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
            width: `${grow ? percent : 0}%`,
            boxShadow: isPerfected ? "0 0 10px rgba(251,191,36,0.4)" : undefined,
          }}
        />
      </div>
      <p className={`mt-1 text-[10px] ${isPerfected ? "text-amber-400/50" : "text-(--color-muted)/60"}`}>
        {isPerfected
          ? "All achievements unlocked"
          : `${percent}% complete`}
        {syncing && (
          <span className="ml-2 italic">Syncing...</span>
        )}
      </p>
    </div>
  );
}
