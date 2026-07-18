import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { countRender } from "../../services/perfCounters";
import {
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gamepad2,
  Heart,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  Settings,
  X,
  XCircle,
  Edit,
  Image,
  Trash2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { LibraryGame } from "../../types/libraryGame";
import type { LibraryAppInfoEntry } from "../../services/tauri";
import type { GameAppInfo } from "../../services/gameCacheService";
import { getLauncherGamePrimaryAction } from "../../utils/launcherGameActions";
import { useSettings } from "../../context/SettingsContext";
import { useInViewport } from "../../hooks/useInViewport";
import { useHoverPrefetch } from "../../hooks/useHoverPrefetch";
import { requestGameData, LoadPriority } from "../../services/gameDataService";
import AsyncImage from "../common/AsyncImage";
import Tooltip from "../common/Tooltip";
import CardActionMenu, { MenuItem } from "./CardActionMenu";
import { SkeletonBox } from "../common/Skeleton";
import {
  isHttpUrl,
  isLocalPath,
} from "../../services/libraryLocalCacheService";
import {
  loadGameAppInfoWithMediaFallback,
  resolveGameMediaUrl,
  resolveCanonicalDisplayTitle,
  resolveCanonicalName,
  resolveProviderMediaPreviewUrl,
  isPendingUninstall,
  markPendingUninstall,
  clearPendingUninstall,
  subscribePendingUninstall,
  getPendingUninstallVersion,
} from "../../services/gameCacheService";
import { useGameSession, computeGameKey } from "../../context/GameSessionContext";
import { useFavorites } from "../../context/FavoritesContext";
import { showSuccess, showError, showInfo, showWarning } from "../toast/GameToast";
import { openExternalUrl } from "../../services/externalLinks";
import { uninstallSteamApp, openSteamStoreApp, downloadAndInstallPackage, computeFileHash, markSyncIndexItem } from "../../services/tauri";
import { getEffectiveProviderAuthHeaders, buildProviderDownloadUrl } from "../../services/providerSearch";
import { findCachedSourceForApp } from "../../services/sourceAvailabilityCacheService";
import { defaultApiProviders } from "../../data/providers";
import type { PackageFileType } from "../../types/provider";
import { saveProviderStatusAfterInstall, saveProviderStatusAuthError, normalizeProviderId, type ProviderStatusOptions } from "../../services/providerStatusService";
import { getUpdateEntry } from "../../services/installedLuaScanner";
import type { SyncIndexItem } from "../../types/syncIndex";
import { getSteamStoreUrl } from "../../utils/steamLinks";
import { useInstallTracker } from "../../hooks/useInstallTracker";
import { useDownloadQueueContext } from "../../context/DownloadQueueContext";
import GameEditDialog from "./GameEditDialog";
import { removeManualGame, normalizeManualGameId } from "../../services/manualGameStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type GameLauncherTileProps = {
  game: LibraryGame;
  appInfoEntry?: LibraryAppInfoEntry | null;
  onSelect: (game: LibraryGame) => void;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
};

function getCardImage(
  mode: "landscape" | "poster",
  canonicalAppInfo: GameAppInfo | null,
): string | undefined {
  if (mode === "poster") {
    return (
      canonicalAppInfo?.media?.coverPath ||
      canonicalAppInfo?.media?.landscapePath ||
      canonicalAppInfo?.media?.backgroundPath ||
      undefined
    );
  }

  return (
    canonicalAppInfo?.media?.landscapePath ||
    canonicalAppInfo?.media?.backgroundPath ||
    canonicalAppInfo?.media?.coverPath ||
    undefined
  );
}

const DEBUG_MANUAL_REMOVE = false;

function areGameLauncherTilePropsEqual(prev: GameLauncherTileProps, next: GameLauncherTileProps): boolean {
  return (
    prev.game === next.game &&
    prev.appInfoEntry === next.appInfoEntry &&
    prev.onSelect === next.onSelect &&
    prev.onPlay === next.onPlay &&
    prev.onInstall === next.onInstall &&
    prev.onDeleteScript === next.onDeleteScript
  );
}

