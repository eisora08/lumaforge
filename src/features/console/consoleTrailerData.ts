import type { LibraryGame } from "../../types/libraryGame";
import type { SteamMovie } from "../../types/gameMetadata";
import type { ResolvedGameTrailer } from "../../types/gameMedia";
import { resolveTrailerByPriority, resolveGameTrailers } from "../../services/gameMetadataResolver";

const LOG_PREFIX = "[CONSOLE_TRAILER]";
const DEBUG_TRAILER = false;

export type TrailerData = {
  thumbnail: string | null;
  mp4Url: string | null;
  webmUrl: string | null;
  hlsUrl: string | null;
  hls_h264: string | null;
  dash_h264: string | null;
  dash_av1: string | null;
  /** Best playable URL following Store priority: mp4 > webm > hls_h264 > dash_h264 > dash_av1 > hls */
  playableUrl: string | null;
  /** Playback engine hint matching the playableUrl source */
  playableType: "direct" | "hls" | "dash" | "none";
  hasTrailer: boolean;
  movieCount: number;
  /** True when at least one movie has a direct mp4/webm URL. */
  hasDirectVideo: boolean;
  /** True when no movie has direct video and at least one has HLS/DASH. */
  hasStreamFallback: boolean;
};

/**
 * Build a ResolvedGameTrailer from metadata movie data.
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
 */
export function extractResolvedTrailers(game: LibraryGame | null): ResolvedGameTrailer[] {
  return resolveGameTrailers(game?.metadata?.movies);
}

/**
 * Extract trailer/video info from game metadata.
 * Pure function — no API calls, no side effects.
 * Uses metadata.movies[] only. Ignores embedded about_the_game/detailed_description videos.
 */
export function extractTrailerData(game: LibraryGame | null): TrailerData {
  const movies = game?.metadata?.movies;
  const trailers = resolveGameTrailers(movies);

  if (DEBUG_TRAILER && game?.appId) {
    if (movies && movies.length > 0) {
      console.log(`${LOG_PREFIX}[MOVIES] appid=${game.appId} count=${movies.length}`);
      movies.forEach((m) => {
        console.log(`${LOG_PREFIX}[MOVIE] appid=${game.appId} id=${m.id} name="${m.name}" thumbnail=${m.thumbnail ?? "null"} hls_h264=${m.hls_h264 ? "yes" : "null"} dash_h264=${m.dash_h264 ? "yes" : "null"} mp4_max=${m.mp4_max ?? "null"} webm_max=${m.webm_max ?? "null"}`);
      });
    } else {
      console.log(`${LOG_PREFIX}[MOVIES] appid=${game.appId} movies=${movies === null ? "null" : movies === undefined ? "undefined" : "empty"}`);
    }
  }

  const empty: TrailerData = {
    thumbnail: null, mp4Url: null, webmUrl: null, hlsUrl: null,
    hls_h264: null, dash_h264: null, dash_av1: null,
    playableUrl: null, playableType: "none",
    hasTrailer: false, movieCount: 0, hasDirectVideo: false, hasStreamFallback: false,
  };

  if (trailers.length === 0) {
    if (DEBUG_TRAILER && game?.appId) {
      console.log(`${LOG_PREFIX}[DATA] appid=${game.appId} title="${game.title}" trailerCount=0`);
    }
    return empty;
  }

  const primary = trailers.find((t) => t.highlight) ?? trailers[0];

  // Store-compatible priority: mp4 > webm > hls_h264 > dash_h264 > dash_av1 > hls
  const playableUrl = primary.mp4Url ?? primary.webmUrl ?? primary.hls_h264 ?? primary.dash_h264 ?? primary.dash_av1 ?? primary.hlsUrl;
  let playableType: TrailerData["playableType"] = "none";
  if (primary.mp4Url || primary.webmUrl) playableType = "direct";
  else if (primary.hls_h264 || primary.hlsUrl) playableType = "hls";
  else if (primary.dash_h264 || primary.dash_av1) playableType = "dash";

  if (DEBUG_TRAILER && game?.appId) {
    console.log(`${LOG_PREFIX}[DATA] appid=${game.appId} title="${game.title}" thumbnailUrl=${primary.thumbnailUrl ?? "null"} playableUrl=${playableUrl ?? "null"} playableType=${playableType}`);
  }

  const hasDirectVideo = trailers.some((t) => t.hasDirectVideo);
  const hasStreamFallback = !hasDirectVideo && trailers.some((t) => t.hasStreamFallback);

  return {
    thumbnail: primary.thumbnailUrl ?? null,
    mp4Url: primary.mp4Url ?? null,
    webmUrl: primary.webmUrl ?? null,
    hlsUrl: primary.hlsUrl ?? null,
    hls_h264: primary.hls_h264 ?? null,
    dash_h264: primary.dash_h264 ?? null,
    dash_av1: primary.dash_av1 ?? null,
    playableUrl: playableUrl ?? null,
    playableType,
    hasTrailer: trailers.some((t) => t.hasDirectVideo || t.hasStreamFallback),
    movieCount: trailers.length,
    hasDirectVideo,
    hasStreamFallback,
  };
}
