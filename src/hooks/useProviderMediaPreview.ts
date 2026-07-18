import { useEffect, useRef, useState } from "react";
import type { LibraryGame } from "../types/libraryGame";
import type { SnapshotGame } from "../services/startupSnapshotService";
import { resolveProviderMediaPreviewUrl, resolveGameMediaUrl } from "../services/gameCacheService";

export type MediaPreviewResult = {
  url: string | null;
  role: string | null;
  loading: boolean;
  error: boolean;
};

/**
 * Shared hook that resolves a playable media URL from a LibraryGame or SnapshotGame,
 * trying roles in priority order.
 *
 * Provider-neutral: works for Steam, Epic, Manual, GOG.
 * Suppresses stale results when game identity changes mid-resolve.
 * Resets error state when src changes (PART 9).
 */
export function useProviderMediaPreview(
  game: LibraryGame | SnapshotGame | null | undefined,
  orderedRoles: string[],
  _options?: { prefer?: "library" | "snapshot" },
): MediaPreviewResult {
  const [url, setUrl] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestIdRef = useRef(0);

  const gameKey = game
    ? ("appId" in game && game.appId)
      || ("libraryId" in game && game.libraryId)
      || ("id" in game && game.id)
      || "unknown"
    : "none";

  useEffect(() => {
    if (!game) {
      setUrl(null);
      setRole(null);
      setLoading(false);
      setError(false);
      return;
    }

    ++requestIdRef.current;
    let cancelled = false;

    const isSnapshot = "media" in game && !("source" in game);

    async function resolve() {
      setLoading(true);
      setError(false);

      for (const r of orderedRoles) {
        if (cancelled) return;

        let rawPath: string | null = null;

        if (isSnapshot) {
          const sg = game as SnapshotGame;
          rawPath = sg.media?.[r as keyof typeof sg.media] as string | null ?? null;
        } else {
          const lg = game as LibraryGame;
          rawPath = (lg as any)[r] as string | null ?? null;
        }

        if (!rawPath) continue;

        try {
          let resolvedUrl: string | null = null;

          if (isSnapshot && "appId" in game && (game as SnapshotGame).appId) {
            resolvedUrl = await resolveGameMediaUrl((game as SnapshotGame).appId, rawPath);
          } else if (!isSnapshot) {
            resolvedUrl = await resolveProviderMediaPreviewUrl(rawPath);
          }

          if (cancelled) return;

          if (resolvedUrl) {
            setUrl(resolvedUrl);
            setRole(r);
            setLoading(false);
            setError(false);
            return;
          }
        } catch {
          // Try next role
          continue;
        }
      }

      // No role resolved
      if (!cancelled) {
        setUrl(null);
        setRole(null);
        setLoading(false);
        // Only set error if we had at least one non-null path that failed
        const hasAnyPath = orderedRoles.some((r) => {
          if (isSnapshot) {
            const m = (game as SnapshotGame).media as Record<string, unknown> | undefined;
            return m?.[r];
          }
          return (game as any)[r];
        });
        setError(!!hasAnyPath);
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [gameKey, ...orderedRoles]);

  return { url, role, loading, error };
}

/**
 * Get a playable media URL directly (not a hook) — for non-React code.
 */
export async function resolveMediaPreviewFromGame(
  game: LibraryGame | SnapshotGame | null | undefined,
  orderedRoles: string[],
): Promise<{ url: string | null; role: string | null }> {
  if (!game) return { url: null, role: null };

  const isSnapshot = "media" in game && !("source" in game);

  for (const r of orderedRoles) {
    let rawPath: string | null = null;

    if (isSnapshot) {
      const sg = game as SnapshotGame;
      rawPath = (sg.media as any)?.[r] ?? null;
    } else {
      const lg = game as LibraryGame;
      rawPath = (lg as any)[r] ?? null;
    }

    if (!rawPath) continue;

    try {
      let resolvedUrl: string | null = null;

      if (isSnapshot && "appId" in game && (game as SnapshotGame).appId) {
        resolvedUrl = await resolveGameMediaUrl((game as SnapshotGame).appId, rawPath);
      } else if (!isSnapshot) {
        resolvedUrl = await resolveProviderMediaPreviewUrl(rawPath);
      }

      if (resolvedUrl) return { url: resolvedUrl, role: r };
    } catch {
      continue;
    }
  }

  return { url: null, role: null };
}
