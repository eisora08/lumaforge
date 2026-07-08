import { useState, useEffect, useRef } from "react";
import type { LibraryGame } from "../../types/libraryGame";
import { getCachedGameMediaPaths, resolveGameMediaUrl } from "../../services/gameCacheService";

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
      const syncMedia = g.appId ? getSyncMedia(g.appId) : undefined;
      const syncMeta = g.appId && _mediaCache.get(g.appId)?.ts
        ? { resolved: true, resolvedAt: _mediaCache.get(g.appId)!.ts }
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
          if (!g.appId) return { appId: "", media: undefined, meta: undefined };
          const media = await resolveConsoleMedia(g.appId);
          const meta: ConsoleMeta = { resolved: true, resolvedAt };
          return { appId: g.appId, media, meta };
        }),
      );

      if (!mounted) return;

      const mediaMap = new Map<string, ConsoleMedia>();
      const metaMap = new Map<string, ConsoleMeta>();
      for (const r of results) {
        if (r.appId) {
          if (r.media) mediaMap.set(r.appId, r.media);
          if (r.meta) metaMap.set(r.appId, r.meta);
        }
      }

      setEnriched(
        currentGames.map((g) => {
          const out: ConsoleLibraryGame = { ...g } as ConsoleLibraryGame;
          if (g.appId) {
            const m = mediaMap.get(g.appId);
            if (m) out._consoleMedia = m;
            const mt = metaMap.get(g.appId);
            if (mt) out._consoleMeta = mt;
          }
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
