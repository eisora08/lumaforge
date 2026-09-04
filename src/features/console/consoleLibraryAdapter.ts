import { useState, useEffect, useRef } from "react";
import type { LibraryGame } from "../../types/libraryGame";
import { getCachedGameMediaPaths, getCachedResolvedMedia, getAppDataBaseSync, localPathToUrl, resolveGameMediaUrl, resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import { getManualGame } from "../../services/manualGameStore";

const DEBUG_EPIC_CONSOLE_MEDIA = false;

export type ConsoleMedia = {
  coverSrc: string | null;
  landscapeSrc: string | null;
  backgroundSrc: string | null;
  logoSrc: string | null;
  heroSrc: string | null;
};

export type ConsoleMeta = {
  resolved: boolean;
  resolvedAt: number;
};

export type ConsoleLibraryGame = LibraryGame & {
  _consoleMedia?: ConsoleMedia;
  _consoleMeta?: ConsoleMeta;
};

const _mediaCache = new Map<string, { media: ConsoleMedia; ts: number }>();

function buildAssetUrl(base: string, provider: string, appId: string, relativePath: string | null): string | null {
  if (!relativePath) return null;
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  if (relativePath.startsWith("asset://") || relativePath.startsWith("data:") || relativePath.startsWith("file://")) return relativePath;
  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith("/")) {
    return localPathToUrl(relativePath);
  }
  const abs = `${base}\\games\\${provider}\\${appId}\\${relativePath.replace(/\//g, "\\")}`;
  return localPathToUrl(abs);
}

export function seedMediaCacheFromSessionCache(games: LibraryGame[]): number {
  const base = getAppDataBaseSync();
  if (!base) return 0;
  let seeded = 0;
  for (const g of games) {
    const appId = g.appId;
    if (!appId) continue;
    if (_mediaCache.has(appId)) continue;
    const paths = getCachedResolvedMedia(appId);
    if (paths === undefined) continue;
    if (paths === null) {
      _mediaCache.set(appId, { media: { coverSrc: null, landscapeSrc: null, backgroundSrc: null, logoSrc: null, heroSrc: null }, ts: Date.now() });
      continue;
    }
    const provider = g.source === "epic" ? "epic" : "steam";
    const coverSrc = buildAssetUrl(base, provider, appId, paths.coverPath);
    const landscapeSrc = buildAssetUrl(base, provider, appId, paths.landscapePath);
    const backgroundSrc = buildAssetUrl(base, provider, appId, paths.backgroundPath);
    const logoSrc = buildAssetUrl(base, provider, appId, paths.logoPath);
    const media: ConsoleMedia = {
      coverSrc,
      landscapeSrc,
      backgroundSrc,
      logoSrc,
      heroSrc: backgroundSrc || landscapeSrc,
    };
    _mediaCache.set(appId, { media, ts: Date.now() });
    seeded++;
  }
  return seeded;
}

function getSyncMedia(appId: string): ConsoleMedia | undefined {
  return _mediaCache.get(appId)?.media;
}

export async function resolveConsoleMedia(appId: string): Promise<ConsoleMedia> {
  const cached = _mediaCache.get(appId);
  if (cached) return cached.media;

  const paths = await getCachedGameMediaPaths(appId);
  if (!paths) {
    const empty: ConsoleMedia = { coverSrc: null, landscapeSrc: null, backgroundSrc: null, logoSrc: null, heroSrc: null };
    _mediaCache.set(appId, { media: empty, ts: Date.now() });
    return empty;
  }

  const [coverSrc, landscapeSrc, backgroundSrc, logoSrc] = await Promise.all([
    resolveGameMediaUrl(appId, paths.coverPath),
    resolveGameMediaUrl(appId, paths.landscapePath),
    resolveGameMediaUrl(appId, paths.backgroundPath),
    resolveGameMediaUrl(appId, paths.logoPath),
  ]);

  const media: ConsoleMedia = {
    coverSrc,
    landscapeSrc,
    backgroundSrc,
    logoSrc,
    heroSrc: backgroundSrc || landscapeSrc,
  };
  _mediaCache.set(appId, { media, ts: Date.now() });
  return media;
}

