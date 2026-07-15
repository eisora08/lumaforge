import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useGameDetails } from "../context/GameDetailsContext";
import { useLibraryGames } from "../context/LibraryGamesContext";
import { useSettings } from "../context/SettingsContext";
import { useDownloadQueue } from "../hooks/useDownloadQueue";
import { resolveGameMetadata } from "../services/gameMetadataResolver";
import { resolveGameReviewSummaries } from "../services/gameReviewResolver";
import { useGameOwnershipLookup } from "../features/search/useGameOwnershipLookup";
import { getSourceAvailability, loadSourceAvailabilityIndex } from "../services/sourceAvailabilityCacheService";
import { getStoreDetailsState } from "../services/storeDetailsSourceState";
import { downloadFromSource, type DownloadFromSourceDeps } from "../features/download/downloadFromSource";
import { scanInstalledLuaScripts } from "../services/tauri";
import { getSourceKey } from "../utils/sourceHelpers";

import StoreGameDetailsPage from "../components/store/StoreGameDetailsPage";
import { SkeletonHero, SkeletonBox } from "../components/common/Skeleton";
import type { PackageGame, PackageSource } from "../types/package";
import type { SteamAppMetadata } from "../types/gameMetadata";
import type { SteamReviewSummary } from "../types/gameReview";
import type { PackageInstallStatus } from "../types/packageInstall";
import type { SourceCheckStatus } from "../services/sourceAvailabilityCacheService";

function DetailsShell({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 p-5 lg:p-7">
      <button
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-(--surface-active-border) bg-white/5 px-3 py-2 text-xs text-(--color-text) transition hover:bg-white/10"
      >
        ← Back
      </button>
      <SkeletonHero />
      <div className="space-y-3">
        <SkeletonBox className="h-5 w-64" />
        <SkeletonBox className="h-4 w-full" />
        <SkeletonBox className="h-4 w-5/6" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <SkeletonBox className="h-20 rounded-xl" />
        <SkeletonBox className="h-20 rounded-xl" />
        <SkeletonBox className="h-20 rounded-xl" />
      </div>
    </div>
  );
}

