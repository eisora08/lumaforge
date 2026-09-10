import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gamepad2,
  Heart,
  Loader2,
  Play,
  Plus,
  Search,
  Settings,
  X,
  XCircle,
  Pencil,
  Image,
  Trash2,
  Wrench,
  ChevronDown,
  Scan,
  Check,
  Circle,
  Filter,
  ArrowUpDown,
  Star,
  ListPlus,
} from "lucide-react";
import { countRender } from "../../services/perfCounters";

import {
  batchLoadGameMedia,
  resolveSidebarMedia,
  isSidebarInstalledGame,
  dedupeLibraryGames,
  getSidebarLabel,
  hasActiveInstalledLuaScript,
  resolveProviderMediaPreviewUrl,
} from "../../services/gameCacheService";

import { invoke } from "@tauri-apps/api/core";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import { usePlayQueue } from "../../context/PlayQueueContext";
import { useSettings } from "../../context/SettingsContext";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry } from "../../services/tauri";
import AsyncImage from "../common/AsyncImage";
import { SkeletonBox } from "../common/Skeleton";
import type { GameAppInfo, ResolvedSidebarMedia, GameMediaPaths } from "../../services/gameCacheService";
import { getBootSnapshot } from "../../services/appBootCoordinator";
import CardActionMenu, { MenuItem } from "../games/CardActionMenu";
import GameEditDialog from "../games/GameEditDialog";
import GameScannerModal from "../games/GameScannerModal";
import type { ScannedProgram } from "../games/GameScannerModal";
import ToolsModal from "../tools/ToolsModal";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import { showSuccess, showError, showInfo, showWarning } from "../toast/GameToast";
import type { AppPage } from "../../types/navigation";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { openExternalUrl } from "../../services/externalLinks";
import { uninstallSteamApp, openSteamStoreApp, deleteLuaScript, scanInstalledLuaScripts, deleteDirectory, deleteGameV2, updateCompletionStatusV2 } from "../../services/tauri";
import { isPendingUninstall, markPendingUninstall, clearPendingUninstall, subscribePendingUninstall, getPendingUninstallVersion, getFavoriteKey, detectAndQueueMissingMedia } from "../../services/gameCacheService";
import { getSteamStoreUrl } from "../../utils/steamLinks";
import { removeManualGame, normalizeManualGameId, saveManualGame } from "../../services/manualGameStore";
import type { ManualGameEntry } from "../../services/manualGameStore";
import { removeDebridGameFromLibrary, getDebridLaunchMetadata } from "../../services/debridGameStore";
import { setPendingLibraryFocus, notifyPendingFocusReady } from "../../services/libraryNavigationService";
import UninstallGameDialog from "../games/UninstallGameDialog";
import { useConfirm } from "../../services/confirmService";

const ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS = false;
const DEBUG_LUA_DELETE = false;

export type SidebarSourceFilter = "all" | "steam" | "epic" | "debrid" | "emulator" | "manual" | "favorites";
export type SidebarSortMode = "name-asc" | "name-desc" | "recent" | "most-played" | "newest";
const SIDEBAR_FILTER_SORT_KEY = "lumaforge-sidebar-filter-sort";

function loadFilterSort(): { filterBy: SidebarSourceFilter; sortBy: SidebarSortMode } {
  try {
    const raw = localStorage.getItem(SIDEBAR_FILTER_SORT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        filterBy: parsed.filterBy ?? "all",
        sortBy: parsed.sortBy ?? "name-asc",
      };
    }
  } catch { /* ignore */ }
  return { filterBy: "all", sortBy: "name-asc" };
}

type Props = {
  onOpenGame?: () => void;
  activePage?: AppPage;
  compact?: boolean;
  collapsed?: boolean;
  variant?: "full" | "header" | "list" | "add-button";
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  filterBy?: SidebarSourceFilter;
  onFilterChange?: (f: SidebarSourceFilter) => void;
  sortBy?: SidebarSortMode;
  onSortChange?: (s: SidebarSortMode) => void;
};

function logSidebarMedia(appId: string, msg: string): void {
  if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
    console.log(`[MEDIA][SIDEBAR] appid=${appId} ${msg}`);
  }
}

function pickSidebarSrc(resolved: ResolvedSidebarMedia | null, appId?: string): string | null {
  if (!resolved) return null;
  const priorities: Array<{ key: keyof ResolvedSidebarMedia; label: string }> = [
    { key: "icon", label: "icon" },
    { key: "cover", label: "cover" },
    { key: "landscape", label: "landscape" },
    { key: "background", label: "background" },
  ];
  for (const { key, label } of priorities) {
    const item = resolved[key];
    if (item?.exists && item.src) {
      if (appId) logSidebarMedia(appId, `selected=${label} path=${item.localPath} exists=true`);
      return item.src;
    }
  }
  if (appId) {
    const allFields = resolved.icon?.exists || resolved.cover?.exists || resolved.landscape?.exists || resolved.background?.exists;
    const reason = !resolved ? "no-resolved-object" : !allFields ? "no-media-fields" : "files-missing";
    logSidebarMedia(appId, `selected=placeholder path=null exists=false placeholderReason=${reason}`);
  }
  return null;
}

function pickSidebarFallbackPath(resolved: ResolvedSidebarMedia | null): string | null {
  if (!resolved) return null;
  const priorities: Array<keyof ResolvedSidebarMedia> = ["icon", "cover", "landscape", "background"];
  for (const key of priorities) {
    const item = resolved[key];
    if (item?.exists && item.localPath) {
      return item.localPath;
    }
  }
  return null;
}

function getSidebarTitle(game: LibraryGame, appInfoEntry?: LibraryAppInfoEntry | null, t?: (key: string, options?: Record<string, unknown>) => string): string {
  // Prefer the live context title (enriched/enriched canonical names) so the
  // sidebar matches the grid. The legacy appinfo index can hold stale names
  // (e.g. a verbose Debrid bundle title) and is only a fallback here.
  if (game.title && !game.title.startsWith("Steam App ")) return game.title;
  if (appInfoEntry?.name) return appInfoEntry.name;
  if (game.appId) {
    logSidebarMedia(game.appId, `placeholderReason=no-name-fallback title="Steam App ${game.appId}"`);
    return t ? t("sidebar.steam_app", { appId: game.appId }) : `Steam App ${game.appId}`;
  }
  return t ? t("sidebar.unknown_game") : "Unknown Game";
}

function getSnapshotMedia(appId: string, game?: { id?: string; libraryId?: string }): GameMediaPaths | null {
  const snapshot = getBootSnapshot();
  if (!snapshot) return null;
  // Match by appId (Steam/Lua) or by id/libraryId (Epic/GOG)
  const matchKeys = [appId];
  if (game?.id) matchKeys.push(game.id);
  if (game?.libraryId) matchKeys.push(game.libraryId);
  for (const g of snapshot.library.games) {
    if (matchKeys.includes(g.appId)) {
      return {
        landscapePath: g.media.landscapePath ?? null,
        coverPath: g.media.coverPath ?? null,
        backgroundPath: g.media.backgroundPath ?? null,
        logoPath: g.media.logoPath ?? null,
        iconPath: g.media.iconPath ?? null,
      };
    }
  }
  return null;
}

