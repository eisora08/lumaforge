import type { LibraryGame } from "../../types/libraryGame";
import type { SteamMovie } from "../../types/gameMetadata";
import type { ResolvedGameTrailer } from "../../types/gameMedia";
import { resolveTrailerByPriority, resolveGameTrailers } from "../../services/gameMetadataResolver";

export type TrailerData = {
  thumbnail: string | null;
  mp4Url: string | null;
  webmUrl: string | null;
  hlsUrl: string | null;
  hasTrailer: boolean;
  movieCount: number;
  /** True when at least one movie has a direct mp4/webm URL. */
  hasDirectVideo: boolean;
  /** True when all movies only have HLS/DASH stream sources. */
  hasStreamFallback: boolean;
};

/**
 * Build a ResolvedGameTrailer from metadata movie data.
 * Uses the priority resolver defined in resolveGameTrailerByPriority.
 */
export function movieToResolvedTrailer(movie: SteamMovie, index: number): ResolvedGameTrailer {
  return resolveTrailerByPriority({
    id: movie.id ?? index,
    name: movie.name ?? `Trailer ${index + 1}`,
    thumbnailUrl: movie.thumbnail,
    mp4_480: movie.mp4_480,
    mp4_max: movie.mp4_max,
    webm_480: movie.webm_480,
    webm_max: movie.webm_max,
    hls: movie.hls,
    hls_h264: movie.hls_h264,
    dash: movie.dash,
    dash_h264: movie.dash_h264,
    dash_av1: movie.dash_av1,
    highlight: movie.highlight,
  });
}

/**
 * Build an array of ResolvedGameTrailers from game metadata.
 * Pure function — no API calls, no side effects.
 */
export function extractResolvedTrailers(game: LibraryGame | null): ResolvedGameTrailer[] {
  return resolveGameTrailers(game?.metadata?.movies);
}

/**
 * Extract trailer/video info from game metadata.
 * Pure function — no API calls, no side effects.
 * Returns best available playable URLs for safe future playback.
 */
export function extractTrailerData(game: LibraryGame | null): TrailerData {
  const trailers = resolveGameTrailers(game?.metadata?.movies);
  if (trailers.length === 0) {
    return { thumbnail: null, mp4Url: null, webmUrl: null, hlsUrl: null, hasTrailer: false, movieCount: 0, hasDirectVideo: false, hasStreamFallback: false };
  }

  // Prefer highlight reel, then first trailer
  const primary = trailers.find((t) => t.highlight) ?? trailers[0];

  return {
    thumbnail: primary.thumbnailUrl ?? null,
    mp4Url: primary.mp4Url ?? null,
    webmUrl: primary.webmUrl ?? null,
    hlsUrl: primary.hlsUrl ?? null,
    hasTrailer: trailers.some((t) => t.hasDirectVideo || t.hasStreamFallback),
    movieCount: trailers.length,
    hasDirectVideo: trailers.some((t) => t.hasDirectVideo),
    hasStreamFallback: !trailers.some((t) => t.hasDirectVideo) && trailers.some((t) => t.hasStreamFallback),
  };
}
