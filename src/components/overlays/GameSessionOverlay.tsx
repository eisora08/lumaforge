import { useEffect, useRef, useState } from "react";
import { Gamepad2, Play, Square } from "lucide-react";
import type { OverlayEvent } from "../../context/GameSessionContext";
import { formatSessionDuration } from "../../utils/sessionUtils";
import { localPathToUrl, resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";

type Props = {
  event: OverlayEvent | null;
  onDismiss: () => void;
};

export default function GameSessionOverlay({ event, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve image URL — heroUrl (background-first) for overlay hero, falls back to imageUrl
  useEffect(() => {
    const rawUrl = event?.heroUrl ?? event?.imageUrl;
    if (!rawUrl) { setResolvedUrl(null); return; }
    // Already a full URL (http, asset, data) — use directly
    if (rawUrl.startsWith("http") || rawUrl.startsWith("asset://") || rawUrl.startsWith("data:") || rawUrl.startsWith("file://")) {
      setResolvedUrl(rawUrl);
      return;
    }
    // Try localPathToUrl first (handles absolute Windows paths)
    const local = localPathToUrl(rawUrl);
    if (local) { setResolvedUrl(local); return; }
    // Fallback: async resolution for relative paths (e.g. "games/manual/<id>/media/background.jpg")
    let cancelled = false;
    resolveProviderMediaPreviewUrl(rawUrl).then((resolved) => {
      if (!cancelled) setResolvedUrl(resolved);
    });
    return () => { cancelled = true; };
  }, [event?.heroUrl, event?.imageUrl]);

  useEffect(() => {
    if (!event) {
      setVisible(false);
      setDismissing(false);
      return;
    }

    setImageFailed(false);
    const showTimer = setTimeout(() => setVisible(true), 10);
    const autoDismissMs = event.type === "launch" ? 3000 : 4000;

    function handleDismiss() {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      setDismissing(true);
      dismissTimerRef.current = setTimeout(() => {
        setVisible(false);
        onDismiss();
      }, 300);
    }

    const autoTimer = setTimeout(handleDismiss, autoDismissMs);

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleDismiss();
    }
    document.addEventListener("keydown", handleKey);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(autoTimer);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      document.removeEventListener("keydown", handleKey);
    };
  }, [event?.id]);

  if (!event) return null;

  const displayTitle = event.provider
    ? `${event.gameTitle} (${event.provider})`
    : event.gameTitle;

  const showImage = resolvedUrl && !imageFailed;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[50000] flex justify-center transition-opacity duration-300 ${visible && !dismissing ? "opacity-100" : "opacity-0"
        }`}
      style={{
        top: "clamp(96px, 18vh, 180px)",
      }}
    >
      <div
        className="pointer-events-auto mx-4 w-full max-w-xs overflow-hidden rounded-2xl border border-(--surface-active-border) lf-surface shadow-2xl transition-all duration-300"
        style={{
          transform: visible && !dismissing ? "translateY(0) scale(1)" : "translateY(20px) scale(0.95)",
        }}
      >
        {showImage ? (
          <div className="relative h-32 w-full overflow-hidden bg-white/5">
            <img
              src={resolvedUrl!}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-(--surface-active) via-transparent to-transparent" />
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center bg-white/[0.03]">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}

        <div className="px-5 pb-5 pt-4 text-center">
          <h3 className="text-base font-bold text-white">
            {displayTitle}
          </h3>

          <div className="mt-3 flex items-center justify-center gap-2">
            {event.type === "launch" ? (
              <>
                <Play className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">
                  Playtime starting!
                </span>
              </>
            ) : (
              <>
                <Square className="h-4 w-4 text-(--color-muted)" />
                <span className="text-sm text-(--color-muted)">
                  You played for{" "}
                  <span className="font-medium text-white">
                    {event.durationSeconds != null
                      ? formatSessionDuration(event.durationSeconds)
                      : "a while"}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
