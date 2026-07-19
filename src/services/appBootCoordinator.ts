import { loadStartupSnapshot } from "./startupSnapshotService";
import type { StartupSnapshot } from "./startupSnapshotService";
import { invoke } from "@tauri-apps/api/core";
import { backgroundJobQueue } from "./backgroundJobQueue";
import { loadSettings } from "../context/SettingsContext";
import type { AppSettings } from "../types/settings";
import type { SteamGameIndexEntry } from "./fullSteamGameIndex";
import { initPerfCounters, setBootPhaseLabel } from "./perfCounters";
import { reportLibraryProgress } from "./libraryProgressService";
import { isIntegrationScanOnStartup, isIntegrationEnabled } from "./integrationSettingsService";

export type BootStatus =
  | "booting"
  | "ready"
  | "error"
  | "timeout";

export type BootTaskId =
  | "load-settings"
  | "migrate-portable-paths"
  | "load-startup-snapshot"
  | "load-manual-games"
  | "enrich-snapshot-titles"
  | "load-local-game-index"
  | "reconcile-lua-games"
  | "load-achievement-summaries"
  | "load-cached-media-index"
  | "start-achievement-watcher"
  | "start-background-job-queue"
  | "load-playtime-store"
  | "schedule-background-repair"
  | "confirm-mounted";

export type BootLogEntry = {
  taskId: BootTaskId;
  status: "started" | "done" | "skipped" | "error";
  error?: string;
  elapsedMs: number;
};

const MAX_SPLASH_TIMEOUT_MS = 10_000;

let _bootStatus: BootStatus = "booting";
let _bootProgress = 0;
let _bootError: string | null = null;
let _bootLog: BootLogEntry[] = [];
let _listeners: Set<() => void> = new Set();
let _bootPromise: Promise<void> | null = null;
let _bootStart = 0;
let _snapshotLoaded: StartupSnapshot | null = null;
let _snapshotResolve: (() => void) | null = null;
let _snapshotReady: Promise<void> = new Promise((resolve) => {
  _snapshotResolve = resolve;
});
let _splashClosed = false;
let _cachedSettings: AppSettings | null = null;
let _cachedGameIndex: SteamGameIndexEntry[] | null = null;
let _enrichedTitleAppIds: Map<string, string> = new Map();

export function getBootSnapshot(): StartupSnapshot | null {
  return _snapshotLoaded;
}

export async function waitForBootSnapshot(): Promise<StartupSnapshot | null> {
  await _snapshotReady;
  return _snapshotLoaded;
}

