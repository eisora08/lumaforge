import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CircleX, ExternalLink, MoreVertical, Pause, Play } from "lucide-react";

import type { DownloadStatus } from "../../types/download";
import type { ActiveDownload } from "../../hooks/useActiveDownload";
import { formatSpeed } from "../../hooks/useActiveDownload";
import { useCrossfadeSrc } from "../../hooks/useCrossfadeSrc";
import { useDynamicPalette } from "../../hooks/useDynamicPalette";
import { useGrowOnMount } from "../../hooks/useGrowOnMount";
import {
  subscribeHeroTransition,
  getHeroTransitionSnapshot,
} from "../../services/heroTransitionStore";
import {
  setAmbientSource,
  clearAmbientSource,
} from "../../services/ambientBackgroundStore";
import CardActionMenu, { MenuItem } from "../../components/games/CardActionMenu";

type ActiveDownloadCardProps = {
  download: ActiveDownload;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onCancel?: (id: string) => void;
};

const CANCELLABLE = new Set<DownloadStatus>([
  "queued",
  "waiting",
  "checking",
  "downloading",
  "extracting",
  "installing",
  "paused",
]);

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: "En cola",
  waiting: "Esperando",
  checking: "Verificando",
  downloading: "Descargando",
  extracting: "Extrayendo",
  installing: "Instalando",
  paused: "Pausado",
  done: "Completado",
  failed: "Fallido",
  cancelled: "Cancelado",
};

/** Control button — label visible, min 36×36 hit target. */
const CTRL_BTN =
  "inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-black/50 px-3 text-xs font-medium text-white backdrop-blur-md transition hover:bg-black/70";

/** Compact icon-only button (Open Steam, menu trigger). */
const ICON_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70";