export default function SidebarLibraryList({ onOpenGame, activePage, compact = false, collapsed = false, variant = "full", searchQuery: externalSearchQuery, onSearchChange, filterBy: externalFilterBy, onFilterChange, sortBy: externalSortBy, onSortChange }: Props) {
  countRender("SidebarLibraryList");
  const { t } = useTranslation();
  const { games, selectedGame, setSelectedGame, loading, initialLoading, appInfoMap, refresh, updateGame } = useLibraryGames();
  const { getState, launchGame, stopSession } = useGameSession();
  const [localQuery, setLocalQuery] = useState("");
  const searchQuery = externalSearchQuery ?? localQuery;
  const handleSearchChange = onSearchChange ?? setLocalQuery;
  const [canonicalInfoMap, setCanonicalInfoMap] = useState<Record<string, GameAppInfo | null>>({});
  const [sidebarMediaMap, setSidebarMediaMap] = useState<Record<string, ResolvedSidebarMedia | null>>({});
  const [menuGame, setMenuGame] = useState<LibraryGame | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDialogInitialTab, setEditDialogInitialTab] = useState<"details" | "media">("details");
  const [editDialogGame, setEditDialogGame] = useState<LibraryGame | null>(null);
  const [toolsGame, setToolsGame] = useState<LibraryGame | null>(null);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<LibraryGame | null>(null);
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isInQueue, toggleQueue } = usePlayQueue();
  const { settings: appSettings } = useSettings();
  const sidebarMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const canonicalLoadedAppIds = useRef<Set<string>>(new Set());
  const sidebarMediaLoading = useRef<Set<string>>(new Set());
  const [startupBatchDelayPassed, setStartupBatchDelayPassed] = useState(false);
  const { jobs } = useDownloadQueueContext();
  const { confirm } = useConfirm();

  // Filter / Sort state — use props when provided (lifted to Sidebar.tsx), fallback to local state
  const [localFilterBy, setLocalFilterBy] = useState<SidebarSourceFilter>(() => loadFilterSort().filterBy);
  const [localSortBy, setLocalSortBy] = useState<SidebarSortMode>(() => loadFilterSort().sortBy);
  const filterBy = externalFilterBy ?? localFilterBy;
  const sortBy = externalSortBy ?? localSortBy;
  const setFilterBy = (f: SidebarSourceFilter) => {
    if (onFilterChange) onFilterChange(f);
    else setLocalFilterBy(f);
  };
  const setSortBy = (s: SidebarSortMode) => {
    if (onSortChange) onSortChange(s);
    else setLocalSortBy(s);
  };
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const [filterButtonRect, setFilterButtonRect] = useState<DOMRect | null>(null);
  const [sortButtonRect, setSortButtonRect] = useState<DOMRect | null>(null);

  // Capture button position when opening dropdowns
  const openFilter = () => {
    if (filterButtonRef.current) setFilterButtonRect(filterButtonRef.current.getBoundingClientRect());
    setFilterOpen(true);
    setSortOpen(false);
  };
  const openSort = () => {
    if (sortButtonRef.current) setSortButtonRect(sortButtonRef.current.getBoundingClientRect());
    setSortOpen(true);
    setFilterOpen(false);
  };

  // Persist to localStorage (only when using local state, i.e., no lifted state)
  useEffect(() => {
    if (onFilterChange || onSortChange) return; // Sidebar.tsx handles persistence
    localStorage.setItem(SIDEBAR_FILTER_SORT_KEY, JSON.stringify({ filterBy, sortBy }));
  }, [filterBy, sortBy, onFilterChange, onSortChange]);

  // No click-outside handler needed — portaled overlay divs handle click-away

  // Auto-scroll to selected game when navigating from LibraryGameDetails
  const gameItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastScrolledIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedGame || activePage !== "library-game-detail") return;
    if (lastScrolledIdRef.current === selectedGame.id) return;
    lastScrolledIdRef.current = selectedGame.id;
    const el = gameItemRefs.current.get(selectedGame.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedGame, activePage]);

  // Subscribe to pending uninstall state changes so React re-renders when the module-level Map changes
  useSyncExternalStore(subscribePendingUninstall, getPendingUninstallVersion, getPendingUninstallVersion);

  // Build set of appIds with active Steam install jobs — these are not yet installed
  const activeInstallAppIds = useMemo(() => {
    const activeStatuses = ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"];
    const set = new Set<string>();
    for (const job of jobs) {
      if (job.type === "steam-install" && activeStatuses.includes(job.status) && job.appId) {
        set.add(job.appId);
      }
    }
    return set;
  }, [jobs]);

  // Defer all batch processing by 5s so initial mount stays zero-work
  useEffect(() => {
    const t = setTimeout(() => setStartupBatchDelayPassed(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const lastInstalledLogRef = useRef("");

  const installed = useMemo(() => {
    const deduped = dedupeLibraryGames(games);
    const filtered = deduped.filter(
      (g) => isSidebarInstalledGame(g) && !(g.appId && activeInstallAppIds.has(g.appId))
    );

    const steamInstalledCount = deduped.filter((g) => g.steamInstalled === true).length;
    const luaActiveCount = deduped.filter(hasActiveInstalledLuaScript).length;
    const localInstalledCount = deduped.filter(
      (g) => (g.source === "local" || g.source === "manual") && typeof g.executablePath === "string" && g.executablePath.length > 0
    ).length;
    const explicitInstalledCount = deduped.filter((g) =>
      (g as any).installedStatus === "active" ||
      (g as any).installStatus === "active" ||
      (g as any).status === "installed"
    ).length;

    if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
      const logKey = `i=${games.length}:o=${filtered.length}`;
      if (logKey !== lastInstalledLogRef.current) {
        lastInstalledLogRef.current = logKey;
        console.log(
          `[SIDEBAR][INSTALLED_BREAKDOWN] input=${games.length} deduped=${deduped.length} ` +
          `steamInstalled=${steamInstalledCount} luaActive=${luaActiveCount} ` +
          `localInstalled=${localInstalledCount} explicitInstalled=${explicitInstalledCount} ` +
          `output=${filtered.length}`
        );
        console.log(
          `[SIDEBAR][INSTALLED_FILTER] input=${games.length} deduped=${deduped.length} output=${filtered.length}`
        );
      }
    }

    return filtered;
  }, [games]);

  const filtered = useMemo(() => {
    let result = installed;

    // 1. Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((g) => {
        const entry = g.appId ? appInfoMap[g.appId] : undefined;
        const displayName = entry?.name || g.title;
        return displayName.toLowerCase().includes(q) || g.appId?.toLowerCase().includes(q);
      });
    }

    // 2. Source filter
    if (filterBy !== "all") {
      if (filterBy === "favorites") {
        result = result.filter((g) => {
          const fk = getFavoriteKey(g);
          return fk ? isFavorite(fk) : false;
        });
      } else {
        result = result.filter((g) => g.source === filterBy);
      }
    }

    // 3. Sort
    if (sortBy === "name-asc") {
      result = [...result].sort((a, b) => {
        const nameA = (appInfoMap[a.appId ?? ""]?.name || a.title || "").toLowerCase();
        const nameB = (appInfoMap[b.appId ?? ""]?.name || b.title || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });
    } else if (sortBy === "name-desc") {
      result = [...result].sort((a, b) => {
        const nameA = (appInfoMap[a.appId ?? ""]?.name || a.title || "").toLowerCase();
        const nameB = (appInfoMap[b.appId ?? ""]?.name || b.title || "").toLowerCase();
        return nameB.localeCompare(nameA);
      });
    } else if (sortBy === "recent") {
      result = [...result].sort((a, b) => {
        const tA = a.steamLastPlayedAt ?? a.localLastPlayedAt ?? 0;
        const tB = b.steamLastPlayedAt ?? b.localLastPlayedAt ?? 0;
        return tB - tA;
      });
    } else if (sortBy === "most-played") {
      result = [...result].sort((a, b) => {
        const pA = a.steamPlaytimeMinutes ?? a.localPlaytimeMinutes ?? 0;
        const pB = b.steamPlaytimeMinutes ?? b.localPlaytimeMinutes ?? 0;
        return pB - pA;
      });
    } else if (sortBy === "newest") {
      result = [...result].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }

    return result;
  }, [installed, searchQuery, appInfoMap, filterBy, sortBy, isFavorite]);

  // Reset scroll tracking when filtered list changes (new scroll position needed)
  useEffect(() => {
    lastScrolledIdRef.current = null;
  }, [filtered]);

  const isCollapsedMode = collapsed;
  const isCompactMode = compact && !collapsed;
  const isFullMode = !compact && !collapsed;

  // Load canonical appinfo lazily — only for filtered (visible) games, deferred 5s on mount
  useEffect(() => {
    if (!startupBatchDelayPassed) return;
    const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
    if (ids.length === 0) return;
    const allIds = [...new Set(ids)];
    const newIds = allIds.filter((id) => !canonicalLoadedAppIds.current.has(id));
    if (newIds.length === 0) return;
    const loadAllBatches = async () => {
      const batchSize = 20;
      for (let i = 0; i < newIds.length; i += batchSize) {
        const batch = newIds.slice(i, i + batchSize);
        for (const id of batch) canonicalLoadedAppIds.current.add(id);
        const map = await batchLoadGameMedia(batch);
        setCanonicalInfoMap((prev) => ({ ...prev, ...map }));
      }
    };
    loadAllBatches();
  }, [filtered]);

  // Resolve sidebar media for visible games — use snapshot paths first
  // Retries when canonicalInfoMap becomes available for IDs that resolved with no usable media
  const [sidebarRetryKey, setSidebarRetryKey] = useState(0);
  useEffect(() => {
    const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
    const uniqueIds = [...new Set(ids)];
    const hasUsableMedia = (id: string) => {
      const r = sidebarMediaMap[id];
      return r ? (r.landscape.exists || r.cover.exists || r.icon.exists || r.background.exists) : false;
    };
    const unloadedIds = uniqueIds.filter((id) => {
      if (sidebarMediaLoading.current.has(id)) return false;
      if (sidebarMediaMap[id] === undefined) return true;
      if (!hasUsableMedia(id) && canonicalInfoMap[id]) return true;
      return false;
    });
    if (unloadedIds.length === 0) return;

    const batchSize = 10;
    const loadBatch = async () => {
      for (let i = 0; i < unloadedIds.length; i += batchSize) {
        const batch = unloadedIds.slice(i, i + batchSize);
        for (const id of batch) sidebarMediaLoading.current.add(id);
        const results = await Promise.all(
          batch.map(async (id) => {
            const snapshotMedia = getSnapshotMedia(id);
            const appInfo = canonicalInfoMap[id] ?? null;
            const resolved = await resolveSidebarMedia(id, appInfo, snapshotMedia);

            if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
              const selectedSrc = pickSidebarSrc(resolved);
              console.log(`[SidebarMedia]`, {
                appId: id,
                fromSnapshot: !!snapshotMedia,
                selectedSource: selectedSrc ? (resolved.landscape.exists ? "landscape" : "cover") : "placeholder",
              });
            }
            return [id, resolved] as const;
          })
        );
        setSidebarMediaMap((prev) => {
          const next = { ...prev };
          for (const [id, resolved] of results) {
            next[id] = resolved;
          }
          return next;
        });
        for (const id of batch) {
          sidebarMediaLoading.current.delete(id);
        }
      }
    };
    loadBatch();
  }, [filtered, canonicalInfoMap, sidebarRetryKey]);

  // Auto-download missing media for sidebar games not yet covered by Library grid
  useEffect(() => {
    const gamesWithoutMedia = filtered
      .filter((g) => {
        if (!g.appId) return false;
        const resolved = sidebarMediaMap[g.appId];
        if (resolved && (resolved.cover.exists || resolved.landscape.exists)) return false;
        return true;
      })
      .slice(0, 10);
    for (const game of gamesWithoutMedia) {
      detectAndQueueMissingMedia(game.appId!, "library-visible").catch(() => {});
    }
  }, [filtered, sidebarMediaMap]);

  // Trigger retry when canonicalInfoMap gains entries for IDs with incomplete media
  useEffect(() => {
    const ids = Object.keys(canonicalInfoMap);
    const needsRetry = ids.some((id) => {
      const r = sidebarMediaMap[id];
      return r !== undefined && !r?.landscape?.exists && !r?.cover?.exists && !r?.icon?.exists;
    });
    if (needsRetry) setSidebarRetryKey((k) => k + 1);
  }, [canonicalInfoMap]);

  // Resolve sidebar media for manual games (no appId — use game.iconPath/game.imageUrl via provider resolver)
  const manualMediaLoading = useRef<Set<string>>(new Set());
  useEffect(() => {
    const manualGames = filtered.filter((g) => !g.appId && g.source === "manual");
    if (manualGames.length === 0) return;
    const unloaded = manualGames.filter((g) => {
      if (manualMediaLoading.current.has(g.id)) return false;
      return sidebarMediaMap[g.id] === undefined;
    });
    if (unloaded.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        unloaded.map(async (g) => {
          manualMediaLoading.current.add(g.id);

          // Sidebar priority: iconPath first (compact thumbnail), then cover
          const iconLocal = g.iconPath ?? undefined;
          const coverLocal = g.imageUrl ?? undefined;

          const [resolvedIcon, resolvedCover] = await Promise.all([
            iconLocal ? resolveProviderMediaPreviewUrl(iconLocal).catch(() => null) : Promise.resolve(null),
            coverLocal ? resolveProviderMediaPreviewUrl(coverLocal).catch(() => null) : Promise.resolve(null),
          ]);

          const media: ResolvedSidebarMedia = {
            icon: resolvedIcon ? { src: resolvedIcon, localPath: iconLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            cover: resolvedCover ? { src: resolvedCover, localPath: coverLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            landscape: { src: null, localPath: null, exists: false },
            background: { src: null, localPath: null, exists: false },
            logo: { src: null, localPath: null, exists: false },
          };
          return [g.id, media] as const;
        })
      );
      if (cancelled) return;
      setSidebarMediaMap((prev) => {
        const next = { ...prev };
        for (const [id, media] of results) next[id] = media;
        return next;
      });
      for (const g of unloaded) manualMediaLoading.current.delete(g.id);
    })();
    return () => {
      cancelled = true;
      for (const g of unloaded) manualMediaLoading.current.delete(g.id);
    };
  }, [filtered]);

  // Resolve sidebar media for Epic games (no appId — use coverPath/landscapePath from snapshot or overrides)
  const epicMediaLoading = useRef<Set<string>>(new Set());
  useEffect(() => {
    const epicGames = filtered.filter((g) => !g.appId && g.source === "epic");
    if (epicGames.length === 0) return;
    const unloaded = epicGames.filter((g) => {
      if (epicMediaLoading.current.has(g.id)) return false;
      return sidebarMediaMap[g.id] === undefined;
    });
    if (unloaded.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        unloaded.map(async (g) => {
          epicMediaLoading.current.add(g.id);

          // Try snapshot first (validated media paths), then fall back to LibraryGame fields
          const snapMedia = getSnapshotMedia(g.id, g);
          const iconLocal = snapMedia?.iconPath ?? g.iconPath ?? undefined;
          const coverLocal = snapMedia?.coverPath ?? g.coverPath ?? g.imageUrl ?? undefined;
          const landscapeLocal = snapMedia?.landscapePath ?? g.landscapePath ?? undefined;
          const backgroundLocal = snapMedia?.backgroundPath ?? g.backgroundPath ?? undefined;

          // Debug: log what paths we're resolving for this Epic game
          if (coverLocal || landscapeLocal || backgroundLocal) {
            console.log(`[SIDEBAR_EPIC_MEDIA] id=${g.id} title="${g.title}" snapCover=${snapMedia?.coverPath ?? "null"} snapLandscape=${snapMedia?.landscapePath ?? "null"} libCover=${g.coverPath ?? "null"} libLandscape=${g.landscapePath ?? "null"} resolving: cover=${coverLocal ?? "null"} landscape=${landscapeLocal ?? "null"} bg=${backgroundLocal ?? "null"}`);
          } else {
            console.log(`[SIDEBAR_EPIC_MEDIA] id=${g.id} title="${g.title}" NO_MEDIA snapCover=${snapMedia?.coverPath ?? "null"} libCover=${g.coverPath ?? "null"} libLandscape=${g.landscapePath ?? "null"}`);
          }

          const [resolvedIcon, resolvedCover, resolvedLandscape, resolvedBackground] = await Promise.all([
            iconLocal ? resolveProviderMediaPreviewUrl(iconLocal).catch(() => null) : Promise.resolve(null),
            coverLocal ? resolveProviderMediaPreviewUrl(coverLocal).catch(() => null) : Promise.resolve(null),
            landscapeLocal ? resolveProviderMediaPreviewUrl(landscapeLocal).catch(() => null) : Promise.resolve(null),
            backgroundLocal ? resolveProviderMediaPreviewUrl(backgroundLocal).catch(() => null) : Promise.resolve(null),
          ]);

          const media: ResolvedSidebarMedia = {
            icon: resolvedIcon ? { src: resolvedIcon, localPath: iconLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            cover: resolvedCover ? { src: resolvedCover, localPath: coverLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            landscape: resolvedLandscape ? { src: resolvedLandscape, localPath: landscapeLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            background: resolvedBackground ? { src: resolvedBackground, localPath: backgroundLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            logo: { src: null, localPath: null, exists: false },
          };

          // Debug: log resolved results
          console.log(`[SIDEBAR_EPIC_MEDIA_RESULT] id=${g.id} cover=${media.cover.exists} landscape=${media.landscape.exists} coverSrc=${media.cover.src?.slice(0, 80) ?? "null"}`);

          return [g.id, media] as const;
        })
      );
      if (cancelled) return;
      setSidebarMediaMap((prev) => {
        const next = { ...prev };
        for (const [id, media] of results) next[id] = media;
        return next;
      });
      for (const g of unloaded) epicMediaLoading.current.delete(g.id);
    })();
    return () => {
      cancelled = true;
      for (const g of unloaded) epicMediaLoading.current.delete(g.id);
    };
  }, [filtered]);

  // Resolve sidebar media for Emulator games (no appId — use coverPath/landscapePath from emulator store)
  const emulatorMediaLoading = useRef<Set<string>>(new Set());
  useEffect(() => {
    const emulatorGames = filtered.filter((g) => !g.appId && g.source === "emulator");
    if (emulatorGames.length === 0) return;
    const unloaded = emulatorGames.filter((g) => {
      if (emulatorMediaLoading.current.has(g.id)) return false;
      return sidebarMediaMap[g.id] === undefined;
    });
    if (unloaded.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        unloaded.map(async (g) => {
          emulatorMediaLoading.current.add(g.id);

          const iconLocal = g.iconPath ?? undefined;
          const coverLocal = g.coverPath ?? g.imageUrl ?? undefined;
          const landscapeLocal = g.landscapePath ?? undefined;
          const backgroundLocal = g.backgroundPath ?? undefined;

          const [resolvedIcon, resolvedCover, resolvedLandscape, resolvedBackground] = await Promise.all([
            iconLocal ? resolveProviderMediaPreviewUrl(iconLocal).catch(() => null) : Promise.resolve(null),
            coverLocal ? resolveProviderMediaPreviewUrl(coverLocal).catch(() => null) : Promise.resolve(null),
            landscapeLocal ? resolveProviderMediaPreviewUrl(landscapeLocal).catch(() => null) : Promise.resolve(null),
            backgroundLocal ? resolveProviderMediaPreviewUrl(backgroundLocal).catch(() => null) : Promise.resolve(null),
          ]);

          const media: ResolvedSidebarMedia = {
            icon: resolvedIcon ? { src: resolvedIcon, localPath: iconLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            cover: resolvedCover ? { src: resolvedCover, localPath: coverLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            landscape: resolvedLandscape ? { src: resolvedLandscape, localPath: landscapeLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            background: resolvedBackground ? { src: resolvedBackground, localPath: backgroundLocal ?? null, exists: true } : { src: null, localPath: null, exists: false },
            logo: { src: null, localPath: null, exists: false },
          };

          return [g.id, media] as const;
        })
      );
      if (cancelled) return;
      setSidebarMediaMap((prev) => {
        const next = { ...prev };
        for (const [id, media] of results) next[id] = media;
        return next;
      });
      for (const g of unloaded) emulatorMediaLoading.current.delete(g.id);
    })();
    return () => {
      cancelled = true;
      for (const g of unloaded) emulatorMediaLoading.current.delete(g.id);
    };
  }, [filtered]);

  // High-priority media resolution for visible games with missing thumbnails
  // useEffect(() => {
  //   const ids = filtered.map((g) => g.appId).filter(Boolean) as string[];
  //   const uniqueIds = [...new Set(ids)];
  //   const missingIds = uniqueIds.filter((id) => {
  //     const resolved = sidebarMediaMap[id];
  //     if (!resolved) return false; // still loading
  //     return !resolved.landscape.exists && !resolved.cover.exists;
  //   });

  //   if (missingIds.length === 0) return;

  //   for (const id of missingIds) {
  //     if (sidebarRepairEnqueued.current.has(id)) continue;
  //     sidebarRepairEnqueued.current.add(id);
  //     const key = backgroundJobQueue.enqueue("repair-game-media", "steam", { appId: id, priority: "high" });
  //     if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) {
  //       console.log(`[MEDIA][SIDEBAR] visible=${uniqueIds.length} missing=${missingIds.length}`);
  //       console.log(`[JOB] queued key=${key} priority=high`);
  //     }
  //   }
  // }, [filtered, sidebarMediaMap]);

  function handleContextMenu(e: React.MouseEvent<HTMLButtonElement>, game: LibraryGame) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedGame(game);
    sidebarMenuAnchorRef.current = e.currentTarget;
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setMenuGame(game);
    setMenuOpen(true);
  }

  async function handleDeleteScript(game: LibraryGame) {
    let script: import("../../types/installedLua").InstalledLuaScript | undefined = game.luaScripts[0];
    if (!script && game.hasLua && game.appId && appSettings.luaPath) {
      try {
        const allScripts = await scanInstalledLuaScripts(appSettings.luaPath, { force: true });
        script = allScripts.find((s) => String(s.app_id) === game.appId);
      } catch { /* scan failed */ }
    }
    if (!script) {
      showWarning(t("sidebar.no_lua_script"), { title: t("library_details.no_script_title") });
      return;
    }
    if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][REQUEST] appid=${game.appId} title="${game.title}" file="${script.file_name}" path="${script.path}" luaPath="${appSettings.luaPath}"`);
    const result = await confirm({
      title: t("sidebar.delete_lua_title"),
      description: t("sidebar.delete_lua_desc", { file: script.file_name, game: game.title }),
      confirmLabel: t("sidebar.delete_lua_confirm"),
      variant: "danger",
    });
    if (!result.confirmed) return;
    try {
      await deleteLuaScript({ luaPath: appSettings.luaPath, fileName: script.file_name });
      const remaining = await scanInstalledLuaScripts(appSettings.luaPath, { force: true });
      const stillPresent = remaining.some((s) => s.file_name === script.file_name);
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][VERIFY] appid=${game.appId} file="${script.file_name}" stillPresent=${stillPresent}`);
      if (stillPresent) {
        showError(t("sidebar.deletion_failed"), { title: t("sidebar.deletion_failed_title") });
        return;
      }
      await refresh({ force: true });
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" success=true`);
      showSuccess(t("sidebar.lua_deleted"), { title: t("sidebar.lua_deleted_title") });
    } catch (err) {
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" error="${String(err)}"`);
      showError(String(err), { title: t("sidebar.error") });
    }
  }

  function handleMenuClose() {
    setMenuOpen(false);
    setContextMenuPos(null);
    setMenuGame(null);
  }

  const renderFilterDropdown = () => (
    <>
      <button
        ref={filterButtonRef}
        type="button"
        onClick={() => { if (filterOpen) { setFilterOpen(false); } else { openFilter(); } }}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          filterBy !== "all"
            ? "bg-(--color-accent)/15 text-(--color-accent)"
            : "text-(--color-muted) hover:bg-white/[0.06] hover:text-(--color-text)"
        }`}
        title={t("sidebar.filter")}
      >
        <Filter className="h-3 w-3" />
        {filterBy !== "all" && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-(--color-accent)" />
        )}
      </button>
      {filterOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[99997]" onClick={() => setFilterOpen(false)} />
          <div
            className="fixed z-[99998] w-44 rounded-2xl border border-(--surface-active-border) lf-surface p-1.5 shadow-2xl shadow-black/40 lf-popover-enter"
            style={{ top: filterButtonRect ? filterButtonRect.bottom + 4 : 0, left: filterButtonRect ? filterButtonRect.left : 0 }}
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">{t("sidebar.filter_source")}</div>
            {(["all", "steam", "epic", "debrid", "emulator", "manual", "favorites"] as SidebarSourceFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => { setFilterBy(f); setFilterOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition ${
                  filterBy === f ? "bg-(--color-accent)/8 text-(--color-accent) font-medium" : "text-(--color-muted) hover:bg-white/[0.03] hover:text-(--color-text)"
                }`}
              >
                {f === "favorites" ? <Star className={`h-3 w-3 ${filterBy === f ? "fill-current" : ""}`} /> : <span className="h-3 w-3" />}
                <span className="flex-1 text-left">{t(`sidebar.filter_${f}`)}</span>
                {filterBy === f && <Check className="h-3 w-3 text-(--color-accent)" />}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );

  const renderSortDropdown = () => (
    <>
      <button
        ref={sortButtonRef}
        type="button"
        onClick={() => { if (sortOpen) { setSortOpen(false); } else { openSort(); } }}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          sortBy !== "name-asc"
            ? "bg-(--color-accent)/15 text-(--color-accent)"
            : "text-(--color-muted) hover:bg-white/[0.06] hover:text-(--color-text)"
        }`}
        title={t("sidebar.sort")}
      >
        <ArrowUpDown className="h-3 w-3" />
      </button>
      {sortOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[99997]" onClick={() => setSortOpen(false)} />
          <div
            className="fixed z-[99998] w-40 rounded-2xl border border-(--surface-active-border) lf-surface p-1.5 shadow-2xl shadow-black/40 lf-popover-enter"
            style={{ top: sortButtonRect ? sortButtonRect.bottom + 4 : 0, right: sortButtonRect ? window.innerWidth - sortButtonRect.right : 0 }}
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-(--color-muted)">{t("sidebar.sort_by")}</div>
            {([
              { value: "name-asc" as SidebarSortMode, labelKey: "sidebar.sort_name_asc" },
              { value: "name-desc" as SidebarSortMode, labelKey: "sidebar.sort_name_desc" },
              { value: "recent" as SidebarSortMode, labelKey: "sidebar.sort_recent" },
              { value: "most-played" as SidebarSortMode, labelKey: "sidebar.sort_most_played" },
              { value: "newest" as SidebarSortMode, labelKey: "sidebar.sort_newest" },
            ]).map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => { setSortBy(s.value); setSortOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition ${
                  sortBy === s.value ? "bg-(--color-accent)/8 text-(--color-accent) font-medium" : "text-(--color-muted) hover:bg-white/[0.03] hover:text-(--color-text)"
                }`}
              >
                <span className="flex-1 text-left">{t(s.labelKey)}</span>
                {sortBy === s.value && <Check className="h-3 w-3 text-(--color-accent)" />}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );

  const renderHeader = () => (
    <>
      {isFullMode && (
        <div className="mb-2 flex items-center justify-between px-1">
          <Gamepad2 className="h-4.5 w-4.5" />
          <span className="text-xs font-bold text-(--color-text)">{t("sidebar.games")}</span>
          <span className="text-[10px] text-(--color-muted)">{t("sidebar.games_count", { count: filtered.length })}</span>
        </div>
      )}

      {isCompactMode && (
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-(--color-text)">{t("sidebar.games")}</span>
          <span className="text-[10px] text-(--color-muted)">{filtered.length}</span>
        </div>
      )}

      {/* Search + Filter + Sort */}
      {isFullMode && (
        <div className="mb-2 flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("sidebar.search_placeholder")}
              className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 py-1.5 pl-7 pr-2.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
            />
          </div>
          {renderFilterDropdown()}
          {renderSortDropdown()}
        </div>
      )}

      {isCompactMode && (
        <div className="mb-2 flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--color-muted)" />
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t("sidebar.search_placeholder_compact")}
              className="w-full rounded-lg border border-(--surface-active-border) bg-white/5 py-1 pl-7 pr-2 text-[11px] text-(--color-text) outline-none placeholder:text-(--color-muted) focus:border-(--color-accent)/40"
            />
          </div>
          {renderFilterDropdown()}
          {renderSortDropdown()}
        </div>
      )}
    </>
  );

  const renderGameList = () => (
    <div className={`${isCollapsedMode ? "space-y-2" : "space-y-0.5"}`}>
      {(initialLoading || (loading && games.length === 0)) ? (
        isCollapsedMode ? (
          <div className="space-y-2 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-center px-2">
                <SkeletonBox className="h-10 w-10 shrink-0 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <SkeletonBox className="h-6 w-10 shrink-0 rounded" />
                <div className="min-w-0 flex-1 space-y-1">
                  <SkeletonBox className="h-3 w-3/4" />
                  <SkeletonBox className="h-2 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        isCollapsedMode ? null : (
          <p className="py-2 text-center text-[10px] text-(--color-muted)">{t("sidebar.no_games_match")}</p>
        )
      ) : (
        filtered.map((game) => {
          const isSelected = activePage === "library-game-detail" && selectedGame?.id === game.id;
          const appInfoEntry = game.appId ? (appInfoMap[game.appId] ?? null) : null;
          const mediaKey = game.appId || game.id;
          const resolved = sidebarMediaMap[mediaKey] ?? null;
          const resolvedThumb = pickSidebarSrc(resolved, game.appId ?? undefined);
          const sidebarFallbackPath = pickSidebarFallbackPath(resolved);
          const displayTitle = getSidebarTitle(game, appInfoEntry, t);
          const gk = computeGameKey(game);
          const gs = getState(gk);
          const isRunning = gs === "running";
          const isLaunching = gs === "launching";

          if (isCollapsedMode) {
            return (
              <button
                key={`sidebar:installed:${game.id}`}
                ref={(el) => { if (el) gameItemRefs.current.set(game.id, el); else gameItemRefs.current.delete(game.id); }}
                type="button"
                title={displayTitle}
                onClick={() => {
                  setSelectedGame(game);
                  onOpenGame?.();
                }}
                onContextMenu={(e) => handleContextMenu(e, game)}
                className={`flex w-full cursor-pointer items-center justify-center rounded-xl px-1 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-(--color-accent)/30 ${isSelected
                  ? "bg-(--color-accent)/10 ring-1 ring-(--color-accent)/30"
                  : "hover:bg-white/[0.06]"
                  }`}
              >
                <div className="relative h-10 w-10 overflow-hidden rounded-xl object-cover">
                  {resolvedThumb ? (
                    <AsyncImage
                      src={resolvedThumb}
                      alt=""
                      className="h-full w-full object-cover"
                      fallbackLocalPath={sidebarFallbackPath}
                      fallback={
                        <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-white/5">
                      <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
                    </div>
                  )}
                  {isRunning && (
                    <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black/50" />
                  )}
                </div>
              </button>
            );
          }

          return (
            <button
              key={`sidebar:installed:${game.id}`}
              ref={(el) => { if (el) gameItemRefs.current.set(game.id, el); else gameItemRefs.current.delete(game.id); }}
              type="button"
              onClick={() => {
                setSelectedGame(game);
                onOpenGame?.();
              }}
              onContextMenu={(e) => handleContextMenu(e, game)}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-(--color-accent)/20 ${isSelected
                ? "bg-(--color-accent)/10 text-(--color-accent)"
                : "text-(--color-text) hover:bg-white/[0.06]"
                }`}
            >
              <div className={`relative shrink-0 overflow-hidden rounded object-cover ${isCompactMode ? "h-6 w-9" : "h-6 w-10"
                }`}>
                {resolvedThumb ? (
                  <AsyncImage
                    src={resolvedThumb}
                    alt=""
                    className="h-full w-full object-cover"
                    fallbackLocalPath={sidebarFallbackPath}
                    fallback={
                      <Gamepad2 className="h-3 w-3 text-(--color-muted)" />
                    }
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/5">
                    <Gamepad2 className="h-3 w-3 text-(--color-muted)" />
                  </div>
                )}
                {isRunning && (
                  <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-black/50" />
                )}
                {isLaunching && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 className="h-3 w-3 animate-spin text-white" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {isRunning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />}
                  <span className={`truncate font-medium leading-tight ${isCompactMode ? "text-[11px]" : ""
                    }`}>
                    {isCompactMode && displayTitle.length > 16
                      ? displayTitle.slice(0, 14) + ".."
                      : displayTitle
                    }
                  </span>
                </div>
                {!isCompactMode && (
                  <div className="text-[10px] text-(--color-muted)">
                    {isRunning ? t("sidebar.running") : isLaunching ? t("sidebar.launching") : getSidebarLabel(game)}
                    {!isRunning && !isLaunching && game.hasUpdate && t("sidebar.update")}
                  </div>
                )}
                {isCompactMode && (
                  <div className="text-[9px] text-(--color-muted)">
                    {isRunning ? t("sidebar.running") : isLaunching ? t("sidebar.launching") : getSidebarLabel(game)}
                  </div>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );

  const renderMenu = () => (
    menuGame && (
      <CardActionMenu
        open={menuOpen}
        anchorRef={sidebarMenuAnchorRef as React.RefObject<HTMLElement | null>}
        onClose={handleMenuClose}
        cursorPos={contextMenuPos}
        gameId={menuGame.appId}
      >
        {(() => {
          const mgk = computeGameKey(menuGame);
          const mState = getState(mgk);
          const isRunning = mState === "running";
          const mAction = getLauncherGamePrimaryAction(menuGame);
          const mHasLua = menuGame.hasLua || menuGame.luaScripts.length > 0;
          const mPendingUninstall = menuGame.appId ? isPendingUninstall(menuGame.appId) : false;
          if (ENABLE_VERBOSE_SIDEBAR_MEDIA_LOGS) console.log(`[SIDEBAR_ACTION_RENDER] appid=${menuGame.appId} uninstallPending=${mPendingUninstall} action=${mPendingUninstall ? "uninstalling" : mAction}`);
          const _sfk = getFavoriteKey(menuGame);
          const fav = _sfk ? isFavorite(_sfk) : false;
          const inQueue = isInQueue(menuGame.id);

          return (
            <>
              {isRunning ? (
                <MenuItem
                  label={t("context_menu.stop")}
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); stopSession(mgk); }}
                />
              ) : mPendingUninstall ? (
                <MenuItem
                  label={t("sidebar.uninstalling")}
                  icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  disabled
                />
              ) : mAction === "play" ? (
                <MenuItem
                  label={t("context_menu.play")}
                  icon={<Play className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); launchGame(menuGame); }}
                />
              ) : mAction === "open-steam" ? (
                <MenuItem
                  label={t("context_menu.open_steam")}
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); if (menuGame.appId) openExternalUrl(getSteamStoreUrl(Number(menuGame.appId))); }}
                />
              ) : mAction === "open-lua-folder" ? (
                <MenuItem
                  label={t("context_menu.lua_folder")}
                  icon={<FolderOpen className="h-3.5 w-3.5" />}
                  onClick={() => {
                    handleMenuClose();
                    if (menuGame.luaScripts.length > 0) {
                      const scriptPath = menuGame.luaScripts[0].path;
                      const scriptDir = scriptPath.substring(0, Math.max(scriptPath.lastIndexOf('/'), scriptPath.lastIndexOf('\\')));
                      if (scriptDir) invoke("open_folder", { path: scriptDir }).catch((err) => showError(t("sidebar.could_not_open_folder", { error: err })));
                    }
                  }}
                />
              ) : (
                <MenuItem
                  label={t("context_menu.install")}
                  icon={<Download className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); }}
                />
              )}
              <MenuItem
                label={fav ? t("sidebar.remove_from_favorites") : t("sidebar.add_to_favorites")}
                icon={<Heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />}
                onClick={() => {
                  const fk = getFavoriteKey(menuGame);
                  if (fk) toggleFavorite(fk);
                  handleMenuClose();
                }}
              />
              <MenuItem
                label={inQueue ? t("sidebar.play_next_remove") : t("sidebar.play_next_add")}
                icon={<ListPlus className="h-3.5 w-3.5" />}
                onClick={() => {
                  toggleQueue(menuGame.id);
                  handleMenuClose();
                }}
              />
              {menuGame.appId && menuGame.source !== "epic" && menuGame.source !== "debrid" && menuGame.source !== "lua" && (
                <MenuItem
                  label={t("context_menu.open_steam")}
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  onClick={() => { handleMenuClose(); openExternalUrl(getSteamStoreUrl(Number(menuGame.appId))); }}
                />
              )}
              <MenuItem
                label={t("context_menu.browse_files")}
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                onClick={() => {
                  handleMenuClose();
                  const exe = menuGame.executablePath || "";
                  const sep = Math.max(exe.lastIndexOf("\\"), exe.lastIndexOf("/"));
                  const folder = (sep > 0 ? exe.substring(0, sep) : null) || menuGame.installDir || "";
                  if (folder) {
                    invoke("open_folder", { path: folder }).catch((err) => {
                      showError(t("sidebar.could_not_open_folder", { error: err }));
                    });
                  }
                }}
              />
              {(menuGame?.source === "steam" || menuGame?.source === "manual" || menuGame?.source === "debrid" || menuGame?.source === "lua") && (
                <MenuItem
                  label={t("context_menu.game_fixes")}
                  icon={<Wrench className="h-3.5 w-3.5" />}
                  onClick={() => {
                    handleMenuClose();
                    setToolsGame(menuGame);
                    setToolsModalOpen(true);
                  }}
                />
              )}
              <MenuItem
                label={t("context_menu.create_shortcut")}
                icon={<FileText className="h-3.5 w-3.5" />}
                onClick={async () => {
                  handleMenuClose();

                  try {
                    const installDir = menuGame.installDir;

                    if (!installDir) {
                      showError(t("sidebar.install_dir_not_found"));
                      return;
                    }

                    const { discoverExecutables } = await import("../../services/tauri");

                    const executables = await discoverExecutables(installDir);

                    console.log("Executables found:", executables);

                    if (!executables.length) {
                      showError(t("context_menu.exe_not_found"));
                      return;
                    }

                    const exe = executables[0];

                    const exePath = exe.exe_path;

                    const path = await invoke<string>("create_shortcut", {
                      exePath,
                      name: menuGame.title || t("sidebar.shortcut_game", { appId: menuGame.appId }),
                    });

                    showSuccess(t("context_menu.shortcut_created", { path }));

                  } catch (err) {
                    showError(t("context_menu.shortcut_error", { error: err }));
                  }
                }}
              />

              <MenuItem
                label={t("context_menu.set_status", "Set Status")}
                icon={<Circle className="h-3.5 w-3.5" />}
                children={[
                  {
                    label: t("context_menu.status_auto", "Auto"),
                    icon: menuGame.completionStatus ? <Circle className="h-3.5 w-3.5 opacity-30" /> : <Check className="h-3.5 w-3.5" />,
                    onClick: () => { setMenuOpen(false); if (menuGame.id) { updateCompletionStatusV2(menuGame.id, undefined).catch(() => {}); updateGame(menuGame.id, { completionStatus: undefined }); } },
                  },
                  {
                    label: t("context_menu.status_completed", "Completed"),
                    icon: menuGame.completionStatus === "completed" ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 opacity-30" />,
                    onClick: () => { setMenuOpen(false); if (menuGame.id) { updateCompletionStatusV2(menuGame.id, "completed").catch(() => {}); updateGame(menuGame.id, { completionStatus: "completed" }); } },
                  },
                  {
                    label: t("context_menu.status_in_progress", "In Progress"),
                    icon: menuGame.completionStatus === "in-progress" ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 opacity-30" />,
                    onClick: () => { setMenuOpen(false); if (menuGame.id) { updateCompletionStatusV2(menuGame.id, "in-progress").catch(() => {}); updateGame(menuGame.id, { completionStatus: "in-progress" }); } },
                  },
                  {
                    label: t("context_menu.status_not_played", "Not Played"),
                    icon: menuGame.completionStatus === "not-played" ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 opacity-30" />,
                    onClick: () => { setMenuOpen(false); if (menuGame.id) { updateCompletionStatusV2(menuGame.id, "not-played").catch(() => {}); updateGame(menuGame.id, { completionStatus: "not-played" }); } },
                  },
                  {
                    label: t("context_menu.status_played", "Played"),
                    icon: menuGame.completionStatus === "played" ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 opacity-30" />,
                    onClick: () => { setMenuOpen(false); if (menuGame.id) { updateCompletionStatusV2(menuGame.id, "played").catch(() => {}); updateGame(menuGame.id, { completionStatus: "played" }); } },
                  },
                  {
                    label: t("context_menu.status_abandoned", "Abandoned"),
                    icon: menuGame.completionStatus === "abandoned" ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 opacity-30" />,
                    onClick: () => { setMenuOpen(false); if (menuGame.id) { updateCompletionStatusV2(menuGame.id, "abandoned").catch(() => {}); updateGame(menuGame.id, { completionStatus: "abandoned" }); } },
                  },
                ]}
              />

              <MenuItem
                label={t("context_menu.manage")}
                icon={<Settings className="h-3.5 w-3.5" />}
                children={[
                  ...(menuGame.source === "manual"
                    ? [
                        {
                          label: t("context_menu.edit_details"),
                          icon: <Pencil className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setMenuOpen(false);
                            setEditDialogGame(menuGame);
                            setEditDialogInitialTab("details");
                            setEditDialogOpen(true);
                          },
                        },
                        {
                          label: t("context_menu.manage_art"),
                          icon: <Image className="h-3.5 w-3.5" />,
                          onClick: () => {
                            setMenuOpen(false);
                            setEditDialogGame(menuGame);
                            setEditDialogInitialTab("media");
                            setEditDialogOpen(true);
                          },
                        },
                        {
                          label: t("context_menu.delete_manual"),
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          destructive: true,
                          disabled: isRunning,
                          onClick: () => {
                            if (isRunning) {
                              showWarning(t("context_menu.stop_before_remove"), { title: t("sidebar.game_is_running") });
                              return;
                            }
                            handleMenuClose();
                            setUninstallTarget(menuGame);
                            setUninstallDialogOpen(true);
                          },
                        },
                      ]
                    : []),
                    ...(menuGame.source === "emulator"
                    ? [{
                        label: t("context_menu.remove_from_library", "Remove from Library"),
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        destructive: true as const,
                        disabled: isRunning,
                        onClick: async () => {
                          if (isRunning) {
                            showWarning(t("context_menu.stop_before_remove"), { title: t("sidebar.game_is_running") });
                            return;
                          }
                          handleMenuClose();
                          const result = await confirm({
                            title: t("context_menu.remove_from_library", "Remove from Library"),
                            description: t("context_menu.remove_from_library_confirm", "Remove \"{{title}}\" from your library? The ROM file will not be deleted.", { title: menuGame.title }),
                            confirmLabel: t("buttons.remove", "Remove"),
                            cancelLabel: t("buttons.cancel", "Cancel"),
                          });
                          if (!result.confirmed) return;
                          try {
                            const { removeEmulatorGameFromLibrary } = await import("../../services/emulatorGameStore");
                            const { deleteGameV2 } = await import("../../services/tauri");
                            removeEmulatorGameFromLibrary(menuGame.id);
                            await deleteGameV2(menuGame.id);
                            showSuccess(`"${menuGame.title}" ${t("context_menu.removed", "removed")}`);
                          } catch (e) {
                            showError(`${t("game_tile.remove_failed", "Failed to remove")}: ${e}`);
                          }
                        },
                      }]
                    : []),
                   ...(mPendingUninstall
                    ? [{
                      label: t("context_menu.cancel_tracking"),
                      icon: <XCircle className="h-3.5 w-3.5" />,
                      onClick: () => {
                        handleMenuClose();
                        console.log(`[UNINSTALL_PENDING] appid=${menuGame.appId} phase=manual-cancel before=${isPendingUninstall(String(menuGame.appId))}`);
                        clearPendingUninstall(String(menuGame.appId));
                        showInfo(t("sidebar.uninstall_tracking_cancelled", { title: menuGame.title ?? menuGame.appId }));
                        console.log(`[UNINSTALL_PENDING] appid=${menuGame.appId} phase=manual-cancel after=${isPendingUninstall(String(menuGame.appId))}`);
                      },
                    }]
                    : menuGame.source === "debrid"
                      ? [{
                        label: t("context_menu.remove_library"),
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        destructive: true as const,
                        onClick: async () => {
                          handleMenuClose();
                          const providerGameId = menuGame.providerGameId;
                          if (!providerGameId) {
                            showError(t("sidebar.debrid_remove_error"));
                            return;
                          }
                          const meta = getDebridLaunchMetadata(providerGameId);
                          const installDir = meta?.installDir;
                          const result = await confirm({
                            title: t("context_menu.remove_library"),
                            description: installDir
                              ? t("sidebar.debrid_remove_confirm", { defaultValue: `This will remove "${menuGame.title ?? providerGameId}" from library and delete:\n${installDir}`, title: menuGame.title ?? providerGameId, installDir })
                              : t("sidebar.debrid_remove_confirm_no_dir", { defaultValue: `This will remove "${menuGame.title ?? providerGameId}" from library.`, title: menuGame.title ?? providerGameId }),
                            confirmLabel: t("context_menu.remove_library"),
                            variant: "danger",
                          });
                          if (!result.confirmed) return;
                          if (installDir) {
                            try { await deleteDirectory(installDir); } catch { /* best effort */ }
                          }
                          try { await deleteGameV2(`debrid:${providerGameId}`); } catch { /* best effort */ }
                          removeDebridGameFromLibrary(providerGameId);
                          showSuccess(t("sidebar.debrid_removed", { title: menuGame.title ?? providerGameId }));
                        },
                      }]
                    : menuGame.source !== "manual" && menuGame.source !== "epic" && menuGame.source !== "lua"
                      ? [{
                        label: t("context_menu.uninstall_steam"),
                        icon: <ExternalLink className="h-3.5 w-3.5" />,
                        disabled: !menuGame.steamInstalled,
                        subtitle: !menuGame.steamInstalled ? t("context_menu.not_installed") : undefined,
                        onClick: menuGame.steamInstalled ? async () => {
                          handleMenuClose();
                          const appId = Number(menuGame.appId);
                          markPendingUninstall(String(appId));
                          showInfo(t("sidebar.steam_uninstall_opened"), { title: t("sidebar.uninstall") });
                          try {
                            console.log(`[STEAM_UNINSTALL_OPEN] appid=${appId} attempt=1`);
                            await uninstallSteamApp(appId);
                            console.log(`[STEAM_UNINSTALL_OPEN] appid=${appId} result=ok attempt=1`);
                          } catch (e1) {
                            console.log(`[STEAM_UNINSTALL_OPEN] appid=${appId} result=error error=${e1} attempt=1`);
                            try {
                              console.log(`[STEAM_UNINSTALL_FALLBACK] appid=${appId} attempt=2`);
                              await openSteamStoreApp(appId);
                            } catch (e2) {
                              console.log(`[STEAM_UNINSTALL_FALLBACK] appid=${appId} uri=${getSteamStoreUrl(appId)} attempt=3`);
                              await openExternalUrl(getSteamStoreUrl(appId));
                            }
                          }
                        } : undefined,
                      }]
                      : []),
                  ...(mHasLua
                    ? [{
                      label: t("game_tile.delete_lua"),
                      icon: <X className="h-3.5 w-3.5" />,
                      destructive: true as const,
                      onClick: () => { handleMenuClose(); handleDeleteScript(menuGame); },
                    }]
                    : []),
                ]}
              />
            </>
          );
        })()}
      </CardActionMenu>
    )
  );

  // Add Manual Game — pinned button, rendered OUTSIDE the scrollable list
  // (mounted in Sidebar.tsx below the scroll container, so scrolling never moves it).
  if (variant === "add-button") {
    if (isCompactMode || isCollapsedMode) return null;
    const handleScanAdd = (programs: ScannedProgram[]) => {
      let lastId: string | null = null;
      let lastName: string | null = null;
      for (const p of programs) {
        const entry: ManualGameEntry = {
          id: crypto.randomUUID(),
          name: p.name,
          executablePath: p.exePath || undefined,
          installDir: p.installPath || undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        // Auto-derive installDir + workingDirectory from exePath parent
        if (p.exePath && /^[A-Za-z]:\\|^\\\\|^\//.test(p.exePath)) {
          const parentDir = p.exePath.replace(/[\\/][^\\/]+$/, "");
          if (parentDir) {
            if (!entry.installDir || !/^[A-Za-z]:\\|^\\\\|^\//.test(entry.installDir)) {
              entry.installDir = parentDir;
            }
            entry.workingDirectory = parentDir;
          }
        }
        saveManualGame(entry);
        lastId = `manual:${entry.id}`;
        lastName = p.name;
      }
      // Auto-scroll to the last added game
      if (lastId) {
        setPendingLibraryFocus(lastId, lastName ?? undefined);
        notifyPendingFocusReady();
      }
      setScannerOpen(false);
    };
    return (
      <div className="flex flex-col gap-1">
        <div className="flex">
          <button
            type="button"
            onClick={() => {
              setEditDialogGame(null);
              setEditDialogInitialTab("details");
              setEditDialogOpen(true);
            }}
            className="flex flex-1 items-center gap-2 rounded-l-lg border border-dashed border-(--surface-active-border) px-3 py-1.5 text-[11px] text-(--color-muted) transition hover:border-(--color-accent)/40 hover:text-(--color-text)"
          >
            <Plus className="h-3 w-3" />
            {t("library_page.add_game")}
          </button>
          <button
            type="button"
            onClick={() => setAddMenuOpen((v) => !v)}
            className="flex items-center rounded-r-lg border border-l-0 border-dashed border-(--surface-active-border) px-1.5 py-1.5 text-(--color-muted) transition hover:border-(--color-accent)/40 hover:text-(--color-text)"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${addMenuOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
        {addMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
            <div className="relative z-50 -mt-0.5 overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) shadow-xl shadow-black/40">
              <button
                onClick={() => { setScannerOpen(true); setAddMenuOpen(false); }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[11px] text-(--color-muted) transition hover:bg-white/5 hover:text-(--color-text)"
              >
                <Scan className="h-3 w-3" />
                {t("library_page.scan_installed")}
              </button>
            </div>
          </>
        )}
        {editDialogOpen && (
          <GameEditDialog
            appId={editDialogGame?.source !== "manual" && editDialogGame?.source !== "epic" && editDialogGame?.source !== "debrid" && editDialogGame?.source !== "emulator" ? editDialogGame?.appId : undefined}
            manualGameId={editDialogGame?.source === "manual" ? editDialogGame?.providerGameId : undefined}
            epicProviderGameId={editDialogGame?.source === "epic" ? editDialogGame?.providerGameId : undefined}
            debridProviderGameId={editDialogGame?.source === "debrid" ? editDialogGame?.providerGameId : undefined}
            emulatorProviderGameId={editDialogGame?.source === "emulator" ? editDialogGame?.providerGameId : undefined}
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            initialTab={editDialogInitialTab}
            game={editDialogGame ?? undefined}
            settings={{
              rawgApiKey: appSettings?.rawgApiKey ?? "",
              igdbClientId: appSettings?.igdbClientId ?? "",
              igdbClientSecret: appSettings?.igdbClientSecret ?? "",
              steamGridDbApiKey: appSettings?.steamGridDbApiKey ?? "",
              steamGridDbArtworkEnabled: appSettings?.steamGridDbArtworkEnabled ?? false,
            }}
          />
        )}
        <GameScannerModal
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onAdd={handleScanAdd}
          games={games}
        />
      </div>
    );
  }

  // Collapsed mode: render everything inline (icons only)
  if (isCollapsedMode) {
    return (
      <div className="flex flex-col">
        {renderGameList()}
        {renderMenu()}
        {toolsModalOpen && (
          <ToolsModal open={toolsModalOpen} game={toolsGame} onClose={() => setToolsModalOpen(false)} />
        )}
        {editDialogOpen && (
          <GameEditDialog
            appId={editDialogGame?.source !== "manual" && editDialogGame?.source !== "epic" && editDialogGame?.source !== "debrid" ? editDialogGame?.appId : undefined}
            manualGameId={editDialogGame?.source === "manual" ? editDialogGame.providerGameId : undefined}
            epicProviderGameId={editDialogGame?.source === "epic" ? editDialogGame.providerGameId : undefined}
            debridProviderGameId={editDialogGame?.source === "debrid" ? editDialogGame.providerGameId : undefined}
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            initialTab={editDialogInitialTab}
            game={editDialogGame ?? undefined}
            settings={{
              rawgApiKey: appSettings?.rawgApiKey ?? "",
              igdbClientId: appSettings?.igdbClientId ?? "",
              igdbClientSecret: appSettings?.igdbClientSecret ?? "",
              steamGridDbApiKey: appSettings?.steamGridDbApiKey ?? "",
              steamGridDbArtworkEnabled: appSettings?.steamGridDbArtworkEnabled ?? false,
            }}
          />
        )}
      </div>
    );
  }

  // Split mode: header-only or list-only
  if (variant === "header") {
    return (
      <div className="flex flex-col">
        {renderHeader()}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="flex flex-col">
        {renderGameList()}
        {renderMenu()}
        {toolsModalOpen && (
          <ToolsModal open={toolsModalOpen} game={toolsGame} onClose={() => setToolsModalOpen(false)} />
        )}
        {editDialogOpen && (
          <GameEditDialog
            appId={editDialogGame?.source !== "manual" && editDialogGame?.source !== "epic" && editDialogGame?.source !== "debrid" ? editDialogGame?.appId : undefined}
            manualGameId={editDialogGame?.source === "manual" ? editDialogGame.providerGameId : undefined}
            epicProviderGameId={editDialogGame?.source === "epic" ? editDialogGame.providerGameId : undefined}
            debridProviderGameId={editDialogGame?.source === "debrid" ? editDialogGame.providerGameId : undefined}
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            initialTab={editDialogInitialTab}
            game={editDialogGame ?? undefined}
            settings={{
              rawgApiKey: appSettings?.rawgApiKey ?? "",
              igdbClientId: appSettings?.igdbClientId ?? "",
              igdbClientSecret: appSettings?.igdbClientSecret ?? "",
              steamGridDbApiKey: appSettings?.steamGridDbApiKey ?? "",
              steamGridDbArtworkEnabled: appSettings?.steamGridDbArtworkEnabled ?? false,
            }}
          />
        )}
      </div>
    );
  }

  // Full mode (default): everything
  return (
    <div className="flex flex-col">
      {renderHeader()}
      {renderGameList()}
      {renderMenu()}
      {toolsModalOpen && (
        <ToolsModal open={toolsModalOpen} game={toolsGame} onClose={() => setToolsModalOpen(false)} />
      )}
      {editDialogOpen && (
          <GameEditDialog
            appId={editDialogGame?.source !== "manual" && editDialogGame?.source !== "epic" && editDialogGame?.source !== "debrid" ? editDialogGame?.appId : undefined}
            manualGameId={editDialogGame?.source === "manual" ? editDialogGame.providerGameId : undefined}
            epicProviderGameId={editDialogGame?.source === "epic" ? editDialogGame.providerGameId : undefined}
            debridProviderGameId={editDialogGame?.source === "debrid" ? editDialogGame.providerGameId : undefined}
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            initialTab={editDialogInitialTab}
            game={editDialogGame ?? undefined}
            settings={{
              rawgApiKey: appSettings?.rawgApiKey ?? "",
              igdbClientId: appSettings?.igdbClientId ?? "",
              igdbClientSecret: appSettings?.igdbClientSecret ?? "",
              steamGridDbApiKey: appSettings?.steamGridDbApiKey ?? "",
              steamGridDbArtworkEnabled: appSettings?.steamGridDbArtworkEnabled ?? false,
            }}
          />
      )}

      <UninstallGameDialog
        open={uninstallDialogOpen}
        onClose={() => { setUninstallDialogOpen(false); setUninstallTarget(null); }}
        gameId={uninstallTarget?.id ?? ""}
        gameTitle={uninstallTarget?.title ?? ""}
        appId={uninstallTarget?.appId}
        onDeleted={() => {
          if (uninstallTarget) {
            const rawId = normalizeManualGameId(uninstallTarget.providerGameId || uninstallTarget.id || "");
            if (rawId) removeManualGame(rawId);
            refresh();
          }
        }}
      />
    </div>
  );
}
