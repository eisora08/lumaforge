import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { countRender } from "../services/perfCounters";
import { useLibraryGames } from "../context/LibraryGamesContext";
import {
  installSteamApp,
  deleteLuaScript,
  scanInstalledLuaScripts,
} from "../services/tauri";
import { installTrackerService } from "../services/installTrackingService";
import { epicInstallTrackerService } from "../services/epicInstallTrackerService";
import { openExternalUrl } from "../services/externalLinks";
import { getSteamStoreUrl, getSteamDbUrl } from "../utils/steamLinks";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { loadSteamStats, mergeSteamStatsIntoGames } from "../services/gameStatsService";
import { resolveArtworkForAppIds } from "../services/storeArtworkResolver";
import {
  getMediaCacheForAppId,
  getLibraryGameDetails,
} from "../services/libraryLocalCacheService";
import { readMediaManifest, type GameMediaCacheEntry, type GameMediaPaths, type MediaManifest } from "../services/tauri";
import type { GameAppInfo } from "../services/gameCacheService";
import { loadGameAppInfoWithMediaFallback, resolveMediaPaths, resolveCanonicalDisplayTitle, resolveProviderMediaPreviewUrl, subscribeMediaCacheVersion, getMediaCacheVersion } from "../services/gameCacheService";
import { resolveGameMediaImageSrc } from "../services/localImageSrc";
import { resolveGameDetailsArtwork, refreshGameDetailsArtwork, materializeResolvedGameMedia } from "../services/gameCacheService";

import type { ResolvedGameMediaBundle } from "../types/gameMedia";
import { enqueueMediaDownload, cancelMediaJobsForApp, subscribeToMediaQueue } from "../services/mediaDownloadQueue";
import LibraryGameDetails from "../components/library/LibraryGameDetails";
import StopGameModal from "../components/library/StopGameModal";
import InstallConfirmModal from "../components/install/InstallConfirmModal";
import ToolsModal from "../components/tools/ToolsModal";
import { useSettings } from "../context/SettingsContext";
import { useGameSession, computeGameKey } from "../context/GameSessionContext";
import { useDownloadQueueContext } from "../context/DownloadQueueContext";
import { useGameLaunchState } from "../hooks/useGameLaunchState";
import { useGameActivity } from "../context/GameActivityContext";
import { useGamePlayStats } from "../services/gamePlayStats";
import { importExternalPlaytime } from "../services/playtimeService";

import type { LibraryGame } from "../types/libraryGame";
const DEBUG_MEDIA_CACHE = false;
const ENABLE_VERBOSE_MEDIA_CACHE_LOGS = DEBUG_MEDIA_CACHE;
const DEBUG_ACTIVITY = false;
const DEBUG_LUA_DELETE = false;
const DEBUG_META_TRACE = false;
if (DEBUG_META_TRACE) (window as any).__DEBUG_META_TRACE = false;
import DebridSourceSelectorModal from "../components/debrid/DebridSourceSelectorModal";
import { DEBRID_INSTALL_ENABLED, DEBRID_LIBRARY_ENABLED, DEBUG_DEBRID_INSTALL } from "../features/debrid/debridFeatureFlag";
import type { RepackQueryResult } from "../services/tauri";
import type { SgdbArtworkData } from "../services/storeArtworkResolver";
import type { AppPage } from "../types/navigation";

import {
  showError,
  showSuccess,
  showWarning,
  showInfo,
} from "../components/toast/GameToast";
import { useConfirm } from "../services/confirmService";
import { resolveDebridInstallUri } from "../services/debridInstallChoice";


type Props = {
  onBack?: () => void;
  onNavigate?: (page: AppPage) => void;
};

