import { useEffect, useState } from "react";
import { Gamepad2, Play, Square } from "lucide-react";
import type { OverlayEvent } from "../../context/GameSessionContext";
import { formatSessionDuration } from "../../utils/sessionUtils";

type Props = {
  event: OverlayEvent | null;
  onDismiss: () => void;
};

export default function GameSessionOverlay({ event, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!event) {
      setVisible(false);
      setDismissing(false);
      return;
    }

    const showTimer = setTimeout(() => setVisible(true), 10);
    const autoDismissMs = event.type === "launch" ? 3000 : 4000;
    const autoTimer = setTimeout(() => handleDismiss(), autoDismissMs);

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleDismiss();
    }
    document.addEventListener("keydown", handleKey);

    function handleDismiss() {
      setDismissing(true);
      setTimeout(() => {
        setVisible(false);
        onDismiss();
      }, 300);
    }

    return () => {
      clearTimeout(showTimer);
      clearTimeout(autoTimer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [event?.id]);

  if (!event) return null;

  const providerLabel = event.provider === "steam" ? "Steam" : event.provider === "local" ? "Local" : "Unknown";

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[50000] flex items-center justify-center transition-opacity duration-300 ${
        visible && !dismissing ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="pointer-events-auto mx-4 w-full max-w-xs overflow-hidden rounded-2xl border border-white/10 bg-[#101014] shadow-2xl transition-all duration-300"
        style={{
          transform: visible && !dismissing ? "translateY(0) scale(1)" : "translateY(20px) scale(0.95)",
        }}
      >
        {event.imageUrl ? (
          <div className="relative h-32 w-full overflow-hidden bg-white/5">
            <img
              src={event.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#101014] via-transparent to-transparent" />
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center bg-white/[0.03]">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)" />
          </div>
        )}

        <div className="px-5 pb-5 pt-4 text-center">
          <h3 className="text-base font-bold text-white">
            {event.gameTitle}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-muted)">
            {providerLabel}
          </p>

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
