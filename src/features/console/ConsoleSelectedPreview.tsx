import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import {
  Play, Pause, Clapperboard, Image, CircleSlash, Loader2,
  SkipBack
} from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import type { TrailerData } from "./consoleTrailerData";
import { getConsoleHeroBackground, getConsoleCardSrc } from "./consoleMedia";

type Props = {
  game: LibraryGame | null;
  showTrailerPreview?: boolean;
  trailerData?: TrailerData | null;
  /** When set, overrides the preview image (used for screenshot browsing).
   *  Disables video/play overlay — purely image display. */
  screenshotOverrideUrl?: string | null;
  /** `"thumbnail"` — image-only preview (no video element)
   *  `"details"` — renders <video> for playable sources + control bar */
  mode?: "thumbnail" | "details";
  /** Autoplay trailer when entering details mode (default false).
   *  Only applies to direct mp4/webm — HLS/DASH always require user click. */
  autoplay?: boolean;
  /** When false, video layer + play button + controls are hidden — shows static artwork only.
   *  Set true on hover or when actively playing. */
  showVideo?: boolean;
  /** Forces display to fallback artwork (hero/landscape) regardless of
   *  trailer availability. Used by ConsoleGridLayout's delayed trailer
   *  behavior: show artwork first, switch to trailer after 3s. */
  showArtworkFirst?: boolean;
  /** When set in thumbnail mode, renders a muted autoplay <video> element
   *  overlaid on the trailer thumbnail. Autoplays on source change, loops on end. */
  thumbnailAutoplaySrc?: string | null;
  /** Callback when a thumbnail autoplay video ends — used for sequential trailer playback. */
  onTrailerEnded?: () => void;
  /** Called when user clicks play in thumbnail mode — requests switch to details mode. */
  onRequestDetailsMode?: () => void;
  /** Identity key that changes whenever the selected media changes.
   *  Used to force video element remount across media type/selection switches. */
  mediaIdentityKey?: string;
};

const DEBUG_PREVIEW = false;
const DEBUG_HLS = false;
const DEBUG_AUTO_OVERLAY = false;
const DEBUG_PREVIEW_PIPE = false;
const LOG_PREFIX = "[CONSOLE_PREVIEW]";
const CONTROLS_HIDE_MS = 3000;
/** For testing only: set to true and provide a known direct MP4 URL to
 *  isolate player/autoplay logic from Steam source data. */
const DEBUG_FORCE_TEST_MP4 = false;
const DEBUG_FORCE_TEST_MP4_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

/** Lightweight video controls bar for Console Mode. */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Preview component for the selected game in ConsoleMode details.
 *
 * Image priority (remote-only, no local file lookups):
 * 1. screenshotOverrideUrl — screenshot browsing override
 * 2. trailerData.thumbnail — prepared trailer thumbnail
 * 3. metadata.movies[0].thumbnail — trailer thumbnail from cached Steam metadata
 * 4. metadata.screenshots[0] — cached screenshot
 * 5. landscape/background image fallback
 *
 * Video priority (remote-only, no local file lookups):
 * 1. trailerData.mp4Url — direct remote mp4
 * 2. trailerData.webmUrl — direct remote webm
 * 3. trailerData.hls_h264 — HLS H.264 stream (via hls.js or native Safari)
 * 4. trailerData.dash_h264 — DASH H.264 stream
 * 5. trailerData.dash_av1 — DASH AV1 stream
 * 6. trailerData.hlsUrl — generic HLS stream
 *
 * HLS playback follows StoreGameMediaGallery pattern:
 * - Native HLS via `video.canPlayType("application/vnd.apple.mpegurl")` (Safari)
 * - hls.js dynamic import for all other browsers (WebView2, Chrome, Firefox)
 * - Cleanup on unmount / source change
 */
