import { memo } from "react";
import { Gamepad2, Heart } from "lucide-react";
import type { LibraryGame } from "../../types/libraryGame";
import { useFavorites } from "../../context/FavoritesContext";
import { getConsoleCardSrc } from "./consoleMedia";
import { getFavoriteKey } from "../../services/gameCacheService";
import { getPlatformShortName } from "../../utils/platformUtils";

type Props = {
  game: LibraryGame;
  isFocused?: boolean;
  isRunning?: boolean;
  onClick?: () => void;
  compact?: boolean;
  variant?: "landscape" | "poster";
  noLabel?: boolean;
  cardWidth?: number;
  noTitle?: boolean;
  cornerRadius?: number;
  onHover?: (game: LibraryGame) => void;
  onHoverEnd?: () => void;
};

function ConsoleGameCardRaw({ game, isFocused, isRunning, onClick, compact, variant = "landscape", noLabel, cardWidth, noTitle, cornerRadius, onHover, onHoverEnd }: Props) {
  const { isFavorite } = useFavorites();
  const fav = isFavorite(getFavoriteKey(game) ?? game.id);
  const isSpotlight = !compact;
  const radius = cornerRadius ?? 16;

  const src = getConsoleCardSrc(game, variant);

  const _seedCompletedAt = Number(localStorage.getItem("_lumaforge_seed_completed_at") ?? "0");
  const NEW_THRESHOLD_MS = 48 * 60 * 60 * 1000;
  const isNew = _seedCompletedAt > 0
    && game.createdAt != null
    && game.createdAt > _seedCompletedAt
    && (Date.now() - game.createdAt) < NEW_THRESHOLD_MS;

  const widthStyle = cardWidth ? { width: `${cardWidth}px` } : undefined;

  const spotlightFocusStyle = isFocused && isSpotlight ? {
    boxShadow: "0 35px 80px -20px rgba(0,0,0,0.7), 0 0 50px color-mix(in srgb, var(--color-accent) 30%, transparent)",
  } as React.CSSProperties : undefined;

  return (
    <div
      role="button"
      tabIndex={isFocused ? 0 : -1}
      aria-label={game.title}
      onClick={onClick}
      onMouseEnter={() => onHover?.(game)}
      onMouseLeave={() => onHoverEnd?.()}
      className={`relative cursor-pointer border transition-[transform,opacity,border-color] duration-[200ms] ease-out shrink-0 ${
        compact ? "" : variant === "poster" ? "w-[200px]" : "w-[280px]"
      } ${cardWidth ? "" : "shrink-0"} ${
        isFocused
          ? `z-[80] border-(--color-accent) ring-3 ring-(--color-accent)/70 shadow-none saturate-[1.05] brightness-[1.03] ${
              isSpotlight ? "scale-[1.18] -translate-y-11" : "scale-[1.04]"
            }`
          : `${
              isSpotlight
                ? "z-[5] scale-[0.96] opacity-[0.78] brightness-[0.88] hover:!z-[30] hover:!scale-[1.04] hover:!-translate-y-2.5 hover:!opacity-100 hover:!brightness-100"
                : ""
            } border-(--surface-active-border) hover:border-(--color-accent)/40 hover:shadow-lg hover:shadow-(--color-accent)/10`
      }`}
      style={{ borderRadius: radius, ...widthStyle, ...spotlightFocusStyle, willChange: "transform" }}
    >
      <div className={`relative overflow-hidden ${
        variant === "poster" ? "aspect-[2/3]" : "aspect-[16/10]"
      }`}
      style={{ borderRadius: radius }}
      >
        {src ? (
          <img
            key={game.appId || game.id}
            src={src}
            alt={game.title}
            className="h-full w-full object-cover"
            onLoad={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "";
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-(--color-surface)/40">
            <Gamepad2 className="h-10 w-10 text-(--color-muted)/30" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100" />

        {/* Focus shine sweep — only on focused card */}
        {isFocused && (
          <div
            className="console-card-shine pointer-events-none absolute inset-0 overflow-hidden"
            style={{ borderRadius: radius, mixBlendMode: "screen" }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(105deg, transparent 25%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.12) 50%, transparent 65%)",
                animation: "console-shine-sweep 1.8s ease-in-out infinite",
              }}
            />
          </div>
        )}

        {/* Favorite heart */}
        {fav && (
          <div className="absolute right-2 top-9 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            <Heart className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
          </div>
        )}

        {/* Badges */}
        <div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-1">
          {isNew && (
            <span className="rounded-full bg-blue-500/80 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              NEW
            </span>
          )}
          {isRunning && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
              Running
            </span>
          )}
          {game.hasUpdate && (
            <span className="rounded-md bg-amber-500/80 px-2 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
              Update
            </span>
          )}
          {(() => {
            const emulatorPlatformLabel = game.source === "emulator" ? getPlatformShortName(game.emulatorPlatform) : null;
            const srcBadge = game.hasLua
              ? { label: "LUA", cls: "bg-emerald-500/80" }
              : game.source === "steam" && !game.hasLua
                ? { label: "STEAM", cls: "bg-blue-500/80" }
                : game.source === "epic"
                  ? { label: "EPIC", cls: "bg-purple-500/80" }
                  : game.source === "debrid"
                    ? { label: "DEBRID", cls: "bg-cyan-500/80" }
                    : game.source === "manual"
                      ? { label: "MANUAL", cls: "bg-sky-500/80" }
                      : game.source === "emulator"
                        ? { label: emulatorPlatformLabel ? `${emulatorPlatformLabel} • EMULATOR` : "EMULATOR", cls: "bg-rose-500/80" }
                        : null;
            if (!srcBadge) return null;
            return (
              <span className={`rounded-md ${srcBadge.cls} px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm`}>
                {srcBadge.label}
              </span>
            );
          })()}
        </div>

        {/* Title gradient overlay for landscape variant — hidden with noTitle */}
        {variant !== "poster" && !noTitle && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pt-8 pb-2">
            <h3 className="line-clamp-2 text-sm font-semibold text-white leading-tight">
              {game.title}
            </h3>
          </div>
        )}
      </div>

      {/* Title below for poster variant — hidden with noLabel or noTitle */}
      {variant === "poster" && !noLabel && !noTitle && (
        <div className="px-1.5 pt-1.5 pb-1.5">
          <h3 className="line-clamp-2 text-xs font-semibold text-(--color-text) leading-snug">
            {game.title}
          </h3>
        </div>
      )}
    </div>
  );
}

const ConsoleGameCard = memo(ConsoleGameCardRaw);
export default ConsoleGameCard;
