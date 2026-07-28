import {
  ChevronLeft, ChevronRight, Gamepad2, Play, Pause, VideoOff,
  Volume2, VolumeX, Maximize, Minimize, SkipBack, Loader2
} from "lucide-react";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import AsyncImage from "../../common/AsyncImage";
import type { StoreMediaItem } from "../../../types/store";
import { getStoreMediaBadgeLabel } from "../../../services/storeMediaService";

type StoreGameMediaGalleryProps = {
  title: string;
  mediaItems: StoreMediaItem[];
  appId: string;
  developer: string;
  platforms: string[];
};

const RAIL_SCROLL_AMOUNT = 360;
const CONTROLS_HIDE_DELAY_MS = 3000;

function getPreferredSrc(item: StoreMediaItem): string | undefined {
  if (item.type !== "trailer") return undefined;
  return item.mp4 || item.webm || item.hls_h264 || item.dash_h264 || item.dash_av1 || item.hls || item.dash || undefined;
}

function getBestType(item: StoreMediaItem): string {
  if (item.type !== "trailer") return "unknown";
  if (item.mp4) return "mp4";
  if (item.webm) return "webm";
  if (item.hls_h264) return "hls_h264";
  if (item.dash_h264) return "dash_h264";
  if (item.dash_av1) return "dash_av1";
  if (item.hls) return "hls";
  if (item.dash) return "dash";
  return "unknown";
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function StoreGameMediaGallery({
  title, mediaItems, appId, developer, platforms,
}: StoreGameMediaGalleryProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const lastScrollState = useRef<string>("");
  const controlsTimerRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectedLogId = useRef<string>("");
  const lastOverlayLogRef = useRef<string>("");

  const validItems = useMemo(
    () => mediaItems.filter((item) => {
      if (item.type === "screenshot") return !failedImages.has(item.image);
      return true;
    }),
    [mediaItems, failedImages]
  );

  const safeIndex = Math.min(selectedIndex, Math.max(0, validItems.length - 1));
  const currentItem = validItems.length > 0 ? validItems[safeIndex] : null;
  const badgeLabel = useMemo(() => getStoreMediaBadgeLabel(mediaItems), [mediaItems]);
  const currentIsTrailer = currentItem?.type === "trailer";
  const currentPrefSrc = currentIsTrailer ? getPreferredSrc(currentItem) : undefined;
  const currentBestType = currentIsTrailer ? getBestType(currentItem) : "unknown";

  const _lastMediaScrollUpdate = useRef(0);
  function updateScrollState() {
    const now = Date.now();
    if (now - _lastMediaScrollUpdate.current < 150) return;
    _lastMediaScrollUpdate.current = now;
    const el = railRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setCanScrollLeft(left);
    setCanScrollRight(right);
    const key = `${left}:${right}`;
    if (key !== lastScrollState.current) {
      lastScrollState.current = key;
      console.log(`[STORE][MEDIA_RAIL_OVERFLOW] appid=${appId} canScrollLeft=${left} canScrollRight=${right}`);
    }
  }

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [validItems.length]);

  // Reset video state on selected index change
  useEffect(() => {
    setVideoError(false);
    setIsPlaying(false);
    setHasStarted(false);
    setHasEnded(false);
    setCurrentTime(0);
    setDuration(0);
    setIsLoading(true);
    setShowControls(true);
    destroyHls();
  }, [selectedIndex]);

  // Scroll selected thumbnail into view
  useEffect(() => {
    const btn = thumbRefs.current.get(selectedIndex);
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [selectedIndex]);

  // Log trailer source/selection only when the actual trailer changes
  useEffect(() => {
    if (!currentItem || currentItem.type !== "trailer") {
      lastSelectedLogId.current = "";
      return;
    }
    const id = currentItem.id;
    if (id === lastSelectedLogId.current) return;
    lastSelectedLogId.current = id;

    console.log(`[STORE][TRAILER_SELECTED] appid=${appId} name="${currentItem.name || ""}" source=${currentItem.source || "unknown"} mp4=${!!currentItem.mp4} webm=${!!currentItem.webm} hls=${!!currentItem.hls} hls_h264=${!!currentItem.hls_h264} dash=${!!currentItem.dash} dash_h264=${!!currentItem.dash_h264} dash_av1=${!!currentItem.dash_av1} chosen=${currentBestType}`);
    console.log(`[STORE][TRAILER_VIDEO_RENDER] appid=${appId} type=${currentBestType} url=${currentPrefSrc}`);
  }, [currentItem, currentBestType, currentPrefSrc, appId]);

  // HLS management
  function destroyHls() {
    if (hlsRef.current) {
      console.log(`[STORE][TRAILER_HLS_DESTROY] appid=${appId}`);
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  async function initHls(video: HTMLVideoElement, url: string) {
    destroyHls();

    // Check native HLS support (Safari, some WebViews)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      console.log(`[STORE][TRAILER_HLS_NATIVE] appid=${appId} supported=true`);
      video.src = url;
      return;
    }

    // Use hls.js for all other browsers (WebView2, Chrome, Firefox)
    console.log(`[STORE][TRAILER_HLS_INIT] appid=${appId} url=${url}`);
    try {
      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        hlsRef.current = new Hls();
        hlsRef.current.loadSource(url);
        hlsRef.current.attachMedia(video);
        hlsRef.current.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            console.log(`[STORE][TRAILER_HLS_ERROR] appid=${appId} error=${data.type}:${data.details}`);
            setVideoError(true);
          }
        });
        console.log(`[STORE][TRAILER_HLS_ATTACHED] appid=${appId} url=${url}`);
      } else {
        console.log(`[STORE][TRAILER_HLS_ERROR] appid=${appId} error=hlsjs-not-supported`);
        setVideoError(true);
      }
    } catch (e) {
      console.log(`[STORE][TRAILER_HLS_ERROR] appid=${appId} error=${String(e)}`);
      setVideoError(true);
    }
  }

  // Setup video source when trailer changes
  useEffect(() => {
    if (!currentIsTrailer || !currentPrefSrc) return;
    const video = videoRef.current;
    if (!video) return;

    setIsLoading(true);

    if (currentBestType === "hls_h264" || currentBestType === "hls" || currentPrefSrc.endsWith(".m3u8")) {
      initHls(video, currentPrefSrc);
    } else if (currentBestType === "dash_h264" || currentBestType === "dash_av1" || currentBestType === "dash" || currentPrefSrc.endsWith(".mpd")) {
      video.src = currentPrefSrc;
    } else {
      video.src = currentPrefSrc;
    }

    return () => {
      destroyHls();
      if (video) video.removeAttribute("src");
    };
  }, [currentItem, currentIsTrailer, currentPrefSrc, currentBestType, appId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyHls();
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // Controls auto-hide timer
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    if (isPlaying && !hasEnded) {
      controlsTimerRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_DELAY_MS);
    }
  }, [isPlaying, hasEnded]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [isPlaying, hasEnded, resetControlsTimer]);

  // Video event handlers
  const handleVideoError = useCallback(() => {
    setVideoError(true);
    setIsPlaying(false);
    setIsLoading(false);
    console.log(`[STORE][TRAILER_ERROR] appid=${appId} error=video-load-failure`);
  }, [appId]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    setHasStarted(true);
    setHasEnded(false);
    setIsLoading(false);
    console.log(`[STORE][TRAILER_PLAY] appid=${appId} url=${videoRef.current?.currentSrc || "none"}`);
  }, [appId]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    setShowControls(true);
    console.log(`[STORE][TRAILER_PAUSE] appid=${appId}`);
  }, [appId]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setHasEnded(true);
    setShowControls(true);
    console.log(`[STORE][TRAILER_ENDED] appid=${appId}`);
  }, [appId]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video) setCurrentTime(video.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      setIsLoading(false);
    }
  }, []);

  const handleWaiting = useCallback(() => setIsLoading(true), []);
  const handleCanPlay = useCallback(() => setIsLoading(false), []);

  const handleVolumeChange = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setVolume(video.volume);
      setMuted(video.muted);
    }
  }, []);

  // Play overlay visibility
  const showPlayOverlay = currentIsTrailer && !videoError && (!hasStarted || !isPlaying || hasEnded);

  // Log overlay state only when it changes
  useEffect(() => {
    if (!currentIsTrailer) return;
    const reason = !videoError
      ? (!hasStarted ? "before-start" : (!isPlaying ? (hasEnded ? "ended" : "paused") : "playing"))
      : "error";
    const logKey = `${showPlayOverlay}:${reason}`;
    if (logKey === lastOverlayLogRef.current) return;
    lastOverlayLogRef.current = logKey;
    console.log(`[STORE][TRAILER_OVERLAY] appid=${appId} visible=${showPlayOverlay} reason=${reason}`);
  }, [showPlayOverlay, currentIsTrailer, videoError, hasStarted, isPlaying, hasEnded, appId]);

  // Control actions
  function handlePlayPause() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      video.play();
    } else {
      video.pause();
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const time = parseFloat(e.target.value);
    video.currentTime = time;
    setCurrentTime(time);
    console.log(`[STORE][TRAILER_SEEK] appid=${appId} currentTime=${time.toFixed(1)}`);
  }

  function handleSkip(direction: "back" | "forward") {
    const video = videoRef.current;
    if (!video) return;
    const delta = direction === "back" ? -10 : 10;
    const newTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
    video.currentTime = newTime;
    setCurrentTime(newTime);
    console.log(`[STORE][TRAILER_SKIP] appid=${appId} direction=${direction} seconds=10 currentTime=${newTime.toFixed(1)}`);
  }

  function handleVolumeSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const v = parseFloat(e.target.value);
    video.volume = v;
    video.muted = v === 0;
    console.log(`[STORE][TRAILER_VOLUME] appid=${appId} volume=${v.toFixed(2)} muted=${v === 0}`);
  }

  function handleMuteToggle() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    console.log(`[STORE][TRAILER_VOLUME] appid=${appId} volume=${video.volume.toFixed(2)} muted=${video.muted}`);
  }

  function handleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
      console.log(`[STORE][TRAILER_FULLSCREEN] appid=${appId} enabled=false`);
    } else {
      container.requestFullscreen();
      setIsFullscreen(true);
      console.log(`[STORE][TRAILER_FULLSCREEN] appid=${appId} enabled=true`);
    }
  }

  function cyclePlaybackRate() {
    const rates = [0.5, 1, 1.5, 2];
    const video = videoRef.current;
    if (!video) return;
    const idx = rates.indexOf(video.playbackRate);
    const next = rates[(idx + 1) % rates.length];
    video.playbackRate = next;
    setPlaybackRate(next);
  }

  function handleNavigate(direction: "prev" | "next") {
    const delta = direction === "prev" ? -1 : 1;
    const next = Math.max(0, Math.min(validItems.length - 1, safeIndex + delta));
    if (next !== safeIndex) {
      if (videoRef.current && isPlaying) {
        videoRef.current.pause();
      }
      setSelectedIndex(next);
      console.log(`[STORE][HERO_NAV] appid=${appId} direction=${direction} from=${safeIndex} to=${next}`);
      console.log(`[STORE][HERO_NAV_STATE] appid=${appId} selectedIndex=${next} total=${validItems.length} canPrev=${next > 0} canNext=${next < validItems.length - 1}`);
    }
  }

  // Keyboard support
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleNavigate("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNavigate("next");
      } else if (e.key === " " || e.key === "Space") {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleFullscreen();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        handleMuteToggle();
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [safeIndex, validItems.length, isPlaying]);

  function handleImageError(src: string) {
    setFailedImages((prev) => {
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  }

  function renderHeroContent() {
    if (!currentItem) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
        </div>
      );
    }

    if (currentIsTrailer) {
      const trailer = currentItem;
      const poster = trailer.poster || trailer.thumbnail;

      if (!currentPrefSrc || videoError) {
        if (poster && !videoError) {
          return (
            <img
              src={poster}
              alt={trailer.name || title}
              className="h-full w-full object-cover"
            />
          );
        }
        return (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-(--color-muted)">
            <VideoOff className="h-10 w-10" />
            <span className="text-sm">Video preview unavailable</span>
          </div>
        );
      }

      return (
        <video
          ref={videoRef}
          key={trailer.id}
          className="h-full w-full bg-black"
          playsInline
          preload="metadata"
          poster={poster}
          onError={handleVideoError}
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onWaiting={handleWaiting}
          onCanPlay={handleCanPlay}
          onVolumeChange={handleVolumeChange}
        />
      );
    }

    return (
      <AsyncImage
        src={currentItem.image}
        alt={title}
        className="h-full w-full"
        onError={() => handleImageError(currentItem.image)}
      />
    );
  }

  function getThumbnailSrc(item: StoreMediaItem): string | undefined {
    if (item.type === "trailer") {
      return item.poster || item.thumbnail;
    }
    return item.thumbnail || item.image;
  }

  // Determine if controls should be visible
  const controlsVisible = !currentIsTrailer || showControls || !isPlaying || hasEnded || !hasStarted || videoError;

  return (
    <div>
      <div className="relative overflow-hidden bg-black/60">
        <div
          ref={containerRef}
          className="relative aspect-video"
          tabIndex={0}
          onMouseMove={resetControlsTimer}
          onMouseEnter={() => setShowControls(true)}
          onMouseLeave={() => {
            if (isPlaying && !hasEnded) {
              setShowControls(false);
            }
          }}
        >
          {renderHeroContent()}

          {/* Loading spinner */}
          {isLoading && currentIsTrailer && !videoError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <Loader2 className="h-8 w-8 animate-spin text-white/60" />
            </div>
          )}

          {/* Play overlay — visible before start, on pause, or on end */}
          {showPlayOverlay && (
            <button
              type="button"
              onClick={handlePlayPause}
              className="absolute inset-0 z-20 flex cursor-pointer items-center justify-center border-0 bg-transparent"
              aria-label={hasEnded ? "Replay" : "Play"}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-transform hover:scale-105">
                <Play className="h-7 w-7 translate-x-0.5" />
              </div>
            </button>
          )}

          {/* Video error state overlay */}
          {videoError && currentIsTrailer && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-(--color-muted)">
                <VideoOff className="h-10 w-10" />
                <span className="text-sm">Video preview unavailable</span>
              </div>
            </div>
          )}

          {/* Bottom gradient + controls bar */}
          {currentIsTrailer && !videoError && (
            <div
              className={`absolute bottom-0 left-0 right-0 z-30 transition-opacity duration-300 ${
                controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              {/* Gradient background for controls */}
              <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/50 to-transparent pointer-events-none" />

              {/* Controls */}
              <div className="relative flex flex-col gap-1 px-3 pb-3 pt-8">
                {/* Seek bar */}
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-(--color-accent) [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                  aria-label="Seek"
                  title={`${formatTime(currentTime)} / ${formatTime(duration)}`}
                />

                {/* Controls row */}
                <div className="flex items-center gap-2 text-white/80">
                  {/* Play/Pause */}
                  <button
                    type="button"
                    onClick={handlePlayPause}
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-0.5 fill-current" />}
                  </button>

                  {/* Skip back 10s */}
                  <button
                    type="button"
                    onClick={() => handleSkip("back")}
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label="Rewind 10 seconds"
                  >
                    <SkipBack className="h-4 w-4 fill-current" />
                  </button>

                  {/* Time display */}
                  <span className="min-w-[70px] text-xs tabular-nums text-white/60 select-none">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Playback speed */}
                  <button
                    type="button"
                    onClick={cyclePlaybackRate}
                    className="flex h-6 items-center justify-center rounded px-1.5 text-[11px] font-medium text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
                    aria-label="Playback speed"
                  >
                    {playbackRate}x
                  </button>

                  {/* Volume slider + mute */}
                  <button
                    type="button"
                    onClick={handleMuteToggle}
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label={muted ? "Unmute" : "Mute"}
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={handleVolumeSlider}
                    className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/20 accent-(--color-accent) [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                    aria-label="Volume"
                  />

                  {/* Fullscreen */}
                  <button
                    type="button"
                    onClick={handleFullscreen}
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 transition-colors"
                    aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  >
                    {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Hero nav arrows */}
          {validItems.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => handleNavigate("prev")}
                disabled={safeIndex === 0}
                className="absolute left-3 top-1/2 z-15 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/70 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white disabled:opacity-0 disabled:pointer-events-none"
                aria-label="Previous media"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => handleNavigate("next")}
                disabled={safeIndex >= validItems.length - 1}
                className="absolute right-3 top-1/2 z-15 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/70 backdrop-blur-sm transition-all hover:bg-black/70 hover:text-white disabled:opacity-0 disabled:pointer-events-none"
                aria-label="Next media"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          {/* Badge label */}
          <div className="absolute right-3 top-3 z-15 rounded-md bg-black/60 px-2.5 py-1 text-xs text-white/60 backdrop-blur-sm">
            {badgeLabel}
          </div>

          {/* Trailer name badge */}
          {currentIsTrailer && (
            <div className="absolute bottom-3 left-3 z-15 rounded-md bg-black/60 px-2 py-1 text-xs text-white/70 backdrop-blur-sm">
              {currentItem.name || "Trailer"}
            </div>
          )}

          {/* Bottom fade */}
          <div className="absolute inset-0 bg-linear-to-t from-black via-black/25 to-transparent pointer-events-none" />

          {/* Overlay text at bottom */}
          <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8 pointer-events-none">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs text-white/70 backdrop-blur-sm">
                AppID {appId}
              </span>
            </div>

            <h1 className="max-w-4xl text-4xl font-black text-white drop-shadow-lg">
              {title}
            </h1>

            <p className="mt-2 text-sm text-white/70 drop-shadow-md">
              {developer}
            </p>

            {platforms.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {platforms.map((platform) => (
                  <span
                    key={platform}
                    className="rounded-md border border-white/10 bg-white/10 px-2.5 py-1 text-xs text-white/75 backdrop-blur-sm"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {validItems.length > 1 && (
        <div className="relative border-t border-(--surface-active-border) bg-black/60">
          <style>{`
            .store-media-rail { scrollbar-width: none; -ms-overflow-style: none; }
            .store-media-rail::-webkit-scrollbar { display: none; }
          `}</style>

          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollRail("left")}
              className="absolute left-0 top-0 z-10 flex h-full w-8 cursor-pointer items-center justify-center bg-gradient-to-r from-black/80 to-transparent text-white/70 hover:text-white"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollRail("right")}
              className="absolute right-0 top-0 z-10 flex h-full w-8 cursor-pointer items-center justify-center bg-gradient-to-l from-black/80 to-transparent text-white/70 hover:text-white"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}

          <div
            ref={railRef}
            className="store-media-rail flex gap-2 overflow-x-auto px-4 py-3"
          >
            {validItems.map((item, idx) => {
              const thumbSrc = getThumbnailSrc(item);
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    if (el) thumbRefs.current.set(idx, el);
                    else thumbRefs.current.delete(idx);
                  }}
                  type="button"
                  onClick={() => {
                    if (videoRef.current && isPlaying) {
                      videoRef.current.pause();
                    }
                    setSelectedIndex(idx);
                  }}
                  className={`relative cursor-pointer flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-200 ${
                    idx === safeIndex
                      ? "border-(--color-accent) ring-1 ring-(--color-accent)/50"
                      : "border-transparent opacity-70 hover:opacity-100"
                  }`}
                >
                  {thumbSrc ? (
                    <AsyncImage
                      src={thumbSrc}
                      alt=""
                      className="h-16 w-28"
                      onError={() => {
                        if (thumbSrc) handleImageError(thumbSrc);
                      }}
                    />
                  ) : (
                    <div className="flex h-16 w-28 items-center justify-center bg-black/40">
                      <Gamepad2 className="h-5 w-5 text-(--color-muted)" />
                    </div>
                  )}
                  {item.type === "trailer" && (
                    <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/70 backdrop-blur-sm">
                      <Play className="h-3 w-3" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  function scrollRail(direction: "left" | "right") {
    const el = railRef.current;
    if (!el) return;
    const delta = direction === "left" ? -RAIL_SCROLL_AMOUNT : RAIL_SCROLL_AMOUNT;
    el.scrollBy({ left: delta, behavior: "smooth" });
    console.log(`[STORE][MEDIA_RAIL_SCROLL] appid=${appId} direction=${direction} scrollLeft=${el.scrollLeft + delta}`);
  }
}
