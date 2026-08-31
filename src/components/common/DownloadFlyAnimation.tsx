import { useEffect, useState, useCallback } from "react";
import { Download } from "lucide-react";

interface FlyEvent {
  startRect: DOMRect;
  openModal?: boolean;
}

/**
 * Renders a flying download icon from the source button to the topbar download icon.
 * Listens for `lumaforge-download-fly` custom events carrying the start rect.
 */
export default function DownloadFlyAnimation() {
  const [flyState, setFlyState] = useState<{
    x: number;
    y: number;
    scale: number;
    opacity: number;
  } | null>(null);

  const handleFly = useCallback((e: Event) => {
    const { startRect, openModal } = (e as CustomEvent<FlyEvent>).detail;
    const endEl = document.getElementById("topbar-download-btn");
    if (!endEl) return;

    const endRect = endEl.getBoundingClientRect();
    const endX = endRect.left + endRect.width / 2;
    const endY = endRect.top + endRect.height / 2;
    const startX = startRect.left + startRect.width / 2;
    const startY = startRect.top + startRect.height / 2;

    // Start at source button center
    setFlyState({ x: startX, y: startY, scale: 0.5, opacity: 1 });

    // Animate to topbar on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyState({ x: endX, y: endY, scale: 1.2, opacity: 0.3 });
      });
    });

    // Clean up after animation
    setTimeout(() => {
      setFlyState(null);
      if (openModal) {
        window.dispatchEvent(new CustomEvent("lumaforge-open-downloads"));
      }
    }, 650);
  }, []);

  useEffect(() => {
    window.addEventListener("lumaforge-download-fly", handleFly);
    return () => window.removeEventListener("lumaforge-download-fly", handleFly);
  }, [handleFly]);

  if (!flyState) return null;

  return (
    <div
      className="pointer-events-none fixed z-[9999]"
      style={{
        left: flyState.x,
        top: flyState.y,
        transform: `translate(-50%, -50%) scale(${flyState.scale})`,
        opacity: flyState.opacity,
        transition: "all 600ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--color-accent) shadow-lg shadow-(--color-accent)/30">
        <Download className="h-5 w-5 text-(--color-accent-text)" />
      </div>
    </div>
  );
}
