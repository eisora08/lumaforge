import { useMemo, useCallback, useRef, useState } from "react";
import { Play, Clapperboard, Image, CircleSlash } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { TrailerData } from "./consoleTrailerData";
import { getConsoleHeroBackground, getConsoleCardSrc } from "./consoleMedia";

type Props = {
  game: LibraryGame | null;
  showTrailerPreview?: boolean;
  trailerData?: TrailerData | null;
  /** `"thumbnail"` — image-only preview (no video element, current behavior)
   *  `"details"` — renders <video> for direct mpeg/webm, play overlay starts playback */
  mode?: "thumbnail" | "details";
  /** Autoplay trailer when entering details mode (default false) */
  autoplay?: boolean;
};

const DEBUG_PREVIEW = false;

/**
 * Preview component for the selected game in ConsoleMode details.
 *
 * Data priority (read-only, no fetches):
 * 1. Prepared trailerData from consoleTrailerData helper
 * 2. metadata.movies[0].thumbnail — trailer thumbnail from cached Steam metadata
 * 3. metadata.screenshots[0] — cached screenshot
 * 4. landscape/background image fallback
 *
 * In "thumbnail" mode (default): always shows a static image with a play overlay
 * if a trailer exists.
 *
 * In "details" mode: renders a <video> element for direct-playable trailers,
 * starts playback on play-click. HLS/DASH‑only trailers show thumbnail with
 * a disabled play overlay.
 */