export default function LibraryGameDetailPage({ onBack, onNavigate }: Props) {
  countRender("LibraryGameDetailPage");
  const { t } = useTranslation();
  const { selectedGame, setSelectedGame, appInfoMap, refresh } = useLibraryGames();
  const downloadQueue = useDownloadQueueContext();
  const { settings } = useSettings();
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [resolvedGame, setResolvedGame] = useState<LibraryGame | null>(null);
  const [artwork, setArtwork] = useState<SgdbArtworkData | null>(null);
  const [mediaEntry, setMediaEntry] = useState<GameMediaCacheEntry | null>(null);
  const [canonicalAppInfo, setCanonicalAppInfo] = useState<GameAppInfo | null>(null);
  const [canonicalDiskFallback, setCanonicalDiskFallback] = useState<string | null>(null);
  const [localDetailsData, setLocalDetailsData] = useState<unknown>(null);
  const [fallbackBundle, setFallbackBundle] = useState<ResolvedGameMediaBundle | null>(null);
  const [canonicalLoaded, setCanonicalLoaded] = useState(false);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const currentRequest = useRef<number | null>(null);
  const prevRunningRef = useRef(false);
  const _prevAppIdRef = useRef<string | null>(null);
  const _refreshInitiatorRef = useRef<string | null>(null);
  const _detailKeyRef = useRef<string | null>(null);
  const [resetGeneration, setResetGeneration] = useState(0);
  // Subscribe to media cache version so canonicalAppInfo re-reads from disk when
  // any media is invalidated (e.g. user saves a new cover/background in the editor).
  useSyncExternalStore(subscribeMediaCacheVersion, getMediaCacheVersion, getMediaCacheVersion);
  const mediaCacheVersion = getMediaCacheVersion();
  const _latestGameRef = useRef<LibraryGame | null>(null);
  _latestGameRef.current = selectedGame;

  // Lightweight re-read of canonical appinfo when media cache is invalidated.
  // Deliberately separate from the main effect (which cancels in-flight media
  // downloads and clears per-game state) to avoid cancelling active jobs and
  // flashing the hero on every media edit.
  useEffect(() => {
    const appId = selectedGame?.appId;
    if (!appId) return;
    let cancelled = false;
    loadGameAppInfoWithMediaFallback(appId)
      .then((info) => {
        if (cancelled) return;
        if (info) {
          setCanonicalAppInfo(info);
          setCanonicalLoaded(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedGame?.appId, mediaCacheVersion]);

  // Reset stale per-game state at render time (React's "adjusting state when a prop
  // changes" pattern) so the first render of a new game never receives the previous
  // game's media/artwork props. Previously this only happened inside the effect
  // (after paint), leaving one frame of "old render" — visible once the hero sharp
  // layer no longer waits on canonicalLoaded. The ref guard keeps this idempotent.
  const detailKey = selectedGame ? computeGameKey(selectedGame) : "";
  if (_detailKeyRef.current !== detailKey) {
    if (DEBUG_META_TRACE) console.log(`[META_TRACE][RESET] prevKey=${_detailKeyRef.current} newKey=${detailKey} appId=${selectedGame?.appId} source=${selectedGame?.source} hasResolvedMeta=${!!resolvedGame?.metadata} resetGen=${resetGeneration}`);
    _detailKeyRef.current = detailKey;
    setMetadataLoading(true);
    setMediaEntry(null);
    setCanonicalAppInfo(null);
    setCanonicalDiskFallback(null);
    setLocalDetailsData(null);
    setFallbackBundle(null);
    setArtwork(null);
    setResolvedGame(null);
    setCanonicalLoaded(false);
    setResetGeneration((g) => g + 1);
  }

  const gameKey = selectedGame ? computeGameKey(selectedGame) : "";
  const { launchInfo, launchGame, cancelLaunch } = useGameLaunchState(gameKey);
  const session = useGameSession();
  const { addActivity } = useGameActivity();
  const { recordSessionEnd } = useGamePlayStats(selectedGame?.id || "");
  const [showStopModal, setShowStopModal] = useState(false);
  const [debridRepacks, setDebridRepacks] = useState<RepackQueryResult[]>([]);
  const [debridInstallGame, setDebridInstallGame] = useState<LibraryGame | null>(null);
  const [installConfirmGame, setInstallConfirmGame] = useState<LibraryGame | null>(null);
  const { confirm } = useConfirm();

  // Playtime tracking: when session transitions from running to idle/cleared
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isRunning = launchInfo.state === "running";
    prevRunningRef.current = isRunning;

    if (wasRunning && !isRunning && launchInfo.launchedAt) {
      const durationMs = Date.now() - launchInfo.launchedAt;
      if (durationMs > 30000) {
        recordSessionEnd(durationMs);
        addActivity({
          gameId: selectedGame?.id || "",
          appId: selectedGame?.appId,
          kind: "game-closed",
          title: t("library_details.game_session_ended"),
          description: t("library_details.played_for", { minutes: Math.round(durationMs / 60000) }),
          source: "local",
          severity: "info",
        });
      }
    }
  }, [launchInfo.state, launchInfo.launchedAt, selectedGame, recordSessionEnd, addActivity]);

  async function handlePlay(game: LibraryGame) {
    if (game.source === "steam" && game.appId) {
      await launchGame(game);
    } else if (game.source === "epic") {
      await launchGame(game);
    } else if (game.source === "debrid" && game.isPlayable) {
      await launchGame(game);
    } else if ((game.source === "local" || game.source === "manual") && game.executablePath) {
      await launchGame(game);
    } else if (game.source === "manual") {
      showWarning(t("library_details.manual_no_executable"), { title: t("library_page.not_available") });
    } else {
      showWarning(t("library_page.not_available_cannot_launch"), { title: t("library_page.not_available") });
    }
  }

  async function handleConfirmStop() {
    setShowStopModal(false);
    await session.stopSession(gameKey);
  }

  function handleMarkAsStopped() {
    setShowStopModal(false);
    session.clearSession(gameKey);
  }

  function handleOpenStopModal() {
    setShowStopModal(true);
  }

  async function handleDeleteScript(game: LibraryGame) {
    const script = game.luaScripts[0];
    if (!script) {
      showWarning(t("sidebar.no_lua_script"), { title: t("library_details.no_script_title") });
      return;
    }
    if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][REQUEST] appid=${game.appId} title="${game.title}" file="${script.file_name}" path="${script.path}" luaPath="${settings.luaPath}"`);
    const result = await confirm({
      title: t("sidebar.delete_lua_title"),
      description: t("sidebar.delete_lua_desc", { file: script.file_name, game: game.title }),
      confirmLabel: t("sidebar.delete_lua_confirm"),
      variant: "danger",
    });
    if (!result.confirmed) return;
    try {
      await deleteLuaScript({ luaPath: settings.luaPath, fileName: script.file_name });
      // Verify file is actually gone from disk
      const remaining = await scanInstalledLuaScripts(settings.luaPath);
      const stillPresent = remaining.some((s) => s.file_name === script.file_name);
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][VERIFY] appid=${game.appId} file="${script.file_name}" stillPresent=${stillPresent}`);
      if (stillPresent) {
        showError(t("sidebar.deletion_failed"), { title: t("sidebar.deletion_failed_title") });
        return;
      }
      // Force refresh library state (bypass TTL) to reflect deletion
      await refresh({ force: true });
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" success=true`);
      showSuccess(t("sidebar.lua_deleted"), { title: t("sidebar.lua_deleted_title") });
    } catch (err) {
      if (DEBUG_LUA_DELETE) console.log(`[LUA_DELETE][UI_RESULT] appid=${game.appId} file="${script.file_name}" error="${String(err)}"`);
      showError(String(err), { title: t("sidebar.error") });
    }
  }

  async function handleFindProcess() {
    const candidate = await session.findGameProcessForSession(gameKey);
    if (candidate) {
      showWarning(t("library_details.process_found", { name: candidate.name, pid: candidate.pid }), { title: t("library_details.process_found_title") });
    } else {
      showWarning(t("library_details.no_process_found"), { title: t("library_details.no_process_found_title") });
    }
  }

  // Load local cache (media cache + canonical appinfo + media manifest + details/{appid}.json) immediately
  // Clear ALL state on any appId change to prevent stale cross-appId data during async fetch.
  useEffect(() => {
    if (DEBUG_META_TRACE) console.log(`[META_TRACE][MAIN_EFFECT] appId=${selectedGame?.appId} source=${selectedGame?.source} resetGen=${resetGeneration} metaHas=${!!selectedGame?.metadata} metaResolved=${selectedGame?.metadata?.resolved}`);
    // Reset scroll to top on game entry/switch
    document.querySelector('main')?.scrollTo(0, 0);

    // Cancel pending media downloads for any previously-active appId
    if (_prevAppIdRef.current) {
      cancelMediaJobsForApp(_prevAppIdRef.current);
    }
    _prevAppIdRef.current = selectedGame?.appId ?? null;
    setMediaEntry(null);
    setCanonicalAppInfo(null);
    setCanonicalDiskFallback(null);
    setLocalDetailsData(null);
    setFallbackBundle(null);
    setArtwork(null);
    setCanonicalLoaded(false);
    _refreshInitiatorRef.current = null;

    // ── Manual games (no appId): load from manualGameStore ──
    // Manual games WITH appId fall through to the Steam pipeline below
    if (selectedGame?.source === "manual" && selectedGame.providerGameId && !selectedGame.appId) {
      let cancelled = false;
      import("../services/manualGameStore").then(({ getManualGame }) => {
        if (cancelled) return;
        const entry = getManualGame(selectedGame.providerGameId!);
        if (!entry) return;

        // Resolve all manual media paths to asset:// URLs via resolveProviderMediaPreviewUrl
        const manualId = entry.id;
        Promise.all([
          resolveProviderMediaPreviewUrl(entry.backgroundPath),
          resolveProviderMediaPreviewUrl(entry.landscapePath),
          resolveProviderMediaPreviewUrl(entry.coverPath),
          resolveProviderMediaPreviewUrl(entry.logoPath),
          resolveProviderMediaPreviewUrl(entry.iconPath),
        ]).then(([bgUrl, lsUrl, cvUrl, lgUrl, icUrl]) => {
          if (cancelled) return;

          // canonicalAppInfo.media: resolved asset:// URLs (not raw relative paths)
          setCanonicalAppInfo({
            appId: null as any,
            name: entry.name,
            media: {
              coverPath: cvUrl,
              landscapePath: lsUrl,
              backgroundPath: bgUrl,
              logoPath: lgUrl,
              iconPath: icUrl,
            },
          } as any);
          setCanonicalLoaded(true);
          if (DEBUG_META_TRACE) console.log(`[META_TRACE][MAIN_MANUAL] appId=${selectedGame?.appId} canonicalLoaded=true localDetailsSet=true`);

          // localDetailsData: all manual fields including linkedSteamAppId
          setLocalDetailsData({
            developer: entry.developers?.join(", "),
            publisher: entry.publishers?.join(", "),
            description: entry.description,
            shortDescription: entry.shortDescription,
            genres: entry.genres ?? [],
            categories: entry.categories ?? [],
            releaseDate: entry.releaseDate,
            linkedSteamAppId: entry.linkedSteamAppId ?? null,
            executablePath: entry.executablePath ?? null,
            installDir: entry.installDir ?? null,
            workingDirectory: entry.workingDirectory ?? null,
          });

          // fallbackBundle with resolved asset:// URLs
          setFallbackBundle({
            appId: manualId,
            background: bgUrl ? { url: bgUrl, source: "local", appId: manualId, kind: "background" } : undefined,
            landscape: lsUrl ? { url: lsUrl, source: "local", appId: manualId, kind: "landscape" } : undefined,
            cover: cvUrl ? { url: cvUrl, source: "local", appId: manualId, kind: "cover" } : undefined,
            logo: lgUrl ? { url: lgUrl, source: "local", appId: manualId, kind: "logo" } : undefined,
          });
        }).catch(() => {});
      }).catch(() => {});
      return () => { cancelled = true; };
    }

    // ── Epic games: resolve provider media paths + build canonicalAppInfo ──
    if (selectedGame?.source === "epic" && selectedGame.providerGameId) {
      let cancelled = false;

      const bgPath = selectedGame.backgroundPath ?? null;
      const lsPath = selectedGame.landscapePath ?? null;
      const cvPath = selectedGame.coverPath ?? null;
      const lgPath = selectedGame.logoPath ?? null;
      const icPath = selectedGame.iconPath ?? null;

      Promise.all([
        resolveProviderMediaPreviewUrl(bgPath).catch(() => null),
        resolveProviderMediaPreviewUrl(lsPath).catch(() => null),
        resolveProviderMediaPreviewUrl(cvPath).catch(() => null),
        resolveProviderMediaPreviewUrl(lgPath).catch(() => null),
        resolveProviderMediaPreviewUrl(icPath).catch(() => null),
      ]).then(([bgUrl, lsUrl, cvUrl, lgUrl, icUrl]) => {
        if (cancelled) return;

        // canonicalAppInfo.media: resolved asset:// URLs (not raw relative paths)
        setCanonicalAppInfo({
          appId: null as any,
          name: selectedGame.title ?? t("library_details.epic_game_default"),
          media: {
            coverPath: cvUrl,
            landscapePath: lsUrl,
            backgroundPath: bgUrl,
            logoPath: lgUrl,
            iconPath: icUrl,
          },
        } as any);
        setCanonicalLoaded(true);

        // localDetailsData from metadata (synthetic SteamAppMetadata built by mergeEpicOverrides)
        const meta = selectedGame.metadata;
        setLocalDetailsData({
          developer: meta?.developer ?? (meta as any)?.developers?.join?.(", ") ?? null,
          publisher: (meta as any)?.publishers?.join?.(", ") ?? null,
          description: meta?.short_description ?? meta?.about_the_game ?? null,
          shortDescription: meta?.short_description ?? null,
          genres: meta?.genres ?? [],
          categories: meta?.categories ?? [],
          releaseDate: meta?.release_date ?? null,
        });

        // fallbackBundle with resolved asset:// URLs
        setFallbackBundle({
          appId: selectedGame.providerGameId ?? "",
          background: bgUrl ? { url: bgUrl, source: "local", appId: selectedGame.providerGameId ?? "", kind: "background" } : undefined,
          landscape: lsUrl ? { url: lsUrl, source: "local", appId: selectedGame.providerGameId ?? "", kind: "landscape" } : undefined,
          cover: cvUrl ? { url: cvUrl, source: "local", appId: selectedGame.providerGameId ?? "", kind: "cover" } : undefined,
          logo: lgUrl ? { url: lgUrl, source: "local", appId: selectedGame.providerGameId ?? "", kind: "logo" } : undefined,
        });
      }).catch(() => {});
      return () => { cancelled = true; };
    }

    if (!selectedGame?.appId) { setCanonicalLoaded(true); return; }

    let cancelled = false;
    const appId = selectedGame.appId;

    getMediaCacheForAppId(appId)
      .then((entry) => { if (!cancelled) setMediaEntry(entry); })
      .catch(() => { if (!cancelled) setMediaEntry(null); });

    // Load canonicalAppInfo AND media manifest simultaneously.
    // Manifest paths (where exists=true) override canonicalAppInfo.media.* fields
    // because the manifest is the authoritative record of what files actually exist on disk.
    Promise.all([
      loadGameAppInfoWithMediaFallback(appId),
      readMediaManifest(appId).catch(() => null as MediaManifest | null),
    ]).then(async ([info, manifest]) => {
      if (cancelled) return;

      // Verify actual files on disk — media_manifest.json may be stale
      // (written at download time, but files may have been deleted manually).
      // getGameMediaPaths checks disk via Rust std::fs::metadata.
      const { getGameMediaPaths } = await import("../services/tauri");
      const diskState = await getGameMediaPaths(appId);

      let mergedInfo = info;
      if (info?.media && manifest) {
        const manifestMedia: GameMediaPaths = {
          coverPath: manifest.files.cover.exists ? manifest.files.cover.path : null,
          landscapePath: manifest.files.landscape.exists ? manifest.files.landscape.path : null,
          backgroundPath: manifest.files.background.exists ? manifest.files.background.path : null,
          logoPath: manifest.files.logo.exists ? manifest.files.logo.path : null,
          iconPath: manifest.files.icon.exists ? manifest.files.icon.path : null,
        };
        const resolvedManifestPaths = await resolveMediaPaths(appId, manifestMedia, "steam");
        if (cancelled) return;
        if (resolvedManifestPaths) {
          const merged = { ...info.media };
          let changed = false;

          const mergeField = (key: keyof GameMediaPaths) => {
            const manifestVal = resolvedManifestPaths[key];
            // Only merge manifest path if the file actually exists on disk
            // (diskState.*Exists is authoritative — the manifest may be stale
            // after manual deletion).
            const existsKey = `${key.replace("Path", "Exists")}` as keyof typeof diskState;
            const fileActuallyExists = diskState?.[existsKey] as boolean | undefined;
            if (manifestVal && fileActuallyExists !== false && merged[key] !== manifestVal) {
              merged[key] = manifestVal;
              changed = true;
            }
          };
          mergeField("coverPath");
          mergeField("landscapePath");
          mergeField("backgroundPath");
          mergeField("logoPath");
          mergeField("iconPath");

          if (changed) {
            if (ENABLE_VERBOSE_MEDIA_CACHE_LOGS) console.log(`[MEDIA][MANIFEST_MERGE] appid=${appId} merged=true`);
            mergedInfo = { ...info, media: merged };
          }
        }
        if (resolvedManifestPaths && import.meta.env.DEV && ENABLE_VERBOSE_MEDIA_CACHE_LOGS) {
          ["background", "logo"].forEach((role) => {
            const key = `${role}Path` as keyof GameMediaPaths;
            const resolvedPath = resolvedManifestPaths[key] ?? null;
            const manifestPath = (manifest as any)?.files?.[role]?.path ?? "(no-manifest)";
            if (DEBUG_ACTIVITY) console.log(`[MEDIA][MANIFEST_RESOLVE] appid=${appId} role=${role} manifestPath=${manifestPath} resolvedPath=${resolvedPath ?? "(null)"} exists=${!!resolvedPath}`);
          });
        }
      }

      // Use actual disk state to override stale appinfo/manifest paths.
      // If a file was manually deleted, diskState.*Path will be null even
      // if appinfo and manifest still reference it.
      if (diskState && mergedInfo?.media) {
        const merged = { ...mergedInfo.media };
        let changed = false;
        const roles: (keyof GameMediaPaths)[] = ["coverPath", "landscapePath", "backgroundPath", "logoPath", "iconPath"];
        for (const roleKey of roles) {
          const existsKey = `${roleKey.replace("Path", "Exists")}` as keyof typeof diskState;
          const fileActuallyExists = diskState?.[existsKey] as boolean | undefined;
          if (fileActuallyExists === false && merged[roleKey]) {
            if (DEBUG_ACTIVITY) console.log(`[MEDIA_STALE][DETECTED] appid=${appId} role=${roleKey} path=${merged[roleKey]} reason=file-missing`);
            (merged as any)[roleKey] = null;
            changed = true;
          }
        }
        if (changed) {
          mergedInfo = { ...mergedInfo, media: merged };
        }
      }

      if (import.meta.env.DEV && mergedInfo?.media) {
        const logDisplay = (role: string) => {
          const key = `${role}Path` as keyof GameMediaPaths;
          const path = mergedInfo.media?.[key] ?? null;
          if (DEBUG_ACTIVITY) console.log(`[MEDIA][DISPLAY_PATH] appid=${appId} role=${role} finalPath=${path ?? "(null)"}`);
        };
        logDisplay("background");
        logDisplay("logo");
      }
      setCanonicalAppInfo(mergedInfo);
      setCanonicalLoaded(true);
      if (DEBUG_META_TRACE) console.log(`[META_TRACE][MAIN_CANONICAL] appId=${appId} canonicalLoaded=true hasInfo=${!!mergedInfo} hasName=${!!mergedInfo?.name} hasMedia=${!!mergedInfo?.media}`);
      if (!mergedInfo?.media?.landscapePath && !mergedInfo?.media?.coverPath) {
        resolveGameMediaImageSrc(appId).then((src) => {
          if (!cancelled && src) setCanonicalDiskFallback(src);
        }).catch(() => {});
      }

      // ── Multi-provider fallback for missing background/logo ──
      const missingBg = !mergedInfo?.media?.backgroundPath;
      const missingLogo = !mergedInfo?.media?.logoPath;
      if (missingBg || missingLogo) {
        const localPaths = mergedInfo?.media ?? null;
        const meta = selectedGame?.metadata ?? null;
        const isDbg = appId === "4717430";
        if (isDbg) console.log(`[LIB_MEDIA_DEBUG][START] appid=4717430 missingBg=${missingBg} missingLogo=${missingLogo} metaKeys=${meta ? Object.keys(meta).join(",") : "(null)"} imageUrl=${selectedGame?.imageUrl ?? "(null)"}`);
        if (isDbg) console.log(`[LIB_MEDIA_DEBUG][CONTEXT] sgdbKey="${settings.steamGridDbApiKey?.substring(0, 4) ?? ""}..." sgdbEnabled=${settings.steamGridDbArtworkEnabled} rawgKey="${settings.rawgApiKey ? "set" : "empty"}" igdbId="${settings.igdbClientId ? "set" : "empty"}" igdbSecret="${settings.igdbClientSecret ? "set" : "empty"}"`);
        Promise.resolve(null).then((cachedSources) => {
          if (cancelled) return;
          const bundle = resolveGameDetailsArtwork(appId, localPaths, meta, selectedGame?.imageUrl ?? null, cachedSources);
          if (cancelled) return;
          if (bundle.background || bundle.logo || bundle.cover || bundle.landscape) {
            setFallbackBundle(bundle);
          }
          // If still missing after sync, trigger async network refresh
          const stillMissingBg = missingBg && !bundle.background;
          const stillMissingLogo = missingLogo && !bundle.logo;
          if (stillMissingBg || stillMissingLogo) {
            if (isDbg) console.log(`[LIB_MEDIA_DEBUG][ASYNC_TRIGGER] stillMissingBg=${stillMissingBg} stillMissingLogo=${stillMissingLogo}`);
            refreshGameDetailsArtwork(
              appId,
              localPaths,
              meta,
              selectedGame?.imageUrl ?? null,
              cachedSources,
              {
                sgdbApiKey: settings.steamGridDbApiKey,
                sgdbEnabled: settings.steamGridDbArtworkEnabled,
                rawgApiKey: settings.rawgApiKey,
                igdbClientId: settings.igdbClientId,
                igdbClientSecret: settings.igdbClientSecret,
              },
            ).then(({ bundle: refreshed, changed }) => {
              if (!cancelled) {
                if (isDbg) console.log(`[LIB_MEDIA_DEBUG][ASYNC_RESULT] changed=${changed} hasBg=${!!refreshed.background} hasLogo=${!!refreshed.logo} bgSource=${refreshed.background?.source ?? "(null)"} logoSrc=${refreshed.logo?.source ?? "(null)"}`);
                if (changed) {
                  setFallbackBundle(refreshed);
                }
              }
            }).catch((e) => {
              if (isDbg) console.log(`[LIB_MEDIA_DEBUG][ASYNC_ERROR] error=${e}`);
            });
          }
        }).catch(() => {});
      }
    }).catch(() => { if (!cancelled) { setCanonicalAppInfo(null); setCanonicalLoaded(true); if (DEBUG_META_TRACE) console.log(`[META_TRACE][MAIN_ERROR] appId=${appId} canonicalLoaded=true (error path)`); } });

    getLibraryGameDetails(appId).then((entry) => {
      if (cancelled) return;
      if (entry?.data) setLocalDetailsData(entry.data);
      if (DEBUG_META_TRACE) console.log(`[META_TRACE][MAIN_DETAILS] appId=${appId} hasData=${!!entry?.data} keys=${entry?.data ? Object.keys(entry.data as any).join(",") : "none"}`);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedGame?.appId, resetGeneration]);

  // Resolve metadata when a game with an appId is selected but has no/incomplete metadata
  useEffect(() => {
    const appIdLog = selectedGame?.appId ?? "?";
    const srcLog = selectedGame?.source ?? "?";
    if (!selectedGame) {
      if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_EFFECT] appId=${appIdLog} src=${srcLog} → no selectedGame, clearing`);
      setResolvedGame(null);
      setMetadataLoading(false);
      return;
    }

    const appIdNum = selectedGame.appId ? Number(selectedGame.appId) : null;
    if (!appIdNum) {
      // Epic games without Steam appId: use local metadata if available
      const epicMeta = selectedGame.metadata;
      if (epicMeta && (epicMeta.short_description || epicMeta.about_the_game || epicMeta.genres?.length)) {
        if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_EFFECT] appId=${appIdLog} src=${srcLog} → Epic game with local metadata, using as resolved`);
        setResolvedGame(selectedGame);
        setMetadataLoading(false);
        return;
      }
      if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_EFFECT] appId=${appIdLog} src=${srcLog} → no appIdNum, setting raw game (no metadata needed)`);
      setResolvedGame(selectedGame);
      setMetadataLoading(false);
      return;
    }

    const meta = selectedGame.metadata;
    const hasDescription = !!meta?.about_the_game || !!meta?.detailed_description;
    // Epic games: treat as resolved if metadata has name + description (even without Steam-specific fields)
    const isEpicResolved = selectedGame.source === "epic" && meta?.resolved === true && !!meta?.name && hasDescription;
    const hasResolvedMetadata = isEpicResolved || (meta && meta.resolved === true && !!meta.name && meta.name !== `Steam App ${appIdNum}` && hasDescription);
    if (hasResolvedMetadata) {
      if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_EFFECT] appId=${appIdLog} src=${srcLog} → hasResolvedMetadata=true, using selectedGame directly`);
      setResolvedGame(selectedGame);
      setMetadataLoading(false);
      return;
    }

    const requestId = Date.now();
    currentRequest.current = requestId;

    const alreadyResolved = resolvedGame?.metadata?.resolved === true && resolvedGame?.appId === selectedGame.appId;
    if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_EFFECT] appId=${appIdLog} src=${srcLog} → resolving from network/cache. alreadyResolved=${alreadyResolved} resetGen=${resetGeneration} requestId=${requestId}`);

    setMetadataLoading(true);
    // Do NOT set resolvedGame to raw selectedGame here — CTX_SYNC keeps replacing
    // selectedGame with new references, and setResolvedGame(selectedGame) overwrites
    // the enriched metadata from a previous .then() that hasn't been committed yet.
    // Only the .then() handler sets resolvedGame with enriched metadata.
    resolveGameMetadata([appIdNum])
      .then((result) => {
        if (currentRequest.current !== requestId) {
          if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_THEN] appId=${appIdLog} → CANCELLED (requestId=${requestId} current=${currentRequest.current})`);
          return;
        }
        const resolvedMeta = result[appIdNum];
        if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_THEN] appId=${appIdLog} → resolvedMeta exists=${!!resolvedMeta} resolved=${resolvedMeta?.resolved} hasShortDesc=${!!resolvedMeta?.short_description} hasAbout=${!!resolvedMeta?.about_the_game} hasName=${!!resolvedMeta?.name} name="${resolvedMeta?.name ?? ""}"`);
        if (resolvedMeta) {
          // Use _latestGameRef to always reference the current selectedGame, not the stale closure
          const currentGame = _latestGameRef.current ?? selectedGame;
          if ((window as any).__DEBUG_MANUAL_META) {
            console.log(`[MANUAL][META_RESOLVED] appId=${appIdNum} source=${currentGame?.source} resolved=${resolvedMeta.resolved} name=${resolvedMeta.name} hasDescription=${!!resolvedMeta.short_description} hasAbout=${!!resolvedMeta.about_the_game}`);
          }
          setResolvedGame({
            ...currentGame,
            metadata: resolvedMeta,
            imageUrl: currentGame.imageUrl || resolvedMeta.header_image || resolvedMeta.capsule_image || resolvedMeta.capsule_image_v5 || undefined,
          });
        } else {
          if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_THEN] appId=${appIdLog} → resolvedMeta is UNDEFINED! result keys=${Object.keys(result).join(",")}`);
        }
      })
      .catch((err) => {
        if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_CATCH] appId=${appIdLog} → error: ${String(err)}`);
      })
      .finally(() => {
        if (currentRequest.current === requestId) {
          if (DEBUG_META_TRACE) console.log(`[META_TRACE][META_FINALLY] appId=${appIdLog} → setting metadataLoading=false`);
          setMetadataLoading(false);
        }
      });
  }, [selectedGame, resetGeneration, i18n.language]);

  // ── Re-run fallback resolver when enriched metadata becomes available ──
  // The main effect runs with selectedGame?.metadata (may not be enriched yet).
  // When resolvedGame updates with enriched metadata (background_image, etc.),
  // this effect re-runs the fallback resolver with the richer data.
  const _lastEnrichedFallbackKey = useRef<string>("");
  useEffect(() => {
    if (!selectedGame?.appId) return;
    if (!canonicalAppInfo) return;
    const appId = selectedGame.appId;

    const meta = resolvedGame?.metadata ?? null;
    if (!meta) return;

    const alreadySetBg = !!canonicalAppInfo?.media?.backgroundPath;
    const alreadySetLogo = !!canonicalAppInfo?.media?.logoPath;
    if (alreadySetBg && alreadySetLogo) return;

    // Build a stable key so we only fire once per metadata snapshot
    const metaKey = `${appId}:bg=${!!meta.background_image}:hdr=${!!meta.header_image}:scr=${meta.screenshots?.length ?? 0}:logo=${!!meta.logo_image}:llogo=${!!meta.library_logo_image}`;
    if (_lastEnrichedFallbackKey.current === metaKey) return;

    const missingBg = !alreadySetBg;
    const missingLogo = !alreadySetLogo;
    const localPaths = canonicalAppInfo?.media ?? null;
    const isDbg = appId === "4717430";

    let cancelled = false;
    Promise.resolve(null).then((cachedSources) => {
      if (cancelled) return;
      _lastEnrichedFallbackKey.current = metaKey;

      const bundle = resolveGameDetailsArtwork(appId, localPaths, meta, selectedGame?.imageUrl ?? null, cachedSources);
      if (cancelled) return;

      if (bundle.background || bundle.logo || bundle.cover || bundle.landscape) {
        setFallbackBundle(bundle);
      }

      // Async refresh still needed?
      const stillMissingBg = missingBg && !bundle.background;
      const stillMissingLogo = missingLogo && !bundle.logo;
      if (stillMissingBg || stillMissingLogo) {
        if (isDbg) console.log(`[LIB_MEDIA_DEBUG][ENRICHED_ASYNC] stillMissingBg=${stillMissingBg} stillMissingLogo=${stillMissingLogo}\n`);
        refreshGameDetailsArtwork(
          appId,
          localPaths,
          meta,
          selectedGame?.imageUrl ?? null,
          cachedSources,
          {
            sgdbApiKey: settings.steamGridDbApiKey,
            sgdbEnabled: settings.steamGridDbArtworkEnabled,
            rawgApiKey: settings.rawgApiKey,
            igdbClientId: settings.igdbClientId,
            igdbClientSecret: settings.igdbClientSecret,
          },
        ).then(({ bundle: refreshed, changed }) => {
          if (!cancelled) {
            if (isDbg) console.log(`[LIB_MEDIA_DEBUG][ENRICHED_ASYNC_RESULT] changed=${changed} hasBg=${!!refreshed.background}\n`);
            if (changed) {
              setFallbackBundle(refreshed);
            }
          }
        }).catch(() => {});
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [
    selectedGame?.appId,
    // Stable deps: trigger when enriched metadata fields become populated
    resolvedGame?.metadata?.background_image,
    resolvedGame?.metadata?.header_image,
    resolvedGame?.metadata?.screenshots,
    resolvedGame?.metadata?.logo_image,
    resolvedGame?.metadata?.library_logo_image,
    canonicalAppInfo?.media?.backgroundPath,
    canonicalAppInfo?.media?.logoPath,
    canonicalAppInfo,
  ]);

  // Check if media files actually exist on disk — if not, queue targeted repair
  // Resets when appId changes so a new game gets its own repair check.
  const mediaCheckDoneRef = useRef(false);
  useEffect(() => {
    mediaCheckDoneRef.current = false;
  }, [selectedGame?.appId]);
  useEffect(() => {
    if (!resolvedGame?.appId) return;
    if (mediaCheckDoneRef.current) return;
    mediaCheckDoneRef.current = true;

    const appIdStr = resolvedGame.appId;

    // Check actual files on disk (not just appinfo paths)
    const checkMedia = async () => {
      const { detectAndQueueMissingMedia } = await import("../services/gameCacheService");
      const queued = await detectAndQueueMissingMedia(appIdStr);
      if (queued.length > 0) {
        if (DEBUG_ACTIVITY) console.log(`[MEDIA][DETAILS_REPAIR] appid=${appIdStr} missing=${queued.join(",")} queued=true`);
      }
    };
    checkMedia();
  }, [resolvedGame, canonicalAppInfo?.media?.landscapePath, canonicalAppInfo?.media?.coverPath, canonicalAppInfo?.media?.backgroundPath, canonicalAppInfo?.media?.logoPath, canonicalAppInfo?.media?.iconPath]);

  // ── Materialize resolved artwork URLs to local disk ──
  // When fallbackBundle changes (sync or async resolution), enqueue downloads
  // for roles that don't yet exist on disk.
  const _lastMaterializedBundleKey = useRef<string>("");
  const _fallbackBundleRef = useRef(fallbackBundle);
  _fallbackBundleRef.current = fallbackBundle;
  useEffect(() => {
    const appId = selectedGame?.appId;
    if (!appId) return;
    if (selectedGame?.source === "manual" && !selectedGame.appId) return;
    if (!fallbackBundle) return;
    if (fallbackBundle.appId && fallbackBundle.appId !== appId) {
      if (DEBUG_ACTIVITY) console.log(`[MEDIA][MATERIALIZE_GUARD] skip appId=${appId} bundleAppId=${fallbackBundle.appId} reason=cross-app-contamination`);
      setFallbackBundle(null);
      return;
    }
    const key = `${appId}:bg=${!!fallbackBundle.background}:l=${!!fallbackBundle.landscape}:c=${!!fallbackBundle.cover}:logo=${!!fallbackBundle.logo}`;
    if (_lastMaterializedBundleKey.current === key) return;
    _lastMaterializedBundleKey.current = key;

    materializeResolvedGameMedia(appId, fallbackBundle, "steam").catch(() => {});
  }, [selectedGame?.appId, fallbackBundle]);

  // ── Subscribe to media queue — re-materialize on download success ──
  // When a download completes for the current app, re-check disk so the
  // next render picks up the local file (localPath gets set on the bundle).
  useEffect(() => {
    const appId = selectedGame?.appId;
    if (!appId) return;
    if (selectedGame?.source === "manual" && !selectedGame.appId) return;

    const unsub = subscribeToMediaQueue((event) => {
      if (event.type !== "success" && event.type !== "partial") return;
      const eventAppId = event.job?.appId ?? event.batchResult?.appId;
      if (eventAppId !== appId) return;
      // Re-materialize to pick up newly-downloaded files on disk (use ref for latest bundle)
      const bundle = _fallbackBundleRef.current;
      if (bundle && bundle.appId && bundle.appId !== appId) {
        if (DEBUG_ACTIVITY) console.log(`[MEDIA][MATERIALIZE_GUARD] skip-subscription appId=${appId} bundleAppId=${bundle.appId} reason=cross-app-contamination`);
        return;
      }
      if (bundle) {
        materializeResolvedGameMedia(appId, bundle, "steam").then((result) => {
          if (result.diskHits.length > 0) {
            setFallbackBundle(result.bundle);
          }
        }).catch(() => {});
      }
    });

    return unsub;
  }, [selectedGame?.appId]);

  // Lazy per-game stats refresh
  useEffect(() => {
    if (!resolvedGame || !resolvedGame.appId) return;
    const appIdNum = Number(resolvedGame.appId);
    if (!Number.isFinite(appIdNum)) return;

    loadSteamStats(settings.steamRoot || undefined, [appIdNum], { forceRefresh: true })
      .then((statsMap) => {
        const stat = statsMap.get(appIdNum);
        if (resolvedGame.appId === "268910" && (window as any).__DEBUG_NAME_TRACE) {
          console.log(`[ACTIVITY][TRACE_STEAM_STATS] appid=268910 statFound=${!!stat} lastPlayed=${stat?.lastPlayed ?? "null"} playtimeMinutes=${stat?.playtimeMinutes ?? "null"}`);
          console.log(`[ACTIVITY][TRACE_SQLITE] appid=268910 preMergeSteamLastPlayed=${resolvedGame.steamLastPlayedAt ?? "null"} steamPlaytimeMinutes=${resolvedGame.steamPlaytimeMinutes ?? "null"}`);
        }
        const games = [resolvedGame];
        mergeSteamStatsIntoGames(games, statsMap);
        setResolvedGame({ ...games[0] });
        if (resolvedGame.appId === "268910" && (window as any).__DEBUG_NAME_TRACE) {
          console.log(`[ACTIVITY][TRACE_STEAM_STATS] appid=268910 postMergeSteamLastPlayed=${games[0].steamLastPlayedAt ?? "null"} postMergeSteamPlaytimeMinutes=${games[0].steamPlaytimeMinutes ?? "null"}`);
        }

        // Import Steam playtime when available
        if (stat?.playtimeMinutes && stat.playtimeMinutes > 0) {
          if (resolvedGame.appId === "268910" && (window as any).__DEBUG_NAME_TRACE) {
            console.log(`[ACTIVITY][TRACE_PLAYTIME_IMPORT] appid=268910 playtimeMinutes=${stat.playtimeMinutes} calling importExternalPlaytime`);
          }
          importExternalPlaytime({
            gameKey: `app-${resolvedGame.appId}`,
            appId: resolvedGame.appId,
            provider: "steam",
            title: resolvedGame.title,
            externalPlaytimeSeconds: stat.playtimeMinutes * 60,
            externalSource: "steam",
          }).catch(() => { /* non-critical */ });
        }
      })
      .catch(() => { /* non-critical */ });
  }, [resolvedGame?.appId, settings.steamRoot]);

  const handleRefreshArtwork = useCallback(async () => {
    const isManual = selectedGame?.source === "manual";
    const isEpic = selectedGame?.source === "epic";
    if (!selectedGame?.appId && !isManual && !isEpic) {
      showWarning(t("library_details.no_appid"), { title: t("library_details.artwork") });
      return;
    }
    if (isManual && !selectedGame?.appId) {
      showInfo(t("library_details.artwork_refresh_manual"), { title: t("library_details.manual_game") });
      return;
    }
    if (isEpic && selectedGame?.providerGameId) {
      showInfo(t("library_details.artwork_refresh_epic"), { title: t("library_details.epic_game") });
      return;
    }

    const appIdStr = selectedGame!.appId!;
    _refreshInitiatorRef.current = appIdStr;

    // Cancel any existing jobs for this app
    cancelMediaJobsForApp(appIdStr);

    // Clear in-memory dedup state so downloads proceed
    const { clearMediaQueueState, markFreshRefreshAppId } = await import("../services/mediaDownloadQueue");
    clearMediaQueueState();

    // Mark this appId as a fresh artwork refresh so flush does not carry
    // forward stale existing-media paths for roles that fail to download.
    markFreshRefreshAppId(appIdStr);

    // Clear session cache so next load picks up fresh files from disk
    const { clearResolvedMediaSessionCache, resetRepairedAppInfoIds } = await import("../services/gameCacheService");
    clearResolvedMediaSessionCache();
    resetRepairedAppInfoIds();
    const appIdNum = Number(appIdStr);
    if (!appIdNum || isNaN(appIdNum)) {
      showWarning(t("library_details.invalid_appid"), { title: t("library_details.artwork") });
      return;
    }

    // ── Ensure Steam metadata is resolved for best artwork sources ──
    // Start only from resolvedGame metadata (Steam data), NOT from Lua
    // metadata which lacks Steam artwork fields.  If resolvedGame is null
    // (Lua-only / non-installed game), fetch fresh metadata by appId.
    let meta = resolvedGame?.metadata ?? null;
    if (!meta || !meta.resolved || (meta as any).name === `Steam App ${appIdNum}`) {
      const result = await resolveGameMetadata([appIdNum]).catch(() => null);
      meta = result?.[appIdNum] ?? null; // null means resolver skips gracefully
    }

    const localPaths = canonicalAppInfo?.media ?? null;

    // ── Resolve artwork using the full priority chain ──
    // Steam CDN → Steam metadata → screenshots → SGDB → RAWG → IGDB
    const { bundle } = await refreshGameDetailsArtwork(
      appIdStr,
      localPaths,
      meta,
      selectedGame?.imageUrl ?? null,
      null,
      {
        sgdbApiKey: settings.steamGridDbApiKey ?? "",
        sgdbEnabled: settings.steamGridDbArtworkEnabled && !!settings.steamGridDbApiKey,
        rawgApiKey: settings.rawgApiKey ?? "",
        igdbClientId: settings.igdbClientId ?? "",
        igdbClientSecret: settings.igdbClientSecret ?? "",
      },
    );

    // ── Set bundle so materialize effect can apply localPath on download ──
    if (_refreshInitiatorRef.current !== appIdStr) {
      if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][STALE_RESULT_IGNORED] resultAppId=${appIdStr} currentAppId=${selectedGame?.appId ?? "(null)"} reason=stale-refresh`);
      return;
    }
    setFallbackBundle(bundle);

    // ── Build fallback candidate URLs per role ──
    // For each role, collect all possible HTTP URLs in priority order (CDN,
    // metadata, screenshots).  If the first candidate fails to download, the
    // next is tried automatically until one succeeds or all are exhausted.
    // This avoids ending up with a null local file when the first CDN URL
    // does not exist for a given appId (e.g. library_hero.jpg missing).
    const { resolveGameMediaPaths: checkDiskPaths } = await import("../services/tauri");
    const metaFallback = meta as Record<string, any> | null;
    const steamCdnBase = `https://steamcdn-a.akamaihd.net/steam/apps/${appIdNum}`;
    const screenshots: string[] = metaFallback?.screenshots ?? [];

    const isStorePageBackground = (url: string): boolean =>
      /storepagebackground/i.test(url) ||
      /\/images\/storepagebackground\/app\//i.test(url);

    function getRoleCandidates(role: string): string[] {
      switch (role) {
        case "landscape":
          return [
            `${steamCdnBase}/header.jpg`,
            metaFallback?.header_image,
            ...(screenshots.length > 0 ? [screenshots[0]] : []),
          ].filter(Boolean) as string[];
        case "background":
          // storepagebackground is NOT included here — it is only used as an
          // absolute last resort (see storePageBg handling below).  Correct
          // visual artwork candidates are: CDN hero, metadata hero/header fields,
          // and screenshots.
          return [
            `${steamCdnBase}/library_hero.jpg`,
            metaFallback?.library_hero_image,
            metaFallback?.hero_image,
            metaFallback?.header_image,
            ...(screenshots.length > 0 ? [screenshots[0]] : []),
            ...(screenshots.length > 1 ? [screenshots[1]] : []),
          ].filter(Boolean) as string[];
        case "logo":
          // Logo must come from CDN or metadata logo fields.  No fallback to
          // header/screenshot/capsule — those are not logos.
          return [
            `${steamCdnBase}/logo.png`,
            metaFallback?.logo_image,
            metaFallback?.library_logo_image,
          ].filter(Boolean) as string[];
        case "cover":
          // Cover must be poster/vertical — capsule/header are horizontal.
          // Only SGDB/IGDB/imageUrl provide poster cover; those are already
          // handled by refreshGameDetailsArtwork.  No generic CDN fallback.
          return [];
        case "icon":
          return [];
        default:
          return [];
      }
    }

    // ── Force-download all resolved artwork roles with fallback ──
    const roles = ["cover", "landscape", "background", "logo", "icon"] as const;
    let hasQueued = 0;
    let hasAnyUrl = false;
    for (const role of roles) {
      const asset = (bundle as any)[role] as { url?: string; source?: string } | undefined;
      if (asset?.url) {
        hasAnyUrl = true;
        const logLabel = asset.source ? `source=${asset.source}` : "";
        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH] appid=${appIdStr} role=${role} url=${asset.url} ${logLabel}`);
      }
    }

    // Check disk for stale local paths before enqueuing
    const diskPaths = await checkDiskPaths(appIdStr).catch(() => null);

    for (const role of roles) {
      const asset = (bundle as any)[role] as { url?: string; source?: string } | undefined;

      // ── No URL at all from resolver → skip ──
      if (!asset?.url) {
        const candidates = getRoleCandidates(role);
        if (candidates.length > 0) {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][FALLBACK_DIRECT] appid=${appIdStr} role=${role} reason=resolver-no-url candidates=${candidates.length} firstUrl=${candidates[0]}`);
          // Skip the resolver's "no-url" — fallback candidates will be tried below
        } else {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][ENQUEUE_SKIP] appid=${appIdStr} role=${role} reason=no-url`);
          continue;
        }
      }

      // ── Local source handling with disk verification ──
      // Verify the local file actually exists on disk AND its filename
      // matches the expected role pattern (e.g. landscape.* for landscape).
      // If stale/missing/wrong-role, treat as stale and proceed to enqueue
      // the best remote candidate.
      if (asset?.source === "local" && !/^https?:\/\//i.test(asset.url ?? "")) {
        const rolePattern = new RegExp(`^${role}\\.`);
        const filename = (asset.url ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
        const fileExists = diskPaths?.[`${role}Path` as keyof typeof diskPaths];
        const roleMatches = rolePattern.test(filename);

        if (!fileExists || !roleMatches) {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][LOCAL_STALE] appid=${appIdStr} role=${role} path=${asset.url} reason=${!fileExists ? "file-missing" : "wrong-role"} fileExists=${!!fileExists} roleMatches=${roleMatches}`);
          // Fall through to try remote candidates below
        } else {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][ENQUEUE_SKIP] appid=${appIdStr} role=${role} reason=local-source-valid path=${asset.url}`);
          continue;
        }
      }

      // ── Build candidate URL list for this role ──
      // Start with the resolver's chosen URL (the highest-priority match),
      // then append fallback URLs from getRoleCandidates, deduplicating.
      // storepagebackground URLs are deferred to the very end and only used
      // if no visually-better background candidate (hero/header/screenshot)
      // is available.
      const candidates: string[] = [];
      const seen = new Set<string>();
      let deferredStorePageBg: string | null = null;

      // If resolver produced a valid HTTP URL
      if (asset?.url && /^https?:\/\//i.test(asset.url) && !seen.has(asset.url)) {
        if (isStorePageBackground(asset.url)) {
          deferredStorePageBg = asset.url;
        } else {
          candidates.push(asset.url);
          seen.add(asset.url);
        }
      }

      // Append fallback candidates, deferring storepagebackground
      for (const url of getRoleCandidates(role)) {
        if (!seen.has(url)) {
          if (isStorePageBackground(url)) {
            if (!deferredStorePageBg) deferredStorePageBg = url;
          } else {
            candidates.push(url);
            seen.add(url);
          }
        }
      }

      // Only append storepagebackground if no better visual candidate exists
      if (deferredStorePageBg && role === "background") {
        const hasBetterCandidate = candidates.some((c) =>
          /library_hero|hero_image|header_image|header\.jpg|screenshot/i.test(c),
        );
        if (!hasBetterCandidate || candidates.length === 0) {
          if (!seen.has(deferredStorePageBg)) {
            candidates.push(deferredStorePageBg);
            seen.add(deferredStorePageBg);
          }
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_BACKGROUND_CANDIDATES] appid=${appIdStr} role=background storepagebackground=last-resort`);
        } else {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_BACKGROUND_SKIP] appid=${appIdStr} source=storepagebackground reason=better-header-or-screenshot-exists`);
        }
      }
      // For non-background roles, append any remaining storepagebackground
      // deferral (unlikely but keeps the logic generic).
      if (deferredStorePageBg && role !== "background" && !seen.has(deferredStorePageBg)) {
        candidates.push(deferredStorePageBg);
        seen.add(deferredStorePageBg);
      }

      if (candidates.length === 0) {
        if (role === "background") {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_BACKGROUND_CANDIDATES] appid=${appIdStr} reason=no-candidates`);
        }
        continue;
      }

      if (role === "background") {
        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_BACKGROUND_CANDIDATES] appid=${appIdStr} candidates=${candidates.length}`);
        candidates.forEach((c, ci) => {
          const label = isStorePageBackground(c) ? " ambient=true" : "";
          if (DEBUG_ACTIVITY) console.log(`  candidate=${ci} url=${c}${label}`);
        });
      }

      if (!hasAnyUrl) hasAnyUrl = true;
      hasQueued++;
      let downloadSucceeded = false;
      for (let ci = 0; ci < candidates.length; ci++) {
        const url = candidates[ci];
        const isFirst = ci === 0;
        const enqueueStart = Date.now();
        const attemptLabel = isFirst ? "" : ` fallback=${ci}`;

        if (!isFirst) {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][FALLBACK_NEXT] appid=${appIdStr} role=${role} candidate=${ci} url=${url}`);
        }

        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][ENQUEUE_START] appid=${appIdStr} role=${role} url=${url} target=media/${role}.jpg${attemptLabel}`);
        const enqResult = await enqueueMediaDownload({
          id: `refresh-${appIdStr}-${role}-${isFirst ? "0" : String(ci)}-${Date.now()}`,
          appId: appIdStr,
          provider: "steam" as const,
          mediaType: role as "landscape" | "cover" | "background" | "logo" | "icon",
          url,
          target: "canonical",
          priority: "high" as const,
          forceRefresh: true,
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][ENQUEUE_RESULT] appid=${appIdStr} role=${role} candidate=${ci} queued=false reason=error elapsedMs=${Date.now() - enqueueStart} error=${msg}`);
          return null;
        });
        if (enqResult) {
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][ENQUEUE_RESULT] appid=${appIdStr} role=${role} candidate=${ci} queued=${enqResult.success} elapsedMs=${Date.now() - enqueueStart} localPath=${enqResult.localPath ?? "(none)"}`);
          if (enqResult.success) {
            downloadSucceeded = true;
            if (role === "background") {
              if (DEBUG_ACTIVITY) console.log(`[ARTWORK_BACKGROUND_SELECTED] appid=${appIdStr} source=${asset?.source ?? "fallback"} url=${url}`);
            }
            break;
          }
          if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][DOWNLOAD_FAIL] appid=${appIdStr} role=${role} candidate=${ci} url=${url} reason=failed`);
        }
      }

      if (!downloadSucceeded) {
        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][ALL_CANDIDATES_FAILED] appid=${appIdStr} role=${role} candidates=${candidates.length}`);
      }
    }

    if (hasQueued > 0) {
      showWarning(t("library_details.artwork_refresh_queued", { count: hasQueued }), { title: t("library_details.artwork") });
    } else {
      if (!hasAnyUrl) {
        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH] appid=${appIdStr} reason=no-urls meta=${meta ? "resolved" : "null"} metaResolved=${meta?.resolved ?? "n/a"}`);
      } else {
        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH] appid=${appIdStr} reason=all-urls-skipped after-queued-check`);
      }
      showWarning(t("library_details.no_artwork"), { title: t("library_details.artwork") });
    }

    // ── Optional: SGDB enhancement for artwork gallery ──
    if (settings.steamGridDbArtworkEnabled && settings.steamGridDbApiKey) {
      const { clearArtworkCache } = await import("../services/storeArtworkResolver");
      clearArtworkCache();
      const { clearGameMediaCacheForGame } = await import("../services/libraryLocalCacheService");
      await clearGameMediaCacheForGame({ appId: appIdStr }).catch(() => {});
      const result = await resolveArtworkForAppIds([appIdNum], settings.steamGridDbApiKey);
      if (_refreshInitiatorRef.current !== appIdStr) {
        if (DEBUG_ACTIVITY) console.log(`[ARTWORK_REFRESH][STALE_RESULT_IGNORED] resultAppId=${appIdStr} currentAppId=${selectedGame?.appId ?? "(null)"} reason=stale-sgdb`);
        return;
      }
      if (result[appIdStr]) {
        setArtwork(result[appIdStr]);
        const sgdbJobs: Array<{ mediaType: string; url?: string }> = [
          { mediaType: "landscape", url: result[appIdStr].sgdbGridUrl || result[appIdStr].sgdbGridThumbUrl || result[appIdStr].sgdbHeroUrl },
          { mediaType: "cover", url: result[appIdStr].sgdbCoverUrl },
          { mediaType: "background", url: result[appIdStr].sgdbHeroUrl },
          { mediaType: "logo", url: result[appIdStr].sgdbLogoUrl },
          { mediaType: "icon", url: result[appIdStr].sgdbIconUrl },
        ];
        for (const { mediaType, url } of sgdbJobs) {
          if (!url) continue;
          enqueueMediaDownload({
            id: `refresh-sgdb-${appIdStr}-${mediaType}-${Date.now()}`,
            appId: appIdStr,
            provider: "steam" as const,
            mediaType: mediaType as any,
            url,
            target: "canonical",
            priority: "high" as const,
            forceRefresh: true,
          }).catch(() => {});
        }
      }
    }
  }, [
    selectedGame,
    resolvedGame,
    canonicalAppInfo,
    settings.steamGridDbArtworkEnabled,
    settings.steamGridDbApiKey,
    settings.rawgApiKey,
    settings.igdbClientId,
    settings.igdbClientSecret,
  ]);

  async function handleInstall(game: LibraryGame) {
    if (game.source === "debrid" && DEBRID_INSTALL_ENABLED && DEBRID_LIBRARY_ENABLED) {
      if (game.appId) {
        const { getRepacksForAppId } = await import("../services/repackCatalogService");
        const repacks = await getRepacksForAppId(Number(game.appId));
        if (repacks.length > 1) {
          if (DEBUG_DEBRID_INSTALL) console.log(`[DEBRID][INSTALL_SELECTOR] appId=${game.appId} title="${game.title}" repacks=${repacks.length}`);
          setDebridRepacks(repacks);
          setDebridInstallGame(game);
          return;
        }
        if (repacks.length === 1) {
          const rawEntry = repacks[0];
          const resolved = await resolveDebridInstallUri(rawEntry.downloadUris, confirm, game.title);
          if (!resolved.ok) {
            if (resolved.reason === "no-uri") {
              showWarning(t("library_page.debrid_no_uri"), { title: t("library_page.not_available") });
            }
            return;
          }
          downloadQueue.addDebridInstallJob(
            rawEntry.id,
            game.title,
            resolved.uri,
            rawEntry.installerType || "zip",
            game.appId ?? "",
            undefined,
            rawEntry.repacker,
            resolved.method,
          );
          return;
        }
      }
      const { getDebridRepackEntry } = await import("../services/debridGameStore");
      const providerGameId = game.providerGameId ?? game.id;
      const rawEntry = getDebridRepackEntry(providerGameId);
      if (!rawEntry) {
        showWarning(t("library_page.debrid_not_found"), { title: t("library_page.not_available") });
        return;
      }
      const resolved = await resolveDebridInstallUri(rawEntry.downloadUris, confirm, game.title);
      if (!resolved.ok) {
        if (resolved.reason === "no-uri") {
          showWarning("No download URI available for this Debrid game.", { title: "Not available" });
        }
        return;
      }
      downloadQueue.addDebridInstallJob(
        providerGameId,
        game.title,
        resolved.uri,
        rawEntry.installerType || "zip",
        game.appId ?? "",
        undefined,
        game.repacker,
        resolved.method,
      );
      return;
    }

    // Epic: show confirmation modal
    if (game.source === "epic" && game.isInstallable) {
      setInstallConfirmGame(game);
      return;
    }

    // Steam: show confirmation modal
    if (game.appId) {
      setInstallConfirmGame(game);
      return;
    } else {
      showWarning(t("library_page.not_available_no_appid"), { title: t("library_page.not_available") });
    }
  }

  async function handleConfirmInstall() {
    const game = installConfirmGame;
    if (!game) return;
    setInstallConfirmGame(null);

    // Epic: open Epic Games Launcher install dialog
    if (game.source === "epic" && game.isInstallable) {
      const { epicOpenInstall } = await import("../services/tauri");
      const parts = game.providerGameId?.split(":");
      const appName = parts && parts.length >= 3 ? parts[parts.length - 1] : parts?.[0];
      if (appName) {
        try {
          await epicOpenInstall(appName);
          epicInstallTrackerService.startTracking(appName, game.title, game.imageUrl);
        } catch (err) {
          showError(String(err), { title: t("library_page.toast.error", "Error") });
        }
      } else {
        showWarning(t("library_page.epic_no_identity", "Cannot determine Epic game identity."), { title: t("library_page.not_available") });
      }
      return;
    }

    // Steam: direct install
    if (game.appId) {
      try {
        await installSteamApp(Number(game.appId));
        installTrackerService.startTracking(game.appId, settings.steamRoot, game.title || String(game.appId), game.imageUrl);
      } catch (err) {
        showError(String(err), { title: t("sidebar.error") });
      }
    }
  }

  function handleOpenSteamStore(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamStoreUrl(Number(game.appId))).catch(() =>
      showError(t("library_details.could_not_open_steam"), { title: t("sidebar.error") })
    );
  }

  function handleOpenSteamDb(game: LibraryGame) {
    if (!game.appId) return;
    openExternalUrl(getSteamDbUrl(Number(game.appId))).catch(() =>
      showError(t("library_details.could_not_open_steamdb"), { title: t("sidebar.error") })
    );
  }

  function handleBack() {
    setSelectedGame(null);
    onBack?.();
  }

  if (!selectedGame) {
    return (
      <div className="flex h-full items-center justify-center p-5 lg:p-7">
        <p className="text-(--color-muted)">{t("library_details.no_game_selected")}</p>
      </div>
    );
  }

  const displayGame = resolvedGame || selectedGame;
  if (DEBUG_META_TRACE) {
    const _src = displayGame.source;
    const _id = displayGame.appId || displayGame.id;
    const _hasMeta = !!displayGame.metadata;
    const _resolved = displayGame.metadata?.resolved;
    const _hasShortDesc = !!displayGame.metadata?.short_description;
    const _hasAbout = !!displayGame.metadata?.about_the_game;
    const _hasLocalDetails = !!localDetailsData;
    const _canonLoaded = canonicalLoaded;
    const _metaLoading = metadataLoading;
    const _hasCanonInfo = !!canonicalAppInfo;
    const _useResolved = !!resolvedGame;
    console.log(`[META_TRACE][RENDER] appId=${_id} src=${_src} useResolved=${_useResolved} hasMeta=${_hasMeta} resolved=${_resolved} hasShortDesc=${_hasShortDesc} hasAbout=${_hasAbout} localDetails=${_hasLocalDetails} canonLoaded=${_canonLoaded} metaLoading=${_metaLoading} hasCanonInfo=${_hasCanonInfo}`);
  }
  const currentSession = session.getSession(gameKey);
  const appInfoEntry = displayGame.appId ? (appInfoMap[displayGame.appId] ?? null) : null;
  const detailTitle = resolveCanonicalDisplayTitle(
    displayGame.appId ?? "",
    displayGame,
    appInfoEntry,
    canonicalAppInfo,
  );

  // ── Re-resolve artwork when media is changed from the edit dialog ──
  const handleMediaChanged = useCallback(() => {
    setResetGeneration((g) => g + 1);
  }, []);

  // Disabled by default. Set window.__DEBUG_NAME_TRACE = true in dev console to enable.
  if ((window as any).__DEBUG_NAME_TRACE) {
    console.log(`[NAME][DISPLAY] appid=${displayGame.appId} title=${detailTitle}`);
  }

  return (
    <div className="lf-page-in h-full">
      <LibraryGameDetails
        key={`library:game-details:${selectedGame.source ?? "unknown"}:${selectedGame.appId || selectedGame.id}`}
        game={displayGame}
        artwork={artwork}
        appInfoEntry={appInfoEntry}
        mediaEntry={mediaEntry}
        canonicalAppInfo={canonicalAppInfo}
        canonicalDiskFallback={canonicalDiskFallback}
        localDetailsData={localDetailsData}
        fallbackBundle={fallbackBundle}
        loading={metadataLoading}
        canonicalLoaded={canonicalLoaded}
        onPlay={handlePlay}
        onInstall={handleInstall}
        onOpenSteam={handleOpenSteamStore}
        onOpenSteamDb={handleOpenSteamDb}
        onBack={handleBack}
        onRefreshArtwork={handleRefreshArtwork}
        onMediaChanged={handleMediaChanged}
        onOpenTools={() => setToolsModalOpen(true)}
        onDeleteScript={handleDeleteScript}
        onNavigate={onNavigate}
        launchInfo={launchInfo}
        onCancelLaunch={cancelLaunch}
        onOpenStopModal={handleOpenStopModal}
      />
      <ToolsModal
        open={toolsModalOpen}
        game={displayGame}
        onClose={() => setToolsModalOpen(false)}
      />
      <DebridSourceSelectorModal
        open={debridRepacks.length > 0 && Boolean(debridInstallGame)}
        repacks={debridRepacks}
        gameTitle={debridInstallGame?.title ?? ""}
        appId={debridInstallGame?.appId}
        onInstallSource={async (repack: RepackQueryResult) => {
          if (!debridInstallGame) return;
          const resolved = await resolveDebridInstallUri(repack.downloadUris, confirm, debridInstallGame.title);
          if (!resolved.ok) {
            if (resolved.reason === "no-uri") {
              showWarning(t("library_page.debrid_no_uri_source"), { title: t("library_page.not_available") });
            }
            return;
          }
          downloadQueue.addDebridInstallJob(
            repack.id,
            debridInstallGame.title,
            resolved.uri,
            repack.installerType || "zip",
            debridInstallGame.appId ?? "",
            undefined,
            debridInstallGame.repacker,
            resolved.method,
          );
        }}
        onClose={() => {
          setDebridRepacks([]);
          setDebridInstallGame(null);
        }}
      />
      <StopGameModal
        open={showStopModal}
        gameTitle={detailTitle}
        canTerminate={!!launchInfo.pid}
        isSoftSession={currentSession?.softSession ?? true}
        trackingConfidence={currentSession?.trackingConfidence}
        onClose={() => setShowStopModal(false)}
        onConfirmStop={handleConfirmStop}
        onMarkStopped={handleMarkAsStopped}
        onFindProcess={handleFindProcess}
      />
      {installConfirmGame && (
        <InstallConfirmModal
          game={installConfirmGame}
          open={true}
          onClose={() => setInstallConfirmGame(null)}
          onConfirm={handleConfirmInstall}
        />
      )}
    </div>
  );
}
