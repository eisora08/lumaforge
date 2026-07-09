import { useMemo, useCallback } from "react";
import { Play, Clapperboard, Image } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { getConsoleHeroBackground, getConsoleCardSrc } from "./consoleMedia";

type Props = {
  game: LibraryGame | null;
  showTrailerPreview?: boolean;
};

const DEBUG_PREVIEW = false;

/**
 * Preview component for the selected game in ConsoleMode details.
 *
 * Data priority (read-only, no fetches):
 * 1. metadata.movies[0].thumbnail — trailer thumbnail from cached Steam metadata
 * 2. metadata.screenshots[0] — cached screenshot
 * 3. landscape/background image fallback
 *
 * Trailer thumbnails show a large centered play overlay.
 * Screenshots/artwork show only a label badge.
 * No real video playback — click is a no-op behind a debug flag.
 */
export default function ConsoleSelectedPreview({ game, showTrailerPreview = true }: Props) {
  const previewData = useMemo(() => {
    if (!game || !showTrailerPreview) return null;

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
  }, [game, showTrailerPreview]);

  const fallbackSrc = useMemo(() => {
    return getConsoleHeroBackground(game) ?? getConsoleCardSrc(game, "landscape");
  }, [game]);

  const displaySrc = previewData?.src ?? fallbackSrc;
  const isTrailer = previewData?.label === "Trailer";
  const label = previewData?.label ?? "Artwork";

  const handlePlayClick = useCallback(() => {
    if (DEBUG_PREVIEW && isTrailer) {
      console.log("[CONSOLE][PREVIEW] trailer play clicked — no-op until video playback is implemented");
    }
  }, [isTrailer]);

  if (!game) return null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-(--color-surface)/20 shadow-xl shadow-black/30 ring-1 ring-white/[0.06] backdrop-blur-sm">
      {displaySrc ? (
        <img
          key={game.appId}
          src={displaySrc}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/30">
          {isTrailer ? (
            <Clapperboard className="h-8 w-8 text-(--color-muted)/30" />
          ) : (
            <Image className="h-8 w-8 text-(--color-muted)/30" />
          )}
        </div>
      )}

      {/* ── Trailer play overlay — large centered button ── */}
      {isTrailer && displaySrc && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={handlePlayClick}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition hover:scale-105 hover:bg-(--color-accent)/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-(--color-accent)/60"
            aria-label="Play trailer"
          >
            <Play className="ml-0.5 h-7 w-7 fill-current" />
          </button>
        </div>
      )}

      {/* ── Type label badge ── */}
      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 backdrop-blur-sm">
        {isTrailer ? (
          <Play className="h-3 w-3 fill-white/70 text-white/70" />
        ) : (
          <Image className="h-3 w-3 text-white/70" />
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
          {label}
        </span>
      </div>
    </div>
  );
}
