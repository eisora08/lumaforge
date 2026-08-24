import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { countRender } from "../../services/perfCounters";
import {
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  FolderOpen,
  Gamepad2,
  Heart,
  Loader2,
  Play,
  RefreshCw,
  Settings,
  X,
  XCircle,
  Edit,
  Image,
  Trash2,
  Wrench,
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
  getFavoriteKey,
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
import ToolsModal from "../tools/ToolsModal";
import { removeManualGame, normalizeManualGameId } from "../../services/manualGameStore";
import { updateDebridGame, removeDebridGameFromLibrary } from "../../services/debridGameStore";
import { open } from "@tauri-apps/plugin-dialog";


type GameLauncherTileProps = {
  game: LibraryGame;
  appInfoEntry?: LibraryAppInfoEntry | null;
  onSelect: (game: LibraryGame) => void;
  onPlay: (game: LibraryGame) => void;
  onInstall: (game: LibraryGame) => void;
  onDeleteScript?: (game: LibraryGame) => void;
  onHoverStart?: (game: LibraryGame, rect: DOMRect) => void;
  onHoverEnd?: () => void;
  onOverlayToggle?: (open: boolean) => void;
};

function getCardImage(
  mode: "landscape" | "poster",
  canonicalAppInfo: GameAppInfo | null,
): string | undefined {
  const media = canonicalAppInfo?.media;
  if (!media) return undefined;

  if (mode === "poster") {
    return (
      [media.coverPath, media.landscapePath, media.backgroundPath]
        .find((p): p is string => !!p && isLocalPath(p)) ||
      media.coverPath ||
      media.landscapePath ||
      media.backgroundPath ||
      undefined
    );
  }

  return (
    [media.landscapePath, media.backgroundPath, media.coverPath]
      .find((p): p is string => !!p && isLocalPath(p)) ||
    media.landscapePath ||
    media.backgroundPath ||
    media.coverPath ||
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
    prev.onDeleteScript === next.onDeleteScript &&
    prev.onHoverStart === next.onHoverStart &&
    prev.onHoverEnd === next.onHoverEnd &&
    prev.onOverlayToggle === next.onOverlayToggle
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
  onHoverStart,
  onHoverEnd,
  onOverlayToggle,
}: GameLauncherTileProps) {
  countRender("GameLauncherTile");
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { ref, isVisible } = useInViewport();
  const { onMouseEnter: prefetchEnter, onMouseLeave: prefetchLeave } = useHoverPrefetch(game.appId);
  const rootRef = useRef<HTMLDivElement>(null);

  const handleHoverEnter = useCallback(() => {
    prefetchEnter();
    if (onHoverStart && rootRef.current) {
      onHoverStart(game, rootRef.current.getBoundingClientRect());
    }
  }, [prefetchEnter, onHoverStart, game]);

  const handleHoverLeave = useCallback(() => {
    prefetchLeave();
    onHoverEnd?.();
  }, [prefetchLeave, onHoverEnd]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editInitialTab, setEditInitialTab] = useState<"details" | "media">("details");
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const _favKey = getFavoriteKey(game);
  const favorite = _favKey ? isFavorite(_favKey) : false;
  const [canonicalInfo, setCanonicalInfo] = useState<GameAppInfo | null>(null);
  const [mediaLoading, setMediaLoading] = useState(true);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const hasRequestedData = useRef(false);
  // Request game data via priority system when card enters viewport
  useEffect(() => {
    if (!game.appId || !isVisible || hasRequestedData.current) return;
    hasRequestedData.current = true;
    requestGameData(game.appId, LoadPriority.VIEWPORT);
  }, [game.appId, isVisible]);

  // Load canonical appinfo for this game — re-runs when media paths change
  useEffect(() => {
    if (!game.appId || !isVisible) {
      if (!game.appId) setMediaLoading(false);
      return;
    }
    let cancelled = false;
    setMediaLoading(true);
    loadGameAppInfoWithMediaFallback(game.appId)
      .then(async (appInfo) => {
        if (cancelled) return;
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
  }, [game.appId, isVisible, game.coverPath, game.landscapePath, game.backgroundPath]);

  const artworkMode = settings.libraryCardArtworkMode ?? "landscape";

  const displayTitle = game.customTitle || resolveCanonicalDisplayTitle(
    game.appId ?? "",
    game,
    appInfoEntry,
    canonicalInfo,
  );

  const developer = game.metadata?.developer || game.metadata?.publishers?.[0];

  // Source trace log â€” emitted once per instance per game
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

  // Render-time diagnostics â€” log once on state change, not every render
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
  useInstallTracker(game.appId);
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
      showError(t("game_tile.toast_provider_not_found", "Provider not found for this package."), { title: t("game_tile.update", "Update") });
      return;
    }

    setUpdateRunning(true);
    try {
      if (!settings.luaPath || !settings.depotcachePath) {
        showWarning(t("game_tile.toast_paths_required", "Configure Lua and Depot paths in Settings."), { title: t("game_tile.toast_paths_required_title", "Paths required") });
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
        showError(t("game_tile.toast_source_required", "Source required. Open Store Details to choose a source."), { title: t("game_tile.update", "Update") });
        return;
      }

      // Rebuild auth headers fresh from settings at request time (never from cache)
      const effectiveHeaders = source.authHeaders ?? getEffectiveProviderAuthHeaders(providerId, settings);

      console.log(`[PACKAGE][CARD_UPDATE_START] appid=${game.appId} provider=${providerId}`);

      showSuccess(t("game_tile.toast_updating_from", "Updating from {{provider}}...", { provider: source.providerName }), { title: t("game_tile.toast_update_started", "Update started") });

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

      // Save provider status as up-to-date (triggers store â†’ subscribers â†’ UI updates)
      const hubcapConfig = (settings.providers?.hubcapdb?.baseUrl && settings.providers?.hubcapdb?.apiKey)
        ? { baseUrl: settings.providers.hubcapdb.baseUrl, apiKey: settings.providers.hubcapdb.apiKey }
        : undefined;
      const providerOpts: ProviderStatusOptions = {
        luaDir: settings.luaPath || undefined,
        steamRoot: settings.steamRoot || undefined,
      };
      await saveProviderStatusAfterInstall(game.appId, providerId, hubcapConfig, providerOpts);

      showSuccess(t("game_tile.toast_update_success", "Package updated successfully."), { title: t("game_tile.toast_update_complete", "Update complete") });
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
          showError(t("game_tile.toast_auth_required", "Update failed: Auth required. Check API key in Settings."), { title: t("game_tile.toast_unauthorized", "Unauthorized") });
          console.log(`[PACKAGE][CARD_UPDATE_AUTH_ERROR] appid=${game.appId} status=401 reason=unauthorized`);
        } else if (statusCode === 403) {
          await saveProviderStatusAuthError(game.appId, providerId, "auth-required", "forbidden").catch(() => {});
          showError(t("game_tile.toast_forbidden", "Update failed: Forbidden. Check API key permissions."), { title: t("game_tile.toast_forbidden_title", "Forbidden") });
          console.log(`[PACKAGE][CARD_UPDATE_AUTH_ERROR] appid=${game.appId} status=403 reason=forbidden`);
        } else if (statusCode === 429) {
          await saveProviderStatusAuthError(game.appId, providerId, "rate-limited", "rate-limited").catch(() => {});
          showError(t("game_tile.toast_rate_limited", "Update failed: Rate limited. Try again later."), { title: t("game_tile.toast_rate_limited_title", "Rate limited") });
          console.log(`[PACKAGE][CARD_UPDATE_AUTH_ERROR] appid=${game.appId} status=429 reason=rate-limited`);
        } else {
          showError(`${t("game_tile.toast_update_failed", "Update failed")}: ${errMsg.slice(0, 200)}`, { title: t("toast.error", "Something went wrong") });
        }
      } else {
        showError(`${t("game_tile.toast_update_failed", "Update failed")}: ${errMsg.slice(0, 200)}`, { title: t("toast.error", "Something went wrong") });
      }
    } finally {
      setUpdateRunning(false);
    }
  }

  function handleCardClick() {
    setMenuOpen(false);
    onSelect(game);
  }

  return (
    <div ref={(node) => { ref.current = node; rootRef.current = node; }} onMouseEnter={handleHoverEnter} onMouseLeave={handleHoverLeave} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenuPos({ x: e.clientX, y: e.clientY }); setMenuOpen(true); onOverlayToggle?.(true); onHoverEnd?.(); }} className="lf-game-card group overflow-hidden rounded-2xl bg-transparent transition hover:bg-white/[0.04] focus-within:ring-2 focus-within:ring-(--color-accent)/20 lf-press-effect">
      {/* Image — fills entire card */}
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
        className={`relative cursor-pointer overflow-hidden ${artworkMode === "poster" ? "aspect-[2/3]" : "aspect-[5/3]"}`}
      >
        {mediaLoading ? (
          <SkeletonBox className="h-full w-full" />
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

        {/* Always-visible title gradient at bottom */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2.5 pb-2">
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
              className="lf-card-title line-clamp-1 cursor-pointer text-[13px] font-semibold text-white transition hover:text-white/90"
            >
              {displayTitle}
            </h3>
          </Tooltip>
        </div>

        {/* Hover overlay — mode-dependent */}
        {settings.libraryHoverMode === "inline" ? (
          /* ── Inline mode: full info slide-up (store-style) ── */
          <div className="absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/50 pointer-events-none">
            <div className="absolute inset-x-0 bottom-0 z-10 translate-y-2 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
              <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5 pb-2">
                <h3 className="line-clamp-1 text-[13px] font-semibold text-white drop-shadow-lg">{displayTitle}</h3>
                {developer && (
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-white/70">{developer}</p>
                )}
                {game.metadata?.genres && game.metadata.genres.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {game.metadata.genres.slice(0, 2).map((genre) => (
                      <span key={genre} className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-medium text-white/80 backdrop-blur-sm">
                        {genre}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-1.5">
                  {(() => {
                    const srcBadge = game.hasLua
                      ? { label: "LUA", cls: "bg-emerald-500/30 text-emerald-300" }
                      : game.source === "epic"
                        ? { label: "EPIC", cls: "bg-purple-500/30 text-purple-300" }
                        : game.source === "debrid"
                          ? { label: "DEBRID", cls: "bg-cyan-500/30 text-cyan-300" }
                          : game.source === "manual"
                            ? { label: "MANUAL", cls: "bg-amber-500/30 text-amber-300" }
                            : game.source === "steam"
                              ? { label: "STEAM", cls: "bg-blue-500/30 text-blue-300" }
                              : null;
                    if (!srcBadge) return null;
                    return (
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide ${srcBadge.cls}`}>
                        {srcBadge.label}
                      </span>
                    );
                  })()}
                  {game.repacker && (
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide text-cyan-300">
                      {game.repacker}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Preview mode: subtle tint (popup handled by Library.tsx) ── */
          <div className="absolute inset-0 bg-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 pointer-events-none" />
        )}

        {/* Update badge — always visible (important notification) */}
        {luaUpdateStatus === "update-available" && game.steamInstalled && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium leading-tight text-black">
            {t("game_tile.update", "Update")}
          </span>
        )}
      </div>

      {/* Right-click context menu (no visible button on card) */}
      <CardActionMenu
        open={menuOpen}
        anchorRef={menuAnchorRef}
        onClose={() => { setMenuOpen(false); setContextMenuPos(null); onOverlayToggle?.(false); }}
        cursorPos={contextMenuPos}
        gameId={game.appId}
      >
            {isRunning ? (
              <MenuItem
                label={t("context_menu.stop", "Stop")}
                icon={<X className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); stopSession(gk); }}
              />
            ) : action === "play" ? (
              <MenuItem
                label={t("context_menu.play", "Play")}
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); onPlay(game); }}
              />
            ) : action === "open-steam" ? (
              <MenuItem
                label={t("context_menu.open_steam", "Open in Steam")}
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); if (game.appId) openExternalUrl(getSteamStoreUrl(Number(game.appId))); }}
              />
            ) : action === "open-lua-folder" ? (
              <MenuItem
                label={t("context_menu.lua_folder", "Lua Folder")}
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  if (game.luaScripts.length > 0) {
                    const scriptPath = game.luaScripts[0].path;
                    const scriptDir = scriptPath.substring(0, Math.max(scriptPath.lastIndexOf('/'), scriptPath.lastIndexOf('\\')));
                    if (scriptDir) invoke("open_folder", { path: scriptDir }).catch((err) => showError(t("context_menu.open_folder_error", "Could not open folder: {{error}}", { error: String(err) })));
                  }
                }}
              />
            ) : action === "installing" ? (
              <MenuItem
                label={t("context_menu.installing", "Installing")}
                icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                disabled
              />
            ) : action === "select-exe" ? (
              <MenuItem
                label={t("context_menu.select_exe", "Select Executable")}
                icon={<FileSearch className="h-3.5 w-3.5" />}
                onClick={() => {
                  setMenuOpen(false);
                  (async () => {
                    try {
                      const selected = await open({
                        title: t("debrid.select_exe", "Select game executable"),
                        filters: [{ name: "Executables", extensions: ["exe", "com", "bat"] }],
                        defaultPath: game.installDir || "C:\\",
                        multiple: false,
                      });
                      if (selected && game.providerGameId) {
                        updateDebridGame(game.providerGameId, game.installDir || "", selected);
                        showSuccess(t("debrid.exe_set", "Game executable set. Ready to play!"));
                      }
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      showError(t("debrid.file_picker_failed", "File picker failed: {{error}}", { error: msg }));
                    }
                  })();
                }}
              />
            ) : !hasActiveInstall ? (
              <MenuItem
                label={t("context_menu.install", "Install")}
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); onInstall(game); }}
              />
            ) : (
              <MenuItem
                label={installJob?.status === "waiting" || installJob?.status === "queued" ? t("context_menu.waiting_steam", "Waiting for Steam…") : t("context_menu.installing", "Installing…")}
                icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                disabled
              />
            )}
            {luaUpdateStatus === "update-available" && game.steamInstalled && (
              <MenuItem
                label={t("context_menu.update_package", "Update Package")}
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
              label={favorite ? t("context_menu.remove_favorites", "Remove from favorites") : t("context_menu.add_favorites", "Add to favorites")}
              icon={<Heart className={`h-3.5 w-3.5 ${favorite ? "fill-current" : ""}`} />}
              onClick={() => { const fk = getFavoriteKey(game); if (fk) toggleFavorite(fk); setMenuOpen(false); }}
            />
            {game.appId && game.source !== "epic" && game.source !== "debrid" && (
              <MenuItem
                label={t("context_menu.open_steam", "Open in Steam")}
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => { setMenuOpen(false); openExternalUrl(getSteamStoreUrl(Number(game.appId))); }}
              />
            )}
            <MenuItem
              label={t("context_menu.browse_files", "Browse Local Files")}
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                const exe = game.executablePath || "";
                const sep = Math.max(exe.lastIndexOf("\\"), exe.lastIndexOf("/"));
                const folder = (sep > 0 ? exe.substring(0, sep) : null) || game.installDir || "";
                if (folder) {
                  invoke("open_folder", { path: folder }).catch((err) => {
                    showError(t("context_menu.open_folder_error", "Could not open folder: {{error}}", { error: String(err) }));
                  });
                }
              }}
            />
            <MenuItem
              label={t("context_menu.create_shortcut", "Create Shortcut")}
              icon={<FileText className="h-3.5 w-3.5" />}
              onClick={async () => {
                setMenuOpen(false);

                try {
                  if (!game?.appId && !game?.executablePath && !game?.installDir) {
                    showError(t("context_menu.game_location_unavailable", "Game location not available"));
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
                    showError(t("context_menu.exe_not_located", "Could not locate executable for this game"));
                    return;
                  }

                  const path = await invoke<string>("create_shortcut", {
                    exePath,
                    name: game.title || `Game ${game.appId}`,
                  });

                  showSuccess(t("context_menu.shortcut_created", "Shortcut created:\n{{path}}", { path }));

                } catch (err) {
                  showError(t("context_menu.shortcut_error", "Could not create shortcut: {{error}}", { error: String(err) }));
                }
              }}
            />

            <MenuItem
              label={t("context_menu.manage", "Manage")}
              icon={<Settings className="h-3.5 w-3.5" />}
              children={[
                {
                  label: t("context_menu.edit_details", "Edit Game Details"),
                  icon: <Edit className="h-3.5 w-3.5" />,
                  onClick: () => { setMenuOpen(false); setEditInitialTab("details"); setEditDialogOpen(true); onOverlayToggle?.(true); },
                },
                {
                  label: t("context_menu.manage_art", "Manage Artwork"),
                  icon: <Image className="h-3.5 w-3.5" />,
                  onClick: () => { setMenuOpen(false); setEditInitialTab("media"); setEditDialogOpen(true); onOverlayToggle?.(true); },
                },
                {
                  label: t("context_menu.game_fixes", "Game Fixes"),
                  icon: <Wrench className="h-3.5 w-3.5" />,
                  onClick: () => { setMenuOpen(false); setToolsModalOpen(true); onOverlayToggle?.(true); },
                },
                    ...(game.source === "manual"
                    ? [{
                        label: t("context_menu.delete_manual", "Delete Manual Game"),
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        destructive: true as const,
                        onClick: () => {
                          setMenuOpen(false);
                          const rawId = normalizeManualGameId(game.providerGameId || game.id || "");
                          if (rawId) {
                            try {
                              if (DEBUG_MANUAL_REMOVE) console.log(`[MANUAL_REMOVE][TILE] rawId=${rawId} title="${game.title}"`);
                              removeManualGame(rawId);
                              showSuccess(`"${game.title ?? rawId}" ${t("context_menu.deleted", "deleted")}`);
                            } catch (e) {
                              showError(`${t("game_tile.delete_failed", "Failed to delete")}: ${e}`);
                            }
                          }
                        },
                      }]
                  : []),
                ...(hasPendingUninstall
                  ? [{
                    label: t("context_menu.cancel_tracking", "Cancel tracking"),
                    icon: <XCircle className="h-3.5 w-3.5" />,
                    onClick: () => {
                      setMenuOpen(false);
                      console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel before=${isPendingUninstall(String(game.appId))}`);
                      clearPendingUninstall(String(game.appId));
                      showInfo(t("game_tile.tracking_cancelled", "\"{{title}}\" uninstall tracking cancelled.", { title: game.title ?? game.appId }));
                      console.log(`[UNINSTALL_PENDING] appid=${game.appId} phase=manual-cancel after=${isPendingUninstall(String(game.appId))}`);
                    },
                  }]
                    : game.source === "debrid"
                      ? [{
                        label: t("context_menu.remove_library", "Remove from Library"),
                        icon: <Trash2 className="h-3.5 w-3.5" />,
                        destructive: true as const,
                        onClick: () => {
                          setMenuOpen(false);
                          if (DEBUG_MANUAL_REMOVE) console.log(`[DEBRID][TILE_REMOVE] providerGameId=${game.providerGameId} title="${game.title}"`);
                          const providerGameId = game.providerGameId;
                          if (providerGameId) {
                            removeDebridGameFromLibrary(providerGameId);
                            showSuccess(`"${game.title ?? providerGameId}" ${t("context_menu.removed_from_library", "removed from library. Files on disk are kept.")}`);
                          } else {
                            showError(t("context_menu.remove_error", "Could not remove this game from the library."));
                          }
                        },
                      }]
                      : game.source !== "manual" && game.source !== "epic"
                        ? [{
                        label: t("context_menu.uninstall_steam", "Uninstall in Steam"),
                        icon: <ExternalLink className="h-3.5 w-3.5" />,
                        disabled: !game.steamInstalled,
                        subtitle: !game.steamInstalled ? t("context_menu.not_installed", "Not installed") : undefined,
                      onClick: game.steamInstalled ? async () => {
                        setMenuOpen(false);
                        const appId = Number(game.appId);
                        markPendingUninstall(String(appId));
                        showInfo(t("context_menu.steam_uninstall_opened", "Steam uninstall opened. Complete uninstall in Steam. LumaForge will update automatically."), { title: t("game_tile.uninstall_title", "Uninstall") });
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
                    label: t("context_menu.delete_lua", "Delete Lua"),
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

        {(game.appId || game.source === "manual" || game.source === "epic" || game.source === "debrid") && (
          <>
            <GameEditDialog
              appId={game.source === "steam" || game.source === "lua" ? game.appId : undefined}
              manualGameId={game.source === "manual" ? game.providerGameId : undefined}
              epicProviderGameId={game.source === "epic" ? game.providerGameId : undefined}
              debridProviderGameId={game.source === "debrid" ? game.providerGameId : undefined}
              open={editDialogOpen}
              onClose={() => { setEditDialogOpen(false); onOverlayToggle?.(false); }}
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

            <ToolsModal
              open={toolsModalOpen}
              game={game}
              onClose={() => { setToolsModalOpen(false); onOverlayToggle?.(false); }}
            />
          </>
        )}
      </div>
  );
}