export default function ConsoleSelectedPreview({
  game, showTrailerPreview = true, trailerData, screenshotOverrideUrl,
  mode = "thumbnail", autoplay = false, showVideo = true, mediaIdentityKey,
  showArtworkFirst = false, thumbnailAutoplaySrc, onTrailerEnded, onRequestDetailsMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbAutoplayVideoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const thumbHlsRef = useRef<any>(null);
  const controlsTimerRef = useRef<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [thumbnailOnlyClicked, setThumbnailOnlyClicked] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [thumbAutoplayError, setThumbAutoplayError] = useState(false);
  const [autoplayFailed, setAutoplayFailed] = useState(false);

  /* ── Debug autoplay state (visible overlay) ── */
  const [autoPlayCalled, setAutoPlayCalled] = useState(false);
  const [autoPlaySuccess, setAutoPlaySuccess] = useState(false);
  const [autoPlayError, setAutoPlayError] = useState<string | null>(null);
  const [autoVideoReady, setAutoVideoReady] = useState(false);
  const [autoHlsState, setAutoHlsState] = useState<string>("idle");

  /* ── Video control state ── */
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(false);

  const detailsMode = mode === "details";

  /* ── Effective display source (considers screenshot override) ── */
  const previewData = useMemo(() => {
    if (!game || !showTrailerPreview) {
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[SOURCE_SKIP] game=${!!game} showTrailerPreview=${showTrailerPreview}`);
      return null;
    }

    // 1. prepared trailer thumbnail
    if (trailerData?.thumbnail) {
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[SOURCE] step=1-trailerData appid=${game.appId} src=${trailerData.thumbnail}`);
      return { src: trailerData.thumbnail, label: "Trailer" as const };
    }

    // 2. metadata movie thumbnail
    const movies = game.metadata?.movies;
    if (movies && movies.length > 0) {
      const first = movies[0];
      const thumb = first.thumbnail ?? null;
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[SOURCE] step=2-movies appid=${game.appId} count=${movies.length} thumb=${thumb}`);
      return { src: thumb, label: "Trailer" as const };
    }

    // 3. screenshot
    const screenshots = game.metadata?.screenshots;
    if (screenshots && screenshots.length > 0) {
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[SOURCE] step=3-screenshots appid=${game.appId} src=${screenshots[0]}`);
      return { src: screenshots[0] ?? null, label: "Screenshot" as const };
    }

    if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[SOURCE] step=4-none appid=${game?.appId ?? "?"} no trailer/screenshot/fallback`);
    return null;
  }, [game, showTrailerPreview, trailerData]);

  const fallbackSrc = useMemo(() => {
    const hero = getConsoleHeroBackground(game);
    const card = getConsoleCardSrc(game, "landscape");
    const src = hero ?? card;
    if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[FALLBACK] appid=${game?.appId ?? "?"} hero=${hero} card=${card} final=${src}`);
    return src;
  }, [game]);

  const screenshotActive = !!screenshotOverrideUrl && !showArtworkFirst;
  const displaySrc = showArtworkFirst ? fallbackSrc : (screenshotOverrideUrl ?? previewData?.src ?? fallbackSrc);
  const isTrailer = !showArtworkFirst && !screenshotActive && previewData?.label === "Trailer";
  const label = showArtworkFirst ? "Artwork" : (screenshotActive ? "Screenshot" : (previewData?.label ?? "Artwork"));

  /* ── Video source (remote-only, no local video cache) ──
   *  Priority matches StoreGameMediaGallery.getPreferredSrc:
   *  mp4 > webm > hls_h264 > dash_h264 > dash_av1 > hls */
  const { videoSrc, playType } = useMemo(() => {
    if (!detailsMode || !trailerData) return { videoSrc: null as string | null, playType: "none" as const };

    const vSrc = trailerData.playableUrl ?? null;
    const vType = trailerData.playableType;
    if (DEBUG_PREVIEW) {
      console.log(`${LOG_PREFIX}[VIDEO_SRC] appid=${game?.appId ?? "?"} videoSrc=${vSrc?.substring(0, 80) ?? "null"} playType=${vType}`);
    }
    return { videoSrc: vSrc, playType: vType };
  }, [detailsMode, trailerData, game?.appId]);

  const hasVideo = playType !== "none";
  const showDisabledFallback = detailsMode && isTrailer && playType === "none" && !videoError;

  /* ── Trailer label ── */
  const trailerName = useMemo(() => {
    if (!detailsMode || !isTrailer || !game?.metadata?.movies) return null;
    const primary = game.metadata.movies.find((m) => m.highlight) ?? game.metadata.movies[0];
    return primary?.name ?? null;
  }, [detailsMode, isTrailer, game]);

  /* ── Controls visibility timer ── */
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isPlaying) {
      controlsTimerRef.current = window.setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
    }
  }, [isPlaying]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [isPlaying, resetControlsTimer]);

  /* ── HLS lifecycle (matches StoreGameMediaGallery pattern) ── */
  function destroyHls() {
    if (hlsRef.current) {
      if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_DESTROY] appid=${game?.appId}`);
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  function destroyThumbHls() {
    if (thumbHlsRef.current) {
      if (DEBUG_HLS) console.log(`${LOG_PREFIX}[THUMB_HLS_DESTROY] appid=${game?.appId}`);
      thumbHlsRef.current.destroy();
      thumbHlsRef.current = null;
    }
  }

  async function initThumbHls(video: HTMLVideoElement, url: string) {
    destroyThumbHls();
    setAutoHlsState("init");
    if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_INIT] appid=${game?.appId} url=${url.substring(0, 80)}`);

    // Native HLS (Safari, some WebViews)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      setAutoHlsState("native");
      video.src = url;
      setAutoPlayCalled(true);
      if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_NATIVE] appid=${game?.appId}`);
      video.play().then(() => {
        setAutoPlaySuccess(true);
        setAutoplayFailed(false);
        if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_NATIVE_PLAY_SUCCESS] appid=${game?.appId}`);
      }).catch((err) => {
        setAutoPlayError(err.message ?? String(err));
        setAutoplayFailed(true);
        if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_NATIVE_PLAY_FAIL] appid=${game?.appId} error=${err.message ?? String(err)}`);
      });
      return;
    }

    try {
      const { default: Hls } = await import("hls.js");
      const supported = Hls.isSupported();
      if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_SUPPORTED] appid=${game?.appId} supported=${supported}`);
      if (supported) {
        setAutoHlsState("loading");
        thumbHlsRef.current = new Hls();
        thumbHlsRef.current.loadSource(url);
        thumbHlsRef.current.attachMedia(video);
        thumbHlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
          setAutoHlsState("manifest_parsed");
          setAutoPlayCalled(true);
          if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_MANIFEST_PARSED] appid=${game?.appId}`);
          video.play().then(() => {
            setAutoPlaySuccess(true);
            setAutoplayFailed(false);
            if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_PLAY_SUCCESS] appid=${game?.appId}`);
          }).catch((err) => {
            setAutoPlayError(err.message ?? String(err));
            setAutoplayFailed(true);
            if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_PLAY_FAIL] appid=${game?.appId} error=${err.message ?? String(err)}`);
          });
        });
        thumbHlsRef.current.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][HLS_ERROR] appid=${game?.appId} type=${data.type} details=${data.details} fatal=${data.fatal}`);
          if (data.fatal) {
            setAutoHlsState(`error:${data.type}:${data.details}`);
            setThumbAutoplayError(true);
          }
        });
      } else {
        setAutoHlsState("unsupported");
        setThumbAutoplayError(true);
      }
    } catch (e) {
      setAutoHlsState(`exception:${String(e)}`);
      setThumbAutoplayError(true);
    }
  }

  /* ── Reset video/metadata state on game change ── */
  useEffect(() => {
    if (!game?.appId) return;
    setIsPlaying(false);
    setVideoError(false);
    setIsLoading(false);
    setHasEnded(false);
    setImgError(false);
    setThumbnailOnlyClicked(false);
    setThumbAutoplayError(false);
    setAutoplayFailed(false);
    setAutoPlayCalled(false);
    setAutoPlaySuccess(false);
    setAutoPlayError(null);
    setAutoVideoReady(false);
    setAutoHlsState("idle");
    setCurrentTime(0);
    setDuration(0);
    if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[GAME_CHANGE_RESET] appid=${game.appId}`);
  }, [game?.appId]);

  /* ── Reset autoplay state on source/appId change ──
   *  Runs BEFORE the play-attempt effect to ensure stale failure state
   *  (autoplayFailed, thumbAutoplayError) from a previous source does not
   *  persist into the new source's first render. */
  useEffect(() => {
    if (!thumbnailAutoplaySrc || !game?.appId) return;
    setAutoPlayCalled(false);
    setAutoPlaySuccess(false);
    setAutoPlayError(null);
    setAutoVideoReady(false);
    setAutoplayFailed(false);
    setThumbAutoplayError(false);
    setAutoHlsState("idle");
    if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[AUTO_RESET] appid=${game.appId} src=${thumbnailAutoplaySrc.substring(0, 80)}`);
  }, [thumbnailAutoplaySrc, game?.appId]);

  /* ── Programmatic autoplay for thumbnail preview video ── */
  const prevThumbAutoplayKey = useRef<string | null>(null);
  useEffect(() => {
    const key = thumbnailAutoplaySrc ? `${game?.appId}:${thumbnailAutoplaySrc}` : null;
    if (!key || key === prevThumbAutoplayKey.current) return;
    prevThumbAutoplayKey.current = key;

    const appId = game?.appId;
    if (!appId) return;

    // Use force test MP4 URL when enabled (bypasses actual source)
    const src = DEBUG_FORCE_TEST_MP4 ? DEBUG_FORCE_TEST_MP4_URL : thumbnailAutoplaySrc;

    if (DEBUG_PREVIEW) {
      console.log(`${LOG_PREFIX}[THUMB_AUTOPLAY] appid=${appId} src=${src?.substring(0, 80)}`);
    }

    // Reset all autoplay state
    setAutoPlayCalled(false);
    setAutoPlaySuccess(false);
    setAutoPlayError(null);
    setAutoVideoReady(false);
    setAutoplayFailed(false);
    setThumbAutoplayError(false);
    setAutoHlsState("idle");

    if (!src) return;

    // ── PREVIEW_PIPE: received prop ──
    if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][RECEIVE_PROP] appid=${appId} src=${src.substring(0, 80)}`);

    const video = thumbAutoplayVideoRef.current;
    if (!video) {
      if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][REF_NULL] appid=${appId} — thumbAutoplayVideoRef is null`);
      setAutoplayFailed(true);
      return;
    }
    if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][REF_OK] appid=${appId} — video ref is set`);

    // Determine source type
    const isHls = !DEBUG_FORCE_TEST_MP4 && trailerData?.playableType === "hls";

    if (isHls) {
      setAutoHlsState("init");
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[THUMB_AUTOPLAY_HLS] appid=${appId} url=${src.substring(0, 80)}`);
      initThumbHls(video, src);
    } else {
      // Direct mp4/webm or force test — set src and call play()
      video.muted = true;
      (video as any).playsInline = true;
      video.preload = "auto";
      video.src = src;

      setAutoPlayCalled(true);

      // Log video events
      const onLoaded = () => {
        setAutoVideoReady(true);
        if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[THUMB_VIDEO_LOADED] appid=${appId}`);
      };
      const onPlaying = () => {
        setAutoPlaySuccess(true);
        setAutoplayFailed(false);
        if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][PLAY_SUCCESS] appid=${appId}`);
      };
      const onError_ = () => {
        const errMsg = video.error?.message ?? video.error?.code?.toString() ?? "unknown";
        setAutoPlayError(errMsg);
        setAutoplayFailed(true);
        if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][PLAY_ERROR] appid=${appId} error=${errMsg}`);
      };

      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("playing", onPlaying, { once: true });
      video.addEventListener("error", onError_, { once: true });

      requestAnimationFrame(() => {
        if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][PLAY_ATTEMPT] appid=${appId} src=${src.substring(0, 80)}`);
        video.play().then(() => {
          // play() resolved — video might still be buffering, wait for 'playing' event
          if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[THUMB_AUTOPLAY_PROMISE_RESOLVED] appid=${appId}`);
        }).catch((err) => {
          if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][PLAY_REJECTED] appid=${appId} error=${err.message ?? String(err)}`);
          setAutoPlayError(err.message ?? String(err));
          setAutoplayFailed(true);
          setAutoPlayCalled(false);
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("playing", onPlaying);
          video.removeEventListener("error", onError_);
        });
      });
    }

    return () => {
      destroyThumbHls();
      if (video) {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [thumbnailAutoplaySrc, game?.appId, trailerData?.playableType]);

  async function initHls(video: HTMLVideoElement, url: string) {
    destroyHls();

    // Native HLS support (Safari, some WebViews)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_NATIVE] appid=${game?.appId}`);
      video.src = url;
      setIsLoading(false);
      return;
    }

    // hls.js for all other browsers (WebView2, Chrome, Firefox)
    if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_INIT] appid=${game?.appId} url=${url}`);
    try {
      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        hlsRef.current = new Hls();
        hlsRef.current.loadSource(url);
        hlsRef.current.attachMedia(video);
        hlsRef.current.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_ERROR] appid=${game?.appId} error=${data.type}:${data.details}`);
            setVideoError(true);
            setIsLoading(false);
          }
        });
        hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
          if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_READY] appid=${game?.appId}`);
          setIsLoading(false);
          // Autoplay if queued
          if (autoplayQueuedRef.current && videoRef.current) {
            autoplayQueuedRef.current = false;
            const v = videoRef.current;
            v.muted = true;
            v.play().then(() => {
              v.addEventListener("playing", () => { v.muted = false; }, { once: true });
            }).catch(() => {});
          }
        });
        if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_ATTACHED] appid=${game?.appId}`);
      } else {
        if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_UNSUPPORTED] appid=${game?.appId}`);
        setVideoError(true);
        setIsLoading(false);
      }
    } catch (e) {
      if (DEBUG_HLS) console.log(`${LOG_PREFIX}[HLS_FAILED] appid=${game?.appId} error=${String(e)}`);
      setVideoError(true);
      setIsLoading(false);
    }
  }

  // Setup video source on trailer/playableUrl change
  useEffect(() => {
    if (!detailsMode || !videoSrc || playType === "none") return;
    const video = videoRef.current;
    if (!video) return;

    setVideoError(false);
    // Don't reset autoplayQueuedRef here — the autoplay effect sets it,
    // and handleLoadedMetadata/initHls will consume it

    if (playType === "hls") {
      setIsLoading(true);
      initHls(video, videoSrc);
    } else {
      // Direct mp4/webm or DASH: set src directly, browser handles loading
      video.src = videoSrc;
    }

    return () => {
      destroyHls();
      if (video) video.removeAttribute("src");
    };
  }, [detailsMode, videoSrc, playType, game?.appId]);

  // Re-setup HLS when video element mounts (showVideo flip or deferred mount)
  useEffect(() => {
    if (!showVideo || !detailsMode || playType !== "hls" || !videoSrc) return;
    const video = videoRef.current;
    if (!video) return;
    setVideoError(false);
    setIsLoading(true);
    initHls(video, videoSrc);
    return () => { destroyHls(); };
  }, [showVideo, detailsMode, playType, videoSrc, game?.appId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyHls();
      destroyThumbHls();
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  /* ── Detect ended state from currentTime vs duration ── */
  useEffect(() => {
    if (detailsMode && hasVideo && duration > 0 && currentTime >= duration && !isPlaying) {
      setHasEnded(true);
    }
  }, [currentTime, duration, detailsMode, hasVideo, isPlaying]);

  /* ── Reset ended state when media identity changes ── */
  useEffect(() => {
    setHasEnded(false);
  }, [mediaIdentityKey]);

  /* ── Play/Pause handler ── */
  const handlePlayClick = useCallback(() => {
    if (videoRef.current && hasVideo && !videoError) {
      if (playType === "hls" && isLoading) return;
      setHasEnded(false);
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[PLAY] appid=${game?.appId} src=${videoSrc?.substring(0, 80) ?? "null"}`);
      return;
    }

    // In thumbnail mode — request switch to details mode for full video player
    if (!detailsMode && isTrailer && trailerData?.playableType !== "none") {
      onRequestDetailsMode?.();
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[REQUEST_DETAILS] appid=${game?.appId}`);
      return;
    }

    // Thumbnail-only click feedback (no playable source)
    if (isTrailer && playType === "none" && !hasVideo) {
      setThumbnailOnlyClicked(true);
      setTimeout(() => setThumbnailOnlyClicked(false), 2000);
      if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[THUMBNAIL_ONLY] appid=${game?.appId} — no playable source`);
    }
  }, [videoSrc, videoError, isTrailer, hasVideo, playType, isLoading, game?.appId, detailsMode, trailerData, onRequestDetailsMode]);

  /* ── Native video event handlers ── */
  const handleNativePlay = useCallback(() => {
    setIsPlaying(true);
    setHasEnded(false);
  }, []);

  const handleNativePause = useCallback(() => {
    setIsPlaying(false);
    setShowControls(true);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) setCurrentTime(video.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) setDuration(video.duration);
    if (autoplayQueuedRef.current && videoRef.current) {
      autoplayQueuedRef.current = false;
      const v = videoRef.current;
      v.muted = true;
      v.play().then(() => {
        v.addEventListener("playing", () => { v.muted = false; }, { once: true });
      }).catch(() => {});
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    setHasEnded(true);
    setShowControls(true);
    onTrailerEnded?.();
  }, [onTrailerEnded]);

  const handleVideoError = useCallback(() => {
    setVideoError(true);
    setIsPlaying(false);
    setIsLoading(false);
  }, []);

  /* ── Control actions ── */
  const handlePlayPauseToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const handleSeekBack = useCallback(() => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, video.currentTime - 10);
    resetControlsTimer();
  }, [resetControlsTimer]);

  /* handleSeekForward and handleMuteToggle removed — mute controlled from ConsoleGameDetails actions zone, seek via LT/RT */

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    video.currentTime = pct * duration;
    resetControlsTimer();
  }, [duration, resetControlsTimer]);

  const handleContainerMouseEnter = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
  }, []);

  const handleContainerMouseMove = useCallback(() => {
    resetControlsTimer();
  }, [resetControlsTimer]);

  /* ── Autoplay on video src / media type change (direct mp4/webm only) ── */
  const prevMediaKey = useRef<string | null>(null);
  const autoplayQueuedRef = useRef(false);
  const mediaKey = screenshotActive ? `ss-${screenshotOverrideUrl}` : (detailsMode && videoSrc ? `trailer-${videoSrc}` : "none");

  useEffect(() => {
    if (mediaKey === prevMediaKey.current) return;
    prevMediaKey.current = mediaKey;

    if (detailsMode && autoplay && !screenshotActive && videoSrc && !videoError) {
      // Queue autoplay — handleLoadedMetadata or HLS setup will pick it up
      autoplayQueuedRef.current = true;
      if (videoRef.current && playType === "direct") {
        const v = videoRef.current;
        v.muted = true;
        v.currentTime = 0;
        if (v.readyState >= 2) {
          v.play().then(() => {
            v.addEventListener("playing", () => { v.muted = false; }, { once: true });
          }).catch(() => {});
          autoplayQueuedRef.current = false;
        }
      }
    }
  }, [mediaKey, detailsMode, autoplay, screenshotActive, playType, videoSrc, videoError]);

  /* ── Track whether the autoplay video element rendered ── */
  const autoVideoRenderedRef = useRef(false);
  useEffect(() => {
    const rendered = thumbAutoplayVideoRef.current !== null;
    if (rendered !== autoVideoRenderedRef.current) {
      autoVideoRenderedRef.current = rendered;
      if (rendered && thumbnailAutoplaySrc) {
        if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][RENDER_VIDEO] appid=${game?.appId} src=${thumbnailAutoplaySrc.substring(0, 80)}`);
      }
    }
  });

  /* ── Reset thumbnail autoplay error on source change ── */
  useEffect(() => {
    setThumbAutoplayError(false);
  }, [thumbnailAutoplaySrc]);

  const handleImgError = useCallback(() => {
    if (DEBUG_PREVIEW) {
      const errorSrc = displaySrc ?? "(null)";
      console.log(`${LOG_PREFIX}[IMAGE_ERROR] appid=${game?.appId ?? "?"} src=${errorSrc.substring(0, 120)}`);
    }
    setImgError(true);
  }, [game?.appId, displaySrc]);

  if (!game) return null;

  if (DEBUG_PREVIEW) {
    console.log(`${LOG_PREFIX}[RENDER] appid=${game.appId} mode=${mode} screenshotActive=${screenshotActive} videoSrc=${videoSrc?.substring(0, 80) ?? "null"} playType=${playType} displaySrc=${displaySrc?.substring(0, 80) ?? "null"} imgError=${imgError} isTrailer=${isTrailer} hasVideo=${hasVideo} isLoading=${isLoading} isPlaying=${isPlaying} videoError=${videoError}`);
  }

  const playBtnSize = "h-14 w-14";
  const playIconSize = "h-6 w-6";
  const showControlsBar = detailsMode && hasVideo && !videoError && !screenshotActive && (showControls || isPlaying);
  const showCenterPlay = showVideo && isTrailer && displaySrc && !imgError && !screenshotActive;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-(--color-surface)/20 shadow-xl shadow-black/30 ring-1 ring-white/[0.06] backdrop-blur-sm"
      onMouseEnter={handleContainerMouseEnter}
      onMouseMove={handleContainerMouseMove}
    >
      {/* ── Image layer ── */}
      {displaySrc && !imgError ? (
        <img
          key={`${game.appId}-${displaySrc}`}
          src={displaySrc}
          alt=""
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            isPlaying && hasVideo && !screenshotActive ? "opacity-0" : ""
          } ${
            !detailsMode && thumbnailAutoplaySrc && !thumbAutoplayError && autoPlaySuccess && !showArtworkFirst ? "opacity-0" : ""
          }`}
          onError={handleImgError}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/30">
          {label === "Screenshot" ? (
            <Image className="h-8 w-8 text-(--color-muted)/30" />
          ) : (
            <Clapperboard className="h-8 w-8 text-(--color-muted)/30" />
          )}
        </div>
      )}

      {/* ── Thumbnail autoplay video (muted, no controls, programmatic play()) ── */}
      {/* The video renders whenever thumbnailAutoplaySrc is set, regardless of
          previous playback failures. The image stays on top until autoPlaySuccess=true,
          so a failed-play video behind it is never visible. The key changes on
          source/appId change, forcing a fresh video element mount. */}
      {!detailsMode && thumbnailAutoplaySrc && !screenshotActive && !showArtworkFirst && (
        <video
          ref={thumbAutoplayVideoRef}
          key={`${game.appId}:${thumbnailAutoplaySrc}`}
          poster={displaySrc && displaySrc !== thumbnailAutoplaySrc ? displaySrc : undefined}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
          onLoadedMetadata={() => { setAutoVideoReady(true); if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[THUMB_VIDEO_LOADEDMETA] appid=${game?.appId}`); }}
          onPlaying={() => { setAutoPlaySuccess(true); setAutoplayFailed(false); if (DEBUG_PREVIEW) console.log(`${LOG_PREFIX}[THUMB_VIDEO_PLAYING] appid=${game?.appId}`); }}
          onError={() => { setThumbAutoplayError(true); if (DEBUG_PREVIEW_PIPE) console.log(`[PREVIEW_PIPE][VIDEO_ELEMENT_ERROR] appid=${game?.appId}`); }}
          onEnded={() => { onTrailerEnded?.(); }}
        />
      )}

      {/* ── Video layer (always renders when video source exists) ── */}
      {detailsMode && hasVideo && !videoError && !screenshotActive && (
        <video
          ref={videoRef}
          data-console-preview-video={game.appId}
          key={`${game.appId}-${mediaIdentityKey ?? trailerData?.playableUrl ?? "none"}`}
          src={playType === "direct" && videoSrc ? videoSrc : undefined}
          muted
          playsInline
          preload="metadata"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            isPlaying ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onPlay={handleNativePlay}
          onPause={handleNativePause}
          onEnded={handleVideoEnded}
          onError={handleVideoError}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
        />
      )}

      {/* ── Center play overlay (trailer / screenshot browser) ── */}
      {showCenterPlay && (
        <div className="absolute inset-0 flex items-center justify-center">
          {isPlaying ? null : (
            <>
              {/* HLS loading spinner */}
              {detailsMode && playType === "hls" && isLoading ? (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/30 backdrop-blur-sm">
                  <Loader2 className="h-7 w-7 animate-spin text-white/60" />
                </div>
              ) : (hasVideo || (!detailsMode && isTrailer && trailerData?.playableType !== "none")) && !videoError && !screenshotActive ? (
                /* Play / Replay button — shows in both thumbnail and details mode when trailer has a source */
                /* Play / Replay button */
                <button
                  type="button"
                  onClick={handlePlayClick}
                  className={`flex ${playBtnSize} items-center justify-center rounded-full bg-black/50 text-white shadow-lg shadow-black/30 backdrop-blur-xl transition-all hover:scale-110 hover:bg-(--color-accent) hover:text-white hover:shadow-xl hover:shadow-(--color-accent)/30 focus:outline-none focus:ring-2 focus:ring-(--color-accent)/60 active:scale-105`}
                  aria-label={hasEnded ? "Replay trailer" : "Play trailer"}
                >
                  <Play className={`ml-0.5 ${playIconSize} fill-current`} />
                </button>
              ) : showDisabledFallback && !hasEnded ? (
                /* No playable source — disabled overlay */
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
              ) : null}

              {/* Replay label when ended */}
              {hasEnded && (
                <span className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/70 backdrop-blur-sm">
                  Trailer ended — click to replay
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Video controls bar ── */}
      {showControlsBar && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10 pb-2.5 px-3 transition-opacity duration-200"
          onMouseEnter={() => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); }}
          onMouseLeave={() => {
            if (isPlaying) {
              controlsTimerRef.current = window.setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
            }
          }}
        >
          {/* Progress bar */}
          <div
            className="group/progress mb-2 h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/15 transition-all hover:h-2"
            onClick={handleProgressClick}
          >
            <div
              className="h-full rounded-full bg-(--color-accent) transition-all duration-150"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Seek back */}
              <button
                type="button"
                onClick={handleSeekBack}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 transition hover:bg-white/10 hover:text-white"
                aria-label="Back 10 seconds"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </button>

              {/* Play/Pause */}
              <button
                type="button"
                onClick={handlePlayPauseToggle}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
              </button>

              {/* Time display */}
              <span className="ml-1 font-mono text-[11px] tabular-nums text-white/60">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-1.5" />
          </div>
        </div>
      )}

      {/* ── Thumbnail-only click feedback toast ── */}
      {thumbnailOnlyClicked && !hasVideo && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <div className="rounded-lg bg-amber-600/80 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
            Trailer preview only — no video available
          </div>
        </div>
      )}

      {/* ── Gradient bottom label — shows trailer name ── */}
      {detailsMode && trailerName && !screenshotActive && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/20 to-transparent pb-3 pt-8">
          <div className="flex items-center gap-2 px-3">
            <Play className="h-3 w-3 fill-white/80 text-white/80 shrink-0" />
            <span className="truncate text-xs font-medium text-white/90">
              {trailerName}
            </span>
          </div>
        </div>
      )}

      {/* ── Type label badge (bottom-left) ── */}
      {!detailsMode && (
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 backdrop-blur-sm">
          {label === "Trailer" ? (
            <Play className="h-3 w-3 fill-white/70 text-white/70" />
          ) : (
            <Image className="h-3 w-3 text-white/70" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
            {label}
          </span>
        </div>
      )}

      {/* ── Screenshot badge / back-to-trailer hint ── */}
      {screenshotActive && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/50 px-2 py-0.5 backdrop-blur-sm">
          <Image className="h-3 w-3 text-white/70" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
            Screenshot
          </span>
        </div>
      )}

      {/* ── Video error badge ── */}
      {detailsMode && videoError && (
        <div className="pointer-events-none absolute bottom-8 left-2 flex items-center gap-1 rounded-md bg-red-900/60 px-2 py-0.5 text-[10px] text-red-200">
          Video unavailable
        </div>
      )}

      {/* ── Debug autoplay overlay ── */}
      {DEBUG_AUTO_OVERLAY && thumbnailAutoplaySrc && !detailsMode && (
        <div className="pointer-events-none absolute top-1 right-1 z-50 max-w-[220px] rounded-md bg-black/80 p-2 text-[9px] leading-tight text-green-300 shadow-lg backdrop-blur-sm">
          <div className="mb-0.5 font-bold text-[10px] text-white/80">AUTO PREVIEW</div>
          <div>appid={game.appId}</div>
          <div>mode={label}</div>
          <div>source={trailerData?.playableType ?? "none"}</div>
          <div>src={thumbnailAutoplaySrc ? thumbnailAutoplaySrc.length > 50 ? thumbnailAutoplaySrc.substring(0, 50) + "…" : thumbnailAutoplaySrc : "null"}</div>
          <div>videoRendered={String(!!thumbAutoplayVideoRef.current)}</div>
          <div>videoRef={String(!!thumbAutoplayVideoRef.current)}</div>
          <div>playCalled={String(autoPlayCalled)}</div>
          <div>playSuccess={String(autoPlaySuccess)}</div>
          <div className={autoPlayError ? "text-red-300" : ""}>playError={autoPlayError ?? "null"}</div>
          <div>hlsState={autoHlsState}</div>
          <div>videoReady={String(autoVideoReady)}</div>
          <div>thumbError={String(thumbAutoplayError)}</div>
          <div>autoFail={String(autoplayFailed)}</div>
        </div>
      )}
    </div>
  );
}