function notify(): void {
  for (const fn of _listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

function logBoot(msg: string): void {
  console.log(`[BOOT] ${msg}`);
}

async function closeSplashscreenAndShowMainOnce(): Promise<void> {
  if (_splashClosed) return;
  _splashClosed = true;
  logBoot("showing main window");
  try {
    await invoke("close_splashscreen_and_show_main");
    logBoot("splash closed");
  } catch (err) {
    console.warn("[BOOT] close splash command failed:", String(err));
  }
}

function track(taskId: BootTaskId, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  const log = (status: BootLogEntry["status"], error?: string) => {
    _bootLog.push({ taskId, status, error, elapsedMs: Math.round(performance.now() - start) });
  };

  log("started");
  return fn()
    .then(() => {
      log("done");
      _bootProgress = Math.min(100, _bootProgress + 10);
      notify();
    })
    .catch((err) => {
      const msg = String(err);
      console.warn("[BOOT] task error:", taskId, msg);
      log("error", msg);
      _bootError = msg;
      _bootProgress = Math.min(100, _bootProgress + 5);
      notify();
    });
}

export function getBootStatus(): BootStatus {
  return _bootStatus;
}

export function getBootProgress(): number {
  return _bootProgress;
}

export function getBootError(): string | null {
  return _bootError;
}

export function getBootLog(): BootLogEntry[] {
  return [..._bootLog];
}

export function isBootReady(): boolean {
  return _bootStatus === "ready";
}

export function getCachedSettings(): AppSettings | null {
  return _cachedSettings;
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export async function runBootTasks(): Promise<void> {
  if (_bootPromise) return _bootPromise;

  initPerfCounters();
  setBootPhaseLabel("critical-start");
  logBoot("start");
  _bootStatus = "booting";
  _bootProgress = 0;
  _bootError = null;
  _bootLog = [];
  _bootStart = Date.now();
  _splashClosed = false;

  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("Boot timeout")), MAX_SPLASH_TIMEOUT_MS);
  });

  _bootPromise = (async () => {
    try {
      await Promise.race([
        (async () => {
          // Stage 1: Load settings
          await track("load-settings", async () => {
            logBoot("load settings start");
            try {
              _cachedSettings = await loadSettings() as unknown as AppSettings;
              logBoot("settings loaded");
            } catch (err) {
              console.warn("[BOOT] settings load failed:", String(err));
            }
            logBoot("load settings end");

            // Register Lua backup settings accessor — reads current settings from
            // localStorage on each call, so runtime settings updates are always visible.
            try {
              const { registerLuaBackupSettingsAccessor } = await import("./steamLuaBackupService");
              registerLuaBackupSettingsAccessor(() => loadSettings() as Record<string, unknown>);
              logBoot("lua backup settings accessor registered");
            } catch {
              // Non-critical — Lua backup gracefully returns empty when accessor is missing
            }
          });

          // Stage 2: Migrate portable paths (safe, non-blocking)
          await track("migrate-portable-paths", async () => {
            logBoot("running portable path migration");
            try {
              const { migrateAchievementsToProviderFolders } = await import("./tauri");
              const result = await migrateAchievementsToProviderFolders();
              if (result.migrated > 0) {
                logBoot(`migrated ${result.migrated} achievement folders`);
              }
              if (result.errors && result.errors.length > 0) {
                console.warn("[BOOT] migration errors:", result.errors);
              }
            } catch (err) {
              // Migration is optional — log but don't block
              console.warn("[BOOT] migration skipped:", String(err));
            }
            logBoot("portable path migration done");
          });

          // Stage 3: Load startup snapshot (instant from file)
          await track("load-startup-snapshot", async () => {
            logBoot("load snapshot start");
            reportLibraryProgress({ phase: "hydrating-snapshot", source: "snapshot" });
            try {
              _snapshotLoaded = await loadStartupSnapshot();
              if (_snapshotLoaded) {
                const gameCount = _snapshotLoaded.library.games.length;
                const sidebarCount = _snapshotLoaded.sidebar.items.length;
                const snapshotAge = Date.now() - _snapshotLoaded.updatedAt;
                const isFresh = snapshotAge < 24 * 60 * 60 * 1000;
                logBoot(`snapshot hydrated from file — games: ${gameCount}, sidebar items: ${sidebarCount}`);
                console.log(`[BOOT][CACHE] snapshotFresh=${!!isFresh}`);
                console.log(`[BOOT][CACHE] rebuildNeeded=${!isFresh}`);
                // Hydrate media stats
                let withLandscape = 0, withCover = 0, withIcon = 0, missingMedia = 0;
                for (const g of _snapshotLoaded.library.games) {
                  if (g.media?.landscapePath) withLandscape++;
                  if (g.media?.coverPath) withCover++;
                  if (g.media?.iconPath) withIcon++;
                  if (!g.media?.landscapePath && !g.media?.coverPath && !g.media?.backgroundPath && !g.media?.iconPath) missingMedia++;
                }
                console.log(`[BOOT][MEDIA] hydrated games=${gameCount}`);
                console.log(`[BOOT][MEDIA] withLandscape=${withLandscape}`);
                console.log(`[BOOT][MEDIA] withCover=${withCover}`);
                console.log(`[BOOT][MEDIA] withIcon=${withIcon}`);
                console.log(`[BOOT][MEDIA] missingMedia=${missingMedia}`);
                // Hydrate: repair missing media paths from canonical appinfo
                const { hydrateStartupSnapshotMedia } = await import("./startupSnapshotService");
                const hydrateResult = await hydrateStartupSnapshotMedia(_snapshotLoaded);
                console.log(`[BOOT][CACHE] hydrateResult: changed=${hydrateResult.changed} repaired=${hydrateResult.repairedCount} ready=${hydrateResult.readyCount} partial=${hydrateResult.partialCount} missing=${hydrateResult.missingCount} stale=${hydrateResult.staleCount}`);
                // Fingerprint checks (Phase 5)
                const indexes = _snapshotLoaded.indexes;
                const hasFingerprints = !!(indexes as any).luaFingerprint || !!(indexes as any).appinfoFingerprint;
                console.log(`[BOOT][CACHE] luaFingerprintChanged=unknown (no baseline)`);
                console.log(`[BOOT][CACHE] mediaFingerprintChanged=unknown (no baseline)`);
                if (!hasFingerprints) {
                  console.log(`[BOOT][CACHE] fingerprintBaseline=missing (first boot or old snapshot)`);
                }
              } else {
                console.log(`[BOOT][CACHE] snapshotFresh=false (no snapshot file)`);
              }
            } catch {
              _snapshotLoaded = null;
            }
            logBoot("load snapshot end");
          });
          reportLibraryProgress({ phase: "done", source: "snapshot" });

          if (_snapshotResolve) _snapshotResolve();
          setBootPhaseLabel("critical-done");
          logBoot("phase=critical-done");

          // Stage 3.25: Load manual games from AppData JSON (migrate from localStorage if needed)
          await track("load-manual-games", async () => {
            if (!isIntegrationEnabled("manual")) {
              logBoot("manual games skip: integration disabled");
              return;
            }
            logBoot("load manual games start");
            try {
              const { loadManualGamesFromJson } = await import("./manualGameStore");
              const manualGames = await loadManualGamesFromJson();
              logBoot(`manual games loaded: ${manualGames.length} entries from JSON`);
            } catch (e) {
              console.error("[BOOT][MANUAL_GAMES] load failed:", e);
            }
            logBoot("load manual games end");
          });

          // Stage 3.5: Enrich snapshot game titles (resolve placeholders via metadata/store)
          await track("enrich-snapshot-titles", async () => {
            logBoot("enrich snapshot titles start");
            if (_snapshotLoaded?.library?.games) {
              const { isPlaceholderSteamTitle, updateGameAppinfoMediaIfChanged } = await import("./gameCacheService");
              const { getStoreDetails } = await import("./tauri");
              const { resolveGameMetadata } = await import("./gameMetadataResolver");
              const { getCachedBootAppInfos } = await import("./startupSnapshotService");
              const placeholderGames = _snapshotLoaded.library.games.filter(
                (g) => g.appId && isPlaceholderSteamTitle(g.title, g.appId),
              );
              if (placeholderGames.length > 0) {
                const appIds = placeholderGames.map((g) => g.appId!);
                const numIds = appIds.map(Number).filter((n) => !isNaN(n));
                let metadataResolution: Record<number, import("../types/gameMetadata").SteamAppMetadata> = {};
                if (numIds.length > 0) {
                  try {
                    metadataResolution = await resolveGameMetadata(numIds);
                  } catch { /* non-critical */ }
                }
                let enrichedCount = 0;
                for (const game of placeholderGames) {
                  if (!game.appId) continue;
                  const meta = metadataResolution[Number(game.appId)];
                  if (meta?.name && !isPlaceholderSteamTitle(meta.name, game.appId)) {
                    game.title = meta.name;
                    enrichedCount++;
                    logBoot(`enriched title: appid=${game.appId} name=${meta.name} source=metadata`);
                      _enrichedTitleAppIds.set(game.appId, meta.name);
                    console.log(`[BOOT][TITLE_ENRICHED] stage=3.5 appid=${game.appId} source=metadata`);
                    // Persist canonical name to appinfo (preserving existing media)
                    try {
                      const bootCache = getCachedBootAppInfos();
                      const bootEntry = bootCache?.[game.appId] as { media?: Record<string, string | null> } | undefined;
                      const m = bootEntry?.media ?? {} as Record<string, string | null>;
                      await updateGameAppinfoMediaIfChanged(
                        game.appId, meta.name,
                        { coverPath: m.coverPath ?? null, backgroundPath: m.backgroundPath ?? null, logoPath: m.logoPath ?? null, iconPath: m.iconPath ?? null, landscapePath: m.landscapePath ?? null },
                        null, undefined, "bootStage35Enrichment",
                      ).catch(() => {});
                      console.log(`[BOOT][TITLE_APPINFO_WRITE] appid=${game.appId} source=metadata`);
                    } catch { /* non-critical */ }
                    continue;
                  }
                  try {
                    const sd = await getStoreDetails(game.appId).catch(() => null);
                    const sdData = sd?.data as { name?: string } | null;
                    if (sdData?.name && !isPlaceholderSteamTitle(sdData.name, game.appId)) {
                      game.title = sdData.name;
                      enrichedCount++;
                      logBoot(`enriched title: appid=${game.appId} name=${sdData.name} source=store`);
                      _enrichedTitleAppIds.set(game.appId, sdData.name);
                      console.log(`[BOOT][TITLE_ENRICHED] stage=3.5 appid=${game.appId} source=store`);
                      // Persist canonical name to appinfo (preserving existing media)
                      try {
                        const bootCache = getCachedBootAppInfos();
                        const bootEntry = bootCache?.[game.appId] as { media?: Record<string, string | null> } | undefined;
                        const m = bootEntry?.media ?? {} as Record<string, string | null>;
                        await updateGameAppinfoMediaIfChanged(
                          game.appId, sdData.name,
                          { coverPath: m.coverPath ?? null, backgroundPath: m.backgroundPath ?? null, logoPath: m.logoPath ?? null, iconPath: m.iconPath ?? null, landscapePath: m.landscapePath ?? null },
                          null, undefined, "bootStage35Enrichment",
                        ).catch(() => {});
                        console.log(`[BOOT][TITLE_APPINFO_WRITE] appid=${game.appId} source=store`);
                      } catch { /* non-critical */ }
                    }
                  } catch { /* ignore */ }
                }
                if (enrichedCount > 0) {
                  const { saveStartupSnapshot } = await import("./startupSnapshotService");
                  await saveStartupSnapshot(_snapshotLoaded).catch(() => {});
                  logBoot(`enriched ${enrichedCount}/${placeholderGames.length} snapshot titles`);
                }
              }
            }
            logBoot("enrich snapshot titles end");
          });

          // Stage 4: Load local game index (SQLite, instant)
          await track("load-local-game-index", async () => {
            logBoot("load game index start");
            try {
              const { loadSteamGameIndex } = await import("./fullSteamGameIndex");
              const index = await loadSteamGameIndex();
              _cachedGameIndex = index;
              if (index && index.length > 0) {
                logBoot(`game index loaded: ${index.length} games`);
              } else {
                logBoot("game index empty (first run or no games scanned)");
              }
            } catch (err) {
              console.warn("[BOOT] game index load failed:", String(err));
            }
            logBoot("load game index end");
          });

          // Stage 4.5: Reconcile local index with config/lua definitions
          await track("reconcile-lua-games", async () => {
            logBoot("reconcile lua games start");
            try {
              const settings = _cachedSettings;
              if (settings) {
                const { setReconciledGames } = await import("./gameStore");
                const { scanInstalledLuaScripts, scanSteamInstalledGames } = await import("./tauri");
                const { loadCachedGames } = await import("./gameDetectionCache");
                const { checkSteamScanAllowed, markSteamScanComplete } = await import("./libraryGameResolver");

                // Use TTL-guarded steam scan to avoid repeated scans on boot re-runs
                let steamGames: Awaited<ReturnType<typeof scanSteamInstalledGames>> = [];
                if (!isIntegrationScanOnStartup("steam")) {
                  console.log("[steam-scan][SKIP] reason=integration-disabled");
                } else if (checkSteamScanAllowed()) {
                  steamGames = await scanSteamInstalledGames({
                    steamPath: settings.steamRoot || undefined,
                    luaPath: settings.luaPath || undefined,
                    depotcachePath: settings.depotcachePath || undefined,
                    gameScanFolders: settings.gameScanFolders.length > 0 ? settings.gameScanFolders : undefined,
                  }).catch(() => []);
                  markSteamScanComplete();
                } else {
                  console.log("[steam-scan][SKIP] reason=boot-reconcile-ttl");
                }

                const [luaScripts, sqliteCache] = await Promise.all([
                  (settings.luaPath && isIntegrationScanOnStartup("lua"))
                    ? scanInstalledLuaScripts(settings.luaPath).catch(() => [])
                    : Promise.resolve([]),
                  loadCachedGames().catch(() => null),
                ]);

                const sqliteAppIds = new Set<string>();
                if (sqliteCache) {
                  for (const g of sqliteCache.games) {
                    if (g.appId) sqliteAppIds.add(g.appId);
                  }
                }

                const luaAppIds = new Set(luaScripts.map((s) => String(s.app_id)));
                const steamAppIds = new Set(steamGames.map((g) => String(g.appId)));

                // Configured games = Steam games + Lua-only games
                const allConfiguredAppIds = new Set([...steamAppIds, ...luaAppIds]);
                const missingFromSqlite: string[] = [];
                const luaOnly: string[] = [];

                for (const appId of allConfiguredAppIds) {
                  if (!sqliteAppIds.has(appId)) {
                    missingFromSqlite.push(appId);
                    if (!steamAppIds.has(appId)) {
                      luaOnly.push(appId);
                    }
                  }
                }

                const staleSqliteOnly = [...sqliteAppIds].filter((id) => !allConfiguredAppIds.has(id));

                logBoot(`sqliteGames=${sqliteAppIds.size}`);
                logBoot(`luaGames=${luaAppIds.size}`);
                logBoot(`steamGames=${steamAppIds.size}`);
                logBoot(`allConfigured=${allConfiguredAppIds.size}`);
                logBoot(`missingFromSQLite=${missingFromSqlite.length}`);
                logBoot(`luaOnly=${luaOnly.length}`);
                logBoot(`staleSqliteOnly=${staleSqliteOnly.length}`);

                let reconciledGames: import("../types/libraryGame").LibraryGame[] | null = null;

                if (missingFromSqlite.length > 0) {
                  // Build LibraryGames for missing entries by running the resolver.
                  // Use { force: true } to bypass TTL guard — the steam scan above
                  // already ran, but resolveLibraryGames needs its own scan
                  // to build the full game list with Lua overlay.
                  const { resolveLibraryGames } = await import("./libraryGameResolver");
                  const result = await resolveLibraryGames(settings, { force: true });
                  reconciledGames = result.games;
                  logBoot(`reconciled games count=${result.games.length}`);

                  // Persist reconciled list to SQLite cache so next boot is instant
                  if (result.games.length > 0) {
                    const { saveCachedGames } = await import("./gameDetectionCache");
                    await saveCachedGames(result.games, result.warnings).catch(() => {});
                    logBoot(`saved reconciled games to cache`);

                    // Also queue background SQLite upsert for the games table
                    scheduleAfterMain(async () => {
                      try {
                        const { batchUpsertGames } = await import("./tauri");
                        const entries = result.games
                          .filter((g) => g.appId)
                          .map((g) => ({
                            appId: g.appId!,
                            title: g.title || "",
                            installed: g.steamInstalled || false,
                            playtime: g.steamPlaytimeMinutes ?? 0,
                            lastPlayed: g.steamLastPlayedAt ?? 0,
                            metadataJson: JSON.stringify(g.metadata ?? {}),
                            updatedAt: Math.floor(Date.now() / 1000),
                          }));
                        if (entries.length > 0) {
                          await batchUpsertGames(entries).catch(() => {});
                          logBoot(`sqlite upserted ${entries.length} games in background`);
                        }
                      } catch { /* non-critical */ }
                    }, 5000);
                  }

                  // [STEP 2] Snapshot fallback: if reconcile returned 0 but snapshot has games,
                  // build LibraryGame[] from snapshot data so runtime state is non-empty.
                  const useSnapshot = reconciledGames === null || reconciledGames.length === 0;
                  if (useSnapshot) {
                    const { setReconciledGames, setReconciledGamesFromSnapshot } = await import("./gameStore");
                    if (_snapshotLoaded?.library?.games && _snapshotLoaded.library.games.length > 0) {
                      setReconciledGamesFromSnapshot(_snapshotLoaded.library.games);
                      reconciledGames = _snapshotLoaded.library.games.map((sg) => ({
                        id: `snapshot-${sg.appId}`,
                        appId: sg.appId,
                        title: sg.title || "",
                        source: (sg.source === "lua" ? "lua" : "steam") as import("../types/libraryGame").LibraryGameSource,
                        isPlayable: sg.playable ?? false,
                        isInstallable: !sg.playable,
                        steamInstalled: sg.installed,
                        lastPlayed: sg.lastPlayed ?? undefined,
                        playtime: sg.playtime ?? undefined,
                        luaScripts: [],
                        hasLua: sg.source === "lua",
                        isLuaActive: sg.source === "lua",
                        isLuaDisabled: false,
                        hasLuaSource: false,
                        sources: [],
                        steamLastPlayedAt: sg.lastPlayed ?? undefined,
                        steamPlaytimeMinutes: sg.playtime ?? undefined,
                      })) as unknown as import("../types/libraryGame").LibraryGame[];
                      logBoot(`[BOOT][SQLITE_EMPTY_FALLBACK] using=snapshot games=${reconciledGames!.length}`);
                      setReconciledGames(reconciledGames!);
                    } else {
                      console.log(`[BOOT][SQLITE_EMPTY_FALLBACK] using=empty (snapshot also empty)`);
                    }
                  }
                } else {
                  // Use the cached games from SQLite for name enrichment
                  if (sqliteCache && sqliteCache.games.length > 0) {
                    const { indexEntryToLibraryGame } = await import("./fullSteamGameIndex");
                    const luaOverlay = {} as Record<string, boolean>;
                    for (const id of luaAppIds) luaOverlay[id] = true;
                    if (_cachedGameIndex && _cachedGameIndex.length > 0) {
                      // Reuse Stage 4's cached game index to avoid a second readAllGames() call
                      reconciledGames = _cachedGameIndex.map((e) => indexEntryToLibraryGame(e, luaOverlay));
                      console.log(`[BOOT][SQLITE_REUSED] source=stage4 target=stage4.5 count=${_cachedGameIndex.length}`);
                    } else {
                      // Fallback: Stage 4 may have failed — load again directly
                      const { loadSteamGameIndex } = await import("./fullSteamGameIndex");
                      const index = await loadSteamGameIndex();
                      reconciledGames = index.map((e) => indexEntryToLibraryGame(e, luaOverlay));
                    }
                  }
                  // Persist to gameStore so validateStartupCacheHealth shows correct count
                  // Always call setReconciledGames; empty-overwrite guard in gameStore prevents wipe
                  if (reconciledGames) {
                    const { setReconciledGames } = await import("./gameStore");
                    setReconciledGames(reconciledGames);
                    console.log(`[GAMESTORE][HYDRATE] source=reconciled games=${reconciledGames.length}`);
                  }
                }

                // Source selection log
                {
                  const runtimeSource = reconciledGames && reconciledGames.length > 0
                    ? (sqliteAppIds.size > 0 ? "reconciled" : "snapshot")
                    : "sqlite";
                  console.log(`[BOOT][SOURCE_SELECT] runtimeSource=${runtimeSource} snapshot=${_snapshotLoaded?.library?.games?.length ?? 0} lua=${luaAppIds.size} steam=${steamAppIds.size} sqlite=${sqliteAppIds.size}`);
                }

                // Resolve names for games with placeholder/empty titles and
                // persist to canonical appinfo so snapshot hydration can use them.
                // Runs regardless of whether reconciliation was needed.
                if (reconciledGames && reconciledGames.length > 0) {
                  const { isPlaceholderSteamTitle } = await import("./gameCacheService");
                  const { readCanonicalAppinfos, getStoreDetails } = await import("./tauri");
                  const { updateGameAppinfoMediaIfChanged } = await import("./gameCacheService");
                  const { resolveGameMetadata } = await import("./gameMetadataResolver");
                  const emptyTitleGames = reconciledGames.filter(
                    (g) => g.appId && isPlaceholderSteamTitle(g.title, g.appId),
                  );
                  if (emptyTitleGames.length > 0) {
                    const appIds = emptyTitleGames.map((g) => g.appId!);
                    // Try boot cache first — populated by Stage 3 hydrateStartupSnapshotMedia
                    const { getCachedBootAppInfos, clearCachedBootAppInfos } = await import("./startupSnapshotService");
                    const bootCache = getCachedBootAppInfos();
                    let appinfos: Record<string, any>;
                    if (bootCache) {
                      appinfos = {} as Record<string, any>;
                      for (const id of appIds) {
                        if (bootCache[id]) {
                          appinfos[id] = bootCache[id];
                        }
                      }
                      const cachedCount = Object.keys(appinfos).length;
                      if (cachedCount > 0) {
                        console.log(`[BOOT][APPINFO_CACHE] hit appIds=${appIds.length} cached=${cachedCount}`);
                      }
                      const missingIds = appIds.filter(id => !appinfos[id]);
                      if (missingIds.length > 0) {
                        const missingInfos = await readCanonicalAppinfos(missingIds).catch(() => ({} as Record<string, any>));
                        Object.assign(appinfos, missingInfos);
                      }
                    } else {
                      appinfos = await readCanonicalAppinfos(appIds).catch(() => ({} as Record<string, any>));
                      console.log(`[BOOT][APPINFO_CACHE] miss appIds=${appIds.length}`);
                    }
                    // Also resolve metadata — may find names that canonical/store don't have yet
                    const numIds = appIds.map(Number).filter((n) => !isNaN(n));
                    let metadataResolution: Record<number, import("../types/gameMetadata").SteamAppMetadata> = {};
                    if (numIds.length > 0) {
                      try { metadataResolution = await resolveGameMetadata(numIds); } catch { /* non-critical */ }
                    }
                    for (const game of emptyTitleGames) {
                      if (!game.appId) continue;
                      // Skip if Stage 3.5 already enriched this game
                      if (_enrichedTitleAppIds.has(game.appId)) {
                        const realName = _enrichedTitleAppIds.get(game.appId);
                        if (realName) {
                          game.title = realName;
                          console.log(`[BOOT][TITLE_ENRICH_SKIP] stage=4.5 appid=${game.appId} reason=already-enriched`);
                        }
                        continue;
                      }
                      const appinfo = appinfos[game.appId];
                      const meta = metadataResolution[Number(game.appId)];
                      let resolvedName: string | null = null;
                      let source = "";
                      if (appinfo?.name && !isPlaceholderSteamTitle(appinfo.name, game.appId)) {
                        resolvedName = appinfo.name;
                        source = "appinfo";
                      } else if (meta?.name && !isPlaceholderSteamTitle(meta.name, game.appId)) {
                        resolvedName = meta.name;
                        source = "metadata";
                      }
                      if (!resolvedName) {
                        try {
                          const sd = await getStoreDetails(game.appId).catch(() => null);
                          const sdData = sd?.data as { name?: string } | null;
                          if (sdData?.name && !isPlaceholderSteamTitle(sdData.name, game.appId)) {
                            resolvedName = sdData.name;
                            source = "store-details";
                          }
                        } catch { /* ignore */ }
                      }
                      if (resolvedName) {
                        console.log(`[NAME][CANONICAL_WRITE] appid=${game.appId} name=${resolvedName} source=${source}`);
                        game.title = resolvedName;
                        // Read existing appinfo to preserve media paths (only update name)
                        const existingForName = appinfos[game.appId];
                        const existingMedia = existingForName?.media ?? {};
                        updateGameAppinfoMediaIfChanged(
                          game.appId, resolvedName,
                          {
                            coverPath: existingMedia.coverPath ?? null,
                            backgroundPath: existingMedia.backgroundPath ?? null,
                            logoPath: existingMedia.logoPath ?? null,
                            iconPath: existingMedia.iconPath ?? null,
                            landscapePath: existingMedia.landscapePath ?? null,
                          },
                          null,
                          undefined,
                          "bootStage45Enrichment",
                        ).catch(() => {});
                      } else {
                        console.log(`[NAME][LIBRARY] appid=${game.appId} title=pending (no local source)`);
                      }
                    }
                    setReconciledGames(reconciledGames);

                    // Update the cached in-memory snapshot so dashboard/grid surfaces
                    // see the real names immediately (they read snapshot game.title).
                    const { getCachedSnapshot, saveStartupSnapshot } = await import("./startupSnapshotService");
                    const cachedSnap = getCachedSnapshot();
                    if (cachedSnap?.library) {
                      let snapChanged = false;
                      for (const enriched of emptyTitleGames) {
                        if (!enriched.appId) continue;
                        const sg = cachedSnap.library.games.find(g => g.appId === enriched.appId);
                        if (sg && sg.title !== enriched.title) {
                          sg.title = enriched.title;
                          snapChanged = true;
                        }
                      }
                      if (snapChanged) {
                        await saveStartupSnapshot(cachedSnap).catch(() => {});
                        logBoot(`snapshot titles updated count=${emptyTitleGames.filter(g => g.appId && !isPlaceholderSteamTitle(g.title, g.appId)).length}`);
                      }
                    }
                    // Invalidate boot cache — disk was updated by updateGameAppinfoMediaIfChanged above
                    clearCachedBootAppInfos();
                  }
                }

                logBoot(`finalGames=${allConfiguredAppIds.size}`);
              }
            } catch (err) {
              console.warn("[BOOT] reconcile lua games failed:", String(err));
            }
            logBoot("reconcile lua games end");
          });

          // Stage 5: Load cached achievement summaries into store (only if auto-enabled)
          await track("load-achievement-summaries", async () => {
            logBoot("load achievement summaries start");
            try {
              const { ACHIEVEMENT_READ_CACHE_ON_BOOT, logCacheReadBootSkipOnce } = await import("./achievementAutoFlags");
              if (!ACHIEVEMENT_READ_CACHE_ON_BOOT) {
                logCacheReadBootSkipOnce();
              } else {
                  const { achievementStore } = await import("./achievementStore");
                  const { readAchievementCache } = await import("./tauri");
                  if (_snapshotLoaded) {
                    const appIds = _snapshotLoaded.library.games.map((g) => g.appId).filter(Boolean);
                    let loaded = 0;
                    // Load up to 20 summaries during splash — enough for instant UI
                    // Batch with Promise.all for concurrent Tauri invokes
                    const batch = appIds.slice(0, 20);
                    const results = await Promise.allSettled(
                      batch.map((appId) => readAchievementCache(Number(appId)))
                    );
                    for (let i = 0; i < batch.length; i++) {
                      const appId = batch[i];
                      const result = results[i];
                      if (result.status === "fulfilled") {
                        const cache = result.value;
                        if (cache) {
                        const summary = {
                          appId,
                          total: cache.achievements.length,
                          unlocked: cache.achievements.filter((a: { unlocked: boolean }) => a.unlocked).length,
                          progressAvailable: cache.summary.progress_available,
                          achievements: cache.achievements.map((a: { api_name: string; name: string; description?: string; icon?: string | null; icon_url?: string | null; icon_gray?: string | null; icon_gray_url?: string | null; unlocked: boolean; unlock_time?: number | null; rarity_percent?: number | null; rarity_level?: string | null }) => ({
                            apiName: a.api_name,
                            name: a.name,
                            description: a.description ?? "",
                            iconUrl: a.icon ?? a.icon_url ?? null,
                            iconGrayUrl: a.icon_gray ?? a.icon_gray_url ?? null,
                            unlocked: a.unlocked,
                            unlockTime: a.unlock_time ?? null,
                            rarityPercent: a.rarity_percent ?? null,
                            rarityLevel: a.rarity_level ?? null,
                          })),
                          newlyUnlocked: [],
                        };
                        achievementStore.setSummary(appId, summary as any);
                        loaded++;
                      }
                    }
                  }
                  if (loaded > 0) {
                    logBoot(`loaded ${loaded} achievement summaries into store`);
                  }
                }
              }
            } catch (err) {
              console.warn("[BOOT] achievement summaries load failed:", String(err));
            }
            logBoot("load achievement summaries end");
          });

          // Stage 6: Load cached media index (from snapshot + manifests)
          await track("load-cached-media-index", async () => {
            logBoot("seed media cache from snapshot");
            try {
              if (_snapshotLoaded) {
                const { seedResolvedMediaCacheFromSnapshot, seedMediaIndexFromStartup, getAllMediaEntries } = await import("./gameCacheService");
                seedResolvedMediaCacheFromSnapshot(_snapshotLoaded.library.games);
                // Seed MediaIndex from per-game manifests for instant runtime URLs
                const appIds = _snapshotLoaded.library.games.map((g) => g.appId).filter(Boolean) as string[];
                await seedMediaIndexFromStartup(appIds);
                const entries = getAllMediaEntries();
                if (entries.length > 0) {
                  const withLandscape = entries.filter((e) => e.hasLandscape).length;
                  const withCover = entries.filter((e) => e.hasCover).length;
                  const withIcon = entries.filter((e) => e.hasIcon).length;
                  const missing = entries.filter((e) => !e.hasLandscape && !e.hasCover && !e.hasBackground && !e.hasIcon).length;
                  console.log(`[MEDIA_INDEX] initialized games=${entries.length}`);
                  console.log(`[MEDIA_INDEX] withLandscape=${withLandscape}`);
                  console.log(`[MEDIA_INDEX] withCover=${withCover}`);
                  console.log(`[MEDIA_INDEX] withIcon=${withIcon}`);
                  console.log(`[MEDIA_INDEX] missing=${missing}`);
                }
                logBoot("media cache seeded from snapshot");
              }
            } catch (err) {
              console.warn("[BOOT] media cache seed failed:", String(err));
            }
            logBoot("cached media index done");
          });

          // Stage 6.5: Load playtime store for Activity playtime/lastPlayed lookups
          await track("load-playtime-store", async () => {
            logBoot("load playtime store start");
            try {
              const { loadPlaytimeStore } = await import("./playtimeService");
              await loadPlaytimeStore();
              logBoot("load playtime store done");
            } catch (err) {
              console.warn("[BOOT] playtime store load failed:", String(err));
            }
          });

          // Stage 7: Start achievement watcher (file watching only, no scanning)
          await track("start-achievement-watcher", async () => {
            logBoot("achievement watcher setup start");
            try {
              const { ACHIEVEMENT_WATCHER_ENABLED } = await import("./achievementWatcherService");
              if (ACHIEVEMENT_WATCHER_ENABLED && _cachedSettings) {
                const { achievementWatcherService } = await import("./achievementWatcherService");
                await achievementWatcherService.start(
                  _cachedSettings.steamRoot,
                  _cachedSettings.steamAccountId,
                );
                logBoot("achievement watcher started");
              } else {
                logBoot("achievement watcher disabled");
              }
            } catch (err) {
              console.warn("[BOOT] achievement watcher start failed:", String(err));
            }
            logBoot("achievement watcher setup end");
          });

          setBootPhaseLabel("post-shell-start");
          logBoot("phase=post-shell-start");

          // Stage 8 (formerly Stage 7): Start background job queue idle processing
          await track("start-background-job-queue", async () => {
            logBoot("background job queue ready");
            // The queue was imported at module level; it's ready to accept jobs.
            // Actual processing starts when jobs are enqueued.
            backgroundJobQueue.setRouteShellReady(true);
            logBoot("background job queue initialized");
          });

          // Stage 9 (formerly Stage 8): Schedule background repair jobs (after main UI opens)
          await track("schedule-background-repair", async () => {
            logBoot("scheduling background repair");
            try {
              // Use the already-defined scheduleAfterMain
              scheduleAfterMain(async () => {
                // Enqueue low-priority validation
                backgroundJobQueue.enqueue("validate-portable-paths", "steam", { priority: "low" });

                // Emergency stabilization: achievement migration disabled
                if (_snapshotLoaded) {
                  const { ACHIEVEMENT_SCHEMA_MIGRATION_AUTO, ACHIEVEMENT_IMAGE_MIGRATION_AUTO } = await import("./achievementStore");
                  const { achievementStore } = await import("./achievementStore");
                  const appIds = _snapshotLoaded.library.games
                    .filter((g) => g.appId && g.source === "steam")
                    .map((g) => g.appId!);
                  // Only enqueue for games not already in store
                  const missing: string[] = [];
                  for (const appId of appIds) {
                    if (!achievementStore.getSummary(appId)) {
                      missing.push(appId);
                    }
                  }

                  // Schemas and image jobs only if auto-migration is enabled
                  if (ACHIEVEMENT_SCHEMA_MIGRATION_AUTO) {
                    // Repair existing cache entries with wrong icon_gray paths
                    const firstBatch = appIds.slice(0, 5);
                    await Promise.allSettled(
                      firstBatch.map((aid) => achievementStore.repairGrayIconPaths(aid, "boot"))
                    );

                    // Batch to avoid overwhelming the queue
                    const batch = missing.slice(0, 10);
                    if (batch.length > 0) {
                      const { enqueueAchievementSchemaJobs, enqueueAchievementImageJobs } = await import("./backgroundJobQueue");
                      enqueueAchievementSchemaJobs(batch, "low");
                      if (ACHIEVEMENT_IMAGE_MIGRATION_AUTO) {
                        enqueueAchievementImageJobs(batch, "low");
                      }
                      logBoot(`scheduled background achievement jobs for ${batch.length} games`);
                    }
                  }
                }
                // Startup media hydration — fill missing appinfo fields
                try {
                  const hash = typeof window !== "undefined" ? window.location.hash : "";
                  if (hash.startsWith("#/store")) {
                    console.log("[BOOT][MEDIA_HYDRATE_SKIP] reason=store-active");
                  } else if (_snapshotLoaded) {
                    const { hydrateMediaOnStartup } = await import("./gameCacheService");
                    const appIds = _snapshotLoaded.library.games
                      .filter((g) => g.appId)
                      .map((g) => g.appId!);
                    // Chunk to avoid blocking main thread
                    const CHUNK_SIZE = 10;
                    for (let i = 0; i < appIds.length; i += CHUNK_SIZE) {
                      const chunk = appIds.slice(i, i + CHUNK_SIZE);
                      await hydrateMediaOnStartup(chunk);
                    }
                  }
                } catch (err) {
                  console.warn("[BOOT] media hydration failed:", String(err));
                }
                // Validate startup cache health
                try {
                  const hash = typeof window !== "undefined" ? window.location.hash : "";
                  if (!hash.startsWith("#/store")) {
                    const { validateStartupCacheHealth } = await import("./gameStore");
                    await validateStartupCacheHealth();
                  } else {
                    console.log("[BOOT][HEALTH_SKIP] reason=store-active");
                  }
                } catch (err) {
                  console.warn("[BOOT] cache health validation failed:", String(err));
                }
                // One-time duplicate detection
                if (_snapshotLoaded) {
                  const snapshotGames = _snapshotLoaded.library.games;
                  const appIds = snapshotGames.map((g) => g.appId).filter(Boolean);
                  const uniqueAppIds = new Set(appIds);
                  if (uniqueAppIds.size < appIds.length) {
                    console.log(`[BOOT][DEDUP_FOUND] snapshot has ${appIds.length - uniqueAppIds.size} duplicate appIds`);
                  }
                }
              }, 2000);
            } catch (err) {
              console.warn("[BOOT] background repair scheduling failed:", String(err));
            }
            logBoot("background repair scheduled");
          });

          // Stage 10 (formerly Stage 9): Confirm main window is mounted
          await track("confirm-mounted", async () => {
            logBoot("route shell ready");
            setBootPhaseLabel("post-shell-done");
          });

          // Performance summary: aggregate metrics from boot stages
          setBootPhaseLabel("idle-ready");
          const perfSummary = {
            snapshotGames: _snapshotLoaded?.library.games.length ?? 0,
            snapshotSidebar: _snapshotLoaded?.sidebar.items.length ?? 0,
          };
          console.log(`[BOOT][PERF_SUMMARY] snapshotGames=${perfSummary.snapshotGames} snapshotSidebar=${perfSummary.snapshotSidebar} elapsedMs=${Date.now() - _bootStart}`);

          _bootStatus = "ready";
          _bootProgress = 100;
          notify();
          backgroundJobQueue.setBootCompleted(true);
          logBoot("phase=idle-ready");

          // Evaluate launcher achievements after boot
          setTimeout(() => {
            import("../features/activity/achievements/achievementEngine").then(({ evaluateAchievements }) => {
              import("../features/activity/stats/statsService").then(({ buildEvalContext }) => {
                import("./gameStore").then(({ getReconciledGames }) => {
                  import("./manualGameStore").then(({ getAllManualGames }) => {
                    import("./manualGameLibraryMapper").then(({ manualGameToLibraryGame }) => {
                      const steamGames = getReconciledGames();
                      const manualGames = getAllManualGames().map(manualGameToLibraryGame);
                      const games = [...steamGames, ...manualGames];
                      if (games.length > 0) {
                        const ctx = buildEvalContext(games);
                        const result = evaluateAchievements(ctx);
                        if (result.newlyUnlocked.length > 0) {
                          console.log(`[LAUNCHER_ACH][BOOT] unlocked=${result.newlyUnlocked.map(a => a.id).join(",")}`);
                          import("../components/activity/AchievementToast").then(({ showAchievementToasts }) => {
                            showAchievementToasts(result.newlyUnlocked);
                          });
                        }
                      }
                    });
                  });
                });
              });
            });
          }, 3000);

          // Log performance counter summary after boot settles (deferred via microtask)
          const { logBootPerfSummary } = await import("./perfCounters");
          setTimeout(() => logBootPerfSummary(), 100);

          // Deferred installed Lua scanner — runs after UI is interactive
          if (_cachedSettings?.luaPath) {
            setTimeout(() => {
              const luaDir = _cachedSettings!.luaPath!;
              const hubcapSettings = _cachedSettings!.providers?.hubcapdb;
              const hubcapConfig = hubcapSettings?.enabled && hubcapSettings?.baseUrl && hubcapSettings?.apiKey
                ? { baseUrl: hubcapSettings.baseUrl, apiKey: hubcapSettings.apiKey }
                : undefined;
              import("./installedLuaScanner").then(({ runInstalledLuaScan }) => {
                runInstalledLuaScan({ luaDir, hubcapConfig }).catch((err: unknown) => {
                  console.warn("[PACKAGE_SCAN][ERROR]", String(err));
                });
              });
            }, 2000);
          }
        })(),
        timeoutPromise,
      ]);
    } catch (err) {
      const isTimeout = (err as Error).message === "Boot timeout";
      if (isTimeout) {
        logBoot("timeout reached, showing main anyway");
      } else {
        console.warn("[BOOT] error:", (err as Error).message);
      }
      _bootStatus = isTimeout ? "timeout" : "error";
      _bootError = (err as Error).message ?? "Boot failed";
      _bootProgress = 80;
      notify();

      if (_snapshotResolve) _snapshotResolve();
    } finally {
      if (_snapshotResolve) _snapshotResolve();
      await closeSplashscreenAndShowMainOnce();
    }
  })();

  return _bootPromise;
}

export function scheduleAfterMain(fn: () => void | Promise<void>, delayMs: number = 3000): void {
  const run = async () => {
    setTimeout(async () => {
      try {
        await fn();
      } catch (err) {
        console.warn("[BOOT] afterMain task failed:", String(err));
      }
    }, delayMs);
  };

  if (_bootStatus === "ready" || _bootStatus === "timeout") {
    run();
  } else {
    const unsub = subscribe(() => {
      if (_bootStatus === "ready" || _bootStatus === "timeout") {
        unsub();
        run();
      }
    });
  }
}

export function resetBootState(): void {
  _bootStatus = "booting";
  _bootProgress = 0;
  _bootError = null;
  _bootLog = [];
  _bootPromise = null;
  _snapshotLoaded = null;
  _snapshotReady = new Promise((resolve) => {
    _snapshotResolve = resolve;
  });
  _splashClosed = false;
  notify();
}
