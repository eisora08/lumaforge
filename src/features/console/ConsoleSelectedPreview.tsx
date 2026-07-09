import { useMemo } from "react";
import { Play } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { getConsoleHeroBackground, getConsoleCardSrc } from "./consoleMedia";

type Props = {
  game: LibraryGame | null;
  showTrailerPreview?: boolean;
};

/**
 * Mini preview component for the selected game in Spotlight.
 *
 * Data priority (read-only, no fetches):
 * 1. metadata.movies[0].thumbnail — trailer thumbnail from cached Steam metadata
 * 2. metadata.screenshots[0] — cached screenshot
 * 3. landscape/background image fallback
 *
 * In Phase 3A this is a read-only component — no network calls on focus change.
 */
export default function ConsoleSelectedPreview({ game, showTrailerPreview = true }: Props) {
  const previewData = useMemo(() => {
    if (!game || !showTrailerPreview) return null;

    const movies = game.metadata?.movies;
    if (movies && movies.length > 0) {
      const first = movies[0];
      return {
        src: first.thumbnail ?? null,
        label: "Trailer",
        isVideo: false,
      };
    }

    const screenshots = game.metadata?.screenshots;
    if (screenshots && screenshots.length > 0) {
      return {
        src: screenshots[0] ?? null,
        label: "Screenshot",
        isVideo: false,
      };
    }

    return null;
  }, [game, showTrailerPreview]);

  const fallbackSrc = useMemo(() => {
    return getConsoleHeroBackground(game) ?? getConsoleCardSrc(game, "landscape");
  }, [game]);

  const displaySrc = previewData?.src ?? fallbackSrc;

  if (!game) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-(--color-surface)/20 shadow-xl shadow-black/30 ring-1 ring-white/[0.06] backdrop-blur-sm">
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
          <Play className="h-6 w-6 text-(--color-muted)/30" />
        </div>
      )}

      {/* Label badge */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 backdrop-blur-sm">
        {previewData?.label === "Trailer" && <Play className="h-3 w-3 fill-white/70 text-white/70" />}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
          {previewData?.label ?? "Artwork"}
        </span>
      </div>
    </div>
  );
}
