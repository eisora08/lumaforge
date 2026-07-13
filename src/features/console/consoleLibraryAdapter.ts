import { useState, useEffect, useRef } from "react";
import type { LibraryGame } from "../../types/libraryGame";
import { getCachedGameMediaPaths, resolveGameMediaUrl, resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";

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
  const [enriched, setEnriched] = useState<ConsoleLibraryGame[]>(() =>
    games.map((g) => {
      const key = g.appId || g.id;
      const syncMedia = getSyncMedia(key);
      const syncMeta = _mediaCache.get(key)?.ts
        ? { resolved: true, resolvedAt: _mediaCache.get(key)!.ts }
        : undefined;
      const base: ConsoleLibraryGame = { ...g, _consoleMedia: syncMedia };
      if (syncMeta) base._consoleMeta = syncMeta;
      return base;
    }),
  );

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
          // Manual games (no appId): resolve imageUrl to renderable URL
          if (g.imageUrl) {
            const resolvedUrl = await resolveProviderMediaPreviewUrl(g.imageUrl);
            if (resolvedUrl) {
              const media: ConsoleMedia = {
                coverSrc: resolvedUrl,
                landscapeSrc: resolvedUrl,
                backgroundSrc: null,
                logoSrc: null,
                heroSrc: resolvedUrl,
              };
              const meta: ConsoleMeta = { resolved: true, resolvedAt };
              return { key: g.id, media, meta };
            }
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
    }

    resolveAll();
    return () => {
      mounted = false;
    };
  }, [games]);

  return enriched;
}
