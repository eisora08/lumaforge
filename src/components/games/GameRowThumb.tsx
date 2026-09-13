import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Gamepad2 } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { GameAppInfo } from "../../services/gameCacheService";
import {
  subscribeMediaCacheVersion,
  getMediaCacheVersion,
  loadGameAppInfoWithMediaFallback,
  resolveGameMediaUrl,
  resolveProviderMediaPreviewUrl,
} from "../../services/gameCacheService";
import { isHttpUrl, isLocalPath } from "../../services/libraryLocalCacheService";
import AsyncImage from "../common/AsyncImage";

type GameRowThumbProps = {
  game: LibraryGame;
  mode?: "poster" | "landscape";
  className?: string;
  fallback?: React.ReactNode;
};

// TEMP: verbose card path logging — keep ON until library artwork paths are stable.
const CARD_PATH_LOGS_ENABLED = true;
function logCardPaths(tag: string, game: LibraryGame, extra: Record<string, unknown>): void {
  if (!CARD_PATH_LOGS_ENABLED) return;
  console.log(
    `[CARD][${tag}] id=${game.id} appId=${game.appId ?? "null"} title="${game.title}" source=${game.source}`,
    JSON.stringify({
      coverPath: game.coverPath ?? null,
      landscapePath: game.landscapePath ?? null,
      backgroundPath: game.backgroundPath ?? null,
      logoPath: game.logoPath ?? null,
      iconPath: game.iconPath ?? null,
      imageUrl: game.imageUrl ?? null,
      ...extra,
    }),
  );
}

export default function GameRowThumb({
  game,
  mode = "poster",
  className = "h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5",
  fallback,
}: GameRowThumbProps) {
  const mediaCacheVersion = useSyncExternalStore(subscribeMediaCacheVersion, getMediaCacheVersion, getMediaCacheVersion);
  const [canonicalInfo, setCanonicalInfo] = useState<GameAppInfo | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);

  // Load canonical appinfo — re-runs when media paths change
  useEffect(() => {
    if (!game.appId) return;
    let cancelled = false;
    loadGameAppInfoWithMediaFallback(game.appId)
      .then((info) => {
        if (!cancelled) setCanonicalInfo(info);
      })
      .catch(() => {
        if (!cancelled) setCanonicalInfo(null);
      });
    return () => { cancelled = true; };
  }, [game.appId, mediaCacheVersion]);

  // Prefer canonical appinfo media, fall back to games_v2 DB paths
  const displayImage = useMemo(() => {
    const media = canonicalInfo?.media;
    if (media) {
      const path = mode === "poster" ? media.coverPath : media.landscapePath;
      if (path) return path;
    }
    if (mode === "poster") {
      return game.coverPath || game.landscapePath || game.backgroundPath || game.imageUrl || undefined;
    }
    return game.landscapePath || game.coverPath || game.backgroundPath || game.imageUrl || undefined;
  }, [canonicalInfo, game, mode]);

  useEffect(() => {
    if (CARD_PATH_LOGS_ENABLED && game.appId) {
      logCardPaths("display", game, {
        canonicalMedia: canonicalInfo?.media ?? null,
        displayImage: displayImage ?? null,
        mode,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.appId, game.id, canonicalInfo, displayImage, mode]);

  // Resolve to a renderable URL (asset:// or data URL fallback handled by AsyncImage)
  useEffect(() => {
    if (!game.appId || !displayImage) {
      // Non-appId / no canonical path — resolve provider-relative path directly
      const providerPath = game.imageUrl || (mode === "poster" ? game.coverPath : game.landscapePath)
        || game.coverPath || game.landscapePath;
      if (providerPath) {
        let cancelled = false;
        resolveProviderMediaPreviewUrl(providerPath)
          .then((url) => {
            if (!cancelled) {
              setResolvedSrc(url ?? undefined);
              if (CARD_PATH_LOGS_ENABLED) console.log(`[CARD][resolve] id=${game.id} appId=${game.appId ?? "null"} providerPath=${providerPath} resolved=${url ?? "null"}`);
            }
          })
          .catch(() => {
            if (!cancelled) setResolvedSrc(undefined);
          });
        return () => { cancelled = true; };
      }
      setResolvedSrc(undefined);
      return;
    }
    let cancelled = false;
    resolveGameMediaUrl(game.appId, displayImage)
      .then((url) => {
        if (!cancelled) {
          setResolvedSrc(url ?? undefined);
          if (CARD_PATH_LOGS_ENABLED) console.log(`[CARD][resolve] id=${game.id} appId=${game.appId} displayImage=${displayImage} resolved=${url ?? "null"}`);
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedSrc(undefined);
      });
    return () => { cancelled = true; };
  }, [game.appId, game.imageUrl, game.coverPath, game.landscapePath, displayImage, mode, mediaCacheVersion]);

  // Raw local path for data URL fallback (only if it's an absolute local file path)
  const fallbackLocalPath = useMemo(() => {
    if (!displayImage) return null;
    if (isHttpUrl(displayImage)) return null;
    if (!isLocalPath(displayImage)) return null;
    return displayImage;
  }, [displayImage]);

  return (
    <AsyncImage
      src={resolvedSrc}
      alt=""
      className={className}
      fallback={
        fallback ?? (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 className="h-4 w-4 text-(--color-muted)" />
          </div>
        )
      }
      fallbackLocalPath={fallbackLocalPath}
      loading="eager"
    />
  );
}