const MemoizedGameLauncherTile = React.memo(GameLauncherTileInner, areGameLauncherTilePropsEqual);

export default MemoizedGameLauncherTile;

function GameLauncherTileInner({
  game,
  appInfoEntry,
  onSelect,
  onPlay,
  onInstall,
  onDeleteScript,
}: GameLauncherTileProps) {
  countRender("GameLauncherTile");
  const { settings } = useSettings();
  const { ref, isVisible } = useInViewport();
  const { onMouseEnter, onMouseLeave } = useHoverPrefetch(game.appId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editInitialTab, setEditInitialTab] = useState<"general" | "media">("general");
  const { isFavorite, toggleFavorite } = useFavorites();
  const _favKey = game.appId || (game.source === "manual" ? game.libraryId : null) || game.id;
  const favorite = _favKey ? isFavorite(_favKey) : false;
  const [canonicalInfo, setCanonicalInfo] = useState<GameAppInfo | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const hasRequestedData = useRef(false);
  const hasMountedData = useRef(false);
  // Request game data via priority system when card enters viewport
  useEffect(() => {
    if (!game.appId || !isVisible || hasRequestedData.current) return;
    hasRequestedData.current = true;
    requestGameData(game.appId, LoadPriority.VIEWPORT);
  }, [game.appId, isVisible]);

  // Load canonical appinfo for this game — deferred until visible
  useEffect(() => {
    if (!game.appId || !isVisible) {
      if (!game.appId) setMediaLoading(false);
      return;
    }
    if (hasMountedData.current) return;
    hasMountedData.current = true;
    let cancelled = false;
    setMediaLoading(true);
    loadGameAppInfoWithMediaFallback(game.appId)
      .then(async (appInfo) => {
        if (cancelled) return;
        // Ensure canonical name is resolved — if appinfo.name is null/placeholder,
        // try metadata resolver and store details, and write back to disk.
        if (appInfo && (!appInfo.name || appInfo.name.startsWith("Steam App "))) {
          const resolvedName = await resolveCanonicalName(game.appId!);
          if (resolvedName) {
            appInfo.name = resolvedName;
          }
        }
        if (!cancelled) {
          setCanonicalInfo(appInfo);
          setMediaLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setMediaLoading(false);
      });
    return () => { cancelled = true; };
  }, [game.appId, isVisible]);

  const artworkMode = settings.libraryCardArtworkMode ?? "landscape";

  const displayTitle = game.customTitle || resolveCanonicalDisplayTitle(
    game.appId ?? "",
    game,
    appInfoEntry,
    canonicalInfo,
  );

  // Source trace log — emitted once per instance per game
  const DEBUG_NAME_SOURCE_TRACE = false;
  const displayTraced = useRef(false);
  if (DEBUG_NAME_SOURCE_TRACE && !displayTraced.current && game.appId) {
    displayTraced.current = true;
    const sources = [
      { key: "canonical", val: canonicalInfo?.name },
      { key: "appInfoEntry", val: appInfoEntry?.name },
      { key: "metadata", val: game?.metadata?.name },
      { key: "gameTitle", val: game?.title },
    ];
    const winner = sources.find((s) => s.val && !s.val.startsWith("Steam App "));
    console.log(`[NAME][SOURCE_TRACE] surface=grid appid=${game.appId} gameTitle=${game.title} canonicalName=${canonicalInfo?.name} metadataName=${game?.metadata?.name} final=${displayTitle} source=${winner?.key || "fallback"}`);
  }

  const displayImage = useMemo(
    () => getCardImage(artworkMode, canonicalInfo),
    [artworkMode, canonicalInfo]
  );

  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);
  const DEBUG_MANUAL_COVER = false;

  // Steam games: resolve via appId + canonical appinfo path
  useEffect(() => {
    if (!game.appId || !displayImage) {
      // Manual/Epic games: resolve provider-relative path directly
      if (!game.appId && (game.imageUrl || game.coverPath || game.landscapePath)) {
        const providerPath = game.imageUrl || (artworkMode === "poster" ? (game.coverPath || game.landscapePath) : (game.landscapePath || game.coverPath));
        if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][TILE_INPUT] title=${game.title} source=${game.source} appId=${game.appId} providerPath=${providerPath} canonicalInfo=${!!canonicalInfo}`);
        let cancelled = false;
        resolveProviderMediaPreviewUrl(providerPath!)
          .then((url) => {
            if (!cancelled) {
              if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][TILE_RESOLVED] imageUrl=${game.imageUrl} resolvedSrc=${url ?? "null"}`);
              setResolvedSrc(url ?? undefined);
            }
          })
          .catch((err) => {
            if (!cancelled) {
              if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][TILE_RESOLVED] imageUrl=${game.imageUrl} resolvedSrc=error error=${err instanceof Error ? err.message : String(err)}`);
              setResolvedSrc(undefined);
            }
          });
        return () => { cancelled = true; };
      }
      setResolvedSrc(undefined);
      return;
    }
    let cancelled = false;
    const logId = game.appId;
    resolveGameMediaUrl(logId, displayImage)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          if (DEBUG_NAME_SOURCE_TRACE) console.log(`[MEDIA][GRID] appid=${logId} selected=${artworkMode === "poster" ? "cover" : "landscape"} source=canonical url=true displayTitle=${displayTitle}`);
          setResolvedSrc(url);
        } else {
          if (DEBUG_NAME_SOURCE_TRACE) console.log(`[MEDIA][GRID] appid=${logId} selected=placeholder reason=resolve-failed path=${displayImage}`);
          setResolvedSrc(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc(undefined);
      });
    return () => { cancelled = true; };
  }, [game.appId, game.imageUrl, game.coverPath, game.landscapePath, displayImage, artworkMode]);

  // Render-time diagnostics — log once on state change, not every render
  // Disabled by default to reduce log spam. Set DEBUG_MEDIA_GRID=true in dev console to enable.
  const DEBUG_MEDIA_GRID = false;
  const renderLogRef = useRef<string | null>(null);
  const renderStateKey = `${game.appId}|${mediaLoading}|${!!resolvedSrc}|${!!displayImage}`;
  if (DEBUG_MEDIA_GRID && renderLogRef.current !== renderStateKey) {
    renderLogRef.current = renderStateKey;
    console.log(`[MEDIA][GRID_RENDER] appid=${game.appId} mediaLoading=${mediaLoading} hasResolvedSrc=${!!resolvedSrc} hasDisplayImage=${!!displayImage}`);
  }

  // Raw local path for data URL fallback (only if it's an absolute local file path)
  const fallbackLocalPath = useMemo(() => {
    if (!displayImage) return null;
    if (isHttpUrl(displayImage)) return null;
    if (!isLocalPath(displayImage)) return null;
    return displayImage;
  }, [displayImage]);

  const { getState, stopSession } = useGameSession();
  const gk = computeGameKey(game);
  const sessionState = getState(gk);
  const isRunning = sessionState === "running";
  const action = getLauncherGamePrimaryAction(game);
  const hasLua = game.luaScripts.length > 0;
  const { installState, dismiss } = useInstallTracker(game.appId);
  const { getJobByAppId } = useDownloadQueueContext();
  const installJob = game.appId ? getJobByAppId(game.appId) : undefined;
  const activeInstallStatuses: string[] = ["queued", "waiting", "checking", "downloading", "extracting", "installing", "paused"];
  const hasActiveInstall = installJob?.type === "steam-install" && activeInstallStatuses.includes(installJob.status);
  // Subscribe to pending uninstall state changes so React re-renders when the module-level Map changes
  useSyncExternalStore(subscribePendingUninstall, getPendingUninstallVersion, getPendingUninstallVersion);
  const hasPendingUninstall = game.appId ? isPendingUninstall(game.appId) : false;
  const [updateRunning, setUpdateRunning] = useState(false);

  // Subscribe to Lua update status
  const [luaUpdateStatus, setLuaUpdateStatus] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    import("../../services/installedLuaScanner").then((mod) => {
      if (cancelled) return;
      const s = game.appId ? mod.getUpdateStatus(game.appId) : undefined;
      if (!cancelled) setLuaUpdateStatus(s);
      const unsub = mod.subscribeUpdateStatus(() => {
        if (!cancelled && game.appId) setLuaUpdateStatus(mod.getUpdateStatus(game.appId));
      });
      return unsub;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [game.appId]);

  async function handleUpdatePackage() {
    if (!game.appId) return;
    const entry = getUpdateEntry(game.appId);
    if (!entry || entry.status !== "update-available") return;
    const providerId = entry.providerId;
    if (!providerId) {
      showError("Provider not found for this package.", { title: "Update" });
      return;
    }

    setUpdateRunning(true);
    try {
      if (!settings.luaPath || !settings.depotcachePath) {
        showWarning("Configure Lua and Depot paths in Settings.", { title: "Paths required" });
        return;
      }

      // Resolve source via cascading fallback:
      //   1. game.sources (match by normalized providerId)
      //   2. sourceAvailabilityCache (findCachedSourceForApp)
      //   3. Provider definition + downloadUrlTemplate
      const normalizedProviderId = normalizeProviderId(providerId);
      let source = game.sources.find((s) =>
        normalizeProviderId(s.providerId) === normalizedProviderId && s.downloadUrl
      );
      if (!source || !source.downloadUrl) {
        source = await findCachedSourceForApp(game.appId!, providerId);
      }
      if (!source || !source.downloadUrl) {
        // Reconstruct from provider definition
        const providerDef = defaultApiProviders.find(
          (p) => normalizeProviderId(p.id) === normalizedProviderId
        );
        if (providerDef) {
          const downloadUrl = buildProviderDownloadUrl(providerDef, game.appId!, settings, "zip");
          if (downloadUrl) {
            const authHeaders = getEffectiveProviderAuthHeaders(providerId, settings);
            source = {
              providerId: providerDef.id,
              providerName: providerDef.name,
              fileType: "zip" as PackageFileType,
              available: true,
              downloadUrl,
              authHeaders,
            };
          }
        }
      }
      if (!source || !source.downloadUrl) {
        console.log(`[PACKAGE][CARD_UPDATE_SOURCE_MISS] appid=${game.appId} provider=${providerId} reason=no-match-in-sources-cache-or-provider-def`);
        showError("Source required. Open Store Details to choose a source.", { title: "Update" });
        return;
      }

      // Rebuild auth headers fresh from settings at request time (never from cache)
      const effectiveHeaders = source.authHeaders ?? getEffectiveProviderAuthHeaders(providerId, settings);

      console.log(`[PACKAGE][CARD_UPDATE_START] appid=${game.appId} provider=${providerId}`);

      showSuccess(`Updating from ${source.providerName}...`, { title: "Update started" });

      await downloadAndInstallPackage({
        jobId: `card-update-${game.appId}-${Date.now()}`,
        downloadUrl: source.downloadUrl,
        luaTarget: settings.luaPath,
        depotcacheTarget: settings.depotcachePath,
        createBackups: true,
        headers: effectiveHeaders,
      });

      // Compute local hash for sync index
      const luaScript = game.luaScripts[0];
      let localHash: string | undefined;
      if (luaScript) {
        try { localHash = await computeFileHash(luaScript.path); } catch { /* optional */ }
      }
      const now = new Date().toISOString();
      const syncItem: SyncIndexItem = {
        appId: game.appId,
        sourceKey: `${source.providerId}:${source.fileType}`,
        providerId: source.providerId,
        providerName: source.providerName,
        fileType: source.fileType,
        installedPath: luaScript?.path || "",
        lastDownloadUrl: source.downloadUrl,
        remoteHash: undefined,
        localHash: localHash || undefined,
        etag: undefined,
        lastModified: undefined,
        installedAt: now,
        updatedAt: now,
        lastCheckedAt: now,
        status: "up-to-date",
      };
      await markSyncIndexItem(syncItem);

      // Save provider status as up-to-date (triggers store → subscribers → UI updates)
      const hubcapConfig = (settings.providers?.hubcapdb?.baseUrl && settings.providers?.hubcapdb?.apiKey)
        ? { baseUrl: settings.providers.hubcapdb.baseUrl, apiKey: settings.providers.hubcapdb.apiKey }
        : undefined;
      const providerOpts: ProviderStatusOptions = {
        luaDir: settings.luaPath || undefined,
        steamRoot: settings.steamRoot || undefined,
      };
      await saveProviderStatusAfterInstall(game.appId, providerId, hubcapConfig, providerOpts);

      showSuccess(`Package updated successfully.`, { title: "Update complete" });
      console.log(`[PACKAGE][CARD_UPDATE_SUCCESS] appid=${game.appId} provider=${providerId}`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PACKAGE][CARD_UPDATE_FAILED] appid=${game.appId} provider=${providerId} error=${errMsg}`);

      // Parse HTTP status from error message for auth/rate-limit handling
      const statusMatch = errMsg.match(/Status:\s*(\d{3})/);
      if (statusMatch) {
        const statusCode = parseInt(statusMatch[1], 10);
        if (statusCode === 401) {
          await saveProviderStatusAuthError(game.appId, providerId, "auth-required", "unauthorized").catch(() => {});
          showError("Update failed: Auth required. Check API key in Settings.", { title: "Unauthorized" });
          console.log(`[PACKAGE][CARD_UPDATE_AUTH_ERROR] appid=${game.appId} status=401 reason=unauthorized`);
        } else if (statusCode === 403) {
          await saveProviderStatusAuthError(game.appId, providerId, "auth-required", "forbidden").catch(() => {});
          showError("Update failed: Forbidden. Check API key permissions.", { title: "Forbidden" });
          console.log(`[PACKAGE][CARD_UPDATE_AUTH_ERROR] appid=${game.appId} status=403 reason=forbidden`);
        } else if (statusCode === 429) {
          await saveProviderStatusAuthError(game.appId, providerId, "rate-limited", "rate-limited").catch(() => {});
          showError("Update failed: Rate limited. Try again later.", { title: "Rate limited" });
          console.log(`[PACKAGE][CARD_UPDATE_AUTH_ERROR] appid=${game.appId} status=429 reason=rate-limited`);
        } else {
          showError(`Update failed: ${errMsg.slice(0, 200)}`, { title: "Error" });
        }
      } else {
        showError(`Update failed: ${errMsg.slice(0, 200)}`, { title: "Error" });
      }
    } finally {
      setUpdateRunning(false);
    }
  }

  function handleCardClick() {
    setMenuOpen(false);
    onSelect(game);
  }

  function handleActionClick(e: React.MouseEvent, cb: () => void) {
    e.stopPropagation();
    setMenuOpen(false);
    cb();
  }

  function handleMenuToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setContextMenuPos(null);
    setMenuOpen((prev) => !prev);
  }

  return (
    <div ref={ref} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenuPos({ x: e.clientX, y: e.clientY }); setMenuOpen(true); }} className="lf-game-card group flex flex-col rounded-2xl bg-transparent transition hover:bg-white/[0.04] focus-within:ring-2 focus-within:ring-(--color-accent)/20 lf-press-effect">
      {/* Image */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick();
          }
        }}
        className={`relative cursor-pointer overflow-hidden rounded-t-2xl ${artworkMode === "poster" ? "aspect-[2/3]" : "aspect-[5/3]"
          }`}
      >
        {mediaLoading ? (
          <SkeletonBox className="h-full w-full rounded-t-2xl" />
        ) : resolvedSrc ? (
          <AsyncImage
            src={resolvedSrc}
            alt={displayTitle}
            className="h-full w-full object-cover"
            fallbackLocalPath={fallbackLocalPath}
            fallback={
              <Gamepad2 className="h-8 w-8 text-(--color-muted)/40" />
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/[0.02]">
            <Gamepad2 className="h-8 w-8 text-(--color-muted)/30" />
          </div>
        )}
        <div className="absolute inset-0 rounded-t-2xl bg-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 pointer-events-none" />
        {luaUpdateStatus === "update-available" && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-black">
            Update
          </span>
        )}
      </div>

      {/* Title + actions row */}
      <div className="flex items-start gap-1 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <Tooltip label={displayTitle} delay={400}>
            <h3
              role="button"
              tabIndex={0}
              onClick={handleCardClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick();
                }
              }}
              className="lf-card-title line-clamp-1 cursor-pointer text-xs font-medium text-(--color-text)/90 transition hover:text-(--color-accent)"
            >
              {displayTitle}
            </h3>
          </Tooltip>

          <div className="mt-1.5 flex items-center gap-2">
            {hasActiveInstall ? (
              <div className="flex w-full flex-col gap-1">
                <div className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400/80">
                  <Loader2 className="h-3 w-3 animate-spin" />
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
                  {installJob.bytesRead !== undefined && installJob.totalBytes !== undefined && installJob.totalBytes > 0 && (
                    <span className="text-[10px] text-amber-400/40">
                      {formatBytes(installJob.bytesRead)} / {formatBytes(installJob.totalBytes)}
                    </span>
                  )}
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  {installJob.progressMode === "determinate" && installJob.progress > 0 ? (
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all duration-500 ease-out"
                      style={{ width: `${Math.min(100, installJob.progress)}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-400/50" />
                  )}
                </div>
              </div>
            ) : installState.status === "timeout" ? (
              <div className="inline-flex items-center gap-1.5">
                <span className="text-[11px] text-amber-400/70">Install stuck?</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onInstall(game); }}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
                >
                  <Download className="h-3 w-3" />
                  Retry
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); dismiss(); }}
                  className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-muted)/50 transition hover:text-(--color-muted)"
                >
                  <X className="h-3 w-3" />
                  Dismiss
                </button>
              </div>
            ) : hasPendingUninstall ? (
              <div className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400/70">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uninstalling…
              </div>
            ) : (
              <>
                {action === "play" && (
                  <button
                    type="button"
                    onClick={(e) => handleActionClick(e, () => onPlay(game))}
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
                  >
                    <Play className="h-3 w-3" />
                    Play
                  </button>
                )}
                {action === "install" && (
                  <button
                    type="button"
                    onClick={(e) => handleActionClick(e, () => onInstall(game))}
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
                  >
                    <Download className="h-3 w-3" />
                    Install
                  </button>
                )}
                {action === "open-steam" && (
                  <button
                    type="button"
                    onClick={(e) => handleActionClick(e, () => {
                      if (game.appId) openExternalUrl(getSteamStoreUrl(Number(game.appId)));
                    })}
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open in Steam
                  </button>
                )}
                {action === "open-lua-folder" && (
                  <button
                    type="button"
                    onClick={(e) => handleActionClick(e, () => {
                      if (game.luaScripts.length > 0) {
                        const scriptPath = game.luaScripts[0].path;
                        const scriptDir = scriptPath.substring(0, Math.max(scriptPath.lastIndexOf('/'), scriptPath.lastIndexOf('\\')));
                        if (scriptDir) invoke("open_folder", { path: scriptDir }).catch((err) => showError(`Could not open folder: ${err}`));
                      }
                    })}
                    className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-(--color-accent)/80 transition hover:text-(--color-accent)"
                  >
                    <FolderOpen className="h-3 w-3" />
                    Lua Folder
                  </button>
                )}
                {action === "missing-path" && (
                  <span className="text-[10px] text-(--color-muted)/50">Missing Path</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Three-dots menu */}
        <div className="relative shrink-0">
          <Tooltip label="More actions" delay={600} disabled={menuOpen}>
            <button
              ref={menuAnchorRef}
              type="button"
              aria-label="More actions"
              onClick={handleMenuToggle}
              className="inline-flex cursor-pointer items-center justify-center rounded-lg p-1 text-(--color-muted)/50 transition hover:bg-white/[0.04] hover:text-(--color-text)"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <CardActionMenu
            open={menuOpen}
            anchorRef={menuAnchorRef}
            onClose={() => { setMenuOpen(false); setContextMenuPos(null); }}
            cursorPos={contextMenuPos}
            gameId={game.appId}
          >
            {isRunning ? (
              <MenuItem
                label="Stop"
                icon={<X className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); stopSession(gk); }}
              />
            ) : action === "play" ? (
              <MenuItem
                label="Play"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); onPlay(game); }}
              />
            ) : action === "open-steam" ? (
              <MenuItem
                label="Open in Steam"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); if (game.appId) openExternalUrl(getSteamStoreUrl(Number(game.appId))); }}
              />
            ) : action === "open-lua-folder" ? (
              <MenuItem
                label="Lua Folder"
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  if (game.luaScripts.length > 0) {
                    const scriptPath = game.luaScripts[0].path;
                    const scriptDir = scriptPath.substring(0, Math.max(scriptPath.lastIndexOf('/'), scriptPath.lastIndexOf('\\')));
                    if (scriptDir) invoke("open_folder", { path: scriptDir }).catch((err) => showError(`Could not open folder: ${err}`));
                  }
                }}
              />
            ) : !hasActiveInstall ? (
              <MenuItem
                label="Install"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); onInstall(game); }}
              />
            ) : (
              <MenuItem
                label={installJob?.status === "waiting" || installJob?.status === "queued" ? "Waiting for Steam…" : "Installing…"}
                icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                disabled
              />
            )}
            {luaUpdateStatus === "update-available" && (
              <MenuItem
                label="Update Package"
                icon={<RefreshCw className={`h-3.5 w-3.5 ${updateRunning ? "animate-spin" : ""}`} />
                }
                disabled={updateRunning}
                onClick={() => {
                  setMenuOpen(false);
                  handleUpdatePackage();
                }}
              />
            )}
            <MenuItem
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              icon={<Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />}
              onClick={() => { const fk = game.appId || (game.source === "manual" ? game.libraryId : null) || game.id; if (fk) toggleFavorite(fk); setMenuOpen(false); }}
            />
            {game.appId && game.source !== "epic" && (
              <MenuItem
                label="Open in Steam"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); openExternalUrl(getSteamStoreUrl(Number(game.appId))); }}
              />
            )}
            <MenuItem
              label="Browse Local Files"
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                if (game.installDir) {
                  invoke("open_folder", { path: game.installDir }).catch((err) => {
                    showError(`Could not open folder: ${err}`);
                  });
                }
              }}
            />
            <MenuItem
              label="Create Shortcut"
              icon={<FileText className="h-3.5 w-3.5" />}
              onClick={async () => {
                setMenuOpen(false);

                try {
                  if (!game?.appId && !game?.executablePath && !game?.installDir) {
                    showError("Game location not available");
                    return;
                  }

                  const { getExePathFromEntry, setInstalledGameEntry } = await import(
                    "../../services/installedGamesRegistry"
                  );

                  let exePath = game.appId ? await getExePathFromEntry(game.appId) : undefined;

                  if (!exePath && game.executablePath) {
                    exePath = game.executablePath;
                  }

                  if (!exePath && game.installDir) {
                    const { discoverExecutables } = await import(
                      "../../services/tauri"
                    );

                    const executables = await discoverExecutables(game.installDir);

                    if (executables?.length > 0) {
                      const validExe =
                        executables.find(e =>
                          !["launcher", "crash", "setup"].some(x =>
                            e.file_name.toLowerCase().includes(x)
                          )
                        ) || executables[0];

                      exePath = validExe.exe_path;


                      await setInstalledGameEntry({
                        gameId: game.appId ?? "",
                        exePath: validExe.exe_path,
                        exeName: validExe.file_name,
                        installDir: game.installDir,
                        provider: "unknown",
                        lastValidated: Date.now(),
                      });
                    }
                  }

                  if (!exePath) {
                    showError("Could not locate executable for this game");
                    return;
                  }

                  const path = await invoke<string>("create_shortcut", {
                    exePath,
                    name: game.title || `Game ${game.appId}`,
                  });

                  showSuccess(`Shortcut created:\n${path}`);

                } catch (err) {
                  showError(`Could not create shortcut: ${err}`);
                }
              }}
            />

            <MenuItem
              label="Manage"
              icon={<Settings className="h-3.5 w-3.5" />}
              children={[
                {
                  label: "Edit Game Details",
                  icon: <Edit className="h-3.5 w-3.5" />,
                  onClick: () => { setMenuOpen(false); setEditInitialTab("general"); setEditDialogOpen(true); },
                },
                {
                  label: "Manage Artwork",
                  icon: <Image className="h-3.5 w-3.5" />,
                  onClick: () => { setMenuOpen(false); setEditInitialTab("media"); setEditDialogOpen(true); },
                },
                    ...(game.source === "manual"
                    ? [{
                        label: "Delete Manual Game",
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        destructive: true as const,
                        onClick: () => {
                          setMenuOpen(false);
                          const rawId = normalizeManualGameId(game.providerGameId || game.id || "");
                          if (rawId) {
                            try {
                              if (DEBUG_MANUAL_REMOVE) console.log(`[MANUAL_REMOVE][TILE] rawId=${rawId} title="${game.title}"`);
                              removeManualGame(rawId);
                              showSuccess(`"${game.title ?? rawId}" deleted from library`);
                            } catch (e) {
                              showError(`Failed to delete: ${e}`);
                            }
                          }
                        },
                      }]
                  : []),
                ...(hasPendingUninstall
                  ? [{
                    label: "Cancel tracking",
                    icon: <XCircle className="h-3.5 w-3.5" />,
                    onClick: () => {
                      setMenuOpen(false);
                      console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel before=${isPendingUninstall(String(game.appId))}`);
                      clearPendingUninstall(String(game.appId));
                      showInfo(`"${game.title ?? game.appId}" uninstall tracking cancelled.`);
                      console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel after=${isPendingUninstall(String(game.appId))}`);
                    },
                  }]
                    : game.source !== "manual" && game.source !== "epic"
                      ? [{
                        label: "Uninstall in Steam",
                        icon: <ExternalLink className="h-3.5 w-3.5" />,
                        disabled: !game.steamInstalled,
                        subtitle: !game.steamInstalled ? "Not installed" : undefined,
                      onClick: game.steamInstalled ? async () => {
                        setMenuOpen(false);
                        const appId = Number(game.appId);
                        markPendingUninstall(String(appId));
                        showInfo("Steam uninstall opened. Complete uninstall in Steam. LumaForge will update automatically.", { title: "Uninstall" });
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
                ...(hasLua
                  ? [{
                    label: "Delete Lua",
                    icon: <X className="h-3.5 w-3.5" />,
                    destructive: true as const,
                    onClick: onDeleteScript
                      ? () => { setMenuOpen(false); onDeleteScript(game); }
                      : undefined,
                    disabled: !onDeleteScript,
                  }]
                  : []),
              ]}
            />
          </CardActionMenu>
        </div>

        {(game.appId || game.source === "manual" || game.source === "epic") && (
          <GameEditDialog
            appId={game.appId}
            manualGameId={game.source === "manual" ? game.providerGameId : undefined}
            epicProviderGameId={game.source === "epic" ? game.providerGameId : undefined}
            open={editDialogOpen}
            onClose={() => setEditDialogOpen(false)}
            initialTab={editInitialTab}
            game={game}
            settings={{
              rawgApiKey: settings.rawgApiKey,
              igdbClientId: settings.igdbClientId,
              igdbClientSecret: settings.igdbClientSecret,
              steamGridDbApiKey: settings.steamGridDbApiKey,
              steamGridDbArtworkEnabled: settings.steamGridDbArtworkEnabled,
            }}
          />
        )}
      </div>
    </div>
  );
}


