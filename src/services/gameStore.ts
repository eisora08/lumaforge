import type { LibraryGame } from "../types/libraryGame";

let _reconciledGames: LibraryGame[] = [];
let _reconciledAt: number | null = null;
let _listeners: Set<() => void> = new Set();

export function getReconciledGames(): LibraryGame[] {
  return _reconciledGames;
}

export function getReconciledAt(): number | null {
  return _reconciledAt;
}

export function setReconciledGames(games: LibraryGame[]): void {
  // Guard: never overwrite a non-empty game list with an empty one
  if (games.length === 0 && _reconciledGames.length > 0) {
    console.log(`[GAMESTORE][EMPTY_OVERWRITE_BLOCKED] current=${_reconciledGames.length} incoming=0`);
    return;
  }
  _reconciledGames = games;
  _reconciledAt = Date.now();
  notify();
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function notify(): void {
  for (const fn of _listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function clearReconciledGames(): void {
  _reconciledGames = [];
  _reconciledAt = null;
  notify();
}

/**
 * setReconciledGamesFromSnapshot — converts SnapshotGame[] to LibraryGame[]
 * and stores them as the reconciled games list. Used when SQLite is empty
 * and the full resolver returned no games, but snapshot data exists.
 */
export function setReconciledGamesFromSnapshot(
  snapshotGames: Array<{ appId: string; title: string; source: string; playable?: boolean; installed?: boolean; lastPlayed?: number | null; playtime?: number | null }>,
): void {
  const games: LibraryGame[] = snapshotGames.map((sg) => ({
    id: `snapshot-${sg.appId}`,
    appId: sg.appId,
    title: sg.title || "",
    source: (sg.source === "lua" ? "lua" : "steam") as LibraryGame["source"],
    isPlayable: sg.playable ?? false,
    isInstallable: !sg.playable,
    steamInstalled: sg.installed ?? false,
    hasLua: sg.source === "lua",
    isLuaActive: sg.source === "lua",
    isLuaDisabled: false,
    hasLuaSource: false,
    luaScripts: [],
    sources: [],
    lastPlayed: sg.lastPlayed ?? undefined,
    playtime: sg.playtime ?? undefined,
    steamLastPlayedAt: sg.lastPlayed ?? undefined,
    steamPlaytimeMinutes: sg.playtime ?? undefined,
  }));
  _reconciledGames = games;
  _reconciledAt = Date.now();
  console.log(`[GAMESTORE][HYDRATE] set reconciled games from snapshot count=${games.length}`);
  notify();
}

// ---------------------------------------------------------------------------
// Library health validation
// ---------------------------------------------------------------------------

export type LibraryHealthReport = {
  luaGames: number;
  sqliteGames: number;
  reconciledGames: number;
  missingFromSQLite: number;
  missingFromStore: number;
  staleSqliteOnly: number;
  missingMedia: number;
  invalidPaths: number;
  details: string[];
};

export async function validateLibraryIndexHealth(
  storeGames: LibraryGame[],
): Promise<LibraryHealthReport> {
  const details: string[] = [];
  let missingMedia = 0;
  let invalidPaths = 0;

  // Count Lua-defined games
  const luaAppIds = new Set<string>();
  const { scanInstalledLuaScripts, readAllGames } = await import("./tauri");
  const { getCachedSettings } = await import("./appBootCoordinator");
  const settings = getCachedSettings();
  if (settings?.luaPath) {
    try {
      const scripts = await scanInstalledLuaScripts(settings.luaPath);
      for (const s of scripts) luaAppIds.add(String(s.app_id));
    } catch { /* ignore */ }
  }

  // Count SQLite games
  let sqliteEntries: { appId: string }[] = [];
  try {
    sqliteEntries = await readAllGames();
  } catch { /* ignore */ }

  const sqliteAppIds = new Set(sqliteEntries.map((e) => e.appId));
  const reconciledAppIds = new Set(storeGames.filter((g) => g.appId).map((g) => g.appId!));
  const allConfigured = new Set([...luaAppIds, ...reconciledAppIds]);

  const missingFromSQLite = [...allConfigured].filter((id) => !sqliteAppIds.has(id));
  const missingFromStore = [...allConfigured].filter((id) => !reconciledAppIds.has(id));
  const staleSqliteOnly = [...sqliteAppIds].filter((id) => !allConfigured.has(id));

  // Check media health — batch all appIds in a single invoke
  const mediaHealthAppIds = storeGames.filter((g) => g.appId).map((g) => g.appId!) as string[];
  if (mediaHealthAppIds.length > 0) {
    const { resolveGameMediaPathsBatch } = await import("./tauri");
    const paths = await resolveGameMediaPathsBatch(mediaHealthAppIds);
    for (const game of storeGames) {
      if (!game.appId) continue;
      const gamePaths = paths[game.appId];
      if (!gamePaths || (!gamePaths.landscapePath && !gamePaths.coverPath && !gamePaths.backgroundPath)) {
        missingMedia++;
        details.push(`[HEALTH] appid=${game.appId} no media files on disk`);
      }
    }
  }

  // Check for invalid persisted paths (absolute appdata paths)
  if (settings) {
    try {
      const { validatePortablePaths } = await import("./tauri");
      const result = await validatePortablePaths();
      invalidPaths = result.absolutePaths + result.assetUrlsPersisted + result.remoteIconFields;
      if (result.details.length > 0) {
        for (const d of result.details) {
          details.push(`[HEALTH] ${d}`);
        }
      }
    } catch { /* ignore */ }
  }

  const report: LibraryHealthReport = {
    luaGames: luaAppIds.size,
    sqliteGames: sqliteAppIds.size,
    reconciledGames: reconciledAppIds.size,
    missingFromSQLite: missingFromSQLite.length,
    missingFromStore: missingFromStore.length,
    staleSqliteOnly: staleSqliteOnly.length,
    missingMedia,
    invalidPaths,
    details,
  };

  console.log(`[LIBRARY][HEALTH] luaGames=${report.luaGames}`);
  console.log(`[LIBRARY][HEALTH] sqliteGames=${report.sqliteGames}`);
  console.log(`[LIBRARY][HEALTH] reconciledGames=${report.reconciledGames}`);
  console.log(`[LIBRARY][HEALTH] missingFromSQLite=${report.missingFromSQLite}`);
  console.log(`[LIBRARY][HEALTH] missingFromStore=${report.missingFromStore}`);
  console.log(`[LIBRARY][HEALTH] missingMedia=${report.missingMedia}`);
  console.log(`[LIBRARY][HEALTH] invalidPaths=${report.invalidPaths}`);

  return report;
}

/** Dev console convenience: calls validateLibraryIndexHealth with cached games. */
export async function validateLibraryIndexHealthFromStore(): Promise<LibraryHealthReport | null> {
  try {
    const games = getReconciledGames();
    if (!games || games.length === 0) {
      console.warn("[LIBRARY][HEALTH] no cached games available");
      return null;
    }
    return await validateLibraryIndexHealth(games);
  } catch {
    return null;
  }
}

// ── Media cache health validation (PART 16) ──

export type MediaCacheHealthReport = {
  games: number;
  withLandscapePath: number;
  withLandscapeUrl: number;
  withCoverPath: number;
  withIconPath: number;
  withIconUrl: number;
  missingFiles: number;
  missingSources: number;
  absolutePaths: number;
  assetUrlsPersisted: number;
  details: string[];
};

export async function validateMediaCacheHealth(): Promise<MediaCacheHealthReport> {
  const details: string[] = [];
  let withLandscapePath = 0;
  let withLandscapeUrl = 0;
  let withCoverPath = 0;
  let withIconPath = 0;
  let withIconUrl = 0;
  let missingFiles = 0;
  let missingSources = 0;
  let absolutePaths = 0;
  let assetUrlsPersisted = 0;

  try {
    const { readCanonicalAppinfos, validateSnapshotMediaPathsBatch } = await import("./tauri");
    const appIds = _reconciledGames.map((g) => g.appId).filter(Boolean) as string[];
    const appinfos = await readCanonicalAppinfos(appIds);
    let gamesCount = 0;

    // Phase 3+5: Batch-validate all media paths in a single invoke.
    const mediaValidationBatch: Record<string, { landscapePath: string | null; coverPath: string | null; backgroundPath: string | null; logoPath: string | null; iconPath: string | null }> = {};
    for (const [appId, info] of Object.entries(appinfos)) {
      if (info?.media) {
        mediaValidationBatch[appId] = info.media;
      }
    }
    const validatedBatch = Object.keys(mediaValidationBatch).length > 0
      ? await validateSnapshotMediaPathsBatch(mediaValidationBatch)
      : {};

    for (const [appId, info] of Object.entries(appinfos)) {
      if (!info) continue;
      gamesCount++;
      if (info.media?.landscapePath) {
        withLandscapePath++;
        const isLocalRel = info.media.landscapePath.startsWith("media/") || info.media.landscapePath.startsWith("img/");
        if (!isLocalRel) withLandscapeUrl++;
      }
      if (info.media?.coverPath) withCoverPath++;
      if (info.media?.iconPath) {
        withIconPath++;
        const isLocalRel = info.media.iconPath.startsWith("media/") || info.media.iconPath.startsWith("img/");
        if (!isLocalRel) withIconUrl++;
      }

      if (info.media) {
        for (const field of ["landscapePath", "coverPath", "backgroundPath", "iconPath", "logoPath"] as const) {
          const val = info.media[field];
          if (!val) continue;
          if (/^[a-zA-Z]:[\\/]/.test(val)) {
            absolutePaths++;
            details.push(`[MEDIA][HEALTH] appid=${appId} absolutePath field=${field} path=${val}`);
          }
          if (/^(https?:)?\/\/(asset\.)?localhost/i.test(val) || val.startsWith("asset://") || val.startsWith("file://")) {
            assetUrlsPersisted++;
            details.push(`[MEDIA][HEALTH] appid=${appId} assetUrl field=${field} url=${val}`);
          }
        }

        const validated = validatedBatch[appId];
        if (validated) {
          const missing = [
            !validated.landscapeExists && !!info.media.landscapePath,
            !validated.coverExists && !!info.media.coverPath,
            !validated.backgroundExists && !!info.media.backgroundPath,
            !validated.iconExists && !!info.media.iconPath,
            !validated.logoExists && !!info.media.logoPath,
          ].filter(Boolean).length;
          if (missing > 0) {
            missingFiles += missing;
            details.push(`[MEDIA][HEALTH] appid=${appId} missingFiles=${missing}`);
          }
        }
      }

      if (!info.mediaSources) {
        missingSources++;
        details.push(`[MEDIA][HEALTH] appid=${appId} missingSources=true`);
      } else {
        const hasAnySource = !!(info.mediaSources.landscape || info.mediaSources.cover || info.mediaSources.background || info.mediaSources.logo || info.mediaSources.icon);
        if (!hasAnySource) {
          missingSources++;
          details.push(`[MEDIA][HEALTH] appid=${appId} mediaSources=empty`);
        }
      }
    }

    console.log(`[MEDIA][HEALTH] games=${gamesCount}`);
    console.log(`[MEDIA][HEALTH] withLandscapePath=${withLandscapePath}`);
    console.log(`[MEDIA][HEALTH] withLandscapeUrl=${withLandscapeUrl}`);
    console.log(`[MEDIA][HEALTH] withCoverPath=${withCoverPath}`);
    console.log(`[MEDIA][HEALTH] withIconPath=${withIconPath}`);
    console.log(`[MEDIA][HEALTH] withIconUrl=${withIconUrl}`);
    console.log(`[MEDIA][HEALTH] missingFiles=${missingFiles}`);
    console.log(`[MEDIA][HEALTH] missingSources=${missingSources}`);
    console.log(`[MEDIA][HEALTH] absolutePaths=${absolutePaths}`);
    console.log(`[MEDIA][HEALTH] assetUrlsPersisted=${assetUrlsPersisted}`);
  } catch (err) {
    details.push(`[MEDIA][HEALTH] error=${err}`);
  }

  return {
    games: _reconciledGames.length,
    withLandscapePath,
    withLandscapeUrl,
    withCoverPath,
    withIconPath,
    withIconUrl,
    missingFiles,
    missingSources,
    absolutePaths,
    assetUrlsPersisted,
    details,
  };
}

// ── Startup Cache Health Validation (Phase 10) ──

export async function validateStartupCacheHealth(): Promise<{
  snapshotGames: number;
  sqliteGames: number;
  reconciledCacheGames: number;
  luaGames: number;
  jobsQueued: number;
  mediaIndexEntries: number;
  mediaWithCover: number;
  mediaWithLandscape: number;
  mediaWithBackground: number;
  mediaWithLogo: number;
  mediaWithIcon: number;
}> {
  let snapshotGames = 0;
  let sqliteGames = 0;
  let reconciledCacheGames = 0;
  let luaGames = 0;
  let mediaIndexEntries = 0;
  let mediaWithCover = 0;
  let mediaWithLandscape = 0;
  let mediaWithBackground = 0;
  let mediaWithLogo = 0;
  let mediaWithIcon = 0;
  let jobsQueued = 0;

  try {
    const { loadStartupSnapshot } = await import("./startupSnapshotService");
    const snap = await loadStartupSnapshot();
    if (snap) {
      snapshotGames = snap.library.games.length;
    }
  } catch { /* ignore */ }

  try {
    const { readAllGames } = await import("./tauri");
    const all = await readAllGames();
    sqliteGames = all.length;
  } catch { /* ignore */ }

  reconciledCacheGames = _reconciledGames.length;

  try {
    const { getCachedSettings } = await import("./appBootCoordinator");
    const settings = getCachedSettings();
    const { scanInstalledLuaScripts } = await import("./tauri");
    if (settings?.luaPath) {
      const scripts = await scanInstalledLuaScripts(settings.luaPath);
      luaGames = scripts.length;
    }
  } catch { /* ignore */ }

  try {
    const { getAllMediaEntries } = await import("./gameCacheService");
    const entries = getAllMediaEntries();
    mediaIndexEntries = entries.length;
    mediaWithCover = entries.filter((e) => e.hasCover).length;
    mediaWithLandscape = entries.filter((e) => e.hasLandscape).length;
    mediaWithBackground = entries.filter((e) => e.hasBackground).length;
    mediaWithLogo = entries.filter((e) => e.hasLogo).length;
    mediaWithIcon = entries.filter((e) => e.hasIcon).length;
  } catch { /* ignore */ }

  try {
    const { backgroundJobQueue } = await import("./backgroundJobQueue");
    const status = backgroundJobQueue.getStatus();
    jobsQueued = status.queued;
  } catch { /* ignore */ }

  console.log(`[BOOT][HEALTH] snapshotGames=${snapshotGames}`);
  console.log(`[BOOT][HEALTH] sqliteGames=${sqliteGames}`);
  console.log(`[BOOT][HEALTH] reconciledCacheGames=${reconciledCacheGames}`);
  console.log(`[BOOT][HEALTH] luaGames=${luaGames}`);
  console.log(`[BOOT][HEALTH] jobsQueued=${jobsQueued}`);
  console.log(`[BOOT][HEALTH] mediaIndexEntries=${mediaIndexEntries}`);
  console.log(`[BOOT][HEALTH] mediaWithCover=${mediaWithCover}`);
  console.log(`[BOOT][HEALTH] mediaWithLandscape=${mediaWithLandscape}`);
  console.log(`[BOOT][HEALTH] mediaWithBackground=${mediaWithBackground}`);
  console.log(`[BOOT][HEALTH] mediaWithLogo=${mediaWithLogo}`);
  console.log(`[BOOT][HEALTH] mediaWithIcon=${mediaWithIcon}`);

  return { snapshotGames, sqliteGames, reconciledCacheGames, luaGames, jobsQueued, mediaIndexEntries, mediaWithCover, mediaWithLandscape, mediaWithBackground, mediaWithLogo, mediaWithIcon };
}

// ── Dev validation: validateAppInfoMedia ──

export async function validateAppInfoMedia(appId: string): Promise<{
  backgroundPath: string | null;
  landscapePath: string | null;
  coverPath: string | null;
  iconPath: string | null;
  logoPath: string | null;
  backgroundExists: boolean;
  landscapeExists: boolean;
  coverExists: boolean;
  iconExists: boolean;
  logoExists: boolean;
  missingFieldsButFilesExist: number;
  crossAppidPaths: number;
}> {
  const { getGameAppInfo, resolveGameMediaPaths } = await import("./tauri");
  const appInfo = await getGameAppInfo(appId);
  const media = appInfo?.media;
  const diskPaths = await resolveGameMediaPaths(appId).catch(() => null);
  console.log(`[MEDIA][APPINFO_VALIDATE] appid=${appId}`);
  const report = {
    backgroundPath: media?.backgroundPath ?? null,
    landscapePath: media?.landscapePath ?? null,
    coverPath: media?.coverPath ?? null,
    iconPath: media?.iconPath ?? null,
    logoPath: media?.logoPath ?? null,
    backgroundExists: diskPaths?.backgroundPath ? true : false,
    landscapeExists: diskPaths?.landscapePath ? true : false,
    coverExists: diskPaths?.coverPath ? true : false,
    iconExists: diskPaths?.iconPath ? true : false,
    logoExists: diskPaths?.logoPath ? true : false,
    missingFieldsButFilesExist: 0,
    crossAppidPaths: 0,
  };
  const roles = [
    { field: "backgroundPath", exists: report.backgroundExists },
    { field: "landscapePath", exists: report.landscapeExists },
    { field: "coverPath", exists: report.coverExists },
    { field: "iconPath", exists: report.iconExists },
    { field: "logoPath", exists: report.logoExists },
  ] as const;
  for (const { field, exists } of roles) {
    const val = (media as any)?.[field] ?? null;
    console.log(`[MEDIA][APPINFO_VALIDATE] ${field}=${val} fileExists=${exists}`);
    if (!val && exists) report.missingFieldsButFilesExist++;
    if (val && typeof val === "string") {
      const otherAppId = val.match(/games[/\\]steam[/\\](\d+)[/\\]/);
      if (otherAppId && otherAppId[1] !== appId) report.crossAppidPaths++;
    }
  }
  console.log(`[MEDIA][APPINFO_VALIDATE] missingFieldsButFilesExist=${report.missingFieldsButFilesExist}`);
  console.log(`[MEDIA][APPINFO_VALIDATE] crossAppidPaths=${report.crossAppidPaths}`);
  return report;
}

// ── Dev validation: validateLibraryNames ──

export async function validateLibraryNames(): Promise<{
  total: number;
  fallbackSteamAppNames: number;
  luaNamed: number;
  appinfoNamed: number;
  customNamed: number;
}> {
  const games = _reconciledGames;
  let fallbackSteamAppNames = 0;
  let luaNamed = 0;
  let appinfoNamed = 0;
  let customNamed = 0;
  const { readCanonicalAppinfos } = await import("./tauri");
  const appIds = games.filter((g) => g.appId).map((g) => g.appId!);
  const appinfos = await readCanonicalAppinfos(appIds).catch(() => ({} as Record<string, any>));
  for (const game of games) {
    const appinfo = game.appId ? appinfos[game.appId] : null;
    const source = game.customTitle ? "custom" : appinfo?.name ? "appinfo" : game.source === "lua" ? "lua" : "fallback";
    if (source === "fallback" || game.title?.startsWith("Steam App ")) fallbackSteamAppNames++;
    else if (source === "custom") customNamed++;
    else if (source === "appinfo") appinfoNamed++;
    else if (source === "lua") luaNamed++;
  }
  console.log(`[LIBRARY][NAMES_VALIDATE] total=${games.length}`);
  console.log(`[LIBRARY][NAMES_VALIDATE] fallbackSteamAppNames=${fallbackSteamAppNames}`);
  console.log(`[LIBRARY][NAMES_VALIDATE] luaNamed=${luaNamed}`);
  console.log(`[LIBRARY][NAMES_VALIDATE] appinfoNamed=${appinfoNamed}`);
  console.log(`[LIBRARY][NAMES_VALIDATE] customNamed=${customNamed}`);
  return { total: games.length, fallbackSteamAppNames, luaNamed, appinfoNamed, customNamed };
}

// ── Dev console exposure ──

if (typeof window !== "undefined") {
  const _w = window as unknown as Record<string, unknown>;
  _w.__validateLibraryIndexHealth = validateLibraryIndexHealth;
  _w.__validateLibraryIndexHealthFromStore = validateLibraryIndexHealthFromStore;
  _w.__validateMediaCacheHealth = validateMediaCacheHealth;
  _w.__validateStartupCacheHealth = validateStartupCacheHealth;
  _w.__validateAppInfoMedia = validateAppInfoMedia;
  _w.__validateLibraryNames = validateLibraryNames;
}

// ---------------------------------------------------------------------------
// Rebuild Library Index from config/lua
// ---------------------------------------------------------------------------

export async function rebuildLibraryIndex(
  settings: any,
): Promise<{ luaGames: number; upserted: number }> {
  console.log("[LIBRARY][REBUILD] started");
  const { resolveLibraryGames } = await import("./libraryGameResolver");
  const { saveCachedGames } = await import("./gameDetectionCache");
  const { batchUpsertGames, readCanonicalAppinfos, getStoreDetails } = await import("./tauri");
  const { updateGameAppinfoMediaIfChanged } = await import("./gameCacheService");

  const result = await resolveLibraryGames(settings);
  const games = result.games;

  // Resolve names for games with fallback "Steam App" title
  const placeholderTitleGames = games.filter(
    (g) => g.appId && (!g.title || g.title === "" || g.title.startsWith("Steam App ")),
  );
  if (placeholderTitleGames.length > 0) {
    const appIds = placeholderTitleGames.map((g) => g.appId!) as string[];
    const appinfos = await readCanonicalAppinfos(appIds).catch(() => ({} as Record<string, any>));
    for (const game of placeholderTitleGames) {
      if (!game.appId) continue;
      const appinfo = appinfos[game.appId];
      let resolvedName: string | null = null;
      let source = "";
      if (appinfo?.name && !appinfo.name.startsWith("Steam App ")) { resolvedName = appinfo.name; source = "appinfo"; }
      if (!resolvedName) {
        try {
          const sd = await getStoreDetails(game.appId).catch(() => null);
          const sdData = sd?.data as { name?: string } | null;
          if (sdData?.name && !sdData.name.startsWith("Steam App ")) { resolvedName = sdData.name; source = "store-details"; }
        } catch { /* ignore */ }
      }
      if (resolvedName) {
        console.log(`[LIBRARY][NAME] appid=${game.appId} source=${source} name=${resolvedName}`);
        game.title = resolvedName;
        // Write to canonical appinfo so snapshot hydration can use name on next boot
        if (source !== "appinfo") {
          updateGameAppinfoMediaIfChanged(
            game.appId, resolvedName,
            { coverPath: null, backgroundPath: null, logoPath: null, iconPath: null, landscapePath: null },
            null,
            undefined,
            "rebuildLibraryIndex",
          ).catch(() => {});
        }
      } else {
        console.log(`[LIBRARY][NAME_WARN] appid=${game.appId} name=pending reason=no-local-source`);
      }
    }
  }

  console.log(`[LIBRARY][REBUILD] luaGames=${games.filter((g) => g.source === "lua").length}`);
  console.log(`[LIBRARY][REBUILD] total=${games.length}`);

  // Persist enriched list to SQLite cache
  await saveCachedGames(games, result.warnings);

  // Upsert into games table
  const luaGameCount = games.filter((g) => g.source === "lua").length;
  const gameEntries = games
    .filter((g) => g.appId)
    .map((g) => ({
      appId: g.appId!,
      title: g.title,
      installed: g.steamInstalled,
      playtime: g.steamPlaytimeMinutes ?? 0,
      lastPlayed: g.steamLastPlayedAt ?? 0,
      metadataJson: JSON.stringify(g.metadata ?? {}),
      updatedAt: Math.floor(Date.now() / 1000),
    }));
  await batchUpsertGames(gameEntries).catch(() => {});

  setReconciledGames(games);
  console.log(`[LIBRARY][REBUILD] complete upserted=${games.length}`);
  return { luaGames: luaGameCount, upserted: games.length };
}


