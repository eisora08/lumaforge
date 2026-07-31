import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import {
  subscribeAmbient,
  getAmbientSnapshot,
  type AmbientIntensity,
} from "../../services/ambientBackgroundStore";

const INTENSITY_STYLES: Record<
  AmbientIntensity,
  { artOpacity: string; blur: string; dim: string }
> = {
  sutil: { artOpacity: "opacity-30", blur: "blur-xl", dim: "bg-black/50" },
  equilibrado: { artOpacity: "opacity-40", blur: "blur-2xl", dim: "bg-black/45" },
  vivido: { artOpacity: "opacity-55", blur: "blur-3xl", dim: "bg-black/40" },
};

const CROSSFADE_MS = 650;

export default function AmbientBackground() {
  const { url, enabled, intensity } = useSyncExternalStore(
    subscribeAmbient,
    getAmbientSnapshot,
    getAmbientSnapshot,
  );

  // Two-layer crossfade: keep the previous image mounted and fade it out while
  // the new one fades in, instead of a hard key-based swap.
  const [prevUrl, setPrevUrl] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(url);

  useEffect(() => {
    if (url === null) {
      lastUrlRef.current = null;
      setPrevUrl(null);
      return;
    }
    if (lastUrlRef.current !== url) {
      setPrevUrl(lastUrlRef.current);
      lastUrlRef.current = url;
      const t = setTimeout(() => setPrevUrl(null), CROSSFADE_MS);
      return () => clearTimeout(t);
    }
  }, [url]);

  if (!enabled || !url) return null;

  const style = INTENSITY_STYLES[intensity] ?? INTENSITY_STYLES.equilibrado;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
    >
      <div className={`absolute inset-0 ${style.artOpacity}`}>
        {prevUrl && (
          <img
            key={`out-${prevUrl}`}
            src={prevUrl}
            alt=""
            draggable={false}
            loading="eager"
            className={`animate-ambient-out absolute inset-0 h-full w-full scale-110 object-cover ${style.blur}`}
          />
        )}
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          loading="eager"
          className={`animate-ambient-in absolute inset-0 h-full w-full scale-110 object-cover ${style.blur}`}
        />
      </div>
      <div className={`absolute inset-0 ${style.dim}`} />
      <div className="absolute inset-0 bg-linear-to-t from-(--color-bg)/75 via-transparent to-(--color-bg)/40" />
    </div>
  );
}