function formatPct(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(2)}%`;
}

export default function ActiveDownloadCard({
  download,
  onPause,
  onResume,
  onCancel,
}: ActiveDownloadCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasArtwork = Boolean(download.coverImageUrl) && !imgFailed;
  const artSrc = hasArtwork ? download.coverImageUrl : null;

  // Grow the main progress bar from 0 to its current value on mount.
  const growProgress = useGrowOnMount();

  // Hero transition preference (Ajustes → Animaciones).
  const heroTransition = useSyncExternalStore(
    subscribeHeroTransition,
    getHeroTransitionSnapshot,
    getHeroTransitionSnapshot
  ).id;

  // Two-layer crossfade when switching between active downloads.
  const { prevSrc, currentSrc } = useCrossfadeSrc(artSrc);

  // Dynamic Effect palette sampled from the artwork (fallback when tainted).
  const palette = useDynamicPalette(currentSrc);

  // Feed the global ambient background with the active download's artwork.
  useEffect(() => {
    if (currentSrc) {
      setAmbientSource("downloads-hero", currentSrc);
    }
  }, [currentSrc]);
  useEffect(() => () => clearAmbientSource("downloads-hero"), []);

  // ••• overflow menu (portal-based, so it is never clipped by the hero).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const handleCancel = useCallback(() => {
    setMenuOpen(false);
    onCancel?.(download.id);
  }, [onCancel, download.id]);

  const canPause =
    download.isDebrid &&
    CANCELLABLE.has(download.status) &&
    download.status !== "paused";
  const canResume = download.isDebrid && download.status === "paused";
  const canCancel = CANCELLABLE.has(download.status);
  const isPaused = download.status === "paused";
  const indeterminate = download.progressMode !== "determinate";
  const isOpenSteam =
    download.isSteam &&
    (download.status === "waiting" || download.status === "downloading");

  const sizeLine =
    download.totalBytes > 0
      ? `${formatBytesLocal(download.downloadedBytes)} de ${formatBytesLocal(download.totalBytes)}`
      : null;

  const statusLabel = STATUS_LABEL[download.status] ?? download.status;
  const metadataParts = [
    download.repacker && download.isDebrid ? download.repacker : null,
    download.isTorrent ? "Torrent" : null,
    download.isSteam ? "Steam" : null,
  ].filter(Boolean);

  const progressValue = Math.max(0, Math.min(1, download.percentage / 100));

  return (
    <article className="relative flex flex-col rounded-2xl border border-(--surface-active-border)">
      {/* Artwork container — overflow hidden ONLY here, never over controls/focus. */}
      <div className="absolute inset-0 overflow-hidden rounded-2xl">
        {heroTransition === "crossfade" ? (
          <>
            {prevSrc && prevSrc !== currentSrc && (
              <img
                src={prevSrc}
                alt=""
                className="absolute inset-0 h-full w-full animate-hero-media-out object-cover brightness-[0.5]"
                loading="eager"
              />
            )}
            {currentSrc && (
              <img
                src={currentSrc}
                alt=""
                className="absolute inset-0 h-full w-full animate-hero-crossfade-in object-cover brightness-[0.5]"
                loading="eager"
                onError={() => setImgFailed(true)}
              />
            )}
          </>
        ) : (
          artSrc && (
            <img
              src={artSrc}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover brightness-[0.5] ${
                heroTransition === "kenburns"
                  ? "animate-hero-kenburns-in"
                  : "animate-hero-focus-in"
              }`}
              loading="eager"
              onError={() => setImgFailed(true)}
            />
          )
        )}
        {!artSrc && <div className="absolute inset-0 bg-(--color-bg)" />}
      </div>

      {/* Dynamic Effect — tint + localized glow derived from the artwork palette. */}
      <div
        className="lf-download-dynamic pointer-events-none absolute inset-0"
        style={
          {
            "--dynamic-primary": palette.primary,
            "--dynamic-secondary": palette.secondary,
            "--dynamic-glow": palette.glow,
          } as React.CSSProperties
        }
      >
        <div className="lf-download-tint absolute inset-0" />
        <div className="lf-download-glow absolute inset-0" />
      </div>

      {/* Readability overlays (never intercept pointer events). */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-black/55 via-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/65 via-transparent to-black/25" />

      {/* Editorial + main progress row (own row above the capsule, no surface). */}
      <div className="relative z-10 flex min-h-[260px] flex-col justify-between gap-5 px-5 pt-6 sm:min-h-[300px] sm:px-6">
        <header className="lf-download-title-in">
          <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300/90">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
            </span>
            Descarga activa
          </p>
          <h2 className="line-clamp-2 text-2xl font-semibold leading-tight text-white sm:text-3xl">
            {download.gameName}
          </h2>
          <p className="mt-1.5 text-sm text-white/70">
            {[statusLabel, ...metadataParts].filter(Boolean).join(" · ")}
          </p>
        </header>

        <div className="pb-2">
          <div className="mb-2 flex items-end justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-white/80">
              {sizeLine
                ? `${sizeLine}${download.timeRemaining ? ` · ${download.timeRemaining}` : ""}`
                : download.message || statusLabel}
            </p>
            <span className="shrink-0 text-base font-bold tabular-nums text-white">
              {indeterminate ? "—" : formatPct(download.percentage)}
            </span>
          </div>
          <div className="h-[5px] w-full overflow-hidden rounded-full bg-white/15 sm:h-[6px]">
            {indeterminate ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-white/60" />
            ) : (
              <div
                className="lf-download-progress-fill h-full w-full origin-left rounded-full bg-linear-to-r from-(--color-accent) to-cyan-300"
                style={{ transform: `scaleX(${growProgress ? progressValue : 0})` }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Floating Download Core — single acrylic capsule over the artwork. */}
      <div className="lf-download-capsule lf-download-capsule-in relative z-20 mx-4 mb-4 mt-2 flex min-h-[76px] flex-wrap items-center gap-3 rounded-2xl px-4 py-3 md:mx-[18px] md:h-[76px] md:flex-nowrap md:gap-4 md:px-5 md:py-0">
        {/* Zone A — current speed + peak */}
        <div className="flex w-[104px] shrink-0 flex-col">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
            Velocidad
          </span>
          <span className="text-xl font-bold leading-tight tabular-nums text-white">
            {formatSpeed(download.currentSpeedBytes) || "—"}
          </span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.16em] tabular-nums text-white/40">
            Pico {formatSpeed(download.peakSpeedBytes) || "—"}
          </span>
        </div>

        <div className="h-9 w-px shrink-0 bg-white/10" aria-hidden="true" />

        {/* Zone B — live speed chart */}
        <SpeedChart values={download.speedHistory} frozen={isPaused} />

        <div className="h-9 w-px shrink-0 bg-white/10" aria-hidden="true" />

        {/* Zone C — live torrent swarm stats (real seeds/peers). Hidden until
            the first installer-network event arrives for this job. */}
        {download.isTorrent &&
          (download.peers != null || download.seeds != null) && (
            <div className="flex shrink-0 items-center gap-3 md:gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
                  Seeds
                </span>
                <span className="text-base font-bold leading-tight tabular-nums text-white">
                  {download.seeds ?? "—"}
                </span>
              </div>
              <div className="h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
              <div className="flex flex-col">
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
                  Peers
                </span>
                <span className="text-base font-bold leading-tight tabular-nums text-white">
                  {download.peers ?? "—"}
                </span>
              </div>
            </div>
          )}

        <div className="h-9 w-px shrink-0 bg-white/10" aria-hidden="true" />

        {/* Zone D — controls. Buttons render when canX (handler optional). */}
        <div className="flex shrink-0 items-center gap-2">
          {canPause && (
            <button
              type="button"
              onClick={() => onPause?.(download.id)}
              className={CTRL_BTN}
              title="Pausar descarga"
            >
              <Pause className="h-3.5 w-3.5" />
              Pausar
            </button>
          )}

          {canResume && (
            <button
              type="button"
              onClick={() => onResume?.(download.id)}
              className={CTRL_BTN}
              title="Reanudar descarga"
            >
              <Play className="h-3.5 w-3.5" />
              Reanudar
            </button>
          )}

          {isOpenSteam && (
            <a
              href={`steam://install/${download.appId}`}
              title="Abrir Steam"
              className={ICON_BTN}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}

          <button
            ref={menuAnchorRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={ICON_BTN}
            title="Más opciones"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>

        <CardActionMenu open={menuOpen} anchorRef={menuAnchorRef} onClose={closeMenu}>
          {canCancel && (
            <MenuItem
              label="Cancelar descarga"
              icon={<CircleX className="h-3.5 w-3.5" />}
              destructive
              onClick={handleCancel}
            />
          )}
        </CardActionMenu>
      </div>
    </article>
  );
}

function formatBytesLocal(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Live speed bar chart. Presentational only — derives bar count from the
 * viewport (24 desktop / 18 medium / 12 small), pauses motion while the tab is
 * hidden, desaturates when the download is paused, grows all bars from 0 on
 * mount, and plays a slide-in entrance on the newest bar when a fresh sample
 * arrives.
 */
function SpeedChart({ values, frozen }: { values: number[]; frozen: boolean }) {
  const [visible, setVisible] = useState(true);
  const [barCount, setBarCount] = useState(20);
  const [hovered, setHovered] = useState<number | null>(null);

  // Grow all bars from 0 to their current height on mount.
  const grow = useGrowOnMount();

  // Freeze motion when the tab is hidden (samples keep arriving but we don't
  // want an invisible chart animating in the background).
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Responsive bar count.
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      setBarCount(w >= 1280 ? 24 : w >= 640 ? 18 : 12);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const frozenOrHidden = frozen || !visible;

  // Fixed-length lane: the most recent `barCount` real samples are left-aligned,
  // and every trailing slot is a zero-height placeholder. The chart always
  // spans the full width and visibly fills left → right as samples arrive —
  // no blank space while the history is short (young downloads, fast
  // downloads, torrents whose emits used to be percent-change-only).
  const recent = values.slice(-barCount);
  const slots: (number | null)[] = [];
  for (let i = 0; i < barCount; i++) {
    slots.push(i < recent.length ? recent[i] : null);
  }
  const max = Math.max(1, ...recent);
  const lastReal = recent.length - 1;

  return (
    <div
      className={`relative flex h-[52px] min-w-0 flex-1 items-end gap-[3px] md:gap-1 ${
        frozenOrHidden ? "lf-download-chart-frozen" : ""
      }`}
    >
      {values.length > 0 ? (
        slots.map((v, i) => {
          if (v == null) {
            return (
              <div
                key={`empty-${i}`}
                className="lf-download-chart-bar w-[3px] rounded-t-[2px] bg-white/10 md:w-[4px]"
                style={{ height: "0%" }}
              />
            );
          }
          const isNew = i === lastReal;
          const h = Math.max(6, (v / max) * 100);
          return (
            <div
              key={isNew ? `new-${values.length}` : `bar-${i}`}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className={`lf-download-chart-bar w-[3px] rounded-t-[2px] md:w-[4px] ${
                isNew ? "lf-download-bar-new lf-download-chart-bar-new" : "lf-download-bar-old"
              }`}
              style={{ height: `${grow ? h : 0}%` }}
            />
          );
        })
      ) : (
        <div className="h-1/2 w-2 animate-pulse rounded-t-[2px] bg-white/25" />
      )}

      {hovered != null && slots[hovered] != null && (
        <div
          className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-black/85 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white shadow-lg"
          style={{ left: `${((hovered + 0.5) / barCount) * 100}%` }}
        >
          {formatSpeed(slots[hovered] as number)}
        </div>
      )}
    </div>
  );
}