export default function ConsoleSelectedPreview({ game, showTrailerPreview = true, trailerData, mode = "thumbnail", autoplay = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const detailsMode = mode === "details";

  const previewData = useMemo(() => {
    if (!game || !showTrailerPreview) return null;

    if (trailerData?.thumbnail) {
      return {
        src: trailerData.thumbnail,
        label: "Trailer" as const,
      };
    }

    const movies = game.metadata?.movies;
    if (movies && movies.length > 0) {
      const first = movies[0];
      return {
        src: first.thumbnail ?? null,
        label: "Trailer" as const,
      };
    }

    const screenshots = game.metadata?.screenshots;
    if (screenshots && screenshots.length > 0) {
      return {
        src: screenshots[0] ?? null,
        label: "Screenshot" as const,
      };
    }

    return null;
  }, [game, showTrailerPreview, trailerData]);

  const fallbackSrc = useMemo(() => {
    return getConsoleHeroBackground(game) ?? getConsoleCardSrc(game, "landscape");
  }, [game]);

  const displaySrc = previewData?.src ?? fallbackSrc;
  const isTrailer = previewData?.label === "Trailer";
  const label = previewData?.label ?? "Artwork";
  const isScreenshot = previewData?.label === "Screenshot";

  /* ── Video source resolution for details mode ── */

  const videoSrc = useMemo(() => {
    if (!detailsMode || !trailerData?.hasDirectVideo || !trailerData.mp4Url) return null;
    return trailerData.mp4Url;
  }, [detailsMode, trailerData]);

  const hasHlsOnly = detailsMode && isTrailer && trailerData?.hasStreamFallback && !trailerData.hasDirectVideo;

  /* ── Play handler ── */

  const handlePlayClick = useCallback(() => {
    if (videoRef.current && videoSrc && !videoError) {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => { /* autoplay blocked, keep overlay visible */ });
      if (DEBUG_PREVIEW) console.log(`[CONSOLE][PREVIEW] play — src=${videoSrc}`);
    } else if (DEBUG_PREVIEW) {
      const msg = trailerData?.hasTrailer
        ? `trailer — mp4=${trailerData.mp4Url ? "yes" : "no"} webm=${trailerData.webmUrl ? "yes" : "no"} hls=${trailerData.hlsUrl ? "yes" : "no"}`
        : "no playable URL available";
      console.log(`[CONSOLE][PREVIEW] play blocked — ${msg}`);
    }
  }, [videoSrc, videoError, trailerData]);

  /* ── Video ended → show overlay again ── */

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleVideoError = useCallback(() => {
    setVideoError(true);
    setIsPlaying(false);
  }, []);

  /* ── Image error guard ── */

  /* ── Autoplay on video src change ── */
  const prevAutoplayKey = useRef<string | null>(null);
  const autoplayKey = detailsMode && autoplay ? (videoSrc ?? "no-src") : null;
  if (autoplayKey && autoplayKey !== prevAutoplayKey.current && autoplayKey !== "no-src" && videoRef.current && !videoError) {
    prevAutoplayKey.current = autoplayKey;
    videoRef.current.play()
      .then(() => setIsPlaying(true))
      .catch(() => {});
  }

  const [imgError, setImgError] = useState(false);
  const handleImgError = useCallback(() => setImgError(true), []);

  if (!game) return null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-(--color-surface)/20 shadow-xl shadow-black/30 ring-1 ring-white/[0.06] backdrop-blur-sm">
      {/* ── Details mode: <video> element for direct-playable trailer ── */}
      {detailsMode && videoSrc && !videoError ? (
        <video
          ref={videoRef}
          key={game.appId}
          src={videoSrc}
          muted
          playsInline
          autoPlay={autoplay}
          preload="metadata"
          className="h-full w-full object-cover"
          onEnded={handleVideoEnded}
          onError={handleVideoError}
        />
      ) : displaySrc && !imgError ? (
        <img
          key={game.appId}
          src={displaySrc}
          alt=""
          className="h-full w-full object-cover"
          onError={handleImgError}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/30">
          {isTrailer ? (
            <Clapperboard className="h-8 w-8 text-(--color-muted)/30" />
          ) : isScreenshot ? (
            <Image className="h-8 w-8 text-(--color-muted)/30" />
          ) : (
            <Image className="h-8 w-8 text-(--color-muted)/30" />
          )}
        </div>
      )}

      {/* ── Play overlay ──
       *   - Details mode + direct video: click starts playback; hidden while playing
       *   - Details mode + HLS/DASH only: disabled with "Stream unavailable" tooltip
       *   - Thumbnail mode + trailer: always shows play overlay (image-only, no video)
       */}
      {isTrailer && displaySrc && !imgError && (
        <div className="absolute inset-0 flex items-center justify-center">
          {detailsMode && isPlaying ? null : detailsMode && hasHlsOnly ? (
            <div className="group relative">
              <button
                type="button"
                disabled
                className="flex h-16 w-16 cursor-not-allowed items-center justify-center rounded-full bg-black/30 text-white/40 backdrop-blur-sm"
                aria-label="Stream preview unavailable"
              >
                <CircleSlash className="h-7 w-7" />
              </button>
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-2 py-0.5 text-[10px] text-white/60 opacity-0 transition group-hover:opacity-100">
                Stream preview unavailable
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePlayClick}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition hover:scale-105 hover:bg-(--color-accent)/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-(--color-accent)/60"
              aria-label="Play trailer"
            >
              <Play className="ml-0.5 h-7 w-7 fill-current" />
            </button>
          )}
        </div>
      )}

      {/* ── Type label badge ── */}
      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 backdrop-blur-sm">
        {isTrailer ? (
          <Play className="h-3 w-3 fill-white/70 text-white/70" />
        ) : isScreenshot ? (
          <Image className="h-3 w-3 text-white/70" />
        ) : (
          <Image className="h-3 w-3 text-white/70" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
          {label}
        </span>
      </div>

      {/* ── Video error badge (details mode) ── */}
      {detailsMode && videoError && (
        <div className="pointer-events-none absolute bottom-8 left-2 flex items-center gap-1 rounded-md bg-red-900/60 px-2 py-0.5 text-[10px] text-red-200">
          Video unavailable
        </div>
      )}
    </div>
  );
}