export function useConsoleLibraryMedia(games: LibraryGame[]): ConsoleLibraryGame[] {
  const [enriched, setEnriched] = useState<ConsoleLibraryGame[]>(() => {
    if (_mediaCache.size === 0 && games.length > 0) {
      seedMediaCacheFromSessionCache(games);
    }
    return games.map((g) => {
      const key = g.appId || g.id;
      const syncMedia = getSyncMedia(key);
      const syncMeta = _mediaCache.get(key)?.ts
        ? { resolved: true, resolvedAt: _mediaCache.get(key)!.ts }
        : undefined;
      const base: ConsoleLibraryGame = { ...g, _consoleMedia: syncMedia };
      if (syncMeta) base._consoleMeta = syncMeta;
      return base;
    });
  });

  const gamesRef = useRef(games);
  gamesRef.current = games;

  useEffect(() => {
    let mounted = true;

    async function resolveAll() {
      const currentGames = gamesRef.current;
      const resolvedAt = Date.now();
      const results = await Promise.all(
        currentGames.map(async (g) => {
          if (g.appId) {
            const media = await resolveConsoleMedia(g.appId);
            const meta: ConsoleMeta = { resolved: true, resolvedAt };
            return { key: g.appId, media, meta };
          }
          // Manual games (no appId): read ManualGameEntry for 5 separate media paths
          if (g.source === "manual" && g.providerGameId) {
            const entry = getManualGame(g.providerGameId);
            if (entry) {
              const [coverSrc, landscapeSrc, backgroundSrc, logoSrc] = await Promise.all([
                entry.coverPath ? resolveProviderMediaPreviewUrl(entry.coverPath) : Promise.resolve(null),
                entry.landscapePath ? resolveProviderMediaPreviewUrl(entry.landscapePath) : Promise.resolve(null),
                entry.backgroundPath ? resolveProviderMediaPreviewUrl(entry.backgroundPath) : Promise.resolve(null),
                entry.logoPath ? resolveProviderMediaPreviewUrl(entry.logoPath) : Promise.resolve(null),
              ]);
              const media: ConsoleMedia = {
                coverSrc,
                landscapeSrc,
                backgroundSrc,
                logoSrc,
                heroSrc: backgroundSrc || landscapeSrc || coverSrc,
              };
              const meta: ConsoleMeta = { resolved: true, resolvedAt };
              return { key: g.id, media, meta };
            }
          }
          // Epic games (no appId): resolve provider-relative media paths directly
          if (g.source === "epic") {
            if (DEBUG_EPIC_CONSOLE_MEDIA) {
              console.log("[EPIC_CONSOLE_MEDIA][INPUT]", {
                libraryId: g.libraryId,
                providerGameId: g.providerGameId,
                coverPath: g.coverPath,
                landscapePath: g.landscapePath,
                backgroundPath: g.backgroundPath,
                logoPath: g.logoPath,
                iconPath: g.iconPath,
                imageUrl: g.imageUrl,
              });
            }
            const [coverSrc, landscapeSrc, backgroundSrc, logoSrc] = await Promise.all([
              g.coverPath ? resolveProviderMediaPreviewUrl(g.coverPath) : Promise.resolve(null),
              g.landscapePath ? resolveProviderMediaPreviewUrl(g.landscapePath) : Promise.resolve(null),
              g.backgroundPath ? resolveProviderMediaPreviewUrl(g.backgroundPath) : Promise.resolve(null),
              g.logoPath ? resolveProviderMediaPreviewUrl(g.logoPath) : Promise.resolve(null),
            ]);
            const media: ConsoleMedia = {
              coverSrc,
              landscapeSrc,
              backgroundSrc,
              logoSrc,
              heroSrc: backgroundSrc || landscapeSrc || coverSrc,
            };
            if (DEBUG_EPIC_CONSOLE_MEDIA) {
              console.log("[EPIC_CONSOLE_MEDIA][RESOLVED]", {
                key: g.id,
                coverPresent: !!coverSrc,
                landscapePresent: !!landscapeSrc,
                backgroundPresent: !!backgroundSrc,
                logoPresent: !!logoSrc,
                failedRoles: [!coverSrc && "cover", !landscapeSrc && "landscape", !backgroundSrc && "background", !logoSrc && "logo"].filter(Boolean),
              });
            }
            const meta: ConsoleMeta = { resolved: true, resolvedAt };
            return { key: g.id, media, meta };
          }
          return { key: g.id, media: undefined, meta: undefined };
        }),
      );

      if (!mounted) return;

      const mediaMap = new Map<string, ConsoleMedia>();
      const metaMap = new Map<string, ConsoleMeta>();
      for (const r of results) {
        if (r.key) {
          if (r.media) mediaMap.set(r.key, r.media);
          if (r.meta) metaMap.set(r.key, r.meta);
        }
      }

      setEnriched(
        currentGames.map((g) => {
          const out: ConsoleLibraryGame = { ...g } as ConsoleLibraryGame;
          const key = g.appId || g.id;
          const m = mediaMap.get(key);
          if (m) out._consoleMedia = m;
          const mt = metaMap.get(key);
          if (mt) out._consoleMeta = mt;
          return out;
        }),
      );

      if (DEBUG_EPIC_CONSOLE_MEDIA) {
        for (const g of currentGames) {
          if (g.source === "epic") {
            const key = g.appId || g.id;
            const m = mediaMap.get(key);
            console.log("[EPIC_CONSOLE_MEDIA][OUTPUT]", {
              cacheKey: key,
              consoleMediaFields: m ? Object.keys(m) : "none",
              coverPresent: !!m?.coverSrc,
              landscapePresent: !!m?.landscapeSrc,
              backgroundPresent: !!m?.backgroundSrc,
              logoPresent: !!m?.logoSrc,
            });
          }
        }
      }
    }

    resolveAll();
    return () => {
      mounted = false;
    };
  }, [games]);

  return enriched;
}
