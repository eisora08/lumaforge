export type GameMediaKind =
  | "cover"
  | "landscape"
  | "background"
  | "logo"
  | "icon"
  | "screenshot"
  | "trailer";

export type GameMediaSource =
  | "local"
  | "steamgriddb"
  | "steam-appdetails"
  | "igdb"
  | "rawg"
  | "placeholder";

export type ResolvedGameMediaAsset = {
  appId: string;
  kind: GameMediaKind;
  source: GameMediaSource;
  url?: string;
  localPath?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  isAnimated?: boolean;
  cachedAt?: number;
};

export type ResolvedGameTrailer = {
  id: string | number;
  name: string;
  source: "local" | "steam-appdetails" | "igdb" | "rawg";
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;
  localVideoPath?: string | null;

  /* Direct video sources (playable in <video> / webview) */
  mp4Url?: string | null;
  mp4_480?: string | null;
  mp4_max?: string | null;
  webmUrl?: string | null;
  webm_480?: string | null;
  webm_max?: string | null;

  /* Stream fallbacks (HLS/DASH) */
  hlsUrl?: string | null;
  hls_h264?: string | null;
  dashUrl?: string | null;
  dash_h264?: string | null;
  dash_av1?: string | null;

  /** Best playable URL sorted by priority. */
  playableUrl?: string | null;
  /** True when a direct mp4/webm source is available. */
  hasDirectVideo: boolean;
  /** True when only HLS/DASH stream sources are available. */
  hasStreamFallback: boolean;

  highlight?: boolean;
  cachedAt?: number;
};

export type ResolvedGameMediaBundle = {
  appId: string;
  cover?: ResolvedGameMediaAsset;
  landscape?: ResolvedGameMediaAsset;
  background?: ResolvedGameMediaAsset;
  logo?: ResolvedGameMediaAsset;
  icon?: ResolvedGameMediaAsset;
  screenshots?: ResolvedGameMediaAsset[];
  trailers?: ResolvedGameTrailer[];
};