export default function GameDetailsPage({ onBack }: { onBack: () => void }) {
  const { selectedGame, selectGame, clearSelection } = useGameDetails();
  const { refresh: libraryRefresh } = useLibraryGames();
  const { settings } = useSettings();
  const { addJob, updateJob } = useDownloadQueue();
  const ownershipLookup = useGameOwnershipLookup();
  const _mountedRef = useRef(true);

  const [metadata, setMetadata] = useState<SteamAppMetadata | undefined>();
  const [reviewSummary, setReviewSummary] = useState<SteamReviewSummary | undefined>();
  const [metadataLoading, setMetadataLoading] = useState(true);

  // Hydrated source state — restored from source availability cache
  const [hydratedSources, setHydratedSources] = useState<PackageSource[]>([]);
  const [hydratedStatus, setHydratedStatus] = useState<SourceCheckStatus | undefined>();
  // Source key selection (persists across renders for current game)
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | undefined>();

  useEffect(() => {
    _mountedRef.current = true;
    return () => { _mountedRef.current = false; };
  }, []);

  // Local Lua scan state — canonical real-time disk check, mirrors Store's
  // installedStatusByAppId behavior
  const [localLuaInstalled, setLocalLuaInstalled] = useState(false);

  // Reactive ownership/install state from shared lookup hook
  const currentAppId = selectedGame?.appId;
  const steamOwned = ownershipLookup.isOwned(currentAppId);
  const isSteamInstalled = ownershipLookup.isSteamInstalled(currentAppId);

  // Derive luaInstalled from local scan (canonical) with hook fallback
  const luaInstalled = localLuaInstalled || ownershipLookup.isLuaActive(currentAppId);

  // Derive installStatus from ownership data
  const installStatus: PackageInstallStatus = isSteamInstalled || luaInstalled
    ? "active"
    : "not-installed";

  const lookupLua = ownershipLookup.isLuaActive(currentAppId);
  console.log(
    `[GAME_DETAILS][DETAIL_PROPS] appid=${currentAppId} localLuaInstalled=${localLuaInstalled} lookupLua=${lookupLua} luaInstalled=${luaInstalled} isSteamInstalled=${isSteamInstalled} installStatus=${installStatus}`,
  );

  const packageGame: PackageGame | null = useMemo(() => {
    if (!selectedGame) return null;
    return {
      appId: selectedGame.appId,
      title: selectedGame.title,
      imageUrl: selectedGame.imageUrl,
      platforms: [],
      sources: [],
    };
  }, [selectedGame]);

  // Helper to find the game's hydrated overlay with sources for source operations
  const gameWithSources: PackageGame | null = useMemo(() => {
    if (!packageGame) return null;
    if (hydratedSources.length > 0 && hydratedStatus === "ready") {
      return { ...packageGame, sources: hydratedSources };
    }
    return packageGame;
  }, [packageGame, hydratedSources, hydratedStatus]);

  // Hydrate source state from cache on appId change
  useEffect(() => {
    // Reset source selection when navigating to a different game
    setSelectedSourceKey(undefined);

    const sg = selectedGame;
    if (!sg) return;
    const appId = sg.appId;
    const appIdNum = Number(appId);
    if (!Number.isFinite(appIdNum)) return;
    const title = sg.title;

    let cancelled = false;

    async function hydrate() {
      console.log(`[GLOBAL_SEARCH][OPEN_STORE_DETAILS] appid=${appId} title=${title}`);

      // Step 1: Restore saved provider/source from store details state (module-level, instant)
      const detailsState = getStoreDetailsState(appId);
      if (detailsState) {
        console.log(
          `[STORE][DETAILS_STATE_RESTORE] appid=${appId} selectedProvider=${detailsState.selectedProvider} status=${detailsState.status}`,
        );
      }

      // Step 2: Load source availability cache if not already loaded
      await loadSourceAvailabilityIndex();
      if (cancelled) return;

      const cached = getSourceAvailability(appId);
      if (cached && cached.status === "ready" && cached.availableSources.length > 0) {
        const sources: PackageSource[] = cached.availableSources.map((s) => ({
          providerId: s.id as any,
          providerName: s.name,
          fileType: s.type as any,
          available: s.status === "ready",
          downloadUrl: s.packageUrl,
        }));
        if (!cancelled) {
          setHydratedSources(sources);
          setHydratedStatus("ready");
          console.log(`[STORE][SOURCE_RESTORE_FROM_CACHE] appid=${appId} found=${sources.length}`);
        }
      } else {
        // Cache miss or incomplete — let StoreGameDetailsPage internal check handle source discovery
        const reason = !cached
          ? "no-cache-entry"
          : cached.availableSources.length === 0
            ? "no-sources"
            : `status=${cached.status}`;
        console.log(`[STORE][SOURCE_EMPTY_GUARD] appid=${appId} reason=${reason} — not overwriting existing with empty`);
        if (!cancelled) {
          setHydratedSources([]);
          setHydratedStatus(undefined);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame?.appId]);

  const appIdNum = selectedGame ? Number(selectedGame.appId) : null;
  const validAppIds: number[] = appIdNum !== null && Number.isFinite(appIdNum) ? [appIdNum] : [];

  useEffect(() => {
    if (validAppIds.length === 0) return;
    // Show loading skeleton when navigating to a different game
    setMetadataLoading(true);
    let cancelled = false;
    async function load() {
      try {
        const [metaMap] = await Promise.all([
          resolveGameMetadata(validAppIds),
        ]);
        if (cancelled) return;
        setMetadata(metaMap[validAppIds[0]]);
      } catch { /* ignore */ }
      if (!cancelled) setMetadataLoading(false);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdNum]);

  useEffect(() => {
    if (validAppIds.length === 0) return;
    // Clear stale review summary when navigating to a different game
    setReviewSummary(undefined);
    let cancelled = false;
    async function load() {
      try {
        const [summaries] = await Promise.all([
          resolveGameReviewSummaries(validAppIds),
        ]);
        if (cancelled) return;
        setReviewSummary(summaries[validAppIds[0]]);
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdNum]);

  // Log ownership state reactively (fires on appId change or ownership/install change)
  useEffect(() => {
    const appId = selectedGame?.appId;
    if (!appId) return;
    const inLib = steamOwned ? !isSteamInstalled : luaInstalled;
    console.log(
      `[STORE][OWNERSHIP_STATE] appid=${appId} owned=${steamOwned} installed=${isSteamInstalled} luaInstalled=${luaInstalled} inLibrary=${inLib}`,
    );
  }, [selectedGame?.appId, steamOwned, isSteamInstalled, luaInstalled]);

  // Local Lua disk scan — canonical real-time check matching Store's installedStatusByAppId
  useEffect(() => {
    setLocalLuaInstalled(false);
    if (!currentAppId || !settings.luaPath) return;
    let cancelled = false;
    (async () => {
      console.log(`[GAME_DETAILS][LUA_SCAN_START] appid=${currentAppId}`);
      try {
        const scripts = await scanInstalledLuaScripts(settings.luaPath!);
        if (cancelled) return;
        const numAppId = Number(currentAppId);
        const match = scripts.find((s) => s.app_id === numAppId);
        const active = !!match && !match.is_disabled;
        console.log(`[GAME_DETAILS][LUA_SCAN_RESULT] appid=${currentAppId} found=${!!match} active=${active} path=${match?.path ?? "none"}`);
        setLocalLuaInstalled(active);
      } catch {
        if (!cancelled) setLocalLuaInstalled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentAppId, settings.luaPath]);

  // Build display game — prefer hydrated sources, fall back to bare packageGame
  const displayGame: PackageGame | null = useMemo(() => {
    if (!packageGame) return null;
    if (hydratedSources.length > 0 && hydratedStatus === "ready") {
      return { ...packageGame, sources: hydratedSources };
    }
    return packageGame;
  }, [packageGame, hydratedSources, hydratedStatus]);

  // Only pass sourceStatus to StoreGameDetailsPage when we have real cached data
  // Otherwise let the internal check handle discovery
  const effectiveSourceStatus: SourceCheckStatus | undefined =
    hydratedStatus === "ready" ? "ready" : undefined;

  const handleBack = () => {
    clearSelection();
    onBack();
  };

  // Download handler — delegates to shared Store-canonical downloadFromSource helper
  const handleDownloadSource = useCallback(async (source: PackageSource): Promise<{ success: boolean; jobId?: string }> => {
    const game = gameWithSources ?? displayGame;
    if (!game) return { success: false };

    const deps: DownloadFromSourceDeps = {
      settings,
      addJob,
      updateJob,
      libraryRefresh,
      mountedRef: _mountedRef,
    };
    const result = await downloadFromSource(game, source, deps);
    if (result.success && currentAppId && settings.luaPath) {
      console.log(`[GAME_DETAILS][LUA_SCAN_START] appid=${currentAppId} reason=post-download`);
      try {
        const scripts = await scanInstalledLuaScripts(settings.luaPath);
        const numAppId = Number(currentAppId);
        const match = scripts.find((s) => s.app_id === numAppId);
        const active = !!match && !match.is_disabled;
        console.log(`[GAME_DETAILS][LUA_SCAN_RESULT] appid=${currentAppId} found=${!!match} active=${active} path=${match?.path ?? "none"}`);
        setLocalLuaInstalled(active);
      } catch {
        // localLuaInstalled stays as-is
      }
    }
    return result;
  }, [gameWithSources, displayGame, settings, addJob, updateJob, libraryRefresh, currentAppId]);

  // Open another game from "More Like This" section
  const handleOpenGame = useCallback((game: PackageGame) => {
    selectGame({ appId: game.appId, title: game.title, imageUrl: game.imageUrl });
  }, [selectGame]);

  // Source key selection handler
  const handleSelectSourceKey = useCallback((sourceKey: string) => {
    const appId = displayGame?.appId;
    console.log(`[STORE][SOURCE_CHANGE] appid=${appId} from=${selectedSourceKey ?? "null"} to=${sourceKey}`);
    setSelectedSourceKey(sourceKey);
  }, [displayGame?.appId, selectedSourceKey]);

  // Find the selected source by key for the effectiveSelectedSource prop
  const effectiveSelectedSource: PackageSource | undefined = useMemo(() => {
    if (!selectedSourceKey || !gameWithSources) return undefined;
    return gameWithSources.sources.find((s) => getSourceKey(s) === selectedSourceKey);
  }, [selectedSourceKey, gameWithSources]);

  if (!displayGame) {
    return (
      <div className="mx-auto w-full max-w-[1440px] p-5 lg:p-7">
        <p className="text-(--color-muted)">No game selected.</p>
      </div>
    );
  }

  if (metadataLoading) {
    return <DetailsShell onBack={handleBack} />;
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] p-5 lg:p-7">
      <StoreGameDetailsPage
        game={displayGame}
        metadata={metadata}
        reviewSummary={reviewSummary}
        installStatus={installStatus}
        isSteamInstalled={isSteamInstalled}
        luaInstalled={luaInstalled}
        steamOwned={steamOwned}
        selectedSource={effectiveSelectedSource}
        sourceStatus={effectiveSourceStatus}
        moreLikeThisGames={[]}
        onBack={handleBack}
        onDownloadSource={handleDownloadSource}
        onOpenGame={handleOpenGame}
        onSelectSourceKey={handleSelectSourceKey}
      />
    </div>
  );
}
