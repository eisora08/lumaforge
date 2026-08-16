import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryGame } from "../../types/libraryGame";
import { getPlaytimeEntryByAppId, formatPlaytime } from "../../services/playtimeService";

const POPUP_WIDTH = 300;
const POPUP_IMAGE_HEIGHT = 170;
const CYCLE_MS = 2000;
const CROSSFADE_MS = 400;

function formatRelativeTime(unixSeconds: number | null): string {
  if (!unixSeconds) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

type GameHoverPreviewProps = {
  game: LibraryGame;
  position: DOMRect;
};

export default function GameHoverPreview({ game, position }: GameHoverPreviewProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  // Screenshot carousel
  const screenshots = game.metadata?.screenshots ?? [];
  const hasScreenshots = screenshots.length > 0;
  const [currentIndex, setCurrentIndex] = useState(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (!hasScreenshots || screenshots.length <= 1) return;
    const interval = setInterval(() => {
      if (!pausedRef.current) {
        setCurrentIndex((i) => (i + 1) % screenshots.length);
      }
    }, CYCLE_MS);
    return () => clearInterval(interval);
  }, [hasScreenshots, screenshots.length]);

  // Reset carousel on game change
  useEffect(() => {
    setCurrentIndex(0);
  }, [game.appId]);

  // Playtime
  const playtime = useMemo(() => {
    const entry = getPlaytimeEntryByAppId(game.appId ?? "");
    if (!entry) return null;
    return {
      total: formatPlaytime(entry.totalPlaytimeSeconds),
      lastPlayed: formatRelativeTime(entry.lastPlayedAt),
      lastPlayedAt: entry.lastPlayedAt,
    };
  }, [game.appId]);

  // Cover image for fallback
  const coverSrc = game.backgroundPath || game.landscapePath || game.coverPath || game.imageUrl || "";

  // Position: right of card, clamp to viewport
  const style = useMemo(() => {
    const gap = 14;
    let left = position.right + gap;
    let top = position.top;

    // If overflows right edge, show on left
    if (left + POPUP_WIDTH > window.innerWidth - 20) {
      left = position.left - POPUP_WIDTH - gap;
    }

    // Clamp vertical
    const popupHeight = POPUP_IMAGE_HEIGHT + 120;
    if (top + popupHeight > window.innerHeight - 20) {
      top = window.innerHeight - popupHeight - 20;
    }
    if (top < 20) top = 20;
    if (left < 20) left = 20;

    return { left, top };
  }, [position]);

  const popup = (
    <div
      ref={popupRef}
      className="lf-game-hover-preview z-[100]"
      style={{
        position: "fixed",
        left: style.left,
        top: style.top,
        width: POPUP_WIDTH,
      }}
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
    >
      <div className="overflow-hidden rounded-xl border border-white/10 lf-surface shadow-2xl shadow-black/60">
        {/* Screenshot area */}
        <div className="relative" style={{ height: POPUP_IMAGE_HEIGHT }}>
          {hasScreenshots ? (
            <>
              {/* Previous (crossfading out) */}
              {screenshots.length > 1 && (
                <img
                  key={`prev-${currentIndex}`}
                  src={screenshots[(currentIndex - 1 + screenshots.length) % screenshots.length]}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity: 0,
                    animation: `hoverPreviewFadeOut ${CROSSFADE_MS}ms ease-out forwards`,
                  }}
                />
              )}
              {/* Current */}
              <img
                key={`cur-${currentIndex}`}
                src={screenshots[currentIndex]}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  opacity: 1,
                  animation: `hoverPreviewFadeIn ${CROSSFADE_MS}ms ease-out forwards`,
                }}
              />
              {/* Dots indicator */}
              {screenshots.length > 1 && (
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                  {screenshots.slice(0, Math.min(screenshots.length, 8)).map((_, i) => (
                    <div
                      key={i}
                      className="h-1 rounded-full transition-all duration-300"
                      style={{
                        width: i === currentIndex ? 12 : 4,
                        backgroundColor: i === currentIndex ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            /* Fallback: cover art */
            <div className="flex h-full w-full items-center justify-center bg-white/[0.03]">
              {coverSrc ? (
                <img src={coverSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-white/30">No preview</span>
              )}
            </div>
          )}
        </div>

        {/* Info section */}
        <div className="p-3">
          <h3 className="truncate text-[13px] font-semibold text-white">{game.title}</h3>

          {/* Playtime row */}
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-white/50">
            {playtime ? (
              <>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {playtime.total}
                </span>
                {playtime.lastPlayed && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {playtime.lastPlayed}
                  </span>
                )}
              </>
            ) : (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Not played
              </span>
            )}
          </div>

          {/* Developer / publisher */}
          {(game.metadata?.developer || game.metadata?.publishers) && (
            <p className="mt-1 truncate text-[10px] text-white/35">
              {[game.metadata.developer, game.metadata.publishers?.[0]].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}

// Lazy icon imports (small, inline)
function Clock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function Calendar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
